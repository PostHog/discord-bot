import { beforeEach, describe, expect, it, vi } from "vitest";

const { captureForGuild, flushForGuild, getGuildConfig } = vi.hoisted(() => ({
  captureForGuild: vi.fn(),
  flushForGuild: vi.fn(async () => {}),
  getGuildConfig: vi.fn(),
}));

vi.mock("@/capture.js", () => ({
  captureForGuild,
  flushForGuild,
  toPersonLike: (u: {
    id: string;
    username: string;
    globalName?: string | null;
    bot?: boolean;
  }) => ({
    id: u.id,
    username: u.username,
    globalName: u.globalName ?? null,
    bot: !!u.bot,
  }),
}));
vi.mock("@/configCache.js", () => ({ getGuildConfig }));

const { rosterGuild } = await import("@/roster.js");

function member(over: Record<string, unknown> = {}) {
  return {
    id: "u1",
    user: { id: "u1", username: "alice", globalName: "Alice", bot: false },
    nickname: null,
    joinedAt: new Date("2026-01-15T10:00:00.000Z"),
    roles: { cache: [{ name: "@everyone" }, { name: "Team" }] },
    ...over,
  };
}

function guild(members: unknown[] = [member()]) {
  return {
    id: "g1",
    name: "G",
    members: { fetch: vi.fn(async () => new Map(members.map((m, i) => [String(i), m]))) },
  };
}

const enabled = { posthogApiKey: "phc_x", enabledEvents: ["member_roster"] };

beforeEach(() => vi.clearAllMocks());

describe("rosterGuild", () => {
  it("does nothing (no member fetch) when the guild is unconfigured", async () => {
    getGuildConfig.mockReturnValue(null);
    const g = guild();
    await rosterGuild(g as never);
    expect(g.members.fetch).not.toHaveBeenCalled();
    expect(captureForGuild).not.toHaveBeenCalled();
  });

  it("does nothing when member_roster is not enabled", async () => {
    getGuildConfig.mockReturnValue({
      posthogApiKey: "phc_x",
      enabledEvents: ["message_sent"],
    });
    const g = guild();
    await rosterGuild(g as never);
    expect(g.members.fetch).not.toHaveBeenCalled();
    expect(captureForGuild).not.toHaveBeenCalled();
  });

  it("emits one event per member with join date and roles", async () => {
    getGuildConfig.mockReturnValue(enabled);
    await rosterGuild(guild([member(), member({ id: "u2" })]) as never);

    expect(captureForGuild).toHaveBeenCalledTimes(2);
    const arg = captureForGuild.mock.calls[0][0];
    expect(arg).toMatchObject({
      guildId: "g1",
      event: "member_roster",
      distinctId: "u1",
    });
    expect(arg.properties).toMatchObject({
      guild_id: "g1",
      joined_at: "2026-01-15T10:00:00.000Z",
      roles: ["Team"],
      role_count: 1,
      is_bot: false,
    });
  });

  it("mirrors join date and roles onto the person", async () => {
    getGuildConfig.mockReturnValue(enabled);
    await rosterGuild(guild() as never);
    expect(captureForGuild.mock.calls[0][0].personProperties).toEqual({
      discord_joined_at: "2026-01-15T10:00:00.000Z",
      discord_roles: ["Team"],
      discord_role_count: 1,
    });
  });

  it("drops @everyone and sorts the remaining roles", async () => {
    getGuildConfig.mockReturnValue(enabled);
    await rosterGuild(
      guild([
        member({
          roles: { cache: [{ name: "Team" }, { name: "@everyone" }, { name: "Alpha" }] },
        }),
      ]) as never
    );
    expect(captureForGuild.mock.calls[0][0].properties.roles).toEqual(["Alpha", "Team"]);
  });

  it("handles a member with no join date", async () => {
    getGuildConfig.mockReturnValue(enabled);
    await rosterGuild(guild([member({ joinedAt: null })]) as never);
    expect(captureForGuild.mock.calls[0][0].properties.joined_at).toBeNull();
  });

  it("flushes periodically so posthog-node's queue cap can't drop members", async () => {
    getGuildConfig.mockReturnValue(enabled);
    // 450 members -> flushes at 200 and 400, plus the final drain.
    const many = Array.from({ length: 450 }, (_, i) => member({ id: `u${i}` }));
    await rosterGuild(guild(many) as never);
    expect(captureForGuild).toHaveBeenCalledTimes(450);
    expect(flushForGuild).toHaveBeenCalledTimes(3);
  });

  it("never throws when the member fetch fails", async () => {
    getGuildConfig.mockReturnValue(enabled);
    const g = guild();
    g.members.fetch = vi.fn(async () => {
      throw new Error("missing intent");
    });
    await expect(rosterGuild(g as never)).resolves.toBeUndefined();
    expect(captureForGuild).not.toHaveBeenCalled();
  });
});
