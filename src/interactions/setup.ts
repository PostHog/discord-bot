import {
  ActionRowBuilder,
  type ChatInputCommandInteraction,
  MessageFlags,
  ModalBuilder,
  type ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";

import { DEFAULT_POSTHOG_HOST, readGuildConfig, upsertPosthog } from "@/db.js";
import { nowMs } from "@/time.js";

export const SETUP_MODAL_ID = "analytics:setup";
const FIELD_KEY = "posthog_key";

/**
 * Region → cloud host. These are the ONLY destinations the bot will ever send
 * to. There is intentionally no self-hosted / custom-host option: the host is
 * never taken from admin free-text, which removes the SSRF surface entirely.
 */
const REGION_HOSTS: Record<string, string> = {
  us: DEFAULT_POSTHOG_HOST,
  eu: "https://eu.i.posthog.com",
};

/**
 * `/analytics setup` → pop a modal asking only for the project API key. The
 * destination is fixed to a PostHog Cloud region (us/eu) chosen via the `region`
 * option and encoded in the modal's custom id (`analytics:setup:<region>`), so
 * the bot can never be pointed at an arbitrary host.
 */
export async function handleSetupCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const existing = interaction.guildId
    ? readGuildConfig(interaction.guildId)
    : null;

  const region = (interaction.options.getString("region") ?? "us").toLowerCase();
  const safeRegion = region in REGION_HOSTS ? region : "us";

  const keyInput = new TextInputBuilder()
    .setCustomId(FIELD_KEY)
    .setLabel("PostHog project API key (phc_...)")
    .setPlaceholder("phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(100);
  if (existing?.posthogApiKey) keyInput.setValue(existing.posthogApiKey);

  const modal = new ModalBuilder()
    .setCustomId(`${SETUP_MODAL_ID}:${safeRegion}`)
    .setTitle(`Connect PostHog (${safeRegion.toUpperCase()})`)
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(keyInput)
    );

  await interaction.showModal(modal);
}

/** Modal submit → validate the key and persist it against the chosen region's host. */
export async function handleSetupModal(
  interaction: ModalSubmitInteraction
): Promise<void> {
  if (!interaction.guildId) {
    await interaction.reply({
      content: "This can only be configured inside a server.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // The region is encoded in the modal custom id; the host is therefore always
  // a known PostHog Cloud URL, never admin-supplied free text.
  const region = interaction.customId.split(":")[2] ?? "us";
  const host = REGION_HOSTS[region] ?? DEFAULT_POSTHOG_HOST;
  const apiKey = interaction.fields.getTextInputValue(FIELD_KEY).trim();

  if (!apiKey.startsWith("phc_")) {
    await interaction.reply({
      content:
        "❌ That doesn't look like a PostHog **project** API key. It should " +
        "start with `phc_`. You can find it in PostHog under " +
        "**Settings → Project → Project API key**.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  upsertPosthog(interaction.guildId, apiKey, host, nowMs());

  await interaction.reply({
    content:
      `✅ Connected to PostHog at \`${host}\`.\n` +
      "Next, run `/analytics events` to choose what to track, then " +
      "`/analytics test` to verify the connection.",
    flags: MessageFlags.Ephemeral,
  });
}
