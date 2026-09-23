import { describe, expect, it } from "vitest";
import type { TSNode } from "#src/access-intent/bash/parser";
import { getParser } from "#src/access-intent/bash/parser";
import {
  collectCommandTokens,
  collectPathCandidateTokens,
  collectRedirectTokens,
  extractCommandName,
  extractCommandWord,
  type PathToken,
} from "#src/access-intent/bash/token-collection";
import { UNPROVEN_EFFECT } from "#src/access-intent/effect";

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * The token strings a collector produced.
 *
 * The collectors answer two questions at once — which tokens are path
 * candidates, and what effect each carries. These wrappers keep the projection
 * assertions reading as projection assertions; the effect assertions call the
 * collectors directly.
 */
function commandTokens(node: TSNode): string[] {
  return tokenTextsOf(collectCommandTokens(node));
}

function redirectTokens(node: TSNode): string[] {
  return tokenTextsOf(collectRedirectTokens(node));
}

function pathCandidateTokens(node: TSNode): string[] {
  return tokenTextsOf(collectPathCandidateTokens(node));
}

function tokenTextsOf(tokens: readonly PathToken[]): string[] {
  return tokens.map(({ token }) => token);
}

/** Depth-first search for the first node of the given type. */
function findNode(node: TSNode, type: string): TSNode | null {
  if (node.type === type) return node;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    const found = findNode(child, type);
    if (found) return found;
  }
  return null;
}

/** A parsed node of a requested type, with the tree that owns it. */
interface ParsedNode {
  node: TSNode;
  tree: { rootNode: TSNode; delete(): void };
}

/**
 * Parse a bash snippet and return its first node of `type`.
 *
 * The node type is a parameter rather than baked into a per-type wrapper
 * because it is an external fact about the tree-sitter-bash grammar, and the
 * collectors under test dispatch on several of them.
 */
async function parseNode(cmd: string, type: string): Promise<ParsedNode> {
  const parser = await getParser();
  const tree = parser.parse(cmd);
  if (!tree) throw new Error("parser.parse returned null");
  const node = findNode(tree.rootNode, type);
  if (!node) throw new Error(`no ${type} node found in: ${cmd}`);
  return { node, tree };
}

/** Parse a bash snippet and return the first `command` node. */
async function parseCommandNode(cmd: string): Promise<ParsedNode> {
  return parseNode(cmd, "command");
}

/** Parse a bash snippet and return the first `file_redirect` node. */
async function parseRedirectNode(cmd: string): Promise<ParsedNode> {
  return parseNode(cmd, "file_redirect");
}

// ── extractCommandName ────────────────────────────────────────────────────────

describe("extractCommandName", () => {
  it("returns the basename for a bare command", async () => {
    const { node, tree } = await parseCommandNode("sed 's/x/y/' file.txt");
    try {
      expect(extractCommandName(node)).toBe("sed");
    } finally {
      tree.delete();
    }
  });

  it("strips the directory prefix from an absolute command path", async () => {
    const { node, tree } = await parseCommandNode(
      "/usr/bin/sed 's/x/y/' file.txt",
    );
    try {
      expect(extractCommandName(node)).toBe("sed");
    } finally {
      tree.delete();
    }
  });

  it("returns the substitution text when the command name is a command substitution", async () => {
    // $(which sed) parses with a command_name child whose text is "$(which sed)";
    // resolveNodeText returns that text, so extractCommandName returns its basename.
    // PATTERN_FIRST_COMMANDS.get("$(which sed)") returns undefined, so
    // collectCommandTokens falls back to generic collection — correct behaviour.
    const { node, tree } = await parseCommandNode(
      "$(which sed) 's/x/y/' file.txt",
    );
    try {
      expect(extractCommandName(node)).toBe("$(which sed)");
    } finally {
      tree.delete();
    }
  });
});

// ── collectCommandTokens — pattern-first commands ─────────────────────────────

describe("collectCommandTokens — pattern-first commands", () => {
  async function tokensOf(cmd: string): Promise<string[]> {
    const { node, tree } = await parseCommandNode(cmd);
    try {
      return commandTokens(node);
    } finally {
      tree.delete();
    }
  }

  /** Tokens of a whole snippet, for the surfaces that sit outside the command. */
  async function pathTokensOf(cmd: string): Promise<string[]> {
    const parser = await getParser();
    const tree = parser.parse(cmd);
    if (!tree) throw new Error("parse returned null");
    try {
      return pathCandidateTokens(tree.rootNode);
    } finally {
      tree.delete();
    }
  }

  it("sed: skips the first positional (inline pattern) and collects the rest", async () => {
    const { node, tree } = await parseCommandNode("sed 's/x/y/' a.txt b.txt");
    try {
      expect(commandTokens(node)).toEqual(["a.txt", "b.txt"]);
    } finally {
      tree.delete();
    }
  });

  it("sed -e: skips the explicit script arg-consuming flag and collects positionals", async () => {
    const { node, tree } = await parseCommandNode("sed -e 's/x/y/' file.txt");
    try {
      // -e consumes the next argument (the script), so file.txt is the first positional
      // Since hasExplicitScript is set by -e, the positional is not skipped
      expect(commandTokens(node)).toEqual(["file.txt"]);
    } finally {
      tree.delete();
    }
  });

  it("sed -f: treats the next argument as a file path (file-consuming flag)", async () => {
    const { node, tree } = await parseCommandNode(
      "sed -f /scripts/script.sed file.txt",
    );
    try {
      // -f consumes the next arg as a file path (extracted), and sets hasExplicitScript
      expect(commandTokens(node)).toEqual(["/scripts/script.sed", "file.txt"]);
    } finally {
      tree.delete();
    }
  });

  it("grep: skips the first positional (pattern) and collects file arguments", async () => {
    const { node, tree } = await parseCommandNode(
      "grep pattern /etc/hosts /etc/passwd",
    );
    try {
      expect(commandTokens(node)).toEqual(["/etc/hosts", "/etc/passwd"]);
    } finally {
      tree.delete();
    }
  });

  it("grep -e: with explicit -e flag, all positionals are file arguments", async () => {
    const { node, tree } = await parseCommandNode("grep -e pattern /etc/hosts");
    try {
      expect(commandTokens(node)).toEqual(["/etc/hosts"]);
    } finally {
      tree.delete();
    }
  });

  it("grep: end-of-flags (--) causes subsequent args to be treated as positionals", async () => {
    const { node, tree } = await parseCommandNode("grep -- pattern /etc/hosts");
    try {
      // After --, both 'pattern' (first positional) and '/etc/hosts' are positionals.
      // pattern is the pattern positional and is skipped; /etc/hosts is collected.
      expect(commandTokens(node)).toEqual(["/etc/hosts"]);
    } finally {
      tree.delete();
    }
  });

  it("sd: skips the first two positionals (FIND and REPLACE_WITH) as patterns", async () => {
    const { node, tree } = await parseCommandNode(
      "sd find replace file.txt other.txt",
    );
    try {
      expect(commandTokens(node)).toEqual(["file.txt", "other.txt"]);
    } finally {
      tree.delete();
    }
  });

  it("rg: skips the pattern positional and collects file/dir arguments", async () => {
    const { node, tree } = await parseCommandNode("rg pattern /etc/");
    try {
      expect(commandTokens(node)).toEqual(["/etc/"]);
    } finally {
      tree.delete();
    }
  });

  describe("a consumed flag argument, whatever node type it is (#823)", () => {
    // tree-sitter-bash types a bare number as `number`, which is not in
    // ARG_NODE_TYPES. Discharging the consumption only on an argument node let
    // the pending skip land on the *pattern* instead, shifting the positional
    // count by one and eating the command's real file operand.
    it.each([
      "grep -A 3 pattern /etc/passwd",
      "grep -B 2 pattern /etc/passwd",
      "grep -C 4 pattern /etc/passwd",
      "grep -m 5 pattern /etc/passwd",
      "rg -C 10 pattern /etc/passwd",
    ])("collects the file operand of %s", async (command) => {
      expect(await tokensOf(command)).toEqual(["/etc/passwd"]);
    });

    it("collects the file operand past a variable-expansion argument", async () => {
      expect(await tokensOf("grep -A $N pattern /etc/passwd")).toEqual([
        "/etc/passwd",
      ]);
      expect(await tokensOf("grep -A ${N} pattern /etc/passwd")).toEqual([
        "/etc/passwd",
      ]);
    });

    it("collects the file operand past a command-substitution argument", async () => {
      expect(await tokensOf("grep -A $(echo 3) pattern /etc/passwd")).toEqual([
        "/etc/passwd",
      ]);
    });

    it("still projects the operands of a command hosted in a consumed argument", async () => {
      // The substitution really runs, so its own command is gated too (#741
      // positional invariance) — discharging the consumption must not stop the
      // walk from descending into it.
      expect(
        await tokensOf("grep -A $(cat /etc/shadow) pattern /etc/passwd"),
      ).toEqual(["/etc/shadow", "/etc/passwd"]);
    });

    it("collects a file-consuming flag's nested execution operands", async () => {
      // `-f` cannot extract a path from a substitution, but the command inside
      // it is still gated, and `-f` still marks the script supplied.
      expect(await tokensOf("grep -f $(echo x) /etc/passwd")).toEqual([
        "x",
        "/etc/passwd",
      ]);
    });

    it("collects the file operand of sd past a numeric argument", async () => {
      expect(await tokensOf("sd -n 3 find replace /etc/hosts")).toEqual([
        "/etc/hosts",
      ]);
    });

    // Quoting the substitution wraps it in a `string`, which the walker reads
    // as the flag's argument and — before #945 — never descended. The
    // unquoted cases above reach the nested command through the `!isArgNode`
    // recursion, so each pair differs only in the quotes.
    it("projects a quoted substitution's operands past a script flag", async () => {
      expect(await tokensOf('sed -e "$(cat /etc/shadow)" f.txt')).toEqual([
        "/etc/shadow",
        "f.txt",
      ]);
    });

    it("projects a quoted substitution's operands past a value flag", async () => {
      expect(
        await tokensOf('grep -A "$(cat /etc/shadow)" pattern /etc/passwd'),
      ).toEqual(["/etc/shadow", "/etc/passwd"]);
    });

    it("projects a quoted substitution's operands past a script-file flag", async () => {
      // `-f` still reads the argument's own text as a script path; the nested
      // command's operand is added beside it, not in place of it.
      expect(await tokensOf('grep -f "$(echo x)" /etc/passwd')).toEqual([
        "x",
        "$(echo x)",
        "/etc/passwd",
      ]);
    });

    it("projects a quoted substitution's operands past a declined suffix flag", async () => {
      // BSD `sed -i ''` consumes the empty suffix, so `-e` is read next and
      // its quoted argument is the one hosting the execution.
      expect(await tokensOf('sed -i "" -e "$(cat /etc/shadow)" f.txt')).toEqual(
        ["/etc/shadow", "f.txt"],
      );
    });

    it("reads nothing from a single-quoted argument, which runs nothing", async () => {
      // A raw_string cannot host a substitution, so the projection must not
      // grow here — the test that separates searching an argument's
      // executions from searching its text.
      expect(await tokensOf("grep -e '$(cat /etc/shadow)' f.txt")).toEqual([
        "f.txt",
      ]);
    });
  });

  describe("a pattern positional the parser does not type as an argument (#823)", () => {
    // The pattern slot is spent by whatever word the shell passes, whatever
    // node type tree-sitter gives it. Counting only ARG_NODE_TYPES nodes let a
    // numeric or computed pattern pass unseen, so the slot was spent on the
    // command's real operand instead and the operand reached no surface.
    it.each([
      ["a bare number", "grep 42 /etc/passwd"],
      ["a variable expansion", "grep $PATTERN /etc/passwd"],
      ["a braced expansion", "grep ${PATTERN} /etc/passwd"],
      ["an arithmetic expansion", "grep $((1 + 2)) /etc/passwd"],
      ["an ANSI-C string", "grep $'x' /etc/passwd"],
      ["a number under rg", "rg 3 /etc/passwd"],
    ])("collects the operand past %s", async (_label, command) => {
      expect(await tokensOf(command)).toEqual(["/etc/passwd"]);
    });

    it("spends both of sd's pattern positionals on numbers", async () => {
      expect(await tokensOf("sd 1 2 /etc/hosts")).toEqual(["/etc/hosts"]);
    });

    it("collects the operand past a substitution pattern, and the nested operand", async () => {
      expect(await tokensOf("grep $(cat /tmp/p) /etc/passwd")).toEqual([
        "/tmp/p",
        "/etc/passwd",
      ]);
    });

    it("does not spend the pattern slot on a redirect hosted by the command", async () => {
      // A herestring hangs off the `command` node like an argument but is a
      // redirect, so counting it would spend the pattern slot and push the real
      // pattern out as an operand token.
      expect(await tokensOf("grep <<< text pattern /etc/passwd")).toEqual([
        "/etc/passwd",
      ]);
    });
  });

  describe("an execution hosted in a quoted positional or operand (#945)", () => {
    // A quoted substitution parses as a `string`, which the walker claims as a
    // positional or an operand and reads for its text alone. The command
    // inside it really runs wherever it sits, so its operands are candidates
    // like any other position (ADR 0009's positional invariance).
    it("projects the operands of a substitution spent as the pattern", async () => {
      expect(await tokensOf('grep "$(cat /etc/shadow)" f.txt')).toEqual([
        "/etc/shadow",
        "f.txt",
      ]);
    });

    it("projects the operands of a substitution collected as an operand", async () => {
      expect(await tokensOf('grep pat "$(cat /etc/shadow)"')).toEqual([
        "/etc/shadow",
        "$(cat /etc/shadow)",
      ]);
    });
  });

  describe("an interpreter's inline script (#863)", () => {
    // `node -e "<script>"` hands the walker a program text in a flag's argument
    // slot. With the interpreter absent from PATTERN_FIRST_COMMANDS the generic
    // walker emitted it as a token, and a script opening with a `//` comment
    // then passed the classifier's leading-`/` branch.
    describe("a flag-supplied script contributes no token", () => {
      it.each([
        // The issue's own repro. tree-sitter-bash concatenates a double-quoted
        // string's per-line children, so the newlines are gone by collection.
        [
          "node -e \"\n// check which packages are installed\nconst fs = require('fs');\n\"",
        ],
        ['node -e "// x"'],
        ['node --eval "// x"'],
        ["node --eval=//x"],
        ["node --eval='// x'"],
        ["node -p '1+1'"],
        ["node --print '1+1'"],
        ['bun -e "// x"'],
        ["bun --eval '1+1'"],
        ["bun -p '1+1'"],
        ["bun --print '1+1'"],
        ['python3 -c "# c\nprint(1)"'],
        ["python -c '# c'"],
        ["perl -e '// x'"],
        ["perl -E 'say 1'"],
        ["ruby -e '# x'"],
      ])("%s yields no token", async (command) => {
        expect(await tokensOf(command)).toEqual([]);
      });
    });

    describe("a script file stays an operand", () => {
      // Zero pattern positionals is what separates an interpreter from `grep`:
      // nothing leads with an inline script, so no positional is skipped.
      it.each([
        ["node build.js /tmp/x", ["build.js", "/tmp/x"]],
        ["python3 script.py /tmp/x", ["script.py", "/tmp/x"]],
        ["ruby task.rb /tmp/x", ["task.rb", "/tmp/x"]],
      ])("%s yields both operands", async (command, expected) => {
        expect(await tokensOf(command)).toEqual(expected);
      });
    });

    describe("a flag the table does not name still over-surfaces", () => {
      // ADR 0009's recoverable direction: an unlisted flag's value becomes a
      // token that names nothing and the existence probe discards, which is
      // strictly better than claiming an arity the binary does not have.
      it("reads ruby -E as the encoding flag it is, not a script flag", async () => {
        expect(await tokensOf("ruby -E utf-8 -e 'code'")).toEqual(["utf-8"]);
      });

      it("splits an unrecognized long option's embedded value", async () => {
        expect(await tokensOf('node --input-type=module -e "// x"')).toEqual([
          "module",
        ]);
      });
    });

    describe("spellings the change does not reach", () => {
      // Pinned as current behavior, not as intent. When the issue named in each
      // comment closes, the assertion below fails and points at it.
      it("still projects a script behind a clustered flag", async () => {
        // `classifyPatternCommandFlag` reads `text.slice(0, 2)`, so `-pe` is
        // looked up as `-p` — unlisted for perl, and listing it would
        // over-list. Recorded as an ADR 0009 residual.
        expect(await tokensOf("perl -pe 's|a|b|' f.txt")).toEqual([
          "s|a|b|",
          "f.txt",
        ]);
      });
    });

    describe("the surfaces around the script are untouched", () => {
      it("still collects a redirect destination", async () => {
        expect(await pathTokensOf('node -e "x" > /tmp/out.txt')).toEqual([
          "/tmp/out.txt",
        ]);
      });

      it("still projects the operands of a script-hosted execution", async () => {
        expect(await tokensOf('node -e "$(cat /etc/shadow)"')).toEqual([
          "/etc/shadow",
        ]);
      });

      it("leaves a script-hosted execution's operand with its own attribution", async () => {
        // The interpreter rows move `node` from the generic walker to the
        // pattern-first one, so #945's attribution invariant has to be re-read
        // through the walker that now runs.
        const { node, tree } = await parseCommandNode(
          'node -e "$(cat /etc/shadow)"',
        );
        try {
          expect(collectCommandTokens(node)).toEqual([
            {
              token: "/etc/shadow",
              effect: { effect: "read", source: "core" },
            },
          ]);
        } finally {
          tree.delete();
        }
      });
    });
  });

  describe("flag spellings a pattern-first command accepts (#823)", () => {
    it.each([
      ["grep --regexp harmless /etc/passwd", ["/etc/passwd"]],
      ["grep --regexp=harmless /etc/passwd", ["/etc/passwd"]],
      ["grep -eharmless /etc/passwd", ["/etc/passwd"]],
      ["grep -e harmless /etc/passwd", ["/etc/passwd"]],
      ["sed --expression 's/a/b/' /etc/hosts", ["/etc/hosts"]],
      ["sed --expression=s/a/b/ /etc/hosts", ["/etc/hosts"]],
      ["sed -e s/a/b/ /etc/hosts", ["/etc/hosts"]],
      ["gawk --source '{print}' /etc/passwd", ["/etc/passwd"]],
    ])(
      "%s marks the script supplied and yields no pattern token",
      async (command, expected) => {
        expect(await tokensOf(command)).toEqual(expected);
      },
    );

    it.each([
      ["grep --file /tmp/patterns /etc/passwd"],
      ["grep --file=/tmp/patterns /etc/passwd"],
      ["grep -f/tmp/patterns /etc/passwd"],
      ["grep -f /tmp/patterns /etc/passwd"],
    ])("%s yields the pattern file and the operand", async (command) => {
      expect(await tokensOf(command)).toEqual(["/tmp/patterns", "/etc/passwd"]);
    });

    it.each([
      ["grep -A3 pattern /etc/passwd"],
      ["grep --after-context=3 pattern /etc/passwd"],
      ["grep --after-context 3 pattern /etc/passwd"],
      ["rg --glob '!docs' pattern /etc/passwd"],
      ["rg -g!docs pattern /etc/passwd"],
      ["rg --replace X pattern /etc/passwd"],
      ["rg -tpy pattern /etc/passwd"],
    ])(
      "%s consumes its value without supplying the script",
      async (command) => {
        expect(await tokensOf(command)).toEqual(["/etc/passwd"]);
      },
    );

    it("reads sd's -f as regex flags, not as a script file", async () => {
      // `sd -f` is `--flags`; treating it as a script file disabled sd's own
      // two-positional pattern skipping and surfaced FIND and REPLACE_WITH.
      expect(await tokensOf("sd -f i find replace /etc/hosts")).toEqual([
        "/etc/hosts",
      ]);
      expect(await tokensOf("sd --flags i find replace /etc/hosts")).toEqual([
        "/etc/hosts",
      ]);
    });

    describe("sed -i, whose argument is separate on BSD and glued on GNU", () => {
      it("consumes an empty suffix argument (the BSD idiom)", async () => {
        expect(await tokensOf("sed -i '' 's/a/b/' /etc/hosts")).toEqual([
          "/etc/hosts",
        ]);
      });

      it("declines a non-empty argument, which GNU reads as the script", async () => {
        expect(await tokensOf("sed -i 's/a/b/' /etc/hosts")).toEqual([
          "/etc/hosts",
        ]);
      });

      it("leaves a glued suffix alone", async () => {
        expect(await tokensOf("sed -i.bak 's/a/b/' /etc/hosts")).toEqual([
          "/etc/hosts",
        ]);
      });
    });

    it("reads --context per tool, since grep's is optional-argument and rg's is not", async () => {
      // grep parses with getopt, where a long option declared with an optional
      // argument never takes a separate `argv`: `grep --context 2 pattern f`
      // really searches for `2` in `pattern` and `f`, so both are operands.
      // rg parses with clap, where the same spelling consumes.
      expect(await tokensOf("grep --context 2 pattern /etc/passwd")).toEqual([
        "pattern",
        "/etc/passwd",
      ]);
      expect(await tokensOf("rg --context 2 pattern /etc/passwd")).toEqual([
        "/etc/passwd",
      ]);
      // The short form is required-argument on both.
      expect(await tokensOf("grep -C 2 pattern /etc/passwd")).toEqual([
        "/etc/passwd",
      ]);
      // Unlisted long form: the `=`-embedded value falls back to the blind
      // split and yields a bare `2` the existence probe drops.
      expect(await tokensOf("grep --context=2 pattern /etc/passwd")).toEqual([
        "2",
        "/etc/passwd",
      ]);
    });

    it("claims no arity for awk's long forms, whose parser the bare name does not fix", async () => {
      // `awk` is GNU awk on Fedora/RHEL, where `--file script.awk` reads
      // `script.awk`, and one-true-awk or mawk on macOS and Debian/Ubuntu,
      // where the long option is ignored outright and the following words are
      // the program text and its input files. Either arity drops a real
      // operand on the other family, so neither is asserted: every operand
      // survives on both, and the extra token names nothing.
      expect(
        await tokensOf("awk --field-separator 1 script.awk data.txt"),
      ).toEqual(["script.awk", "data.txt"]);
      expect(await tokensOf("nawk --assign x=1 script.awk data.txt")).toEqual([
        "x=1",
        "script.awk",
        "data.txt",
      ]);
      expect(await tokensOf("awk --file script.awk data.txt")).toEqual([
        "script.awk",
        "data.txt",
      ]);
      expect(await tokensOf("awk --source '{print}' data.txt")).toEqual([
        "{print}",
        "data.txt",
      ]);

      // `gawk` names GNU awk unambiguously, so its long forms are honored.
      expect(
        await tokensOf("gawk --field-separator , '{print}' /etc/passwd"),
      ).toEqual(["/etc/passwd"]);
      expect(await tokensOf("gawk --file /tmp/prog.awk data.txt")).toEqual([
        "/tmp/prog.awk",
        "data.txt",
      ]);
      // The short forms are POSIX and consume on every implementation.
      expect(await tokensOf("awk -F, '{print $1}' /etc/passwd")).toEqual([
        "/etc/passwd",
      ]);
      expect(await tokensOf("awk -v x=1 '{print}' /etc/passwd")).toEqual([
        "/etc/passwd",
      ]);
    });

    it("reads a quoted glued value on a recognized flag as a flag (#957)", async () => {
      // `-g'!docs'` parses as a `concatenation`, not a `word`, but the
      // directive it spells is one the table names, so it acts as the flag it
      // is and leaves the pattern positional to the pattern. The `awk -F':'`
      // instance is the one seen in the wild: its program text, led by a regex
      // delimiter, reached the `external_directory` gate as if it were an
      // absolute path, prompting for a file the command never opened.
      expect(await tokensOf("rg -g'!docs' pattern /etc/passwd")).toEqual([
        "/etc/passwd",
      ]);
      expect(await tokensOf("awk -F':' '/k/{print $2}' f.yml")).toEqual([
        "f.yml",
      ]);
      expect(await tokensOf("sed -i'.bak' 's/a/b/' f.txt")).toEqual(["f.txt"]);
      expect(await tokensOf("grep --regexp='/etc/passwd' f.txt")).toEqual([
        "f.txt",
      ]);
    });

    it("leaves a wholly quoted leading-`-` pattern its positional", async () => {
      // The narrowing's other half: `'-old'` is quoted *whole*, so it is a
      // `raw_string` rather than a concatenation of a flag and its quoted
      // value, and it goes on spending a pattern positional. Admitting every
      // `-`-leading token of any node type would read `'-new'` as `-n` and
      // shift `file.txt` out of the walk — ADR 0009's unrecoverable
      // direction, and the instance #957 names.
      expect(await tokensOf("sd '-old' '-new' file.txt")).toEqual(["file.txt"]);
      expect(await tokensOf("sd '-old' 'b' f.txt")).toEqual(["f.txt"]);
      // `-i` is a grep flag that takes no value, so the table does not list
      // it: the quoted value stays a token naming nothing, which the existence
      // probe discards.
      expect(await tokensOf("grep -i'foo' pattern f.txt")).toEqual([
        "pattern",
        "f.txt",
      ]);
    });

    it("leaves a cluster whose consuming flag is not first unrecognized", async () => {
      // Getopt reads `-ie` as `-i` then `-e`, but only the first short flag is
      // matched. The residual over-surfaces the pattern rather than dropping
      // the operand — ADR 0009's recoverable direction.
      expect(await tokensOf("grep -ie pattern /etc/passwd")).toEqual([
        "/etc/passwd",
      ]);
    });
  });
});

// ── collectCommandTokens — generic commands ───────────────────────────────────

describe("collectCommandTokens — generic commands", () => {
  async function tokensOf(cmd: string): Promise<string[]> {
    const { node, tree } = await parseCommandNode(cmd);
    try {
      return commandTokens(node);
    } finally {
      tree.delete();
    }
  }

  it("collects all argument tokens after the command name", async () => {
    expect(await tokensOf("cat /etc/hosts /etc/passwd")).toEqual([
      "/etc/hosts",
      "/etc/passwd",
    ]);
  });

  it("skips variable assignment prefixes", async () => {
    expect(await tokensOf("FOO=/bar cat /etc/hosts")).toEqual(["/etc/hosts"]);
  });

  it("collects no tokens for a bare command with no arguments", async () => {
    expect(await tokensOf("ls")).toEqual([]);
  });

  describe("a command hosted in a prefix position (#742)", () => {
    // `command_name` and `variable_assignment` are skipped as operands — the
    // head word is not one, and a prefix assignment's value is assigned rather
    // than accessed — but either can *host* a substitution that really runs,
    // whose own operands are candidates like any other position (ADR 0009).
    it("collects the operand of a substitution in command-name position", async () => {
      expect(await tokensOf("$(cat /etc/shadow)")).toEqual(["/etc/shadow"]);
    });

    it("collects the operand of a substitution in a prefix assignment", async () => {
      expect(await tokensOf("FOO=$(cat /etc/shadow) echo hi")).toEqual([
        "/etc/shadow",
        "hi",
      ]);
    });

    it("collects a prefix-hosted operand for a pattern-first command too", async () => {
      expect(await tokensOf("FOO=$(cat /etc/shadow) grep -f p x")).toEqual([
        "/etc/shadow",
        "p",
        "x",
      ]);
    });

    it("leaves a prefix assignment's literal value uncollected", async () => {
      expect(await tokensOf("FOO=/etc/shadow echo hi")).toEqual(["hi"]);
    });
  });

  describe("an execution hosted in a quoted argument (#945)", () => {
    // A generic command collects every argument's text, so a quoted
    // substitution was emitted as its own literal spelling and the command
    // inside it — which really runs — contributed nothing. Both tokens are
    // kept: the nested operand is added beside the argument's text, not in
    // place of it.
    it("projects the operands of a substitution passed as an argument", async () => {
      expect(await tokensOf('echo "$(cat /etc/shadow)"')).toEqual([
        "/etc/shadow",
        "$(cat /etc/shadow)",
      ]);
    });

    it("projects the operands of a substitution inside a concatenation", async () => {
      expect(await tokensOf('cat "prefix$(cat /etc/shadow)"')).toEqual([
        "/etc/shadow",
        "prefix$(cat /etc/shadow)",
      ]);
    });
  });
});

// ── collectRedirectTokens ─────────────────────────────────────────────────────

describe("collectRedirectTokens", () => {
  it("collects the destination path from a stdout redirect", async () => {
    const { node, tree } = await parseRedirectNode(
      "cat /etc/hosts > /tmp/out.txt",
    );
    try {
      expect(redirectTokens(node)).toEqual(["/tmp/out.txt"]);
    } finally {
      tree.delete();
    }
  });

  it("collects the destination path from an append redirect", async () => {
    const { node, tree } = await parseRedirectNode(
      "echo hello >> /tmp/log.txt",
    );
    try {
      expect(redirectTokens(node)).toEqual(["/tmp/log.txt"]);
    } finally {
      tree.delete();
    }
  });

  it("collects the source path from a stdin redirect", async () => {
    const { node, tree } = await parseRedirectNode("cat < /etc/hosts");
    try {
      expect(redirectTokens(node)).toEqual(["/etc/hosts"]);
    } finally {
      tree.delete();
    }
  });

  describe("operands of a hosted nested command (#741)", () => {
    it("collects the operand of a substitution used as the destination", async () => {
      const { node, tree } = await parseRedirectNode(
        "echo hi > $(cat /etc/shadow)",
      );
      try {
        expect(redirectTokens(node)).toEqual(["/etc/shadow"]);
      } finally {
        tree.delete();
      }
    });

    it("collects the operand of a process substitution read as input", async () => {
      const { node, tree } = await parseRedirectNode(
        "cat < <(cat /etc/shadow)",
      );
      try {
        expect(redirectTokens(node)).toEqual(["/etc/shadow"]);
      } finally {
        tree.delete();
      }
    });

    it("collects both the destination text and a concatenated operand", async () => {
      const { node, tree } = await parseRedirectNode(
        "echo hi > /tmp/$(cat /etc/shadow)",
      );
      try {
        expect(redirectTokens(node)).toEqual([
          "/tmp/$(cat /etc/shadow)",
          "/etc/shadow",
        ]);
      } finally {
        tree.delete();
      }
    });
  });
});

// ── collectPathCandidateTokens ────────────────────────────────────────────────

describe("collectPathCandidateTokens", () => {
  it("collects all argument tokens from a simple command via the program root", async () => {
    const parser = await getParser();
    const tree = parser.parse("cat /etc/hosts");
    try {
      if (!tree) throw new Error("parse returned null");
      expect(pathCandidateTokens(tree.rootNode)).toEqual(["/etc/hosts"]);
    } finally {
      tree?.delete();
    }
  });

  it("collects redirect destinations as well as command arguments", async () => {
    const parser = await getParser();
    const tree = parser.parse("cat /etc/hosts > /tmp/out.txt");
    try {
      if (!tree) throw new Error("parse returned null");
      expect(pathCandidateTokens(tree.rootNode)).toEqual([
        "/etc/hosts",
        "/tmp/out.txt",
      ]);
    } finally {
      tree?.delete();
    }
  });

  it("returns empty array for heredoc-only content (SKIP_SUBTREE_TYPES)", async () => {
    const parser = await getParser();
    const tree = parser.parse("cat <<EOF\nhello\nEOF");
    try {
      if (!tree) throw new Error("parse returned null");
      // heredoc_body is in SKIP_SUBTREE_TYPES — its text must not be collected
      const tokens = pathCandidateTokens(tree.rootNode);
      expect(tokens).not.toContain("hello");
    } finally {
      tree?.delete();
    }
  });

  describe("operands hosted in a heredoc body (#741)", () => {
    async function collectFrom(command: string): Promise<string[]> {
      const parser = await getParser();
      const tree = parser.parse(command);
      if (!tree) throw new Error("parse returned null");
      try {
        return pathCandidateTokens(tree.rootNode);
      } finally {
        tree.delete();
      }
    }

    it("collects the operand of an interpolating heredoc body", async () => {
      expect(await collectFrom("cat <<EOF\n$(cat /etc/shadow)\nEOF")).toEqual([
        "/etc/shadow",
      ]);
    });

    it.each([
      ["single-quoted", "cat <<'EOF'\n$(cat /etc/shadow)\nEOF"],
      ["double-quoted", 'cat <<"EOF"\n$(cat /etc/shadow)\nEOF'],
    ])("collects nothing from a %s heredoc body", async (_label, command) => {
      expect(await collectFrom(command)).toEqual([]);
    });

    it("never collects heredoc prose, even alongside a substitution", async () => {
      expect(
        await collectFrom(
          "cat <<EOF\n/etc/passwd is prose\n$(cat /etc/shadow)\nEOF",
        ),
      ).toEqual(["/etc/shadow"]);
    });

    it("collects the operand of a herestring substitution", async () => {
      expect(await collectFrom("cat <<< $(cat /etc/shadow)")).toEqual([
        "/etc/shadow",
      ]);
    });
  });

  it("recurses into command substitution to collect nested tokens", async () => {
    const parser = await getParser();
    const tree = parser.parse("cat $(echo /etc/hosts)");
    try {
      if (!tree) throw new Error("parse returned null");
      // The command_substitution is a non-command, non-redirect node — recurse
      const tokens = pathCandidateTokens(tree.rootNode);
      // /etc/hosts is inside the substitution, collected by recursion
      expect(tokens).toContain("/etc/hosts");
    } finally {
      tree?.delete();
    }
  });
});

// ── Statement operands (#839) ─────────────────────────────────────────────────

describe("statement operands", () => {
  async function tokensOf(command: string): Promise<PathToken[]> {
    const parser = await getParser();
    const tree = parser.parse(command);
    if (!tree) throw new Error("parse returned null");
    try {
      return collectPathCandidateTokens(tree.rootNode);
    } finally {
      tree.delete();
    }
  }

  async function textsOf(command: string): Promise<string[]> {
    return tokenTextsOf(await tokensOf(command));
  }

  describe("a for/select word list", () => {
    it("collects the operand a for loop names directly", async () => {
      expect(await textsOf("for f in /etc/shadow; do cat $f; done")).toEqual([
        "/etc/shadow",
      ]);
    });

    it("collects the operand a select statement names directly", async () => {
      // `select` parses as `for_statement`, so the two spellings are one case.
      expect(
        await textsOf("select f in /etc/shadow; do echo $f; done"),
      ).toEqual(["/etc/shadow"]);
    });

    it("collects every operand of a multi-entry word list, in source order", async () => {
      expect(await textsOf("for f in /tmp/a /tmp/b; do echo; done")).toEqual([
        "/tmp/a",
        "/tmp/b",
      ]);
    });

    it("removes quotes from a quoted operand", async () => {
      expect(await textsOf('for f in "/etc/shadow"; do echo; done')).toEqual([
        "/etc/shadow",
      ]);
    });

    it("leaves the loop variable uncollected", async () => {
      // `f` is the name being bound, not a path the loop touches; a walker
      // reading every child on the operand side would emit it. Asserted as a
      // whole list rather than an absence, so the claim fails if `f` appears.
      expect(await textsOf("for f in /etc/shadow; do echo; done")).toEqual([
        "/etc/shadow",
      ]);
    });

    it("still collects the loop body's own operands", async () => {
      // The non-operand side falls through to the ordinary recursion, so the
      // `do_group` reaches its commands exactly as before.
      expect(await textsOf("for f in a; do cat /etc/shadow; done")).toEqual([
        "a",
        "/etc/shadow",
      ]);
    });

    it("collects nothing new from a word-list-less for loop", async () => {
      // `for f; do …; done` iterates "$@"; there is no `in` and no word list.
      expect(await textsOf("for f; do cat /etc/shadow; done")).toEqual([
        "/etc/shadow",
      ]);
    });

    it("descends a substitution in the word list rather than reading its text", async () => {
      expect(
        await textsOf("for f in $(cat /etc/shadow); do echo $f; done"),
      ).toEqual(["/etc/shadow"]);
    });

    it("attributes an operand no command owns as unproven", async () => {
      expect(await tokensOf("for f in /etc/shadow; do echo; done")).toEqual([
        { token: "/etc/shadow", effect: UNPROVEN_EFFECT },
      ]);
    });

    it("leaves a nested command's operand with its own attribution", async () => {
      // The statement proves nothing, but `cat` proves a read for its own
      // operand — the enclosing statement must not overwrite it (#807).
      expect(
        await tokensOf("for f in $(cat /etc/shadow); do echo; done"),
      ).toEqual([
        { token: "/etc/shadow", effect: { effect: "read", source: "core" } },
      ]);
    });
  });

  describe("a case subject", () => {
    // Most arms below run `true`, which takes no operand, so each assertion
    // sees the subject and nothing the arms contribute.
    it("collects the subject a case statement names directly", async () => {
      expect(await textsOf("case /etc/shadow in a) true;; esac")).toEqual([
        "/etc/shadow",
      ]);
    });

    it("removes quotes from a quoted subject", async () => {
      expect(await textsOf('case "/etc/shadow" in a) true;; esac')).toEqual([
        "/etc/shadow",
      ]);
    });

    it("leaves an arm's pattern uncollected", async () => {
      // A `case` pattern is a glob matched against the subject string, not a
      // path anything touches — so the subject side of `in` is the operand
      // side, and the arms are recursed for their commands alone.
      expect(await textsOf("case $x in /etc/passwd) true;; esac")).toEqual([]);
    });

    it("still collects an arm's own command operands", async () => {
      expect(await textsOf("case $x in a) cat /etc/shadow;; esac")).toEqual([
        "/etc/shadow",
      ]);
    });

    it("attributes a subject no command owns as unproven", async () => {
      expect(await tokensOf("case /etc/shadow in a) true;; esac")).toEqual([
        { token: "/etc/shadow", effect: UNPROVEN_EFFECT },
      ]);
    });

    it("descends a substitution in the subject rather than reading its text", async () => {
      expect(
        await tokensOf("case $(cat /etc/shadow) in a) true;; esac"),
      ).toEqual([
        { token: "/etc/shadow", effect: { effect: "read", source: "core" } },
      ]);
    });
  });
});

describe("embedded --opt=value extraction (#645)", () => {
  async function tokensOf(cmd: string): Promise<string[]> {
    const { node, tree } = await parseCommandNode(cmd);
    try {
      return commandTokens(node);
    } finally {
      tree.delete();
    }
  }

  it("emits the value of a long option carrying an inline path", async () => {
    // The issue's second repro: the flag token itself is rejected by the
    // shape prelude, so the embedded path had to be split out to be seen.
    expect(await tokensOf("grep --file=/tmp/patterns target")).toContain(
      "/tmp/patterns",
    );
  });

  it("emits the embedded value for a non-pattern-first command too", async () => {
    expect(await tokensOf("tar --directory=/etc -xf a.tar")).toContain("/etc");
  });

  it("preserves the original flag token", async () => {
    expect(await tokensOf("cat --file=/tmp/x")).toContain("--file=/tmp/x");
  });

  it("emits a bare value, leaving it for the shape gates to drop", async () => {
    // --format=json yields "json", which names nothing and is dropped later.
    expect(await tokensOf("cat --format=json")).toContain("json");
  });

  it("splits the single-dash form", async () => {
    expect(await tokensOf("cat -o=/tmp/out")).toContain("/tmp/out");
  });

  it("does not split a flag with no value", async () => {
    const tokens = await tokensOf("grep --recursive target");
    expect(tokens).not.toContain("");
    expect(tokens).not.toContain("--recursive");
  });

  it("does not split a non-flag token containing '='", async () => {
    // FOO=bar is a variable_assignment, never an argument token.
    expect(await tokensOf("cat a=b")).toEqual(["a=b"]);
  });

  it("keeps only the first '=' as the separator", async () => {
    expect(await tokensOf("cat --opt=/tmp/a=b")).toContain("/tmp/a=b");
  });

  describe("a pattern-first command's own flags are not split blindly (#823)", () => {
    it("suppresses a recognized pattern flag's embedded value", async () => {
      // `--regexp=` is grep's long form of `-e`, and `--expression=` is sed's:
      // neither names a file, so neither value is a path candidate. The split
      // is the pattern-first walker's own, so it knows the flag's role.
      expect(
        await tokensOf("grep --regexp=/etc/passwd file.txt"),
      ).not.toContain("/etc/passwd");
      expect(
        await tokensOf("sed --expression=/etc/shadow file.txt"),
      ).not.toContain("/etc/shadow");
    });

    it("suppresses the same pattern in its short-flag form", async () => {
      expect(await tokensOf("grep -e /etc/passwd file.txt")).not.toContain(
        "/etc/passwd",
      );
    });

    it("still splits an unrecognized option's embedded value", async () => {
      // The #645 contract survives for a flag the table does not name: the
      // value is emitted and left to the ordinary shape gates.
      expect(
        await tokensOf("grep --exclude-dir=/etc/skel pattern f"),
      ).toContain("/etc/skel");
    });
  });
});

// ── extractCommandWord ─────────────────────────────────────────────────

describe("extractCommandWord", () => {
  it("returns a bare head word unchanged", async () => {
    const { node, tree } = await parseCommandNode("grep pattern file.txt");
    try {
      expect(extractCommandWord(node)).toBe("grep");
    } finally {
      tree.delete();
    }
  });

  it.each(["/usr/bin/grep", "./grep", "../bin/grep"])(
    "keeps the directory prefix of %s, which extractCommandName strips",
    async (headWord) => {
      const { node, tree } = await parseCommandNode(`${headWord} p file.txt`);
      try {
        expect(extractCommandWord(node)).toBe(headWord);
        expect(extractCommandName(node)).toBe("grep");
      } finally {
        tree.delete();
      }
    },
  );
});

// ── Per-token effect attribution (#807) ───────────────────────────────────

describe("effect attribution", () => {
  async function attributedTokens(command: string): Promise<PathToken[]> {
    const parser = await getParser();
    const tree = parser.parse(command);
    if (!tree) throw new Error("parse returned null");
    try {
      return collectPathCandidateTokens(tree.rootNode);
    } finally {
      tree.delete();
    }
  }

  it("attributes a core word's read to every token it owns", async () => {
    expect(await attributedTokens("cat /etc/hosts /etc/passwd")).toEqual([
      { token: "/etc/hosts", effect: { effect: "read", source: "core" } },
      { token: "/etc/passwd", effect: { effect: "read", source: "core" } },
    ]);
  });

  it("attributes a pattern-first command's read to its file arguments", async () => {
    expect(await attributedTokens("grep needle /etc/hosts")).toEqual([
      { token: "/etc/hosts", effect: { effect: "read", source: "core" } },
    ]);
  });

  it("attributes a core word's read to an embedded option value", async () => {
    // `--file=` supplies the script, so `target` is a file operand rather than
    // the inline pattern (#823); both carry grep's proven read.
    expect(await attributedTokens("grep --file=/tmp/patterns target")).toEqual([
      { token: "/tmp/patterns", effect: { effect: "read", source: "core" } },
      { token: "target", effect: { effect: "read", source: "core" } },
    ]);
  });

  it("proves nothing for a command outside the core", async () => {
    expect(await attributedTokens("pnpm test /etc/hosts")).toEqual([
      { token: "test", effect: UNPROVEN_EFFECT },
      { token: "/etc/hosts", effect: UNPROVEN_EFFECT },
    ]);
  });

  it("proves nothing for a path-qualified core word", async () => {
    expect(await attributedTokens("/tmp/evil/cat /etc/hosts")).toEqual([
      { token: "/etc/hosts", effect: UNPROVEN_EFFECT },
    ]);
  });

  it("retracts a guarded word's claim when an option withdraws it", async () => {
    const retracted = { effect: "unproven", source: "retracted" };
    expect(await attributedTokens("find /etc -delete")).toEqual([
      { token: "/etc", effect: retracted },
      { token: "-delete", effect: retracted },
    ]);
  });

  it("proves a write for an output redirect destination", async () => {
    expect(await attributedTokens("cat /etc/hosts > /tmp/out.txt")).toEqual([
      { token: "/etc/hosts", effect: { effect: "read", source: "core" } },
      { token: "/tmp/out.txt", effect: { effect: "write", source: "syntax" } },
    ]);
  });

  it("proves a write for an append redirect even under a core reader", async () => {
    expect(await attributedTokens("echo hi >> /tmp/log.txt")).toEqual([
      { token: "hi", effect: { effect: "read", source: "core" } },
      { token: "/tmp/log.txt", effect: { effect: "write", source: "syntax" } },
    ]);
  });

  it("proves a read for an input redirect destination", async () => {
    expect(await attributedTokens("pnpm x < /tmp/in.txt")).toEqual([
      { token: "x", effect: UNPROVEN_EFFECT },
      { token: "/tmp/in.txt", effect: { effect: "read", source: "syntax" } },
    ]);
  });

  it("collects no token for a file-descriptor duplication", async () => {
    expect(await attributedTokens("pnpm x 2>&1")).toEqual([
      { token: "x", effect: UNPROVEN_EFFECT },
    ]);
  });

  it("gives a nested execution's tokens their own command's attribution", async () => {
    expect(await attributedTokens("pnpm x > $(cat /etc/shadow)")).toEqual([
      { token: "x", effect: UNPROVEN_EFFECT },
      { token: "/etc/shadow", effect: { effect: "read", source: "core" } },
    ]);
  });

  it("gives an argument-hosted execution's tokens their own attribution", async () => {
    // `sed` is outside the pure-reader core and `cat` is in it, so the two
    // tokens must disagree — a token that inherited the enclosing command's
    // proof would read unproven here (#945).
    expect(await attributedTokens('sed -e "$(cat /etc/shadow)" f.txt')).toEqual(
      [
        { token: "/etc/shadow", effect: { effect: "read", source: "core" } },
        { token: "f.txt", effect: UNPROVEN_EFFECT },
      ],
    );
  });

  it("attributes each unit of a pipeline separately", async () => {
    expect(await attributedTokens("cat /etc/hosts | tee /tmp/copy")).toEqual([
      { token: "/etc/hosts", effect: { effect: "read", source: "core" } },
      { token: "/tmp/copy", effect: UNPROVEN_EFFECT },
    ]);
  });

  describe("a redirect the parser could not resolve (#814)", () => {
    // The gates consume the collector, not the analyzer, so the destination of
    // a read-write open has to arrive here unproven — whichever way the parse
    // happened to split the operator.
    it("proves nothing for a bare destination", async () => {
      expect(await attributedTokens("cat <> rw.txt")).toEqual([
        { token: "rw.txt", effect: UNPROVEN_EFFECT },
      ]);
    });

    it("proves nothing for a home-relative destination", async () => {
      expect(await attributedTokens("cat <> ~/rw.txt")).toEqual([
        { token: "~/rw.txt", effect: UNPROVEN_EFFECT },
      ]);
    });
  });
});
