import { existsSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import * as tui from "@earendil-works/pi-tui";

type ExtensionFactory = (pi: ExtensionAPI) => void;
type RuntimeBuilder = (host: {
  "@earendil-works/pi-coding-agent": typeof codingAgent;
  "@earendil-works/pi-tui": typeof tui;
}) => ExtensionFactory;

const runtimePath = fileURLToPath(
  new URL("./dist/runtime.cjs", import.meta.url),
);
const require = createRequire(import.meta.url);
const compiledFactory = loadCompiledFactory();

export default async function permissionSystemExtension(
  pi: ExtensionAPI,
): Promise<void> {
  const factory = compiledFactory ?? (await import("./src/index")).default;
  factory(pi);
}

function loadCompiledFactory(): ExtensionFactory | undefined {
  if (!existsSync(runtimePath)) return undefined;
  try {
    const builtAt = statSync(runtimePath).mtimeMs;
    const sourceRoot = fileURLToPath(new URL("./src/", import.meta.url));
    // Packed files can have equal normalized timestamps. Only newer source
    // files invalidate the bundle; extraction-created directories do not.
    if (
      readdirSync(sourceRoot, { recursive: true, encoding: "utf8" }).some(
        (source) =>
          /\.tsx?$/.test(source) &&
          statSync(join(sourceRoot, source)).mtimeMs > builtAt,
      )
    ) {
      console.warn(
        "[pi-permission-system] JS runtime is older than source; falling back to TypeScript.",
      );
      return undefined;
    }
    const id = require.resolve(runtimePath);
    // Pi clears its own import cache on /reload, not Node's. Reload rebuilt
    // code as well as recreating the module closure; never evict dependencies.
    delete require.cache[id];
    const factory = (require(id) as RuntimeBuilder)({
      "@earendil-works/pi-coding-agent": codingAgent,
      "@earendil-works/pi-tui": tui,
    });
    if (typeof factory !== "function") {
      throw new TypeError("JS runtime did not return an extension factory");
    }
    return factory;
  } catch (error) {
    // No ExtensionAPI has been passed yet, so falling back cannot duplicate
    // registered hooks. Errors after factory(pi) starts must still propagate.
    console.warn(
      "[pi-permission-system] JS runtime could not be loaded; falling back to TypeScript.",
      error,
    );
    return undefined;
  }
}
