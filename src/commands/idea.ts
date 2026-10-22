import { ApplicationCommandType, ContextMenuCommandBuilder } from "discord.js";

/**
 * Message action for submitting an existing message as a roadmap idea —
 * right-click a message → Apps → "Submit as roadmap idea".
 *
 * This is a separate command rather than part of `/ph` because Discord models
 * context-menu entries as their own application commands; they cannot be
 * subcommands. It is registered per-guild and only where the feature is
 * configured (see `commandRegistry.ts`), so it stays invisible elsewhere.
 */
export const IDEA_MESSAGE_COMMAND_NAME = "Submit as roadmap idea";

export const ideaMessageCommand = new ContextMenuCommandBuilder()
  .setName(IDEA_MESSAGE_COMMAND_NAME)
  .setType(ApplicationCommandType.Message)
  .setDMPermission(false)
  .toJSON();
