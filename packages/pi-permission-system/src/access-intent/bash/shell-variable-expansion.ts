/**
 * Resolution of the shell variable references the bash path projection can
 * settle statically.
 *
 * Runs at token collection, upstream of classification: by the time a token
 * reaches `classifyTokenAsPathCandidate` it already carries the expanded path,
 * so `$HOME/x` is accepted by the ordinary absolute-shape branch and needs no
 * per-variable knowledge in the classifiers (#694). Keeping the vocabulary here
 * — rather than teaching each classifier a `$HOME` prefix — is what stops the
 * two from drifting apart, which is the defect this module closes.
 *
 * The resolvable set is deliberately tiny and closed. `HOME` is the spelling
 * `expandHomePath` already resolves for config patterns and path literals, so
 * resolving it here removes an inconsistency rather than widening the
 * determinism boundary; `PWD` reads no environment at all. Every other name
 * keeps its literal text, so ADR 0003's exclusion of ambient host state stands.
 * See `docs/decisions/0009-bash-path-projection-completeness-contract.md`.
 */
import { homedir } from "node:os";

import type { TSNode } from "./parser";

/**
 * The value of a plain `$NAME` / `${NAME}` reference, or `null` when the node
 * is not a plain reference or names a variable outside the resolvable set.
 *
 * Plainness is decided structurally, not by matching the node's text: a plain
 * reference carries exactly one `variable_name` child and nothing else but
 * delimiters. An operator form (`${HOME:-/tmp}`, `${#HOME}`, `${HOME%/*}`)
 * carries additional children and is therefore rejected without this module
 * needing to enumerate bash's expansion operators.
 */
export function resolvePlainVariableExpansion(node: TSNode): string | null {
  const name = plainVariableName(node);
  return name === null ? null : (RESOLVABLE_VARIABLES.get(name)?.() ?? null);
}

/**
 * How each resolvable variable is spelled as a path.
 *
 * `PWD` resolves to the base-relative marker rather than a directory: the
 * shell's working directory at a given point *is* the projection's effective
 * base, which the resolver already applies via `resolveBase`. Handing back `.`
 * therefore lands `$PWD/x` on the same footing as `./x` — correct after any
 * `cd` folding, conservative under an unknown base (#393), and free of both a
 * threaded base parameter and a platform branch.
 */
const RESOLVABLE_VARIABLES: ReadonlyMap<string, () => string> = new Map([
  ["HOME", homedir],
  ["PWD", () => "."],
]);

/** Node types that delimit an expansion without altering what it evaluates to. */
const EXPANSION_DELIMITERS: ReadonlySet<string> = new Set(["$", "${", "}"]);

/**
 * The variable a node plainly references, or `null` when it references none —
 * because it has no `variable_name` child, has more than one, or carries a
 * child that is neither the name nor a delimiter (an expansion operator and its
 * operand, or an assignment's `=` and value).
 */
function plainVariableName(node: TSNode): string | null {
  let name: string | null = null;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "variable_name") {
      if (name !== null) return null;
      name = child.text;
      continue;
    }
    if (!EXPANSION_DELIMITERS.has(child.type)) return null;
  }

  return name;
}
