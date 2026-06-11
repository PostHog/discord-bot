import {
  ChannelType,
  type ChatInputCommandInteraction,
  MessageFlags,
} from "discord.js";

import {
  addWatchedForum,
  listWatchedForums,
  removeWatchedForum,
} from "@/db.js";

const EPHEMERAL = { flags: MessageFlags.Ephemeral } as const;

/** `/ph forums watch <channel>` → start forwarding new posts from a forum. */
export async function handleForumsWatch(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) return;
  const channel = interaction.options.getChannel("channel", true);

  // The option is restricted to forum channels, but re-check so a stale/odd
  // selection can't slip through.
  if (channel.type !== ChannelType.GuildForum) {
    await interaction.reply({
      content: "❌ That isn't a forum channel.",
      ...EPHEMERAL,
    });
    return;
  }

  const added = addWatchedForum(interaction.guildId, channel.id);
  await interaction.reply({
    content: added
      ? `✅ Now forwarding new posts in <#${channel.id}> to PostHog Code.`
      : `<#${channel.id}> is already being watched.`,
    ...EPHEMERAL,
  });
}

/** `/ph forums unwatch <channel>` → stop forwarding posts from a forum. */
export async function handleForumsUnwatch(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) return;
  const channel = interaction.options.getChannel("channel", true);

  const removed = removeWatchedForum(interaction.guildId, channel.id);
  await interaction.reply({
    content: removed
      ? `🛑 Stopped forwarding posts in <#${channel.id}>.`
      : `<#${channel.id}> wasn't being watched.`,
    ...EPHEMERAL,
  });
}

/** `/ph forums list` → show the watched forum channels. */
export async function handleForumsList(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  if (!interaction.guildId) return;
  const ids = listWatchedForums(interaction.guildId);

  await interaction.reply({
    content:
      ids.length === 0
        ? "No forums are being watched. Add one with `/ph forums watch`."
        : `📋 Watching ${ids.length} forum(s):\n` +
          ids.map((id) => `• <#${id}>`).join("\n"),
    ...EPHEMERAL,
  });
}
