/**
 * Shared fixtures for building an `AuthorizerSelection` and the `selectAuthorizer`
 * dependency bag.
 *
 * Extracted from `test/authority/authorizer-selection.test.ts` so more than one
 * test file can drive a **real** `AuthorizerSelection` — notably the
 * forwarded-request server tests, which wire it in as the serving node's
 * `AskEscalator` to exercise the chain end to end.
 */

import { type Mock, vi } from "vitest";
import type {
  AuthorizerVerdict,
  AuthorizerSelectionDeps as SelectionCtorDeps,
} from "#src/authority/authorizer";
import { AuthorizerRegistry } from "#src/authority/authorizer-registry";
import { ForwardingLivenessJudge } from "#src/authority/forwarding-liveness";
import type { PermissionPrompterApi } from "#src/authority/permission-prompter";
import { ServingSessionRegistry } from "#src/authority/serving-registry";
import type { SubagentDetector } from "#src/authority/subagent-detection";
import type { PermissionQuery } from "#src/service";
import { makeAuthorizerLog } from "#test/helpers/authorizer-log-fixtures";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import { makePromptPreferences } from "#test/helpers/prompt-view-fixtures";

/** The full constructor bag `AuthorizerSelection` takes (the ctor intersection). */
export type AuthorizerSelectionTestDeps = SelectionCtorDeps & {
  prompter: PermissionPrompterApi;
  getPermissionQuery: () => PermissionQuery;
  authorizerRegistry: AuthorizerRegistry;
  getAuthorizerChain: () => string[];
};

/** A `SubagentDetector` answering a fixed verdict. */
export function makeDetection(isSubagent = false): SubagentDetector {
  return { isSubagent: vi.fn(() => isSubagent) };
}

/** A prompter that records the call and resolves to a default approval. */
export function makePrompterApi(): PermissionPrompterApi & {
  prompt: Mock<PermissionPrompterApi["prompt"]>;
} {
  return {
    prompt: vi.fn<PermissionPrompterApi["prompt"]>().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    }),
  };
}

/**
 * A prompter that actually runs the passed authorizer, so a test can observe
 * the composed chain's decision (the real `PermissionPrompter` brackets log
 * entries around `authorizer.authorize(details)`).
 */
export function makeInvokingPrompter(): PermissionPrompterApi & {
  prompt: Mock<PermissionPrompterApi["prompt"]>;
} {
  return {
    prompt: vi.fn<PermissionPrompterApi["prompt"]>((authorizer, details) =>
      authorizer.authorize(details),
    ),
  };
}

/** Register a link returning a fixed verdict. */
export function registerLink(
  registry: AuthorizerRegistry,
  name: string,
  verdict: AuthorizerVerdict,
): void {
  registry.register(name, () => Promise.resolve(verdict));
}

function makeQuery(): PermissionQuery {
  return { checkPermission: vi.fn(), getToolPermission: vi.fn() };
}

/** The `AuthorizerSelection` constructor bag, override-driven. */
export function makeAuthorizerSelectionDeps(
  overrides: Partial<AuthorizerSelectionTestDeps> = {},
): AuthorizerSelectionTestDeps {
  return {
    detection: overrides.detection ?? makeDetection(),
    events: overrides.events ?? {
      emit: vi.fn(),
      on: vi.fn().mockReturnValue(() => undefined),
    },
    getPromptPreferences:
      overrides.getPromptPreferences ?? (() => makePromptPreferences()),
    requestPermissionDecision:
      overrides.requestPermissionDecision ??
      vi.fn().mockResolvedValue({
        approved: true,
        state: "approved",
        decidedBy: DECIDED_BY_HUMAN,
      }),
    forwardingDir: overrides.forwardingDir ?? "/tmp/forwarding",
    registry: overrides.registry,
    serving:
      overrides.serving ??
      new ForwardingLivenessJudge({
        registry: new ServingSessionRegistry(),
        heartbeats: { read: () => "absent", servingIds: () => [] },
      }),
    getForwardingTimeoutMs: overrides.getForwardingTimeoutMs ?? (() => 1000),
    logger: overrides.logger ?? makeAuthorizerLog(),
    prompter: overrides.prompter ?? makePrompterApi(),
    getPermissionQuery: overrides.getPermissionQuery ?? (() => makeQuery()),
    authorizerRegistry:
      overrides.authorizerRegistry ?? new AuthorizerRegistry(),
    getAuthorizerChain: overrides.getAuthorizerChain ?? (() => []),
  };
}
