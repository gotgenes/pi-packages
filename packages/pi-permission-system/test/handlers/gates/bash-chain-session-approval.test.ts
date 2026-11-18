import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import type { Authorizer } from "#src/authority/authorizer";
import { AuthorizerRegistry } from "#src/authority/authorizer-registry";
import {
  type AskEscalator,
  AuthorizerSelection,
} from "#src/authority/authorizer-selection";
import type { requestPermissionDecision } from "#src/authority/permission-prompt-component";
import { PermissionPrompter } from "#src/authority/permission-prompter";
import { ToolCallGatePipeline } from "#src/handlers/gates/tool-call-gate-pipeline";
import { PermissionResolver } from "#src/policy/permission-resolver";
import { SessionRules } from "#src/session/session-rules";
import {
  makeAuthorizerSelectionDeps,
  neutralizeSubagentEnvHints,
} from "#test/helpers/authorizer-fixtures";
import { makeAuthorizerLog } from "#test/helpers/authorizer-log-fixtures";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import {
  makeGateInputs,
  makeGateRunner,
  makeTcc,
} from "#test/helpers/gate-fixtures";
import { createInMemoryManager } from "#test/helpers/manager-harness";

type Permission = NonNullable<
  NonNullable<Parameters<typeof createInMemoryManager>[0]>["global"]
>["permission"];

neutralizeSubagentEnvHints();

/**
 * The real parse, resolver, session layer, and runner, with a human who
 * answers every ask "for this session".
 */
function sessionApprovingGate(permission: Permission) {
  const rules = new SessionRules();
  const resolver = new PermissionResolver(
    createInMemoryManager({ global: { permission } }),
    rules,
  );
  const escalate = vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
    approved: true,
    state: "approved_for_session",
    decidedBy: DECIDED_BY_HUMAN,
  });
  const { runner } = makeGateRunner({
    resolve: (intent) => resolver.resolve(intent),
    recordSessionApproval: (approval) => {
      rules.recordSessionApproval(approval);
    },
    escalate,
  });
  const pipeline = new ToolCallGatePipeline(resolver, makeGateInputs());
  const run = (command: string) =>
    pipeline.evaluate(
      makeTcc({ toolName: "bash", input: { command } }),
      runner,
    );
  const sessionPatterns = () =>
    rules.getRuleset().map((rule) => `${rule.surface}:${rule.pattern}`);
  return { run, escalate, sessionPatterns };
}

describe("approving a bash chain for the session", () => {
  it("grants every unit the prompt asked about, so the chain runs silently next time", async () => {
    const { run, escalate, sessionPatterns } = sessionApprovingGate({
      bash: { "*": "ask" },
    });

    expect(await run("cd sub && npm test")).toEqual({ action: "allow" });
    expect(escalate).toHaveBeenCalledTimes(1);
    expect(sessionPatterns()).toEqual(["bash:cd sub*", "bash:npm test*"]);

    expect(await run("cd sub && npm test")).toEqual({ action: "allow" });
    expect(escalate).toHaveBeenCalledTimes(1);
  });

  it("names every asking unit on the one prompt", async () => {
    const { run, escalate } = sessionApprovingGate({ bash: { "*": "ask" } });

    await run("cd sub && npm test");

    // Partial match: the escalation carries the whole descriptor, and the claim
    // here is only what the prompt names and what its session option offers.
    expect(escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            value: "cd sub",
            otherAskingUnits: ["npm test"],
          }),
        }),
        sessionLabel: 'Yes, allow bash "cd sub*", "npm test*" for this session',
      }),
    );
  });

  it("does not grant a cd into a directory the prompt never showed", async () => {
    const { run, escalate } = sessionApprovingGate({
      "*": "allow",
      bash: { "*": "ask" },
    });

    await run("cd sub && npm test");
    await run("cd /etc");

    expect(escalate).toHaveBeenCalledTimes(2);
    expect(escalate).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          request: expect.objectContaining({
            surface: "bash",
            value: "cd /etc",
          }),
        }),
      }),
    );
  });
});

/** A node with a UI, whose terminal is the human dialog. */
function makeLocalCtx(): ExtensionContext {
  return {
    cwd: "/test/project",
    hasUI: true,
    mode: "tui",
    ui: { select: vi.fn(), input: vi.fn(), custom: vi.fn() },
    sessionManager: {
      getSessionId: vi.fn().mockReturnValue(null),
      getSessionName: vi.fn((): string | undefined => undefined),
    },
  } as unknown as ExtensionContext;
}

/** A link that settles every asking unit that is a plain variable assignment. */
const allowAssignments: Authorizer["authorize"] = (details) => {
  const units = (details.accessIntent?.askingUnits ?? [])
    .map((unit) => unit.command)
    .filter((command) => /^[A-Za-z_]\w*=/.test(command));
  return Promise.resolve(
    units.length === 0 ? { kind: "defer" } : { kind: "allow_units", units },
  );
};

/**
 * The real parse, resolver, session layer, runner, and authorizer chain, with
 * the assignment link configured and a human who answers "for this session".
 */
function gateWithAssignmentLink(permission: Permission) {
  const rules = new SessionRules();
  const resolver = new PermissionResolver(
    createInMemoryManager({ global: { permission } }),
    rules,
  );
  const registry = new AuthorizerRegistry();
  registry.register("assignments", allowAssignments);
  const dialog = vi.fn<typeof requestPermissionDecision>().mockResolvedValue({
    approved: true,
    state: "approved_for_session",
    decidedBy: DECIDED_BY_HUMAN,
  });
  const logger = makeAuthorizerLog();
  const selection = new AuthorizerSelection(
    makeAuthorizerSelectionDeps({
      prompter: new PermissionPrompter({ logger }),
      authorizerRegistry: registry,
      getAuthorizerChain: () => ["assignments"],
      requestPermissionDecision: dialog,
      logger,
    }),
  );
  selection.activate(makeLocalCtx());
  const { runner } = makeGateRunner({
    resolve: (intent) => resolver.resolve(intent),
    recordSessionApproval: (approval) => {
      rules.recordSessionApproval(approval);
    },
    escalate: (details) => selection.escalate(details),
  });
  const pipeline = new ToolCallGatePipeline(resolver, makeGateInputs());
  const run = (command: string) =>
    pipeline.evaluate(
      makeTcc({ toolName: "bash", input: { command } }),
      runner,
    );
  const sessionPatterns = () =>
    rules.getRuleset().map((rule) => `${rule.surface}:${rule.pattern}`);
  return { run, dialog, sessionPatterns };
}

describe("a link that allows part of a chain", () => {
  const command = 'F="a/b.txt c/d.txt" && git commit --dry-run -m x -- $F';

  it("asks the human only about the unit still undecided, and offers to grant only it", async () => {
    const { run, dialog } = gateWithAssignmentLink({
      "*": "allow",
      bash: { "*": "ask" },
    });

    expect(await run(command)).toEqual({ action: "allow" });

    // Partial match: the dialog's view and title are not the claim here.
    expect(dialog).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      expect.any(String),
      expect.objectContaining({
        request: expect.objectContaining({
          value: "git commit --dry-run -m x -- $F",
        }),
      }),
      expect.objectContaining({
        sessionLabel: 'Yes, allow bash "git commit *" for this session',
      }),
    );
    const payload = dialog.mock.lastCall?.[2];
    expect(payload?.request).not.toHaveProperty("otherAskingUnits");
  });

  it("grants for the session only the unit the human was shown", async () => {
    const { run, sessionPatterns } = gateWithAssignmentLink({
      "*": "allow",
      bash: { "*": "ask" },
    });

    await run(command);

    expect(sessionPatterns()).toEqual(["bash:git commit *"]);
  });

  it("runs the same command silently next time: the link settles the rest", async () => {
    const { run, dialog } = gateWithAssignmentLink({
      "*": "allow",
      bash: { "*": "ask" },
    });

    await run(command);
    expect(await run(command)).toEqual({ action: "allow" });

    expect(dialog).toHaveBeenCalledOnce();
  });
});
