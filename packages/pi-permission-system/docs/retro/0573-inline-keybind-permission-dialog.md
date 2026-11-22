---
issue: 573
issue_title: "[FEATURE REQUEST] Keybinds for approve/deny/deny with reason"
---

# Retro: #573 — Inline keybind permission dialog

## Stage: Planning (2026-07-13T00:00:00Z)

### Session summary

Planned Phase 11 Step 4: an inline `ctx.ui.custom<PermissionPromptDecision>` permission dialog with `y`/`s`/`n`/`r` hotkeys, gated on `ctx.mode === "tui"` with the `select`/`input` flow preserved for RPC (the #519 constraint).
The design splits a pure decision model (`permission-prompt-decision.ts`) from a thin TUI component (`permission-prompt-component.ts`), adds a default-on `doublePressToConfirm` config toggle, and makes deny-with-reason a mandatory inline editor sub-step with back-navigation.
Committed the plan; no follow-up issues filed (deferred items are unfiled by design).

### Observations

- This is a third-party issue (author `Hex4C` ≠ `gotgenes`), but it was already scheduled in the operator's own roadmap (Phase 11 Step 4), so the `ask-user` direction gate largely confirmed the roadmap design.
- The operator extended the raw request in two rounds of `ask-user`: (1) double-press-to-confirm on **all four** hotkeys, a **default-on** config toggle, modeled on pi-ask's pure `resolveReviewShortcutDoublePress`; (2) deny-with-reason reason is **mandatory** (empty rejected), `esc` = back to the decision list.
- Keybinding scheme resolved to the roadmap's `y`/`s`/`n`/`r` (over the issue's `y`/`A`/`n`/`tab`) — avoids `tab` (a navigation key) and uses mnemonic lowercase.
- Tension noted and accepted: #573's motivation was *fewer* keypresses, but the operator chose double-press default-on for safety; the operator's call overrides the original motivation.
- Enter semantics decided by the planner (not re-asked): enter confirms the highlighted option in a single press; the double-press toggle governs only the **letter-hotkey** fast path.
  Navigate-then-enter is already two deliberate keystrokes.
- Classified **non-breaking** (`feat:`, not `feat!:`): the TUI interaction changes on upgrade, but the `PermissionPromptDecision` contract, gate outcomes, and config surface are additive/unchanged; the new toggle defaults on and is disableable.
- SDK verification: `ctx.ui.custom` renders inline by default and works only in TUI (`hasUI` is also true for RPC), so the gate is `ctx.mode === "tui"`, not `hasUI`.
  `config-modal.ts` is the in-package `ctx.ui.custom` precedent; `@earendil-works/pi-tui` is already a `devDependency`.
- `requestPermissionDecisionFromUi` is **retained** as the RPC fallback (lift-and-shift), so no consumer/doc breaks — only the injected seam re-points to a new `requestPermissionDecision` dispatcher.
- `doublePressToConfirm` threaded as a live **getter** (not an activation snapshot) so the `/permission-system` settings-modal toggle takes effect on the next prompt.

## Stage: Implementation — TDD (2026-07-13T20:20:00Z)

### Session summary

Implemented the inline keybind permission dialog across 5 TDD cycles: a pure decision model (`permission-prompt-decision.ts`), the `doublePressToConfirm` config toggle, the inline `ctx.ui.custom` component (`permission-prompt-component.ts`), the mode-dispatch wiring, and the architecture-doc completion.
Test count grew from 2418 to 2455 (+37); full suite, `pnpm run check`, root lint, and `pnpm fallow dead-code` all green.

### Observations

- **Design deviation (ISP + cycle avoidance):** the plan said to widen `PermissionDecisionUi` with `custom` and put the dispatcher in `permission-dialog.ts`.
  Instead I kept `PermissionDecisionUi` narrow (`select`/`input`) and added a separate `PermissionPromptUi = Pick<ExtensionUIContext, "select" | "input" | "custom">` plus the `requestPermissionDecision` dispatcher in `permission-prompt-component.ts`.
  This avoids a `permission-dialog.ts` ↔ component import cycle and is more ISP-faithful; `permission-dialog.ts` was consequently **not** modified.
- **Tidy-first prep skipped:** the assessor's one recommended commit (a `makeStubUi` fixture) was predicated on widening the shared `PermissionDecisionUi` — the ISP deviation above made it low-value (only the 2 `local-user-authorizer.test.ts` sites broke, and they were rewritten in the wiring step anyway).
- **Config field forced call-site updates early:** making `doublePressToConfirm` a required field of `PermissionSystemExtensionConfig` broke three literal constructions (`config-modal.ts` `cloneDefaultConfig`, `config-modal.test.ts`, `config-reporter.test.ts`), fixed in the same step-2 commit per the required-field rule.
- **Options are always `[y, s, n, r]`:** the plan's speculative "s absent" edge case does not occur — the fallback dialog always offers the session option, so the model mirrors that.
- **`matchesKey` works on raw strings** (verified via a throwaway probe): arrows `\u001b[A/B`, `\r` enter, `\u001b` escape, `\u007f` backspace all resolve, so the component maps keystrokes without a live terminal, and the pi-ask fake-`tui`/`plainTheme`/`done` harness tests the component end-to-end.
- **Pre-completion reviewer: WARN** — one non-blocking finding: the plan asked to bump the `Inline prompt component files` health-metric row `0 → 1`.
  Deliberately **not** done: that column is the dated `Baseline (2026-07-12)` snapshot, and the already-landed Phase 11 steps 1–3 left their achieved rows' baselines untouched too (the table is recomputed at phase close, not per-step).
  Editing only this row would make the baseline column internally inconsistent; the `✅` step heading + Mermaid node are the completion markers.

## Stage: Final Retrospective (2026-07-14T01:30:00Z)

### Session summary

One continuous session carried #573 from `/plan-issue` through `/tdd-plan`, `/ship-issue`, and this retro: an inline keybind permission dialog for TUI sessions, released as `pi-permission-system` `20.7.0`.
Five TDD cycles landed with zero rework commits and no test failures (+37 tests, 2418 → 2455); the whole plan→ship arc was clean.

### Observations

#### What went well

- **Test-Driven Design paid off.**
  Splitting the branch-heavy interaction logic into a pure `reducePrompt` model (no SDK/TUI imports) and a thin `ctx.ui.custom` adapter made every decision path (double-press arming, reason validation, scope step, esc transitions) unit-testable without a live terminal.
  A throwaway `matchesKey`-on-raw-strings probe confirmed the pi-ask fake-`tui`/`plainTheme`/`done` harness would work before committing to it.
- **The `ask-user` gate surfaced real scope.**
  The raw third-party issue asked only for `y`/`n`/`tab`/reason keybinds; three planning `ask-user` rounds drew out the operator's double-press-to-confirm affordance (default-on toggle) and the mandatory-reason rule — substantial behavior the issue never stated.
  The operator explicitly appended "I also want to improve the flow" to an answer, which the interactive flow invited.
- **An implementation-time design refinement improved on the plan.**
  The plan's "widen `PermissionDecisionUi` + dispatcher in `permission-dialog.ts`" would have created a `permission-dialog.ts` ↔ component import cycle; catching it during TDD and refining to a narrow `PermissionDecisionUi` + a `Pick`-based `PermissionPromptUi` (ISP) left `permission-dialog.ts` untouched and shrank the diff.
- **The ship `UNSTABLE` guidance worked as written.**
  `release_pr_merge` refused with `merge_state: UNSTABLE`; the `statusCheckRollup` check was `IN_PROGRESS` (not the empty-rollup `GITHUB_TOKEN` case), so waiting two polls for it to finish and then retrying `release_pr_merge` was exactly the prompt's prescribed path — no premature `gh pr merge` fallback.

#### What caused friction (agent side)

- `missing-context` — the plan's Module-Level Changes instructed "update the health-metric row from `0` to `1`," but that column is the dated `Baseline (2026-07-12)` snapshot, recomputed at phase close, not a per-step live value (the already-landed Phase 11 Steps 1–3 left their achieved rows' baselines untouched).
  Following the instruction would have made the baseline column internally inconsistent.
  Impact: one pre-completion-reviewer WARN and a judgment call to decline the edit; no rework, but the plan (self-authored) committed to a doc edit without checking the table's own convention.
- `other` (path slip) — a `README.md` `Edit` used the absolute path `/Users/chris/development/pi/pi-permission-system/README.md`, dropping the `pi-packages/packages` segment, and returned `ENOENT`.
  Impact: one wasted tool call, self-corrected immediately with the relative path.

#### What caused friction (user side)

- None.
  The operator's extended requirements emerged naturally through the planning `ask-user` rounds — the right place for a third-party issue where the operator's own preferences (double-press, mandatory reason) are not in the issue body.

### Diagnostic details

- **Model-performance correlation** — both subagent dispatches (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5`, appropriate for their judgment-heavy work (preparatory-refactor assessment, quality review); no reasoning-weak-on-judgment or high-cost-on-mechanical mismatch.
- **Escalation-delay tracking** — no `rabbit-hole` friction; the longest same-error sequence was 1 retry (the `README.md` path slip).
- **Feedback-loop gap analysis** — verification ran incrementally: each TDD step ran its affected test file (red→green), `pnpm run check` after every shared-interface/config change, and the full suite + root lint + `pnpm fallow dead-code` after the last step.
  No end-only verification gap.

### Follow-up: orphaned mid-batch issue #580

During this retro the operator noticed #580 (Phase 11 Step 2, `shellTools` config model) was still **open** despite being released in `pi-permission-system-v20.5.0`.
It was not #573's responsibility to close it — the two issues are unrelated and #580's commits predate #573's `v20.6.0` ship baseline.
Root cause: #580 was a **mid-batch** member of the "shell-tool-aliases" batch (tail #574); `/ship-issue` step 4b couples the issue **close** to the release **defer** decision ("leave the issue open and skip steps 5–6"), and the batch-tail (#574) ship's stacked-issue check only scans `<pkg-tag>..HEAD`, which excludes a sibling already released below the tag.
So the issue orphaned.
Closed #580 manually with a summary; filed #586 to fix the ship-flow gap (two candidate fixes: decouple close from release in step 4b, or have the batch-tail ship enumerate and close its batch siblings).

### Changes made

1. `.pi/skills/package-pi-permission-system/SKILL.md` — clarified that a dated `Baseline (<date>)` health-metric column is a fixed phase-open snapshot recomputed at phase close, not a per-step value (resolves the pre-completion WARN's root cause; `Refs #573`).
2. Closed #580 (orphaned mid-batch issue) with an implemented-in/released-in summary.
3. Filed #586 — the `/ship-issue` mid-batch-close gap that orphaned #580.
4. `packages/pi-permission-system/docs/retro/0573-inline-keybind-permission-dialog.md` — this Final Retrospective stage entry.
