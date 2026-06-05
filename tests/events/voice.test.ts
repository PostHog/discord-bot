import { Events } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureForGuild } = vi.hoisted(() => ({ captureForGuild: vi.fn() }));
const { runVoiceJoinTriggers } = vi.hoisted(() => ({ runVoiceJoinTriggers: vi.fn() }));

vi.mock("../../src/capture.js", () => ({
  captureForGuild,
  toPersonLike: (u: { id: string; username: string; globalName?: string | null; bot?: boolean }) => ({
    id: u.id,
    username: u.username,
    globalName: u.globalName ?? null,
    bot: !!u.bot,
  }),
}));
vi.mock("../../src/triggers.js", () => ({ runVoiceJoinTriggers }));

const { register } = await import("../../src/events/voice.js");

function client() {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  register({ on: (e: string, cb: never) => handlers.set(e, cb) } as never);
  return { fire: (e: string, ...a: unknown[]) => handlers.get(e)?.(...a) };
}

const member = { id: "u1", user: { id: "u1", username: "a", globalName: null, bot: false } };
const guild = { id: "g1", name: "G" };
const chan = (id: string, name: string) => ({ id, name });

function state(channelId: string | null, channelName: string | null) {
  return {
    channelId,
    channel: channelId ? chan(channelId, channelName ?? "") : null,
    member,
    guild,
  };
}

beforeEach(() => vi.clearAllMocks());

describe("VoiceStateUpdate", () => {
  it("captures voice_channel_joined and runs voice-join triggers", () => {
    client().fire(Events.VoiceStateUpdate, state(null, null), state("vc1", "Lounge"));
    expect(captureForGuild.mock.calls[0][0]).toMatchObject({
      event: "voice_channel_joined",
      properties: { channel_id: "vc1", channel_name: "Lounge" },
    });
    expect(runVoiceJoinTriggers).toHaveBeenCalledTimes(1);
    expect(runVoiceJoinTriggers.mock.calls[0][1]).toMatchObject({ id: "vc1" });
  });

  it("captures voice_channel_left without running triggers", () => {
    client().fire(Events.VoiceStateUpdate, state("vc1", "Lounge"), state(null, null));
    expect(captureForGuild.mock.calls[0][0]).toMatchObject({
      event: "voice_channel_left",
      properties: { channel_id: "vc1" },
    });
    expect(runVoiceJoinTriggers).not.toHaveBeenCalled();
  });

  it("captures voice_channel_moved with from/to", () => {
    client().fire(Events.VoiceStateUpdate, state("vc1", "Lounge"), state("vc2", "Stage"));
    expect(captureForGuild.mock.calls[0][0]).toMatchObject({
      event: "voice_channel_moved",
      properties: {
        from_channel_id: "vc1",
        from_channel_name: "Lounge",
        to_channel_id: "vc2",
        to_channel_name: "Stage",
      },
    });
    expect(runVoiceJoinTriggers).not.toHaveBeenCalled();
  });

  it("ignores same-channel updates (mute/deafen/stream)", () => {
    client().fire(Events.VoiceStateUpdate, state("vc1", "Lounge"), state("vc1", "Lounge"));
    expect(captureForGuild).not.toHaveBeenCalled();
  });
});
