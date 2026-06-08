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

export const config: BotConfig = {
  discordToken: required("DISCORD_BOT_TOKEN"),
  discordClientId: required("DISCORD_APPLICATION_ID"),
  databasePath: process.env.DATABASE_PATH?.trim() || "./data/bot.sqlite",
  snapshotIntervalHours: positiveNumber("SNAPSHOT_INTERVAL_HOURS", 24),
};
