import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Match the tsconfig "@/*" -> "src/*" path alias used by the source + tests.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
    // The source uses NodeNext-style ".js" specifiers that point at ".ts" files.
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  test: {
    environment: "node",
    // Tests live both in the top-level tests/ dir and in per-module tests/ dirs.
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    // config.ts requires these at import time; db tests use an in-memory SQLite.
    env: {
      DISCORD_BOT_TOKEN: "test-token",
      DISCORD_APPLICATION_ID: "test-app",
      DATABASE_PATH: ":memory:",
    },
  },
});
