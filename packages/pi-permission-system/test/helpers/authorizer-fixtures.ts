/**
 * Shared fixtures for building an `AuthorizerSelection` and the `selectAuthorizer`
 * dependency bag.
 *
 * Extracted from `test/authority/authorizer-selection.test.ts` so more than one
 * test file can drive a **real** `AuthorizerSelection` — notably the
 * forwarded-request server tests, which wire it in as the serving node's
 * `AskEscalator` to exercise the chain end to end.
 */

import { afterEach, beforeEach, type Mock, vi } from "vitest";
import { AskDialogQueue } from "#src/authority/ask-dialog-queue";
import type { AuthorizerVerdict } from "#src/authority/authorizer";
import type { UnregisteredLinkAuditor } from "#src/authority/authorizer-chain-audit";
import { AuthorizerRegistry } from "#src/authority/authorizer-registry";
import type { AuthorizerSelectionConstructorDeps } from "#src/authority/authorizer-selection";
import { ForwardingLivenessJudge } from "#src/authority/forwarding-liveness";
import { LocalUserAuthorizer } from "#src/authority/local-user-authorizer";
import { SUBAGENT_ENV_HINT_KEYS } from "#src/authority/permission-forwarding";
import type {
  PromptPreferences,
  requestPermissionDecision,
} from "#src/authority/permission-prompt-component";
import type { PermissionPrompterApi } from "#src/authority/permission-prompter";
import { ServingSessionRegistry } from "#src/authority/serving-registry";
import type { SubagentDetector } from "#src/authority/subagent-detection";
import type { PermissionQuery } from "#src/service";
import type { PermissionEventBus } from "#src/service/permission-events";
import { makeAuthorizerLog } from "./authorizer-log-fixtures";
import { DECIDED_BY_HUMAN } from "./decision-fixtures";
import { makePromptPreferences } from "./prompt-view-fixtures";

/**
 * The full constructor bag `AuthorizerSelection` takes, narrowed to the
 * concrete `AuthorizerRegistry` so a test can register links into the same
 * instance it hands the selection.
 */
/**
 * The constructor deps, plus the three inputs the default local-terminal
 * factory is built from — so a test can shape the local dialog without
 * writing its own `createLocalAuthorizer`.
 */
export type AuthorizerSelectionTestDeps = Omit<
  AuthorizerSelectionConstructorDeps,
  "authorizerRegistry"
> & {
  authorizerRegistry: AuthorizerRegistry;
  events?: PermissionEventBus;
  getPromptPreferences?: () => PromptPreferences;
  requestPermissionDecision?: typeof requestPermissionDecision;
};

/**
 * Clear every subagent env hint before each test in the calling file, and
 * restore the host environment afterwards.
 *
 * `selectAuthorizer` resolves a forwarding target through ambient
 * `process.env`, so a developer running with `PI_SUBAGENT_PARENT_SESSION`
 * exported would otherwise change what these fixtures select. The same pair is
 * spelled out in `approval-escalator.test.ts` and `forwarding-manager.test.ts`;
 * it lives here so the files sharing these fixtures do not copy it a third and
 * fourth time.
 */
export function neutralizeSubagentEnvHints(): void {
  beforeEach(() => {
    for (const key of SUBAGENT_ENV_HINT_KEYS) {
      vi.stubEnv(key, undefined);
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });
}

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

/** A recording `UnregisteredLinkAuditor` double. */
export function makeChainAudit(): {
  auditUnregisteredLink: Mock<UnregisteredLinkAuditor["auditUnregisteredLink"]>;
} {
  return {
    auditUnregisteredLink:
      vi.fn<UnregisteredLinkAuditor["auditUnregisteredLink"]>(),
  };
}

/** The `AuthorizerSelection` constructor bag, override-driven. */
export function makeAuthorizerSelectionDeps(
  overrides: Partial<AuthorizerSelectionTestDeps> = {},
): AuthorizerSelectionTestDeps {
  const events: PermissionEventBus = overrides.events ?? {
    emit: vi.fn(),
    on: vi.fn().mockReturnValue(() => undefined),
  };
  const dialogs = new AskDialogQueue();
  const getPromptPreferences =
    overrides.getPromptPreferences ?? (() => makePromptPreferences());
  const decide: typeof requestPermissionDecision =
    overrides.requestPermissionDecision ??
    vi.fn().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });
  return {
    detection: overrides.detection ?? makeDetection(),
    createLocalAuthorizer:
      overrides.createLocalAuthorizer ??
      ((ctx) =>
        new LocalUserAuthorizer({
          ui: ctx.ui,
          mode: ctx.mode,
          events,
          dialogs,
          getPromptPreferences,
          requestPermissionDecision: decide,
        })),
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
    chainAudit: overrides.chainAudit ?? makeChainAudit(),
  };
}
