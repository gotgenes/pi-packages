import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Module mocks (hoisted) ─────────────────────────────────────────────────

const {
  mockLoadAndMergeConfigs,
  mockSyncPermissionSystemStatus,
  mockBuildResolvedConfigLogEntry,
} = vi.hoisted(() => ({
  mockLoadAndMergeConfigs: vi.fn(),
  mockSyncPermissionSystemStatus: vi.fn(),
  mockBuildResolvedConfigLogEntry: vi.fn(),
}));

// Only the merge is replaced: `save()` reads the global file through the real
// loader, against the real temporary directory each test stages.
vi.mock("#src/config/config-loader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("#src/config/config-loader")>()),
  loadAndMergeConfigs: mockLoadAndMergeConfigs,
}));

vi.mock("#src/config/status", () => ({
  syncPermissionSystemStatus: mockSyncPermissionSystemStatus,
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

function makePolicyPathProvider(
  paths?: Partial<ResolvedPolicyPaths>,
): ResolvedPolicyPathProvider {
  return {
    getResolvedPolicyPaths: vi.fn(
      (): ResolvedPolicyPaths => ({
        globalConfigPath: "/agent/config.json",
        globalConfigExists: false,
        projectConfigPath: null,
        projectConfigExists: false,
        agentsDir: "/agent/agents",
        agentsDirExists: false,
        projectAgentsDir: null,
        projectAgentsDirExists: false,
        ...paths,
      }),
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
    mockSyncPermissionSystemStatus.mockReset();
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
        expect.any(String),
        { includeProjectScope: true },
      );
    });

    it("withholds the project scope when the project is untrusted", () => {
      const { store } = makeStore();
      store.refresh("/my/project", false);
      expect(mockLoadAndMergeConfigs).toHaveBeenCalledWith(
        agentDir,
        "/my/project",
        expect.any(String),
        { includeProjectScope: false },
      );
    });

    it("uses empty string cwd when no cwd is provided", () => {
      const { store } = makeStore();
      store.refresh(undefined, true);
      expect(mockLoadAndMergeConfigs).toHaveBeenCalledWith(
        agentDir,
        "",
        expect.any(String),
        { includeProjectScope: true },
      );
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

    // The load takes no context now, so it cannot notify or sync the status
    // bar even by accident, which is the point: `PermissionSession` owns the
    // status sync and `ConfigIssueReporter` owns the warning (#933).
    it("does not sync the status bar", () => {
      const { store } = makeStore();
      store.refresh("/my/project", true);
      expect(mockSyncPermissionSystemStatus).not.toHaveBeenCalled();
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

    it("survives a save, which rebuilds the runtime config", () => {
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
      it("writes the knobs to the global config file", () => {
        const { store } = makeStore();
        store.save(
          { ...DEFAULT_EXTENSION_CONFIG, debugLog: true },
          makeCommandCtx(),
        );
        expect(readGlobalConfig(agentDir)).toEqual({
          debugLog: true,
          permissionReviewLog: true,
          yoloMode: false,
        });
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
          { ...DEFAULT_EXTENSION_CONFIG, yoloMode: true },
          makeCommandCtx(),
        );
        expect(readGlobalConfig(agentDir)).toEqual({
          permission: { bash: { "rm *": "deny" } },
          piInfrastructureReadPaths: ["/extra/path"],
          toolInputPreviewMaxLength: 800,
          debugLog: false,
          permissionReviewLog: true,
          yoloMode: true,
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

      it("syncs the status bar", () => {
        const { store } = makeStore();
        const ctx = makeCommandCtx();
        store.save({ ...DEFAULT_EXTENSION_CONFIG }, ctx);
        expect(mockSyncPermissionSystemStatus).toHaveBeenCalledWith(
          ctx,
          expect.any(Object),
        );
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
        store.save({ ...DEFAULT_EXTENSION_CONFIG, debugLog: true }, ctx);
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

      it("leaves no temporary file beside the target", () => {
        // A directory where the file should be: the rename onto it fails.
        const configDir = getGlobalConfigDir(agentDir);
        fixture.subdir(configDir, "config.json");
        const mockNotify = vi.fn();
        const ctx = makeCommandCtx({ ui: { notify: mockNotify } as never });
        const { store } = makeStore();
        store.save({ ...DEFAULT_EXTENSION_CONFIG }, ctx);
        expect(mockNotify).toHaveBeenCalledWith(expect.any(String), "error");
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

    // The extension-config legacy path lives under the package's own install
    // directory, which the test does not control, so only the two flags the
    // fixture decides are asserted.
    it("reports a legacy global policy file found in the agent dir", () => {
      fixture.file(agentDir, "pi-permissions.jsonc", "{}");
      expect(getLegacyGlobalPolicyPath(agentDir)).toBe(
        join(agentDir, "pi-permissions.jsonc"),
      );
      const { store } = makeStore();
      store.logResolvedPaths("/some/project");
      expect(mockBuildResolvedConfigLogEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyGlobalPolicyDetected: true,
          legacyProjectPolicyDetected: false,
        }),
      );
    });

    it("reports no legacy project policy when no cwd is provided", () => {
      const { store } = makeStore();
      store.logResolvedPaths();
      expect(mockBuildResolvedConfigLogEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyGlobalPolicyDetected: false,
          legacyProjectPolicyDetected: false,
        }),
      );
    });
  });
});
