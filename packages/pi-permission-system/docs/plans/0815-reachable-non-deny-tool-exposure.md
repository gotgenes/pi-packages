---
issue: 815
issue_title: "pi-permission-system: bash tool hidden entirely when surface catch-all is deny, even with more permissive nested patterns"
---

# Expose a tool when any rule under its surface is reachably non-deny

## Release Recommendation

**Release:** ship independently

[#815] appears in no Phase 14 roadmap step, and no step names `permission-manager.ts`'s tool-level query or `handlers/before-agent-start.ts`.
It is a third-party bug report against a surface the capability axis does not touch, so it follows [#821]'s precedent — out of scope for the roadmap, fixed and released on its own.

## Problem Statement

Phase-1 tool filtering asks `getToolPermission(toolName)` whether a tool should reach the model, and that method evaluates the surface against the **literal string `"*"`** as the candidate value ([`src/permission-manager.ts:263`](../../src/policy/permission-manager.ts)).
So it only ever reads the surface's own catch-all entry.
Any surface written as a pattern map whose catch-all is `deny` is therefore hidden from the model entirely, no matter what exceptions sit under it — the agent never sees the tool, so it can never issue the command the operator explicitly wanted to be asked about.

Measured at `bb00a11` with an in-memory `PermissionManager` (spike deleted before commit):

| Config under `permission`                | `getToolPermission("bash")` | Gate verdict, `git status` | Gate verdict, `rm -rf /` |
| ---------------------------------------- | --------------------------- | -------------------------- | ------------------------ |
| `bash: {"*":"deny","git *":"ask"}`       | `deny` → hidden             | `ask`                      | `deny`                   |
| `bash: {"git *":"ask","*":"deny"}`       | `deny` → hidden             | `deny`                     | `deny`                   |
| `read: {"*":"deny","~/notes/*":"allow"}` | `deny` → hidden             | —                          | —                        |

Row 1 is the reported defect: a reachable `ask` exists and the tool is hidden anyway.
Row 3 shows it is not bash-specific — every per-tool path map with a `deny` catch-all is hidden the same way.
Row 2 is the case where hiding is *correct*: last-match-wins means a catch-all written last shadows the exception above it, so nothing is reachable.

The package's own `docs/configuration.md` publishes a recipe with row 1's shape — [Restricted Bash Surface](../configuration.md) is `bash: {"*": "deny", "git status": "allow", "git diff": "allow", "git log *": "allow"}` — and that documented recipe hides the Bash tool today.

## Goals

- A tool reaches the model whenever **some** value could resolve to a non-`deny` action under the composed ruleset for that surface.
- A tool is still hidden when every reachable value resolves to `deny` — including the shadowed case in row 2, where an exception is written above a later catch-all.
- The reachability question is a distinct, named question, separate from `getToolPermission`, whose published meaning ("the surface catch-all state") is unchanged.
- Third-party consumers doing the same tool pre-filtering can ask the same question: the new predicate is published on `PermissionsService` and documented in `docs/cross-extension-api.md`.

This change is **not breaking**.
It changes no default, removes no export, and alters no existing method's answer.
`PermissionsService` gains one member, which is additive for every caller; only a *fake* built against the old interface (a test double) fails to typecheck on upgrade.

## Non-Goals

- Changing `getToolPermission`'s semantics.
  It keeps answering the surface catch-all state, and `docs/cross-extension-api.md` keeps documenting it as such.
- Adding the predicate to `PermissionQuery`, the narrow projection handed to `Authorizer` chain links.
  A link adjudicates one ask against one concrete value; tool pre-filtering is a `PermissionsService` use, and ISP says the link's view should not grow for it.
- Any change to Phase-2 invocation gating.
  The gate pipeline is untouched; this plan only decides visibility.
- Making session approvals participate in exposure.
  `getToolPermission` reads the composed **config** rules with no session layer, and the new predicate reads the same list.
  A session grant cannot un-hide a tool, and cannot need to: the tool must already have been visible for the call that produced the grant.
- Signalling in the system prompt that a visible tool is mostly denied.
  The `Available tools:` narrowing continues to follow the filtered active set and nothing more.
- Re-litigating [#797]'s answer (a config recipe for spreadsheet-cell operands) or any other open bash-surface issue.

## Background

Relevant modules, and the constraints that bear on them:

- [`src/rule.ts`](../../src/policy/rule.ts) — the decision engine.
  `evaluate(surface, value, rules, flavor)` returns the **last** rule whose surface and pattern both wildcard-match, or a synthesized `ask` default.
  `ruleMatches` matches the surface exactly (`wildcardMatch(rule.surface, surface)`) and applies `pathMatchOptions` to the value side only for `PATH_SURFACES`.
- [`src/wildcard-matcher.ts`](../../src/policy/wildcard-matcher.ts) — `compileWildcardPattern` runs `expandHomePath` on the **pattern** side only; the value side gets separator folding but no home expansion.
  A trailing `" *"` compiles to `( .*)?`, so `"git *"` matches bare `"git"`.
- [`src/permission-manager.ts`](../../src/policy/permission-manager.ts) — `resolvePermissions(agentName)` produces the cached `composedRules`.
  Two composition-stage rewrites apply to that list: the yolo `ask`→`allow` rewrite is deliberately applied **post-cache** inside `check()` so display surfaces stay yolo-free ([#526]), while the fail-closed `allow`→`ask` floor is applied **at composition** so display surfaces do reflect it ([#646]).
  Reading `composedRules` therefore inherits the fail-closed floor and not the yolo rewrite — which is exactly what an exposure decision wants, since neither rewrite creates or removes a `deny`.
- [`src/handlers/before-agent-start.ts`](../../src/handlers/before-agent-start.ts) — `shouldExposeTool` is a pure exported helper taking a permission-lookup callback; `AgentPrepHandler.handle` iterates `toolRegistry.getActive()` and passes the survivors to `setActive` and to `sanitizeAvailableToolsSection`.
  Filtering is restrict-only: the active set is the base and tools are only ever removed ([#385]).
- [`src/service.ts`](../../src/service.ts) — `PermissionQuery` declares `checkPermission` + `getToolPermission`; `PermissionsService extends PermissionQuery` and adds the registration surfaces.
- `linkWorkspacePackages: false` in `pnpm-workspace.yaml` means `packages/pi-permission-model-judge` resolves `@gotgenes/pi-permission-system` from **npm 27.0.0**, not the workspace.
  Its `makeService` fake is therefore unaffected by this change, and the plan stays single-package.

AGENTS.md constraints that apply: architecture-doc module-tree entries describe current behavior and carry an issue ref only when it encodes an active constraint (so the tree edits here add no `(#815)`); a step that reworks a documented mechanism's wording must also grep `.pi/skills/package-*/SKILL.md`; and a step adding a required member to a shared interface must fold every construction site into the same commit.

## Design Overview

### The question, named

Exposure asks a different question from `getToolPermission`, with a different burden of proof — the `code-design` skill's "shared predicate, different burden of proof".
`getToolPermission` is a classifier: "what does this surface's catch-all say?"
Exposure is a guard: "is *every* invocation of this tool denied?"
Reusing the first as the second is what produced the defect.
So the guard gets its own name at every layer: `isSurfaceFullyDenied` in the rule engine, `isToolFullyDenied` on the manager, resolver, and service.

### Reachability by pattern probe

An exact answer ("does any string resolve non-`deny`?") is glob-language emptiness and is not worth building.
The probe approximates it by treating each **configured pattern on the surface** as a representative value, and running it through the one existing `evaluate`:

```typescript
export function isSurfaceFullyDenied(
  surface: string,
  rules: Ruleset,
  flavor: PathFlavor,
): boolean {
  for (const value of probeValuesForSurface(surface, rules)) {
    if (evaluate(surface, value, rules, flavor).action !== "deny") return false;
  }
  return true;
}

function probeValuesForSurface(surface: string, rules: Ruleset): Set<string> {
  const values = new Set<string>(["*"]);
  for (const rule of rules) {
    // Mirrors ruleMatches' surface side: the universal `*` rule matches too.
    if (wildcardMatch(rule.surface, surface)) values.add(expandHomePath(rule.pattern));
  }
  return values;
}
```

Three properties make it correct on the measured cases:

1. **Every configured pattern is probed, not just `"*"`.**
   Row 1's `"git *"` becomes a candidate value, `evaluate` finds it as the last match, and the surface is not fully denied.
2. **`evaluate` is the probe, so last-match-wins shadowing is respected.**
   In row 2 the candidate `"git *"` is matched by the later `"*": deny` rule, which wins, so the surface *is* fully denied and the tool stays hidden.
   An ordering-blind "does any non-deny rule exist on this surface" scan gets this wrong.
3. **Candidates are home-expanded, mirroring `compileWildcardPattern`.**
   Measured: without `expandHomePath`, row 3's `"~/notes/*"` candidate does not match its own compiled pattern (which expanded to an absolute path), so the probe reports fully-denied and the `read` tool stays wrongly hidden.
   With it, the probe reports reachable.
   The same holds for the `$HOME` and `${HOME}` spellings.
   Measured invariant: every pattern in `["*", "git *", "git", "npm i*", "a?c", "~/x/*", "$HOME", "*.env", "/a/b c/*", "exa:*", "**"]` matches itself after expansion.

The universal `permission["*"]` entry composes as a `{surface:"*", pattern:"*", layer:"default"}` rule rather than a config-layer rule, but it is in `composedRules` and its surface wildcard-matches every tool, so `permission: {"*": "deny"}` alone still reports every tool fully denied.
Measured.

### Call-site sketches

`AgentPrepHandler.handle`, after the rewire:

```typescript
if (
  shouldExposeTool(toolName, agentName, (t, a) =>
    this.resolver.isToolFullyDenied(t, a),
  )
) {
  allowedTools.push(toolName);
}
```

`shouldExposeTool` becomes the negation and nothing else:

```typescript
export function shouldExposeTool(
  toolName: string,
  agentName: string | null,
  isToolFullyDenied: (toolName: string, agentName?: string) => boolean,
): boolean {
  return !isToolFullyDenied(toolName, agentName ?? undefined);
}
```

A third-party consumer, replacing the idiom `docs/cross-extension-api.md` publishes today:

```typescript
const permissions = getPermissionsService(sessionId);
const usable = tools.filter((t) => !permissions.isToolFullyDenied(t, agentName));
```

### Safety direction

Phase 1 decides visibility; Phase 2 re-evaluates the real command or path against the same ruleset and is untouched.
Exposing a tool that turns out to be fully denied costs tokens and a refusal, never an authorization.
So every way the probe can be wrong errs toward a denial the gate still enforces.

## Module-Level Changes

### Source

- **`src/rule.ts`** — add exported `isSurfaceFullyDenied(surface, rules, flavor): boolean` and the private `probeValuesForSurface(surface, rules)` helper below it (stepdown rule).
  Add the `expandHomePath` import (file-local style is `./`-relative for same-directory siblings).
- **`src/permission-manager.ts`** — add `isToolFullyDenied(toolName, agentName?): boolean` to the `ScopedPermissionManager` interface (near line 85) and to the class beside `getToolPermission` (near line 263): resolve `composedRules` via `this.resolvePermissions(agentName)` and delegate to `isSurfaceFullyDenied(toolName.trim(), composedRules, this.flavor)`.
  `getToolPermission` is untouched.
- **`src/permission-resolver.ts`** — one-line `isToolFullyDenied` delegation beside `getToolPermission` (near line 129).
- **`src/handlers/before-agent-start.ts`** — `shouldExposeTool`'s third parameter becomes `isToolFullyDenied` and the body becomes its negation; rewrite the doc comment, which currently describes the catch-all semantics ("so that a blanket `bash: deny` hides the tool entirely").
  `AgentPrepHandler.handle` (line 72) passes `this.resolver.isToolFullyDenied`.
- **`src/service.ts`** — add `isToolFullyDenied(toolName, agentName?): boolean` to `PermissionsService` (**not** `PermissionQuery`), with a doc comment stating it answers whether every value under the surface resolves to `deny`.
- **`src/permissions-service.ts`** — add the member to the private `ResolverForService` interface (line ~27) and an `isToolFullyDenied` delegation on `LocalPermissionsService` beside `getToolPermission` (line ~77).

No export is removed or renamed, so no removed-symbol grep is required.
`isSurfaceFullyDenied` is a package-internal export consumed by `permission-manager.ts`; `isToolFullyDenied` reaches `dist/public.d.ts` through `PermissionsService`.

### Tests

- **`test/rule.test.ts`** — new `describe("isSurfaceFullyDenied")` with locally-scoped `Rule` fixtures, matching the file's existing per-`describe` convention.
- **`test/helpers/session-fixtures.ts`** — `makeFakePermissionManager` gains `isToolFullyDenied: vi.fn().mockReturnValue(false)`.
- **`test/permission-resolver.test.ts`** — the local `makePermissionManager` is replaced by an alias onto `makeFakePermissionManager` (preparatory step), then a delegation test is added.
- **`test/helpers/service-fixtures.ts`** — new; `makeFakePermissionsService(overrides: Partial<PermissionsService> = {})` (preparatory step).
- **`test/service.test.ts`, `test/service-lifecycle.test.ts`, `test/authority/inherited-registrations.test.ts`** — each drops its local `makeService` for the shared fixture (preparatory step).
- **`test/handlers/before-agent-start.test.ts`** — the five `shouldExposeTool` tests move to the boolean callback; `makeSetup`'s `toolPermission?: "allow" | "deny" | "ask"` option becomes `toolFullyDenied?: boolean` driving `permissionManager.isToolFullyDenied`; the `filters out denied tools from allowed list` and `narrows a denied tool out of the Available tools listing` tests follow it.
- **`test/permission-manager-unified.test.ts`** — a sibling `describe("isToolFullyDenied")` beside the existing `getToolPermission` block (line ~1063); the `ScopedPermissionManager` structural assertion (line ~1589) gains the new member.
- **`test/permissions-service.test.ts`** — the fake resolver gains `isToolFullyDenied` and a delegation test.
- **`test/permission-manager-fail-closed.test.ts`, `test/permission-manager-yolo.test.ts`** — one assertion each pinning that the composition-stage rewrites do not move the exposure answer (see Invariants at risk).

### Docs

- **`docs/architecture/architecture.md`**
  - Line ~336 (`### Path-bearing tool normalization`): the sentence "`getToolPermission()` is unaffected — it always evaluates with `"*"` to determine whether to inject the tool at agent start" is now wrong about injection.
    Rewrite: `getToolPermission()` still evaluates with `"*"`, but injection asks `isToolFullyDenied` instead.
  - Line ~460 (`### Phase 1: Tool filtering`): rewrite to describe the probe — "is every value under this surface denied?"
    — replacing the `evaluate(toolName, "*", rules)` description.
  - Line ~553 (`## Cross-extension service accessor`): "exposes five methods" → six, with an `isToolFullyDenied` bullet.
  - Module-tree entries: `permission-resolver.ts` (line ~822) and `permissions-service.ts` (line ~882) list `getToolPermission` and gain `isToolFullyDenied`; `handlers/before-agent-start.ts` (line ~857) names the `shouldExposeTool` helper and needs no symbol change, but its description should not imply the catch-all rule.
    Per the architecture-doc convention these are current-behavior edits with no issue ref.
  - `#### Open-issue sweep dispositions` (line ~1004): add a `[#815]` line recording it as out of scope for the roadmap and fixed independently, mirroring the existing `[#821]` entry, so `/finish-phase` reconciles the phase window cleanly.
- **`docs/cross-extension-api.md`** — add a `#### isToolFullyDenied` subsection after `#### getToolPermission` (line ~130); correct the `getToolPermission` example, which currently publishes the buggy filtering idiom (`getToolPermission(t, agentName) === "deny"`), pointing it at the new predicate.
  Also add the member to the interface listing at line ~73.
- **`docs/configuration.md`**
  - `### Tool Surfaces` (line ~272): a paragraph after "Unknown or absent tools are not required in the config" stating that a tool is withheld from the model only when every pattern configured under its surface resolves to `deny`, and that an exception written *after* a `deny` catch-all keeps the tool visible while one written *before* it is shadowed and does not.
  - `## Pi Integration Hooks` → "Additional behaviors" (line ~1145): a bullet stating the same rule for the filtered active set.
  - `### Restricted Bash Surface` (line ~980): a sentence noting the recipe keeps the Bash tool visible because `git status` is reachable.
- **`.pi/skills/package-pi-permission-system/SKILL.md`** — the Implementation Priorities bullet "Hide denied tools from the agent before it starts (tool filtering + system-prompt sanitization)" (line 30) states the mechanism this change reworks and carries no removed symbol, so it must be reworded to the reachability rule.

Files listed here appear in no Non-Goal.

## Test Impact Analysis

1. **New tests the extraction enables.**
   `isSurfaceFullyDenied` is a pure function over `(surface, rules, flavor)`, so the reachability semantics — probe coverage, shadowing, home expansion, the universal-fallback rule — become direct `rule.test.ts` unit tests with hand-built `Ruleset` literals, with no manager, config file, or handler in the way.
   None of that was reachable before: the semantics lived inside a one-line `evaluate(..., "*", ...)` call whose only observable was a `PermissionState`.
2. **Tests that become redundant.**
   None are removed.
   The five `shouldExposeTool` tests are *rewritten* rather than retired — they still pin the pure helper's contract (negation, `null`→`undefined` agent-name conversion, agent-name passthrough), now against a boolean callback.
   The three `makeService` locals and the one `makePermissionManager` local are deleted by the preparatory steps, but every test that used them keeps running unchanged.
3. **Tests that must stay as-is.**
   `permission-manager-unified.test.ts`'s `getToolPermission` describe block — `getToolPermission` keeps its meaning and these tests are the pin on that; the `AgentPrepHandler` restrict-only test (`does not activate registered tools pi left inactive`); the `Available tools:` narrowing and byte-stability tests; every Phase-2 gate test.

The input domain for the new parser-shaped code is the pattern language itself, not the examples that come to mind, so `rule.test.ts` covers: `"*"`; a trailing-`" *"` pattern; a `?` pattern; a `~`/`$HOME`/`${HOME}` pattern; a path-glob pattern (`"*.env"`); an MCP-shaped pattern (`"exa:*"`); a pattern containing a space; and `"**"` (which compiles identically to `"*"`, per the package's own doc rule).

## Invariants at risk

- **Restrict-only filtering ([#385]).**
  The active set starts from `toolRegistry.getActive()` and tools are only ever removed.
  This change can only make the surviving set *larger than the buggy result*, never larger than the base — `shouldExposeTool` is still a filter predicate inside the same loop.
  Pinned by `does not activate registered tools pi left inactive (find/grep/ls)` in `test/handlers/before-agent-start.test.ts`, which passes a `getAll` wider than `getActive` and asserts on the `getActive` set.
  Opened and confirmed it exercises the real handler over a real `PermissionResolver` (via `makeSetup`), not a mocked filter.
- **Display surfaces reflect the fail-closed floor but not the yolo rewrite ([#526], [#646]).**
  Both invariants live in prose plus tests that assert on `getToolPermission`.
  The new predicate reads the same `resolvePermissions().composedRules`, so it inherits the same posture — but neither rewrite creates or removes a `deny` (`rewriteAsksToYolo` touches only `ask`; `floorAllowsToAsk` touches only `allow`), so **neither can change the exposure answer**.
  That is currently pinned nowhere, so add one assertion to each file: under yolo, a `bash: "deny"` surface is still fully denied; under an invalid non-global scope, a floored `allow`→`ask` surface is **not** fully denied.
- **`Available tools:` byte-stability across turns.**
  Pinned by `keeps the wire system prompt byte-stable across the tool-listing drift between turns`.
  The change alters *which* tools are in the set for one config shape, not whether the set is recomputed deterministically, so the invariant holds; the test stays as-is.

Quantitative note: the probe's cost is `|candidates| × |rules|` wildcard matches per tool per `before_agent_start`.
Candidates are bounded by the number of rules whose surface matches the tool, which for a realistic config is single digits; `rules` is tens.
This is estimated, not measured — no measurement is warranted because the loop is inside a per-turn handler that already walks the full ruleset for skill sanitization.

## TDD Order

1. **`test:` alias the resolver test's local manager fake onto the shared fixture.**
   Preparatory (Tidy First): `test/permission-resolver.test.ts:12` hand-rolls a `ScopedPermissionManager` fake that duplicates `makeFakePermissionManager` in `test/helpers/session-fixtures.ts` byte for byte, and `permission-session.test.ts:33` already solved this with `const makePermissionManager = makeFakePermissionManager;`.
   Without it, step 4's new required interface member has to be added to two fakes instead of one.
   Delete the local function, import the helper, alias it; no call site changes.
   Verify: `pnpm --filter @gotgenes/pi-permission-system run test` green.
   No new assertions, so no killing mutation — this step's correctness is the unchanged suite.
   Commit: `test(pi-permission-system): reuse the shared permission-manager fake in the resolver suite`

2. **`test:` extract a shared `PermissionsService` fake.**
   Preparatory (Tidy First): `test/service.test.ts:19`, `test/service-lifecycle.test.ts:30`, and `test/authority/inherited-registrations.test.ts:23` each hand-roll the identical seven-member `PermissionsService` literal.
   Without it, step 5's new required member has to be added in three places.
   Add `test/helpers/service-fixtures.ts` exporting `makeFakePermissionsService(overrides: Partial<PermissionsService> = {})` — the two files that already take an overrides bag keep their call shape, and the parameterless one is a strict subset — and migrate all three.
   Verify: full package suite green.
   No killing mutation, for the same reason as step 1.
   Commit: `test(pi-permission-system): extract a shared PermissionsService test fake`

3. **`refactor:` add the reachability probe to the rule engine.**
   Red: `test/rule.test.ts` gains `describe("isSurfaceFullyDenied")` covering — an exception written after a `deny` catch-all is reachable; an exception written before it is shadowed and the surface is fully denied; a bare `{surface, "*", deny}` is fully denied; a universal `{surface:"*", pattern:"*", deny}` makes every tool fully denied; a `~`-prefixed pattern is reachable; the `$HOME`/`${HOME}` spellings likewise; a surface with no rules at all is not fully denied (it falls to the synthesized `ask`); and the pattern-shape sweep from Test Impact Analysis.
   Green: `isSurfaceFullyDenied` + `probeValuesForSurface` in `src/rule.ts`.
   Nothing imports it yet, so this is `refactor:` per the repo's commit-typing rule.
   Killing mutations, one per equivalence class:
   - Make `probeValuesForSurface` return `new Set(["*"])` — the reachable-exception, `~`-pattern, and `$HOME` tests must go red; the shadowed, bare-deny, and universal-deny tests must stay green.
   - Drop `expandHomePath` from the candidate — the `~`, `$HOME`, and `${HOME}` tests must go red; every bash-surface test must stay green.
   - Replace the loop body with `rules.some((r) => wildcardMatch(r.surface, surface) && r.action !== "deny")` — the shadowed-exception test must go red; the reachable-exception test must stay green.

   Commit: `refactor(pi-permission-system): add a surface reachability probe to the rule engine`

4. **`fix:` keep a tool visible when its surface has a reachable non-deny rule.**
   Red: `test/permission-manager-unified.test.ts` gains `describe("isToolFullyDenied")` — `bash: {"*":"deny","git *":"ask"}` is not fully denied while `bash: "deny"` is, and `read: {"*":"deny","~/notes/*":"allow"}` is not; `test/handlers/before-agent-start.test.ts`'s rewritten `shouldExposeTool` block and its `filters out denied tools` / `Available tools:` narrowing tests drive the boolean callback.
   `test/permission-resolver.test.ts` gains a delegation test.
   Green: the `ScopedPermissionManager` member, the manager method, the resolver delegation, `shouldExposeTool`'s new parameter and doc comment, the `AgentPrepHandler` call site, `makeFakePermissionManager`'s new member, and `makeSetup`'s `toolFullyDenied` option — all in one commit, because adding a required member to `ScopedPermissionManager` breaks every construction site at compile time.
   Add the fail-closed and yolo assertions from Invariants at risk here.
   Killing mutations:
   - Make `PermissionManager.isToolFullyDenied` return `this.getToolPermission(toolName, agentName) === "deny"` (the pre-fix semantics) — the manager's reachable-exception tests and the handler's exposure test must go red.
   - Delete the `shouldExposeTool` call in `AgentPrepHandler.handle` and push every tool unconditionally — `filters out denied tools from allowed list` and `narrows a denied tool out of the Available tools listing` must go red.
     (The call site moves in this step, so it needs its own mutation rather than riding the pure helper's.)

   Commit: `fix(pi-permission-system): stop hiding a tool whose surface has a reachable non-deny rule (#815)`

5. **`feat:` publish the predicate cross-extension.**
   Red: `test/permissions-service.test.ts` gains an `isToolFullyDenied` delegation test (called with `(toolName, agentName)`, return value passed through) and the fake resolver gains the member.
   Green: the member on `PermissionsService` and `ResolverForService`, the `LocalPermissionsService` delegation, the new member's default on `makeFakePermissionsService`, and the `docs/cross-extension-api.md` entry.
   Killing mutation: make `LocalPermissionsService.isToolFullyDenied` return `this.resolver.getToolPermission(toolName, agentName) === "deny"` — the delegation test asserting `resolver.isToolFullyDenied` was called must go red.
   Commit: `feat(pi-permission-system): publish isToolFullyDenied for cross-extension tool pre-filtering (#815)`

6. **`docs:` bring the architecture, configuration, and skill docs in line.**
   All the Docs entries in Module-Level Changes, in one commit.
   Verify: `pnpm exec rumdl check` on each edited file, and re-grep `.pi/skills/` and `packages/pi-permission-system/docs/` for the phrase "evaluates with `\"*\"`" and for "hides the tool entirely" to confirm no stale copy survives.
   Commit: `docs(pi-permission-system): describe tool exposure as surface reachability (#815)`

## Risks and Mitigations

| Risk                                                                                                                        | Mitigation                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The probe is an approximation: a pathological pattern pair could make a fully-denied surface look reachable, or vice versa. | Neither direction authorizes anything — Phase 2 re-evaluates the real value against the same ruleset. The worst case is a visible tool that refuses every call, which is the pre-#815 status quo inverted. Recorded in Design Overview rather than mitigated by mechanism.                                                                                                            |
| A user who wrote `bash: {"*": "deny", …}` expecting the tool to be hidden now sees it.                                      | That shape is exactly what the report and the package's own Restricted Bash Surface recipe intend to be partially permissive. A user who wants the tool hidden outright writes `bash: "deny"`, which still hides it — pinned by a step-4 test.                                                                                                                                        |
| Adding a required member to `PermissionsService` breaks a downstream test double on upgrade.                                | Type-level and test-only; no runtime caller breaks, since consumers call the interface and do not implement it. `packages/pi-permission-model-judge` resolves the published 27.0.0 (`linkWorkspacePackages: false`), so its `makeService` fake breaks only when it bumps, where `tsc` catches it immediately. Noted in the interface's doc comment rather than versioned as breaking. |
| The home-expansion asymmetry is easy to reintroduce if `probeValuesForSurface` is later "simplified".                       | The `~`/`$HOME`/`${HOME}` tests in step 3 are named for the asymmetry, and the step's second killing mutation is exactly that simplification.                                                                                                                                                                                                                                         |
| `expandHomePath` reads `os.homedir()`, so the probe is not a pure function of its arguments.                                | It is the same impurity `compileWildcardPattern` already has on the pattern side, and symmetry with it is the point. Tests build patterns from the `~`/`$HOME` prefixes rather than hard-coded absolute paths.                                                                                                                                                                        |

## Open Questions

None blocking.

The `rule.ts:143` stale duplicate doc comment (flagged by the Phase 14 craftsmanship scout, on `evaluateMostRestrictive`) sits in a file this change touches but not at its insertion point; the Tidy-First assessor declined it as scope creep and this plan follows that, leaving it to a craftsmanship round.

[#385]: https://github.com/gotgenes/pi-packages/issues/385
[#526]: https://github.com/gotgenes/pi-packages/issues/526
[#646]: https://github.com/gotgenes/pi-packages/issues/646
[#797]: https://github.com/gotgenes/pi-packages/issues/797
[#815]: https://github.com/gotgenes/pi-packages/issues/815
[#821]: https://github.com/gotgenes/pi-packages/issues/821
