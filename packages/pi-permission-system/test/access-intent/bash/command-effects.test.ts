import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PURE_READER_CORE,
  proveCommandEffect,
  redirectDestinationEffect,
} from "#src/access-intent/bash/command-effects";
import { UNPROVEN_EFFECT } from "#src/access-intent/effect";
import { computedArgWord, literalArgWords } from "#test/helpers/arg-words";

const CORE_READ = { effect: "read", source: "core" } as const;
const RETRACTED = { effect: "unproven", source: "retracted" } as const;
const SYNTAX_READ = { effect: "read", source: "syntax" } as const;
const SYNTAX_WRITE = { effect: "write", source: "syntax" } as const;

/** The frozen v1 roster, spelled out so the test pins it rather than mirrors it. */
const ROSTER = [
  "cat",
  "head",
  "tail",
  "wc",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "diff",
  "ls",
  "stat",
  "pwd",
  "basename",
  "dirname",
  "realpath",
  "echo",
  "which",
  "cd",
  "find",
  "fd",
  "sort",
  "sed",
  "awk",
  "true",
  "false",
  ":",
];

/**
 * The least a presumed reader needs to prove a read: `sed` with no script at
 * all is not a proven reader, so its roster row names one.
 */
const MINIMAL_ARGUMENTS: ReadonlyMap<string, readonly string[]> = new Map([
  ["sed", ["p"]],
  ["awk", ["{print}"]],
]);

/** Prove a head word's effect over plain argument spellings. */
function prove(headWord: string, argWords: readonly string[]) {
  return proveCommandEffect(headWord, literalArgWords(...argWords));
}

describe("PURE_READER_CORE", () => {
  it("holds exactly the audited words", () => {
    expect([...PURE_READER_CORE].sort()).toEqual([...ROSTER].sort());
  });

  it("matches the roster published in docs/configuration.md", () => {
    // A listed roster drifts from the code, and this one is what a user reads
    // to decide whether a directional grant will cover their commands.
    const doc = readFileSync(
      join(import.meta.dirname, "..", "..", "..", "docs", "configuration.md"),
      "utf-8",
    );
    const listed =
      /<!-- BEGIN PURE_READER_CORE -->([\s\S]*?)<!-- END PURE_READER_CORE -->/.exec(
        doc,
      )?.[1];
    expect(listed).toBeDefined();

    const documented = [...(listed ?? "").matchAll(/`([^`]+)`/g)].map(
      ([, word]) => word,
    );
    expect(documented).toEqual([...PURE_READER_CORE].sort());
  });
});

describe("proveCommandEffect", () => {
  describe("a core word", () => {
    it.each(ROSTER)("proves a read for %s", (word) => {
      expect(prove(word, MINIMAL_ARGUMENTS.get(word) ?? [])).toEqual(CORE_READ);
    });

    it("proves a read whatever its arguments are", () => {
      expect(prove("cat", ["-n", "~/.ssh/id_rsa"])).toEqual(CORE_READ);
    });
  });

  describe("a word outside the core", () => {
    it.each([
      "pnpm",
      "git",
      "gawk",
      "uniq",
      "tee",
      "dd",
      "less",
      "more",
      // `file -C` writes a magic.mgc file, so it fails the roster's bar.
      "file",
      "curl",
      "tree",
      "node",
      "rm",
    ])("proves nothing for %s", (word) => {
      expect(prove(word, [])).toEqual(UNPROVEN_EFFECT);
    });

    it("proves nothing for an unresolvable head word", () => {
      expect(prove("", ["~/outside"])).toEqual(UNPROVEN_EFFECT);
    });

    it("never proves a write, so rm cannot ride a read grant", () => {
      expect(prove("rm", ["-rf", "~/outside"])).toEqual(UNPROVEN_EFFECT);
    });
  });

  describe("the bare-basename rule", () => {
    it.each([
      "./grep",
      "../grep",
      "/usr/bin/grep",
      "/tmp/evil/grep",
      "bin\\grep",
      "C:\\tools\\grep",
      "/bin/sed",
      "./sed",
      "./awk",
    ])("refuses the core for the path-qualified head word %s", (word) => {
      expect(prove(word, [])).toEqual(UNPROVEN_EFFECT);
    });
  });

  describe("the find retraction guard", () => {
    it.each([
      "-exec",
      "-execdir",
      "-ok",
      "-okdir",
      "-delete",
      "-fprint",
      "-fprint0",
      "-fprintf",
      "-fls",
    ])("retracts the read claim on %s", (option) => {
      expect(prove("find", [".", option, "rm", "{}", ";"])).toEqual(RETRACTED);
    });

    it("keeps the read claim for an ordinary search", () => {
      expect(prove("find", [".", "-name", "*.ts"])).toEqual(CORE_READ);
    });

    it("does not retract on a word that merely contains a guarded option", () => {
      expect(prove("find", [".", "-name", "-delete.txt"])).toEqual(CORE_READ);
    });
  });

  describe("the fd retraction guard", () => {
    it.each(["-x", "-X", "--exec", "--exec-batch"])(
      "retracts the read claim on %s",
      (option) => {
        expect(prove("fd", ["foo", option, "rm"])).toEqual(RETRACTED);
      },
    );

    it("retracts on a long stem carrying an attached value", () => {
      expect(prove("fd", ["foo", "--exec=rm"])).toEqual(RETRACTED);
    });

    it("retracts on a guarded letter inside a short cluster", () => {
      expect(prove("fd", ["-Hx", "rm"])).toEqual(RETRACTED);
    });

    it("keeps the read claim for an ordinary search", () => {
      expect(prove("fd", ["-H", "--type", "f", "foo"])).toEqual(CORE_READ);
    });
  });

  describe("the sort retraction guard", () => {
    it.each(["-o", "--output"])("retracts the read claim on %s", (option) => {
      expect(prove("sort", [option, "/tmp/out", "in"])).toEqual(RETRACTED);
    });

    it("retracts on a long stem carrying an attached value", () => {
      expect(prove("sort", ["--output=/tmp/out", "in"])).toEqual(RETRACTED);
    });

    it.each(["--out", "--outp", "--o"])(
      "retracts on the GNU long-option abbreviation %s",
      (option) => {
        // GNU getopt_long resolves any unambiguous abbreviation to --output,
        // so an abbreviation reaches the same write the full spelling does.
        expect(prove("sort", [option, "/tmp/out", "in"])).toEqual(RETRACTED);
      },
    );

    it("retracts on an abbreviation carrying an attached value", () => {
      expect(prove("sort", ["--out=/tmp/out", "in"])).toEqual(RETRACTED);
    });

    it("does not treat a bare -- end-of-options marker as an abbreviation", () => {
      expect(prove("sort", ["--", "in"])).toEqual(CORE_READ);
    });

    it("retracts on the attached-value short form", () => {
      expect(prove("sort", ["-o/tmp/out", "in"])).toEqual(RETRACTED);
    });

    it("retracts on a guarded letter inside a short cluster", () => {
      expect(prove("sort", ["-uo", "/tmp/out", "in"])).toEqual(RETRACTED);
    });

    it("keeps the read claim for an ordinary sort", () => {
      expect(prove("sort", ["-u", "-k2", "in"])).toEqual(CORE_READ);
    });
  });

  describe("a computed argument to an option-guarded word", () => {
    // Its value is the unresolved source spelling, which is not what the
    // program receives, so only whether it may lead with `-` can decide.
    it.each(["find", "fd", "sort"])(
      "retracts %s's read claim when the word may lead with a dash",
      (headWord) => {
        expect(
          proveCommandEffect(headWord, [
            ...literalArgWords("in"),
            computedArgWord("$A", true),
          ]),
        ).toEqual(RETRACTED);
      },
    );

    it.each(["find", "fd", "sort"])(
      "keeps %s's read claim when the word cannot lead with a dash",
      (headWord) => {
        expect(
          proveCommandEffect(headWord, [
            ...literalArgWords("in"),
            computedArgWord("x*", false),
          ]),
        ).toEqual(CORE_READ);
      },
    );
  });

  describe("the sed guard", () => {
    // The prover's own cases live in sed-invocation.test.ts; these pin that
    // the core consults it.
    it("keeps the read claim for a print-only script", () => {
      expect(prove("sed", ["-n", "1,80p", "f.md"])).toEqual(CORE_READ);
    });

    it("retracts the read claim for an in-place edit", () => {
      expect(prove("sed", ["-i", "s/a/b/", "f.md"])).toEqual(RETRACTED);
    });

    it("retracts the read claim for a computed script", () => {
      expect(
        proveCommandEffect("sed", [
          computedArgWord("$range", true),
          ...literalArgWords("f.md"),
        ]),
      ).toEqual(RETRACTED);
    });
  });

  describe("the awk guard", () => {
    it("keeps the read claim for a program that only prints", () => {
      expect(prove("awk", ["{print $1}", "data"])).toEqual(CORE_READ);
    });

    it("retracts the read claim for a program that redirects its output", () => {
      expect(prove("awk", ['{print > "out"}', "data"])).toEqual(RETRACTED);
    });
  });

  describe("a guard belongs to its own word only", () => {
    it("does not apply sed's guard to cat", () => {
      expect(prove("cat", ["-i", "w", "out"])).toEqual(CORE_READ);
    });

    it("does not apply find's guard to cat", () => {
      expect(prove("cat", ["-delete"])).toEqual(CORE_READ);
    });

    it("does not apply sort's guard to grep", () => {
      expect(prove("grep", ["-o", "pattern", "file"])).toEqual(CORE_READ);
    });

    it("does not apply fd's guard to find", () => {
      expect(prove("find", [".", "-x"])).toEqual(CORE_READ);
    });
  });
});

describe("redirectDestinationEffect", () => {
  describe("an output redirect", () => {
    it.each([">", ">>", ">|", "&>", "&>>"])(
      "proves a write for %s",
      (operator) => {
        expect(redirectDestinationEffect(operator, false)).toEqual(
          SYNTAX_WRITE,
        );
      },
    );
  });

  describe("an input redirect", () => {
    it.each(["<", "<<<"])("proves a read for %s", (operator) => {
      expect(redirectDestinationEffect(operator, false)).toEqual(SYNTAX_READ);
    });
  });

  describe("a file-descriptor duplication", () => {
    it.each([">&", "<&"])("collects no token for %s a descriptor", (op) => {
      expect(redirectDestinationEffect(op, true)).toBeNull();
    });

    it("proves a write when >& names a file instead", () => {
      expect(redirectDestinationEffect(">&", false)).toEqual(SYNTAX_WRITE);
    });

    it("proves a read when <& names a file instead", () => {
      expect(redirectDestinationEffect("<&", false)).toEqual(SYNTAX_READ);
    });
  });

  describe("an operator outside the table", () => {
    it.each(["<>", "&", ""])(
      "proves nothing rather than dropping the token for %s",
      (operator) => {
        expect(redirectDestinationEffect(operator, false)).toEqual(
          UNPROVEN_EFFECT,
        );
      },
    );

    it("still collects the token when the destination is a descriptor", () => {
      expect(redirectDestinationEffect("<>", true)).toEqual(UNPROVEN_EFFECT);
    });
  });
});
