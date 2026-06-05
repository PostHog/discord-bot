import { ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";

import { channelProps, guildProps } from "./props.js";

// Minimal channel/guild shapes — the helpers only read id/name/type.
function chan(type: ChannelType, id = "c1", name: string | null = "general") {
  return { id, name, type } as never;
}

describe("channelProps", () => {
  it("returns {} for a null/undefined channel", () => {
    expect(channelProps(null)).toEqual({});
    expect(channelProps(undefined)).toEqual({});
  });

  it("maps id, name, and a readable type label", () => {
    expect(channelProps(chan(ChannelType.GuildText))).toEqual({
      channel_id: "c1",
      channel_name: "general",
      channel_type: "text",
    });
  });

  it("handles a missing channel name", () => {
    expect(channelProps(chan(ChannelType.GuildText, "c2", null))).toMatchObject({
      channel_id: "c2",
      channel_name: null,
    });
  });

  it("labels the known channel types", () => {
    const cases: Array<[ChannelType, string]> = [
      [ChannelType.GuildVoice, "voice"],
      [ChannelType.GuildAnnouncement, "announcement"],
      [ChannelType.GuildStageVoice, "stage"],
      [ChannelType.GuildForum, "forum"],
      [ChannelType.PublicThread, "public_thread"],
      [ChannelType.PrivateThread, "private_thread"],
      [ChannelType.AnnouncementThread, "announcement_thread"],
    ];
    for (const [type, label] of cases) {
      expect(channelProps(chan(type)).channel_type).toBe(label);
    }
  });

  it("falls back to type_<n> for unknown types", () => {
    expect(channelProps(chan(ChannelType.GuildDirectory)).channel_type).toMatch(
      /^type_\d+$/
    );
  });
});

describe("guildProps", () => {
  it("maps guild id and name", () => {
    expect(guildProps({ id: "g1", name: "My Server" } as never)).toEqual({
      guild_id: "g1",
      guild_name: "My Server",
    });
  });
});
