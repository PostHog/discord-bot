import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Trigger } from "./db.js";

// Mock the cache (source of triggers) and the capture sink so these tests stay
// pure — no real DB, PostHog client, or env needed.
const { getGuildTriggers } = vi.hoisted(() => ({ getGuildTriggers: vi.fn() }));
const { captureCustomEvent } = vi.hoisted(() => ({ captureCustomEvent: vi.fn() }));

vi.mock("./triggersCache.js", () => ({ getGuildTriggers }));
vi.mock("./capture.js", () => ({
  captureCustomEvent,
  toPersonLike: (u: { id: string; username: string; globalName?: string | null; bot?: boolean }) => ({
    id: u.id,
    username: u.username,
    globalName: u.globalName ?? null,
    bot: !!u.bot,
  }),
}));

const {
  matchChannel,
  matchContent,
  fileExtension,
  matchEmoji,
  evaluateMessage,
  evaluateReaction,
  evaluateMemberJoin,
  evaluateVoiceJoin,
  runMessageTriggers,
  runReactionTriggers,
} = await import("./triggers.js");

function trigger(partial: Partial<Trigger>): Trigger {
  return {
    id: 1,
    guildId: "g1",
    name: "T",
    eventName: "custom_event",
    source: "message",
    conditions: {},
    enabled: true,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Pure matchers
// ---------------------------------------------------------------------------

describe("matchChannel", () => {
  it("passes when no channels configured", () => {
    expect(matchChannel({}, "c1")).toBe(true);
    expect(matchChannel({ channelIds: [] }, "c1")).toBe(true);
  });
  it("checks membership otherwise", () => {
    expect(matchChannel({ channelIds: ["c1", "c2"] }, "c2")).toBe(true);
    expect(matchChannel({ channelIds: ["c1"] }, "c9")).toBe(false);
    expect(matchChannel({ channelIds: ["c1"] }, null)).toBe(false);
  });
});

describe("matchContent", () => {
  it("contains is case-insensitive and reports the term", () => {
    const r = matchContent("Please REFUND me", { mode: "contains", terms: ["refund"] });
    expect(r).toEqual({ ok: true, term: "refund" });
  });
  it("keywords matches any term", () => {
    expect(matchContent("found a bug", { mode: "keywords", terms: ["help", "bug"] }).ok).toBe(true);
    expect(matchContent("nothing", { mode: "keywords", terms: ["help", "bug"] }).ok).toBe(false);
  });
  it("starts_with anchors at the beginning", () => {
    expect(matchContent("!ticket", { mode: "starts_with", terms: ["!"] }).ok).toBe(true);
    expect(matchContent(" !ticket", { mode: "starts_with", terms: ["!"] }).ok).toBe(false);
  });
  it("ignores empty terms", () => {
    expect(matchContent("abc", { mode: "contains", terms: [""] }).ok).toBe(false);
  });
});

describe("fileExtension", () => {
  it("lowercases and strips the dot", () => {
    expect(fileExtension("Report.PDF")).toBe("pdf");
    expect(fileExtension("a.tar.gz")).toBe("gz");
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".env")).toBe("");
  });
});

describe("matchEmoji", () => {
  it("matches unicode by name and custom by id", () => {
    expect(matchEmoji({ kind: "unicode", value: "🎫" }, { name: "🎫", id: null })).toBe(true);
    expect(matchEmoji({ kind: "unicode", value: "🎫" }, { name: "🔥", id: null })).toBe(false);
    expect(matchEmoji({ kind: "custom", id: "9", name: "tick" }, { name: "tick", id: "9" })).toBe(true);
    expect(matchEmoji({ kind: "custom", id: "9", name: "tick" }, { name: "tick", id: "1" })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Evaluators
// ---------------------------------------------------------------------------

function message(opts: {
  guildId?: string;
  channelId?: string;
  content?: string;
  attachments?: Array<{ name: string | null }>;
}) {
  const atts = opts.attachments ?? [];
  return {
    guildId: opts.guildId ?? "g1",
    channelId: opts.channelId ?? "c1",
    content: opts.content ?? "",
    attachments: new Map(atts.map((a, i) => [String(i), a])),
    guild: { id: opts.guildId ?? "g1", name: "Guild" },
    channel: { id: opts.channelId ?? "c1", name: "general", type: 0 },
    author: { id: "u1", username: "alice", globalName: "Alice", bot: false },
  } as never;
}

describe("evaluateMessage", () => {
  it("matches a content trigger and reports the term", () => {
    getGuildTriggers.mockReturnValue([
      trigger({ conditions: { content: { mode: "contains", terms: ["refund"] } } }),
    ]);
    const out = evaluateMessage(message({ content: "a refund please" }));
    expect(out).toHaveLength(1);
    expect(out[0].matchProps).toMatchObject({ matched_term: "refund" });
  });

  it("does not match when content misses", () => {
    getGuildTriggers.mockReturnValue([
      trigger({ conditions: { content: { mode: "contains", terms: ["refund"] } } }),
    ]);
    expect(evaluateMessage(message({ content: "hello" }))).toHaveLength(0);
  });

  it("respects the channel filter", () => {
    getGuildTriggers.mockReturnValue([
      trigger({ conditions: { channelIds: ["support"] } }),
    ]);
    expect(evaluateMessage(message({ channelId: "random" }))).toHaveLength(0);
    expect(evaluateMessage(message({ channelId: "support" }))).toHaveLength(1);
  });

  it("skips disabled triggers", () => {
    getGuildTriggers.mockReturnValue([trigger({ enabled: false })]);
    expect(evaluateMessage(message({ content: "x" }))).toHaveLength(0);
  });

  it("file source requires an attachment and honors the extension filter", () => {
    getGuildTriggers.mockReturnValue([
      trigger({ source: "file", conditions: { fileExtensions: ["pdf"] } }),
    ]);
    expect(evaluateMessage(message({}))).toHaveLength(0); // no attachment
    expect(
      evaluateMessage(message({ attachments: [{ name: "a.png" }] }))
    ).toHaveLength(0); // wrong ext
    const out = evaluateMessage(message({ attachments: [{ name: "contract.PDF" }] }));
    expect(out).toHaveLength(1);
    expect(out[0].matchProps).toMatchObject({
      file_name: "contract.PDF",
      file_extension: "pdf",
    });
  });

  it("ignores reaction/other sources", () => {
    getGuildTriggers.mockReturnValue([trigger({ source: "reaction" })]);
    expect(evaluateMessage(message({ content: "x" }))).toHaveLength(0);
  });
});

function reaction(opts: { guildId?: string | null; channelId?: string; emoji?: { name: string | null; id: string | null } }) {
  return {
    message: {
      guildId: opts.guildId === undefined ? "g1" : opts.guildId,
      channelId: opts.channelId ?? "c1",
      channel: { id: opts.channelId ?? "c1", name: "general", type: 0 },
    },
    emoji: opts.emoji ?? { name: "🎫", id: null },
  } as never;
}

describe("evaluateReaction", () => {
  it("returns nothing in a DM (no guild)", () => {
    getGuildTriggers.mockReturnValue([trigger({ source: "reaction" })]);
    expect(evaluateReaction(reaction({ guildId: null }))).toHaveLength(0);
  });

  it("matches a specific emoji and reports it", () => {
    getGuildTriggers.mockReturnValue([
      trigger({ source: "reaction", conditions: { emoji: { kind: "unicode", value: "🎫" } } }),
    ]);
    expect(evaluateReaction(reaction({ emoji: { name: "🔥", id: null } }))).toHaveLength(0);
    const out = evaluateReaction(reaction({ emoji: { name: "🎫", id: null } }));
    expect(out).toHaveLength(1);
    expect(out[0].matchProps).toMatchObject({ matched_emoji: "🎫" });
  });

  it("matches any emoji when none configured", () => {
    getGuildTriggers.mockReturnValue([trigger({ source: "reaction" })]);
    expect(evaluateReaction(reaction({ emoji: { name: "🙂", id: null } }))).toHaveLength(1);
  });
});

describe("evaluateMemberJoin / evaluateVoiceJoin", () => {
  const member = { id: "u1", guild: { id: "g1", name: "G" }, user: { id: "u1", username: "a", globalName: null, bot: false } } as never;

  it("member_join returns all matching triggers", () => {
    getGuildTriggers.mockReturnValue([
      trigger({ source: "member_join" }),
      trigger({ source: "message" }),
    ]);
    expect(evaluateMemberJoin(member)).toHaveLength(1);
  });

  it("voice_join respects the channel filter", () => {
    getGuildTriggers.mockReturnValue([
      trigger({ source: "voice_join", conditions: { channelIds: ["vc1"] } }),
    ]);
    expect(evaluateVoiceJoin(member, { id: "vc2", name: "Other" } as never)).toHaveLength(0);
    expect(evaluateVoiceJoin(member, { id: "vc1", name: "Lounge" } as never)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Runners
// ---------------------------------------------------------------------------

describe("runMessageTriggers", () => {
  it("emits a custom event per match with full context", () => {
    getGuildTriggers.mockReturnValue([
      trigger({ id: 7, name: "Refunds", eventName: "refund_request", conditions: { content: { mode: "contains", terms: ["refund"] } } }),
    ]);
    runMessageTriggers(message({ content: "a refund" }));
    expect(captureCustomEvent).toHaveBeenCalledTimes(1);
    const arg = captureCustomEvent.mock.calls[0][0];
    expect(arg).toMatchObject({
      guildId: "g1",
      event: "refund_request",
      distinctId: "u1",
    });
    expect(arg.properties).toMatchObject({
      guild_id: "g1",
      channel_id: "c1",
      matched_term: "refund",
      trigger_id: 7,
      trigger_name: "Refunds",
      trigger_source: "message",
    });
  });

  it("does nothing when there are no matches", () => {
    getGuildTriggers.mockReturnValue([]);
    runMessageTriggers(message({ content: "x" }));
    expect(captureCustomEvent).not.toHaveBeenCalled();
  });
});

describe("runReactionTriggers", () => {
  it("omits the actor for a partial user", () => {
    getGuildTriggers.mockReturnValue([trigger({ source: "reaction" })]);
    const user = { id: "u9", partial: true } as never;
    runReactionTriggers(reaction({}), user);
    expect(captureCustomEvent).toHaveBeenCalledTimes(1);
    expect(captureCustomEvent.mock.calls[0][0].actor).toBeUndefined();
  });
});
