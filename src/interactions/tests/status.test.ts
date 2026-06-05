import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db.js")>();
  return { ...actual, readGuildConfig: vi.fn(), countTriggers: vi.fn(() => 0) };
});

const { handleStatusCommand } = await import("@/interactions/status.js");
const { readGuildConfig, countTriggers } = await import("@/db.js");
const readMock = vi.mocked(readGuildConfig);
const countMock = vi.mocked(countTriggers);

function interaction() {
  const reply = vi.fn();
  return { guildId: "g1", reply };
}

beforeEach(() => {
  vi.clearAllMocks();
  countMock.mockReturnValue(0);
});

describe("handleStatusCommand", () => {
  it("tells unconnected servers to run setup", async () => {
    readMock.mockReturnValue(null);
    const i = interaction();
    await handleStatusCommand(i as never);
    expect((i.reply.mock.calls[0][0] as { content: string }).content).toContain("setup");
  });

  it("masks the project key in the status embed", async () => {
    readMock.mockReturnValue({
      guildId: "g1",
      posthogApiKey: "phc_1234567890ab",
      posthogHost: "https://us.i.posthog.com",
      enabledEvents: ["message_sent"],
      ignoreBots: true,
      messageSampleRate: 1,
    });
    countMock.mockReturnValue(3);
    const i = interaction();
    await handleStatusCommand(i as never);

    const payload = i.reply.mock.calls[0][0] as {
      embeds: Array<{ data: { fields: Array<{ name: string; value: string }> } }>;
    };
    const fields = payload.embeds[0].data.fields;
    const keyField = fields.find((f) => f.name === "Project key");
    expect(keyField?.value).toContain("phc_…90ab");
    // The full key must never appear.
    expect(keyField?.value).not.toContain("1234567890");
  });
});
