import "dotenv/config";

/**
 * Bot-level configuration loaded from the environment. This is intentionally
 * minimal — PostHog credentials are NOT here, because they are configured
 * per-guild at runtime via the `/analytics setup` slash command and stored in
 * SQLite. See {@link file://./db.ts}.
 */
export interface BotConfig {
  discordToken: string;
  discordClientId: string;
  databasePath: string;
  /** How often to emit the server_snapshot event, in hours (default 24). */
  snapshotIntervalHours: number;
  /**
   * Shared secret for the PostHog Code bridge, used as a bearer token in BOTH
   * directions: the bot sends it when forwarding interactions to PostHog, and
   * requires it on inbound calls to the actions API. See `src/bridge/`.
   */
  sharedSecret: string;
  /** host:port the bot's inbound actions API binds to (PostHog → bot). */
  actionsBind: { host: string; port: number };
  /**
   * Dev-only override for the PostHog app host the bridge forwards to. When set,
   * it replaces the per-guild region derivation (us/eu cloud) entirely — point
   * it at a local PostHog, e.g. http://127.0.0.1:8000. Unset in production.
   */
  bridgeBaseUrl?: string;
}

function positiveNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Copy .env.example to .env and fill it in.`
    );
  }
  return value.trim();
}

/** Parse a required `host:port` env var (e.g. `0.0.0.0:8080`). */
function requiredBind(name: string): { host: string; port: number } {
  const raw = required(name);
  const idx = raw.lastIndexOf(":");
  if (idx === -1) {
    throw new Error(`${name} must be in host:port form, e.g. 0.0.0.0:8080 (got "${raw}").`);
  }
  const host = raw.slice(0, idx) || "0.0.0.0";
  const port = Number(raw.slice(idx + 1));
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} has an invalid port: "${raw}".`);
  }
  return { host, port };
}

export const config: BotConfig = {
  discordToken: required("DISCORD_BOT_TOKEN"),
  discordClientId: required("DISCORD_APPLICATION_ID"),
  databasePath: process.env.DATABASE_PATH?.trim() || "./data/bot.sqlite",
  snapshotIntervalHours: positiveNumber("SNAPSHOT_INTERVAL_HOURS", 24),
  sharedSecret: required("POSTHOG_DISCORD_SHARED_SECRET"),
  actionsBind: requiredBind("BOT_ACTIONS_BIND"),
  bridgeBaseUrl: process.env.POSTHOG_BRIDGE_BASE_URL?.trim().replace(/\/+$/, "") || undefined,
};
