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
  /** Optional guild id used only for instant dev command registration. */
  devGuildId?: string;
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
  discordToken: required("DISCORD_TOKEN"),
  discordClientId: required("DISCORD_CLIENT_ID"),
  databasePath: process.env.DATABASE_PATH?.trim() || "./data/bot.sqlite",
  devGuildId: process.env.DEV_GUILD_ID?.trim() || undefined,
};
