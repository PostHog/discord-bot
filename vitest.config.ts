import { defineConfig } from "vitest/config";

export default defineConfig({
  // The source uses NodeNext-style ".js" import specifiers that actually point
  // at ".ts" files. Tell Vite to resolve ".js" to ".ts" first so it can load
  // the real modules under test.
  resolve: {
    extensionAlias: {
      ".js": [".ts", ".js"],
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // config.ts requires these at import time; db tests use an in-memory SQLite.
    env: {
      DISCORD_BOT_TOKEN: "test-token",
      DISCORD_APPLICATION_ID: "test-app",
      DATABASE_PATH: ":memory:",
    },
  },
});
