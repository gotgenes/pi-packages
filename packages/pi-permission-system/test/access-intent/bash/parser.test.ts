import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  getParser,
  getWarmBashParser,
  parseUnresolvedAt,
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
