import type { User } from "discord.js";

import { getGuildConfig } from "./configCache.js";
import type { GuildConfig } from "./db.js";
import { getPostHogClient } from "./posthogPool.js";

/** Shape of the bits of a Discord user we turn into PostHog person properties. */
interface PersonLike {
  id: string;
  username: string;
  globalName?: string | null;
  bot: boolean;
}

export interface CaptureArgs {
  guildId: string;
  /** Catalog event key, e.g. "message_sent". Gated against the guild's enabled set. */
  event: string;
  /** Discord user id — used as PostHog distinct_id. */
  distinctId: string;
  properties?: Record<string, unknown>;
  /** The acting user, used to set person properties and apply the bot filter. */
  actor?: PersonLike;
}

function toPersonLike(user: Pick<User, "id" | "username" | "globalName" | "bot">): PersonLike {
  return {
    id: user.id,
    username: user.username,
    globalName: user.globalName,
    bot: user.bot,
  };
}

/** Build `$set` person properties from a Discord user. */
function personSet(actor: PersonLike): Record<string, unknown> {
  return {
    $set: {
      discord_username: actor.username,
      discord_global_name: actor.globalName ?? null,
      discord_is_bot: actor.bot,
    },
  };
}

function shouldSample(config: GuildConfig, event: string): boolean {
  // Sampling currently applies only to high-volume message_sent events.
  if (event !== "message_sent") return true;
  const rate = config.messageSampleRate;
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  // Deterministic-enough sampling without Math.random (which is fine here, but
  // keeping it dependency-free): hash the distinct id is overkill — a simple
  // probabilistic check is acceptable for analytics down-sampling.
  return Math.random() < rate;
}

/**
 * Shared tail: actually send the event to the guild's PostHog project, attaching
 * person + group context. Callers are responsible for the gating they need.
 */
function sendToGuild(
  cfg: GuildConfig,
  args: CaptureArgs
): void {
  const client = getPostHogClient(cfg.posthogHost, cfg.posthogApiKey!);

  const properties: Record<string, unknown> = {
    ...args.properties,
    ...(args.actor ? personSet(args.actor) : {}),
  };

  client.capture({
    distinctId: args.distinctId,
    event: args.event,
    properties,
    groups: { discord_server: args.guildId },
  });
}

/**
 * The choke point for built-in catalog events. Applies the full gate
 * (configured? event enabled? bot filter? sampling?) and never throws —
 * analytics failures must not affect bot behaviour.
 */
export function captureForGuild(args: CaptureArgs): void {
  try {
    const cfg = getGuildConfig(args.guildId);

    // Gate 1: guild must have completed setup.
    if (!cfg || !cfg.posthogApiKey) return;
    // Gate 2: this event type must be enabled by an admin.
    if (!cfg.enabledEvents.includes(args.event)) return;
    // Gate 3: optional bot filter.
    if (cfg.ignoreBots && args.actor?.bot) return;
    // Gate 4: optional sampling.
    if (!shouldSample(cfg, args.event)) return;

    sendToGuild(cfg, args);
  } catch (err) {
    // Swallow — never let analytics break the bot. Log for operators.
    console.error(`[capture] failed for event ${args.event}:`, err);
  }
}

/**
 * Send a custom event fired by a user-defined trigger. Unlike
 * {@link captureForGuild}, this is NOT gated on the built-in event catalog or
 * sampling — a trigger fires whenever the guild is configured (and the bot
 * filter passes), regardless of which catalog events are enabled.
 */
export function captureCustomEvent(args: CaptureArgs): void {
  try {
    const cfg = getGuildConfig(args.guildId);
    if (!cfg || !cfg.posthogApiKey) return;
    if (cfg.ignoreBots && args.actor?.bot) return;
    sendToGuild(cfg, args);
  } catch (err) {
    console.error(`[capture] custom event ${args.event} failed:`, err);
  }
}

export { toPersonLike };
export type { PersonLike };
