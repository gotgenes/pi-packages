import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Module mocks (hoisted) ─────────────────────────────────────────────────

const { mockLoadAndMergeConfigs, mockBuildResolvedConfigLogEntry } = vi.hoisted(
  () => ({
    mockLoadAndMergeConfigs: vi.fn(),
    mockBuildResolvedConfigLogEntry: vi.fn(),
  }),
);

// Only the merge is replaced: `save()` reads the global file through the real
// loader, against the real temporary directory each test stages.
vi.mock("#src/config/config-loader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#src/config/config-loader")>()),
  loadAndMergeConfigs: mockLoadAndMergeConfigs,
}));

vi.mock("#src/config/config-reporter", () => ({
  buildResolvedConfigLogEntry: mockBuildResolvedConfigLogEntry,
}));

// ── Imports ────────────────────────────────────────────────────────────────

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  foldDeclaredCommandEffects,
  NO_DECLARED_COMMAND_EFFECTS,
} from "#src/config/command-effects-config";
import {
  getGlobalConfigDir,
  getGlobalConfigPath,
  getLegacyGlobalPolicyPath,
} from "#src/config/config-paths";
import {
  ConfigStore,
  type ConfigStoreDeps,
  type ResolvedPolicyPathProvider,
} from "#src/config/config-store";
import { DEFAULT_EXTENSION_CONFIG } from "#src/config/extension-config";
import type { ResolvedPolicyPaths } from "#src/config/policy-loader";
import { createTmpFixture, type TmpFixture } from "#test/helpers/tmp-fixture";

// ── Helpers ────────────────────────────────────────────────────────────────

function makePolicyPathProvider(): ResolvedPolicyPathProvider {
  return {
    getResolvedPolicyPaths: vi.fn(
      (): ResolvedPolicyPaths => [
        { name: "global", path: "/agent/config.json", exists: false },
        { name: "project", path: null, exists: false },
        { name: "agent", path: "/agent/agents", exists: false },
        { name: "project-agent", path: null, exists: false },
      ],
    ),
  };
}

function makeLogger() {
  return {
    debug: vi.fn<(event: string, details?: Record<string, unknown>) => void>(),
    review: vi.fn<(event: string, details?: Record<string, unknown>) => void>(),
  };
}

function makeCommandCtx(
  overrides: Partial<ExtensionCommandContext> = {},
): ExtensionCommandContext {
  return {
    cwd: "/test/project",
    ui: { notify: vi.fn(), setStatus: vi.fn() },
    ...overrides,
  } as unknown as ExtensionCommandContext;
}

function readGlobalConfig(agentDir: string): unknown {
  return JSON.parse(readFileSync(getGlobalConfigPath(agentDir), "utf-8"));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ConfigStore", () => {
  let fixture: TmpFixture;
  let agentDir: string;

  function makeStore(overrides: Partial<ConfigStoreDeps> = {}): {
    store: ConfigStore;
    logger: ReturnType<typeof makeLogger>;
  } {
    const logger = makeLogger();
    const deps: ConfigStoreDeps = {
      agentDir,
      policyPaths: makePolicyPathProvider(),
      coreCommandWords: new Set(["sed"]),
      wrapperCommandWords: new Set(["xargs"]),
      logger,
      ...overrides,
    };
    return { store: new ConfigStore(deps), logger };
  }

  function writeGlobalConfig(content: string): string {
    return fixture.file(getGlobalConfigDir(agentDir), "config.json", content);
  }

  beforeEach(() => {
    fixture = createTmpFixture();
    agentDir = fixture.dir("config-store-agent-");
    mockLoadAndMergeConfigs.mockReset().mockReturnValue({
      declaredCommandEffects: NO_DECLARED_COMMAND_EFFECTS,
      merged: { ...DEFAULT_EXTENSION_CONFIG },
      issues: [],
    });
    mockBuildResolvedConfigLogEntry
      .mockReset()
      .mockReturnValue({ resolved: true });
  });

  afterEach(() => {
    fixture.cleanup();
  });

  // ── current() ─────────────────────────────────────────────────────────

  describe("current()", () => {
    it("returns DEFAULT_EXTENSION_CONFIG before any refresh", () => {
      const { store } = makeStore();
      expect(store.current()).toEqual(DEFAULT_EXTENSION_CONFIG);
    });
  });

  // ── getConfigIssues() ─────────────────────────────────────────────────

  describe("getConfigIssues()", () => {
    it("answers empty before any refresh", () => {
      const { store } = makeStore();
      expect(store.getConfigIssues()).toEqual([]);
    });

    it("answers the issues the last load produced", () => {
      const { store } = makeStore();
      mockLoadAndMergeConfigs.mockReturnValue({
        declaredCommandEffects: NO_DECLARED_COMMAND_EFFECTS,
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: ["first issue", "second issue"],
      });
      store.refresh("/test/project", true);
      expect(store.getConfigIssues()).toEqual(["first issue", "second issue"]);
    });

    it("answers empty again once a reload finds the config clean", () => {
      const { store } = makeStore();
      mockLoadAndMergeConfigs.mockReturnValue({
        declaredCommandEffects: NO_DECLARED_COMMAND_EFFECTS,
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: ["transient issue"],
      });
      store.refresh("/test/project", true);
      mockLoadAndMergeConfigs.mockReturnValue({
        declaredCommandEffects: NO_DECLARED_COMMAND_EFFECTS,
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: [],
      });
      store.refresh("/test/project", true);
      expect(store.getConfigIssues()).toEqual([]);
    });

    it("appends a declaration the pure-reader core shadows", () => {
      const { store } = makeStore();
      mockLoadAndMergeConfigs.mockReturnValue({
        declaredCommandEffects: foldDeclaredCommandEffects(
          NO_DECLARED_COMMAND_EFFECTS,
          {
            sed: { effects: "read" },
            xargs: { effects: "read" },
            git: { effects: "read" },
          },
          "global",
        ),
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: ["first issue"],
      });
      store.refresh("/test/project", true);
      expect(store.getConfigIssues()).toEqual([
        "first issue",
        "commandEffects declares 'sed', a pure-reader core command. The core decides its effects, so the declaration is ignored; remove it.",
        "commandEffects declares 'xargs', a wrapper. A declaration describes a command's own arguments, never the command a wrapper runs, so it is ignored; remove it.",
      ]);
    });
  });

  // ── refresh() ─────────────────────────────────────────────────────────

  describe("refresh()", () => {
    it("uses the passed cwd for loadAndMergeConfigs and includes the project scope when trusted", () => {
      const { store } = makeStore();
      store.refresh("/my/project", true);
      expect(mockLoadAndMergeConfigs).toHaveBeenCalledWith(
        agentDir,
        "/my/project",
        { includeProjectScope: true },
      );
    });

    it("withholds the project scope when the project is untrusted", () => {
      const { store } = makeStore();
      store.refresh("/my/project", false);
      expect(mockLoadAndMergeConfigs).toHaveBeenCalledWith(
        agentDir,
        "/my/project",
        { includeProjectScope: false },
      );
    });

    it("uses empty string cwd when no cwd is provided", () => {
      const { store } = makeStore();
      store.refresh(undefined, true);
      expect(mockLoadAndMergeConfigs).toHaveBeenCalledWith(agentDir, "", {
        includeProjectScope: true,
      });
    });

    it("updates current() with normalized merged result", () => {
      const { store } = makeStore();
      mockLoadAndMergeConfigs.mockReturnValue({
        declaredCommandEffects: NO_DECLARED_COMMAND_EFFECTS,
        merged: { debugLog: true, permissionReviewLog: false, yoloMode: false },
        issues: [],
      });
      store.refresh(undefined, true);
      expect(store.current().debugLog).toBe(true);
      expect(store.current().permissionReviewLog).toBe(false);
    });

    it("writes config.loaded debug log", () => {
      const { store, logger } = makeStore();
      store.refresh(undefined, true);
      expect(logger.debug).toHaveBeenCalledWith(
        "config.loaded",
        expect.objectContaining({ debugLog: false }),
      );
    });

    // `config.loaded` is the durable record of what the load found, for
    // whoever is diagnosing after the fact. The operator-facing notification
    // is `ConfigIssueReporter`'s job; this field is not.
    it("records the issues on config.loaded as one joined string", () => {
      const { store, logger } = makeStore();
      mockLoadAndMergeConfigs.mockReturnValue({
        declaredCommandEffects: NO_DECLARED_COMMAND_EFFECTS,
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: ["first issue", "second issue"],
      });
      store.refresh(undefined, true);
      expect(logger.debug).toHaveBeenCalledWith(
        "config.loaded",
        expect.objectContaining({ warning: "first issue\nsecond issue" }),
      );
    });

    it("records a null warning on config.loaded when the config is clean", () => {
      const { store, logger } = makeStore();
      store.refresh(undefined, true);
      expect(logger.debug).toHaveBeenCalledWith(
        "config.loaded",
        expect.objectContaining({ warning: null }),
      );
    });

    it("carries piInfrastructureReadPaths from merged config into current()", () => {
      const { store } = makeStore();
      mockLoadAndMergeConfigs.mockReturnValue({
        declaredCommandEffects: NO_DECLARED_COMMAND_EFFECTS,
        merged: { piInfrastructureReadPaths: ["/extra/path"] },
        issues: [],
      });
      store.refresh(undefined, true);
      expect(store.current().piInfrastructureReadPaths).toEqual([
        "/extra/path",
      ]);
    });
  });

  // ── declaredCommandEffects() ──────────────────────────────────────────

  describe("declaredCommandEffects()", () => {
    const declared = foldDeclaredCommandEffects(
      NO_DECLARED_COMMAND_EFFECTS,
      { git: { subcommands: { log: "read" } } },
      "project",
    );

    it("answers none before any refresh", () => {
      const { store } = makeStore();
      expect(store.declaredCommandEffects()).toBe(NO_DECLARED_COMMAND_EFFECTS);
    });

    it("answers what the last refresh loaded", () => {
      const { store } = makeStore();
      mockLoadAndMergeConfigs.mockReturnValue({
        declaredCommandEffects: declared,
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: [],
      });
      store.refresh("/test/project", true);
      expect(store.declaredCommandEffects()).toBe(declared);
    });

    it("survives a save", () => {
      const { store } = makeStore();
      mockLoadAndMergeConfigs.mockReturnValue({
        declaredCommandEffects: declared,
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: [],
      });
      store.refresh("/test/project", true);
      store.save(
        { ...DEFAULT_EXTENSION_CONFIG, debugLog: true },
        makeCommandCtx(),
      );
      expect(readGlobalConfig(agentDir)).toEqual(
        expect.objectContaining({ debugLog: true }),
      );
      expect(store.declaredCommandEffects()).toBe(declared);
    });
  });

  // ── save() ─────────────────────────────────────────────────────────────

  describe("save()", () => {
    describe("when the write lands", () => {
      it("writes the knobs to the global config file and reports it saved", () => {
        const { store } = makeStore();
        const saved = store.save(
          { ...DEFAULT_EXTENSION_CONFIG, debugLog: true },
          makeCommandCtx(),
        );
        expect(saved).toBe(true);
        expect(readGlobalConfig(agentDir)).toEqual({
          debugLog: true,
          permissionReviewLog: true,
          doublePressToConfirm: true,
        });
      });

      it("persists the double-press setting across the next refresh", async () => {
        const { loadAndMergeConfigs } = await vi.importActual<
          typeof import("#src/config/config-loader")
        >("#src/config/config-loader");
        mockLoadAndMergeConfigs.mockImplementation(loadAndMergeConfigs);
        const { store } = makeStore();
        store.refresh(undefined, true);

        store.save(
          { ...store.current(), doublePressToConfirm: false },
          makeCommandCtx(),
        );
        store.refresh(undefined, true);

        expect(store.current().doublePressToConfirm).toBe(false);
      });

      it("keeps the keys of a valid existing file that it does not set", () => {
        writeGlobalConfig(
          JSON.stringify({
            permission: { bash: { "rm *": "deny" } },
            piInfrastructureReadPaths: ["/extra/path"],
            toolInputPreviewMaxLength: 800,
          }),
        );
        const { store } = makeStore();
        store.save(
          { ...DEFAULT_EXTENSION_CONFIG, debugLog: true },
          makeCommandCtx(),
        );
        expect(readGlobalConfig(agentDir)).toEqual({
          permission: { bash: { "rm *": "deny" } },
          piInfrastructureReadPaths: ["/extra/path"],
          toolInputPreviewMaxLength: 800,
          debugLog: true,
          permissionReviewLog: true,
          doublePressToConfirm: true,
        });
      });

      it("updates current()", () => {
        const { store } = makeStore();
        store.save(
          { ...DEFAULT_EXTENSION_CONFIG, debugLog: true },
          makeCommandCtx(),
        );
        expect(store.current().debugLog).toBe(true);
      });

      it("keeps the loaded settings it does not write in current()", () => {
        mockLoadAndMergeConfigs.mockReturnValue({
          declaredCommandEffects: NO_DECLARED_COMMAND_EFFECTS,
          merged: {
            ...DEFAULT_EXTENSION_CONFIG,
            shellTools: { exec_command: { commandArgument: "cmd" } },
          },
          issues: [],
        });
        const { store } = makeStore();
        store.refresh(undefined, true);

        store.save(
          {
            permissionReviewLog: true,
            debugLog: false,
            doublePressToConfirm: true,
          },
          makeCommandCtx(),
        );

        expect(store.current().shellTools).toEqual({
          exec_command: { commandArgument: "cmd" },
        });
      });

      it("writes the config.saved debug log", () => {
        const { store, logger } = makeStore();
        store.save({ ...DEFAULT_EXTENSION_CONFIG }, makeCommandCtx());
        expect(logger.debug).toHaveBeenCalledWith(
          "config.saved",
          expect.objectContaining({ debugLog: false }),
        );
      });
    });

    describe("when the write fails", () => {
      it("notifies an error and leaves current() and the log alone", () => {
        // An agent dir that is a regular file: creating the config directory
        // beneath it fails with ENOTDIR.
        agentDir = fixture.file(fixture.dir(), "not-a-directory");
        const mockNotify = vi.fn();
        const ctx = makeCommandCtx({ ui: { notify: mockNotify } as never });
        const { store, logger } = makeStore();
        const saved = store.save(
          { ...DEFAULT_EXTENSION_CONFIG, debugLog: true },
          ctx,
        );
        expect(saved).toBe(false);
        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining("Failed to save"),
          "error",
        );
        expect(store.current()).toEqual(DEFAULT_EXTENSION_CONFIG);
        expect(logger.debug).not.toHaveBeenCalledWith(
          "config.saved",
          expect.anything(),
        );
      });
    });

    describe("when the existing file is invalid", () => {
      it("refuses, keeping every rule the file holds", () => {
        const original =
          '{\n  "permission": { "bash": { "rm *": "deny" } },\n  "typoKey": true\n}\n';
        const path = writeGlobalConfig(original);
        const mockNotify = vi.fn();
        const ctx = makeCommandCtx({ ui: { notify: mockNotify } as never });
        const { store, logger } = makeStore();

        const saved = store.save(
          { ...DEFAULT_EXTENSION_CONFIG, debugLog: true },
          ctx,
        );

        expect(saved).toBe(false);
        expect(readFileSync(path, "utf-8")).toBe(original);
        expect(mockNotify).toHaveBeenCalledWith(
          `Refusing to save permission-system settings: '${path}' has problems a save would overwrite. Fix them by hand, then try again:\n- Unrecognized config key 'typoKey'.`,
          "error",
        );
        expect(store.current()).toEqual(DEFAULT_EXTENSION_CONFIG);
        expect(logger.debug).not.toHaveBeenCalledWith(
          "config.saved",
          expect.anything(),
        );
      });

      it("refuses a config path that is a directory, leaving nothing beside it", () => {
        const configDir = getGlobalConfigDir(agentDir);
        fixture.subdir(configDir, "config.json");
        const mockNotify = vi.fn();
        const ctx = makeCommandCtx({ ui: { notify: mockNotify } as never });
        const { store } = makeStore();

        expect(store.save({ ...DEFAULT_EXTENSION_CONFIG }, ctx)).toBe(false);

        expect(mockNotify).toHaveBeenCalledWith(
          expect.stringContaining("Refusing to save"),
          "error",
        );
        expect(readdirSync(configDir)).toEqual(["config.json"]);
      });
    });
  });

  // ── logResolvedPaths() ─────────────────────────────────────────────────

  describe("logResolvedPaths()", () => {
    it("writes config.resolved to both review and debug logs", () => {
      const { store, logger } = makeStore();
      store.logResolvedPaths();
      expect(logger.review).toHaveBeenCalledWith(
        "config.resolved",
        expect.any(Object),
      );
      expect(logger.debug).toHaveBeenCalledWith(
        "config.resolved",
        expect.any(Object),
      );
    });

    it("calls getResolvedPolicyPaths from the provider", () => {
      const mockProvider = makePolicyPathProvider();
      const { store } = makeStore({ policyPaths: mockProvider });
      store.logResolvedPaths();
      expect(mockProvider.getResolvedPolicyPaths).toHaveBeenCalled();
    });

    it("reports a legacy global policy file found in the agent dir", () => {
      fixture.file(agentDir, "pi-permissions.jsonc", "{}");
      expect(getLegacyGlobalPolicyPath(agentDir)).toBe(
        join(agentDir, "pi-permissions.jsonc"),
      );
      const { store } = makeStore();
      store.logResolvedPaths("/some/project");
      expect(mockBuildResolvedConfigLogEntry).toHaveBeenCalledWith({
        policyPaths: makePolicyPathProvider().getResolvedPolicyPaths(),
        legacyGlobalPolicyDetected: true,
        legacyProjectPolicyDetected: false,
      });
    });

    it("reports a legacy project policy file found under the given cwd", () => {
      const cwd = fixture.dir("config-store-project-");
      fixture.file(join(cwd, ".pi", "agent"), "pi-permissions.jsonc", "{}");
      const { store } = makeStore();
      store.logResolvedPaths(cwd);
      expect(mockBuildResolvedConfigLogEntry).toHaveBeenCalledWith({
        policyPaths: makePolicyPathProvider().getResolvedPolicyPaths(),
        legacyGlobalPolicyDetected: false,
        legacyProjectPolicyDetected: true,
      });
    });

    it("reports no legacy project policy when no cwd is provided", () => {
      const { store } = makeStore();
      store.logResolvedPaths();
      expect(mockBuildResolvedConfigLogEntry).toHaveBeenCalledWith({
        policyPaths: makePolicyPathProvider().getResolvedPolicyPaths(),
        legacyGlobalPolicyDetected: false,
        legacyProjectPolicyDetected: false,
      });
    });
  });
});
