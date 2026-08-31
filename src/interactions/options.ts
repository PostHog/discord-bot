import {
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";

import { readGuildConfig, setOptions } from "@/db.js";
import { nowMs } from "@/time.js";

/** `/ph analytics options` → update bot-filtering and message sampling. */
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

  const captureMessageContent =
    interaction.options.getBoolean("capture_message_content") ??
    existing?.captureMessageContent ??
    false;

  setOptions(
    interaction.guildId,
    ignoreBots,
    sampleRate,
    captureMessageContent,
    nowMs()
  );

  const contentWarning = captureMessageContent
    ? "\n\n⚠️ Message text from this server is now sent to PostHog as " +
      "`message_content`. Members are not notified — make sure that's what " +
      "your server expects. Turn it back off with " +
      "`/ph analytics options capture_message_content:false`."
    : "";

  await interaction.reply({
    content:
      "✅ Options updated:\n" +
      `• Ignore bot users: **${ignoreBots ? "yes" : "no"}**\n` +
      `• Message sample rate: **${sampleRate}** (1.0 = all messages)\n` +
      `• Capture message content: **${captureMessageContent ? "yes" : "no"}**` +
      contentWarning,
    flags: MessageFlags.Ephemeral,
  });
}
