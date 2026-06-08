import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Module mocks (hoisted) ─────────────────────────────────────────────────

const {
  mockLoadAndMergeConfigs,
  mockLoadUnifiedConfig,
  mockSyncPermissionSystemStatus,
  mockBuildResolvedConfigLogEntry,
  mockExistsSync,
  mockMkdirSync,
  mockWriteFileSync,
  mockRenameSync,
  mockUnlinkSync,
} = vi.hoisted(() => ({
  mockLoadAndMergeConfigs: vi.fn(),
  mockLoadUnifiedConfig: vi.fn(),
  mockSyncPermissionSystemStatus: vi.fn(),
  mockBuildResolvedConfigLogEntry: vi.fn(),
  mockExistsSync: vi.fn<(path: string) => boolean>(),
  mockMkdirSync: vi.fn(),
  mockWriteFileSync: vi.fn(),
  mockRenameSync: vi.fn(),
  mockUnlinkSync: vi.fn(),
}));

vi.mock("../src/config-loader", () => ({
  loadAndMergeConfigs: mockLoadAndMergeConfigs,
  loadUnifiedConfig: mockLoadUnifiedConfig,
}));

vi.mock("../src/status", () => ({
  syncPermissionSystemStatus: mockSyncPermissionSystemStatus,
}));

vi.mock("../src/config-reporter", () => ({
  buildResolvedConfigLogEntry: mockBuildResolvedConfigLogEntry,
}));

vi.mock("node:fs", () => ({
  existsSync: mockExistsSync,
  mkdirSync: mockMkdirSync,
  writeFileSync: mockWriteFileSync,
  renameSync: mockRenameSync,
  unlinkSync: mockUnlinkSync,
  default: {
    existsSync: mockExistsSync,
    mkdirSync: mockMkdirSync,
    writeFileSync: mockWriteFileSync,
    renameSync: mockRenameSync,
    unlinkSync: mockUnlinkSync,
  },
}));

// ── Imports ────────────────────────────────────────────────────────────────

import type {
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import {
  ConfigStore,
  type ConfigStoreDeps,
  type ResolvedPolicyPathProvider,
} from "#src/config-store";
import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import type { ResolvedPolicyPaths } from "#src/policy-loader";

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

function makeCtx(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
  return {
    cwd: "/test/project",
    hasUI: false,
    ui: { notify: vi.fn(), setStatus: vi.fn() },
    sessionManager: { getEntries: vi.fn(), addEntry: vi.fn() },
    ...overrides,
  } as unknown as ExtensionContext;
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

function makeStore(overrides: Partial<ConfigStoreDeps> = {}): {
  store: ConfigStore;
  logger: ReturnType<typeof makeLogger>;
} {
  const logger = makeLogger();
  const deps: ConfigStoreDeps = {
    agentDir: "/test/agent",
    policyPaths: makePolicyPathProvider(),
    logger,
    ...overrides,
  };
  return { store: new ConfigStore(deps), logger };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("ConfigStore", () => {
  beforeEach(() => {
    mockLoadAndMergeConfigs.mockReset().mockReturnValue({
      merged: { ...DEFAULT_EXTENSION_CONFIG },
      issues: [],
    });
    mockLoadUnifiedConfig.mockReset().mockReturnValue({ config: {} });
    mockSyncPermissionSystemStatus.mockReset();
    mockBuildResolvedConfigLogEntry
      .mockReset()
      .mockReturnValue({ resolved: true });
    mockExistsSync.mockReset().mockReturnValue(false);
    mockMkdirSync.mockReset();
    mockWriteFileSync.mockReset();
    mockRenameSync.mockReset();
    mockUnlinkSync.mockReset();
  });

  // ── current() ─────────────────────────────────────────────────────────

  describe("current()", () => {
    it("returns DEFAULT_EXTENSION_CONFIG before any refresh", () => {
      const { store } = makeStore();
      expect(store.current()).toEqual(DEFAULT_EXTENSION_CONFIG);
    });
  });

  // ── refresh() ─────────────────────────────────────────────────────────

  describe("refresh()", () => {
    it("uses the passed ctx cwd for loadAndMergeConfigs", () => {
      const { store } = makeStore();
      store.refresh(makeCtx({ cwd: "/my/project" }));
      expect(mockLoadAndMergeConfigs).toHaveBeenCalledWith(
        "/test/agent",
        "/my/project",
        expect.any(String),
      );
    });

    it("uses empty string cwd when no ctx is provided", () => {
      const { store } = makeStore();
      store.refresh();
      expect(mockLoadAndMergeConfigs).toHaveBeenCalledWith(
        "/test/agent",
        "",
        expect.any(String),
      );
    });

    it("updates current() with normalized merged result", () => {
      const { store } = makeStore();
      mockLoadAndMergeConfigs.mockReturnValue({
        merged: { debugLog: true, permissionReviewLog: false, yoloMode: false },
        issues: [],
      });
      store.refresh();
      expect(store.current().debugLog).toBe(true);
      expect(store.current().permissionReviewLog).toBe(false);
    });

    it("keeps optional runtime knobs from merged config", () => {
      const { store } = makeStore();
      mockLoadAndMergeConfigs.mockReturnValue({
        merged: {
          ...DEFAULT_EXTENSION_CONFIG,
          piInfrastructureReadPaths: ["/opt/pi"],
          toolInputPreviewMaxLength: 400,
          toolTextSummaryMaxLength: 120,
        },
        issues: [],
      });

      store.refresh();

      expect(store.current()).toEqual({
        ...DEFAULT_EXTENSION_CONFIG,
        piInfrastructureReadPaths: ["/opt/pi"],
        toolInputPreviewMaxLength: 400,
        toolTextSummaryMaxLength: 120,
      });
    });

    it("writes config.loaded debug log", () => {
      const { store, logger } = makeStore();
      store.refresh();
      expect(logger.debug).toHaveBeenCalledWith(
        "config.loaded",
        expect.objectContaining({ debugLog: false }),
      );
    });

    it("sets warning when issues are present", () => {
      const { store } = makeStore();
      const ctx = makeCtx({ hasUI: false });
      mockLoadAndMergeConfigs.mockReturnValue({
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: ["legacy config detected"],
      });
      store.refresh(ctx);
      // Verify the warning is tracked (next identical call should not re-notify)
      const mockNotify = vi.fn();
      const ctx2 = makeCtx({
        hasUI: true,
        ui: { notify: mockNotify } as never,
      });
      mockLoadAndMergeConfigs.mockReturnValue({
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: ["legacy config detected"],
      });
      store.refresh(ctx2);
      // Same warning — should not re-notify
      expect(mockNotify).not.toHaveBeenCalled();
    });

    it("notifies UI when a new warning appears and hasUI is true", () => {
      const mockNotify = vi.fn();
      const { store } = makeStore();
      const ctx = makeCtx({ hasUI: true, ui: { notify: mockNotify } as never });
      mockLoadAndMergeConfigs.mockReturnValue({
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: ["new warning"],
      });
      store.refresh(ctx);
      expect(mockNotify).toHaveBeenCalledWith("new warning", "warning");
    });

    it("does not re-notify the same warning on subsequent calls", () => {
      const mockNotify = vi.fn();
      const { store } = makeStore();
      const ctx = makeCtx({ hasUI: true, ui: { notify: mockNotify } as never });
      mockLoadAndMergeConfigs.mockReturnValue({
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: ["persistent warning"],
      });
      store.refresh(ctx);
      store.refresh(ctx);
      expect(mockNotify).toHaveBeenCalledTimes(1);
    });

    it("clears warning when no issues on next refresh", () => {
      const mockNotify = vi.fn();
      const { store } = makeStore();
      // First call: set a warning
      const ctxWithUI = makeCtx({
        hasUI: true,
        ui: { notify: mockNotify } as never,
      });
      mockLoadAndMergeConfigs.mockReturnValue({
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: ["warning"],
      });
      store.refresh(ctxWithUI);
      // Second call: no issues — warning should clear
      mockLoadAndMergeConfigs.mockReturnValue({
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: [],
      });
      store.refresh();
      // Third call: same warning reappears — should notify again (dedup cleared)
      mockLoadAndMergeConfigs.mockReturnValue({
        merged: { ...DEFAULT_EXTENSION_CONFIG },
        issues: ["warning"],
      });
      store.refresh(ctxWithUI);
      expect(mockNotify).toHaveBeenCalledTimes(2);
    });

    it("calls syncPermissionSystemStatus when hasUI is true", () => {
      const { store } = makeStore();
      const ctx = makeCtx({ hasUI: true });
      store.refresh(ctx);
      expect(mockSyncPermissionSystemStatus).toHaveBeenCalledWith(
        ctx,
        expect.any(Object),
      );
    });

    it("does not call syncPermissionSystemStatus when hasUI is false", () => {
      const { store } = makeStore();
      const ctx = makeCtx({ hasUI: false });
      store.refresh(ctx);
      expect(mockSyncPermissionSystemStatus).not.toHaveBeenCalled();
    });
  });

  // ── save() ─────────────────────────────────────────────────────────────

  describe("save()", () => {
    it("writes merged config to the global path", () => {
      const { store } = makeStore();
      mockLoadUnifiedConfig.mockReturnValue({
        config: { permission: { "*": "ask" } },
      });
      const next = { ...DEFAULT_EXTENSION_CONFIG, debugLog: true };
      const ctx = makeCommandCtx();
      store.save(next, ctx);
      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining(".tmp"),
        expect.stringContaining('"debugLog": true'),
        "utf-8",
      );
      expect(mockRenameSync).toHaveBeenCalled();
    });

    it("writes optional runtime knobs without dropping existing permission", () => {
      const { store } = makeStore();
      mockLoadUnifiedConfig.mockReturnValue({
        config: { permission: { "*": "ask" } },
      });
      const next = {
        ...DEFAULT_EXTENSION_CONFIG,
        piInfrastructureReadPaths: ["/opt/pi"],
        toolInputPreviewMaxLength: 400,
        toolTextSummaryMaxLength: 120,
      };

      store.save(next, makeCommandCtx());

      const [, written] = mockWriteFileSync.mock.calls[0] as [
        string,
        string,
        string,
      ];
      expect(JSON.parse(written)).toEqual({
        permission: { "*": "ask" },
        debugLog: false,
        permissionReviewLog: true,
        yoloMode: false,
        piInfrastructureReadPaths: ["/opt/pi"],
        toolInputPreviewMaxLength: 400,
        toolTextSummaryMaxLength: 120,
      });
    });

    it("updates current() after a successful save", () => {
      const { store } = makeStore();
      const next = { ...DEFAULT_EXTENSION_CONFIG, debugLog: true };
      store.save(next, makeCommandCtx());
      expect(store.current().debugLog).toBe(true);
    });

    it("calls syncPermissionSystemStatus after a successful save", () => {
      const { store } = makeStore();
      const ctx = makeCommandCtx();
      store.save({ ...DEFAULT_EXTENSION_CONFIG }, ctx);
      expect(mockSyncPermissionSystemStatus).toHaveBeenCalledWith(
        ctx,
        expect.any(Object),
      );
    });

    it("writes config.saved debug log after a successful save", () => {
      const { store, logger } = makeStore();
      store.save({ ...DEFAULT_EXTENSION_CONFIG }, makeCommandCtx());
      expect(logger.debug).toHaveBeenCalledWith(
        "config.saved",
        expect.objectContaining({ debugLog: false }),
      );
    });

    it("notifies with error and returns early when write fails", () => {
      const mockNotify = vi.fn();
      const ctx = makeCommandCtx({ ui: { notify: mockNotify } as never });
      const { store, logger } = makeStore();
      mockMkdirSync.mockImplementation(() => {
        throw new Error("disk full");
      });
      store.save({ ...DEFAULT_EXTENSION_CONFIG }, ctx);
      expect(mockNotify).toHaveBeenCalledWith(
        expect.stringContaining("Failed to save"),
        "error",
      );
      // current() is not updated on failure
      expect(store.current()).toEqual(DEFAULT_EXTENSION_CONFIG);
      // no debug log on failure
      expect(logger.debug).not.toHaveBeenCalledWith(
        "config.saved",
        expect.anything(),
      );
    });

    it("attempts cleanup of tmp file when write fails and tmp exists", () => {
      const ctx = makeCommandCtx();
      const { store } = makeStore();
      mockMkdirSync.mockImplementation(() => {
        throw new Error("disk full");
      });
      mockExistsSync.mockReturnValue(true);
      store.save({ ...DEFAULT_EXTENSION_CONFIG }, ctx);
      expect(mockUnlinkSync).toHaveBeenCalled();
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

    it("passes legacy detection results to buildResolvedConfigLogEntry", () => {
      const { store } = makeStore();
      // Make one legacy path exist
      mockExistsSync.mockImplementation((p: string) =>
        p.includes("policies.json"),
      );
      store.logResolvedPaths("/some/project");
      expect(mockBuildResolvedConfigLogEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          legacyGlobalPolicyDetected: expect.any(Boolean),
          legacyProjectPolicyDetected: expect.any(Boolean),
          legacyExtensionConfigDetected: expect.any(Boolean),
        }),
      );
    });

    it("does not check project legacy path when no cwd is provided", () => {
      const { store } = makeStore();
      store.logResolvedPaths(); // no cwd
      // existsSync called for global and ext-config legacy paths only (not project)
      const calls = mockExistsSync.mock.calls.map(([p]: [string]) => p);
      const projectCalls = calls.filter(
        (p) => p.includes("/null/") || p.includes("null"),
      );
      expect(projectCalls).toHaveLength(0);
    });
  });
});
