---
issue: 1003
issue_title: "pi-github-tools, pi-colgrep: `isError: true` results read as success on Pi < 0.99.0"
---

# Require Pi 1.0.0 so `err()` results reach the model as errors

## Release Recommendation

**Release:** ship independently

Neither `pi-github-tools` nor `pi-colgrep` has a roadmap step that references this issue (`pi-github-tools` has no architecture doc, and `grep 1003` over `packages/pi-colgrep/docs/architecture/architecture.md` finds nothing), so there is no batch to wait for.
Dispatch both packages in one release run.
At planning time `./scripts/release/next-version.sh` prints `Nothing to release` for both (measured), so the `feat!:` and `fix:` commits below cut a major release of each.

## Problem Statement

Both packages report a tool failure by returning `err()` from `execute`, which sets `isError: true` on the result (`src/tool-result.ts` in each package).
Before Pi 0.99.0 the agent loop discarded that flag: it returned `{ result, isError: false }` for every non-throwing `execute`.
Both packages declare `@earendil-works/pi-coding-agent >=0.75.0`, so a user on Pi 0.75–0.98 sees every caught failure flagged as a success.
That covers `ci_find`, `ci_list`, `ci_watch`, and `issue_close`, plus colgrep's unavailable-binary, missing-query, and search errors.
The model still reads the error text, but Anthropic's `is_error`, the TUI's error styling, and other extensions' `tool_result` handlers all see success.

A second symptom sits in the colgrep renderer and is independent of the Pi version.
Its collapsed result view always prints a green `✓` followed by the hit count, so a failed search renders as `✓ no matches`.

## Goals

- Raise the peer floor of `pi-github-tools` to `@earendil-works/pi-coding-agent >=1.0.0`, and the devDependency pin from `0.79.1` to `1.0.0`.
- Raise the peer floor of `pi-colgrep` to `>=1.0.0` for both `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`, and both devDependency pins from `0.79.1` to `1.0.0`.
- With those floors, every Pi version either package admits honors `isError: true`, so the existing `err()` builders stay as they are.
- In colgrep's collapsed view, render a failed result as a red `✗` followed by the error's first line, instead of `✓ no matches`.
- **Breaking:** both floor raises are breaking.
  On upgrade, a user on Pi older than 1.0.0 gets a peer-dependency mismatch without making any edit of their own.
  Each lands as `feat(<pkg>)!: require Pi 1.0.0 or later` with a `BREAKING CHANGE:` footer, following the precedent of `e93ec7ce` (pi-subagents) and `9c76ae30` (pi-permission-system).
- The renderer change is a non-breaking `fix(pi-colgrep):`.

## Non-Goals

- Throwing from `execute` instead of returning `err()`.
  Throwing works on every host from 0.75.0.
  I checked the published `pi-agent-core` 0.75.0 tarball and the pinned 0.79.1 `dist/agent-loop.js`: both turn a thrown error into `createErrorToolResult(error.message)` with `isError: true`.
  It also matches Pi's `docs/extensions.md` ("Throw from `execute()` to produce a failed tool result").
  The operator chose the floor raise instead.
  That keeps `err()` and avoids a collision with the open third-party PR [#993], whose new `test/tools/issue-close.test.ts` imports `err` from `#src/tool-result`.
- Documenting a "needs Pi 0.99.0" caveat without a floor change.
  The operator rejected that option.
- Raising the floor of any other package that still admits Pi older than 1.0.0 (`pi-session-tools`, `pi-subagents-worktrees`, `pi-autoformat`, `pi-permission-model-judge`).
  `grep -rn isError` over those packages' `src/` finds no `execute` that returns the flag, so none of them is affected by this defect.
- Unifying the two packages' `tool-result.ts` copies.
  Sharing code across packages is a separate concern.
- Any change to the expanded colgrep view, which already prints the full text.

## Background

- `packages/pi-github-tools/src/tool-result.ts` and `packages/pi-colgrep/src/tool-result.ts` contain the `ok()` / `err()` builders.
  `err()` returns `details: undefined, isError: true`.
- The four `pi-github-tools` wrappers (`src/tools/ci-find.ts`, `ci-list.ts`, `ci-watch.ts`, `issue-close.ts`) catch whatever the `lib/` call throws and return `err(message)`.
- `packages/pi-colgrep/src/tools/colgrep.ts`:
  - `executeColGrepSearch` returns `err()` on three paths: unavailable binary, missing query, and search error.
  - `registerColGrep`'s `renderResult(result, options, theme, context)` calls the private `formatResult(result, options, theme)` (line 180, sole caller at line 145).
  - The collapsed branch of `formatResult` unconditionally emits `theme.fg("success", "✓")`.
- Pi exposes `context.isError` to `renderResult` (`ToolRenderContext.isError`, "Whether the current result is an error").
  The field is present in the 0.75.0 and 1.0.0 type declarations (checked in the tarball and the Pi checkout).
  Pi's own example `examples/extensions/tic-tac-toe.ts` uses `context?.isError ? theme.fg("error", "✗ ") : theme.fg("success", "✓ ")`.
  `error` is a `ThemeColor` (`theme.ts`).
- Three sibling packages already floor at `>=1.0.0`: `pi-nocd`, `pi-subagents`, and `pi-permission-system`.
- The watchlist rows in `.pi/skills/package-pi-github-tools/SKILL.md` (line 50) and `.pi/skills/package-pi-colgrep/SKILL.md` (line 78) already say "true only from Pi 0.99.0 (#1003)".
  Commit `3264a775` added that wording, and it becomes stale once the floor admits only hosts where the flag holds.

## Design Overview

### Floor raise (both packages)

This is a manifest change only, with no `src/` edit.
Raise the peer floor and the devDependency pin together, as `e93ec7ce` did, so `tsc` keeps checking against the oldest Pi the package admits.

Spike (measured, then reverted): I bumped both devDependency pins to `1.0.0` and ran `pnpm install`.
Afterwards, for both packages:

- `tsc --noEmit` is clean.
- `pnpm --filter … run lint` (Biome, ESLint, rumdl) reports nothing.
- `vitest run` passes: 93 tests for pi-github-tools and 116 for pi-colgrep.
- The lockfile diff is 18 lines.

The `1.0.0` types do not require any source or test adjustment.

### Renderer (pi-colgrep)

Pass `context.isError` into `formatResult` as a fourth parameter, `isError: boolean`.
The collapsed branch then has these cases:

- **Error:** `${theme.fg("error", "✗")} ${theme.fg("error", firstLine)}`, where `firstLine` is the result text up to its first `\n`.
  For the unavailable-binary path this is `colgrep is not installed or not available.`.
- **Success:** unchanged (`✓` plus the hit count).

The expanded branch is unchanged.

```typescript
renderResult(result, options, theme, context) {
  const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
  text.setText(formatResult(result, options, theme, context.isError));
  return text;
},
```

Edge case: an error result with empty text renders `✗` followed by an empty first line.
Step 3 does not assert the exact spacing.

## Module-Level Changes

- `packages/pi-github-tools/package.json`: change the peer `@earendil-works/pi-coding-agent` to `">=1.0.0"` and the devDependency to `"1.0.0"`.
- `packages/pi-colgrep/package.json`: change the peers `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui` to `">=1.0.0"` and both devDependencies to `"1.0.0"`.
- `pnpm-lock.yaml`: regenerated by `pnpm install`.
- `packages/pi-colgrep/src/tools/colgrep.ts`: `formatResult` gains an `isError` parameter and an error branch.
  `renderResult` passes `context.isError`.
- `packages/pi-colgrep/test/tools/colgrep.test.ts`: add a local `captureTool()` helper and a `renderResult` describe block.
- `.pi/skills/package-pi-github-tools/SKILL.md`: reword the watchlist row from "true only from Pi 0.99.0 (#1003)" to state that Pi honors the flag from 0.99.0 and that the package's 1.0.0 floor admits no host that drops it.
  The "Breaks as" cell still says every `err()` reads as success if that changes.
- `.pi/skills/package-pi-colgrep/SKILL.md`: make the same rewording on the `err()` row.
  Also extend the `renderCall`/`renderResult` row to name `context.isError` as an assumed input.
- Predicted unchanged:
  - Both `src/tool-result.ts` files, because `err()` stays.
  - The four `pi-github-tools` wrappers.
  - Both READMEs, because `grep` finds no Pi-version statement in either.
  - `packages/pi-colgrep/docs/architecture/architecture.md`, whose module table already says "call/result rendering".
  - `packages/pi-colgrep/test/extension.test.ts`, whose `TestPi.registerTool` at line 73 is a no-op.

## Test Impact Analysis

1. New tests: `renderResult` has no test today.
   `formatResult` is private, and `test/tools/colgrep.test.ts` imports only `executeColGrepSearch`.
   Capturing the tool from `registerColGrep` makes it testable through the real callback without widening exports.
   The capture uses a stub `pi`:

   ```typescript
   const registerTool = vi.fn();
   registerColGrep({ registerTool } as unknown as ExtensionAPI, deps);
   const tool = registerTool.mock.calls[0][0];
   ```

   A stub theme `{ fg: (color, s) => `<${color}>${s}` }` makes the color observable.
   `formatResult` calls only `theme.fg`, which the stub covers, and `bold` appears only in `formatCall`.

2. Redundant tests: none.

3. Unchanged tests: the four `result.isError` assertions in `executeColGrepSearch` stay as they are, because `err()` is unchanged.

The floor-raise steps add no tests: no test can observe a peer range, and the spike's green `tsc` and suite against `1.0.0` are their verification.

## Invariants at risk

- Search failures keep `isError: true` in the result object.
  `test/tools/colgrep.test.ts` pins this with four `expect(result.isError).toBe(true)` assertions, and step 3 leaves them untouched.
- The collapsed success view still shows `✓` plus the hit count.
  Step 3 adds a success-path render test that pins it.

## TDD Order

1. **Raise the pi-github-tools floor.**
   Edit `packages/pi-github-tools/package.json` and run `pnpm install`.
   Verify with `pnpm --filter @gotgenes/pi-github-tools run check`, `run lint`, and `run test` (expect 93 passing).
   Update the watchlist row in `.pi/skills/package-pi-github-tools/SKILL.md` in the same commit.
   No new tests, so no killing mutation.
   Commit:

   ```text
   feat(pi-github-tools)!: require Pi 1.0.0 or later

   Raise the peer floor and devDependency pin for
   @earendil-works/pi-coding-agent together. Pi before 0.99.0 discarded
   the isError flag a tool returns from execute, so every caught ci_find,
   ci_list, ci_watch, and issue_close failure reached the model and other
   extensions' tool_result handlers as a success.

   Refs #1003

   BREAKING CHANGE: @earendil-works/pi-coding-agent must now be 1.0.0 or
   later. On an older Pi, stay on the current pi-github-tools major.
   ```

2. **Raise the pi-colgrep floor.**
   Edit `packages/pi-colgrep/package.json` for both `pi-coding-agent` and `pi-tui`, then run `pnpm install`.
   Verify `check`, `lint`, and `test` for `@gotgenes/pi-colgrep` (expect 116 passing).
   Update the `err()` watchlist row in `.pi/skills/package-pi-colgrep/SKILL.md` in the same commit.
   Commit `feat(pi-colgrep)!: require Pi 1.0.0 or later`, with a body and `BREAKING CHANGE:` footer shaped like step 1's.
   The footer names both `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`, and the body names the unavailable-binary, missing-query, and search errors.

3. **Render a failed colgrep search as an error.**
   - Red: in `test/tools/colgrep.test.ts`, add the `captureTool()` helper and a `describe("renderResult")` block with three tests:
     - An error result with `{ expanded: false }` and `context.isError: true` renders text that contains `<error>✗` and the error's first line, and does not contain `<success>✓`.
     - A success result (`details.hitCount: 2`) with `context.isError: false` renders `<success>✓` and `2 hits`.
     - An error result with `{ expanded: true }` renders the full error text.
   - Green: add the `isError` parameter and branch to `formatResult`, and pass `context.isError` from `renderResult`.
   - Update the `renderCall`/`renderResult` watchlist row in `.pi/skills/package-pi-colgrep/SKILL.md` to name `context.isError`.
   - Killing mutations:
     - In `renderResult`, pass `false` instead of `context.isError`.
       This kills the collapsed-error test only, and pins the wiring.
     - In `formatResult`, make the error branch's condition `false`.
       This kills the same test, and pins the branch.
     - Make the collapsed branch always emit `theme.fg("error", "✗")`.
       This kills the success test.
   - Commit: `fix(pi-colgrep): show a failed search as an error in the collapsed result (#1003)`.

## Risks and Mitigations

- **A user on Pi older than 1.0.0 upgrades and gets a peer warning, or an install refusal under strict peers.**
  The `BREAKING CHANGE:` footer drives a major bump and names the remedy: stay on the current major.
- **PR [#993] needs a rebase.**
  It touches `src/tools/issue-close.ts`, `src/lib/issue.ts`, its tests, and the README, but not `package.json`, so only `pnpm-lock.yaml` could conflict, and that would be in a merge from `main`, not in the PR's own diff.
  `err()` stays, so its test's import keeps compiling.
- **The `1.0.0` types reject something the spike missed.**
  The spike ran the full `check`, `lint`, and `test` scripts for both packages against `1.0.0` (measured green), and each step re-runs them.

## Open Questions

None.

[#993]: https://github.com/gotgenes/pi-packages/pull/993
