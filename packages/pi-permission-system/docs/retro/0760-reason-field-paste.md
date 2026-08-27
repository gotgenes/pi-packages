---
issue: 760
issue_title: "pi-permission-system: pasting a denial reason into the inline TUI permission prompt does nothing"
---

# Retro: #760 — pasting a denial reason into the inline TUI permission prompt does nothing

## Stage: Planning (2026-08-17T15:58:57Z)

### Session summary

Traced the reported bug end to end through `@earendil-works/pi-tui@0.79.1` and confirmed it: a bracketed paste arrives at `PermissionPromptComponent.handleInput` as one multi-character chunk, and the hand-rolled reason editor's `isPrintable` guard rejects anything longer than one character.
The issue was filed by `kuoruan` (a third party), so the direction went to the operator, who chose delegating the reason step to pi-tui's framework `Input` component rather than a targeted paste fix — and chose the label-above-editor layout plus collapsing pasted newline runs to single spaces.
Wrote `packages/pi-permission-system/docs/plans/0760-reason-field-paste.md`: four TDD steps (pure collapser → delegation → drop the dead `reasonDraft` field → docs).

### Observations

- Two disposable vitest spikes drove the real `Input` class and `matchesKey` before the design was written, so every behavioral claim in the plan is measured rather than argued: paste acceptance, newline deletion (`"one\ntwo"` → `"onetwo"`, which is what motivated the collapse-to-space pre-pass), `Ctrl+O` rejected as a control character, `render(40)` returning exactly one padded row after a 500-character paste, and `Ctrl+C` reaching `onEscape`.
  A second spike established that a paste chunk matches none of the decision-step hotkeys — a stray paste cannot decide a permission — which became a new pinned invariant rather than an assumption.
- Two behavior deltas fall out of delegation and are recorded rather than hidden: `Ctrl+C` during reason entry now returns to the decision step (it lands on the decision step, never an approval), and the framework editor reads pi-tui's module-global keybindings, which an extension-side module instance may not share with the host.
  The latter is not a regression — today's editor uses the config-free `matchesKey` and honors no rebinding either.
- Planning surfaced write-only state: `PromptViewState.reasonDraft` is assigned in four places and read nowhere, duplicating the adapter's `reasonBuffer`.
  Delegation makes it unmistakably dead, so it is removed in the plan's step 3 rather than filed as a follow-up.
- Open PR [#757] rewrites the same component and test file (bordered-panel render).
  The conflict is confined to the render path, but its fate is worth deciding around this ship.
- No follow-up issues were filed: nothing in the plan names deferred work beyond the already-tracked [#751].

## Stage: Implementation — TDD (2026-08-17T16:20:31Z)

### Session summary

All four planned TDD cycles landed as planned, plus a one-line comment fixup the reviewer flagged: the pure `collapsePastedNewlines` helper, the delegation of the dialog's reason step to the pi-tui `Input` line editor, removal of the write-only `PromptViewState.reasonDraft`, and the architecture/configuration doc updates.
The target package went from 3123 to 3136 tests (+13: eight for `bracketed-paste.ts`, five for the component).
The `tidy-first-assessor` found no preparatory tidying warranted, and the pre-completion reviewer returned PASS.

### Observations

- The Red step caught a **vacuous assertion** in my own new test: `expect(after.join("\n")).toContain("x")` passed before the fix because the fixture's rendered `path : /repo/secret.txt` line contains an `x` in `.txt`.
  It surfaced only because I checked which of the five new cases actually went red and then probed the render with a temporary `toBe("PROBE")`.
  Switched the probe character to `q`, which appears nowhere else in that render.
  A single-character `toContain` probe against a render that includes filesystem paths is a trap worth remembering.
- Two of the five new component cases pass against the pre-fix code by design — the stray-paste-at-the-decision-step case and the expand-key case pin invariants that were already true (the plan's Invariants table says so).
  The reviewer verified this empirically by checking out the pre-fix tree and re-running the suite, and confirmed the three paste-specific cases all fail without the fix.
- One deviation from the plan, in the safe direction: instead of `setValue("")` on entering the reason step, the component builds a **fresh** `Input` per visit (`createReasonEditor`).
  The framework editor carries an undo stack and a kill ring, so a reused instance would let a reason the operator backed out of be undone back into a later ask.
- The reviewer's one WARN was a stale comment naming the deleted `isPrintable` guard in an untouched test case; fixed as a separate `test:` commit.
- Only one `feat`/`fix` line reaches the changelog (`fix(pi-permission-system): accept pasted text in the denial-reason field`), which is the correct user-observable framing — the helper and the model cleanup are `refactor:`.

## Stage: Final Retrospective (2026-08-17T16:33:27Z)

### Session summary

One continuous session carried #760 from a third-party bug report to a published `pi-permission-system-v26.2.1`: plan, four TDD cycles, ship, release.
The fix replaced the inline permission dialog's hand-rolled denial-reason editor with pi-tui's framework `Input`, so pasting works and the field gains cursor movement, word deletion, kill ring, and undo.
Six commits landed (`refactor:` × 2, `fix:`, `test:`, `docs:` × 1 plus stage notes), the package went 3123 → 3136 tests, and every gate — `check`, root `lint`, `test`, `fallow dead-code`, and both CI runs — was green on the first attempt.

### Observations

#### What went well

- **Disposable spikes at planning time turned the design into a measurement.**
  Two throwaway Vitest files drove the real `Input` class and `matchesKey` before a line of the plan was written, producing the plan's evidence table: paste accepted, `"one\ntwo"` → `"onetwo"`, `Ctrl+O` rejected as a control character, `render(40)` returning one padded row after a 500-character paste, `Ctrl+C` reaching `onEscape`.
  The newline-collapse pre-pass exists *because* the spike showed the framework joins words across a break — a design element that reading the `.d.ts` would never have surfaced.
  The `testing` skill's "Exploration before planning" rule already prescribes this; this session is evidence it pays off at plan time, not just at integration time.
- **A second spike converted an assumption into a pinned invariant.**
  Asking "what does a paste chunk do at the *decision* step?"
  (answer: `matchesKey` matches none of ten decision keys) turned a hand-wave into the regression test "never decides on a stray paste at the decision step".
- **The `pre-completion-reviewer` verified rather than read.**
  It checked out the pre-fix tree, overlaid the new test file, and re-ran the suite to confirm which new cases actually discriminate — stronger evidence than inspection, and it independently confirmed the vacuous-probe fix was sound.
- **The two-round `ask_user` structure matched the decision's shape.**
  Round one settled direction (targeted paste fix vs. framework delegation); round two asked layout and newline handling, both of which are only meaningful once delegation is chosen.
  No answer had to be revisited.

#### What caused friction (agent side)

- `other` — **a vacuous assertion in my own new test.**
  `expect(after.join("\n")).toContain("x")` passed *before* the fix, because the fixture's rendered `path : /repo/secret.txt` line contains an `x` in `.txt`.
  It surfaced only because I checked which of the five new cases actually went red instead of accepting "3 failed" as sufficient.
  Impact: four extra tool calls (verbose re-run, a temporary `toBe("PROBE")` probe, revert, re-run) and one edit changing the probe to `q`; no rework beyond that, and the test is stronger for it.
- `instruction-violation` (self-identified) — **filtered Vitest output through a `grep` that matched nothing.**
  My first probe attempt piped the run through `grep -E "^\s*[-+]"`, which printed nothing and read as "no failure" rather than "wrong filter" — exactly the trap the `testing` skill names ("a `grep`/`sed` filter over Vitest output often matches nothing and prints empty").
  Impact: one wasted tool call; re-ran unfiltered and got the answer immediately.
- `other` — **GitHub API 503s interrupted two gates.**
  `gh api user --jq .login` failed twice during planning (the third-party author check) and `release_pr_merge` failed once during ship.
  Impact: three wasted tool calls.
  Ship recovered by retrying; planning could not, so I inferred third-party status from the issue author (`kuoruan`) against the repo owner and stated the inference rather than silently skipping the `ask_user` gate — the conservative direction, and the gate ran.
- `other` — **reached for the wrong skill path.**
  Opened `~/.pi/agent/skills/github-voice/SKILL.md` when the retro prompt asked for `ask-user`.
  Impact: one wasted read; no downstream effect.

#### What caused friction (user side)

- Nothing blocking — both `ask_user` rounds were answered decisively and the answers drove the plan unchanged.
- Opportunity: the direction chosen here (delegate to a framework primitive rather than extend hand-rolled UI code) is a *standing* architectural preference, not a one-off.
  Recording it once — in `AGENTS.md` or the package skill — would let a future dialog/input issue skip the direction round of `ask_user` and go straight to the detail questions.
  Not proposed as a change this session because one data point is thin; worth watching for a second.

### Diagnostic details

- **Model-performance correlation** — planning, TDD, and this retrospective ran on `anthropic/claude-opus-5`; the `/ship-issue` stage ran on `anthropic/claude-sonnet-5` (31 turns, nearly all deterministic `git`/CI tool calls).
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran `anthropic/claude-sonnet-5` per their frontmatter.
  No mismatch: the judgment-heavy stages got the stronger model and the mechanical orchestration did not, and the reviewer's sonnet run still produced the session's most rigorous verification.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest single-issue sequence was the vacuous-assertion investigation at four consecutive tool calls, under the five-call threshold; no subagent escalation was warranted.
- **Unused-tool detection** — nothing missed.
  `colgrep` went unused, correctly: the issue named its own affected files, so exploration was targeted reads plus greps of the pinned dependency's compiled `dist/`, which is exactly what `AGENTS.md` prescribes for designing around an SDK seam.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` ran before each of the four commits, the affected test file ran per Red/Green cycle, the full package suite ran after the behavior-change step and again at the end, and the root-level `lint`/`fallow` gates ran at both the TDD close and the ship pre-push.

### Changes made

1. `.pi/skills/testing/SKILL.md` — added a Red-step rule beside the existing near-miss-probe bullet: a new test that passes during Red is either an invariant pin or a broken probe, with the `toContain("x")` / `secret.txt` collision as the one-line example.

The second proposal — a `gh api user` failure fallback in `.pi/prompts/plan-issue.md` — was declined; the conservative behavior stays a judgment call.

### Follow-ups

- PR [#757] (still open) rewrites `permission-prompt-component.ts` and its test file to wrap the dialog in a bordered panel.
  This ship touched the same two files — the input path, not the render path — so it now needs a rebase whoever lands it.
  Its fate is worth deciding rather than letting it drift.

[#751]: https://github.com/gotgenes/pi-packages/issues/751
[#757]: https://github.com/gotgenes/pi-packages/pull/757
