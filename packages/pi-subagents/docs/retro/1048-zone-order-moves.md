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
