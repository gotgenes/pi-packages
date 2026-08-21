import type {
  PromptPayload,
  PromptPermissionDetails,
} from "@gotgenes/pi-permission-system";

/**
 * The ask facts a chain link is handed at `authorize` time.
 *
 * `payload` is required by the interface but inert for this package:
 * `createTypoReviewer` reads an ask through `accessIntent` / `surface` /
 * `path` / `value`, never through the structured payload.
 */
export function makePromptDetails(
  overrides: Partial<PromptPermissionDetails> = {},
): PromptPermissionDetails {
  return {
    requestId: "req-1",
    source: "tool_call",
    agentName: null,
    surface: "external_directory",
    payload: EXTERNAL_DIRECTORY_PAYLOAD,
    ...overrides,
  };
}

const EXTERNAL_DIRECTORY_PAYLOAD: PromptPayload = {
  kind: "external_directory",
  request: {
    requester: { agentName: null, forwarded: false, sessionId: null },
    surface: "external_directory",
    toolName: null,
    invokedToolName: null,
    value: "",
    matchedPattern: null,
    commandContext: null,
    executedUnit: null,
  },
  evidence: [],
  annotations: [],
};
