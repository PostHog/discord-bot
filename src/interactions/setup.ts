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
const FIELD_HOST = "posthog_host";

/** Hosts for the `region` convenience option. US is the default. */
const REGION_HOSTS: Record<string, string> = {
  us: DEFAULT_POSTHOG_HOST,
  eu: "https://eu.i.posthog.com",
};

/** `/analytics setup` → pop a modal pre-filled with any existing values. */
export async function handleSetupCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const existing = interaction.guildId
    ? readGuildConfig(interaction.guildId)
    : null;

  // Optional region picker pre-fills the host field. "custom" (or none) keeps
  // the existing/default host so the admin can type their own.
  const region = interaction.options.getString("region");
  const regionHost =
    region && region !== "custom" ? REGION_HOSTS[region] : undefined;
  const hostDefault =
    regionHost ?? existing?.posthogHost ?? DEFAULT_POSTHOG_HOST;

  const keyInput = new TextInputBuilder()
    .setCustomId(FIELD_KEY)
    .setLabel("PostHog project API key (phc_...)")
    .setPlaceholder("phc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(100);
  if (existing?.posthogApiKey) keyInput.setValue(existing.posthogApiKey);

  const hostInput = new TextInputBuilder()
    .setCustomId(FIELD_HOST)
    .setLabel("PostHog host")
    .setPlaceholder(DEFAULT_POSTHOG_HOST)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setValue(hostDefault);

  const modal = new ModalBuilder()
    .setCustomId(SETUP_MODAL_ID)
    .setTitle("Connect PostHog")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(keyInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(hostInput)
    );

  await interaction.showModal(modal);
}

function normalizeHost(raw: string): string | null {
  let value = raw.trim();
  if (value === "") return null;
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    // Strip any trailing slash / path — posthog-node wants the bare origin.
    return url.origin;
  } catch {
    return null;
  }
}

/** Modal submit → validate and persist the PostHog key + host. */
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

  const apiKey = interaction.fields.getTextInputValue(FIELD_KEY).trim();
  const hostRaw = interaction.fields.getTextInputValue(FIELD_HOST);
  const host = normalizeHost(hostRaw);

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

  if (!host) {
    await interaction.reply({
      content: `❌ "${hostRaw}" isn't a valid host URL. Example: \`${DEFAULT_POSTHOG_HOST}\``,
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
