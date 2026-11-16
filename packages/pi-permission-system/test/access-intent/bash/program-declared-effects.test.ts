import { homedir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Identity realpath, as in the sibling program suites, so no path here depends
// on what exists on the host.
const realpathSync = vi.hoisted(() =>
  vi.fn<(path: string) => string>((p) => p),
);
vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    realpathSync,
    default: { ...actual, realpathSync },
  };
});

import { BashProgram } from "#src/access-intent/bash/program";
import { UNPROVEN_EFFECT } from "#src/access-intent/effect";
import {
  type DeclarationScope,
  foldDeclaredCommandEffects,
  NO_DECLARED_COMMAND_EFFECTS,
} from "#src/config/command-effects-config";
import type { CommandEffectsConfig } from "#src/config/config-schema";
import { pathFlavorForPlatform } from "#src/path/path-flavor";
import { PathNormalizer } from "#src/path/path-normalizer";

const cwd = "/projects/my-app";
const normalizer = new PathNormalizer(
  pathFlavorForPlatform(process.platform),
  cwd,
);
const HOME_X = join(homedir(), "x");

function declare(
  config: CommandEffectsConfig,
  scope: DeclarationScope = "global",
) {
  return foldDeclaredCommandEffects(NO_DECLARED_COMMAND_EFFECTS, config, scope);
}

const GIT_LOG = declare({ git: { subcommands: { log: "read" } } });
const DECLARED_READ = { effect: "read", source: "declared-global" } as const;

/** Each external access as its as-typed path and attributed effect. */
async function externalsOf(
  command: string,
  commandEffects = GIT_LOG,
): Promise<{ path: string; effect: object }[]> {
  const program = await BashProgram.parse(command, normalizer, {
    commandEffects,
  });
  return program
    .externalAccesses()
    .map(({ path, effect }) => ({ path: path.value(), effect }));
}

describe("BashProgram with commandEffects declarations", () => {
  beforeEach(() => {
    realpathSync.mockReset();
    realpathSync.mockImplementation((p: string) => p);
  });

  describe("a declared reader's operands", () => {
    it("route by the declared effect", async () => {
      expect(await externalsOf("git log ~/x")).toEqual([
        { path: HOME_X, effect: DECLARED_READ },
      ]);
    });

    it("name the project scope when the project declared them", async () => {
      expect(
        await externalsOf(
          "git log ~/x",
          declare({ git: { subcommands: { log: "read" } } }, "project"),
        ),
      ).toEqual([
        {
          path: HOME_X,
          effect: { effect: "read", source: "declared-project" },
        },
      ]);
    });

    it("stay unproven without a declaration", async () => {
      expect(
        await externalsOf("git log ~/x", NO_DECLARED_COMMAND_EFFECTS),
      ).toEqual([{ path: HOME_X, effect: UNPROVEN_EFFECT }]);
    });

    it("leave a redirect's syntax proof absolute", async () => {
      expect(await externalsOf("git log > ~/out")).toEqual([
        {
          path: join(homedir(), "out"),
          effect: { effect: "write", source: "syntax" },
        },
      ]);
    });
  });

  describe("an effects: [] command's operands", () => {
    const OFFICECLI = declare({ officecli: { effects: [] } });

    it("reach neither path surface", async () => {
      const program = await BashProgram.parse(
        "officecli set data.xlsx /Sheet1/B1",
        normalizer,
        { commandEffects: OFFICECLI },
      );

      expect(program.externalAccesses()).toEqual([]);
      expect(program.pathRuleCandidates()).toEqual([]);
    });

    it("still spell the command's unit for the bash surface", async () => {
      const program = await BashProgram.parse(
        "officecli set sub/data.xlsx /Sheet1/B1",
        normalizer,
        { commandEffects: OFFICECLI },
      );

      expect(program.commands()).toEqual([
        {
          text: "officecli set sub/data.xlsx /Sheet1/B1",
          spellings: [`officecli set ${cwd}/sub/data.xlsx /Sheet1/B1`],
        },
      ]);
    });

    it.each(["officecli x ~/x; cat ~/x", "cat ~/x; officecli x ~/x"])(
      "never fold with another command's attribution of the same path in %s",
      async (command) => {
        expect(await externalsOf(command, OFFICECLI)).toEqual([
          { path: HOME_X, effect: { effect: "read", source: "core" } },
        ]);

        const program = await BashProgram.parse(command, normalizer, {
          commandEffects: OFFICECLI,
        });
        expect(
          program.pathRuleCandidates().map(({ token, effect }) => ({
            token,
            effect,
          })),
        ).toEqual([
          { token: "~/x", effect: { effect: "read", source: "core" } },
        ]);
      },
    );

    it("leave a nested command's operands on the path surfaces", async () => {
      expect(
        await externalsOf("officecli $(cat /etc/hosts) x", OFFICECLI),
      ).toEqual([
        { path: "/etc/hosts", effect: { effect: "read", source: "core" } },
      ]);
    });

    it("leave a redirect's destination on the path surfaces", async () => {
      expect(await externalsOf("officecli x > ~/out", OFFICECLI)).toEqual([
        {
          path: join(homedir(), "out"),
          effect: { effect: "write", source: "syntax" },
        },
      ]);
    });
  });

  describe("a declaration for a core word", () => {
    it("never overrides the core's retraction", async () => {
      expect(
        await externalsOf(
          "sed -i s/a/b/ ~/x",
          declare({ sed: { effects: "read" } }),
        ),
      ).toEqual([
        { path: HOME_X, effect: { effect: "unproven", source: "retracted" } },
      ]);
    });
  });

  describe("a declared command behind a wrapper", () => {
    it("keeps the wrapper floor", async () => {
      const declared = await BashProgram.parse(
        "xargs git log ~/x",
        normalizer,
        {
          commandEffects: GIT_LOG,
        },
      );
      const undeclared = await BashProgram.parse(
        "xargs git log ~/x",
        normalizer,
      );

      expect(declared.commands()).toEqual(undeclared.commands());
      expect(declared.commands().map((unit) => unit.wrapperKind)).toEqual([
        "indirection",
      ]);
      expect(declared.commands().map((unit) => unit.floorExemption)).toEqual([
        undefined,
      ]);
    });

    it.each([
      ["xargs", "read", "xargs rm ~/x"],
      ["env", "read", "env FOO=1 rm ~/x"],
      ["sudo", "inert", "sudo rm ~/x"],
      ["time", "inert", "time rm ~/x"],
      ["timeout", "inert", "timeout 5 rm ~/x"],
      ["bash", "read", "bash ~/x"],
      ["nohup", "inert", "nohup rm ~/x"],
    ] as const)(
      "ignores a declaration keyed by the wrapper %s (%s)",
      async (wrapper, kind, command) => {
        const declared = declare({
          [wrapper]: { effects: kind === "read" ? "read" : [] },
        });
        expect(await externalsOf(command, declared)).toEqual([
          { path: HOME_X, effect: UNPROVEN_EFFECT },
        ]);
      },
    );

    it("leaves the wrapped command's operands unproven", async () => {
      expect(await externalsOf("xargs git log ~/x")).toEqual([
        { path: HOME_X, effect: UNPROVEN_EFFECT },
      ]);
    });
  });

  describe("a declared command nested in another construct", () => {
    it.each([
      ["a command substitution", "echo $(git log ~/x)"],
      ["a quoted command substitution", 'echo "$(git log ~/x)"'],
      ["a heredoc body", "cat <<EOF\n$(git log ~/x)\nEOF"],
      ["a for word list", "for f in $(git log ~/x); do :; done"],
      ["a redirect destination", 'echo hi > "$(git log ~/x)"'],
      ["a pattern-first command's argument", "grep -e pat $(git log ~/x)"],
    ])("is attributed inside %s", async (_label, command) => {
      expect(
        (await externalsOf(command)).filter(({ path }) => path === HOME_X),
      ).toEqual([{ path: HOME_X, effect: DECLARED_READ }]);
    });

    it("attributes a declared pattern-first command", async () => {
      expect(
        await externalsOf(
          "node build.js ~/x",
          declare({ node: { effects: "read" } }),
        ),
      ).toEqual([{ path: HOME_X, effect: DECLARED_READ }]);
    });
  });
});
