import { describe, expect, it } from "vitest";
import {
  bypassableWrapperUnit,
  type CommandWord,
  classifyWrapperWords,
  executedUnitOf,
  inlineShellPayloadIndex,
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

describe("inlineShellPayloadIndex", () => {
  /** The payload index of a unit spelled as plain whitespace-separated words. */
  function payloadIndex(unitText: string): number {
    return inlineShellPayloadIndex(words(unitText));
  }

  describe("a shell running an inline program", () => {
    it.each([
      ['bash -c "rm -rf /"', 2],
      ["sh -c 'ls'", 2],
      ["dash -c ls", 2],
      ["zsh -c ls", 2],
      ["ksh -c ls", 2],
      ['bash -ec "make build"', 2],
      ['bash -xc "make build"', 2],
      ['/bin/bash -c "ls"', 2],
      ['bash -i -c "ls"', 3],
    ])("names the argument after the -c cluster in %s", (unit, expected) => {
      expect(payloadIndex(unit)).toBe(expected);
    });

    it("names eval's first argument, which takes no flag", () => {
      expect(payloadIndex('eval "rm x"')).toBe(1);
    });
  });

  describe("a shell reached through an indirection wrapper", () => {
    // `executedUnitOf` peels indirection to name the payload, so this must peel
    // it too: otherwise `sudo bash -c 'TOKEN=…'` masks under `executedUnit` and
    // not under `command`, which is the inconsistency #923 reports.
    it.each([
      [`sudo bash -c 'x'`, 3],
      [`xargs sh -c 'x'`, 3],
      [`timeout 5 bash -c 'x'`, 4],
      [`env FOO=bar bash -c 'x'`, 4],
      [`sudo -u root bash -c 'x'`, 5],
      [`sudo timeout 5 bash -c 'x'`, 5],
      [`find . -exec sh -c 'x' ;`, 5],
    ])("names the payload of %s through the wrapper", (unit, expected) => {
      expect(payloadIndex(unit)).toBe(expected);
    });

    it.each([
      [`sudo ls`, "the wrapped command carries no inline program"],
      [`xargs grep foo`, "the wrapped command carries no inline program"],
      [`sudo python3 -c 'x'`, "the wrapped interpreter is not a shell"],
      [`xargs --unknown-opt`, "the wrapper's own options run out first"],
      [`find . -exec`, "the exec flag ends the command"],
    ])("answers -1 for %s (%s)", (unit) => {
      expect(payloadIndex(unit)).toBe(-1);
    });
  });

  describe("a unit carrying no inline program", () => {
    it.each([
      ["bash script.sh", "a shell running a script file"],
      ["bash --help", "a long option is not a -c cluster"],
      ["bash -- -c", "the -c follows the end-of-options marker"],
      ["python3 -c 'print(1)'", "an interpreter is not a shell"],
      ["node -e 'x'", "an interpreter is not a shell"],
      ["sudo ls", "an indirection wrapper hides no payload"],
      ["ls -la", "an ordinary command"],
    ])("answers -1 for %s (%s)", (unit) => {
      expect(payloadIndex(unit)).toBe(-1);
    });

    it("answers -1 for an empty word list", () => {
      expect(inlineShellPayloadIndex([])).toBe(-1);
    });
  });

  describe("a payload flag with nothing after it", () => {
    // The index still names where the payload *would* be; the caller decides
    // what an out-of-range index is worth, exactly as `opaquePayload` does.
    it.each([
      ["bash -c", 2],
      ["eval", 1],
    ])("names the vacant position in %s", (unit, expected) => {
      expect(payloadIndex(unit)).toBe(expected);
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

describe("bypassableWrapperUnit (#490)", () => {
  it.each([
    ["xargs cat", "cat", "xargs cat *"],
    ["xargs rm -rf", "rm", "xargs rm *"],
    ["xargs -r ls -t", "ls", "xargs -r ls *"],
    ["xargs -0 rg -ln foo", "rg", "xargs -0 rg *"],
    ["xargs -n 2 wc -l", "wc", "xargs -n 2 wc *"],
    ["xargs -I {} cp src dst", "cp", "xargs -I {} cp *"],
    ["xargs --no-run-if-empty cat", "cat", "xargs --no-run-if-empty cat *"],
    ["xargs -a /tmp/files cat", "cat", "xargs -a /tmp/files cat *"],
  ])(
    "names the inner command and the pattern that pins it for %s",
    (command, innerCommand, pattern) => {
      expect(bypassableWrapperUnit(words(command), command)).toEqual({
        innerCommand,
        pattern,
      });
    },
  );

  it("names a path-qualified inner command by basename, pinning it as written", () => {
    expect(
      bypassableWrapperUnit(words("xargs /bin/cat foo"), "xargs /bin/cat foo"),
    ).toEqual({ innerCommand: "cat", pattern: "xargs /bin/cat *" });
  });

  it.each(["xargs", "xargs -r", "xargs --no-run-if-empty"])(
    "returns null for %s (no inner command)",
    (command) => {
      expect(bypassableWrapperUnit(words(command), command)).toBeNull();
    },
  );

  it.each([
    ["sudo rm -rf /", "the rule cannot anticipate each inner command"],
    ["env FOO=bar aws s3 ls", "the same, behind an environment prefix"],
    ["timeout 10 grep foo", "a wrapper that takes a leading operand"],
    ["nice -n 10 cat", "a prefix wrapper with no stable verb"],
  ])("returns null for %s (%s)", (command, _why) => {
    expect(bypassableWrapperUnit(words(command), command)).toBeNull();
  });

  it.each([
    ["xargs sudo rm", "an inner indirection wrapper"],
    ["xargs env aws", "an inner prefix wrapper"],
    ["xargs sh -c 'grep x'", "an inner opaque payload"],
  ])("returns null for %s (%s)", (command, _why) => {
    expect(bypassableWrapperUnit(words(command), command)).toBeNull();
  });
});
