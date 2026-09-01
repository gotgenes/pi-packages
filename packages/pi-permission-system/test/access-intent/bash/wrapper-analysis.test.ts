import { describe, expect, it } from "vitest";
import {
  type CommandWord,
  classifyWrapperWords,
  executedUnitOf,
  isTransparentWrapper,
} from "#src/access-intent/bash/wrapper-analysis";

/**
 * Split a command unit into words the way the AST walk does: whitespace
 * separated, but a quoted span is one word carrying its quotes — tree-sitter
 * emits a `string`/`raw_string` argument as a single named child.
 *
 * `program.test.ts` pins the real node adapter end to end; this stands in for it
 * so the extraction rules can be exercised without a parse.
 */
function words(unitText: string): CommandWord[] {
  const out: CommandWord[] = [];
  const pattern = /"[^"]*"|'[^']*'|\S+/g;
  let match = pattern.exec(unitText);
  while (match !== null) {
    out.push({ text: match[0], offset: match.index });
    match = pattern.exec(unitText);
  }
  return out;
}

describe("classifyWrapperWords", () => {
  describe("opaque payloads", () => {
    it.each([
      "eval rm",
      "bash -c rm",
      "sh -c rm",
      "dash -c rm",
      "zsh -c rm",
      "ksh -c rm",
      "bash -ec rm",
      "bash -xc rm",
      "/bin/bash -c rm",
    ])("flags %s", (unit) => {
      expect(classifyWrapperWords(words(unit))).toBe("opaque-payload");
    });

    it("does not flag a shell running a script file", () => {
      expect(classifyWrapperWords(words("bash script.sh"))).toBeUndefined();
    });

    it("does not flag a -c cluster after the end-of-options marker", () => {
      expect(classifyWrapperWords(words("bash -- -c"))).toBeUndefined();
    });
  });

  describe("indirection wrappers", () => {
    it.each([
      "sudo aws s3 ls",
      "env FOO=bar aws",
      "xargs grep foo",
      "timeout 10 grep foo",
      "nice -n 5 make",
      "doas ls",
      "flock /tmp/lock ls",
    ])("flags %s", (unit) => {
      expect(classifyWrapperWords(words(unit))).toBe("indirection");
    });

    it.each([
      "find . -exec grep foo {} ;",
      "find . -execdir rm {} ;",
      "fd -x rm",
      "fd --exec-batch rm",
    ])("flags the exec-conditional %s", (unit) => {
      expect(classifyWrapperWords(words(unit))).toBe("indirection");
    });

    it("does not flag a bare search", () => {
      expect(classifyWrapperWords(words("find . -name x"))).toBeUndefined();
    });
  });

  describe("ordinary commands", () => {
    it.each(["ls -la", "grep -c foo file", "git status"])(
      "does not flag %s",
      (unit) => {
        expect(classifyWrapperWords(words(unit))).toBeUndefined();
      },
    );

    it("does not flag an empty word list", () => {
      expect(classifyWrapperWords([])).toBeUndefined();
    });
  });
});

describe("executedUnitOf", () => {
  /** Extract from a unit spelled as plain whitespace-separated words. */
  function executedUnit(unitText: string): string | null {
    return executedUnitOf(unitText, words(unitText));
  }

  describe("opaque payloads", () => {
    it.each([
      ['bash -c "rm -rf /"', "rm -rf /"],
      ["bash -c 'rm -rf /'", "rm -rf /"],
      ['sh -ec "make build"', "make build"],
      ['/bin/bash -c "ls"', "ls"],
      ['eval "rm x"', "rm x"],
    ])("names the inner program of %s", (unit, expected) => {
      expect(executedUnit(unit)).toBe(expected);
    });

    it("returns null when the payload argument is missing", () => {
      expect(executedUnit("bash -c")).toBeNull();
    });
  });

  describe("indirection wrappers", () => {
    it.each([
      ["sudo aws s3 rm", "aws s3 rm"],
      ["sudo -u root aws s3 rm", "aws s3 rm"],
      ["sudo -- ls -la", "ls -la"],
      ["xargs grep foo", "grep foo"],
      ["xargs -0 -n1 grep foo", "grep foo"],
      ["xargs -I{} rm {}", "rm {}"],
      ["timeout 10 grep foo", "grep foo"],
      ["timeout -s KILL 10 grep foo", "grep foo"],
      ["nice -n 5 make build", "make build"],
      ["env FOO=bar grep foo", "grep foo"],
      ["flock /tmp/lock aws s3 ls", "aws s3 ls"],
      ["watch -n 2 ls", "ls"],
    ])("names the inner command of %s", (unit, expected) => {
      expect(executedUnit(unit)).toBe(expected);
    });

    it("preserves the inner command's original spacing and quoting", () => {
      expect(executedUnit("sudo   grep  'a  b'  x")).toBe("grep  'a  b'  x");
    });

    it.each(["xargs", "sudo", "sudo -u root", "timeout 10"])(
      "returns null when %s names no inner command",
      (unit) => {
        expect(executedUnit(unit)).toBeNull();
      },
    );

    it("returns null rather than guessing past an unknown trailing option", () => {
      expect(executedUnit("xargs --unknown-opt")).toBeNull();
    });
  });

  describe("exec-conditional wrappers", () => {
    it.each([
      ["find . -name x -exec grep foo {} ;", "grep foo {}"],
      ["find . -exec rm {} +", "rm {}"],
      ["find . -execdir grep foo {} ;", "grep foo {}"],
      ["fd -x rm", "rm"],
      ["fd --exec-batch rm -f", "rm -f"],
    ])("names the per-result command of %s", (unit, expected) => {
      expect(executedUnit(unit)).toBe(expected);
    });

    it("returns null when the exec flag ends the command", () => {
      expect(executedUnit("find . -exec")).toBeNull();
    });
  });

  describe("nested wrappers", () => {
    it.each([
      ["sudo timeout 5 xargs grep foo", "grep foo"],
      ["sudo bash -c 'rm x'", "rm x"],
      ["timeout 10 sudo -u root aws s3 rm", "aws s3 rm"],
    ])("unwraps %s to its innermost command", (unit, expected) => {
      expect(executedUnit(unit)).toBe(expected);
    });
  });

  describe("nothing to add", () => {
    it("returns null for an ordinary command", () => {
      expect(executedUnit("grep foo")).toBeNull();
    });

    it("returns null for an empty word list", () => {
      expect(executedUnitOf("", [])).toBeNull();
    });
  });
});

describe("isTransparentWrapper", () => {
  /** The predicate over a unit that carries no write-proving redirect. */
  function isTransparent(unitText: string): boolean {
    return isTransparentWrapper(words(unitText), { writesViaRedirect: false });
  }

  describe("a wrapper running a proven pure reader", () => {
    it.each([
      "xargs grep foo",
      "xargs -0 rg pattern",
      "xargs -I{} basename {}",
      "xargs cat",
      "time cat x",
      "env FOO=bar grep x",
      "sudo grep foo /etc/hosts",
      "find . -name '*.ts' -exec wc -l {} +",
      "fd -e ts -x cat",
    ])("is transparent: %s", (unit) => {
      expect(isTransparent(unit)).toBe(true);
    });

    it("unwraps nested indirection to the innermost command", () => {
      expect(isTransparent("sudo timeout 5 xargs grep foo")).toBe(true);
    });
  });

  describe("a wrapper running anything else", () => {
    it.each([
      ["xargs pnpm test", "the inner command is not in the core"],
      ["time pnpm test", "the inner command is not in the core"],
      ["xargs git commit", "the inner command is subcommand-dependent"],
      ["xargs ./grep foo", "a path-qualified head word is never core"],
      ["xargs /usr/bin/grep foo", "a path-qualified head word is never core"],
      ["xargs sort -o /tmp/x", "`-o` withdraws sort's read claim"],
      ["xargs find . -delete", "`-delete` withdraws find's read claim"],
      ["xargs fd -x rm", "`-x` withdraws fd's read claim"],
    ])("is not transparent: %s (%s)", (unit) => {
      expect(isTransparent(unit)).toBe(false);
    });
  });

  describe("an opaque payload is never transparent", () => {
    // `executedUnitOf` deliberately unwraps *through* an opaque payload to name
    // what runs, so its head word can be a core word while the payload is an
    // unparsed shell program. The predicate must refuse there, and these pin the
    // two functions disagreeing on the same input (#803).
    it.each([
      "xargs -I{} sh -c 'grep -l x {}'",
      "find . -exec sh -c 'grep x' \\;",
      "sudo bash -c 'cat /etc/shadow'",
      "eval 'grep foo'",
      "bash -c 'grep foo'",
    ])("is not transparent: %s", (unit) => {
      expect(isTransparent(unit)).toBe(false);
    });

    it("still names the payload for display", () => {
      const unit = "xargs -I{} sh -c 'grep -l x {}'";
      expect(executedUnitOf(unit, words(unit))).toBe("grep -l x {}");
      expect(isTransparent(unit)).toBe(false);
    });
  });

  describe("an unresolvable inner command is never transparent", () => {
    it.each([
      ["xargs --unknown-opt", "the wrapper's own options run out first"],
      ["find . -exec", "the exec flag ends the command"],
      ["sudo timeout 5 xargs --unknown-opt", "peeling stops at the wrapper"],
    ])("is not transparent: %s (%s)", (unit) => {
      expect(isTransparent(unit)).toBe(false);
    });
  });

  describe("a unit that is not a floored wrapper", () => {
    it.each([
      ["grep foo", "an ordinary command has no floor to lift"],
      ["find . -name '*.ts'", "a bare search runs no subcommand"],
      ["cat a", "an ordinary command has no floor to lift"],
    ])("is not transparent: %s (%s)", (unit) => {
      expect(isTransparent(unit)).toBe(false);
    });

    it("is not transparent for an empty word list", () => {
      expect(isTransparentWrapper([], { writesViaRedirect: false })).toBe(
        false,
      );
    });
  });

  describe("a write-proving redirect", () => {
    it("withholds the exemption from an otherwise transparent wrapper", () => {
      const unit = "xargs grep foo";
      expect(isTransparent(unit)).toBe(true);
      expect(
        isTransparentWrapper(words(unit), { writesViaRedirect: true }),
      ).toBe(false);
    });
  });
});
