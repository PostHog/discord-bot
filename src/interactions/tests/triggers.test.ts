import { beforeEach, describe, expect, it, vi } from "vitest";

// Spy on addTrigger but keep the real TriggerLimitError class (so the handler's
// instanceof check works) and everything else.
vi.mock("@/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db.js")>();
  return {
    ...actual,
    addTrigger: vi.fn(() => 5),
    getTrigger: vi.fn(),
    setTriggerEnabled: vi.fn(() => true),
  };
});

const { handleTriggerAdd, handleTriggerToggle } = await import(
  "@/interactions/triggers.js"
);
const { addTrigger, TriggerLimitError, getTrigger, setTriggerEnabled } =
  await import("@/db.js");
const addTriggerMock = vi.mocked(addTrigger);
const getTriggerMock = vi.mocked(getTrigger);
const setTriggerEnabledMock = vi.mocked(setTriggerEnabled);

interface ReplyArg {
  content: string;
}

function makeInteraction(opts: Record<string, unknown>) {
  const reply = vi.fn(async () => {});
  const interaction = {
    guildId: "g1",
    options: {
      getString: (n: string) => (opts[n] ?? null) as string | null,
      getChannel: (n: string) => (opts[n] ?? null) as unknown,
      getInteger: (n: string) => (opts[n] ?? null) as number | null,
      getBoolean: (n: string) => (opts[n] ?? null) as boolean | null,
    },
    reply,
  };
  return interaction as never;
}

function replyContent(interaction: unknown): string {
  const reply = (interaction as { reply: ReturnType<typeof vi.fn> }).reply;
  return (reply.mock.calls[0][0] as ReplyArg).content;
}

beforeEach(() => {
  vi.clearAllMocks();
  addTriggerMock.mockReturnValue(5);
});

describe("handleTriggerAdd", () => {
  it("creates a message+contains trigger", async () => {
    const i = makeInteraction({
      name: "Refunds",
      event_name: "refund_request",
      source: "message",
      contains: "refund",
    });
    await handleTriggerAdd(i);
    expect(addTriggerMock).toHaveBeenCalledTimes(1);
    expect(addTriggerMock.mock.calls[0][1]).toMatchObject({
      name: "Refunds",
      eventName: "refund_request",
      source: "message",
      conditions: { content: { mode: "contains", terms: ["refund"] } },
    });
    expect(replyContent(i)).toContain("Created trigger");
  });

  it("sanitizes the event name to snake_case", async () => {
    const i = makeInteraction({
      name: "X",
      event_name: "My Event!!",
      source: "message",
      contains: "x",
    });
    await handleTriggerAdd(i);
    expect(addTriggerMock.mock.calls[0][1].eventName).toBe("my_event");
  });

  it("rejects an event name with no usable characters", async () => {
    const i = makeInteraction({ name: "X", event_name: "!!!", source: "message" });
    await handleTriggerAdd(i);
    expect(addTriggerMock).not.toHaveBeenCalled();
    expect(replyContent(i)).toContain("event_name");
  });

  it("rejects options that don't apply to the source", async () => {
    const i = makeInteraction({
      name: "X",
      event_name: "x",
      source: "message",
      emoji: "🎫",
    });
    await handleTriggerAdd(i);
    expect(addTriggerMock).not.toHaveBeenCalled();
    expect(replyContent(i)).toContain("don't apply");
  });

  it("rejects more than one content mode", async () => {
    const i = makeInteraction({
      name: "X",
      event_name: "x",
      source: "message",
      contains: "a",
      keywords: "b",
    });
    await handleTriggerAdd(i);
    expect(addTriggerMock).not.toHaveBeenCalled();
    expect(replyContent(i)).toContain("only one");
  });

  it("normalizes file extensions for a file trigger", async () => {
    const i = makeInteraction({
      name: "Docs",
      event_name: "doc_uploaded",
      source: "file",
      file_ext: ".PDF, PNG",
    });
    await handleTriggerAdd(i);
    expect(addTriggerMock.mock.calls[0][1].conditions.fileExtensions).toEqual([
      "pdf",
      "png",
    ]);
  });

  it("parses a custom emoji for a reaction trigger", async () => {
    const i = makeInteraction({
      name: "Tickets",
      event_name: "ticket_opened",
      source: "reaction",
      emoji: "<:tick:123>",
    });
    await handleTriggerAdd(i);
    expect(addTriggerMock.mock.calls[0][1].conditions.emoji).toEqual({
      kind: "custom",
      id: "123",
      name: "tick",
    });
  });

  it("surfaces the per-guild cap error", async () => {
    addTriggerMock.mockImplementationOnce(() => {
      throw new TriggerLimitError();
    });
    const i = makeInteraction({
      name: "X",
      event_name: "x",
      source: "message",
      contains: "x",
    });
    await handleTriggerAdd(i);
    expect(replyContent(i)).toContain("at most");
  });

  it("creates a rate trigger with a new-member filter and default cooldown", async () => {
    const i = makeInteraction({
      name: "Spam raid",
      event_name: "community_spam_raid",
      source: "message",
      keywords: "http://,https://,discord.gg/",
      rate_count: 15,
      rate_window_minutes: 5,
      new_member_hours: 24,
    });
    await handleTriggerAdd(i);
    expect(addTriggerMock.mock.calls[0][1]).toMatchObject({
      source: "message",
      conditions: {
        content: { mode: "keywords", terms: ["http://", "https://", "discord.gg/"] },
        newMemberHours: 24,
        rate: { count: 15, windowMinutes: 5, cooldownMinutes: 30 },
      },
    });
    expect(replyContent(i)).toContain("≥15 in 5m (cooldown 30m)");
    expect(replyContent(i)).toContain("joined < 24h ago");
  });

  it("requires rate_count and rate_window_minutes together", async () => {
    const i = makeInteraction({
      name: "x", event_name: "x", source: "message", rate_count: 5,
    });
    await handleTriggerAdd(i);
    expect(addTriggerMock).not.toHaveBeenCalled();
    expect(replyContent(i)).toContain("must be set together");
  });

  it("rejects cooldown without a rate", async () => {
    const i = makeInteraction({
      name: "x", event_name: "x", source: "message", cooldown_minutes: 10,
    });
    await handleTriggerAdd(i);
    expect(addTriggerMock).not.toHaveBeenCalled();
    expect(replyContent(i)).toContain("only applies with");
  });

  it("rejects rate options on non-message sources", async () => {
    const i = makeInteraction({
      name: "x", event_name: "x", source: "reaction", rate_count: 5, rate_window_minutes: 5,
    });
    await handleTriggerAdd(i);
    expect(addTriggerMock).not.toHaveBeenCalled();
    expect(replyContent(i)).toContain("rate_count");
  });
});

describe("handleTriggerToggle", () => {
  it("toggles when the state changes", async () => {
    getTriggerMock.mockReturnValue({ id: 3, enabled: false } as never);
    const i = makeInteraction({ id: 3, enabled: true });
    await handleTriggerToggle(i);
    expect(setTriggerEnabledMock).toHaveBeenCalledTimes(1);
    expect(replyContent(i)).toContain("Enabled");
  });

  it("is a no-op when already in that state (keeps the rate cooldown)", async () => {
    getTriggerMock.mockReturnValue({ id: 3, enabled: true } as never);
    const i = makeInteraction({ id: 3, enabled: true });
    await handleTriggerToggle(i);
    expect(setTriggerEnabledMock).not.toHaveBeenCalled();
    expect(replyContent(i)).toContain("already enabled");
  });
});
