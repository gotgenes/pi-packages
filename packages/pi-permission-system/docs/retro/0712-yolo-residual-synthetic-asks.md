---
issue: 712
issue_title: "pi-permission-system: yolo mode prompts for wrapper-floored and unparseable bash asks"
---

# Retro: #712 — pi-permission-system: yolo mode prompts for wrapper-floored and unparseable bash asks

## Stage: Planning (2026-08-14T21:50:48Z)

### Session summary

Traced the reported bug (yolo prompting for wrapper-floored and unparseable bash asks) through `resolveBashCommandCheck` → `GateRunner`, then reproduced it live with a throwaway composition-root spike that ran the real factory under `yoloMode: true` and captured `ui.select` titles.
The spike confirmed both reported cases and surfaced a third, yolo-independent defect: the `<unparseable-bash-command>` branch never consults the resolver, so an explicit `bash` `deny` is masked into an approvable prompt.
Wrote `docs/plans/0712-yolo-residual-synthetic-asks.md` — four TDD cycles (deny consult, gate-level yolo grant, end-to-end repro pin, docs) shipping independently.

### Observations

- The issue is third-party (`maertayn`) and re-files [#570], which was closed NOT_PLANNED for provenance, not merit.
  The `ask_user` gate confirmed all three open decisions at once: fix it, place the reconciliation at the `GateRunner` choke point, fold the deny-masking fix into the same plan.
- Measurement beat argument: the spike (`makeFakePi` + real factory + a UI ctx that records prompt titles) produced the exact prompt string from the issue, and probing for a genuinely unparseable command showed `cat <<'EOF'` parses fine while `> out.txt` and `2>&1` hit the sentinel.
  Both facts are in the plan as measured rows, not inferences.
- Design tension named in the plan: `docs/architecture/architecture.md` § "yolo is recorded authority" claims the decision path loses all yolo knowledge, and `PermissionPrompter`'s docstring claims no `ask` reaches it under yolo.
  Both are false today; the floors are per-parse, not per-pattern, so no rules-only fix exists and the doc claims must be amended.
- Blast radius of the runner-level catch-all was enumerated rather than assumed: every `preCheck` source already flows through the yolo-rewritten resolver, `synthesizeDefaults` guarantees the `evaluate()` builtin fallback never surfaces, and only `describeSkillReadGate`'s `preResolved` can carry a non-ruleset `ask` (a stale skill entry after a mid-session yolo toggle).
- Rejected alternatives recorded: reconciling inside `resolveBashCommandCheck` (three-layer parameter relay, contract still unenforced) and selecting an auto-approving `TerminalAuthorizer` under yolo (breaks the single `auto_approved` review-entry parity from [#526]).
- Deferred without filing: yolo parity on the advisory path (`resolveBashAdvisoryCheck`).
  The discrepancy is in the safe direction — advisory stricter than the gate — and no known consumer depends on it.
- Two existing assertions (`expect(resolver.resolve).not.toHaveBeenCalled()` in `bash-command.test.ts` and `bash-advisory-check.test.ts`) invert with the deny consult; the implementation session should expect that, not treat it as a regression.

[#452]: https://github.com/gotgenes/pi-packages/issues/452
[#481]: https://github.com/gotgenes/pi-packages/issues/481
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#526]: https://github.com/gotgenes/pi-packages/issues/526
[#570]: https://github.com/gotgenes/pi-packages/issues/570

## Stage: Implementation — TDD (2026-08-14T22:07:49Z)

### Session summary

Landed one tidy-first preparatory commit plus the plan's three TDD cycles and the doc commit: the unparseable branch now resolves the whole command and returns an explicit `deny` before synthesizing its sentinel `ask`, and `GateRunner` grants any residual `ask` under yolo through the new pure `resolveYoloGrant` helper, wired from a single `isYoloEnabled` reader in `index.ts` shared with `PermissionManager`.
Five composition-root tests drive the real factory over the issue's literal repro (`git status | xargs grep foo` and `> out.txt`), covering yolo-on, yolo-off, and explicit-deny.
The `pi-permission-system` suite went 2769 → 2784 tests; check, root lint, and `pnpm fallow dead-code` are green.

### Observations

- The `tidy-first-assessor` found one Recommended prep: `resolveBashCommandCheck` already resolved the whole command inline at two sites and the fix would have added a third, so `resolveWholeCommand` was extracted first (`refactor:`).
  That is the only deviation from the plan's file list, and it made the step-1 diff a single call.
  The assessor's Optional item (a shared `() => false` reader across the three `GateRunner` test fixtures) was declined as the plan predicted.
- The plan's two predicted assertion inversions (`expect(resolver.resolve).not.toHaveBeenCalled()` in `bash-command.test.ts` and `bash-advisory-check.test.ts`) landed exactly as described; no other existing assertion moved, and the [#526] yolo-origin runner test was left untouched to hold review-log parity.
- The advisory path inherits the deny consult for free (it shares `resolveBashCommandCheck`), so a denied unparseable command now reports `deny` there too — an extra test pins it.
  The advisory path's yolo discrepancy remains deferred and unfiled per the plan's Open Questions.
- Pre-completion reviewer: WARN (no FAILs).
  Finding 1 — the `runner.ts` module-tree entry cited `#712` as bare provenance; fixed by rewording to the constraint itself ("the sole place a post-resolution ask is reconciled with yolo") and amended into the docs commit.
  Finding 2 — the plan's deferred advisory-parity question carries no issue number; left as an accepted, reasoned deferral recorded in the plan.
- Reviewer confirmed the [#452] fail-closed, [#481]/[#490] wrapper-floor, and [#526] parity invariants survive by diff, not prose.

## Stage: Final Retrospective (2026-08-15T00:35:32Z)

### Session summary

One Pi session carried #712 from planning through ship: a third-party bug report was verified with a live composition-root spike, planned as four cycles, implemented with one tidy-first preparatory commit, and released as `pi-permission-system@25.2.1`.
The spike found a second, unreported defect (an explicit `bash` `deny` masked by the `<unparseable-bash-command>` synthetic ask), which became the first TDD cycle and a prerequisite for the yolo grant.
Suite went 2769 → 2784 tests; both CI runs (push and release) were green, and the issue closed with a behavior summary.

### Observations

#### What went well

- The planning-time spike was an instrument, not a formality.
  Running the **real factory** through `makeFakePi` with a `ui.select`-recording ctx reproduced the issue's exact prompt string, then a ten-command probe batch established which inputs actually reach the unparseable branch (`> out.txt` and `2>&1` do; `cat <<'EOF'`, `((1+1))`, and `arr=(1 2 3)` all parse normally).
  The same harness then exposed the deny-masking hole — an adjacent defect the report never mentioned — exactly as [#493]'s live repro exposed [#507].
- The `tidy-first-assessor` beat the plan's own design review.
  The plan ran the `design-review` checklist and still missed that `resolveBashCommandCheck` already inlined the same five-field whole-command resolve twice and the fix would add a third; the assessor caught it from the *upcoming* diff and the extraction landed first (`2e9f6db2`), turning cycle 1's change into a one-line call.
- Bundling the third-party gate paid off: direction, placement, and the deny-masking scope question went into a single `ask_user` call after a measured-evidence message, and no follow-up question was needed for the rest of the session.
- Every predicted breakage landed as predicted — both `expect(resolver.resolve).not.toHaveBeenCalled()` inversions and the [#526] parity test staying untouched — so the TDD stage produced no unplanned rework.

#### What caused friction (agent side)

1. `other` — the first spike run printed nothing: Vitest's default reporter hides `console.log` from passing tests, so the measurement had to be re-run with reporter flags.
   Impact: one wasted run plus one re-run; no rework.
   A follow-up measurement this session pinned the actual cause — `--silent=false` alone still hides the log; `--reporter=verbose` is what surfaces it.
2. `instruction-violation` (self-identified) — the `architecture.md` doc edit carried stray `oldText2`/`newText2` keys in one `edits[]` entry, the exact trap `AGENTS.md` § Edit tool batches documents.
   Impact: none — the keys were empty and all four intended blocks applied, verified by counting reported blocks against intended edits.
   Evidence the rule is correct but low-salience mid-flow.
3. `missing-context` — the new `resolveYoloGrant` test block was written against invented fixture names (`makeAllow`/`makeAsk`) instead of the builders `helpers.test.ts` already uses, and the corrective `Edit` then failed to match because `pi-autoformat` had reflowed the just-written block.
   Impact: three extra tool calls (rejected edit → re-read → five-entry corrective batch).
   Both halves are documented rules — check the file's existing conventions first, and re-read a region you just edited.
4. `other` — the composition-root tests were appended with a shell heredoc, which bypasses the `pi-autoformat` hook that fires on `Edit`/`Write`; `pnpm run lint` then failed on formatting and needed `pnpm exec biome check --write`.
   Impact: one failed lint plus one fix call.
   The "no heredoc" rule exists in the repo but is scoped to markdown.
5. `other` — a brief false start at ship time ("need to check where #737's commits end") over the release range, self-corrected in the same turn.
   Impact: one extra tool call.
6. `other` — a `Read` call used a doubled package path (`pi-packages` dropped), which the extension under test denied with a corrective message.
   Impact: one wasted call; mildly instructive that `external_directory` caught it.

#### What caused friction (user side)

- Nothing material.
  The three `ask_user` answers were decisive and unblocked the whole session; the operator's involvement was strategic (direction, placement, scope) rather than mechanical.
- Small opportunity: #712 re-files a NOT_PLANNED issue whose "verified patch" lives on a fork.
  An upfront steer ("treat the linked patch as reference, not a merge candidate") would have saved fetching [#570]'s body — one tool call — though the issue body did carry the provenance.

### Diagnostic details

- **Model-performance correlation** — the plan/TDD/ship turns ran on `anthropic/claude-sonnet-5`; the retrospective stage on `anthropic/claude-opus-5`.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) declare `anthropic/claude-sonnet-5` and both did judgment-heavy work (preparatory-refactor design, invariant verification by diff).
  No mismatch in either direction.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; the longest streak on a single error was two calls (the rejected `Edit`), far below the five-call escalation threshold.
- **Unused-tool detection** — no `Explore` dispatch was warranted: the issue supplied a numbered source trace, which the plan prompt keeps inline.
  `colgrep` went unused because every hunt was exact-symbol (`state: "ask"`, `new GateRunner`, `<indirection-bash-wrapper>`) — the case the `colgrep` skill's decision table assigns to `grep`.
- **Feedback-loop gap analysis** — verification was incremental, not end-loaded: per-cycle `vitest run <file>`, `pnpm run check` before each commit, the full package suite after cycles 1 and 2, and root `lint` + `fallow dead-code` both at the end of the TDD stage and again as pre-push gates.
  The one gap was formatting, caught only by the end-of-cycle lint (friction point 4).

### Changes made

1. `AGENTS.md` § Tool-injected messages — recorded that `pi-autoformat` fires on `Edit`/`Write` only, so a heredoc-appended source file skips formatting and fails `pnpm run lint`.
2. `.pi/skills/package-pi-permission-system/SKILL.md` Debugging rule 5 — widened the live-repro trigger from a claimed bypass to any report of a concrete prompt or decision the gate should not have produced, citing this issue alongside [#493]/[#507].
3. `.pi/skills/testing/SKILL.md` — replaced the spike-output guidance with the measured fix (`--reporter=verbose`; `--silent=false` alone does not surface the log), keeping file-writing for output that must outlive the run.

[#493]: https://github.com/gotgenes/pi-packages/issues/493
[#507]: https://github.com/gotgenes/pi-packages/issues/507
