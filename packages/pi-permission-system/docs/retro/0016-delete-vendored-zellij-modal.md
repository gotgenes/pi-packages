---
issue: 16
issue_title: "Delete vendored src/zellij-modal.ts; rebuild settings UI on pi-tui"
---

# Retro: #16 — Delete vendored zellij-modal; rebuild settings UI on pi-tui

## Final Retrospective (2026-05-03T01:20:00Z)

### Session summary

Deleted the 1,117-line vendored `src/zellij-modal.ts` and rewrote `openSettingsModal()` in `src/config-modal.ts` to use `SettingsList` from `pi-tui` directly.
The `/permission-system` slash command behavior is unchanged.
Released as v0.8.0.

### Observations

#### What went well

- **Type declaration check before planning.**
  Reading `node_modules/.ignored/@mariozechner/pi-tui/dist/components/settings-list.d.ts` confirmed that `SettingsList` already implements `Component` with `render`/`handleInput`/`invalidate`/`onChange`/`onCancel` — making the design obvious and the implementation trivial (~20 lines replacing ~60).
- **Single-commit functional change.**
  The plan initially had a 5-step TDD order, but `/tdd-plan` correctly collapsed it to 1 functional commit since there was no useful intermediate state.
  The result was clean: 1,189 lines removed, 18 added, all tests green.

#### What caused friction (agent side)

- `premature-convergence` — The initial plan accepted the issue's premise ("rebuild the modal on `pi-tui`") without questioning whether the modal should exist at all.
  When the user challenged with "why would we provide a TUI to the settings?", the agent immediately agreed the modal should be dropped.
  When pointed to issue #10 (config consolidation), the agent doubled down on dropping it.
  It took a third user message ("port this" with the concrete reason: zero-cost toggles save token usage) to land on the right approach.
  Impact: three rounds of plan revision before writing the final version; no rework in code since planning preceded implementation.
- `scope-drift` — When the user asked "Have we updated all our documentation?", the agent interpreted this as "are there stale references to `zellij-modal`?" and did a thorough grep.
  The user's actual question was whether user-facing behavior had changed in a way that needed documentation.
  The answer was no (behavior unchanged), but the agent reached the right conclusion via the wrong reasoning.
  Impact: added friction but no rework.

#### What caused friction (user side)

- The user's Socratic questioning (three progressively focused questions: "why a TUI?" → "look at #10" → "what settings?" → "port this") was effective at surfacing the right design, but could have been front-loaded with a single redirecting statement like "the modal is worth keeping for zero-cost toggles; just port it to `pi-tui` directly."
  This would have saved two planning rounds.
  That said, the Socratic approach may have been intentional — testing whether the agent would question the premise independently.

#### CI friction (pre-existing)

- Biome schema version drifted from 2.4.13 to 2.4.14 between releases, causing CI failure on lint despite local `npm run lint:all` passing with warnings.
  Fixed in `f2750da` alongside two other pre-existing lint issues (`.pi/extensions/pi-autoformat/config.json` formatting, `noConfusingVoidType` in `tests/permission-system.test.ts`).
  This is the same pattern seen in issues #6 and #13 — lint drift accumulates silently between releases.
