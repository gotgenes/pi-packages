---
issue: 559
issue_title: "pi-permission-system: complete the authority/ directory migration"
---

# Complete the `authority/` directory migration

## Release Recommendation

**Release:** ship independently

This is Phase 9 Step 5 — a pure directory move tagged `Release: independent` in the roadmap.
It lands as a `refactor:` commit (hidden changelog type), so it does not cut a release on its own; it auto-batches into the next `feat:`/`fix:`/unhidden-`docs:` release.
Phase 9 declares no multi-step release batch — every step leaves the package consistent on its own — so there is nothing to defer or coordinate.

## Problem Statement

Phase 8's forward-looking `src/` directory sketch places the whole escalation/forwarding/subagent domain under `src/authority/`: the subagent machinery is the cross-session edge of the authority domain, not a peer domain.
Phase 9 Steps 1–4 rewrote most of those modules into `src/authority/` as they were reworked (tidy-first — a file reaches its final home as it is rewritten).
Five modules never needed a rewrite, so they still sit in the flat `src/` root.
This step moves that mechanical remainder so the domain is closed, the flat root shrinks, and each file has moved exactly once across Phase 9.

## Goals

- Relocate the five remaining escalation/forwarding/subagent modules into `src/authority/`.
- Rewrite every import of the moved modules (parent-relative imports become `#src/authority/…` aliases; same-directory refs stay `./`).
- Mirror the established `src/authority/foo.ts` ↔ `test/authority/foo.test.ts` layout by moving the five modules' test files into `test/authority/`.
- Mark Phase 9 Step 5 complete in `docs/architecture/architecture.md` (module tree, step heading, Mermaid node) in the same commit as the move.
- Preserve behavior exactly — this is a directory move, not a logic change.

Non-breaking: no exported symbol, config default, or observable behavior changes.
The moved modules are all internal (no `package.json` `exports` re-export among them), so no consumer outside the package is affected.

## Non-Goals

- No logic, signature, or behavior changes to any moved module.
- No renaming of any exported symbol — only file locations and import specifiers change.
- No rework of the `authority/` subtree's existing residents (Steps 1–4 modules).
- No update to `docs/architecture/v3-architecture.md` — it is a frozen pre-`authority/` snapshot (last touched at #314, before the `authority/` subtree existed) and is not maintained as current state.
  Touching two of its stale tree lines would leave it internally inconsistent; leave it as the historical artifact it is.
- No changes to `docs/plans/*`, `docs/retro/*`, or `docs/architecture/history/*` — those are frozen per-issue records.

## Background

Relevant modules and their current relationships (verified against `src/`):

| Module                             | Imports (relative)                                                                                  | Imported by                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `src/permission-dialog.ts`         | none (leaf)                                                                                         | 9 `authority/` files, `handlers/gates/runner.ts` |
| `src/subagent-registry.ts`         | none (leaf)                                                                                         | 5 `authority/` files                             |
| `src/subagent-lifecycle-events.ts` | `./subagent-registry`                                                                               | `index.ts`, tests                                |
| `src/permission-forwarding.ts`     | `./permission-dialog`, `./permission-events`, `./subagent-registry`                                 | 5 `authority/` files, test helpers               |
| `src/forwarding-manager.ts`        | `./authority/forwarded-request-server`, `./authority/subagent-detection`, `./permission-forwarding` | `index.ts`, test helpers                         |

`src/authority/` already holds the Phase 8/9 residents (`authorizer.ts`, `local-user-authorizer.ts`, `authorizer-selection.ts`, `permission-prompter.ts`, `approval-escalator.ts`, `forwarded-request-server.ts`, `forwarding-io.ts`, `subagent-context.ts`, `subagent-detection.ts`, `forwarder-context.ts`, `denying-authorizer.ts`).

AGENTS.md / eslint constraints that shape the move:

- The root `eslint.config.js` `local-rules/no-parent-relative-imports` rule flags any `../…` import in `packages/*/src|test/` and auto-fixes it to the package's `#src/`/`#test/` alias.
  Same-directory `./…` imports are permitted (that is why `index.ts` and these modules use `./sibling` today).
  So after the move, `eslint --fix` mechanically rewrites the parent-relative cases; `tsc` catches any missed path.
- `#src/…` aliases are package-root-absolute: an importer's `#src/permission-dialog` becomes `#src/authority/permission-dialog` because the target moved, regardless of the importer's own location.
- The package skill requires the architecture step-complete marker to land in the implementation commit, not a deferred ship commit.

## Design Overview

Pure relocation.
Five files move from `src/` root into `src/authority/`; their five test files move from `test/` root into `test/authority/`.
The `authority/` subtree already imports four of the five via `#src/…` aliases, so the dependency direction is unchanged — the modules are already logical `authority/` residents, only their physical location is stale.

Import-rewrite rules by category (mechanically enforced by `tsc` + `eslint --fix`):

1. Moved modules that reference each other stay `./sibling` (all five land in the same `authority/` directory): `permission-forwarding.ts` keeps `./permission-dialog` and `./subagent-registry`; `subagent-lifecycle-events.ts` keeps `./subagent-registry`; `forwarding-manager.ts` keeps `./permission-forwarding`.
2. Moved modules that reference an existing `authority/` resident lose the `authority/` path segment: `forwarding-manager.ts`'s `./authority/forwarded-request-server` → `./forwarded-request-server`, `./authority/subagent-detection` → `./subagent-detection`.
3. Moved modules that reference a module staying in `src/` root gain a `#src/` alias (was same-dir `./`, now parent-relative): `permission-forwarding.ts`'s `./permission-events` → `#src/permission-events`.
4. Existing `authority/` importers of a moved module gain the `authority/` segment: `#src/permission-dialog` → `#src/authority/permission-dialog`, `#src/subagent-registry` → `#src/authority/subagent-registry`, `#src/permission-forwarding` → `#src/authority/permission-forwarding`.
5. `handlers/gates/runner.ts` and test files/helpers: same `#src/…` → `#src/authority/…` rewrite as (4).
6. `index.ts` (composition root, same-dir `./` style): `./forwarding-manager` → `./authority/forwarding-manager`, `./permission-dialog` → `./authority/permission-dialog`, `./subagent-lifecycle-events` → `./authority/subagent-lifecycle-events`, `./subagent-registry` → `./authority/subagent-registry`.

No collaborator is introduced, no signature changes, no state moves — this is not an extraction, so the anti-procedure-splitting and Tell-Don't-Ask reviews do not apply.
The existing test suite plus `tsc` and `eslint` are the full correctness proof: a green suite after the move demonstrates behavior preservation.

## Module-Level Changes

Source moves (`git mv`, no content change beyond import specifiers):

1. `src/permission-dialog.ts` → `src/authority/permission-dialog.ts` (leaf; no import edits in the file itself).
2. `src/subagent-registry.ts` → `src/authority/subagent-registry.ts` (leaf; no import edits).
3. `src/subagent-lifecycle-events.ts` → `src/authority/subagent-lifecycle-events.ts` (`./subagent-registry` unchanged — same dir).
4. `src/permission-forwarding.ts` → `src/authority/permission-forwarding.ts` (`./permission-events` → `#src/permission-events`; `./permission-dialog` and `./subagent-registry` unchanged).
5. `src/forwarding-manager.ts` → `src/authority/forwarding-manager.ts` (`./authority/forwarded-request-server` → `./forwarded-request-server`; `./authority/subagent-detection` → `./subagent-detection`; `./permission-forwarding` unchanged).

Importer updates (`#src/…` → `#src/authority/…` for the moved symbols):

6. `src/authority/authorizer-selection.ts`, `approval-escalator.ts`, `forwarded-request-server.ts`, `forwarder-context.ts`, `denying-authorizer.ts`, `permission-prompter.ts`, `local-user-authorizer.ts`, `forwarding-io.ts`, `authorizer.ts`, `subagent-context.ts`, `subagent-detection.ts` — update their `#src/permission-dialog` / `#src/subagent-registry` / `#src/permission-forwarding` imports to the `#src/authority/…` form (11 files; some import two of the moved modules).
7. `src/handlers/gates/runner.ts` — `#src/permission-dialog` → `#src/authority/permission-dialog`.
8. `src/index.ts` — the four `./…` imports of `forwarding-manager`, `permission-dialog`, `subagent-lifecycle-events`, `subagent-registry` → `./authority/…`.

Test moves (mirror the `test/authority/` layout) + import updates:

9. `test/permission-dialog.test.ts` → `test/authority/permission-dialog.test.ts`.
10. `test/subagent-registry.test.ts` → `test/authority/subagent-registry.test.ts`.
11. `test/subagent-lifecycle-events.test.ts` → `test/authority/subagent-lifecycle-events.test.ts`.
12. `test/permission-forwarding.test.ts` → `test/authority/permission-forwarding.test.ts`.
13. `test/forwarding-manager.test.ts` → `test/authority/forwarding-manager.test.ts`.
    Each moved test updates its `#src/<module>` import to `#src/authority/<module>` (the `#src/`/`#test/` aliases are absolute, so the test's own new location needs no other edits).

Test-helper importer updates (helpers stay in `test/helpers/`):

14. `test/helpers/forwarding-fixtures.ts` — `#src/permission-forwarding` → `#src/authority/permission-forwarding`; `#src/subagent-registry` → `#src/authority/subagent-registry`.
15. `test/helpers/session-fixtures.ts` — `#src/forwarding-manager` → `#src/authority/forwarding-manager`.
16. `test/composition-root.test.ts` and any remaining test importers (`test/authority/*.test.ts` already using `#src/permission-forwarding` / `#src/subagent-registry`) — same `#src/…` → `#src/authority/…` rewrite (caught by `tsc`).

Documentation updates (current-state docs only; land in the same commit):

17. `docs/architecture/architecture.md`:
    - Move the five module descriptions out of the flat-root listing (lines for `permission-dialog.ts`, `subagent-registry.ts`, `subagent-lifecycle-events.ts`, `permission-forwarding.ts`, `forwarding-manager.ts`) into the `authority/` subtree block, preserving their descriptions and fixing the tree connector glyphs (`├──`/`└──`) so the subtree's last child is the only `└──`.
    - Mark Step 5 complete: prefix the `**Complete the `authority/` migration.**` step heading with `✅` and update the Mermaid `S5` node label to `"✅ Step 5 (#559)<br/>Complete authority/ migration"`.
    - The Phase 9 target table's `Flat `src/` root modules ~67 → ~62` row is a target/exit table and needs no edit — the move realizes the already-stated target.
18. `docs/subagent-integration.md` — update the two prose path references `src/subagent-lifecycle-events.ts` → `src/authority/subagent-lifecycle-events.ts` and `src/subagent-registry.ts` → `src/authority/subagent-registry.ts`.
19. `.pi/skills/package-pi-permission-system/SKILL.md` — update the two prose path references (`src/subagent-lifecycle-events.ts`, `src/subagent-registry.ts`) to their `src/authority/…` forms.

No moved module has a `package.json` `exports` re-export, `Symbol.for()` cross-extension surface, or event-channel name that changes — the `getSubagentSessionRegistry()` accessor and its `Symbol.for("@gotgenes/pi-permission-system:subagent-registry")` key are unchanged; only `subagent-registry.ts`'s file location moves.
So no wider `docs/` grep beyond the three current-state files above is warranted (the remaining hits are frozen plans/retros/history).

## Test Impact Analysis

This is a move, not an extraction, so the three extraction questions resolve trivially:

1. No new unit tests are enabled — no new seam or collaborator is created.
2. No existing tests become redundant — every test still exercises the same module at the same granularity; only the file path and one import line change.
3. All five moved test files must stay as-is (content-wise) — they genuinely exercise the moved modules.
   They relocate to `test/authority/` for layout consistency, keeping their assertions intact.

The full existing suite (`pnpm --filter @gotgenes/pi-permission-system run test`) staying green after the move is the behavior-preservation proof.

## Invariants at risk

The move touches modules that Steps 1–4 wired into the `authority/` spine, so the relevant invariants are those steps' documented outcomes:

- Step 3's pinned invariant — the forwarded `permissions:ui_prompt` broadcast stays non-degraded (original `source`, `surface`/`value` projection, populated `forwarding` context) — is exercised by the composition-root round-trip and `test/authority/forwarded-request-server.test.ts`.
  A pure file move cannot regress it; the same code runs.
  The green suite (including `test/composition-root.test.ts`'s subagent-registry-sharing and forwarding round-trip) confirms it.
- Step 4's whole-session-grant round-trip (composition-root test) likewise rides on unchanged logic.

No invariant lives only in prose here — each is pinned by an existing test that runs unchanged after the move.

## TDD Order

This is a behavior-preserving move; there is no red phase.
The proof is `tsc` + `eslint` + the unchanged green suite.
One atomic commit (the moves and importer rewrites must land together — `tsc` rejects a half-moved state).

1. **Move + rewrite + doc-mark (single commit).**
   - `git mv` the five source files into `src/authority/` and the five test files into `test/authority/`.
   - Run `pnpm --filter @gotgenes/pi-permission-system exec eslint . --fix` to auto-rewrite parent-relative imports to `#src/authority/…` aliases, then hand-fix the same-dir cases per the Design Overview rules (`forwarding-manager.ts`'s `./authority/*` → `./*`; `permission-forwarding.ts`'s `./permission-events` → `#src/permission-events`).
   - Update `index.ts`'s four `./…` imports to `./authority/…`.
   - Apply the three documentation edits (architecture tree + Step 5 `✅` + Mermaid node; `subagent-integration.md`; SKILL.md).
   - Verify: `pnpm --filter @gotgenes/pi-permission-system run check` (tsc), `pnpm --filter @gotgenes/pi-permission-system run lint`, `pnpm --filter @gotgenes/pi-permission-system run test`, and `pnpm fallow dead-code` all pass; `git status` shows only renames + import-line/doc diffs.
   - Commit: `refactor(pi-permission-system): move escalation/forwarding/subagent modules into authority/ (#559)`.

Folding the doc updates into the `refactor:` commit keeps the change hidden-changelog (no stray `docs:` release) and satisfies the package skill's "mark the roadmap step complete in the implementation commit" rule.

## Risks and Mitigations

- **A missed importer.**
  Mitigation: `tsc` (`pnpm run check`) fails on any unresolved specifier; `eslint`'s `no-parent-relative-imports` fails on a stray `../`.
  The suite will not go green until every reference is updated.
- **`git mv` recorded as delete+add, losing history.**
  Mitigation: use `git mv` (not delete+rewrite) so Git records renames; the content change per file is one or two import lines, well within rename-detection thresholds.
- **Tree-glyph corruption in the architecture listing.**
  Mitigation: after editing, re-read the `authority/` subtree block to confirm exactly one `└──` (the last child) and correct `├──` connectors — per the AGENTS decorative-rule caution.
- **Stale prose path in an unsearched current-state doc.**
  Mitigation: the `src/`-symbol grep was widened to the three current-state docs (`architecture.md`, `subagent-integration.md`, SKILL.md); remaining hits are frozen plans/retros/history, explicitly out of scope.

## Open Questions

None.
The scope is fully mechanical and enumerated; no follow-up issues are filed.
