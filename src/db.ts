import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { config } from "./config.js";
import { invalidateConfigCache } from "./configCache.js";
import { sanitizeEventKeys } from "./events-catalog.js";

/**
 * Per-guild configuration as stored in SQLite. `posthogApiKey === null` means
 * the guild has not run `/analytics setup` yet, so the bot stays silent for it.
 */
export interface GuildConfig {
  guildId: string;
  posthogApiKey: string | null;
  posthogHost: string;
  enabledEvents: string[];
  ignoreBots: boolean;
  messageSampleRate: number;
}

export const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

interface GuildConfigRow {
  guild_id: string;
  posthog_api_key: string | null;
  posthog_host: string;
  enabled_events: string;
  ignore_bots: number;
  message_sample_rate: number;
}

// Ensure the directory for the SQLite file exists before opening it.
mkdirSync(dirname(config.databasePath), { recursive: true });

const db = new Database(config.databasePath);
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS guild_config (
    guild_id            TEXT PRIMARY KEY,
    posthog_api_key     TEXT,
    posthog_host        TEXT    NOT NULL DEFAULT '${DEFAULT_POSTHOG_HOST}',
    enabled_events      TEXT    NOT NULL DEFAULT '[]',
    ignore_bots         INTEGER NOT NULL DEFAULT 1,
    message_sample_rate REAL    NOT NULL DEFAULT 1.0,
    created_at          INTEGER NOT NULL,
    updated_at          INTEGER NOT NULL
  );
`);

function rowToConfig(row: GuildConfigRow): GuildConfig {
  let enabledEvents: string[] = [];
  try {
    const parsed = JSON.parse(row.enabled_events);
    if (Array.isArray(parsed)) {
      enabledEvents = sanitizeEventKeys(parsed.map(String));
    }
  } catch {
    // Corrupt JSON — treat as no events enabled rather than crashing.
    enabledEvents = [];
  }
  return {
    guildId: row.guild_id,
    posthogApiKey: row.posthog_api_key,
    posthogHost: row.posthog_host,
    enabledEvents,
    ignoreBots: row.ignore_bots !== 0,
    messageSampleRate: row.message_sample_rate,
  };
}

const selectStmt = db.prepare<[string]>(
  "SELECT * FROM guild_config WHERE guild_id = ?"
);

/** Read a guild's config straight from SQLite (no cache). Returns null if absent. */
export function readGuildConfig(guildId: string): GuildConfig | null {
  const row = selectStmt.get(guildId) as GuildConfigRow | undefined;
  return row ? rowToConfig(row) : null;
}

/**
 * Insert the guild row if missing, returning the (possibly freshly created)
 * config. Used by writers so they can UPDATE individual columns afterwards.
 */
const ensureStmt = db.prepare<[string, number, number]>(`
  INSERT INTO guild_config (guild_id, created_at, updated_at)
  VALUES (?, ?, ?)
  ON CONFLICT(guild_id) DO NOTHING
`);

function ensureRow(guildId: string, now: number): void {
  ensureStmt.run(guildId, now, now);
}

const setPosthogStmt = db.prepare<[string, string, number, string]>(`
  UPDATE guild_config
  SET posthog_api_key = ?, posthog_host = ?, updated_at = ?
  WHERE guild_id = ?
`);

export function upsertPosthog(
  guildId: string,
  apiKey: string,
  host: string,
  now: number
): void {
  ensureRow(guildId, now);
  setPosthogStmt.run(apiKey, host, now, guildId);
  invalidateConfigCache(guildId);
}

const setEventsStmt = db.prepare<[string, number, string]>(`
  UPDATE guild_config
  SET enabled_events = ?, updated_at = ?
  WHERE guild_id = ?
`);

export function setEnabledEvents(
  guildId: string,
  events: string[],
  now: number
): void {
  ensureRow(guildId, now);
  setEventsStmt.run(JSON.stringify(sanitizeEventKeys(events)), now, guildId);
  invalidateConfigCache(guildId);
}

const setOptionsStmt = db.prepare<[number, number, number, string]>(`
  UPDATE guild_config
  SET ignore_bots = ?, message_sample_rate = ?, updated_at = ?
  WHERE guild_id = ?
`);

export function setOptions(
  guildId: string,
  ignoreBots: boolean,
  messageSampleRate: number,
  now: number
): void {
  ensureRow(guildId, now);
  setOptionsStmt.run(
    ignoreBots ? 1 : 0,
    messageSampleRate,
    now,
    guildId
  );
  invalidateConfigCache(guildId);
}

const deleteStmt = db.prepare<[string]>(
  "DELETE FROM guild_config WHERE guild_id = ?"
);

/** Remove all config for a guild — the bot goes silent for it again. */
export function clearConfig(guildId: string): void {
  deleteStmt.run(guildId);
  invalidateConfigCache(guildId);
}

export function closeDb(): void {
  db.close();
}
