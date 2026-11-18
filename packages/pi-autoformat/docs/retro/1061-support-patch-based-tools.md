---
issue: 1061
issue_title: "Support patch-based tools for pi-autoformat"
pr: 1072
---

# Retro: #1061 — Support patch-based tools for pi-autoformat

## Stage: PR Review (2026-11-18T06:16:19Z)

### Session summary

PR #1072 by @michaelmior adds a `patchField` option to `customMutationTools` so a Codex-style `apply_patch` tool, whose input is one patch string rather than a filename field, can feed paths into the touched-files queue.
The gap is real on current `main` and the capability fits the existing config surface, but the PR queues deleted paths, re-validates the patch grammar strictly, and carries roughly 300 lines of unrelated `config-loader.ts` restructuring.
The operator chose to adopt the capability with a simplified design, planned via `/plan-issue #1061`.

### Evaluation

#### Verify gate (against `main` at `30d39eb9`; PR base `98ee0a19` is an ancestor, 58 commits behind)

- Reproduced with a throwaway unit test: `validateUserFormatterConfig({ customMutationTools: [{ toolName: "apply_patch", patchField: "input" }] })` returns `customMutationTools[0].patchField: Unknown property.`, and the only workaround, `extractPathsFromInput({ input: patch }, { pathField: "input" })`, returns the whole patch body as a single "path".
- No existing mechanism covers it: `SnapshotTracker` in `src/extension.ts` only runs around `bash` tool calls, and the `autoformat:touched` event-bus channel requires the patch tool's own extension to emit.
- Pi itself registers no `apply_patch` tool (`grep` of `../pi/packages/coding-agent/src` finds none); it comes from third-party extensions.
  Both checked carry the patch in a single string parameter named `input`: npm `pi-apply-patch@0.1.1` (`src/tool.ts`, `applyPatchParameters`) and GitHub `code-yeongyu/pi-apply-patch` (`src/index.ts`, `APPLY_PATCH_PARAMS`).
- Does not reach us: neither `.pi/settings.json` nor the global settings load an `apply_patch` tool.

#### Checks on the PR branch (scratch worktree at `9c3c9183`)

- `pnpm run check`, `pnpm run lint`, and the pi-autoformat unit project (313 tests) all pass; fork CI run `40918791147` concluded `success`.
- The PR ships tests for the parser (`test/custom-mutation-tools.test.ts`) and the validator (`test/config-loader.test.ts`).

#### What is valuable

- The capability and its API shape: `patchField` as a third mutually exclusive option beside `pathField`/`pathFields` on `CustomMutationToolSpec`, with the schema `oneOf`, `docs/configuration.md`, and the loader kept aligned.
- The `*** Move to:` handling: the move destination replaces the preceding update path.
- The regression test that added content (`+*** Delete File: other.txt`) is not read as a header.

#### What to change

1. Deleted paths are queued (confirmed defect in the PR).
   `extractPathsFromPatch` returns `*** Delete File:` paths; a scratch test on the PR branch showed `TouchedFilesQueue.flush()` returning `["gone.ts", "kept.ts"]` for a patch that deletes `gone.ts`.
   Nothing downstream filters missing files (`touched-files-queue.ts`, `prompt-autoformatter.ts` `flushPrompt`; `isInFormatScope` deliberately keeps nonexistent paths), so the formatter would be run on a file that no longer exists and report a failure.
2. The strict grammar validator (`consumePatchLine`, `consumePatchMove`, `isPatchBodyLine`, `PatchState`, about 85 lines) is the wrong burden of proof.
   The handler only sees successful `tool_result` events (`if (event.isError) return;` in `src/extension.ts`), so the tool has already accepted the patch; a stricter re-validation can only turn an accepted variant into a silent miss, never prevent a bad edit.
   The `*** Environment ID:` special case is speculative.
   Replace with a stateless header scan: collect `*** Add File:` and `*** Update File:` paths, let `*** Move to:` replace the last update path, ignore everything else; hunk content lines always begin with `+`, `-`, or a space, so they cannot match a header prefix.
3. Unrelated `config-loader.ts` churn.
   The PR restructures `validateConfigObject`, `validateShellMutationDetection`, `validateFormatterDefinition`, `validateFallbackStep`, `validateChains`, and `validateFormatterOutput` in the same commit; it reads as behavior-preserving but is outside the feature.
   The contributor cites CI complexity failures.
   A probe (`fallow audit --base origin/main` after a trivial edit to `config-loader.ts`) reported "audit gate excluded 7 inherited findings" and passed, so the gate appears to fire only on functions the change makes more complex, most likely only `validateCustomMutationToolEntry`.
   That is inferred, not re-measured against a minimal implementation: the plan should restructure that one validator as a `refactor:` step ahead of the feature (tidy first) and confirm the audit result.

#### Behavior and breaking

Additive and opt-in: a new optional config key, no default change, no change for existing `pathField`/`pathFields` entries.
A `feat(pi-autoformat):` commit, not breaking.

### Decision and attribution

Direction: adopt the capability with a simplified design; PR #1072 is reference, not merge target.

Agreed scope:

- Add `patchField` to `CustomMutationToolSpec`, the config loader's exactly-one-of check, the JSON schema, and `docs/configuration.md` (document the `pi-apply-patch` example as `{ "toolName": "apply_patch", "patchField": "input" }`).
- Extract paths with a lenient header scan (operator choice: header scan over strict grammar validation).
- Exclude `*** Delete File:` paths from the queue (operator choice).
- Keep the PR's move-destination behavior and its "added content is not a header" regression test.
- Restructure only `validateCustomMutationToolEntry` as a preparatory `refactor:` commit if the complexity gate requires it.

Non-goals: the PR's restructuring of the other config-loader validators; `*** Environment ID:` handling; built-in zero-config recognition of a tool named `apply_patch`.

Attribution: every implementation and docs commit ends with the trailer below (final paragraph, after `Refs #1061` / `Refs #1072`), and the ship-stage close comment on PR #1072 thanks @michaelmior by name and links the implementing SHAs.

```text
Co-authored-by: Michael Mior <michael@onechronos.com>
```
