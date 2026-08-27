/**
 * Shared gate-level test fixtures for gate descriptor and runner tests.
 */
import { vi } from "vitest";
import type { AskEscalator } from "#src/authority/authorizer-selection";
import type { ShellToolsConfig } from "#src/config-schema";
import type { DecisionReporter } from "#src/decision-reporter";
import type { GateDescriptor } from "#src/handlers/gates/descriptor";
import { GateRunner } from "#src/handlers/gates/runner";
import type { SkillInputGateInputs } from "#src/handlers/gates/skill-input-gate-pipeline";
import type { ToolCallGateInputs } from "#src/handlers/gates/tool-call-gate-pipeline";
import type { ToolCallContext } from "#src/handlers/gates/types";
import { pathFlavorForPlatform } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { SessionApprovalRecorder } from "#src/session-approval-recorder";
import type { SkillPromptEntry } from "#src/skill-prompt-sanitizer";
import type { ToolPreviewFormatterOptions } from "#src/tool-preview-formatter";
import type { PermissionCheckResult } from "#src/types";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";
import {
  makeGatePromptDetails,
  makePromptPayload,
} from "#test/helpers/prompt-details-fixtures";

/**
 * Permission resolver mock with an optional default check result.
 *
 * Returns a plain object whose `resolve` is a `vi.fn` so callers retain full
 * mock access (`mockReturnValue`, `mockImplementation`, `mock.calls`).
 */
export function makeResolver(defaultCheck?: PermissionCheckResult) {
  const resolve = vi.fn<ScopedPermissionResolver["resolve"]>();
  if (defaultCheck) {
    resolve.mockReturnValue(defaultCheck);
  }
  return { resolve };
}

/**
 * Gate descriptor factory with runner-test defaults.
 *
 * Carries the payload every render over this descriptor reads, so a test that
 * verifies a block path gets rendered denial text without overriding it.
 */
export function makeDescriptor(
  overrides: Partial<GateDescriptor> = {},
): GateDescriptor {
  return {
    surface: "read",
    input: {},
    payload: makePromptPayload({
      request: {
        ...makePromptPayload().request,
        matchedPattern: "*",
      },
    }),
    promptDetails: makeGatePromptDetails({
      toolCallId: "tc-1",
      toolName: "read",
    }),
    logContext: {
      source: "tool_call",
      toolCallId: "tc-1",
      toolName: "read",
    },
    decision: {
      surface: "read",
      value: "read",
    },
    ...overrides,
  };
}

/**
 * Reporter mock with independently inspectable vi.fn() stubs.
 */
export function makeReporter(
  overrides: Partial<DecisionReporter> = {},
): DecisionReporter {
  return {
    writeReviewLog: vi.fn(),
    emitDecision: vi.fn(),
    ...overrides,
  };
}

/**
 * Gate runner factory for `GateRunner` unit tests.
 *
 * Builds one `GateRunner` from four role mocks and returns `{ runner, deps }`
 * so tests can both invoke `runner.run(...)` and assert on the individual
 * mock call records (`deps.reporter.*`, `deps.resolve`, etc.).
 */
export function makeGateRunner(
  overrides: {
    resolveResult?: PermissionCheckResult;
    resolve?: ScopedPermissionResolver["resolve"];
    recordSessionApproval?: SessionApprovalRecorder["recordSessionApproval"];
    escalate?: AskEscalator["escalate"];
    reporter?: Partial<DecisionReporter>;
    /** Standing yolo setting for the runner's residual-ask grant. */
    yolo?: boolean;
    /** Live yolo reader, for tests that toggle the setting between runs. */
    isYoloEnabled?: () => boolean;
  } = {},
) {
  const reporter = makeReporter(overrides.reporter);
  const resolve =
    overrides.resolve ??
    vi
      .fn<ScopedPermissionResolver["resolve"]>()
      .mockReturnValue(
        overrides.resolveResult ?? makeCheckResult({ matchedPattern: "*" }),
      );
  const recordSessionApproval =
    overrides.recordSessionApproval ??
    (vi.fn() as SessionApprovalRecorder["recordSessionApproval"]);
  const escalate =
    overrides.escalate ??
    vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });
  const isYoloEnabled =
    overrides.isYoloEnabled ?? ((): boolean => overrides.yolo ?? false);
  const runner = new GateRunner(
    { resolve },
    { recordSessionApproval },
    { escalate },
    reporter,
    isYoloEnabled,
  );
  return {
    runner,
    deps: {
      resolve,
      recordSessionApproval,
      escalate,
      reporter,
    },
  };
}

/**
 * Tool-call context factory with bash defaults.
 *
 * path.test.ts uses different defaults (toolName "read", path input) and
 * keeps a local wrapper; bash-path.test.ts uses this factory directly.
 */
export function makeTcc(
  overrides: Partial<ToolCallContext> = {},
): ToolCallContext {
  return {
    toolName: "bash",
    agentName: null,
    input: { command: "cat .env" },
    toolCallId: "tc-1",
    cwd: "/test/project",
    ...overrides,
  };
}

/**
 * Resolver whose `resolve` dispatches on `input.path`, falling back to a
 * default result for any path not in the map.
 *
 * Use when a test needs different results for different path tokens without
 * writing a full `mockImplementation` block.
 *
 * Return type is intentionally unannotated so callers retain full `vi.fn()`
 * mock access (`mock.calls`, `toHaveBeenCalledWith`, etc.).
 */
export function makePathDispatchResolver(
  byPath: Record<string, PermissionCheckResult>,
  defaultResult: PermissionCheckResult,
) {
  const resolve = vi.fn<ScopedPermissionResolver["resolve"]>();
  resolve.mockImplementation((intent) => {
    if (intent.kind === "tool") {
      const path = (intent.input as Record<string, unknown>).path;
      if (typeof path === "string" && path in byPath) {
        return byPath[path];
      }
      return defaultResult;
    }
    const values = intent.path.matchValues();
    for (const value of values) {
      if (value in byPath) return byPath[value];
    }
    return defaultResult;
  });
  return { resolve };
}

/**
 * Path-surface check result factory.
 *
 * Shared between bash-path.test.ts and path.test.ts; both use
 * toolName "path", source "special", origin "global" as defaults.
 */
export function makeGateCheckResult(
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    toolName: "path",
    state: "allow",
    source: "special",
    origin: "global",
    ...overrides,
  };
}

/**
 * Mock of `ToolCallGateInputs` for `ToolCallGatePipeline` unit tests.
 *
 * Each method is a `vi.fn()` stub so callers retain full mock access
 * (`mock.calls`, `mockReturnValue`, etc.) on the returned object.
 * Pass `overrides` to replace individual stubs without rebuilding the whole
 * mock from scratch.
 */
export function makeGateInputs(
  overrides: {
    getActiveSkillEntries?: () => SkillPromptEntry[];
    getInfrastructureReadDirs?: () => string[];
    getToolPreviewLimits?: () => ToolPreviewFormatterOptions;
    getPathNormalizer?: () => PathNormalizer;
    getShellToolAliases?: () => ShellToolsConfig | undefined;
  } = {},
): ToolCallGateInputs {
  return {
    getActiveSkillEntries:
      overrides.getActiveSkillEntries ??
      vi.fn<() => SkillPromptEntry[]>(() => []),
    getInfrastructureReadDirs:
      overrides.getInfrastructureReadDirs ?? vi.fn<() => string[]>(() => []),
    getToolPreviewLimits:
      overrides.getToolPreviewLimits ??
      vi.fn<() => ToolPreviewFormatterOptions>(() => ({
        toolInputPreviewMaxLength: 500,
        toolTextSummaryMaxLength: 100,
      })),
    getPathNormalizer:
      overrides.getPathNormalizer ??
      vi.fn<() => PathNormalizer>(
        () =>
          new PathNormalizer(
            pathFlavorForPlatform(process.platform),
            "/test/cwd",
          ),
      ),
    getShellToolAliases:
      overrides.getShellToolAliases ??
      vi.fn<() => ShellToolsConfig | undefined>(() => undefined),
  };
}

/**
 * Mock of `SkillInputGateInputs` for `SkillInputGatePipeline` unit tests.
 *
 * Returns a plain object with a `checkPermission` `vi.fn()` stub so callers
 * retain full mock access (`mockReturnValue`, `mock.calls`, etc.).
 */
export function makeSkillInputInputs(
  overrides: { checkPermission?: SkillInputGateInputs["checkPermission"] } = {},
): SkillInputGateInputs {
  return {
    checkPermission:
      overrides.checkPermission ??
      vi
        .fn<SkillInputGateInputs["checkPermission"]>()
        .mockReturnValue(makeCheckResult()),
  };
}

/**
 * Mock `GateNotifier` for `SkillInputGatePipeline` unit tests.
 *
 * Return type is intentionally unannotated so callers retain full `vi.fn()`
 * mock access (`mock.calls`, `toHaveBeenCalledWith`, etc.) — annotating with
 * `GateNotifier` would erase `Mock<...>` methods from the inferred type.
 */
export function makeNotifier() {
  return {
    warn: vi.fn<(message: string) => void>(),
  };
}
