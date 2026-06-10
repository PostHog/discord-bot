import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getGuildConfig } = vi.hoisted(() => ({ getGuildConfig: vi.fn() }));
vi.mock("@/configCache.js", () => ({ getGuildConfig }));

const { appHostForGuild, buildCommandPayload, fetchRepos, forwardInteraction } =
  await import("@/bridge/forward.js");
const { config } = await import("@/config.js");

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  getGuildConfig.mockReturnValue(null);
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("appHostForGuild", () => {
  it("defaults to US when unconfigured", () => {
    expect(appHostForGuild("g")).toBe("https://us.posthog.com");
    expect(appHostForGuild(null)).toBe("https://us.posthog.com");
  });

  it("uses EU when the guild's host is EU", () => {
    getGuildConfig.mockReturnValue({ posthogHost: "https://eu.i.posthog.com" });
    expect(appHostForGuild("g")).toBe("https://eu.posthog.com");
  });

  it("honors the dev override over region derivation", () => {
    getGuildConfig.mockReturnValue({ posthogHost: "https://eu.i.posthog.com" });
    config.bridgeBaseUrl = "http://127.0.0.1:8000";
    try {
      expect(appHostForGuild("g")).toBe("http://127.0.0.1:8000");
    } finally {
      config.bridgeBaseUrl = undefined;
    }
  });
});

describe("buildCommandPayload", () => {
  function chatInput(group: string | null, sub: string, leaf: { name: string; value: unknown }[]) {
    const leafOpts = leaf.map((o) => ({ name: o.name, value: o.value }));
    const data = group
      ? [{ name: group, type: 2, options: [{ name: sub, type: 1, options: leafOpts }] }]
      : [{ name: sub, type: 1, options: leafOpts }];
    return {
      options: {
        getSubcommandGroup: () => group,
        getSubcommand: () => sub,
        data,
      },
      guildId: "g",
      channelId: "c",
      user: { id: "u", username: "name", globalName: "Global" },
      id: "iid",
      token: "tok",
      applicationId: "app",
    };
  }

  it("maps a grouped subcommand to command+subcommand and flattens options", () => {
    const p = buildCommandPayload(
      chatInput("project", "set", [{ name: "project_id", value: "123" }]) as never
    );
    expect(p).toMatchObject({
      kind: "command",
      command: "project",
      subcommand: "set",
      options: { project_id: "123" },
      guild_id: "g",
      channel_id: "c",
      user: { id: "u", username: "name", global_name: "Global" },
      interaction_id: "iid",
      interaction_token: "tok",
      application_id: "app",
    });
  });

  it("maps the bare code subcommand with a null subcommand", () => {
    const p = buildCommandPayload(
      chatInput(null, "code", [{ name: "prompt", value: "fix it" }]) as never
    );
    expect(p.command).toBe("code");
    expect(p.subcommand).toBeNull();
    expect(p.options).toEqual({ prompt: "fix it" });
  });
});

describe("forwardInteraction", () => {
  const payload = {
    kind: "command" as const,
    guild_id: "g",
    channel_id: "c",
    user: { id: "u", username: "n", global_name: null },
    interaction_id: "i",
    interaction_token: "t",
    application_id: "a",
  };

  it("POSTs to the region app host with a bearer and returns the parsed reply", async () => {
    getGuildConfig.mockReturnValue({ posthogHost: "https://eu.i.posthog.com" });
    fetchMock.mockResolvedValue(jsonResponse({ status: "accepted" }));

    const res = await forwardInteraction(payload);

    expect(res).toEqual({ status: "accepted" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://eu.posthog.com/api/discord/interactions/ingest");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as { headers: Record<string, string> }).headers.Authorization).toBe(
      "Bearer test-secret"
    );
    expect(JSON.parse((init as { body: string }).body)).toMatchObject({ kind: "command" });
  });

  it("returns the ephemeral action reply", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ action: "ephemeral", content: "link here" }));
    expect(await forwardInteraction(payload)).toEqual({ action: "ephemeral", content: "link here" });
  });

  it("returns null on a non-OK response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
    expect(await forwardInteraction(payload)).toBeNull();
  });

  it("returns null on a network error", async () => {
    fetchMock.mockRejectedValue(new Error("boom"));
    expect(await forwardInteraction(payload)).toBeNull();
  });
});

describe("fetchRepos", () => {
  it("maps a repos string array to choices", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ repos: ["a/b", "c/d"] }));
    expect(await fetchRepos("g", "u", "a")).toEqual([
      { name: "a/b", value: "a/b" },
      { name: "c/d", value: "c/d" },
    ]);
  });

  it("passes through explicit choices", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ choices: [{ name: "x", value: "y" }] }));
    expect(await fetchRepos("g", "u", "")).toEqual([{ name: "x", value: "y" }]);
  });

  it("returns [] on failure", async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 500));
    expect(await fetchRepos("g", "u", "a")).toEqual([]);
    fetchMock.mockRejectedValue(new Error("boom"));
    expect(await fetchRepos("g", "u", "a")).toEqual([]);
  });
});
