---
issue: 1061
issue_title: "Support patch-based tools for pi-autoformat"
---

# Support patch-based tools in `customMutationTools`

## Release Recommendation

**Release:** ship independently

pi-autoformat has no architecture roadmap or release batch, and the change is an additive, opt-in config key.

## Problem Statement

Some Pi environments edit files through a Codex-style `apply_patch` tool instead of `write`/`edit`.
Its input is a single patch string (`*** Begin Patch` … `*** End Patch`) that names the files inside it, so no tool argument holds a filename for `customMutationTools` to point at.
Today the only option, `pathField: "input"`, queues the whole patch text as one bogus path, and the files the patch changed are never formatted.

The issue was filed by @michaelmior, who also opened PR #1072 with an implementation.
The PR review (`docs/retro/1061-support-patch-based-tools.md`, stage "PR Review") settled the direction: adopt the capability with a simplified design, using the PR as reference rather than merging it.

## Goals

- Add a `patchField` option to `customMutationTools` entries: a dotted path into the tool's input that resolves to a Codex-style patch string.
- Extract the files a patch adds, updates, or moves to, and queue them for formatting through the existing pipeline.
- Never queue a path from `*** Delete File:`: the file no longer exists, and a missing file fails the whole formatter batch.
- Keep `docs/configuration.md`, `schemas/pi-autoformat.schema.json`, and the config loader aligned.
- Non-breaking: an additive, opt-in key with no default change (`feat`, not `feat!`).

## Non-Goals

- Validating the patch grammar.
  The PR's line-by-line state machine (`consumePatchLine`, `consumePatchMove`, `isPatchBodyLine`) is not adopted; see Design Overview.
- `*** Environment ID:` handling, which the header scan ignores like any other non-header line.
- Restructuring the other config-loader validators (`validateConfigObject`, `validateShellMutationDetection`, `validateFormatterDefinition`, `validateFallbackStep`, `validateChains`, `validateFormatterOutput`) as the PR did; the complexity gate does not require it (measured, see Background).
- Zero-config recognition of a tool named `apply_patch`: tool names and field names vary across packages, so the mapping stays explicit config.
- An automated real-CLI acceptance test; no LLM-free path can make the real CLI call `apply_patch` (commands have no `ctx.executeTool()`).
- pi-permission-system coverage of `apply_patch` (its `PATH_BEARING_TOOLS` omits it).
  This only matters if this repo's agents adopt a patch tool, which the PR review judged not worthwhile for Anthropic models, so no follow-up is filed.

## Background

- `src/custom-mutation-tools.ts` defines `CustomMutationToolSpec` (`toolName` plus optional `pathField` / `pathFields`) and `extractPathsFromInput`, which resolves each dotted path with `resolveDottedPath` and flattens strings and string arrays via `collectFromValue`.
  `extractPathsFromInput` already combines `pathField` and `pathFields` additively; the exactly-one rule is enforced only by the loader.
- `createCustomToolHandler` wraps a spec as a `MutationSourceHandler`; `extension.ts` registers them when `config.customMutationTools` is non-empty, and the `tool_result` listener returns early on `event.isError`, so only successful tool results are recorded.
- `TouchedFilesQueue.add` normalizes and scope-filters paths but never checks existence (`isInFormatScope` deliberately keeps nonexistent paths), and `PromptAutoformatter.flushPrompt` hands every queued file to one formatter invocation per chain group.
  A deleted path therefore fails the batch, which the PR review reproduced end to end against two real patch packages.
- `src/config-loader.ts` `validateCustomMutationToolEntry` (around line 690) validates `toolName`, `pathField`, `pathFields`, rejects unknown keys, and enforces exclusivity with `hasField === hasFields`.
- `schemas/pi-autoformat.schema.json` `$defs.customMutationToolSpec` mirrors the loader with a two-branch `oneOf`.
- Patch tools in the ecosystem (from the PR review, read from published tarballs): `@howaboua/pi-codex-conversion` and `@d3ara1n/pi-apply-patch` carry the patch in `input`; `pi-openai-codex-compat` and `@maxiaochao/pi-toolkit`'s `codex-edit` use `patch`.
- Complexity gate, measured at planning time on a scratch worktree of `main`: a minimal implementation of this exact design passes `pnpm fallow audit --base origin/main` (exit 0).
  `validateCustomMutationToolEntry` grows from 22 cyclomatic / 39 cognitive to 26 / 46 but is excluded as an inherited finding, and the new scan function is not flagged.
- Package skill constraints: opt-in widening of noticed mutations is in the README's charter ("Widening which mutations are noticed (always opt-in and explicit)"); keep schema, `docs/configuration.md`, README, and loader aligned; a declared config field must be read by the dispatcher.

## Design Overview

### Spec shape

```typescript
export type CustomMutationToolSpec = {
  toolName: string;
  pathField?: string;
  pathFields?: string[];
  /** Dotted path to a Codex-style patch string in the tool's `input` payload. */
  patchField?: string;
};
```

The flat optional shape is kept.
A discriminated union would state the exactly-one invariant in the type, but it widens the change into every test that builds a spec with `Pick`, and `extractPathsFromInput` is additive by construction, so the loader stays the single owner of exclusivity.
The doc comment's exclusivity sentence is updated to name all three keys.

### Extraction

`extractPathsFromInput` widens its `Pick` to include `patchField` and, after the existing `pathField`/`pathFields` loop, appends `extractPathsFromPatch(resolveDottedPath(input, spec.patchField))` when `patchField` is set.

```typescript
const PATCH_FILE_HEADERS = ["*** Add File: ", "*** Update File: "];
const PATCH_MOVE_HEADER = "*** Move to: ";

function extractPathsFromPatch(patch: unknown): string[] {
  if (typeof patch !== "string") return [];
  const paths: string[] = [];
  for (const line of patch.split(/\r?\n/)) {
    const header = PATCH_FILE_HEADERS.find((prefix) => line.startsWith(prefix));
    if (header) paths.push(line.slice(header.length).trim());
    else if (line.startsWith(PATCH_MOVE_HEADER) && paths.length > 0)
      paths[paths.length - 1] = line.slice(PATCH_MOVE_HEADER.length).trim();
  }
  return paths;
}
```

Why a stateless header scan rather than grammar validation (operator decision in the PR review):

- The handler only sees successful `tool_result` events, so the tool has already accepted the patch and changed the files; a stricter re-validation cannot prevent a bad edit, only turn an accepted variant into a silent miss.
- Hunk content lines always begin with `+`, `-`, or a space, so a content line that quotes a header (`+*** Add File: x`, or a space and then `*** Update File: x`) cannot match an unindented header prefix.
  This is why lines are **not** trimmed before matching.
- A wrapper the tool tolerates (a heredoc `apply_patch <<'EOF'` line, a missing `*** Begin Patch`) does not hide the headers.

Edge-case behavior, each pinned by a test in step 1:

| Input                                                                 | Paths                                                                                                                |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Organic patch from the PR review (update, add, delete, update + move) | `src/greet.ts`, `src/farewell.ts`, `src/lib/util.ts`                                                                 |
| Same patch with CRLF line endings                                     | same                                                                                                                 |
| `*** Delete File:` only                                               | none                                                                                                                 |
| Context line quoting a header (a space, then `*** Add File: fake.ts`) | only the real header's path                                                                                          |
| Added line quoting a header (`+*** Update File: fake.ts`)             | only the real header's path                                                                                          |
| Trailing whitespace after a header path                               | trimmed path                                                                                                         |
| Heredoc-wrapped patch                                                 | the patch's paths                                                                                                    |
| `patchField` absent or resolving to a non-string                      | none                                                                                                                 |
| `patchField` combined with `pathField` on one spec                    | both sets, additively (the loader rejects this config; the extractor stays additive like `pathField` + `pathFields`) |

Every row was run through a spike of this code at planning time and produced the listed result.

### Config validation

`validateCustomMutationToolEntry` gains a `patchField` branch with the same non-empty-string check as `pathField` (accepting the two-site duplication; the assessor rated a shared helper optional and not worth it), a `let patchField` local, and a `return { toolName, patchField }` arm.
The exclusivity check becomes a count over the three settings, with the message "Expected exactly one of `pathField`, `pathFields`, or `patchField`." and the residual unreachable-return comment updated to match.

### Schema

`customMutationToolSpec` gains a `patchField` string property (`minLength: 1`), and `oneOf` becomes three required-only branches: under `oneOf`, an entry with two keys matches two branches and fails, so the existing `not` clauses are redundant.

## Module-Level Changes

- `packages/pi-autoformat/src/custom-mutation-tools.ts` — `patchField` on `CustomMutationToolSpec` and its doc comment; `extractPathsFromInput` `Pick` widened and patch paths appended; new private `extractPathsFromPatch`, `PATCH_FILE_HEADERS`, `PATCH_MOVE_HEADER`.
- `packages/pi-autoformat/test/custom-mutation-tools.test.ts` — new `describe("patchField", …)` inside `describe("extractPathsFromInput")`, holding the organic patch as a fixture constant; one `createCustomToolHandler` case with a `patchField` spec.
- `packages/pi-autoformat/src/config-loader.ts` — `validateCustomMutationToolEntry` only, as above.
- `packages/pi-autoformat/test/config-loader.test.ts` — the `validateUserFormatterConfig: customMutationTools` describe gains acceptance of `patchField`, rejection of `patchField` combined with each path key with the new message asserted, and empty/non-string `patchField` rejection; the existing "accepts entries with pathField or pathFields" title widens to include `patchField`.
- `packages/pi-autoformat/schemas/pi-autoformat.schema.json` — `patchField` property and three-branch `oneOf`; the `customMutationTools` description mentions patch tools.
- `packages/pi-autoformat/test/schema.test.ts` — a `customMutationToolSpec` assertion that `patchField` is declared and that `oneOf` holds exactly the three single-key `required` branches.
- `packages/pi-autoformat/docs/configuration.md` — `customMutationTools` section rewritten for three keys (see step 3).

Predicted unchanged, with the claim each rests on:

- `src/extension.ts` and `src/touched-files-queue.ts` — handlers are spec-agnostic and the queue receives plain path strings.
- `src/formatter-config.ts` — only carries `CustomMutationToolSpec[]` through.
- `test/extension.test.ts` — its customMutationTools wiring test uses `pathField` and stays green.
- `README.md` — it names `customMutationTools` only as a pointer (`Where adjacent requests belong`) and enumerates no spec keys.
- `.pi/skills/package-pi-autoformat/SKILL.md` — names no spec keys (grep for `pathField` finds none).

## Test Impact Analysis

1. New tests: header-scan cases on the real model-written patch captured in the PR review, which replaces hand-built fixtures as the primary input; config, schema, and handler cases for the new key.
2. Redundant tests: none.
3. Unchanged: the existing `extractPathsFromInput` `pathField`/`pathFields` cases and config-loader rejection cases still exercise their paths; the "both"/"neither" rejection tests assert only the issue path, not the message, so they stay green across the message change, which is why step 2 asserts the new message explicitly.

## Invariants at risk

- Existing `pathField`/`pathFields` behavior: pinned by the current `extractPathsFromInput` and `createCustomToolHandler` tests, which run unchanged in every step.
- Rejection of both/neither path keys: pinned by the existing config-loader tests (issue paths); step 2's new message assertion covers the three-key wording.

## TDD Order

Every commit below ends with this trailer as its final paragraph, after `Refs #1061, #1072`:

```text
Co-authored-by: Michael Mior <michael@onechronos.com>
```

1. **Extract patch paths** — `test/custom-mutation-tools.test.ts`.
   Red: the edge-case table's rows as tests in a new `describe("patchField", …)` under `extractPathsFromInput`, plus a `createCustomToolHandler` case returning the organic patch's paths for a matching tool name.
   Green: `patchField` on the spec, `extractPathsFromPatch`, the widened `extractPathsFromInput`.
   Killing mutations (each kills only its named test, verified on the spike): add `"*** Delete File: "` to `PATCH_FILE_HEADERS` (kills the organic and delete-only cases); match on `line.trimStart().startsWith(prefix)` (kills the context-line case); replace the move assignment with a no-op (kills the organic case); drop `.trim()` from the header path (kills the trailing-whitespace case).
   Commit: `refactor(pi-autoformat): extract file paths from Codex-style patch input` — no user can reach it until the loader accepts `patchField`.
2. **Accept `patchField` in config and schema** — `test/config-loader.test.ts`, `test/schema.test.ts`.
   Red: `patchField` accepted and round-tripped; `patchField` + `pathField` and `patchField` + `pathFields` rejected at `customMutationTools[N]` with the message "Expected exactly one of `pathField`, `pathFields`, or `patchField`."; `patchField: ""` and `patchField: 42` rejected at `.patchField`; the schema declares `patchField` and a three-branch `oneOf`.
   Green: the `validateCustomMutationToolEntry` changes and the schema edit.
   Killing mutations: delete the `patchField` branch (acceptance test reports "Unknown property."); count only `pathField`/`pathFields` (the combined-key entries are then accepted, failing their rejection tests); drop the `patchField` `oneOf` branch (schema test).
   Run `pnpm fallow audit --base origin/main` before committing and confirm exit 0.
   Commit: `feat(pi-autoformat): format files changed by patch-based tools via customMutationTools patchField`.
3. **Document it** — `docs/configuration.md`.
   State exactly one of three keys; describe `patchField` (a Codex-style patch string; `Add File` and `Update File` paths are formatted, a `Move to` destination replaces its update path, deleted files are skipped); note that the field name varies by tool (`input` or `patch`; check the tool's parameter schema); add `{ "toolName": "apply_patch", "patchField": "input" }` to the example; state that only successful tool results are recorded, so a tool that reports a partly applied patch as an error is not formatted.
   Verify: `pnpm exec rumdl check packages/pi-autoformat/docs/configuration.md`.
   Commit: `docs(pi-autoformat): document patchField for patch-based tools`.

## Risks and Mitigations

- **A patch tool emits headers with leading whitespace.**
  The scan would miss them (no leading trim, by design, to keep content lines from matching).
  Neither real run produced indented headers; the trade-off favors never formatting a quoted header over catching a malformed one.
- **A tool's patch dialect differs from the Codex headers.**
  The scan then returns nothing, which is today's behavior; the docs name the format explicitly.
- **The move rule replaces the wrong path in an invalid patch** (a `Move to:` after an `Add File:`).
  The Codex grammar allows `Move to:` only after `Update File:`, so a tool enforcing it reports an error and the result is never recorded; a lax tool would get its last added path replaced, which is unverified against real tools and accepted as a residual.
- **The complexity gate moves.**
  Measured passing at planning time; step 2 re-runs it before committing.

## Open Questions

None.
