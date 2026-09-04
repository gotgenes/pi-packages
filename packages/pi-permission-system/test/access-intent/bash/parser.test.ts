import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getParser,
  getWarmBashParser,
  parseUnresolvedAt,
  parseUnresolvedWithin,
  resetWarmBashParser,
  type TSNode,
  warmBashParser,
} from "#src/access-intent/bash/parser";

describe("getParser", () => {
  it("parses a simple bash command and returns a non-null root node", async () => {
    const parser = await getParser();
    const tree = parser.parse("echo hi");
    expect(tree).not.toBeNull();
    expect(tree?.rootNode).toBeDefined();
    expect(tree?.rootNode.type).toBe("program");
    tree?.delete();
  });

  it("returns the same memoized parser instance on repeated calls", async () => {
    const first = await getParser();
    const second = await getParser();
    expect(first).toBe(second);
  });
});

describe("warm parser", () => {
  beforeEach(() => {
    resetWarmBashParser();
  });
  afterEach(() => {
    resetWarmBashParser();
  });

  it("returns null before the parser is warmed", () => {
    expect(getWarmBashParser()).toBeNull();
  });

  it("exposes the parser synchronously after warm-up", async () => {
    await warmBashParser();
    const parser = getWarmBashParser();
    expect(parser).not.toBeNull();
    const tree = parser?.parse("echo hi");
    expect(tree?.rootNode.type).toBe("program");
    tree?.delete();
  });

  it("hands out the same memoized parser as getParser", async () => {
    await warmBashParser();
    expect(getWarmBashParser()).toBe(await getParser());
  });

  it("resetWarmBashParser clears the cached parser", async () => {
    await warmBashParser();
    expect(getWarmBashParser()).not.toBeNull();
    resetWarmBashParser();
    expect(getWarmBashParser()).toBeNull();
  });
});

// ── parseUnresolvedAt ────────────────────────────────────────────────

/** Depth-first collection of every node of the given type, in source order. */
function findNodes(node: TSNode, type: string, out: TSNode[] = []): TSNode[] {
  if (node.type === type) out.push(node);
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) findNodes(child, type, out);
  }
  return out;
}

/**
 * `parseUnresolvedAt` applied to each `file_redirect` a command carries.
 *
 * The subject is the shape tree-sitter really produces for these commands, so
 * the fixtures are parsed rather than fabricated — the whole point is where
 * error recovery puts the text it could not attach.
 */
async function unresolvedRedirects(command: string): Promise<boolean[]> {
  const parser = await getParser();
  const tree = parser.parse(command);
  if (!tree) throw new Error("parser.parse returned null");
  try {
    return findNodes(tree.rootNode, "file_redirect").map(parseUnresolvedAt);
  } finally {
    tree.delete();
  }
}

describe("parseUnresolvedAt", () => {
  describe("a node tree-sitter could not resolve", () => {
    it("answers true when the discarded text is inside the node", async () => {
      // `<>` has no node in the grammar; here the `>` half is recovered as an
      // `ERROR` child of the redirect itself.
      await expect(unresolvedRedirects("cat <> rw.txt")).resolves.toEqual([
        true,
      ]);
    });

    it("answers true when the discarded text is the preceding sibling", async () => {
      // Same command, tilde destination: the `<` half is recovered as an
      // `ERROR` *before* an otherwise clean `file_redirect "> ~/rw.txt"`, so
      // nothing inside that node distinguishes it from a genuine write.
      await expect(unresolvedRedirects("cat <> ~/rw.txt")).resolves.toEqual([
        true,
      ]);
    });

    it.each(["cat 3<> rw.txt", "cat 0<> ~/y", "cat <>&1"])(
      "answers true for %s",
      async (command) => {
        await expect(unresolvedRedirects(command)).resolves.toContain(true);
      },
    );

    it.each(["cat $(( > out.txt", "echo ) > out.txt"])(
      "answers true for %s, whose redirect is itself well-formed",
      async (command) => {
        // The question is about the parse, not about `<>`. A redirect preceded
        // by an unrelated recovery failure loses its proof too — the accepted
        // cost, pinned here so the wider population is deliberate rather than
        // incidental. Over-refusing costs a prompt; under-refusing hands a
        // write to a read grant.
        await expect(unresolvedRedirects(command)).resolves.toEqual([true]);
      },
    );
  });

  describe("a node tree-sitter resolved", () => {
    it.each([
      "cat a > out.txt",
      "cat < in.txt",
      "pnpm x 2>&1",
      "pnpm x >& out.txt",
      "cat a > $(mktemp)",
      "foo; cat a > out.txt",
    ])("answers false for %s", async (command) => {
      await expect(unresolvedRedirects(command)).resolves.toEqual([false]);
    });
  });

  describe("a command mixing resolved and unresolved redirects", () => {
    it("answers per redirect rather than per statement", async () => {
      // Three sibling `file_redirect` nodes: the genuine `> out.txt`, the
      // stranded `<`, and the `> ~/rw.txt` the `<` was meant to pair with. A
      // statement-wide rule would condemn the first, which really is a write.
      await expect(
        unresolvedRedirects("cat a > out.txt <> ~/rw.txt"),
      ).resolves.toEqual([false, true, true]);
    });

    it("leaves a resolvable redirect after an unresolvable one proven", async () => {
      await expect(
        unresolvedRedirects("cat <> ~/a.txt > b.txt"),
      ).resolves.toEqual([true, false]);
    });
  });
});

// ── parseUnresolvedWithin ────────────────────────────────────────────

/** `parseUnresolvedWithin` applied to each `type` node a command produces. */
async function unresolvedWithin(
  command: string,
  type: string,
): Promise<boolean[]> {
  const parser = await getParser();
  const tree = parser.parse(command);
  if (!tree) throw new Error("parser.parse returned null");
  try {
    return findNodes(tree.rootNode, type).map(parseUnresolvedWithin);
  } finally {
    tree.delete();
  }
}

describe("parseUnresolvedWithin", () => {
  describe("a node whose own subtree carries the failure", () => {
    it("answers true when the discarded text is inside the node", async () => {
      // `<>` has no node in the grammar; the `>` half is recovered as an
      // `ERROR` child of the redirect itself.
      await expect(
        unresolvedWithin("cat <> rw.txt", "file_redirect"),
      ).resolves.toEqual([true]);
    });

    it("answers true for a statement whose failure is several levels down", async () => {
      // The `ERROR` sits under `heredoc_redirect → file_redirect`; the
      // statement is what a walker descending statements can see it through.
      await expect(
        unresolvedWithin(
          "git commit -F - <<'MSG' 2>&1 | tail -4\nmsg\nMSG",
          "redirected_statement",
        ),
      ).resolves.toEqual([true]);
    });
  });

  describe("a node whose predecessor carried the failure", () => {
    it("answers false where parseUnresolvedAt answers true", async () => {
      // The one case that separates the two predicates. Here the `<` half is
      // recovered as an `ERROR` *before* an otherwise clean
      // `file_redirect "> ~/rw.txt"`. A redirect must refuse on that, because
      // error recovery strands the discarded operator ahead of the node it
      // belonged to — but a statement whose predecessor failed is not itself
      // unparsed, so the subtree-only question is the one a walker asks.
      await expect(
        unresolvedWithin("cat <> ~/rw.txt", "file_redirect"),
      ).resolves.toEqual([false]);
      await expect(unresolvedRedirects("cat <> ~/rw.txt")).resolves.toEqual([
        true,
      ]);
    });
  });

  describe("a fully resolved parse", () => {
    it.each(["cat a > out.txt", "cd /repo && git push", "echo hi | tail -2"])(
      "answers false at every level of %s",
      async (command) => {
        await expect(unresolvedWithin(command, "program")).resolves.toEqual([
          false,
        ]);
        await expect(
          unresolvedWithin(command, "command"),
        ).resolves.not.toContain(true);
      },
    );
  });

  describe("the root of a partially failed parse", () => {
    it("answers true for the program node however local the failure", async () => {
      // Why a walker cannot ask this of `program`, `list`, or `pipeline`: the
      // answer is true whenever anything anywhere failed, so marking there
      // would mark every unit of the command.
      await expect(
        unresolvedWithin(
          "echo hi > out.txt <> rw.txt; rm -rf /tmp/y",
          "program",
        ),
      ).resolves.toEqual([true]);
    });
  });
});
