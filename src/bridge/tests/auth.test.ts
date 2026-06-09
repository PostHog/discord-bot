import { describe, expect, it } from "vitest";

import { bearerHeaders, verifyBearer } from "@/bridge/auth.js";

// vitest.config sets POSTHOG_DISCORD_SHARED_SECRET = "test-secret".

describe("verifyBearer", () => {
  it("accepts the correct bearer", () => {
    expect(verifyBearer("Bearer test-secret")).toBe(true);
  });

  it("rejects a same-length wrong secret", () => {
    expect(verifyBearer("Bearer test-secreX")).toBe(false);
  });

  it("rejects a different-length secret", () => {
    expect(verifyBearer("Bearer nope")).toBe(false);
  });

  it("rejects missing or malformed headers", () => {
    expect(verifyBearer(undefined)).toBe(false);
    expect(verifyBearer("test-secret")).toBe(false);
    expect(verifyBearer("Basic test-secret")).toBe(false);
  });
});

describe("bearerHeaders", () => {
  it("builds the Authorization header", () => {
    expect(bearerHeaders()).toEqual({ Authorization: "Bearer test-secret" });
  });
});
