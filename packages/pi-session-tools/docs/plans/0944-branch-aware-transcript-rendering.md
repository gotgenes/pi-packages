---
issue: 944
issue_title: "pi-session-tools: transcript rendering ignores parentId, presenting abandoned branches as history"
---

# Branch-aware transcript rendering

## Release Recommendation

**Release:** ship independently

`pi-session-tools` has no `docs/architecture/` directory and therefore no improvement roadmap, so no `Release:` tag governs this issue and no batch holds it.
The 2026-09-18 triage banded it at rank 4 in Band 1 (security and bugs) as a silent wrong result in a tool this repo's own `/retro` and triage sessions read, which argues for shipping as soon as it is green rather than accumulating with the rest of the session-tools trio.

## Problem Statement

A Pi session file is a tree, not a list.
Every entry carries an `id` and a `parentId`, and rewinding the conversation moves the leaf pointer backward so that the next entry becomes a second child of an earlier one.
All three transcript tools walk the file in write order and never read `parentId`, so entries from a branch the operator explicitly backed out of render indistinguishably from entries on the live path.

The affected party is a reader — usually an agent running `/retro`'s diagnostic lenses — who is handed one flat narrative and has no way to tell that a stretch of it was retracted.
On a real 609-entry session in this repo's own session directory, the tools report 287 messages and 278 tool calls; only 139 and 121 of those are on the live path.
A model-attribution pass over that file counts 148 turns that never happened, and a reader reconstructing a decision can pick up reasoning that was deliberately abandoned.

## Goals

- Render the live path — root to leaf via `parentId` — as the default for `read_session`, `read_parent_session`, and `read_session_file`.
- Make every omission visible: each run of abandoned entries is replaced by a marker naming how many entries were dropped, so a rewind is never silent.
- Keep the abandoned branch reachable through a `branches` parameter on the same three tools, with its entries explicitly bracketed rather than interleaved.
- Make `details.summary` count live entries only, so the collapsed TUI row and the numbers an attribution pass reads agree with the transcript.
- **This change is breaking.**
  The default rendered output and the reported counts change on upgrade with no user edit, for any session file containing a fork.
  Suggested commit type `fix(pi-session-tools)!:` with a `BREAKING CHANGE:` footer; 2.2.0 → a major.

## Non-Goals

- *A `read_session_branch({ leafId })` tool.*
  Offered at the `ask_user` gate as a way to render any named branch and declined in favour of the parameter, on the precedent that `offset` (#916) and `elide_user_text` (#940) are rendering choices rather than new reach.
  Declined, not deferred — no follow-up issue is filed, matching how #943 handled the transcript footer.
- *Rendering the session as a tree.*
  The transcript stays one linear text stream; branches are marked within it, not indented or nested.
- *Compaction-aware context reconstruction.*
  Pi's `buildContextEntries` additionally collapses summarized entries behind the newest `compaction` entry.
  That is a different projection (what the model sees) from this one (what happened), it is absent from the pinned 0.79.1 `ReadonlySessionManager`, and the transcript already renders `[compaction]` markers.
- *Changing `list_session_files` or `list_subagent_sessions`.*
  Neither renders entries.
- *Owning the leaf when the file cannot answer.*
  A session ended immediately after a rewind with nothing appended has a last line that is not its leaf, and nothing in the file records that.
  Pi resumes into the same leaf we pick, so matching Pi is the ceiling.

## Background

### The mechanism, verified against source

`packages/coding-agent/src/core/session-manager.ts` in the Pi checkout beside this repo:

- `SessionEntryBase` declares `id: string` and `parentId: string | null`; every one of the nine `SessionEntry` variants extends it.
- `_buildIndex()` loops every file entry in order and assigns `this.leafId = entry.id` unconditionally, so **the last entry in the file wins** when a session is loaded or resumed.
- `buildSessionPath(entries, leafId, byId)` resolves the leaf (falling back to `entries[entries.length - 1]` when none is given), walks `parentId` to the root, and reverses.
  `getBranch(fromId?)` is the same walk over the in-memory index.
- `getTree()` treats `parentId === null` **and** `parentId === entry.id` as roots, and an entry whose parent is missing as an orphan root.

`ReadonlySessionManager` — the type `ctx.sessionManager` holds — exposes `getLeafId()`, `getLeafEntry()`, `getEntry()`, `getBranch()`, `getTree()`, and `getEntries()`.
Verified present both in the pinned `@earendil-works/pi-coding-agent@0.79.1` declaration bundle and in the published `0.75.0` tarball, which is this package's `peerDependencies` floor.
`getEntries()` returns every entry in write order, which is why `read_session` is affected identically to the two file readers.

### How this package renders today

`src/index.ts`'s `buildTranscriptResult(allEntries, params)` is the single seam all three read tools share: it calls `selectEntries` (`src/entry-selection.ts`), then `summarizeEntries` (`src/entry-summary.ts`), then `formatTranscript` (`src/format-transcript.ts`).
`selectEntries` is a three-stage pipeline — `filterByTypes` → `prunePhantomModelChanges` → `windowEntries` — and none of the three modules reads `id` or `parentId` anywhere.

### Corpus

Measured over all 998 session files under `~/.pi/agent/sessions/` (every cwd, not just this repo's):

| Fact                                                                               | Value                        |
| ---------------------------------------------------------------------------------- | ---------------------------- |
| Files with at least one fork point                                                 | 71 (7.1%)                    |
| Off-path share among those — min / median / p90 / max                              | 0.3% / 11.6% / 39.9% / 95.7% |
| Maximum fork points in one file                                                    | 6                            |
| Forked files carrying a `branch_summary` entry                                     | 29 of 71                     |
| Forked files whose off-path entries are **not** contiguous in file order           | 6 of 71 (max 2 runs)         |
| Files with a missing `id`, a broken parent chain, a self-parent, or multiple roots | 0                            |
| Files at session schema version 3                                                  | 998 of 998                   |

The 42 forked files with no `branch_summary` have no marker of any kind today, which is what makes the omission marker load-bearing rather than decorative.
Non-contiguity is why markers are placed per run in file order rather than once per fork point.

### Constraints from AGENTS.md and the package README

- The README's in-scope line — *"A new capability arrives as a new tool rather than as another parameter on an existing one"* — was raised at the gate as a collision.
  The operator resolved it in favour of a parameter, on the 2026-09-18 triage's own reading that *"an `offset` bound is not a new capability, so the new-tool rule does not reach #940"*.
  A branch selector is the same class: a rendering choice over the same entries.
- The README non-goal *"Owning Pi's session storage format — the directory encoding and entry schema belong to Pi; this package matches them rather than improving them"* is satisfied by reproducing `buildSessionPath`'s algorithm rather than inventing one.
- Parameter style follows this repo's precedent for a small closed value set: `pi-subagents`' `thinking` parameter (`packages/pi-subagents/src/tools/agent-tool.ts`) is a plain `Type.String` naming its values in the description, not a `Type.Union` of literals.

## Design Overview

### The new module

`src/session-tree.ts` owns the one fact the package does not yet know — that a session file is a tree — and exports a single function plus the types its output carries.

```typescript
/** Which branches of a session's entry tree a transcript renders. */
export type BranchMode = "live" | "all";

/**
 * Synthetic entry injected in place of (or around) a run of abandoned entries.
 * Never present in a session file; `type` is chosen to not collide with any
 * SDK `SessionEntry` variant.
 */
export type BranchMarkerEntry =
  | { type: "branch_marker"; marker: "omitted"; count: number }
  | { type: "branch_marker"; marker: "abandoned_begin"; count: number }
  | { type: "branch_marker"; marker: "abandoned_end" };

export const BRANCH_MARKER_TYPE = "branch_marker";

export interface BranchResolution {
  mode: BranchMode;
  /** The leaf to walk back from. Omit to use the last entry, as Pi does on load. */
  leafId?: string | null;
}

/**
 * Rewrite an entry array so that abandoned branches are marked rather than
 * silently interleaved. In `"live"` mode each maximal run of off-path entries
 * is replaced by one `omitted` marker; in `"all"` mode each run is bracketed
 * by `abandoned_begin` / `abandoned_end`.
 */
export function resolveBranches(
  entries: TranscriptEntry[],
  resolution: BranchResolution,
): TranscriptEntry[];
```

The walk is `buildSessionPath`'s, with two guards Pi's own `getTree` already implies: a `visited` set so a cyclic `parentId` chain terminates, and a stop on `parentId === entry.id`.

### Degenerate inputs

One rule covers every shape the corpus does not contain, stated so it does not depend on the corpus:

- The leaf is `resolution.leafId` when given; otherwise the last entry's `id`.
  **If the leaf cannot be resolved to a string `id`, `resolveBranches` returns `entries` unchanged** — there is no tree to walk, so nothing can be proven abandoned.
- An entry without a string `id` is never abandoned.
  It cannot be shown to be off-path, so it is kept.

Together these make a pre-v3 file (no `id`/`parentId`) render exactly as it does today, and make a mixed array degrade toward keeping entries rather than dropping them.

### Marker placement and text

Markers are computed over the **file-order** array, per maximal run of abandoned entries, not per fork point.
This falls out of the corpus: 6 of 71 forked files interleave two off-path runs, and a per-fork marker would report one count for two separated stretches.

`formatMetadataEntry` in `src/format-transcript.ts` gains one `case`:

| marker            | rendered line                                                         |
| ----------------- | --------------------------------------------------------------------- |
| `omitted`         | `[abandoned branch] 331 entries omitted (branches: "all" to include)` |
| `abandoned_begin` | `[abandoned branch begins] 331 entries`                               |
| `abandoned_end`   | `[abandoned branch ends]`                                             |

`[abandoned branch]` is deliberately distinct from the existing `[branch]` line that `branch_summary` renders.
The two are complementary and both appear on a live path: Pi's `branchWithSummary` appends a `branch_summary` as a child of the fork point (so it is on the live path) describing *what* was abandoned, while the marker reports *how much*.

### Pipeline order and the two new selection fields

`EntrySelection` gains two fields, and `selectEntries` prepends one stage:

```typescript
export interface EntrySelection {
  types?: string[];
  offset?: number;
  limit?: number;
  /** Which branches to keep. Omit to skip branch resolution entirely. */
  branches?: BranchMode;
  /** The live leaf, when the caller knows it. */
  leafId?: string | null;
}

// selectEntries:
const resolved = selection.branches
  ? resolveBranches(entries, { mode: selection.branches, leafId: selection.leafId })
  : entries;
const filtered = filterByTypes(resolved, selection.types);
const pruned = prunePhantomModelChanges(filtered);
return windowEntries(pruned, selection.offset, selection.limit);
```

Three ordering decisions, each load-bearing:

1. **Branch resolution runs first.**
   `filterByTypes` severs parent chains — a `types: ["message"]` query would drop the `model_change` root of every session in the corpus, orphaning the entries below it.
2. **`branches: undefined` means "do not resolve".**
   This is `EntrySelection`'s existing idiom (`types` undefined is no filter, `limit` undefined is no window), and it keeps `selectEntries` a pure function of its arguments rather than one with a hidden default.
   The user-facing default lives at the boundary, in `buildTranscriptResult`, where the tool parameter is normalized.
3. **`filterByTypes` exempts `BRANCH_MARKER_TYPE`.**
   A marker is not a session entry type, and the disclosure that a branch was dropped should not itself be droppable by a type filter — that would reproduce the defect for exactly the `types`-filtered calls `/retro`'s lenses make.

Markers do occupy a slot against `offset`/`limit`, since they are ordinary array elements by the time `windowEntries` runs.
At a measured maximum of 6 fork points per file this is not worth special-casing, and it is documented in the README.

### Counting

`summarizeEntries` skips `BRANCH_MARKER_TYPE` with the same early-`continue` shape it already uses for `compaction` and `model_change`, so `totalEntries` counts session entries only.
In live mode the summary therefore reports the live path — which is the number the issue's motivating scenario needs.

### Wiring at the boundary

`buildTranscriptResult` becomes the single place the mode is decided, and the only place the leaf is sourced:

```typescript
function buildTranscriptResult(
  allEntries: TranscriptEntry[],
  params: TranscriptReadParams,
  leafId?: string | null,
) {
  const branches: BranchMode = params.branches === "all" ? "all" : "live";
  const entries = selectEntries(allEntries, {
    types: params.types,
    offset: params.offset,
    limit: params.limit,
    branches,
    leafId,
  });
  // …summarizeEntries / formatTranscript unchanged
}
```

Normalizing to `"live"` for anything other than the literal `"all"` means a mistyped parameter falls back to the safe default rather than the lossy one.
The selection object is now built explicitly instead of passing `params` through, which also removes the current implicit reliance on the tool parameter names happening to match `EntrySelection`'s field names.

Call sites:

```typescript
// read_session — has the authoritative pointer
return buildTranscriptResult(
  ctx.sessionManager.getEntries(),
  params,
  ctx.sessionManager.getLeafId(),
);

// read_parent_session / read_session_file — no SessionManager for that file;
// resolveBranches falls back to the last entry, which is the leaf Pi resumes into.
return buildTranscriptResult(allEntries, params);
```

`getLeafId()` and the last-entry fallback agree during a tool call — every append advances the leaf to the entry it just wrote — so the third argument is not covering an observed divergence.
It is used because it is the authoritative source, available at the peer-dependency floor, and free.

## Module-Level Changes

| File                                                                | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-session-tools/src/session-tree.ts`                     | **New.** `BranchMode`, `BranchMarkerEntry`, `BRANCH_MARKER_TYPE`, `BranchResolution`, `resolveBranches`. Private helpers: leaf resolution, the `parentId` walk with cycle and self-parent guards, run collapsing/bracketing.                                                                                                                                                                                                                                                                        |
| `packages/pi-session-tools/src/entry-selection.ts`                  | `EntrySelection` gains `branches?: BranchMode` and `leafId?: string \| null`; `selectEntries` prepends the `resolveBranches` stage; `filterByTypes` exempts `BRANCH_MARKER_TYPE`. Module docblock updated — it currently enumerates the pipeline as "type filtering, phantom `model_change` pruning, and windowing".                                                                                                                                                                                |
| `packages/pi-session-tools/src/format-transcript.ts`                | `formatMetadataEntry` gains `case "branch_marker"` with the three marker texts.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/pi-session-tools/src/entry-summary.ts`                    | `summarizeEntries` skips `BRANCH_MARKER_TYPE`; `SessionSummary.totalEntries`'s doc comment updated to say session entries.                                                                                                                                                                                                                                                                                                                                                                          |
| `packages/pi-session-tools/src/index.ts`                            | New named `TranscriptReadParams` type replacing the inline bag at four sites (`buildTranscriptResult` ~L141 and the three `execute` signatures ~L302/L376/L488), gaining `branches?: string`; `buildTranscriptResult` gains a `leafId` parameter and the mode normalization; `branches` added to the three tools' `Type.Object` blocks and to their descriptions; `read_session`'s `execute` passes `ctx.sessionManager.getLeafId()`; `formatCallText`'s `args` type and hint list gain `branches`. |
| `packages/pi-session-tools/test/session-tree.test.ts`               | **New.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `packages/pi-session-tools/test/entry-selection.test.ts`            | New `describe` for branch resolution: ordering vs. `filterByTypes`, the marker exemption, `branches: undefined` passthrough.                                                                                                                                                                                                                                                                                                                                                                        |
| `packages/pi-session-tools/test/format-transcript.test.ts`          | New `describe` for the three marker renderings.                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/pi-session-tools/test/entry-summary.test.ts`              | New test that markers do not count toward `totalEntries`.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/pi-session-tools/test/read-session.test.ts`               | `makeCtx` gains `getLeafId`; new `describe` for branch behavior including the leaf-vs-last-entry discriminator.                                                                                                                                                                                                                                                                                                                                                                                     |
| `packages/pi-session-tools/test/read-parent-session.test.ts`        | New branch cases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/pi-session-tools/test/read-session-file.test.ts`          | New branch cases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `packages/pi-session-tools/test/transcript-tool-parameters.test.ts` | New `describe.each` case: all three tools declare `branches` as a string.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `packages/pi-session-tools/README.md`                               | `read_session` section documents the live-path default, the marker lines, and the `branches` parameter; the sample transcript gains a marker line; the "Neither is a filter" sentence under *Reading a long session without re-reading its tail* is qualified, since branch resolution **is** a filter and an attribution pass can no longer use every knob without thinking about it.                                                                                                              |
| `.pi/prompts/retro.md`                                              | One sentence on the model-attribution lens (`## 3.` block, ~L101) noting the transcript now follows the live path by default and marks what it omits. Outside `packages/`, so outside release scope.                                                                                                                                                                                                                                                                                                |

### Symbol and prose greps run at planning time

- `id`/`parentId` appear in no `src/` file of this package (`rg -n 'parentId' packages/pi-session-tools/src/` → no matches, as the issue reports).
- No export is removed or renamed by this change, so the removed-symbol sweep has nothing to sweep.
- There is no `packages/pi-session-tools/docs/architecture/` directory and no `package-pi-session-tools` skill, so neither the architecture-doc nor the skill grep has a target.
- `read_session`/`read_parent_session`/`read_session_file` appear outside the package in `.pi/prompts/retro.md`, `.pi/prompts/sync-worktree.md`, and `.pi/skills/reproduction/SKILL.md`.
  Only `retro.md` describes what the rendering *contains*; the other two describe reaching a file and are unaffected.
- `branch_marker` and `BRANCH_MARKER_TYPE` match nothing in the repo or in the SDK's nine-variant `SessionEntry` union, so the synthetic type name cannot collide.

### Predicted unchanged

Each of these is a falsifiable claim; a diff in any of them means the design was wrong somewhere.

| File                                                                                                                                                                 | Claim it rests on                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/session-file.ts`, `src/session-listing.ts`, `src/parent-session.ts`                                                                                             | Branch resolution happens above the file reader and beside the listing helpers; `readSessionFileEntries` keeps returning every entry, header excluded.                                                                                                                                                                                                                                |
| `test/session-file.test.ts`, `test/session-listing.test.ts`, `test/parent-session.test.ts`, `test/list-session-files.test.ts`, `test/list-subagent-sessions.test.ts` | Same.                                                                                                                                                                                                                                                                                                                                                                                 |
| `test/format-transcript.test.ts` — the `handles parallel tool calls with out-of-order results` fixture at L137                                                       | Its entries are `[id 1, id 3 (parent 2), id 2 (parent 1)]`: file order 1,3,2 but tree order 1→2→3, so walking from the last entry would drop `id 3`. The test calls `formatTranscript` **directly**, bypassing `selectEntries`, so `resolveBranches` never runs on it. This is the concrete reason branch resolution must live in `entry-selection.ts` and not in `formatTranscript`. |
| `test/entry-selection.test.ts`'s existing cases                                                                                                                      | Its fixtures carry no `id`/`parentId` at all (0 occurrences, re-derived) **and** its `selectEntries` calls pass no `branches`, so the new stage is skipped outright rather than relying on the degenerate-input rule.                                                                                                                                                                 |
| `test/entry-summary.test.ts`'s existing cases                                                                                                                        | Same: 0 `parentId` occurrences, and `summarizeEntries` gains only a skip for a type those fixtures never contain.                                                                                                                                                                                                                                                                     |
| `packages/pi-session-tools/CHANGELOG.md`                                                                                                                             | Owned by `scripts/release/prepare-release.sh`.                                                                                                                                                                                                                                                                                                                                        |

## Test Impact Analysis

### What the new module makes testable

Extracting the tree walk into `src/session-tree.ts` makes the live-path decision unit-testable without a `ctx` stub, a session file, or the formatter — today there is no layer at which "which entries are on the live path" could be asserted at all.
The equivalence classes worth their own tests: single linear chain (no-op), one fork, nested fork inside an abandoned branch, two non-contiguous runs, explicit `leafId` disagreeing with the last entry, missing leaf id, mixed id/id-less array, cyclic `parentId`, self-parent.
The last three exist because the rule must not depend on the corpus containing them — the corpus contains none.

### What becomes redundant

Nothing.
No existing test asserts the flat-history behavior deliberately; the flatness is incidental to every fixture, all of which are linear.

### What must stay as-is

`test/format-transcript.test.ts`'s 25 fixtures continue to exercise the formatter directly, which is what keeps them independent of the selection pipeline — including the L137 fixture whose file order and tree order deliberately disagree.
`test/entry-selection.test.ts`'s existing pipeline-order and window-bound assertions genuinely exercise the stages this change prepends to, and pin that prepending a stage did not perturb them.

### Verification commands, dry-run at planning time

```bash
pnpm --filter @gotgenes/pi-session-tools exec vitest run
pnpm --filter @gotgenes/pi-session-tools run check
pnpm run lint
```

Baseline at planning time: 10 test files, 144 tests (per #943's implementation note), all green.

## Invariants at risk

| Invariant                                                                                                                                                                  | Origin       | What pins it                                                                                            | Risk from this change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A `[model change]` line renders only when the switch took effect — a marker followed by an assistant turn before the next switch or the end of entries                     | #546         | `test/entry-selection.test.ts`'s `collectEffectiveModelChangeIndices` cases                             | **Real interaction.** Pruning now runs on the branch-resolved array, so a live `model_change` whose only following assistant turn was on an abandoned branch becomes phantom and is dropped. That is the correct reading — the turn did not happen on the live path — but it is a second behavior change riding along, so it needs its own test rather than inheriting #546's. Measured on the two forked sessions in the spike: `modelChanges` was 4 before / 4 after and 1 before / 1 after, i.e. no live marker flipped in either; the fixture must construct the flip deliberately. |
| `offset` and `elide_user_text` are not filters — both leave phantom-switch suppression and the `[provider/model]` label intact, so an attribution pass can use them freely | #940, README | The README sentence, plus `test/read-session.test.ts`'s window-bound and elision cases                  | The sentence stays true of those two knobs and false of the section's implied conclusion once `branches` exists. The README edit is listed in Module-Level Changes; the constituency it served — an attribution pass — is the same one this change serves, and it is better off.                                                                                                                                                                                                                                                                                                        |
| `limit`/`offset` clamp at zero and count entries that survive pruning                                                                                                      | #916, #940   | `test/entry-selection.test.ts` window-bound cases, `test/read-session.test.ts` `window bounds` describe | Unchanged arithmetic, but the population shrinks in live mode and grows by one element per marker. Pinned by a new test asserting a windowed forked session, not by argument.                                                                                                                                                                                                                                                                                                                                                                                                           |
| The count line / collapsed summary reports what was rendered                                                                                                               | #916, #943   | `test/read-session.test.ts` `details.summary` assertions                                                | Preserved deliberately: markers are excluded from `totalEntries` so the summary keeps describing session entries, and live mode makes it describe the live path.                                                                                                                                                                                                                                                                                                                                                                                                                        |
| `read_session_file` on a path with no file returns a `status` detail, not a transcript                                                                                     | #549, #943   | `test/read-session-file.test.ts`                                                                        | Untouched — the guard precedes `buildTranscriptResult`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

## TDD Order

1. **`refactor(pi-session-tools): add the session entry-tree walker`** New `src/session-tree.ts` and `test/session-tree.test.ts`.
   Covers the nine equivalence classes above against `resolveBranches` in both modes.
   No consumer references it yet, so `refactor:` per the observable-outcome rule; `fallow dead-code` will flag it until step 6 wires it up.
   Killing mutations, one per class:
   - Walk: *make the walk start at `entries[0]` instead of the resolved leaf* — the one-fork and non-contiguous-run tests go red; the linear-chain no-op test stays green.
   - Leaf source: *ignore `resolution.leafId` and always use the last entry* — only the explicit-`leafId` test goes red.
   - Marker injection: *drop the abandoned run without emitting a marker* — the marker-text and marker-count tests go red; the live-path-content tests stay green, which is what proves the two concerns are separably pinned.
   - Degenerate input: *treat an entry with no string `id` as abandoned* — the mixed-array and no-ids tests go red.

2. **`refactor(pi-session-tools): thread branch mode through entry selection`** `src/entry-selection.ts` + new cases in `test/entry-selection.test.ts`.
   Still no user-visible change: no caller passes `branches`, and `branches: undefined` skips the stage.
   Killing mutations:
   - *Move the `resolveBranches` call after `filterByTypes`* — the test whose `types` filter would sever the chain goes red.
   - *Remove the `BRANCH_MARKER_TYPE` exemption from `filterByTypes`* — the marker-survives-a-type-filter test goes red.
   - *Make `selectEntries` default `branches` to `"live"` when undefined* — the passthrough test goes red, which is the assertion that keeps step 6 the only behavior-changing commit.

3. **`refactor(pi-session-tools): render and discount branch markers`** `src/format-transcript.ts` and `src/entry-summary.ts`, with cases in their two suites.
   Both call the functions directly, so nothing user-visible moves yet.
   Killing mutations:
   - *Make `case "branch_marker"` return `null`* — the three marker-rendering tests go red.
   - *Remove the `BRANCH_MARKER_TYPE` skip in `summarizeEntries`* — the `totalEntries` test goes red.

4. **`refactor(pi-session-tools): name the transcript read params bag`** Tidy First, recommended by the assessor.
   Lift the inline `{ types?; offset?; limit?; elide_user_text? }` written out at four sites in `src/index.ts` into a named `TranscriptReadParams`, with `read_session_file`'s staying `TranscriptReadParams & { path: string }` — `path` is a real per-tool difference, not a discriminator to paper over.
   Friction it prepares: step 6 adds `branches?: string` to that exact bag; named first, that is one edit instead of four that must stay synchronized.
   No new tests; verified by `pnpm run check` and a green suite.

5. **`test(pi-session-tools): add getLeafId to the read_session ctx stub`** Tidy First, recommended by the assessor.
   `test/read-session.test.ts`'s `makeCtx` (L14) builds `sessionManager: { getEntries, getSessionFile }` with no `getLeafId`, and the `as unknown as ExtensionContext` cast means the compiler will not catch the gap.
   Add `getLeafId: () => entries.at(-1)?.id ?? null`, mirroring Pi's own last-wins rule so linear fixtures behave identically.
   Friction it prepares: without it, every one of that file's `execute` calls throws `getLeafId is not a function` the moment step 6 lands.
   No new tests; the suite must stay green, which is the point.

6. **`fix(pi-session-tools)!: follow the live path when rendering a branched session`** `src/index.ts` wiring, `README.md`, and new cases in `test/read-session.test.ts`, `test/read-parent-session.test.ts`, `test/read-session-file.test.ts`, `test/transcript-tool-parameters.test.ts`.
   This is the only commit a user can observe, and the only breaking one.
   Body must carry a `BREAKING CHANGE:` footer naming the new default and the `branches: "all"` remediation, and `Refs #944`.
   Killing mutations:
   - *Make `buildTranscriptResult` pass `branches: undefined` to `selectEntries`* — every tool-level live-path test goes red.
   - *Normalize an absent `branches` to `"all"` instead of `"live"`* — the default-mode tests go red and the explicit-`"all"` tests stay green.
   - *Drop the `getLeafId()` argument from `read_session`'s `execute`* — only the discriminating fixture goes red: `getEntries()` returns a branched array whose **last** entry is off-path while `getLeafId()` names an earlier one.
     A linear fixture cannot kill this mutation, because the two sources agree there.
   - *Delete the `branches` property from `read_parent_session`'s `Type.Object` block* — that tool's case in `transcript-tool-parameters.test.ts` goes red and the other two stay green.
     The parameter is added at three sites; a per-site mutation is what pins each one.

7. **`docs: note the live-path default in the retro model-attribution lens`** `.pi/prompts/retro.md` only.
   Separate commit because `.pi/` is outside the package's release scope and should not sit in the release diff.
   Verified with `pnpm exec rumdl check .pi/prompts/retro.md`; the sentence prescribes no new shell command, so there is nothing to dry-run.

## Risks and Mitigations

| Risk                                                                                                        | Mitigation                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The last-entry leaf rule is wrong for some file we have not seen, and live mode drops real history.         | It is not our rule — `_buildIndex()` assigns the same leaf when Pi loads that file, so a divergence would mean Pi resumes into a different conversation than it renders. `read_session` uses the authoritative `getLeafId()` regardless.                                                                   |
| A malformed or hand-edited file sends the walk into a cycle and hangs the tool.                             | `visited` set plus a self-parent stop, both pinned by their own tests in step 1. Corpus has 0 instances, so the tests are the only evidence — which is why the classes are enumerated from the mechanism rather than from the corpus.                                                                      |
| The degenerate-input rule fails **open** (drops entries) rather than closed for a shape we did not model.   | The rule is written as "an entry without a string `id` is never abandoned" and "an unresolvable leaf returns the input unchanged", so both degenerate directions keep entries. Step 1's mutation *treat an id-less entry as abandoned* exists specifically to prove the rule is exercised and not vacuous. |
| A caller's `types` filter hides the omission marker, reproducing the defect for `/retro`'s filtered lenses. | `filterByTypes` exempts `BRANCH_MARKER_TYPE`; pinned by a step 2 mutation.                                                                                                                                                                                                                                 |
| Markers consume `limit`/`offset` slots and shift a paging caller's window.                                  | Documented in the README; bounded by 6 fork points per file at the corpus maximum. A step 6 test windows a forked session so the arithmetic is pinned rather than argued.                                                                                                                                  |
| The breaking change surprises a downstream consumer of the rendered text.                                   | `fix(pi-session-tools)!:` with a `BREAKING CHANGE:` footer naming `branches: "all"` as the exact restoration of prior output — verified to exist as a real parameter in the same commit, not inferred by analogy.                                                                                          |
| Steps 1–3 leave `resolveBranches` unreferenced, so a mid-plan `fallow dead-code` run reports it.            | Expected between steps 1 and 6 and resolved by step 6; the pre-completion gate runs at HEAD, where it is wired.                                                                                                                                                                                            |

## Open Questions

- Whether `branches: "all"` should renumber turns so abandoned turns do not consume numbers in the numbered sequence.
  Deferred: `"all"` is the explicit archaeology mode, the begin/end brackets already delimit the abandoned stretch, and renumbering would mean `formatTranscript` needs branch knowledge it otherwise does not.
  Revisit only if a reader reports being misled by the numbering in `"all"` mode.
