import { ChannelType, Events } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { forwardForumPost, forwardMessage, isWatchedForum, isWatchedThread } = vi.hoisted(
  () => ({
    forwardForumPost: vi.fn(async () => {}),
    forwardMessage: vi.fn(async () => {}),
    isWatchedForum: vi.fn(() => true),
    isWatchedThread: vi.fn(() => false),
  })
);
vi.mock("@/bridge/forward.js", () => ({ forwardForumPost, forwardMessage }));
vi.mock("@/db.js", () => ({ isWatchedForum, isWatchedThread }));

const { register } = await import("@/events/forumPosts.js");

function handlers() {
  const map = new Map<string, (...a: unknown[]) => Promise<void>>();
  register({ on: (e: string, cb: never) => map.set(e, cb) } as never);
  return map;
}
const handler = () => handlers().get(Events.ThreadCreate)!;
const messageHandler = () => handlers().get(Events.MessageCreate)!;

function thread(over: Record<string, unknown> = {}) {
  return {
    guildId: "g",
    parentId: "fc",
    id: "t1",
    name: "Need help with X",
    archived: false,
    appliedTags: ["tag1", "unknown"],
    parent: {
      type: ChannelType.GuildForum,
      availableTags: [{ id: "tag1", name: "bug" }],
    },
    fetchStarterMessage: vi.fn(async () => ({
      content: "here is my problem",
      author: { id: "u1", username: "alice", globalName: "Alice", bot: false },
    })),
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  isWatchedForum.mockReturnValue(true);
  isWatchedThread.mockReturnValue(false);
});
afterEach(() => vi.useRealTimers());

describe("ThreadCreate → forum post forwarding", () => {
  it("forwards a new post in a watched forum with resolved tags + author", async () => {
    await handler()(thread(), true);
    expect(forwardForumPost).toHaveBeenCalledTimes(1);
    expect(forwardForumPost).toHaveBeenCalledWith({
      kind: "forum_post",
      guild_id: "g",
      forum_channel_id: "fc",
      thread_id: "t1",
      title: "Need help with X",
      content: "here is my problem",
      tags: ["bug"], // unknown tag id dropped
      author: { id: "u1", username: "alice", global_name: "Alice", bot: false },
    });
  });

  it("ignores threads the bot merely gained access to", async () => {
    await handler()(thread(), false);
    expect(forwardForumPost).not.toHaveBeenCalled();
  });

  it("ignores non-forum parents", async () => {
    await handler()(thread({ parent: { type: ChannelType.GuildText } }), true);
    expect(forwardForumPost).not.toHaveBeenCalled();
  });

  it("ignores unwatched forums", async () => {
    isWatchedForum.mockReturnValue(false);
    await handler()(thread(), true);
    expect(forwardForumPost).not.toHaveBeenCalled();
  });

  it("ignores archived threads", async () => {
    await handler()(thread({ archived: true }), true);
    expect(forwardForumPost).not.toHaveBeenCalled();
  });

  it("skips posts authored by a bot", async () => {
    const t = thread({
      fetchStarterMessage: vi.fn(async () => ({
        content: "x",
        author: { id: "b", username: "bot", globalName: null, bot: true },
      })),
    });
    await handler()(t, true);
    expect(forwardForumPost).not.toHaveBeenCalled();
  });

  it("retries the starter fetch once, then gives up", async () => {
    vi.useFakeTimers();
    const fetchStarterMessage = vi.fn(async () => null);
    const p = handler()(thread({ fetchStarterMessage }), true);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
    expect(fetchStarterMessage).toHaveBeenCalledTimes(2);
    expect(forwardForumPost).not.toHaveBeenCalled();
  });
});

function message(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    guildId: "g",
    channelId: "t1",
    content: "a reply",
    author: { id: "u1", username: "alice", globalName: "Alice", bot: false },
    reference: null,
    fetchReference: vi.fn(),
    channel: {
      id: "t1",
      isThread: () => true,
      parent: { id: "fc", type: ChannelType.GuildForum },
    },
    ...over,
  };
}

describe("MessageCreate → reply forwarding", () => {
  it("forwards a plain message with a null replied_to (no thread history)", async () => {
    await messageHandler()(message());
    expect(forwardMessage).toHaveBeenCalledWith({
      kind: "message",
      guild_id: "g",
      forum_channel_id: "fc",
      thread_id: "t1",
      message_id: "m1",
      content: "a reply",
      author: { id: "u1", username: "alice", global_name: "Alice", bot: false },
      replied_to: null,
    });
  });

  it("resolves the replied-to message when the reply references one", async () => {
    const m = message({
      reference: { messageId: "m0" },
      fetchReference: vi.fn(async () => ({
        id: "m0",
        content: "earlier question",
        createdTimestamp: 1_000,
        author: { id: "u2", username: "bob", globalName: "Bob", bot: false },
        reference: null,
      })),
    });
    await messageHandler()(m);
    expect(forwardMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        replied_to: expect.objectContaining({ id: "m0", content: "earlier question" }),
      })
    );
  });

  it("skips bot authors (no feedback loop on the agent's own replies)", async () => {
    await messageHandler()(
      message({ author: { id: "b", username: "bot", globalName: null, bot: true } })
    );
    expect(forwardMessage).not.toHaveBeenCalled();
  });

  it("skips the starter message (id === thread id)", async () => {
    await messageHandler()(message({ id: "t1" }));
    expect(forwardMessage).not.toHaveBeenCalled();
  });

  it("skips non-thread channels", async () => {
    await messageHandler()(message({ channel: { isThread: () => false } }));
    expect(forwardMessage).not.toHaveBeenCalled();
  });

  it("skips threads not under a forum", async () => {
    await messageHandler()(
      message({ channel: { id: "t1", isThread: () => true, parent: { type: ChannelType.GuildText } } })
    );
    expect(forwardMessage).not.toHaveBeenCalled();
  });

  it("skips unwatched forums", async () => {
    isWatchedForum.mockReturnValue(false);
    await messageHandler()(message());
    expect(forwardMessage).not.toHaveBeenCalled();
  });

  it("forwards in an individually watched non-forum thread (forum_channel_id null)", async () => {
    isWatchedForum.mockReturnValue(false);
    isWatchedThread.mockReturnValue(true);
    await messageHandler()(
      message({ channel: { id: "t1", isThread: () => true, parent: { type: ChannelType.GuildText } } })
    );
    expect(forwardMessage).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "message", thread_id: "t1", forum_channel_id: null })
    );
  });
});
