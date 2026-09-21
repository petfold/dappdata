import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Unit tests mock Bee; integration tests against bee-factory live in test/integration
    // and are excluded until Phase 1 has a transport (PLAN, Phase 1 gate).
    include: ["test/**/*.test.ts"],
    exclude: ["test/integration/**"],
  },
});
