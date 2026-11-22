---
issue: 928
issue_title: "MCP permission targets: prefix-named tools derive no server; proxy-shaped MCP clients are invisible to the mcp surface"
---

# Honor last-match-wins on the `mcp` surface and derive the server for prefix-named tools

## Release Recommendation

**Release:** ship independently

#928 appears in no step of `docs/architecture/architecture.md`, so it carries no `Release:` tag and belongs to no batch.
It is a fail-open fix in the `mcp` surface with no dependency on an unshipped sibling.

## Problem Statement

The `mcp` permission surface does not honor the package's own documented rule policy, and it cannot see the server a prefix-named tool belongs to.
Two independent causes produce one symptom — a configured rule that silently never fires.

1. **Candidate short-circuit overrides last-match-wins.**
   `README.md:134` states the contract: "Within a surface map like `bash` or `mcp`, **last matching rule wins** — put broad catch-alls first and specific overrides after."
   `evaluateFirst` (`src/policy/rule.ts:231`) returns at the first *candidate* matching any config-layer rule, then applies last-match-wins within that one candidate.
   So a user-written `mcp` catch-all is matched by candidate[0] and every later candidate is never evaluated.
   `mcp` is the only surface with a multi-candidate list, so it is the only surface where this happens.
2. **Prefix-named tools derive no server.**
   `addDerivedMcpServerTargets` (`src/access-intent/mcp-targets.ts:54`) requires a suffix match and then explicitly `continue`s on a prefix match, so `github_search_code` — the shape the `mcp()` proxy and mcp-combiner both produce — yields no bare `github` candidate at all.

The package's own documented example in `docs/configuration.md:510` does not work because of cause 1, independently of cause 2.
Measured on `main` through the real `PermissionManager`:

| Call against the documented config          | `main`                 | after this change          |
| ------------------------------------------- | ---------------------- | -------------------------- |
| `{}` (status)                               | allow via `mcp_status` | allow via `mcp_status`     |
| `{server: "myServer"}` (list)               | **ask via `*`**        | allow via `mcp_list`       |
| `{tool: "dangerousServer_wipe"}`            | **ask via `*`**        | deny via `dangerousServer` |
| `{tool: "wipe", server: "dangerousServer"}` | **ask via `*`**        | deny via `dangerousServer` |

The last row already emits a bare `dangerousServer` candidate on `main` and still fails: a documented `deny` masked by the catch-all above it.

## Goals

- Honor last-match-wins on the `mcp` surface: rule position decides, not candidate position.
- Collapse the two evaluators to one — `evaluateAnyValue` — and delete `evaluateFirst`.
- Derive the bare server for prefix-named MCP tools, longest match only, with the longest-match invariant owned by the deriving function rather than by its caller's sort order.
- Stop emitting re-prefixed candidates that can match nothing when an explicit `server` accompanies an already-prefixed tool name.
- Order candidates tool-name-first for the new prefix case, so the ask prompt and review log name the tool being called.
- Publish the derivation rules and the rule-shape guidance in `docs/configuration.md`.

**This change is breaking.**
It alters permission decisions on upgrade with no user config edit, in both directions.
A `mcp: {"*": "allow", "github": "deny"}` config starts denying (a fail-open closes); a `mcp: {"*": "deny", "github": "allow"}` config starts allowing (a loosening).
Both are the answers last-match-wins already specifies, but neither is today's behavior.
Commit messages use `fix!:` / `feat!:` with a `BREAKING CHANGE:` footer.

## Non-Goals

- **Gap 2 of #928** — routing arbitrary proxy tool names to the `mcp` surface (`registerMcpProxy`, PR #930).
  Tracked separately as [#946]; #928 closes on gap 1 alone.
- Removing the literal `"mcp"` special case from `classifyToolKind`.
- The operation-scoped `mcp` config schema proposed in #687.
  This plan fixes #687's stated problem 1 at the matcher; its problem 2 (discoverability of the synthetic `mcp_*` target names) is untouched and stays with that issue.
- Changing where the MCP server list comes from.
  It is read only from `~/.pi/agent/mcp.json` (`defaultGlobalMcpConfigPath`, `src/config/policy-loader.ts:112`), which is `pi-mcp-adapter`'s file rather than a Pi core file, so derivation helps only users of that adapter's config location.
  Widening the source is out of scope.
- `src/policy/synthesize.ts` — predicted unchanged.
  The claim: baseline rules sit *before* config rules in `composeRuleset`, and their `mcp_*` patterns match only late candidates, so under `evaluateAnyValue` any config rule matching any candidate already outranks them, exactly as it did under `evaluateFirst`.
  Measured: baseline outcomes are identical in all 22 baseline-armed matrix rows, though the *attribution* changes in two (see Invariants at risk).
- `src/exposure/` — predicted unchanged.
  `isSurfaceFullyDenied` probes each configured pattern through `evaluate` directly and never calls either multi-value evaluator.

## Background

### Relevant modules

- `src/policy/rule.ts` — `evaluate` (last-match-wins over one value, `findLast`), `evaluateFirst` (first-non-default across candidates), `evaluateAnyValue` (last-match-wins across candidates), `evaluateMostRestrictive`, `isSurfaceFullyDenied`.
- `src/policy/permission-manager.ts` — `buildCheckResult` (line 363) selects the evaluator on `PATH_SURFACES` membership; `check` feeds it from both the `tool` and `path-values` branches.
- `src/access-intent/input-normalizer.ts` — `normalizeInput` produces `{ surface, values, resultExtras }`.
- `src/access-intent/mcp-targets.ts` — `McpTargetList`, `parseQualifiedMcpToolName`, `addDerivedMcpServerTargets`, `pushMcpToolPermissionTargets`, `createMcpPermissionTargets`.
- `src/config/policy-loader.ts` — `getConfiguredMcpServerNamesFromPaths` sorts the server list longest-first before returning it.

### Why one evaluator suffices

`normalizeInput`'s `switch` is exhaustive over `ToolKind` and gives every non-`mcp` arm a **single-element** `values` array — `skill` → `[lookupValue]`, `bash` → `[matchValue]`, `path` and `extension` → `["*"]`.
For a single-element array the two evaluators provably agree: `evaluateFirst` skips a `layer: "default"` match and then falls back to `evaluate(values[0])`, which returns that same default rule.
The `path-values` branch of `check` passes multiple values, but every surface it can name is in `PATH_SURFACES` and already routes to `evaluateAnyValue`.

So `mcp` is the only surface where the two differ, and deleting `evaluateFirst` is behavior-preserving everywhere else.
This licenses removing the discriminator rather than widening it to `PATH_SURFACES.has(surface) || surface === "mcp"`, which would leave a second evaluator alive with only degenerate callers.

### Archaeology

`evaluateFirst` was introduced in `55029597` (2026-05-04) as a step of #81, whose plan (`docs/plans/0081-unify-checkpermission-surface-branching.md`) declares "Pure refactor: no change to permission decisions" and lists changing decision output as a Non-Goal.
It is a verbatim lift of the pre-#81 MCP branch's loop (`git show 55029597^:src/permission-manager.ts`, lines 575–578).
It was never a designed matching policy and has no ADR.
`evaluateAnyValue` arrived five weeks later (`2b7d2409`, #393) to fix the same masking, discovered first on path aliases; that plan's Non-Goals recorded "MCP keeps `evaluateFirst` (its candidates are genuinely different targets, not aliases of one path)" — a distinction that does not survive contact with the documented config above, where the masked candidates are different targets and the mask is still wrong.

### Constraints from AGENTS.md and the package skill

- Default to least privilege; a configured `deny` that does not fire is the defect class this fixes.
- Keep config files the source of truth; prefer config patterns over new runtime mechanisms.
- `*` already crosses directory boundaries; write `~/dev/*`, never `~/dev/**`.
- Treat any declared config field not read at runtime as a maintenance trap.

## Design Overview

### One evaluator

`buildCheckResult` loses its ternary:

```ts
const { rule, value } = evaluateAnyValue(surface, values, fullRules, flavor);
```

`PATH_SURFACES` is then unused in `permission-manager.ts` and is trimmed from the existing multi-name import (its sibling `surfaceFamilyOf` is still used at line 435, so the import statement survives).
`evaluateFirst` is deleted from `rule.ts`.

The semantic this establishes, stated once for the docs: **a rule's position in the config decides, and the candidate list decides only which name the decision is reported under.**
`PermissionCheckResult.target` remains the matched candidate (`permission-manager.ts:380`); `evaluateAnyValue` picks the first candidate the winning rule matches.

### Longest-prefix derivation owns its own invariant

```ts
function findLongestPrefixServer(
  toolName: string,
  configuredServerNames: readonly string[],
): string | null;
```

It scans for the longest configured server that is the leading `<server>_` segment of the tool name, independent of the order it is handed.
Today's `addDerivedMcpServerTargets` has no early exit at all, so a suffix match against several configured servers adds three candidates for **each** of them; the caller's longest-first sort is never consulted to pick a winner.
Putting the selection in the callee means the function is correct for any caller, including `PolicyLoaderOptions.mcpServerNames`, which does not sort.

A prefix hit adds the tool name first, then the bare server, and returns — suppressing suffix coincidence, so `foo_bar_baz_github` with `["foo_bar", "github"]` derives `foo_bar` and never `github`.
One naming convention per name.

Candidate list for `github_search_code` with `github` configured, before and after:

```text
main:   ["github_search_code", "mcp_call", "mcp"]
after:  ["github_search_code", "github", "mcp_call", "mcp"]
```

Tool-name-first matches what `main` already produces for a qualified name or an explicit `server` — `["github_search_code", "github:search_code", "github", "search_code", "mcp_call"]`, server-qualified forms first, bare server third.
A prefix-named tool *is* that candidate[0] form.
Under one evaluator this ordering no longer affects any decision; it decides only the reported `target`, and naming the tool is strictly more informative than naming its server.

### No redundant re-prefixing

`pushMcpToolPermissionTargets` guards the explicit-`server` branch:

```ts
if (!resolvedTool.startsWith(`${resolvedServer}_`)) {
  targets.add(`${resolvedServer}_${resolvedTool}`);
  targets.add(`${resolvedServer}:${resolvedTool}`);
}
targets.add(resolvedServer);
```

`{ tool: "github_search_code", server: "github" }` today produces `github_github_search_code` and `github:github_search_code` as candidates 0 and 1 — strings no rule can usefully name, which also become the reported `target` when nothing matches.

### The derivation is heuristic, and the docs must say so

A configured server `git` attaches to `git_lab_issues` from a different server (measured: candidates `["git_lab_issues", "git", "mcp_call"]`).
Longest-match narrows this only when both servers are configured.
This is a fail-open when the matching rule is `allow`, and it is inherent to deriving identity from a name; `docs/configuration.md` states the limit and recommends an explicit `server` argument or a qualified `server:tool` name where the distinction matters.

## Module-Level Changes

### Source

- `src/policy/rule.ts` — delete `evaluateFirst` (lines 220–249, including its doc comment).
  Reword `evaluateAnyValue`'s doc comment, which opens "Unlike `evaluateFirst()`" (line 254), to state its contract without the removed sibling.
- `src/policy/permission-manager.ts` — `buildCheckResult` calls `evaluateAnyValue` unconditionally; drop the `evaluateFirst` import (line 32) and the `PATH_SURFACES` name from the import at lines 4–7; update the doc comment at line 360, which currently says "every other surface keeps `evaluateFirst`".
- `src/access-intent/mcp-targets.ts` — add private `findLongestPrefixServer`; rewrite `addDerivedMcpServerTargets` to take the prefix branch first (tool name, then server, then return) and fall through to the unchanged suffix loop; add the `startsWith` guard in `pushMcpToolPermissionTargets`; update the doc comment at line 111, which names `evaluateFirst`.
- `src/access-intent/input-normalizer.ts` — doc comment at line 105 says "feed a single `evaluateFirst()` call"; update the name.
  No code change.

### Tests

- `test/policy/rule.test.ts` — delete `describe("evaluateFirst")` (line 480, seven cases) and the `evaluateFirst` import (line 7).
  The cases that express a still-live behavior (empty candidate list, default-layer fallback) are re-expressed against `evaluateAnyValue` rather than dropped.
- `test/access-intent/input-normalizer.test.ts` — new: every non-`mcp` `ToolKind` yields exactly one candidate.
- `test/access-intent/mcp-targets.test.ts` — new prefix-derivation cases; existing suffix cases unchanged.
- `test/policy/permission-manager-unified.test.ts` — new end-to-end matcher cases, including the documented-config regression.

### Docs

- `docs/configuration.md` — under the `mcp` surface section (line ~500): a derivation walkthrough (qualified → longest prefix → suffix), a which-rule-shape-to-write table, the statement that rule position decides, and the heuristic's fail-open limit.
  The existing example at line 510 keeps its text — it starts working — but gains a sentence naming what each rule now does.
- `docs/architecture/architecture.md:481` — "`checkPermission()` uses a single evaluate path: `normalizeInput()` → `evaluateFirst()` → `deriveSource()`" names the deleted function.
  The module listing at line 852 describes `rule.ts` without naming `evaluateFirst` and needs no edit.
- `README.md:134` already states last-match-wins for the `mcp` surface and becomes true; predicted unchanged.
- `.pi/skills/package-pi-permission-system/SKILL.md` — grep for `evaluateFirst` returns zero hits; predicted unchanged.

### Predicted-unchanged files in the blast radius

| File                                    | Claim                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `src/policy/synthesize.ts`              | Baseline rules precede config rules and match only late candidates, so a config rule already outranks them under either evaluator. |
| `src/exposure/tool-surface-baseline.ts` | `isSurfaceFullyDenied` calls `evaluate` per pattern, never a multi-value evaluator.                                                |
| `src/service/permissions-service.ts`    | Routes through `PermissionResolver`/`PermissionManager.check`; inherits the change with no edit.                                   |
| `src/handlers/gates/*`                  | Consume `PermissionCheckResult`; its shape is unchanged.                                                                           |

## Test Impact Analysis

**What the change enables.**
Nothing was previously untestable; the gap is that nothing was tested.
Measured: the full suite is 165 files / 4413 tests on `main`, and applying both changes leaves it at 165 / 4413 **passing** — not one existing test discriminates the behavior being changed.
A 12-config × 11-input matrix through the real `PermissionManager` changes 37 of 132 rows under the same edit.
Every assertion below is therefore new coverage over a previously unpinned surface.

**What becomes redundant.**
`describe("evaluateFirst")` in `test/policy/rule.test.ts` (seven cases) tests a deleted function.
Two of its cases assert behavior `evaluateAnyValue` must also have — an empty candidate list falls back to `"*"`, and an all-default match returns the first candidate — and are re-expressed there rather than deleted.

**What must stay.**
The path-alias tests genuinely pin the evaluator and must keep passing untouched.
Measured by forcing the path branch onto `evaluateFirst`, which turns five red in two files:

- `test/policy/permission-manager-unified.test.ts` — "last-match-wins across the provided aliases", "preserves last-match-wins across the provided aliases", "keeps legacy relative path rules working after `configureForCwd`", "preserves last-match-wins across absolute and relative aliases".
- `test/handlers/external-directory-symlink-acceptance.test.ts` — "allows a path-bearing tool when the allow is keyed on the resolved path".

These are the regression net for the deletion: they already prove `evaluateAnyValue` is correct for a multi-candidate surface.

## Invariants at risk

- **Baseline discovery auto-allow** (`synthesizeBaseline`, `docs/configuration.md`: "Baseline discovery targets auto-allow when any explicit `mcp: allow` rule exists").
  Constituency: a user who grants one MCP server and expects discovery to stop prompting.
  The *action* is preserved in every measured row, but the **attribution changes** in two: with `mcp: {"github": "allow"}`, a describe of `github_search_code` was `allow via mcp_describe` (source `mcp`, baseline layer) and becomes `allow via github` once derivation supplies the server candidate.
  Same decision, different `matchedPattern` in the review log.
  Pinned by a new case asserting both the action and the pattern, so a future change that silently drops the baseline is visible.
- **Session approvals win.**
  `check` appends session rules to the end of `fullRules` (#81 step 1), so under `evaluateAnyValue` a session grant always outranks a config rule.
  Under `evaluateFirst` a session grant matching a *later* candidate lost to a config rule matching an earlier one — a grant the user gave that did not stick.
  This is a fix, not a regression, and it lives only in prose today; a new case pins it.
- **Position, not specificity.**
  `evaluateAnyValue` must not be mistaken for a specificity model.
  Control: `mcp: {"github": "deny", "*": "ask"}` — catch-all written last — stays `ask` for every call shape (measured, unchanged by this edit).
  Pinned as an explicit test so a later "make the specific rule win" change fails loudly.
- **Non-`mcp` surfaces are single-candidate.**
  This is the claim that licenses deleting `evaluateFirst`.
  It is structural (`normalizeInput`'s exhaustive `switch`) rather than empirical, so it is pinned directly rather than inferred from a green suite.

## TDD Order

The Tidy-First assessor read `rule.ts`, `permission-manager.ts`, `mcp-targets.ts`, and the four test files and recommended **no** preparatory refactorings: the deletion is a clean single-call-site removal with no shared helpers or exports to untangle, `buildCheckResult`'s signature is untouched by the edit, and both test files already nest unit-then-scenario behind a capable harness (`createManagerWithConfig`, `checkTool`), so the new cases drop in without a new fixture.
Its one correction to the design summary is folded in above: `addDerivedMcpServerTargets` has no early exit today, so the current defect is unbounded fan-out across every suffix-matching server, not merely a fragile dependence on the caller's sort order.

1. **Pin the single-candidate invariant.**
   Surface: `test/access-intent/input-normalizer.test.ts`.
   Assert `normalizeInput` returns exactly one candidate for a `skill` call, a `bash` call, a path-bearing tool, and an extension tool — and more than one for `mcp`.
   Killing mutation: make the `path`/`extension` arm return `["*", "mcp"]`; the new case must go red.
   Commit: `test: pin that only the mcp surface produces multiple permission candidates`

2. **Honor last-match-wins on the `mcp` surface.**
   Surface: `test/policy/permission-manager-unified.test.ts`, plus the deletions in `test/policy/rule.test.ts`.
   Red first — each of these fails on `main`:
   - the documented `docs/configuration.md` config: `{server: "myServer"}` allows via `mcp_list`, and `{tool: "wipe", server: "dangerousServer"}` denies via `dangerousServer`;
   - `mcp: {"*": "ask", "mcp_describe": "allow"}` — a describe allows via `mcp_describe` (#687's problem 1);
   - `mcp: {"*": "allow", "github": "deny"}` — a suffix-named, a qualified, and an explicit-`server` call all deny via `github`;
   - a session grant matching a late candidate wins over a config rule matching an earlier one.

   Green: `buildCheckResult` calls `evaluateAnyValue` unconditionally; delete `evaluateFirst`, its import, its `describe` block, and the `PATH_SURFACES` import name; re-express the two surviving `evaluateFirst` cases against `evaluateAnyValue`; update the four doc comments.
   Also add the control case (catch-all last stays `ask`) and the baseline-attribution case from Invariants at risk.
   Verify: the five path-alias tests named in Test Impact Analysis stay green.
   Killing mutation: restore the ternary so `mcp` routes to `evaluateFirst`; every new case except the control must go red.
   Commit: `fix!: honor last-match-wins for MCP rules instead of stopping at the first candidate`

3. **Derive the server for prefix-named tools.**
   Surface: `test/access-intent/mcp-targets.test.ts`.
   Red: a prefix-named tool with a configured server derives the bare server and keeps the tool name at `targets[0]`; an unconfigured server derives nothing; longest-match wins when the server list is passed **unsorted** (`["foo", "foo_bar"]` against `foo_bar_baz` → `foo_bar`, never `foo`); a prefix hit suppresses suffix coincidence (`foo_bar_baz_github` with `["foo_bar", "github"]`); existing suffix cases unchanged.
   Green: `findLongestPrefixServer` plus the prefix branch in `addDerivedMcpServerTargets`.
   Killing mutations, one per equivalence class:
   - make `findLongestPrefixServer` return the first match instead of the longest → the unsorted-list case goes red, and only that one;
   - delete the `targets.add(trimmedToolName)` that precedes the server add → the `targets[0]` ordering case goes red;
   - delete the early `return` after the prefix hit → the suffix-suppression case goes red.

   Commit: `feat!: apply MCP server rules to prefix-named tools such as github_search_code`

4. **Stop emitting re-prefixed candidates.**
   Surface: `test/access-intent/mcp-targets.test.ts`.
   Red: `{tool: "github_search_code", server: "github"}` produces neither `github_github_search_code` nor `github:github_search_code`, and reports `github_search_code` as its first candidate; `{tool: "search_code", server: "github"}` keeps both qualified forms.
   Green: the `startsWith` guard in `pushMcpToolPermissionTargets`.
   Killing mutation: remove the guard; the first case goes red and the second stays green.
   Commit: `fix: stop deriving unmatchable re-prefixed MCP candidates for already-qualified tool names`

5. **Document the derivation and the matching contract.**
   Surface: `docs/configuration.md`, `docs/architecture/architecture.md`.
   The derivation walkthrough, the rule-shape table, the statement that rule position decides, the heuristic's fail-open limit, and a sentence on the existing example naming what each of its rules now does; `architecture.md:481` loses the `evaluateFirst` reference.
   Verify: `pnpm exec rumdl check` on both files, and re-run the documented example's four calls as a test so the doc's claim is executable rather than asserted.
   Commit: `docs: describe how MCP tool names derive server and tool permission targets`

The `BREAKING CHANGE:` footer belongs on steps 2 and 3, naming both directions: a `deny` after a permissive catch-all begins to fire, and an `allow` after a restrictive one does too.

## Risks and Mitigations

- **A user's permissive config tightens on upgrade and breaks a working setup.**
  A `mcp: {"*": "allow", "github": "deny"}` config silently allowed everything and now denies github calls.
  This is the fail-open closing, so it is the intended direction, but it is a visible change.
  Mitigation: the `BREAKING CHANGE:` footer names it, and the `docs/configuration.md` note tells a user how to read their own config under the stated contract.
- **A user's restrictive config loosens on upgrade.**
  The mirror case, `mcp: {"*": "deny", "github": "allow"}`, begins allowing.
  This is the more dangerous direction for a permission system even though last-match-wins already specifies it.
  Mitigation: call it out first in the footer and in the docs, since a user who wrote the catch-all last (`{"github": "allow", "*": "deny"}`) is unaffected — measured — and that ordering is what the docs already recommend.
- **Derived server identity is a heuristic and can attach the wrong rule.**
  A configured `git` matches `git_lab_issues`.
  Mitigation: longest-match narrows it; the docs state the limit and point at an explicit `server` argument or a qualified name.
  Not mitigated in code — deriving identity from a name has no sound completion.
- **Deleting `evaluateFirst` rests on a claim about every non-`mcp` surface.**
  Mitigation: step 1 pins the claim directly rather than inferring it from a green suite, and the claim is structural (an exhaustive `switch`), so a new multi-candidate surface added later fails that test.
- **The green suite is not evidence here.**
  Measured: both changes together leave 4413/4413 passing.
  Mitigation: every step names a killing mutation, and step 2's is the whole point — restoring the ternary must turn the new cases red.

## Open Questions

- Should `mcp` eventually adopt `evaluateMostRestrictive` instead, so a `deny` on any candidate wins regardless of position?
  That is a different policy from last-match-wins and would contradict `README.md:134`; not proposed here.
  Deferred until a user reports the ordering as a footgun.
- #687's remaining problem 2 — the synthetic `mcp_*` target names are undiscoverable — is untouched.
  The docs added in step 5 partly address discoverability; whether the operation-scoped schema is still wanted is a question for that issue's reporter, asked on #687 in this session.

[#946]: https://github.com/gotgenes/pi-packages/issues/946
