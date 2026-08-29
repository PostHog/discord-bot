import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";

import { countTriggers, readGuildConfig } from "@/db.js";
import { EVENT_CATALOG } from "@/events-catalog.js";

/** Mask an API key so `/ph analytics status` never echoes it in full. */
function maskKey(key: string): string {
  if (key.length <= 8) return "phc_…";
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/** `/ph analytics status` → show the current configuration as an ephemeral embed. */
export async function handleStatusCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) return;

  const cfg = readGuildConfig(interaction.guildId);

  if (!cfg || !cfg.posthogApiKey) {
    await interaction.reply({
      content:
        "This server isn't connected to PostHog yet. Run `/ph connect` to get started.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const enabled = new Set(cfg.enabledEvents);
  const eventLines =
    cfg.enabledEvents.length === 0
      ? "_none — nothing is being sent_"
      : EVENT_CATALOG.filter((e) => enabled.has(e.key))
          .map((e) => `• ${e.label}`)
          .join("\n");

  const embed = new EmbedBuilder()
    .setTitle("📊 Analytics configuration")
    .setColor(0x1d4aff)
    .addFields(
      { name: "PostHog host", value: `\`${cfg.posthogHost}\``, inline: false },
      { name: "Project key", value: `\`${maskKey(cfg.posthogApiKey)}\``, inline: true },
      { name: "Ignore bots", value: cfg.ignoreBots ? "yes" : "no", inline: true },
      {
        name: "Message sample rate",
        value: String(cfg.messageSampleRate),
        inline: true,
      },
      {
        name: "Message content",
        value: cfg.captureMessageContent ? "⚠️ sent" : "not sent",
        inline: true,
      },
      {
        name: `Enabled events (${cfg.enabledEvents.length})`,
        value: eventLines,
        inline: false,
      },
      {
        name: "Custom triggers",
        value: `${countTriggers(interaction.guildId)} (see \`/ph triggers list\`)`,
        inline: false,
      }
    );

  await interaction.reply({
    embeds: [embed],
    flags: MessageFlags.Ephemeral,
  });
}
