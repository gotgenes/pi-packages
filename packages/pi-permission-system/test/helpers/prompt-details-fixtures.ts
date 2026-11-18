import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import { describeToolGate } from "#src/handlers/gates/tool";
import type { PromptPayload } from "#src/presentation/prompt-payload";
import type { AskingBashUnit } from "#src/types";
import {
  makePermissionCheckResult,
  makeToolPreviewFormatter,
} from "./presentation-fixtures";

/**
 * Build a minimal `PromptPermissionDetails` for a prompter/authorizer unit test.
 *
 * Owns the *structural* contract — every required field, and nothing else — so a
 * new required field is defaulted here once instead of at every construction
 * site. A test file that asserts on a particular value keeps its own semantic
 * defaults by wrapping this factory.
 */
export function makePromptDetails(
  overrides?: Partial<PromptPermissionDetails>,
): PromptPermissionDetails {
  return { requestId: "req-1", ...makeGatePromptDetails(), ...overrides };
}

/**
 * The gate-descriptor projection of {@link makePromptDetails}.
 *
 * A gate supplies every prompt detail except the request id, which the runner
 * mints. Declared beside the full factory so a new required field is defaulted
 * once for both, rather than diverging between the prompter tests and the gate
 * tests.
 */
export function makeGatePromptDetails(
  overrides?: Partial<Omit<PromptPermissionDetails, "requestId">>,
): Omit<PromptPermissionDetails, "requestId"> {
  return {
    source: "tool_call",
    agentName: null,
    payload: makePromptPayload(),
    ...overrides,
  };
}

/**
 * The details a bash chain's ask reaches the authorizer chain with, built by
 * the per-tool gate itself (`describeToolGate`) so the payload, the access
 * facts, the session suggestion, and its label agree as they do in production.
 *
 * The first unit is the winner, as `resolveBashCommandCheck` picks it. The
 * forwarded shape is what a serving node rebuilds from the wire: the child's
 * display `value` and no gate-local `sessionLabel` or log context.
 */
export function makeBashChainPromptDetails(
  units: readonly AskingBashUnit[],
  options: { command?: string; forwarded?: boolean } = {},
): PromptPermissionDetails {
  const winner = units.at(0);
  if (winner === undefined) {
    throw new Error("a bash chain ask has at least one asking unit");
  }
  const command =
    options.command ?? units.map((unit) => unit.command).join(" && ");
  const floor = units.find((unit) => unit.floor !== undefined)?.floor;
  const check = makePermissionCheckResult("bash", {
    source: "bash",
    command: winner.command,
    ...(winner.matchedPattern === undefined
      ? {}
      : { matchedPattern: winner.matchedPattern }),
    ...(floor === undefined ? {} : { floor }),
    askingUnits: units,
  });
  const descriptor = describeToolGate(
    // A literal rather than `makeTcc`: `gate-fixtures` already imports this
    // module, so importing it back would close a cycle.
    {
      toolName: "bash",
      agentName: null,
      input: { command },
      toolCallId: "tc-1",
      cwd: "/test/project",
    },
    check,
    makeToolPreviewFormatter(),
  );
  const sessionApproval = descriptor.sessionApproval?.toForwardedData();
  const local: PromptPermissionDetails = {
    requestId: "req-1",
    payload: descriptor.payload,
    ...descriptor.promptDetails,
    ...(sessionApproval ? { sessionApproval } : {}),
  };
  if (options.forwarded !== true) return local;
  return {
    requestId: local.requestId,
    source: local.source,
    agentName: "reviewer",
    payload: local.payload,
    surface: "bash",
    value: winner.command,
    forwarding: {
      requesterAgentName: "reviewer",
      requesterSessionId: "child-session",
    },
    ...(sessionApproval ? { sessionApproval } : {}),
    ...(local.accessIntent ? { accessIntent: local.accessIntent } : {}),
  };
}

/** A minimal complete {@link PromptPayload} for a test that does not render it. */
export function makePromptPayload(
  overrides?: Partial<PromptPayload>,
): PromptPayload {
  return {
    kind: "tool",
    request: {
      requester: { agentName: null, forwarded: false, sessionId: null },
      surface: "read",
      toolName: "read",
      invokedToolName: null,
      value: "read",
      matchedPattern: null,
      commandContext: null,
      matchedSpelling: null,
      executedUnit: null,
      decidingPath: null,
    },
    evidence: [],
    annotations: [],
    ...overrides,
  };
}
