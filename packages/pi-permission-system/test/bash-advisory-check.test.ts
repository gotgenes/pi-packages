import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AccessIntent } from "#src/access-intent/access-intent";
import {
  resetWarmBashParser,
  warmBashParser,
} from "#src/access-intent/bash/parser";
import { resolveBashAdvisoryCheck } from "#src/bash-advisory-check";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { PermissionCheckResult } from "#src/types";

import { makeCheckResult } from "#test/helpers/handler-fixtures";

/**
 * Resolver whose `resolve` dispatches on the bash command text, so a test can
 * assign a distinct decision to each decomposed sub-command.
 */
function makeBashResolver(
  byCommand: Record<string, PermissionCheckResult> = {},
  fallback: PermissionCheckResult = makeCheckResult({ toolName: "bash" }),
): ScopedPermissionResolver {
  return {
    resolve: vi.fn((intent: AccessIntent): PermissionCheckResult => {
      if (intent.kind === "tool" && intent.surface === "bash") {
        const command = (intent.input as { command?: string }).command ?? "";
        return byCommand[command] ?? fallback;
      }
      return fallback;
    }),
  };
}

describe("resolveBashAdvisoryCheck", () => {
  beforeEach(() => {
    resetWarmBashParser();
  });
  afterEach(() => {
    resetWarmBashParser();
  });

  describe("cold (parser not warmed)", () => {
    it("resolves the whole command as a single bash tool intent", () => {
      const resolver = makeBashResolver();
      resolveBashAdvisoryCheck(
        "cd /repo && npm install x",
        "my-agent",
        resolver,
      );
      expect(resolver.resolve).toHaveBeenCalledTimes(1);
      expect(resolver.resolve).toHaveBeenCalledWith({
        kind: "tool",
        surface: "bash",
        input: { command: "cd /repo && npm install x" },
        agentName: "my-agent",
      });
    });
  });

  describe("warm (parser warmed)", () => {
    beforeEach(async () => {
      await warmBashParser();
    });

    it("decomposes a chained command and returns the most-restrictive unit", () => {
      const resolver = makeBashResolver({
        "cd /repo": makeCheckResult({ state: "allow", toolName: "bash" }),
        "npm install x": makeCheckResult({
          state: "deny",
          toolName: "bash",
          matchedPattern: "npm *",
        }),
      });
      const result = resolveBashAdvisoryCheck(
        "cd /repo && npm install x",
        undefined,
        resolver,
      );
      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("npm *");
      // Each unit is evaluated on the bash surface.
      expect(resolver.resolve).toHaveBeenCalledWith({
        kind: "tool",
        surface: "bash",
        input: { command: "npm install x" },
        agentName: undefined,
      });
    });

    it("floors an opaque wrapper allow to ask", () => {
      const resolver = makeBashResolver({
        'bash -c "rm -rf /"': makeCheckResult({
          state: "allow",
          toolName: "bash",
        }),
      });
      const result = resolveBashAdvisoryCheck(
        'bash -c "rm -rf /"',
        undefined,
        resolver,
      );
      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe("<opaque-bash-wrapper>");
    });

    it("fails closed for a non-empty command that parses to zero units", () => {
      const resolver = makeBashResolver();
      const result = resolveBashAdvisoryCheck("> out.txt", undefined, resolver);
      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe("<unparseable-bash-command>");
      // The whole command is resolved once, to see whether a deny covers it.
      expect(resolver.resolve).toHaveBeenCalledTimes(1);
    });

    it("reports the explicit deny for an unparseable command covered by a deny rule", () => {
      const resolver = makeBashResolver({
        "> out.txt": makeCheckResult({
          state: "deny",
          toolName: "bash",
          matchedPattern: "> *",
        }),
      });

      const result = resolveBashAdvisoryCheck("> out.txt", undefined, resolver);

      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("> *");
    });

    it("evaluates a nested command inside a substitution", () => {
      const resolver = makeBashResolver({
        "echo $(rm -rf /)": makeCheckResult({
          state: "allow",
          toolName: "bash",
        }),
        "rm -rf /": makeCheckResult({
          state: "deny",
          toolName: "bash",
          matchedPattern: "rm *",
        }),
      });
      const result = resolveBashAdvisoryCheck(
        "echo $(rm -rf /)",
        undefined,
        resolver,
      );
      expect(result.state).toBe("deny");
      expect(result.commandContext).toBe("command_substitution");
    });

    it("evaluates a nested command hosted in a redirect target (#741)", () => {
      const resolver = makeBashResolver({
        'echo "hello world"': makeCheckResult({
          state: "allow",
          toolName: "bash",
          matchedPattern: "echo *",
        }),
        "rm *.txt": makeCheckResult({
          state: "deny",
          toolName: "bash",
          matchedPattern: "rm *",
        }),
      });

      const result = resolveBashAdvisoryCheck(
        'echo "hello world" > $(rm *.txt)',
        undefined,
        resolver,
      );

      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("rm *");
      expect(result.commandContext).toBe("command_substitution");
    });
  });
});
