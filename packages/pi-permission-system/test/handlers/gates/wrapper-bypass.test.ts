import { describe, expect, it } from "vitest";

import type { BashCommand } from "#src/access-intent/bash/command-enumeration";
import { BashProgram } from "#src/access-intent/bash/program";
import { resolveBashCommandCheck } from "#src/handlers/gates/bash-command";
import { pathFlavorForPlatform } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";
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

/** The unit the enumerator stamps for a bypassable `xargs` wrapper. */
const bypassUnit: BashCommand = {
  text: "xargs rm -rf files",
  wrapperKind: "indirection",
  executedUnit: "rm -rf files",
  bypassInnerCommand: "rm",
  bypassPattern: "xargs rm *",
};

/** The wrapper sentinel a floored unit is named by. */
const WRAPPER_SENTINEL = "<indirection-bash-wrapper>";

describe("indirection wrapper floor bypass (#490)", () => {
  describe("the enumerator stamps the bypass on a bypassable wrapper", () => {
    const normalizer = new PathNormalizer(
      pathFlavorForPlatform(process.platform),
      "/projects/my-app",
    );

    it("stamps the inner command and the pattern that pins it", async () => {
      const program = await BashProgram.parse("xargs rm -rf files", normalizer);

      expect(program.commands()).toEqual([
        expect.objectContaining({
          text: "xargs rm -rf files",
          wrapperKind: "indirection",
          bypassInnerCommand: "rm",
          bypassPattern: "xargs rm *",
        }),
      ]);
    });

    it("stamps nothing for a wrapper whose verb is not stable", async () => {
      // `sudo` runs a fresh expression each time, so no rule text can name what
      // runs; the floor stays and the bypass is never stamped.
      const program = await BashProgram.parse("sudo rm -rf /", normalizer);
      const [unit] = program.commands();

      expect(unit.wrapperKind).toBe("indirection");
      expect(unit.bypassInnerCommand).toBeUndefined();
      expect(unit.bypassPattern).toBeUndefined();
    });

    it("stamps the bypass on a wrapper whose inner command proves no read", async () => {
      // The case upstream's transparency exemption (#803) does not reach: `rm`
      // proves no read, so the floor holds unless a rule pins the command.
      const program = await BashProgram.parse(
        "xargs -r rm -rf files",
        normalizer,
      );
      const [unit] = program.commands();

      expect(unit.floorExemption).toBeUndefined();
      expect(unit.bypassInnerCommand).toBe("rm");
      expect(unit.bypassPattern).toBe("xargs -r rm *");
    });
  });

  describe("resolveBashCommandCheck", () => {
    it("lifts the floor when the matched allow rule pins the inner command", () => {
      const resolver = makeResolver(
        bashResult("allow", "xargs rm -rf files", "xargs rm *"),
      );

      const result = resolveBashCommandCheck(
        "xargs rm -rf files",
        [bypassUnit],
        undefined,
        resolver,
      );

      expect(result.state).toBe("allow");
      expect(result.matchedPattern).toBe("xargs rm *");
      // The pinning pattern is published so the prompt offers a grant that
      // re-enters here, rather than the arity-derived `xargs *`.
      expect(result.bypassPattern).toBe("xargs rm *");
      // The unit is still what runs: the prompt, decision value, and suggestion
      // all name the wrapper the operator is looking at.
      expect(result.command).toBe("xargs rm -rf files");
      expect(resolver.resolve).toHaveBeenCalledTimes(1);
    });

    it("keeps the floor when the matched rule is the bare wrapper catch-all", () => {
      const resolver = makeResolver(
        bashResult("allow", "xargs rm -rf files", "xargs *"),
      );

      const result = resolveBashCommandCheck(
        "xargs rm -rf files",
        [bypassUnit],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe(WRAPPER_SENTINEL);
      expect(result.bypassPattern).toBeUndefined();
    });

    it("keeps the floor when the rule pins a different command", () => {
      const resolver = makeResolver(
        bashResult("allow", "xargs rm -rf files", "xargs cat *"),
      );

      const result = resolveBashCommandCheck(
        "xargs rm -rf files",
        [bypassUnit],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe(WRAPPER_SENTINEL);
    });

    it("keeps the floor when the rule states no literal prefix", () => {
      // `*` names nothing, so the grant is broader than the command it rides
      // on — exactly what the floor withholds.
      const resolver = makeResolver(
        bashResult("allow", "xargs rm -rf files", "*"),
      );

      const result = resolveBashCommandCheck(
        "xargs rm -rf files",
        [bypassUnit],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe(WRAPPER_SENTINEL);
    });

    it("keeps the floor for a wrapper the enumerator stamped no bypass on", () => {
      const resolver = makeResolver(
        bashResult("allow", "sudo rm -rf /", "sudo rm*"),
      );

      const result = resolveBashCommandCheck(
        "sudo rm -rf /",
        [
          {
            text: "sudo rm -rf /",
            wrapperKind: "indirection",
            executedUnit: "rm -rf /",
          },
        ],
        undefined,
        resolver,
      );

      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe(WRAPPER_SENTINEL);
    });

    it("preserves an explicit deny, reading no inner rule", () => {
      const resolver = makeResolver(
        bashResult("deny", "xargs rm -rf files", "xargs rm *"),
      );

      const result = resolveBashCommandCheck(
        "xargs rm -rf files",
        [bypassUnit],
        undefined,
        resolver,
      );

      expect(result.state).toBe("deny");
      expect(result.matchedPattern).toBe("xargs rm *");
      expect(result.bypassPattern).toBeUndefined();
      expect(resolver.resolve).toHaveBeenCalledTimes(1);
    });

    it("pins a path-qualified inner command by basename", () => {
      const resolver = makeResolver(
        bashResult("allow", "xargs /bin/rm -rf files", "xargs /bin/rm *"),
      );

      const result = resolveBashCommandCheck(
        "xargs /bin/rm -rf files",
        [
          {
            ...bypassUnit,
            text: "xargs /bin/rm -rf files",
            bypassPattern: "xargs /bin/rm *",
          },
        ],
        undefined,
        resolver,
      );

      expect(result.state).toBe("allow");
      expect(result.bypassPattern).toBe("xargs /bin/rm *");
    });

    it("bypasses only the pinned unit across a chain", () => {
      const resolver = makeResolver();
      resolver.resolve.mockImplementation((intent) => {
        const { command } = (intent as { input: { command: string } }).input;
        return command === "xargs cat a"
          ? bashResult("allow", command, "xargs cat *")
          : bashResult("allow", command, "xargs *");
      });

      const result = resolveBashCommandCheck(
        "xargs cat a && xargs rm -rf b",
        [
          {
            text: "xargs cat a",
            wrapperKind: "indirection",
            executedUnit: "cat a",
            bypassInnerCommand: "cat",
            bypassPattern: "xargs cat *",
          },
          {
            text: "xargs rm -rf b",
            wrapperKind: "indirection",
            executedUnit: "rm -rf b",
            bypassInnerCommand: "rm",
            bypassPattern: "xargs rm *",
          },
        ],
        undefined,
        resolver,
      );

      // The pinned `cat` unit is let through; the bare-wrapper `rm` unit floors
      // to ask; ask is the more restrictive verdict, so the chain prompts.
      expect(result.state).toBe("ask");
      expect(result.matchedPattern).toBe(WRAPPER_SENTINEL);
      expect(result.command).toBe("xargs rm -rf b");
    });
  });
});
