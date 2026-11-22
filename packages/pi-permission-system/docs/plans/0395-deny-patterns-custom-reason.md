---
issue: 395
issue_title: "feat(pi-permission-system): deny patterns with custom reason"
---

# Deny patterns with a custom reason

## Problem Statement

A denied command currently produces only a generic block message — the agent is told *no* but never *why* or *what to do instead*.
A user who blocks `npm *` cannot tell the agent to use `pnpm`; the agent just sees a bare denial and may flail.
PR #395 (third-party, from `@k0valik`) proposes an object syntax for deny rules carrying an optional `reason` that is surfaced to the agent in the block message:

```jsonc
"bash": { "npm *": { "action": "deny", "reason": "Use pnpm instead" } }
```

The PR-review stage (see `docs/retro/0395-deny-patterns-with-custom-reason.md`) confirmed the operator's direction: **adopt the capability with our own simplified design** — keep the capability and the explicit `{ action, reason }` shape, but collapse the PR's two duplicated type guards into one and tighten the types/schema so they match runtime behavior.
The Decide gate is therefore already satisfied by the retro; this plan implements the recorded decision.

## Goals

- Add an optional `reason` to **deny** rules via the object syntax `{ "action": "deny", "reason": "..." }` at the pattern-value level.
- Surface the reason to the agent in the denial message, appended after the sentence-ending period: `... (matched 'npm *'). Reason: Use pnpm instead.`.
- Thread `reason` from config through the rule pipeline to `PermissionCheckResult`.
- Keep the change **non-breaking**: existing string-form config is untouched, the new field is optional everywhere, no default changes on upgrade.
  Suggested commits are `feat:`, not `feat!:`.
- Keep schema, example config, `docs/configuration.md`, and the TypeScript types/loaders aligned (per the package's alignment rule).
- Preserve least privilege: the object form only annotates `deny`, so it can never widen access.

## Non-Goals

- No `reason` on `ask` (it would render only in the human confirmation dialog, never reach the agent — a separate, weaker, human-facing feature).
  Deferred as an Open Question.
- No `reason` on `allow` (invisible — dead weight).
- No support for a **top-level** (surface-level) deny-with-reason object — a surface value stays either a `PermissionState` string or a pattern→action map.
  A top-level `{ "action": "deny", "reason": "..." }` is, and remains, parsed as a pattern map (`action` → `"deny"`), consistent with current behavior.
- No change to wildcard matching, merge precedence, or the `path` cross-cutting gate.

## Background

Relevant modules (all under `packages/pi-permission-system/src/`):

- `types.ts` — `PermissionState`, `FlatPermissionConfig` (the on-disk shape), and `PermissionCheckResult` (the evaluation result returned to gates).
- `common.ts` — shared narrow type guards, including `isPermissionState`.
  This is the natural home for a shared `isDenyWithReason` guard, beside its sibling.
- `rule.ts` — the `Rule` value object and `evaluate()`.
  `evaluate()` returns the matched `Rule` **directly** (last-match-wins via `findLast`), so a `reason` field on `Rule` propagates to the result automatically — no change to `evaluate()` is needed.
- `normalize.ts` — `normalizeFlatConfig(FlatPermissionConfig): Ruleset`.
  Converts the on-disk flat config into `Rule[]`.
  The object-value branch currently only accepts `isPermissionState(action)` and silently drops everything else (including deny-with-reason objects).
- `config-loader.ts` — `normalizeFlatPermissionValue(unknown): FlatPermissionConfig`.
  Validates raw parsed JSON into a `FlatPermissionConfig`.
  Its inner pattern-map loop currently only keeps `isPermissionState(action)` values, so a deny-with-reason object read from a JSON config file is **silently stripped before it ever reaches `normalizeFlatConfig`**.
  Both layers must preserve the object for the feature to work end-to-end.
- `permission-manager.ts` — `buildCheckResult()` assembles a `PermissionCheckResult` from the matched `Rule`.
  It must copy `rule.reason` onto the result.
- `denial-messages.ts` — `buildToolDenyBody()` formats the agent-facing block message.
  It must append the reason when present.
- `schemas/permissions.schema.json` — `$defs/permissionState` and `$defs/permissionMap`.
  The surface-level value is `oneOf[permissionState, permissionMap]`; `permissionMap` maps patterns to `permissionState`.

Constraints from AGENTS.md / package skill that apply:

- "Keep schema, example config, `docs/configuration.md`, `README.md`, and TypeScript types/loaders aligned — changing one without the others is a bug."
- "Treat any declared config field not read at runtime as a maintenance trap."
  The `action` discriminator **is** read at runtime (the guard checks `=== "deny"` and it disambiguates a deny-object from a pattern map), so it earns its keep despite being single-valued — this is the explicit shape the operator chose to keep.
- "When a config example sets a policy for `write`, include the same policy for `edit`." (Applies only if a new example touches `write`/`edit`; the `npm *` example does not.)

### Where this plan diverges from PR #395 (the simplifications)

1. **One shared guard, not two.**
   PR #395 defines `isDenyWithReason` twice — in `normalize.ts` (typed `value is DenyWithReason`) and in `config-loader.ts` (typed against an inline anonymous `{ action: "deny"; reason?: string }`).
   This plan defines a single `isDenyWithReason` in `common.ts` returning `value is DenyWithReason`, imported by both call sites.
2. **Tighter `FlatPermissionConfig`.**
   PR #395 sets the top-level value to `PatternValue | Record<string, PatternValue>`, which falsely implies a surface-level deny-with-reason is valid.
   This plan uses `PermissionState | Record<string, PatternValue>` — `PatternValue` (which includes `DenyWithReason`) appears only inside the pattern map, matching runtime behavior.
3. **Schema object form scoped to the pattern map.**
   PR #395 adds the object variant to `$defs/permissionState`, which is also referenced at the surface level — so the schema would accept a top-level deny-with-reason the runtime rejects.
   This plan adds a new `$defs/denyWithReason` and references it **only** from `permissionMap.additionalProperties`, leaving the surface-level `oneOf` unchanged.

## Design Overview

### Data shapes (`types.ts`)

```typescript
/**
 * A deny action with an optional reason annotation, used when a pattern maps
 * to an object instead of a plain PermissionState string.
 */
export interface DenyWithReason {
  action: "deny";
  reason?: string;
}

/** A pattern value: a PermissionState string OR a DenyWithReason object. */
export type PatternValue = PermissionState | DenyWithReason;

/**
 * The on-disk permission shape inside the `"permission"` key.
 * A surface value is a PermissionState string (catch-all shorthand) or a
 * pattern→value map. Pattern values may be a string or a DenyWithReason.
 */
export type FlatPermissionConfig = Record<
  string,
  PermissionState | Record<string, PatternValue>
>;

export interface PermissionCheckResult {
  toolName: string;
  state: PermissionState;
  /** Custom denial reason from a deny-with-reason pattern, when present. */
  reason?: string;
  // …existing fields unchanged…
}
```

`rule.ts` gains one optional field:

```typescript
export interface Rule {
  surface: string;
  pattern: string;
  action: PermissionState;
  /** Custom denial reason for deny rules (optional). */
  reason?: string;
  // …existing fields unchanged…
}
```

### Shared guard (`common.ts`)

```typescript
/**
 * Narrow type guard: a raw value representing a DenyWithReason object.
 * Accepts `{ action: "deny" }` and `{ action: "deny", reason: "…" }`.
 * Rejects a non-string `reason` to keep malformed config out of the rule set.
 */
export function isDenyWithReason(value: unknown): value is DenyWithReason {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.action === "deny" &&
    (record.reason === undefined || typeof record.reason === "string")
  );
}
```

### Data flow

`config-loader.normalizeFlatPermissionValue` (preserve object) → `FlatPermissionConfig` → `normalize.normalizeFlatConfig` (build `Rule` with `reason`) → `evaluate()` (returns the matched rule verbatim) → `permission-manager.buildCheckResult` (`reason: rule.reason`) → `PermissionCheckResult` → `denial-messages.buildToolDenyBody` (append `Reason: …`).
`reason` rides existing value-object carriers (`Rule`, `PermissionCheckResult`); it is **not** a parameter threaded through callbacks, so there is no parameter-relay smell.

Consumer call sites (verifying Tell-Don't-Ask / LoD — both just read one field off a value they already hold):

```typescript
// normalize.ts — object branch
for (const [pattern, raw] of Object.entries(value)) {
  if (isDenyWithReason(raw)) {
    rules.push({ surface, pattern, action: "deny", reason: raw.reason, origin: "builtin" });
  } else if (isPermissionState(raw)) {
    rules.push({ surface, pattern, action: raw, origin: "builtin" });
  }
}

// permission-manager.ts — buildCheckResult
return { toolName, state: rule.action, reason: rule.reason, /* …existing… */ };

// denial-messages.ts — buildToolDenyBody, after the period
let message = `${parts.join(" ")}.`;
if (check.reason) message += ` Reason: ${check.reason}.`;
return message;
```

### Schema (`permissions.schema.json`)

Add a `$def` and reference it only from the pattern map:

```jsonc
"permissionMap": {
  "additionalProperties": {
    "oneOf": [
      { "$ref": "#/$defs/permissionState" },
      { "$ref": "#/$defs/denyWithReason" }
    ]
  }
},
"denyWithReason": {
  "type": "object",
  "description": "Deny with an optional custom reason shown to the agent.",
  "properties": {
    "action": { "const": "deny", "description": "The decision — must be \"deny\"." },
    "reason": { "type": "string", "maxLength": 500, "description": "Reason shown to the agent when denied." }
  },
  "required": ["action"],
  "additionalProperties": false
}
```

The surface-level `properties.permission.additionalProperties.oneOf` stays `[permissionState, permissionMap]` — unchanged.

### Edge cases

- `{ "action": "deny", "reason": 42 }` — non-string reason: the guard returns `false`, so neither `isDenyWithReason` nor `isPermissionState` matches and the pattern is dropped (falls through to the surface/default).
  Documented by tests in both `normalize` and the manager end-to-end suite.
- `{ "action": "deny" }` — no reason: a deny rule with `reason` absent (`undefined`).
- Top-level `{ "action": "deny", "reason": "…" }` at the surface level: parsed as a pattern map (`action` → `deny`); `reason`'s value `"…"` is not a valid `PermissionState`, so that pattern is dropped, leaving a single `action`→`deny` rule.
  Unchanged from today; asserted by an existing-behavior test.
- `allow`/`ask` object forms: not matched by `isDenyWithReason` (action ≠ "deny") and not a string, so dropped — only `deny` gets the object form.

## Module-Level Changes

- `src/types.ts` — add `DenyWithReason` interface and `PatternValue` type; change `FlatPermissionConfig` pattern-map value from `PermissionState` to `PatternValue`; add `reason?: string` to `PermissionCheckResult`.
- `src/rule.ts` — add `reason?: string` to `Rule`.
  No change to `evaluate()`.
- `src/common.ts` — add `isDenyWithReason` guard (imports `DenyWithReason` from `./types`).
- `src/normalize.ts` — import `isDenyWithReason`; in the object-value branch, build a deny rule with `reason` when the guard matches, else fall back to `isPermissionState`.
  Remove the eslint-disable only if the type change makes it unnecessary (re-verify; the defensive null check likely stays).
- `src/config-loader.ts` — import `isDenyWithReason`; in `normalizeFlatPermissionValue`'s inner pattern-map loop, keep deny-with-reason objects alongside `isPermissionState` strings; widen the inner `map` type to `Record<string, PatternValue>`.
- `src/permission-manager.ts` — in `buildCheckResult`, add `reason: rule.reason` to the returned `PermissionCheckResult`.
- `src/denial-messages.ts` — in `buildToolDenyBody`, append `Reason: ${check.reason}.` when `check.reason` is set.
- `schemas/permissions.schema.json` — add `$defs/denyWithReason`; reference it from `permissionMap.additionalProperties` via `oneOf`.
  Leave the surface-level value `oneOf` unchanged.
- `config/config.example.json` — add an illustrative `"npm *": { "action": "deny", "reason": "Use pnpm instead" }` entry under `bash`.
- `docs/configuration.md` — document the object form at the pattern-value level (one prose paragraph + reflect the example), noting the reason is shown to the agent on denial and is deny-only.

No exported symbol is removed or renamed, so no skill/architecture-doc grep is required for removals.
No file is added or deleted, so `docs/architecture/` layout listings are unaffected.

## Test Impact Analysis

This is an additive feature, not an extraction/refactor, so there are no redundant tests to remove.

1. **New unit coverage enabled:** a focused `isDenyWithReason` test in `common.test.ts` (previously the predicate did not exist); deny-with-reason branches in `normalize.test.ts`, `config-loader.test.ts`, `rule.test.ts`, `denial-messages.test.ts`; and an end-to-end thread-through in `permission-manager-unified.test.ts`.
2. **Tests that become redundant:** none — existing tests cover only the string form, which is unchanged.
3. **Tests that must stay as-is:** all existing `normalize`/`rule`/`denial-messages`/`permission-manager` tests — they pin the string-form behavior the feature must preserve (regression guard).

The override-driven helpers already support the new field: `toolCheck`/`mcpCheck` (`denial-messages.test.ts`) spread `Partial<PermissionCheckResult>`, and `makeManagerWithConfig` (`permission-manager-unified.test.ts`) writes arbitrary JSON config — both accept `reason` with no helper change once the type carries it.

## TDD Order

1. **Types + shared guard.**
   Red: add `isDenyWithReason` cases to `common.test.ts` (accepts `{action:"deny"}` and `{action:"deny",reason:"x"}`; rejects `{action:"allow"}`, a non-string `reason`, `null`, arrays, and non-objects).
   Green: add `DenyWithReason`/`PatternValue` and the `PermissionCheckResult.reason` field to `types.ts`, `reason?` to `Rule` in `rule.ts`, widen `FlatPermissionConfig`, and add `isDenyWithReason` to `common.ts`.
   Run `pnpm run check` (shared-interface change).
   Commit: `feat(pi-permission-system): add DenyWithReason type and shared guard`.
2. **Normalizer.**
   Red: add the `deny with reason` describe block to `normalize.test.ts` (rule with reason; without reason; coexists with strings; top-level object treated as a pattern map; non-string reason dropped).
   Green: update `normalize.ts`'s object branch to use `isDenyWithReason`.
   Commit: `feat(pi-permission-system): build deny rules with reason in normalizeFlatConfig`.
3. **Config loader.**
   Red: add deny-with-reason cases to `config-loader.test.ts` (object preserved into `FlatPermissionConfig`; non-string reason stripped; coexists with string values).
   Green: update `normalizeFlatPermissionValue` to keep deny-with-reason objects and widen the inner map type.
   Commit: `feat(pi-permission-system): preserve deny-with-reason from JSON config`.
4. **Rule propagation + manager thread-through.**
   Red: add `evaluate()` reason cases to `rule.test.ts` (reason propagates from the matched rule; carried through last-match-wins; absent on the synthetic fallback) and the end-to-end deny-with-reason block to `permission-manager-unified.test.ts` (`result.reason` set for bash and non-bash surfaces; `undefined` for plain deny; non-string reason falls through to default).
   Green: add `reason: rule.reason` to `buildCheckResult`.
   Commit: `feat(pi-permission-system): thread deny reason into PermissionCheckResult`.
5. **Denial message.**
   Red: add reason cases to `denial-messages.test.ts` (bash with reason; generic tool with reason and no matched pattern; agent-name + reason; MCP target + reason).
   Green: append `Reason: ….` in `buildToolDenyBody`.
   Commit: `feat(pi-permission-system): append custom reason to denial messages`.
6. **Schema, example, docs.**
   No test cycle (data + prose).
   Update `schemas/permissions.schema.json` (`$defs/denyWithReason` + `permissionMap` `oneOf`), `config/config.example.json`, and `docs/configuration.md`.
   Run `pnpm run lint` (rumdl) and `pnpm run check`.
   Commit: `docs(pi-permission-system): document deny-with-reason config form`.

Every commit body ends with a blank line then the attribution trailer (see Risks → Attribution).
Each step is independently green: steps 1–3 are exercised by their own direct-call tests; the manager end-to-end assertions live in step 4 once both normalize and config-loader handle the object form.

## Risks and Mitigations

- **Risk: forgetting one of the two parse layers** (config-loader strips the object before normalize sees it).
  Mitigation: step 3 tests the loader directly, and step 4's end-to-end manager test fails if either layer drops the reason.
- **Risk: schema/runtime drift** (accepting a top-level deny-with-reason in the schema that the runtime treats as a pattern map).
  Mitigation: the schema object form is referenced only from `permissionMap`, never the surface-level value; an existing-behavior test pins the top-level case.
- **Risk: re-introducing the PR's duplicated guard.**
  Mitigation: the single guard lives in `common.ts`; both `normalize.ts` and `config-loader.ts` import it (step 1 lands it before steps 2–3 consume it).
- **Risk: breaking-change misclassification.**
  Mitigation: every change is additive and optional; no existing config or default changes, so `feat:` (not `feat!:`) is correct.
- **Attribution (required):** every implementation/docs commit body carries, after a blank line, `Co-authored-by: k0valik <85703878+k0valik@users.noreply.github.com>` (the PR commit recorded a placeholder email; the GitHub no-reply form links to `@k0valik`).
  The ship-stage close comment thanks `@k0valik` and links the implementing SHA(s).
  Never use `Closes #395` in a commit; reference as `Refs #395` / `(#395)`.

## Open Questions

- Should a reason be available on `ask` rules too, surfaced in the interactive confirmation dialog (human-facing, never reaching the agent)?
  Deferred as a possible follow-up; out of scope here.
- Should the denial message distinguish a config-authored reason from a synthesized one?
  Not currently needed — only config deny rules carry a reason.
