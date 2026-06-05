import { Events } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureForGuild } = vi.hoisted(() => ({ captureForGuild: vi.fn() }));
vi.mock("../../src/capture.js", () => ({ captureForGuild }));

const { register } = await import("../../src/events/threads.js");

function client() {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  register({ on: (e: string, cb: never) => handlers.set(e, cb) } as never);
  return { fire: (e: string, ...a: unknown[]) => handlers.get(e)?.(...a) };
}

function thread(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    name: "help",
    ownerId: "u1",
    parentId: "c1",
    parent: { name: "general" },
    guild: { id: "g1", name: "G" },
    ...over,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("ThreadCreate", () => {
  it("captures thread_created for a newly created thread", () => {
    client().fire(Events.ThreadCreate, thread(), true);
    expect(captureForGuild.mock.calls[0][0]).toMatchObject({
      event: "thread_created",
      distinctId: "u1",
      properties: {
        thread_id: "t1",
        thread_name: "help",
        parent_channel_id: "c1",
        parent_channel_name: "general",
      },
    });
  });

  it("ignores threads the bot merely gained access to", () => {
    client().fire(Events.ThreadCreate, thread(), false);
    expect(captureForGuild).not.toHaveBeenCalled();
  });

  it("skips threads with no owner to attribute", () => {
    client().fire(Events.ThreadCreate, thread({ ownerId: null }), true);
    expect(captureForGuild).not.toHaveBeenCalled();
  });
});
