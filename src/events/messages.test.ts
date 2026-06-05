import { Events, MessageType } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureForGuild } = vi.hoisted(() => ({ captureForGuild: vi.fn() }));
const { runMessageTriggers } = vi.hoisted(() => ({ runMessageTriggers: vi.fn() }));

vi.mock("../capture.js", () => ({
  captureForGuild,
  toPersonLike: (u: { id: string; username: string; globalName?: string | null; bot?: boolean }) => ({
    id: u.id,
    username: u.username,
    globalName: u.globalName ?? null,
    bot: !!u.bot,
  }),
}));
vi.mock("../triggers.js", () => ({ runMessageTriggers }));

const { register } = await import("./messages.js");

function client() {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  register({ on: (e: string, cb: never) => handlers.set(e, cb) } as never);
  return { fire: (e: string, ...a: unknown[]) => handlers.get(e)?.(...a) };
}

const author = { id: "u1", username: "alice", globalName: "Alice", bot: false };
const guild = { id: "g1", name: "G" };
const channel = { id: "c1", name: "general", type: 0 };

beforeEach(() => vi.clearAllMocks());

describe("MessageCreate", () => {
  it("captures message_sent with metadata and runs triggers", () => {
    const msg = {
      inGuild: () => true,
      guildId: "g1",
      author,
      guild,
      channel,
      content: "hello world",
      attachments: { size: 2 },
      mentions: { users: { size: 1 }, roles: { size: 1 } },
      type: MessageType.Default,
      embeds: [],
    };
    client().fire(Events.MessageCreate, msg);
    expect(captureForGuild).toHaveBeenCalledTimes(1);
    const arg = captureForGuild.mock.calls[0][0];
    expect(arg).toMatchObject({ guildId: "g1", event: "message_sent", distinctId: "u1" });
    expect(arg.properties).toMatchObject({
      guild_id: "g1",
      channel_id: "c1",
      message_length: 11,
      attachment_count: 2,
      mention_count: 2,
      is_reply: false,
      has_embed: false,
    });
    expect(runMessageTriggers).toHaveBeenCalledWith(msg);
  });

  it("ignores DMs", () => {
    client().fire(Events.MessageCreate, { inGuild: () => false });
    expect(captureForGuild).not.toHaveBeenCalled();
    expect(runMessageTriggers).not.toHaveBeenCalled();
  });

  it("flags replies and embeds", () => {
    client().fire(Events.MessageCreate, {
      inGuild: () => true,
      guildId: "g1",
      author,
      guild,
      channel,
      content: "x",
      attachments: { size: 0 },
      mentions: { users: { size: 0 }, roles: { size: 0 } },
      type: MessageType.Reply,
      embeds: [{}],
    });
    expect(captureForGuild.mock.calls[0][0].properties).toMatchObject({
      is_reply: true,
      has_embed: true,
    });
  });
});

describe("MessageUpdate", () => {
  const edited = (over: Record<string, unknown> = {}) => ({
    inGuild: () => true,
    guildId: "g1",
    editedTimestamp: 123,
    author,
    guild,
    channel,
    ...over,
  });

  it("captures message_edited for a real edit", () => {
    client().fire(Events.MessageUpdate, {}, edited());
    expect(captureForGuild).toHaveBeenCalledWith(
      expect.objectContaining({ event: "message_edited", distinctId: "u1" })
    );
  });

  it("ignores embed-unfurl updates with no editedTimestamp", () => {
    client().fire(Events.MessageUpdate, {}, edited({ editedTimestamp: null }));
    expect(captureForGuild).not.toHaveBeenCalled();
  });
});

describe("MessageDelete", () => {
  it("captures message_deleted when the author is known", () => {
    client().fire(Events.MessageDelete, {
      inGuild: () => true,
      guildId: "g1",
      author,
      guild,
      channel,
    });
    expect(captureForGuild).toHaveBeenCalledWith(
      expect.objectContaining({ event: "message_deleted" })
    );
  });

  it("skips uncached deletes with no author", () => {
    client().fire(Events.MessageDelete, {
      inGuild: () => true,
      guildId: "g1",
      author: null,
      guild,
      channel,
    });
    expect(captureForGuild).not.toHaveBeenCalled();
  });
});
