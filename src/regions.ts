import { DEFAULT_POSTHOG_HOST } from "@/db.js";

/**
 * Region → PostHog Cloud capture host. These are the ONLY destinations the bot
 * will ever send analytics to — the host is always derived from a known region,
 * never accepted as free text, which removes the SSRF surface entirely.
 */
export const REGION_HOSTS: Record<string, string> = {
  us: DEFAULT_POSTHOG_HOST,
  eu: "https://eu.i.posthog.com",
};

/** Map a region string (us/eu, case-insensitive) to its capture host. */
export function hostForRegion(region: string | undefined): string {
  return REGION_HOSTS[(region ?? "us").toLowerCase()] ?? DEFAULT_POSTHOG_HOST;
}
