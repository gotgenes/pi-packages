---
issue: 148
issue_title: "Cross-cutting path permission surface"
---

# Cross-cutting `path` permission surface

## Problem Statement

Path-level permission rules are fragmented across surfaces:

- Per-tool path patterns (#147, shipped) deny `*.env` for `read`, but the user must repeat the rule for `write`, `edit`, `grep`, etc.
- `external_directory` gates paths outside CWD, but cannot deny specific in-CWD paths like `.env`.
- Bash has no path-level restriction at all — `cat .env` bypasses any `read`-level `.env` deny.

There is no single place to say "no tool — built-in or bash — may access `.env` files."

## Goals

- Add a `path` permission surface whose rules apply to all file access (Pi tools and bash).
- Use the existing `evaluate()` function — same last-match-wins semantics, no new evaluation model.
- Broaden the bash token extraction filter to accept relative paths (dot-files, `/`-containing tokens).
- Compose cleanly with `external_directory` and per-tool path patterns: most restrictive wins.
- Update schema, example config, README, and architecture docs.

## Non-Goals

- Replacing `external_directory` — it remains the CWD-boundary check.
  `path` is the pattern-level policy.
- Replacing per-tool path patterns (#147) — they remain for tool-specific overrides (e.g., allow reads of `.env` but deny writes).
- Additive or nested command × path evaluation — the original #148 design, deferred due to complexity.
- Extending `PATTERN_FIRST_COMMANDS` with additional commands — follow-up refinement.
- Path normalization/resolution for rule matching (see Open Questions).

## Background

### Permission surfaces involved

`path` (new) — a cross-cutting surface evaluated for every file access.

### How permission evaluation works today

`evaluate(surface, value, rules)` is the universal primitive.
It finds the last rule in the composed ruleset whose surface and pattern both wildcard-match, returning the action.
All surfaces use this same function.

### How per-tool path patterns work (#147)

`normalizeInput` for path-bearing tools returns `input.path` as the match value.
`evaluate("read", ".env", rules)` matches the file path against per-tool patterns.
This is per-tool — a `"read": { "*.env": "deny" }` rule does not affect `write`, `edit`, or `bash`.

### How `external_directory` works

Two gates extract paths and check whether they resolve outside CWD:

- `describeExternalDirectoryGate` — sync, for path-bearing tools (`input.path`).
- `describeBashExternalDirectoryGate` — async, for bash (tree-sitter extraction).

Both evaluate against `external_directory` rules via `checkPermission`.

### How bash path extraction works

`bash-path-extractor.ts` provides:

- A lazy tree-sitter parser (WASM, async init, singleton).
- `collectPathCandidateTokens(node, tokens)` — AST walker that extracts argument tokens, respects `PATTERN_FIRST_COMMANDS` to skip pattern arguments.
- `classifyTokenAsPathCandidate(token)` — strict filter: accepts `/...`, `~/...`, `..`-containing tokens only.
- `extractExternalPathsFromBashCommand(command, cwd)` — combines parsing, walking, classification, and CWD-outside filtering.

The AST walker is reusable.
The strict classification filter is the bottleneck — it rejects relative paths like `.env` and `src/.env`.

### `SPECIAL_PERMISSION_KEYS`

`external_directory` is in this set.
`normalizeInput` handles special keys by extracting `input.path` as the match value.
Adding `"path"` to this set gives it the same treatment for free.

## Design Overview

### Config syntax

```jsonc
{
  "permission": {
    "path": {
      "*": "allow",
      "*.env": "deny",
      "*.env.*": "deny",
      "*.env.example": "allow",
      "~/.ssh/*": "deny"
    },
    "external_directory": "ask",
    "bash": { "*": "ask", "git *": "allow" },
    "read": "allow",
    "write": "ask"
  }
}
```

One configuration protects `.env` from `read`, `write`, `edit`, `grep`, `bash`, `cat` — everything.
The `path` surface is a standard permission map — same format as every other surface.

### Composition model

Four orthogonal layers, most restrictive wins:

| Layer                    | Question                                | Applies to       |
| ------------------------ | --------------------------------------- | ---------------- |
| `path` (new)             | Is this specific path pattern allowed?  | All tools + bash |
| `external_directory`     | Is accessing outside CWD ok?            | All tools + bash |
| Per-tool patterns (#147) | Is this path ok for this specific tool? | Individual tools |
| `bash` command patterns  | Is this command ok?                     | Bash only        |

A `path` deny cannot be overridden by a per-tool allow.
This is consistent with AGENTS.md's "default to least privilege."

### Evaluation for Pi tools

For path-bearing tools (`read`, `write`, `edit`, `find`, `grep`, `ls`), a new gate:

1. Extracts `input.path` via `getPathBearingToolPath()` (existing helper).
2. Calls `checkPermission("path", { path: filePath }, agentName, sessionRules)`.
3. If the result is `deny` or `ask`, returns a `GateDescriptor`.
4. If `allow`, returns `null` (no restriction from the `path` layer).

This runs alongside the existing external-directory and tool gates.
The most restrictive result across all gates determines the outcome.

### Evaluation for bash

A new async gate:

1. Extracts argument tokens from the bash command using tree-sitter (reuses the shared parser).
2. Applies a broader token filter (accepts dot-files and `/`-containing tokens).
3. Evaluates each token: `evaluate("path", token, fullRules)`.
4. Returns the most restrictive result across all tokens (deny > ask > allow).

When no tokens are extracted, the gate returns `null` (no path restriction).

### Most-restrictive evaluation across tokens

New helper function — not a new evaluation model, just an aggregation over multiple `evaluate()` calls:

```typescript
function evaluateMostRestrictive(
  surface: string,
  values: string[],
  rules: Ruleset,
): { rule: Rule; value: string } | null {
  let worst: { rule: Rule; value: string } | null = null;
  for (const value of values) {
    const rule = evaluate(surface, value, rules);
    if (rule.action === "deny") return { rule, value };
    if (rule.action === "ask" && worst?.rule.action !== "ask") {
      worst = { rule, value };
    }
  }
  return worst;
}
```

Returns `null` when all tokens evaluate to `allow` (no restriction).
Returns the first `deny` immediately (short-circuit).
Returns the first `ask` if no `deny` is found.

### Broadened token extraction

A new function `extractTokensForPathRules(command)` in `bash-path-extractor.ts`:

1. Parses the command with the shared tree-sitter parser.
2. Walks the AST with the existing `collectPathCandidateTokens` walker.
3. Applies a broader filter than `classifyTokenAsPathCandidate`:
   - Same rejections: empty, flags, env assignments, URLs, `@scope/package`, bare-slash, regex metacharacters.
   - Accepts: tokens starting with `.` (dot-files: `.env`, `./src`) or containing `/` (paths: `src/foo.ts`).
   - Does NOT require the existing "must start with `/` or `~/` or contain `..`" gate.
4. Returns the filtered tokens.

The existing `extractExternalPathsFromBashCommand` and `classifyTokenAsPathCandidate` remain unchanged.

### `normalizeInput` integration

Add `"path"` to `SPECIAL_PERMISSION_KEYS`.
`normalizeInput("path", { path: ".env" })` then returns `{ surface: "path", values: [".env"], resultExtras: {} }` — the same treatment `external_directory` gets.

### `getToolPermission` for `path`

`getToolPermission("path")` evaluates `evaluate("path", "*", composedRules)`.
With `"path": { "*": "allow", "*.env": "deny" }`, the catch-all `"*" → allow` is at index 0, `"*.env" → deny` is at index 1.
`evaluate("path", "*", rules)` matches `"*"` against both patterns: `"*"` matches `"*"` (allow), `"*.env"` does NOT match `"*"` → last match is `"*" → allow`.
Result: `allow`.
This means `path` does not cause tool hiding — correct, because `path` is a cross-cutting restriction, not a tool-level one.

### Gate chain

```text
1. Skill-read gate              (existing)
2. Path gate (tools)            ← NEW: path-bearing tools only
3. External-directory gate       (existing)
4. Bash external-directory gate  (existing)
5. Bash path gate               ← NEW: bash only
6. Tool permission gate          (existing)
```

The path gate for tools (step 2) runs before the external-directory gate.
If the `path` surface denies, the command is blocked before the external-directory prompt — no wasted prompts.

The bash path gate (step 5) runs before the tool gate.
If it denies, the tool gate is not reached — no double prompts.

### Session approvals

For the tool path gate: session approval pattern derived from the file path using `deriveApprovalPattern()` (existing function, returns `<parent-dir>/*`).
Surface: `"path"`.

For the bash path gate: session approval scoped to the triggering token's directory.
Surface: `"path"`.

Both use the same surface, so a session approval for `"path": "/home/user/.ssh/*"` applies to both tool and bash access to that directory.

### Merge precedence

Unchanged: global → project → per-agent frontmatter, deep-shallow merge on `permission`.
The `path` key merges like any other surface: both-objects → shallow-merge patterns; otherwise → override replaces base.

### Backward compatibility

- No existing surface changes semantics.
- Configs without a `path` key behave identically (no path gate fires — `evaluate("path", value, rules)` returns the universal default, which is not "deny").
- `external_directory` is unchanged.
- Per-tool path patterns (#147) are unchanged.

## Module-Level Changes

### New files

| File                                     | Purpose                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `src/handlers/gates/path.ts`             | `describePathGate()` — sync gate for path-bearing tools against `path` rules. |
| `src/handlers/gates/bash-path.ts`        | `describeBashPathGate()` — async gate for bash against `path` rules.          |
| `tests/handlers/gates/path.test.ts`      | Unit tests for the tool path gate.                                            |
| `tests/handlers/gates/bash-path.test.ts` | Unit tests for the bash path gate.                                            |

### Changed files

| File                                        | Change                                                                                                    |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `src/input-normalizer.ts`                   | Add `"path"` to `SPECIAL_PERMISSION_KEYS`.                                                                |
| `src/rule.ts`                               | Add `evaluateMostRestrictive()` helper (aggregates `evaluate()` over multiple values).                    |
| `src/handlers/gates/bash-path-extractor.ts` | Add `classifyTokenAsRuleCandidate()` (broader filter) and `extractTokensForPathRules()`.                  |
| `src/handlers/gates/index.ts`               | Export new gate functions.                                                                                |
| `src/handlers/permission-gate-handler.ts`   | Insert path gate (tools) and bash path gate into the chain.                                               |
| `src/permission-prompts.ts`                 | Add `formatPathDenyReason()`, `formatPathAskPrompt()` for the `path` surface.                             |
| `src/permission-manager.ts`                 | Add `"path"` to `SPECIAL_PERMISSION_KEYS` (duplicated from `input-normalizer.ts` — both sets must agree). |
| `schemas/permissions.schema.json`           | Add `path` to the examples. Add `markdownDescription` noting the cross-cutting semantics.                 |
| `config/config.example.json`                | Add a `"path"` entry with `*.env` deny example.                                                           |
| `README.md`                                 | Document the `path` surface, composition model, and examples.                                             |
| `docs/architecture/architecture.md`         | Add the `path` surface to the evaluation flow description.                                                |

### Changed test files

| File                                             | Change                                                                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/input-normalizer.test.ts`                 | Add tests: `"path"` is a special key; `normalizeInput("path", { path: ".env" })` returns `values: [".env"]`.                                               |
| `tests/rule.test.ts`                             | Add tests for `evaluateMostRestrictive()`: deny short-circuits, ask accumulates, all-allow returns null.                                                   |
| `tests/bash-external-directory.test.ts`          | Add tests for `extractTokensForPathRules()`: broader filter accepts `.env`, `src/foo.ts`, rejects flags/URLs.                                              |
| `tests/permission-manager-unified.test.ts`       | Add integration tests: `path` surface denies `.env` for tool calls; `path` + per-tool compose (most restrictive wins); session approval on `path` surface. |
| `tests/handlers/permission-gate-handler.test.ts` | Add tests for path gate and bash path gate integration in the chain.                                                                                       |

### Unchanged files

| File                                            | Reason                                                                                                                                                                                                                |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/rule.ts` (`evaluate`, `evaluateFirst`)     | Core evaluation unchanged — `evaluateMostRestrictive` is additive, not a replacement.                                                                                                                                 |
| `src/types.ts`                                  | `FlatPermissionConfig` type unchanged — `path` is a regular surface with a standard pattern map.                                                                                                                      |
| `src/normalize.ts`                              | `normalizeFlatConfig` handles `path` naturally (standard surface).                                                                                                                                                    |
| `src/permission-merge.ts`                       | Merge handles `path` naturally (standard surface).                                                                                                                                                                    |
| `src/wildcard-matcher.ts`                       | Wildcard matching unchanged.                                                                                                                                                                                          |
| `src/pattern-suggest.ts`                        | Session patterns for `path` use existing `deriveApprovalPattern()`. The `suggestSessionPattern` function already handles non-bash, non-mcp surfaces via the `PATH_BEARING_TOOLS` branch and the default `"*"` branch. |
| `src/handlers/gates/external-directory.ts`      | External-directory gate unchanged.                                                                                                                                                                                    |
| `src/handlers/gates/bash-external-directory.ts` | Bash external-directory gate unchanged.                                                                                                                                                                               |
| `src/handlers/gates/tool.ts`                    | Tool gate unchanged.                                                                                                                                                                                                  |

## Test Impact Analysis

1. **New tests enabled:**
   - `tests/rule.test.ts`: `evaluateMostRestrictive()` — deny short-circuit, ask accumulation, all-allow returns null, empty values returns null.
   - `tests/handlers/gates/path.test.ts`: tool path gate — returns null when tool is not path-bearing, returns null when no `path` rules, returns descriptor when path matches deny/ask, returns null when path matches allow.
   - `tests/handlers/gates/bash-path.test.ts`: bash path gate — returns null for non-bash, returns null when no `path` rules, extracts tokens and evaluates, most-restrictive across tokens, session bypass.
   - `tests/bash-external-directory.test.ts`: `extractTokensForPathRules` — broader filter accepts dot-files and slash-containing tokens.
   - `tests/permission-manager-unified.test.ts`: end-to-end `path` surface evaluation.

2. **Existing tests that become redundant:** None — the `path` surface is purely additive.

3. **Existing tests that stay as-is:** All existing tests for `external_directory`, per-tool path patterns, bash command patterns, and session rules.

## TDD Order

### Step 1 — Red: `normalizeInput` recognizes `path` as a special key

1. In `tests/input-normalizer.test.ts`, add tests:
   - `normalizeInput("path", { path: ".env" }, [])` returns `{ surface: "path", values: [".env"], resultExtras: {} }`.
   - `normalizeInput("path", {}, [])` returns `values: ["*"]` (missing path fallback).
2. Tests fail (path not in `SPECIAL_PERMISSION_KEYS`).

Commit: `test: expect normalizeInput to handle path as special key (#148)`

### Step 2 — Green: add `path` to `SPECIAL_PERMISSION_KEYS`

1. In `src/input-normalizer.ts`, add `"path"` to `SPECIAL_PERMISSION_KEYS`.
2. In `src/permission-manager.ts`, add `"path"` to `SPECIAL_PERMISSION_KEYS`.
3. Tests pass.

Commit: `feat: register path as a special permission surface (#148)`

### Step 3 — Red: `evaluateMostRestrictive` helper

1. In `tests/rule.test.ts`, add tests:
   - Deny short-circuits: `["a", "b"]` where `a → deny` returns `{ rule, value: "a" }` without evaluating `b`.
   - Ask accumulates: `["a", "b"]` where `a → ask`, `b → allow` returns `{ rule, value: "a" }`.
   - All allow: returns `null`.
   - Empty values: returns `null`.
   - Deny + ask: deny wins.
2. Tests fail (function does not exist).

Commit: `test: expect evaluateMostRestrictive aggregation (#148)`

### Step 4 — Green: implement `evaluateMostRestrictive`

1. In `src/rule.ts`, add `evaluateMostRestrictive()`.
2. Tests pass.

Commit: `feat: evaluateMostRestrictive helper for cross-cutting path evaluation (#148)`

### Step 5 — Red: broader token extraction

1. In `tests/bash-external-directory.test.ts`, add tests for `extractTokensForPathRules`:
   - `cat .env` → extracts `.env`.
   - `git add src/.env` → extracts `src/.env`.
   - `echo hello` → extracts nothing (no dot prefix, no slash).
   - `rm -rf ./src` → extracts `./src`, skips `-rf`.
   - Heredoc content not extracted.
   - `cat /etc/hosts` → extracts `/etc/hosts`.
   - URLs skipped.
2. Tests fail (function does not exist).

Commit: `test: expect extractTokensForPathRules to capture relative paths (#148)`

### Step 6 — Green: implement broader token extraction

1. In `src/handlers/gates/bash-path-extractor.ts`, add `classifyTokenAsRuleCandidate()` and `extractTokensForPathRules()`.
2. Tests pass.

Commit: `feat: broader token extraction for path rules (#148)`

### Step 7 — Red: tool path gate

1. In `tests/handlers/gates/path.test.ts`, add tests for `describePathGate`:
   - Returns `null` for non-path-bearing tools.
   - Returns `null` when `path` check result is `allow`.
   - Returns `GateDescriptor` when `path` check result is `deny`.
   - Returns `GateDescriptor` when `path` check result is `ask`.
   - Descriptor has correct session approval (surface `"path"`, pattern from `deriveApprovalPattern`).
2. Tests fail (function does not exist).

Commit: `test: expect describePathGate for tool path restrictions (#148)`

### Step 8 — Green: implement tool path gate

1. In `src/handlers/gates/path.ts`, implement `describePathGate()`.
2. Add `formatPathDenyReason()` and `formatPathAskPrompt()` in `src/permission-prompts.ts`.
3. Export from `src/handlers/gates/index.ts`.
4. Tests pass.

Commit: `feat: path gate for tool path restrictions (#148)`

### Step 9 — Red: bash path gate

1. In `tests/handlers/gates/bash-path.test.ts`, add tests for `describeBashPathGate`:
   - Returns `null` for non-bash tools.
   - Returns `null` when no tokens extracted.
   - Returns `null` when all tokens evaluate to `allow`.
   - Returns `GateDescriptor` when a token evaluates to `deny`.
   - Returns `GateDescriptor` when a token evaluates to `ask` (most restrictive).
   - Session bypass: returns `GateBypass` when session rule covers the path.
   - Descriptor includes triggering token in prompt message.
2. Tests fail (function does not exist).

Commit: `test: expect describeBashPathGate for bash path restrictions (#148)`

### Step 10 — Green: implement bash path gate

1. In `src/handlers/gates/bash-path.ts`, implement `describeBashPathGate()`.
2. Tests pass.

Commit: `feat: bash path gate with broader token extraction (#148)`

### Step 11 — Integrate into gate chain

1. In `src/handlers/permission-gate-handler.ts`:
   - Insert tool path gate (step 2 in chain) before external-directory gate.
   - Insert bash path gate (step 5 in chain) before tool gate.
2. Add integration tests in `tests/handlers/permission-gate-handler.test.ts`.
3. Add integration tests in `tests/permission-manager-unified.test.ts`:
   - `path: { "*.env": "deny" }` denies `read` of `.env`.
   - `path: { "*.env": "deny" }` composes with `read: "allow"` (path deny wins).
   - `path: { "*": "allow" }` does not interfere with existing behavior.
   - Session approval on `path` surface bypasses the gate.
   - `getToolPermission("path")` returns catch-all action.
4. Run full test suite.

Commit: `feat: integrate path gates into permission pipeline (#148)`

### Step 12 — Schema, example config, and docs

1. In `schemas/permissions.schema.json`: add `path` to examples, add `markdownDescription`.
2. In `config/config.example.json`: add `"path"` entry with `*.env` deny.
3. In `README.md`: document the `path` surface, composition model, examples.
4. In `docs/architecture/architecture.md`: add `path` to evaluation flow.
5. Run `pnpm run build`.

Commit: `docs: document cross-cutting path permission surface (#148)`

## Prompt UX Scenarios

### Scenario A: path deny for in-CWD file (tool)

```text
Config:  "path": { "*": "allow", "*.env": "deny" }, "read": "allow"
Tool:    read { path: ".env" }
```

```text
Gate chain:
  1. Path gate (tools)    → .env matches "*.env" → deny → BLOCKED
  2. Ext-dir gate         → not reached
  3. Tool gate            → not reached
```

One gate fires, clean deny.
The deny message names the path and the matched pattern.

### Scenario B: path ask for in-CWD file (bash)

```text
Config:  "path": { "*": "allow", ".scratch": "ask" }
Command: git add .scratch
```

```text
Gate chain:
  1. Bash ext-dir gate    → null (no external paths)
  2. Bash path gate       → .scratch matches ".scratch" → ask → PROMPT
  3. Tool gate            → skipped (bash path gate handled)
```

One prompt.
Session approval: `"path": "<cwd>/.scratch"` (or directory pattern).

### Scenario C: path deny + external-directory ask (no wasted prompt)

```text
Config:  "path": { "*": "allow", "~/.ssh/*": "deny" }, "external_directory": "ask"
Command: cat ~/.ssh/id_rsa
```

```text
Gate chain:
  1. Bash ext-dir gate    → ~/.ssh/id_rsa outside CWD → ask → PROMPT
  2. Bash path gate       → ~/.ssh/id_rsa matches "~/.ssh/*" → deny → BLOCKED
```

The user sees the external-directory prompt (step 1) before the path deny (step 2).
If the user denies step 1, the command is blocked without reaching step 2.
If the user allows step 1, step 2 still blocks — the path deny is absolute.

This is a minor UX imperfection (one potentially wasted prompt), but it is consistent: the external-directory gate does not know about `path` rules, and `path` rules do not weaken `external_directory` denials.
The gate ordering (ext-dir before path) preserves the existing behavior where external-directory is the outermost safety net.

To avoid the wasted prompt, the user should align their configs: if `"path": { "~/.ssh/*": "deny" }`, also set `"external_directory": { "~/.ssh/*": "deny" }` to deny at the outer gate too.

### Scenario D: path + per-tool composition

```text
Config:  "path": { "*": "allow", "*.env": "deny" }
         "read": { "*": "allow", "*.env": "allow" }   ← per-tool attempts override
Tool:    read { path: ".env" }
```

```text
Gate chain:
  1. Path gate (tools)    → .env matches "*.env" → deny → BLOCKED
  2. Tool gate            → not reached
```

The per-tool allow does NOT override the cross-cutting `path` deny.
This is by design: `path` is the safety net, per-tool patterns are the flexibility layer.

### Session approval options

The `path` gate uses the existing prompt UI (4 options):

```text
1. Yes
2. Yes, allow path "<dir>/*" for this session
3. No
4. No, provide reason
```

The session label is derived from `deriveApprovalPattern()` — same as `external_directory`.
A session approval on the `path` surface applies to both tool and bash access to that directory.

## Risks and Mitigations

| Risk                                                  | Mitigation                                                                                                                                                                                                         |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Could this silently weaken a permission?              | No — `path` is additive. Configs without a `path` key are unaffected. The `path` gate only restricts; it cannot override a deny from another gate.                                                                 |
| `getToolPermission("path")` hides tools               | No — `path` is in `SPECIAL_PERMISSION_KEYS`, not a tool name. `getToolPermission` is called for tool names, not special keys. And `evaluate("path", "*", rules)` returns the catch-all action (typically "allow"). |
| Per-tool path allows override `path` denies           | By design, they cannot. The `path` gate runs first. If it denies, the tool gate is not reached.                                                                                                                    |
| Double prompt for external + path rules               | Possible for external paths where both gates ask. User can align configs to avoid it. See Scenario C analysis.                                                                                                     |
| Performance: tree-sitter runs twice for bash          | Parser is a lazy singleton. Parsing the same command twice is negligible (~1ms). Can be merged in a follow-up if profiling shows impact.                                                                           |
| Broader token extraction causes false-positive denies | The broader filter only accepts tokens starting with `.` or containing `/`. Non-path tokens that slip through match `"*" → allow` unless the user configured a deny pattern that happens to match.                 |

## Open Questions

1. **Should path patterns be normalized before matching?**
   Currently, extracted tokens are matched raw against path patterns using `wildcardMatch`.
   `.env` matches `"*.env"` but `./src/.env` does not match `".env"` (it matches `"*.env"` though).
   Normalization (resolve relative, expand `~`) would make matching more predictable but adds complexity and requires `cwd`.
   Recommendation: start with raw matching; add normalization in a follow-up if users report surprises.

2. **Should `path` rules apply to `find`, `grep`, and `ls`?**
   These tools accept a `path` parameter but it's a search root, not a file being read/written.
   `find { path: "src" }` with `"path": { "src": "deny" }` would deny searching `src/`.
   This might be surprising — the user denied access to files named `src`, not searching under `src/`.
   Recommendation: include them (they're in `PATH_BEARING_TOOLS`), but document the semantics clearly.

3. **Gate ordering: should the bash path gate run before or after the bash external-directory gate?**
   Current plan: after (ext-dir first, path second).
   If the path gate ran first, a `path` deny would prevent the wasted ext-dir prompt in Scenario C. But this changes the existing invariant that ext-dir is the outermost safety net.
   Recommendation: keep ext-dir first for now; revisit if double-prompt feedback materializes.

4. **Should the `path` surface affect non-path-bearing tools?**
   Extension tools and MCP tools do not have a standard `input.path`.
   The `path` gate only fires for `PATH_BEARING_TOOLS` and `bash`.
   If an extension tool accesses files via a non-standard input field, `path` rules do not apply.
   This is a known limitation, consistent with how `external_directory` works today.
