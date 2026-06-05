import { describe, expect, it } from "vitest";

import { getGuildConfig, invalidateConfigCache } from "./configCache.js";
import {
  addTrigger,
  clearConfig,
  countTriggers,
  DEFAULT_POSTHOG_HOST,
  getTrigger,
  listTriggers,
  MAX_TRIGGERS_PER_GUILD,
  readGuildConfig,
  removeTrigger,
  setEnabledEvents,
  setOptions,
  setTriggerEnabled,
  TriggerLimitError,
  upsertPosthog,
} from "./db.js";
import { getGuildTriggers } from "./triggersCache.js";

const NOW = 1_700_000_000_000;

// Each test uses a unique guild id so the shared in-memory DB stays isolated.
let counter = 0;
function guild(): string {
  counter += 1;
  return `guild-${counter}`;
}

describe("guild_config repo", () => {
  it("returns null for an unconfigured guild", () => {
    expect(readGuildConfig(guild())).toBeNull();
  });

  it("stores key/host and applies sensible defaults", () => {
    const g = guild();
    upsertPosthog(g, "phc_abc", DEFAULT_POSTHOG_HOST, NOW);
    const cfg = readGuildConfig(g);
    expect(cfg).toMatchObject({
      posthogApiKey: "phc_abc",
      posthogHost: DEFAULT_POSTHOG_HOST,
      enabledEvents: [],
      ignoreBots: true,
      messageSampleRate: 1,
    });
  });

  it("sanitizes enabled events on write", () => {
    const g = guild();
    setEnabledEvents(g, ["message_sent", "bogus", "member_joined"], NOW);
    expect(readGuildConfig(g)?.enabledEvents).toEqual([
      "message_sent",
      "member_joined",
    ]);
  });

  it("updates options", () => {
    const g = guild();
    setOptions(g, false, 0.25, NOW);
    expect(readGuildConfig(g)).toMatchObject({
      ignoreBots: false,
      messageSampleRate: 0.25,
    });
  });

  it("clears config", () => {
    const g = guild();
    upsertPosthog(g, "phc_x", DEFAULT_POSTHOG_HOST, NOW);
    clearConfig(g);
    expect(readGuildConfig(g)).toBeNull();
  });

  it("invalidates the config cache on write", () => {
    const g = guild();
    expect(getGuildConfig(g)).toBeNull(); // caches the miss
    upsertPosthog(g, "phc_cache", DEFAULT_POSTHOG_HOST, NOW);
    expect(getGuildConfig(g)?.posthogApiKey).toBe("phc_cache");
    clearConfig(g);
    expect(getGuildConfig(g)).toBeNull();
    invalidateConfigCache(g);
  });
});

describe("triggers repo", () => {
  it("adds, lists in id order, and round-trips conditions", () => {
    const g = guild();
    const id1 = addTrigger(
      g,
      {
        name: "Support",
        eventName: "support_request",
        source: "message",
        conditions: { content: { mode: "contains", terms: ["refund"] } },
      },
      NOW
    );
    const id2 = addTrigger(
      g,
      {
        name: "Tickets",
        eventName: "ticket_opened",
        source: "reaction",
        conditions: { emoji: { kind: "unicode", value: "🎫" } },
      },
      NOW
    );
    expect(typeof id1).toBe("number");
    expect(countTriggers(g)).toBe(2);
    expect(listTriggers(g).map((t) => t.id)).toEqual([id1, id2]);
    expect(getTrigger(g, id1)?.conditions).toEqual({
      content: { mode: "contains", terms: ["refund"] },
    });
  });

  it("enables/disables a trigger", () => {
    const g = guild();
    const id = addTrigger(
      g,
      { name: "x", eventName: "x", source: "message", conditions: {} },
      NOW
    );
    expect(setTriggerEnabled(g, id, false, NOW)).toBe(true);
    expect(getTrigger(g, id)?.enabled).toBe(false);
    expect(setTriggerEnabled(g, 999999, false, NOW)).toBe(false);
  });

  it("removes a trigger and is guild-scoped", () => {
    const gA = guild();
    const gB = guild();
    const id = addTrigger(
      gA,
      { name: "x", eventName: "x", source: "message", conditions: {} },
      NOW
    );
    // A different guild cannot remove it.
    expect(removeTrigger(gB, id)).toBe(false);
    expect(countTriggers(gA)).toBe(1);
    expect(removeTrigger(gA, id)).toBe(true);
    expect(countTriggers(gA)).toBe(0);
  });

  it("enforces the per-guild cap", () => {
    const g = guild();
    for (let i = 0; i < MAX_TRIGGERS_PER_GUILD; i++) {
      addTrigger(
        g,
        { name: `t${i}`, eventName: `e${i}`, source: "message", conditions: {} },
        NOW
      );
    }
    expect(countTriggers(g)).toBe(MAX_TRIGGERS_PER_GUILD);
    expect(() =>
      addTrigger(
        g,
        { name: "over", eventName: "over", source: "message", conditions: {} },
        NOW
      )
    ).toThrow(TriggerLimitError);
  });

  it("invalidates the triggers cache on write", () => {
    const g = guild();
    expect(getGuildTriggers(g)).toEqual([]); // caches the empty list
    addTrigger(
      g,
      { name: "x", eventName: "x", source: "message", conditions: {} },
      NOW
    );
    expect(getGuildTriggers(g)).toHaveLength(1);
  });
});
