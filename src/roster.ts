import { type Client, Events, type Guild, type GuildMember } from "discord.js";

import { captureForGuild, toPersonLike } from "@/capture.js";
import { config } from "@/config.js";
import { getGuildConfig } from "@/configCache.js";

/**
 * Periodic member roster. Gateway events only ever tell you about people who
 * *do* something, so PostHog never learns about the silent majority of a server
 * — which makes "how many members have never posted?" unanswerable, since the
 * denominator is missing.
 *
 * This emits one event per member on a schedule, creating a PostHog person for
 * every member and attaching their Discord join date and roles. That gives you
 * the full roster to divide by, plus tenure ("joined 30+ days ago") for members
 * who were already in the server before the bot arrived — `member_joined` can
 * only see joins from installation onwards.
 *
 * Roles are re-`$set` on every run, so a member who picks up a role later is
 * reflected within one interval. Opt-in like any other event, and note it costs
 * one event per member per run — on a 1,000-member server that's 1,000 events a
 * day at the default interval.
 */
const ROSTER_EVENT = "member_roster";

/** Discord's implicit everyone-role shows on every member; it carries no signal. */
const EVERYONE_ROLE = "@everyone";

function memberProperties(
  guild: Guild,
  member: GuildMember
): { properties: Record<string, unknown>; personProperties: Record<string, unknown> } {
  const roles = member.roles.cache
    .map((role) => role.name)
    .filter((name) => name !== EVERYONE_ROLE)
    .sort();
  const joinedAt = member.joinedAt ? member.joinedAt.toISOString() : null;

  return {
    properties: {
      guild_id: guild.id,
      guild_name: guild.name,
      joined_at: joinedAt,
      roles,
      role_count: roles.length,
      is_bot: member.user.bot,
      nickname: member.nickname ?? null,
    },
    // Mirrored onto the person so roster facts are usable in cohorts and in
    // breakdowns of the member's other events.
    personProperties: {
      discord_joined_at: joinedAt,
      discord_roles: roles,
      discord_role_count: roles.length,
    },
  };
}

export async function rosterGuild(guild: Guild): Promise<void> {
  const cfg = getGuildConfig(guild.id);
  // Pre-gate here (as well as inside captureForGuild) so we skip the member
  // fetch entirely for guilds that aren't configured / haven't enabled it.
  if (!cfg?.posthogApiKey) return;
  if (!cfg.enabledEvents.includes(ROSTER_EVENT)) return;

  let members;
  try {
    // Requires the privileged GuildMembers intent; without it this resolves to
    // just the bot itself rather than throwing, so the roster is simply thin.
    members = await guild.members.fetch();
  } catch (err) {
    console.error(`[roster] member fetch failed for ${guild.id}:`, err);
    return;
  }

  for (const member of members.values()) {
    const { properties, personProperties } = memberProperties(guild, member);
    captureForGuild({
      guildId: guild.id,
      event: ROSTER_EVENT,
      distinctId: member.id,
      actor: toPersonLike(member.user),
      properties,
      personProperties,
    });
  }
}

async function rosterAll(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    await rosterGuild(guild);
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

export function register(client: Client): void {
  client.once(Events.ClientReady, () => {
    const intervalMs = config.rosterIntervalHours * 60 * 60 * 1000;
    // One pass on startup so the roster is populated immediately.
    void rosterAll(client);
    timer = setInterval(() => void rosterAll(client), intervalMs);
    timer.unref();
    console.log(`Member roster enabled (every ${config.rosterIntervalHours}h).`);
  });
}

export function stopRoster(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
