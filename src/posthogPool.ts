import { PostHog } from "posthog-node";

/**
 * Pool of PostHog clients keyed by `${host}::${apiKey}`. Each guild routes to its
 * own PostHog project, but many guilds may share a host (e.g. us.i.posthog.com)
 * and some may even share a key, so we cache one client per distinct destination
 * rather than constructing one per event or per guild.
 *
 * posthog-node batches internally (flushAt: 20, flushInterval: 10s), which suits
 * a high-volume multi-tenant bot well — we keep those defaults.
 */
const clients = new Map<string, PostHog>();

function poolKey(host: string, apiKey: string): string {
  return `${host}::${apiKey}`;
}

export function getPostHogClient(host: string, apiKey: string): PostHog {
  const key = poolKey(host, apiKey);
  let client = clients.get(key);
  if (!client) {
    client = new PostHog(apiKey, { host });
    clients.set(key, client);
  }
  return client;
}

/** Flush and close every pooled client. Call on graceful shutdown. */
export async function shutdownAll(): Promise<void> {
  const all = [...clients.values()];
  clients.clear();
  await Promise.allSettled(all.map((c) => c.shutdown()));
}
