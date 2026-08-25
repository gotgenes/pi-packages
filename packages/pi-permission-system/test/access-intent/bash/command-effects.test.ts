import { describe, expect, it } from "vitest";
import {
  PURE_READER_CORE,
  proveCommandEffect,
} from "#src/access-intent/bash/command-effects";
import { UNPROVEN_EFFECT } from "#src/access-intent/effect";

const CORE_READ = { effect: "read", source: "core" } as const;
const RETRACTED = { effect: "unproven", source: "retracted" } as const;

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
  "file",
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
];

describe("PURE_READER_CORE", () => {
  it("holds exactly the 22 audited words", () => {
    expect([...PURE_READER_CORE].sort()).toEqual([...ROSTER].sort());
  });
});

describe("proveCommandEffect", () => {
  describe("a core word", () => {
    it.each(ROSTER)("proves a read for %s", (word) => {
      expect(proveCommandEffect(word, [])).toEqual(CORE_READ);
    });

    it("proves a read whatever its arguments are", () => {
      expect(proveCommandEffect("cat", ["-n", "~/.ssh/id_rsa"])).toEqual(
        CORE_READ,
      );
    });
  });

  describe("a word outside the core", () => {
    it.each([
      "pnpm",
      "git",
      "sed",
      "awk",
      "gawk",
      "uniq",
      "tee",
      "dd",
      "less",
      "more",
      "curl",
      "tree",
      "node",
      "rm",
    ])("proves nothing for %s", (word) => {
      expect(proveCommandEffect(word, [])).toEqual(UNPROVEN_EFFECT);
    });

    it("proves nothing for an unresolvable head word", () => {
      expect(proveCommandEffect("", ["~/outside"])).toEqual(UNPROVEN_EFFECT);
    });

    it("never proves a write, so rm cannot ride a read grant", () => {
      expect(proveCommandEffect("rm", ["-rf", "~/outside"])).toEqual(
        UNPROVEN_EFFECT,
      );
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
    ])("refuses the core for the path-qualified head word %s", (word) => {
      expect(proveCommandEffect(word, [])).toEqual(UNPROVEN_EFFECT);
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
      "-fprintf",
      "-fls",
    ])("retracts the read claim on %s", (option) => {
      expect(
        proveCommandEffect("find", [".", option, "rm", "{}", ";"]),
      ).toEqual(RETRACTED);
    });

    it("keeps the read claim for an ordinary search", () => {
      expect(proveCommandEffect("find", [".", "-name", "*.ts"])).toEqual(
        CORE_READ,
      );
    });

    it("does not retract on a word that merely contains a guarded option", () => {
      expect(proveCommandEffect("find", [".", "-name", "-delete.txt"])).toEqual(
        CORE_READ,
      );
    });
  });

  describe("the fd retraction guard", () => {
    it.each([
      "-x",
      "-X",
      "--exec",
      "--exec-batch",
    ])("retracts the read claim on %s", (option) => {
      expect(proveCommandEffect("fd", ["foo", option, "rm"])).toEqual(
        RETRACTED,
      );
    });

    it("retracts on a long stem carrying an attached value", () => {
      expect(proveCommandEffect("fd", ["foo", "--exec=rm"])).toEqual(RETRACTED);
    });

    it("retracts on a guarded letter inside a short cluster", () => {
      expect(proveCommandEffect("fd", ["-Hx", "rm"])).toEqual(RETRACTED);
    });

    it("keeps the read claim for an ordinary search", () => {
      expect(proveCommandEffect("fd", ["-H", "--type", "f", "foo"])).toEqual(
        CORE_READ,
      );
    });
  });

  describe("the sort retraction guard", () => {
    it.each(["-o", "--output"])("retracts the read claim on %s", (option) => {
      expect(proveCommandEffect("sort", [option, "/tmp/out", "in"])).toEqual(
        RETRACTED,
      );
    });

    it("retracts on a long stem carrying an attached value", () => {
      expect(proveCommandEffect("sort", ["--output=/tmp/out", "in"])).toEqual(
        RETRACTED,
      );
    });

    it("retracts on the attached-value short form", () => {
      expect(proveCommandEffect("sort", ["-o/tmp/out", "in"])).toEqual(
        RETRACTED,
      );
    });

    it("retracts on a guarded letter inside a short cluster", () => {
      expect(proveCommandEffect("sort", ["-uo", "/tmp/out", "in"])).toEqual(
        RETRACTED,
      );
    });

    it("keeps the read claim for an ordinary sort", () => {
      expect(proveCommandEffect("sort", ["-u", "-k2", "in"])).toEqual(
        CORE_READ,
      );
    });
  });

  describe("a guard belongs to its own word only", () => {
    it("does not apply find's guard to cat", () => {
      expect(proveCommandEffect("cat", ["-delete"])).toEqual(CORE_READ);
    });

    it("does not apply sort's guard to grep", () => {
      expect(proveCommandEffect("grep", ["-o", "pattern", "file"])).toEqual(
        CORE_READ,
      );
    });

    it("does not apply fd's guard to find", () => {
      expect(proveCommandEffect("find", [".", "-x"])).toEqual(CORE_READ);
    });
  });
});
