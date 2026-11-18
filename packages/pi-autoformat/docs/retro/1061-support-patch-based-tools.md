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

### Real-world verification

After the decision, two one-time end-to-end runs exercised the PR branch (`9c3c9183`) against real third-party patch tools; no automated acceptance test is wanted.

#### Patch tools in the ecosystem

Pi registers no `apply_patch` itself.
These npm packages do, ranked by last-month downloads from `api.npmjs.org`; the field name was read from each published tarball.

| Package                                 | Downloads/month | Patch field                                                         |
| --------------------------------------- | --------------- | ------------------------------------------------------------------- |
| `@howaboua/pi-codex-conversion`         | 30908           | `input` (`prepareArguments` folds `patch`/`patchText` into `input`) |
| `@maxiaochao/pi-toolkit` (`codex-edit`) | 13634           | `patch`                                                             |
| `pi-openai-codex-compat`                | 3589            | `patch`                                                             |
| `@d3ara1n/pi-apply-patch`               | 2863            | `input`                                                             |
| `pi-apply-patch`                        | 221             | `input`                                                             |

The field name varies, which supports a configurable `patchField` over a hardcoded handler; the docs example should show both `input` and `patch`.
None of the four inspected packages emit on `autoformat:touched`.
`@howaboua/pi-codex-conversion` returns `isError: true` on a `partial_failure`, so pi-autoformat skips a partly applied patch; document that limit.

#### Method

- Each run used a fresh temp git repo with `src/greet.ts`, `src/legacy.ts`, and `src/util.ts`, and a project pi-autoformat config chaining `.ts` to a recorder formatter that logs its arguments and exits 1 when a file is missing, as a real formatter does.
- Invocation: `pi -p --no-session --no-extensions -e <capture> -e <PR pi-autoformat> -e <patch package> --tools read,apply_patch --model radius/gpt-6-luna` (Pi 1.5.2), so only the PR copy of pi-autoformat and the patch package sat between the model and the files.
- A capture extension logged every `tool_result` input exactly as pi-autoformat receives it.
- The prompt directed one `apply_patch` call that updates `src/greet.ts`, adds `src/farewell.ts`, deletes `src/legacy.ts`, and moves `src/util.ts` to `src/lib/util.ts` with an edit.
- `@howaboua/pi-codex-conversion` needed a project `.pi/pi-codex-conversion.json` with `scope.allProviders: "extras"` and `tools.applyPatchOnly: true` (plus `--approve`), because its default scope only activates for Codex-like models and the `radius` provider does not match.
- n = 1 per package, one model, directed prompt; this confirms the mechanism, not a rate.

#### Results

| Run | Package                         | `tool_result` input key | Paths handed to the formatter                         | Outcome                                                          |
| --- | ------------------------------- | ----------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | `@d3ara1n/pi-apply-patch@0.9.0` | `input`                 | `greet.ts`, `farewell.ts`, `legacy.ts`, `lib/util.ts` | `legacy.ts` missing, whole batch reported as a formatter failure |
| 2   | `@howaboua/pi-codex-conversion` | `input`                 | `greet.ts`, `farewell.ts`, `legacy.ts`, `lib/util.ts` | Same failure                                                     |

- Both runs confirm the deleted-path defect end to end: one missing path fails the single formatter invocation for the whole batch, so the files that did change are reported as failed too.
- The failure also cost model turns: after the warning the model issued 3 more `read` calls in run 1 and 5 in run 2 to investigate.
- The move destination (`src/lib/util.ts`) was resolved correctly, and the move source never reached the formatter.
- The agreed header scan, without deleted paths, yields `src/greet.ts`, `src/farewell.ts`, `src/lib/util.ts` for this patch, which is the correct set.

Both runs produced this model-written patch, an organic fixture for the plan's tests:

```text
*** Begin Patch
*** Update File: src/greet.ts
@@
 export function greet(name: string): string {
-  return "Hello, " + name;
+  return `Hello, ${name}`;
 }
*** Add File: src/farewell.ts
+export function farewell(name: string): string {
+  return `Goodbye, ${name}`;
+}
*** Delete File: src/legacy.ts
*** Update File: src/util.ts
*** Move to: src/lib/util.ts
@@
 export function add(a: number, b: number): number {
   return a + b;
 }
+
+export function subtract(a: number, b: number): number {
+  return a - b;
+}
*** End Patch
```

The operator's agents run Claude, and an evaluation of adopting a patch tool locally found it not worth it for Anthropic models: `pi-permission-system`'s `PATH_BEARING_TOOLS` (`src/access-intent/path-surfaces.ts`) excludes `apply_patch`, so path rules would not see patched files.
That is out of scope for #1061 but is the gap to file if GPT-driven agents ever adopt a patch tool here.

## Stage: Planning (2026-11-18T06:33:18Z)

### Session summary

Wrote `packages/pi-autoformat/docs/plans/1061-support-patch-based-tools.md`: three steps (patch-path extraction as `refactor:`, loader + schema acceptance as `feat:`, `docs/configuration.md` as `docs:`), each carrying the `Co-authored-by: Michael Mior` trailer.
The PR Review stage had already settled direction, so the Decide gate was satisfied without a new `ask_user`.

### Observations

- The open question from the PR review is now measured: a minimal spike of the planned design on a scratch worktree passed `pnpm fallow audit --base origin/main` (exit 0); `validateCustomMutationToolEntry` grows from 22/39 to 26/46 cyclomatic/cognitive but counts as an inherited finding, and the new scan is not flagged.
  The PR's wide config-loader restructuring is therefore not needed.
  The 2026-10-18 triage recorded the PR's first head red on CRAP 148.4 for its stateful `extractPathsFromPatch`; the stateless scan avoids that.
- Every edge-case row in the plan, and the four killing mutations in step 1, were run through the spike; each mutation killed exactly its named case.
- Lines are deliberately not trimmed before header matching, so a context line quoting a header cannot match; the cost is missing headers a tool emits indented (residual in Risks).
- The schema's existing `not` clauses are redundant under `oneOf`; the plan collapses it to three required-only branches.
- The Tidy-First assessor recommended no preparatory commits; it rated a shared non-empty-string helper optional (two call sites, eight similar sites elsewhere invite scope creep) and noted the existing both/neither tests assert only issue paths, so step 2 asserts the new exclusivity message explicitly.
- `pi-autoformat` reflow trims a meaningful leading space inside a code span; the plan states it in prose instead.

## Stage: Implementation — TDD (2026-11-18T06:46:49Z)

### Session summary

Implemented all three plan steps: patch-path extraction (`refactor(pi-autoformat): extract file paths from Codex-style patch input`), loader and schema acceptance (`feat(pi-autoformat): format files changed by patch-based tools via customMutationTools patchField`), and `docs/configuration.md`, plus one `style:` fixup. pi-autoformat tests went from 307 to 321; every gate (`check`, root `lint`, `test`, `fallow dead-code`, `fallow audit --base origin/main`) is green.

### Observations

- Two new tests stayed green during Red and were tightened or checked by mutation: the empty/non-string `patchField` test passed pre-feature because today's "Unknown property." issue lands on the same `.patchField` path, so it now asserts the full issue including "Expected a non-empty string."; the delete-only case is killed by the delete-header mutation.
- All planned mutations killed their predicted tests; an extra substring-match mutation (`line.includes(prefix)`) was added to pin the added-line-quotes-a-header case, which no planned mutation covered.
  The count-only-path-keys mutation also kills the acceptance test (a `patchField`-only entry counts zero settings), one more than the plan named.
- `fallow audit` measured as at planning: `validateCustomMutationToolEntry` 26 cyclomatic / 46 cognitive, inherited, exit 0.
- Deviation: the model-written fixture quotes TypeScript template literals, which Biome's `noTemplateCurlyInString` reports at warning level (exit 0, so only a warning count caught it); fixed with two reasoned `biome-ignore` comments in a separate `style:` commit, since the latest feat commit was no longer `HEAD`.
- The docs name the `patch` field variant in prose and show only `input` in the JSON example.

#### Reviewer warnings

Pre-completion reviewer: WARN.

- A `*** Move to:` line overwrites the last queued path regardless of what precedes it, so grammar-invalid sequences (`Update a.ts` / `Delete c.ts` / `Move to: d.ts`, or two consecutive moves) lose or replace a path; no test pins them.
  Every case needs a patch the Codex grammar rejects, so a tool enforcing it reports an error and the result is never recorded; this extends the plan's accepted move residual and was left unfixed.
  The reviewer's suggested fix, if wanted, is to apply a move only when the previous line was an `*** Update File:` header.
- The `style:` fixup commit carries no `Co-authored-by:` trailer; it touches only the captured fixture, not the contributor's design.

## Stage: Final Retrospective (2026-11-18T07:00:02Z)

### Session summary

One process ran PR review, planning, TDD, ship, and retro for #1061: PR #1072 was triaged to adopt-with-simplified-design, the plan landed three steps (`refactor:`, `feat:`, `docs:`) plus a `style:` fixup, and `pi-autoformat` 5.2.0 shipped with #1061 and PR #1072 closed.
The design's two departures from the PR (skip deleted paths, header scan instead of grammar validation) both came from evidence gathered in the session, and the deleted-path defect was confirmed end to end against two real `apply_patch` packages before the plan existed.

### Observations

#### What went well

- Real-tool probes became design input and test data.
  A capture extension logged `tool_result` inputs while `pi -p --no-session --no-extensions -e <capture> -e <pi-autoformat> -e <patch package> --tools read,apply_patch --model radius/gpt-6-luna` ran in a temp repo whose formatter was a recorder that fails on missing files.
  It reproduced the PR's deleted-path defect, measured its cost (3 and 5 follow-up `read` calls by the model), captured the model-written patch that became the unit-test fixture, and at ship time confirmed the fix end to end (exactly three files, no follow-up reads).
- Uncertainty handed forward as a measurement, not a claim: the PR review recorded "likely only `validateCustomMutationToolEntry`" for the complexity gate as unverified, and planning measured it on a scratch-worktree spike (`fallow audit` exit 0, 22/39 → 26/46, inherited), which removed the PR's 300-line `config-loader.ts` restructuring from scope.
- Every edge-case row and killing mutation was run through the planning spike, so the TDD stage's mutation battery (`/tmp/mutate.mjs`, single-match assertion per pattern) reproduced the plan's predictions exactly.
- The `git-workflow` skill's warning-count rule caught two `noTemplateCurlyInString` warnings that `pnpm run lint` exit 0 hid.

#### What caused friction (agent side)

- `instruction-violation` — Ship stage, on `anthropic/claude-sonnet-5-5`: three consecutive `ask_user` calls were rejected for having no visible text, each re-sent bare, before falling back to a plain-text question.
  The `clarification-gates` skill (loaded earlier in the same process) says a rejected call is re-sent with its substance in full.
  Self-identified after the third rejection.
  Impact: three wasted calls; the plain-text gate then worked.
- `instruction-violation` — PR Review gate: the parser-strictness question carried a one-line option each and no briefing of its own, so the operator answered "Please provide more information".
  User-caught.
  Impact: one extra round trip; the follow-up briefing produced a clean decision.
- `missing-context` — Asked implicitly whether the operator had model access for a live test ("You don't need a Codex plan…") without first running `pi --list-models`, which lists `radius/gpt-*` models.
  The operator supplied it.
  Impact: one round trip.
- `instruction-violation` — A PR-branch spike test printed its result with `console.log` under Vitest's default reporter, which hides it (`testing` skill), and the `grep` filter showed nothing.
  Self-identified.
  Impact: two extra tool calls, rewritten as an assertion.
- `other` — The refactor commit used `git commit -q -F - <<'EOF'`, the spelling `AGENTS.md` names as a `pi-permission-system` deny rule.
  The review log shows no event at all for it (commit at 06:39:04Z): the rule did not fire, and no approval prompt fired either.
  This is #941 (a heredoc absorbs the `-` operand, so the command enumerates as `git commit -F`), still open.
  Impact: none on this issue; the tripwire is silently inert for its own target spelling.

#### What caused friction (user side)

- The operator's mid-probe pivot ("would a dedicated patch tool help my agents?") and the late disclosure of Radius GPT access both redirected work productively; surfacing model access when the live test was first raised would have saved one round trip.
- Four `/tmp` probe commands needed operator approval dialogs (`external_directory`); mechanical oversight the probes could avoid by running under a repo-ignored scratch directory.

### Diagnostic details

- **Model-performance correlation** — PR review, planning, and TDD ran on `anthropic/claude-opus-5-5`; the ship stage switched to `anthropic/claude-sonnet-5-5` and produced the only repeated-error sequence (the three bare `ask_user` calls), then the operator switched back to Opus for the live run.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5-5`, which fit: the reviewer's own-input enumeration found the `Move to:` overwrite cases the plan had not tested.
- **Feedback-loop gap analysis** — Verification ran incrementally: per-step Vitest plus `pnpm run check`, mutation battery before each commit, `fallow audit` before the `feat:` commit; root `lint` ran only at the end, which is where the warning-level Biome finding surfaced and forced a separate `style:` commit instead of folding into step 1.

### Changes made

1. `.pi/skills/reproduction/SKILL.md` — new `## Probing a third-party Pi tool` section: the isolated `pi -p --no-extensions` probe shape, and run `pi --list-models` before claiming a probe needs an account or model family.
2. Commented on #941 (issuecomment-6971579752): the `git commit*-F -*` deny rule did not fire for this session's heredoc commit, and no approval prompt fired either, so the rule's rationale may be gone (one observation).
3. Declined: filing a follow-up for the `*** Move to:` overwrite warning; it stays an accepted residual recorded in the TDD stage.
