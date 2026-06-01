import { type Client, Events } from "discord.js";

import { captureForGuild, toPersonLike } from "../capture.js";
import { guildProps } from "../props.js";
import { nowMs } from "../time.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Member lifecycle events: joins, leaves, and bans. Requires the GuildMembers intent for joins/leaves. */
export function register(client: Client): void {
  client.on(Events.GuildMemberAdd, (member) => {
    const createdAt = member.user.createdTimestamp;
    captureForGuild({
      guildId: member.guild.id,
      event: "member_joined",
      distinctId: member.id,
      actor: toPersonLike(member.user),
      properties: {
        ...guildProps(member.guild),
        account_age_days: Math.floor((nowMs() - createdAt) / DAY_MS),
        member_count: member.guild.memberCount,
      },
    });
  });

  client.on(Events.GuildMemberRemove, (member) => {
    const joinedTs = member.joinedTimestamp;
    captureForGuild({
      guildId: member.guild.id,
      event: "member_left",
      distinctId: member.id,
      actor: member.user ? toPersonLike(member.user) : undefined,
      properties: {
        ...guildProps(member.guild),
        joined_days_ago:
          joinedTs != null ? Math.floor((nowMs() - joinedTs) / DAY_MS) : null,
        // roles includes @everyone; subtract it for a meaningful count.
        roles_count: Math.max(0, member.roles.cache.size - 1),
      },
    });
  });

  client.on(Events.GuildBanAdd, (ban) => {
    captureForGuild({
      guildId: ban.guild.id,
      event: "member_banned",
      distinctId: ban.user.id,
      actor: toPersonLike(ban.user),
      properties: {
        ...guildProps(ban.guild),
      },
    });
  });
}
