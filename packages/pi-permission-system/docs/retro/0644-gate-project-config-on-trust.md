---
issue: 644
issue_title: "pi-permission-system: project policy is loaded without checking project trust"
---

# Retro: #644 — pi-permission-system: project policy is loaded without checking project trust

## Stage: Planning (2026-06-13T00:00:00Z)

### Session summary

Planned the ADR-0001 implementation: gate project-scoped config loading on `ctx.isProjectTrusted()`.
This is a third-party issue (author `marcoscale98`), so the `ask_user` direction gate was mandatory; the operator confirmed implementing the ADR direction, covering **both** untrusted load paths, and **loudly warning** the user on skip.
Produced a 3-cycle TDD plan (`docs/plans/0644-gate-project-config-on-trust.md`) and committed it.

### Observations

- Source review surfaced a hole the issue and ADR-0001 did **not** name: untrusted project config leaks through **two** independent cwd-keyed paths, not one.
  The ADR only covers the permission **policy** (`PermissionManager.configureForCwd`); the extension **runtime config** path (`ConfigStore.refresh` → `loadAndMergeConfigs`) also merges the project's `config.json`, including `yoloMode: true` — arguably the worse hole.
  Operator chose to gate both.
- Design reuses existing levers where possible: passing `undefined` cwd to `configureForCwd` already yields global-only policy (via `derivePolicyLoaderOptions`), so the policy path needs no new manager code.
  The runtime path needs an **explicit** `includeProjectScope` flag, not an empty cwd — `getProjectConfigPath("")` resolves relative to `process.cwd()`, which would defeat the gate.
- Chose a **required** (no-default) `projectTrusted` parameter at every internal seam so TypeScript forces a conscious trust decision — no unsafe "trusted by default" fallback.
  The signature cascade (config-store → session → handler → index.ts) is compile-coupled, so the gate + all consumer/test updates land in one commit (cycle 2), per the lift-and-shift rule.
- Verified `ctx.isProjectTrusted()` exists on `ExtensionContext` in `@earendil-works/pi-coding-agent@0.79.1`.
  `resources_discover` handlers do receive `(event, ctx)`; `index.ts` currently drops the ctx arg — cycle 2 wires it.
- `#646` fail-closed clamp does not interact: an untrusted project's config is never loaded, so `projectConfig.invalid` never fires.
  No regression.
- Breaking change (`fix!`) → next major (package.json already at 21.0.0, release-please manifest ahead).
  Not in any roadmap batch → ship independently.
- Deferred (Open Questions, no follow-up filed): reload path re-reading runtime config on trust grant (safe interim = global-only runtime); surfacing trust state in `/permission-system` UI.

## Stage: Implementation — TDD (2026-07-24T18:00:00Z)

### Session summary

Implemented the trust gate across three TDD cycles plus one tidy-first prep commit: (1) `loadAndMergeConfigs` gained an `includeProjectScope` option; (2) the required `projectTrusted` boolean cascade through `ConfigStore.refresh` / `PermissionSession.{refreshConfig,resetForNewSession,reload}` / the two lifecycle handlers / `index.ts`, plus the loud warn + `project_trust.skipped` review-log entry; (3) docs (ADR-0001 status, `configuration.md`, `README.md`, new migration note).
Test count went from 2555 to 2570 (+15); all green, `check`/`lint`/`fallow` clean.

### Observations

- **Plan miss caught by `tsc`** — the plan's Module-Level Changes did not enumerate two additional project-config load sites: `before_agent_start` also calls `refreshConfig` (a mid-session runtime-config reload that would have re-leaked an untrusted project's `yoloMode` right before agent start), and the factory-init `configStore.refresh()` in `index.ts`.
  The required-parameter cascade made `tsc` surface both immediately.
  Both are now gated (`before_agent_start` on `ctx.isProjectTrusted()`, no re-warn; factory-init withholds the project scope with `(undefined, false)` since no trust decision exists yet).
  Grepped every `refresh`/`configureForCwd` call site to confirm no ungated path remains.
  Deviation documented in the `fix!` commit body.
- **Tidy-first paid off** — the assessor's one recommendation (extract `makeBaseCtx` in `composition-root.test.ts`) turned a five-place `isProjectTrusted` edit into one.
  Two more hand-built ctx objects outside that file (`session-start.test.ts`, `permission-events.test.ts`) still needed the field; the latter only surfaced at full-suite runtime (`ctx.isProjectTrusted is not a function`), not `tsc` — a reminder that hand-rolled ctx literals dodge the type check.
- **End-to-end proof** — the composition-root pair (untrusted project `bash: allow` does NOT override global `bash: deny`; trusted DOES) exercises the whole gate through the real service, the strongest evidence the fix holds.
- **`extractedProject` empty on skip** — `loadAndMergeConfigs` returns `project: {}` when the scope is withheld, so `MergedConfigResult.project` stays honest for downstream readers.
- **Pre-completion reviewer: PASS** (one non-blocking WARN, now fixed).

### Reviewer warnings

- WARN (fixed): the `README.md` "Upgrading" heading read `21.0.0`, but 21.0.0 already released (#646); relabeled to `22.0.0` (next major) and updated the in-page anchor.
  Amended into the docs commit before ship.

## Stage: Final Retrospective (2026-07-24T19:00:00Z)

### Session summary

One continuous session carried #644 through planning, TDD implementation, and ship: a third-party security bug (untrusted project config could loosen global policy) gated behind `ctx.isProjectTrusted()` across both config-load paths, released as `pi-permission-system-v22.0.0` (breaking major).
The ship phase was clean end-to-end — lint/fallow/CI green, issue closed with a curated comment, and the release-please PR merged after correctly waiting out an in-progress check.

### Observations

#### What went well

- **Ship-runbook `UNSTABLE` disambiguation held.**
  `release_pr_merge` refused PR #650 with `merge_state: UNSTABLE`; `statusCheckRollup` showed a `check` run still `IN_PROGRESS` (not the empty-rollup `GITHUB_TOKEN` case).
  The runbook's three-branch rule was applied correctly — waited via `ci_watch` for the check to finish, then retried `release_pr_merge` (rather than falling back to `gh pr merge` while a check was running).
  Merge succeeded, `v22.0.0` tagged, `publish` job green.
- **Required-parameter design as a completeness check.**
  Choosing a required (no-default) `projectTrusted` at every seam turned two unenumerated call sites (`before_agent_start`, factory-init `configStore.refresh()`) from a silent security gap into `tsc` errors during cycle 2 — an optional-with-default param would have compiled and shipped the hole.
  The design choice paid a concrete safety dividend.
- **Pre-completion reviewer caught a real doc slip.**
  The `21.0.0`→`22.0.0` version-label WARN would have misdirected readers post-release; fixed and amended before ship.
  The version prediction (22.0.0) was then confirmed by the release-please PR body.

#### What caused friction (agent side)

- `missing-context` — a hand-built ctx literal in `test/permission-events.test.ts` (cast to `ExtensionContext`) lacked `isProjectTrusted`, so it slipped `tsc` and failed only at the full-suite run (`ctx.isProjectTrusted is not a function`).
  18 test files hand-roll ctx literals via `as unknown as ExtensionContext` / `as never`; only 4 needed the new field, and the casts hide the gap from the type check.
  Impact: one extra fix cycle during TDD (a full-suite runtime failure after the affected-file cycle passed); no shipped defect.
- `missing-context` (plan-time) — the plan's Module-Level Changes did not enumerate the `before_agent_start` and factory-init `refreshConfig` call sites, despite the `testing` skill's rule to list every file in a threaded-parameter chain.
  Impact: none in the end — the required-param cascade made `tsc` surface both, folded into the same commit; but the miss was a latent security gap that only the design choice caught.

#### What caused friction (user side)

- None.
  The one preference-sensitive gate (third-party direction + scope) was resolved cleanly at plan time via `ask_user`; the rest ran without correction.

### Diagnostic details

- **Feedback-loop gap** — verification cadence was otherwise good (per-cycle `vitest`, `check` after interface changes, full suite + `check` + `lint` + `fallow` at cycle end), but the `permission-events` ctx failure surfaced only at the full-suite run, not the cycle-scoped file run — because it lives in a test file outside the changed cycle's affected set.
  This is the hand-built-ctx hazard above, not a verification-timing miss; the fix is a grep discipline (proposed below), not more-frequent test runs.
- **Model-performance correlation** — session ran on a mix of `anthropic/claude-opus-4-8` and `anthropic/claude-sonnet-5`; the `tidy-first-assessor` and `pre-completion-reviewer` subagents ran on their frontmatter-pinned models.
  No reasoning-weak-on-judgment or high-cost-on-mechanical mismatch.
  The reviewer's long wall-clock (~37 min, 45 tool uses) was thorough judgment work, appropriately modeled — not a mismatch.
- **Escalation-delay / unused-tool** — no rabbit-holes; no >5-call error loops; `grep`/`colgrep` and both bracketing subagents used where appropriate.
  Nothing notable.

### Changes made

1. `.pi/skills/package-pi-permission-system/SKILL.md` — added a Testing-section rule: when a change reads a new `ExtensionContext` field/method, update `makeCtx` **and** grep every hand-built ctx literal (`grep -rln "hasUI:" test/`), since the `as unknown as ExtensionContext` / `as never` casts bypass `tsc` and fail only at the full-suite run (#644 evidence).
