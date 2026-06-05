import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  StringSelectMenuBuilder,
  type StringSelectMenuInteraction,
  StringSelectMenuOptionBuilder,
} from "discord.js";

import { readGuildConfig, setEnabledEvents } from "@/db.js";
import { EVENT_CATALOG } from "@/events-catalog.js";
import { nowMs } from "@/time.js";

export const EVENTS_SELECT_ID = "analytics:events";

/** `/analytics events` → show a multi-select of every event with current ones pre-checked. */
export async function handleEventsCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) return;

  const existing = readGuildConfig(interaction.guildId);
  const enabled = new Set(existing?.enabledEvents ?? []);

  const options = EVENT_CATALOG.map((entry) =>
    new StringSelectMenuOptionBuilder()
      .setLabel(entry.label)
      .setValue(entry.key)
      .setDescription(entry.description.slice(0, 100))
      .setDefault(enabled.has(entry.key))
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(EVENTS_SELECT_ID)
    .setPlaceholder("Select the events to send to PostHog")
    .setMinValues(0)
    .setMaxValues(options.length)
    .addOptions(options);

  const note =
    existing?.posthogApiKey
      ? "Pick the events you want streamed to PostHog:"
      : "⚠️ This server isn't connected to PostHog yet — run `/analytics setup` " +
        "first. You can still choose events now; they'll start sending once " +
        "you're connected.";

  await interaction.reply({
    content: note,
    components: [
      new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select),
    ],
    flags: MessageFlags.Ephemeral,
  });
}

/** Select submit → persist the chosen event set. */
export async function handleEventsSelect(
  interaction: StringSelectMenuInteraction
): Promise<void> {
  if (!interaction.guildId) return;

  const selected = interaction.values;
  setEnabledEvents(interaction.guildId, selected, nowMs());

  const summary =
    selected.length === 0
      ? "No events selected — nothing will be sent until you enable some."
      : `Now tracking **${selected.length}** event type(s):\n` +
        selected.map((k) => `• \`${k}\``).join("\n");

  await interaction.update({
    content: `✅ Saved.\n${summary}`,
    components: [],
  });
}
