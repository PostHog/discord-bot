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

/**
 * Common channel properties attached to most events.
 *
 * For a thread we also record its parent, and expose `root_channel_*` — the
 * parent for threads, the channel itself otherwise. Break down on `root_channel_name`
 * to get per-channel totals with thread activity folded into the channel it
 * happened in; use `channel_name` when you want each thread counted separately.
 */
export function channelProps(
  channel: AnyChannel | null | undefined
): Record<string, unknown> {
  if (!channel) return {};
  const name = "name" in channel ? (channel.name ?? null) : null;
  const props: Record<string, unknown> = {
    channel_id: channel.id,
    channel_name: name,
    channel_type: channelTypeLabel(channel.type),
  };

  // `parent` is only meaningful here for threads — on a regular channel it's the
  // category, which isn't what we want to roll up into.
  const isThread =
    "isThread" in channel && typeof channel.isThread === "function"
      ? channel.isThread()
      : false;
  const parent =
    isThread && "parent" in channel
      ? (channel.parent as { id: string; name?: string | null } | null)
      : null;

  if (parent) {
    props.parent_channel_id = parent.id;
    props.parent_channel_name = parent.name ?? null;
  }
  props.root_channel_id = parent ? parent.id : channel.id;
  props.root_channel_name = parent ? (parent.name ?? null) : name;

  return props;
}

/** Common guild (server) properties attached to every event. */
export function guildProps(guild: Guild): Record<string, unknown> {
  return {
    guild_id: guild.id,
    guild_name: guild.name,
  };
}
