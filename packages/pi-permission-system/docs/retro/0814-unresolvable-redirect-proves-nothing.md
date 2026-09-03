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
- **The final commit (`9e57a909`) is self-verified rather than reviewer-verified.**
  It is the one-sentence user-doc fix round 2 asked for; a third dispatch would have reviewed the reviewer's own instruction.
  Verified by re-running all four deterministic gates, reading the whole section for heading reparenting, scanning the diff for non-ASCII, and independently checking the "a later statement keeps its proof" claim against the parser before writing it into a user doc.
- **Watch for stray non-ASCII in generated prose.**
  Two CJK characters appeared in a test comment mid-draft and were caught only because the region was re-read.
  `rg -n '[^\x00-\x7f]'` filtered against the repo's legitimate em-dashes and box-drawing rules is a cheap standing check after any comment-heavy edit.

## Stage: Sync (worktree) (2026-09-03T20:38:48Z)

### Session summary

Pre-push checks both green from a clean worktree: `pnpm run lint` (0 findings) and `pnpm fallow dead-code` (0 issues, 326 entry points).
Plan's `**Release:** ship independently` — no batch, no deferral, ready to release at the root's discretion once landed.
One open item for the root: the TDD stage's final commit (`9e57a909`, a `docs/configuration.md` correction) was self-verified rather than reviewer-dispatched, noted in that session's own summary as worth a third pre-completion round if desired before shipping.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-814--/2026-09-03T17-53-52-242Z_01a06867-dc72-7ee6-beb5-e9c8f002d272.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Nothing else to add beyond the TDD stage's own notes — no rebase performed yet (next step), no new findings from the pre-push run itself.

## Stage: Final Retrospective (2026-09-03T21:16:31Z)

### Session summary

Landed the peer branch on `main` by fast-forward, verified CI, closed #814, released `pi-permission-system-v31.0.1`, and tore down the worktree.
The ship half itself was uneventful — every prediction gate (`git merge-base --is-ancestor`, `next-version.sh`) agreed with what followed, and no step had to be retried.
The retrospective's substantive finding is not in the ship mechanics but in a SHA-provenance defect the worktree flow creates by construction.

### Observations

#### What went well

- **The prediction-before-action gates all held.**
  `git merge-base --is-ancestor main <branch> && echo ff-ok` predicted the fast-forward, `./scripts/release/next-version.sh pi-permission-system` predicted `pi-permission-system-v31.0.1`, and both matched exactly.
  Nothing in the ship half was discovered by attempting it.
- **Two `pre-completion-reviewer` rounds each returned an actionable WARN, and the second found what the first's own fix missed.**
  Round 1 flagged the residual documented as a `<>` fact when the predicate is a parse fact; the fix corrected the docstring, the `Landed:` note, and the package skill.
  Round 2, scoped to that delta, found `docs/configuration.md` — the one surface a user reads — still carrying the false claim.
  The "re-dispatch scoped to the delta after a substantive post-review commit" pattern is what caught it; a single round would have shipped a user-facing doc that is wrong about exactly the case it needs to predict.
- **Model assignment tracked task type across all four stages without intervention.**
  Planning and TDD ran on `anthropic/claude-opus-5` (design judgment, mutation analysis, reviewer triage); the sync stage and the ship stage ran on `anthropic/claude-sonnet-5` (mechanical gates, git plumbing); this retrospective on `anthropic/claude-opus-5`.
  No stage was under- or over-modeled.
- **The peer's in-chat handoff was more accurate than its own committed artifact**, and noticing the divergence is what surfaced the finding below.
  Its sync report named `9e57a909` (computed after the rebase); its committed stage note named `ed0182bc` (written before it).

#### What caused friction (agent side)

- `instruction-violation` (retro-identified — not caught mid-session, not user-caught) — ran `git rev-parse <ref> | wc -c` twice (once on `HEAD`, once on `0327feb9`) to confirm a 40-character SHA.
  `AGENTS.md` names this exact anti-pattern: "Do not spend a tool call measuring the shape of a deterministic command's own output — `git rev-parse` emits exactly 40 hex characters, so `| wc -c` on it tests git, not your work" (Refs #839).
  Worse than the wasted calls, the shape check **displaced** the check that was actually required: `/ship-worktree` step 5 asks to re-resolve every hex token *in the finished draft*, which is where a mistyped hash enters.
  Impact: 2 wasted tool calls; no rework, because the SHA happened to be correct.
  This is a compliance miss against an existing crisp rule, not a gap in it.
- `missing-context` — quoted `ed0182bc` from the retro breadcrumb straight into the published ship report without checking it against `main`.
  That SHA is a **pre-rebase** object: `git merge-base --is-ancestor ed0182bc main` fails, `git branch --contains ed0182bc` is empty, and `git patch-id --stable` confirms it is the same patch as `9e57a909`, which is the SHA that actually landed.
  It resolves today only because the unreachable object has not been garbage-collected.
  Impact: the ship report names a commit not in `main`; the TDD and Sync stage notes above carried the same dead SHA until this retrospective corrected both to `9e57a909`.
  No rework, but the published ship report stays wrong.

#### The structural cause, and why the existing rule does not catch it

The worktree flow invalidates its own citations by construction.
`/sync-worktree` writes the sync stage note (step 3) and *then* rebases (step 4), so every branch SHA any stage note carries — the sync note's own, and the earlier TDD note's, both authored inside the worktree — is rewritten by the very next step.
The rebase here was clean and reordered nothing, and it still renamed all twelve commits.

`AGENTS.md` already requires resolving every published SHA with `git rev-parse` (Refs #777), and `/ship-worktree` step 5 and `/ship-issue` step 5 both restate it.
That rule is **insufficient here**: `git rev-parse ed0182bc^{commit}` succeeds on a dangling object.
Resolution proves existence; only reachability (`git merge-base --is-ancestor <sha> main`) proves the commit landed.
On trunk the two coincide, which is why the gap has not shown up before.

#### What caused friction (user side)

Nothing.
The operator's only involvement was invoking the two commands, which is the correct level for a ship stage where every gate is deterministic.
The one judgment call the flow surfaced — the peer's self-verified final commit, offered for a third reviewer round — was raised by the peer, re-raised in the ship report, and reasonably left alone; CI was green and the commit was a one-sentence user-doc correction.

### Diagnostic details

- **Model-performance correlation** — no mismatch.
  Peer session (`01a06867`): planning + TDD on `anthropic/claude-opus-5`, sync stage on `anthropic/claude-sonnet-5`.
  Root session: ship on `anthropic/claude-sonnet-5`, retrospective on `anthropic/claude-opus-5`.
  Both `pre-completion-reviewer` dispatches ran from the opus TDD stage on the agent's own configured model.
  The documented phantom-switch hazard reproduced exactly: a `types: ["model_change"]`-filtered read of the peer session renders three transitions (`opus → sonnet → opus`) where the unfiltered read shows two model regions and no opus turn after the sonnet ones (Refs #737).
  The prompt's existing warning was sufficient — attribution was taken from the unfiltered read.
- **Escalation-delay tracking** — no `rabbit-hole` friction points in the ship session; longest same-target run was 2 calls.
  The peer session's one extended sequence (6 calls investigating how `fallow dead-code` treats an unregistered `scripts/*.mjs`) resolved correctly by finding the repo's precedent commit `e3e87993` rather than reaching for a suppression, so the length bought the right answer.
- **Unused-tool detection** — nothing was needed that was not used.
  The `ed0182bc` finding required no subagent or search tool, only one reachability check the flow does not currently ask for.
- **Feedback-loop gap analysis** — not applicable to the ship stage, which runs no local gates by design (the peer ran `pnpm run lint` and `pnpm fallow dead-code` before handoff; CI re-ran the full set on the merge commit and passed).
  In the peer session the four gates ran after each substantive commit rather than only at the end.

### Changes made

1. `.pi/prompts/sync-worktree.md` — step 3 now forbids citing a branch commit SHA in the sync stage note, since step 4's rebase rewrites every one.
2. `.pi/prompts/ship-worktree.md` — step 5 now requires `git merge-base --is-ancestor <sha> main` for a SHA quoted from the plan or a stage note, because `git rev-parse` succeeds on an unreachable pre-rebase object.
3. `.pi/prompts/ship-worktree.md` and `.pi/prompts/ship-issue.md` — dropped `40-char` from the SHA-capture step; the phrase primed the `git rev-parse | wc -c` shape check `AGENTS.md` forbids (Refs #839).
4. `packages/pi-permission-system/docs/retro/0814-unresolvable-redirect-proves-nothing.md` — corrected the dangling `ed0182bc` citation to the landed `9e57a909` in the TDD and Sync stage notes, and appended this Final Retrospective entry.

#### Recorded as a follow-up, not implemented

Reordering `/sync-worktree` to rebase **before** writing the stage note would remove the hazard at its source rather than routing around it.
It changes the command's step order and the "note must ride the branch" invariant, so it is issue-sized rather than retro-sized.
The two prompt guards above make the current order safe in the meantime.
