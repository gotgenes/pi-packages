---
issue: 1108
issue_title: 'pi-permission-system: agent frontmatter "*": deny does not override a global allow'
---

# A later scope's patterns are placed after an earlier scope's

## Release Recommendation

**Release:** ship independently

The Phase 16 roadmap step for this issue carries `Release: independent`, and the roadmap's `Release batches` subsection says there is no batch.
The change is breaking (`fix!:`), and the README commits each breaking change to its own release, so it cuts its own major.

## Problem Statement

An agent whose frontmatter sets `bash: { "*": "deny" }` can still run `git status` when the global config allows `"git *"`.
`PermissionManager.resolvePermissions` merges the scopes' raw permission objects with `mergeFlatPermissions` before normalizing them, and a JavaScript spread keeps a redefined key at its original position.
The merged map is `{ "*": "deny", "git *": "allow" }`, so the agent's catch-all sits in front of the global allow, and last-match-wins picks the allow.
Two documented statements collide: "both-object shallow-merges pattern maps" (`docs/configuration.md`, Merge Precedence) and "last matching rule wins" (README).

ADR 0016 §2 decides the outcome: a later scope's patterns are placed after an earlier scope's, so a redefined key moves to the later scope's position and a later scope's catch-all overrides an earlier scope's specific patterns.
The issue was filed by a third party (@smb374); the operator's reply on the issue confirms ADR 0016 §2 as the direction and keeps this issue as the implementing one.

## Goals

- Compose the config band scope by scope: each scope's rules are normalized on their own, stamped with that scope's origin, and placed after every earlier scope's rules.
  A `(surface, pattern)` pair a later scope redefines appears once, at the later scope's position.
- The reporter's scenario denies `git status`, and the bash tool is withheld from that agent because every bash pattern now resolves to `deny`.
- The universal `permission["*"]` stays the fallback for checks no rule matches; the last scope that sets it decides (operator decision).
- A top-level `mcp__…` key is relocated onto the `mcp` surface within its own scope, so a later scope's `mcp` rule overrides an earlier scope's relocated key.
- `mergeScopesWithOrigins`, its parallel origin map, and `buildConfigRules` are deleted.
- `mergeFlatPermissions`, which now feeds only the startup warning about an ungated bash, keeps an earlier scope's string catch-all when a later scope supplies a pattern map, so the warning agrees with the composed policy (operator decision: align it now).
- **Breaking.**
  A scope that restates a catch-all now overrides the earlier scopes' specific patterns on that surface; an earlier scope's string catch-all now survives a later scope's pattern map; a later scope's `mcp` rules now override an earlier scope's top-level `mcp__` key.
  Shipped as `fix(pi-permission-system)!:` with a `BREAKING CHANGE:` footer, and a README `Upgrading` entry.

## Non-Goals

- Turning a later scope's universal `"*"` into a rule that overrides earlier scopes' surface rules.
  The operator chose "stays the fallback": a trusted project's `"*": "allow"` would otherwise erase every global deny.
- Rejecting a pattern map under the universal `"*"` key.
  The schema accepts it and the policy ignores it today (measured: a global `{"*": {"*": "deny"}}` loads with no issue and resolves `read` to `ask`, origin `global`).
  This plan preserves that behavior; filed as [#1147], folded into [#1127].
- Moving the bash-ungated warning onto the composed rules, or removing the `permission` half of `mergeUnifiedConfigs`.
  That is [#1028]'s single-read rework; this plan only keeps the warning accurate.
- Reordering keys inside `mergeFlatPermissions`.
  Its only reader, `detectPermissiveBashFallback`, reads key presence, never order, so an ordering clause would be untestable mechanism (narrowed from the gate's wording after the Tidy-First assessment).
- Giving `normalizeFlatConfig` an `origin` parameter in place of the `"builtin"` stamp every caller overwrites.
  Recorded as a deferred tidying.
- The session layer's precedence against config denies ([#1120]) and the `config.local.json` slots ([#1122]); both build on this order.

## Background

- `src/policy/permission-manager.ts` `resolvePermissions` loads `PolicyScope[]` from `PolicyLoader.loadScopes` ([#1134] made the scopes one ordered list), then calls `mergeScopesWithOrigins`, reads the universal fallback from `mergedPermission["*"]` and its origin from the origin map, builds config rules with the private `buildConfigRules`, relocates top-level `mcp__` keys over the whole band with `relocateMcpToolKeyRules`, and composes `defaults → baseline → config` with `composeRuleset`.
  The fail-closed floor ([#646]) is applied to the composed rules afterwards; yolo is applied post-cache in `check`.
- `src/policy/scope-merge.ts` `mergeScopesWithOrigins` (cognitive complexity 29 per the roadmap's fallow run) re-implements `mergeFlatPermissions`' both-objects predicate to keep a `surface → pattern → origin` map beside the merge.
  It calls `expandDirectionalSugar` per scope, before the merge, so sugar-derived rules keep their authoring scope (ADR 0013 §9).
- `src/policy/normalize.ts`: `expandDirectionalSugar`, `normalizeFlatConfig` (stamps `origin: "builtin"`), `relocateMcpToolKeyRules` (appends each relocated copy after every other rule).
- `src/policy/synthesize.ts` `synthesizeBaseline(configRules)` emits the MCP discovery auto-allows when any config rule is an `mcp` allow; it reads the rules as written, before relocation, so a relocated allow on one Pi MCP tool does not open the discovery targets.
- `src/policy/permission-merge.ts` `mergeFlatPermissions` is also called by `src/config/config-loader.ts` `mergeUnifiedConfigs` for the runtime-config view (global and project `config.json`, plus the legacy files [#1126] retires); that view's `permission` is read only by `detectPermissiveBashFallback`.
- `getComposedConfigRules` feeds `/permission-system show` (`src/config/config-modal.ts` `formatRulesSummary`), which lists config rules in band order.
- AGENTS.md: pnpm only; run package commands from the repo root (`pnpm --filter @gotgenes/pi-permission-system …`).
  `fallow guard` allows `policy/` to import `config/` (checked for `permission-manager.ts`), so the new module may take `PolicyScope` from `#src/config/policy-loader`; `policy-loader.ts` imports only `policy/rule` from `policy/`, so no cycle forms.

## Design Overview

### How the repro was produced

Every number here was measured with disposable Vitest files under `packages/pi-permission-system/test/`, deleted before this plan was committed.

- **Reporter's scenario, real files.**
  `createManager` wrote a real global config file (`bash: {"*": "ask", "git *": "allow"}`) and a real `agents/locked.md` with frontmatter `bash: {"*": deny}`, read through `FilePolicyLoader`; `PermissionManager.check` ran as agent `locked`.
  Today: `git status` resolves `allow` (`git *`, global), `ls` resolves `deny`, `isToolFullyDenied("bash")` is `false`.
- **Prototype.**
  `resolvePermissions` was replaced in place by the per-scope fold this design describes (redefined pairs dropped from their earlier position, relocation per scope, a separate written-rules fold for the baseline), then reverted.
  Under it the same files gave `git status` → `deny` (`*`, agent) and `isToolFullyDenied("bash")` → `true`; the full package suite gave 6562 passed, 1 failed (the test at `permission-manager.test.ts:708`, which encodes the bug; see TDD step 1).
- The edge scenarios below came from `createInMemoryManager`, n = 1 each (the code is deterministic and uncached).

### Decision model

The config band becomes a fold over the scopes in precedence order:

```text
for each scope (global → project → agent → project-agent), skipping one with no permission:
  permission ← expandDirectionalSugar(scope.config.permission)
  if permission has "*":  fallback ← (isPermissionState ? value : "ask", origin: scope.name)
  written    ← normalizeFlatConfig(permission without "*"), stamped layer "config", origin scope.name
  relocated  ← relocateMcpToolKeyRules(written).rules          (step 3)
  rules        ← redefine(rules, relocated)
  writtenRules ← redefine(writtenRules, written)               (step 3)

redefine(earlier, later) = earlier minus every rule whose (surface, pattern) later defines, then later
```

`redefine` is the literal form of ADR 0016 §2's "a redefined key moves to the later scope's position".
Dropping the earlier copy cannot change any evaluation, since an identical `(surface, pattern)` later in the list matches whenever the earlier one does.
It keeps two readers as they are today: `/permission-system show` lists a redefined pair once, and `synthesizeBaseline` does not see a shadowed `mcp` allow (global `mcp: {"srv:tool": "allow"}` + project `mcp: {"srv:tool": "deny"}` would otherwise newly auto-allow `mcp_status`).

Within one scope nothing changes: ADR 0013 §4's normative intra-surface order and the file's key order stand.

### Behavior, before and after

| Scenario (measured)                                                                                               | Today                                                               | After                                                       |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| Global `bash: {"*": "ask", "git *": "allow"}`, agent `bash: {"*": "deny"}`: `git status`                          | allow (global)                                                      | deny (agent)                                                |
| Same: bash tool withheld from the agent                                                                           | no                                                                  | yes                                                         |
| Global `bash: "allow"`, project `bash: {"rm *": "deny"}`: `ls`                                                    | ask (builtin fallback; the project map discarded the global string) | allow (global)                                              |
| Global `bash: {"git *": "allow"}`, agent `"*": "deny"`: `git status` / `ls`                                       | allow / deny                                                        | allow / deny (unchanged: the universal `"*"` is a fallback) |
| Global top-level `mcp__srv__tool: "allow"`, agent `mcp: {"*": "deny"}`: `mcp__srv__tool`                          | allow (global)                                                      | deny (agent)                                                |
| Project-agent `skill: {"pi-*": "allow", "*": "deny"}` over a global-agent `skill: {"*": "ask"}`: `pi-code-review` | allow                                                               | deny (that scope's own last-match-wins)                     |

Unchanged by construction: a later string over an earlier pattern map (the later `"*"` shadows every earlier pattern on that surface, as today's replacement did), two scopes defining the same pattern (the later wins, as today), and the fail-closed floor (applied to the composed band, as today).
`/permission-system show` now lists rules scope by scope instead of in merged-key order.

### Data shapes

```typescript
// src/policy/scope-composition.ts
import type { PolicyScope } from "#src/config/policy-loader";

/** The universal fallback and the scope that set it. */
export interface UniversalFallback {
  action: PermissionState;
  origin: RuleOrigin;
}

/** The config layer composed from the scopes in precedence order. */
export interface ComposedScopes {
  /** Config-layer rules, each scope's after the scopes before it, relocated Pi MCP tool keys included. */
  rules: Ruleset;
  /** The same fold over the rules as written, before relocation; the MCP baseline reads these. (step 3) */
  writtenRules: Ruleset;
  /** Absent when no scope sets the universal `"*"`. */
  universalFallback: UniversalFallback | undefined;
  /** Each relocated top-level `mcp__` key, in scope order. (step 3) */
  relocatedMcpToolKeys: string[];
}

export function composeScopes(
  scopes: readonly Pick<PolicyScope, "name" | "config">[],
): ComposedScopes;
```

`composeScopes` reads only each scope's `name` and `config.permission`; `Pick<PolicyScope, "name" | "config">` excludes `floorsWhenInvalid`, which only the floor reads.
`writtenRules` is its own fold over each scope's written rules, not `rules` minus the copies: a relocated copy is indistinguishable from a written `mcp: {"mcp__srv__x": …}` rule, and an agent's top-level `mcp__srv__x: "deny"` copy redefines (drops) a global written `mcp: {"mcp__srv__x": "allow"}` in `rules` while the baseline must still see that allow (Tidy-First assessor's example, TDD step 3).

A universal `"*"` whose value is not a permission state (a pattern map, which the schema accepts, [#1147]) still sets the fallback to `ask` attributed to that scope, preserving the measured behavior.

### Consumer call site

```typescript
const scopes = this.loader.loadScopes(agentName);
const composed = composeScopes(scopes);
const fallback = composed.universalFallback ?? { action: DEFAULT_UNIVERSAL_FALLBACK, origin: "builtin" };
const composedRules = composeRuleset(
  synthesizeDefaults(fallback.action, fallback.origin),
  synthesizeBaseline(composed.writtenRules),
  composed.rules,
);
```

The manager tells `composeScopes` the scopes and consumes one value; it no longer reaches into an origin map or a merged object.
The default `ask` stays the manager's constant, since it is the manager's policy when no scope speaks.

### The runtime-config merge

`mergeFlatPermissions` keeps its three cases with one change: when the base value is a string and the override is a pattern map without a `"*"` key, the base string survives as the map's `"*"` entry (`{bash: "ask"}` + `{bash: {"git *": "allow"}}` → `{bash: {"*": "ask", "git *": "allow"}}`).
That is the composed band's meaning for the same two scopes, so `detectPermissiveBashFallback` stops warning that bash is ungated when an earlier scope's bash catch-all still applies.
The other false-signal direction cannot occur: every other case already agrees with the band on whether bash has a `"*"`.

### Edge cases and where each is tested

| Edge case                                                                  | Step                                       |
| -------------------------------------------------------------------------- | ------------------------------------------ |
| Redefined pair moves, not duplicated                                       | 2 (unit; `show` rules; baseline)           |
| Object after string keeps the earlier string                               | 2 (unit; manager)                          |
| String after object shadows the earlier patterns                           | 2 (unit)                                   |
| Universal `"*"` stays a fallback; last scope decides; absent → `undefined` | 2 (unit; manager)                          |
| Non-state universal `"*"` → `ask` from that scope                          | 2 (unit)                                   |
| Sugar expands per scope with the authoring origin                          | 2 (unit)                                   |
| Scope with no `permission` skipped                                         | 2 (unit)                                   |
| Relocation per scope; `writtenRules` is its own fold                       | 3 (unit; manager)                          |
| Mixed string/object merge keeps the warning accurate                       | 4 (unit; `mergeUnifiedConfigs` + detector) |

## Module-Level Changes

- **New** `src/policy/scope-composition.ts`: `composeScopes`, `ComposedScopes`, `UniversalFallback` (step 2; `writtenRules` and `relocatedMcpToolKeys` added in step 3).
- **New** `test/policy/scope-composition.test.ts` (steps 2–3), absorbing the still-meaningful cases of `scope-merge.test.ts` (string and map attribution, four-scope order, skipped scope, universal attribution).
- **Deleted** `src/policy/scope-merge.ts` (`mergeScopesWithOrigins`, `MergedScopes`) and `test/policy/scope-merge.test.ts` (step 2).
  Grep confirmed the only references are `permission-manager.ts:36,205,494`, the test file, `.pi/skills/package-pi-permission-system/SKILL.md` (sugar bullet), and `docs/architecture/architecture.md` (module tree line 950, roadmap prose).
- `src/policy/permission-manager.ts`: `resolvePermissions` calls `composeScopes`; delete private `buildConfigRules` (sole call site `:219`) and the `MergedScopes`/`mergeScopesWithOrigins` import; drop the now-unused `normalizeFlatConfig` import and, in step 3, the `relocateMcpToolKeyRules` import; `FlatPermissionConfig` and `isPermissionState` imports stay only if still read (re-check at commit).
- `src/policy/permission-merge.ts`: the string-base, map-override case (step 4); JSDoc rewritten to name its one consumer.
- `src/config/config-loader.ts`: JSDoc of `mergeUnifiedConfigs` (line 201, "deep-shallow merged") and the `// Permission: deep-shallow merge` comment (step 4); no logic change.
- `test/policy/permission-manager.test.ts`: step 1 reorders the YAML at `:708`; step 2 adds tests under `scope composition > precedence between scopes` and renames `:217` "string replaces object in override scope" and `:314` "object replaces string: …" to describe shadowing; step 3 adds the relocation test under `mcp > Pi MCP tools > a top-level mcp__ key keeps applying…`.
- `test/policy/permission-merge.test.ts`: "object replaces string" becomes "a string base survives a pattern-map override as its `"*"`", plus the override-defines-`"*"` case (step 4).
- `test/config/config-loader.test.ts`: one `mergeUnifiedConfigs` → `detectPermissiveBashFallback` case (step 4); the existing "object replaces string when override uses object for same surface" (`:527`) stays green because its override defines `"*"`.
- Docs (step 5):
  - `docs/configuration.md` § Merge Precedence: replace the deep-shallow sentence with the scope-by-scope rule, an example, and a deny-all-agent recipe (a surface catch-all overrides that surface; the universal `"*"` covers only surfaces no scope configures).
  - `README.md` § Upgrading: a "The major after 43.x" entry with the before/after of the reporter's config, the object-after-string case, and the `mcp__` key case.
  - `docs/glossary.md` § Scope: drop the "keeps the earlier scope's position … changing in [#1108]" sentence for the new rule.
  - `docs/architecture/architecture.md`: `## Composed ruleset` (the ASCII diagram's config band comment and the "not yet the per-scope concatenation" paragraph at lines ~236–241, reworded to the move-not-duplicate rule the assessor flagged); module tree lines 950–951 (`scope-merge.ts` → `scope-composition.ts`; `permission-merge.ts` described as the runtime-config view's merge); the roadmap step `#### [#1108]` gains `✅` and a `Landed:` note, and Mermaid node `S1108` gains `✅`.
  - `.pi/skills/package-pi-permission-system/SKILL.md`: the sugar bullet ("inside `mergeScopesWithOrigins` before origin bookkeeping and the merge") and the Configuration bullet ("The `permission` object uses deep-shallow merge").
  - Step 5 greps the whole `packages/pi-permission-system/docs/` tree, `README.md`, and `src/config/config-schema.ts` descriptions for `deep-shallow`, `shallow-merge`, `override wins entirely`, and `mergeScopesWithOrigins` before committing.
- **Predicted unchanged:**
  - `src/policy/normalize.ts`: `composeScopes` uses its three exports as they are.
  - `src/policy/synthesize.ts`: `synthesizeBaseline` receives `writtenRules`, which has the meaning it reads today.
  - `src/config/config-modal.ts`: it renders whatever order it is handed; no test pins the order (assessor: `config-modal.test.ts:133` feeds hand-built rules).
  - `test/policy/normalize.test.ts`, `test/policy/synthesize.test.ts`: no signature changes.
  - `src/config/policy-loader.ts`: `PolicyScope` is read, not changed.
  - `docs/decisions/0016-policy-channels.md`: its measurement 4 is a dated record of what was measured, and §2 already states the target.

## Test Impact Analysis

1. **Newly possible.**
   `composeScopes` is pure, so rule order, origin, and the fallback are asserted directly as full `Ruleset` values with `toEqual`.
   Today rule order is only observable through a manager decision, and origin only through the origin map's internals.
2. **Redundant.**
   `scope-merge.test.ts` goes with its module; its full-replacement cases asserted the old semantics and are not carried over.
   The manager's "precedence between scopes" tests stay as the integration layer.
3. **Must stay.**
   `permission-manager.test.ts` scope-composition, fail-closed, yolo, MCP relocation, and baseline describes exercise the composition through the manager and are the invariant pins below.

## Invariants at risk

| Invariant (source)                                                     | Constituency                                              | Pinned by                                                                                                                                                                                 |
| ---------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An invalid non-global scope floors `allow`→`ask` ([#646], ADR 0016 K3) | operators relying on a typo'd project deny failing closed | `permission-manager.test.ts` `an invalid non-global scope fails closed` (`:806`), incl. "floors a lower-scope allow to ask when a project scope is invalid" and the over-real-files table |
| Sugar-derived rules keep their authoring scope's origin (ADR 0013 §9)  | review-log and decision-event readers                     | new `scope-composition.test.ts` case (step 2); `paths > directional sugar` (`:3094`)                                                                                                      |
| A relocated `mcp__` allow does not open the proxy's discovery targets  | operators allowing one Pi MCP tool                        | `mcp > Pi MCP tools > … does not let a relocated allow open the proxy's discovery targets` (`:2825` block); step 3's `writtenRules` unit case                                             |
| The relocation port notice lists each key once                         | operators porting old configs                             | same block, "asks the operator to port the key"                                                                                                                                           |
| The cached composed ruleset and display surfaces stay yolo-free        | `/permission-system show`                                 | `yolo` describe (`:1132`)                                                                                                                                                                 |
| `getComposedConfigRules` returns config-layer rules only               | `/permission-system show`                                 | `composed config rules` (`:1065`), extended in step 2 to the full array for a redefined pair                                                                                              |

The prototype ran all of these green (6562 of 6563; the one red is step 1's test).

## TDD Order

1. **`test(pi-permission-system): put the project-agent skill catch-all before its exception`.**
   Reorder the project-agent YAML in "project-agent frontmatter skill rules override global-agent frontmatter skill rules" (`permission-manager.test.ts:708`) to `"*": deny` then `"pi-*": allow`.
   Tidy-First (Recommended): the test as written passes only because the global-agent's `"*"` holds the earlier position, which is this bug, and step 2 would otherwise have to flip it among its new reds.
   Green before and after the fix (the assessor traced both merges by hand: `{"*": deny, "pi-*": allow}` either way).
   No killing mutation: this step adds no assertion.
2. **`fix(pi-permission-system)!: place a later scope's patterns after an earlier scope's`.**
   - Red: `test/policy/scope-composition.test.ts` (full `toEqual` on `rules` and `universalFallback`) for every step-2 row of the edge-case table; manager tests under `scope composition > precedence between scopes`:
     - the reporter's scenario over real files (`createManager` with `agents/locked.md`), which pins the `evaluateAnyValue` resolver via `check` (`git status` → `deny`, origin `agent`);
     - `isToolFullyDenied("bash", "locked")` → `true`, which pins the `evaluate` resolver;
     - the universal fallback staying a fallback (global `bash: {"git *": "allow"}` + agent `"*": "deny"`: `git status` allow, `ls` deny);
     - object after string (`ls` → `allow`, origin `global`);
     - "a later scope's own key order decides" (step 1's original YAML order → `pi-code-review` denied);
     - a shadowed `mcp` allow does not synthesize the baseline (global `mcp: {"srv:tool": "allow"}` + project `mcp: {"srv:tool": "deny"}`: a discovery operation resolves as the fallback, mirroring the input of "still auto-allows a discovery operation no config rule can name");
     - `getComposedConfigRules` for a redefined pair, full array.

   - Green: add `scope-composition.ts` with `rules` and `universalFallback`; keep whole-band relocation in `resolvePermissions` for now (`relocateMcpToolKeyRules(composed.rules)`, baseline from `composed.rules`); delete `scope-merge.ts`, its test, and `buildConfigRules`; rename the tests at `:217` and `:314`.

   - Killing mutations:
     - prepend instead of append in the fold (`[...scopeRules, ...kept]`) → the reporter scenario, `isToolFullyDenied`, and the unit order cases go red;
     - remove the filter that drops redefined pairs → the move-not-duplicate unit case, the `getComposedConfigRules` case, and the baseline case go red;
     - emit a scope's universal `"*"` as a config rule `{ surface: "*", pattern: "*" }` → the fallback-stays-a-fallback cases go red;
     - drop the `expandDirectionalSugar` call → the sugar-origin unit case goes red;
     - stamp `origin: "builtin"` instead of the scope name → every origin assertion goes red.

   - Verify: `pnpm --filter @gotgenes/pi-permission-system exec vitest run && pnpm --filter @gotgenes/pi-permission-system run check`, then `pnpm fallow dead-code`.

   - Commit footer: a `BREAKING CHANGE:` paragraph ("a scope that restates a catch-all now overrides earlier scopes' specific patterns on that surface, and an earlier scope's string catch-all survives a later scope's pattern map"), then `Refs #1108`, then the final trailer paragraph:

     ```text
     Co-authored-by: Po-Yeh Chen <13521730+smb374@users.noreply.github.com>
     ```

     The reporter's expected behavior ("a higher-precedence scope's rules to come after the lower scope's rules") is the constraint ADR 0016 §2 adopts; verify the trailer with `git interpret-trailers --parse`.
3. **`fix(pi-permission-system)!: let a later scope's mcp rules override an earlier scope's top-level mcp__ key`.**
   - Red: unit cases for per-scope relocation (global top-level `mcp__srv__tool: "allow"` + agent `mcp: {"*": "deny"}` → the copy sits before the agent's rule), `relocatedMcpToolKeys` in scope order, and the assessor's `writtenRules` case (global `mcp: {"mcp__srv__x": "allow"}` + agent top-level `mcp__srv__x: "deny"`: `rules` drops the global allow, `writtenRules` keeps it); a manager test under `a top-level mcp__ key keeps applying to the Pi MCP tool it names` (`mcp__srv__tool` → `deny`, origin `agent`).
   - Green: move relocation into the per-scope fold, add `writtenRules` and `relocatedMcpToolKeys`, have `resolvePermissions` read them, drop its `relocateMcpToolKeyRules` import.
   - Killing mutations:
     - relocate once over the folded `rules` (today's placement) → the manager test and the copy-order unit case go red;
     - derive `writtenRules` by filtering relocated copies out of `rules` → the assessor's `writtenRules` case goes red.
   - Commit footer: `BREAKING CHANGE:` ("a later scope's `mcp` rules now override an earlier scope's top-level `mcp__` key").
4. **`fix(pi-permission-system): stop warning that bash is ungated when an earlier scope's bash catch-all still applies`.**
   - Red: `permission-merge.test.ts` "a string base survives a pattern-map override as its `"*"`" and "an override that defines `"*"` replaces the string base"; `config-loader.test.ts`: global `{"*": "allow", bash: "ask"}` merged with project `{bash: {"git *": "allow"}}` → `detectPermissiveBashFallback(merged.permission)` is `undefined`.
   - Green: the mixed-case branch in `mergeFlatPermissions`; update its JSDoc and `config-loader.ts`'s two comments.
   - Killing mutation: restore `merged[key] = value` for a string base and a map override → both new merge cases and the detector case go red.
5. **`docs(pi-permission-system): document scope-by-scope rule placement`.**
   - The doc updates listed under Module-Level Changes, including the roadmap `✅` mark (heading and Mermaid node `S1108`) and a `Landed:` note.
   - Verify: `pnpm exec rumdl check` on each edited markdown file, then the step's grep for stale phrases returns only historical records (plans, retros, ADR measurement 4, `history/`).

## Risks and Mitigations

- **A user's later scope restates a catch-all after its exceptions** (the step-1 test's shape) and now gets the catch-all.
  Mitigation: the README `Upgrading` entry shows the reorder; the change ships in its own major.
- **The object-after-string case loosens an outcome** (`ask` → `allow` in the measured example).
  The new outcome is what the earlier scope wrote, the same as if it had used `{"*": "allow"}`; the old outcome discarded it silently.
  Mitigation: named in the `BREAKING CHANGE:` footer and the `Upgrading` entry.
- **`/permission-system show` output order changes** to scope by scope.
  No test or consumer pins it; it now matches evaluation order, which is what a reader of last-match-wins needs.
- **A new complexity hotspot replaces `mergeScopesWithOrigins`.**
  Mitigation: keep `redefine` and the per-scope body as file-local helpers below `composeScopes` (stepdown); check `pnpm --silent fallow health` for the file in step 3.
- **Hidden ordering dependency in other suites.**
  Mitigation: the prototype's full-suite run (measured, 1 red) and the assessor's hand trace of every multi-scope test in `scope composition`.

## Open Questions

- Whether `mergeFlatPermissions` should move from `policy/` to `config/` once its only consumer is `config-loader.ts`; left to [#1028], which reworks that read path.

[#646]: https://github.com/gotgenes/pi-packages/issues/646
[#1028]: https://github.com/gotgenes/pi-packages/issues/1028
[#1120]: https://github.com/gotgenes/pi-packages/issues/1120
[#1122]: https://github.com/gotgenes/pi-packages/issues/1122
[#1126]: https://github.com/gotgenes/pi-packages/issues/1126
[#1127]: https://github.com/gotgenes/pi-packages/issues/1127
[#1134]: https://github.com/gotgenes/pi-packages/issues/1134
[#1147]: https://github.com/gotgenes/pi-packages/issues/1147
