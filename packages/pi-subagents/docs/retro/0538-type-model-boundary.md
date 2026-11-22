---
issue: 538
issue_title: "pi-subagents Phase 20 Step 4: type the model boundary"
---

# Retro: #538 — pi-subagents Phase 20 Step 4: type the model boundary

## Stage: Planning (2026-07-08T00:00:00Z)

### Session summary

Planned Phase 20 Step 4: typing the `Model<any>` boundary through `model-resolver.ts`, `spawn-config.ts`, `runtime.ts`, and `service-adapter.ts` to remove two file-level `eslint-disable` headers and drop `resolveModel` / `service-adapter.spawn` off the fallow high-complexity list.
Verified the SDK exports a usable `Model` type (`@earendil-works/pi-ai`) with typed `id`/`name`/`provider`, and that `@typescript-eslint/no-explicit-any` is off, so `Model<any>` is lint-clean and matches four sibling modules' convention.
Produced a two-refactor-commit + one-docs-commit plan and committed it.

### Observations

- **`Model<any>` vs `Model<Api>`**: chose `Model<any>` to match the issue, the roadmap, and four existing modules, despite `Model<Api>` being strictly more precise (it matches the real `ModelRegistry` class return types exactly).
  Convention-consistency won; not surfaced to the operator as it was explicitly specified.
- **Forced commit coupling**: retyping `resolveInvocationModel`'s `parentModel` parameter to `Model<any> | undefined` breaks the `spawn-config.ts` call site at typecheck (a `{ id; name? }` is not a `Model<any>`), so `model-resolver.ts` + `spawn-config.ts` + `runtime.ts` must land in one commit.
  `service-adapter.ts` is independent (its own `spawn` path, injected `resolveModel`) and is a separate commit.
- **`ModelInfo.modelRegistry: unknown` → `ModelRegistry | undefined`** required `resolveInvocationModel` to accept `ModelRegistry | undefined` with a new no-registry guard.
  The guarded path is unreachable mid-session and previously would have thrown a `TypeError`; converting an unreachable crash into a typed error result is internal hardening, kept as `refactor:` (not `fix:`), preserving the refactor-only / release-neutral framing.
- **Test-fixture migration**: registry typing forces `MODELS` / stub returns from partial literals (`{ id, provider }`) to full `Model<any>` objects.
  Planned a shared `test/helpers/make-model.ts` builder (landed with its first consumer to avoid a fallow `unused-exports` flag), rather than `as unknown as` casts.
- **`ParentSnapshot.model` deferred**: a separate `unknown` thread at the SDK-capture boundary; typing it cascades into session-config assembly and sits behind a genuine SDK gap.
  Left as a Non-Goal, not filed (roadmap does not name it; nothing speculative filed).
- **Architecture-doc convention**: prior Phase 20 steps append a `Landed:` note per step and leave the Phase-19-end discovery/health-metrics snapshot untouched; the plan follows this.
  The path is release-excluded, so the `docs:` landing commit does not cut a release.

## Stage: Implementation — TDD (2026-07-14T21:20:00Z)

### Session summary

Executed the plan in 5 commits: 2 tidy-first preparatory commits (a `makeModel` fixture builder migrating three test files off partial model literals; an untyped extraction of `findBestFuzzyMatch` from `resolveModel`), 2 refactor commits (typing `model-resolver.ts`/`spawn-config.ts`/`runtime.ts` against `Model<any>` as one coupled change; typing `service-adapter.spawn` via an extracted `resolveModelOption` helper), and 1 `docs:` commit marking Phase 20 Step 4 landed in the architecture doc.
Test count went from 961 to 965 (4 new: 2 `make-model.test.ts` cases, 2 `resolveInvocationModel` no-registry-guard cases).
Pre-completion reviewer: **PASS**.

### Observations

- **Tidy-first assessor delivered as advertised**: both of its Recommended preparatory commits (fixture migration, complexity extraction) were taken as-is and genuinely isolated the two "real" typing commits into pure signature diffs, matching its stated rationale.
  Its Optional suggestion (pre-extracting `resolveModelOption` untyped) was skipped — the branch was small enough that the plan's single-commit bundling in TDD step 2 was reasonable without it.
- **`null` → `undefined` test fixture deviation** (anticipated in planning, confirmed necessary in implementation): retyping `resolveInvocationModel`'s `parentModel` to `Model<any> | undefined` broke two existing tests that passed `parentModel: null`.
  Fixed in the same commit (7c8ddefe) by changing both the input and the expected `{ model: ... }` result symmetrically — the function body (`return { model: parentModel }`) is an unchanged passthrough, so this is a type-forced fixture update, not a behavior change.
  Verified by the pre-completion reviewer as legitimate.
- **Unplanned deviation — `test/helpers/make-deps.ts`**: not listed in the plan's Module-Level Changes, but its `getModelInfo` stub also constructed a partial `ModelInfo`-shaped object (`{id, name}` parentModel, `modelRegistry` missing `find()`) that broke under the widened types.
  Fixed in the same commit as the type change (mechanical, forced by the shared type — the same class of fallout the plan's Test Impact Analysis anticipated for the three explicitly-named test files, just one file the initial file grep missed).
- **Unplanned addition — `test/helpers/make-model.test.ts`**: not explicitly named in the plan, but added to match this package's established convention (every `test/helpers/*.ts` file has a paired `*.test.ts`) — confirmed by checking sibling helpers before writing it.
- **TS narrowing surprise**: after typing `model: Model<any> | undefined` in `spawn-config.ts`, eslint's `no-unnecessary-condition` flagged `model?.name ?? effectiveModelId` as fully unreachable — the type checker narrows `model` to non-undefined inside the ternary branch guarded by `effectiveModelId && ...` (since `effectiveModelId` is itself derived from `model?.id`).
  Simplified to `model.name` directly; `tsc --noEmit` confirmed the narrowing holds with no cast needed.
- **CRAP-threshold verification**: used `fallow health --complexity --format json` (not the human-readable grep) to confirm `severity` dropped from `"high"` to `"moderate"` for `service-adapter.spawn`, matching the testing skill's Refs #537 guidance to verify quantitative targets against structured output.
- **Commit-message self-correction**: the first refactor commit's message initially claimed `service-adapter.spawn` was already off the HIGH-CRAP list — caught before it left this session (still unpushed) and fixed via `git commit --amend`, since that outcome only lands in commit 2.
- **Amend safety check**: before amending, confirmed via `git log -1 --format=%H` that HEAD was this session's own just-made commit (per AGENTS.md guidance) before running `--amend`.

## Stage: Final Retrospective (2026-07-14T22:00:00Z)

### Session summary

One continuous session carried #538 through planning → TDD → ship: an internal type-safety refactor typing the `pi-subagents` model boundary against `Model<any>`, removing two file-level `eslint-disable` headers and dropping `resolveModel` and `service-adapter.spawn` off fallow's complexity list.
Eight commits landed (plan + planning retro + 2 tidy-first prep + 2 refactor + landed-docs + TDD retro), CI passed on `89471018`, and the issue closed with no release (all `refactor:`/`test:`/`docs:` commits auto-batch into the next `feat:`/`fix:` release).
The pre-completion reviewer returned PASS on the first pass; no rework cycles occurred.

### Observations

#### What went well

- **Tidy-first prep commits paid off concretely** — the `tidy-first-assessor`'s two Recommended commits (the `makeModel` fixture migration and the untyped `findBestFuzzyMatch` extraction) were landed as-is and left the two "real" typing commits (`7c8ddefe`, `b0480c6d`) as pure signature diffs.
  This is the first session where that workflow's isolation benefit was visibly realized end-to-end (the agent's own skill still carries a "first-live-use checkpoint").
- **The Red step exercised behavior, not just a signature** — the no-registry-guard test failed with a real `TypeError` crash before Green, confirming it drove the new total-function contract rather than coincidentally passing the old runtime path (the exact hollow-red trap the testing skill warns about).
- **Planning anticipated the two hardest deviations** — the `null` → `undefined` fixture change and the forced single-commit coupling of `model-resolver` + `spawn-config` + `runtime` were both called out in the plan's stage notes before implementation, so neither caused a stall.

#### What caused friction (agent side)

- `other` (premature outcome claim) — the first refactor commit's message (`7c8ddefe`) initially claimed `service-adapter.spawn` was "off the HIGH-CRAP list," but that outcome only lands in the *next* commit (`b0480c6d`).
  Self-identified before push and fixed via `git commit --amend` (with the AGENTS.md HEAD-ownership check first).
  Impact: one amend, no rework, nothing pushed — a documentation-of-work slip, not a code slip.
- `missing-context` (structural-mock grep gap) — the plan's Test Impact Analysis named three test files but missed `test/helpers/make-deps.ts`, whose `getModelInfo` stub builds a `ModelInfo`-shaped object *inline* without naming the `ModelInfo` type, so the planning-time type-name grep did not surface it.
  Impact: none beyond one extra file in the same commit — `tsc --noEmit` caught it immediately after the coupled type change.

#### What caused friction (user side)

- None.
  No corrections, redirections, or clarifications were needed across the three stages; operator involvement was model selection only.

### Diagnostic details

- **Model-performance correlation** — both subagent dispatches (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5`, appropriate for judgment-heavy read-only work; no reasoning-weak-model-on-hard-task or costly-model-on-mechanical-task mismatch.
- **Escalation-delay tracking** — no `rabbit-hole` friction; the longest same-error sequence was the eslint `no-unnecessary-condition` flag on the `model?.name` ternary, resolved in one edit plus one `tsc` verify (well under the 5-call flag).
- **Feedback-loop gap analysis** — verification was incremental, not end-loaded: `tsc --noEmit` was run immediately after the coupled type change specifically to surface the planned `spawn-config` break, `vitest run <file>` after each Red/Green, and the full `check`/`lint`/`test`/`fallow` gate plus JSON-based CRAP verification at the end.
  No gap to flag.

### Changes made

1. Appended this Final Retrospective stage entry to `packages/pi-subagents/docs/retro/0538-type-model-boundary.md`.
   No `AGENTS.md` or prompt changes: both friction points were self-identified, zero-rework, and already covered by existing guardrails (`tsc` for the structural-mock miss; commit-scope convention for the outcome-timing slip).
   Operator confirmed "land retro only."
