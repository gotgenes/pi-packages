import { createRequire } from "node:module";
import { memoizeAsyncWithRetry } from "#src/async-cache";

/**
 * Minimal subset of web-tree-sitter's SyntaxNode used by the AST walker.
 * Defined locally so callers do not need to import web-tree-sitter types.
 *
 * The last two members are the parse's own health, which every other member
 * describes a *successful* parse's structure. They exist for
 * {@link parseUnresolvedAt} and are read nowhere else — see its doc comment for
 * why that boundary matters.
 */
export interface TSNode {
  readonly type: string;
  readonly text: string;
  /** Absolute byte offset of this node's start in the parsed source. */
  readonly startIndex: number;
  readonly childCount: number;
  /** False for anonymous tokens (operators, delimiters); true for named nodes. */
  readonly isNamed: boolean;
  /** True when this node is an error or missing token, or contains one. */
  readonly hasError: boolean;
  /** The node immediately before this one under the same parent, named or not. */
  readonly previousSibling: TSNode | null;
  child(index: number): TSNode | null;
}

/**
 * Whether tree-sitter failed to resolve the syntax at `node`.
 *
 * Error recovery disposes of text it cannot attach in one of two places, and
 * which one it picks depends on what follows. The read-write open `<>`, which
 * `tree-sitter-bash` 0.25.1 has no node for, shows both: `cat <> rw.txt` keeps
 * the discarded `>` as an `ERROR` *child* of the redirect, while
 * `cat <> ~/rw.txt` strands the `<` as an `ERROR` *sibling* ahead of a redirect
 * that is otherwise indistinguishable from a genuine `> ~/rw.txt`. A reader
 * that consults only the node's own subtree sees the first and not the second.
 *
 * The immediate predecessor, rather than the enclosing statement, is what makes
 * the answer per-redirect: in `cat a > out.txt <> ~/rw.txt` the statement has
 * an error but its first redirect is a fully resolved write, and condemning it
 * would forfeit a proof the parse really did establish.
 *
 * This is the one place {@link TSNode.hasError} and
 * {@link TSNode.previousSibling} are read. Keeping the lateral navigation here
 * is deliberate: recovering-parser behavior is a fact about tree-sitter rather
 * than about any construct, so a caller asks this question instead of
 * hand-rolling a sibling walk of its own.
 */
export function parseUnresolvedAt(node: TSNode): boolean {
  return node.hasError || (node.previousSibling?.hasError ?? false);
}

/**
 * Minimal subset of web-tree-sitter's Parser used by this module.
 */
interface TSParser {
  parse(input: string): { rootNode: TSNode; delete(): void } | null;
  delete(): void;
}

async function initParser(): Promise<TSParser> {
  // Use named imports — web-tree-sitter exports Parser as a named class.
  const { Parser, Language } = await import("web-tree-sitter");
  const req = createRequire(import.meta.url);
  const treeSitterWasm = req.resolve("web-tree-sitter/web-tree-sitter.wasm");
  await Parser.init({ locateFile: () => treeSitterWasm });

  const parser = new Parser();
  const bashWasm = req.resolve("tree-sitter-bash/tree-sitter-bash.wasm");
  const bash = await Language.load(bashWasm);
  parser.setLanguage(bash);
  return parser;
}

// Memoize on success but drop a rejected result so a transient init failure
// (e.g. a slow WASM load) is retried on the next tool call instead of poisoning
// the parser for the process lifetime.
export const getParser = memoizeAsyncWithRetry(initParser);

// Resolved parser cached for synchronous access after warm-up. The tree-sitter
// parser is stateless (parse is a pure function of its input), so caching it at
// module scope is safe even though module state now persists across same-cwd
// session switches.
let warmedParser: TSParser | null = null;

/**
 * Warm the tree-sitter parser so {@link getWarmBashParser} can hand it out
 * synchronously. Triggered at `before_agent_start` (which precedes any tool
 * call) so the synchronous advisory bash path can decompose at gate parity
 * (#309).
 *
 * Best-effort and idempotent: it swallows a WASM init failure (the sync
 * accessor stays cold and callers fall back to whole-string matching), and it
 * returns immediately once warm, so calling it every turn is free.
 */
export async function warmBashParser(): Promise<void> {
  if (warmedParser) return;
  try {
    warmedParser = await getParser();
  } catch {
    // Leave cold → advisory bash queries fall back to whole-string matching.
    // getParser's own retry memoization re-attempts init on the next call.
  }
}

/**
 * The warmed parser for synchronous use, or `null` when it has not been warmed
 * yet (the pre-warm window). Callers that get `null` must degrade gracefully.
 */
export function getWarmBashParser(): TSParser | null {
  return warmedParser;
}

/** Test-only: clear the warmed-parser cache so cold/warm cases are isolatable. */
export function resetWarmBashParser(): void {
  warmedParser = null;
}
