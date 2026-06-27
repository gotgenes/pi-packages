import { describe, expect, it } from "vitest";
import { auditBashCommand, type BashAuditConfig } from "#src/bash-command-auditor";

const open: BashAuditConfig = {};
const allowSudo: BashAuditConfig = { allowSudo: true };
const allowEscape: BashAuditConfig = { allowShellEscape: true };

describe("auditBashCommand — sudo detection", () => {
  it("blocks bare sudo", () => {
    expect(auditBashCommand("sudo rm -rf /", open).verdict).toBe("block");
  });

  it("blocks SUDO (case-insensitive)", () => {
    expect(auditBashCommand("SUDO rm -rf /", open).verdict).toBe("block");
  });

  it("blocks SuDo (mixed case)", () => {
    expect(auditBashCommand("SuDo rm -rf /", open).verdict).toBe("block");
  });

  it("blocks path-qualified /usr/bin/sudo", () => {
    expect(auditBashCommand("/usr/bin/sudo rm -rf /", open).verdict).toBe("block");
  });

  it("blocks sudo after &&", () => {
    expect(auditBashCommand("echo hi && sudo evil", open).verdict).toBe("block");
  });

  it("blocks sudo after ;", () => {
    expect(auditBashCommand("ls; sudo evil", open).verdict).toBe("block");
  });

  it("passes sudo when allowSudo is true", () => {
    expect(auditBashCommand("sudo ls", allowSudo).verdict).toBe("pass");
  });

  it("passes command without sudo", () => {
    expect(auditBashCommand("ls -la /tmp", open).verdict).toBe("pass");
  });

  it("does not false-positive on 'pseudocode'", () => {
    expect(auditBashCommand("echo pseudocode", open).verdict).toBe("pass");
  });
});

describe("auditBashCommand — shell escape detection", () => {
  it("blocks bash -c with variable expansion", () => {
    expect(auditBashCommand('bash -c "$CMD"', open).verdict).toBe("block");
  });

  it("blocks BASH -c (case-insensitive)", () => {
    expect(auditBashCommand('BASH -c "$CMD"', open).verdict).toBe("block");
  });

  it("blocks sh -c with command substitution", () => {
    expect(auditBashCommand("sh -c \"$(get_cmd)\"", open).verdict).toBe("block");
  });

  it("blocks SH -c (case-insensitive)", () => {
    expect(auditBashCommand('SH -c "$X"', open).verdict).toBe("block");
  });

  it("blocks bash -x -c (flags before -c)", () => {
    expect(auditBashCommand('bash -x -c "$CMD"', open).verdict).toBe("block");
  });

  it("passes bash -c with single-quoted literal", () => {
    expect(auditBashCommand("bash -c 'echo hello'", open).verdict).toBe("pass");
  });

  it("passes bash -c with double-quoted literal (no expansion)", () => {
    expect(auditBashCommand('bash -c "echo hello"', open).verdict).toBe("pass");
  });

  it("passes when allowShellEscape is true", () => {
    expect(auditBashCommand('bash -c "$CMD"', allowEscape).verdict).toBe("pass");
  });
});

describe("auditBashCommand — xargs detection", () => {
  it("escalates to ask for pipe into xargs", () => {
    expect(auditBashCommand("find . | xargs rm", open).verdict).toBe("ask");
  });

  it("escalates to ask even when allowSudo is set", () => {
    expect(auditBashCommand("find . | xargs rm", allowSudo).verdict).toBe("ask");
  });

  it("passes xargs without pipe (direct invocation)", () => {
    expect(auditBashCommand("xargs echo < file.txt", open).verdict).toBe("pass");
  });
});

describe("auditBashCommand — verdict priority", () => {
  it("returns block (sudo) before ask (xargs) when both present", () => {
    expect(auditBashCommand("sudo find . | xargs rm", open).verdict).toBe("block");
  });

  it("returns block (shell escape) before ask (xargs) when both present", () => {
    expect(auditBashCommand('bash -c "$X" | xargs rm', open).verdict).toBe("block");
  });
});
