import { listTriggers, type Trigger  } from "@/db.js";

/**
 * In-memory cache of each guild's triggers, so the hot per-event path (every
 * message, reaction, etc.) is a Map lookup rather than a SQLite read. Writers in
 * db.ts call {@link invalidateTriggersCache} on every change. We cache the empty
 * list too, so guilds with no triggers — the common case — don't hit the DB.
 */
const cache = new Map<string, Trigger[]>();

export function getGuildTriggers(guildId: string): Trigger[] {
  const cached = cache.get(guildId);
  if (cached) return cached;
  const fromDb = listTriggers(guildId);
  cache.set(guildId, fromDb);
  return fromDb;
}

export function invalidateTriggersCache(guildId: string): void {
  cache.delete(guildId);
}
