import type { PromptPermissionDetails } from "#src/authority/permission-prompter";
import type { PromptPayload } from "#src/presentation/prompt-payload";

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
      executedUnit: null,
    },
    evidence: [],
    annotations: [],
    ...overrides,
  };
}
