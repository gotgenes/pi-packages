import path from "node:path";
import { defineConfig } from "vitest/config";

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
    include: ["test/**/*.test.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
