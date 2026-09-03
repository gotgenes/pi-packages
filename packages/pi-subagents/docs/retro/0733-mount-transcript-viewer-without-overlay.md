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

[#864]: https://github.com/gotgenes/pi-packages/issues/864
[#874]: https://github.com/gotgenes/pi-packages/issues/874
[earendil-works/pi#2759]: https://github.com/earendil-works/pi/issues/2759
[earendil-works/pi#4785]: https://github.com/earendil-works/pi/issues/4785
