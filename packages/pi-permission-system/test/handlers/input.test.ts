import { describe, expect, it, vi } from "vitest";
import type { AskEscalator } from "#src/authority/authorizer-selection";
import { extractSkillNameFromInput } from "#src/handlers/permission-gate-handler";
import { DECIDED_BY_HUMAN } from "#test/helpers/decision-fixtures";
import { makeCtx, makeHandler } from "#test/helpers/handler-fixtures";

// ── helpers ────────────────────────────────────────────────────────────────

function makeInputEvent(text: string) {
  return { text };
}

// ── extractSkillNameFromInput ──────────────────────────────────────────────

describe("extractSkillNameFromInput", () => {
  it("returns null for plain text", () => {
    expect(extractSkillNameFromInput("hello world")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(extractSkillNameFromInput("")).toBeNull();
  });

  it("returns null for bare /skill: with no name", () => {
    expect(extractSkillNameFromInput("/skill:")).toBeNull();
  });

  it("extracts skill name from /skill:<name>", () => {
    expect(extractSkillNameFromInput("/skill:librarian")).toBe("librarian");
  });

  it("extracts skill name stopping at whitespace", () => {
    expect(extractSkillNameFromInput("/skill:librarian some extra")).toBe(
      "librarian",
    );
  });

  it("trims leading whitespace before the prefix", () => {
    expect(extractSkillNameFromInput("  /skill:my-skill")).toBe("my-skill");
  });

  it("returns null when the skill name after trimming is empty", () => {
    expect(extractSkillNameFromInput("/skill: ")).toBeNull();
  });
});

// ── handleInput ───────────────────────────────────────────────────────────

describe("handleInput", () => {
  it("activates session with ctx", async () => {
    const ctx = makeCtx();
    const { handler, forwarding } = makeHandler();
    await handler.handleInput(makeInputEvent("hello"), ctx);
    // session.activate(ctx) calls forwarding.start(ctx) on the real session
    expect(forwarding.start).toHaveBeenCalledWith(ctx);
  });

  it("returns continue for non-skill input", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleInput(
      makeInputEvent("just a message"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "continue" });
  });

  it("does not check permissions for non-skill input", async () => {
    const { handler, permissionManager } = makeHandler();
    await handler.handleInput(makeInputEvent("just a message"), makeCtx());
    expect(permissionManager.check).not.toHaveBeenCalled();
  });

  it("returns continue when skill is allowed", async () => {
    const { handler } = makeHandler();
    const result = await handler.handleInput(
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "continue" });
  });

  it("returns handled when skill is denied", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "deny" }),
      },
    });
    const result = await handler.handleInput(
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "handled" });
  });

  it("shows a warning notification when skill is denied and UI is available", async () => {
    const ctx = makeCtx({ hasUI: true });
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "deny" }),
      },
    });
    await handler.handleInput(makeInputEvent("/skill:librarian"), ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("librarian"),
      "warning",
    );
  });

  it("does not show a warning notification when skill is denied and UI is absent", async () => {
    const ctx = makeCtx({ hasUI: false });
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "deny" }),
      },
    });
    await handler.handleInput(makeInputEvent("/skill:librarian"), ctx);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("returns handled when skill requires approval but no UI is available", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "ask" }),
      },
      prompter: {
        escalate: vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
          approved: false,
          state: "denied",
          confirmationUnavailable: true,
          decidedBy: DECIDED_BY_HUMAN,
        }),
      },
    });
    const result = await handler.handleInput(
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "handled" });
  });

  it("prompts and returns continue when skill ask is approved", async () => {
    const approvePrompt = vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });
    const { handler, prompter } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "ask" }),
      },
      prompter: {
        escalate: approvePrompt,
      },
    });
    const result = await handler.handleInput(
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "continue" });
    expect(prompter.escalate).toHaveBeenCalledOnce();
  });

  it("returns handled when skill ask is denied by user", async () => {
    const { handler } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "ask" }),
      },
      prompter: {
        escalate: vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
          approved: false,
          state: "denied",
          decidedBy: DECIDED_BY_HUMAN,
        }),
      },
    });
    const result = await handler.handleInput(
      makeInputEvent("/skill:librarian"),
      makeCtx(),
    );
    expect(result).toEqual({ action: "handled" });
  });

  it("passes agentName in the prompt permission request", async () => {
    const approvePrompt = vi.fn<AskEscalator["escalate"]>().mockResolvedValue({
      approved: true,
      state: "approved",
      decidedBy: DECIDED_BY_HUMAN,
    });
    const { handler, prompter } = makeHandler({
      session: {
        checkPermission: vi.fn().mockReturnValue({ state: "ask" }),
        resolveAgentName: vi.fn().mockReturnValue("code-agent"),
      },
      prompter: {
        escalate: approvePrompt,
      },
    });
    await handler.handleInput(makeInputEvent("/skill:librarian"), makeCtx());
    expect(prompter.escalate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentName: "code-agent",
        skillName: "librarian",
      }),
    );
  });
});
