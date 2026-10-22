import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/interactions/bridge.js", () => ({
  handleCodeCommand: vi.fn(),
  handleForwardedCommand: vi.fn(),
  handleComponentForward: vi.fn(),
  handleModalForward: vi.fn(),
  handleRepoAutocomplete: vi.fn(),
}));
vi.mock("@/interactions/disable.js", () => ({ handleDisableCommand: vi.fn() }));
vi.mock("@/interactions/events.js", () => ({
  EVENTS_SELECT_ID: "analytics:events",
  handleEventsCommand: vi.fn(),
  handleEventsSelect: vi.fn(),
}));
vi.mock("@/interactions/options.js", () => ({ handleOptionsCommand: vi.fn() }));
vi.mock("@/interactions/forums.js", () => ({
  handleForumsWatch: vi.fn(),
  handleForumsUnwatch: vi.fn(),
  handleForumsList: vi.fn(),
}));
vi.mock("@/interactions/idea.js", () => ({
  IDEA_MODAL_PREFIX: "roadmap_idea",
  handleIdeaCommand: vi.fn(),
  handleIdeaMessageAction: vi.fn(),
  handleIdeaModalSubmit: vi.fn(),
}));
vi.mock("@/interactions/status.js", () => ({ handleStatusCommand: vi.fn() }));
vi.mock("@/interactions/test.js", () => ({ handleTestCommand: vi.fn() }));
vi.mock("@/interactions/triggers.js", () => ({
  handleTriggerAdd: vi.fn(),
  handleTriggerList: vi.fn(),
  handleTriggerRemove: vi.fn(),
  handleTriggerToggle: vi.fn(),
}));

const { routeInteraction } = await import("@/interactions/router.js");
const { handleStatusCommand } = await import("@/interactions/status.js");
const { handleEventsSelect } = await import("@/interactions/events.js");
const { handleTriggerAdd } = await import("@/interactions/triggers.js");
const { handleForumsWatch } = await import("@/interactions/forums.js");
const {
  handleCodeCommand,
  handleForwardedCommand,
  handleComponentForward,
  handleModalForward,
  handleRepoAutocomplete,
} = await import("@/interactions/bridge.js");
const { handleIdeaCommand, handleIdeaMessageAction, handleIdeaModalSubmit } = await import(
  "@/interactions/idea.js"
);
const { IDEA_MESSAGE_COMMAND_NAME } = await import("@/commands/idea.js");

function ix(over: Record<string, unknown> = {}) {
  const reply = vi.fn(async () => {});
  return {
    inGuild: () => true,
    isRepliable: () => true,
    memberPermissions: { has: () => true },
    isAutocomplete: () => false,
    isChatInputCommand: () => false,
    isMessageContextMenuCommand: () => false,
    isModalSubmit: () => false,
    isMessageComponent: () => false,
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
    commandName: "ph",
    options: { getSubcommandGroup: () => group, getSubcommand: () => sub },
    ...over,
  });
}

function replyText(i: { reply: ReturnType<typeof vi.fn> }): string {
  return (i.reply.mock.calls[0][0] as { content: string }).content;
}

beforeEach(() => vi.clearAllMocks());

describe("local analytics/triggers (Manage Server gated)", () => {
  it("rejects analytics outside a guild", async () => {
    const i = command("analytics", "status", { inGuild: () => false });
    await routeInteraction(i as never);
    expect(replyText(i)).toContain("inside a server");
    expect(handleStatusCommand).not.toHaveBeenCalled();
  });

  it("rejects non-admins for analytics and does not dispatch", async () => {
    const i = command("analytics", "status", { memberPermissions: { has: () => false } });
    await routeInteraction(i as never);
    expect(replyText(i)).toContain("Manage Server");
    expect(handleStatusCommand).not.toHaveBeenCalled();
  });

  it("routes an analytics subcommand to its handler", async () => {
    await routeInteraction(command("analytics", "status") as never);
    expect(handleStatusCommand).toHaveBeenCalledTimes(1);
  });

  it("routes a triggers subcommand to its handler", async () => {
    await routeInteraction(command("triggers", "add") as never);
    expect(handleTriggerAdd).toHaveBeenCalledTimes(1);
  });

  it("routes a forums subcommand to its handler", async () => {
    await routeInteraction(command("forums", "watch") as never);
    expect(handleForumsWatch).toHaveBeenCalledTimes(1);
  });

  it("gates forums on Manage Server", async () => {
    const i = command("forums", "watch", { memberPermissions: { has: () => false } });
    await routeInteraction(i as never);
    expect(replyText(i)).toContain("Manage Server");
    expect(handleForumsWatch).not.toHaveBeenCalled();
  });
});

describe("forwarded code/connect", () => {
  it("forwards /ph code (no group) publicly", async () => {
    await routeInteraction(command(null, "code") as never);
    expect(handleCodeCommand).toHaveBeenCalledTimes(1);
  });

  it("forwards /ph connect for admins", async () => {
    await routeInteraction(command(null, "connect") as never);
    expect(handleForwardedCommand).toHaveBeenCalledTimes(1);
  });

  it("requires Manage Server for /ph connect", async () => {
    const i = command(null, "connect", { memberPermissions: { has: () => false } });
    await routeInteraction(i as never);
    expect(replyText(i)).toContain("Manage Server");
    expect(handleForwardedCommand).not.toHaveBeenCalled();
  });
});

describe("roadmap ideas", () => {
  it("routes /ph idea locally without a permission gate", async () => {
    const i = command(null, "idea", { memberPermissions: { has: () => false } });
    await routeInteraction(i as never);
    expect(handleIdeaCommand).toHaveBeenCalledTimes(1);
  });

  it("routes the message action to the idea handler", async () => {
    const i = ix({
      isMessageContextMenuCommand: () => true,
      commandName: IDEA_MESSAGE_COMMAND_NAME,
    });
    await routeInteraction(i as never);
    expect(handleIdeaMessageAction).toHaveBeenCalledTimes(1);
  });

  it("ignores an unknown message action", async () => {
    const i = ix({ isMessageContextMenuCommand: () => true, commandName: "Something else" });
    await routeInteraction(i as never);
    expect(handleIdeaMessageAction).not.toHaveBeenCalled();
  });

  it("rejects the message action outside a guild", async () => {
    const i = ix({
      isMessageContextMenuCommand: () => true,
      commandName: IDEA_MESSAGE_COMMAND_NAME,
      inGuild: () => false,
    });
    await routeInteraction(i as never);
    expect(replyText(i)).toContain("inside a server");
    expect(handleIdeaMessageAction).not.toHaveBeenCalled();
  });

  it("routes the idea modal locally, not to PostHog", async () => {
    const i = ix({ isModalSubmit: () => true, customId: "roadmap_idea:1:2:3" });
    await routeInteraction(i as never);
    expect(handleIdeaModalSubmit).toHaveBeenCalledTimes(1);
    expect(handleModalForward).not.toHaveBeenCalled();
  });
});

describe("modals, components, autocomplete", () => {
  it("forwards a PostHog-rendered modal", async () => {
    const i = ix({ isModalSubmit: () => true, customId: "posthog_repo_modal" });
    await routeInteraction(i as never);
    expect(handleModalForward).toHaveBeenCalledTimes(1);
  });

  it("routes the events select menu (admin)", async () => {
    const i = ix({
      isMessageComponent: () => true,
      isStringSelectMenu: () => true,
      customId: "analytics:events",
    });
    await routeInteraction(i as never);
    expect(handleEventsSelect).toHaveBeenCalledTimes(1);
  });

  it("forwards a PostHog-rendered component", async () => {
    const i = ix({
      isMessageComponent: () => true,
      isStringSelectMenu: () => false,
      customId: "posthog_code_repo_select",
    });
    await routeInteraction(i as never);
    expect(handleComponentForward).toHaveBeenCalledTimes(1);
  });

  it("routes autocomplete to the repo handler", async () => {
    const i = ix({ isAutocomplete: () => true });
    await routeInteraction(i as never);
    expect(handleRepoAutocomplete).toHaveBeenCalledTimes(1);
  });
});
