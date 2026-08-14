import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AccessIntent } from "#src/access-intent/access-intent";
import { BashProgram } from "#src/access-intent/bash/program";
import { highlightOccurrences } from "#src/authority/permission-prompt-component";
import { describeBashExternalDirectoryGate } from "#src/handlers/gates/bash-external-directory";
import type {
  GateBypass,
  GateDescriptor,
  GateResult,
} from "#src/handlers/gates/descriptor";
import { isGateBypass, isGateDescriptor } from "#src/handlers/gates/descriptor";
import type { ToolCallContext } from "#src/handlers/gates/types";
import { pathFlavorForPlatform, win32PathFlavor } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { PermissionCheckResult } from "#src/types";
import { getNonEmptyString, toRecord } from "#src/value-guards";

import { makeResolver } from "#test/helpers/gate-fixtures";

// ── helpers ────────────────────────────────────────────────────────────────

function makeTcc(overrides: Partial<ToolCallContext> = {}): ToolCallContext {
  return {
    toolName: "bash",
    agentName: null,
    input: { command: "cat /outside/project/file.ts" },
    toolCallId: "tc-1",
    cwd: "/test/project",
    ...overrides,
  };
}

function makeCheckResult(
  state: "allow" | "deny" | "ask",
  overrides: Partial<PermissionCheckResult> = {},
): PermissionCheckResult {
  return {
    state,
    toolName: "external_directory",
    source: "special",
    origin: "builtin",
    ...overrides,
  };
}

/** Extract the policy match values a resolve(intent) call carries. */
function intentValues(intent: AccessIntent): readonly string[] {
  if (intent.kind === "access-path") return intent.path.matchValues();
  return [];
}

/**
 * Mirror the handler's parse-once derivation: parse the bash command into a
 * shared `BashProgram` and inject it, exactly as `permission-gate-handler.ts`
 * does, so the gate is exercised through the production wiring.
 */
async function describeGate(
  tcc: ToolCallContext,
  resolver: ScopedPermissionResolver,
): Promise<GateResult> {
  const command = getNonEmptyString(toRecord(tcc.input).command);
  const bashProgram =
    tcc.toolName === "bash" && command
      ? await BashProgram.parse(
          command,
          new PathNormalizer(pathFlavorForPlatform(process.platform), tcc.cwd),
        )
      : null;
  return describeBashExternalDirectoryGate(tcc, bashProgram, resolver);
}

// ── tests ──────────────────────────────────────────────────────────────────

describe("describeBashExternalDirectoryGate", () => {
  it("returns null when tool is not bash", async () => {
    const result = await describeGate(
      makeTcc({ toolName: "read" }),
      makeResolver(makeCheckResult("ask")),
    );
    expect(result).toBeNull();
  });

  it("returns null when command has no external paths", async () => {
    const result = await describeGate(
      makeTcc({ input: { command: "ls -la" } }),
      makeResolver(makeCheckResult("ask")),
    );
    expect(result).toBeNull();
  });

  describe("resolved shell expansions (#694)", () => {
    it("prompts for a $HOME write target that does not exist yet", async () => {
      const resolver = makeResolver(makeCheckResult("ask"));
      const result = await describeGate(
        makeTcc({
          input: {
            command: 'touch "$HOME/pi-permission-system-repro-new"',
          },
        }),
        resolver,
      );
      expect(isGateDescriptor(result)).toBe(true);
      expect((result as GateDescriptor).denialContext).toMatchObject({
        kind: "bash_external_directory",
        externalPaths: [
          { path: join(homedir(), "pi-permission-system-repro-new") },
        ],
      });
    });

    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal — a braced shell expansion, not a template string
    it("prompts for a braced ${HOME} reference", async () => {
      const result = await describeGate(
        // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal — a braced shell expansion, not a template string
        makeTcc({ input: { command: 'ls "${HOME}/somewhere"' } }),
        makeResolver(makeCheckResult("ask")),
      );
      expect(isGateDescriptor(result)).toBe(true);
      expect((result as GateDescriptor).denialContext).toMatchObject({
        kind: "bash_external_directory",
        externalPaths: [{ path: join(homedir(), "somewhere") }],
      });
    });

    it("does not prompt for a variable it cannot resolve", async () => {
      const result = await describeGate(
        makeTcc({ input: { command: 'CURRENT="$HOME"; ls "$CURRENT"' } }),
        makeResolver(makeCheckResult("ask")),
      );
      expect(result).toBeNull();
    });
  });

  it("resolves each external path on the external_directory surface via an access-path intent (#418)", async () => {
    const resolver = makeResolver(makeCheckResult("ask"));
    await describeGate(
      makeTcc({ input: { command: "cat /outside/a.ts" } }),
      resolver,
    );
    const intent = resolver.resolve.mock.calls[0][0];
    expect(intent).toMatchObject({
      kind: "access-path",
      surface: "external_directory",
      agentName: undefined,
    });
    expect(intentValues(intent)).toEqual(["/outside/a.ts"]);
  });

  it("carries the deciding path's access facts on promptDetails (bash external_directory surface)", async () => {
    const resolver = makeResolver(makeCheckResult("ask"));
    const result = (await describeGate(
      makeTcc({ input: { command: "cat /outside/a.ts" } }),
      resolver,
    )) as GateDescriptor;
    const intent = resolver.resolve.mock.calls[0][0];
    const path = intent.kind === "access-path" ? intent.path : undefined;
    expect(path).toBeDefined();
    expect(result.promptDetails.accessIntent).toEqual({
      surface: "external_directory",
      matchValues: path?.matchValues(),
      boundaryValue: path?.boundaryValue(),
    });
    expect(result.promptDetails.highlightText).toBe("/outside/a.ts");
  });

  it("highlights the disclosed path before the formatter's sentence period", async () => {
    const resolver = makeResolver(makeCheckResult("ask"));
    const result = (await describeGate(
      makeTcc({ input: { command: "cat /outside/a.ts" } }),
      resolver,
    )) as GateDescriptor;
    const target = result.promptDetails.highlightText!;

    expect(highlightOccurrences(result.promptDetails.message, target, (text) => `<warning>${text}</warning>`)).toContain(
      `<warning>${target}</warning>. Allow this external directory access?`,
    );
  });

  it("returns GateBypass when all external paths are session-covered", async () => {
    const resolver = makeResolver(
      makeCheckResult("allow", { source: "session" }),
    );
    const result = await describeGate(makeTcc(), resolver);
    expect(result).not.toBeNull();
    expect(isGateBypass(result)).toBe(true);
    const bypass = result as GateBypass;
    expect(bypass.action).toBe("allow");
    expect(bypass.log).toMatchObject({
      event: "permission_request.session_approved",
      details: expect.objectContaining({ resolution: "session_approved" }),
    });
  });

  it("returns GateDescriptor with multi-pattern sessionApproval for uncovered paths", async () => {
    const result = await describeGate(
      makeTcc({ input: { command: "diff /outside/a.ts /outside/b.ts" } }),
      makeResolver(makeCheckResult("ask")),
    );
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.sessionApproval).toBeDefined();
    if (!desc.sessionApproval) return;
    expect(desc.sessionApproval.patterns.length).toBeGreaterThan(0);
  });

  it("returns GateBypass when all external paths are config-level allowed", async () => {
    // Config-level allow (source: "special") should suppress the prompt,
    // not just session-level allow. This was the bug: source !== "session"
    // kept config-allowed paths in the uncovered set.
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) =>
      intentValues(intent).length > 0
        ? makeCheckResult("allow", { source: "special" })
        : makeCheckResult("ask"),
    );
    const result = await describeGate(makeTcc(), resolver);
    expect(result).not.toBeNull();
    expect(isGateBypass(result)).toBe(true);
  });

  it("uses worst-check state from uncovered paths for preCheck (config deny > catch-all ask)", async () => {
    // The path-less extCheck used to always return the "*" catch-all (ask),
    // silently downgrading a config-level deny to ask. After the fix, the
    // descriptor's preCheck is derived from the actual path check result.
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) =>
      intentValues(intent).length > 0
        ? makeCheckResult("deny", { source: "special" })
        : makeCheckResult("ask"),
    );
    const result = await describeGate(makeTcc(), resolver);
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.preCheck?.state).toBe("deny");
  });

  it("descriptor surface is 'external_directory'", async () => {
    const result = await describeGate(
      makeTcc(),
      makeResolver(makeCheckResult("ask")),
    );
    const desc = result as GateDescriptor;
    expect(desc.surface).toBe("external_directory");
  });

  it("descriptor decision surface is 'external_directory'", async () => {
    const result = await describeGate(
      makeTcc(),
      makeResolver(makeCheckResult("ask")),
    );
    const desc = result as GateDescriptor;
    expect(desc.decision.surface).toBe("external_directory");
  });

  it("denialContext contains the command and external paths", async () => {
    const result = await describeGate(
      makeTcc({ input: { command: "cat /outside/file.ts" } }),
      makeResolver(makeCheckResult("ask")),
    );
    const desc = result as GateDescriptor;
    expect(desc.denialContext).toMatchObject({
      kind: "bash_external_directory",
      command: "cat /outside/file.ts",
      cwd: "/test/project",
    });
  });

  it("promptDetails includes command and tool_call source", async () => {
    const result = await describeGate(
      makeTcc({ agentName: "agent-1", toolCallId: "tc-5" }),
      makeResolver(makeCheckResult("ask")),
    );
    const desc = result as GateDescriptor;
    expect(desc.promptDetails).toMatchObject({
      source: "tool_call",
      agentName: "agent-1",
      toolCallId: "tc-5",
      toolName: "bash",
      command: "cat /outside/project/file.ts",
    });
  });

  it("config-allowed path is excluded; remaining ask path produces a descriptor", async () => {
    // One path config-allowed, one config-ask → descriptor with only the ask path.
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) =>
      intentValues(intent).includes("/outside/a.ts")
        ? makeCheckResult("allow", { source: "special" })
        : makeCheckResult("ask"),
    );
    const result = await describeGate(
      makeTcc({ input: { command: "diff /outside/a.ts /outside/b.ts" } }),
      resolver,
    );
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.sessionApproval).toBeDefined();
    if (!desc.sessionApproval) return;
    expect(desc.sessionApproval.patterns.length).toBe(1);
    expect(desc.preCheck?.state).toBe("ask");
  });

  it("config-denied path makes worstCheck deny even when another path is ask", async () => {
    // One path config-denied, one config-ask → descriptor with preCheck.state === "deny".
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) =>
      intentValues(intent).includes("/outside/a.ts")
        ? makeCheckResult("deny", { source: "special" })
        : makeCheckResult("ask"),
    );
    const result = await describeGate(
      makeTcc({ input: { command: "diff /outside/a.ts /outside/b.ts" } }),
      resolver,
    );
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.preCheck?.state).toBe("deny");
    // Both paths are uncovered (neither is allow), so both patterns are included.
    expect(desc.sessionApproval).toBeDefined();
    if (!desc.sessionApproval) return;
    expect(desc.sessionApproval.patterns.length).toBe(2);
  });

  it("only includes uncovered paths when some are session-covered", async () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) =>
      intentValues(intent).includes("/outside/a.ts")
        ? makeCheckResult("allow", { source: "session" })
        : makeCheckResult("ask"),
    );
    const result = await describeGate(
      makeTcc({ input: { command: "diff /outside/a.ts /outside/b.ts" } }),
      resolver,
    );
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    // Should have patterns only for the uncovered path
    expect(desc.sessionApproval).toBeDefined();
    if (!desc.sessionApproval) return;
    expect(desc.sessionApproval.patterns.length).toBe(1);
  });
});

describe("describeBashExternalDirectoryGate — Git Bash semantics (win32)", () => {
  async function describeGateWin32(
    tcc: ToolCallContext,
    resolver: ScopedPermissionResolver,
  ): Promise<GateResult> {
    const command = getNonEmptyString(toRecord(tcc.input).command);
    const bashProgram =
      tcc.toolName === "bash" && command
        ? await BashProgram.parse(
            command,
            new PathNormalizer(win32PathFlavor, tcc.cwd),
          )
        : null;
    return describeBashExternalDirectoryGate(tcc, bashProgram, resolver);
  }

  const winTcc = (command: string): ToolCallContext =>
    makeTcc({ cwd: "C:/projects/app", input: { command } });

  it("does not prompt for a /dev/null redirect target", async () => {
    const result = await describeGateWin32(
      winTcc("echo hi > /dev/null"),
      makeResolver(makeCheckResult("ask")),
    );
    expect(result).toBeNull();
  });

  it("prompts for a /tmp path displayed as typed, not as C:\\tmp", async () => {
    const result = await describeGateWin32(
      winTcc("ls /tmp"),
      makeResolver(makeCheckResult("ask")),
    );
    expect(isGateDescriptor(result)).toBe(true);
    const desc = result as GateDescriptor;
    expect(desc.denialContext).toMatchObject({
      kind: "bash_external_directory",
      externalPaths: [{ path: "/tmp" }],
    });
  });
});
