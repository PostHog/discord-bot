import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureForGuild, getGuildConfig } = vi.hoisted(() => ({
  captureForGuild: vi.fn(),
  getGuildConfig: vi.fn(),
}));

vi.mock("@/capture.js", () => ({ captureForGuild }));
vi.mock("@/configCache.js", () => ({ getGuildConfig }));

const { snapshotGuild } = await import("@/snapshots.js");

function guild(over: Record<string, unknown> = {}) {
  return {
    id: "g1",
    name: "G",
    memberCount: 100,
    channels: { cache: { size: 10 } },
    roles: { cache: { size: 5 } },
    emojis: { cache: { size: 3 } },
    stickers: { cache: { size: 1 } },
    premiumSubscriptionCount: 7,
    premiumTier: 2,
    fetch: vi.fn(async () => ({
      approximateMemberCount: 123,
      approximatePresenceCount: 45,
    })),
    ...over,
  };
}

const enabled = { posthogApiKey: "phc_x", enabledEvents: ["server_snapshot"] };

beforeEach(() => vi.clearAllMocks());

describe("snapshotGuild", () => {
  it("does nothing (no API call) when the guild is unconfigured", async () => {
    getGuildConfig.mockReturnValue(null);
    const g = guild();
    await snapshotGuild(g as never);
    expect(g.fetch).not.toHaveBeenCalled();
    expect(captureForGuild).not.toHaveBeenCalled();
  });

  it("does nothing when server_snapshot is not enabled", async () => {
    getGuildConfig.mockReturnValue({ posthogApiKey: "phc_x", enabledEvents: ["message_sent"] });
    const g = guild();
    await snapshotGuild(g as never);
    expect(g.fetch).not.toHaveBeenCalled();
    expect(captureForGuild).not.toHaveBeenCalled();
  });

  it("captures server_snapshot with approximate counts and guild totals", async () => {
    getGuildConfig.mockReturnValue(enabled);
    await snapshotGuild(guild() as never);
    expect(captureForGuild.mock.calls[0][0]).toMatchObject({
      event: "server_snapshot",
      distinctId: "server-g1",
      properties: {
        member_count: 123,
        online_count: 45,
        channel_count: 10,
        role_count: 5,
        boost_count: 7,
        premium_tier: 2,
        emoji_count: 3,
        sticker_count: 1,
      },
    });
  });

  it("falls back to cached member count and null online if fetch fails", async () => {
    getGuildConfig.mockReturnValue(enabled);
    const g = guild({ fetch: vi.fn(async () => { throw new Error("rate limited"); }) });
    await snapshotGuild(g as never);
    expect(captureForGuild.mock.calls[0][0].properties).toMatchObject({
      member_count: 100,
      online_count: null,
    });
  });
});
