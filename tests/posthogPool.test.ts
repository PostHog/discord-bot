import { afterEach, describe, expect, it, vi } from "vitest";

// Fake PostHog so no real client/network is created.
const instances: Array<{ key: string; host: string; shutdown: ReturnType<typeof vi.fn> }> = [];
vi.mock("posthog-node", () => ({
  PostHog: class {
    key: string;
    host: string;
    shutdown = vi.fn(async () => {});
    constructor(key: string, opts: { host: string }) {
      this.key = key;
      this.host = opts.host;
      instances.push(this);
    }
  },
}));

const { getPostHogClient, shutdownAll } = await import("../src/posthogPool.js");

afterEach(() => {
  instances.length = 0;
});

describe("posthogPool", () => {
  it("reuses a single client per host+key", () => {
    const a = getPostHogClient("https://us.i.posthog.com", "phc_dup");
    const b = getPostHogClient("https://us.i.posthog.com", "phc_dup");
    expect(a).toBe(b);
  });

  it("creates separate clients for different host or key", () => {
    const us = getPostHogClient("https://us.i.posthog.com", "phc_A");
    const eu = getPostHogClient("https://eu.i.posthog.com", "phc_A");
    const otherKey = getPostHogClient("https://us.i.posthog.com", "phc_B");
    expect(us).not.toBe(eu);
    expect(us).not.toBe(otherKey);
  });

  it("shutdownAll flushes every client and clears the pool", async () => {
    const client = getPostHogClient("https://us.i.posthog.com", "phc_shutdown");
    await shutdownAll();
    expect(client.shutdown).toHaveBeenCalledTimes(1);
    // Pool cleared → a fresh instance is constructed next time.
    const again = getPostHogClient("https://us.i.posthog.com", "phc_shutdown");
    expect(again).not.toBe(client);
  });
});
