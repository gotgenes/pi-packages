import { redirectDestinationEffect } from "#src/access-intent/bash/command-effects";
import { ARG_NODE_TYPES } from "#src/access-intent/bash/node-text";
import type { TSNode } from "#src/access-intent/bash/parser";
import type { TokenEffect } from "#src/access-intent/effect";

/**
 * What a redirect node in the parse tree proves.
 *
 * `command-effects.ts` owns the operator *table* — which spelling means read,
 * which means write — and this module owns reading a `file_redirect` node well
 * enough to consult it: finding the operator among the node's children, and
 * telling a destination that names a file from one that names a descriptor.
 *
 * The split exists because two callers need different answers from the same
 * read. The token collector asks what effect to attribute to a destination it
 * is about to emit; the command enumerator asks only whether the statement
 * writes a file at all, because a wrapper unit carrying a write is not
 * transparent however read-only the command it runs is (#803). One reader
 * answering both keeps them from drifting.
 */

/**
 * The effect `redirect` proves for `destination`, or `null` when the redirect
 * names no file and no token should be collected.
 *
 * `>&` and `<&` are the two operators that may name either a file descriptor
 * (`2>&1`) or a real file (`cmd >& out`); the destination node's type is the
 * parse-tree fact that tells them apart.
 */
export function redirectEffectForDestination(
  redirect: TSNode,
  destination: TSNode,
): TokenEffect | null {
  return redirectDestinationEffect(
    redirectOperatorOf(redirect),
    DESCRIPTOR_NODE_TYPES.has(destination.type),
  );
}

/**
 * True when `redirect` proves a write to a real file.
 *
 * A descriptor duplication (`2>&1`) is not a write, and neither is an input
 * redirect — reading a file alongside a pure reader leaves it a pure reader.
 */
export function redirectProvesFileWrite(redirect: TSNode): boolean {
  for (let i = 0; i < redirect.childCount; i++) {
    const child = redirect.child(i);
    if (!child || !ARG_NODE_TYPES.has(child.type)) continue;
    if (redirectEffectForDestination(redirect, child)?.effect === "write") {
      return true;
    }
  }
  return false;
}

/**
 * Destination node types that name a file descriptor rather than a file, so
 * `>&` / `<&` duplicate a stream instead of touching the filesystem.
 *
 * Neither type is in {@link ARG_NODE_TYPES}, so `2>&1`'s `1` is already never
 * collected; the check is what keeps that true if the argument set widens.
 */
const DESCRIPTOR_NODE_TYPES: ReadonlySet<string> = new Set([
  "file_descriptor",
  "number",
]);

/**
 * The redirect operator of a redirect node.
 *
 * tree-sitter-bash emits it as an unnamed child whose `type` is the operator
 * text itself, and a redirect's only unnamed child is that operator — so the
 * syntax proof is a lookup on the first one found.
 */
function redirectOperatorOf(node: TSNode): string {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child && !child.isNamed) return child.type;
  }
  return "";
}
