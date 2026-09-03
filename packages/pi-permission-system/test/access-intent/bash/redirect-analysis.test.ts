import { describe, expect, it } from "vitest";
import { ARG_NODE_TYPES } from "#src/access-intent/bash/node-text";
import { getParser, type TSNode } from "#src/access-intent/bash/parser";
import {
  redirectEffectForDestination,
  redirectMayWriteFile,
} from "#src/access-intent/bash/redirect-analysis";
import type { TokenEffect } from "#src/access-intent/effect";

// ── Helpers ───────────────────────────────────────────────────────────────────

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
 * Parse a bash snippet and hand `read` every redirect node of `type` it holds.
 *
 * A command can carry several, and an unresolvable one does not contaminate a
 * resolvable neighbour — so a test asserting that needs the whole list from one
 * parse, not the first match.
 */
async function withRedirects<T>(
  command: string,
  type: string,
  read: (redirects: TSNode[]) => T,
): Promise<T> {
  const parser = await getParser();
  const tree = parser.parse(command);
  if (!tree) throw new Error("parser.parse returned null");
  try {
    return read(findNodes(tree.rootNode, type));
  } finally {
    tree.delete();
  }
}

/** Parse a bash snippet and hand its first redirect node to `read`. */
function withRedirect<T>(
  command: string,
  type: string,
  read: (redirect: TSNode) => T,
): Promise<T> {
  return withRedirects(command, type, (redirects) => {
    if (redirects.length === 0) {
      throw new Error(`no ${type} node found in: ${command}`);
    }
    return read(redirects[0]);
  });
}

/** The effect proved for a redirect's first argument-shaped destination. */
function effectForFirstDestination(redirect: TSNode): TokenEffect | null {
  for (let i = 0; i < redirect.childCount; i++) {
    const child = redirect.child(i);
    if (child && ARG_NODE_TYPES.has(child.type)) {
      return redirectEffectForDestination(redirect, child);
    }
  }
  return null;
}

/** The effect a redirect proves for the destination it names. */
function destinationEffect(
  command: string,
  type = "file_redirect",
): Promise<TokenEffect | null> {
  return withRedirect(command, type, effectForFirstDestination);
}

/** The effect each of a command's redirects proves, in source order. */
function allDestinationEffects(
  command: string,
): Promise<(TokenEffect | null)[]> {
  return withRedirects(command, "file_redirect", (redirects) =>
    redirects.map(effectForFirstDestination),
  );
}

/**
 * Destination node types naming a file descriptor rather than a file.
 *
 * Transcribed from `redirect-analysis.ts`'s private set, because neither
 * production caller ever hands one of these to `redirectEffectForDestination`
 * — both filter to {@link ARG_NODE_TYPES} first — so only a direct call reaches
 * the branch that answers for them.
 */
const DESCRIPTOR_NODE_TYPES: ReadonlySet<string> = new Set([
  "file_descriptor",
  "number",
]);

/** The effect a redirect proves for the descriptor it names, not a file. */
function descriptorDestinationEffect(
  command: string,
): Promise<TokenEffect | null> {
  return withRedirect(command, "file_redirect", (redirect) => {
    for (let i = 0; i < redirect.childCount; i++) {
      const child = redirect.child(i);
      if (child && DESCRIPTOR_NODE_TYPES.has(child.type)) {
        return redirectEffectForDestination(redirect, child);
      }
    }
    throw new Error(`no descriptor destination in: ${command}`);
  });
}

/** Whether a redirect fails to prove it only reads. */
function mayWrite(command: string, type = "file_redirect"): Promise<boolean> {
  return withRedirect(command, type, redirectMayWriteFile);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("redirectEffectForDestination", () => {
  describe("output operators", () => {
    it.each([
      ["cat a > out.txt", ">"],
      ["cat a >> out.txt", ">>"],
      ["cat a >| out.txt", ">|"],
      ["cat a &> out.txt", "&>"],
      ["cat a &>> out.txt", "&>>"],
    ])("proves a write for %s (%s)", async (command) => {
      await expect(destinationEffect(command)).resolves.toEqual({
        effect: "write",
        source: "syntax",
      });
    });
  });

  describe("input operators", () => {
    it("proves a read for a stdin redirect", async () => {
      await expect(destinationEffect("cat < in.txt")).resolves.toEqual({
        effect: "read",
        source: "syntax",
      });
    });

    it("proves a read for a herestring", async () => {
      await expect(
        destinationEffect("cat <<< in.txt", "herestring_redirect"),
      ).resolves.toEqual({ effect: "read", source: "syntax" });
    });
  });

  describe("descriptor-capable operators", () => {
    it("names no file at all when the destination is a descriptor", async () => {
      await expect(destinationEffect("pnpm x 2>&1")).resolves.toBeNull();
    });

    it("proves a write when >& names a real file", async () => {
      await expect(destinationEffect("pnpm x >& out.txt")).resolves.toEqual({
        effect: "write",
        source: "syntax",
      });
    });

    it("proves a read when <& names a real file", async () => {
      await expect(destinationEffect("pnpm x <& in.txt")).resolves.toEqual({
        effect: "read",
        source: "syntax",
      });
    });
  });

  describe("a redirect the parser could not resolve", () => {
    // tree-sitter-bash has no node for the read-write open `<>`; it degrades to
    // an `ERROR` whose placement depends on the destination's shape, so the
    // operator that survives is a function of the filename. Reading a proof off
    // that operator produced two different answers for one command, one of them
    // a bare read for a destination the shell may truncate.
    it.each([
      "cat <> rw.txt",
      "cat <> ~/rw.txt",
      "cat 3<> rw.txt",
      "cat 0<> ~/y",
    ])("proves nothing for %s", async (command) => {
      await expect(destinationEffect(command)).resolves.toEqual({
        effect: "unproven",
        source: "unproven",
      });
    });

    it("proves the same effect however the destination is spelled", async () => {
      const [bare, tilde] = await Promise.all([
        destinationEffect("cat <> rw.txt"),
        destinationEffect("cat <> ~/rw.txt"),
      ]);
      expect(bare).toEqual(tilde);
    });

    it("still names no file at all when the destination is a descriptor", async () => {
      // Failing to resolve the operator is a reason to withhold a *proof*, not
      // a reason to invent a path: a descriptor names no file whatever the
      // syntax around it did. Answering `unproven` here would emit the bare
      // `1` of `<>&1` as a path candidate.
      await expect(descriptorDestinationEffect("cat <>&1")).resolves.toBeNull();
    });
  });

  describe("a command mixing resolved and unresolved redirects", () => {
    // An unresolvable redirect must not contaminate a resolvable neighbour in
    // either direction: the `> out.txt` and `> b.txt` below really are writes,
    // and forfeiting their proofs would cost gates the parse did establish.
    it("keeps the proof of a resolvable redirect before it", async () => {
      // Three sibling `file_redirect` nodes: the genuine `> out.txt`, the
      // stranded `<` (recovered with a zero-width destination of its own), and
      // the `> ~/rw.txt` it was meant to pair with.
      await expect(
        allDestinationEffects("cat a > out.txt <> ~/rw.txt"),
      ).resolves.toEqual([
        { effect: "write", source: "syntax" },
        { effect: "unproven", source: "unproven" },
        { effect: "unproven", source: "unproven" },
      ]);
    });

    it("keeps the proof of a resolvable redirect after it", async () => {
      await expect(
        allDestinationEffects("cat <> ~/a.txt > b.txt"),
      ).resolves.toEqual([
        { effect: "unproven", source: "unproven" },
        { effect: "write", source: "syntax" },
      ]);
    });
  });
});

describe("redirectMayWriteFile", () => {
  describe("a redirect that writes", () => {
    it.each([
      "cat a > out.txt",
      "cat a >> out.txt",
      "cat a &> out.txt",
      "pnpm x 2> err.log",
      "pnpm x >& out.txt",
    ])("answers true for %s", async (command) => {
      await expect(mayWrite(command)).resolves.toBe(true);
    });

    it("does not read a file descriptor source as a destination", async () => {
      // `2` is the redirected descriptor and `err.log` the destination; a reader
      // that stopped at the first named child would clear this wrongly.
      await expect(mayWrite("pnpm x 2> err.log")).resolves.toBe(true);
    });
  });

  describe("a redirect that provably only reads", () => {
    it.each(["cat < in.txt", "pnpm x 2>&1", "pnpm x <& in.txt"])(
      "answers false for %s",
      async (command) => {
        await expect(mayWrite(command)).resolves.toBe(false);
      },
    );
  });

  describe("a destination the parse cannot resolve", () => {
    // The answer is a refusal, not the negation of a write proof. These name a
    // file chosen at run time, so the parse says nothing about which — and the
    // caller is deciding whether to remove a guard.
    it.each([
      ["cat a > $OUT", "an unquoted variable"],
      ["cat a >${OUT}", "a brace expansion"],
      ["cat a > $(mktemp)", "a command substitution"],
      ["cat a > ${DIR}/log", "an expansion concatenated with a literal"],
      ["cat <> rw.txt", "a read-write open the grammar could not parse"],
      ["cat <> ~/rw.txt", "a read-write open whose halves the parse split"],
      ["cat <>&1", "a read-write open naming no argument-shaped destination"],
    ])("answers true for %s (%s)", async (command) => {
      await expect(mayWrite(command)).resolves.toBe(true);
    });
  });
});
