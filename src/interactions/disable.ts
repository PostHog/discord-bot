import {
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";

import { clearConfig } from "@/db.js";

/** `/ph analytics disable` → clear all config; the bot goes silent for this guild. */
export async function handleDisableCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) return;

  clearConfig(interaction.guildId);

  await interaction.reply({
    content:
      "🛑 Analytics disabled. This server's PostHog key and event settings have " +
      "been cleared. Run `/ph connect` any time to start again.",
    flags: MessageFlags.Ephemeral,
  });
}
