import { nowMs } from "@/time.js";

/**
 * In-memory dedupe for Discord interaction ids. Discord may redeliver an
 * interaction (e.g. on gateway resume), and forwarding the same one twice would
 * double-trigger PostHog. We remember ids for a window comfortably longer than
 * any redelivery would occur, then forget them so memory stays bounded.
 */
const TTL_MS = 15 * 60 * 1000;

const seen = new Map<string, number>();

/**
 * Record an interaction id. Returns true if it's new (caller should proceed),
 * false if it was already seen within the TTL (caller should skip).
 */
export function markSeen(interactionId: string): boolean {
  const now = nowMs();
  prune(now);
  if (seen.has(interactionId)) return false;
  seen.set(interactionId, now);
  return true;
}

function prune(now: number): void {
  for (const [id, ts] of seen) {
    if (now - ts > TTL_MS) seen.delete(id);
  }
}

/** Test helper — clears the dedupe state. */
export function _resetDedupe(): void {
  seen.clear();
}
