import { ChannelType } from "discord.js";
import { describe, expect, it } from "vitest";

import { channelProps, guildProps, messageProps, messageUrl } from "@/props.js";

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
      // A non-thread is its own root, so per-channel breakdowns work uniformly.
      root_channel_id: "c1",
      root_channel_name: "general",
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

describe("channelProps for threads", () => {
  function thread(parent: { id: string; name: string | null } | null) {
    return {
      id: "t1",
      name: "help with X",
      type: ChannelType.PublicThread,
      isThread: () => true,
      parent,
    } as never;
  }

  it("rolls a thread up into its parent channel", () => {
    expect(channelProps(thread({ id: "c1", name: "posthog-chat" }))).toMatchObject({
      channel_id: "t1",
      channel_name: "help with X",
      parent_channel_id: "c1",
      parent_channel_name: "posthog-chat",
      root_channel_id: "c1",
      root_channel_name: "posthog-chat",
    });
  });

  it("falls back to the thread itself when the parent isn't cached", () => {
    const props = channelProps(thread(null));
    expect(props).not.toHaveProperty("parent_channel_id");
    expect(props).toMatchObject({ root_channel_id: "t1", root_channel_name: "help with X" });
  });
});

describe("messageUrl / messageProps", () => {
  it("builds a Discord deep link", () => {
    expect(messageUrl("g1", "c1", "m1")).toBe("https://discord.com/channels/g1/c1/m1");
  });

  it("returns message_id and message_url for a guild message", () => {
    expect(messageProps({ id: "m1", guildId: "g1", channelId: "c1" })).toEqual({
      message_id: "m1",
      message_url: "https://discord.com/channels/g1/c1/m1",
    });
  });

  it("omits the url when there is no guild", () => {
    expect(messageProps({ id: "m1", guildId: null, channelId: "c1" })).toEqual({
      message_id: "m1",
    });
  });
});
