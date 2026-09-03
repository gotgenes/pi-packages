---
issue: 814
issue_title: "pi-permission-system: a <> read-write redirect proves a read, and the answer depends on the filename"
---

# Retro: #814 — a `<>` read-write redirect proves a read, and the answer depends on the filename

## Stage: Planning (2026-09-03T18:59:41Z)

### Session summary

Planned Phase 14 Step 12 as `packages/pi-permission-system/docs/plans/0814-unresolvable-redirect-proves-nothing.md`.
The fix demotes a redirect whose parse `tree-sitter-bash` could not resolve to `UNPROVEN_EFFECT`, via a new `parseUnresolvedAt` reader exported from `parser.ts` and consulted by both of `redirect-analysis.ts`'s exported functions.
Five TDD steps: one preparatory test-helper commit from the Tidy-First assessor, a `refactor:` adding the predicate, the `fix:` itself, the measurement instrument, and the roadmap/doc refresh.

### Observations

- **The issue's own candidate shape 1 does not work as written.**
  "Detect an `ERROR` child on a `file_redirect` (or an `ERROR` sibling immediately preceding one)" was right in outline, but the parenthetical is the load-bearing half and the sibling is not always a bare `ERROR`.
  In `cat a > out.txt <> ~/rw.txt` the leftover `<` becomes its own `file_redirect "<"` carrying an error, not an `ERROR` node — so a type check on the previous sibling would miss it and `hasError` is what actually separates the cases.
  Measured against the real parser rather than reasoned about; the Tidy-First assessor independently re-derived the same three-sibling shape and corrected an earlier two-node reading in the design summary.
- **A second, unreported instance of the same defect turned up while looking for a killing mutation.**
  `cat <>&1` parses to `file_redirect ">&1"` whose only children are the unnamed `>&` and a `number "1"`, so `redirectMayWriteFile`'s loop finds nothing to refuse on and answers `false` today — clearing the wrapper-floor exemption for an unresolvable form.
  Looking for a mutation that would kill the planned `if (parseUnresolvedAt(redirect)) return true;` lead is what surfaced it: the lead looked redundant with the destination demotion until a shape with no argument-shaped child was found.
  Worth repeating as a technique — "what input distinguishes this line from the one next to it" is a defect finder, not just a test-quality check.
- **The breaking-vs-not call was settled by measurement, and the roadmap had precedents on both sides.**
  Step 16 took `fix!:` because it newly prompted on 3 of 5191 measured commands; Step 14 takes `fix:` at 0.02% measured cost.
  Running the real corpus (5296 distinct intact bash commands, 3353 carrying a redirect) put this at 1 changed attribution (0.019%) landing on a non-path token — `"tail": write → unproven` in ADR 0013's known-unparseable `git commit -F - <<'MSG' 2>&1 | tail -4` — and 0 newly prompting, which is squarely Step 14's side.
  Zero `<>` occurrences in the corpus at all.
- **Operator decision at the gate: the raw parse-tree navigation stays inside `parser.ts`.**
  The alternative considered was a private predicate in `redirect-analysis.ts` (smaller diff, keeps `parser.ts` lifecycle-only).
  The reasoning for the boundary module is that the sibling split is a fact about tree-sitter's error recovery rather than about redirects, so naming it beside the interface that declares `hasError` / `previousSibling` keeps a later walker from hand-rolling a chain.
- **Rejected alternatives, with the reason each was priced out.**
  Adding `<>` to the operator table (the issue's candidate 2) is dead code — the parser never yields `<>` as a single operator token.
  A coarser `redirect.parent.hasError` rule over-refuses: it would demote the genuine `> out.txt` in `cat a > out.txt <> ~/rw.txt`.
  Threading the sibling fact from each walker was rejected as a parameter relay across three call sites (`collectPathCandidateTokens`, `foldPipelineFirstStage`, `redirectedScope`), where a fourth walker added later would silently revert the fix.
  A `Redirect` value object was rejected as procedure relocation — it adds no collaborator and moves no behavior onto data.
- **The widening's blast radius was spiked rather than grepped.**
  Applying the two new `TSNode` members and running `tsc --noEmit` reported exactly one error, at `test/helpers/fake-ts-node.ts:20` — the shared-fixture constructor `AGENTS.md` names as the common miss for a new required interface field.
  The real web-tree-sitter `Parser` still satisfies the widened `TSParser` / `TSNode` structurally, which a grep could not have established.

#### Deferred tidyings

- `packages/pi-permission-system/src/access-intent/bash/parser.ts` — rename `TSNode` / `TSParser` / `makeTSNode` (and `test/helpers/fake-ts-node.ts`) to drop the ambiguous `TS` prefix; 8 `src/` files, 6 `test/` files, 3 `architecture.md` module-tree rows, 1 `SKILL.md` line.
  Raised by the operator at the planning gate and deferred: not preparatory, and it competes for the same files as Phase 14 Step 13's bulk `src/` reorganization ([#837]).
- `packages/pi-permission-system/test/access-intent/bash/redirect-analysis.test.ts` and its three siblings — four duplicate `findNode` implementations across `redirect-analysis.test.ts`, `token-collection.test.ts`, `nested-execution.test.ts`, and `shell-variable-expansion.test.ts`, plus a `findNodeOfType` variant.
  Flagged by the Tidy-First assessor and declined as scope creep: only the `redirect-analysis.test.ts` copy is on this change's path.

[#837]: https://github.com/gotgenes/pi-packages/issues/837

## Stage: Implementation — TDD (2026-09-03T19:42:55Z)

### Session summary

Executed all five planned TDD steps plus three follow-on commits (a fallow entry-point registration and two review-driven doc corrections), landing Phase 14 Step 12.
A redirect the parser could not resolve now proves nothing, via a single `parseUnresolvedAt` predicate in `parser.ts` that both of `redirect-analysis.ts`'s answers consult.
Test count went 4004 passed + 2 expected fail → 4029 passed (+25, and the two `it.fails` became real assertions).

### Observations

- **The plan's fourth killing mutation survived, and that was the most valuable finding of the session.**
  Moving the demotion ahead of the descriptor `null` answer killed nothing: both production callers filter to `ARG_NODE_TYPES`, so neither ever hands a descriptor node to `redirectEffectForDestination`, and the test helper filtered the same way.
  The docstring's claim that "the demotion applies to a proof, never to the `null`" was therefore unpinned.
  Added a test calling the function directly with `cat <>&1`'s `number` child — the only call shape that distinguishes the two orderings — and confirmed it kills the mutation.
  Counting reds against the plan's prediction is what surfaced this; a green suite looked identical either way.
- **The other three mutations killed exactly what the plan predicted** (5 and 8 reds for `parseUnresolvedAt`'s two mutations, 9 and 16 and 1 for the fix's).
  Mutation (c) — deleting `redirectMayWriteFile`'s up-front refusal — killed exactly one test, `cat <>&1`, which is precisely the case that proves the lead is not redundant with the demotion.
- **A second, unreported instance of the defect was found at plan time by hunting for that mutation.**
  `cat <>&1` parses to a redirect whose only children are the operator and a descriptor, so the old loop found nothing to refuse on and cleared the Step 3 wrapper-floor exemption.
  "What input distinguishes this line from the one beside it" is a defect finder, not only a test-quality check.
- **The shipped instrument corrected two of the plan's population figures.**
  The plan was written from an ad-hoc extraction; the established `measure-*.mjs` scripts key on `entry.toolName === "bash"` and the plan's "carrying a redirect" counted redirect *nodes*, including `2>&1`, which names no file.
  Corrected to 2619 of 5352 (48.9%), and the plan's claim of zero `<>` in the corpus was never actually checked — the literal appears 13 times, all as quoted text, several from this issue's own investigation sessions.
  The load-bearing numbers (1 changed attribution, 0 newly prompting) did not move, so the `fix:` classification held.
- **Two deviations from the plan's file list**, both required rather than discretionary: `packages/pi-permission-system/package.json` gained a `measure:unresolved-redirects` script, because `fallow dead-code` reports an unregistered `scripts/*.mjs` as an unused file and the repo's convention (precedent `e3e87993`) is to register rather than suppress.
  The mixed-redirect fixture's stranded middle node answers `unproven` rather than `null` — it is recovered with a zero-width destination, which the plan did not predict.
- **Pre-completion reviewer: WARN, then WARN, both non-blocking, both worth fixing.**
  Round 1 found the accepted residual documented as if it were about `<>` when the predicate asks about the parse, and supplied a reproducer (`cat $(( > out.txt`) where a well-formed `> out.txt` is demoted because an unrelated recovery failure precedes it.
  Fixed by pinning that population as tests and restating the mechanism in the docstring, the `Landed:` note, and the package skill.
  Round 2, scoped to that delta, found the internal docs corrected while `docs/configuration.md` — the one surface a user reads — still claimed the rule was about the redirect's own syntax, which is false of exactly the case it needs to predict.
  Fixed, with the bound verified against the real parser first: the demotion reaches the immediate neighbour and no further.
- **The final commit (`ed0182bc`) is self-verified rather than reviewer-verified.**
  It is the one-sentence user-doc fix round 2 asked for; a third dispatch would have reviewed the reviewer's own instruction.
  Verified by re-running all four deterministic gates, reading the whole section for heading reparenting, scanning the diff for non-ASCII, and independently checking the "a later statement keeps its proof" claim against the parser before writing it into a user doc.
- **Watch for stray non-ASCII in generated prose.**
  Two CJK characters appeared in a test comment mid-draft and were caught only because the region was re-read.
  `rg -n '[^\x00-\x7f]'` filtered against the repo's legitimate em-dashes and box-drawing rules is a cheap standing check after any comment-heavy edit.
