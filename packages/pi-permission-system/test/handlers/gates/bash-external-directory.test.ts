import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AccessIntent } from "#src/access-intent/access-intent";
import { BashProgram } from "#src/access-intent/bash/program";
import { describeBashExternalDirectoryGate } from "#src/handlers/gates/bash-external-directory";
import type {
  GateBypass,
  GateDescriptor,
  GateResult,
} from "#src/handlers/gates/descriptor";
import { isGateBypass, isGateDescriptor } from "#src/handlers/gates/descriptor";
import type { ToolCallContext } from "#src/handlers/gates/types";
import { pathFlavorForPlatform } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import {
  allEvidence,
  findEvidence,
  type PromptPayload,
} from "#src/presentation/prompt-payload";
import type { PermissionCheckResult } from "#src/types";
import { getNonEmptyString, toRecord } from "#src/value-guards";

import { makeResolver } from "#test/helpers/gate-fixtures";

// ── helpers ────────────────────────────────────────────────────────────────

/** Every escaping path the payload lists, in payload order. */
function externalPaths(payload: PromptPayload): string[] {
  return allEvidence(payload, "external path").map((entry) => entry.text);
}

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
  return describeGateOnPlatform(process.platform, tcc, resolver);
}

/**
 * Variant of {@link describeGate} that injects an explicit host platform, so a
 * win32-specific decision can be exercised on a POSIX CI host (and vice versa)
 * without mocking `node:path` (#533).
 */
async function describeGateOnPlatform(
  platform: NodeJS.Platform,
  tcc: ToolCallContext,
  resolver: ScopedPermissionResolver,
): Promise<GateResult> {
  const normalizer = new PathNormalizer(
    pathFlavorForPlatform(platform),
    tcc.cwd,
  );
  const command = getNonEmptyString(toRecord(tcc.input).command);
  const bashProgram =
    tcc.toolName === "bash" && command
      ? await BashProgram.parse(command, normalizer)
      : null;
  return describeBashExternalDirectoryGate(
    tcc,
    bashProgram,
    resolver,
    normalizer,
  );
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
      expect(externalPaths((result as GateDescriptor).payload)).toEqual([
        join(homedir(), "pi-permission-system-repro-new"),
      ]);
    });

    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal — a braced shell expansion, not a template string
    it("prompts for a braced ${HOME} reference", async () => {
      const result = await describeGate(
        // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal — a braced shell expansion, not a template string
        makeTcc({ input: { command: 'ls "${HOME}/somewhere"' } }),
        makeResolver(makeCheckResult("ask")),
      );
      expect(isGateDescriptor(result)).toBe(true);
      expect(externalPaths((result as GateDescriptor).payload)).toEqual([
        join(homedir(), "somewhere"),
      ]);
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
      // `cat` is a pure-reader core word, so the path routes directionally.
      surface: "external_directory_read",
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
      surface: "external_directory_read",
      matchValues: path?.matchValues(),
      boundaryValue: path?.boundaryValue(),
    });
  });

  it("emits a bash_external_directory payload listing every escaping path", async () => {
    const resolver = makeResolver(makeCheckResult("ask"));
    const result = (await describeGate(
      makeTcc({ input: { command: "cat /outside/a.ts" } }),
      resolver,
    )) as GateDescriptor;

    expect(result.payload.kind).toBe("bash_external_directory");
    // The command is the decision value; the paths it reaches are evidence.
    expect(result.payload.request.value).toBe("cat /outside/a.ts");
    expect(result.payload.evidence).toContainEqual({
      label: "external path",
      text: "/outside/a.ts",
      detail: null,
    });
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
    expect(bypass.decidedBy).toEqual({
      kind: "session_approval",
      surface: "external_directory",
      pattern: null,
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
    expect(desc.sessionApproval.grants.length).toBeGreaterThan(0);
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

  it("descriptor surface names what the deciding path proved", async () => {
    const result = await describeGate(
      makeTcc(),
      makeResolver(makeCheckResult("ask")),
    );
    const desc = result as GateDescriptor;
    expect(desc.surface).toBe("external_directory_read");
  });

  it("descriptor decision surface names what the deciding path proved", async () => {
    const result = await describeGate(
      makeTcc(),
      makeResolver(makeCheckResult("ask")),
    );
    const desc = result as GateDescriptor;
    expect(desc.decision.surface).toBe("external_directory_read");
  });

  describe("directional routing (#807)", () => {
    it("routes a proven read to the read surface, end to end", async () => {
      const result = (await describeGate(
        makeTcc({ input: { command: "cat /outside/a.ts" } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;

      expect(result.surface).toBe("external_directory_read");
      expect(result.payload.request.surface).toBe("external_directory_read");
      expect(result.decision.surface).toBe("external_directory_read");
      expect(result.sessionApproval?.grants[0]?.surface).toBe(
        "external_directory_read",
      );
    });

    it("routes a proven write to the write surface", async () => {
      const result = (await describeGate(
        makeTcc({ input: { command: "echo hi > /outside/out.txt" } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;

      expect(result.surface).toBe("external_directory_write");
      expect(result.sessionApproval?.grants[0]?.surface).toBe(
        "external_directory_write",
      );
    });

    it("routes an unproven path to the bare family, which folds both", async () => {
      const result = (await describeGate(
        makeTcc({ input: { command: "rm -rf /outside/gone" } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;

      expect(result.surface).toBe("external_directory");
      expect(result.sessionApproval?.grants[0]?.surface).toBe(
        "external_directory",
      );
    });

    it("falls back to the bare family when one ask spans two directions", async () => {
      const result = (await describeGate(
        makeTcc({ input: { command: "cat /outside/a.ts > /outside/b.ts" } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;

      // One session approval holds one surface for all its patterns, so a
      // mixed-direction ask grants exactly today's width, never wider.
      expect(result.sessionApproval?.grants[0]?.surface).toBe(
        "external_directory",
      );
      expect(result.sessionApproval?.grants.length).toBe(2);
    });

    it("records the deciding path's effect and blame source in the log", async () => {
      const result = (await describeGate(
        makeTcc({ input: { command: "cat /outside/a.ts" } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;

      expect(result.logContext).toMatchObject({
        effect: "read",
        effectSource: "core",
      });
    });

    it("records a retraction as the blame source for a guarded word", async () => {
      const result = (await describeGate(
        makeTcc({ input: { command: "find /outside -delete" } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;

      expect(result.surface).toBe("external_directory");
      expect(result.logContext).toMatchObject({
        effect: "unproven",
        effectSource: "retracted",
      });
    });
  });

  it("payload carries the command and the boundary it escaped", async () => {
    const result = await describeGate(
      makeTcc({ input: { command: "cat /outside/file.ts" } }),
      makeResolver(makeCheckResult("ask")),
    );
    const { payload } = result as GateDescriptor;
    expect(payload.kind).toBe("bash_external_directory");
    expect(payload.request.value).toBe("cat /outside/file.ts");
    expect(findEvidence(payload, "working directory")?.text).toBe(
      "/test/project",
    );
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
    expect(desc.sessionApproval.grants.length).toBe(1);
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
    expect(desc.sessionApproval.grants.length).toBe(2);
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
    expect(desc.sessionApproval.grants.length).toBe(1);
  });
});

describe("describeBashExternalDirectoryGate — Git Bash semantics (win32)", () => {
  const winTcc = (command: string): ToolCallContext =>
    makeTcc({ cwd: "C:/projects/app", input: { command } });

  it("does not prompt for a /dev/null redirect target", async () => {
    const result = await describeGateOnPlatform(
      "win32",
      winTcc("echo hi > /dev/null"),
      makeResolver(makeCheckResult("ask")),
    );
    expect(result).toBeNull();
  });

  it("prompts for a /tmp path displayed as typed, not as C:\\tmp", async () => {
    const result = await describeGateOnPlatform(
      "win32",
      winTcc("ls /tmp"),
      makeResolver(makeCheckResult("ask")),
    );
    expect(isGateDescriptor(result)).toBe(true);
    expect(externalPaths((result as GateDescriptor).payload)).toEqual(["/tmp"]);
  });

  it("derives the session approval through the injected flavor, not the host", async () => {
    // A native Windows path carries backslash separators the *host* POSIX
    // `node:path` cannot see, so an ambient derivation collapses it to `./*`
    // and the recorded grant matches nothing (#655).
    const result = await describeGateOnPlatform(
      "win32",
      makeTcc({
        cwd: "C:\\Projects\\App",
        input: { command: "cat C:\\Other\\data\\x.txt" },
      }),
      makeResolver(makeCheckResult("ask")),
    );
    expect(isGateDescriptor(result)).toBe(true);
    expect(
      (result as GateDescriptor).sessionApproval?.grants.map(
        (grant) => grant.pattern,
      ),
    ).toEqual(["c:\\other\\data\\*"]);
  });

  // Invariant pin, not a probe: the pre-#655 ambient derivation also produced
  // `/tmp/logs/*` on a POSIX CI host, since it read the *host* separator. It
  // goes red only against a flavor-aware derivation that scopes on
  // `flavor.impl.sep` — the tempting rewrite that reintroduces the widening.
  it("keeps a POSIX-shaped Git Bash directory token scoped to itself", async () => {
    const result = await describeGateOnPlatform(
      "win32",
      winTcc("ls /tmp/logs/"),
      makeResolver(makeCheckResult("ask")),
    );
    expect(isGateDescriptor(result)).toBe(true);
    expect(
      (result as GateDescriptor).sessionApproval?.grants.map(
        (grant) => grant.pattern,
      ),
    ).toEqual(["/tmp/logs/*"]);
  });
});
