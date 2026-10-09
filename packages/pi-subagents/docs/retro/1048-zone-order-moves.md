---
issue: 1048
issue_title: "pi-subagents: move record-observer into lifecycle/ and the notification renderer into ui/"
---

# Retro: #1048 — pi-subagents: move record-observer into lifecycle/ and the notification renderer into ui/

## Stage: Planning (2026-10-09T06:20:27Z)

### Session summary

Planned the two zone-order moves (`record-observer.ts` to `lifecycle/`, `renderer.ts` to `ui/notification-renderer.ts`) as two `refactor:` commits, a `docs:` commit, and the roadmap completion mark.
Spiked the whole move in the worktree before writing the plan, measured it, and reset it.

### Observations

- The issue's acceptance claim was wrong as written.
  With only the two `allow` narrowings it names, `fallow dead-code` reports 1 boundary violation, because the moved renderer's `import type` of the `*Details` contracts (in `observation/notification.ts`) becomes a new `ui → observation` edge.
  The operator chose `"allowTypeOnly": ["pi-subagents/observation"]` on the `ui` zone over a full `allow` or relocating the types to `src/types.ts`.
- Three ratchet probes stand in for killing mutations, all measured against the spike, each reporting 1 violation: (A) a `lifecycle → observation` import, (B) the inline `import { type … }` form, and (C) an `observation → ui` import.
  Probe B shows that fallow reads the inline `type` modifier as a value import, so the renderer must keep its top-level `import type`.
- Tidy-First assessor: nothing recommended.
  The optional trim of `record-observer.ts`'s provenance header sentence is folded into step 1.
  The rename to a broader filename was declined, since the roadmap already names `notification-renderer.ts`.
- The assessor reported that `fallow guard` fails in this worktree ("autoDiscover path did not resolve"), but it ran fine inline.
  That failure is specific to the subagent's environment and is not a finding.

#### Deferred tidyings

- `src/observation/renderer.ts`: the three `create*Renderer` factories share line-assembly shape (assessor judged the divergence structural; rejected as scope creep).
- `src/observation/renderer.ts`: pure helpers (`buildStatsParts`, `buildPreviewLines`, `resolveStatusPresentation`) live beside the factories; a split is a separate concern.

## Stage: Implementation — Build (2026-10-09T15:53:56Z)

### Session summary

All four plan steps landed: two `refactor:` moves (each narrowing its own `.fallowrc.json` zone, the second adding the `ui` zone's `allowTypeOnly: ["pi-subagents/observation"]`), a `docs:` commit stating the zone order in `architecture.md` and the package skill, and the roadmap ✅ marks with a `Landed:` note.
The pi-subagents suite stayed at 86 files and 2100 tests, as predicted.

### Observations

- No deviations from the plan.
- Probes A, B, and C each reported exactly 1 boundary violation against the committed config, matching the planning spike.
- Biome's `organizeImports` reorders a rewritten `#src/` import path (both `subagent.ts` and `index.ts` moved position), so each move step needed `biome check --write` before lint passed; expect this on any path-rewriting move.
- `pi-autoformat` collapsed the `observation` zone's two-item `allow` array onto one line in `.fallowrc.json`; harmless.
- The roadmap step's own Cause/Target prose (`architecture.md` lines 982 and 986) keeps the old `observation/renderer.ts` path deliberately, as a description of the step.
- Pre-completion reviewer: PASS.
