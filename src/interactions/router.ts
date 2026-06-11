import {
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type Interaction,
  MessageFlags,
  type MessageComponentInteraction,
  type ModalSubmitInteraction,
  PermissionFlagsBits,
} from "discord.js";

import {
  handleCodeCommand,
  handleComponentForward,
  handleForwardedCommand,
  handleModalForward,
  handleRepoAutocomplete,
} from "@/interactions/bridge.js";
import { handleDisableCommand } from "@/interactions/disable.js";
import { EVENTS_SELECT_ID, handleEventsCommand, handleEventsSelect } from "@/interactions/events.js";
import {
  handleForumsList,
  handleForumsUnwatch,
  handleForumsWatch,
} from "@/interactions/forums.js";
import { handleOptionsCommand } from "@/interactions/options.js";
import { handleStatusCommand } from "@/interactions/status.js";
import { handleTestCommand } from "@/interactions/test.js";
import {
  handleTriggerAdd,
  handleTriggerList,
  handleTriggerRemove,
  handleTriggerToggle,
} from "@/interactions/triggers.js";

/**
 * Single entry point for `Events.InteractionCreate`. The bot exposes one `/ph`
 * command; routing splits by interaction type then by subcommand group:
 *
 * - `analytics` / `triggers` groups are handled **locally** and gated to
 *   Manage Server (the gate is per-branch, not global, because `code` and the
 *   PostHog-rendered components must stay open to everyone).
 * - `code` / `connect` and any non-analytics component/modal are **forwarded**
 *   to PostHog Code (see `interactions/bridge.ts`).
 */
export async function routeInteraction(interaction: Interaction): Promise<void> {
  try {
    if (interaction.isAutocomplete()) return await routeAutocomplete(interaction);
    if (interaction.isChatInputCommand()) return await routeCommand(interaction);
    if (interaction.isModalSubmit()) return await routeModal(interaction);
    if (interaction.isMessageComponent()) return await routeComponent(interaction);
  } catch (err) {
    console.error("[interaction] handler error:", err);
    // Best-effort error surface to the user without throwing again.
    try {
      if (interaction.isRepliable()) {
        const payload = {
          content: "Something went wrong handling that interaction.",
          flags: MessageFlags.Ephemeral as const,
        };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      }
    } catch {
      // give up silently
    }
  }
}

async function routeCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.commandName !== "ph") return;

  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand(false);

  // Local, Manage-Server-gated groups.
  if (group === "analytics" || group === "triggers" || group === "forums") {
    if (!(await ensureGuild(interaction))) return;
    if (!(await ensureManageGuild(interaction))) return;
    if (group === "analytics") return await dispatchAnalytics(interaction, sub);
    if (group === "triggers") return await dispatchTrigger(interaction, sub);
    return await dispatchForums(interaction, sub);
  }

  // Forwarded commands.
  if (sub === "code") {
    return await handleCodeCommand(interaction);
  }
  // Binding the server to a PostHog project — gate on Manage Server so a
  // non-admin can't connect the shared server to their own project (PostHog
  // separately verifies org-admin on the target project).
  if (sub === "connect") {
    if (!(await ensureGuild(interaction))) return;
    if (!(await ensureManageGuild(interaction))) return;
    return await handleForwardedCommand(interaction);
  }
}

async function dispatchForums(
  interaction: ChatInputCommandInteraction,
  sub: string | null
): Promise<void> {
  switch (sub) {
    case "watch":
      return await handleForumsWatch(interaction);
    case "unwatch":
      return await handleForumsUnwatch(interaction);
    case "list":
      return await handleForumsList(interaction);
  }
}

async function dispatchAnalytics(
  interaction: ChatInputCommandInteraction,
  sub: string | null
): Promise<void> {
  switch (sub) {
    case "events":
      return await handleEventsCommand(interaction);
    case "options":
      return await handleOptionsCommand(interaction);
    case "status":
      return await handleStatusCommand(interaction);
    case "test":
      return await handleTestCommand(interaction);
    case "disable":
      return await handleDisableCommand(interaction);
  }
}

async function dispatchTrigger(
  interaction: ChatInputCommandInteraction,
  sub: string | null
): Promise<void> {
  switch (sub) {
    case "add":
      return await handleTriggerAdd(interaction);
    case "list":
      return await handleTriggerList(interaction);
    case "remove":
      return await handleTriggerRemove(interaction);
    case "toggle":
      return await handleTriggerToggle(interaction);
  }
}

async function routeModal(interaction: ModalSubmitInteraction): Promise<void> {
  // The bot has no local modals; every modal submit is PostHog-rendered.
  return await handleModalForward(interaction);
}

async function routeComponent(interaction: MessageComponentInteraction): Promise<void> {
  if (interaction.isStringSelectMenu() && interaction.customId === EVENTS_SELECT_ID) {
    if (!(await ensureGuild(interaction))) return;
    if (!(await ensureManageGuild(interaction))) return;
    return await handleEventsSelect(interaction);
  }
  return await handleComponentForward(interaction);
}

async function routeAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
  return await handleRepoAutocomplete(interaction);
}

/** Reply + deny if the interaction isn't in a guild. */
async function ensureGuild(interaction: Interaction): Promise<boolean> {
  if (interaction.inGuild()) return true;
  if (interaction.isRepliable()) {
    await interaction.reply({
      content: "This can only be used inside a server.",
      flags: MessageFlags.Ephemeral,
    });
  }
  return false;
}

/** Reply + deny if the member lacks Manage Server. */
async function ensureManageGuild(interaction: Interaction): Promise<boolean> {
  if (hasManageGuild(interaction)) return true;
  if (interaction.isRepliable()) {
    await interaction.reply({
      content: "You need the **Manage Server** permission to do that.",
      flags: MessageFlags.Ephemeral,
    });
  }
  return false;
}

/**
 * Re-check the Manage Server permission. `interaction.memberPermissions` is a
 * resolved bitfield in guild contexts; absent only for the edge case of an
 * uncached member, in which case we deny.
 */
function hasManageGuild(interaction: Interaction): boolean {
  const perms = interaction.memberPermissions;
  return perms?.has(PermissionFlagsBits.ManageGuild) ?? false;
}
