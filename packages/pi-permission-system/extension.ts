import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative } from "node:path";
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
    const metadata = JSON.parse(
      readFileSync(
        new URL("./dist/runtime.meta.json", import.meta.url),
        "utf8",
      ),
    ) as { sourceHash?: unknown } | null;
    // npm rewrites mtimes during extraction. Check content instead, including
    // relative paths so edits, additions, removals and renames invalidate JS.
    if (
      metadata?.sourceHash !==
      sourceFingerprint(fileURLToPath(new URL("./src/", import.meta.url)))
    ) {
      console.warn(
        "[pi-permission-system] JS runtime sources changed; falling back to TypeScript.",
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

function sourceFingerprint(sourceRoot: string): string {
  const sources = readdirSync(sourceRoot, {
    recursive: true,
    withFileTypes: true,
  })
    .filter(
      (file) => file.isFile() && /\.(?:[cm]?[jt]sx?|json)$/.test(file.name),
    )
    .map((file) =>
      relative(sourceRoot, join(file.parentPath, file.name)).replaceAll(
        "\\",
        "/",
      ),
    )
    .sort();
  const hash = createHash("sha256");
  for (const file of sources) {
    const contents = readFileSync(join(sourceRoot, file));
    hash.update(JSON.stringify([file, contents.length])).update(contents);
  }
  return hash.digest("hex");
}
