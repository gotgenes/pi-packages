---
issue: 318
issue_title: "Introduce an McpTargetList value object in mcp-targets.ts"
---

# Introduce an `McpTargetList` value object in `mcp-targets.ts`

## Problem Statement

`createMcpPermissionTargets` accumulates permission-lookup candidates through a `pushTarget` closure over a mutable local array, deduping by hand:

```typescript
const targets: string[] = [];
const pushTarget = (value: string | null) => {
  if (!value) return;
  if (!targets.includes(value)) targets.push(value);
};
```

The core smell is the `includes` check: every push site asks the array what it already contains, then acts on it — the ordered-uniqueness invariant lives in the caller, not in the array.
That is a Tell-Don't-Ask violation, repeated implicitly at every push across the per-mode branches (tool / connect / describe / search / list / status).
This is the one remaining "mutable closure state with no owner" in the package after the Phase 3 forwarding work (Track C, Step 5 of the architecture roadmap).
The fix gives the accumulator an owner: a small `McpTargetList` value object whose `add` swallows the empty/null guard and the dedup, so the per-mode dispatch reads as a sequence of tells.

## Goals

- Add an `McpTargetList` value object that owns the ordered-uniqueness invariant: `add(value)` ignores empty/null and appends only when the value is not already present; `toArray()` returns the ordered result.
- Move the `includes` dedup check inside the object so no call site asks the array what it holds.
- Rewrite `createMcpPermissionTargets`, `pushMcpToolPermissionTargets`, and `addDerivedMcpServerTargets` so the per-mode branches construct an `McpTargetList` and tell it to `add`.
- Export `McpTargetList` and give it focused unit tests that document the invariant directly.
- Behavior-preserving: `test/mcp-targets.test.ts` stays green; candidate ordering is unchanged.

## Non-Goals

- No MCP-naming command methods on the list (e.g. `addQualifiedTool(server, tool)`, `addServerListing(server)`).
  `McpTargetList` owns ordering + uniqueness only; the `${server}_${tool}` / `${server}:${tool}` / `mcp_server_${server}` spelling is a separate responsibility that stays in the pure dispatch functions that tell the list.
- No `McpInvocation` / `deriveTargets()` class.
  Modeling the input as an object with a single `deriveTargets()` method plus a constructor is a one-shot transform wearing a class costume — no retained state across calls, no polymorphic seam.
  The dispatch stays a function.
- No change to `parseQualifiedMcpToolName` (its signature, behavior, and tests are untouched).
- No change to `src/input-normalizer.ts` behavior — it spreads the returned array and appends `"mcp"`; the returned shape (`string[]`) is unchanged.
- No change to the candidate ordering, the set of candidates produced for any input, or any user-visible permission decision.

## Background

Relevant existing modules:

- `src/mcp-targets.ts` — exports `parseQualifiedMcpToolName` and `createMcpPermissionTargets`; contains the module-private helpers `addDerivedMcpServerTargets` and `pushMcpToolPermissionTargets`.
  All three derivation functions thread a `pushTarget: (value: string | null) => void` callback today.
- `src/input-normalizer.ts` (line 106) — the sole production consumer: `[...createMcpPermissionTargets(input, configuredMcpServerNames), "mcp"]`.
  It spreads the array, so whether `toArray()` returns the live array or a copy is invisible to it.
- `test/mcp-targets.test.ts` — exercises `createMcpPermissionTargets` across all six modes plus a dedup assertion (`does not include duplicate entries`) and an ordering assertion (`tool targets appear before mcp_call`).
- `test/input-normalizer.test.ts` (line 175) — asserts the normalizer output matches `createMcpPermissionTargets` output with `"mcp"` appended; unaffected because the return shape is unchanged.

Constraints from AGENTS.md and skills:

- `@typescript-eslint/require-await` is enabled for `src/` — not triggered here (no `async` involved).
- Within the package, tests import via the `#src/` alias (`#src/mcp-targets`), not relative paths.
- Code organization (newspaper / stepdown): exported API near the top, helpers below their callers.
- Do not add speculative re-exports; fallow flags them as dead code.
  `McpTargetList` is exported and consumed by both `mcp-targets.ts` (production) and `test/mcp-targets.test.ts`, so it has real consumers — no dead-export risk.
- The architecture doc (`docs/architecture/architecture.md`) records this as Finding 4 / Step 5 and references the `pushTarget` closure by name; it needs an update once the closure is gone.

## Design Overview

### The value object

`McpTargetList` owns a private array and exposes exactly two methods — `add` (a command that tells) and `toArray` (a query that reads the ordered result):

```typescript
export class McpTargetList {
  private readonly targets: string[] = [];

  add(value: string | null): void {
    if (!value) {
      return;
    }
    if (!this.targets.includes(value)) {
      this.targets.push(value);
    }
  }

  toArray(): string[] {
    return [...this.targets];
  }
}
```

Design notes:

- `add` absorbs both the empty/null guard and the `includes` dedup — the two responsibilities that were inlined at every call site.
- `toArray()` returns a defensive copy (`[...this.targets]`).
  The current code returns the live array, but the sole consumer spreads it, so the copy is behavior-preserving and prevents external mutation of the list's internal state.
- The class is intentionally generic — it knows nothing about MCP naming.
  It is a thin ordered-set accumulator; the MCP spelling stays in the dispatch functions.

### Dispatch tells the list

The two helpers stop taking a `pushTarget` callback and instead take the `McpTargetList` directly, calling `targets.add(...)`.
This is the per-mode dispatch telling the list rather than asking an array:

```typescript
// createMcpPermissionTargets, tool branch (sketch)
const targets = new McpTargetList();
if (tool) {
  pushMcpToolPermissionTargets(tool, server, configuredServerNames, targets);
  targets.add("mcp_call");
  return targets.toArray();
}
```

`pushMcpToolPermissionTargets` and `addDerivedMcpServerTargets` change their last parameter from `pushTarget: (value: string | null) => void` to `targets: McpTargetList` and replace each `pushTarget(x)` with `targets.add(x)`.
No control flow, ordering, or candidate set changes — only the accumulation mechanism.

### Extraction interaction audit

The new module does not import anything new — `McpTargetList` is self-contained (no upstream dependencies, no SDK types).
The helpers already received the accumulation behavior as a callback parameter (`pushTarget`); swapping the callback for an injected object that owns the same behavior is a direct DIP-friendly substitution with no reverse-search, output-argument, or LoD concerns.
Each branch still returns `targets.toArray()` instead of the bare `targets` array — the function returns a value; the list owns the invariant.

### Edge cases (all already covered by behavior)

- Empty/null/whitespace values: `add(null)` and `add("")` are no-ops (falsy guard).
  `getNonEmptyString` already normalizes input, so whitespace never reaches `add`.
- Duplicate candidates (e.g. `tool: "exa:search"` with `["exa"]` configured): `add` dedups; ordering follows first-insertion, identical to the old `includes`-then-`push`.
- Insertion order is the candidate priority (most-specific first); `toArray()` preserves it.

## Module-Level Changes

`src/mcp-targets.ts`:

- Add and export the `McpTargetList` class (placed near the top, below the file's leading imports and above or beside the exported functions per the newspaper rule).
- Change `addDerivedMcpServerTargets` signature: last parameter `pushTarget: (value: string | null) => void` → `targets: McpTargetList`; replace `pushTarget(...)` calls with `targets.add(...)`.
- Change `pushMcpToolPermissionTargets` signature the same way; replace its `pushTarget(...)` calls with `targets.add(...)` and pass `targets` through to `addDerivedMcpServerTargets`.
- Rewrite `createMcpPermissionTargets`: replace the local `targets` array + `pushTarget` closure with `const targets = new McpTargetList()`; replace every `pushTarget(x)` with `targets.add(x)`; replace each `return targets` with `return targets.toArray()`.

`test/mcp-targets.test.ts`:

- Add a `describe("McpTargetList")` block with focused unit tests for the invariant (see TDD order Step 1).
- Import `McpTargetList` from `#src/mcp-targets` alongside the existing imports.
- The existing `createMcpPermissionTargets` and `parseQualifiedMcpToolName` blocks stay unchanged (regression guard).

`docs/architecture/architecture.md`:

- Update Finding 4 (line ~785) and Step 5 (line ~818) to reflect that the `pushTarget` closure is resolved by the `McpTargetList` value object (mark the step done in the style of Steps 1–4, which carry a ✅ and an Outcome).

No other `src/` or `test/` file imports the changed symbols; the package skill does not reference `mcp-targets.ts` internals by name (verified by grep), so no skill update is required.

## Test Impact Analysis

1. New tests the extraction enables: direct `McpTargetList` unit tests that document the ordered-uniqueness invariant in isolation — `add` ignores `null`, ignores `""`, appends new values, dedups repeats, preserves first-insertion order across a mix, and `toArray()` returns a copy that does not mutate the list.
   These were impossible while the accumulator was a closure-local array.
2. Tests that become redundant: none are removed.
   The existing `does not include duplicate entries` test in the `createMcpPermissionTargets` block now overlaps with the direct dedup test, but it stays as an integration-level regression guard (it verifies dedup through the real dispatch, not just the list in isolation).
3. Tests that must stay as-is: the entire existing `createMcpPermissionTargets` block (all six modes + ordering) genuinely exercises the dispatch layer being refactored and is the primary behavior-preservation guard; the `parseQualifiedMcpToolName` block is untouched.

## TDD Order

1. red → green → commit — `test/mcp-targets.test.ts`, new `describe("McpTargetList")` block.
   Add the value object and its focused tests in one cycle: write the tests against an exported `McpTargetList` (red — symbol does not exist), add the class to `src/mcp-targets.ts`, run green.
   Covers: `add` ignores null/empty, appends, dedups, preserves order; `toArray` returns an independent copy.
   Commit: `test: add McpTargetList value object with ordered-uniqueness tests`. (Combined test+impl because the class is the unit under test; suggested split — if preferred, `feat:` the class first, then `test:` — but one cycle is cleaner here.)

2. green → commit — `src/mcp-targets.ts`, rewrite the dispatch.
   Replace the `pushTarget` closure and local array in `createMcpPermissionTargets` with `new McpTargetList()` / `add` / `toArray()`, and repoint `pushMcpToolPermissionTargets` + `addDerivedMcpServerTargets` to accept and tell the `McpTargetList`.
   No new test — the existing `createMcpPermissionTargets` block is the regression guard and must stay green throughout.
   Commit: `refactor: dispatch MCP targets through McpTargetList`.

3. docs → commit — `docs/architecture/architecture.md`.
   Mark roadmap Step 5 done and update Finding 4 to note the closure is replaced by the value object (matching the ✅/Outcome style of Steps 1–4).
   Commit: `docs: record McpTargetList resolves the pushTarget closure (#318)`.

This is a behavior-preserving refactor, so there is no `feat!:` and no breaking change.

## Risks and Mitigations

- Risk: ordering regression if `add` changes insertion semantics.
  Mitigation: `add` preserves the exact `includes`-then-`push` order; the existing `tool targets appear before mcp_call` ordering test and all per-mode `toContain` assertions guard it.
- Risk: a caller relying on `toArray()` returning the live array and mutating it.
  Mitigation: the sole consumer (`input-normalizer.ts`) spreads the result; the defensive copy is strictly safer and behavior-identical.
- Risk: scope creep into MCP-naming command methods on the list.
  Mitigation: explicit Non-Goal; the list stays generic and the spelling stays in the dispatch functions.

## Open Questions

None.
The issue's "Proposed change" and "Non-goals" sections fully specify the design; the only decision (export + directly test `McpTargetList`) was confirmed with the user before writing this plan.
