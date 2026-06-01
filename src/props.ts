import {
  ChannelType,
  type Guild,
  type GuildBasedChannel,
  type TextBasedChannel,
} from "discord.js";

/**
 * Human-readable channel type label. Maps discord.js's numeric ChannelType enum
 * to a stable snake_case string so PostHog breakdowns read nicely.
 */
function channelTypeLabel(type: ChannelType): string {
  switch (type) {
    case ChannelType.GuildText:
      return "text";
    case ChannelType.GuildVoice:
      return "voice";
    case ChannelType.GuildAnnouncement:
      return "announcement";
    case ChannelType.GuildStageVoice:
      return "stage";
    case ChannelType.GuildForum:
      return "forum";
    case ChannelType.PublicThread:
      return "public_thread";
    case ChannelType.PrivateThread:
      return "private_thread";
    case ChannelType.AnnouncementThread:
      return "announcement_thread";
    default:
      return `type_${type}`;
  }
}

type AnyChannel = (GuildBasedChannel | TextBasedChannel) & {
  id: string;
  type: ChannelType;
};

/** Common channel properties attached to most events. */
export function channelProps(
  channel: AnyChannel | null | undefined
): Record<string, unknown> {
  if (!channel) return {};
  const name = "name" in channel ? (channel.name ?? null) : null;
  return {
    channel_id: channel.id,
    channel_name: name,
    channel_type: channelTypeLabel(channel.type),
  };
}

/** Common guild (server) properties attached to every event. */
export function guildProps(guild: Guild): Record<string, unknown> {
  return {
    guild_id: guild.id,
    guild_name: guild.name,
  };
}
