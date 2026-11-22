---
issue: 642
issue_title: "pi-permission-system: preserve Ctrl+O tool expansion in inline permission prompts"
pr: 643
---

# Retro: #642 — preserve Ctrl+O tool expansion in inline permission prompts

Tracking issue **#642** (the bug report); PR **#643** is @0xbentang's implementation against it, evaluated below as reference material.
Both were filed by @0xbentang.

## Stage: PR Review (2026-07-26T01:17:17Z)

### Session summary

Issue #642 reports that Pi's `app.tools.expand` action (Ctrl+O) has no effect while an inline permission prompt is focused; PR #643 from @0xbentang (third party) implements a fix, so a user can expand a truncated tool preview before approving it.
The underlying gap is real: `PermissionPromptComponent.handleInput` consumes every keystroke and the `ctx.ui.custom` factory discards its injected keybindings manager (`_keybindings`), so the global expand action is dead for the whole duration of an ask.
The operator chose **direction 1 — adopt the capability with our own simplified design**, using the PR as reference rather than the merge target.

### Evaluation

**Problem — real, and it works against a stated package priority.**
`packages/pi-permission-system/src/authority/permission-prompt-component.ts` renders the ask inline (`view.ui.custom(..., { overlay: false })`) and takes focus.
Its `handleInput` dispatches only to `handleReasonInput` and `toEvent`, and `presentInlinePermissionPrompt` names the third factory argument `_keybindings`, so no application action survives the prompt.
The package's "keep block/ask/allow decisions reviewable" priority argues directly for the fix: the moment a user most needs the full pending tool invocation is the moment they are deciding on it.

**The SDK surface exists and the sibling pattern is established.**
Verified against the sibling Pi checkout, not the bundled `dist`:

- `ExtensionUIContext.getToolsExpanded()` / `setToolsExpanded()` are declared at `../pi/packages/coding-agent/src/core/extensions/types.ts:277`.
- All three modes supply them — interactive (`interactive-mode.ts:2189`), RPC (`rpc-mode.ts:302`, no-op), and the headless runner stub (`runner.ts:262`) — so widening the prompt's UI surface cannot fail at runtime.
- `setToolsExpanded` already calls `this.ui.requestRender()` itself (`interactive-mode.ts:3815`), so the PR is correct **not** to add a redundant `requestRender()` after the toggle.
- Pi's own `ExtensionSelectorComponent.handleInput` performs the same `kb.matches(keyData, "app.tools.expand")` check first (`components/extension-selector.ts:93`), so this is convention-fit, not an invented shape.

There is no speculative generality here — nothing declared-but-unread, no over-wide threading of a value through layers that ignore it.
CI on the PR head is green (`check` passes).

**What is valuable:** the capability itself, the decision to route through the injected `KeybindingsManager` rather than hard-coding `\u000f`, the delegation of the `get`/`set` reach-through into a closure owned by `presentInlinePermissionPrompt`, and the regression test's core assertion — that toggling never settles the decision promise.

**What I would change:**

1. **Interface segregation on the SDK type.**
   The PR imports `KeybindingsManager` whole but uses only `.matches()`.
   The PR's own test is the tell: `PromptFactory` types the argument as `{ matches(data: string, action: string): boolean }` — the narrow contract already surfaced under test pressure and should be the production shape.
2. **Constructor width.**
   `PermissionPromptComponent` goes from six to eight positional constructor parameters, and two of the additions (`keybindings` + `toggleToolsExpanded`) are one collaborator's worth of behavior split across two slots.
   Collapse them into a single injected seam — an "app action consumed this keystroke" predicate of shape `(data: string) => boolean` — so `presentInlinePermissionPrompt` owns both the keybinding lookup and the `ui` reach-through, the component holds no Pi SDK type, and the test needs no fake keybindings manager.
   This is "thread decisions, not discriminators": the component should not re-interpret a raw keybindings manager.
3. **Key precedence during the `reason` step.**
   The PR checks the app action at the very top of `handleInput`, ahead of the `reason` branch.
   Harmless for the default Ctrl+O (`\u000f` is non-printable and `isPrintable` would drop it anyway), but `app.tools.expand` is user-rebindable: a printable rebinding becomes untypeable inside a deny reason and shadows the `y`/`s`/`n`/`r` decision hotkeys.
4. **Docs.**
   The inline-dialog key table in `docs/configuration.md` (the block at lines 119-130) says nothing about tool expansion, so the behavior is undocumented.

**Behavior / breaking:** not breaking.
Purely additive keystroke handling — no output shape, no default, no config field, no change to any existing key's meaning.
`fix(pi-permission-system):` is the correct type.

**Security surface:** least-privilege and aligned with the package's priorities.
The toggle mutates display expansion only; it cannot resolve, arm, or alter a pending decision, and the new test asserts non-resolution across two toggles before the decision is committed.
It strictly increases the information available to the human before an approval.

### Decision and attribution

**Direction: adopt the capability, plan a simplified design** (`/plan-issue #642`).
The work is tracked on issue **#642**; PR #643 is reference material, and the implementation is ours.

Agreed scope:

- Toggle `app.tools.expand` while the inline permission prompt is focused, without touching the pending decision.
- Collapse the two new constructor parameters into one narrow app-action seam; keep `KeybindingsManager` out of `PermissionPromptComponent`.
- **Precedence: check the app action before local handling, but only in the `decision` and `scope` steps** — the `reason` step's text entry is never intercepted.
  Operator's call, and I agree: it preserves Pi-like precedence while choosing, and removes the rebinding collision entirely for text input.
- Update the inline-dialog key table in `docs/configuration.md` and the prompt description in `README.md`.

Non-goals (operator decisions, both sound):

- **No expand hint in the prompt's hint line.**
  Expansion is a global app binding most users already know, the decision-step hint line is already dense, and a permission dialog is the wrong place to teach an unrelated global key.
- **The `PermissionPromptUi` widening stands as the PR has it.**
  It also types `LocalUserAuthorizerDeps.ui`, so the non-TUI `requestPermissionDecisionFromUi` path nominally gains two methods it never calls — accepted, since every mode supplies them and the alternative (a separate field on `PermissionPromptView`) buys little.
  This is why the diff touches `local-user-authorizer.test.ts`; expect the same test churn in our implementation.

Attribution — required on every implementation and docs commit for this work, as the last line of the body after a blank line:

```text
Co-authored-by: Ben Tang <bentang@fastmail.com>
```

Reference both as `Refs #642, #643` / `(#642)` — never `Closes #642` or `Closes #643`, which would pre-empt the curated close comments.

Close-out at ship time closes **both**:

- Issue **#642** — `issue_close` as `completed`, with the behavior summary and the implementing SHA(s).
- PR **#643** — closed as superseded, with a comment thanking **@0xbentang** by name, explaining that we adopted the capability with a simplified design, and linking the implementing SHA(s).

## Stage: Planning (2026-07-26T01:26:47Z)

### Session summary

Wrote `docs/plans/0642-preserve-tool-expansion-in-prompts.md` implementing the PR-review stage's recorded decision — adopt the capability, simplify the seam — in three TDD cycles (red test, `fix:` green, `docs:`).
The `Decide` gate was already satisfied by the PR Review stage above, so this session planned around the recorded direction rather than re-litigating it.
Release is **ship independently**: a grep of `docs/architecture/architecture.md` for `#642`/`#643` returns nothing, so the issue is in no roadmap batch and its `fix:` commit cuts a release on its own.

### Observations

- **Verified the SDK against `../pi`, not the bundled `dist`.**
  Two facts changed the design rather than merely confirming it.
  `setToolsExpanded` ends with `this.ui.requestRender()` (`interactive-mode.ts:3815`), so the component must *not* call `requestRender()` after toggling — the omission is load-bearing, and the plan records why so a future reader does not "fix" it.
  `custom`'s third factory argument is a non-optional `KeybindingsManager` invoked as `factory(this.ui, theme, this.keybindings, close)` (`interactive-mode.ts:2490`), so no undefined guard is needed despite the existing test passing `undefined` behind a cast.
- **Measured the ISP narrowing instead of asserting it.**
  Compiled a throwaway probe (`Pick<KeybindingsManager, "matches">` satisfied by a bare object literal) under `tsc` before planning around it.
  This is the skill's "confirm what a module exports with `tsc`, not a runtime symptom" rule applied at planning time.
- **Rejected the params-object constructor refactor.**
  The PR review flagged constructor width, and collapsing the PR's two new parameters into one seam addresses the agreed scope (8 → 7 params).
  A full params-object conversion would replace `this.theme` with `this.deps.theme` across all three render methods of a private, single-call-site class — trading one readability problem for another inside a bug-fix commit.
  Left explicitly to the `tidy-first-assessor` at `/tdd-plan` start rather than pre-empted.
- **The precedence choice is what protects a #573 invariant.**
  Intercepting keystrokes during the `reason` step could make a *required* denial reason untypeable.
  The plan pins this with a test that binds `app.tools.expand` to the printable key `e` — asserting on the default Ctrl+O would false-green, since `isPrintable` drops it regardless of the seam.
  This was the sharpest planning insight: the obvious test proves nothing.
- **Alternative precedence considered and rejected.**
  Consulting the app action only *after* local mapping declines is marginally safer against a pathological rebinding (e.g. binding expand to `y`), but diverges from Pi's own `ExtensionSelectorComponent`, which checks the action first.
  Host-convention consistency won; the residual risk is bounded because arrow/`j`/`k` + `enter` still commits every option, so no decision becomes unreachable.
- **Enumerated the widening's blast radius by type, not by grep alone.**
  Only `local-user-authorizer.test.ts` (two `ui` literals) breaks at `tsc`, because it is typed through `LocalUserAuthorizerDeps`.
  `authorizer.test.ts` and `authorizer-selection.test.ts` build theirs behind `as unknown as ExtensionContext` casts and never reach `custom`, so they break neither at compile time nor at runtime — the package skill's warning about cast-masked ctx literals applied, and the answer here was "no update needed".
- **No follow-up issues filed.**
  The one deferred item (an expand hint in the prompt's hint line) is an operator-declined non-goal, not concretely named future work; filing it would be speculative.

## Stage: Implementation — TDD (2026-07-26T13:50:20Z)

### Session summary

Implemented the plan in two commits (`6a0d2412` `fix:`, `f4098d33` `docs:`), forwarding Pi's `app.tools.expand` action through a narrow `(data: string) => boolean` seam consulted only in the `decision` and `scope` steps.
Test count for `pi-permission-system` went 2665 → 2668 (+3, all in `test/authority/permission-prompt-component.test.ts`).
Pre-completion reviewer: **PASS** — ready for `/ship-issue`.

### Observations

- **Deviation: folded the plan's `test:` red step into the `fix:` commit** (2 commits, not 3).
  Rationale: the widened `PermissionPromptUi` breaks `local-user-authorizer.test.ts` at the type level in the same commit regardless, so a standalone red commit would have left the tree failing `tsc` *and* the suite.
  The Red→Green cycle still ran — the red was measured (2 failed / 17 passed) before any `src/` edit.
  The reviewer independently endorsed the call on two grounds: the `testing` skill's interface-change rule mandates bundling, and this repo's history shows `fix:` commits routinely carry their own tests rather than landing a separate red commit.
- **The `tidy-first-assessor` returned "no preparatory tidying warranted"** and independently confirmed the plan's decision to keep the positional constructor.
  It added an argument the plan had not made: the three callback parameters have mutually incompatible signatures (`(data: string) => boolean`, `() => void`, `(decision) => void`), so a transposition at the single call site fails `tsc` rather than silently misbehaving — which is what makes 7 positional params acceptable here.
  It also correctly declined to split the `makePromptUi()` extraction into a separate prep commit, noting it is not separable from the widening.
- **The precedence guard test is load-bearing, and the reviewer proved it more sharply than planning did.**
  Planning argued it "discriminates"; the reviewer traced the actual failure mode: hoisting the check above the `reason` branch makes `"e"` never reach `reasonBuffer`, so `ENTER` submits an *empty* reason, the decision model rejects it, the promise never resolves, and the test hangs to timeout.
  Worth remembering as a pattern — an "absence of interception" assertion can look weak while actually pinning ordering that no lint rule or type constrains.
- **Binding the fake action to a printable key was the whole trick.**
  A test asserting on the default `Ctrl+O` would have false-greened, because `isPrintable` drops `\u000f` in the reason editor whether or not the seam intercepts it.
  The plan called this out in advance and it held up exactly as predicted.
- **The `Pick<KeybindingsManager, "matches">` narrowing needed no rework**, because it was compiled as a throwaway `tsc` probe during planning rather than assumed.
  Same for the no-`requestRender()` decision, which came from reading `interactive-mode.ts:3815` in the sibling `../pi` checkout rather than the bundled `dist`.
- **Blast radius matched the plan exactly**: only `local-user-authorizer.test.ts` broke at `tsc` (cascading to 10 call sites through `makeDeps`), while the cast-masked ctx literals in `authorizer.test.ts` / `authorizer-selection.test.ts` were correctly predicted to need nothing.
  No unplanned file was touched.

## Stage: Final Retrospective (2026-07-26T15:22:34Z)

### Session summary

All five stages — PR review, planning, TDD, ship, retro — ran in a single session, taking third-party PR #643 from triage through `pi-permission-system-v23.0.3`.
The capability (Pi's `app.tools.expand` staying live during an inline permission prompt) was adopted with a narrower design than the PR proposed, with @0xbentang credited via `Co-authored-by:` trailers and a close comment on both #642 and #643.
One user correction (retro keyed to the PR number instead of the issue) and one multi-hop SDK spelunk were the only real friction.

### Observations

#### What went well

- **Measuring a type-level assumption at planning time.**
  Before designing around `Pick<KeybindingsManager, "matches">`, planning wrote a throwaway `src/__kbprobe.ts`, ran `pnpm run check`, and deleted it.
  The `testing` skill says to confirm export claims with `tsc` rather than a runtime symptom, and the plan template says to *measure* quantitative invariants — this generalized both to a type-level design assumption, and the narrowing needed no rework at implementation.
- **The plan's skepticism about its own test design was the highest-value planning output.**
  Planning noticed that a precedence test using the default `Ctrl+O` would false-green, because `isPrintable` drops `\u000f` in the reason editor whether or not the seam intercepts it, and specified binding the fake action to the printable key `e` instead.
  The pre-completion reviewer independently confirmed the test is load-bearing by tracing the failure mode: hoisting the check above the `reason` branch makes `ENTER` submit an empty reason, which the model rejects, so the promise never resolves and the test hangs to timeout.
- **The plan predicted the `tsc` blast radius exactly.**
  It named `local-user-authorizer.test.ts` as the only type-level break and correctly predicted that the cast-masked ctx literals in `authorizer.test.ts` / `authorizer-selection.test.ts` would need nothing — an application of the package skill's cast-masking warning that held on contact.
- **The `tidy-first-assessor` earned its dispatch by sharpening an argument rather than adding work.**
  It returned "no preparatory tidying warranted" and confirmed the plan's decision to keep the positional constructor, adding a point planning had not made: the three callback parameters have mutually incompatible signatures, so a transposition fails `tsc` rather than silently misbehaving.

#### What caused friction (agent side)

- `missing-context` — keyed the PR-review triage note to the **PR** number (`0643-…`) instead of the issue it addresses (`0642-…`), and told the operator to run `/plan-issue #643`.
  The prompt at `.pi/prompts/pr-review.md:88` does say `NNNN` matches the PR number, but issue #642 had been read at the start of the session *and* a directory listing two turns earlier showed the issue-keyed convention (`0645-`, `0646-`, `0647-`, `0653-`) — neither signal was reconciled against the prompt's rule.
  **User-caught** ("Note, this is also about Issue #642").
  Impact: `git mv` + an `Edit` + a `commit --amend` (4 tool calls of rework) and a wrong handoff already printed.
  The mis-keyed file would also not have been found by `/plan-issue`, which looks the retro up by issue number.
- `rabbit-hole` — spent roughly 8 consecutive tool calls in the sibling `../pi` checkout hunting where `ui.custom` passes its keybindings argument to the factory: `grep "async custom"` → `grep "custom:"` → an `awk` line-range → `grep keybindingsManager` → `grep showCustomComponent` → a tab-literal grep that finally hit line 2161 → `showExtensionCustom` → the `factory(...)` call.
  Impact: no rework and the answer was correct and load-bearing, but the whole multi-hop trace burned planning-session context that an `Explore` subagent dispatch would have kept off it.
- `other` (tool-selection slip) — the retro stage's skill load pulled `github-voice` instead of the `ask-user` skill the prompt names.
  Self-identified and corrected on the next turn.
  Impact: one wasted file read, no rework.
- `other` (plan/template mismatch) — the plan specified a standalone `test:` red commit, while `/tdd-plan` states test-only commits are "rare; usually folded into the feat."
  Implementation folded them, which the pre-completion reviewer endorsed on two independent grounds.
  Impact: no rework; a deviation that had to be justified in a commit body and to the reviewer.

#### What caused friction (user side)

- Nothing that cost rework.
  The single correction ("Note, this is also about Issue #642") was five words delivered at the earliest possible moment — immediately after the mis-keyed handoff was printed, before any downstream stage consumed it.
  That is the ideal shape for this intervention, and the fix belongs in the prompt rather than in operator vigilance.
- Invoking `/pr-review 643` without the issue number was reasonable; the prompt should derive the issue from the PR body, and the proposal below makes it do so.
- "Everything ready to ship?" before `/ship-issue` was a useful checkpoint: it found nothing wrong but forced an explicit state verification (clean tree, 6 unpushed commits, nothing through CI yet) before an irreversible action.

### Diagnostic details

- **Model-performance correlation** — PR review, planning, and TDD ran on `anthropic/claude-opus-5`; the ship stage ran on `anthropic/claude-sonnet-5`; the retro returned to opus-5.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) are pinned to `anthropic/claude-sonnet-5` in their frontmatter.
  No mismatch found in either direction.
  The sonnet ship stage handled the one judgment call it met correctly — distinguishing a genuinely `IN_PROGRESS` check from the empty-rollup `GITHUB_TOKEN` case on the release PR, and waiting rather than falling back to `gh pr merge` — which is the `/ship-issue` runbook doing its job on a cheaper model.
- **Escalation-delay tracking** — the `../pi` spelunk above ran ~8 consecutive tool calls on one question, past the 5-call threshold.
  It should have been an `Explore` subagent dispatch.
- **Unused-tool detection** — `Explore` was never dispatched despite two read-only, multi-hop exploration tasks (the `../pi` trace; the initial survey of `permission-prompt-component.ts` and its test-fixture blast radius).
  `colgrep` was also never used; every search was exact-symbol `grep`, which was defensible here since the targets were known identifiers.
- **Feedback-loop gap analysis** — no gap.
  Verification ran incrementally: `vitest` on the single file at red and again at green, `pnpm run check` immediately after the shared-interface change and before the commit, the `authority/` directory suite next, then the full suite plus `lint` and `fallow dead-code` before the docs commit.

### Changes made

1. `.pi/prompts/pr-review.md` — the triage note is now keyed to the **issue** the PR addresses, not the PR number.
   Three spots: the path rule (read the PR body for `Refs #N` / `Closes #N`, fall back to the PR number only when there is no issue), the frontmatter block (`issue:` takes the issue number and a new `pr:` field carries the PR), and the direction-1 handoff line, which now names `/plan-issue #<issue>` rather than `#$1`.
2. `AGENTS.md` — extended the `../pi` sibling-checkout rule to name the dispatch mechanism: an `Explore` subagent with `model: "sonnet-5"` for a multi-hop trace, inline reads for a known file.
   The explicit model pin is deliberate — `Explore` defaults to `claude-haiku-4-5`, which is the reasoning-weak-model-on-judgment-work mismatch this retro's own model lens is meant to catch.
3. Declined a third proposal (noting in `/plan-issue` that a red test and its green land in one commit).
   The deviation it targets cost no rework, and the plan-vs-template inconsistency is documented here instead.

Not done, available as a follow-up: pinning `Explore` to sonnet-5 **globally** via a `.pi/agents/Explore.md` override.
The change above scopes the pin to `../pi` SDK tracing only; a global override would change every `Explore` dispatch in the repo and is a larger call than a retro should make unasked.
