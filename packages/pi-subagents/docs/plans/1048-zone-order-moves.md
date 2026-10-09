---
issue: 1048
issue_title: "pi-subagents: move record-observer into lifecycle/ and the notification renderer into ui/"
---

# Move record-observer into lifecycle/ and the notification renderer into ui/

## Release Recommendation

**Release:** ship independently

The roadmap tags this step `Release: independent` and lists it under "Release batches" as `refactor:` only, so it cuts no release on its own.
Its commits are `refactor:` and `docs:`, which `cliff.toml` skips, and the next release vehicle in Track A ([#1049]) carries them.

## Problem Statement

The architecture doc's "Module organization" section names two allowed fallow edges that run against the order the package's directories imply, and leaves open whether they should exist.

- `lifecycle/` imports `subscribeSubagentObserver` from `observation/record-observer.ts`.
  That module has one caller (`lifecycle/subagent.ts`) and writes into one object (`SubagentState`, in `lifecycle/`); it is the run's own metric accumulator, filed by what it touches rather than by who owns it.
- `observation/` imports `display` and `glyphs` from `ui/` through `observation/renderer.ts`.
  That module is presentation (the TUI components for completion nudges, mid-run updates, and workspace notices), and its only importer is the composition root.

Phase 23's discovery settles the order: `lifecycle/` is the core, `observation/` reacts to it, and `ui/` renders both.
Each module is the sole reason for its backwards edge, so moving each to its owner's directory removes the edge, and narrowing `.fallowrc.json` keeps it gone.

## Goals

- Move `src/observation/record-observer.ts` to `src/lifecycle/record-observer.ts`, with its test.
- Move `src/observation/renderer.ts` to `src/ui/notification-renderer.ts`, with its test.
- Narrow `.fallowrc.json` so both backwards edges are ratcheted out:
  - `pi-subagents/lifecycle` drops `pi-subagents/observation` from `allow`;
  - `pi-subagents/observation` drops `pi-subagents/ui` from `allow`;
  - `pi-subagents/ui` gains `"allowTypeOnly": ["pi-subagents/observation"]`, the forward edge the moved renderer's `import type` of the `*Details` message contracts needs (operator decision, see Design Overview).
- Replace the "Module organization" paragraph with a statement of the zone order, and bring the module tree, domain-model diagram, and package skill's domain table in line.
- Not breaking: no behavior, output, default, or public export changes.
  Neither module is reachable from the package's `exports` map (`src/service/service.ts`, `src/layered-settings.ts`).

## Non-Goals

- Moving the `NotificationDetails` / `UpdateDetails` / `WorkspaceNoticeDetails` types out of `observation/notification.ts`.
  They are the message contract `observation/` produces and `ui/` renders; the operator chose a type-only edge over relocating them.
- Renaming `subscribeSubagentObserver`, `SubagentObserverOptions`, or the renderer's exports or file-local interfaces (`RendererTheme`, `RendererMessage`, …).
  The Tidy-First assessor found no collision with `ui/widget-renderer.ts` (which exports only `WidgetAgent`) or with [#1049]'s planned `src/lifecycle/subagent-run.ts`.
- Restructuring the three `create*Renderer` factories, or splitting the pure helpers from the factories (assessor: rejected as scope creep).
- Tightening other zones' edges to `allowTypeOnly` beyond the one this move introduces.
- [#1049]'s per-run subscription; this step only puts the record observer where [#1049] will call it.
- `docs/architecture/client-server-opportunities.md` and `docs/architecture/history/` name `record-observer` by module name, not path, and describe history or a hypothetical; predicted unchanged.

## Background

- `src/observation/record-observer.ts` (76 lines) imports only `#src/lifecycle/subagent-state` (type) and `#src/types` (type).
  Importers: `src/lifecycle/subagent.ts:21` and `test/observation/record-observer.test.ts:3`.
  No `vi.mock("#src/observation/record-observer")` exists anywhere in `test/` (grepped `record-observer` across `src/` and `test/`).
- `src/observation/renderer.ts` (162 lines) imports `#src/lifecycle/subagent-state`, `#src/lifecycle/turn-limits`, `#src/ui/display`, `#src/ui/glyphs`, and `import type { NotificationDetails, UpdateDetails, WorkspaceNoticeDetails } from "#src/observation/notification"`.
  Importers: `src/index.ts:40-44` and `test/observation/renderer.test.ts:15`.
- `.fallowrc.json` encodes one boundary zone per `src/` directory; each zone's `allow` list was the set of zones it imported when the zones were encoded.
  `pi-subagents/ui` currently allows `config`, `core`, `lifecycle`; it does **not** allow `observation`.
  `allowTypeOnly` reads the `import type` **syntax**, not the imported symbol's kind (fallow skill), and is already used by pi-permission-system's `policy/` zone.
- AGENTS.md / package skill: run `pnpm --silent fallow guard <file>` before adding a cross-directory import, and extend a zone's allow list in the same commit as the intended edge, saying why in the commit body.

## Design Overview

### How the design was verified

The full move was spiked in this worktree at planning time (`git mv` of the four files, four import rewrites, the `.fallowrc.json` edits), measured, then reset:

| Measurement (measured, 2026-10-09)                                                         | Result                                                                                  |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| `vitest run` on the two moved test files                                                   | 2 files, 54 tests passed                                                                |
| `pnpm --filter @gotgenes/pi-subagents run check`                                           | clean                                                                                   |
| Both issue greps (`#src/observation/` in `src/lifecycle`, `#src/ui/` in `src/observation`) | no output                                                                               |
| `fallow dead-code`, issue's two narrowings only                                            | **1 boundary violation**: `ui/notification-renderer.ts:6 → observation/notification.ts` |
| `fallow dead-code`, plus `ui` `allowTypeOnly: ["pi-subagents/observation"]`                | No issues found                                                                         |

The issue's acceptance claim ("fallow reports no boundary violation") does not hold with only the two narrowings it names: moving the renderer turns its `import type` of the `*Details` contracts into a new `ui → observation` edge.
That edge runs **with** the stated order (`ui/` renders both), so it is admitted, as type-only.

### Decision: `allowTypeOnly` for the new forward edge

Options put to the operator: `allowTypeOnly` on the `ui` zone (recommended), a full `allow`, or relocating the `*Details` types to `src/types.ts`.
The operator chose `allowTypeOnly`: it admits exactly the edge the renderer has (types only), and a later value import from `observation/` into `ui/` is still reported.

Resulting `.fallowrc.json` rules (only the three changed rules shown):

```jsonc
{ "from": "pi-subagents/lifecycle", "allow": ["pi-subagents/config", "pi-subagents/core", "pi-subagents/session"] },
{ "from": "pi-subagents/observation", "allow": ["pi-subagents/core", "pi-subagents/lifecycle"] },
{
  "from": "pi-subagents/ui",
  "allow": ["pi-subagents/config", "pi-subagents/core", "pi-subagents/lifecycle"],
  "allowTypeOnly": ["pi-subagents/observation"]
}
```

### Ratchet probes (measured against the spike)

Each probe is a one-line temporary edit applied after the relevant step, run through `pnpm --silent fallow dead-code --workspace @gotgenes/pi-subagents`, then reverted.

| Probe                           | Edit                                                                                                                      | Measured result                                                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| A — lifecycle edge stays gone   | prepend `import type { NotificationDetails } from "#src/observation/notification";` to `src/lifecycle/record-observer.ts` | 1 violation, `pi-subagents/lifecycle → pi-subagents/observation` |
| B — ui edge is type-only        | rewrite the renderer's `import type { NotificationDetails, …}` to `import { type NotificationDetails, …}`                 | 1 violation, `pi-subagents/ui → pi-subagents/observation`        |
| C — observation edge stays gone | prepend `import type { WidgetAgent } from "#src/ui/widget-renderer";` to `src/observation/notification.ts`                | 1 violation, `pi-subagents/observation → pi-subagents/ui`        |

Probe B also shows that fallow treats the inline `type` modifier as a value import; the renderer must keep the top-level `import type` form it already has.

### Moved-code hygiene

A move is a copy, so the moved code is re-read against `code-design` before committing.
The assessor found one violation: `record-observer.ts`'s header opens with provenance ("Replaces the scattered callback-wrapping logic in SubagentManager's startAgent() and resume() …"), which AGENTS.md principle 3 puts in git.
Step 1 drops that sentence; the rest of the header (what it subscribes to, that it targets `SubagentState` and carries no dependency on `Subagent`) describes current behavior and stays.

## Module-Level Changes

### Source and tests

- `src/observation/record-observer.ts` → `src/lifecycle/record-observer.ts` (`git mv`; header provenance sentence dropped).
- `test/observation/record-observer.test.ts` → `test/lifecycle/record-observer.test.ts` (`git mv`; import path).
- `src/lifecycle/subagent.ts` — import path at line 21.
- `src/observation/renderer.ts` → `src/ui/notification-renderer.ts` (`git mv`, verbatim).
- `test/observation/renderer.test.ts` → `test/ui/notification-renderer.test.ts` (`git mv`; import path).
- `src/index.ts` — import path at lines 40-44.
- `.fallowrc.json` — the three rules above.

Predicted unchanged (blast radius, with the claim each rests on):

- `test/lifecycle/subagent.test.ts` — it exercises `subscribeSubagentObserver` through `Subagent` without mocking the module path (no `vi.mock` of `record-observer` in `test/`).
- `src/types.ts:46` and `src/lifecycle/subagent-state.ts`, `src/lifecycle/run-listeners.ts` — their comments name `record-observer` by module name, which does not change.
- `src/observation/notification.ts` — keeps the `*Details` types.

### Docs

- `packages/pi-subagents/docs/architecture/architecture.md`:
  - "Module organization" (lines 337-340): replace the two-edge paragraph with a statement of the zone order (`lifecycle/` is the core, `observation/` reacts to it, `ui/` renders both), noting that `ui/` reaches `observation/` for types only (`allowTypeOnly`).
  - "Current layout" tree: `record-observer.ts` entry moves under `lifecycle/`; `renderer.ts` becomes `notification-renderer.ts` under `ui/`; the `observation/` directory caption ("progress tracking and notification") no longer describes progress tracking, so reword it to what the directory now holds (notification, outcome delivery, lifecycle-event emission, observer fan-out).
  - "Domain model" Mermaid block (line ~101): the `RecordObserver` node moves from the `observation` subgraph to the `lifecycle` subgraph; its `subscribes` edge to `SubagentSession` is unchanged.
    Node-label check: no other node models these two modules (grepped `record-observer`, `renderer.ts`).
  - Phase 23 roadmap: ✅ on the `#### [#1048]` heading and on the `S1048` node in the step dependency diagram, plus a `Landed:` note — `/tdd-plan` lands these at implementation completion.
  - The health-metrics table is a baseline record and keeps its baseline values; the two zone-import rows reading 0 is reported in the `Landed:` note.
- `.pi/skills/package-pi-subagents/SKILL.md` domain table: Lifecycle row gains `record-observer.ts` (14 → 15 modules) and "session-event stats"; Observation row loses `record-observer.ts` and `renderer.ts` (6 → 4) and their responsibilities ("Session-event stats", "notification rendering"); UI row gains notification-message rendering (10 → 11).
  The "72 files" total is unchanged.

## Test Impact Analysis

1. New tests enabled: none; this is a relocation with no new seam.
2. Tests made redundant: none.
3. Tests that stay as-is: both moved test files, verbatim apart from the import path.
   `test/lifecycle/record-observer.test.ts` keeps pinning every event arm; `test/ui/notification-renderer.test.ts` keeps pinning all six exports.

The boundary ratchet's testable surface is `fallow dead-code`; Probes A-C are its mutation checks.
The suite's file and test counts are unchanged across the change: compare the full-suite summary before Step 1 and after Step 2.

## Invariants at risk

- [#947] `Landed:` — `record-observer` stamps every session event as the run's last progress (`SubagentState.lastProgressAt`).
  Pinned by `describe("progress")` in `test/observation/record-observer.test.ts` (line 209), which drives a real `SubagentState` through `createMockSession` (no mock of the module under test); it moves with the file and must stay green.
  Constituency: the `get_subagent_result` report's `Progress:` line.
- The three message renderers stay registered under their channel names (`subagent-notification`, `subagent-update`, `subagent-workspace-notice`) in `src/index.ts`; only the import path changes.
  `tsc` pins the import; the full suite runs `index.ts`'s registration.

## TDD Order

No step adds a behavior test; each is a verbatim move whose verification is the existing suite, `tsc`, and fallow's boundary check, with a ratchet probe standing in for a killing mutation.

1. **Move the record observer into `lifecycle/`.**
   `git mv src/observation/record-observer.ts src/lifecycle/record-observer.ts` and `git mv test/observation/record-observer.test.ts test/lifecycle/record-observer.test.ts`; rewrite the import in `src/lifecycle/subagent.ts` and the moved test; drop the header's provenance sentence; in `.fallowrc.json`, remove `pi-subagents/observation` from `pi-subagents/lifecycle`'s `allow`.
   Verify: `vitest run test/lifecycle/record-observer.test.ts test/lifecycle/subagent.test.ts`, `run check`, `fallow dead-code --workspace @gotgenes/pi-subagents` reports no issues, and `grep -rlE '#src/observation/' packages/pi-subagents/src/lifecycle` prints nothing.
   Ratchet probe (instead of a killing mutation): Probe A must report 1 violation; revert it.
   Commit: `refactor(pi-subagents): move record-observer into lifecycle/` (body: the lifecycle zone drops `observation` because this was its only importer).
2. **Move the notification renderer into `ui/`.**
   `git mv src/observation/renderer.ts src/ui/notification-renderer.ts` and `git mv test/observation/renderer.test.ts test/ui/notification-renderer.test.ts`; rewrite the import in `src/index.ts` and the moved test; in `.fallowrc.json`, remove `pi-subagents/ui` from `pi-subagents/observation`'s `allow` and add `"allowTypeOnly": ["pi-subagents/observation"]` to `pi-subagents/ui`.
   Run `pnpm --silent fallow guard packages/pi-subagents/src/ui/notification-renderer.ts` and confirm it reports `type-only: pi-subagents/observation`.
   Verify: `vitest run test/ui/notification-renderer.test.ts`, `run check`, `fallow dead-code` reports no issues, `grep -rlE '#src/ui/' packages/pi-subagents/src/observation` prints nothing, then the full package suite.
   Ratchet probes: Probe B and Probe C must each report 1 violation; revert both.
   Commit: `refactor(pi-subagents): move the notification renderer into ui/` (body: why `ui` gains a type-only edge to `observation` — the renderer reads the `*Details` contracts `observation/notification.ts` produces).
3. **State the zone order in the docs.**
   Apply the architecture-doc and package-skill updates under "Docs" above, except the roadmap ✅ marks and `Landed:` note.
   Verify: `pnpm exec rumdl check` on both files; re-read the Mermaid domain-model block (`mermaid` skill) after moving the node.
   Commit: `docs(pi-subagents): state the zone order and relocate the two moved modules`.
4. **Roadmap completion** (lands with `/tdd-plan`'s completion step): ✅ on the `#### [#1048]` heading and the `S1048` node, and a `Landed:` note recording both zone-import rows at 0 and the `ui` type-only edge.
   Commit: `docs(pi-subagents): mark #1048 landed`.

## Risks and Mitigations

| Risk                                                                                                                                                             | Mitigation                                                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A future lint or formatter pass rewrites the renderer's `import type {…}` to the inline `import { type … }` form, which fallow reads as a value import (Probe B) | The file already passes Biome and ESLint in the top-level form, so no current rule rewrites it; a rewrite would surface as a `boundary-violation` in `fallow dead-code`, not silently.                                                                                                                               |
| Git loses rename detection, making the moves read as delete + add                                                                                                | The moves are verbatim apart from import lines and one dropped comment sentence; confirm `git show --stat` reports renames (`{observation => lifecycle}`) before each commit.                                                                                                                                        |
| A stale doc reference to the old paths survives                                                                                                                  | Module-Level Changes lists every path mention grepped at planning time (`architecture.md` lines 101, 337, 395, 398; skill table line 81); step 3 re-greps `observation/renderer` and `observation/record-observer` across `packages/pi-subagents/docs` (excluding `plans/`, `retro/`, `history/`) and `.pi/skills/`. |

## Open Questions

None.

[#947]: https://github.com/gotgenes/pi-packages/issues/947
[#1049]: https://github.com/gotgenes/pi-packages/issues/1049
