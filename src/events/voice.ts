import { type Client, Events, type VoiceState } from "discord.js";

import { captureForGuild, toPersonLike } from "@/capture.js";
import { guildProps } from "@/props.js";
import { runVoiceJoinTriggers } from "@/triggers.js";

/** Voice channel join / leave / move events. */
export function register(client: Client): void {
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const member = newState.member ?? oldState.member;
    if (!member) return;

    const guild = newState.guild;
    const left = oldState.channelId;
    const joined = newState.channelId;

    if (!left && joined) {
      captureForGuild({
        guildId: guild.id,
        event: "voice_channel_joined",
        distinctId: member.id,
        actor: toPersonLike(member.user),
        properties: {
          ...guildProps(guild),
          channel_id: joined,
          channel_name: newState.channel?.name ?? null,
        },
      });

      // User-defined voice-join triggers (fired only on a fresh join).
      if (newState.channel) {
        runVoiceJoinTriggers(member, newState.channel);
      }
    } else if (left && !joined) {
      captureForGuild({
        guildId: guild.id,
        event: "voice_channel_left",
        distinctId: member.id,
        actor: toPersonLike(member.user),
        properties: {
          ...guildProps(guild),
          channel_id: left,
          channel_name: oldState.channel?.name ?? null,
        },
      });
    } else if (left && joined && left !== joined) {
      captureForGuild({
        guildId: guild.id,
        event: "voice_channel_moved",
        distinctId: member.id,
        actor: toPersonLike(member.user),
        properties: {
          ...guildProps(guild),
          from_channel_id: left,
          from_channel_name: oldState.channel?.name ?? null,
          to_channel_id: joined,
          to_channel_name: newState.channel?.name ?? null,
        },
      });
    }
    // Otherwise: same channel (mute/deafen/stream change) — not tracked.
  });
}

export type { VoiceState };
