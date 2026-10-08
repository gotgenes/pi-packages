import type { BashCommandContext } from "#src/types";
import type { TSNode } from "./parser";
import { REDIRECT_NODE_TYPES } from "./redirect-analysis";

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
 * The word nodes of a `command` node, in source order: every named child except
 * a prefix assignment and a hosted redirect.
 *
 * Shared so every consumer that reads a command's words, whether as words (the
 * command enumerator's unit text) or as nodes (the log's command masker, which
 * offsets a re-parse by the payload node's `startIndex`), walks the identical
 * filtered list. Two walks over the same children with the same filter,
 * written twice, is how the two come to disagree about which word is at which
 * index.
 */
export function commandWordNodes(node: TSNode): TSNode[] {
  const nodes: TSNode[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child?.isNamed) continue;
    if (child.type === "variable_assignment") continue;
    if (REDIRECT_NODE_TYPES.has(child.type)) continue;
    nodes.push(child);
  }
  return nodes;
}

/**
 * The subshell a `command` node times, or `null` when it is not `time ( … )`.
 *
 * `tree-sitter-bash` has no `time` keyword, so `time (rm x)` parses as a
 * command named `time` whose only argument is a `subshell`. Bash runs that
 * subshell's commands as surely as a bare `( … )`'s, so both bash surfaces read
 * the shape through this one recognizer rather than each re-deciding it.
 *
 * The words must be exactly a `time` spelled literally (a quoted `"time"` is
 * not the keyword) and one subshell. Anything between them (`time -p ( … )`,
 * whose `-p` the grammar cannot place) leaves the shape unrecognized, so it
 * keeps whatever floor the enumerator gives it.
 */
export function timedSubshellOf(command: TSNode): TSNode | null {
  const words = commandWordNodes(command);
  if (words.length !== 2) return null;
  const [name, argument] = words;
  if (argument.type !== "subshell") return null;
  return name.type === "command_name" && name.text === "time" ? argument : null;
}

/**
 * Visit every execution context `node` *is or contains*, in source order.
 *
 * The root-inclusive question, and the one nearly every consumer asks: a node
 * handed in can be a substitution outright (`> $(cmd)`) or merely host one
 * (`> ${DIR}/$(cmd)`), and both really execute. {@link forEachNestedExecution}
 * answers the strictly-within question instead, which is what a visitor needs
 * once it has already decided to treat a context's interior itself.
 */
export function forEachExecutionIn(
  node: TSNode,
  visit: (contextNode: TSNode, context: BashCommandContext) => void,
): void {
  const context = NESTED_EXECUTION_CONTEXTS.get(node.type);
  if (context) visit(node, context);
  else forEachNestedExecution(node, visit);
}

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
 *
 * `node` itself is never visited, however it is typed — use
 * {@link forEachExecutionIn} when it may *be* a context rather than merely
 * contain one.
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
