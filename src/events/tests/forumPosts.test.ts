import { ChannelType, Events } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { forwardForumPost, isWatchedForum } = vi.hoisted(() => ({
  forwardForumPost: vi.fn(async () => {}),
  isWatchedForum: vi.fn(() => true),
}));
vi.mock("@/bridge/forward.js", () => ({ forwardForumPost }));
vi.mock("@/db.js", () => ({ isWatchedForum }));

const { register } = await import("@/events/forumPosts.js");

function handler() {
  const handlers = new Map<string, (...a: unknown[]) => Promise<void>>();
  register({ on: (e: string, cb: never) => handlers.set(e, cb) } as never);
  return handlers.get(Events.ThreadCreate)!;
}

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
