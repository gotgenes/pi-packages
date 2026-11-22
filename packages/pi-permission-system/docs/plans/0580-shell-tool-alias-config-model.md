---
issue: 580
issue_title: "pi-permission-system: shell-tool alias config model (shellTools)"
---

# Shell-tool alias config model (`shellTools`)

## Release Recommendation

**Release:** mid-batch — defer (batch "shell-tool-aliases"); confirm at ship time

This is Phase 11 Step 2 of the pi-permission-system improvement roadmap, tagged `Release: batch "shell-tool-aliases"`.
The batch tail is Step 3 ([#574]) — the enforcement gate that consumes this config.
Step 2 delivers only the validated, merged, documented config surface with no runtime behavior change, so it ships together with Step 3, not on its own.
A `feat:` commit that lands here waits on `main` and auto-batches into the release cut when Step 3 lands.

## Problem Statement

`classifyToolKind` decides "what does this invocation access?" from a closed set of hardcoded built-in tool names.
A tool that carries bash semantics under a different name — e.g. `@howaboua/pi-codex-conversion` replaces the native `bash` tool with `exec_command` (`cmd` + optional `workdir`) — is classified as a generic extension tool, so it never receives command decomposition, wrapper flooring, bash path/external-directory token gates, or `bash:` config rules.
The same shell operation is then evaluated differently depending on which toolset is active.

The access-intent boundary has no way to *record* that a foreign tool name is really a shell.
Config is the right home for that recording: config files are the source of truth for policy, and the project prefers config patterns over new runtime mechanisms.

This issue delivers the config surface only.
Consuming it at gate time — routing an aliased invocation through the bash enforcement stack — is Phase 11 Step 3 ([#574]).

## Goals

- Add an optional `shellTools` field to `unifiedConfigSchema` mapping a tool name to `{ commandArgument, workdirArgument? }`, with `.meta` descriptions and strict fail-closed validation.
- Regenerate `schemas/permissions.schema.json` from the zod source via `pnpm run gen:schema` (never hand-edited); keep the parity test green.
- Carry the field through `PermissionSystemExtensionConfig`, `normalizePermissionSystemConfig`, and `mergeUnifiedConfigs()` so it is not silently dropped before runtime (the [#332]/[#347] class; post-[#356] the compiler flags the gap).
- Merge `shellTools` **shallowly by tool name** across scopes: project entries add/override per tool name on top of global, never dropping a global entry wholesale.
- Document the field in `config/config.example.json`, `docs/configuration.md`, and `README.md`.
- Not breaking: `shellTools` is a new optional field; existing configs are unaffected on upgrade.

## Non-Goals

- **No runtime behavior change.**
  Nothing reads `shellTools` yet — `grep -c shellTools src/config-schema.ts` goes 0 → ≥ 1, but no gate consults it.
  Wiring the recording into `classifyToolKind` / the tool-call gate pipeline is Step 3 ([#574]) and is deliberately deferred.
- **No tool-removal or toolset lever.**
  `shellTools` only ever tightens enforcement (routes a tool through the bash stack) and is inert when the tool is not registered.
  Opting a project out of `pi-codex-conversion` is a package-disable / active-tools concern that Pi owns, not a permission-config field.
- **No per-agent frontmatter surface.**
  Per-agent frontmatter stays tolerant and carries only its `permission` block; `shellTools` is a file-config field, matching the other runtime knobs.

## Background

Relevant existing modules and conventions (from the `package-pi-permission-system` skill and the code):

- `src/config-schema.ts` — the single source of truth.
  Composable zod schemas drive both runtime validation and the generated JSON Schema (`buildPermissionsJsonSchema`).
  `id`-tagged sub-schemas (`permissionState`, `permissionMap`, `denyWithReason`) become `$defs`; everything else inlines.
  `UnifiedPermissionConfig` is `z.infer<typeof unifiedConfigSchema>`.
- `schemas/permissions.schema.json` — **generated** via `pnpm run gen:schema` (`scripts/generate-permissions-schema.ts` + `biome format`); never edited by hand.
  A parity test in `test/config-schema.test.ts` fails on drift.
  That test also asserts `$defs` is exactly `["denyWithReason", "permissionMap", "permissionState"]`.
- `src/extension-config.ts` — `PermissionSystemExtensionConfig` (the runtime type) and `normalizePermissionSystemConfig(raw: UnifiedPermissionConfig)`, which reads fields directly off the typed parameter (so an omitted field is a compile error post-[#356]).
  `DEFAULT_EXTENSION_CONFIG` must not carry an explicit `undefined` optional field — tests use `deepEqual`.
- `src/config-loader.ts` — `mergeUnifiedConfigs(base, override)`: boolean/number scalars replace, array fields replace, `permission` deep-shallow merges via `mergeFlatPermissions`.
- `config/config.example.json`, `docs/configuration.md`, `README.md` — kept aligned with the schema whenever the config shape changes.

Constraints from AGENTS.md / the package skill that apply:

- Config **files** are validated strictly against `unifiedConfigSchema` and rejected fail-closed on any invalid field.
  `strictObject` at the alias level makes an unknown alias key an error.
- A field on the runtime type but not the merge intermediate is silently dropped — carry it through all three sites.
- Keep `config-schema.ts`, example config, `docs/configuration.md`, and `README.md` aligned — the schema and config types both derive from `config-schema.ts`, the one edit point.
- Mark the completed roadmap step (`✅` on Step 2's heading and its Mermaid node) in the implementation doc-update commit, not a deferred ship commit.

## Design Overview

### Config shape

```typescript
// A single aliased shell tool's field mapping.
const shellToolAliasSchema = z.strictObject({
  commandArgument: z.string().min(1).meta({
    description:
      "The input field holding the shell command string for this tool (e.g. 'cmd').",
  }),
  workdirArgument: z.string().min(1).optional().meta({
    description:
      "Optional input field holding the working directory for this tool (e.g. 'workdir').",
  }),
});

// tool name -> alias mapping
const shellToolsSchema = z
  .record(
    z.string().min(1).meta({
      description: "A non-bash tool name that carries shell semantics.",
    }),
    shellToolAliasSchema,
  )
  .meta({
    description:
      "Maps non-bash tool names that carry shell semantics to the input fields holding their command and working directory.",
    markdownDescription:
      "Records which non-`bash` tools carry shell semantics, mapping each tool name to the input field holding its command (and optionally its working directory).\n\nUse this when an extension replaces the native `bash` tool under a different name — e.g. `@howaboua/pi-codex-conversion` registers `exec_command` with a `cmd` field and an optional `workdir`. Recording the alias lets the permission system gate that tool through the same bash enforcement stack as native `bash` (command decomposition, wrapper flooring, path/external-directory token gates, and `bash:` rules).\n\nExample:\n\n```json\n\"shellTools\": {\n  \"exec_command\": { \"commandArgument\": \"cmd\", \"workdirArgument\": \"workdir\" }\n}\n```\n\n**Merge order:** shallow-merge by tool name across global → project. A project entry overrides a specific tool's mapping on key collision but never drops a global entry.",
  });

export type ShellToolAlias = z.infer<typeof shellToolAliasSchema>;
export type ShellToolsConfig = z.infer<typeof shellToolsSchema>;
```

Then add `shellTools: shellToolsSchema.optional()` to `unifiedConfigSchema`'s `strictObject`.

Design notes:

- The alias sub-schema is **not** `id`-tagged, so it inlines under `properties.shellTools.additionalProperties` in the generated JSON Schema rather than becoming a fourth `$def`.
  This keeps the parity test's `$defs === ["denyWithReason", "permissionMap", "permissionState"]` assertion unchanged.
- `strictObject` at the alias level fails closed on an unknown field (e.g. a typo'd `commandFeild`), matching the rest of the config's strict validation.
- `commandArgument` is required (a shell alias with no command field is meaningless); `workdirArgument` is optional (a tool may not project a working directory).
- Both field names are `.min(1)` non-empty strings.

### Merge semantics — shallow by tool name

`shellTools` is security-relevant: in Step 3 an entry is what routes a tool through the bash enforcement stack, so a dropped entry is a silent enforcement regression (the "silent bypass" class this package guards against).
Merge must therefore be **additive**: a project can override a specific tool's mapping but can never silently drop a global entry.

```typescript
// In mergeUnifiedConfigs, alongside the permission deep-shallow merge:
const baseShell = base.shellTools;
const overrideShell = override.shellTools;
if (baseShell && overrideShell) {
  merged.shellTools = { ...baseShell, ...overrideShell };
} else if (baseShell) {
  merged.shellTools = baseShell;
} else if (overrideShell) {
  merged.shellTools = overrideShell;
}
```

The spread replaces a colliding tool's alias object wholesale (no deep-merge of `commandArgument`/`workdirArgument`) — a project overriding `exec_command` supplies the full mapping, so it can never end up with a `commandArgument` and a stale global `workdirArgument`.
This mirrors the `permission` block's structure but one level shallower (a flat tool→alias record, not a nested pattern map).

Decision rationale (confirmed with the operator during planning):

- A project that wants a *different* field mapping for a tool sets that tool's key — shallow-merge replaces just that object.
- A project that wants no `pi-codex-conversion` disables the package; the `exec_command` tool is then unregistered and any `shellTools` entry is inert.
- A project that wants a tool gated *loosely* uses `bash:`/`path:` rules, not un-recording the shell semantics.
- The only capability "replace wholesale" adds over shallow-merge — "define one entry and silently drop all global entries" — has no legitimate use and is a footgun, so it is rejected.

### Carry-through

`normalizePermissionSystemConfig` copies the optional field only when present (matching `piInfrastructureReadPaths`):

```typescript
if (raw.shellTools !== undefined) {
  result.shellTools = raw.shellTools;
}
```

`PermissionSystemExtensionConfig` gains `shellTools?: ShellToolsConfig;`.
`DEFAULT_EXTENSION_CONFIG` is untouched — the field stays absent (no explicit `undefined`), preserving `deepEqual` equality in tests.

## Module-Level Changes

- `src/config-schema.ts` — add `shellToolAliasSchema` + `shellToolsSchema` (with `.meta`), add `shellTools: shellToolsSchema.optional()` to `unifiedConfigSchema`, export `ShellToolAlias` and `ShellToolsConfig` types.
- `schemas/permissions.schema.json` — regenerated via `pnpm run gen:schema` (do not hand-edit).
- `src/extension-config.ts` — add `shellTools?: ShellToolsConfig` to `PermissionSystemExtensionConfig`; copy it in `normalizePermissionSystemConfig` when defined.
  Import `ShellToolsConfig` from `config-schema` (or re-exported via `config-loader`, matching the existing `UnifiedPermissionConfig` import path).
- `src/config-loader.ts` — add the shallow-by-tool-name merge block in `mergeUnifiedConfigs`.
- `test/config-schema.test.ts` — new accept/reject cases (see TDD Order); the existing parity + `$defs` assertions stay green.
- `test/config-loader.test.ts` (or the merge test file) — new shallow-merge cases for `shellTools`.
- `test/extension-config.test.ts` (or wherever `normalizePermissionSystemConfig` is tested) — carry-through case.
- `config/config.example.json` — add a `shellTools` block showing `exec_command`.
- `docs/configuration.md` — add a `shellTools` subsection under Runtime Knobs and include it in the Full Example.
- `README.md` — add a one-line mention of `shellTools` in the Configuration section (pointer to the docs reference).
- `docs/architecture/architecture.md` — mark Phase 11 Step 2 complete (`✅` on the Step 2 heading and its Mermaid node `S2`); no `rule.ts`-type listing is touched (this change adds a config field, not a `Rule`/`Ruleset` field).

Grep confirmation performed during planning: `shellTools` / `ShellTool` appears nowhere in `src/` today, so no existing symbol collides.
The health-metric row (`shellTools` schema sites 0 → ≥ 1, line 875 of `architecture.md`) is a Phase 11 target, satisfied by this step; leave the target table as written (it tracks the phase, not per-step baselines).

## Test Impact Analysis

This is an additive config-surface change, not an extraction, so the extraction-specific questions are largely N/A:

1. **New tests enabled** — schema accept/reject for the `shellTools` shape, `mergeUnifiedConfigs` shallow-merge behavior, and `normalizePermissionSystemConfig` carry-through.
   All are new unit tests over existing seams; nothing was previously untestable.
2. **Redundant tests** — none.
   No existing test covers `shellTools` (the field is new).
3. **Tests that must stay** — the parity test (`committed schemas/permissions.schema.json is in sync`) and the `$defs` assertion genuinely guard schema drift and must stay; the design deliberately keeps `$defs` at three entries so the latter stays green without edit.

## Invariants at risk

This change touches `config-schema.ts`, `extension-config.ts`, and `config-loader.ts` — surfaces the [#356] carry-through hardening and the [#547] strict-validation / schema-parity work already refactored.

- **[#356] carry-through invariant** — a runtime-type field must be readable from the typed `UnifiedPermissionConfig`, so an omitted merge/normalize site is a compile error.
  Pinned by the type-level test `inferred types match the hand-written domain types` and by `tsc`; adding `shellTools` exercises exactly this path.
- **[#547] schema-parity invariant** — the committed JSON Schema equals `buildPermissionsJsonSchema()`.
  Pinned by `committed schemas/permissions.schema.json is in sync`; regenerating the schema in the same commit keeps it green.
- **[#547] `$defs` shape invariant** — exactly three shared sub-schemas.
  Pinned by `extracts the shared sub-schemas into $defs`; the design keeps the alias sub-schema un-`id`-tagged so this stays green.

No earlier phase step's documented `Outcome:` invariant is regressed — this step only adds an optional field.

## TDD Order

1. **Schema surface** (`test: add shellTools schema cases` → `feat(pi-permission-system): add shellTools config schema`).
   - Red: in `test/config-schema.test.ts`, add cases — accepts a config with `shellTools: { exec_command: { commandArgument: "cmd", workdirArgument: "workdir" } }`; accepts an alias with only `commandArgument`; rejects an alias missing `commandArgument`; rejects an unknown field inside an alias (`strictObject`); rejects a non-string `commandArgument`.
   - Green: add `shellToolAliasSchema` + `shellToolsSchema` + the optional field + exported types to `config-schema.ts`; run `pnpm run gen:schema` to regenerate the committed JSON (the parity test then passes).
   - Verify: `pnpm run check`, the new + existing config-schema tests, and `$defs` still equals the three entries.
   - Commit the schema source, regenerated `schemas/permissions.schema.json`, and the test together (`feat:`).

2. **Runtime carry-through + merge** (`feat(pi-permission-system): carry shellTools through config merge`).
   - Red: add a `normalizePermissionSystemConfig` carry-through test (field copied when present, absent from `DEFAULT_EXTENSION_CONFIG`) and `mergeUnifiedConfigs` shallow-merge tests — global-only survives, project-only survives, project overrides a colliding tool key, project adds a new tool without dropping the global entry.
   - Green: add `shellTools?: ShellToolsConfig` to `PermissionSystemExtensionConfig`, the `if (raw.shellTools !== undefined)` copy in `normalizePermissionSystemConfig`, and the shallow-merge block in `mergeUnifiedConfigs`.
   - Verify: `pnpm run check`, `pnpm -r run test` for the package.
   - Note: because `normalizePermissionSystemConfig` reads the typed field, the compiler enforces the carry-through — a missed site fails `tsc`.

3. **Docs + example + roadmap** (`docs(pi-permission-system): document shellTools config`).
   - Update `config/config.example.json` (add the `exec_command` `shellTools` block), `docs/configuration.md` (a `shellTools` subsection + Full Example entry), and `README.md` (one-line mention).
   - Mark Phase 11 Step 2 complete in `docs/architecture/architecture.md` (`✅` on the Step 2 heading and Mermaid node `S2`) in this same commit.
   - Verify: `pnpm exec rumdl check` on the edited markdown; confirm `config.example.json` still parses and validates against the schema.
   - `docs:` type is a `hidden: true` changelog entry that does not cut a release on its own — correct for this deferred batch member.

## Risks and Mitigations

- **Schema `$defs` drift breaks the parity/`$defs` test** — mitigated by leaving the alias sub-schema un-`id`-tagged (inlines) and regenerating the JSON in step 1; the parity test is the guard.
- **Silent field drop before runtime** ([#332]/[#347] class) — mitigated by the compile-time carry-through ([#356]) plus explicit merge/normalize tests in step 2.
- **Merge choice locks in Step 3 runtime behavior** — the shallow-by-tool-name decision is deliberate and operator-confirmed; documented here and in the `markdownDescription` so Step 3 consumes a known, additive contract.
- **Example config that fails validation** — mitigated by the step-3 verify that `config.example.json` parses and validates against the regenerated schema.

## Open Questions

None outstanding.
The one design ambiguity (merge semantics) was resolved to shallow-merge-by-tool-name during planning.
Step 3 ([#574]) owns all consumption-time questions (which dispatch point consults the alias, `workdir` as effective base, review-log shape) — deferred by design.

[#332]: https://github.com/gotgenes/pi-packages/issues/332
[#347]: https://github.com/gotgenes/pi-packages/issues/347
[#356]: https://github.com/gotgenes/pi-packages/issues/356
[#547]: https://github.com/gotgenes/pi-packages/issues/547
[#574]: https://github.com/gotgenes/pi-packages/issues/574
