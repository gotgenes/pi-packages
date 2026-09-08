import { defineConfig } from "vitest/config";

// Scoped to the repo root's own `test/` directory. Each package runs `vitest
// run` from its own directory against its own config, so this never descends
// into `packages/`.
export default defineConfig({
  test: {
    include: ["test/**/*.test.mjs"],
  },
});
