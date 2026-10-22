import "dotenv/config";

/**
 * Bot-level configuration loaded from the environment. This is intentionally
 * minimal — PostHog credentials are NOT here, because they are configured
 * per-guild at runtime via the `/ph connect` flow and stored in
 * SQLite. See {@link file://./db.ts}.
 */
/**
 * Roadmap-idea submission. Unlike every other capture in the bot, this reports
 * to ONE fixed PostHog project: the survey behind posthog.com/roadmap lives
 * there, not in whichever project a guild bound with `/ph connect`.
 */
export interface RoadmapIdeaConfig {
  /** Capture host for the fixed project, e.g. https://us.i.posthog.com. */
  host: string;
  /** Public project key (`phc_…`) for the project holding the survey. */
  projectApiKey: string;
  surveyId: string;
  /** Question ids of the survey's two questions, in `$survey_response_<id>`. */
  ideaQuestionId: string;
  emailQuestionId: string;
  /**
   * Guilds the feature is offered in. The message action is only registered in
   * these, and submissions from anywhere else are refused. Empty means every
   * guild — don't do that on a public install, since it lets any server write
   * into PostHog's own roadmap survey.
   */
  guildIds: string[];
}

export interface BotConfig {
  discordToken: string;
  discordClientId: string;
  databasePath: string;
  /** How often to emit the server_snapshot event, in hours (default 1). */
  snapshotIntervalHours: number;
  /** How often to emit the member_roster event set, in hours (default 24). */
  rosterIntervalHours: number;
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
  /** Roadmap-idea submission. Undefined switches the whole feature off. */
  roadmapIdea?: RoadmapIdeaConfig;
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

/** Parse a comma-separated env var into trimmed, non-empty entries. */
function csv(name: string): string[] {
  return (process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * Read the roadmap-idea block. Keyed off the survey id: with it unset the
 * feature is simply off, so a deployment that doesn't want it needs no other
 * variables. With it set, the rest are required rather than defaulted — a
 * half-configured submission would silently land on the wrong survey question.
 */
function roadmapIdeaConfig(): RoadmapIdeaConfig | undefined {
  const surveyId = process.env.ROADMAP_SURVEY_ID?.trim();
  if (!surveyId) return undefined;
  return {
    host:
      process.env.ROADMAP_POSTHOG_HOST?.trim().replace(/\/+$/, "") ||
      "https://us.i.posthog.com",
    projectApiKey: required("ROADMAP_POSTHOG_PROJECT_API_KEY"),
    surveyId,
    ideaQuestionId: required("ROADMAP_SURVEY_IDEA_QUESTION_ID"),
    emailQuestionId: required("ROADMAP_SURVEY_EMAIL_QUESTION_ID"),
    guildIds: csv("ROADMAP_GUILD_IDS"),
  };
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
  // Hourly, because the presence count is only interesting as a shape over the
  // day: sampled once every 24h it lands on the same hour every time, which
  // describes one moment rather than when the server is actually busy. The cost is
  // one REST call and one event per server per hour.
  snapshotIntervalHours: positiveNumber("SNAPSHOT_INTERVAL_HOURS", 1),
  rosterIntervalHours: positiveNumber("ROSTER_INTERVAL_HOURS", 24),
  sharedSecret: required("POSTHOG_DISCORD_SHARED_SECRET"),
  actionsBind: requiredBind("BOT_ACTIONS_BIND"),
  bridgeBaseUrl: process.env.POSTHOG_BRIDGE_BASE_URL?.trim().replace(/\/+$/, "") || undefined,
  roadmapIdea: roadmapIdeaConfig(),
};
