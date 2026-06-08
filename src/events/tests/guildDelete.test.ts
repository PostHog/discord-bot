import { Events } from "discord.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { purgeGuild } = vi.hoisted(() => ({ purgeGuild: vi.fn() }));

vi.mock("@/db.js", () => ({ purgeGuild }));

const { register } = await import("@/events/guildDelete.js");

function deleteClient(guild: { id: string; name?: string; available?: boolean }) {
  const handlers = new Map<string, (...a: unknown[]) => void>();
  register({ on: (e: string, cb: never) => handlers.set(e, cb) } as never);
  return () => handlers.get(Events.GuildDelete)?.(guild);
}

beforeEach(() => vi.clearAllMocks());

describe("GuildDelete", () => {
  it("purges the guild's stored data when the bot is removed", () => {
    deleteClient({ id: "g1", name: "G1", available: true })();
    expect(purgeGuild).toHaveBeenCalledWith("g1");
  });

  it("purges when availability is unset (treated as a real removal)", () => {
    deleteClient({ id: "g2", name: "G2" })();
    expect(purgeGuild).toHaveBeenCalledWith("g2");
  });

  it("does not purge during a transient outage (available === false)", () => {
    deleteClient({ id: "g3", name: "G3", available: false })();
    expect(purgeGuild).not.toHaveBeenCalled();
  });
});
