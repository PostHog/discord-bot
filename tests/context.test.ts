import { describe, expect, it, vi } from "vitest";

import { fetchChannelContext, resolveRepliedTo } from "@/bridge/context.js";

function msg(over: Record<string, unknown> = {}) {
  return {
    id: "m1",
    content: "hello",
    createdTimestamp: 1_000,
    author: { id: "u1", username: "alice", globalName: "Alice", bot: false },
    reference: null,
    interactionMetadata: null,
    ...over,
  };
}

function channel(messages: ReturnType<typeof msg>[]) {
  const map = new Map(messages.map((m) => [m.id, m]));
  return { messages: { fetch: vi.fn(async () => map) } };
}

describe("fetchChannelContext", () => {
  it("returns [] for a channel that can't page history", async () => {
    expect(await fetchChannelContext(null)).toEqual([]);
    expect(await fetchChannelContext({})).toEqual([]);
  });

  it("returns messages oldest-first with mapped fields", async () => {
    const ch = channel([
      msg({ id: "b", createdTimestamp: 2_000, content: "second" }),
      msg({ id: "a", createdTimestamp: 1_000, content: "first" }),
    ]);
    const out = await fetchChannelContext(ch);
    expect(out.map((m) => m.id)).toEqual(["a", "b"]);
    expect(out[0]).toMatchObject({
      id: "a",
      content: "first",
      author: { id: "u1", username: "alice", global_name: "Alice", bot: false },
      reply_to_id: null,
    });
    expect(out[0].timestamp).toBe(new Date(1_000).toISOString());
  });

  it("carries reply_to_id from the message reference", async () => {
    const ch = channel([msg({ reference: { messageId: "parent" } })]);
    const [out] = await fetchChannelContext(ch);
    expect(out.reply_to_id).toBe("parent");
  });

  it("excludes our own deferred reply by interaction id", async () => {
    const ch = channel([
      msg({ id: "a" }),
      msg({ id: "thinking", interactionMetadata: { id: "int-1" } }),
    ]);
    const out = await fetchChannelContext(ch, { excludeInteractionId: "int-1" });
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });

  it("excludes a specific message id", async () => {
    const ch = channel([msg({ id: "a" }), msg({ id: "b" })]);
    const out = await fetchChannelContext(ch, { excludeMessageId: "b" });
    expect(out.map((m) => m.id)).toEqual(["a"]);
  });

  it("honours the limit option when fetching", async () => {
    const ch = channel([msg()]);
    await fetchChannelContext(ch, { limit: 7 });
    expect(ch.messages.fetch).toHaveBeenCalledWith({ limit: 7 });
  });

  it("returns [] when the fetch throws", async () => {
    const ch = { messages: { fetch: vi.fn(async () => { throw new Error("boom"); }) } };
    expect(await fetchChannelContext(ch)).toEqual([]);
  });
});

describe("resolveRepliedTo", () => {
  it("returns null when the message isn't a reply", async () => {
    const m = { ...msg(), reference: null, fetchReference: vi.fn() };
    expect(await resolveRepliedTo(m)).toBeNull();
    expect(m.fetchReference).not.toHaveBeenCalled();
  });

  it("resolves and maps the referenced message", async () => {
    const m = {
      ...msg({ reference: { messageId: "parent" } }),
      fetchReference: vi.fn(async () =>
        msg({ id: "parent", content: "original", createdTimestamp: 500 })
      ),
    };
    expect(await resolveRepliedTo(m)).toMatchObject({ id: "parent", content: "original" });
  });

  it("returns null when the reference can't be fetched (e.g. deleted)", async () => {
    const m = {
      ...msg({ reference: { messageId: "gone" } }),
      fetchReference: vi.fn(async () => { throw new Error("unknown message"); }),
    };
    expect(await resolveRepliedTo(m)).toBeNull();
  });
});
