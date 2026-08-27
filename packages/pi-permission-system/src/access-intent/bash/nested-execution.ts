import type { TSNode } from "#src/access-intent/bash/parser";
import type { BashCommandContext } from "#src/types";

/**
 * AST node types whose interior commands really execute when the shell runs the
 * program: command substitution (`$(…)`, backticks) and process substitution
 * (`<(…)`/`>(…)`).
 *
 * Subshells (`( … )`) are deliberately absent — a subshell is also a command
 * unit in its own right, so the command enumerator emits it whole and descends
 * it separately rather than treating it as a pure nesting wrapper.
 *
 * This map is the single vocabulary shared by the bash command surface and the
 * bash path surface, so the two cannot disagree about what counts as a nested
 * execution (#741).
 */
export const NESTED_EXECUTION_CONTEXTS: ReadonlyMap<
  string,
  BashCommandContext
> = new Map([
  ["command_substitution", "command_substitution"],
  ["process_substitution", "process_substitution"],
] satisfies [string, BashCommandContext][]);

/**
 * AST node types that are neither commands nor argument values themselves, but
 * whose subtree can host a nested execution context that really runs.
 *
 * A redirect destination is the motivating case: tree-sitter-bash parses
 * `echo hi > $(rm x)` with the `file_redirect` as a *sibling* of the `command`,
 * so a consumer that abandons the redirect never sees the substitution inside
 * it — the bypass #741 fixed.
 *
 * An interpolating heredoc body is the second case: `cat <<EOF` with `$(rm e)`
 * in the body really runs `rm e`. Quoting needs no special handling here —
 * tree-sitter-bash emits a `command_substitution` node under `heredoc_body`
 * only for a bare `<<EOF`, never for `<<'EOF'` or `<<"EOF"`, so the parser
 * already encodes the interpolation rule.
 *
 * Membership means "do not read this subtree's own text, but do descend it for
 * executions"; each consumer keeps its own handling of the destination tokens.
 */
export const EXECUTION_HOST_TYPES: ReadonlySet<string> = new Set([
  "file_redirect",
  "heredoc_redirect",
  "herestring_redirect",
  "heredoc_body",
]);

/**
 * Visit every nested execution context in `node`'s subtree, in source order.
 *
 * The walk does not descend *past* a context it finds: `visit` receives the
 * context node itself and decides how to treat its interior (the command
 * enumerator enumerates commands there; the path collector collects operand
 * tokens), which keeps recursion policy with the consumer that understands it.
 *
 * A substitution can nest under `command_name` (when the whole command is
 * `$(…)`), under an argument, inside a redirect destination, or inside an
 * interpolating heredoc body, so the entire subtree is searched.
 */
export function forEachNestedExecution(
  node: TSNode,
  visit: (contextNode: TSNode, context: BashCommandContext) => void,
): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    const context = NESTED_EXECUTION_CONTEXTS.get(child.type);
    if (context) {
      visit(child, context);
    } else {
      forEachNestedExecution(child, visit);
    }
  }
}
