import { describe, expect, it } from "vitest";

import {
  formatSkillDenyNotice,
  SkillInputGatePipeline,
} from "#src/handlers/gates/skill-input-gate-pipeline";

import {
  makeGateRunner,
  makeNotifier,
  makeSkillInputInputs,
} from "#test/helpers/gate-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

// ── formatSkillDenyNotice ─────────────────────────────────────────────────

describe("formatSkillDenyNotice", () => {
  it("includes the skill name in the message (no agent)", () => {
    const msg = formatSkillDenyNotice("librarian", null);
    expect(msg).toContain("librarian");
  });

  it("includes the skill name and agent name when agent is present", () => {
    const msg = formatSkillDenyNotice("librarian", "code-agent");
    expect(msg).toContain("librarian");
    expect(msg).toContain("code-agent");
  });
});

// ── SkillInputGatePipeline.evaluate ───────────────────────────────────────

describe("SkillInputGatePipeline.evaluate", () => {
  // ── notifier behaviour ──────────────────────────────────────────────────

  it("calls notifier.warn when the skill is denied", async () => {
    const inputs = makeSkillInputInputs({
      checkPermission: () => makeCheckResult({ state: "deny" }),
    });
    const notifier = makeNotifier();
    const { runner } = makeGateRunner();
    const pipeline = new SkillInputGatePipeline(inputs);

    await pipeline.evaluate("librarian", null, notifier, runner);

    expect(notifier.warn).toHaveBeenCalledOnce();
    expect(notifier.warn).toHaveBeenCalledWith(
      expect.stringContaining("librarian"),
    );
  });

  it("does not call notifier.warn when the skill is allowed", async () => {
    const inputs = makeSkillInputInputs({
      checkPermission: () => makeCheckResult({ state: "allow" }),
    });
    const notifier = makeNotifier();
    const { runner } = makeGateRunner();
    const pipeline = new SkillInputGatePipeline(inputs);

    await pipeline.evaluate("librarian", null, notifier, runner);

    expect(notifier.warn).not.toHaveBeenCalled();
  });

  it("does not call notifier.warn when the skill requires approval (ask)", async () => {
    const inputs = makeSkillInputInputs({
      checkPermission: () => makeCheckResult({ state: "ask" }),
    });
    const notifier = makeNotifier();
    const { runner } = makeGateRunner();
    const pipeline = new SkillInputGatePipeline(inputs);

    await pipeline.evaluate("librarian", null, notifier, runner);

    expect(notifier.warn).not.toHaveBeenCalled();
  });

  it("includes agent name in the deny notice when agent is present", async () => {
    const inputs = makeSkillInputInputs({
      checkPermission: () => makeCheckResult({ state: "deny" }),
    });
    const notifier = makeNotifier();
    const { runner } = makeGateRunner();
    const pipeline = new SkillInputGatePipeline(inputs);

    await pipeline.evaluate("librarian", "code-agent", notifier, runner);

    expect(notifier.warn).toHaveBeenCalledWith(
      expect.stringContaining("code-agent"),
    );
  });

  // ── outcome mapping ─────────────────────────────────────────────────────

  it("returns allow when the gate passes", async () => {
    const inputs = makeSkillInputInputs({
      checkPermission: () => makeCheckResult({ state: "allow" }),
    });
    const { runner } = makeGateRunner();
    const pipeline = new SkillInputGatePipeline(inputs);

    const result = await pipeline.evaluate(
      "librarian",
      null,
      makeNotifier(),
      runner,
    );

    expect(result).toEqual({ action: "allow" });
  });

  it("returns block when the gate denies", async () => {
    const inputs = makeSkillInputInputs({
      checkPermission: () =>
        makeCheckResult({ state: "deny", matchedPattern: "*" }),
    });
    const { runner } = makeGateRunner();
    const pipeline = new SkillInputGatePipeline(inputs);

    const result = await pipeline.evaluate(
      "librarian",
      null,
      makeNotifier(),
      runner,
    );

    expect(result).toEqual({
      action: "block",
      reason: expect.stringContaining("librarian"),
    });
  });

  // ── checkPermission call ────────────────────────────────────────────────

  it("calls checkPermission with the skill surface, skill name, and agent name", async () => {
    const inputs = makeSkillInputInputs();
    const { runner } = makeGateRunner();
    const pipeline = new SkillInputGatePipeline(inputs);

    await pipeline.evaluate("explorer", "code-agent", makeNotifier(), runner);

    expect(inputs.checkPermission).toHaveBeenCalledWith(
      "skill",
      { name: "explorer" },
      "code-agent",
    );
  });

  it("calls checkPermission with undefined agentName when agentName is null", async () => {
    const inputs = makeSkillInputInputs();
    const { runner } = makeGateRunner();
    const pipeline = new SkillInputGatePipeline(inputs);

    await pipeline.evaluate("explorer", null, makeNotifier(), runner);

    expect(inputs.checkPermission).toHaveBeenCalledWith(
      "skill",
      { name: "explorer" },
      undefined,
    );
  });
});
