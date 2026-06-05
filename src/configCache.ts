import { readGuildConfig, type GuildConfig } from "@/db.js";

/**
 * In-memory cache of per-guild config so the hot per-event path (which can fire
 * many times per second on a busy server) is a cheap Map lookup instead of a
 * SQLite read. Writers in db.ts call {@link invalidateConfigCache} on every
 * change, so the cache never goes stale.
 *
 * We cache the "absent" result too (as `null`) so unconfigured guilds — which
 * are the common case for a public bot — don't hit the DB on every message.
 */
const cache = new Map<string, GuildConfig | null>();

export function getGuildConfig(guildId: string): GuildConfig | null {
  if (cache.has(guildId)) {
    return cache.get(guildId) ?? null;
  }
  const fromDb = readGuildConfig(guildId);
  cache.set(guildId, fromDb);
  return fromDb;
}

export function invalidateConfigCache(guildId: string): void {
  cache.delete(guildId);
}
