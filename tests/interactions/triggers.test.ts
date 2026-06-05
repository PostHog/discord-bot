import { beforeEach, describe, expect, it, vi } from "vitest";

// Spy on addTrigger but keep the real TriggerLimitError class (so the handler's
// instanceof check works) and everything else.
vi.mock("../../src/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/db.js")>();
  return { ...actual, addTrigger: vi.fn(() => 5) };
});

const { handleTriggerAdd } = await import("../../src/interactions/triggers.js");
const { addTrigger, TriggerLimitError } = await import("../../src/db.js");
const addTriggerMock = vi.mocked(addTrigger);

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
});
