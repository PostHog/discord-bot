import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { config } from "./config.js";
import { invalidateConfigCache } from "./configCache.js";
import { invalidateTriggersCache } from "./triggersCache.js";
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

/** Max triggers per guild — bounds the per-event hot-path work. */
export const MAX_TRIGGERS_PER_GUILD = 50;

/** Which Discord signal a trigger listens on. */
export type TriggerSource =
  | "message"
  | "file"
  | "reaction"
  | "member_join"
  | "voice_join";

/**
 * Conditions for a trigger. All present fields must match (AND). An empty object
 * means "every signal of this source matches".
 */
export interface TriggerConditions {
  /** Restrict to these channel ids (incl. the voice channel for voice_join). */
  channelIds?: string[];
  /** Message/file text match (case-insensitive). */
  content?: { mode: "contains" | "keywords" | "starts_with"; terms: string[] };
  /** File source: match any of these lowercased extensions, e.g. ["pdf","png"]. */
  fileExtensions?: string[];
  /** Reaction source: the emoji to match. */
  emoji?:
    | { kind: "unicode"; value: string }
    | { kind: "custom"; id: string; name: string };
}

export interface Trigger {
  id: number;
  guildId: string;
  name: string;
  /** PostHog event name emitted when this trigger matches. */
  eventName: string;
  source: TriggerSource;
  conditions: TriggerConditions;
  enabled: boolean;
}

/** Thrown by {@link addTrigger} when a guild is at {@link MAX_TRIGGERS_PER_GUILD}. */
export class TriggerLimitError extends Error {
  constructor() {
    super(`A server can have at most ${MAX_TRIGGERS_PER_GUILD} triggers.`);
    this.name = "TriggerLimitError";
  }
}

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

  CREATE TABLE IF NOT EXISTS triggers (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id    TEXT    NOT NULL,
    name        TEXT    NOT NULL,
    event_name  TEXT    NOT NULL,
    source      TEXT    NOT NULL,
    conditions  TEXT    NOT NULL DEFAULT '{}',
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_triggers_guild ON triggers(guild_id);
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

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

interface TriggerRow {
  id: number;
  guild_id: string;
  name: string;
  event_name: string;
  source: string;
  conditions: string;
  enabled: number;
}

function rowToTrigger(row: TriggerRow): Trigger {
  let conditions: TriggerConditions = {};
  try {
    const parsed = JSON.parse(row.conditions);
    if (parsed && typeof parsed === "object") conditions = parsed;
  } catch {
    conditions = {};
  }
  return {
    id: row.id,
    guildId: row.guild_id,
    name: row.name,
    eventName: row.event_name,
    source: row.source as TriggerSource,
    conditions,
    enabled: row.enabled !== 0,
  };
}

const countTriggersStmt = db.prepare<[string]>(
  "SELECT COUNT(*) AS n FROM triggers WHERE guild_id = ?"
);
const listTriggersStmt = db.prepare<[string]>(
  "SELECT * FROM triggers WHERE guild_id = ? ORDER BY id"
);
const getTriggerStmt = db.prepare<[string, number]>(
  "SELECT * FROM triggers WHERE guild_id = ? AND id = ?"
);
const insertTriggerStmt = db.prepare<
  [string, string, string, string, string, number, number]
>(`
  INSERT INTO triggers (guild_id, name, event_name, source, conditions, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const deleteTriggerStmt = db.prepare<[string, number]>(
  "DELETE FROM triggers WHERE guild_id = ? AND id = ?"
);
const setTriggerEnabledStmt = db.prepare<[number, number, string, number]>(`
  UPDATE triggers SET enabled = ?, updated_at = ? WHERE guild_id = ? AND id = ?
`);

export function countTriggers(guildId: string): number {
  const row = countTriggersStmt.get(guildId) as { n: number };
  return row.n;
}

export function listTriggers(guildId: string): Trigger[] {
  const rows = listTriggersStmt.all(guildId) as TriggerRow[];
  return rows.map(rowToTrigger);
}

export function getTrigger(guildId: string, id: number): Trigger | null {
  const row = getTriggerStmt.get(guildId, id) as TriggerRow | undefined;
  return row ? rowToTrigger(row) : null;
}

/** Insert a trigger; returns its new id. Throws {@link TriggerLimitError} at the cap. */
export function addTrigger(
  guildId: string,
  trigger: {
    name: string;
    eventName: string;
    source: TriggerSource;
    conditions: TriggerConditions;
  },
  now: number
): number {
  if (countTriggers(guildId) >= MAX_TRIGGERS_PER_GUILD) {
    throw new TriggerLimitError();
  }
  const result = insertTriggerStmt.run(
    guildId,
    trigger.name,
    trigger.eventName,
    trigger.source,
    JSON.stringify(trigger.conditions),
    now,
    now
  );
  invalidateTriggersCache(guildId);
  return Number(result.lastInsertRowid);
}

/** Remove a trigger by id. Returns true if a row was deleted. */
export function removeTrigger(guildId: string, id: number): boolean {
  const result = deleteTriggerStmt.run(guildId, id);
  invalidateTriggersCache(guildId);
  return result.changes > 0;
}

/** Enable/disable a trigger by id. Returns true if a row was updated. */
export function setTriggerEnabled(
  guildId: string,
  id: number,
  enabled: boolean,
  now: number
): boolean {
  const result = setTriggerEnabledStmt.run(enabled ? 1 : 0, now, guildId, id);
  invalidateTriggersCache(guildId);
  return result.changes > 0;
}

export function closeDb(): void {
  db.close();
}
