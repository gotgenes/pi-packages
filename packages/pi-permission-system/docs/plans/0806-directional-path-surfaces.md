---
issue: 806
issue_title: "pi-permission-system: add the read/write capability axis to the path surfaces"
---

# The direction axis on the path surfaces

## Release Recommendation

**Release:** mid-batch — defer (batch "capability-axis"); confirm at ship time

Phase 14 Step 1 is the head of the `capability-axis` batch (Steps 1, 2, 3), whose tail and release vehicle is Step 3 ([#803], wrapper transparency).
Steps 1 and 2 relieve nothing a user can observe until a directional grant exists to write against a classified effect, so the batch ships together.
Leave the release-please PR unmerged at ship time.

## Problem Statement

The policy vocabulary names *what* is touched and never *what is done to it*.
A surface key identifies an actor or an object; nothing in a rule, an intent, or a gate carries direction.
So the deterministic layer cannot distinguish a read from a write, and a user who wants to permit reading outside the working tree must permit writing there too — which means they permit neither and absorb the prompt.

[ADR 0013](../decisions/0013-permission-policy-model.md) §1 names this as the single defect behind eight open issues.
This change is its staging slice 1: the four directional surface keys, load-time sugar expansion of the bare keys, and enough gate routing to relieve band A (tool reads, a measured ~19% of current asks) — because a tool's identity already proves its direction.

## Goals

- Add `path_read`, `path_write`, `external_directory_read`, and `external_directory_write` as first-class surfaces.
- Expand a bare `path` / `external_directory` key at load into both directional keys, in ADR 0013 §4's normative order, so a config and its key-order-swapped twin mean the same thing.
- Route an access with a proven direction to that direction's surfaces, and an access without one to both, most-restrictive (§10's fail-closed base case).
- Convert ADR 0007 §5's bounded-delegation exclusion from literal-name membership to surface-**family** membership, in the same commit as the new surface names.
- Reject a misspelled directional key (`path_wrote`) at config load instead of letting it sit inert.
- Stay **non-breaking by construction**: every existing config expands to its current meaning exactly, and nothing prompts differently on upgrade.

This change is **not** breaking.
The only user-visible differences on upgrade are additive: new config keys, a new `surface` fact in the ask dialog for a direction-proven tool ask, and directional surface names in the review log and on the `permissions:decision` bus event.

## Non-Goals

- **Bash effect attribution** ([#807], Step 2).
  A bash path token stays unproven here and consults both directional surfaces; the syntax proofs and the pure-reader core that give it a direction are the next step.
- **Wrapper transparency** ([#803], Step 3).
  The indirection floor is untouched.
- **`commandEffects`** — the user-declaration half of ADR 0013 §7, deferred with Step 2's split.
- **Redirect projection** ([#609], Phase 15 slice 4).
  An output-redirect destination is provably a write, but projecting bare nonexistent destinations carries the phase's only breaking change and does not belong in the same release as an axis that must be non-breaking.
- **Relaxing what the delegation envelope excludes** ([#620], and the open third-party PR [#684]).
  This change alters how a family name *resolves to members*; it does not alter which families are excluded.
  ADR 0013 §4 states that distinction explicitly, and the implementation must keep a later relaxation independently landable.
- **Blame threading** — ADR 0013 §10's verdict blame reaching prompts and session-approval suggestions is Phase 15 slice 5.
  This change makes the blamed surface *available* (the fold returns the losing member's own result), but adds no prompt wording that consumes it.
- **Naming the five existing well-known surfaces in the schema** — filed as [#808] and adopted as Phase 14 Step 9.
  This change names only the four directional keys; closing the resulting asymmetry is that step's job.

## Background

### The four rule sources and the one read path

Config rules come from four scopes (global, project, agent frontmatter, project-agent), merged pattern-by-pattern by `mergeScopesWithOrigins` (`src/scope-merge.ts`) with a parallel origin map, then turned into a `Ruleset` by `normalizeFlatConfig` (`src/normalize.ts`).
Session approvals are a fifth source, stored as `Rule`s by `SessionRules` (`src/session-rules.ts`) and appended at check time.

Every gate resolves through `PermissionResolver.resolve` (`src/permission-resolver.ts`), which unwraps an `access-path` intent to its match values and calls `PermissionManager.check`.
`buildCheckResult` (`src/permission-manager.ts`) evaluates `(surface, values)` against the composed ruleset with **exact surface-string equality**.

`PermissionResolver.resolve` is also the entry point for two non-gate readers, and both matter here:

- `LocalPermissionsService.checkPermission` — the public cross-extension query, and the `PermissionQuery` ADR 0007 §3 injects into every authorizer link "so a link queries the deterministic engine at gate parity".
- `ServingPolicy.resolve` (`src/authority/forwarded-request-server.ts`) — the **recorded-authority view a serving node resolves a forwarded child request against**, using the child-fixed `matchValues` and the child's own surface.

The second is the load-bearing one.
A child's path gate sends `surface: "path"`.
Once expansion empties that surface, a serving node that does not fold the family resolves the child's request against nothing, gets the universal fallback, and a parent's recorded `path: {"~/.ssh/*": "deny"}` stops hard-denying the child and escalates to an approvable prompt instead — the [#712] defect class verbatim.

### Constraints from AGENTS.md and the package skill

- Do not add a permission surface without also adding a policy field, schema entry, and example.
- Keep `config-schema.ts`, `config/config.example.json`, `docs/configuration.md`, and `README.md` aligned; `schemas/permissions.schema.json` is generated by `pnpm run gen:schema` and guarded by a parity test.
- The manager stays string-based and must not import `AccessPath` — a `no-restricted-imports` lint rule guards `permission-manager.ts` (`docs/decisions/0002-path-values-string-boundary.md`).
- A completed roadmap step is marked `✅` on both the step heading and its Mermaid node in the implementation commit, not a deferred one.

### Measured planning baselines

All four of this step's roadmap metrics are `0` today, measured at planning time:

```bash
grep -cE 'path_read|path_write|external_directory_read|external_directory_write' src/access-intent/path-surfaces.ts   # 0 → 4
grep -cE 'path_read|path_write' src/config-schema.ts                                                                  # 0 → ≥ 2
grep -c 'expandDirectionalSugar' src/normalize.ts                                                                     # 0 → ≥ 1
grep -c 'surfaceFamily' src/authority/delegation-envelope.ts                                                          # 0 → ≥ 1
```

Test-migration size, measured: `grep -rhoE 'surface: "(path|external_directory)"' test | wc -l` reports **100** occurrences across `test/`, of which **11** are in `permission-manager-unified.test.ts`.
Most of the 100 are gate-descriptor assertions that stay as written; the migrating population is the subset that queries the engine directly.

## Design Overview

### The axis is two independent bits, not two tiers

`path_read` governs reads; `path_write` governs writes; neither implies the other.
This follows ADR 0013 §2 (an effect value is a *set*, and `["read","write"]` is "legal and honest") and §6 (composition unchanged), and matches the prior art the ADR cites — Landlock's `READ_FILE` and `WRITE_FILE` are independent bits, as are POSIX `r` and `w`.

The rejected alternative was a capability chain in which an `allow` on `path_write` also grants read and a `deny` on `path_read` floors `path_write`.
It is intuitive — a policy that permits writing but forbids reading is close to useless — but it reintroduces exactly the cross-surface interaction ADR 0013 §4 exists to prevent ("there is exactly one axis with two values and no new cross-surface interaction to reason about"), needs a new precedence rule for a `path_write: allow` written after a `path_read: deny`, and grants read implicitly wherever write is granted, which is the exfiltration surface the axis exists to let a user withhold.

The intuition is instead served by documentation, and the doc guidance is sharper than "grant both":

- The **useful grants** are `path_read: allow` (the band-A relief) and the bare sugar key when direction does not matter.
- `*_write` earns its keep as a **restriction** — `path_write: {"**": "deny"}` is a coherent read-only-agent posture — far more than as a grant.
- A `*_write: allow` alone does not silence an `edit`, which also reads; grant read too, or use the bare key.

### Write side: sugar expands at load

`expandDirectionalSugar(permission)` (`src/normalize.ts`) rewrites one scope's flat permission object:

```typescript
// written                                    // after expansion
{ path: { "*": "ask", "~/.ssh/*": "deny" },   { path_read:  { "*": "ask", "~/.ssh/*": "deny" },
  path_read: { "~/dev/**": "allow" } }          path_write: { "*": "ask", "~/.ssh/*": "deny" } }
                                              // …with path_read's own entries appended after
                                              // the sugar-derived ones, whatever the file's key order
```

It is called once, inside `mergeScopesWithOrigins`'s per-scope loop, before both the origin bookkeeping and `mergeFlatPermissions`.
That placement is load-order-correct per ADR 0013 §9 ("sugar expands at load, before composition") and is the only placement that keeps per-scope origin attribution: origins are keyed by the authored surface name, so expanding after the merge would attribute every expanded rule to `builtin`.

`SessionRules.approve` expands the same way, because a session approval is a policy source under §9 and is matched by exact surface.
An approval recorded on the sugar surface becomes two session rules; one recorded on a directional surface stays one.

After expansion **no rules live on the bare surfaces at all**.
That is the point, and it is what makes the read side necessary.

### Read side: a family-name query folds its members

```typescript
// src/permission-resolver.ts
resolve(intent: AccessIntent | PathValuesAccessIntent): PermissionCheckResult {
  const resolved = toResolvedIntent(intent);
  const members = surfaceFamilyMembers(resolved.surface); // readonly [string, ...string[]] | null
  return members === null
    ? this.check(resolved)
    : mostRestrictiveOf(members.map((surface) => this.check({ ...resolved, surface })));
}
```

One site, and it is the site the gates, `LocalPermissionsService`, and `ServingPolicy` already share.
The gates that emit a bare family surface — both bash path gates — therefore need **no change at all**.

The fold returns the losing member's own `PermissionCheckResult`, so `toolName`, `matchedPattern`, `origin`, and `source` all name the surface that forced the verdict.
That is the blame fact ADR 0013 §10 wants, delivered for free rather than re-derived per gate later.

This diverges from the issue body and the roadmap's Target line, which both say the gates route.
The divergence is deliberate: gate-level folding leaves `ServingPolicy` resolving an emptied surface (the [#712] regression above), and would need a second parity shim in `permissions-service.ts` beside `resolveBashAdvisoryCheck` — which exists for exactly this reason, because the bash gate decomposes and the manager does not ([#309]).
Its cost is that reading `bash-path.ts` no longer shows that two surfaces are consulted, so the emit sites carry a comment pointing at §10's base case.

### Direction attribution, this slice

A gate names the narrowest surface it can prove.
`capabilitySurfaceForTool(family, toolName)` (`src/access-intent/path-surfaces.ts`) answers it:

| Access                       | Proven effects       | Surface emitted  |
| ---------------------------- | -------------------- | ---------------- |
| `read`, `grep`, `find`, `ls` | read                 | `<family>_read`  |
| `write`                      | write                | `<family>_write` |
| `edit`                       | read + write         | `<family>`       |
| MCP tool, extension tool     | unknown              | `<family>`       |
| bash path token              | unknown until [#807] | `<family>`       |

`<family>` is `path` for the path gates and `external_directory` for the boundary gates.
`edit` and the unknown cases emit the same name because they consult the same two surfaces; the family name means "both directions", which is both the proven-both case and the fail-closed base case.
The read set is `READ_ONLY_PATH_BEARING_TOOLS`, which already exists and already carries exactly this meaning for the infrastructure-read bypass.

The worked band-A case:

```jsonc
{ "permission": {
    "external_directory": { "*": "ask" },
    "external_directory_read": { "~/dev/**": "allow" }
} }
```

A `read` of `~/dev/x` resolves `external_directory_read`, where the sugar's `* → ask` is followed by the explicit `~/dev/** → allow`, and last-match-wins allows it — no prompt.
A `write` to the same path resolves `external_directory_write`, finds only `* → ask`, and prompts.
An `edit` folds both and prompts.

### Family vocabulary

`surfaceFamilyOf` and `surfaceFamilyMembers` derive the relation from the suffix rather than enumerating it, so the four names appear exactly once in the codebase:

```typescript
const CAPABILITY_SUFFIXES = ["_read", "_write"] as const;
const DIRECTIONAL_FAMILIES: ReadonlySet<string> = new Set(["path", "external_directory"]);

/** The family a surface belongs to — itself, when it carries no capability suffix. */
export function surfaceFamilyOf(surface: string): string;

/** A family name's directional members, or null when `surface` is not a family name. */
export function surfaceFamilyMembers(surface: string): readonly [string, ...string[]] | null;
```

Consumers, each replacing a literal comparison:

- `delegation-envelope.ts` — `DELEGATION_EXCLUDED_SURFACES.has(surfaceFamilyOf(surface))`, leaving the excluded *set* untouched so [#620] and [#684] stay independently landable.
- `permission-manager.ts` `deriveSource` — `SPECIAL_PERMISSION_KEYS.has(surfaceFamilyOf(toolName))`, so a directional surface keeps reporting `source: "special"`.
- `input-normalizer.ts` `buildInputForSurface` — the `external_directory` arm becomes family-aware.

`surfaceFamilyMembers` returning a statically non-empty tuple is what lets `mostRestrictiveOf` be total, so the fold has no `undefined` branch to handle.

### Schema

`permissionSchema` becomes `z.object({ …four directional keys… }).catchall(patternValueSchema | permissionStateSchema)`.
Spike-verified against the installed zod: this emits `properties` with each key's `description`/`markdownDescription` **plus** `additionalProperties`, so arbitrary tool-name surfaces keep validating and the four keys gain editor autocomplete and hover documentation.

Two refinements ride along:

1. A key matching `^(path|external_directory)_` that is not one of the four is a load error.
   A typo in a *grant* fails safe (`external_directory_reed: allow` never fires, so the user gets more prompts), but a typo in a *restriction* fails **open** — `path_wrote: {"**": "deny"}` enforces nothing at all.
   The refinement converts that silent hole into a named error.
   Its false-positive population is an extension tool literally named `path_*`, and the cost of one would be a fail-closed scope under [#646].
2. A non-empty surface-key check, restoring the `propertyNames: {minLength: 1}` the record form emitted and `.catchall()` drops (spike-verified).

Refinements do not serialize into JSON Schema, so both are runtime-loader checks; editors will not flag a misspelling, the loader will.

### Verified non-touch-points

Two modules that look like they need changes and do not, checked rather than assumed:

- `src/pattern-suggest.ts` — its `buildLabel` `path` / `external_directory` arms are unreachable from the path gates.
  Its only callers are `handlers/gates/tool.ts`, which passes `bash` or a tool name, and `buildForwardedScopeLabels`, which interpolates the surface directly without calling `buildLabel`.
- `src/rule.ts` — `pathMatchOptions` keys off `PATH_SURFACES`, so win32 case and separator folding follows the four new names with no edit.

## Module-Level Changes

### Source

1. `src/access-intent/path-surfaces.ts` — add the four directional names to `PATH_SURFACES`; add `CAPABILITY_SUFFIXES`, `DIRECTIONAL_FAMILIES`, `surfaceFamilyOf`, `surfaceFamilyMembers`, `capabilitySurfaceForTool`.
2. `src/restrictiveness.ts` — **new**; receives `RESTRICTIVENESS` and `pickMostRestrictive` relocated from `src/handlers/gates/candidate-check.ts`, and gains the total `mostRestrictiveOf(results: readonly [T, ...T[]]): T`.
   The resolver is a core-layer module and must not import from `handlers/`.
3. `src/handlers/gates/candidate-check.ts` — **deleted**; its three importers (`bash-path.ts`, `bash-command.ts`, `external-directory-policy.ts`) repoint to `#src/restrictiveness`.
4. `src/normalize.ts` — add `expandDirectionalSugar(permission: FlatPermissionConfig): FlatPermissionConfig`.
5. `src/scope-merge.ts` — call `expandDirectionalSugar` on each scope's `permission` at the top of the per-scope loop, before the origin bookkeeping and `mergeFlatPermissions`.
6. `src/session-rules.ts` — `approve` expands a sugar surface into its family members.
7. `src/permission-resolver.ts` — the family fold in `resolve`.
8. `src/permission-manager.ts` — `deriveSource` reads `SPECIAL_PERMISSION_KEYS.has(surfaceFamilyOf(toolName))`.
9. `src/access-intent/input-normalizer.ts` — `buildInputForSurface`'s `external_directory` arm becomes family-aware.
10. `src/authority/delegation-envelope.ts` — `isExcludedSurface` tests `surfaceFamilyOf(surface)`; the excluded set and the `undefined` fail-safe are unchanged.
11. `src/handlers/gates/path.ts` — emit `capabilitySurfaceForTool("path", tcc.toolName)` on the intent, the descriptor `surface`, `SessionApproval`, `accessFactsFromPath`, and `decision.surface`.
12. `src/handlers/gates/external-directory.ts` — the same for the `external_directory` family.
13. `src/presentation/path-ask-payload.ts` — `PathAskFacts` gains a `surface` field so `pathPayload` carries the directional name in `request.surface`; the payload `kind` stays `"path"` / `"external_directory"`, so renderer dispatch is untouched.
14. `src/config-schema.ts` — the named-property conversion and the two refinements.

### Generated, config, and docs

1. `schemas/permissions.schema.json` — regenerated by `pnpm run gen:schema`; never hand-edited.
2. `config/config.example.json` — add a directional example; the band-A `external_directory_read` grant is the one worth showing.
3. `docs/configuration.md` — a directional-surfaces section under the surface documentation, covering the four keys, sugar expansion and its normative order, the per-tool attribution table, the base case for an unproven access, and the grant guidance (`*_read: allow` and the bare key are the useful grants; `*_write` earns its keep as a restriction).
   Update the bounded-delegation sentence at line 230 to say the exclusion is over a surface family.
4. `README.md` — extend the surface description near lines 81–98 and the delegation sentence at line 118.
5. `docs/decisions/0013-permission-policy-model.md` — an amendment recording tool-identity effect attribution (the table above) and the two-independent-bits reading of §2 for tool accesses, so [#807] and [#803] do not re-derive it.
6. `docs/architecture/architecture.md` — Step 1 marked `✅` on the heading and the `S1` Mermaid node, with a `Landed:` note; the four Step 1 metric rows updated from their `0` baselines.

### Symbol-removal greps run at planning time

`pickMostRestrictive` is relocated, not removed, and its four references (three source, one test) are listed above.
No exported symbol is deleted, so the `.pi/skills/package-*/SKILL.md` and `docs/` narrative-prose greps find nothing to update on that axis.
The skill *does* describe mechanisms this change reworks — the four-layer composition paragraph and the `DELEGATION_EXCLUDED_SURFACES` sentence — and both are reworded prose with no removed symbol to match, so `.pi/skills/package-pi-permission-system/SKILL.md` is an expected doc update in the final cycle.

## Test Impact Analysis

**New unit tests this change enables.**
The family vocabulary and the fold are separately testable in a way the current literal comparisons are not: `surfaceFamilyOf` / `surfaceFamilyMembers` / `capabilitySurfaceForTool` get a table-driven test in `test/access-intent/path-surfaces.test.ts`, and the fold gets direct most-restrictive tests in `test/permission-resolver.test.ts` without going through a gate.
`expandDirectionalSugar` gets order-normativity tests in `test/normalize.test.ts` — specifically that a config and its key-order-swapped twin produce identical rulesets, which is a property no existing test could express.

**Tests that become redundant.**
None are removed.
The 11 direct `surface: "path"` queries in `permission-manager-unified.test.ts` migrate to directional surfaces rather than disappearing; they are testing the rule engine, and naming a real rule surface is a clarification.

**Tests that must stay as-is.**
The gate-descriptor assertions across `test/handlers/gates/` genuinely exercise the layer being changed and are updated in place, not replaced.
`test/authority/forwarded-request-server.test.ts` and the forwarding round-trips in `test/composition-root.test.ts` exercise the serving path this design turns on, and must keep asserting that a parent's recorded deny answers a child's forwarded request without escalation.

**New behavior-level coverage.**
A band-A relief test — `external_directory_read: {"~/dev/**": "allow"}` under `external_directory: {"*": "ask"}` silences a `read` while `write` and `edit` still prompt — belongs at the composition-root level, since it is the change's entire user-visible payoff.

## Invariants at risk

Each of these is an outcome a prior step documented; each names the test that pins it.

1. **[#58] backward compatibility** — a config with no path key must not produce path prompts.
   The gates skip on `matchedPattern === undefined`; the fold must not synthesize a pattern.
   Pinned by the existing "no `path` key → no path gate" tests in `test/handlers/gates/path.test.ts` and `bash-path.test.ts`; add one asserting the same through the fold.
2. **[#712] a deny is never masked into an approvable ask** — the fold must return `deny` whenever either member denies, and `ServingPolicy` must keep hard-denying a forwarded child request the parent's config denies.
   Pinned by a new fold test and by the forwarded-deny test in `test/authority/forwarded-request-server.test.ts`.
3. **ADR 0007 §5 bounded delegation** — a link's `allow` on a path-family surface is capped to `defer`.
   Pinned by `test/authority/delegation-envelope.test.ts`, extended with the four directional surfaces.
   This is the ordering constraint: the family conversion lands in the same commit as the new surface names.
4. **[#418] / [#486] / [#502] lexical ∪ canonical alias matching** — every path gate emits `access-path` and the resolver unwraps `matchValues`.
   The fold varies the surface, never the intent kind.
   Pinned by the existing resolver alias tests.
5. **[#382] / [#653] symmetric win32 folding** — path-surface rules fold case and separators on both pattern and value.
   Follows the four new names through `PATH_SURFACES` with no edit; pinned by adding a directional case to the win32 tests in `test/rule.test.ts`.
6. **[#646] fail-closed floor** — `floorAllowsToAsk` runs over the composed ruleset, which now contains expanded rules.
   Pinned by the existing fail-closed tests, which use a bare `path` config.
7. **Session-approval coverage** — approving a bash path for the session must still cover the next bash ask for it.
   At risk because the approval is recorded on the sugar surface while the query folds directional members.
   Pinned by a new `test/session-rules.test.ts` case plus the existing bash-path session-coverage tests.

Quantitative baselines are the four metric greps recorded under Background; all four are measured, not inferred.

## TDD Order

1. **`refactor:` relocate the restrictiveness vocabulary.**
   Move `RESTRICTIVENESS` and `pickMostRestrictive` from `src/handlers/gates/candidate-check.ts` into a new `src/restrictiveness.ts`, add the total `mostRestrictiveOf`, delete `candidate-check.ts`, repoint its three source importers, and move `test/handlers/gates/candidate-check.test.ts` to `test/restrictiveness.test.ts` with cases for the new function.
   Preparatory: the resolver cannot import from `handlers/`.
   `refactor(pi-permission-system): extract the restrictiveness ordering from the gates`
2. **`refactor:` delete the stale duplicate doc comment.**
   `src/rule.ts` stacks a doc comment describing `evaluateFirst` directly above `evaluateAnyValue`'s own.
   Carried from the roadmap's craftsmanship sweep; this change does not otherwise touch `rule.ts`, so it is roadmap-honoring rather than change-scoped.
   `refactor(pi-permission-system): drop the stale duplicate comment above evaluateAnyValue`
3. **`refactor:` the surface-family vocabulary.**
   Red: `test/access-intent/path-surfaces.test.ts` for `surfaceFamilyOf`, `surfaceFamilyMembers`, `capabilitySurfaceForTool`, and the four names' presence in `PATH_SURFACES`.
   No production consumer yet, so the commit is `refactor:` per the observability rule.
   `refactor(pi-permission-system): add the directional surface-family vocabulary`
4. **`feat:` the axis is expressible — one atomic commit.**
   Expansion and the fold are mutually dependent: expansion alone empties the surfaces every query names, and the fold alone folds surfaces no rule occupies.
   The delegation-envelope conversion joins them under ADR 0013 §4's ordering constraint.
   Red: `expandDirectionalSugar` order-normativity in `test/normalize.test.ts`; the fold's most-restrictive and tie behavior in `test/permission-resolver.test.ts`; session-approval expansion in `test/session-rules.test.ts`; family exclusion in `test/authority/delegation-envelope.test.ts`; `source: "special"` for a directional surface in `test/permission-manager-unified.test.ts`.
   Green: items 4–10 of the source list, plus migrating the direct-query test sites.
   Verify: every existing config resolves exactly as before, and a directional key is honored as a restriction on every path access.
   `feat(pi-permission-system): add the read/write capability axis to the path surfaces (#806)`
5. **`feat:` tool-identity direction routing.**
   Red: `test/handlers/gates/path.test.ts` and `external-directory.test.ts` assert the surface each tool's gate emits, per the attribution table; a composition-root test asserts band-A relief.
   Green: source items 11–13.
   `feat(pi-permission-system): route a direction-proven tool access to its directional surface`
6. **`feat:` schema and example config.**
   Red: `test/config-schema.test.ts` — the four named properties survive JSON-Schema generation, a misspelled directional key is rejected, an empty surface key is rejected, an arbitrary tool-name surface still validates, and the committed JSON matches the generated one.
   Green: `src/config-schema.ts`, `pnpm run gen:schema`, `config/config.example.json`.
   `feat(pi-permission-system): name and validate the directional keys in the config schema`
7. **`docs:` documentation, ADR amendment, and the roadmap mark.**
   `docs/configuration.md`, `README.md`, the ADR 0013 amendment, `.pi/skills/package-pi-permission-system/SKILL.md`, and the architecture doc's Step 1 `✅` marks, `Landed:` note, and four metric rows.
   `docs(pi-permission-system): document the directional path surfaces (#806)`

## Risks and Mitigations

1. **A directional key reaching an authorizer before the family conversion silently widens the delegation envelope.**
   Mitigated by cycle 4's atomicity: the envelope conversion lands with the expansion and the fold, and cycle 5 — which first makes a gate emit a directional surface — comes after it.
2. **Version skew on the forwarded-ask wire.**
   A pre-axis child sends `surface: "path"`, which a new parent folds correctly.
   A new child sends `path_read` to a **pre-axis parent**, which finds no such rules and falls to the universal default — more prompting, never less.
   Documented in the configuration guide's forwarding section rather than mechanised.
3. **Cycle 4's intermediate semantics are narrower than the final ones.**
   Between cycles 4 and 5 every path access folds both directions, so a `path_read: deny` also blocks writes.
   Strictly more restrictive, and both cycles ship in one release, so no user observes the intermediate state.
4. **New surface values reach downstream consumers.**
   The review log, the `permissions:decision` bus event, and `PromptPayload.request.surface` will carry `path_read` and friends.
   The field is a free string in every one of those contracts, so nothing breaks, but it is a data change worth naming in the release notes.
5. **The ask dialog gains a `surface` fact for direction-proven tool asks.**
   `renderPromptDialog` shows `surface` only when it differs from both the tool name and the value label; `path` currently equals the label and is hidden, `path_read` does not and will appear.
   This is desirable — it tells the operator which surface fired — and is pinned by a dialog-renderer test rather than left to be discovered.
6. **`/permission-system show` will list expanded directional rules for a user who wrote `path`.**
   Left honest rather than collapsed back: the display then matches what is enforced, and it teaches the axis at the moment a user is inspecting policy.
7. **The misspelling refinement fails a scope closed on a false positive.**
   The population is an extension tool literally named `path_*` or `external_directory_*`.
   The error message names the offending key and the four legal spellings, so the fix is immediate.

## Open Questions

1. **Should `edit` eventually consult `path_read` and `path_write` separately rather than folding them?**
   Folding is correct today because a single verdict is all a gate can act on.
   Once ADR 0013 §10's blame threading lands (Phase 15 slice 5), naming *which* half of an `edit` was refused would improve the prompt.
   Deferred until blame exists to carry it.
2. **Does `delete` (reserved in ADR 0013 §2) become a third family member or a modifier on `write`?**
   `surfaceFamilyMembers` returns a non-empty tuple precisely so a third member costs no restructuring, but the config spelling is not decided.
   Deferred until command knowledge or enforcement can prove a delete.

[#58]: https://github.com/gotgenes/pi-packages/issues/58
[#309]: https://github.com/gotgenes/pi-packages/issues/309
[#382]: https://github.com/gotgenes/pi-packages/issues/382
[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#486]: https://github.com/gotgenes/pi-packages/issues/486
[#502]: https://github.com/gotgenes/pi-packages/issues/502
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#646]: https://github.com/gotgenes/pi-packages/issues/646
[#653]: https://github.com/gotgenes/pi-packages/issues/653
[#684]: https://github.com/gotgenes/pi-packages/pull/684
[#712]: https://github.com/gotgenes/pi-packages/issues/712
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#808]: https://github.com/gotgenes/pi-packages/issues/808
