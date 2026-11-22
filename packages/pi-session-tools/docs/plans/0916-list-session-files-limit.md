---
issue: 916
issue_title: "pi-session-tools: list_session_files has no limit, returning every session path for a cwd"
---

# Bound `list_session_files` to the newest N paths

## Release Recommendation

**Release:** ship independently

`pi-session-tools` has no `docs/architecture/architecture.md` and therefore no improvement roadmap, so this issue belongs to no release batch and ships on its own schedule.

The change is breaking (see Goals), so the suggested commit is `feat!:` with a `BREAKING CHANGE:` footer.
The package is at `1.2.1`, so this cuts **2.0.0**.

## Problem Statement

`list_session_files` renders every `.jsonl` path in a cwd's session directory with no way to bound the output.
For this repo's own checkout that is a large, almost entirely unused result: measured just now with `ls`, the directory `--Users-chris-development-pi-pi-packages--` holds **608** session files whose paths total **88,160 characters** of tool-result text.

The listing is already sorted newest-first by `listSessionFiles` (`packages/pi-session-tools/src/session-file.ts:84-99`), and every documented caller wants the newest one or two entries.
So the tool spends its caller's context on paths the caller will never read — and it gets called precisely when the caller has the least budget to spare, as the fallback route for locating a peer session whose path was not recorded.

## Goals

- Add an optional `limit` parameter to `list_session_files` that caps how many paths the text body lists.
- Default `limit` to **10** when the caller omits it, so the common case is fixed without a caller opting in.
  **This is a breaking change**: existing callers that pass no `limit` see a different result on upgrade with no edit of their own, so the commit is `feat!:` with a `BREAKING CHANGE:` footer.
- Keep the count line reporting the **true total** even when the list is truncated, so a caller can tell there is more.
- Keep the collapsed TUI row and the text body in agreement on both numbers.
- Leave the untruncated output byte-identical to today's, so nothing changes for a directory with ten or fewer session files.

## Non-Goals

- **Recursing into a session's `tasks/` children** ([#943]).
  That issue proposes the same listing grow downward into subagent transcripts.
  It is deliberately out of scope here; whichever lands second inherits the other, and bounding the list first means [#943] gets the bound for free.
- **An `offset` or `before` parameter** on this tool or on the transcript tools ([#940]).
  This plan adds a bound, not paging.
- **Fixing `buildTranscriptResult`'s own `limit` handling.**
  `entries.slice(-params.limit)` mishandles `0` and negative values — filed as [#950] during this planning session.
  The two helpers slice in opposite directions (tail vs. head) and share no code, so the fix does not belong here.
- **A new tool.**
  The package README's in-scope line says "A new capability arrives as a new tool rather than as another parameter on an existing one", but `docs/triage/2026-09-18-backlog.md:73` already recorded the verdict that a bound "is not a new capability, so the new-tool rule does not reach #940 — the same reading #916 got".
  No scope collision.
- **A `renderResult`-level integration test.**
  No test anywhere in this repo exercises a tool's `renderResult`, and `keyHint` — which `formatResultText` calls — reads `getKeybindings()` and a module-level `theme` (verified in the pinned `@earendil-works/pi-coding-agent@0.79.1` at `dist/modes/interactive/components/keybinding-hints.js`).
  The design instead moves the collapsed row's phrasing into a pure function that is unit-tested directly.

## Background

Relevant code, all in `packages/pi-session-tools/`:

- `src/session-file.ts` — `listSessionFiles(directory)` returns absolute `.jsonl` paths sorted newest-first (mtime descending, tie-broken by filename), or `[]` when the directory does not exist.
  This plan does not change it.
- `src/index.ts:110-121` — `renderListing(directory, files)` builds the text body: a `Session directory: <dir>` line, then `No session files found.` or a count line plus one indented path per file.
- `src/index.ts:455-470` — `list_session_files`'s `execute` calls `renderListing` for `content` and separately constructs `details: { kind: "listing", directory, count: files.length }`.
  The count is derived twice, in two places.
- `src/index.ts:38-41` — `SessionToolDetails`, whose `listing` variant is `{ kind: "listing"; directory: string; count: number }`.
- `src/index.ts:88-93` — `formatResultText`'s `listing` branch renders the collapsed TUI row: `✓ 608 session files in <dir>`, with its own singular/plural check.
- `src/index.ts:126-147` — `buildTranscriptResult`, the shared `{ content, details }` builder the three transcript tools route through.
  Its `limit` semantics are `entries.slice(-limit)` — the **tail**, because a transcript is oldest-first.
  A listing is newest-first, so its bound is the **head**.
  The two are not the same operation and must not be shared.
- `src/index.ts:50-63` — `formatCallText` already emits a `limit: N` hint when `args.limit != null`, so the tool's `renderCall` needs no change.

Callers of the tool today:

- `.pi/prompts/retro.md:61` and `:65` — locate a sibling or peer-worktree session; both want the newest entry.
- `.pi/prompts/sync-worktree.md:46` — names the tool as the root's recovery route for a peer session path; wants the newest entry.
- `packages/pi-session-tools/README.md:113-133` — documents the signature and shows a two-file sample.

Constraint from `AGENTS.md`: this is a published npm package, so a default change is an upgrade-visible behavior change and must be classified as breaking rather than treated as a bug fix.

## Design Overview

The design was settled with the operator through an `ask_user` gate: default of 10, count-line disclosure, and a `shown` field driving the collapsed row.

### Presentation moves to its own module

`src/index.ts` currently holds the listing's text-building inline, and the collapsed row's phrasing inside `formatResultText` — which is untestable without initialized pi-tui keybindings.
The package already keeps pure presentation in sibling modules with their own suites (`entry-summary.ts` + `entry-summary.test.ts`, `format-transcript.ts` + `format-transcript.test.ts`).
Following that structure, a new `src/session-listing.ts` owns the three pure decisions this change introduces:

```typescript
/** Default cap on how many paths `list_session_files` lists. */
export const DEFAULT_LIST_LIMIT = 10;

/** Take the newest `limit` paths from a newest-first list; a negative limit yields none. */
export function boundListingPaths(files: string[], limit: number): string[];

/** Text body: directory line, count line, one indented path per bounded entry. */
export function formatListingText(
  directory: string,
  paths: string[],
  total: number,
): string;

/** Collapsed TUI row phrase, without theme colouring or the expand hint. */
export function formatListingSummary(
  directory: string,
  shown: number,
  total: number,
): string;
```

`boundListingPaths` is `files.slice(0, Math.max(0, limit))` — head, not tail, and clamped.
Unclamped, a negative `limit` is not a no-op but a near-full listing: measured, `["newest","2nd","3rd","4th"].slice(0, -2)` returns the first two, so `limit: -2` against 608 files would emit 606 paths.

`formatListingText` derives truncation from its own arguments (`paths.length < total`) rather than taking a flag, so the caller cannot desynchronize the two.

### Output shapes

Untruncated (byte-identical to today):

```text
Session directory: /Users/chris/.pi/agent/sessions/--Users-chris-worktrees-issue-546--
2 session files, newest first:
  /Users/chris/.pi/agent/sessions/--Users-chris-worktrees-issue-546--/2026-07-06T10-00-00Z_.jsonl
  /Users/chris/.pi/agent/sessions/--Users-chris-worktrees-issue-546--/2026-07-05T09-00-00Z_.jsonl
```

Truncated:

```text
Session directory: /Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages--
608 session files, newest first (showing 10):
  …ten paths…
```

Empty (unchanged):

```text
Session directory: /nowhere
No session files found.
```

The singular forms (`1 session file, newest first:`) are preserved.
`limit: 0` produces `608 session files, newest first (showing 0):` with no path lines — degenerate but honest, and it is what the caller asked for.

### Details and the collapsed row

The `listing` variant gains one field:

```typescript
type SessionToolDetails =
  | { kind: "transcript"; summary: SessionSummary }
  | { kind: "status"; message: string }
  | { kind: "listing"; directory: string; count: number; shown: number };
```

`count` stays the true total; `shown` is how many paths the body listed.
`formatResultText`'s `listing` branch delegates to `formatListingSummary(details.directory, details.shown, details.count)`, which returns `10 of 608 session files in <dir>` when `shown < count` and `608 session files in <dir>` otherwise.
The branch itself shrinks to a single call, so the only line in `formatResultText` that this change leaves untested is the delegation.

### Call site

`execute` composes the module rather than re-deriving anything:

```typescript
const files = listSessionFiles(directory);
const paths = boundListingPaths(files, params.limit ?? DEFAULT_LIST_LIMIT);
return {
  content: [{ type: "text", text: formatListingText(directory, paths, files.length) }],
  details: { kind: "listing", directory, count: files.length, shown: paths.length },
};
```

This is Tell-Don't-Ask against `session-listing.ts`: the tool hands it the data and takes back the rendered product, and the double derivation of `count` at the current call site (`renderListing` computing `files.length` for the count line, `execute` computing it again for `details`) collapses to one read.
The Tidy-First step below reshapes this into a `buildListingResult` helper mirroring `buildTranscriptResult` before the behavior change lands, so the feature commit only adds the parameter, the default, the slice, and `shown`.

### Escape hatch

With a default in place, "list everything" needs an explicit value.
A large `limit` (e.g. `limit: 1000`) does it; there is no sentinel, and `0` means zero rather than unbounded.
The tool description and README say so.

## Module-Level Changes

- **NEW** `packages/pi-session-tools/src/session-listing.ts` — `DEFAULT_LIST_LIMIT`, `boundListingPaths`, `formatListingText`, `formatListingSummary`.
  The body-rendering logic moves here from `renderListing`; the collapsed-row phrasing moves here from `formatResultText`.
- **NEW** `packages/pi-session-tools/test/session-listing.test.ts` — unit tests for all four exports.
- `packages/pi-session-tools/src/index.ts`:
  - Remove `renderListing` (its sole caller is `list_session_files`'s `execute`; grep confirms no other reference in `src/`, `test/`, `README.md`, or `.pi/`).
  - Add `buildListingResult(directory, files, params)` directly below `buildTranscriptResult`, returning `{ content, details }`.
  - Add `limit: Type.Optional(Type.Number({ … }))` to `list_session_files`'s `parameters`, and extend the tool `description` to name the default and the large-`limit` escape hatch.
  - Extend `SessionToolDetails`'s `listing` variant with `shown: number`.
  - Replace `formatResultText`'s inline `listing` phrasing with a `formatListingSummary` call.
  - Update the module header comment's `list_session_files` line to mention the bound.
- `packages/pi-session-tools/test/list-session-files.test.ts`:
  - Add a `mockSessionFiles(n)` fixture helper and migrate the three existing inline fixture blocks to it.
  - Add a `describe("limit")` block for the new behavior and a `shown` assertion in the existing `describe("details")` block.
- `packages/pi-session-tools/README.md:113-133` — document `limit`, the default of 10, the truncated sample output, and the large-`limit` escape hatch.

Files in the blast radius that this design predicts will **not** change, with the claim each rests on:

- `packages/pi-session-tools/src/session-file.ts` — `listSessionFiles` keeps returning the full newest-first list; the bound is applied above it, because `details.count` must report the true total.
- `packages/pi-session-tools/test/session-file.test.ts` — tests `listSessionFiles` only, which is untouched.
- `src/index.ts`'s `formatCallText` — it already emits a `limit: N` hint for `args.limit != null` (line 59), and `renderCall` receives the caller's raw arguments, so an omitted `limit` correctly shows no hint even though the default applies inside `execute`.
- `.pi/prompts/retro.md` and `.pi/prompts/sync-worktree.md` — both want the newest entry, which the default of 10 still delivers; neither quotes the count line or a file count.
- `packages/pi-session-tools/test/read-session.test.ts`, `read-session-file.test.ts`, `read-parent-session.test.ts` — they exercise `buildTranscriptResult`, which this plan does not touch.

Grep evidence for the doc sweep: the literal `session files, newest first` and `renderListing` appear only in `src/index.ts`, `test/list-session-files.test.ts`, and `README.md:115,130` (plus historical `docs/plans`, `docs/retro`, and `docs/triage` entries, which record past state and are not updated).
`pi-session-tools` has no `docs/architecture/` tree and no `.pi/skills/package-pi-session-tools/SKILL.md`, so neither sweep target exists.

## Test Impact Analysis

1. **New tests the extraction enables.**
   `session-listing.ts` makes three things directly testable that are not today: the head-slice and its negative clamp, the count line's truncated and untruncated forms, and the collapsed row's phrase.
   The last is the important one — `formatResultText` cannot be called from a test without initialized pi-tui keybindings, so the row's phrasing has never been covered for any tool in this package.
2. **Tests that become redundant.**
   None are removed.
   The existing `list-session-files.test.ts` case that asserts the full text body for two files now overlaps `session-listing.test.ts`'s untruncated case, but it keeps its own value: it is the only test proving `execute` wires the directory encoding, `listSessionFiles`, and the renderer together.
   It is migrated to the fixture helper, not deleted.
3. **Tests that must stay as-is.**
   `test/session-file.test.ts`'s sort-order and missing-directory cases — they pin the newest-first ordering the head-slice depends on, at the layer this change does not touch.
   `test/list-session-files.test.ts`'s "derives the sessions root from the current session file" and "reports no session files found" cases likewise exercise paths orthogonal to the bound.

Verified against the fixtures by the Tidy-First assessor: every existing assertion in `list-session-files.test.ts` uses one or two files, so `shown < count` is false at those sizes and the default of 10 leaves all of them green.
That is a prediction the plan makes and Step 3 must confirm, not an assumption to skip.

## Invariants at risk

The prior step on this surface is [#549], which introduced `list_session_files` and `renderListing`.
Its documented outcomes and the test that pins each:

- **The text body's untruncated shape** — `Session directory:` line, count line, indented absolute paths.
  Pinned by `test/list-session-files.test.ts`'s "lists session files for a cwd, newest first", which asserts the complete string with `toBe`.
  Opened and confirmed: it asserts the literal body, not a substring, so any drift in the untruncated form fails it.
  Constituency: the model reading the tool result, and the README sample that shows it.
- **`No session files found.` for a missing directory** — pinned by "reports no session files found for an empty directory" and by `details.count === 0`.
  A bound must not change this path; `boundListingPaths([], n)` is `[]` and the empty branch still fires first.
- **`details.count` is the true file count** — pinned by "returns listing details with directory and count".
  This is the invariant the whole design turns on: the count line and `details.count` must keep reporting 608 while the body lists 10.
  Constituency: a caller deciding whether to re-ask with a larger `limit`.
  The design keeps the bound above `listSessionFiles` specifically so `count` still sees the full array.
- **Newest-first ordering** — pinned by `test/session-file.test.ts`.
  The head-slice is only correct because of it; if the sort ever inverted, `limit` would return the oldest N.
  Step 3's ordering assertion (the bounded paths equal the newest N, in order) pins the composition, not just the sort.

Quantitative invariant — the tool-result size, which is the issue's whole motivation:

| Listing                         | Files | Body chars                                  |
| ------------------------------- | ----- | ------------------------------------------- |
| Full, today (measured)          | 608   | 88,160                                      |
| Default `limit: 10` (predicted) | 10    | 1,450 paths + ~110 of header and count line |
| `limit: 1` (measured)           | 1     | 145                                         |

The measured figures come from `ls ~/.pi/agent/sessions/--Users-chris-development-pi-pi-packages--/*.jsonl` piped through `awk` summing `length($0)+3` (the two-space indent plus a newline).
The predicted default figure is the same sum over the newest ten, so it is arithmetic on measured data rather than an estimate.

## TDD Order

1. **Extract the listing presentation into its own module.**
   `refactor:` — behavior-preserving, and the preparation the Tidy-First assessment recommended leading with.
   Create `src/session-listing.ts` with `formatListingText(directory, paths, total)` and `formatListingSummary(directory, shown, total)` reproducing today's exact strings (call them with `paths.length === total` throughout — the truncated arm arrives in Step 3).
   Add `buildListingResult(directory, files)` to `src/index.ts` directly below `buildTranscriptResult`, returning `{ content, details }`; point `list_session_files`'s `execute` at it and delete `renderListing` and the inline `details` literal.
   Point `formatResultText`'s `listing` branch at `formatListingSummary`.
   Add `test/session-listing.test.ts` covering the plural count line, the singular count line, the empty directory, and both summary phrasings at `shown === total`.
   Friction this prepares: today the count is derived in two places, so a single commit adding `limit` would have to restructure the helper and change its behavior at once.
   Killing mutation: make `formatListingText` always emit the plural `${total} session files` count line — the singular one-file test must go red while the two-file test stays green.
   Verify: `pnpm --filter @gotgenes/pi-session-tools exec vitest run` and `pnpm run check`.
   Commit: `refactor(pi-session-tools): extract listing presentation into session-listing (#916)`.

2. **Introduce an n-file fixture helper in the tool suite.**
   `test:` — the second Tidy-First recommendation.
   Add `mockSessionFiles(n: number): string[]` to `test/list-session-files.test.ts`: it sets `mockExistsSync` true, `mockReaddirSync` to `n` generated `.jsonl` names, and `mockStatSync` to descending mtimes, and returns the expected newest-first basenames so a test can build its expected body from them.
   Migrate all three existing inline fixture blocks to it in the same commit, so the helper ships with consumers rather than as dead code.
   Friction this prepares: Step 3 needs fixtures of 12+ files for truncation and another for the clamp, and today's blocks are hand-written for one or two files with filename-suffix-keyed `mockStatSync` implementations that do not generalize.
   Killing mutation: reverse the mtime assignment inside `mockSessionFiles` so the returned basenames no longer match the tool's newest-first output — the migrated "lists session files for a cwd, newest first" test must go red, proving the helper's ordering contract is actually exercised.
   Verify: `pnpm --filter @gotgenes/pi-session-tools exec vitest run test/list-session-files.test.ts`.
   Commit: `test(pi-session-tools): add an n-file fixture helper to the list_session_files suite (#916)`.

3. **Bound the listing to the newest 10 paths by default.**
   `feat!:` — the behavior change, the schema, the details field, and the docs, in one commit.
   Red, in `test/session-listing.test.ts`: `boundListingPaths` returns the newest N in order for `limit < length`, the whole array for `limit >= length`, `[]` for `limit === 0`, and `[]` for a negative `limit`; `formatListingText` emits `(showing N)` when `paths.length < total` and omits it otherwise; `formatListingSummary` returns `10 of 608 session files in <dir>` when `shown < total`.
   Red, in `test/list-session-files.test.ts`: a 12-file fixture with no `limit` lists 10 paths under a `12 session files, newest first (showing 10):` count line; an explicit `limit: 3` lists 3; a `limit` above the total renders today's exact untruncated body; `details.shown` reports the bounded count while `details.count` reports the total; the existing one- and two-file cases stay green under the default.
   Green: add `DEFAULT_LIST_LIMIT` and `boundListingPaths` to `src/session-listing.ts`, the truncated arm to `formatListingText` and `formatListingSummary`, the `limit` parameter and extended `description` to the tool, `shown` to the `listing` details variant, and the `params.limit ?? DEFAULT_LIST_LIMIT` resolution to `buildListingResult`.
   Update `README.md:113-133` with the parameter, the default, a truncated sample, and the large-`limit` escape hatch in the same commit.
   Killing mutations, one per equivalence class:
   - Replace `params.limit ?? DEFAULT_LIST_LIMIT` with `params.limit ?? files.length` — the default-truncation test goes red; the explicit-`limit` and small-directory tests stay green.
   - Change `files.slice(0, …)` to `files.slice(-…)` in `boundListingPaths` — the newest-N ordering assertions go red; the `limit >= length` test stays green.
   - Change `Math.max(0, limit)` to `limit` — the negative-`limit` test goes red; every non-negative case stays green.
   - Delete the `(showing ${paths.length})` suffix from `formatListingText` — the truncated count-line tests go red; the untruncated ones stay green.
   - Hardcode `shown: files.length` in `buildListingResult` — the `details.shown` test goes red while `details.count` assertions stay green.
   - Delete the `${shown} of` prefix from `formatListingSummary` — the truncated summary test goes red.

   Verify: `pnpm --filter @gotgenes/pi-session-tools exec vitest run`, `pnpm run check`, `pnpm run lint`.
   Commit: `feat(pi-session-tools)!: bound list_session_files to the newest 10 paths by default (#916)` with a `BREAKING CHANGE:` footer naming the old behavior (every path) and the escape hatch (a large `limit`).

## Risks and Mitigations

- **Risk: the major version bump surprises at ship time.**
  `feat!:` takes the package from `1.2.1` to `2.0.0` for what is a one-parameter addition plus a default.
  Mitigation: the Release Recommendation states the resulting version, and the operator classified the change as breaking at the `ask_user` gate with that framing.
- **Risk: a caller genuinely needs the full listing and has no way to ask for it.**
  Mitigation: a large `limit` returns everything; the tool `description` and README both say so, so the escape hatch reaches the agent that needs it without reading the source.
  This was priced at the gate as the cost of defaulting.
- **Risk: a negative `limit` produces a near-full listing rather than an empty one.**
  This is not hypothetical — measured, `[…4 items].slice(0, -2)` returns the first two, so an unclamped `limit: -2` against 608 files emits 606 paths, the opposite of the caller's intent.
  Mitigation: `boundListingPaths` clamps with `Math.max(0, limit)`, and Step 3's killing mutation for that clamp is named explicitly.
  The mirror-image defect on the transcript side is filed as [#950] rather than fixed here.
- **Risk: `details.count` silently becomes the bounded count during the refactor, so the body says "608" and the TUI row says "10 of 10".**
  Mitigation: the bound is applied above `listSessionFiles` so the total is still in hand; the existing `details.count` test and the new `details.shown` test assert both numbers against the same 12-file fixture, and the "hardcode `shown: files.length`" mutation is the check that they discriminate.
- **Risk: the collapsed-row delegation in `formatResultText` regresses without a test noticing.**
  `formatResultText` itself stays untested — no test in this repo exercises `renderResult`, because `keyHint` needs initialized pi-tui keybindings.
  Mitigation: the design shrinks that branch to a single `formatListingSummary` call, so the untested surface is one delegation rather than the phrasing logic; the phrasing is covered directly.
  Accepted residual: a typo in the delegation's argument order (`shown` and `count` are both `number`) would not be caught by the suite.
- **Risk: [#943] lands and reintroduces an unbounded listing.**
  Mitigation: the bound lives in `boundListingPaths`, applied to whatever array `execute` assembles, so a recursive listing inherits it by construction.
  The Non-Goals section records the interaction so [#943]'s plan can cite it.

## Open Questions

None.
The default, the disclosure format, and the `details` shape were all settled at the `ask_user` gate; the remaining decisions are mechanical.

[#549]: https://github.com/gotgenes/pi-packages/issues/549
[#940]: https://github.com/gotgenes/pi-packages/issues/940
[#943]: https://github.com/gotgenes/pi-packages/issues/943
[#950]: https://github.com/gotgenes/pi-packages/issues/950
