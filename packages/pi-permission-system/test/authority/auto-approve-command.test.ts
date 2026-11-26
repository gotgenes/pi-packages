import { describe, expect, it, vi } from "vitest";
import { AutoApproval } from "#src/authority/auto-approval";
import {
  AUTO_APPROVE_COMMAND,
  handleAutoApproveCommand,
  parseAutoApproveArgs,
  registerAutoApproveCommand,
} from "#src/authority/auto-approve-command";

describe("parseAutoApproveArgs", () => {
  it.each([
    ["", { kind: "status" }],
    ["status", { kind: "status" }],
    ["help", { kind: "help" }],
    ["on", { kind: "on", scopes: [{ kind: "own" }, { kind: "forwarded" }] }],
    ["ON", { kind: "on", scopes: [{ kind: "own" }, { kind: "forwarded" }] }],
    ["on own", { kind: "on", scopes: [{ kind: "own" }] }],
    ["on forwarded", { kind: "on", scopes: [{ kind: "forwarded" }] }],
    [
      "on agent reviewer",
      { kind: "on", scopes: [{ kind: "agent", agentName: "reviewer" }] },
    ],
    [
      "  on   agent   Reviewer  ",
      {
        kind: "on",
        scopes: [{ kind: "agent", agentName: "Reviewer" }],
      },
    ],
    ["off", { kind: "off" }],
    ["off own", { kind: "off", scope: { kind: "own" } }],
    ["off forwarded", { kind: "off", scope: { kind: "forwarded" } }],
    [
      "off agent reviewer",
      { kind: "off", scope: { kind: "agent", agentName: "reviewer" } },
    ],
  ])("parses %j", (args, expected) => {
    expect(parseAutoApproveArgs(args)).toEqual(expected);
  });

  it.each([
    "yes",
    "on everything",
    "on agent",
    "on agent a b",
    "on own forwarded",
    "off agent",
    "status now",
  ])("reads %j as a usage error", (args) => {
    expect(parseAutoApproveArgs(args)).toEqual({ kind: "usage" });
  });
});

describe("handleAutoApproveCommand", () => {
  function setup(adjudicatesLocally = true) {
    const approval = new AutoApproval();
    const ctx = { ui: { notify: vi.fn(), setStatus: vi.fn() } };
    const controller = {
      approval,
      role: { adjudicatesLocally: () => adjudicatesLocally },
    };
    return { approval, ctx, controller };
  }

  it("turns on the own and forwarded scopes, shows the indicator, and says what is on", () => {
    const { approval, ctx, controller } = setup();

    handleAutoApproveCommand("on", ctx, controller);

    expect(approval.describe()).toBe("own (command), forwarded (command)");
    expect(ctx.ui.setStatus).toHaveBeenCalledWith(
      "pi-permission-system",
      "auto-approve",
    );
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "auto-approve: own (command), forwarded (command)",
      "info",
    );
  });

  it("turns one scope off and keeps the rest", () => {
    const { approval, ctx, controller } = setup();
    handleAutoApproveCommand("on", ctx, controller);

    handleAutoApproveCommand("off forwarded", ctx, controller);

    expect(approval.describe()).toBe("own (command)");
  });

  it("turns everything off and clears the indicator", () => {
    const { approval, ctx, controller } = setup();
    handleAutoApproveCommand("on agent reviewer", ctx, controller);

    handleAutoApproveCommand("off", ctx, controller);

    expect(approval.isActive()).toBe(false);
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith(
      "pi-permission-system",
      undefined,
    );
  });

  it("reports the state without changing it", () => {
    const { approval, ctx, controller } = setup();
    approval.enable({ kind: "own" }, "flag");

    handleAutoApproveCommand("status", ctx, controller);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      "auto-approve: own (flag)",
      "info",
    );
    expect(ctx.ui.setStatus).not.toHaveBeenCalled();
  });

  it("warns on an unknown argument and changes nothing", () => {
    const { approval, ctx, controller } = setup();

    handleAutoApproveCommand("on everything", ctx, controller);

    expect(approval.isActive()).toBe(false);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining(`Usage: /${AUTO_APPROVE_COMMAND}`),
      "warning",
    );
  });

  it("warns that a relaying session's own auto-approve does not apply", () => {
    const { approval, ctx, controller } = setup(false);

    handleAutoApproveCommand("on own", ctx, controller);

    expect(approval.isActive()).toBe(true);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("relays its asks"),
      "warning",
    );
  });

  it("does not warn a session that decides its own asks", () => {
    const { ctx, controller } = setup(true);

    handleAutoApproveCommand("on own", ctx, controller);

    expect(ctx.ui.notify).not.toHaveBeenCalledWith(
      expect.anything(),
      "warning",
    );
  });
});

describe("registerAutoApproveCommand", () => {
  it("registers the command in the package's namespace", () => {
    const registerCommand = vi.fn();

    registerAutoApproveCommand(
      { registerCommand },
      {
        approval: new AutoApproval(),
        role: { adjudicatesLocally: () => true },
      },
    );

    expect(registerCommand).toHaveBeenCalledWith(
      "permission-system:auto-approve",
      expect.objectContaining({ handler: expect.any(Function) }),
    );
  });
});
