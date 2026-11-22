---
issue: 611
issue_title: "Finish typing the model boundary in the snapshot and session-assembly thread"
---

# Retro: #611 — Finish typing the model boundary in the snapshot and session-assembly thread

## Stage: Planning (2026-07-18T00:00:00Z)

### Session summary

Produced the numbered plan for Phase 21 Step 3 — a pure Category C type-threading refactor typing `model` / `parentModel` against `Model<any>` and `modelRegistry` against the `model-resolver` `ModelRegistry` across the snapshot and session-assembly thread, dropping the `runtime.ts` cast and the `parent-snapshot.ts` `!`.
Issue is the operator's own and unambiguous (`Release: independent`), so the `ask-user` gate was skipped.
Confirmed the 7-site recompute baseline, verified the SDK surface (`ExtensionContext.modelRegistry` is non-optional), and enumerated the full test-fixture blast radius.

### Observations

- **Key design decision:** make `SessionContext.modelRegistry` non-optional (matching the SDK) so the `parent-snapshot.ts` `!` drops cleanly, rather than making the snapshot field optional and cascading `registry?.` guards into `resolveDefaultModel` (a subtle throw→fallback behavior shift for no gain).
- The type thread is entangled — `resolveDefaultModel`'s return type depends on `registry.find`'s return type — so it cannot be split into "model typing" and "registry typing" commits; it lands as one atomic `refactor:` commit plus a `docs:` commit for the roadmap step-mark.
- Adopting the shared `ModelRegistry` interface also collapses a duplicated inline structural type (`{ find(...): unknown; getAvailable?() }`) present in both `parent-snapshot.ts` and `session-config.ts`.
- Three test fixtures pass partial `Model` literals or registries missing `getAll` **uncast** and will break under tightening: `test/helpers/stub-ctx.ts`, `test/session/session-config.test.ts`, `test/runtime.test.ts` — the plan enumerates each edit (switch partials to `makeModel(...)`, add `getAll`, widen `getAvailable` returns to `Model<any>[]`).
  Fixtures that cast via `as unknown` / `as any` (`parent-snapshot.test.ts`, `print-mode.test.ts`) need no change.
- `CreateSessionOptions.model` / `.modelRegistry` (`create-subagent-session.ts`) are typed too even though only `model` is counted by the metric — they are the same thread and `index.ts` casts `as any` at the SDK-creation seam, so no compat issue.
- Lands as `refactor:` (hidden changelog type) → no dedicated release; auto-batches into the next unhidden release.
  Next stage is `/tdd-plan` (treated as a compiler-guarded refactor: no new behavioral red→green cycle).

## Stage: Implementation — TDD (2026-07-18T11:20:00Z)

### Session summary

Executed the type-threading refactor across the snapshot and session-assembly boundary: four commits (two preparatory `test:` fixture migrations recommended by the tidy-first assessor, one atomic `refactor:` for the entangled type thread, one `docs:` marking Phase 21 Step 3 ✅).
The recompute metric landed at 0 (7 → 0 `unknown` sites), the `runtime.ts` cast and `parent-snapshot.ts` `!` are gone, and the full suite stayed at 1073 tests passing with no delta (a pure type-only change — the compiler plus the existing suite were the safety net).

### Observations

- **Tidy-first paid off exactly as the assessor predicted.**
  The two prep commits (`session-config.test.ts` partials → `makeModel(...)` + `getAll`; `runtime.test.ts` default `modelRegistry` stub + `getModelInfo` literal → `makeModel`) landed green against the still-`unknown` types, leaving the `refactor:` commit's diff in those files to nothing.
  The assessor's scope boundary held — every Recommended item was inside the target-file list, and it correctly rejected a premature shared stub-registry helper.
- **One unplanned fixture surfaced:** `test/session/context.test.ts`'s `makeCtx` set `modelRegistry: undefined`, which broke once `SessionContext.modelRegistry` went non-optional.
  Caught immediately by `pnpm run check`, fixed in the `refactor:` commit with the same `{ find: () => undefined, getAll: () => [] }` stub used elsewhere.
  The plan's "no change needed" list had enumerated the SessionContext/ParentSnapshot constructors but missed this one (a `buildParentContext` test fixture).
  A `grep -rn "modelRegistry: undefined"` at plan time would have caught it.
- **Design decision validated:** making `SessionContext.modelRegistry` non-optional (matching the SDK's `ExtensionContext`) was the clean lever to drop the `!` — no cascade of `registry?.` guards into `resolveDefaultModel`, and only three fixtures needed a stub-registry default.
  `getModelInfo`/`service-adapter` keep their `ModelRegistry | undefined` results via `currentCtx?.` (optional from `currentCtx`, not the field), so no consumer regressed.
- **Pre-completion reviewer: PASS** — all deterministic checks green (check/lint/test/fallow), recompute metric verified at 0, 6/6 Mermaid diagrams parse with the new `✅` `S3` node, code design clean (mechanical type substitutions, no control-flow change), cross-step invariants preserved (model-resolution priority + `getModelInfo` pass-through pinned by still-passing tests, now with a stronger `toBe(model)` identity assertion).
  No warnings.

## Stage: Final Retrospective (2026-07-18T12:00:00Z)

### Session summary

Single-conversation issue spanning planning → TDD → ship → retro for Phase 21 Step 3, a pure type-threading refactor (`model`/`parentModel` → `Model<any>`, `modelRegistry` → shared `ModelRegistry`) that dropped the `runtime.ts` cast and `parent-snapshot.ts` `!` and completed Phase 21.
Shipped cleanly: 1073 tests green with no delta, recompute metric 7 → 0, pre-completion PASS, CI success, issue closed; no release cut (all commits are hidden `refactor:`/`test:` types or `docs:` on excluded paths, so the work auto-batches into the next unhidden release).

### Observations

#### What went well

- **Tidy-first cleanly applies to a *type* refactor, not just a behavioral one.**
  The two preparatory `test:` commits migrated `session-config.test.ts` / `runtime.test.ts` fixtures onto `makeModel(...)` while the production types were still `unknown` — so they landed green independently and shrank the atomic `refactor:` commit's diff in those files to near-nothing.
  The `tidy-first-assessor` predicted this exactly and its scope boundary held (every Recommended item inside the target-file list; it correctly rejected a premature shared stub-registry helper).
- **Compiler-guarded refactor discipline paid off.**
  With no behavioral red→green available, `pnpm run check` ran after each prep commit and before the main commit, catching the one unplanned fixture immediately (see below) rather than at end-of-cycle.

#### What caused friction (agent side)

- `missing-context` (planning) — the plan's touch-point enumeration missed `test/session/context.test.ts`'s `makeCtx`, which set `modelRegistry: undefined` incidentally (a `buildParentContext` fixture that never reads the registry) and broke when `SessionContext.modelRegistry` went non-optional.
  Impact: minimal — one `tsc` error at TDD time, fixed with a one-line stub edit folded into the `refactor:` commit; no extra commit, no rework beyond ~30s.
  Self-identified (compiler-caught, not user-caught).
  Root cause: the plan grepped for the field's *use* sites (model/registry constructors) but not the exact `modelRegistry: undefined` literal that an optional→required tightening breaks.
  This is a distinct case from the existing #539 touch-point rule (which covers `unknown` → concrete *parameter* types).

#### What caused friction (user side)

- None.
  The issue was well-specified (operator's own, `Release: independent`); the operator drove model selection across stages but no correction or redirection was needed.

### Diagnostic details

- **Model-performance correlation** — both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5`, appropriate for read-only judgment work; no reasoning-weak-on-judgment or costly-on-mechanical mismatch.
  The main session switched `opus-4-8` ↔ `sonnet-5` across stages (operator-driven), with no quality impact.
- **Escalation-delay tracking** — no rabbit-holes; the single `tsc` error (`context.test.ts`) resolved in the immediately following tool call (1 call, well under the 5-call flag).
- **Unused-tool detection** — no `missing-context`/`rabbit-hole` friction needed an undispatched tool; direct `grep` + targeted `Read` during planning were right for a bounded 5-file refactor (`colgrep`/`Explore` not warranted).
- **Feedback-loop gap analysis** — verification ran incrementally (scoped `vitest` + `check` after each prep commit and before the main refactor; root `lint` + `fallow` at ship), not end-only.
  No gap.

### Changes made

1. `.pi/prompts/plan-issue.md` — added a touch-point-grep rule (after the #539 line): when a step tightens an **optional** interface field to required (drops `| undefined`), grep the exact `<field>: undefined` literal across all `test/` files, since an incidental fixture sets the field to `undefined` without reading it and a use-site grep under-catches (Refs #611).
