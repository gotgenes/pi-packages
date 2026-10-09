import { describe, expect, it } from "vitest";
import type { ArgWord } from "#src/access-intent/bash/node-text";
import {
  type CommandWord,
  classifyWrapperWords,
  executedUnitOf,
  floorExemptionOf,
  inlineShellPayloadIndex,
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
    out.push({ ...argWordOf(match[0]), text: match[0], offset: match.index });
    match = pattern.exec(unitText);
  }
  return out;
}

/**
 * The value a stand-in word reaches its program with: the surrounding quotes
 * removed, and computed when an unquoted or double-quoted `$` decides it. A
 * computed stand-in may always lead with a dash, the conservative reading.
 */
function argWordOf(text: string): ArgWord {
  const quoted = /^(['"])(.*)\1$/s.exec(text);
  const value = quoted ? quoted[2] : text;
  const computed = quoted?.[1] !== "'" && value.includes("$");
  return {
    value,
    computed,
    mayLeadWithDash: computed || value.startsWith("-"),
  };
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

  describe("a sudo layer", () => {
    it("finds the payload past a clustered value-taking option", () => {
      expect(payloadIndex(`sudo -nu root bash -c 'x'`)).toBe(5);
    });

    it("answers -1 when sudo edits its operands as files", () => {
      expect(payloadIndex(`sudo -e bash -c 'x'`)).toBe(-1);
    });
  });

  describe("an xargs layer", () => {
    it("finds the payload past an optional-argument option", () => {
      expect(payloadIndex(`xargs -i bash -c 'x'`)).toBe(4);
    });

    it("answers -1 when -J may put input in the utility position", () => {
      expect(payloadIndex(`xargs -J % bash -c 'x'`)).toBe(-1);
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

  describe("a sudo layer", () => {
    it.each([
      ["sudo -nu cat rm x", "rm x"],
      ["sudo --user cat rm x", "rm x"],
      ["sudo --us root cat x", "cat x"],
      ["sudo --user=root cat x", "cat x"],
      ["sudo -uedward cat", "cat"],
    ])(
      "names the inner command of %s by sudo's option grammar",
      (unit, expected) => {
        expect(executedUnit(unit)).toBe(expected);
      },
    );

    it.each([
      ["sudo -e cat", "-e edits its operands as files"],
      ["sudo --edit true", "--edit edits its operands as files"],
      ["sudo -ne cat", "a cluster carrying e edits"],
      ["sudo --ed cat", "an abbreviation of --edit edits"],
      ["sudo -Z cat", "an unlisted option refuses"],
    ])("returns null for %s (%s)", (unit) => {
      expect(executedUnit(unit)).toBeNull();
    });

    it("names the refused sudo layer when an outer wrapper peels to it", () => {
      expect(executedUnit("timeout 5 sudo -e cat")).toBe("sudo -e cat");
    });
  });

  describe("an xargs layer", () => {
    it.each([
      ["xargs -i rm cat x", "rm cat x"],
      ["xargs -l rm cat x", "rm cat x"],
      ["xargs -i{} cat {}", "cat {}"],
      ["xargs -l1 cat x", "cat x"],
      ["xargs --replace cat x", "cat x"],
      ["xargs --replace=% cat %", "cat %"],
      ["xargs FOO=1 cat", "FOO=1 cat"],
      ["xargs --max-args 1 cat", "cat"],
    ])(
      "names the inner command of %s by xargs's option grammar",
      (unit, expected) => {
        expect(executedUnit(unit)).toBe(expected);
      },
    );

    it.each([
      ["xargs -J cat rm x", "-J may put input in the utility position"],
      ["xargs -J % cat %", "-J may put input in the utility position"],
      ["xargs -Z cat x", "an unlisted option refuses"],
    ])("returns null for %s (%s)", (unit) => {
      expect(executedUnit(unit)).toBeNull();
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

describe("floorExemptionOf", () => {
  /** Whether a unit with no write-proving redirect is exempt as a core reader. */
  function isTransparent(unitText: string): boolean {
    return (
      floorExemptionOf(words(unitText), { writesViaRedirect: false }) ===
      "core-reader"
    );
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
      "sudo -n true",
      "sudo -n :",
      "xargs false",
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
      ["sudo ./true", "a path-qualified head word is never core"],
      ["sudo -n /bin/true", "a path-qualified head word is never core"],
      ["sudo sh -c true", "an inline shell's payload is never peeled"],
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
      expect(
        floorExemptionOf([], { writesViaRedirect: false }),
      ).toBeUndefined();
    });
  });

  describe("a write-proving redirect", () => {
    it("withholds the exemption from an otherwise transparent wrapper", () => {
      const unit = "xargs grep foo";
      expect(floorExemptionOf(words(unit), { writesViaRedirect: false })).toBe(
        "core-reader",
      );
      expect(
        floorExemptionOf(words(unit), { writesViaRedirect: true }),
      ).toBeUndefined();
    });
  });

  describe("an execution modifier", () => {
    /** The exemption a unit earns, with or without a write-proving redirect. */
    function exemptionOf(
      unitText: string,
      writesViaRedirect = false,
    ): string | undefined {
      return floorExemptionOf(words(unitText), { writesViaRedirect });
    }

    describe("running any visible command", () => {
      it.each([
        "time pnpm test",
        "timeout 300 pnpm run lint",
        "timeout -s KILL 10 pnpm test",
        "timeout -sKILL -k5 10 pnpm test",
        "timeout --signal=KILL 10 pnpm test",
        "nice -n 5 pnpm test",
        "nice --adjustment=5 pnpm test",
        "stdbuf -oL pnpm test",
        "stdbuf -o L pnpm test",
        "setsid pnpm test",
        "time timeout 5 pnpm test",
        "time FOO=1 pnpm test",
        "/usr/bin/time pnpm test",
        "time ./scripts/x.sh",
        "time -f %e pnpm test",
        "time -- pnpm test",
      ])("is exempt: %s", (unit) => {
        expect(exemptionOf(unit)).toBe("execution-modifier");
      });

      it("stays exempt when the statement writes through a redirect", () => {
        // The destination is gated by the path surfaces, as for the bare
        // command; this clause inherits a verdict rather than proving a read.
        expect(exemptionOf("time pnpm test", true)).toBe("execution-modifier");
      });
    });

    describe("with a flag the modifier admits", () => {
      it.each([
        "time -p pnpm test",
        "/usr/bin/time -l yarn make",
        "/usr/bin/time -h pnpm test",
        "timeout -v 5 pnpm test",
        "timeout --verbose 5 pnpm test",
        "timeout --foreground 5 pnpm test",
        "timeout -f 5 pnpm test",
        "timeout -p 5 pnpm test",
        "timeout --preserve-status 5 pnpm test",
      ])("is exempt: %s", (unit) => {
        expect(exemptionOf(unit)).toBe("execution-modifier");
      });

      it.each([
        ["setsid -f pnpm test", "setsid's flags are unverified here"],
        ["time -pl pnpm test", "a flag cluster is not listed"],
      ])("is not exempt: %s (%s)", (unit) => {
        expect(exemptionOf(unit)).toBeUndefined();
      });
    });

    describe("running a proven pure reader", () => {
      it("records the core-reader reason first", () => {
        expect(exemptionOf("time grep foo")).toBe("core-reader");
      });

      it("falls back to the modifier reason when a redirect writes", () => {
        expect(exemptionOf("time grep foo", true)).toBe("execution-modifier");
      });
    });

    describe("refused", () => {
      it.each([
        ["time sudo rm -rf x", "a peeled layer changes who runs it"],
        ["sudo time pnpm test", "the outer layer changes who runs it"],
        ["time env A=1 pnpm test", "a peeled layer changes the environment"],
        ["time xargs pnpm test", "a peeled layer feeds hidden arguments"],
        ["nohup pnpm test", "nohup may write nohup.out"],
        ["flock /tmp/l pnpm test", "flock creates its lock file"],
        ["watch pnpm test", "watch repeats the command"],
        ["timeout 5 bash -c 'rm x'", "the payload is not re-parsed"],
        ["time eval 'rm x'", "the payload is not re-parsed"],
      ])("is not exempt: %s (%s)", (unit) => {
        expect(exemptionOf(unit)).toBeUndefined();
      });

      it.each([
        ["timeout --sig KILL 5 rm -rf /", "an abbreviation hides its value"],
        ["nice --adj 5 rm -rf /", "an abbreviation hides its value"],
        ["timeout --unknown 5 pnpm test", "an unlisted option"],
        ["/usr/bin/time -o t.txt pnpm test", "-o writes a file"],
        ["time --output=t.txt pnpm test", "--output writes a file"],
        ["time -a -o t.txt pnpm test", "-a appends to a file"],
        ["nice -5 pnpm test", "the legacy numeric form is not listed"],
      ])("is not exempt: %s (%s)", (unit) => {
        expect(exemptionOf(unit)).toBeUndefined();
      });

      it.each([
        ["time { rm -rf /tmp/x; }", "a brace group is not a command"],
        ["time (rm -rf /tmp/x)", "a subshell is not a command"],
        ["time $(echo rm) -rf x", "a computed head is not a name"],
        ['time "$CMD" x', "a computed head is not a name"],
        ["time if true", "a reserved word is not a command"],
        ["time -- -x", "a dash-led head is not a name"],
      ])("is not exempt: %s (%s)", (unit) => {
        expect(exemptionOf(unit)).toBeUndefined();
      });

      it.each([
        ["time sudo --unknown-opt", "the peel stopped at a wrapper"],
        ["time time time time time pnpm test", "the peel ran out of depth"],
        ["time", "there is no inner command"],
        ["timeout 5", "there is no inner command"],
      ])("is not exempt: %s (%s)", (unit) => {
        expect(exemptionOf(unit)).toBeUndefined();
      });
    });
  });

  describe("a sudo layer", () => {
    it.each([
      ["sudo -e cat", "-e edits its operands as files"],
      ["sudo --edit true", "--edit edits its operands as files"],
      ["sudo -ne cat", "a cluster carrying e edits"],
      ["sudo --ed cat", "an abbreviation of --edit edits"],
      ["sudo -Z cat", "an unlisted option refuses"],
      ["timeout 5 sudo -e cat", "the refused layer is still a wrapper"],
      ["sudo -nu cat rm x", "the cluster's -u takes cat as its value"],
      ["sudo --user cat rm x", "--user takes cat as its value"],
    ])("is not transparent: %s (%s)", (unit) => {
      expect(isTransparent(unit)).toBe(false);
    });

    it.each([
      ["sudo --us root cat x", "an abbreviation of --user takes root"],
      ["sudo --user=root cat x", "an attached long value"],
      ["sudo -uedward cat", "an attached short value ends the cluster"],
      ["sudo FOO=1 cat x", "sudo passes an assignment to the command"],
    ])("is transparent: %s (%s)", (unit) => {
      expect(isTransparent(unit)).toBe(true);
    });

    describe("a mode in which the named command is not what runs", () => {
      it.each([
        ["sudo -D /etc cat shadow", "-D moves where operands resolve"],
        [
          "sudo --chdir /etc cat shadow",
          "--chdir moves where operands resolve",
        ],
        ["sudo -R /x cat y", "-R moves where operands resolve"],
        ["sudo --chroot /x cat y", "--chroot moves where operands resolve"],
        ["sudo -s cat x", "-s hands the operand to a shell"],
        ["sudo --shell cat x", "--shell hands the operand to a shell"],
        ["sudo -i cat x", "-i hands the operand to a login shell"],
        ["sudo --lo cat x", "an abbreviation of --login"],
        ["sudo -h host cat x", "-h is help or a host by context"],
        ["sudo --host host cat x", "--host's arity is unsettled"],
      ])("is not transparent: %s (%s)", (unit) => {
        expect(isTransparent(unit)).toBe(false);
      });

      it.each([
        ["sudo --l cat x", "--list and --login"],
        ["sudo --pre cat x", "--preserve-env and --preserve-groups"],
      ])("is not transparent for the ambiguous %s (%s)", (unit) => {
        expect(isTransparent(unit)).toBe(false);
      });
    });

    describe("a documented option that changes nothing the peel names", () => {
      it.each([
        "sudo -E cat x",
        "sudo -H cat x",
        "sudo -AbBkNPS cat x",
        "sudo --preserve-env cat x",
        "sudo --preserve-env=PATH cat x",
        "sudo -T 5 cat x",
        "sudo --command-timeout 5 cat x",
        "sudo --close-from 3 cat x",
        "sudo --other-user bob cat x",
        "sudo --prompt pw cat x",
        "sudo --non-interactive --set-home cat x",
      ])("is transparent: %s", (unit) => {
        expect(isTransparent(unit)).toBe(true);
      });
    });
  });

  describe("an xargs layer", () => {
    it.each([
      ["xargs -J cat rm x", "-J takes cat as its replstr, so rm runs"],
      ["xargs -J % cat %", "-J may put input in the utility position"],
      ["xargs -Z cat x", "an unlisted option refuses"],
      ["xargs -i rm cat x", "-i takes only an attached value, so rm runs"],
      ["xargs -l rm cat x", "-l takes only an attached value, so rm runs"],
      ["xargs FOO=1 cat", "xargs runs a word like FOO=1 as the command"],
    ])("is not transparent: %s (%s)", (unit) => {
      expect(isTransparent(unit)).toBe(false);
    });

    it.each([
      ["xargs -i{} cat {}", "an attached optional value"],
      ["xargs -l1 cat x", "an attached optional value"],
      ["xargs --replace cat x", "a long optional argument takes no word"],
      ["xargs --replace=% cat %", "an attached long optional value"],
      ["xargs --max-args 1 cat", "--max-args takes 1 as its value"],
      ["xargs -0r grep foo", "a cluster of flags"],
      ["xargs -n1 cat x", "an attached short value"],
      ["xargs -I{} cat {}", "an attached replstr"],
    ])("is transparent: %s (%s)", (unit) => {
      expect(isTransparent(unit)).toBe(true);
    });
  });
});
