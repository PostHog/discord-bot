import { timingSafeEqual } from "node:crypto";

import { config } from "@/config.js";

/**
 * Static-bearer auth for the PostHog Code bridge. The same shared secret guards
 * both directions; integrity/confidentiality rely on TLS in front of both ends.
 * A bearer (not HMAC) was chosen deliberately — see the plan/A6.
 */

/** Header value the bot sends when calling PostHog. */
export function bearerHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${config.sharedSecret}` };
}

/**
 * Verify an inbound `Authorization` header against the shared secret in
 * constant time. Returns false for a missing/malformed header or a mismatch.
 */
export function verifyBearer(header: string | undefined): boolean {
  if (!header) return false;
  const match = /^Bearer (.+)$/.exec(header);
  if (!match) return false;

  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(config.sharedSecret);
  // timingSafeEqual throws on length mismatch, so guard first. The length check
  // itself leaks only the length, not the contents.
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
