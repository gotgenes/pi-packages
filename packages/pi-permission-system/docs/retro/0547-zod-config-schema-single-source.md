---
issue: 547
issue_title: "Include a JSON Schema definition in pi-permissions.jsonc for completions and easier configuration"
---

# Retro: #547 — Include a JSON Schema definition in pi-permissions.jsonc for completions and easier configuration

## Stage: Planning (2026-07-06T00:00:00Z)

### Session summary

Planned issue #547 (third-party, filed by `JasonLandbridge`).
Discovered the requested JSON Schema already exists (`schemas/permissions.schema.json`), the config already accepts `$schema`, and completions technically already work — the real defects are a stale hosted URL (points at the pre-monorepo `gotgenes/pi-permission-system` fork) and a hand-maintained schema that drifts from the TS types and hand-rolled loader guards.
Through three `ask_user` rounds the operator chose the "Full" direction: adopt **zod** (pin `4.4.3`, the production `latest`) as the single source of truth, derive the Draft 2020-12 JSON Schema from it, and route the loader's runtime validation through it with **strict, breaking** semantics (reject a malformed field with a clear description, fail-closed to `ask`).
Wrote a 6-step lift-and-shift TDD plan and committed it.

### Observations

- Third-party issue → did not skip the `ask_user` gate; the operator materially reshaped scope (zod over the issue's TypeBox suggestion; runtime validation, not schema-only; stricter/breaking with clear errors).
- The operator interjected two directives mid-plan: use the current production zod (`4.4.3`, confirmed via `pnpm view`, since the `npm` shim is blocked) and lean on schema composability without over-abstraction — folded both into the design (bottom-up composable schemas mirroring the existing `$defs`, `reused: "ref"`).
- Key design guards captured: **no `.default()` in the parse schema** (defaults belong post-merge in `normalizePermissionSystemConfig`, else global/project override semantics break); allow `$schema` explicitly under `strictObject`; **fail-closed to `ask`** on reject is the security-critical invariant and gets its own test.
- `markdownDescription` is not confirmed to auto-copy from `z.toJSONSchema` ([colinhacks/zod#5272] is open) — the Step 2 parity test decides whether `.meta()` suffices or the `override` callback is needed.
- Scope interaction with open roadmap Step 8 ([#532]): #547 removes the two config-only guards (`normalizeOptionalStringArray`, `normalizeOptionalPositiveInt`) that #532 meant to keep, and keeps the domain guards #532 meant to move — noted as a Non-Goal, updating `architecture.md` line 807/906 rather than completing #532.
- No follow-up issues filed: deeper `normalize.ts`/`policy-loader.ts` guard cleanup is deferred to existing #532; per-agent frontmatter validation left as an Open Question (not speculative-filed).
- Release: ship independently — #547 is not in the architecture roadmap.
- Freshness gate is a vitest parity test (runs in the existing `pnpm -r run test` CI job), so no `ci.yml` edit is needed.

## Stage: Implementation — TDD (2026-07-06T17:26:46Z)

### Session summary

Implemented all 6 planned TDD steps across 6 commits: added the composable zod schema module (`config-schema.ts`) as the single source of truth, generated `permissions.schema.json` from it (fixing the stale `$id` URL), routed the config-file loader through strict `safeParse` (breaking, fail-closed), removed the two superseded config-only guards, derived the config types from zod, and updated docs/ADR/migration/skill.
Package tests went 2283 → 2293 (+10 net: +22 from `config-schema.test.ts`, +1 fail-closed test, −13 from removed guard tests).
All deterministic gates pass; pre-completion reviewer returned WARN (one finding, fixed).

### Observations

- **Two unplanned but necessary deviations, both honoring the plan's scope.**
  (1) `normalizeUnifiedConfig` turned out to be dual-purpose — it also validated per-agent `.md` frontmatter (which carries non-config keys like `name`/`model`).
  A strict `strictObject` would have rejected those and silently dropped agent permission blocks.
  Fix: `policy-loader.ts` now extracts only the `permission` block via the exported tolerant `normalizeFlatPermissionValue`, so config files are strict while agent frontmatter stays tolerant (the plan's stated boundary). (2) Legacy-file validation issues are suppressed in `loadAndMergeConfigs` so the move-it migration message stays the clean, actionable signal.
- **The generated schema is not byte-identical to the hand-maintained one** — zod emits `anyOf`-of-consts (not `oneOf`) and adds a safe-int `maximum` on integers.
  Functionally equivalent for editors; the parity test snapshots the generator output for freshness rather than matching the old file.
  `markdownDescription`, `examples`, `default`, and per-value descriptions all survive via `.meta()` (no `override` callback needed).
- **`gen:schema` chains `biome format`** because `JSON.stringify(…, null, 2)` collapses differently than biome (single-element arrays); chaining keeps the committed file deterministic and lint-clean.
- **No `.default()` in the parse schema** — defaults stay in `normalizePermissionSystemConfig` post-merge, preserving global-vs-project override semantics (a plan guard that held up).
- **Type derivation was safe** — `expectTypeOf(...).toEqualTypeOf(...)` in `config-schema.test.ts` (enforced by `tsc`, since tsconfig includes `test`) proved the `z.infer` types equal the hand-written ones before the lift-and-shift, so all ~58 consumers compiled untouched.
- **Pre-completion reviewer: WARN** — the only finding was a missing README Documentation-table row for the new `docs/migration/strict-config-validation.md`; added it (amended into the docs commit) and re-verified lint.
  Everything else PASS, including explicit tests for the fail-closed `ask` fallback and legacy-file suppression.
- **#532 interaction** — removed the two config-only guards it planned to keep; updated `architecture.md`'s Step 8 note and the ADR to reflect the shrunk target without closing #532.
- **zod `4.4.3`** installed cleanly, no `minimumReleaseAgeExclude` needed; tarball verified to ship `src/config-schema.ts` + schema + migration doc and exclude `scripts/`, `test/`, and the internal ADR.

## Stage: Final Retrospective (2026-07-06T18:00:00Z)

### Session summary

One continuous session carried #547 through planning, TDD implementation, and ship.
Shipped `pi-permission-system` `v19.0.0` (major, breaking): zod is now the single source of truth for the config-file shape, the JSON Schema and config types both derive from it, the stale hosted `$id`/`$schema` URLs are repointed to the monorepo, and config-file validation is strict and fail-closed.
Six implementation commits, `+10` net tests, pre-completion WARN fixed, CI green, release-please PR #550 merged, issue closed.

### Observations

#### What went well

- **Discovery-first planning reframed the issue.**
  The request was "add a JSON Schema," but investigation found the schema already existed and completions already worked; the real defects were a stale hosted URL and schema/type/loader drift.
  Reframing avoided building a redundant artifact and produced a higher-value single-source-of-truth outcome.
- **Throwaway exploration scripts before committing to the schema shape.**
  Two disposable `explore-zod.ts` runs revealed that `reused: "ref"` produced ugly `__schemaN` `$defs` and that `.meta({ id })` alone yields clean `$defs` — and that `markdownDescription`/`examples`/`default` all pass through `.meta()` (no `override` needed).
  This is the `testing` skill's "write a disposable exploratory script first" rule paying off directly.
- **Caught a latent regression during implementation.**
  `normalizeUnifiedConfig` was dual-purpose (config files *and* per-agent frontmatter); a naive strict-ification would have silently dropped agent `permission` blocks (frontmatter carries `name`/`model`/etc.).
  Grepping the callers surfaced it, and the fix kept agent frontmatter tolerant while config files went strict.
- **Proactively checked biome warnings (exit 0).**
  After removing test blocks, an unused `it` import lingered as a biome *warning* — which `pnpm run lint` passes and the pre-completion reviewer's error-gated checks would miss.
  Explicitly inspecting `biome check` warnings caught it before commit.
- **Incremental verification, no feedback-loop gap.**
  `pnpm run check` / the affected test file / `pnpm run lint` ran after *every* TDD step, and the full suite + `fallow dead-code` + a `pnpm pack` tarball inspection ran at the end.
  `expectTypeOf(...).toEqualTypeOf(...)` (enforced by `tsc`) de-risked the ~58-consumer type lift-and-shift before it landed.
- **Ship-flow rule adherence under an in-progress release check.**
  The release-please PR reported `UNSTABLE` with a check still `IN_PROGRESS`; per the ship prompt I waited and re-polled rather than falling back to `gh pr merge` while the check ran, then merged clean via `release_pr_merge`.

#### What caused friction (agent side)

- `other` (path typo) — one `Edit` used an absolute path missing the `pi-packages/packages/` segment, tripping the permission gate.
  Impact: one rejected call + retry, no rework.
- `missing-context` — did not anticipate that biome formats committed JSON, so the first `gen:schema` output failed lint (biome collapses single-element arrays differently than `JSON.stringify`).
  Impact: one fix cycle; resolved by chaining `biome format --write` into `gen:schema` so the generated file is deterministic and lint-clean.

#### What caused friction (user side)

- None.
  The operator's two mid-planning interjections (zod over TypeBox; pin the latest production version + favor schema composability) were well-timed and materially improved the design; they could not have come earlier since the operator did not yet know the schema already existed.

### Diagnostic details

- **Model-performance correlation** — one subagent dispatch: `pre-completion-reviewer` on `anthropic/claude-sonnet-5` (274s, 53 tool uses) for judgment-heavy review (acceptance criteria, design review, doc staleness, Mermaid render).
  Appropriate model for the work; no mismatch.
- **Escalation-delay tracking** — no rabbit holes; the longest same-target sequence was the two deliberate zod-exploration script runs, which were investigative, not stuck.
- **Unused-tool detection** — `web_search` + `fetch_content` (zod v4 `toJSONSchema` docs) and disposable scripts covered the unfamiliar-library risk; no Explore/Plan subagent was warranted (full context was already in-session).
- **Feedback-loop gap analysis** — none: verification ran incrementally after each step rather than only at the end.

### Changes made

1. Added this Final Retrospective stage entry to `packages/pi-permission-system/docs/retro/0547-zod-config-schema-single-source.md`.
   No prompt, `AGENTS.md`, or skill changes: the operator chose retro-only, since the `gen:schema` script already self-documents the `biome format` chaining and the other candidate lessons duplicate existing guidance.

[#532]: https://github.com/gotgenes/pi-packages/issues/532
[colinhacks/zod#5272]: https://github.com/colinhacks/zod/issues/5272
