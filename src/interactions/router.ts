import {
  type Interaction,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

import { handleDisableCommand } from "@/interactions/disable.js";
import { EVENTS_SELECT_ID, handleEventsCommand, handleEventsSelect } from "@/interactions/events.js";
import { handleOptionsCommand } from "@/interactions/options.js";
import {
  SETUP_MODAL_ID,
  handleSetupCommand,
  handleSetupModal,
} from "@/interactions/setup.js";
import { handleStatusCommand } from "@/interactions/status.js";
import { handleTestCommand } from "@/interactions/test.js";
import {
  handleTriggerAdd,
  handleTriggerList,
  handleTriggerRemove,
  handleTriggerToggle,
} from "@/interactions/triggers.js";

/**
 * Single entry point for `Events.InteractionCreate`. Dispatches slash-command
 * subcommands, the setup modal submit, and the events select-menu submit. Every
 * branch re-checks the "Manage Server" permission so the gate can't be bypassed
 * by loosening Discord's per-command permission overrides.
 */
export async function routeInteraction(interaction: Interaction): Promise<void> {
  try {
    if (!interaction.inGuild()) {
      // Only respond to things we can reply to.
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: "Analytics can only be configured inside a server.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (!hasManageGuild(interaction)) {
      if (interaction.isRepliable()) {
        await interaction.reply({
          content: "You need the **Manage Server** permission to do that.",
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (interaction.isChatInputCommand() && interaction.commandName === "analytics") {
      const group = interaction.options.getSubcommandGroup(false);
      const sub = interaction.options.getSubcommand();

      if (group === "trigger") {
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
        return;
      }

      switch (sub) {
        case "setup":
          return await handleSetupCommand(interaction);
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
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === SETUP_MODAL_ID) {
      return await handleSetupModal(interaction);
    }

    if (
      interaction.isStringSelectMenu() &&
      interaction.customId === EVENTS_SELECT_ID
    ) {
      return await handleEventsSelect(interaction);
    }
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

/**
 * Re-check the Manage Server permission. `interaction.memberPermissions` is a
 * resolved bitfield in guild contexts; absent only for the edge case of an
 * uncached member, in which case we deny.
 */
function hasManageGuild(interaction: Interaction): boolean {
  const perms = interaction.memberPermissions;
  return perms?.has(PermissionFlagsBits.ManageGuild) ?? false;
}
