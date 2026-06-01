import {
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";

import { readGuildConfig, setOptions } from "../db.js";
import { nowMs } from "../time.js";

/** `/analytics options` → update bot-filtering and message sampling. */
export async function handleOptionsCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) return;

  const existing = readGuildConfig(interaction.guildId);
  const ignoreBots =
    interaction.options.getBoolean("ignore_bots") ??
    existing?.ignoreBots ??
    true;
  const sampleRate =
    interaction.options.getNumber("message_sample_rate") ??
    existing?.messageSampleRate ??
    1.0;

  setOptions(interaction.guildId, ignoreBots, sampleRate, nowMs());

  await interaction.reply({
    content:
      "✅ Options updated:\n" +
      `• Ignore bot users: **${ignoreBots ? "yes" : "no"}**\n` +
      `• Message sample rate: **${sampleRate}** (1.0 = all messages)`,
    flags: MessageFlags.Ephemeral,
  });
}
