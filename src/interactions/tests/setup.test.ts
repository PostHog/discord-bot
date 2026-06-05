import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db.js")>();
  return { ...actual, upsertPosthog: vi.fn() };
});

const { handleSetupCommand, handleSetupModal } = await import("@/interactions/setup.js");
const { upsertPosthog } = await import("@/db.js");
const upsertMock = vi.mocked(upsertPosthog);

// The modal carries the region in its custom id (analytics:setup:<region>); the
// modal itself only has the key field.
function modal(key: string, region = "us") {
  const reply = vi.fn();
  const interaction = {
    guildId: "g1",
    customId: `analytics:setup:${region}`,
    fields: { getTextInputValue: () => key },
    reply,
  };
  return interaction;
}

beforeEach(() => vi.clearAllMocks());

describe("handleSetupModal", () => {
  it("rejects a non-phc key", async () => {
    const i = modal("sk_live_nope");
    await handleSetupModal(i as never);
    expect(upsertMock).not.toHaveBeenCalled();
    expect((i.reply.mock.calls[0][0] as { content: string }).content).toContain("project");
  });

  it("stores the key against the US cloud host", async () => {
    const i = modal("phc_ok", "us");
    await handleSetupModal(i as never);
    expect(upsertMock).toHaveBeenCalledWith("g1", "phc_ok", "https://us.i.posthog.com", expect.any(Number));
  });

  it("stores the key against the EU cloud host", async () => {
    const i = modal("phc_ok", "eu");
    await handleSetupModal(i as never);
    expect(upsertMock.mock.calls[0][2]).toBe("https://eu.i.posthog.com");
  });

  it("falls back to the US host for an unknown/garbage region", async () => {
    const i = modal("phc_ok", "evil-host.internal");
    await handleSetupModal(i as never);
    expect(upsertMock.mock.calls[0][2]).toBe("https://us.i.posthog.com");
  });
});

describe("handleSetupCommand", () => {
  function cmd(region: string | null) {
    const showModal = vi.fn();
    return { guildId: "g1", options: { getString: (n: string) => (n === "region" ? region : null) }, showModal };
  }

  it("encodes the chosen region in the modal custom id", async () => {
    const i = cmd("eu");
    await handleSetupCommand(i as never);
    expect(i.showModal.mock.calls[0][0].toJSON().custom_id).toBe("analytics:setup:eu");
  });

  it("defaults to us when no region is given", async () => {
    const i = cmd(null);
    await handleSetupCommand(i as never);
    expect(i.showModal.mock.calls[0][0].toJSON().custom_id).toBe("analytics:setup:us");
  });

  it("does not expose a free-text host field", async () => {
    const i = cmd("us");
    await handleSetupCommand(i as never);
    const json = i.showModal.mock.calls[0][0].toJSON();
    const customIds = (json.components ?? []).flatMap((r: { components?: Array<{ custom_id?: string }> }) =>
      (r.components ?? []).map((c) => c.custom_id)
    );
    expect(customIds).toContain("posthog_key");
    expect(customIds).not.toContain("posthog_host");
  });
});
