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
