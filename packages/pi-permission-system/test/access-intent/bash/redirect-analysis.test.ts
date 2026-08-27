import { describe, expect, it } from "vitest";
import { ARG_NODE_TYPES } from "#src/access-intent/bash/node-text";
import { getParser, type TSNode } from "#src/access-intent/bash/parser";
import {
  redirectEffectForDestination,
  redirectMayWriteFile,
} from "#src/access-intent/bash/redirect-analysis";
import type { TokenEffect } from "#src/access-intent/effect";

// ── Helpers ───────────────────────────────────────────────────────────────────

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

/** Parse a bash snippet and hand its first redirect node to `read`. */
async function withRedirect<T>(
  command: string,
  type: string,
  read: (redirect: TSNode) => T,
): Promise<T> {
  const parser = await getParser();
  const tree = parser.parse(command);
  if (!tree) throw new Error("parser.parse returned null");
  try {
    const redirect = findNode(tree.rootNode, type);
    if (!redirect) throw new Error(`no ${type} node found in: ${command}`);
    return read(redirect);
  } finally {
    tree.delete();
  }
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
    // operator that survives — and therefore the proof — is a function of the
    // filename. Both cases below assert today's behavior; #814 (Phase 14
    // Step 12) makes them agree on something that is not a bare read.
    it("reads `<> rw.txt` as an input redirect", async () => {
      await expect(destinationEffect("cat <> rw.txt")).resolves.toEqual({
        effect: "read",
        source: "syntax",
      });
    });

    it("reads `<> ~/rw.txt` as an output redirect", async () => {
      await expect(destinationEffect("cat <> ~/rw.txt")).resolves.toEqual({
        effect: "write",
        source: "syntax",
      });
    });

    it.fails("proves the same effect however the destination is spelled", async () => {
      const [bare, tilde] = await Promise.all([
        destinationEffect("cat <> rw.txt"),
        destinationEffect("cat <> ~/rw.txt"),
      ]);
      expect(bare).toEqual(tilde);
    });

    it.fails("does not prove a bare read for a read-write open", async () => {
      await expect(destinationEffect("cat <> rw.txt")).resolves.not.toEqual({
        effect: "read",
        source: "syntax",
      });
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
    it.each([
      "cat < in.txt",
      "pnpm x 2>&1",
      "pnpm x <& in.txt",
    ])("answers false for %s", async (command) => {
      await expect(mayWrite(command)).resolves.toBe(false);
    });
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
    ])("answers true for %s (%s)", async (command) => {
      await expect(mayWrite(command)).resolves.toBe(true);
    });
  });
});
