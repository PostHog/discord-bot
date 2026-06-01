import {
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";

import { readGuildConfig } from "../db.js";
import { getPostHogClient } from "../posthogPool.js";

/**
 * `/analytics test` → send a real `analytics_test` event to the guild's PostHog
 * project and confirm it flushed without error, so an admin knows the key works.
 */
export async function handleTestCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) return;

  const cfg = readGuildConfig(interaction.guildId);
  if (!cfg || !cfg.posthogApiKey) {
    await interaction.reply({
      content: "Not connected yet — run `/analytics setup` first.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const client = getPostHogClient(cfg.posthogHost, cfg.posthogApiKey);
    client.capture({
      distinctId: interaction.user.id,
      event: "analytics_test",
      properties: {
        source: "discord_bot",
        triggered_by: interaction.user.username,
        $set: { discord_username: interaction.user.username },
      },
      groups: { discord_server: interaction.guildId },
    });
    // Force a flush so we surface auth/network errors synchronously here rather
    // than silently in the background batch.
    await client.flush();

    await interaction.editReply({
      content:
        `✅ Sent a test event (\`analytics_test\`) to \`${cfg.posthogHost}\`.\n` +
        "Check your PostHog **Activity** feed — it should appear within a few seconds.",
    });
  } catch (err) {
    await interaction.editReply({
      content:
        "❌ Failed to send the test event. Double-check the project API key and " +
        `host with \`/analytics setup\`.\n\`\`\`${String(err).slice(0, 300)}\`\`\``,
    });
  }
}
