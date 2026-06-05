import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../db.js")>();
  return { ...actual, upsertPosthog: vi.fn() };
});

const { handleSetupCommand, handleSetupModal } = await import("./setup.js");
const { upsertPosthog } = await import("../db.js");
const upsertMock = vi.mocked(upsertPosthog);

function modal(key: string, host: string) {
  const reply = vi.fn();
  const interaction = {
    guildId: "g1",
    fields: {
      getTextInputValue: (f: string) => (f === "posthog_key" ? key : host),
    },
    reply,
  };
  return interaction;
}

function fieldValue(json: { components?: Array<{ components?: Array<{ custom_id?: string; value?: string }> }> }, id: string) {
  for (const row of json.components ?? []) {
    for (const comp of row.components ?? []) {
      if (comp.custom_id === id) return comp.value;
    }
  }
  return undefined;
}

beforeEach(() => vi.clearAllMocks());

describe("handleSetupModal", () => {
  it("rejects a non-phc key", async () => {
    const i = modal("sk_live_nope", "https://us.i.posthog.com");
    await handleSetupModal(i as never);
    expect(upsertMock).not.toHaveBeenCalled();
    expect((i.reply.mock.calls[0][0] as { content: string }).content).toContain("project");
  });

  it("rejects an unparseable host", async () => {
    const i = modal("phc_ok", "");
    await handleSetupModal(i as never);
    expect(upsertMock).not.toHaveBeenCalled();
    expect((i.reply.mock.calls[0][0] as { content: string }).content).toContain("valid host");
  });

  it("normalizes a bare host and stores it", async () => {
    const i = modal("phc_ok", "eu.i.posthog.com");
    await handleSetupModal(i as never);
    expect(upsertMock).toHaveBeenCalledWith("g1", "phc_ok", "https://eu.i.posthog.com", expect.any(Number));
  });

  it("strips path/trailing slash to the origin", async () => {
    const i = modal("phc_ok", "https://ph.example.com/ingest/");
    await handleSetupModal(i as never);
    expect(upsertMock.mock.calls[0][2]).toBe("https://ph.example.com");
  });
});

describe("handleSetupCommand region prefill", () => {
  function cmd(region: string | null) {
    const showModal = vi.fn();
    return { guildId: "g1", options: { getString: (n: string) => (n === "region" ? region : null) }, showModal };
  }

  it("pre-fills the EU host", async () => {
    const i = cmd("eu");
    await handleSetupCommand(i as never);
    const json = i.showModal.mock.calls[0][0].toJSON();
    expect(fieldValue(json, "posthog_host")).toBe("https://eu.i.posthog.com");
  });

  it("defaults to the US host when no region is given", async () => {
    const i = cmd(null);
    await handleSetupCommand(i as never);
    const json = i.showModal.mock.calls[0][0].toJSON();
    expect(fieldValue(json, "posthog_host")).toBe("https://us.i.posthog.com");
  });
});
