import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { AccessIntent } from "#src/access-intent/access-intent";
import { BashProgram } from "#src/access-intent/bash/program";
import {
  foldDeclaredCommandEffects,
  NO_DECLARED_COMMAND_EFFECTS,
} from "#src/config/command-effects-config";
import { describeBashExternalDirectoryGate } from "#src/handlers/gates/bash-external-directory";
import type {
  GateBypass,
  GateDescriptor,
  GateResult,
} from "#src/handlers/gates/descriptor";
import { isGateBypass, isGateDescriptor } from "#src/handlers/gates/descriptor";
import type { ToolCallContext } from "#src/handlers/gates/types";
import { pathFlavorForPlatform } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
import {
  PermissionResolver,
  type ScopedPermissionResolver,
} from "#src/policy/permission-resolver";
import {
  allEvidence,
  findEvidence,
  type PromptPayload,
} from "#src/presentation/prompt-payload";
import { renderReviewLogFacts } from "#src/presentation/review-log-renderer";
import { SessionRules } from "#src/session/session-rules";
import type { PermissionCheckResult } from "#src/types";
import { getNonEmptyString, toRecord } from "#src/value-guards";
import { makeResolver } from "#test/helpers/gate-fixtures";
import { createManagerWithConfig } from "#test/helpers/manager-harness";

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
    // `/outside` names nothing on disk, so the ask also carries the license.
    expect(result.promptDetails.accessIntent).toEqual({
      surface: "external_directory_read",
      matchValues: path?.matchValues(),
      boundaryValue: path?.boundaryValue(),
      delegationLicense: "nothing-on-disk",
    });
  });

  describe("the nothing-on-disk delegation license (ADR 0007 §8)", () => {
    // A distinctive top-level name, absent on any host, so the answer does not
    // depend on whether the machine happens to have `/outside`.
    const ABSENT_AT_ROOT = "/pi-permission-882-absent";

    async function licenseOf(command: string): Promise<string | undefined> {
      const result = (await describeGate(
        makeTcc({ input: { command } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;
      expect(isGateDescriptor(result)).toBe(true);
      return result.promptDetails.accessIntent?.delegationLicense;
    }

    it("licenses an undeclared tool's operand that names nothing on disk", async () => {
      expect(
        await licenseOf(`officecli set data.xlsx ${ABSENT_AT_ROOT}/Sheet1/B1`),
      ).toBe("nothing-on-disk");
    });

    it("withholds it when another flagged path sits under an existing directory", async () => {
      expect(
        await licenseOf(
          `officecli set ${ABSENT_AT_ROOT}/Sheet1/B1 ${join(tmpdir(), "pi-permission-882-absent", "x")}`,
        ),
      ).toBeUndefined();
    });

    it.each(["rm -rf /", "chmod -R 777 /", "ls /", "cat /."])(
      "withholds it from the filesystem root itself (%s)",
      async (command) => {
        expect(await licenseOf(command)).toBeUndefined();
      },
    );

    it.each([
      ["a glob", "cat /e?c/passwd"],
      ["a bracket glob", "cat /[e]tc/passwd"],
      ["a star glob", "cat /*"],
      ["a brace expansion", "cat /{etc,var}/hosts"],
      ["a parameter expansion", "cat /$X/passwd"],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional literal — a braced shell expansion, not a template string
      ["a quoted braced expansion", 'cat "/${X}c/passwd"'],
      ["a command substitution", "cat /$(echo etc)/passwd"],
      ["a backtick substitution", "cat /`echo etc`/passwd"],
      ["a backslash escape", "cat /e\\tc/passwd"],
    ])(
      "withholds it from %s the shell expands to a different path (%s)",
      async (_, command) => {
        expect(await licenseOf(command)).toBeUndefined();
      },
    );

    it.each([
      ["@(", "shopt -s extglob\nrm -rf /@(etc|var)"],
      ["+(", "shopt -s extglob\nls x /+(etc)"],
      ["!(", "shopt -s extglob\nls x /!(zzz)"],
      ["mid-word @(", "shopt -s extglob\nls x /e@(t)c"],
    ])(
      "withholds it from a command the parse could not read whole (extglob %s)",
      async (_, command) => {
        expect(await licenseOf(command)).toBeUndefined();
      },
    );

    it.each([
      ["a relative climb to the root", "cat ../../pi-permission-882-absent/x"],
      [
        "a relative path after a cd that fails",
        "cd /pi-permission-882-absent; cat ../../.ssh/id_rsa",
      ],
      [
        "a `..` segment, which the kernel resolves physically",
        "cat /pi-permission-882-absent/../pi-permission-882-other/x",
      ],
      ["a `.` segment", "cat /pi-permission-882-absent/./x"],
    ])(
      "withholds it from a token not spelled as the path it names (%s)",
      async (_, command) => {
        expect(await licenseOf(command)).toBeUndefined();
      },
    );

    it.each([
      ["a split absolute path", "cat /pi-permission-882-absent/e\\\ntc/passwd"],
      ["a split head", "cat /e\\\ntc/passwd"],
    ])(
      "withholds it from a command a backslash-newline joins (%s)",
      async (_, command) => {
        expect(await licenseOf(command)).toBeUndefined();
      },
    );

    it.each([
      ["a mid-word backtick", "cat /e`echo tc`/passwd"],
      ["a quoted head before a backtick", 'cat "/e"`echo tc`"/passwd"'],
      ["a mid-word process substitution", "cat /e<(true)tc/passwd"],
      ["a read redirect", "cat < /e`echo tc`/passwd"],
    ])(
      "withholds it from a token the grammar split out of one word (%s)",
      async (_, command) => {
        expect(await licenseOf(command)).toBeUndefined();
      },
    );

    it.each([
      ["a carriage return", "cat /e\rtc/passwd"],
      ["a form feed", "cat /pi-permission-882-e\ftc/passwd"],
      ["a vertical tab", "cat /pi-permission-882-e\vtc/passwd"],
    ])(
      "withholds it from a token the grammar split where bash does not (%s)",
      async (_, command) => {
        // tree-sitter-bash treats these as whitespace; bash splits words only
        // on a space, a tab, or a newline, so the word it runs is longer.
        expect(await licenseOf(command)).toBeUndefined();
      },
    );

    it("withholds it from a token after a backslash-escaped tab, which bash keeps in the word", async () => {
      expect(
        await licenseOf("cat a\\\t/pi-permission-882-absent/x"),
      ).toBeUndefined();
    });

    it("still licenses a whole word bounded by a tab", async () => {
      expect(
        await licenseOf(
          "officecli set data.xlsx\t/pi-permission-882-absent/B1",
        ),
      ).toBe("nothing-on-disk");
    });

    it("withholds it from a value read out of part of an argument", async () => {
      // `--file=` and the path share one word; the token has no span of its own
      // to bound, so it cannot be shown to stand alone.
      expect(
        await licenseOf("grep --file=/pi-permission-882-absent/x foo"),
      ).toBeUndefined();
    });

    it("withholds it from a token beside a parenthesis, which is refused as a boundary", async () => {
      // A parenthesis ends a word only around a subshell or group; the check
      // does not tell the two apart, so it costs this whole word a prompt.
      expect(
        await licenseOf("(cat /pi-permission-882-absent/B1)"),
      ).toBeUndefined();
    });

    it.each([
      ["a trailing operator", "cat /pi-permission-882-absent/B1;"],
      ["a pipe", "cat /pi-permission-882-absent/B1|wc -l"],
      ["a read redirect", "cat </pi-permission-882-absent/B1"],
    ])(
      "still licenses a whole word bounded by an operator (%s)",
      async (_, command) => {
        expect(await licenseOf(command)).toBe("nothing-on-disk");
      },
    );

    it("withholds it from a proven write", async () => {
      expect(await licenseOf(`echo x > ${ABSENT_AT_ROOT}/f`)).toBeUndefined();
    });

    it("withholds it from a relative path a non-literal cd left unlocated", async () => {
      // From the session cwd `/test/project` the token would resolve to
      // `/pi-permission-882-absent/x`, but after `cd "$D"` it could land under
      // any existing directory, so the guess licenses nothing.
      expect(
        await licenseOf('cd "$D" && cat ../../pi-permission-882-absent/x'),
      ).toBeUndefined();
    });

    it.each([
      [
        "located first",
        'cd "$D" && cat /pi-permission-882-absent/x ../../pi-permission-882-absent/x',
      ],
      [
        "unlocated first",
        'cd "$D" && cat ../../pi-permission-882-absent/x /pi-permission-882-absent/x',
      ],
    ])(
      "keeps a merged path unlocated when any of its tokens was (%s)",
      async (_order, command) => {
        // Both tokens resolve to one entry; the absolute one is located, the
        // relative one is not, and the merge must not forget either.
        expect(await licenseOf(command)).toBeUndefined();
      },
    );
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
    expect(bypass.log).toEqual({
      event: "permission_request.session_approved",
      details: {
        source: "tool_call",
        toolCallId: "tc-1",
        toolName: "bash",
        agentName: null,
        command: "cat /outside/project/file.ts",
        externalPaths: ["/outside/project/file.ts"],
        resolution: "session_approved",
      },
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

  it("writes no entry when every external path is config-rule allowed", async () => {
    // A config allow suppresses the prompt just as a session allow does, but
    // no session grant decided it, so no session_approved entry is written —
    // the same silence every other gate gives a policy allow.
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) =>
      intentValues(intent).length > 0
        ? makeCheckResult("allow", {
            source: "special",
            matchedPattern: "/outside/*",
          })
        : makeCheckResult("ask"),
    );
    const result = await describeGate(makeTcc(), resolver);
    expect(result).toBeNull();
  });

  it("writes no entry when every external path is allowed by the universal fallback", async () => {
    const result = await describeGate(
      makeTcc(),
      makeResolver(makeCheckResult("allow")),
    );
    expect(result).toBeNull();
  });

  it("lists only the session-covered paths when the rest are config-allowed", async () => {
    const resolver = makeResolver();
    resolver.resolve.mockImplementation((intent) =>
      intentValues(intent).includes("/outside/a.ts")
        ? makeCheckResult("allow", { source: "session" })
        : makeCheckResult("allow", { matchedPattern: "/outside/*" }),
    );
    const result = await describeGate(
      makeTcc({ input: { command: "diff /outside/a.ts /outside/b.ts" } }),
      resolver,
    );
    expect(isGateBypass(result)).toBe(true);
    const bypass = result as GateBypass;
    expect(bypass.decidedBy).toEqual({
      kind: "session_approval",
      surface: "external_directory",
      pattern: null,
    });
    expect(bypass.log?.details.externalPaths).toEqual(["/outside/a.ts"]);
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

  describe("a redirect's target that does not exist yet (#609)", () => {
    it("asks on the write surface for a bare target after a non-literal cd", async () => {
      const result = (await describeGate(
        makeTcc({ input: { command: 'cd "$D" && echo hi > out.txt' } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;

      expect(result.surface).toBe("external_directory_write");
    });
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

    it("grants each path only the direction its own token proved", async () => {
      const result = (await describeGate(
        makeTcc({ input: { command: "cat /outside/a.ts > /elsewhere/b.ts" } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;

      expect(result.sessionApproval?.grants).toEqual([
        { surface: "external_directory_read", pattern: "/outside/*" },
        { surface: "external_directory_write", pattern: "/elsewhere/*" },
      ]);
    });

    it("grants both directions when two directions share a directory", async () => {
      const result = (await describeGate(
        makeTcc({ input: { command: "cat /outside/a.ts > /outside/b.ts" } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;

      // Both tokens derive the same directory glob, so the two grants
      // reconstitute what the bare family sugar-expands to. That is correct:
      // the user did approve a read and a write in this directory.
      expect(result.sessionApproval?.grants).toEqual([
        { surface: "external_directory_read", pattern: "/outside/*" },
        { surface: "external_directory_write", pattern: "/outside/*" },
      ]);
    });

    it("blames the deciding path on its effect and source in the payload, not the log context", async () => {
      const result = (await describeGate(
        makeTcc({ input: { command: "cat /outside/a.ts" } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;

      expect(result.payload.request.decidingPath).toEqual({
        path: "/outside/a.ts",
        effect: "read",
        effectSource: "core",
      });
      expect(result.logContext).not.toHaveProperty("effect");
      expect(result.logContext).not.toHaveProperty("effectSource");
    });

    it("records a retraction as the blame source for a guarded word", async () => {
      const result = (await describeGate(
        makeTcc({ input: { command: "find /outside -delete" } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;

      expect(result.surface).toBe("external_directory");
      expect(result.payload.request.decidingPath).toEqual({
        path: "/outside",
        effect: "unproven",
        effectSource: "retracted",
      });
      expect(result.logContext).not.toHaveProperty("effectSource");
    });

    it("records a retraction when a variable may spell the withdrawing option", async () => {
      const result = (await describeGate(
        makeTcc({ input: { command: "A=-delete; find /outside $A" } }),
        makeResolver(makeCheckResult("ask")),
      )) as GateDescriptor;

      expect(result.surface).toBe("external_directory");
      expect(result.payload.request.decidingPath).toEqual({
        path: "/outside",
        effect: "unproven",
        effectSource: "retracted",
      });
      expect(result.logContext).not.toHaveProperty("effectSource");
    });

    it("records the declaring scope as the blame source for a declared reader", async () => {
      const tcc = makeTcc({ input: { command: "git log /outside/a.ts" } });
      const normalizer = new PathNormalizer(
        pathFlavorForPlatform(process.platform),
        tcc.cwd,
      );
      const program = await BashProgram.parse(
        "git log /outside/a.ts",
        normalizer,
        {
          commandEffects: foldDeclaredCommandEffects(
            NO_DECLARED_COMMAND_EFFECTS,
            { git: { subcommands: { log: "read" } } },
            "project",
          ),
        },
      );

      const result = describeBashExternalDirectoryGate(
        tcc,
        program,
        makeResolver(makeCheckResult("ask")),
        normalizer,
      ) as GateDescriptor;

      expect(result.surface).toBe("external_directory_read");
      expect(result.payload.request.decidingPath).toEqual({
        path: "/outside/a.ts",
        effect: "read",
        effectSource: "declared-project",
      });
      // What the review log persists for every entry of this ask.
      expect(renderReviewLogFacts(result.payload)).toMatchObject({
        decidingPath: "/outside/a.ts",
        effect: "read",
        effectSource: "declared-project",
      });
      expect(result.logContext).not.toHaveProperty("effectSource");
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

describe("describeBashExternalDirectoryGate — review-log provenance through the real resolver", () => {
  const command = "head -1 /etc/hostname";

  async function describeWithConfig(
    permission: Record<string, unknown>,
    sessionRules: SessionRules,
  ): Promise<GateResult> {
    const { manager, cleanup } = createManagerWithConfig(permission);
    try {
      manager.configureForCwd("/test/project");
      return await describeGate(
        makeTcc({ input: { command } }),
        new PermissionResolver(manager, sessionRules),
      );
    } finally {
      cleanup();
    }
  }

  it("writes no entry when the universal fallback allows the path", async () => {
    const result = await describeWithConfig(
      { "*": "allow" },
      new SessionRules(),
    );
    expect(result).toBeNull();
  });

  it("records a session approval when a session grant covers the path", async () => {
    const sessionRules = new SessionRules();
    sessionRules.approve("external_directory_read", "/etc/*");
    const result = await describeWithConfig({ "*": "allow" }, sessionRules);
    expect(isGateBypass(result)).toBe(true);
    const bypass = result as GateBypass;
    expect(bypass.log?.event).toBe("permission_request.session_approved");
    expect(bypass.log?.details.externalPaths).toEqual(["/etc/hostname"]);
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
