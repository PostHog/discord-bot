import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
const flush = vi.fn(async () => {});

vi.mock("@/posthogPool.js", () => ({
  getPostHogClient: vi.fn(() => ({ capture, flush })),
}));

const roadmapIdea = {
  host: "https://us.i.posthog.com",
  projectApiKey: "phc_test",
  surveyId: "survey-1",
  ideaQuestionId: "q-idea",
  emailQuestionId: "q-email",
  guildIds: ["allowed-guild"],
};

vi.mock("@/config.js", () => ({ config: { roadmapIdea } }));

let now = 1_000_000;
vi.mock("@/time.js", () => ({ nowMs: () => now }));

const {
  buildIdeaModal,
  decodeSource,
  handleIdeaCommand,
  handleIdeaMessageAction,
  handleIdeaModalSubmit,
  resetIdeaCooldowns,
  COOLDOWN_MS,
} = await import("@/interactions/idea.js");
const { getPostHogClient } = await import("@/posthogPool.js");

/** The shape of a built modal, as far as these tests care. */
interface ModalJson {
  custom_id: string;
  components: { components: { value?: string }[] }[];
}

function base(over: Record<string, unknown> = {}) {
  return {
    guildId: "allowed-guild",
    guild: { id: "allowed-guild", name: "Community" },
    channel: { id: "chan-1", name: "general", type: 0 },
    user: { id: "submitter-1", username: "curator" },
    reply: vi.fn(async (_payload: Record<string, unknown>) => {}),
    showModal: vi.fn(async (_modal: { toJSON(): unknown }) => {}),
    ...over,
  };
}

function modalSubmit(customId: string, fields: Record<string, string>, over = {}) {
  return base({
    customId,
    fields: { getTextInputValue: (id: string) => fields[id] ?? "" },
    ...over,
  });
}

/** Properties of the single captured event. */
function captured(): Record<string, unknown> {
  return capture.mock.calls[0][0].properties as Record<string, unknown>;
}

type Fake = ReturnType<typeof base>;

function replyPayload(i: Fake): Record<string, unknown> {
  return i.reply.mock.calls[0][0];
}

function replyText(i: Fake): string {
  return String(replyPayload(i).content);
}

function shownModal(i: Fake): ModalJson {
  return i.showModal.mock.calls[0][0].toJSON() as ModalJson;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetIdeaCooldowns();
  now = 1_000_000;
  roadmapIdea.guildIds = ["allowed-guild"];
});

describe("opening the modal", () => {
  it("opens an empty modal for /ph idea", async () => {
    const i = base();
    await handleIdeaCommand(i as never);
    expect(i.showModal).toHaveBeenCalledTimes(1);
  });

  it("prefills the modal from the target message", async () => {
    const i = base({
      targetMessage: {
        id: "msg-1",
        channelId: "chan-1",
        content: "i wish posthog did this",
        author: { id: "author-1" },
      },
    });
    await handleIdeaMessageAction(i as never);

    const modal = shownModal(i);
    expect(modal.custom_id).toBe("roadmap_idea:chan-1:msg-1:author-1");
    expect(modal.components[0].components[0].value).toBe("i wish posthog did this");
  });

  it("refuses a message with no text", async () => {
    const i = base({
      targetMessage: { id: "m", channelId: "c", content: "  ", author: { id: "a" } },
    });
    await handleIdeaMessageAction(i as never);
    expect(i.showModal).not.toHaveBeenCalled();
    expect(replyText(i)).toContain("no text");
  });

  it("refuses a guild that is not on the allowlist", async () => {
    const i = base({ guildId: "other-guild" });
    await handleIdeaCommand(i as never);
    expect(i.showModal).not.toHaveBeenCalled();
    expect(replyText(i)).toContain("aren't enabled");
  });

  it("truncates a message longer than Discord's input cap", () => {
    const modal = buildIdeaModal({}, "x".repeat(5000)).toJSON() as unknown as ModalJson;
    expect(modal.components[0].components[0].value).toHaveLength(4000);
  });
});

describe("submitting", () => {
  it("captures the survey response with both questions and the source link", async () => {
    const i = modalSubmit("roadmap_idea:chan-1:msg-1:author-1", {
      idea: "ship dark mode",
      email: "someone@example.com",
    });
    await handleIdeaModalSubmit(i as never);

    expect(getPostHogClient).toHaveBeenCalledWith(roadmapIdea.host, roadmapIdea.projectApiKey);
    expect(capture.mock.calls[0][0].event).toBe("survey sent");
    expect(captured()).toMatchObject({
      $survey_id: "survey-1",
      $survey_response: "ship dark mode",
      "$survey_response_q-idea": "ship dark mode",
      "$survey_response_q-email": "someone@example.com",
      submission_source: "discord",
      discord_author_id: "author-1",
      discord_submitted_by: "submitter-1",
      discord_message_url: "https://discord.com/channels/allowed-guild/chan-1/msg-1",
      channel_name: "general",
      guild_name: "Community",
    });
  });

  it("attributes the person to the message author, not the submitter", async () => {
    await handleIdeaModalSubmit(
      modalSubmit("roadmap_idea:c:m:author-1", { idea: "an idea" }) as never
    );
    expect(capture.mock.calls[0][0].distinctId).toBe("author-1");
  });

  it("falls back to the submitter when there is no source message", async () => {
    await handleIdeaModalSubmit(modalSubmit("roadmap_idea:::", { idea: "an idea" }) as never);
    expect(capture.mock.calls[0][0].distinctId).toBe("submitter-1");
    expect(captured().discord_message_url).toBeNull();
  });

  it("omits the email question when no email is given", async () => {
    await handleIdeaModalSubmit(modalSubmit("roadmap_idea:::", { idea: "an idea" }) as never);
    expect(captured()).not.toHaveProperty("$survey_response_q-email");
  });

  it("announces publicly when submitting someone else's message", async () => {
    const i = modalSubmit("roadmap_idea:chan-1:msg-1:author-1", { idea: "their idea" });
    await handleIdeaModalSubmit(i as never);

    const payload = replyPayload(i);
    expect(payload.content).toContain("<@author-1>");
    expect(payload.flags).toBeUndefined();
    expect(payload.allowedMentions).toEqual({ users: ["author-1"] });
  });

  it("confirms privately when submitting your own idea", async () => {
    const i = modalSubmit("roadmap_idea:::", { idea: "my idea" });
    await handleIdeaModalSubmit(i as never);
    expect(replyPayload(i).flags).toBeDefined();
  });

  it("does not claim success when the flush fails", async () => {
    flush.mockRejectedValueOnce(new Error("network down"));
    const i = modalSubmit("roadmap_idea:::", { idea: "an idea" });
    await handleIdeaModalSubmit(i as never);
    expect(replyText(i)).toContain("wasn't submitted");
  });
});

describe("cooldown", () => {
  it("refuses a second submission inside the window", async () => {
    await handleIdeaModalSubmit(modalSubmit("roadmap_idea:::", { idea: "one" }) as never);
    const second = modalSubmit("roadmap_idea:::", { idea: "two" });
    await handleIdeaModalSubmit(second as never);

    expect(capture).toHaveBeenCalledTimes(1);
    expect(replyText(second)).toContain("Hold on");
  });

  it("allows another submission once the window passes", async () => {
    await handleIdeaModalSubmit(modalSubmit("roadmap_idea:::", { idea: "one" }) as never);
    now += COOLDOWN_MS;
    await handleIdeaModalSubmit(modalSubmit("roadmap_idea:::", { idea: "two" }) as never);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("is per user, so one member can't block another", async () => {
    await handleIdeaModalSubmit(modalSubmit("roadmap_idea:::", { idea: "one" }) as never);
    const other = modalSubmit(
      "roadmap_idea:::",
      { idea: "two" },
      { user: { id: "submitter-2", username: "someone-else" } }
    );
    await handleIdeaModalSubmit(other as never);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it("does not start a cooldown when the submission failed", async () => {
    flush.mockRejectedValueOnce(new Error("network down"));
    await handleIdeaModalSubmit(modalSubmit("roadmap_idea:::", { idea: "one" }) as never);
    await handleIdeaModalSubmit(modalSubmit("roadmap_idea:::", { idea: "two" }) as never);
    expect(capture).toHaveBeenCalledTimes(2);
  });
});

describe("decodeSource", () => {
  it("round-trips a message source", () => {
    expect(decodeSource("roadmap_idea:c:m:a")).toEqual({
      channelId: "c",
      messageId: "m",
      authorId: "a",
    });
  });

  it("returns an empty source for a fresh idea", () => {
    expect(decodeSource("roadmap_idea:::")).toEqual({
      channelId: undefined,
      messageId: undefined,
      authorId: undefined,
    });
  });
});
