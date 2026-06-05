import { Events } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureForGuild } = vi.hoisted(() => ({ captureForGuild: vi.fn() }));
const { runReactionTriggers } = vi.hoisted(() => ({ runReactionTriggers: vi.fn() }));

vi.mock("../../src/capture.js", () => ({
  captureForGuild,
  toPersonLike: (u: { id: string; username: string; globalName?: string | null; bot?: boolean }) => ({
    id: u.id,
    username: u.username,
    globalName: u.globalName ?? null,
    bot: !!u.bot,
  }),
}));
vi.mock("../../src/triggers.js", () => ({ runReactionTriggers }));

const { register } = await import("../../src/events/reactions.js");

function client() {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  register({ on: (e: string, cb: never) => handlers.set(e, cb) } as never);
  return { fire: (e: string, ...a: unknown[]) => handlers.get(e)?.(...a) };
}

function reaction(emoji: { name: string | null; id: string | null }, guildId: string | null = "g1") {
  return { message: { guildId, channel: { id: "c1", name: "general", type: 0 } }, emoji };
}
const user = { id: "u1", username: "a", globalName: null, bot: false, partial: false };

beforeEach(() => vi.clearAllMocks());

describe("MessageReactionAdd", () => {
  it("captures reaction_added with emoji props and runs triggers", () => {
    client().fire(Events.MessageReactionAdd, reaction({ name: "🎫", id: null }), user);
    const arg = captureForGuild.mock.calls[0][0];
    expect(arg).toMatchObject({ event: "reaction_added", distinctId: "u1" });
    expect(arg.properties).toMatchObject({
      channel_id: "c1",
      emoji_name: "🎫",
      emoji_id: null,
      is_custom_emoji: false,
    });
    expect(runReactionTriggers).toHaveBeenCalledTimes(1);
  });

  it("marks custom emoji", () => {
    client().fire(Events.MessageReactionAdd, reaction({ name: "tick", id: "123" }), user);
    expect(captureForGuild.mock.calls[0][0].properties).toMatchObject({
      emoji_id: "123",
      is_custom_emoji: true,
    });
  });

  it("omits the actor for a partial user", () => {
    client().fire(Events.MessageReactionAdd, reaction({ name: "🙂", id: null }), {
      id: "u9",
      partial: true,
    });
    expect(captureForGuild.mock.calls[0][0].actor).toBeUndefined();
  });

  it("ignores DM reactions", () => {
    client().fire(Events.MessageReactionAdd, reaction({ name: "🙂", id: null }, null), user);
    expect(captureForGuild).not.toHaveBeenCalled();
  });
});

describe("MessageReactionRemove", () => {
  it("captures reaction_removed and does NOT run triggers", () => {
    client().fire(Events.MessageReactionRemove, reaction({ name: "🎫", id: null }), user);
    expect(captureForGuild.mock.calls[0][0]).toMatchObject({ event: "reaction_removed" });
    expect(runReactionTriggers).not.toHaveBeenCalled();
  });
});
