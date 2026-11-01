import { describe, expect, it, vi } from "vitest";
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

function setup(bash: Record<string, "allow" | "ask" | "deny">) {
  const rules = new SessionRules();
  const resolver = new PermissionResolver(
    createInMemoryManager({ global: { permission: { "*": "allow", bash } } }),
    rules,
  );
  const escalate = vi.fn().mockResolvedValue({
    approved: true,
    state: "approved_for_session",
    decidedBy: DECIDED_BY_HUMAN,
  });
  const { runner } = makeGateRunner({
    resolve: (intent) => resolver.resolve(intent),
    recordSessionApproval: (approval) => rules.recordSessionApproval(approval),
    escalate,
  });
  const pipeline = new ToolCallGatePipeline(resolver, makeGateInputs());
  const run = (command: string) =>
    pipeline.evaluate(
      makeTcc({ toolName: "bash", input: { command } }),
      runner,
    );
  return { run, escalate, rules };
}

describe("bash chain session approval", () => {
  it("approves each asking unit and does not grant unrelated directories", async () => {
    const { run, escalate, rules } = setup({ "*": "ask" });
    expect(await run("cd sub && npm test")).toEqual({ action: "allow" });
    expect(
      escalate.mock.calls.map(([details]) => details.payload.request.value),
    ).toEqual(["cd sub", "npm test"]);
    expect(rules.getRuleset().map((rule) => rule.pattern)).toEqual([
      "cd sub*",
      "npm test*",
    ]);
    expect(await run("cd sub && npm test")).toEqual({ action: "allow" });
    expect(escalate).toHaveBeenCalledTimes(2);
    await run("cd /etc");
    expect(escalate).toHaveBeenCalledTimes(3);
  });

  it("denies the whole chain before any ask when a unit is denied", async () => {
    const { run, escalate } = setup({ "*": "ask", "npm *": "deny" });
    expect((await run("cd sub && npm test")).action).toBe("block");
    expect(escalate).not.toHaveBeenCalled();
  });

  it("blocks the call when the second unit is refused", async () => {
    const { run, escalate, rules } = setup({ "*": "ask" });
    escalate.mockResolvedValueOnce({
      approved: true,
      state: "approved_for_session",
      decidedBy: DECIDED_BY_HUMAN,
    });
    escalate.mockResolvedValueOnce({
      approved: false,
      state: "denied",
      decidedBy: DECIDED_BY_HUMAN,
    });
    expect((await run("cd sub && npm test")).action).toBe("block");
    expect(rules.getRuleset().map((rule) => rule.pattern)).toEqual(["cd sub*"]);
  });
});
