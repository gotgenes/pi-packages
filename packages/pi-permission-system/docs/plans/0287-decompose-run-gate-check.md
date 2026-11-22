---
issue: 287
issue_title: "Decompose runGateCheck in handlers/gates/runner.ts"
---

# Give the session-approval data behavior and tell the session store to record it

## Problem Statement

`runGateCheck` in `src/handlers/gates/runner.ts` is flagged by `fallow health --targets` (cognitive complexity 32, Phase 2 finding #3).
The issue originally proposed extracting three named phase helpers, but that is procedure-splitting: it moves statements into helpers and lowers the metric without improving the design.
The real smell is that `runGateCheck` does the work that belongs to two collaborators it talks to.

- The descriptor's `sessionApproval` is a raw `{ surface; pattern } | { surface; patterns }` union.
  The runner cracks it open **twice** — once in phase 3 with a nested ternary to fish out a representative pattern for the prompt, and again in phase 6 with an `"patterns" in …` branch to loop the patterns into the store.
  That polymorphic union with no behavior is a missing value object.
- The session store (`SessionRules`, `src/session-rules.ts`) is the genuinely stateful object here — it persists across the whole session, is queried on every check (the `source: "session"` fast path via `getRuleset()`) and mutated by `approve`.
  Phase 6 reaches into the descriptor union and dribbles patterns into it **one scalar at a time** through `deps.approveSessionRule(surface, pattern)`.
  That is Ask: the runner is doing the store's bookkeeping for it.
- The `emitDecision` payload is constructed in two places (the phase-2 session-hit path and the phase-5 gate-result path) with five of seven fields identical, including the repeated `origin / agentName / matchedPattern ?? null` normalization.

This is Phase 2 step 3 of the improvement roadmap in `docs/architecture/architecture.md`.

## Goals

- Introduce a `SessionApproval` value object that owns the single-vs-multi-pattern union and exposes behavior: `surface`, `patterns`, `representativePattern` (for the prompt), and `toGateApproval()` (the `{ surface; pattern }` shape `applyPermissionGate` expects).
- Tell the stateful store to record a whole approval: `SessionRules.record(approval)` loops the patterns internally; the `GateRunnerDeps` seam becomes `recordSessionApproval(approval)` instead of the scalar `approveSessionRule(surface, pattern)`.
- Extract a pure `buildDecisionEvent(...)` helper so the decision-event payload (and its null-normalization) has one home, used by both emit sites in `runGateCheck`.
- As a **consequence** of the above, `runGateCheck` shrinks to a thin orchestration function — phase 3's nested ternary becomes `descriptor.sessionApproval?.toGateApproval()`, phase 6 becomes a single `deps.recordSessionApproval(...)` tell, and both emits go through the builder.
  The complexity drop is a side effect of better design, not procedure-splitting.
- Behavior-preserving end-to-end: the same approvals are recorded and the same decision events are emitted.
- This is a breaking change to internal seams (`GateRunnerDeps`, `GateDescriptor.sessionApproval`, `PermissionSession`, `SessionRules`) — all internal to the package, so no published API changes, but use `refactor:`/`feat:` with a clear body noting the seam reshape.

## Non-Goals

- No change to permission semantics: resolution order (pre-check → pre-resolved → `checkPermission`), session-hit short-circuit, the deny/ask/allow gate decision, resolution derivation, and which patterns get approved are all frozen.
- No change to `applyPermissionGate` / `permission-gate.ts` — it keeps its single `{ surface; pattern }` `sessionApproval` seam; the runner adapts to it via `SessionApproval.toGateApproval()`.
- No extraction of phase 1 (check resolution) into a helper — it is a small inline value-producing branch and splitting it is the procedure-shuffling this plan rejects.
  Listed in Open Questions if `fallow` still flags `runner.ts` afterward.
- No change to the other Phase 2 targets: `resolvePermissions` ([#286], done), `bash-path-extractor.ts` ([#289]), `stripJsonComments` ([#290]), test-fixture dedup ([#288]).
- No change to the `v3-architecture.md` data-flow diagram — `runGateCheck` remains a single node.

## Background

Relevant existing modules:

- `src/handlers/gates/runner.ts` — `runGateCheck(descriptor, agentName, toolCallId, deps): Promise<GateOutcome>`; the orchestrator being thinned.
- `src/handlers/gates/descriptor.ts` — `GateDescriptor.sessionApproval?: { surface; pattern } | { surface; patterns }` (the union to replace) and `GateRunnerDeps.approveSessionRule(surface, pattern)` (the scalar sink to reshape).
- `src/session-rules.ts` — `SessionRules` (the stateful store): `approve(surface, pattern)`, `getRuleset()`, `clear()`; also exports `deriveApprovalPattern`.
  The new `SessionApproval` value object will live in its own module so both `SessionRules` and the gates layer can import it without a cycle.
- `src/permission-session.ts` — `PermissionSession.approveSessionRule(surface, pattern)` delegates to `sessionRules.approve`; `getSessionRuleset()` delegates to `getRuleset()`.
- `src/handlers/permission-gate-handler.ts` — builds `GateRunnerDeps` once (lines 101–109), wiring `approveSessionRule` to `this.session.approveSessionRule`.
- `src/permission-gate.ts` — `applyPermissionGate`; `PermissionGateParams.sessionApproval?: { surface; pattern }` and `PermissionGateResult` echo a single pattern.
  Unchanged.
- The five producers that build `sessionApproval`: `tool.ts`, `path.ts`, `external-directory.ts`, `bash-path.ts` (single `{ surface; pattern }`), and `bash-external-directory.ts` (multi `{ surface; patterns }`).
- `src/handlers/gates/helpers.ts` — existing pure helpers `deriveResolution`, `deriveDecisionValue`; the new `buildDecisionEvent` belongs here (pure, no `deps`).

Constraints from AGENTS.md / the package skill that apply:

- Enforce permissions deterministically — recording the same patterns and emitting the same events must be preserved.
- Keep modules focused (one concern per file); import siblings via `#src/` / `#test/` aliases.
- Every new export needs a consumer — fallow flags speculative re-exports as dead code.
- Biome `noNonNullAssertion` bans `x!`; prefer explicit guards.
  `representativePattern` returns `string | undefined` and callers guard rather than assert.
- ES2024 target — `for...of`, spread, getters available.

## Design Overview

### New module: `src/session-approval.ts`

```typescript
/** Value object for a session-scoped approval: one surface, one-or-more patterns. */
export class SessionApproval {
  private constructor(
    readonly surface: string,
    readonly patterns: readonly string[],
  ) {}

  static single(surface: string, pattern: string): SessionApproval {
    return new SessionApproval(surface, [pattern]);
  }

  static multiple(surface: string, patterns: readonly string[]): SessionApproval {
    return new SessionApproval(surface, [...patterns]);
  }

  /** Representative pattern for the interactive prompt — the first, if any. */
  get representativePattern(): string | undefined {
    return this.patterns[0];
  }

  /** Single-pattern shape applyPermissionGate echoes back; undefined when empty. */
  toGateApproval(): { surface: string; pattern: string } | undefined {
    const pattern = this.representativePattern;
    return pattern === undefined ? undefined : { surface: this.surface, pattern };
  }
}
```

This preserves the old phase-3 behavior exactly: `patterns.length > 0 ? patterns[0] : undefined`.

### Stateful store: `SessionRules.record`

The store is *told* a whole approval and owns the loop (the bookkeeping that previously leaked into the runner).
The existing scalar `approve(surface, pattern)` stays as the internal primitive so `session-rules.test.ts` is not rewritten:

```typescript
import { SessionApproval } from "./session-approval";

record(approval: SessionApproval): void {
  for (const pattern of approval.patterns) {
    this.approve(approval.surface, pattern);
  }
}
```

### Reshaped seams

- `GateDescriptor.sessionApproval?: SessionApproval`.
- `GateRunnerDeps`: replace `approveSessionRule(surface, pattern): void` with `recordSessionApproval(approval: SessionApproval): void`.
- `PermissionSession`: replace `approveSessionRule(surface, pattern)` with `recordSessionApproval(approval): void { this.sessionRules.record(approval); }`.
- `permission-gate-handler.ts`: the deps closure becomes `recordSessionApproval: (approval) => this.session.recordSessionApproval(approval)`.

### Pure builder: `buildDecisionEvent` (in `helpers.ts`)

```typescript
export function buildDecisionEvent(
  decision: { surface: string; value: string },
  check: PermissionCheckResult,
  agentName: string | null,
  result: "allow" | "deny",
  resolution: PermissionDecisionResolution,
): PermissionDecisionEvent {
  return {
    surface: decision.surface,
    value: decision.value,
    result,
    resolution,
    origin: check.origin ?? null,
    agentName: agentName ?? null,
    matchedPattern: check.matchedPattern ?? null,
  };
}
```

### Thinned `runGateCheck` (the consequence, not the goal)

```typescript
// phase 1 (inline, unchanged): resolve `check` from preCheck / preResolved / checkPermission

// phase 2: session-hit fast path
if (check.source === "session") {
  deps.writeReviewLog("permission_request.session_approved", { ...descriptor.logContext, agentName, resolution: "session_approved", sessionApprovalPattern: check.matchedPattern });
  deps.emitDecision(buildDecisionEvent(descriptor.decision, check, agentName, "allow", "session_approved"));
  return { action: "allow" };
}

// phase 3: gate — the nested ternary collapses
const gateResult = await applyPermissionGate({
  state: check.state,
  canConfirm,
  sessionApproval: descriptor.sessionApproval?.toGateApproval(),
  promptForApproval: async () => { /* unchanged; sets autoApproved */ },
  writeLog: deps.writeReviewLog,
  logContext: { ...descriptor.logContext, agentName },
  messages,
});

// phase 4 (unchanged): hasSessionApproval = action === "allow" && gateResult.sessionApproval !== undefined

// phase 5: single emit through the builder
deps.emitDecision(buildDecisionEvent(descriptor.decision, check, agentName,
  gateResult.action === "allow" ? "allow" : "deny",
  deriveResolution(check.state, gateResult.action, hasSessionApproval, canConfirm, autoApproved)));

// phase 6: one tell — the union-cracking loop is gone
if (gateResult.action === "allow" && hasSessionApproval && descriptor.sessionApproval) {
  deps.recordSessionApproval(descriptor.sessionApproval);
}

return gateResult.action === "block" ? { action: "block", reason: gateResult.reason } : { action: "allow" };
```

Tell-Don't-Ask: the runner no longer interrogates the approval union or dribbles patterns; it hands `SessionApproval` to the store.
Law of Demeter holds — it does not reach through the union's shape.
ISP: `buildDecisionEvent` takes only `decision`, `check`, `agentName` plus the two varying fields — no unused descriptor fields.

### Edge cases (all preserved)

- Multi-pattern (`bash-external-directory`) → `SessionApproval.multiple`; `representativePattern` is the first path's pattern (matches old `patterns[0]`); `record` approves all patterns.
- Single-pattern producers → `SessionApproval.single`; one pattern recorded.
- No `descriptor.sessionApproval` → `toGateApproval()` never called, phase-6 guard skips the tell.
- Empty patterns is unreachable (producers always supply ≥1; `bash-external-directory` returns a bypass before an empty `patterns`), but `representativePattern`/`toGateApproval` degrade to `undefined` safely.

## Module-Level Changes

- `src/session-approval.ts` (new): `SessionApproval` value object.
- `src/session-rules.ts`: import `SessionApproval`; add `record(approval)`; keep `approve(surface, pattern)` as the internal primitive.
- `src/permission-session.ts`: replace `approveSessionRule(surface, pattern)` with `recordSessionApproval(approval)`.
- `src/handlers/gates/descriptor.ts`: `sessionApproval?: SessionApproval`; `GateRunnerDeps.approveSessionRule` → `recordSessionApproval(approval)`.
- `src/handlers/gates/helpers.ts`: add `buildDecisionEvent` (import `PermissionDecisionEvent`, `PermissionDecisionResolution`, `PermissionCheckResult`).
- `src/handlers/gates/runner.ts`: phase 3 uses `toGateApproval()`; phases 2 & 5 use `buildDecisionEvent`; phase 6 is a single `recordSessionApproval` tell; the `singleSessionApproval` ternary and the phase-6 `"patterns" in` loop are deleted.
- `src/handlers/gates/tool.ts`, `path.ts`, `external-directory.ts`, `bash-path.ts`: build `SessionApproval.single(surface, pattern)`.
- `src/handlers/gates/bash-external-directory.ts`: build `SessionApproval.multiple("external_directory", patterns)`.
- `src/handlers/permission-gate-handler.ts`: deps closure `recordSessionApproval` wired to `this.session.recordSessionApproval`.
- Tests (see Test Impact): `test/session-rules.test.ts`, `test/permission-session.test.ts`, `test/handlers/gates/runner.test.ts`, the five producer tests, and the handler deps-mock files (`input.test.ts`, `tool-call.test.ts`, `tool-call-events.test.ts`, `input-events.test.ts`, `external-directory-integration.test.ts`, `external-directory-session-dedup.test.ts`) that declare `approveSessionRule: vi.fn()`.
- `docs/architecture/architecture.md`: mark Phase 2 step 3 done, ✅ finding #3, add `session-approval.ts` to the module tree, refresh refactoring-targets count and `runner.ts` complexity after re-running `fallow health --targets`.
- `.pi/skills/package-pi-permission-system/SKILL.md`: no documented symbol is removed — no change.

No file in Module-Level Changes is claimed unchanged in Non-Goals (`permission-gate.ts` and `v3-architecture.md` are the only "unchanged" claims, and neither appears above).

## Test Impact Analysis

1. New unit tests enabled.
   - `test/session-approval.test.ts` (new): `single`/`multiple` factories, `representativePattern` (first pattern, `undefined` when empty), `toGateApproval` (shape and `undefined` case).
   - `test/session-rules.test.ts`: add `record(approval)` fan-out cases (single pattern → one rule; multi-pattern → one rule per pattern) alongside the kept scalar `approve` cases.
2. Tests that change shape (not removed).
   - `runner.test.ts`: the deps mock field `approveSessionRule` → `recordSessionApproval`; the "once per pattern" assertion becomes "called once with a `SessionApproval` carrying both patterns" (the loop moved into `SessionRules`, so the *runner* now makes one call); descriptor fixtures build `SessionApproval.single/multiple`.
   - `permission-session.test.ts`: the two delegation tests target `recordSessionApproval(approval)`.
   - The five producer tests: `sessionApproval` expectations become `SessionApproval` instances.
   - Handler deps-mock files: rename the `approveSessionRule: vi.fn()` field; `external-directory-session-dedup.test.ts`'s stateful mock records via `record(approval)`.
3. Tests that stay as-is.
   - `session-rules.test.ts` scalar `approve` cases (the primitive is retained).
   - All `runGateCheck` behavioral cases keep their resolution/emit assertions — they are the behavior-preservation net; only the recording-call shape updates.

## TDD Order

Lift-and-shift: introduce the value object and store method additively first, then do the type-forced cutover, then dedup the emit.

1. `feat:` Add `src/session-approval.ts` + `test/session-approval.test.ts`; add `SessionRules.record(approval)` + its `session-rules.test.ts` cases.
   Purely additive, no consumers yet.
   Red→green within the step (new tests fail until the module/method exist).
   Commit: `feat: add SessionApproval value object and SessionRules.record`.
2. `refactor:` The cutover.
   Change `GateDescriptor.sessionApproval` to `SessionApproval`; migrate the five producers to `SessionApproval.single/multiple`; reshape `GateRunnerDeps`/`PermissionSession` (`approveSessionRule` → `recordSessionApproval`); rewire the `permission-gate-handler.ts` closure; update `runGateCheck` phase 3 (`toGateApproval()`) and phase 6 (single tell); update `runner.test.ts`, `permission-session.test.ts`, the producer tests, and the handler deps-mocks in the same commit.
   These cannot be split — the descriptor type change and the deps reshape break every producer, the runner, and every deps-mock at the type level simultaneously (excess/missing property errors).
   Green: full suite passes; behavior unchanged.
   Run `pnpm --filter @gotgenes/pi-permission-system run test` and `… run check` before committing.
   Commit: `refactor: tell SessionRules to record a SessionApproval value object`.
3. `feat:` Add `buildDecisionEvent` to `helpers.ts` (+ a small unit test) and route both `runGateCheck` emit sites through it; delete the duplicated payload construction.
   Independent of step 2's seam reshape (can also land before it).
   Green.
   Commit: `feat: centralize decision-event construction in buildDecisionEvent`.
4. `docs:` Update `architecture.md` — mark Phase 2 step 3 complete, ✅ finding #3, add `session-approval.ts` to the module tree, refresh metrics after `fallow health --targets`.
   Commit: `docs: mark Phase 2 step 3 complete in permission-system roadmap`.

Step 2 is the only large commit; it is type-forced and the producer/test edits are mechanical.
The `SessionRules` scalar primitive is retained so `session-rules.test.ts` is not rewritten.

## Risks and Mitigations

- Risk: the multi-pattern `representativePattern` diverges from the old `patterns[0]`.
  Mitigation: `representativePattern` is defined as `patterns[0]`; `session-approval.test.ts` asserts it, and the multi-pattern `runner.test.ts` case still verifies all patterns are recorded.
- Risk: dropping a recorded pattern in the move of the loop into `SessionRules.record`.
  Mitigation: `record` iterates `approval.patterns`; `session-rules.test.ts` asserts one rule per pattern, and the end-to-end `external-directory-session-dedup.test.ts` verifies dedup still works.
- Risk: step 2 is large and a stale `approveSessionRule` reference or deps-mock slips through.
  Mitigation: `grep` for `approveSessionRule` reaches zero after step 2; `pnpm check` fails on any stale reference or mismatched mock shape.
- Risk: `SessionApproval` in a new module creates an import cycle (`session-rules.ts` ↔ producers).
  Mitigation: `session-approval.ts` imports nothing from `session-rules.ts`; the dependency is one-way (`session-rules.ts` → `session-approval.ts`), and producers import both leaf-ward.
- Risk: fallow flags `SessionApproval` members or `buildDecisionEvent` as dead.
  Mitigation: `representativePattern`/`toGateApproval` are consumed by `runGateCheck`, `patterns`/`surface` by `SessionRules.record`, the factories by the producers, and `buildDecisionEvent` by both emit sites — each has a real consumer.

## Open Questions

- Whether to also lift phase 1's check resolution onto the descriptor (e.g. `descriptor.resolveCheck(deps)`) so the runner stops branching on `preCheck`/`preResolved` — deferred.
  It is value-returning and small; revisit only if `fallow health --targets` still flags `runner.ts` above the `< 15` target after step 3.

[#286]: https://github.com/gotgenes/pi-packages/issues/286
[#288]: https://github.com/gotgenes/pi-packages/issues/288
[#289]: https://github.com/gotgenes/pi-packages/issues/289
[#290]: https://github.com/gotgenes/pi-packages/issues/290
