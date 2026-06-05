import { Events } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getGuildConfig, getPostHogClient, groupIdentify } = vi.hoisted(() => {
  const groupIdentify = vi.fn();
  return {
    groupIdentify,
    getGuildConfig: vi.fn(),
    getPostHogClient: vi.fn(() => ({ groupIdentify })),
  };
});

vi.mock("@/configCache.js", () => ({ getGuildConfig }));
vi.mock("@/posthogPool.js", () => ({ getPostHogClient }));

const { register } = await import("@/events/ready.js");

function readyClient(guilds: Array<{ id: string; name: string; memberCount: number }>) {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  register({ once: (e: string, cb: never) => handlers.set(e, cb) } as never);
  const ready = {
    user: { tag: "bot#0001" },
    guilds: { cache: new Map(guilds.map((g) => [g.id, g])) },
  };
  return () => handlers.get(Events.ClientReady)?.(ready);
}

beforeEach(() => vi.clearAllMocks());

describe("ClientReady", () => {
  it("groupIdentifies configured guilds with name + member count", () => {
    getGuildConfig.mockReturnValue({
      posthogApiKey: "phc_x",
      posthogHost: "https://us.i.posthog.com",
    });
    readyClient([{ id: "g1", name: "G", memberCount: 7 }])();
    expect(getPostHogClient).toHaveBeenCalledWith("https://us.i.posthog.com", "phc_x");
    expect(groupIdentify).toHaveBeenCalledWith({
      groupType: "discord_server",
      groupKey: "g1",
      properties: { name: "G", member_count: 7 },
    });
  });

  it("skips unconfigured guilds", () => {
    getGuildConfig.mockReturnValue(null);
    readyClient([{ id: "g1", name: "G", memberCount: 7 }])();
    expect(groupIdentify).not.toHaveBeenCalled();
  });
});
