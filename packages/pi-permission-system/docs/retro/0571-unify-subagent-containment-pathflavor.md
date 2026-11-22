---
issue: 571
issue_title: "Unify subagent-context containment onto PathFlavor.isWithin"
---

# Retro: #571 — Unify subagent-context containment onto `PathFlavor.isWithin`

## Stage: Planning (2026-07-13T00:00:00Z)

### Session summary

Planned Phase 11 Step 5: replacing the private `isPathWithinDirectoryForSubagent` string-prefix helper in `src/authority/subagent-context.ts` with the shared `flavor.isWithin(...)` geometry, plus edge-case tests and helper deletion.
The roadmap (`docs/architecture/architecture.md` Step 5) already scoped the work precisely, so planning focused on verifying the behavioral claim and writing a cover-then-refactor TDD order.

### Observations

- **Parity finding:** empirically confirmed (against `path.posix`) that the prefix check and `flavor.isWithin` **agree on every realistic normalized-absolute input**.
  Because branch 3 of `isSubagentExecutionContext` normalizes both operands through `normalizeFilesystemPath` first, `..` segments collapse and the trailing-separator prefix (`directory + sep`) already rejects sibling-prefix dirs.
  Session dirs are always absolute, so no leading `..` survives normalization to trigger the theoretical divergence the issue and [#562] hypothesized.
- **Consequence for the plan:** classified as a behavior-preserving `refactor:` + `test:` change (not `feat!`/breaking).
  The added tests are characterization tests that lock in equivalence, not red→green tests that reveal a change — the plan states this honestly rather than asserting a divergence the inputs cannot produce.
- **Release:** `Release: independent` per the roadmap, but since both commit types are `hidden: true`, the change will not cut a release on its own — it batches into the next `feat:`/`fix:` release.
  The plan's Release Recommendation says so explicitly (per the AGENTS.md refactor-only-plan rule).
- **Doc-update scope:** the only doc touch is marking Step 5 `✅` (heading + Mermaid `S5` node) in the implementation commit; the health-metric row already targets `0` and needs no value edit.
  Historical helper mentions in older plans/retros are dated records, left as-is.
- **No follow-ups filed** — the change is fully self-contained.

## Stage: Implementation — TDD (2026-07-13T23:35:00Z)

### Session summary

Executed the two-step plan: added 8 characterization tests pinning subagent-context containment edge cases (`..` escape/re-entry, cross-root, sibling-prefix) on both `posixPathFlavor` and `win32PathFlavor`, then swapped `isSubagentExecutionContext`'s branch-3 call onto `flavor.isWithin(...)` and deleted the 13-line private `isPathWithinDirectoryForSubagent` helper.
Suite went 2456 → 2464 tests (+8); `grep -c 'startsWith(prefix)' src/authority/subagent-context.ts` is now 0.

### Observations

- **Behavior parity held exactly as planned.**
  The characterization tests passed green against the old prefix helper and stayed green after the swap — confirming the plan's finding that both algorithms agree on all normalized-absolute session paths (both operands are `normalizeFilesystemPath`'d first, collapsing `..` and folding win32 case/separators).
  No red→green; this was cover-then-refactor under green throughout.
- **Tidy-First assessor: no required prep.**
  It flagged one optional `describe.each` parameterization of the session-dir block but declined to recommend it, on the grounds that rewriting the existing posix tests (the equivalence anchors) adds churn to the safety net; I skipped it, keeping discrete tests legible as a literal before/after record.
- **Pre-completion reviewer: WARN** (1 non-blocking finding) — the Phase 10 summary line still listed [#571] as "remain open and non-gating."
  Fixed in a follow-up `docs:` commit noting it was carried into Phase 11 Step 5 and is now closed.
  All deterministic gates (check/lint/test/fallow) PASS.
- **Doc marking landed in the refactor commit** (not deferred to ship): Step 5 `✅` on the heading and Mermaid `S5` node, plus a `Landed:` note recording the parity finding.
  The health-metric row already targeted 0, so no value edit was needed.
- No deviations from the plan's Module-Level Changes; no follow-up issues warranted.

## Stage: Final Retrospective (2026-07-14T18:30:08Z)

### Session summary

Planned, implemented (TDD), shipped, and retro'd Phase 11 Step 5 in one continuous session: unified `subagent-context` filesystem containment onto the shared `PathFlavor.isWithin`, deleting the private `isPathWithinDirectoryForSubagent` prefix helper.
A behavior-preserving refactor landed as `test:` + `refactor:` + two `docs:` commits, closed clean, auto-batched for release (no releasing commit types).
The run was friction-free: no rework, no user corrections, one self-recovered shell-quoting slip.

### Observations

#### What went well

- **Empirical parity verification before classifying the change.**
  At planning (transcript turn 12) a throwaway `node -e` script compared the prefix check against `path.relative`-based `isWithin` across seven normalized inputs, proving they agree.
  This turned the issue's and [#562]'s "behavior-affecting" hypothesis into a verified "behavior-preserving" finding, which then shaped the entire TDD approach (characterization tests, cover-then-refactor under green rather than red→green).
  This is the `testing` skill's "write a disposable exploratory script first" rule applied proactively at plan time — a good pattern to repeat for any "is this refactor really behavior-preserving?" question.
- **Cover-then-refactor executed cleanly.**
  The 8 characterization tests passed green against the old helper and stayed green after the swap — the safety net worked as designed for a behavior-preserving refactor.
- **Pre-completion reviewer earned its dispatch.**
  It caught a real stale-doc reference (the Phase 10 summary still listing [#571] as "remain open and non-gating") that no `src/`/`test/` grep would have surfaced; fixed in a one-line follow-up `docs:` commit.

#### What caused friction (agent side)

- `other` (shell-quoting slip) — at ship (transcript turn 53) the model ran `grep -A1 '**Release:**'`, which errored (`repetition-operator operand invalid`: a leading `*` is an invalid BRE repetition operator).
  Recovered on the next call with `grep -F`.
  Impact: one wasted tool call, no rework.
  The `/ship-issue` prompt names the `**Release:**` marker to read but gives no command, so the model improvised a fragile pattern.

#### What caused friction (user side)

- None.
  The issue was precisely pre-scoped by the architecture roadmap (Step 5 named the target, the edge cases, and the outcome metric), so the session ran autonomously with no strategic input needed.

### Diagnostic details

- **Model-performance correlation** — Planning + TDD ran on `anthropic/claude-opus-4-8` (judgment-heavy: parity analysis, test design, refactor); ship ran on `opencode-go/deepseek-v4-flash` (mechanical: git/CI/close).
  Both assignments were appropriate to task weight.
  Two subagent dispatches: `tidy-first-assessor` correctly found no prep warranted; `pre-completion-reviewer` caught the stale-doc WARN.
  The one ship-side slip (the `grep '**'` error) is generic shell fragility, not a reasoning-quality mismatch.
- **Escalation-delay tracking** — no rabbit-holes; the single grep error resolved on the next tool call (1 retry, well under the 5-call flag).
- **Unused-tool detection** — `colgrep` was not used, but planning relied on targeted `grep` against a roadmap that already named the symbols; semantic search would have added nothing.
  No gap.
- **Feedback-loop gap analysis** — verification ran incrementally: `pnpm run check` right after the interface-touching swap (turn 31), the affected test file after each step (turns 28, 31), full suite + root lint + `fallow dead-code` at the end (turns 37–38).
  No end-loaded verification.

### Changes made

1. Added this Final Retrospective stage entry to `packages/pi-permission-system/docs/retro/0571-unify-subagent-containment-pathflavor.md`.
2. `.pi/prompts/ship-issue.md` — gave the `**Release:**` marker read an explicit `grep -F` command so the deterministic ship step no longer improvises a BRE-fragile `**` pattern.

[#562]: https://github.com/gotgenes/pi-packages/issues/562
[#571]: https://github.com/gotgenes/pi-packages/issues/571
