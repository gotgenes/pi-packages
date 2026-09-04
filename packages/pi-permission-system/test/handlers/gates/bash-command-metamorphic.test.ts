/**
 * Metamorphic totality property for the bash command gate (#452, A3).
 *
 * Wrapping any `ask`/`deny` command in `cd /x && <cmd>` must not weaken the
 * decision — the chain decomposition + most-restrictive-wins, combined with the
 * fail-closed empty-parse fallback, guarantees a `cd …` prefix can never let a
 * gated command ride a permissive top-level `*`.
 *
 * A focused parametrized table over the real tree-sitter parse + resolve, not a
 * full fuzzer (tree-sitter fuzzing is brittle); it pins A3 directly.
 */
import { describe, expect, it } from "vitest";
import { BashProgram } from "#src/access-intent/bash/program";
import { resolveBashCommandCheck } from "#src/handlers/gates/bash-command";
import { pathFlavorForPlatform } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path-normalizer";
import type { ScopedPermissionResolver } from "#src/permission-resolver";
import type { PermissionState } from "#src/types";

import { makeCheckResult } from "#test/helpers/handler-fixtures";

/** Decision strength ordering: deny (2) > ask (1) > allow (0). */
const STRENGTH: Record<PermissionState, number> = {
  allow: 0,
  ask: 1,
  deny: 2,
};

/**
 * Resolver whose decision keys on a command substring → state map. A command
 * matching no entry resolves to allow (the permissive top-level `*`).
 */
function makeKeyedResolver(
  rules: { match: string; state: PermissionState }[],
): ScopedPermissionResolver {
  return {
    resolve: (intent) => {
      const command =
        intent.kind === "tool"
          ? ((intent.input as { command?: string }).command ?? "")
          : "";
      const rule = rules.find((r) => command.includes(r.match));
      const state: PermissionState = rule?.state ?? "allow";
      return makeCheckResult({ state, source: "bash", command });
    },
  };
}

async function decide(
  command: string,
  resolver: ScopedPermissionResolver,
): Promise<PermissionState> {
  const program = await BashProgram.parse(
    command,
    new PathNormalizer(pathFlavorForPlatform(process.platform), "/cwd"),
  );
  return resolveBashCommandCheck(
    command,
    program.commands(),
    undefined,
    resolver,
  ).state;
}

describe("bash command gate — metamorphic totality", () => {
  const cases: { bare: string; state: PermissionState }[] = [
    { bare: "git push", state: "ask" },
    { bare: "git commit -m wip", state: "ask" },
    { bare: "rm -rf build", state: "deny" },
    { bare: "npm install pkg", state: "deny" },
    { bare: "gh pr create", state: "ask" },
  ];

  for (const { bare, state } of cases) {
    it(`wrapping "${bare}" in a cd prefix does not weaken its ${state} decision`, async () => {
      const resolver = makeKeyedResolver([
        { match: bare.split(" ")[0] ?? bare, state },
      ]);

      const bareDecision = await decide(bare, resolver);
      const wrappedDecision = await decide(`cd /repo && ${bare}`, resolver);

      expect(STRENGTH[wrappedDecision]).toBeGreaterThanOrEqual(
        STRENGTH[bareDecision],
      );
      expect(wrappedDecision).toBe(state);
    });
  }
});

/**
 * The same totality property for nested execution hosts (#741).
 *
 * A command hosted in a redirect target or an interpolating heredoc body really
 * executes, so hosting a gated command there must not weaken its decision — the
 * enclosing `echo`/`cat` resolves to a permissive allow, and only the nested
 * unit carries the restriction.
 */
describe("bash command gate — nested execution hosts do not weaken", () => {
  const hosts: { label: string; wrap: (cmd: string) => string }[] = [
    { label: "a stdout redirect", wrap: (c) => `echo hi > $(${c})` },
    { label: "an appending redirect", wrap: (c) => `echo hi >> $(${c})` },
    { label: "a stderr redirect", wrap: (c) => `echo hi 2> \`${c}\`` },
    { label: "an input process substitution", wrap: (c) => `cat < <(${c})` },
    {
      label: "an interpolating heredoc",
      wrap: (c) => `cat <<EOF\n$(${c})\nEOF`,
    },
  ];

  const cases: { bare: string; state: PermissionState }[] = [
    { bare: "rm -rf build", state: "deny" },
    { bare: "git push", state: "ask" },
  ];

  for (const { label, wrap } of hosts) {
    for (const { bare, state } of cases) {
      it(`hosting "${bare}" in ${label} does not weaken its ${state} decision`, async () => {
        const resolver = makeKeyedResolver([
          { match: bare.split(" ")[0] ?? bare, state },
        ]);

        const bareDecision = await decide(bare, resolver);
        const hostedDecision = await decide(wrap(bare), resolver);

        expect(STRENGTH[hostedDecision]).toBeGreaterThanOrEqual(
          STRENGTH[bareDecision],
        );
        expect(hostedDecision).toBe(state);
      });
    }
  }

  it("denies the reported repro when the enclosing command is allowed", async () => {
    // #741: `echo *` allowed, `rm *` denied — the redirect-hosted `rm` decides.
    const resolver = makeKeyedResolver([{ match: "rm", state: "deny" }]);

    expect(await decide('echo "hello world" > $(rm *.txt)', resolver)).toBe(
      "deny",
    );
  });

  it("leaves a quoted heredoc body literal, so it does not gate", async () => {
    const resolver = makeKeyedResolver([{ match: "rm", state: "deny" }]);

    expect(await decide("cat <<'EOF'\n$(rm x)\nEOF", resolver)).toBe("allow");
  });
});

/**
 * The same never-weaker property for wrapper transparency (#803).
 *
 * An exempt wrapper resolves by its inner command's own rule instead of the
 * floor, which means the gate returns a result assembled from two resolves —
 * the inner one's verdict, the outer one's command. This is the property that
 * composite has to satisfy, and it is stronger than any single table row:
 * wrapping a command in a transparent wrapper may only hold the decision or
 * strengthen it, never weaken it.
 */
describe("bash command gate — a transparent wrapper does not weaken", () => {
  const wrappers = [
    (cmd: string) => `xargs ${cmd}`,
    (cmd: string) => `time ${cmd}`,
    (cmd: string) => `sudo timeout 5 xargs ${cmd}`,
  ];

  const cases: { bare: string; state: PermissionState }[] = [
    { bare: "grep -l foo", state: "allow" },
    { bare: "grep -l foo", state: "ask" },
    { bare: "grep -l foo", state: "deny" },
    { bare: "cat notes.txt", state: "deny" },
    { bare: "wc -l", state: "ask" },
  ];

  for (const wrap of wrappers) {
    for (const { bare, state } of cases) {
      it(`wrapping "${bare}" in "${wrap("…")}" does not weaken its ${state} decision`, async () => {
        const resolver = makeKeyedResolver([
          { match: bare.split(" ")[0] ?? bare, state },
        ]);

        const bareDecision = await decide(bare, resolver);
        const wrappedDecision = await decide(wrap(bare), resolver);

        expect(STRENGTH[wrappedDecision]).toBeGreaterThanOrEqual(
          STRENGTH[bareDecision],
        );
      });
    }
  }

  it("holds the decision rather than flooring it, for an allowed pure reader", async () => {
    // The relief itself: without the exemption this is `ask` (the floor).
    const resolver = makeKeyedResolver([]);

    expect(await decide("xargs grep -l foo", resolver)).toBe("allow");
  });

  it("still floors a wrapper whose inner command is not a pure reader", async () => {
    const resolver = makeKeyedResolver([]);

    expect(await decide("xargs pnpm test", resolver)).toBe("ask");
  });

  // A redirect makes the statement write whatever the wrapped command reads, so
  // the exemption must not survive one — including a destination the parse
  // cannot resolve, which is the shape no other surface sees either (#609).
  it.each([
    "xargs grep -l foo > out.txt",
    "xargs grep -l foo >> out.txt",
    "xargs grep -l foo > $OUT",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: a bash brace expansion, the destination shape under test
    "xargs grep -l foo >${OUT}",
    "xargs grep -l foo > $(mktemp)",
  ])("floors %s despite the pure-reader inner command", async (command) => {
    const resolver = makeKeyedResolver([]);

    expect(await decide(command, resolver)).toBe("ask");
  });

  it("keeps the exemption when the redirect only reads", async () => {
    const resolver = makeKeyedResolver([]);

    expect(await decide("xargs grep -l foo < in.txt", resolver)).toBe("allow");
    expect(await decide("xargs grep -l foo 2>&1", resolver)).toBe("allow");
  });
});

/**
 * The fail-closed property for a parse tree-sitter could not resolve (#840).
 *
 * ADR 0013 §10's last combinator clause — any unhandled node type fails closed
 * — is delivered here by a per-statement marker rather than a program-level
 * one, so its coverage is an argument about the enumerator's walk instead of a
 * property of a single boolean. These cases are what verify that argument: the
 * inputs are drawn from a measurement over 5269 real logged bash commands, not
 * from the shapes one can picture.
 */
describe("bash command gate — a parse it could not resolve fails closed", () => {
  /** Commands `tree-sitter-bash` 0.25.1 cannot fully parse. */
  const unresolved: { label: string; command: string }[] = [
    // Valid bash (`bash -n` accepts it): a heredoc redirect combined with
    // `2>&1` AND a pipe, though each pairing alone parses. The only shape in
    // the measured corpus, and the one that really runs — the recovery drops
    // the piped command from enumeration entirely.
    {
      label: "a heredoc redirect with 2>&1 and a pipe",
      command: "git commit -F - <<'MSG' 2>&1 | tail -4\nmsg\nMSG",
    },
    {
      label: "the same shape piping into a mutator",
      command:
        "git add -A . && git commit -F - <<'MSG' 2>&1 | rm -rf /tmp/x\nmsg\nMSG",
    },
    // Malformed input, which the shell itself refuses to run. Covered because
    // the clause is about the parse, not about what bash would accept.
    { label: "an unbalanced quote", command: "echo 'unbalanced" },
    { label: "an unterminated if", command: "if true; then echo hi" },
    { label: "an unterminated for", command: "for f in a b; do echo $f" },
    { label: "an unterminated brace group", command: "{ echo hi" },
    {
      label: "an unterminated heredoc",
      command: "cat <<'EOF'\nsee `rm -rf x` here",
    },
    // The #814 shapes: a read-write open the grammar has no node for, and a
    // well-formed redirect preceded by an unrelated recovery failure.
    { label: "a read-write open", command: "cat <> rw.txt" },
    { label: "an unclosed arithmetic expansion", command: "cat $(( > out.txt" },
  ];

  /** Commands that parse cleanly, as the control set. */
  const resolved: string[] = [
    "cd /repo && git push",
    "echo hi | tail -2",
    "cat a > out.txt",
    "for f in a b; do rm $f; done",
    "cat <<'EOF'\nplain body\nEOF",
    "git commit -F - <<'MSG' 2>&1\nmsg\nMSG",
    "git commit -F - <<'MSG' | tail -4\nmsg\nMSG",
  ];

  const normalizer = new PathNormalizer(
    pathFlavorForPlatform(process.platform),
    "/cwd",
  );

  describe("the enumerator marks something wherever the parse failed", () => {
    it.each(unresolved)(
      "leaves no unmarked-only unit list for $label",
      async ({ command }) => {
        // The completeness argument, stated as a property: an errored parse
        // either yields no units at all (the #452 zero-unit branch fails that
        // closed) or yields at least one unit the fold can floor. A shape that
        // errors and leaves every unit clean would be a silent fail-open.
        const units = (await BashProgram.parse(command, normalizer)).commands();
        const marked = units.filter((unit) => unit.parseUnresolved === true);

        expect(units.length === 0 || marked.length > 0).toBe(true);
      },
    );

    it.each(resolved)("marks nothing in %s", async (command) => {
      const units = (await BashProgram.parse(command, normalizer)).commands();

      expect(units.filter((unit) => unit.parseUnresolved === true)).toEqual([]);
    });
  });

  describe("the gate floors what the enumerator marked", () => {
    it.each(unresolved)(
      "asks for $label under a permissive catch-all",
      async ({ command }) => {
        // No rule matches anything, so `makeKeyedResolver` answers allow for
        // every unit — the permissive top-level `*` this clause exists to stop
        // an unparsed subtree from riding.
        expect(await decide(command, makeKeyedResolver([]))).toBe("ask");
      },
    );

    it.each(resolved)("allows %s under the same catch-all", async (command) => {
      expect(await decide(command, makeKeyedResolver([]))).toBe("allow");
    });

    it("still lets an explicit deny decide a command that did not parse", async () => {
      // The floor clamps `allow` only, so a rule covering a recovered unit is
      // not masked into an approvable prompt.
      const resolver = makeKeyedResolver([{ match: "git add", state: "deny" }]);

      expect(
        await decide(
          "git add -A . && git commit -F - <<'MSG' 2>&1 | tail -4\nmsg\nMSG",
          resolver,
        ),
      ).toBe("deny");
    });
  });
});
