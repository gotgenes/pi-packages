---
issue: 814
issue_title: "pi-permission-system: a <> read-write redirect proves a read, and the answer depends on the filename"
---

# An unresolvable redirect proves nothing

## Release Recommendation

**Release:** ship independently

This issue is adopted as Phase 14 Step 12, whose roadmap entry carries a `Release: independent` tag.
It belongs to no release batch: the `capability-axis` batch (Steps 1–3) shipped as `pi-permission-system-v27.1.0`, and this step's relief — a `<>` destination stops proving a bare read — is immediate and unconditional the moment it lands.
It is a non-breaking `fix:` (see Goals), so it may also ride behind other pi-permission-system work in the same dispatch rather than needing its own.

## Problem Statement

`redirectDestinationEffect` ([`src/access-intent/bash/command-effects.ts`](../../src/access-intent/bash/command-effects.ts)) classifies a redirect destination by operator spelling, and `redirectOperatorOf` ([`src/access-intent/bash/redirect-analysis.ts`](../../src/access-intent/bash/redirect-analysis.ts)) reads that spelling as the redirect node's first unnamed child.

`tree-sitter-bash` 0.25.1 has no node for the read-write open `<>`.
Its error recovery keeps whichever half of the operator it can attach and discards the rest into an `ERROR` node — and *where* that `ERROR` lands depends on the destination's shape.
Measured against a real parse at `78f7a287`:

```text
cat <> rw.txt
  redirected_statement
    command "cat"
    file_redirect "<> rw.txt"
      !< "<"
      ERROR ">"                 <- the write half, discarded
      word "rw.txt"

cat <> ~/rw.txt
  redirected_statement
    command "cat"
    ERROR "<"                   <- the read half, discarded, as a *sibling*
    file_redirect "> ~/rw.txt"  <- indistinguishable from a genuine `> ~/rw.txt`
      !> ">"
      word "~/rw.txt"
```

`redirectOperatorOf` returns `<` for the first and `>` for the second, so the same command proves `{ effect: "read", source: "syntax" }` or `{ effect: "write", source: "syntax" }` according to how its filename is spelled.

Both answers are wrong, and the first is wrong in the fail-open direction ADR 0013 §10 is careful about everywhere else.
`<>` opens the file for *writing* as well as reading, but a `read` proof routes the token to `path_read` / `external_directory_read` alone — so a user running the read-only-agent posture the capability axis exists to make safe (`external_directory_read: {"*": "allow"}`) gets no `path_write` consultation on a destination the shell may truncate through.

There is a second, narrower instance of the same defect.
`redirectMayWriteFile` — the refusal the wrapper-transparency exemption consults ([#803]) — answers `false` for `cat <>&1`, whose `file_redirect ">&1"` carries no argument-shaped child at all, so its loop finds nothing to refuse on and the floor exemption is cleared for an unresolvable form.

## Goals

- A redirect whose parse `tree-sitter-bash` could not resolve proves **nothing** about its destination: the token carries `UNPROVEN_EFFECT`, so the gates consult both directional surfaces, most-restrictive — ADR 0013 §10's base case.
- `cat <> rw.txt` and `cat <> ~/rw.txt` attribute the **same** effect to their destination, and it is not a bare `read`.
- Every currently-proven operator keeps its answer: `>`, `>>`, `>|`, `&>`, `&>>`, `<`, `<<<`, `2>&1`, `>& out`, `<& in`, and every unresolvable-*destination* form (`> $OUT`, `>${OUT}`, `> $(mktemp)`, `> ${DIR}/log`).
- `redirectMayWriteFile` refuses an unresolvable redirect explicitly rather than by accident of which children it happens to carry.
- The lateral parse-tree navigation this needs stays inside the `tree-sitter` boundary module (`parser.ts`), named once, so no walker hand-rolls it.
- **Not breaking** (`fix:`, no `!`).
  Measured on the author's review log (5296 distinct intact bash commands, 3353 carrying a redirect): **1** command (0.019%) changes a redirect attribution, and it lands on a non-path token, so **0** commands newly prompt.
  This mirrors Phase 14 Step 14's classification (a fail-closed floor typed `fix:` at 0.02% measured cost) rather than Step 16's (`fix!:`, which newly prompted on 3 of 5191 measured commands).

## Non-Goals

- **Adding `<>` to the operator table as a write.**
  The issue offers this as candidate shape 2.
  It is unreachable: the parser never yields `<>` as a single operator token, so a `<>` entry in `OUTPUT_REDIRECT_OPERATORS` would be dead code, and the `cat <> ~/rw.txt` spelling would still be classified from the surviving `>` alone.
- **Renaming `TSNode` / `TSParser` / `makeTSNode`.**
  Raised at the planning gate and deferred by operator decision: both new members are genuine web-tree-sitter `Node` members (`hasError` and `previousSibling`), so the interface stays a strict subset-mirror and its docstring stays true; and the rename is not preparatory — it does not shrink this change by one line, while competing for the same files as Phase 14 Step 13's bulk `src/` reorganization ([#837]), which has not landed.
  Recorded under `#### Deferred tidyings` in the Planning stage note.
- **Consolidating the four duplicate `findNode` helpers** across `redirect-analysis.test.ts`, `token-collection.test.ts`, `nested-execution.test.ts`, and `shell-variable-expansion.test.ts`.
  The Tidy-First assessor flagged the duplication and declined it as scope creep: only `redirect-analysis.test.ts`'s copy is on this change's path.
  Also recorded under `#### Deferred tidyings`.
- **An ADR 0013 amendment.**
  Declined at the planning gate. §10 already states the base case this change implements ("a path token whose effect cannot be proven consults *both* directional surfaces"), and the 2026-08-29 amendment already records what an `ERROR` node is; neither needs new text for a fix that brings the code to what they say.
- **Flooring the enclosing unit on an unparsed subtree.**
  That is §10's *unhandled node type* clause and belongs to Phase 14 Step 14 ([#840]).
  This change touches token attribution only, never a command unit's permission state.
- **Descending an `ERROR` node for commands.**
  Settled against in ADR 0013's 2026-08-29 amendment ([#742]) and untouched here.
- **Widening the fix to every node type that can carry an `ERROR`.**
  The predicate is asked only of a redirect node, by its two readers.
  Nothing else in the walker changes its behavior on a recovered parse.

## Background

Three modules meet at this defect, and Phase 14 Step 3 ([#803]) is what put them in their current shape.

- **`src/access-intent/bash/parser.ts`** owns the `tree-sitter` boundary: the memoized `getParser`, the warm-parser accessors, and the exported `TSNode` interface — a deliberately minimal local mirror of web-tree-sitter's `Node`, "defined locally so callers do not need to import web-tree-sitter types".
  It carries five readonly members (`type`, `text`, `startIndex`, `childCount`, `isNamed`) plus `child(index)`.
  It contains no AST-reading logic today.
- **`src/access-intent/bash/redirect-analysis.ts`** is the sole owner of reading a `file_redirect` node, extracted in [#803].
  It exports two functions carrying deliberately different burdens of proof, which the module docstring states and the package skill repeats: `redirectEffectForDestination` answers with a **proof** (what to attribute to a destination the collector is about to emit), and `redirectMayWriteFile` answers with a **refusal** (whether it is safe to remove the wrapper floor).
  Its private `redirectOperatorOf` reads the operator as the node's first unnamed child.
- **`src/access-intent/bash/command-effects.ts`** owns the operator *table* — which spelling means read, which means write — and knows nothing about nodes.

Consumers, all unchanged by this plan: `token-collection.ts` (`collectRedirectTokens` → `redirectEffectForDestination`), `command-enumeration.ts` (`redirectedScope` → `redirectMayWriteFile`), and `bash-path-resolver.ts` (`foldPipelineFirstStage` → `collectRedirectTokens`).

Constraints from `AGENTS.md` and the package skill that bear on this change:

- A new required field on a shared interface needs a grep for **constructors** of that type, not its use sites.
  Here that is `test/helpers/fake-ts-node.ts` — verified by spike to be the only compile break.
- The roadmap step's `✅` mark (heading **and** Mermaid node) lands in the implementation doc-update commit, not a deferred ship commit.
- A durable number ships with the instrument that produced it (the convention `scripts/measure-*.mjs` and their `docs(pi-permission-system): commit the instrument behind …` commits establish).
- A module-tree entry cites an issue only when the ref encodes an **active constraint**.
  The `parser.ts` entry's new clause does (the "no other module reads the raw members" boundary), so it cites #814; nothing else gains a ref.

## Design Overview

### The predicate

`tree-sitter`'s error recovery either keeps the unparseable text inside the node (`file_redirect "<> rw.txt"` with an inner `ERROR ">"`) or splits it out ahead of the node (`ERROR "<"` then a clean `file_redirect "> ~/rw.txt"`).
Both are visible from the redirect node itself once `TSNode` exposes the two members web-tree-sitter's `Node` already has:

```typescript
// src/access-intent/bash/parser.ts
export interface TSNode {
  readonly type: string;
  readonly text: string;
  readonly startIndex: number;
  readonly childCount: number;
  readonly isNamed: boolean;
  /** True when this node is an `ERROR`/`MISSING`, or contains one. */
  readonly hasError: boolean;
  /** The node immediately before this one under the same parent, named or not. */
  readonly previousSibling: TSNode | null;
  child(index: number): TSNode | null;
}

export function parseUnresolvedAt(node: TSNode): boolean {
  return node.hasError || (node.previousSibling?.hasError ?? false);
}
```

`parseUnresolvedAt` lives in `parser.ts`, not in `redirect-analysis.ts`, by operator decision at the planning gate.
The reasoning is that the sibling split is a fact about **tree-sitter's error recovery**, not about redirects — the `<` in `cat <> ~/rw.txt` lands in a sibling `ERROR` because of how the grammar recovers, and any construct could do the same.
Naming it beside the interface that declares the raw members keeps lateral navigation inside the boundary module: `redirect-analysis.ts` asks one question and reads neither `previousSibling` nor `hasError`, and a later walker needing the same fact finds it instead of hand-rolling a chain.

**Why the immediate predecessor and not the whole enclosing statement.**
A coarser rule (`redirect.parent.hasError`) was considered and rejected at the gate: it over-refuses.
In `cat a > out.txt <> ~/rw.txt` the enclosing `redirected_statement` errors, but its first redirect is a genuine, fully resolved `> out.txt` and must keep its write proof.

### Truth table, measured against a real parse at `78f7a287`

| Command                       | `file_redirect` nodes, in order         | `parseUnresolvedAt` | Destination effect after                    |
| ----------------------------- | --------------------------------------- | ------------------- | ------------------------------------------- |
| `cat <> rw.txt`               | `"<> rw.txt"` (inner `ERROR ">"`)       | true                | unproven                                    |
| `cat <> ~/rw.txt`             | `"> ~/rw.txt"`, preceded by `ERROR "<"` | true                | unproven                                    |
| `cat 3<> rw.txt`              | `"3<> rw.txt"`                          | true                | unproven                                    |
| `cat 0<> ~/y`                 | `"> ~/y"`, preceded by `ERROR "<"`      | true                | unproven                                    |
| `cat <>&1`                    | `">&1"`, preceded by `ERROR "<"`        | true                | (no argument child; `mayWriteFile` refuses) |
| `cat a > out.txt <> ~/rw.txt` | `"> out.txt"`; `"<"`; `"> ~/rw.txt"`    | false; true; true   | write; —; unproven                          |
| `cat <> ~/a.txt > b.txt`      | `"> ~/a.txt"`; `"> b.txt"`              | true; false         | unproven; write                             |

The last two rows are the precision argument: an unresolvable redirect does not contaminate a resolvable sibling in either direction.

Every resolvable shape answers `false` — verified over `>`, `>>`, `>|`, `&>`, `&>>`, `<`, `<<<`, `2>&1`, `>& out`, `<& in`, `2> err.log`, `2>> err.log`, `> $OUT`, `>${OUT}`, `> $(mktemp)`, `> ${DIR}/log`, `> $(rm x)`, `< <(rm c)`, `> ~/a.txt`, and a heredoc.

### The two readers

```typescript
// src/access-intent/bash/redirect-analysis.ts
export function redirectEffectForDestination(
  redirect: TSNode,
  destination: TSNode,
): TokenEffect | null {
  const proven = redirectDestinationEffect(
    redirectOperatorOf(redirect),
    DESCRIPTOR_NODE_TYPES.has(destination.type),
  );
  if (proven === null) return null;
  return parseUnresolvedAt(redirect) ? UNPROVEN_EFFECT : proven;
}

export function redirectMayWriteFile(redirect: TSNode): boolean {
  if (parseUnresolvedAt(redirect)) return true;
  // …existing loop, with its `child.type === "ERROR"` line deleted…
}
```

Two properties carry the design.

1. **`null` still means "names no file at all".**
   The demotion is applied to a *proof*, never to the descriptor-duplication answer, so `2>&1` keeps contributing no token.
   Ordering the checks the other way would emit a descriptor number as a path candidate.
2. **The `redirectMayWriteFile` lead is not redundant with the demotion**, even though it looks it.
   For most shapes the loop would refuse anyway — a demoted destination is `unproven`, which is `!== "read"`.
   But `cat <>&1` parses to `file_redirect ">&1"` whose only children are the unnamed `>&` and a `number "1"`: the loop skips both and answers `false`.
   The lead answers `true`.
   That is a real, independently killable behavior change, and it is also why the in-loop `child.type === "ERROR"` line goes away rather than being kept beside it — the lead is strictly stronger, and keeping both would state the same refusal twice with different reach.

Both exported functions now read the same fact, which is what the module exists to guarantee: the collector and the enumerator cannot drift on what an unresolvable redirect is.

### Interaction with the effect fold

`UNPROVEN_EFFECT` is `{ effect: "unproven", source: "unproven" }`, and per `mergeTokenEffects` an unproven attribution merged with any other attribution of the same resolved path folds to unproven.
Unproven consults *both* directional surfaces, most-restrictive, so the change is monotonically at-least-as-restrictive as today's behavior at every gate — it can add a prompt, never remove one.

### Structural review

Run against the `design-review` checklist, since this widens a shared interface:

| Check                               | Finding                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency width                    | `TSNode` goes from 5 members + 1 method to 7 + 1. It is a structural mirror of an external node type, not a dependency bag — every walker takes the whole node, so a per-consumer narrowing would mean N interfaces over one object. Accepted.                                                          |
| Law of Demeter                      | `node.previousSibling?.hasError` is a two-hop reach. It is written exactly once, inside `parseUnresolvedAt`, in the module that owns the interface — which is the named-method fix the checklist prescribes.                                                                                            |
| Output arguments / scattered resets | None; every function here is pure over a node.                                                                                                                                                                                                                                                          |
| Parameter relay                     | Avoided by construction. The rejected alternative (each walker detects the preceding `ERROR` and passes a boolean) would have threaded the fact through `collectPathCandidateTokens`, `foldPipelineFirstStage`, and `redirectedScope`, where a fourth walker added later would silently revert the fix. |
| Repeated discriminators             | `type === "ERROR"` currently appears in `redirect-analysis.ts` and `command-enumeration.ts`. This change removes the first; the second asks a different question (whether to descend) and stays.                                                                                                        |
| Test mock depth                     | `makeTSNode` gains two defaulted fields, one edit in one factory.                                                                                                                                                                                                                                       |

## Module-Level Changes

### `src/access-intent/bash/parser.ts`

- `TSNode` gains `readonly hasError: boolean` and `readonly previousSibling: TSNode | null`, each with a one-line doc comment.
- New exported `parseUnresolvedAt(node: TSNode): boolean`, with a doc comment that states both the fact it reads (tree-sitter's recovery places the discarded text either inside the node or immediately before it) and the boundary it exists to hold (no other module reads `hasError` / `previousSibling` directly).
- The `TSNode` docstring keeps its "minimal subset of web-tree-sitter's `SyntaxNode`" framing — it is still literally true — and gains a sentence naming what the two new members are for.

### `src/access-intent/bash/redirect-analysis.ts`

- Imports `parseUnresolvedAt` from `#src/access-intent/bash/parser` (already imports `TSNode` from there, as a type-only import — this becomes a mixed import).
- `redirectEffectForDestination` demotes a proof to `UNPROVEN_EFFECT` when the redirect is unresolved; its doc comment gains the `<>` case and the reason the demotion runs after the `null` answer, not before it.
- `redirectMayWriteFile` leads with `if (parseUnresolvedAt(redirect)) return true;`, and the in-loop `if (child.type === "ERROR") return true;` line plus its two-line comment are deleted.
  Its doc comment's "only two things clear it" paragraph is reworded to name three: the lead refusal, a descriptor duplication, and a proven read.
- The module docstring's split paragraph is reworded: the two answers still carry different burdens of proof, but they now share one fact about whether the parse resolved.

### `src/access-intent/bash/command-effects.ts`

Unchanged.
`redirectDestinationEffect`'s docstring already says "An operator outside the table proves nothing rather than dropping the token", which stays exactly true; `<>` is not added to any operator set (see Non-Goals).

### `test/helpers/fake-ts-node.ts`

- `makeTSNode` gains `hasError: false` and `previousSibling: null` defaults.
  Verified by spike that this is the **only** compile break from the widening: `tsc --noEmit` reported exactly one error, at `fake-ts-node.ts:20`, and the real web-tree-sitter `Parser` still satisfies the widened `TSParser` / `TSNode` structurally.
  Its two consumers (`node-text.test.ts`, `shell-variable-expansion.test.ts`) need no edit.

### `test/access-intent/bash/parser.test.ts`

- New `describe("parseUnresolvedAt")` block, parsing real commands rather than asserting against fabricated node shapes (the convention `redirect-analysis.test.ts` and `program.test.ts` follow).

### `test/access-intent/bash/redirect-analysis.test.ts`

- `findNode` is re-expressed over a new `findNodes(node, type): TSNode[]`, and `withRedirect` over a new `withRedirects(command, type, read)` — the Tidy-First assessor's one recommended preparatory commit.
  Needed because the `cat a > out.txt <> ~/rw.txt` case must reach the **first and third** of three sibling `file_redirect` nodes from one parse, and `findNode` is a depth-first search for the first match only.
- The `describe("a redirect the parser could not resolve")` block's four tests (two `it`, two `it.fails`) collapse into plain assertions that both spellings prove `{ effect: "unproven", source: "unproven" }`, plus the new `3<>`, `0<>`, mixed, and trailing-resolvable cases.
- The `redirectMayWriteFile` block gains `cat <>&1`.

### `test/access-intent/bash/token-collection.test.ts`

- One end-to-end pin: `collectPathCandidateTokens` on `cat <> ~/rw.txt` and on `cat <> rw.txt` each emit their destination with an unproven effect.
  This is the layer the gates actually consume, so it pins the observable outcome rather than the analyzer's contract alone.

### `packages/pi-permission-system/scripts/measure-unresolved-redirects.mjs` (new)

- The instrument behind this plan's `1 of 5296` figure, following the header conventions of `measure-statement-operands.mjs`: the transcribed vocabulary, the measurement date, the drift note, and the `node scripts/… [path-to-review-log.jsonl]` usage line.
- Reports: intact commands, commands carrying a redirect, commands whose redirect attribution changes, and the changed attributions themselves.
- Not in the package's `files` allowlist, so it does not ship in the tarball.

### `docs/architecture/architecture.md`

- Module tree, `parser.ts` row: add `parseUnresolvedAt` and the two new `TSNode` members, with the "no other module reads the raw members directly" boundary as an active constraint citing #814.
- Module tree, `redirect-analysis.ts` row: the current entry names "the `ERROR` node `<>` degrades to" as something that counts against the exemption; reword so both answers derive from `parseUnresolvedAt`, and drop the stale implication that the collector guesses from a partial operator.
- Step 12 heading → `#### ✅ Step 12: An unresolvable redirect proves nothing ([#814])`, plus a `Landed:` note recording the measured delta and the two things the Target line did not name (the sibling-split placement, and `cat <>&1`'s independent refusal).
- Mermaid node `S12` → `"✅ Step 12 (#814): unresolvable redirect proves nothing"`.
- Health metrics: **no row references Step 12**, verified by reading the table; none is added or edited.
  The `Baseline (2026-08-24)` column is a fixed phase-open snapshot and is not touched.

### `docs/configuration.md`

- Under "Which direction is a given access?", after the paragraph "An access whose direction cannot be established consults **both** surfaces…", add one sentence naming the read-write open as such a form.
  A new table row is deliberately not used: the table is width-padded, `rumdl fmt` does not re-pad it, and "Any other bash path token → both, most-restrictive" already covers the case categorically.
- The wrapper-transparency clause-4 paragraph at line 832 already says "a redirect destination the parse cannot resolve … is not projected onto those surfaces either"; it stays true and is not edited.

### `.pi/skills/package-pi-permission-system/SKILL.md`

- The redirect-proof sentence ("a redirect operator proves its destination (`>`/`>>`/`>|`/`&>` write, `<`/`<<<` read, a descriptor destination collects no token at all)") gains the unresolvable case.
- The `redirect-analysis.ts` ownership sentence gains the `parseUnresolvedAt` boundary.
- The sentence "`TSNode` exposes no parent" (line 342) stays as written — it remains literally true, and the `UnitScope` relay it justifies is still required, because a redirect hangs off the whole `redirected_statement` and applies to every command beneath it, which no sibling link supplies.
  The same sentence in `architecture.md`'s Step 3 `Landed:` note is phase history and is not rewritten.

### Greps run at planning time

- `TSNode` across `src/` (8 files), `test/` (6 files), `docs/` and `.pi/skills/` — enumerated in full; the only non-frozen prose touch points are the three `architecture.md` lines and the one `SKILL.md` line above.
- `redirectEffectForDestination` / `redirectMayWriteFile` / `collectRedirectTokens` across `src/` and `test/` — three production call sites, all listed above, none needing a signature change.
- No symbol is removed or renamed by this plan, so the removed-export grep classes do not apply.

## Test Impact Analysis

**What the change enables that was not testable before.**
Nothing structurally new — `redirect-analysis.test.ts` already drives the analyzer directly, which is what surfaced the defect.
What it *enables* is expressing a multi-redirect command, which the current helpers cannot reach past the first match; that is the preparatory commit.

**What becomes redundant.**
The two `it.fails` characterization tests are consumed: they exist to flip.
The two plain `it` tests asserting today's split (`"reads \`<> rw.txt\` as an input redirect"` / `"reads \`<> ~/rw.txt\` as an output redirect"`) are replaced rather than kept — they assert the defect.
Nothing else is removed.

**What must stay as-is.**
Every operator test in `describe("output operators")`, `describe("input operators")`, and `describe("descriptor-capable operators")`, and the whole `describe("a destination the parse cannot resolve")` block for `redirectMayWriteFile` — these are Step 2's and Step 3's invariants and the change must leave them green untouched.
`command-effects.test.ts` is untouched: the operator table does not change.

**The parser's input domain, not the inputs I can picture.**
The predicate is a matcher over parse shapes, so it was run at planning time over every redirect form in the existing suite (20 resolvable shapes, all `false`) plus every `<>` spelling reachable by varying the descriptor prefix (`<>`, `3<>`, `0<>`, `2<>`), the destination shape (bare word, `~/`-prefixed, absolute, `$VAR`), and the trailing operand (`&1`, `&2`), plus multi-redirect commands in both orders.
It was then run over the 5296-command review-log corpus, where it flags exactly 1 command — and that one is ADR 0013's known-unparseable valid bash (`git commit -F - <<'MSG' 2>&1 | tail -4`), not a `<>` at all.

## Invariants at risk

| Invariant                                                                                                                                          | Owner                  | Pinned by                                                                                                       | Risk here                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| A redirect operator's proof is absolute and per-token: `>`/`>>`/`>\|`/`&>`/`&>>` write, `<`/`<<<` read, a descriptor destination collects no token | Step 2 ([#807])        | `redirect-analysis.test.ts` operator blocks; `command-effects.test.ts`                                          | The demotion must fire only on an unresolved parse. Killing mutation in step 3 makes it unconditional and these go red                 |
| An unresolvable *destination* counts against the wrapper-floor exemption (`> $OUT`, `> $(mktemp)`)                                                 | Step 3 ([#803])        | `redirectMayWriteFile`'s `describe("a destination the parse cannot resolve")` block                             | Deleting the in-loop `ERROR` line must not weaken it; the block runs unchanged and the lead is strictly stronger                       |
| The wrapper floor is exempted only when the enclosing statement provably writes no file                                                            | Step 3 ([#803])        | `command-enumeration.test.ts`, `wrapper-analysis.test.ts`, `composition-root.test.ts` yolo-reconciliation tests | `redirectedScope` reads `redirectMayWriteFile`, which only ever gets *more* refusing. Run all three files, not just the redirect tests |
| A path token whose effect cannot be proven consults both directional surfaces, most-restrictive                                                    | ADR 0013 §10 base case | `effect.ts`'s `mergeTokenEffects`; the bash gate tests                                                          | This change produces more unproven tokens; it changes no consumer of them                                                              |

**Quantitative baseline, measured at `78f7a287`:** 5296 distinct intact bash commands in the local review log, 3353 carrying a redirect, 1 (0.019%) changing a redirect attribution (`"tail": write → unproven`), 0 newly prompting.
Re-run the instrument at implementation time rather than quoting these — the log grows with use, and the figure is scoped to one corpus and one config.

## TDD Order

1. **`test:` — reach every matching redirect node in the analyzer tests.**
   Preparatory (Tidy-First assessor's one recommendation).
   In `test/access-intent/bash/redirect-analysis.test.ts`, add `findNodes(node, type): TSNode[]` (depth-first, every match) and re-express `findNode` as `findNodes(node, type)[0] ?? null`; add `withRedirects(command, type, read: (nodes: TSNode[]) => T)` carrying the existing parse/`try`/`finally` boilerplate, and re-express `withRedirect` over it.
   Prepares step 3's `cat a > out.txt <> ~/rw.txt` case, which needs the first and third of three sibling `file_redirect` nodes from one parse — unreachable with a first-match finder.
   No assertion changes and no production change, so there is **no killing mutation**: the verification is that every existing test in the file stays green and both new helpers have a caller from this commit.
   Commit: `test(pi-permission-system): reach every matching redirect node in the analyzer tests`

2. **`refactor:` — name the unresolved-parse fact at the tree-sitter boundary.**
   Red: a new `describe("parseUnresolvedAt")` block in `test/access-intent/bash/parser.test.ts`, parsing real commands — `true` for `cat <> rw.txt` (error inside the node), `cat <> ~/rw.txt` (error in the preceding sibling), `cat 3<> rw.txt`, and `cat <>&1`; `false` for `cat a > out.txt`, `cat < in.txt`, `pnpm x 2>&1`, `cat a > $(mktemp)`, and the first redirect of `cat a > out.txt <> ~/rw.txt`.
   Green: widen `TSNode` with `hasError` / `previousSibling` and add `parseUnresolvedAt`; add the two defaults to `makeTSNode` in `test/helpers/fake-ts-node.ts` (the widening's only compile break).
   Nothing consumes the function yet, so nothing a user can observe changes — `refactor:`, not `feat:`.
   Killing mutations: (a) drop the `previousSibling` clause, returning `node.hasError` alone — the `cat <> ~/rw.txt` and `cat <>&1` cases go red, the rest stay green; (b) return `true` unconditionally — every `false` case goes red, including the mixed command's first redirect, which is what distinguishes this predicate from "the statement errored somewhere".
   Commit: `refactor(pi-permission-system): name the unresolved-parse fact at the tree-sitter boundary`

3. **`fix:` — an unresolvable redirect proves nothing about its destination.**
   The behavior change, pinned at both layers in one commit because they are one fact.
   Red, in `test/access-intent/bash/redirect-analysis.test.ts`: replace the four tests in `describe("a redirect the parser could not resolve")` with assertions that `cat <> rw.txt`, `cat <> ~/rw.txt`, `cat 3<> rw.txt`, and `cat 0<> ~/y` each prove `{ effect: "unproven", source: "unproven" }`, that the two spellings agree, and that in `cat a > out.txt <> ~/rw.txt` the first redirect keeps `{ effect: "write", source: "syntax" }` while the third is unproven (using `withRedirects` from step 1); add `cat <>&1` to the `redirectMayWriteFile` refusal block.
   Red, in `test/access-intent/bash/token-collection.test.ts`: `collectPathCandidateTokens` on `cat <> ~/rw.txt` emits `~/rw.txt` with an unproven effect, and on `cat <> rw.txt` emits `rw.txt` the same way.
   Green: the two `redirect-analysis.ts` edits from Design Overview, plus the docstring rewordings.
   Killing mutations, one per equivalence class: (a) delete the demotion in `redirectEffectForDestination`, returning the table answer directly — the six unresolvable-attribution assertions and both token-collection pins go red, and all ten operator tests stay green; (b) make the demotion unconditional for a non-`null` proof — the ten operator tests and the mixed command's `> out.txt` assertion go red; (c) delete the `parseUnresolvedAt` lead from `redirectMayWriteFile` — only `cat <>&1` goes red, which is the case the demotion alone cannot reach because that node carries no argument-shaped child; (d) move the demotion ahead of the `null` check — `pnpm x 2>&1` stops answering `null`.
   Commit: `fix(pi-permission-system): stop proving a read for a redirect the parser could not resolve`

4. **`docs:` — commit the instrument behind the measurement.**
   Add `packages/pi-permission-system/scripts/measure-unresolved-redirects.mjs`, following `measure-statement-operands.mjs`'s header conventions (transcribed vocabulary, measurement date, drift note, usage line).
   Verify by running it against the real review log and checking its reported figures against this plan's, allowing for log growth.
   Split from step 3 deliberately: the mechanism and the measurement have different failure modes and different verification instruments.
   Commit: `docs(pi-permission-system): commit the instrument behind the unresolved-redirect measurement`

5. **`docs:` — mark Step 12 complete and refresh the affected prose.**
   All six doc edits from Module-Level Changes: the two `architecture.md` module-tree rows, the Step 12 `✅` heading + Mermaid node + `Landed:` note, the `configuration.md` sentence, and the two `SKILL.md` sentences.
   Verify with `pnpm exec rumdl check` on each edited markdown file, and confirm the Mermaid graph still renders.
   Commit: `docs(pi-permission-system): mark Phase 14 Step 12 complete`

Run `pnpm run check`, `pnpm run lint`, `pnpm -r run test`, and `pnpm fallow dead-code` before the pre-completion review.
Count Biome warnings explicitly (`pnpm run lint >/tmp/l.log 2>&1; grep -c 'lint/' /tmp/l.log || true`) — warnings exit 0 and a redirected check reports PASS while they accumulate.

## Risks and Mitigations

| Risk                                                                                                                 | Mitigation                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The widened `TSNode` breaks a hand-built node fake somewhere the plan did not find                                   | Spiked at planning time: `tsc --noEmit` after the widening reported exactly one error, at `test/helpers/fake-ts-node.ts:20`. Step 2 re-runs `pnpm run check` before its commit                                                                                                                           |
| `previousSibling` returns a *named*-only sibling, so an anonymous node between the `ERROR` and the redirect hides it | Measured, not assumed: `previousSibling` is the raw sibling link (it returned `command "cat a"` for `cat a > out.txt`, an unnamed-inclusive relation), and the `ERROR` is a named node in every observed `<>` shape. Step 2's `false` cases include commands with `;` separators (`foo; cat <> ~/x.txt`) |
| The demotion silently weakens something, because "unproven" sounds weaker than "read"                                | It is strictly more restrictive: unproven consults both directional surfaces most-restrictive, a proof consults one. `mergeTokenEffects` already folds a disagreement to the same value. The change can add a prompt, never remove one — and the measurement found 0 commands newly prompting            |
| Deleting `redirectMayWriteFile`'s in-loop `ERROR` check re-opens the exemption for some shape                        | The lead refusal is strictly stronger than the deleted line (it also catches the sibling-split and no-argument-child cases the line missed). Killing mutation (c) in step 3 pins the difference with `cat <>&1`, a case the old code answered `false` for                                                |
| The `cat a > out.txt <> ~/rw.txt` fixture parses differently than the plan claims                                    | Verified twice against the real parser — by this session and independently by the Tidy-First assessor, which corrected an earlier two-node reading to the real three-sibling shape. The test reads nodes positionally from one parse rather than assuming a count                                        |
| The measured delta is read as a universal claim                                                                      | Scoped in the plan, in the roadmap `Landed:` note, and in the script header to one corpus, one cwd, and one config, with the method stated. The instrument ships so it can be re-run rather than argued with                                                                                             |
| `redirect-analysis.ts`'s type-only `TSNode` import becomes a value import and trips a lint rule                      | `import { parseUnresolvedAt, type TSNode } from "#src/access-intent/bash/parser"` is the established mixed form in this package; `token-collection.ts` already imports both values and types from sibling modules                                                                                        |

## Open Questions

None blocking.

The `TSNode` rename and the four-way `findNode` duplication are both recorded as deferred tidyings in the Planning stage note for `/plan-improvements` to sweep; neither is a prerequisite and neither is made harder by this change.

[#742]: https://github.com/gotgenes/pi-packages/issues/742
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#837]: https://github.com/gotgenes/pi-packages/issues/837
[#840]: https://github.com/gotgenes/pi-packages/issues/840
