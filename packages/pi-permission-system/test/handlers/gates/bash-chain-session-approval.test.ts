import { describe, expect, it, vi } from "vitest";
import type { AskEscalator } from "#src/authority/authorizer-selection";
import { ToolCallGatePipeline } from "#src/handlers/gates/tool-call-gate-pipeline";
import { PermissionResolver } from "#src/policy/permission-resolver";
import { SessionRules } from "#src/session/session-rules";
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
