import { defineConfig } from "vitest/config";

// Integration tests run against bee-factory, never in CI (PLAN, "Tests").
// They skip themselves unless DAPPDATA_BEE_URL and DAPPDATA_STAMP are set.
export default defineConfig({
  test: {
    include: ["test/integration/**/*.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
