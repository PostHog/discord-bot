import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./disable.js", () => ({ handleDisableCommand: vi.fn() }));
vi.mock("./events.js", () => ({
  EVENTS_SELECT_ID: "analytics:events",
  handleEventsCommand: vi.fn(),
  handleEventsSelect: vi.fn(),
}));
vi.mock("./options.js", () => ({ handleOptionsCommand: vi.fn() }));
vi.mock("./setup.js", () => ({
  SETUP_MODAL_ID: "analytics:setup",
  handleSetupCommand: vi.fn(),
  handleSetupModal: vi.fn(),
}));
vi.mock("./status.js", () => ({ handleStatusCommand: vi.fn() }));
vi.mock("./test.js", () => ({ handleTestCommand: vi.fn() }));
vi.mock("./triggers.js", () => ({
  handleTriggerAdd: vi.fn(),
  handleTriggerList: vi.fn(),
  handleTriggerRemove: vi.fn(),
  handleTriggerToggle: vi.fn(),
}));

const { routeInteraction } = await import("./router.js");
const { handleSetupCommand, handleSetupModal } = await import("./setup.js");
const { handleStatusCommand } = await import("./status.js");
const { handleEventsSelect } = await import("./events.js");
const { handleTriggerAdd } = await import("./triggers.js");

function ix(over: Record<string, unknown> = {}) {
  const reply = vi.fn(async () => {});
  return {
    inGuild: () => true,
    isRepliable: () => true,
    memberPermissions: { has: () => true },
    isChatInputCommand: () => false,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    replied: false,
    deferred: false,
    reply,
    ...over,
  };
}

function command(group: string | null, sub: string, over: Record<string, unknown> = {}) {
  return ix({
    isChatInputCommand: () => true,
    commandName: "analytics",
    options: { getSubcommandGroup: () => group, getSubcommand: () => sub },
    ...over,
  });
}

function replyText(i: { reply: ReturnType<typeof vi.fn> }): string {
  return (i.reply.mock.calls[0][0] as { content: string }).content;
}

beforeEach(() => vi.clearAllMocks());

describe("routeInteraction permission gate", () => {
  it("rejects interactions outside a guild", async () => {
    const i = ix({ inGuild: () => false });
    await routeInteraction(i as never);
    expect(replyText(i)).toContain("inside a server");
  });

  it("rejects non-admins and does not dispatch", async () => {
    const i = command(null, "setup", { memberPermissions: { has: () => false } });
    await routeInteraction(i as never);
    expect(replyText(i)).toContain("Manage Server");
    expect(handleSetupCommand).not.toHaveBeenCalled();
  });
});

describe("routeInteraction dispatch", () => {
  it("routes a flat subcommand to its handler", async () => {
    await routeInteraction(command(null, "setup") as never);
    expect(handleSetupCommand).toHaveBeenCalledTimes(1);
  });

  it("routes a trigger subcommand group", async () => {
    await routeInteraction(command("trigger", "add") as never);
    expect(handleTriggerAdd).toHaveBeenCalledTimes(1);
  });

  it("routes status", async () => {
    await routeInteraction(command(null, "status") as never);
    expect(handleStatusCommand).toHaveBeenCalledTimes(1);
  });

  it("routes the setup modal submit", async () => {
    const i = ix({ isModalSubmit: () => true, customId: "analytics:setup" });
    await routeInteraction(i as never);
    expect(handleSetupModal).toHaveBeenCalledTimes(1);
  });

  it("routes the events select menu", async () => {
    const i = ix({ isStringSelectMenu: () => true, customId: "analytics:events" });
    await routeInteraction(i as never);
    expect(handleEventsSelect).toHaveBeenCalledTimes(1);
  });
});
