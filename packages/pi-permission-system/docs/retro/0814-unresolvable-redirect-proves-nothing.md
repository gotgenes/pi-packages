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
