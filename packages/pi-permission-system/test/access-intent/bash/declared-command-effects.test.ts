import { describe, expect, it } from "vitest";
import { proveDeclaredEffect } from "#src/access-intent/bash/declared-command-effects";
import {
  type DeclarationScope,
  foldDeclaredCommandEffects,
  NO_DECLARED_COMMAND_EFFECTS,
} from "#src/config/command-effects-config";
import type { CommandEffectsConfig } from "#src/config/config-schema";
import { computedArgWord, literalArgWords } from "#test/helpers/arg-words";

function declare(
  config: CommandEffectsConfig,
  scope: DeclarationScope = "global",
) {
  return foldDeclaredCommandEffects(NO_DECLARED_COMMAND_EFFECTS, config, scope);
}

const UNPROVEN = {
  kind: "effect",
  effect: { effect: "unproven", source: "unproven" },
} as const;
const RETRACTED = {
  kind: "effect",
  effect: { effect: "unproven", source: "retracted" },
} as const;
const DECLARED_READ = {
  kind: "effect",
  effect: { effect: "read", source: "declared-global" },
} as const;

const GIT_READERS = declare({
  git: {
    subcommands: {
      log: "read",
      diff: { effects: "read", unlessOption: ["--output"] },
      remote: { subcommands: { show: "read" } },
    },
  },
});

describe("proveDeclaredEffect", () => {
  describe("lookup", () => {
    it("matches a declared command by its bare head word", () => {
      expect(
        proveDeclaredEffect(
          declare({ strings: { effects: "read" } }),
          "strings",
          literalArgWords("/tmp/x"),
        ),
      ).toEqual(DECLARED_READ);
    });

    it("leaves an undeclared command unproven", () => {
      expect(
        proveDeclaredEffect(GIT_READERS, "strings", literalArgWords("/tmp/x")),
      ).toEqual(UNPROVEN);
    });

    it.each(["./git", "/usr/bin/git", "bin\\git"])(
      "leaves a path-qualified head word %s undeclared",
      (head) => {
        expect(
          proveDeclaredEffect(GIT_READERS, head, literalArgWords("log", "x")),
        ).toEqual(UNPROVEN);
      },
    );

    it.each(["constructor", "toString", "__proto__", "hasOwnProperty"])(
      "never reads the prototype for a head word %s",
      (head) => {
        expect(
          proveDeclaredEffect(GIT_READERS, head, literalArgWords("x")),
        ).toEqual(UNPROVEN);
      },
    );

    it("never reads the prototype for a subcommand word", () => {
      expect(
        proveDeclaredEffect(
          declare({ git: { effects: "read", subcommands: { log: "read" } } }),
          "git",
          literalArgWords("toString"),
        ),
      ).toEqual(DECLARED_READ);
    });

    it("names the project scope when the project declared the command", () => {
      expect(
        proveDeclaredEffect(
          declare({ strings: { effects: "read" } }, "project"),
          "strings",
          literalArgWords("x"),
        ),
      ).toEqual({
        kind: "effect",
        effect: { effect: "read", source: "declared-project" },
      });
    });
  });

  describe("subcommand descent", () => {
    it("descends into an exactly matching subcommand", () => {
      expect(
        proveDeclaredEffect(GIT_READERS, "git", literalArgWords("log", "~/x")),
      ).toEqual(DECLARED_READ);
    });

    it("descends two levels", () => {
      expect(
        proveDeclaredEffect(
          GIT_READERS,
          "git",
          literalArgWords("remote", "show", "origin"),
        ),
      ).toEqual(DECLARED_READ);
    });

    it("leaves an undeclared subcommand unproven when the entry declares no effects of its own", () => {
      expect(
        proveDeclaredEffect(GIT_READERS, "git", literalArgWords("push")),
      ).toEqual(UNPROVEN);
    });

    it("leaves a parent reached without a declared child unproven when it declares no effects", () => {
      expect(
        proveDeclaredEffect(
          GIT_READERS,
          "git",
          literalArgWords("remote", "add", "x"),
        ),
      ).toEqual(UNPROVEN);
    });

    it("applies the entry's own effects to an undeclared subcommand", () => {
      expect(
        proveDeclaredEffect(
          declare({ tool: { effects: "read", subcommands: { put: "write" } } }),
          "tool",
          literalArgWords("get", "x"),
        ),
      ).toEqual(DECLARED_READ);
    });

    it("applies the entry's own effects when no word follows", () => {
      expect(
        proveDeclaredEffect(
          declare({ tool: { effects: "read", subcommands: { put: "write" } } }),
          "tool",
          [],
        ),
      ).toEqual(DECLARED_READ);
    });

    it.each([
      ["an option", literalArgWords("-C", "~/other", "log")],
      ["a long option", literalArgWords("--no-pager", "log")],
      [
        "a computed word",
        [computedArgWord("$SUB", false), ...literalArgWords("x")],
      ],
    ])(
      "is unproven when the word where a subcommand belongs is %s",
      (_label, argWords) => {
        const declared = declare({
          git: { effects: "read", subcommands: { push: "write", log: "read" } },
        });
        expect(proveDeclaredEffect(declared, "git", argWords)).toEqual(
          UNPROVEN,
        );
      },
    );

    it("reads options freely for an entry that declares no subcommands", () => {
      expect(
        proveDeclaredEffect(
          declare({ strings: { effects: "read" } }),
          "strings",
          literalArgWords("-n", "8", "/tmp/x"),
        ),
      ).toEqual(DECLARED_READ);
    });
  });

  describe("unlessOption guards", () => {
    const SED_LIKE = declare({
      tool: { effects: "read", unlessOption: ["-i", "--in-place"] },
    });

    it.each([
      ["a separate short option", literalArgWords("-i", "x")],
      ["a short option in a cluster", literalArgWords("-ni", "x")],
      ["a short option with an attached value", literalArgWords("-i.bak", "x")],
      ["a long option", literalArgWords("--in-place", "x")],
      [
        "a long option with an attached value",
        literalArgWords("--in-place=.bak", "x"),
      ],
      ["an abbreviated long option", literalArgWords("--in", "x")],
      [
        "a computed word that may lead with a dash",
        [computedArgWord("$opt", true)],
      ],
    ])("retracts on %s", (_label, argWords) => {
      expect(proveDeclaredEffect(SED_LIKE, "tool", argWords)).toEqual(
        RETRACTED,
      );
    });

    it.each([
      ["no option", literalArgWords("x")],
      ["an unguarded option", literalArgWords("-n", "x")],
      [
        "a computed word that cannot lead with a dash",
        [computedArgWord("x$y", false)],
      ],
    ])("keeps the declaration with %s", (_label, argWords) => {
      expect(proveDeclaredEffect(SED_LIKE, "tool", argWords)).toEqual(
        DECLARED_READ,
      );
    });

    it.each([
      ["the exact word", literalArgWords("-exec", "rm")],
      ["an attached suffix", literalArgWords("-execdir", "rm")],
    ])("retracts a single-dash long stem on %s", (_label, argWords) => {
      expect(
        proveDeclaredEffect(
          declare({ tool: { effects: "read", unlessOption: ["-exec"] } }),
          "tool",
          argWords,
        ),
      ).toEqual(RETRACTED);
    });

    it("does not read a single-dash long stem's letters as a cluster", () => {
      expect(
        proveDeclaredEffect(
          declare({ tool: { effects: "read", unlessOption: ["-exec"] } }),
          "tool",
          literalArgWords("-e", "x"),
        ),
      ).toEqual(DECLARED_READ);
    });

    it("retracts on a reached subcommand's own guard", () => {
      expect(
        proveDeclaredEffect(
          GIT_READERS,
          "git",
          literalArgWords("diff", "--output=/tmp/x"),
        ),
      ).toEqual(RETRACTED);
    });

    it("keeps an unguarded declaration with a computed word that may lead with a dash", () => {
      expect(
        proveDeclaredEffect(declare({ tool: { effects: "read" } }), "tool", [
          computedArgWord("$(cat ~/a)", true),
        ]),
      ).toEqual(DECLARED_READ);
    });

    it("applies a parent's guard under the subcommand it reached", () => {
      expect(
        proveDeclaredEffect(
          declare({
            git: { unlessOption: ["--output"], subcommands: { log: "read" } },
          }),
          "git",
          literalArgWords("log", "--output=/tmp/x"),
        ),
      ).toEqual(RETRACTED);
    });

    it("leaves a guarded entry without effects unproven rather than retracted", () => {
      expect(
        proveDeclaredEffect(
          declare({ tool: { unlessOption: ["-i"] } }),
          "tool",
          literalArgWords("-i"),
        ),
      ).toEqual(UNPROVEN);
    });
  });

  describe("effect mapping", () => {
    it.each([
      [
        "read",
        "read",
        {
          kind: "effect",
          effect: { effect: "read", source: "declared-global" },
        },
      ],
      [
        "[read]",
        ["read"],
        {
          kind: "effect",
          effect: { effect: "read", source: "declared-global" },
        },
      ],
      [
        "write",
        "write",
        {
          kind: "effect",
          effect: { effect: "write", source: "declared-global" },
        },
      ],
      [
        "[write]",
        ["write"],
        {
          kind: "effect",
          effect: { effect: "write", source: "declared-global" },
        },
      ],
      [
        "[read, write]",
        ["read", "write"],
        {
          kind: "effect",
          effect: { effect: "unproven", source: "declared-global" },
        },
      ],
      [
        "[]",
        [],
        {
          kind: "inert",
          effect: { effect: "unproven", source: "declared-global" },
        },
      ],
    ] as const)("maps %s", (_label, effects, expected) => {
      expect(
        proveDeclaredEffect(
          declare({
            tool: {
              effects: typeof effects === "string" ? effects : [...effects],
            },
          }),
          "tool",
          literalArgWords("x"),
        ),
      ).toEqual(expected);
    });

    it("maps a shorthand subcommand value as its effects", () => {
      expect(
        proveDeclaredEffect(
          declare({ officecli: { subcommands: { set: [] } } }),
          "officecli",
          literalArgWords("set", "data.xlsx", "/Sheet1/B1"),
        ),
      ).toEqual({
        kind: "inert",
        effect: { effect: "unproven", source: "declared-global" },
      });
    });
  });
});
