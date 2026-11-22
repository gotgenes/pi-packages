---
issue: 571
issue_title: "Unify subagent-context containment onto PathFlavor.isWithin"
---

# Unify subagent-context containment onto `PathFlavor.isWithin`

## Release Recommendation

**Release:** ship independently

Phase 11 Step 5 carries a `Release: independent` tag ([#571] in `docs/architecture/architecture.md`), with no batch membership.
The change is `refactor:` + `test:` only (both `hidden: true` changelog types), so it will not cut a release on its own — it lands on `main` and auto-batches into the next `feat:`/`fix:`/unhidden-`docs:` release for the package.
"Ship independently" here means it carries no cross-issue release coupling, not that it triggers a release by itself.

## Problem Statement

`src/authority/subagent-context.ts` carries its own containment helper, `isPathWithinDirectoryForSubagent`, a string-prefix check (`pathValue.startsWith(directory + sep)`).
It answers the same question as `PathFlavor.isWithin` (`src/path/path-flavor.ts`) — "is this path inside that directory under this platform?" — but with a different algorithm: a `path.relative`-based geometry versus a raw prefix compare.
Two algorithms for one must-agree question is the connascence-of-algorithm smell [#562] set out to remove; [#562] deferred this site by design because unifying it is nominally behavior-affecting, not a pure relocation, and so needs its own change with targeted tests.

## Goals

- Replace `isPathWithinDirectoryForSubagent` with `flavor.isWithin(...)` inside `isSubagentExecutionContext`, so subagent filesystem detection uses the same containment geometry as the path gates.
- Delete the now-unused private helper.
- Pin the containment edge cases (`..` in a session dir, sibling directory sharing a string prefix, cross-root) with tests on both `posix` and `win32` flavors, documenting the intended post-change behavior.
- Drive the `startsWith(prefix)`-in-`subagent-context.ts` count from 1 to 0 (Phase 11 Step 5 outcome).

This change is **not breaking**.
It preserves the observable subagent-detection outcome for every realistic input (see Design Overview); it is an internal algorithm unification with a characterization-test safety net.

## Non-Goals

- No change to the registry or env-var detection branches of `isSubagentExecutionContext` — only the filesystem fallback's containment call changes.
- No change to `normalizeFilesystemPath` (the normalize + fold pre-step stays; it is what keeps `flavor.isWithin` case- and separator-correct on win32).
- No change to `PathFlavor.isWithin` itself — it is already the package's single containment primitive after [#562].
- No new public API, no config surface, no schema/docs/config-example touch.

## Background

- `isSubagentExecutionContext(ctx, subagentSessionsDir, flavor, registry?)` (`src/authority/subagent-context.ts`) decides whether the current process is a subagent via three branches, in priority order: (1) explicit registry membership, (2) subagent env hints, (3) a filesystem fallback — is the session dir within the known subagent-sessions root?
  Only branch 3 uses the prefix helper.
- Branch 3 first normalizes **both** operands through `normalizeFilesystemPath` (which calls `flavor.impl.normalize` then `flavor.fold` — so `..` segments are collapsed and win32 values are lowercased) before the containment compare.
- `PathFlavor.isWithin(pathValue, directory)` (`src/path/path-flavor.ts`) is `path.relative`-based: equal ⇒ true; otherwise `relative(directory, pathValue)` must be non-empty, not `..`, not `..`-prefixed, and not absolute.
  It does not fold case internally — callers pass already-folded values, exactly as branch 3 does.
- `isSubagentExecutionContext` already receives `flavor: PathFlavor` as a parameter, so `flavor.isWithin` is in scope with no signature change.
- AGENTS.md / package skill constraint: no `process.platform` read may enter `src/` outside `index.ts`; this change adds none — it removes hand-rolled `flavor.impl.sep` prefix logic in favor of the flavor's own `isWithin`, tightening the "every platform question delegates to `flavor`" invariant.

## Design Overview

### Behavioral parity finding

The two algorithms **agree on every realistic normalized-absolute input**, because branch 3 normalizes both operands before the compare.
Verified empirically against `path.posix` (identical logic for `path.win32`):

| `pathValue` (pre-norm)      | `directory`       | normalized          | prefix check | `isWithin` |
| --------------------------- | ----------------- | ------------------- | ------------ | ---------- |
| `/root/subagents/x`         | `/root/subagents` | `/root/subagents/x` | true         | true       |
| `/root/subagents`           | `/root/subagents` | `/root/subagents`   | true         | true       |
| `/root/subagents-extra/x`   | `/root/subagents` | (unchanged)         | false        | false      |
| `/root/main`                | `/root/subagents` | (unchanged)         | false        | false      |
| `/root/subagents/../evil/x` | `/root/subagents` | `/root/evil/x`      | false        | false      |
| `/root`                     | `/root/subagents` | `/root`             | false        | false      |
| `/root/subagents/a/../b`    | `/root/subagents` | `/root/subagents/b` | true         | true       |

The prefix check already appends the separator (`prefix = directory + sep`), so it rejects sibling-prefix dirs (`subagents-extra`) correctly; and `normalizeFilesystemPath` collapses `..` before either algorithm runs, so the theoretical `..`/cross-root divergences never reach the compare.
Session dirs are always absolute, so `..` cannot survive normalization as a leading segment.

The consequence: this is a behavior-preserving refactor with a characterization-test net, not a behavior change.
[#562]'s "behavior-affecting" caution was the reason to give it its own commit with tests — the tests **confirm** equivalence rather than reveal a change.
The plan states this honestly instead of asserting a divergence the inputs cannot produce.

### The change

`isSubagentExecutionContext` branch 3, after computing `normalizedSessionDir` and `normalizedSubagentRoot`:

```typescript
// before
return isPathWithinDirectoryForSubagent(
  normalizedSessionDir,
  normalizedSubagentRoot,
  flavor,
);

// after
return flavor.isWithin(normalizedSessionDir, normalizedSubagentRoot);
```

Then delete the private `isPathWithinDirectoryForSubagent` function entirely (it has exactly one call site, the line above).

`flavor.isWithin` carries its own empty-operand guard (`if (!pathValue || !directory) return false`) and equal-operand short-circuit, so the helper's own guards are subsumed — no behavior is lost by deleting it.

### Design-review check

No shared interface widens, no new collaborator is introduced, no layer wiring changes.
`flavor` is already a parameter; the change narrows `subagent-context.ts`'s dependency from "a private algorithm plus `flavor.impl.sep`" to "one `flavor` method call" — a strict reduction in surface.
No Tell-Don't-Ask or Law-of-Demeter concern: `flavor.isWithin(a, b)` is a single tell.

## Module-Level Changes

- `src/authority/subagent-context.ts`
  - Remove the private `isPathWithinDirectoryForSubagent` function.
  - Replace its sole call in `isSubagentExecutionContext` with `flavor.isWithin(normalizedSessionDir, normalizedSubagentRoot)`.
  - `normalizeFilesystemPath` and the two normalize calls are unchanged.
- `test/authority/subagent-context.test.ts`
  - Add characterization tests to the "session dir detection" describe block covering, on **both** `posixPathFlavor` and `win32PathFlavor`: `..` inside the session dir (normalizes to an outside path ⇒ false), a sibling directory sharing a string prefix (⇒ false), and a cross-root path (posix `/other/...`; win32 different drive letter ⇒ false), plus the nested-and-equal true cases for win32 (the posix nested/equal/sibling/outside cases already exist).
- `packages/pi-permission-system/docs/architecture/architecture.md` (implementation doc-update, per the package skill — lands in the same commit as the code change, not deferred to ship)
  - Mark Phase 11 Step 5 complete: `✅` on the `#### Step 5:` heading and on the `S5[...]` node in the "Step dependency diagram" Mermaid block.
  - The "Subagent prefix-containment sites" health-metric row already targets `0`; the recompute command (`grep -c 'startsWith(prefix)' ...`) now returns `0`, so the target is met — no row value edit is required, but confirm the row still reads correctly after the step is marked done.

No other `src/`, `test/`, `docs/`, or skill file references the private helper as a live symbol.
The historical mentions in `docs/plans/0382-*.md`, `docs/plans/0505-*.md`, `docs/plans/0510-*.md`, `docs/plans/0562-*.md`, and `docs/retro/0562-*.md` describe the deferral decision at the time and are intentionally left as-is (they are dated records, not current-state claims).
The package skill's containment-idiom guidance (`.pi/skills/package-pi-permission-system/SKILL.md`) is generic and already describes the `relative()`-based idiom this change adopts — no edit needed.

## Test Impact Analysis

1. **New tests enabled:** the swap enables (does not require) explicit win32-flavor edge-case coverage of the filesystem branch — previously the branch's win32 behavior was only implicitly covered by `normalizeFilesystemPath` unit tests plus posix session-dir tests.
   The new tests pin the containment geometry directly on both flavors.
2. **Redundant tests:** none become redundant.
   The existing posix "session dir detection" tests (nested / equal / sibling-prefix / outside / null / empty) remain valid and continue to characterize the exact behavior — they pass unchanged before and after the swap, which is precisely the safety-net property being asserted.
3. **Tests that must stay:** all existing `subagent-context.test.ts` cases stay — the registry and env-hint branches are untouched, and the posix session-dir cases are the primary equivalence anchor.

## Invariants at risk

The touched surface is `subagent-context.ts`'s filesystem-detection branch, last shaped by [#510] (inject `flavor`/platform) and referenced by [#562] (the deferral).
Invariants and their pinning tests:

- **Equal session-dir-and-root ⇒ subagent** — pinned by `"returns true when session dir equals subagent root"`; `flavor.isWithin` preserves it via its equal short-circuit.
- **Nested session dir ⇒ subagent** — pinned by `"returns true when session dir is within subagent root"`.
- **Sibling with shared string prefix ⇒ not subagent** — pinned by `"returns false when session dir is a sibling with shared prefix"`; `flavor.isWithin` preserves it (the `..`-prefixed `relative` result).
- **Empty / null session dir ⇒ not subagent** — pinned by the null/empty tests; `flavor.isWithin`'s empty-operand guard preserves it.
- **Registry and env-hint priority ordering** — pinned by the "registry detection" describe block; untouched by this change.

No earlier phase step's documented `Outcome:` is regressed — this step's own outcome (one containment algorithm) tightens [#562]'s invariant rather than loosening it.

## TDD Order

This is a behavior-preserving refactor, so the sequence is cover-then-refactor (tests green throughout) rather than red→green.

1. **Characterization tests** (`test:`)
   - Surface: `test/authority/subagent-context.test.ts`, "session dir detection" describe block.
   - Add win32-flavor nested / equal / sibling-prefix / cross-root (different drive) cases and posix/win32 `..`-in-session-dir cases, asserting the current behavior.
   - These pass green against the existing `isPathWithinDirectoryForSubagent` implementation — they lock the behavior before the swap.
   - Commit: `test(permission-system): pin subagent-context containment edge cases (#571)`.

2. **Swap onto `flavor.isWithin` and delete the helper** (`refactor:`)
   - Replace the helper call with `flavor.isWithin(normalizedSessionDir, normalizedSubagentRoot)` and remove the private `isPathWithinDirectoryForSubagent` function.
   - All step-1 tests plus the pre-existing suite stay green; `grep -c 'startsWith(prefix)' src/authority/subagent-context.ts` returns `0`.
   - Mark Phase 11 Step 5 `✅` in `docs/architecture/architecture.md` (heading + Mermaid `S5` node) in this same commit.
   - Commit: `refactor(permission-system): unify subagent-context containment onto PathFlavor.isWithin (#571)`.

## Risks and Mitigations

- **Risk:** an untested edge case where the prefix check and `isWithin` diverge slips through, silently changing subagent detection.
  **Mitigation:** the step-1 characterization tests cover the three edge families named in the issue on both flavors, run green before the swap; the empirical parity table shows agreement on every case; the full existing suite is the regression net.
- **Risk:** dropping the helper's empty-operand / equal guards changes behavior.
  **Mitigation:** `flavor.isWithin` carries the same two guards; the null/empty and equal tests confirm parity.
- **Risk:** win32 case/separator handling regresses.
  **Mitigation:** the `normalizeFilesystemPath` normalize+fold pre-step is retained, and new tests exercise `win32PathFlavor` directly (no `vi.mock("node:path")`, per the package skill).

## Open Questions

None.
The change is fully specified by Phase 11 Step 5 and the parity finding above; no follow-up issues are warranted.

[#510]: https://github.com/gotgenes/pi-packages/issues/510
[#562]: https://github.com/gotgenes/pi-packages/issues/562
[#571]: https://github.com/gotgenes/pi-packages/issues/571
