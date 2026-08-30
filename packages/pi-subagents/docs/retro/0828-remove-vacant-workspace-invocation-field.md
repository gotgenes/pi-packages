---
issue: 828
issue_title: "pi-subagents: remove the vacant WorkspacePrepareContext.invocation field from the workspace seam"
---

# Retro: #828 — Remove the vacant `WorkspacePrepareContext.invocation` field

## Stage: Planning (2026-08-30T05:06:57Z)

### Session summary

Planned Phase 22 Step 4: deleting the unread `invocation` field from `WorkspacePrepareContext` and the whole storage chain that fed it (`AgentSpawnConfig` → `SubagentInit` → `Subagent` → the seam), plus the two tool-door producers.
Verified the hard dependency on [#724] is satisfied (closed and landed; the widget filter now reads `Subagent.isBackground`), measured the chain at 7 live sites against the roadmap's baseline of 8, and confirmed the plan's release position as the `front-door-majors` batch tail.
Plan committed at `packages/pi-subagents/docs/plans/0828-remove-vacant-workspace-invocation-field.md`; no follow-up issues filed.

### Observations

- **Two of the issue body's own claims were refuted by measurement.**
  The issue asserts that `pnpm fallow dead-code` (a CI gate) fails on a partial removal, forcing the whole chain into one commit.
  A spike that removed the seam field and the `prepare({...})` key while leaving the rest of the chain in place ran green on `tsc`, `fallow dead-code`, and the full 101-test `subagent.test.ts` file.
  The plan therefore lands the chain in one commit for coherence — a half-removed chain leaves exactly the stored-and-unread field the issue exists to delete — and explicitly records that no gate would have caught it.
- **The `tidy-first-assessor` returned "no preparatory tidying warranted" and one universal claim that was wrong.**
  It asserted that `toHaveBeenCalledWith` "asserts deep equality of the full call-argument object", so the existing `subagent.test.ts` seam-context test pins the shape and is the regression guard.
  It does not: `toHaveBeenCalledWith` compares with `toEqual` semantics, which ignore an explicitly-`undefined` key.
  A two-case probe confirmed both directions (`toHaveBeenCalledWith({a,b,c:undefined})` passes against a call of `{a,b}`; `toStrictEqual` distinguishes them).
  This is the `AGENTS.md` pattern about a subagent's universal claim being the one to verify — the assessor's line-number corrections were all correct, and its one behavioral generalization was not.
- **The plan's central design decision came out of that refutation.**
  Step 1 replaces the assertion with `toStrictEqual` on `mock.calls[0][0]`, which gives the step a killing mutation that actually fires.
  Without the probe the plan would have deleted a key from a green assertion and shipped a guard that could not see the field return.
- **Release position confirmed by reading the sibling plan, not by inferring it.**
  `docs/plans/0829-locked-fields-precedence.md:440` states the case directly — hold the release PR until #828's commit joins it — and PR #842 (`chore(main): release pi-subagents 21.0.0`) is open against a published 20.1.0.
  The batch's own line names Step 3 the tail, but Step 3 landed first and deferred, so this issue is the last remaining member.
- **Operator decisions at the clarification gate.**
  `ADR 0005`'s display-snapshot exclusion bullet is amended in place (its only named instance is being removed), and the now-vacuous `not.toHaveProperty("invocation")` assertion in `service-adapter.test.ts` is deleted rather than kept as a re-entry guard.
  The `pi-subagents-worktrees` fixture line is included as its own `test(...)` step, and the plan stays filed under `packages/pi-subagents/docs/plans/` despite touching a second package's test file.
  Follow-up question answered: the worktrees commit is a hidden changelog type touching only `test/`, so it creates no competing release PR and does not affect that package's tarball.
- **One scope note recorded as a Non-Goal rather than a follow-up issue.**
  A purpose-built per-call seam shape (`isBackground`, `model: Model`, `maxTurns`) is deliberately not filed — filing it would re-create the vacant hook in the tracker instead of the type.
  The `BREAKING CHANGE:` footer is the intake path.

#### Deferred tidyings

None — the `tidy-first-assessor` recommended no preparatory commits and rejected nothing as scope creep, finding no unrelated cleanup in any of the eleven target files.

## Stage: Implementation — TDD (2026-08-30T05:24:43Z)

### Session summary

Executed all three plan steps in order: the atomic `refactor(pi-subagents)!:` chain removal with its strengthened seam-context pin, the `pi-subagents-worktrees` fixture cleanup, and the doc updates (ADR 0005 bullet, Phase 22 Step 4 `✅` on both heading and Mermaid node, metric row `0 ✅`).
Test count is unchanged at 1337 (pi-subagents) and 62 (worktrees) — the deleted assertions lived inside tests that survive, and the one rewritten test replaced a matcher rather than adding a case.
The `invocation` storage-chain metric row went 7 → 0 (roadmap baseline 8; Step 1 had already taken one), and `dist/public.d.ts` now shows `WorkspacePrepareContext` with exactly three fields.

### Observations

- **The plan's central prediction held, including its negative half.**
  Killing mutation A (re-add `invocation: this.invocation` to the `prepare({...})` literal) turned exactly one test red — the rewritten `toStrictEqual` pin.
  Killing mutation B (re-add the field to `WorkspacePrepareContext` alone) was a no-op across `tsc`, the full 1337-test suite, and `pnpm fallow dead-code`, exactly as the plan predicted and recorded as a known non-covered class.
  Predicting the no-op in advance is what made it a finding rather than a surprise.
- **The Red step paid for itself immediately.**
  Writing the `toStrictEqual` assertion against the *unchanged* code produced a red that named the extra `invocation` key directly.
  Had the step merely deleted `invocation: undefined` from the existing `toHaveBeenCalledWith` literal, it would have gone green without ever demonstrating that the assertion discriminates.
- **The issue body's gating claim stayed refuted under a second, independent derivation.**
  The `pre-completion-reviewer` re-ran the partial-removal probe by hand rather than accepting the plan's measurement, and confirmed `tsc`, `fallow dead-code`, and the suite all pass with the vacant field restored to the type alone.
  It also verified the matcher asymmetry both ways — the new form red under mutation A, the old form green under the same mutation.
  The architecture doc's `Landed:` note records the refutation so the next reader does not inherit the wrong premise.
- **No deviations from the plan.**
  Every file in the plan's Module-Level Changes tables was touched and nothing else; the changelog preview over `feat|fix` subjects is empty, as intended for a `refactor!:`-carried breaking change.
- **One typing detail resolved during implementation.**
  The rewritten pin declares its own `vi.fn((_ctx: WorkspacePrepareContext) => ...)` instead of reusing the file's `makeWorkspaceProvider` helper, so `prepare.mock.calls[0][0]` is reachable and typed without the `ReturnType<typeof vi.fn>` cast the neighbouring factory assertion still uses.
  This required importing `WorkspacePrepareContext` into the test file.
- **Pre-completion reviewer: PASS.**
  No WARN findings.
  It independently re-derived the removal's completeness, `AgentInvocation`'s survival through `spawn-config.ts` → `display.ts`, both deleted assertions, the mutation result, the fallow claim, and the `BREAKING CHANGE:` footer's factual claims (including `modelName`'s derivation and `refactor`'s `hidden: true` status in `release-please-config.json`).
  It also ran `mmdc` over `architecture.md`'s six charts.

### Release note

This issue is the `front-door-majors` batch tail.
Release PR #842 (`chore(main): release pi-subagents 21.0.0`) is open against a published 20.1.0 and has been held for this commit; `/ship-worktree` should merge it after the land.

## Stage: Sync (worktree) (2026-08-30T05:38:50Z)

### Session summary

Root-level `pnpm run lint` and `pnpm fallow dead-code` both pass clean from the worktree.
`origin/main` had not moved since the branch was cut (`git rev-list --left-right --count origin/main...HEAD` showed 0 behind, 6 ahead), so the rebase in step 4 is expected to be a no-op fast-forward, not an actual replay.
No work is deferred to the root: the plan's `**Release:**` marker is `ship now — batch "front-door-majors" tail`, and PR #842 (`chore(main): release pi-subagents 21.0.0`) is the release vehicle to merge after landing.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-828--/2026-08-30T04-37-23-136Z_01a050f5-3840-7e8d-9ac1-a87703338600.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

None beyond the above — a clean, quiet sync with no conflicts expected.

## Stage: Final Retrospective (2026-08-30T06:02:43Z)

### Session summary

Shipped #828 across four stages in two sessions: planning and TDD in the peer worktree, then sync (peer) and ship (root).
The branch fast-forwarded onto `main` with no conflicts, CI passed on `0df19d58`, issue #828 closed, and release PR #842 merged to cut `pi-subagents-v21.0.0` — the `front-door-majors` batch tail.
One operator correction across the whole issue, and it exposed a real prompt defect rather than a modeling slip.

### Observations

#### What went well

- **The #843 model pin worked on its first real exercise.**
  #843 landed the `model: anthropic/claude-sonnet-5` frontmatter on `sync-worktree.md` and `ship-worktree.md` in commit `36952029`, immediately before this issue's plan commit `f85aba1e`.
  This issue is the first to run under it, and the split held exactly as designed: planning and TDD on `anthropic/claude-opus-5` (judgment-heavy), sync and ship on `anthropic/claude-sonnet-5` (procedural).
  Nothing in either sonnet stage needed escalation.
- **Two of the issue body's own claims were refuted by measurement, and the second one became the design.**
  The planning session spiked a partial removal to refute the claim that `pnpm fallow dead-code` gates it, then probed `toHaveBeenCalledWith` semantics after `tidy-first-assessor` asserted it "asserts deep equality of the full call-argument object".
  It does not — `toEqual` semantics ignore an explicitly-`undefined` key — so Step 1 rewrote the pin as `toStrictEqual` on `mock.calls[0][0]`.
  Without that probe the step would have deleted a key from a green assertion and shipped a guard blind to the field's return.
  This is `AGENTS.md`'s "a subagent's universal claim is the one to verify" paying off on a concrete, load-bearing claim.
- **A predicted negative result stayed a finding instead of a surprise.**
  The plan named mutation B (re-add the field to `WorkspacePrepareContext` alone) as an expected no-op across `tsc`, the suite, and `fallow`, and it was.
  Predicting the non-covered class in advance is what let the architecture doc's `Landed:` note record it as a refutation rather than a gap discovered late.
- **The `pre-completion-reviewer` re-derived rather than accepted.**
  It re-ran the partial-removal probe and the matcher asymmetry by hand instead of trusting the plan's measurements, and verified the `BREAKING CHANGE:` footer's factual claims including `refactor`'s `hidden: true` status in `release-please-config.json`.
  PASS with no WARN findings.

#### What caused friction (agent side)

- `instruction-violation` (user-caught) — at the end of the TDD stage the peer session named `/ship-worktree 828` as the next step, skipping `/sync-worktree 828` entirely.
  The operator caught it with "Wait what about /sync-worktree".
  The root cause is in the prompt, not the reasoning: `.pi/prompts/tdd-plan.md:207` ends with an unconditional "The next step is `/ship-issue`.", even though line 15 of the same file already branches on a worktree branch and names `/sync-worktree`.
  The agent correctly rejected the literal `/ship-issue` because it knew it was in a worktree, then guessed the wrong half of the two-command worktree flow.
  `.pi/prompts/build-plan.md` carries the identical defect at line 170.
  Impact: one corrective operator turn, no rework — the agent self-diagnosed accurately once prompted and the sync ran clean.
- `other` (near-miss, zero impact) — the planning session opened one bash call with a bare `rg -rn 2>/dev/null`, the exact `--replace` trap `AGENTS.md` warns about.
  It carried no pattern, no path, and its output was discarded, so no file was rewritten.
  Impact: none; the rule already exists and needs no change.

#### What caused friction (user side)

- None.
  The one intervention was a redirecting question ("Wait what about /sync-worktree") rather than a correction, which is the cheaper of the two forms — it let the agent locate its own error and the prompt defect behind it.
  The planning gate's follow-up on the `pi-subagents-worktrees` release question was answered promptly and settled the single-vs-cross-package filing decision in one exchange.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5`; sync and ship ran on `anthropic/claude-sonnet-5` (pinned by #843); this retrospective on `anthropic/claude-opus-5`.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5` per their frontmatter.
  One mismatch worth noting: `tidy-first-assessor` on sonnet-5 produced a wrong universal claim about Vitest matcher semantics while all its line-number corrections were right.
  The failure mode is behavioral generalization about a framework, not file reading — consistent with the existing guardrail, and it was caught, so no model change is indicated.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; no sequence exceeded two tool calls on the same question.
- **Feedback-loop gap analysis** — no gap.
  The TDD session established a full green baseline (`check`, root `lint`, `test`, `fallow dead-code`) before writing any code, ran `check` plus the affected file after each step, and re-ran the full gate set at end-of-cycle.
  `verify:public-types` was run before the breaking commit, and `dist/public.d.ts` was inspected directly to confirm the shipped three-field interface.

The **unused-tool detection** lens is skipped — it applies to `rabbit-hole` and `missing-context` friction points, and this issue had neither.

### Changes made

1. `.pi/prompts/tdd-plan.md:207` — replaced the unconditional terminal `The next step is /ship-issue.` with a worktree-aware line naming `/sync-worktree <N>` for an `issue-<N>-*` branch.
2. `.pi/prompts/build-plan.md:170` — the same replacement; the file carried the identical defect.
3. `.pi/prompts/ship-issue.md` — added a `## 0. Confirm you are on trunk` branch guard mirroring `/ship-worktree`'s step 0, and folded the existing `set_session_name` instruction in after it so a mis-invocation stops before any work.
   `AGENTS.md` already declared `/ship-issue` trunk-only, but the prompt had no guard while both worktree prompts did.
