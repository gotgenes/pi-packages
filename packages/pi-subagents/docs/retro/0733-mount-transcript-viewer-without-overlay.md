---
issue: 733
issue_title: "fix(pi-subagents): /subagents:sessions overlay smears box chrome into scrollback"
---

# Retro: #733 — fix(pi-subagents): /subagents:sessions overlay smears box chrome into scrollback

## Stage: Planning (2026-09-03T18:50:52Z)

### Session summary

Planned the move of `/subagents:sessions` off Pi's overlay compositor and onto the non-overlay `ui.custom` path, plus three operator-chosen adaptations to the docked shape: minimal chrome (`CHROME_LINES` 6 → 2), content-sized height capped at 70%, and a rename off the `Overlay` vocabulary.
The session also built a working reproduction of the upstream pi-tui defect against the published 0.84.4 public API, which corrected the issue body's account of the mechanism before it could reach an upstream report.
Filed [#874] for the repo's other `overlay: true` call site, posted a verified not-shared-origin finding to [#864], and recorded [#874]'s disposition against pi-permission-system's Phase 14.

### Observations

- **The measurement overturned the plan's own premise, twice.**
  The first two reproduction attempts found **zero** contamination and I nearly concluded the bug was not real.
  The issue body's claim — "every row in the overlay's band eventually scrolls off carrying box chrome" — is false: with line-at-a-time appends the differential renderer repairs the band as it moves.
  The real precondition is a burst append large enough to carry a row from under the overlay past the top of the screen in one frame (threshold 8 for a 10-line box in a 24-row terminal, matching `floor((24-10)/2) + 1`).
  Had the operator filed the pre-measurement text, it would have been falsifiable in one run.
- **A triage note's "plausible shared cause" is a lead, not a finding.**
  `docs/triage/2026-09-02-backlog.md` banded this issue and [#864] together at rank 3.
  Two greps settled it: `AgentWidget` mounts via `ui.setWidget` into an ordinary `Container` and never reaches `showOverlay`, so `hasOverlayEntries` is false throughout [#864]'s reproduction, and neither fix addresses the other.
- **I asserted upstream posture without checking it.**
  I described the mechanism as "confirmed" from a source trace and let that stand as though it settled whether upstream would call it a bug.
  The operator's recollection of a "You are wrong." was correct — it is on [earendil-works/pi#4785], from a maintainer, aimed at the [#864] family rather than this mechanism.
  Verifying the source and verifying the maintainer's position are different claims and should not have been conflated.
- **The tracker shows what evidence works there.**
  [earendil-works/pi#4785] offered a source reading plus a one-line patch and was rejected flatly; [earendil-works/pi#2759] offered a repro command against the repo's own example extension and was fixed by the maintainer in 33 minutes.
  That contrast is why ADR 0007 carries a runnable script rather than an argument.
- **`TuiMainScreen` is a public export of `@earendil-works/pi-tui`**, so the reproduction runs against the published package with no monorepo checkout — a materially better artifact to hand upstream than one requiring their tree.
  `captureRenderState()` exposes `previousLines` and `previousViewportTop`, which is the exact assertion surface.
- **The correct assertion was at commit time, not on final state.**
  `previousLines` is rebuilt each frame, so the renderer's model self-corrects; what the terminal keeps is whatever a row held at the last frame it was still on screen.
  Two failed attempts came from asserting on the final buffer.
- **`previousLines = newLines` occurs at three sites**, not one — `tui-main-screen.ts:314`, `:440`, `:611` in the installed 0.84.4.
  I had originally read only the `fullRender` assignment, which understated the claim.
  These line numbers were first recorded as 315/441/612, read from the `../../pi` checkout rather than the pinned dependency; see the TDD stage entry.
- **Verified the plan's own appendix rather than trusting it**: extracted the fenced script back out of the committed plan and ran it, confirming an identical result (171 contaminated rows, control 0).
- Scope held at one package.
  The `pi-permission-system` config modal is the same mechanism but needs a different answer, because it asks for a fixed 82-column width the non-overlay path does not offer — so it is [#874], not a step here.
- A mistyped absolute path (`/Users/chris/development/pi/pi-permission-system/...`, missing the worktree prefix) was caught by the `external_directory` gate rather than failing fast, exactly as AGENTS.md warns.
  Repo-relative paths avoided it.

#### Deferred tidyings

The Tidy-First assessor reported no contradictions against the design and recommended two preparatory steps, both adopted as TDD steps 1 and 2.
One candidate was rejected as not worth doing as preparation:

- `src/ui/session-navigator.ts` — extracting header/footer painting into a `paintChrome` helper.
  With the box removed, the top and bottom of `render()` are replaced wholesale regardless of how they are factored, so extracting first relocates the diff rather than shrinking it.

`transcript-content.ts` and `test/helpers/transcript-fixtures.ts` were assessed and found to need nothing.

## Stage: Implementation — TDD (2026-09-03T19:29:09Z)

### Session summary

Executed all seven TDD steps, including the two Tidy-First preparatory commits, each as its own commit leaving the tree green.
The viewer now mounts through `ui.custom`'s non-overlay path with a two-line chrome and a content-sized height, and ADR 0007 records the upstream mechanism with a runnable reproduction.
Test count 1508 → 1514 (+6) in `pi-subagents`; `check`, `lint` (0 findings), `test`, and `fallow dead-code` all green at baseline and at the end.

### Observations

- **Pre-completion reviewer: WARN**, resolved.
  It found the three `previousLines = newLines` citations in ADR 0007 each off by one.
  Root cause is the exact hazard `AGENTS.md` warns about: I read line numbers from the `../../pi` checkout, which tracks Pi's `main`, instead of the pinned dependency the ADR claims to cite.
  The sharper form is that the checkout **drifted during this session** — the `compositeOverlays` line read 267 at planning time and 268 by the end — so even a number captured correctly earlier can rot in place.
  The durable fix is to cite from the installed package's sourcemap (`dist/*.js.map` `sourcesContent`), which is what shipped.
- The reviewer also caught that the threshold prose asserted 8 *is* the distance to the top of the screen and then computed that distance as 7.
  It is one more than the distance.
  The planning retro had it right and the shipped text dropped the `+ 1`.
- **A chrome change is invisible in the pane's total height.**
  Total lines are `floor(rows * 70%)` before and after, because the viewport absorbs whatever the chrome gives up.
  The first draft of the capacity test asserted total height and would have passed under both, which is the testing skill's "name both outcomes and confirm your assertion differs between them" rule catching a vacuous probe before it was written.
  The discriminating measure is transcript rows shown: 21 before, 25 after.
- **The measured capacity was 21 → 25, not the 22 → 26 the arithmetic suggested.**
  One viewport row is the user-message component's own trailing row.
  I predicted 25 from the observed 21 before running it, and confirmed the delta is exactly 4, so the expectation was reasoned rather than fitted to output.
- Three deviations from the plan, each recorded in its commit body:
  1. The planned assertion on `inputWidth()`'s pre-first-render fallback was not written — `render()` clamps `visibleStart` to its own `maxScroll`, so a wrong fallback produces identical output at any render width.
  2. Step 1's killing mutation turns one scroll-bounds test red, not both; the second is an up-then-down round trip insensitive to a width mutation by construction.
  3. `viewportHeight` takes the already-computed `totalLines` rather than the plan's `width`, avoiding a second `lineCount` traversal per frame.
- **A pin that stays green through Red needs its own mutation.**
  Step 6's cap test passed during Red because the old fixed height already produced the capped value.
  The plan's mutation was designed to leave it green, so it proved nothing about that test; a second mutation removing only the upper clamp turned it red at 84 rows versus 28.
- Verified both copies of the reproduction script by extracting them from the committed plan and the committed ADR and running each, rather than assuming the paste was faithful.
- For whoever runs `/finish-phase` on pi-subagents Phase 22: that roadmap's sweep list defers this issue as "requiring SDK-level rendering investigation".
  The investigation happened here and its conclusion is the opposite — no SDK change is required.
  The disposition is left as the historical record it is, but the rationale should not be carried forward as fact.

## Stage: Sync (worktree) (2026-09-03T19:46:22Z)

### Session summary

Pre-push checks pass clean: `pnpm run lint` (0 findings) and `pnpm fallow dead-code` (0 issues), both unchanged from the TDD stage's end-of-cycle run.
The plan's `**Release:**` marker is `ship independently` — no batch to coordinate.
Rebase onto local `main` is clean; nothing else is pending on this branch.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-733--/2026-09-03T17-49-55-724Z_01a06864-408c-7b87-99b0-9541a94ff196.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Context for the root session at land time:

- **This is `feat:`-bearing.**
  Two of the commits (`243bdb21`, `d0dfe786`) are `feat:`, so this cuts a **minor**, not a patch — confirm with `./scripts/release/next-version.sh pi-subagents` rather than assuming.
- **Two follow-up issues were filed during planning and remain open**, not this branch's work: [#874] (the `pi-permission-system` config modal has the same `overlay: true` defect at lower exposure) and the not-shared-origin finding posted as a comment on [#864] (the widget render loop is a distinct mechanism from this issue's fix).
- **The upstream report has not been filed.**
  ADR 0007 carries a ready-to-file brief text and a runnable reproduction script; filing is the operator's action, in their own voice, and nothing here depends on it happening.
- **A citation defect was found and fixed within this branch's own history**, not carried forward: the pre-completion reviewer caught three `pi-tui` line citations in ADR 0007 off by one (read from the drifting `../../pi` checkout instead of the pinned dependency), corrected in `0f545a77`.

## Stage: Final Retrospective (2026-09-03T20:09:22Z)

### Session summary

Landed #733 through the parallel-worktree flow: planning, TDD, and sync ran in a peer session, and this root session ran `/ship-worktree` — ff-merge, push, CI, issue close, release, teardown — with no rework at any step.
The shipped change moves `/subagents:sessions` off Pi's overlay compositor onto the non-overlay `ui.custom` path, and released as `pi-subagents-v21.4.0` (a minor, as the peer's handoff predicted).
This retrospective spans all four stages, read from the peer transcript rather than the breadcrumbs alone.

### Observations

#### What went well

- **A measurement overturned the issue's own premise before it could reach upstream.**
  The planning session's first two reproduction attempts found zero contamination, and the issue body's mechanism claim ("every row in the overlay's band eventually scrolls off carrying box chrome") turned out to be false.
  The real precondition is a burst append large enough to carry a row past the top of the screen in one frame — threshold 8, matching `floor((24-10)/2) + 1` exactly.
  Filing the pre-measurement text would have been falsifiable in one run, which is precisely how [earendil-works/pi#4785] failed.
  This is the rare case where the agent's own artifact was the thing being falsified, and it kept going rather than concluding the bug was not real.
- **The `pre-completion-reviewer` caught a defect the implementing session structurally could not see.**
  Three `previousLines = newLines` line citations in ADR 0007 were each off by one.
  A fresh-context reviewer with a mandate to re-derive rather than accept is what found it; the implementing session had every number in front of it and had already checked them once.
- **The peer→root handoff carried exactly the facts the ship stage needed.**
  The `## Stage: Sync (worktree)` note stated the `**Release:**` marker, predicted the minor bump with the two `feat:` SHAs, and listed the two follow-ups as *not* this branch's work.
  The ship session re-derived each independently (`next-version.sh`, the `(#N)` subject scan) and every one matched, so the breadcrumb functioned as a cross-check rather than a claim to trust.
- **Verification ran incrementally, not at the end.**
  The TDD session established a four-gate green baseline before step 1 and ran `pnpm run check` after steps 1, 3, 4, 5, and 6 — so the end-of-cycle run confirmed a state already known green instead of discovering one.

#### What caused friction (agent side)

- `missing-context` (user-caught) — the planning session never searched Pi's upstream issue tracker, while describing the mechanism as "confirmed".
  It had verified the mechanism against Pi's source and let that stand as though it also settled whether upstream would call it a bug.
  The operator's recollection of a maintainer's "You are wrong." was correct, and it took a direct question to surface it.
  Impact: roughly 8 tool calls of recovery across turns 42–49 (searching `earendil-works/pi`, reading #8200, #4785, and PR #4784), and a materially changed framing arriving after the design had settled — [earendil-works/pi#4785] targets the [#864] family, not this mechanism, so nothing upstream had ruled on this claim at all.
- `instruction-violation` (reviewer-caught) — the ADR's `pi-tui` line citations were read from the `../../pi` checkout instead of the pinned dependency.
  `AGENTS.md` names this trap explicitly, and the failure has a sharper edge than the rule currently describes: the checkout **drifted mid-session**, moving `compositeOverlays` from 267 at planning time to 268 by implementation.
  A number captured correctly earlier can therefore rot in place.
  Impact: one extra commit (`0f545a77`) plus a correction to the already-committed plan and retro; the corrected text ships in the npm tarball, so the defect was one review away from being published.
- `missing-context` (user-caught) — `docs/triage/2026-09-02-backlog.md` bands this issue with [#864] at rank 3 and records a shared-cause hypothesis, and the planning session did not read it.
  The operator supplied it at turn 10.
  Impact: no rework — two greps settled the hypothesis as false — but the framing input arrived from the operator rather than from the sweep that exists to find it.
- `other` (self-identified at retro) — four of the five SHAs in the ship close comment are wrapped in backticks, so they do not auto-link on GitHub.
  `/ship-worktree`'s rule is scoped to the "Implemented in" SHA alone ("so GitHub auto-links **it**"), while `/ship-issue`'s equivalent covers "every SHA the comment will contain".
  Impact: cosmetic, no rework — but the artifact is already posted on a closed issue.
- `instruction-violation` (self-identified) — a mistyped absolute path (`/Users/chris/development/pi/pi-permission-system/…`, missing the worktree prefix) tripped the `external_directory` gate instead of failing fast.
  Impact: one wasted tool call.
  `AGENTS.md` already carries this rule and the gate behaved exactly as documented; no change proposed.

#### What caused friction (user side)

- The two highest-value interventions were both **context the operator held and the agent should have derived** — the triage note (turn 10) and the upstream "You are wrong." recollection (turn 41).
  Both arrived as corrections after the agent had committed to a framing, rather than as inputs to it.
  The opportunity is not for the operator to volunteer more: it is for `/plan-issue` to sweep the two sources those facts live in, which is where both proposals below land.
- The turn-28 scoping instruction ("document thoroughly, but do not file — that has to be filed by a human, and it has to be brief") was a clean strategic intervention that produced two correctly-shaped artifacts instead of one confused one.
  Nothing to change.

### Diagnostic details

- **Model-performance correlation** — planning, TDD, and this ship session ran on `anthropic/claude-opus-5`; the sync stage ran on `anthropic/claude-sonnet-5`.
  Planning and TDD are the judgment-heavy stages (source tracing, reproduction design, mutation reasoning) and were well matched.
  Sync on sonnet-5 was also well matched — two lint gates, a rebase, and a breadcrumb — and it executed cleanly, which is evidence the mechanical stages do not need opus.
  The ship stage is comparable in shape: deterministic prompt-following with a single judgment step (drafting the close comment), and the one defect it produced was in exactly that step.
  Not proposing a model change, since a wrong close comment is a published artifact, but the asymmetry is worth noting.
- **Escalation-delay tracking** — no sequence exceeded the 5-call threshold on a single error.
  The nearest candidate is the reproduction hunt (peer turns 55–61, three attempts before contamination appeared), but each attempt falsified a different hypothesis and the third produced the threshold measurement; that is the method working, not a rabbit hole.
- **Unused-tool detection** — for the upstream-posture gap, `gh issue list --repo earendil-works/pi` was available throughout and was never dispatched until the operator asked; `AGENTS.md` already directs agents to `gh` rather than web search for upstream trackers, so the tool was known and simply not reached for.
  No subagent gap: `tidy-first-assessor` and `pre-completion-reviewer` were both dispatched at their designated points, and the latter returned the session's most valuable finding.
- **Feedback-loop gap analysis** — no gap.
  Baseline on all four gates before step 1, `pnpm run check` after five of seven steps, and per-step `vitest` runs scoped to the affected file throughout.

### Changes made

1. `.pi/prompts/plan-issue.md` — Gather context step 4 now reads the newest `docs/triage/*.md` for an entry on the issue, framing a triage hypothesis as a lead to verify rather than a finding.
2. `.pi/prompts/plan-issue.md` — same step now searches the upstream tracker when the diagnosis attributes the defect to a dependency, separating "the source says so" from "the maintainer agrees".
3. `AGENTS.md` — the `pi`-checkout paragraph now states that a line number read there is not citable, and directs citations to the installed package's sourcemap (`dist/*.js.map`, `sourcesContent`).
4. `.pi/prompts/ship-worktree.md` — the close-comment SHA rule now covers every SHA in the comment, matching `/ship-issue`'s existing wording.

[#864]: https://github.com/gotgenes/pi-packages/issues/864
[#874]: https://github.com/gotgenes/pi-packages/issues/874
[earendil-works/pi#2759]: https://github.com/earendil-works/pi/issues/2759
[earendil-works/pi#4785]: https://github.com/earendil-works/pi/issues/4785
