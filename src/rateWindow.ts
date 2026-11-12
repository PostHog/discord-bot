/**
 * Per-trigger sliding windows for rate (burst) triggers. See docs/rate-triggers.md.
 *
 * NOTE: this state is in memory only. A restart resets every window and
 * cooldown. That's acceptable: a raid that spans a restart either fires again
 * (its cooldown was lost) or needs N fresh messages to fire.
 *
 * Memory is bounded: each trigger keeps at most `rate.count` hits (≤ 500), and a
 * guild has at most 50 triggers.
 */

export interface RateConfig {
  count: number;
  windowMinutes: number;
  cooldownMinutes: number;
}

export interface RateHit {
  ts: number;
  authorId: string;
  channelId: string;
  messageId: string;
}

interface WindowState {
  hits: RateHit[];
  cooldownUntil: number;
}

/** Max author ids we put on the event, so a big raid doesn't bloat it. */
export const MAX_SAMPLE_AUTHORS = 10;

export const DEFAULT_COOLDOWN_MINUTES = 30;

const MINUTE_MS = 60_000;

const windows = new Map<string, WindowState>();

const key = (guildId: string, triggerId: number) => `${guildId}:${triggerId}`;

/**
 * Record one matching message. Returns the burst's event properties when this
 * message reaches the threshold, otherwise null. After firing, the window is
 * cleared and the trigger ignores messages until the cooldown ends, so one raid
 * fires once.
 */
export function recordRateHit(
  guildId: string,
  triggerId: number,
  rate: RateConfig,
  hit: RateHit
): Record<string, unknown> | null {
  const k = key(guildId, triggerId);
  let state = windows.get(k);
  if (!state) {
    state = { hits: [], cooldownUntil: 0 };
    windows.set(k, state);
  }

  // In cooldown: this raid already fired. Don't count, so the next alert needs
  // a fresh burst of N messages after the cooldown ends.
  if (hit.ts < state.cooldownUntil) return null;

  const windowStart = hit.ts - rate.windowMinutes * MINUTE_MS;
  state.hits = state.hits.filter((h) => h.ts > windowStart);
  state.hits.push(hit);
  // Only the newest `count` hits can matter for the threshold.
  if (state.hits.length > rate.count) {
    state.hits = state.hits.slice(state.hits.length - rate.count);
  }

  if (state.hits.length < rate.count) return null;

  const burst = summarizeBurst(state.hits, rate);
  state.hits = [];
  state.cooldownUntil = hit.ts + rate.cooldownMinutes * MINUTE_MS;
  return burst;
}

function summarizeBurst(hits: RateHit[], rate: RateConfig): Record<string, unknown> {
  const first = hits[0];
  const last = hits[hits.length - 1];
  const authors = [...new Set(hits.map((h) => h.authorId))];
  return {
    rate_count: hits.length,
    rate_threshold: rate.count,
    rate_window_minutes: rate.windowMinutes,
    cooldown_minutes: rate.cooldownMinutes,
    burst_duration_seconds: Math.round((last.ts - first.ts) / 1000),
    unique_author_count: authors.length,
    sample_author_ids: authors.slice(0, MAX_SAMPLE_AUTHORS),
    channel_ids: [...new Set(hits.map((h) => h.channelId))],
    first_message_id: first.messageId,
    last_message_id: last.messageId,
    first_message_at: new Date(first.ts).toISOString(),
  };
}

/** Drop all windows for a guild. Called whenever its triggers change. */
export function resetRateState(guildId: string): void {
  const prefix = `${guildId}:`;
  for (const k of windows.keys()) {
    if (k.startsWith(prefix)) windows.delete(k);
  }
}

/** Test helper. */
export function _resetAllRateState(): void {
  windows.clear();
}
