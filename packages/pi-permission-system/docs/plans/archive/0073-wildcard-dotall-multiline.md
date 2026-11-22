---
issue: 73
issue_title: "node -e command triggers permission prompt despite \"*\": \"allow\" global fallback"
---

# Wildcard matcher fails on multiline bash commands

## Problem Statement

When a bash command contains newlines (e.g., `node -e "\nimport(...)\n"`), the wildcard matcher's compiled regex `/^.*$/` fails because `.` does not match `\n` by default in JavaScript.
This causes `evaluate()` to find no matching rule — not even the universal `{ surface: "*", pattern: "*" }` catch-all — and fall through to the hard-coded `"ask"` default, producing a spurious permission prompt.

## Goals

- Make `wildcardMatch` (and all callers via `compileWildcardPattern`) correctly match values containing newline characters.
- Zero behavior change for single-line values — this is a strict bug fix.

## Non-Goals

- Changing the permission evaluation model or rule precedence.
- Addressing shell-quote tokenization (covered by #72, already landed).
- Adding multiline-aware pattern syntax (e.g., `**` for newlines) — the existing `*` should simply match everything including newlines.

## Background

- **Permission surface**: `bash` (but the fix is in the generic wildcard module, affecting all surfaces).
- **Module**: `src/wildcard-matcher.ts` — `compileWildcardPattern()` builds a `RegExp` by escaping literal segments and joining with `.*`.
  The regex uses no flags, so `.` does not match `\n`.
- **Call path**: `evaluate()` in `src/rule.ts` calls `wildcardMatch(rule.pattern, value)` for both `surface` and `pattern` fields.
  A multiline bash command is the `value` argument to the pattern match.

## Design Overview

Add the `s` (dotAll) flag to the regex constructed in `compileWildcardPattern`.
With `dotAll`, `.` matches any character including line terminators (`\n`, `\r`, `\u2028`, `\u2029`).

```typescript
return {
  pattern,
  state,
  regex: new RegExp(`^${escaped}$`, "s"),
};
```

This is the minimal, correct fix.
No new types, no data-shape changes, no config changes.

## Module-Level Changes

| File                               | Change                                                                            |
| ---------------------------------- | --------------------------------------------------------------------------------- |
| `src/wildcard-matcher.ts`          | Add `"s"` flag to `new RegExp(...)` in `compileWildcardPattern()`.                |
| `tests/wildcard-matcher.test.ts`   | Add test cases for multiline values matching `*` and literal-prefix-`*` patterns. |
| `tests/permission-manager.test.ts` | Add integration test: multiline bash command with `"*": "allow"` returns allow.   |

## TDD Order

1. **test: multiline value fails to match wildcard `*` pattern (red)** Add tests in `tests/wildcard-matcher.test.ts`:
   - `wildcardMatch("*", "line1\nline2")` → expected `true`
   - `wildcardMatch("node *", "node -e \"\nfoo\n\"")` → expected `true`
   - `compileWildcardPattern("*", "allow").regex.test("a\nb")` → expected `true`

   Commit: `test: cover multiline values in wildcardMatch`

2. **feat: add dotAll flag to wildcard regex** In `src/wildcard-matcher.ts`, change `new RegExp(...)` to include `"s"` flag.
   Tests from step 1 go green.

   Commit: `fix: add dotAll flag so wildcard`*`matches newlines (#73)`

3. **test: integration — multiline bash command resolves to allow** Add a test in `tests/permission-manager.test.ts`:
   - Config: `{ "*": "allow", bash: { "rm -rf *": "deny" } }`
   - `checkPermission("bash", { command: "node -e \"\nimport(...)\n\"" })` → `state: "allow"`

   Commit: `test: multiline bash command resolves allow via universal fallback`

## Risks and Mitigations

| Risk                                                      | Mitigation                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Could this silently weaken a permission?                  | No. The `s` flag only makes `*` match what users already expect it to match. A pattern like `rm -rf *` still only matches strings starting with `rm -rf` — it does not gain the ability to match unrelated multiline strings because the literal prefix anchors it. |
| Over-broad match for patterns containing literal newlines | No user would put literal `\n` in a pattern string in JSON config. The patterns are single-line strings; only values (commands) can be multiline.                                                                                                                   |
| Breaks existing tests                                     | Existing tests use single-line values. Adding `s` has no effect on strings without newlines.                                                                                                                                                                        |

## Open Questions

None — the fix is unambiguous.
