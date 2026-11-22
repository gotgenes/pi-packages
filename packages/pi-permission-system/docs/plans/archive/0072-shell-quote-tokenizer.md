---
issue: 72
issue_title: "Replace regex-based bash tokenizer with shell-quote or tree-sitter-bash"
---

# Replace regex-based bash tokenizer with `shell-quote`

## Problem Statement

`extractExternalPathsFromBashCommand` in `src/external-directory.ts` uses a hand-rolled regex tokenizer (`stripQuotedStrings` + `split(/[|;&><\s]+/)`) that produces false positives on edge cases.
Issue #68 fixed bare-slash tokens, but the underlying tokenizer remains fragile:

1. `stripQuotedStrings` breaks on escaped quotes (`\"`), leaking post-break content into the token stream.
2. Shell comments (`# ...`) are not stripped — path-like tokens after `#` are scanned.
3. Heredoc content is tokenized as if it were command arguments.
4. Operators are treated as simple delimiters, losing structural information.

These are not hypothetical — the escaped-quote bug triggered a false-positive external-directory prompt during #68 dog-fooding.

## Goals

- Replace `stripQuotedStrings` and the `split(/[|;&><\s]+/)` tokenizer with `shell-quote`'s `parse()`.
- Eliminate false positives from escaped quotes, shell comments, and operator conflation.
- Keep `classifyTokenAsPathCandidate` as a separate concern operating on properly tokenized string arguments.
- Add `shell-quote` and `@types/shell-quote` as runtime and dev dependencies respectively.
- Add regression tests for the edge cases that the regex tokenizer gets wrong.

## Non-Goals

- Adopting `web-tree-sitter` + `tree-sitter-bash` — deferred to a follow-up issue.
  `shell-quote` is sufficient for path extraction and avoids the 1.5MB WASM overhead.
- Handling heredocs — `shell-quote` flattens heredoc content into tokens, which is the same behavior as the current tokenizer.
  This is a known limitation shared by both approaches.
- Changing `classifyTokenAsPathCandidate` logic — the classification heuristics are orthogonal to tokenization.
- Changing any permission surface, config format, or merge precedence.

## Background

- **Permission surface**: `external_directory` (bash variant).
- **Module**: `src/external-directory.ts` — `extractExternalPathsFromBashCommand` is the entry point; `stripQuotedStrings` and `classifyTokenAsPathCandidate` are internal helpers.
- **Tests**: `tests/bash-external-directory.test.ts` (388 lines) covers extraction, formatting, and edge cases.
- **Prerequisite**: #68 (bare-slash fix) — already shipped in v4.0.1.

### `shell-quote` API

`shell-quote` exports `parse(cmd)` returning `ParseEntry[]` where:

```typescript
type ParseEntry =
  | string                          // plain argument (quotes resolved)
  | { op: string }                  // shell operator (|, &&, ;, etc.)
  | { op: "glob"; pattern: string } // glob pattern
  | { comment: string };            // shell comment
```

String entries have quotes already resolved — `parse('git commit -m "fix /etc/hosts"')` returns `["git", "commit", "-m", "fix /etc/hosts"]`.
Operator and comment entries are objects, trivially filtered out.

## Design Overview

### Tokenization change

Replace:

```typescript
const unquoted = stripQuotedStrings(command);
const tokens = unquoted.split(/[|;&><\s]+/).filter(Boolean);
```

With:

```typescript
import { parse } from "shell-quote";

const entries = parse(command);
const tokens = entries.filter((e): e is string => typeof e === "string");
```

This single change fixes escaped quotes, comments, and operator handling in one shot.
`classifyTokenAsPathCandidate` continues to receive plain strings and is unchanged.

### Dead code removal

`stripQuotedStrings` becomes dead code and is removed.
The bare-slash guard in `classifyTokenAsPathCandidate` (`/^\/+$/.test(token)`) is kept — `shell-quote` can still produce bare-slash strings (e.g., `parse("echo /")` → `["echo", "/"]`), so the guard remains a valid defense-in-depth layer.

### Dependency addition

- `shell-quote` as a runtime dependency (`dependencies` in `package.json`).
- `@types/shell-quote` as a dev dependency (`devDependencies`).

This is the first runtime dependency for this package.
`shell-quote` is 23KB, zero transitive dependencies, MIT license, 47M+ weekly downloads — low risk.

## Module-Level Changes

| File                                    | Change                                                                                                                                                                                   |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                          | Add `shell-quote` to `dependencies`, `@types/shell-quote` to `devDependencies`.                                                                                                          |
| `src/external-directory.ts`             | Import `parse` from `shell-quote`. Replace `stripQuotedStrings` + `split()` in `extractExternalPathsFromBashCommand` with `parse()` + type filter. Remove `stripQuotedStrings` function. |
| `tests/bash-external-directory.test.ts` | Add tests for: escaped quotes in double-quoted strings, shell comments containing paths, operators as typed tokens (not leaking into path stream). Verify existing tests still pass.     |

## TDD Order

1. **test: add failing tests for regex tokenizer edge cases (#72)** Add a new `describe("shell-quote tokenizer edge cases")` block in `tests/bash-external-directory.test.ts` with:
   - Escaped double quote: `git commit -m "fix \"the /etc/hosts\" issue"` → no external path (path is inside quotes).
   - Shell comment: `echo hello # read /etc/shadow` → no external path (path is in comment).
   - Comment alongside real path: `cat /etc/hosts # /etc/shadow` → only `/etc/hosts`.
   - Operator tokens don't leak: `cat /etc/hosts | grep foo` → only `/etc/hosts`, not `|` or `grep`.
   - Semicolons: `echo ok; cat /etc/hosts` → `/etc/hosts` extracted correctly.
   These tests will fail against the current regex tokenizer (red).
   Commit: `test: add failing cases for regex tokenizer edge cases (#72)`

2. **feat: replace regex tokenizer with shell-quote (#72)**
   - Add `shell-quote` and `@types/shell-quote` dependencies.
   - In `extractExternalPathsFromBashCommand`, replace `stripQuotedStrings` + `split()` with `parse()` + string filter.
   - Remove the `stripQuotedStrings` function.
   - All new tests pass (green).
     Run full suite to confirm no regressions.
   Commit: `feat: replace regex tokenizer with shell-quote (#72)`

3. **test: verify defense-in-depth for bare-slash tokens (#72)** Add or confirm a test that `parse("echo /")` still produces `/` as a token and `classifyTokenAsPathCandidate` still rejects it.
   This validates the bare-slash guard remains necessary even with `shell-quote`.
   Commit: `test: confirm bare-slash guard with shell-quote tokenizer (#72)`

4. **docs: update plan retro and close issue (#72)** Optional retro in `docs/retro/0072-shell-quote-tokenizer.md` if anything surprising surfaces.
   Commit: `docs: retro for shell-quote tokenizer migration (#72)`

## Risks and Mitigations

| Risk                                                              | Mitigation                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Could this silently weaken a permission?                          | No — `shell-quote` produces *fewer* tokens than the regex tokenizer (comments and operators are filtered out as non-strings). Fewer tokens means fewer path candidates, which means fewer prompts, never fewer blocks. A path that was correctly detected before will still be a string token from `shell-quote`.                          |
| `shell-quote` misparses a command and drops a real path argument? | `shell-quote` has 47M weekly downloads and handles standard POSIX quoting. Edge cases (heredocs, complex expansions) are no worse than the regex tokenizer. The bare-slash guard and `classifyTokenAsPathCandidate` provide additional filtering layers.                                                                                   |
| First runtime dependency — supply chain risk?                     | `shell-quote` is zero-dependency, MIT, maintained by the `shell-quote` org. The `@types/shell-quote` package is DefinitelyTyped-sourced. Both are widely audited. Pin versions via lockfile.                                                                                                                                               |
| `shell-quote` handles `$VAR` expansion by default?                | `parse(cmd)` with no `env` argument replaces `$VAR` with empty string. This is acceptable — we don't want environment variables expanded for path extraction. If a command uses `$HOME/foo`, the path candidate will be `/foo` (or empty), not `~/foo`. This is the same behavior as the regex tokenizer, which has no variable awareness. |

## Open Questions

- **Follow-up: `tree-sitter-bash` for full AST parsing.**
  Addressed by #74 — `shell-quote` has been replaced with `web-tree-sitter` + `tree-sitter-bash`, eliminating heredoc false positives and providing full AST-based path extraction.
- **`$VAR` expansion**: tree-sitter parses `$HOME/foo` as an `expansion` + `word` concatenation.
  `classifyTokenAsPathCandidate` does not expand variables, so `$HOME/foo` is not detected as an external path.
  This is the same pre-existing limitation as with `shell-quote`.
  Deferred — not a regression from current behavior.
