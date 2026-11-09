import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as codingAgent from "@earendil-works/pi-coding-agent";
import * as tui from "@earendil-works/pi-tui";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const cache: Record<string, unknown> = {};
  return {
    exists: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    require: vi.fn(),
    createExtension: vi.fn(),
    compiledFactory: vi.fn(),
    sourceFactory: vi.fn(),
    cache,
  };
});

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  existsSync: mocks.exists,
  readdirSync: mocks.readdir,
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
    mocks.exists.mockReset().mockReturnValue(true);
    mocks.readdir
      .mockReset()
      .mockReturnValue([
        "index.ts",
        "policy/permission-manager.ts",
        "notes.txt",
      ]);
    mocks.stat.mockReset().mockImplementation((path: string) => ({
      mtimeMs: path.endsWith("runtime.cjs") ? 200 : 100,
    }));
    mocks.require.mockReset().mockReturnValue(mocks.createExtension);
    mocks.createExtension.mockReset().mockReturnValue(mocks.compiledFactory);
    mocks.compiledFactory.mockReset();
    mocks.sourceFactory.mockReset();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loads a runtime newer than its sources and supplies the host modules", async () => {
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
  });

  it("uses TS when a nested source is newer than the runtime", async () => {
    mocks.stat.mockImplementation((path: string) => ({
      mtimeMs: path.endsWith("permission-manager.ts") ? 300 : 200,
    }));
    const { default: extension } = await loadEntry();
    const pi = {} as ExtensionAPI;
    await extension(pi);
    expect(mocks.sourceFactory).toHaveBeenCalledExactlyOnceWith(pi);
    expect(mocks.require).not.toHaveBeenCalled();
    expect(mocks.readdir).toHaveBeenCalledWith(
      expect.stringMatching(/[/\\]src[/\\]?$/),
      { recursive: true, encoding: "utf8" },
    );
  });

  it("loads packed JS when the source and runtime timestamps are equal", async () => {
    mocks.stat.mockReturnValue({ mtimeMs: 100 });
    const { default: extension } = await loadEntry();
    const pi = {} as ExtensionAPI;
    await extension(pi);
    expect(mocks.compiledFactory).toHaveBeenCalledExactlyOnceWith(pi);
    expect(mocks.sourceFactory).not.toHaveBeenCalled();
  });

  it("uses TS when source freshness cannot be checked", async () => {
    mocks.readdir.mockImplementation(failLoad);
    const { default: extension } = await loadEntry();
    const pi = {} as ExtensionAPI;
    await extension(pi);
    expect(mocks.sourceFactory).toHaveBeenCalledExactlyOnceWith(pi);
    expect(mocks.require).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledWith(
      "[pi-permission-system] JS runtime could not be loaded; falling back to TypeScript.",
      expect.any(SyntaxError),
    );
  });

  it("uses the TS source in a checkout with no built runtime", async () => {
    mocks.exists.mockReturnValue(false);
    const { default: extension } = await loadEntry();
    const pi = {} as ExtensionAPI;
    await extension(pi);
    expect(mocks.sourceFactory).toHaveBeenCalledExactlyOnceWith(pi);
    expect(mocks.require).not.toHaveBeenCalled();
    expect(mocks.readdir).not.toHaveBeenCalled();
    expect(mocks.stat).not.toHaveBeenCalled();
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
    mocks.require.mockImplementation(failLoad);
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
