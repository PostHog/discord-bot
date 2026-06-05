import { type Client, Events, type Guild } from "discord.js";

import { captureForGuild } from "@/capture.js";
import { config } from "@/config.js";
import { getGuildConfig } from "@/configCache.js";

/**
 * Periodic server snapshot. Gateway events capture *flows* (joins, messages);
 * this captures *point-in-time totals* (members, online, channels, boosts) on a
 * schedule, so they're trendable in PostHog — the legit equivalent of Discord's
 * Server Insights overview, which is not exposed to bots.
 *
 * It's opt-in like any other event: a guild only gets snapshots if it's
 * configured AND has enabled the `server_snapshot` event via `/analytics events`.
 */
const SNAPSHOT_EVENT = "server_snapshot";

export async function snapshotGuild(guild: Guild): Promise<void> {
  const cfg = getGuildConfig(guild.id);
  // Pre-gate here (as well as inside captureForGuild) so we skip the REST fetch
  // for guilds that aren't configured / haven't enabled snapshots.
  if (!cfg?.posthogApiKey) return;
  if (!cfg.enabledEvents.includes(SNAPSHOT_EVENT)) return;

  // Fetch approximate counts (total members + online) — populated via
  // GET /guilds/{id}?with_counts=true, so no Presence intent is required.
  let memberCount = guild.memberCount;
  let onlineCount: number | null = null;
  try {
    const fetched = await guild.fetch();
    memberCount = fetched.approximateMemberCount ?? guild.memberCount;
    onlineCount = fetched.approximatePresenceCount ?? null;
  } catch (err) {
    console.error(`[snapshot] fetch failed for ${guild.id}:`, err);
  }

  captureForGuild({
    guildId: guild.id,
    event: SNAPSHOT_EVENT,
    // Server-level event — no acting user. Prefix avoids any conceptual clash
    // with real user distinct_ids.
    distinctId: `server-${guild.id}`,
    properties: {
      guild_id: guild.id,
      guild_name: guild.name,
      member_count: memberCount,
      online_count: onlineCount,
      channel_count: guild.channels.cache.size,
      role_count: guild.roles.cache.size,
      boost_count: guild.premiumSubscriptionCount ?? 0,
      premium_tier: guild.premiumTier,
      emoji_count: guild.emojis.cache.size,
      sticker_count: guild.stickers.cache.size,
    },
  });
}

async function snapshotAll(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    await snapshotGuild(guild);
  }
}

let timer: ReturnType<typeof setInterval> | undefined;

export function register(client: Client): void {
  client.once(Events.ClientReady, () => {
    const intervalMs = config.snapshotIntervalHours * 60 * 60 * 1000;
    // One snapshot on startup for an immediate data point, then on a schedule.
    void snapshotAll(client);
    timer = setInterval(() => void snapshotAll(client), intervalMs);
    // Don't let the timer keep the process alive on its own.
    timer.unref();
    console.log(
      `Server snapshots enabled (every ${config.snapshotIntervalHours}h).`
    );
  });
}

export function stopSnapshots(): void {
  if (timer) {
    clearInterval(timer);
    timer = undefined;
  }
}
