import { MessageFlags } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { forwardInteraction, fetchRepos, markSeen } = vi.hoisted(() => ({
  forwardInteraction: vi.fn(),
  fetchRepos: vi.fn(),
  markSeen: vi.fn(() => true),
}));
vi.mock("@/bridge/forward.js", () => ({
  forwardInteraction,
  fetchRepos,
  buildCommandPayload: (i: unknown) => i,
  buildComponentPayload: (i: unknown) => i,
  buildModalPayload: (i: unknown) => i,
}));
vi.mock("@/bridge/dedupe.js", () => ({ markSeen }));

const {
  handleCodeCommand,
  handleForwardedCommand,
  handleComponentForward,
  handleRepoAutocomplete,
} = await import("@/interactions/bridge.js");

function cmd() {
  return {
    id: "iid",
    deferReply: vi.fn(async () => {}),
    editReply: vi.fn(async () => {}),
    followUp: vi.fn(async () => {}),
    deleteReply: vi.fn(async () => {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  markSeen.mockReturnValue(true);
});

describe("handleCodeCommand", () => {
  it("defers publicly and forwards", async () => {
    forwardInteraction.mockResolvedValue({ status: "accepted" });
    const i = cmd();
    await handleCodeCommand(i as never);
    expect(i.deferReply).toHaveBeenCalledWith();
    expect(forwardInteraction).toHaveBeenCalledTimes(1);
    expect(i.editReply).not.toHaveBeenCalled();
    expect(i.followUp).not.toHaveBeenCalled();
  });

  it("answers the account-link prompt privately, clearing the public defer", async () => {
    forwardInteraction.mockResolvedValue({ action: "ephemeral", content: "link" });
    const i = cmd();
    await handleCodeCommand(i as never);
    expect(i.deleteReply).toHaveBeenCalledTimes(1);
    expect(i.followUp).toHaveBeenCalledWith({ content: "link", flags: MessageFlags.Ephemeral });
  });

  it("surfaces an error when forwarding fails", async () => {
    forwardInteraction.mockResolvedValue(null);
    const i = cmd();
    await handleCodeCommand(i as never);
    expect(i.editReply).toHaveBeenCalledTimes(1);
  });

  it("skips a redelivered interaction", async () => {
    markSeen.mockReturnValue(false);
    const i = cmd();
    await handleCodeCommand(i as never);
    expect(i.deferReply).not.toHaveBeenCalled();
    expect(forwardInteraction).not.toHaveBeenCalled();
  });
});

describe("handleForwardedCommand", () => {
  it("defers ephemerally and keeps ephemeral on account-link", async () => {
    forwardInteraction.mockResolvedValue({ action: "ephemeral", content: "link" });
    const i = cmd();
    await handleForwardedCommand(i as never);
    expect(i.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(i.editReply).toHaveBeenCalledWith({ content: "link" });
    expect(i.deleteReply).not.toHaveBeenCalled();
  });
});

describe("handleComponentForward", () => {
  it("defers an update and forwards", async () => {
    forwardInteraction.mockResolvedValue({ status: "accepted" });
    const i = { id: "iid", deferUpdate: vi.fn(async () => {}) };
    await handleComponentForward(i as never);
    expect(i.deferUpdate).toHaveBeenCalledTimes(1);
    expect(forwardInteraction).toHaveBeenCalledTimes(1);
  });
});

describe("handleRepoAutocomplete", () => {
  it("responds with PostHog choices for the repo option", async () => {
    fetchRepos.mockResolvedValue([{ name: "a/b", value: "a/b" }]);
    const respond = vi.fn(async () => {});
    const i = {
      guildId: "g",
      user: { id: "u" },
      options: { getFocused: () => ({ name: "repo", value: "a" }) },
      respond,
    };
    await handleRepoAutocomplete(i as never);
    expect(fetchRepos).toHaveBeenCalledWith("g", "u", "a");
    expect(respond).toHaveBeenCalledWith([{ name: "a/b", value: "a/b" }]);
  });

  it("responds empty for a non-repo focused option", async () => {
    const respond = vi.fn(async () => {});
    const i = {
      guildId: "g",
      user: { id: "u" },
      options: { getFocused: () => ({ name: "other", value: "x" }) },
      respond,
    };
    await handleRepoAutocomplete(i as never);
    expect(fetchRepos).not.toHaveBeenCalled();
    expect(respond).toHaveBeenCalledWith([]);
  });
});
