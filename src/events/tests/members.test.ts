import { Events } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

const { captureForGuild } = vi.hoisted(() => ({ captureForGuild: vi.fn() }));
const { runMemberJoinTriggers } = vi.hoisted(() => ({ runMemberJoinTriggers: vi.fn() }));

vi.mock("@/capture.js", () => ({
  captureForGuild,
  toPersonLike: (u: { id: string; username: string; globalName?: string | null; bot?: boolean }) => ({
    id: u.id,
    username: u.username,
    globalName: u.globalName ?? null,
    bot: !!u.bot,
  }),
}));
vi.mock("@/triggers.js", () => ({ runMemberJoinTriggers }));
vi.mock("@/time.js", () => ({ nowMs: () => NOW }));

const { register } = await import("@/events/members.js");

function client() {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  register({ on: (e: string, cb: never) => handlers.set(e, cb) } as never);
  return { fire: (e: string, ...a: unknown[]) => handlers.get(e)?.(...a) };
}

const user = { id: "u1", username: "a", globalName: null, bot: false };
const guild = { id: "g1", name: "G", memberCount: 42 };

beforeEach(() => vi.clearAllMocks());

describe("GuildMemberAdd", () => {
  it("captures member_joined with account age + member count, and runs triggers", () => {
    const member = {
      id: "u1",
      user: { ...user, createdTimestamp: NOW - 10 * DAY },
      guild,
    };
    client().fire(Events.GuildMemberAdd, member);
    expect(captureForGuild.mock.calls[0][0]).toMatchObject({
      event: "member_joined",
      distinctId: "u1",
      properties: { guild_id: "g1", account_age_days: 10, member_count: 42 },
    });
    expect(runMemberJoinTriggers).toHaveBeenCalledWith(member);
  });
});

describe("GuildMemberRemove", () => {
  it("captures member_left with tenure and role count (minus @everyone)", () => {
    client().fire(Events.GuildMemberRemove, {
      id: "u1",
      user,
      guild,
      joinedTimestamp: NOW - 5 * DAY,
      roles: { cache: { size: 3 } },
    });
    expect(captureForGuild.mock.calls[0][0]).toMatchObject({
      event: "member_left",
      properties: { joined_days_ago: 5, roles_count: 2 },
    });
    expect(runMemberJoinTriggers).not.toHaveBeenCalled();
  });

  it("tolerates an unknown join time", () => {
    client().fire(Events.GuildMemberRemove, {
      id: "u1",
      user,
      guild,
      joinedTimestamp: null,
      roles: { cache: { size: 1 } },
    });
    expect(captureForGuild.mock.calls[0][0].properties).toMatchObject({
      joined_days_ago: null,
      roles_count: 0,
    });
  });
});

describe("GuildBanAdd", () => {
  it("captures member_banned", () => {
    client().fire(Events.GuildBanAdd, { user, guild });
    expect(captureForGuild.mock.calls[0][0]).toMatchObject({
      event: "member_banned",
      distinctId: "u1",
    });
  });
});
