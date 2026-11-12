import { beforeEach, describe, expect, it } from "vitest";

import {
  _resetAllRateState,
  MAX_SAMPLE_AUTHORS,
  recordRateHit,
  resetRateState,
  type RateConfig,
} from "@/rateWindow.js";

const MIN = 60_000;
const T0 = Date.UTC(2026, 10, 12, 12, 0, 0);
const rate: RateConfig = { count: 3, windowMinutes: 5, cooldownMinutes: 30 };

let n = 0;
function hit(ts: number, authorId = `u${n}`, channelId = "c1") {
  n += 1;
  return { ts, authorId, channelId, messageId: `m${n}` };
}

beforeEach(() => {
  _resetAllRateState();
  n = 0;
});

describe("recordRateHit — threshold", () => {
  it("stays quiet below the threshold and fires exactly at it", () => {
    expect(recordRateHit("g1", 1, rate, hit(T0))).toBeNull();
    expect(recordRateHit("g1", 1, rate, hit(T0 + MIN))).toBeNull();
    const burst = recordRateHit("g1", 1, rate, hit(T0 + 2 * MIN));
    expect(burst).not.toBeNull();
    expect(burst).toMatchObject({
      rate_count: 3,
      rate_threshold: 3,
      rate_window_minutes: 5,
      cooldown_minutes: 30,
      burst_duration_seconds: 120,
      first_message_id: "m1",
      last_message_id: "m3",
      first_message_url: "https://discord.com/channels/g1/c1/m1",
      last_message_url: "https://discord.com/channels/g1/c1/m3",
      first_message_at: new Date(T0).toISOString(),
    });
  });

  it("reports unique authors and channels, capping the author sample", () => {
    const big: RateConfig = { count: 15, windowMinutes: 5, cooldownMinutes: 30 };
    let burst: Record<string, unknown> | null = null;
    for (let i = 0; i < 15; i++) {
      burst = recordRateHit("g1", 1, big, hit(T0 + i * 1000, `u${i}`, i % 2 ? "c2" : "c1"));
    }
    expect(burst).toMatchObject({ rate_count: 15, unique_author_count: 15 });
    expect(burst!.sample_author_ids).toHaveLength(MAX_SAMPLE_AUTHORS);
    expect(burst!.channel_ids).toEqual(["c1", "c2"]);
  });

  it("dedupes repeat authors", () => {
    recordRateHit("g1", 1, rate, hit(T0, "spammer"));
    recordRateHit("g1", 1, rate, hit(T0 + 1, "spammer"));
    const burst = recordRateHit("g1", 1, rate, hit(T0 + 2, "spammer"));
    expect(burst).toMatchObject({ unique_author_count: 1, sample_author_ids: ["spammer"] });
  });
});

describe("recordRateHit — sliding window", () => {
  it("drops hits older than the window", () => {
    recordRateHit("g1", 1, rate, hit(T0));
    recordRateHit("g1", 1, rate, hit(T0 + 1 * MIN));
    // 5.5 minutes after the first hit: the first one has slid out, so only 2 count.
    expect(recordRateHit("g1", 1, rate, hit(T0 + 5.5 * MIN))).toBeNull();
    // A 3rd hit inside the window of the last two fires.
    expect(recordRateHit("g1", 1, rate, hit(T0 + 5.5 * MIN + 1))).not.toBeNull();
  });

  it("treats a hit exactly window-old as expired", () => {
    recordRateHit("g1", 1, rate, hit(T0));
    recordRateHit("g1", 1, rate, hit(T0 + MIN));
    expect(recordRateHit("g1", 1, rate, hit(T0 + 5 * MIN))).toBeNull();
  });

  it("keeps windows separate per trigger and per guild", () => {
    recordRateHit("g1", 1, rate, hit(T0));
    recordRateHit("g1", 1, rate, hit(T0 + 1));
    expect(recordRateHit("g1", 2, rate, hit(T0 + 2))).toBeNull();
    expect(recordRateHit("g2", 1, rate, hit(T0 + 3))).toBeNull();
    expect(recordRateHit("g1", 1, rate, hit(T0 + 4))).not.toBeNull();
  });
});

describe("recordRateHit — cooldown", () => {
  function fire(start: number) {
    recordRateHit("g1", 1, rate, hit(start));
    recordRateHit("g1", 1, rate, hit(start + 1));
    return recordRateHit("g1", 1, rate, hit(start + 2));
  }

  it("fires once per raid, ignoring messages during the cooldown", () => {
    expect(fire(T0)).not.toBeNull();
    // The raid continues: 10 more messages in the next few minutes → silence.
    for (let i = 1; i <= 10; i++) {
      expect(recordRateHit("g1", 1, rate, hit(T0 + i * 10_000))).toBeNull();
    }
  });

  it("can fire again after the cooldown with a fresh burst", () => {
    expect(fire(T0)).not.toBeNull();
    // Messages sent during cooldown don't carry over into the next window.
    recordRateHit("g1", 1, rate, hit(T0 + 29 * MIN));
    recordRateHit("g1", 1, rate, hit(T0 + 29 * MIN + 1));
    // After the cooldown (ends at T0+30m) counting starts from zero.
    expect(recordRateHit("g1", 1, rate, hit(T0 + 31 * MIN))).toBeNull();
    expect(recordRateHit("g1", 1, rate, hit(T0 + 31 * MIN + 1))).toBeNull();
    expect(recordRateHit("g1", 1, rate, hit(T0 + 31 * MIN + 2))).not.toBeNull();
  });

  it("resetRateState clears windows and cooldowns for one guild only", () => {
    expect(fire(T0)).not.toBeNull();
    recordRateHit("g2", 1, rate, hit(T0));
    recordRateHit("g2", 1, rate, hit(T0 + 1));
    resetRateState("g1");
    // g1's cooldown is gone, so it can fire immediately.
    expect(fire(T0 + 10)).not.toBeNull();
    // g2's window survived.
    expect(recordRateHit("g2", 1, rate, hit(T0 + 2))).not.toBeNull();
  });

  it("resetRateState with a trigger id only clears that trigger", () => {
    // Trigger 1 fires and goes into cooldown; trigger 2 has a partial window.
    expect(fire(T0)).not.toBeNull();
    recordRateHit("g1", 2, rate, hit(T0));
    recordRateHit("g1", 2, rate, hit(T0 + 1));
    resetRateState("g1", 2);
    // Trigger 1's cooldown survived, so the raid doesn't page again.
    expect(fire(T0 + 10)).toBeNull();
    // Trigger 2 starts over: two more hits aren't enough.
    expect(recordRateHit("g1", 2, rate, hit(T0 + 2))).toBeNull();
    expect(recordRateHit("g1", 2, rate, hit(T0 + 3))).toBeNull();
  });
});
