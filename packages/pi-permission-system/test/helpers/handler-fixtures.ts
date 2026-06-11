/**
 * Shared handler-level test fixtures for PermissionGateHandler tests.
 *
 * `makeHandler` builds a real PermissionSession + PermissionResolver and wires
 * them into the handler and pipelines exactly as `index.ts` does.
 * Call-site overrides for permission results flow through
 * `permissionManager.checkPermission`; session state overrides are applied
 * via vi.spyOn on the real session instance.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { vi } from "vitest";

import { GateDecisionReporter } from "#src/decision-reporter";
import type { GatePrompter } from "#src/gate-prompter";
import { GateRunner } from "#src/handlers/gates/runner";
import {
  type SkillInputGateInputs,
  SkillInputGatePipeline,
} from "#src/handlers/gates/skill-input-gate-pipeline";
import {
  type ToolCallGateInputs,
  ToolCallGatePipeline,
} from "#src/handlers/gates/tool-call-gate-pipeline";
import { PermissionGateHandler } from "#src/handlers/permission-gate-handler";
import type { PermissionDecisionEvent } from "#src/permission-events";
import { PERMISSIONS_DECISION_CHANNEL } from "#src/permission-events";
import type { Rule } from "#src/rule";
import { SessionRules } from "#src/session-rules";
import type { ToolRegistry } from "#src/tool-registry";
import type { PermissionCheckResult, PermissionState } from "#src/types";
import {
  makeRealResolver,
  makeRealSession,
} from "#test/helpers/session-fixtures";

// ── MockGateHandlerSession ────────────────────────────────────────────────

/**
 * Mock type for gate-pipeline inputs (ToolCallGateInputs + SkillInputGateInputs).
 *
 * Used by `makeSurfaceCheck`, `makeBashCommandCheck`, and the `session`
 * override bag in `makeHandler`.  The `GateHandlerSession` role (activate +
 * resolveAgentName) is now satisfied by the real `PermissionSession`; this
 * type covers only the pipeline input surface.
 *
 * The 4-arg `checkPermission` is a superset of `SkillInputGateInputs` —
 * it routes through `permissionManager.checkPermission` in production.
 */
export type MockGateHandlerSession = ToolCallGateInputs &
  SkillInputGateInputs & {
    /** 4-arg form so surface-check mocks can receive optional rules. */
    checkPermission(
      surface: string,
      input: unknown,
      agentName?: string,
      rules?: Rule[],
    ): PermissionCheckResult;
  };

// ── Small utility factories ───────────────────────────────────────────────

export function makeEvents() {
  return {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => undefined),
  };
}

export function makeCtx(
  overrides: Partial<ExtensionContext> = {},
): ExtensionContext {
  return {
    cwd: "/test/project",
    hasUI: true,
    ui: {
      setStatus: vi.fn(),
      notify: vi.fn(),
      select: vi.fn(),
      input: vi.fn(),
    },
    sessionManager: {
      getEntries: vi.fn().mockReturnValue([]),
      getSessionDir: vi.fn().mockReturnValue("/sessions/test"),
      addEntry: vi.fn(),
    },
    ...overrides,
  } as unknown as ExtensionContext;
}

export function makeToolCallEvent(
  toolName: string,
  extraFields: Record<string, unknown> = {},
) {
  return {
    type: "tool_call",
    toolCallId: "tc-1",
    name: toolName,
    input: {},
    ...extraFields,
  };
}

/**
 * Neutral-default check-result builder.
 *
 * Pass exactly the fields the original fixture hard-coded so divergent
 * defaults across test files are preserved at their call sites.
 */
export function makeCheckResult(
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    state: "allow",
    toolName: "read",
    source: "tool",
    origin: "builtin",
    ...overrides,
  };
}

export function makeToolRegistry(
  overrides: Partial<ToolRegistry> = {},
): ToolRegistry {
  return {
    getAll: vi.fn().mockReturnValue([{ name: "read" }, { name: "bash" }]),
    getActive: vi.fn().mockReturnValue([{ name: "read" }, { name: "bash" }]),
    setActive: vi.fn(),
    ...overrides,
  };
}

// ── Surface-check factories ────────────────────────────────────────────────

/**
 * Surface-dispatching `checkPermission` mock.
 *
 * Returns the matching per-surface result or `defaultResult`.
 * Pass the returned function as `session.checkPermission` in a `makeHandler`
 * override bag — it is applied to `permissionManager.checkPermission`.
 *
 * Return type is intentionally unannotated so callers retain full `vi.fn()`
 * mock access (`mock.calls`, `toHaveBeenCalledWith`, etc.).
 */
export function makeSurfaceCheck(
  bySurface: Record<
    string,
    Partial<PermissionCheckResult> & { state: PermissionState }
  >,
  defaultResult: Partial<PermissionCheckResult> & { state: PermissionState } = {
    state: "allow",
  },
) {
  return vi
    .fn<MockGateHandlerSession["checkPermission"]>()
    .mockImplementation((surface): PermissionCheckResult => {
      const base = bySurface[surface] ?? defaultResult;
      return {
        toolName: surface,
        source: "tool",
        origin: "builtin",
        ...base,
      };
    });
}

/**
 * Bash-surface `checkPermission` mock that dispatches on a command regex.
 *
 * Pass the returned function as `session.checkPermission` in a `makeHandler`
 * override bag — it is applied to `permissionManager.checkPermission`.
 *
 * Return type is intentionally unannotated so callers retain full `vi.fn()`
 * mock access.
 */
export function makeBashCommandCheck(opts: {
  deny: RegExp;
  denyMatched: string;
  allowMatched?: string;
}) {
  return vi
    .fn<MockGateHandlerSession["checkPermission"]>()
    .mockImplementation((surface, input): PermissionCheckResult => {
      if (surface === "bash") {
        const command = (input as { command?: string }).command ?? "";
        return opts.deny.test(command)
          ? makeCheckResult({
              state: "deny",
              source: "bash",
              command,
              matchedPattern: opts.denyMatched,
            })
          : makeCheckResult({
              state: "allow",
              source: "bash",
              command,
              matchedPattern: opts.allowMatched,
            });
      }
      return makeCheckResult({ state: "allow" });
    });
}

// ── makeHandler ────────────────────────────────────────────────────────────

/**
 * Constructs a PermissionGateHandler wired with real collaborators.
 *
 * The `session` override bag maps to the real collaborators:
 * - `checkPermission` → applied to `permissionManager.checkPermission`
 * - `getActiveSkillEntries`, `getInfrastructureReadDirs`, `getToolPreviewLimits`
 *   → applied as vi.spyOn overrides on the real session
 * - `resolveAgentName` → applied as a vi.spyOn override on the real session
 *
 * Returns `{ handler, events, session, toolRegistry, prompter, recorder,
 * permissionManager, forwarding }` so each test file can destructure only
 * what it needs.
 * `session.activate` is not a mock — use `forwarding.start` to assert it
 * was called.
 */
export function makeHandler(overrides?: {
  session?: Partial<MockGateHandlerSession> & {
    resolveAgentName?: (
      ctx: ExtensionContext,
      systemPrompt?: string,
    ) => string | null;
  };
  /** Override the GatePrompter passed to GateRunner. Defaults to an allow-all stub. */
  prompter?: GatePrompter;
  toolRegistry?: Partial<ToolRegistry>;
  /** Sugar: builds the `getAll` mock from a list of tool names. */
  tools?: string[];
}) {
  const { session, permissionManager, sessionRules, forwarding, logger } =
    makeRealSession();
  const { resolver } = makeRealResolver(permissionManager, sessionRules);

  // Apply session override bag to the real collaborators.
  const so = overrides?.session;
  if (so?.checkPermission) {
    vi.mocked(permissionManager.checkPermission).mockImplementation(
      so.checkPermission,
    );
  }
  if (so?.getActiveSkillEntries) {
    vi.spyOn(session, "getActiveSkillEntries").mockImplementation(
      so.getActiveSkillEntries,
    );
  }
  if (so?.getInfrastructureReadDirs) {
    vi.spyOn(session, "getInfrastructureReadDirs").mockImplementation(
      so.getInfrastructureReadDirs,
    );
  }
  if (so?.getToolPreviewLimits) {
    vi.spyOn(session, "getToolPreviewLimits").mockImplementation(
      so.getToolPreviewLimits,
    );
  }
  if (so?.resolveAgentName) {
    vi.spyOn(session, "resolveAgentName").mockImplementation(
      so.resolveAgentName,
    );
  }

  const events = makeEvents();
  const toolRegistry =
    overrides?.tools !== undefined
      ? makeToolRegistry({
          getAll: vi
            .fn()
            .mockReturnValue(overrides.tools.map((name) => ({ name }))),
        })
      : makeToolRegistry(overrides?.toolRegistry);

  const recorder = new SessionRules();
  const pipeline = new ToolCallGatePipeline(resolver, session);
  const skillInputPipeline = new SkillInputGatePipeline(resolver);
  const reporter = new GateDecisionReporter(logger, events);
  const prompter: GatePrompter = overrides?.prompter ?? {
    canConfirm: vi.fn().mockReturnValue(true),
    prompt: vi
      .fn<GatePrompter["prompt"]>()
      .mockResolvedValue({ approved: true, state: "approved" }),
  };
  const runner = new GateRunner(resolver, recorder, prompter, reporter);
  const handler = new PermissionGateHandler(
    session,
    toolRegistry,
    pipeline,
    skillInputPipeline,
    runner,
  );
  return {
    handler,
    events,
    session,
    logger,
    toolRegistry,
    prompter,
    recorder,
    permissionManager,
    forwarding,
  };
}

// ── Decision-event helper ─────────────────────────────────────────────────

/** Extract all permissions:decision payloads from the events.emit mock. */
export function getDecisionEvents(
  events: ReturnType<typeof makeEvents>,
): PermissionDecisionEvent[] {
  return events.emit.mock.calls
    .filter(([channel]) => channel === PERMISSIONS_DECISION_CHANNEL)
    .map(([, payload]) => payload as PermissionDecisionEvent);
}
