import path from "node:path";
import { defineConfig } from "vitest/config";

import { ACCEPTANCE_FILES } from "./test/acceptance-files";

// Vitest's `include` / `exclude` want a mutable array.
const acceptanceFiles = [...ACCEPTANCE_FILES];

export default defineConfig({
  // Resolve `include` against this package, not the cwd: `fallow mutation
  // --runner-config` runs Vitest from the repo root.
  root: import.meta.dirname,
  resolve: {
    alias: {
      "#src": path.resolve(import.meta.dirname, "src"),
      "#test": path.resolve(import.meta.dirname, "test"),
    },
  },
  test: {
    coverage: {
      reporter: ["text", "html"],
    },
    // Two projects so `pnpm test` (the `unit` project) never spawns the real
    // `pi` CLI. See `test/acceptance-files.ts` for why that matters (#678).
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/**/*.test.ts"],
          exclude: acceptanceFiles,
        },
      },
      {
        test: {
          name: "acceptance",
          include: acceptanceFiles,
          // A GitHub runner has 2-4 vCPU, where two concurrent real-`pi`
          // spawns contend directly. Serializing makes the suite's timing
          // independent of core count.
          fileParallelism: false,
        },
      },
    ],
  },
});
