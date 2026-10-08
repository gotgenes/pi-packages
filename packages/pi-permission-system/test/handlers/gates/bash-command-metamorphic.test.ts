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
import { BashPathResolver } from "#src/access-intent/bash/bash-path-resolver";
import { collectCommands } from "#src/access-intent/bash/command-enumeration";
import { WordReader } from "#src/access-intent/bash/node-text";
import { getParser } from "#src/access-intent/bash/parser";
import { BashProgram } from "#src/access-intent/bash/program";
import { ShellVariables } from "#src/access-intent/bash/shell-variable-expansion";
import { resolveBashCommandCheck } from "#src/handlers/gates/bash-command";
import { pathFlavorForPlatform } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
import type { ScopedPermissionResolver } from "#src/policy/permission-resolver";
import type { PermissionState } from "#src/types";

import { bashCommandOf } from "#test/helpers/gate-fixtures";
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
      const command = bashCommandOf(intent) ?? "";
      const rule = rules.find((r) => command.includes(r.match));
      const state: PermissionState = rule?.state ?? "allow";
      return makeCheckResult({ state, source: "bash", command });
    },
  };
}

/**
 * Resolver modelling a `<prefix> *` rule: a command that *starts with* the
 * prefix resolves to `state`, and anything else to allow (the permissive
 * top-level `*`). Unlike a substring match, a wrapper's own text never matches
 * the rule for the command it runs.
 */
function makePrefixResolver(
  prefix: string,
  state: PermissionState,
): ScopedPermissionResolver {
  return {
    resolve: (intent) => {
      const command = bashCommandOf(intent) ?? "";
      return makeCheckResult({
        state: command.startsWith(prefix) ? state : "allow",
        source: "bash",
        command,
      });
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

/**
 * Whether `unit`'s whitespace-separated words appear in `command`, in order:
 * the unit is the command with zero or more whole spans left out.
 *
 * Each word is found as a substring rather than as one of the command's own
 * words, because an operator can abut a word (`rm $f;`).
 */
function isWordSubsequence(unit: string, command: string): boolean {
  let next = 0;
  for (const word of unit.split(/\s+/)) {
    const found = command.indexOf(word, next);
    if (found === -1) return false;
    next = found + word.length;
  }
  return true;
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
 * Where a redirect sits in a simple command does not change which command runs,
 * so moving it must not weaken a rule anchored on the command's own words.
 *
 * The resolver models a `<prefix> *` rule: it matches a unit that *starts with*
 * the prefix, which is what a redirect's text or a dropped word defeats. A
 * substring match would find `git` in `2>/dev/null git push` and prove nothing.
 */
describe("bash command gate — a redirect's position does not weaken", () => {
  const placements: {
    label: string;
    place: (head: string, rest: string) => string;
  }[] = [
    { label: "before the command", place: (h, r) => `2>/dev/null ${h} ${r}` },
    {
      label: "between a prefix assignment and the command",
      place: (h, r) => `FOO=1 >/dev/null ${h} ${r}`,
    },
    {
      label: "as a herestring after the head word",
      place: (h, r) => `${h} <<< x ${r}`,
    },
    {
      label: "after the head word",
      place: (h, r) => `${h} 2>/dev/null ${r}`,
    },
    {
      label: "between the arguments",
      place: (h, r) => {
        const [first = "", ...others] = r.split(" ");
        return `${h} ${first} 2>&1 ${others.join(" ")}`;
      },
    },
    {
      label: "after the head word of a list's last command",
      place: (h, r) => `cd a && ${h} 2>/dev/null ${r}`,
    },
    {
      label: "as a heredoc after the head word",
      place: (h, r) => `${h} <<EOF ${r}\nbody\nEOF`,
    },
    {
      label: "as a heredoc after the head word of a list's last command",
      place: (h, r) => `cd a && ${h} <<EOF ${r}\nbody\nEOF`,
    },
    {
      label: "as a heredoc piped into the command",
      place: (h, r) => `cat <<EOF | ${h} ${r}\nbody\nEOF`,
    },
    {
      label: "as a heredoc joined to the command by &&",
      place: (h, r) => `cat <<EOF && ${h} ${r}\nbody\nEOF`,
    },
    {
      label: "as a heredoc writing a file before the command",
      place: (h, r) => `cat <<EOF > /tmp/o && ${h} ${r}\nbody\nEOF`,
    },
  ];

  const cases: {
    head: string;
    rest: string;
    prefix: string;
    state: PermissionState;
  }[] = [
    { head: "git", rest: "push --force", prefix: "git push", state: "deny" },
    { head: "rm", rest: "-rf build", prefix: "rm -rf", state: "deny" },
    { head: "gh", rest: "pr create", prefix: "gh pr", state: "ask" },
  ];

  for (const { label, place } of placements) {
    for (const { head, rest, prefix, state } of cases) {
      it(`a redirect ${label} leaves "${head} ${rest}" at ${state}`, async () => {
        const resolver = makePrefixResolver(prefix, state);

        expect(await decide(`${head} ${rest}`, resolver)).toBe(state);
        expect(await decide(place(head, rest), resolver)).toBe(state);
      });
    }
  }
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
 * A wrapper that changes only *how* a command runs — `time`, `timeout`, `nice`,
 * `stdbuf`, `setsid` — is decided exactly as the command it runs (#963).
 *
 * Stronger than the never-weaker property above: the wrapped decision must
 * *equal* the bare one, in both directions, so an inner `deny` reaches through
 * the wrapper and an inner `allow` is not floored.
 */
describe("bash command gate — an execution modifier inherits the verdict", () => {
  const modifiers = [
    (cmd: string) => `time ${cmd}`,
    (cmd: string) => `timeout 5 ${cmd}`,
    (cmd: string) => `nice -n 5 ${cmd}`,
    (cmd: string) => `stdbuf -oL ${cmd}`,
    (cmd: string) => `setsid ${cmd}`,
    (cmd: string) => `time timeout 5 ${cmd}`,
  ];

  const cases: { bare: string; prefix: string; state: PermissionState }[] = [
    { bare: "pnpm test", prefix: "pnpm", state: "allow" },
    { bare: "pnpm test", prefix: "pnpm", state: "ask" },
    { bare: "pnpm test", prefix: "pnpm", state: "deny" },
    { bare: "git push --force", prefix: "git push", state: "deny" },
  ];

  for (const wrap of modifiers) {
    for (const { bare, prefix, state } of cases) {
      it(`decides "${wrap(bare)}" as "${bare}" at ${state}`, async () => {
        const resolver = makePrefixResolver(prefix, state);

        expect(await decide(bare, resolver)).toBe(state);
        expect(await decide(wrap(bare), resolver)).toBe(state);
      });
    }
  }

  it("allows the timed lint run that prompted the issue", async () => {
    const command =
      'time pnpm run lint >/tmp/lintout.txt 2>&1; echo "lint rc=$?"; tail -3 /tmp/lintout.txt';

    expect(await decide(command, makeKeyedResolver([]))).toBe("allow");
  });

  it("keeps an explicit ask on the wrapper", async () => {
    const resolver = makePrefixResolver("time", "ask");

    expect(await decide("time pnpm test", resolver)).toBe("ask");
  });

  // The wrapper's text never matches the `rm *` rule, so only the floor stands
  // between these and a permissive `*`: each must ask, never allow.
  it.each([
    "timeout --sig KILL 5 rm -rf /",
    "nice --adj 5 rm -rf /",
    "time sudo rm -rf x",
    "time { rm -rf /tmp/x; }",
    "timeout 5 bash -c 'rm x'",
    "timeout -- 5 sudo rm x",
    "timeout -s KILL -- 5 bash -c 'rm x'",
    "nice -n 1 -- timeout -- 5 sudo rm x",
    "timeout {5,sudo} rm x",
    // `D="5 sudo"` splits into a duration and a wrapper the gate never sees.
    "timeout $D pnpm test",
    "nice -n $N pnpm test",
    "timeout $(echo 5 sudo) rm x",
  ])(
    "floors %s rather than resolving a misread inner command",
    async (command) => {
      const resolver = makePrefixResolver("rm", "deny");

      expect(await decide(command, resolver)).toBe("ask");
    },
  );
});

/**
 * A subshell timed by `time` is decided exactly as the bare subshell (#1027).
 *
 * The grammar has no `time` keyword, so the enumerator reads `time ( … )`
 * itself: the subshell's commands become units of their own, and the `time`
 * unit resolves by the subshell's text, as the bare subshell's whole unit does.
 */
describe("bash command gate — a timed subshell decides as the bare subshell", () => {
  const cases: { bare: string; prefix: string; state: PermissionState }[] = [
    { bare: "pnpm test", prefix: "pnpm", state: "allow" },
    { bare: "pnpm test", prefix: "pnpm", state: "ask" },
    { bare: "pnpm test", prefix: "pnpm", state: "deny" },
    { bare: "git push --force", prefix: "git push", state: "deny" },
  ];

  for (const { bare, prefix, state } of cases) {
    it(`decides "time (${bare})" as "(${bare})" at ${state}`, async () => {
      const resolver = makePrefixResolver(prefix, state);

      expect(await decide(`(${bare})`, resolver)).toBe(state);
      expect(await decide(`time (${bare})`, resolver)).toBe(state);
    });
  }

  it("lets an inner deny reach a command inside the subshell", async () => {
    const resolver = makePrefixResolver("rm", "deny");

    expect(await decide("time (rm -rf /tmp/x)", resolver)).toBe("deny");
  });

  it("allows the timed lint run the review log asked about", async () => {
    const command = "time (pnpm run lint >/tmp/l.log 2>&1)";

    expect(await decide(command, makeKeyedResolver([]))).toBe("allow");
  });

  it.each(["ask", "deny"] as const)(
    "keeps an explicit %s on the wrapper",
    async (state) => {
      const resolver = makePrefixResolver("time", state);

      expect(await decide("time (pnpm test)", resolver)).toBe(state);
    },
  );
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
    // the measured corpus, and the one that really runs — the recovery leaves
    // the piped command in no unit, which the salvage restores (#875).
    {
      label: "a heredoc redirect with 2>&1 and a pipe",
      command: "git commit -F - <<'MSG' 2>&1 | tail -4\nmsg\nMSG",
    },
    {
      label: "the same shape piping into a mutator",
      command:
        "git add -A . && git commit -F - <<'MSG' 2>&1 | rm -rf /tmp/x\nmsg\nMSG",
    },
    // Valid bash whose heredoc tail the grammar cannot parse at all: the
    // salvage recovers the command after the heredoc from the line's
    // heredoc-free spelling.
    {
      label: "a heredoc followed by `;`",
      command: "cat <<EOF ; rm -rf /tmp/x\nb\nEOF",
    },
    {
      label: "a heredoc followed by `&`",
      command: "cat <<EOF & rm -rf /tmp/x\nb\nEOF",
    },
    {
      label: "a heredoc followed by words and a redirect",
      command: "cat <<EOF arg > /tmp/o\nb\nEOF",
    },
    {
      label: "a descriptor the grammar lexed into the delimiter",
      command: "cat 0<<EOF | rm -rf /tmp/x\nb\nEOF",
    },
    {
      label: "a heredoc tail inside a compound statement",
      command: "if true; then cat <<EOF ; rm -rf /tmp/x\nb\nEOF\nfi",
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
    // Further spellings of the grammar gap, probed against the real parser:
    // the failing region can sit inside any enclosing statement, and the
    // redirect can take several forms before the pipe.
    {
      label: "the gap inside a control-flow body",
      command: "if true; then cat <<'EOF' 2>&1 | rm -rf /x\nbody\nEOF\nfi",
    },
    {
      label: "the gap inside a subshell",
      command: "(cat <<'E' 2>&1 | rm -rf /x\nb\nE\n)",
    },
    {
      label: "the gap inside a command substitution",
      command: "x=$(cat <<'E' 2>&1 | rm -rf /x\nb\nE\n)",
    },
    {
      label: "the gap with a duplicating redirect to stderr",
      command: "cat <<'E' 1>&2 | rm -rf /x\nb\nE",
    },
    {
      label: "the gap piping stderr too",
      command: "cat <<'E' 2>&1 |& rm -rf /x\nb\nE",
    },
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

  describe("the salvage only ever adds to what the primary parse found", () => {
    /** The units the primary parse alone yields, with no salvage. */
    async function primaryUnitsOf(command: string) {
      const parser = await getParser();
      const tree = parser.parse(command);
      if (!tree) throw new Error("parse returned null");
      try {
        // The primary parse alone, spelled as the program spells it: the
        // resolver walking only the primary tree records the same argument
        // spellings, since a salvaged fragment's tokens are never spelled.
        const words = new WordReader(ShellVariables.UNREBOUND);
        const { argumentSpellings } = new BashPathResolver(
          normalizer,
          words,
        ).resolve(tree.rootNode);
        return collectCommands(tree.rootNode, words, argumentSpellings);
      } finally {
        tree.delete();
      }
    }

    it.each([...unresolved.map(({ command }) => command), ...resolved])(
      "keeps every primary unit, in order, for %s",
      async (command) => {
        // Salvaging is additive by construction, and this is the property that
        // says so: a mechanism that reordered or replaced units could weaken a
        // decision the primary parse already reached.
        const units = (await BashProgram.parse(command, normalizer)).commands();
        const primary = await primaryUnitsOf(command);

        expect(units.slice(0, primary.length)).toEqual(primary);
      },
    );

    it.each([...unresolved.map(({ command }) => command), ...resolved])(
      "emits no unit whose words are not the command's words, in order, for %s",
      async (command) => {
        // Anti-invention: every unit is built from a parse of the command's own
        // source, salvaged or not, with at most whole spans left out: a
        // redirect or heredoc between a command's words is not part of its
        // unit. So its words are the command's words, in order. Recovery's
        // invented structure is refused a step earlier, when its re-parse fails.
        const units = (await BashProgram.parse(command, normalizer)).commands();

        expect(
          units.filter(({ text }) => !isWordSubsequence(text, command)),
        ).toEqual([]);
      },
    );

    it.each(resolved)("adds no unit at all to %s", async (command) => {
      const units = (await BashProgram.parse(command, normalizer)).commands();

      expect(units).toEqual(await primaryUnitsOf(command));
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

  describe("the gate consults the rules of a command the parse dropped (#875)", () => {
    const dropped =
      "git add -A . && git commit -F - <<'MSG' 2>&1 | rm -rf /tmp/x\nmsg\nMSG";

    it("denies on a rule covering only the dropped command", async () => {
      // The defect: `rm -rf /tmp/x` was in no unit, so this rule was never
      // evaluated and the user was prompted about `git commit` instead.
      const resolver = makeKeyedResolver([{ match: "rm -rf", state: "deny" }]);

      expect(await decide(dropped, resolver)).toBe("deny");
    });

    it("names the dropped command as the offender", async () => {
      const resolver = makeKeyedResolver([{ match: "rm -rf", state: "deny" }]);
      const program = await BashProgram.parse(dropped, normalizer);

      expect(
        resolveBashCommandCheck(
          dropped,
          program.commands(),
          undefined,
          resolver,
        ).command,
      ).toBe("rm -rf /tmp/x");
    });

    it("still only asks when no rule covers the dropped command", async () => {
      // The salvaged unit is marked, so its `allow` floors like every other
      // marked unit — the salvage adds restriction and removes none.
      expect(await decide(dropped, makeKeyedResolver([]))).toBe("ask");
    });

    it("still resolves the whole command when the primary parse found nothing", async () => {
      // A body-less leading redirect ahead of the gap: the primary parse
      // yields zero units, so the whole command string is the only surface an
      // explicit deny can reach (#452, #712). Salvaging a unit must not make
      // that check unreachable — `deny` → `ask` would be a real weakening, and
      // the only one this otherwise-additive mechanism could cause.
      const resolver = makeKeyedResolver([
        { match: " rm -rf ", state: "deny" },
      ]);

      expect(
        await decide("> f <<'M' 2>&1 | rm -rf /tmp/x\nmsg\nM", resolver),
      ).toBe("deny");
    });

    it("consults no rule for a region whose own re-parse fails", async () => {
      // `<>` recovery invents the token `">"`; admitting it as a unit would
      // match it against the bash rules (#814).
      const resolver = makeKeyedResolver([{ match: ">", state: "deny" }]);

      expect(await decide("cat <> rw.txt", resolver)).toBe("ask");
    });
  });
});
