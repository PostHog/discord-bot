import http from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/db.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db.js")>();
  return { ...actual, readGuildConfig: vi.fn() };
});

const { handleTestCommand } = await import("@/interactions/test.js");
const { readGuildConfig } = await import("@/db.js");
const { shutdownAll } = await import("@/posthogPool.js");
const readMock = vi.mocked(readGuildConfig);

const servers: http.Server[] = [];

/** A capture endpoint that answers every request with `status`, echoing v1 results on 200. */
async function captureServer(status: number): Promise<string> {
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      res.writeHead(status, { "content-type": "application/json" });
      if (status !== 200) {
        res.end(JSON.stringify({ error: "synthetic" }));
        return;
      }
      res.end(JSON.stringify({ results: {} }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

function interaction() {
  return {
    guildId: "g1",
    user: { id: "u1", username: "tester" },
    reply: vi.fn(),
    deferReply: vi.fn(),
    editReply: vi.fn(),
  };
}

function connect(host: string, key: string) {
  readMock.mockReturnValue({
    guildId: "g1",
    posthogApiKey: key,
    posthogHost: host,
    enabledEvents: [],
    ignoreBots: true,
    messageSampleRate: 1,
    captureMessageContent: false,
  });
}

afterEach(async () => {
  await shutdownAll();
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

describe("handleTestCommand", () => {
  it.each([
    [401, "an auth failure"],
    [500, "a server error"],
  ])("reports %s (%s) instead of a sent test event", async (status) => {
    connect(await captureServer(status), `phc_test_failure_${status}`);
    const i = interaction();

    await handleTestCommand(i as never);

    const content = (i.editReply.mock.calls[0][0] as { content: string }).content;
    expect(content).toContain("Failed to send the test event");
  });

  it("confirms the test event when PostHog accepts it", async () => {
    connect(await captureServer(200), "phc_test_success");
    const i = interaction();

    await handleTestCommand(i as never);

    const content = (i.editReply.mock.calls[0][0] as { content: string }).content;
    expect(content).toContain("Sent a test event");
  });
});
