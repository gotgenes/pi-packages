import type { TSNode } from "#src/access-intent/bash/parser";

/**
 * Build a fake {@link TSNode} for testing the pure AST helpers without paying
 * for a real tree-sitter parse.
 *
 * Fills only the fields those helpers read; `children` drives both `childCount`
 * and `child(i)`, so a node's structural shape (delimiters plus a
 * `variable_name`, a quoted string's inner content) can be expressed directly.
 * A fake node is a well-formed one: it reports no parse error and no preceding
 * sibling, because the helpers this builds for read neither.
 *
 * Prefer a real parse (`getParser()`) when the test's subject is the AST shape
 * tree-sitter actually produces; use this when the subject is the helper's
 * behavior given a shape.
 */
export function makeTSNode(
  type: string,
  text: string,
  children: TSNode[] = [],
): TSNode {
  return {
    type,
    text,
    startIndex: 0,
    childCount: children.length,
    isNamed: true,
    hasError: false,
    previousSibling: null,
    child: (i) => children[i] ?? null,
  };
}
