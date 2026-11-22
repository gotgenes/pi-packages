---
issue: 263
issue_title: "Extract worktree isolation to @gotgenes/pi-subagents-worktrees"
---

# Retro: #263 — Extract worktree isolation to @gotgenes/pi-subagents-worktrees

## Stage: Planning (2026-05-29T17:00:46Z)

### Session summary

Produced a cross-package plan (`docs/plans/0263-extract-worktrees-package.md`) for Phase 16 Step 3 of [ADR-0002]: create `@gotgenes/pi-subagents-worktrees` implementing the `WorkspaceProvider` seam (#262, already landed and wired provider-first in `Agent.run()`), then evict the legacy worktree path and the `isolation` axis from the core.
The plan has nine TDD cycles split into Track A (build the new package) and Track B (two `feat!` core-eviction commits), plus root-config registration and docs.

### Observations

- The `WorkspaceProvider`/`Workspace` seam already exists; #262 is closed and `Agent.run()` already consults a provider provider-first with a legacy `worktree` fallback.
  This issue is purely "build the consumer + delete the fallback," which is smaller than the issue text implies.
- Three design decisions were resolved via `ask_user`: (1) opt-in is **per-agent via package config** (a `worktreeAgents` list keyed off `WorkspacePrepareContext.agentType`), (2) worktree-creation failure **throws and fails the run** (preserves the old strict `WorktreeIsolation.setup()` semantics), (3) the provider registers **once at extension init** (not per-session), relying on Pi's deterministic `settings.json` load order.
- The user explicitly flagged two constraints mid-session: the new package must be added to `.pi/settings.json` like the others, and Pi's `settings.json` order is deterministic (first-listed loads first) — so the new package is listed **after** `pi-subagents` and registration-at-init is safe.
  Both are captured in the plan.
- This is the **first intra-repo `@gotgenes/*` package import** — the new package imports seam types + `getSubagentsService` from `@gotgenes/pi-subagents`.
  Plan wires it as `workspace:*` devDep + peerDep range; flagged in Risks since no existing package does this.
- `service.ts` already carried a comment that "#263 adds named re-exports when it imports them" — so Step 1 adds `Workspace`/context/result type re-exports (currently only `WorkspaceProvider` is named).
- Core eviction must be **two type-coherent commits**: removing the tool-facing `isolation` axis (`SpawnExecution`/`AgentInvocation` field removal breaks all downstream object literals at once), then deleting the legacy worktree wiring + modules.
  `AgentSpawnConfig.isolation` is left optional after Step 7 so Step 7 type-checks, then removed in Step 8.
- Label note: the issue carries `pkg:pi-permission-system` **and** `pkg:pi-subagents`, but the content does not touch the permission system.
  Treated as cross-package (new package + core + root config) and placed in top-level `docs/plans/`; the `pi-permission-system` label appears incongruent.
- Confirmed no regression for no-provider children: `agent-runner.ts` uses `effectiveCwd = options.context.cwd ?? snapshot.cwd`, so a `undefined` cwd already falls back to the parent cwd today.

## Stage: Implementation — TDD (2026-05-29T17:32:42Z)

### Session summary

Executed the first three TDD cycles, then paused.
Steps 2–3 landed and are green on `main`: the new `@gotgenes/pi-subagents-worktrees` package scaffold with the git-plumbing lift-and-shift (`worktree.ts` + migrated `worktree.test.ts`, 11 tests) and the `worktreeAgents` config loader (`config.ts` + `config.test.ts`, 7 tests).
Step 1 (re-export seam types from pi-subagents `service.ts`) and Step 4 (the `WorkspaceProvider` implementation, written and green under vitest) were reverted; remaining steps (5–9, plus the eviction) are deferred behind prerequisite issue #270.

### Observations

- **Blocker (the headline):** the worktrees package must `import { getSubagentsService, type WorkspaceProvider } from "@gotgenes/pi-subagents"`, but pi-subagents is not type-consumable from a sibling package.
  Three compounding causes: (1) `exports["."]` points at a non-existent `./src/service.ts` (real file: `./src/service/service.ts`); (2) the public entry uses the internal `#src/*` alias, which a consumer's `tsc` resolves against the *consumer's* config; (3) `tsconfig` `paths` are program-global (collide with pi-subagents' own `#src` — both packages have a `debug.ts`), and tsc won't resolve package.json `imports` `.ts` targets.
  Filed as prerequisite **#270**; `/plan-issue`'s "first intra-repo package import" risk note proved accurate.
- **Decision (scope):** rather than expand #263 to re-package pi-subagents (would introduce the repo's first build step, mixed concerns), split the packaging work into #270 and pause #263.
  The committed Steps 2–3 are prerequisite-independent and were kept; Step 1's re-exports were dropped because their exact shape depends on #270's chosen fix.
- **Architectural note:** importing pi-subagents source contradicts the repo's own composition rule (code-design skill: prefer the event bus / `Symbol.for()` service; `pi-permission-system` never imports `@gotgenes/pi-subagents`).
  If #270 cannot make the source cleanly consumable, the fallback for #263 is a local seam contract accessed via the published `Symbol.for("@gotgenes/pi-subagents:service")` global.
  Flagged in the plan's new Status section.
- **`@types/node` quirk:** the new package needed `"types": ["node"]` in its `tsconfig.json` for node built-ins / `process` to resolve, even though `pi-session-tools` (identical otherwise) does not.
  Auto type-discovery did not kick in for the new package; the explicit `types` is the minimal fix and avoids adding an unused dep just to trigger transitive discovery.
- **Latent bug found:** pi-subagents `exports["."]` has always pointed at the wrong path; harmless to date because nothing imports the package by name.
  Captured in #270.
- **Pre-completion review:** not dispatched — the implementation was paused before completing all steps, so the pre-completion protocol does not apply yet.
  It will run when #263 resumes and finishes.
- **Remaining work on resume:** Step 1 (re-exports, contingent on #270), Step 4 (`WorkspaceProvider` impl), Step 5 (extension entry), Step 6 (settings + release-please registration), Steps 7–8 (core eviction, breaking), Step 9 (docs).

## Stage: Implementation — TDD (resumed) (2026-05-29T21:09:56Z)

### Session summary

Resumed after #270 published `@gotgenes/pi-subagents@11.6.0` (the bundled `dist/public.d.ts`).
Completed the remaining steps: the `WorkspaceProvider` impl, the extension entry, repo-config registration, and the two breaking core-eviction commits, plus docs.
The worktrees package is 26 tests (4 files); the core dropped to 1016 tests (−41 worktree tests removed); all 7 packages, `pnpm run check`/`lint`, and `pnpm fallow dead-code` are green.
Pre-completion reviewer: **PASS**.

### Observations

- **Step 1 dropped (chicken-and-egg confirmed).**
  The published `11.6.0` `dist/public.d.ts` exports only `WorkspaceProvider` by name; `Workspace`/`WorkspacePrepareContext`/etc. are inlined-but-unexported.
  Adding re-exports in #263 would be unconsumable until pi-subagents re-publishes, and `fallow` would flag them as dead.
  The provider recovers the collaborator types via indexed-access aliases (`Parameters<WorkspaceProvider["prepare"]>[0]`, `NonNullable<Awaited<ReturnType<…>>>`).
  Named re-exports tracked in new issue **#272**.
- **Registry consumption, config in `pnpm-workspace.yaml` not `.npmrc`.**
  Per #270's directive ("no workspace trickery"), the worktrees package depends on `@gotgenes/pi-subagents@^11.6.0` from the registry with `linkWorkspacePackages: false`.
  The user corrected my initial `.npmrc` plan: pnpm 11 reads `linkWorkspacePackages` from `pnpm-workspace.yaml`, where this repo already centralizes `catalog`/`allowBuilds`.
- **Provider shape.**
  Class `WorktreeWorkspaceProvider implements WorkspaceProvider` with an inner `WorktreeWorkspace implements Workspace` (Workspace recovered via the derived alias).
  `prepare` keeps `async` with an `eslint-disable require-await` (the seam is async; staying async makes creation failure *reject* rather than throw synchronously, which the `.rejects` test relies on).
- **`settings.json` npm entry breaks unpublished packages.**
  Adding `{ "source": "npm:@gotgenes/pi-subagents-worktrees" }` made the subagent harness (and Pi launch) try to `npm install` an unpublished package — the `pre-completion-reviewer` dispatch failed twice until I removed the `npm:` entry.
  Only the local workspace-path entry is added now; the `npm:` entry must wait until first publish.
- **Plan file-list gaps (handled).**
  The tool-facing `isolation` axis also lived in `ui/agent-creation-wizard.ts`, `ui/agent-config-editor.ts`, and `config/custom-agents.ts` — not in the plan's Module-Level Changes.
  The two-commit split held: Step 7 kept `IsolationMode` alive for `AgentSpawnConfig`, Step 8 removed it; `fallow` then flagged `IsolationMode` as orphaned and it was folded into the Step 8 commit.
- **Reviewer WARN findings (non-blocking, deferred):** (1) `worktree.ts` `cleanupWorktree` mutates its `WorktreeInfo` arg (`worktree.branch = …`) redundantly with the returned result — a pre-existing pattern carried verbatim from the core lift-and-shift; (2) `debug.ts` reads `process.env` inside `isDebug()`, mirroring the core's intentional pattern.
  Both left as-is to preserve the verbatim lift-and-shift; worth a future cleanup.
- **Follow-ups filed:** #272 (named seam-type re-exports).
  The `npm:` settings entry and the README's install instructions become accurate once the package first publishes.

## Stage: Final Retrospective (2026-05-29T23:17:50Z)

### Session summary

Shipped #263 across four stages (plan → TDD-paused → #270 prerequisite → TDD-resumed → ship): a new `@gotgenes/pi-subagents-worktrees` package implements the `WorkspaceProvider` seam, and the legacy worktree path plus the `isolation` axis were evicted from the core.
Released `pi-subagents-v12.0.0` (breaking) and `pi-subagents-worktrees-v0.1.0`; pre-completion reviewer returned PASS.
The dominant story was a cross-package *consumability* blocker that was flagged as a planning risk but only proven at implementation time, spawning the #270 prerequisite.

### Observations

#### What went well

- **Escalating the blocker to a prerequisite instead of chasing it.**
  When the sibling-import failure surfaced under `tsc` in the first TDD session, the response was to stop, file #270, and pause #263 — not to bolt a build step onto #263.
  Clean scope control; the paused Steps 2–3 stayed green and independent.
- **The retro file worked as the cross-session bridge.**
  The resumed session read #270's "no workspace trickery / consume the published release" directive straight from the retro stage notes and applied it without re-litigating.
- **Indexed-access aliases as a principled workaround.**
  Recovering the unexported seam collaborator types via `Parameters<WorkspaceProvider["prepare"]>[0]` / `NonNullable<Awaited<ReturnType<…>>>` unblocked the consumer against the published `11.6.0` without forcing a premature re-publish, and the proper fix was filed as #272.
- **Autosquash kept history clean under mid-session discovery.**
  `IsolationMode` (caught orphaned by `fallow`) folded into the Step 8 eviction commit; the `settings.json` `npm:` fix folded into Step 6 — both via `--fixup` + `--autosquash`, so the shipped history reads as coherent steps.

#### What caused friction (agent side)

- `missing-context` — the `.pi/settings.json` `npm:` entry for the still-unpublished package made the subagent harness try to `npm install @gotgenes/pi-subagents-worktrees`, failing the `pre-completion-reviewer` dispatch **twice** before it was diagnosed and the entry removed.
  Impact: two failed subagent dispatches (~7 min) plus a Step 6 fixup commit.
  Self-identified (diagnosed from the install error).
- `missing-context` — first proposed `.npmrc` for `linkWorkspacePackages` when this repo centralizes every pnpm setting (`catalog`, `allowBuilds`) in `pnpm-workspace.yaml`.
  Impact: no rework — the user redirected before implementation.
  User-caught.
- `missing-context` — the consumability failure (stale `exports` path + `#src` alias collision) was *flagged as a risk* in planning ("first intra-repo package import") but the plan committed to `workspace:*` without an empirical probe; the real failure mode only appeared at TDD Step 4 under `tsc`.
  Impact: paused #263, spun up the full #270 plan/build/ship cycle, reverted Steps 1 and 4.
  Self-identified.
- `other` (under-communicated workaround) — applied the indexed-access alias workaround and left a code comment, but did not proactively file the follow-up issue; #272 was only filed after the user asked "why did we not stop to fix the types… create a GitHub Issue."
  Impact: no rework, but the follow-up would have been missed without the prompt.
  User-caught.

#### What caused friction (user side)

- The "no workspace trickery / use the released version" constraint was settled in #270 and arrived in this session as a retro note — a clean handoff, not friction.
  The user's two mid-session interventions ("why `.npmrc`?" and "create a GitHub Issue") were both *redirecting questions* that landed before rework, which is the cheap place to catch things — worth repeating.

### Diagnostic details

- **Model-performance correlation** — the only subagent dispatch was the `pre-completion-reviewer` (judgment-heavy review, appropriate model); its two early failures were infra (`npm install`), not a model mismatch.
- **Escalation-delay** — no error sequence exceeded 5 consecutive tool calls; the reviewer-dispatch failure resolved in 2 attempts, and the consumability blocker was escalated to #270 rather than chased.
- **Feedback-loop** — healthy and incremental: `pnpm run check` after each core-eviction edit batch, full suite after each step, `verify:public-types` for the public-surface change, and `fallow dead-code` at the end (which caught orphaned `IsolationMode`).
  Running `fallow` right after Step 8 would have caught it one step earlier, but the final gate sufficed.

### Changes made

1. `AGENTS.md` (Code Style, pnpm bullets) — added a rule that pnpm settings (`catalog`, `allowBuilds`, `linkWorkspacePackages`) live in `pnpm-workspace.yaml`, not `.npmrc`.
2. `.pi/skills/package-pi-subagents/SKILL.md` (Build section) — added a note that sibling packages consume the published registry release (`linkWorkspacePackages: false`), not a workspace symlink, with `@gotgenes/pi-subagents-worktrees` as the reference.
3. Declined proposal B (`.pi/settings.json` registration timing) and the `plan-issue` "probe first-of-its-kind integrations" note — the `settings.json` `npm:`-entry caveat remains captured in this retro's stage notes only.

[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
