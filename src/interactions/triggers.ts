import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";

import {
  addTrigger,
  getTrigger,
  listTriggers,
  removeTrigger,
  setTriggerEnabled,
  TriggerLimitError,
  type Trigger,
  type TriggerConditions,
  type TriggerSource,
} from "../db.js";
import { nowMs } from "../time.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** PostHog event names: lowercase, [a-z0-9_] only. */
function sanitizeEventName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function splitList(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Parse an emoji option value into a stored condition. */
function parseEmoji(raw: string): NonNullable<TriggerConditions["emoji"]> {
  const custom = raw.trim().match(/^<a?:(\w+):(\d+)>$/);
  if (custom) return { kind: "custom", id: custom[2], name: custom[1] };
  return { kind: "unicode", value: raw.trim() };
}

/** Which option fields are valid for each source. */
const ALLOWED: Record<TriggerSource, Set<string>> = {
  message: new Set(["channel", "contains", "keywords", "starts_with"]),
  file: new Set(["channel", "contains", "keywords", "starts_with", "file_ext"]),
  reaction: new Set(["channel", "emoji"]),
  member_join: new Set([]),
  voice_join: new Set(["channel"]),
};

export async function handleTriggerAdd(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) return;
  const opts = interaction.options;

  const name = opts.getString("name", true).trim();
  const eventName = sanitizeEventName(opts.getString("event_name", true));
  const source = opts.getString("source", true) as TriggerSource;

  if (!eventName) {
    await interaction.reply({
      content:
        "❌ `event_name` must contain letters or numbers (it becomes the PostHog event name).",
      ...EPHEMERAL,
    });
    return;
  }

  const channel = opts.getChannel("channel");
  const contains = opts.getString("contains");
  const keywords = opts.getString("keywords");
  const startsWith = opts.getString("starts_with");
  const fileExt = opts.getString("file_ext");
  const emoji = opts.getString("emoji");

  // Reject options that don't apply to the chosen source.
  const provided: Record<string, unknown> = {
    channel,
    contains,
    keywords,
    starts_with: startsWith,
    file_ext: fileExt,
    emoji,
  };
  const allowed = ALLOWED[source];
  const stray = Object.entries(provided)
    .filter(([k, v]) => v != null && !allowed.has(k))
    .map(([k]) => k);
  if (stray.length > 0) {
    await interaction.reply({
      content:
        `❌ These options don't apply to a **${source}** trigger: ` +
        stray.map((s) => `\`${s}\``).join(", ") +
        `.\nAllowed for ${source}: ${[...allowed].map((s) => `\`${s}\``).join(", ") || "_none_"}.`,
      ...EPHEMERAL,
    });
    return;
  }

  // At most one content mode.
  const contentModes = [contains, keywords, startsWith].filter(
    (v) => v != null
  );
  if (contentModes.length > 1) {
    await interaction.reply({
      content: "❌ Pick only one of `contains`, `keywords`, or `starts_with`.",
      ...EPHEMERAL,
    });
    return;
  }

  // Build conditions.
  const conditions: TriggerConditions = {};
  if (channel) conditions.channelIds = [channel.id];
  if (contains) conditions.content = { mode: "contains", terms: [contains] };
  else if (keywords)
    conditions.content = { mode: "keywords", terms: splitList(keywords) };
  else if (startsWith)
    conditions.content = { mode: "starts_with", terms: [startsWith] };
  if (fileExt)
    conditions.fileExtensions = splitList(fileExt).map((e) =>
      e.replace(/^\./, "").toLowerCase()
    );
  if (emoji) conditions.emoji = parseEmoji(emoji);

  let id: number;
  try {
    id = addTrigger(
      interaction.guildId,
      { name, eventName, source, conditions },
      nowMs()
    );
  } catch (err) {
    if (err instanceof TriggerLimitError) {
      await interaction.reply({ content: `❌ ${err.message}`, ...EPHEMERAL });
      return;
    }
    throw err;
  }

  // Warn when matching depends on the privileged Message Content intent.
  const needsContent =
    source === "file" || (source === "message" && conditions.content != null);
  const note = needsContent
    ? "\n\n⚠️ This matches on message content/attachments, which requires the " +
      "**Message Content** privileged intent to be enabled for the bot."
    : "";

  await interaction.reply({
    content:
      `✅ Created trigger **#${id}** — \`${eventName}\`\n` +
      summarizeTrigger({
        id,
        guildId: interaction.guildId,
        name,
        eventName,
        source,
        conditions,
        enabled: true,
      }) +
      note,
    ...EPHEMERAL,
  });
}

export async function handleTriggerList(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) return;
  const triggers = listTriggers(interaction.guildId);

  if (triggers.length === 0) {
    await interaction.reply({
      content:
        "No triggers yet. Create one with `/analytics trigger add`. " +
        "Example: source `message`, `contains: refund`, event_name `refund_request`.",
      ...EPHEMERAL,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle(`🎯 Custom triggers (${triggers.length})`)
    .setColor(0x1d4aff)
    .setDescription(triggers.map((t) => summarizeTrigger(t)).join("\n\n"));

  await interaction.reply({ embeds: [embed], ...EPHEMERAL });
}

export async function handleTriggerRemove(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) return;
  const id = interaction.options.getInteger("id", true);
  const ok = removeTrigger(interaction.guildId, id);
  await interaction.reply({
    content: ok
      ? `🗑️ Removed trigger **#${id}**.`
      : `❌ No trigger **#${id}** in this server.`,
    ...EPHEMERAL,
  });
}

export async function handleTriggerToggle(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) return;
  const id = interaction.options.getInteger("id", true);
  const enabled = interaction.options.getBoolean("enabled", true);
  // Guard: only toggle if it exists, so we can give a useful message.
  if (!getTrigger(interaction.guildId, id)) {
    await interaction.reply({
      content: `❌ No trigger **#${id}** in this server.`,
      ...EPHEMERAL,
    });
    return;
  }
  setTriggerEnabled(interaction.guildId, id, enabled, nowMs());
  await interaction.reply({
    content: `${enabled ? "✅ Enabled" : "⏸️ Disabled"} trigger **#${id}**.`,
    ...EPHEMERAL,
  });
}

/** One-line-ish human summary of a trigger and its conditions. */
function summarizeTrigger(t: Trigger): string {
  const parts: string[] = [];
  const c = t.conditions;
  if (c.channelIds?.length)
    parts.push(`channel ${c.channelIds.map((id) => `<#${id}>`).join(", ")}`);
  if (c.content)
    parts.push(`${c.content.mode}: ${c.content.terms.map((x) => `"${x}"`).join(", ")}`);
  if (c.fileExtensions?.length)
    parts.push(`file ext: ${c.fileExtensions.join(", ")}`);
  if (c.emoji)
    parts.push(
      `emoji: ${c.emoji.kind === "custom" ? `:${c.emoji.name}:` : c.emoji.value}`
    );
  const cond = parts.length ? parts.join(" · ") : "any";
  const status = t.enabled ? "" : " _(disabled)_";
  return `**#${t.id}** ${t.name}${status}\n` + `   ${t.source} → \`${t.eventName}\` · ${cond}`;
}
