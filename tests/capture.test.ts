import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GuildConfig } from "@/db.js";

const { captureSpy, getPostHogClient, getGuildConfig } = vi.hoisted(() => {
  const captureSpy = vi.fn();
  return {
    captureSpy,
    getPostHogClient: vi.fn(() => ({ capture: captureSpy })),
    getGuildConfig: vi.fn(),
  };
});

vi.mock("@/posthogPool.js", () => ({ getPostHogClient }));
vi.mock("@/configCache.js", () => ({ getGuildConfig }));

const { captureForGuild, captureCustomEvent } = await import("@/capture.js");

function config(partial: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: "g1",
    posthogApiKey: "phc_key",
    posthogHost: "https://us.i.posthog.com",
    enabledEvents: ["message_sent"],
    ignoreBots: true,
    messageSampleRate: 1,
    ...partial,
  };
}

const actor = { id: "u1", username: "alice", globalName: "Alice", bot: false };

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockReturnValue(config());
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("captureForGuild", () => {
  it("does nothing when the guild is unconfigured", () => {
    getGuildConfig.mockReturnValue(null);
    captureForGuild({ guildId: "g1", event: "message_sent", distinctId: "u1" });
    getGuildConfig.mockReturnValue(config({ posthogApiKey: null }));
    captureForGuild({ guildId: "g1", event: "message_sent", distinctId: "u1" });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("does nothing when the event is not enabled", () => {
    getGuildConfig.mockReturnValue(config({ enabledEvents: ["member_joined"] }));
    captureForGuild({ guildId: "g1", event: "message_sent", distinctId: "u1" });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("applies the bot filter", () => {
    captureForGuild({
      guildId: "g1",
      event: "message_sent",
      distinctId: "b1",
      actor: { ...actor, bot: true },
    });
    expect(captureSpy).not.toHaveBeenCalled();

    getGuildConfig.mockReturnValue(config({ ignoreBots: false }));
    captureForGuild({
      guildId: "g1",
      event: "message_sent",
      distinctId: "b1",
      actor: { ...actor, bot: true },
    });
    expect(captureSpy).toHaveBeenCalledTimes(1);
  });

  it("drops message_sent below the sample rate", () => {
    getGuildConfig.mockReturnValue(config({ messageSampleRate: 0 }));
    captureForGuild({ guildId: "g1", event: "message_sent", distinctId: "u1" });
    expect(captureSpy).not.toHaveBeenCalled();

    getGuildConfig.mockReturnValue(config({ messageSampleRate: 0.5 }));
    vi.spyOn(Math, "random").mockReturnValue(0.9); // above 0.5 -> drop
    captureForGuild({ guildId: "g1", event: "message_sent", distinctId: "u1" });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("captures with person + group context on the happy path", () => {
    captureForGuild({
      guildId: "g1",
      event: "message_sent",
      distinctId: "u1",
      properties: { channel_id: "c1" },
      actor,
    });
    expect(getPostHogClient).toHaveBeenCalledWith(
      "https://us.i.posthog.com",
      "phc_key"
    );
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy.mock.calls[0][0]).toMatchObject({
      distinctId: "u1",
      event: "message_sent",
      groups: { discord_server: "g1" },
      properties: {
        channel_id: "c1",
        $set: {
          discord_username: "alice",
          discord_global_name: "Alice",
          discord_is_bot: false,
        },
      },
    });
  });

  it("never throws even if the client errors", () => {
    captureSpy.mockImplementationOnce(() => {
      throw new Error("network down");
    });
    expect(() =>
      captureForGuild({ guildId: "g1", event: "message_sent", distinctId: "u1" })
    ).not.toThrow();
  });
});

describe("captureCustomEvent", () => {
  it("fires even when the event is NOT in the enabled catalog", () => {
    getGuildConfig.mockReturnValue(config({ enabledEvents: [] }));
    captureCustomEvent({ guildId: "g1", event: "refund_request", distinctId: "u1" });
    expect(captureSpy).toHaveBeenCalledTimes(1);
    expect(captureSpy.mock.calls[0][0]).toMatchObject({
      event: "refund_request",
      groups: { discord_server: "g1" },
    });
  });

  it("still requires the guild to be configured", () => {
    getGuildConfig.mockReturnValue(null);
    captureCustomEvent({ guildId: "g1", event: "refund_request", distinctId: "u1" });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("applies the bot filter", () => {
    captureCustomEvent({
      guildId: "g1",
      event: "refund_request",
      distinctId: "b1",
      actor: { ...actor, bot: true },
    });
    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("is not subject to sampling", () => {
    getGuildConfig.mockReturnValue(config({ enabledEvents: [], messageSampleRate: 0 }));
    captureCustomEvent({ guildId: "g1", event: "message_sent", distinctId: "u1" });
    expect(captureSpy).toHaveBeenCalledTimes(1);
  });
});
