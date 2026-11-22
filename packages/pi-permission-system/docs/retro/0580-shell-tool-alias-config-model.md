---
issue: 580
issue_title: "pi-permission-system: shell-tool alias config model (shellTools)"
---

# Retro: #580 — Shell-tool alias config model (`shellTools`)

## Stage: Planning (2026-07-13T00:00:00Z)

### Session summary

Planned Phase 11 Step 2: an additive, non-breaking `shellTools` config field mapping a tool name to `{ commandField, workdirField? }`, delivering the validated/merged/documented config surface only (Step 3 / `#574` consumes it).
Produced a 3-cycle TDD plan — schema surface + regen, runtime carry-through + merge, docs + roadmap mark — committed as `0580-shell-tool-alias-config-model.md`.

### Observations

- **Merge semantics were the one real design choice** and are locked to **shallow-merge by tool name** (operator-confirmed after a walkthrough).
  Rationale: `shellTools` only ever *tightens* enforcement (routes a tool through the bash stack) and is inert when the tool is unregistered, so a dropped entry is a silent enforcement regression — additive merge is the safe, deterministic, least-privilege choice.
  Per-tool mapping override still works via key collision (spread replaces the colliding alias object wholesale); total codex opt-out is a package-disable concern, not a permission-config lever.
  "Replace wholesale" was rejected: its only added capability ("define one entry, silently drop all global entries") is a footgun with no legitimate use.
- **Grounded the design in the real tool** by cloning `@howaboua/pi-codex-conversion`: `exec_command` uses canonical fields `cmd` (required) + `workdir` (optional), confirming the issue's proposed `{ commandField: "cmd", workdirField: "workdir" }` shape and that a tool-name-keyed **map** is right (it also ships a code-mode `exec`; other extensions could register their own shells).
- **Kept `$defs` at three entries** by deliberately not `id`-tagging the alias sub-schema (it inlines), so the `config-schema.test.ts` `$defs` assertion stays green without edit.
- **Carry-through is compiler-enforced** post-`#356`: `normalizePermissionSystemConfig` reads the typed field, so a missed merge/normalize site fails `tsc` — the `#332`/`#347` silent-drop class is structurally guarded.
- **Release is deferred** (mid-batch, batch "shell-tool-aliases", tail = `#574`); the plan's commits (`feat:`/`docs:`) wait on `main` and auto-batch into the cut when Step 3 lands.
- Next step: `/tdd-plan` (this plan has test cycles).

## Stage: Implementation — TDD (2026-07-13T12:40:00Z)

### Session summary

Implemented all three planned TDD cycles: (1) `shellTools` schema surface + regenerated JSON schema, (2) runtime carry-through (`PermissionSystemExtensionConfig` + `normalizePermissionSystemConfig`) and shallow-by-tool-name merge in `mergeUnifiedConfigs`, (3) docs (`config.example.json`, `configuration.md`, `README.md`) + roadmap Step 2 marked `✅`.
Test count 2374 → 2387 (+13); `pnpm run check`, root `pnpm run lint`, and `pnpm fallow dead-code` all green.

### Observations

- **Tidy-First assessor found no preparatory work warranted** — every target file already had a direct precedent (`permissionMapSchema` for the new `z.record`, the `piInfrastructureReadPaths`/`toolInputPreviewMaxLength` copy-through blocks, the three-branch optional-field merge blocks, flat inline-literal test cases).
  Implemented directly.
- **Deviation from plan:** the plan listed exporting both `ShellToolAlias` and `ShellToolsConfig` from `config-schema.ts`; only `ShellToolsConfig` is exported (consumed by `extension-config.ts`).
  `ShellToolAlias` had no consumer yet and tripped the `fallow dead-code` gate, so it was dropped in a `refactor:` commit — `#574` reintroduces it when the enforcement gate consumes the field.
  Added one extra test beyond the plan (empty-string `commandField` rejection).
- **Design held as planned:** the un-`id`-tagged alias sub-schema inlines, keeping `$defs` at exactly three entries; regenerating the schema produces zero diff; `config.example.json` validates against `unifiedConfigSchema`.
- **Fallow gate caught the speculative export** — a reminder that `code-design`'s "no speculative re-exports" rule is enforced deterministically here, not just by review.
- **Pre-completion reviewer: PASS** — deterministic checks all green, no code-design concerns, Mermaid parses, dead-code clean, `#574` follow-up correctly recorded.
  No warnings.
- **Release:** mid-batch — defer (batch "shell-tool-aliases", tail = `#574`); confirm batching at ship time.
  Next step: `/ship-issue`.

## Stage: Final Retrospective (2026-07-13T17:35:41Z)

### Session summary

Shipped `#580` cleanly across four stages (plan → TDD → ship → retro) in one continuous session: a non-breaking `shellTools` config surface, +13 tests, `PASS` pre-completion review, CI green on `f66beef7`.
The release was deferred at ship time per the plan's `mid-batch — defer` marker (batch "shell-tool-aliases", tail `#574`), so the issue stays open and the release-please PR is left unmerged.

### Observations

#### What went well

- **Grounded the config design in the real tool before designing it** (Planning) — cloned `@howaboua/pi-codex-conversion` via `fetch_content` and read `src/tools/exec/command-tool.ts` to confirm `exec_command`'s canonical fields (`cmd` required, `workdir` optional) rather than trusting the issue's prose.
  This is the `missing-context` failure mode pre-empted: the field names and the tool-name-keyed-map shape were verified against source, not assumed.
- **The `ask_user` merge-semantics gate worked as a genuine design conversation** (Planning) — the operator engaged across three rounds ("walk me through the consequences", "what happens when a project wants to clobber global") rather than picking blindly, and each round added new evidence (real-tool facts, the clobber-vs-disable distinction).
  The gate surfaced a security-relevant decision (shallow-merge vs. replace) that a silent default could have gotten wrong.
- **The `fallow dead-code` gate caught the speculative export deterministically** (TDD) — the safety net fired exactly where the plan erred, before push.
- **Clean incremental feedback loop** (TDD) — ran `pnpm run check` + the affected test file after each of the three cycles, not just at the end; the full-suite/lint/fallow sweep at the end found only the one export issue.

#### What caused friction (agent side)

- `missing-context` (planning-time, self-caught by gate) — the plan (`0580` Design Overview + Module-Level Changes) prescribed exporting **both** `ShellToolAlias` and `ShellToolsConfig` from `config-schema.ts`, but `ShellToolAlias` has no in-scope consumer (its consumer is the deferred `#574`).
  The `fallow dead-code` gate rejected it during the end-of-TDD sweep, forcing a `refactor:` commit (`e7cc7260`) to remove the export that a `feat:` commit (`cd4f851a`) had just added.
  Impact: one extra commit and a small feat-adds-then-refactor-removes churn within the same PR; no rework beyond that.
  The `code-design` skill already carries the rule ("Do not add speculative re-exports; fallow will flag them as dead code"), but it was not applied at **plan** time — the gap is that `/plan-issue` does not prompt to defer an export whose only consumer is a later issue.

#### What caused friction (user side)

- Mis-click on the ship-stage release-coordination `ask_user` (cancelled the flow by accident).
  I paused rather than guessing the release decision, re-asked in plain text, and the operator confirmed **defer** immediately.
  Impact: none — no rework, correct outcome; the pause-don't-guess behavior on a high-stakes irreversible gate was the right call.

### Diagnostic details

- **Model-performance correlation** — both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5`, appropriate for read + judgment work; no reasoning-weak-on-judgment or costly-on-mechanical mismatch.
  The main session ran on `opus-4-8` / `sonnet-5`.
- **Escalation-delay tracking** — no `rabbit-hole` sequences; no error was retried more than once.
- **Unused-tool detection** — no gaps; `fetch_content` (repo clone) was the right tool for verifying the external tool's field names, and the subagents covered tidy-first + pre-completion.
- **Feedback-loop gap analysis** — verification ran incrementally (per-cycle `check` + affected test file), not end-only; the deferred-to-end checks (root `lint`, `fallow dead-code`) are the ones that must run late anyway.

### Changes made

1. Appended this Final Retrospective stage entry to `packages/pi-permission-system/docs/retro/0580-shell-tool-alias-config-model.md`.

2. No prompt or `AGENTS.md` changes: the one candidate (a `/plan-issue` reminder to defer an export whose only consumer is a later issue) was declined as first-instance over-fitting — the `code-design` skill already carries the underlying "no speculative re-exports" rule.

   Revisit if the speculative-export-tripping-`fallow` pattern recurs.

3. **Post-ship rename of the `shellTools` config keys** — the operator noticed "field" is not Pi's vocabulary for tool-call input parts.
Verified against `~/development/pi/pi/packages/ai/src/types.ts`: Pi uses `Tool.parameters` (declared schema), `ToolCall.arguments` (runtime values), and JSON-Schema **properties** — never "field."
The term `commandField`/`workdirField` was inherited verbatim from the issue body and never reconciled at plan time (a planning-stage `missing-context`: the field *values* `cmd`/`workdir` were grounded against the real tool, but the meta-term was not).
Renamed `commandField` → `commandArgument` and `workdirField` → `workdirArgument` (operator-chosen: the value names a key in `ToolCall.arguments`, which is what `#574` reads at gate time) across `src/config-schema.ts` (keys + prose descriptions), regenerated `schemas/permissions.schema.json`, `config/config.example.json`, `docs/configuration.md`, the three test files, `docs/architecture/architecture.md`, and both plan files (`0580` + the not-yet-implemented `0574`).
Safe to do without a breaking-change footer because `#580` is merged but **unreleased** (mid-batch defer) and `#574` has a plan but no implementation.
The historical Planning/TDD stage entries above keep the original `commandField`/`workdirField` term as an accurate timeline of what those stages produced.

## Stage: Final Retrospective — Addendum: naming correction (2026-07-13T18:42:03Z)

### Session summary

A short follow-up session in which the operator questioned whether "field" is Pi's term for tool-call input parts.
Investigation against Pi's source confirmed it is not, and the `shellTools` config keys were renamed `commandField`/`workdirField` → `commandArgument`/`workdirArgument` before release (execution detail recorded in the addendum stage's `### Changes made` item 3 above).
This addendum captures the reusable lesson behind that rename.

### Observations

#### What went well

- **Verified against the authoritative source instead of asserting** — read `~/development/pi/pi/packages/ai/src/types.ts` and confirmed `Tool.parameters` / `ToolCall.arguments` / JSON-Schema properties are Pi's vocabulary, so the answer to "is 'field' Pi's term?" rested on the actual SDK contract, not memory.
- **Caught inside the unreleased window** — because `#580` was merged but held under the mid-batch defer, the rename was a clean `refactor:` (no `BREAKING CHANGE:` footer, no consumer to migrate); `#574` had a plan but no implementation, so updating its plan file was the only downstream cost.
- **`ask_user` on a preference-sensitive naming call** rather than picking a term unilaterally — the operator chose `commandArgument`/`workdirArgument` from four grounded options (`argument`/`parameter`/`key`/keep).

#### What caused friction (agent side)

- `missing-context` (user-caught) — the config keys `commandField`/`workdirField` were inherited verbatim from the issue body and carried into a **public config surface** without reconciling the term against Pi's SDK vocabulary.
  The planning stage grounded the field *values* (`cmd`/`workdir`) against the real tool's source but never checked the *naming term* itself; neither planning, TDD, pre-completion review, nor the first Final Retrospective caught it.
  Impact: a post-merge rename touching 11 files plus a CI run — avoided released breakage only because the mid-batch defer left `#580` unreleased.

#### What caused friction (user side)

- The SDK-vocabulary mismatch was **user-caught, not self-identified** — evidence that the existing planning guard for public-surface naming (`plan-issue` step 6, which searches *sibling packages* for conventions) does not prompt a check against the *SDK's* term for the domain concept a config key names.
- Bidirectional (positive): the operator proactively shared the local Pi source path (`~/development/pi/pi`) after a `find /` probe stalled, unblocking the verification in one turn rather than leaving me to hunt for the checkout.

### Diagnostic details

- **Model-performance correlation** — no subagents dispatched this session; the investigation and rename ran in the main session (`opus-4-8` / `sonnet-5`), appropriate for a source-reading + judgment task.
- **Unused-tool detection** — one minor detour: a `find /` sweep for Pi's `.d.ts` files was aborted before the operator pointed to `~/development/pi/pi`; a first grep of the known local checkout path would have skipped it.
  No `Explore`/`colgrep` gap otherwise.
- **Feedback-loop gap analysis** — verification was incremental and complete: affected-file tests + `pnpm run check` after the rename, root `lint` + full suite (2387) before commit, and CI watched to green post-push.

### Changes made

1. Appended this Addendum stage entry to `packages/pi-permission-system/docs/retro/0580-shell-tool-alias-config-model.md`.
2. Added an SDK-vocabulary naming guard to `.pi/prompts/plan-issue.md` step 6: a config key or public field naming an SDK/domain concept should use the SDK's own term (verified against SDK types), not a term adopted verbatim from the issue body (Refs #580).
  The rationale and the 11-file worked example stay here in the retro; the prompt carries only the rule plus a one-clause example.
