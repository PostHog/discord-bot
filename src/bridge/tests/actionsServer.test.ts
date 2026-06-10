import type { AddressInfo } from "node:net";

import { Routes } from "discord.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rest } = vi.hoisted(() => ({
  rest: { post: vi.fn(), patch: vi.fn(), delete: vi.fn(), put: vi.fn() },
}));
vi.mock("@/bridge/discordRest.js", () => ({ rest }));

const { createActionsServer, handleAction } = await import("@/bridge/actionsServer.js");
const { readGuildConfig } = await import("@/db.js"); // real in-memory SQLite

// vitest.config sets DISCORD_APPLICATION_ID = "test-app".
const APP = "test-app";

beforeEach(() => vi.clearAllMocks());

describe("handleAction", () => {
  it("create_thread off a message", async () => {
    rest.post.mockResolvedValue({ id: "t1" });
    const res = await handleAction("create_thread", {
      channel_id: "c",
      message_id: "m",
      name: "Topic",
    });
    expect(rest.post).toHaveBeenCalledWith(Routes.threads("c", "m"), { body: { name: "Topic" } });
    expect(res).toEqual({ status: 200, body: { thread_id: "t1" } });
  });

  it("post_message to a channel uses bot auth", async () => {
    rest.post.mockResolvedValue({ id: "m1" });
    const res = await handleAction("post_message", { target_id: "c", content: "hi" });
    expect(rest.post).toHaveBeenCalledWith(Routes.channelMessages("c"), {
      body: { content: "hi", embeds: undefined, components: undefined },
      auth: true,
    });
    expect(res.body).toEqual({ message_id: "m1" });
  });

  it("post_message via interaction token is ephemeral + unauthenticated", async () => {
    rest.post.mockResolvedValue({ id: "m2" });
    await handleAction("post_message", {
      interaction_token: "tok",
      content: "secret",
      ephemeral: true,
    });
    const [route, opts] = rest.post.mock.calls[0];
    expect(route).toBe(Routes.webhook(APP, "tok"));
    expect(opts).toMatchObject({ auth: false, body: { content: "secret", flags: 64 } });
  });

  it("edit_message via interaction token edits @original", async () => {
    rest.patch.mockResolvedValue({});
    const res = await handleAction("edit_message", { interaction_token: "tok", content: "x" });
    expect(rest.patch).toHaveBeenCalledWith(Routes.webhookMessage(APP, "tok", "@original"), {
      body: { content: "x", embeds: undefined, components: undefined },
      auth: false,
    });
    expect(res.body).toEqual({ ok: true });
  });

  it("delete_message and reactions hit the right routes", async () => {
    rest.delete.mockResolvedValue({});
    rest.put.mockResolvedValue({});
    await handleAction("delete_message", { target_id: "c", message_id: "m" });
    expect(rest.delete).toHaveBeenCalledWith(Routes.channelMessage("c", "m"));

    await handleAction("add_reaction", { channel_id: "c", message_id: "m", emoji: "%F0%9F%91%80" });
    expect(rest.put).toHaveBeenCalledWith(
      Routes.channelMessageOwnReaction("c", "m", "%F0%9F%91%80")
    );
  });

  it("rejects an unknown op", async () => {
    const res = await handleAction("teleport", {});
    expect(res.status).toBe(400);
  });

  it("connect_guild stores the project key against the region host", async () => {
    const res = await handleAction("connect_guild", {
      guild_id: "g-connect",
      region: "eu",
      project_api_key: "phc_test",
    });
    expect(res).toEqual({ status: 200, body: { ok: true } });
    const cfg = readGuildConfig("g-connect");
    expect(cfg?.posthogApiKey).toBe("phc_test");
    expect(cfg?.posthogHost).toBe("https://eu.i.posthog.com");
  });

  it("connect_guild with no key disconnects the guild", async () => {
    await handleAction("connect_guild", {
      guild_id: "g-dc",
      region: "us",
      project_api_key: "phc_x",
    });
    await handleAction("connect_guild", { guild_id: "g-dc" });
    expect(readGuildConfig("g-dc")?.posthogApiKey ?? null).toBeNull();
  });

  it("connect_guild requires a guild_id", async () => {
    const res = await handleAction("connect_guild", { project_api_key: "phc_x" });
    expect(res.status).toBe(400);
  });
});

describe("actions HTTP server", () => {
  let server: ReturnType<typeof createActionsServer>;
  let base: string;

  beforeEach(async () => {
    server = createActionsServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => server.close());

  const auth = { Authorization: "Bearer test-secret" };

  it("401s without a valid bearer", async () => {
    const res = await fetch(`${base}/actions`, { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
  });

  it("400s on invalid JSON", async () => {
    const res = await fetch(`${base}/actions`, { method: "POST", headers: auth, body: "not json" });
    expect(res.status).toBe(400);
  });

  it("dispatches an authenticated op", async () => {
    rest.post.mockResolvedValue({ id: "m9" });
    const res = await fetch(`${base}/actions`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ op: "post_message", target_id: "c", content: "hi" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message_id: "m9" });
    expect(rest.post).toHaveBeenCalledTimes(1);
  });

  it("serves /health", async () => {
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
  });
});
