import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import * as tui from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const cache: Record<string, unknown> = {};
  const sources: Record<string, string> = {};
  return {
    exists: vi.fn(),
    readdir: vi.fn(),
    readFile: vi.fn(),
    stat: vi.fn(),
    require: vi.fn(),
    createExtension: vi.fn(),
    compiledFactory: vi.fn(),
    sourceFactory: vi.fn(),
    cache,
    sources,
    metadata: "",
  };
});

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: mocks.exists,
  readdirSync: mocks.readdir,
  readFileSync: mocks.readFile,
  statSync: mocks.stat,
}));
vi.mock("node:module", () => ({
  createRequire: () =>
    Object.assign(mocks.require, {
      resolve: (path: string) => path,
      cache: mocks.cache,
    }),
}));
vi.mock("../src/index.ts", () => ({ default: mocks.sourceFactory }));

// Reload the entry to model Pi's /reload, not to isolate domain objects.
const loadEntry = () => import("../extension");

describe("runtime entry", () => {
  beforeEach(() => {
    vi.resetModules();
    for (const path of Object.keys(mocks.sources))
      Reflect.deleteProperty(mocks.sources, path);
    Object.assign(mocks.sources, {
      "index.ts": "export const entry = 1;\n",
      "policy/permission-manager.ts": "export const policy = 1;\n",
      "policy/data.json": "{}\n",
    });
    // Independent fixture encoding pins the metadata protocol: sorted POSIX
    // relative paths and byte lengths as JSON, followed by the original bytes.
    const hash = createHash("sha256");
    for (const path of Object.keys(mocks.sources).toSorted()) {
      const contents = Buffer.from(mocks.sources[path] ?? "");
      hash.update(JSON.stringify([path, contents.length])).update(contents);
    }
    mocks.metadata = JSON.stringify({ sourceHash: hash.digest("hex") });
    mocks.exists.mockReset().mockReturnValue(true);
    // npm stamps source files after the bundle. Matching contents must still
    // select native JS rather than consulting these extraction timestamps.
    mocks.stat.mockReset().mockImplementation((path: string) => ({
      mtimeMs: path.endsWith("runtime.cjs") ? 200 : 300,
    }));
    mocks.readdir
      .mockReset()
      .mockImplementation(
        (root: string, options: { withFileTypes?: boolean }) => {
          const paths = Object.keys(mocks.sources).toReversed();
          return options.withFileTypes
            ? paths.map((path) => ({
                name: path.split("/").at(-1),
                parentPath: join(root, ...path.split("/").slice(0, -1)),
                isFile: () => true,
              }))
            : paths;
        },
      );
    mocks.readFile.mockReset().mockImplementation((target: string | URL) => {
      const path = typeof target === "string" ? target : fileURLToPath(target);
      if (path.endsWith("runtime.meta.json")) return mocks.metadata;
      const relative = path.replaceAll("\\", "/").split("/src/")[1];
      if (!relative || !(relative in mocks.sources))
        throw new Error(`Unexpected source: ${path}`);
      return Buffer.from(mocks.sources[relative] ?? "");
    });
    mocks.require.mockReset().mockReturnValue(mocks.createExtension);
    mocks.createExtension.mockReset().mockReturnValue(mocks.compiledFactory);
    mocks.compiledFactory.mockReset();
    mocks.sourceFactory.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => vi.restoreAllMocks());

  it("loads matching source contents without a warning and supplies host modules", async () => {
    const { default: extension } = await loadEntry();
    const pi = {} as ExtensionAPI;
    await extension(pi);
    expect(mocks.require).toHaveBeenCalledWith(
      expect.stringMatching(/[/\\]dist[/\\]runtime\.cjs$/),
    );
    expect(mocks.createExtension).toHaveBeenCalledWith({
      "@earendil-works/pi-coding-agent": codingAgent,
      "@earendil-works/pi-tui": tui,
    });
    expect(mocks.compiledFactory).toHaveBeenCalledExactlyOnceWith(pi);
    expect(mocks.sourceFactory).not.toHaveBeenCalled();
    expect(console.warn).not.toHaveBeenCalled();
    expect(mocks.stat).not.toHaveBeenCalled();
  });

  it.each(["index.ts", "policy/permission-manager.ts", "policy/data.json"])(
    "uses TS with a warning when %s changes, irrespective of timestamps",
    async (path) => {
      mocks.sources[path] += "changed";
      const { default: extension } = await loadEntry();
      const pi = {} as ExtensionAPI;
      await extension(pi);
      expect(mocks.sourceFactory).toHaveBeenCalledExactlyOnceWith(pi);
      expect(mocks.require).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledExactlyOnceWith(
        "[pi-permission-system] JS runtime sources changed; falling back to TypeScript.",
      );
    },
  );

  it.each(["added", "removed", "renamed"])(
    "detects a source file being %s",
    async (change) => {
      if (change !== "added") Reflect.deleteProperty(mocks.sources, "index.ts");
      if (change !== "removed")
        mocks.sources["other.ts"] = "export const entry = 1;\n";
      const { default: extension } = await loadEntry();
      const pi = {} as ExtensionAPI;
      await extension(pi);
      expect(mocks.sourceFactory).toHaveBeenCalledExactlyOnceWith(pi);
      expect(mocks.require).not.toHaveBeenCalled();
    },
  );

  it.each(["missing", "invalid"])(
    "uses TS safely when metadata is %s",
    async (kind) => {
      if (kind === "missing") mocks.readFile.mockImplementation(failLoad);
      else mocks.metadata = "not JSON";
      const { default: extension } = await loadEntry();
      const pi = {} as ExtensionAPI;
      await extension(pi);
      expect(mocks.sourceFactory).toHaveBeenCalledExactlyOnceWith(pi);
      expect(mocks.require).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        "[pi-permission-system] JS runtime could not be loaded; falling back to TypeScript.",
        expect.any(SyntaxError),
      );
    },
  );

  it("uses TS when source freshness cannot be checked", async () => {
    mocks.readdir.mockImplementation(failLoad);
    const { default: extension } = await loadEntry();
    const pi = {} as ExtensionAPI;
    await extension(pi);
    expect(mocks.sourceFactory).toHaveBeenCalledExactlyOnceWith(pi);
    expect(mocks.require).not.toHaveBeenCalled();
  });

  it("uses TS without reading metadata or sources when the runtime is missing", async () => {
    mocks.exists.mockReturnValue(false);
    const { default: extension } = await loadEntry();
    const pi = {} as ExtensionAPI;
    await extension(pi);
    expect(mocks.sourceFactory).toHaveBeenCalledExactlyOnceWith(pi);
    expect(mocks.require).not.toHaveBeenCalled();
    expect(mocks.readdir).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });

  it("does not retry the source after compiled initialization fails", async () => {
    mocks.compiledFactory.mockImplementation(() => {
      throw new Error("initialization failed");
    });
    const { default: extension } = await loadEntry();
    await expect(extension({} as ExtensionAPI)).rejects.toThrow(
      "initialization failed",
    );
    expect(mocks.sourceFactory).not.toHaveBeenCalled();
  });

  it("evicts stale native code and recreates module state on reload", async () => {
    const first = await loadEntry();
    await first.default({} as ExtensionAPI);
    const id = mocks.require.mock.calls[0]?.[0] as string;
    mocks.cache[id] = { exports: "stale runtime" };
    vi.resetModules();
    const second = await loadEntry();
    await second.default({} as ExtensionAPI);
    expect(Object.hasOwn(mocks.cache, id)).toBe(false);
    expect(mocks.createExtension).toHaveBeenCalledTimes(2);
    expect(mocks.compiledFactory).toHaveBeenCalledTimes(2);
  });

  it.each(["native loading", "module evaluation", "invalid factory"])(
    "falls back to TS on %s failure",
    async (stage) => {
      if (stage === "invalid factory")
        mocks.createExtension.mockReturnValue({});
      else
        (stage === "native loading"
          ? mocks.require
          : mocks.createExtension
        ).mockImplementation(failLoad);
      const { default: extension } = await loadEntry();
      const pi = {} as ExtensionAPI;
      await extension(pi);
      expect(mocks.sourceFactory).toHaveBeenCalledExactlyOnceWith(pi);
      expect(mocks.compiledFactory).not.toHaveBeenCalled();
      expect(console.warn).toHaveBeenCalledWith(
        "[pi-permission-system] JS runtime could not be loaded; falling back to TypeScript.",
        expect.any(stage === "invalid factory" ? TypeError : SyntaxError),
      );
    },
  );

  it("propagates a TS initialization error instead of running ungated", async () => {
    mocks.readFile.mockImplementation(failLoad);
    mocks.sourceFactory.mockImplementation(() => {
      throw new Error("source initialization failed");
    });
    const { default: extension } = await loadEntry();
    await expect(extension({} as ExtensionAPI)).rejects.toThrow(
      "source initialization failed",
    );
    expect(mocks.sourceFactory).toHaveBeenCalledTimes(1);
  });
});

function failLoad(): never {
  throw new SyntaxError("broken runtime");
}
