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

/** Parse a bash snippet and return the first `command` node. */
async function parseCommandNode(cmd: string): Promise<{
  node: TSNode;
  tree: { rootNode: TSNode; delete(): void };
}> {
  const parser = await getParser();
  const tree = parser.parse(cmd);
  if (!tree) throw new Error("parser.parse returned null");
  const node = findNode(tree.rootNode, "command");
  if (!node) throw new Error(`no command node found in: ${cmd}`);
  return { node, tree };
}

/** Parse a bash snippet and return the first `file_redirect` node. */
async function parseRedirectNode(cmd: string): Promise<{
  node: TSNode;
  tree: { rootNode: TSNode; delete(): void };
}> {
  const parser = await getParser();
  const tree = parser.parse(cmd);
  if (!tree) throw new Error("parser.parse returned null");
  const node = findNode(tree.rootNode, "file_redirect");
  if (!node) throw new Error(`no file_redirect node found in: ${cmd}`);
  return { node, tree };
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
    async function tokensOf(cmd: string): Promise<string[]> {
      const { node, tree } = await parseCommandNode(cmd);
      try {
        return commandTokens(node);
      } finally {
        tree.delete();
      }
    }

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
  });
});

// ── collectCommandTokens — generic commands ───────────────────────────────────

describe("collectCommandTokens — generic commands", () => {
  it("collects all argument tokens after the command name", async () => {
    const { node, tree } = await parseCommandNode("cat /etc/hosts /etc/passwd");
    try {
      expect(commandTokens(node)).toEqual(["/etc/hosts", "/etc/passwd"]);
    } finally {
      tree.delete();
    }
  });

  it("skips variable assignment prefixes", async () => {
    const { node, tree } = await parseCommandNode("FOO=/bar cat /etc/hosts");
    try {
      expect(commandTokens(node)).toEqual(["/etc/hosts"]);
    } finally {
      tree.delete();
    }
  });

  it("collects no tokens for a bare command with no arguments", async () => {
    const { node, tree } = await parseCommandNode("ls");
    try {
      expect(commandTokens(node)).toEqual([]);
    } finally {
      tree.delete();
    }
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

  describe("long-form flags of a pattern-first command — accepted residual (#823)", () => {
    it("emits a pattern-first command's embedded pattern value", async () => {
      // `--regexp=` is grep's long form of `-e`, and `--expression=` is sed's:
      // neither names a file. The split runs ahead of the pattern-first walker
      // and knows nothing of `argConsumingFlags`, so the pattern is emitted as
      // an ordinary token and classified like any other value. Pinned as the
      // current behavior, not endorsed — the fix is #823, and ADR 0009 records
      // it as a residual.
      expect(await tokensOf("grep --regexp=/etc/passwd file.txt")).toContain(
        "/etc/passwd",
      );
      expect(await tokensOf("sed --expression=/etc/shadow file.txt")).toContain(
        "/etc/shadow",
      );
    });

    it("suppresses the same pattern in its short-flag form", async () => {
      // The contrast that makes the residual precise: `-e /etc/passwd` is a
      // consumed argument the pattern-first walker skips, so only the
      // `=`-embedded spelling escapes.
      expect(await tokensOf("grep -e /etc/passwd file.txt")).not.toContain(
        "/etc/passwd",
      );
    });

    it("drops the real file operand behind an unrecognized long flag", async () => {
      // The severe half of the same root cause: `--regexp=` never sets
      // `hasExplicitScript`, so the walker still expects an inline pattern and
      // eats `/etc/passwd` as that positional — a fail-open the path surfaces
      // never see. Pinned as current behavior; the fix is #823.
      expect(
        await tokensOf("grep --regexp=harmless /etc/passwd"),
      ).not.toContain("/etc/passwd");
      expect(
        await tokensOf("sed --expression=s/a/b/ /etc/hosts"),
      ).not.toContain("/etc/hosts");
    });

    it("drops the real file operand behind a glued short flag", async () => {
      // `-epattern` is valid getopt syntax that fails the set's exact match.
      expect(await tokensOf("grep -epattern /etc/passwd")).not.toContain(
        "/etc/passwd",
      );
    });

    it("keeps the operand for every spelling the walker does track", async () => {
      expect(await tokensOf("grep -e harmless /etc/passwd")).toContain(
        "/etc/passwd",
      );
      expect(await tokensOf("sed -e s/a/b/ /etc/hosts")).toContain(
        "/etc/hosts",
      );
      // Glued numeric argument: one token, so no consumption is pending.
      expect(await tokensOf("grep -A3 pattern /etc/passwd")).toContain(
        "/etc/passwd",
      );
      // Space-separated long form of an arg-consuming flag: unrecognized, so
      // the following word is skipped as the inline positional anyway and the
      // operand survives. Pinned so a #823 fix does not regress it.
      expect(await tokensOf("grep --regexp harmless /etc/passwd")).toContain(
        "/etc/passwd",
      );
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

  it.each([
    "/usr/bin/grep",
    "./grep",
    "../bin/grep",
  ])("keeps the directory prefix of %s, which extractCommandName strips", async (headWord) => {
    const { node, tree } = await parseCommandNode(`${headWord} p file.txt`);
    try {
      expect(extractCommandWord(node)).toBe(headWord);
      expect(extractCommandName(node)).toBe("grep");
    } finally {
      tree.delete();
    }
  });
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
    expect(await attributedTokens("grep --file=/tmp/patterns target")).toEqual([
      { token: "/tmp/patterns", effect: { effect: "read", source: "core" } },
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

  it("attributes each unit of a pipeline separately", async () => {
    expect(await attributedTokens("cat /etc/hosts | tee /tmp/copy")).toEqual([
      { token: "/etc/hosts", effect: { effect: "read", source: "core" } },
      { token: "/tmp/copy", effect: UNPROVEN_EFFECT },
    ]);
  });
});
