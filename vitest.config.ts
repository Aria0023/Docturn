import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    // Each test file gets its own fresh in-process database (see tests/helpers.ts),
    // so run files in isolation to keep state deterministic.
    pool: "forks",
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 30000,
  },
});
