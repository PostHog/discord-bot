import { beforeEach, describe, expect, it, vi } from "vitest";

const { nowMs } = vi.hoisted(() => ({ nowMs: vi.fn(() => 1000) }));
vi.mock("@/time.js", () => ({ nowMs }));

const { markSeen, _resetDedupe } = await import("@/bridge/dedupe.js");

beforeEach(() => {
  _resetDedupe();
  nowMs.mockReturnValue(1000);
});

describe("markSeen", () => {
  it("passes new ids and blocks repeats within the window", () => {
    expect(markSeen("a")).toBe(true);
    expect(markSeen("a")).toBe(false);
    expect(markSeen("b")).toBe(true);
  });

  it("forgets ids after the TTL", () => {
    expect(markSeen("a")).toBe(true);
    nowMs.mockReturnValue(1000 + 16 * 60 * 1000);
    expect(markSeen("a")).toBe(true);
  });
});
