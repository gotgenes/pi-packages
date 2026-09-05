---
status: accepted
date: 2026-07-06
---

# 0004 — Zod as the single source of truth for config schema and validation

## Status

Accepted.

## Context

Issue [#547] asked for a hosted JSON Schema so editors give completions and flag typos in the permission-system config.
A schema already existed (`schemas/permissions.schema.json`), the config already accepted a `$schema` key, and the example config already set it — but two defects remained:

- Every hosted URL (`$id`, the example config's `$schema`, doc references) pointed at `raw.githubusercontent.com/gotgenes/pi-permission-system/…`, the pre-monorepo upstream fork, not the monorepo path.
- The JSON Schema was hand-maintained separately from the TypeScript types and the hand-rolled loader guards (`value-guards.ts`, `normalizeUnifiedConfig`), so the three could drift — the exact maintenance trap the package skill warns about.

The loader was also **tolerant**: it silently discarded a malformed field (a non-boolean `debugLog`, an invalid permission action, an unknown key) and loaded the rest, so a typo failed quietly.

## Decision

Adopt **zod** (`^4.4.3`) as the single source of truth for the config-file shape (`src/config/config-schema.ts`):

- Composable schemas (`permissionState` → `denyWithReason` → `patternValue` → `permissionMap` → `permission` → the unified config) mirror the previous `$defs` structure.
  The config types (`PermissionState`, `DenyWithReason`, `PatternValue`, `FlatPermissionConfig`, `UnifiedPermissionConfig`) are derived with `z.infer` and re-exported from `types.ts` / `config-loader.ts`, so there is one definition, not three.
- The published `schemas/permissions.schema.json` is **generated** from the zod source via `z.toJSONSchema` (Draft 2020-12) by `pnpm run gen:schema`; a parity test fails if the committed file drifts.
  The root `$id` and every doc/example `$schema` URL now point at the monorepo raw path.
- The config-file loader validates via `unifiedConfigSchema.safeParse`.
  Rich editor metadata (`markdownDescription`, `examples`, per-value descriptions, `default` annotations) is carried through zod's `.meta()`.

Validation is **strict and fail-closed** (breaking): a config file with any invalid field is rejected as a whole scope — it contributes an empty config, so missing surfaces fall through to the universal `ask` default rather than `allow` — and every violation is reported as a clear, path-qualified issue.

### Scope boundaries

- **Per-agent frontmatter is not validated by this schema.**
  Agent `.md` frontmatter carries non-config keys (`name`, `description`, `model`, …) alongside a `permission:` block; routing it through the strict `strictObject` would reject those keys.
  `policy-loader.ts` therefore extracts and tolerantly normalizes only the `permission` block, unchanged.
- **Legacy files keep their migration guidance without strict-validation noise.**
  The move-it message is the actionable signal; the loader suppresses zod issues for legacy paths.
- **The flat-permission-to-`Rule` translation (`normalize.ts`, `policy-loader.ts`) is unchanged** — it consumes already-validated config and keeps using `isPermissionState` / `isDenyWithReason`.

## Consequences

- One edit point for the config shape; the schema, types, and runtime validator cannot drift.
- Typos and wrong-typed fields are caught — in the editor (via `additionalProperties: false` + types) and at load time (with a clear message) — instead of failing silently.
- **Breaking:** a config that previously loaded with silently-dropped fields is now rejected until the reported problems are fixed; the affected scope falls back to `ask` until then (see `docs/migration/strict-config-validation.md`).
- A new runtime dependency (`zod`) is added.
- The config-only guards `normalizeOptionalStringArray` and `normalizeOptionalPositiveInt` were removed (superseded by zod), shrinking the scope of the still-open [#532].

[#532]: https://github.com/gotgenes/pi-packages/issues/532
[#547]: https://github.com/gotgenes/pi-packages/issues/547
