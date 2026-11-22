---
issue: 393
issue_title: "fix(pi-permission-system): normalize path policy inputs"
---

# Normalize path policy inputs

## Problem Statement

The path gates already know the current Pi working directory — `PermissionManager.configureForCwd` records it — but the evaluator never used it.
So a relative tool input or bash token such as `src/App.jsx` could never match an absolute allowlist rule such as `/workspace/project/*`, even though the two name the same file.
After extension and MCP tools started flowing through the same path gates ([#352]), this gap became more visible: relative inputs silently miss absolute rules.

The fix is to feed the evaluator a set of equivalent "policy values" for a path (absolute, project-relative, and raw relative), derived from the known working directory, and to match them with last-match-wins preserved across the aliases so a catch-all on one spelling cannot mask a later specific rule on another.

This plan adopts that capability from third-party PR [#393] (`@moekyo`) but plans a simplified design: the PR is reference, not the merge target.
The direction, scope, and breaking classification were confirmed by the operator during the PR Review stage (recorded in the retro) — the `Decide` gate is satisfied and is not re-litigated here.

## Goals

- Derive equivalent path-policy lookup values (absolute, project-relative, raw) for path surfaces when the working directory is known.
- Match those values with last-match-wins preserved **across** aliases of the same path, so an early catch-all match cannot mask a later, more specific rule.
- Make the bash `path` gate use cd-aware policy values for literal current-shell `cd` commands, while keeping prompts, logs, and session approvals on the raw token.
- Pass bash's per-token resolution context **explicitly** through a dedicated resolver/manager method — not as a symbol-keyed side-channel on the tool `input` object.
- Remove the now-orphaned `pathTokens()` / `extractTokensForPathRules` chain rather than suppressing the dead-code flag.
- Document the matching semantics in the README, configuration guide, and JSON schema description.
- **This change is breaking.**
  It flips permission decisions on upgrade with no config edit: a relative input under a config like `path: { "*": "ask", "/workspace/project/*": "allow" }` moves from `ask` to `allow`.
  For a least-privilege package that loosening is breaking — use `feat!:` with a `BREAKING CHANGE:` footer.

## Non-Goals

- Adding a config flag to opt out of cwd-aware matching — the flat permission model stays as-is; no new config surface.
- Changing MCP target resolution: MCP keeps `evaluateFirst` (its candidates are genuinely different targets, not aliases of one path).
- Per-tool path maps for extension tools (threading the access extractor through `normalizeInput`) — a deferred follow-up noted in [#352].
- Reworking `extractExternalPathsFromBashCommand` or the `external_directory` token classifier — out of scope; only the orphaned `pathTokens` surface is removed.

## Background

Relevant existing modules:

- `src/path-utils.ts` — `normalizePathForComparison` (lexical cleanup + resolve against cwd), `PATH_SURFACES` (the set of path-matching surfaces), `PATH_BEARING_TOOLS`.
- `src/rule.ts` — `evaluate` (last-match-wins over one value), `evaluateFirst` (first-non-default across MCP candidates).
- `src/input-normalizer.ts` — `normalizeInput(toolName, input, mcpServerNames)` maps a tool call to `{ surface, values, resultExtras }`; `normalizePathSurfaceValue` extracts and home-expands `input.path`.
- `src/permission-manager.ts` — `configureForCwd` already records the cwd via the loader; `checkPermission` calls `normalizeInput` then `evaluateFirst`.
  `ScopedPermissionManager` is the narrow interface gates depend on.
- `src/permission-resolver.ts` — `ScopedPermissionResolver.resolve(surface, input, agentName)`; the bash path gate's sole evaluation entry point.
- `src/handlers/gates/bash-program.ts` — parses a command once; `rawCandidates` pairs each path token with its `EffectiveBase` (the effective dir after folding literal `cd` commands).
  `pathTokens()` returns deduplicated rule-candidate tokens (no cwd resolution).
- `src/handlers/gates/bash-path.ts` — `describeBashPathGate` evaluates each `pathTokens()` token against the `path` surface and returns the most restrictive result; always sets `preCheck`.
- `src/handlers/gates/bash-path-extractor.ts` — `extractTokensForPathRules` (thin facade over `pathTokens`, test-only) and `extractExternalPathsFromBashCommand` (used by the external-directory gate path; **kept**).
- `src/handlers/gates/runner.ts` — `runDescriptor` uses `descriptor.preCheck` when set and **only** calls `resolver.resolve(descriptor.surface, descriptor.input, …)` when `preCheck` is absent.

Constraints from AGENTS.md / package skill that apply:

- Default to least privilege; a loosening behavior change is breaking.
- Keep schema, example config, `docs/configuration.md`, `README.md`, and TS types/loaders aligned.
- "Treat any declared field not read at runtime as a maintenance trap" — drives removing the orphaned `pathTokens` chain.
- Do not smuggle policy through a symbol on raw tool `input`; pass resolution context explicitly.

## Design Overview

### Equivalent path-policy values (path-utils.ts)

Add a pure value-deriver shared by every path surface:

```typescript
export interface PathPolicyValueOptions {
  /** Current Pi working directory; enables a project-relative alias. */
  cwd?: string;
  /** Directory used to resolve into an absolute value. Defaults to cwd; bash
   *  passes the effective dir after a literal cd. */
  resolveBase?: string;
}

/** Lexical cleanup only — trim, strip wrapping quotes, strip leading `@`,
 *  expand `~`/`$HOME`. No cwd resolution. Preserves `src/*`, `*.env` rules. */
export function normalizePathPolicyLiteral(pathValue: string): string;

/** Equivalent lookup values, most-specific first:
 *  [ absolute (resolved against resolveBase ?? cwd),
 *    project-relative (when inside cwd),
 *    raw literal ]  — deduped. `"*"` and empty collapse to themselves. */
export function getPathPolicyValues(
  pathValue: string,
  options?: PathPolicyValueOptions,
): string[];
```

When no base is available, `getPathPolicyValues` returns just the literal — so behavior with cwd unknown is unchanged.

### Alias-aware evaluation (rule.ts)

Add `evaluateAnyValue`, distinct from `evaluateFirst`:

```typescript
/** Last rule that matches ANY alias wins (last-match-wins across aliases).
 *  Lets an absolute allowlist and a legacy relative rule coexist without an
 *  early catch-all masking a later specific rule. */
export function evaluateAnyValue(
  surface: string,
  values: string[],
  rules: Ruleset,
  platform?: NodeJS.Platform,
): { rule: Rule; value: string };
```

Refactor the surface/pattern match in `evaluate` into a private `ruleMatches(rule, surface, value, platform)` (and `pathMatchOptions`) so `evaluate` and `evaluateAnyValue` share the Windows case/separator folding.
This is a pure internal refactor — no behavior change to `evaluate`.

### Manager: cwd plumbing + explicit path-policy entry (permission-manager.ts)

- Capture `currentCwd` in `configureForCwd` (trimmed, empty → `undefined`).
- Thread `currentCwd` into `normalizeInput`.
- For `PATH_SURFACES`, evaluate with `evaluateAnyValue`; MCP and all other surfaces keep `evaluateFirst`.
- Add an explicit method so the bash gate can evaluate its own precomputed values without a side-channel:

```typescript
export interface ScopedPermissionManager {
  // …existing…
  checkPathPolicy(
    values: readonly string[],
    agentName?: string,
    sessionRules?: Ruleset,
  ): PermissionCheckResult;
}
```

`checkPathPolicy` composes rules + session rules exactly as `checkPermission`, then evaluates `evaluateAnyValue("path", values, fullRules)` and builds a `PermissionCheckResult` with `toolName: "path"`, `source: "special"`.
Extract the shared post-evaluation result-building (rule dispatch + extras + source/pattern derivation) into a private helper used by both `checkPermission` and `checkPathPolicy` — same synchronous lifecycle, genuine duplication, safe to extract.

This method is the explicit replacement for the PR's `INTERNAL_PATH_POLICY_VALUES` symbol.
It is safe by construction: the values come only from the bash gate's own computation, never from a string-keyed field on untrusted tool `input`, so there is no spoofing surface.

### Resolver: narrow delegating method (permission-resolver.ts)

```typescript
export interface ScopedPermissionResolver {
  resolve(surface: string, input: unknown, agentName?: string): PermissionCheckResult;
  resolvePathPolicy(
    values: readonly string[],
    agentName?: string,
  ): PermissionCheckResult;
}
```

`PermissionResolver.resolvePathPolicy` delegates to `manager.checkPathPolicy(values, agentName, this.sessionRules.getRuleset())`, mirroring how `resolve` composes the session ruleset.

### Bash program: cd-aware candidates (bash-program.ts)

Add `pathRuleCandidates(cwd?)` returning the raw token (for prompts) paired with policy values:

```typescript
export interface BashPathRuleCandidate {
  readonly token: string;             // raw — prompts, logs, approvals
  readonly policyValues: readonly string[]; // cd-aware — policy matching
}

pathRuleCandidates(cwd?: string): BashPathRuleCandidate[];
```

A private `getPolicyValuesForRuleCandidate(candidate, base, cwd)` owns the cd semantics:

- No `cwd` → literal only (unchanged behavior).
- `base.kind === "unknown"` (non-literal `cd "$DIR"`, `cd -`, bare `cd`) on a relative token → literal only (conservative — do not invent an absolute alias).
- Otherwise → `getPathPolicyValues(candidate, { cwd, resolveBase: base.kind === "known" ? resolve(cwd, base.offset) : cwd })`.

### Bash path gate: consume candidates, resolve explicitly (bash-path.ts)

Call site (verifies Tell-Don't-Ask / LoD — bash tells the resolver "resolve these values", no reach-through):

```typescript
const candidates = bashProgram.pathRuleCandidates(tcc.cwd);
if (candidates.length === 0) return null;

for (const { token, policyValues } of candidates) {
  const check = resolver.resolvePathPolicy(policyValues, tcc.agentName ?? undefined);
  // …existing backward-compat (#58), session-cover, deny/ask aggregation…
  // descriptor uses `token` for pattern, prompt, log, decision, and input
}
```

The descriptor keeps `input: { path: worstToken }` and `preCheck: worstCheck`.
Because `runDescriptor` uses `preCheck` whenever it is set (and the bash path gate always sets it), `descriptor.input` is never re-resolved — so no symbol on `input` is needed (the PR's stamp was vestigial).

### Edge cases

- cwd unknown → single literal value; identical to current behavior.
- Token outside cwd (e.g. `/etc/hosts`) → absolute + literal, no project-relative alias.
- Non-literal `cd` before a relative token → literal-only policy values (no spurious absolute allow).
- `"*"` / empty path → `["*"]` (surface catch-all), unchanged.

## Module-Level Changes

- `src/path-utils.ts` — add `PathPolicyValueOptions`, `normalizePathPolicyLiteral`, `getPathPolicyValues` (+ private `getAbsolutePathPolicyValues`, `getCwdRelativePathPolicyValues`); import `relative` from `node:path`.
- `src/rule.ts` — add `evaluateAnyValue`; extract private `ruleMatches` + `pathMatchOptions` from `evaluate`.
- `src/input-normalizer.ts` — add optional `cwd` param to `normalizeInput`; `normalizePathSurfaceValue` → `normalizePathSurfaceValues` returning `string[]` via `getPathPolicyValues`.
  **No** `INTERNAL_PATH_POLICY_VALUES` symbol; no `normalizeOptionalStringArray` import.
- `src/permission-manager.ts` — add `currentCwd` field; capture in `configureForCwd`; thread into `normalizeInput`; dispatch `PATH_SURFACES` to `evaluateAnyValue`; add `checkPathPolicy` to `ScopedPermissionManager` + class; extract shared result-builder helper.
- `src/permission-resolver.ts` — add `resolvePathPolicy` to `ScopedPermissionResolver` + `PermissionResolver`.
- `src/handlers/gates/bash-program.ts` — add `BashPathRuleCandidate`, `pathRuleCandidates`, private `getPolicyValuesForRuleCandidate`; **remove** `pathTokens()`.
- `src/handlers/gates/bash-path.ts` — consume `pathRuleCandidates(tcc.cwd)` and `resolver.resolvePathPolicy`; keep raw `token` for presentation.
- `src/handlers/gates/bash-path-extractor.ts` — **remove** `extractTokensForPathRules` (orphaned after the gate migrates); keep `extractExternalPathsFromBashCommand`.
- `test/helpers/session-fixtures.ts` — add `checkPathPolicy` to `makeFakePermissionManager`.
- `test/helpers/gate-fixtures.ts` — add `resolvePathPolicy` to `makeResolver`, `makeGateRunner`'s resolver, and `makePathDispatchResolver`.
- `test/handlers/gates/tool-call-gate-pipeline.test.ts` — mock `pathRuleCandidates` instead of `pathTokens`.
- Tests: `test/path-utils.test.ts`, `test/rule.test.ts`, `test/input-normalizer.test.ts`, `test/permission-manager-unified.test.ts`, `test/permission-resolver.test.ts`, `test/handlers/gates/bash-program.test.ts`, `test/handlers/gates/bash-path.test.ts`, `test/bash-external-directory.test.ts` (remove `extractTokensForPathRules` block).
- Docs/schema: `README.md`, `docs/configuration.md`, `schemas/permissions.schema.json` (markdownDescription).

Before finalizing, grep `src/`, `test/`, and `.pi/skills/package-pi-permission-system/SKILL.md` for `pathTokens` and `extractTokensForPathRules` to confirm every reference is removed or migrated.
Any test file that constructs a `ScopedPermissionManager` or `ScopedPermissionResolver` mock inline (not via the shared fixtures) must gain the new method in the same step the interface changes — grep both interface names across `test/`.

## Test Impact Analysis

1. **New tests enabled by the change:**
   - `getPathPolicyValues` / `normalizePathPolicyLiteral` unit tests (cwd present/absent, inside/outside cwd, `resolveBase`, `"*"`, quotes/`@`/`~`).
   - `evaluateAnyValue` unit tests (last-match-wins across aliases; absolute-alias fallback).
   - `pathRuleCandidates` unit tests (relative→absolute+relative; literal `cd`; unknown `cd`→literal only).
   - `normalizeInput` cwd-alias tests for path surfaces.
   - Manager cwd-aware path-policy tests (relative input vs. absolute allowlist; legacy relative still works; last-match-wins; cross-cutting `path` surface).
   - `resolvePathPolicy` delegation test.
   - `bash-path` cd-aware policy-value test (resolves against literal `cd`, preserves raw prompt token) and unknown-`cd` conservative test.
2. **Redundant tests removed:** the `pathTokens` describe block (`bash-program.test.ts`) and the `extractTokensForPathRules` describe block (`bash-external-directory.test.ts`) — both exercise the orphaned chain being deleted.
3. **Tests that must stay as-is:** the `extractExternalPathsFromBashCommand` suite (`bash-external-directory.test.ts`) — it exercises the kept external-directory extraction, untouched by this change.
   The PR's symbol-spoofing tests are **not** ported (the symbol is not implemented); instead a single `normalizeInput` test locks the no-side-channel property by asserting an extra `pathPolicyValues`-like key on `input` is ignored.

## TDD Order

1. **path-utils policy values.**
   Surface: `test/path-utils.test.ts`.
   Add `normalizePathPolicyLiteral` + `getPathPolicyValues` (pure functions); red tests for cwd/resolveBase/outside-cwd/`"*"`/quotes.
   Commit: `feat: add path-policy value derivation (#393)`.
2. **Alias-aware evaluation.**
   Surface: `test/rule.test.ts`.
   Add `evaluateAnyValue`; refactor `ruleMatches`/`pathMatchOptions` (no behavior change to `evaluate`).
   Commit: `feat: add alias-aware evaluateAnyValue (#393)`.
3. **normalizeInput cwd aliases.**
   Surface: `test/input-normalizer.test.ts`.
   Add optional `cwd`; `normalizePathSurfaceValues` returns aliases via `getPathPolicyValues`; add the no-side-channel test.
   The single call site (`permission-manager.ts`) compiles unchanged (optional param).
   Commit: `feat: normalize path inputs to cwd-aware policy values (#393)`.
4. **Manager: cwd plumbing, evaluateAnyValue, checkPathPolicy.**
   Surface: `test/permission-manager-unified.test.ts` (+ `session-fixtures.ts`).
   Capture `currentCwd`; thread into `normalizeInput`; dispatch `PATH_SURFACES` → `evaluateAnyValue`; add `checkPathPolicy` to interface + class + shared result-builder; add `checkPathPolicy` to `makeFakePermissionManager` and any inline `ScopedPermissionManager` mock (same commit — interface break).
   This flips tool/path-surface decisions for relative inputs.
   Commit: `feat!: match relative path inputs against absolute allowlists (#393)` with a `BREAKING CHANGE:` footer.
   Run `pnpm run check` immediately (shared-interface change).
5. **Resolver: resolvePathPolicy.**
   Surface: `test/permission-resolver.test.ts` (+ `gate-fixtures.ts`).
   Add `resolvePathPolicy` to `ScopedPermissionResolver` + `PermissionResolver`; add it to `makeResolver`, `makeGateRunner`, `makePathDispatchResolver` and any inline resolver mock (same commit — interface break).
   Commit: `feat: add resolvePathPolicy resolver method (#393)`.
   Run `pnpm run check` immediately.
6. **Bash program: pathRuleCandidates (additive).**
   Surface: `test/handlers/gates/bash-program.test.ts`.
   Add `BashPathRuleCandidate` + `pathRuleCandidates` + `getPolicyValuesForRuleCandidate`; keep `pathTokens` for now (lift-and-shift).
   Commit: `feat: add cd-aware pathRuleCandidates to BashProgram (#393)`.
7. **Bash path gate: migrate to candidates + explicit resolve.**
   Surface: `test/handlers/gates/bash-path.test.ts` (+ `tool-call-gate-pipeline.test.ts` mock → `pathRuleCandidates`).
   Switch `describeBashPathGate` to `pathRuleCandidates(tcc.cwd)` + `resolver.resolvePathPolicy`; keep raw `token` for prompt/log/approval/`input`.
   This makes bash tokens cd-aware against absolute rules.
   Commit: `feat!: resolve bash path tokens with cd-aware policy values (#393)` with a `BREAKING CHANGE:` footer.
8. **Remove the orphaned pathTokens chain.**
   Surface: `bash-program.ts`, `bash-path-extractor.ts`, `bash-program.test.ts`, `bash-external-directory.test.ts`.
   Remove `BashProgram.pathTokens`, `extractTokensForPathRules`, and their tests; re-check orphaned imports.
   Commit: `refactor: remove orphaned bash pathTokens extraction (#393)`.
9. **Docs + schema.**
   Surface: `README.md`, `docs/configuration.md`, `schemas/permissions.schema.json`.
   Document cwd-aware matching and the bash literal-`cd` behavior.
   Commit: `docs: document cwd-aware path policy matching (#393)`.

Every implementation/docs commit carries `Co-authored-by: moekyo <shigotods@outlook.com>` and references the PR as `(#393)` / `Refs #393` — never `Closes #393`.

## Risks and Mitigations

- **Silent gate loosening on upgrade (security).**
  Mitigation: classify as breaking (`feat!:`), with a `BREAKING CHANGE:` footer and migration note in the README/configuration guide; the close comment thanks `@moekyo` and links the implementing SHAs.
  Do not name a config opt-out — none exists; the note explains that absolute allowlists now also cover their relative spellings and that tighter control needs narrower patterns or a `path` deny.
- **Interface break cascades to mocks.**
  Mitigation: steps 4 and 5 fold every fixture/inline-mock update into the same commit; `pnpm run check` runs immediately after each.
- **Removing `pathTokens` while a caller remains.**
  Mitigation: lift-and-shift — add `pathRuleCandidates` (step 6), migrate the gate (step 7), delete `pathTokens`/`extractTokensForPathRules` only after no src caller remains (step 8).
- **Bash cd resolution over-reaching on non-literal `cd`.**
  Mitigation: `unknown` base yields literal-only policy values; covered by an explicit conservative test in steps 6–7.

## Open Questions

- Whether to later expose cwd-aware matching as an opt-out config flag if users report unexpected loosening — deferred until there is a concrete request.
- Whether the `external_directory` token classifier should adopt the same alias derivation — out of scope; revisit if a parallel gap surfaces.

[#352]: https://github.com/gotgenes/pi-packages/issues/352
[#393]: https://github.com/gotgenes/pi-packages/issues/393
