import { describe, expect, it } from "vitest";

import {
  EVENT_CATALOG,
  EVENT_KEYS,
  getCatalogEntry,
  isValidEventKey,
  sanitizeEventKeys,
} from "../src/events-catalog.js";

describe("events-catalog", () => {
  it("exposes a key for every catalog entry", () => {
    expect(EVENT_KEYS).toEqual(EVENT_CATALOG.map((e) => e.key));
  });

  it("includes the expected built-in events", () => {
    for (const key of [
      "message_sent",
      "member_joined",
      "reaction_added",
      "voice_channel_joined",
      "thread_created",
      "server_snapshot",
    ]) {
      expect(EVENT_KEYS).toContain(key);
    }
  });

  it("has unique keys and well-formed entries", () => {
    const seen = new Set<string>();
    const categories = new Set([
      "messages",
      "members",
      "reactions",
      "voice",
      "threads",
      "server",
    ]);
    for (const entry of EVENT_CATALOG) {
      expect(seen.has(entry.key), `duplicate key ${entry.key}`).toBe(false);
      seen.add(entry.key);
      expect(entry.label.length).toBeGreaterThan(0);
      expect(entry.description.length).toBeGreaterThan(0);
      expect(categories.has(entry.category)).toBe(true);
    }
  });

  describe("isValidEventKey", () => {
    it("accepts known keys and rejects unknown", () => {
      expect(isValidEventKey("message_sent")).toBe(true);
      expect(isValidEventKey("server_snapshot")).toBe(true);
      expect(isValidEventKey("nope")).toBe(false);
      expect(isValidEventKey("")).toBe(false);
    });
  });

  describe("sanitizeEventKeys", () => {
    it("drops unknown keys and keeps known ones in order", () => {
      expect(
        sanitizeEventKeys(["message_sent", "bogus", "member_joined"])
      ).toEqual(["message_sent", "member_joined"]);
    });

    it("returns an empty array when nothing is valid", () => {
      expect(sanitizeEventKeys(["a", "b"])).toEqual([]);
      expect(sanitizeEventKeys([])).toEqual([]);
    });
  });

  describe("getCatalogEntry", () => {
    it("returns the entry or undefined", () => {
      expect(getCatalogEntry("message_sent")?.category).toBe("messages");
      expect(getCatalogEntry("server_snapshot")?.category).toBe("server");
      expect(getCatalogEntry("missing")).toBeUndefined();
    });
  });
});
