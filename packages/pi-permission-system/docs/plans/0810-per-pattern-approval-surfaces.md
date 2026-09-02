---
issue: 810
issue_title: "pi-permission-system: record a session approval at the direction the gate proved, per pattern"
---

# Per-pattern surfaces on a session approval

## Release Recommendation

**Release:** ship independently

Phase 14 Step 10 carries no `Release: batch` annotation in the roadmap, and the "Release batches" subsection lists it under "Independently releasable".
Its predecessor batch ("capability-axis", Steps 1–3) has already shipped, so nothing is waiting on this step and nothing this step needs is unreleased.

## Problem Statement

Since [#807] a bash path token carries its own proven effect, so a gate routes a proven read to `external_directory_read`, a proven write to `external_directory_write`, and an unproven token to the bare family that folds both.
The session grant a user records from that ask cannot follow, because `SessionApproval` holds **one** surface for **many** patterns:

```typescript
class SessionApproval {
  private constructor(
    readonly surface: string,
    readonly patterns: readonly string[],
  ) {}
}
```

`describeBashPathGate` selects a single worst token, so it always records that token's own proven surface.
`describeBashExternalDirectoryGate` aggregates every uncovered path into one prompt carrying one `SessionApproval`, so when the uncovered set mixes a proven read with a proven write, its private `approvalSurfaceFor` falls back to the bare family — and the family sugar-expands onto both directional members for **every** pattern in the approval.

Approving `cat /outside/a.ts > /elsewhere/b.ts` for the session therefore also grants writes under `/outside/` and reads under `/elsewhere/`.
That is exactly the width every bash session approval had before [#807], so it is not a regression — but it is wider than what the prompt showed and the user agreed to, and [#807] is the change that made the narrower grant expressible.

## Goals

- Give `SessionApproval` a `(surface, pattern)` pair per grant, so each pattern records at the direction its own token proved.
- Have `SessionRules.recordSessionApproval` read each pair's own surface rather than the approval's single one.
- Replace `ForwardedSessionApproval`'s wire shape with the pair form, and narrow the tolerant reader to accept only that shape.
- Stop `describeBashExternalDirectoryGate` from falling back to the bare family when one ask's uncovered paths disagree on direction.

This change is **breaking.**
`ForwardedSessionApproval` is structurally reachable from the published declaration bundle through `PromptPermissionDetails`, which is the type a third-party `Authorizer` chain link receives (`authorize(details, query, log)`, ADR 0007 §3).
A link reading `details.sessionApproval.patterns` compiles against the published `@gotgenes/pi-permission-system` 29.3.0 and will not compile after this change.
The same shape is written to the forwarded-request file another process reads, so a version-skewed pair drops the suggestion.
The core commit is `feat!:` with a `BREAKING CHANGE:` footer, and a migration guide ships in the tarball.

## Non-Goals

- **A user-chosen grant width** ([#813], Phase 14 Step 11).
  This change records what the gate proved; letting the user say "and reads too" at the prompt is a separate affordance, and the roadmap's dashed edge from Step 10 to Step 11 exists precisely so Step 11 reads this shape rather than competing for it.
- **Widening the approval *pattern*** ([#604]).
  That issue asks for a configurable directory scope (`parent-dir` / `repo-root` / N levels up) on the glob `deriveApprovalPattern` produces.
  This change alters which **surface** each pattern is recorded on and never touches the pattern derivation.
- **Backward-compatible reading of the old wire shape.**
  The operator settled this at the clarification gate: `asForwardedSessionApproval` rejects `{ surface, patterns }` outright rather than normalizing it into pairs.
  Skew in either direction drops the suggestion, which fails narrow (see Risks).
- **Persisting an approval beyond the session** ([#691], PR [#692]).
  Session rules stay ephemeral and cleared at `session_shutdown`.
- **`docs/session-approvals.md`'s suggested-pattern table.**
  It documents which glob each surface suggests, which is unchanged; the direction a grant lands on is not in that table today and adding it is Step 11's material, once the user has a choice to document.

## Background

### The four producers of a `SessionApproval`

| Site                                                | Constructor | Surface                                                          |
| --------------------------------------------------- | ----------- | ---------------------------------------------------------------- |
| `src/handlers/gates/tool.ts:117`                    | `single`    | `suggestion.surface` (tool name, `bash`, `mcp`, `skill`)         |
| `src/handlers/gates/path.ts:76`                     | `single`    | the tool's proven `path`-family surface                          |
| `src/handlers/gates/external-directory.ts:105`      | `single`    | the tool's proven `external_directory`-family surface            |
| `src/handlers/gates/bash-path.ts:150`               | `single`    | the worst token's proven `path`-family surface                   |
| `src/handlers/gates/bash-external-directory.ts:115` | `multiple`  | `approvalSurfaceFor(...)` — one surface for every uncovered path |

Only the last is capable of disagreeing with itself, which is why it is the only gate whose behavior changes.

### The three consumers of a `SessionApproval`

`GateRunner.runDescriptor` (`src/handlers/gates/runner.ts`) is the sole reader, and it uses the approval three ways:

1. `descriptor.sessionApproval?.toGateApproval()` → `applyPermissionGate`'s `sessionApproval` param, echoed back on the allow arm.
2. `descriptor.sessionApproval.toForwardedData()` → `PromptPermissionDetails.sessionApproval` → the forwarded request file.
3. `this.recorder.recordSessionApproval(descriptor.sessionApproval)` → `SessionRules`, which loops the patterns.

Consumer 1's **value** has no reader: `runner.ts:233` only tests `gateResult.sessionApproval !== undefined`, and `GateRunner.run`'s public `GateOutcome` type carries no such field.
The Tidy-First assessor independently confirmed this, which is what makes the preparatory step below possible.

### The forwarded wire and its readers

`ForwardedSessionApproval` rides on `ForwardedPermissionRequest.sessionApproval`, written by a no-UI subagent and read by the serving node that drains its inbox.
`readForwardedPermissionRequest` (`src/authority/forwarding-io.ts`) is a hand-rolled tolerant narrower: it rejects a request only when `id`, `createdAt`, `requesterSessionId`, `targetSessionId`, or `requesterAgentName` is missing, and it reconstructs an allowlist of known optional fields, ignoring unknown keys.
Verified against the published tag (`git show pi-permission-system-v29.3.0:packages/pi-permission-system/src/authority/forwarding-io.ts`): the required set is the same five fields there, and `asForwardedSessionApproval` accepts a value only when `surface` is a non-empty string and `patterns` is an all-string array.

So a version-skewed pair — in **either** direction — accepts the request and drops the suggestion.
The serving node then offers no whole-session scope step (`buildRequestOptions`, `src/authority/local-user-authorizer.ts:72`, requires a suggestion), the human's "for this session" returns a plain `approved_for_session`, and the requesting child records its own already-narrow grant.
That is a lost affordance, not a lost grant, and it fails narrow.

### Constraints from AGENTS.md and the package skill that apply

- `path` and `external_directory` each carry a read/write axis whose two directions are **independent bits, not tiers** (ADR 0013 §3–§4).
  A bare family key is load-time sugar expanded by `expandDirectionalSugar`; `SessionRules.approve` expands the same way, because a session approval is a policy source under §9.
  This change does not touch `approve` — a grant whose surface is a bare family (an unproven-direction token) still expands to both members.
- The roadmap's health-metric clause: a step that creates a symbol the roadmap greps for "must either use the roadmap's name or update the metric row in the same commit."
  The operator chose `ApprovalGrant` over the roadmap's predicted `ApprovalPattern`, so the metric row and its recompute command are updated in the docs step.
- `docs/decisions/` and `docs/architecture/` are **not** in the package's `files` allowlist, so the shipped migration guide must link ADRs by absolute GitHub URL, not a relative path.

## Design Overview

### The pair

A new module holds the pair type, because `src/session-approval.ts` already imports `ForwardedSessionApproval` from `src/authority/permission-forwarding.ts`; declaring `ApprovalGrant` in either of those two and importing it from the other creates a type-only import cycle.

```typescript
// src/approval-grant.ts
/** One session-approval grant: a wildcard pattern approved on one surface. */
export interface ApprovalGrant {
  readonly surface: string;
  readonly pattern: string;
}
```

`src/session-approval-recorder.ts` is the precedent — a single-interface module extracted to keep an edge one-directional.

### The value object

```typescript
export class SessionApproval {
  private constructor(readonly grants: readonly ApprovalGrant[]) {}

  /** Create an approval for a single pattern (the common case). */
  static single(surface: string, pattern: string): SessionApproval {
    return new SessionApproval([{ surface, pattern }]);
  }

  /** Create an approval whose patterns were each proven on their own surface. */
  static forGrants(grants: readonly ApprovalGrant[]): SessionApproval {
    return new SessionApproval([...grants]);
  }

  /** Representative grant for the interactive prompt — the first, if any. */
  get representativeGrant(): ApprovalGrant | undefined {
    return this.grants[0];
  }

  toForwardedData(): ForwardedSessionApproval {
    return { grants: [...this.grants] };
  }
}
```

`multiple(surface, patterns)` is **removed**, diverging from the issue's sketch.
Its only two production call sites (`bash-external-directory.ts`, `forwarded-request-server.ts`) both move to `forGrants`, so keeping it would leave a constructor with no production caller — the maintenance trap the package skill warns about, and a `pnpm fallow dead-code` liability CI gates on.

`toGateApproval()` is deleted by the preparatory step, before this reshape, so the reshape never has to define what "the representative `{surface, pattern}`" means for an approval that carries several.

### The consumer call sites

```typescript
// src/session-rules.ts — the loop reads the pair's own surface
recordSessionApproval(approval: SessionApproval): void {
  for (const { surface, pattern } of approval.grants) {
    this.approve(surface, pattern);
  }
}

// src/handlers/gates/bash-external-directory.ts — no fallback, no shared surface
sessionApproval: SessionApproval.forGrants(
  uncoveredEntries.map(({ path, surface }) => ({
    surface,
    pattern: normalizer.approvalPatternFor(path),
  })),
),
```

Both are Tell-Don't-Ask: the gate hands the store a value object and the store owns the loop, exactly as today.
Neither reaches through `approval` to a stranger — `grants` is the object's own data, and each element is destructured at the point of use.

### The wire

```typescript
// src/authority/permission-forwarding.ts
export interface ForwardedSessionApproval {
  grants: readonly ApprovalGrant[];
}
```

`asForwardedSessionApproval` (`src/authority/forwarding-io.ts`) accepts a value only when `grants` is a **non-empty** array whose every entry is an object with a non-empty string `surface` and a string `pattern`.
Rejecting an empty array is a deliberate small tightening over today, where `{ surface, patterns: [] }` is accepted and then guarded downstream by `buildRequestOptions`; with the tightening, `applyGrantScope` can no longer record nothing and log an empty `forwarded_permission.session_recorded` entry.
No producer emits an empty approval — every gate's uncovered set is non-empty by the time it builds one.

### What the user observes, and what they do not

The relief appears only when the uncovered paths sit in **different directories**, because `deriveApprovalPattern` scopes a pattern at the value's last separator:

| Command                               | Grants today                                                           | Grants after                                           |
| ------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------ |
| `cat /outside/a.ts > /elsewhere/b.ts` | `/outside/*` and `/elsewhere/*`, each on **both** directions (4 rules) | `/outside/*` read, `/elsewhere/*` write (2 rules)      |
| `cat /outside/a.ts > /outside/b.ts`   | `/outside/*` on both directions (2 rules)                              | `/outside/*` read **and** `/outside/*` write (2 rules) |

The same-directory row is a deliberate no-op: both tokens derive the identical glob, so the two grants reconstitute exactly what the family sugar expands to — which is correct, because the user did approve a read and a write in that directory.
The roadmap's `Outcome:` line must therefore be read with paths in different directories, and the step's tests use them.

### The prompt text

No local prompt text changes: only `describeToolGate` supplies a custom `sessionLabel`, and the bash gates fall through to `DEFAULT_SESSION_LABEL`.
The **forwarded** whole-session scope label (`buildForwardedScopeLabels`, `src/pattern-suggest.ts:79`) names one surface and one pattern; it is fed today from `sessionApproval.surface` + `patterns[0]` and after this change from the first `ApprovalGrant`.
That an approval carrying several paths under-names its scope in that label is pre-existing behavior, unchanged here, and is noted as an accepted residual in Open Questions.

## Module-Level Changes

### Added

- `src/approval-grant.ts` — the `ApprovalGrant` interface.
- `packages/pi-permission-system/docs/migration/0810-per-pattern-approval-surfaces.md` — the shipped migration guide (`docs/migration` is in the `files` allowlist; ADRs it cites use absolute GitHub URLs).

### Changed — `src/`

- `src/permission-gate.ts` — `PermissionGateParams.sessionApproval?: { surface, pattern }` becomes `canGrantForSession: boolean`; `PermissionGateResult`'s allow arm swaps `sessionApproval?: { surface, pattern }` for `forSession?: true` (`forSession` is already the vocabulary `resolutionFor` uses in `src/authority/decision-resolution.ts`).
- `src/handlers/gates/runner.ts` — line 212 passes the boolean; line 233 reads `gateResult.forSession === true`.
- `src/session-approval.ts` — fields, constructors, `representativeGrant`, `toForwardedData`; `toGateApproval` and `representativePattern` and `multiple` all removed.
- `src/session-rules.ts` — `recordSessionApproval` destructures each grant. `approve` is untouched.
- `src/authority/permission-forwarding.ts` — `ForwardedSessionApproval` becomes `{ grants }`, importing `ApprovalGrant`; its doc comment's "rebuilds via `SessionApproval.multiple`" sentence is rewritten to name `forGrants`.
- `src/authority/forwarding-io.ts` — `asForwardedSessionApproval` narrows the new shape only.
- `src/authority/forwarded-request-server.ts` — `applyGrantScope` (line 344) rebuilds with `forGrants`; its `forwarded_permission.session_recorded` review entry logs `grants` in place of `surface`/`patterns`.
- `src/authority/local-user-authorizer.ts` — `buildRequestOptions` (line 72) reads the first `ApprovalGrant` instead of `sessionApproval.surface` + `patterns[0]`.
- `src/handlers/gates/bash-external-directory.ts` — the private `approvalSurfaceFor` helper is deleted (its sole call site is the descriptor's `sessionApproval`, so it goes in the same step), the separate `patterns` local folds into the `forGrants` call, and the gate's doc-comment paragraph about the one-surface constraint is rewritten.

`src/handlers/gates/{tool,path,external-directory,bash-path}.ts` keep `SessionApproval.single` and need no edit.
`src/authority/permission-prompter.ts` and `src/authority/approval-escalator.ts` reference the type but never its fields — they compile unchanged.

### Changed — `test/`

Every file below breaks at the type level or asserts the removed shape; each rides in the step that causes it.

- `test/permission-gate.test.ts` — the `"ask branch — approved_for_session with sessionApproval"` describe block (4 tests, ~lines 223–290) asserts the `{surface, pattern}` echo; it becomes boolean assertions in the preparatory step.
- `test/session-approval.test.ts` — the `toGateApproval` tests go in the preparatory step; the `multiple` describe becomes `forGrants` and `representativePattern` becomes `representativeGrant` in the reshape.
- `test/session-rules.test.ts` — `recordSessionApproval` and directional-sugar blocks construct via `multiple`; a new test records a two-grant approval whose grants name different surfaces.
- `test/authority/forwarding-io.test.ts` — has no `sessionApproval` coverage today; the reader's accept/reject tests land here.
- `test/authority/forwarded-request-server.test.ts` (6 `{ surface: "bash", patterns: ["git *"] }` literals), `test/authority/local-user-authorizer.test.ts` (1), `test/authority/approval-escalator.test.ts` (2 sites, ~lines 233 and 238).
- `test/handlers/gates/bash-external-directory.test.ts` — the `directional routing (#807)` describe block (~lines 290–335), whose `"falls back to the bare family when one ask spans two directions"` test is rewritten.
- `test/handlers/gates/{path,bash-path,external-directory,tool}.test.ts` — assertions on `sessionApproval?.surface` / `?.patterns` / `?.representativePattern`.
- `test/handlers/gates/runner.test.ts` — imports `SessionApproval` and asserts through the `recordSessionApproval` mock and the public `GateOutcome`; the assessor verified it needs no change for the preparatory step.
  Re-check it after the reshape.
- `test/permission-session.test.ts`, `test/permission-resolver.test.ts` — `SessionApproval.single` call sites only; unchanged.
- `test/helpers/gate-fixtures.ts`, `test/helpers/forwarding-fixtures.ts` — both stub `recordSessionApproval` as a bare `vi.fn()` and never construct the shape; unchanged.

### Documentation

- `packages/pi-permission-system/docs/architecture/architecture.md`:
  - module tree: `session-approval.ts` (line 814, currently "owns the single/multi-pattern union; exposes representativePattern and toGateApproval()"), `session-rules.ts` (line 815), a new `approval-grant.ts` entry, and `bash-external-directory.ts` (line 871, whose entry states the one-surface constraint as an active constraint that this change removes).
  - health metrics: the "Per-pattern surfaces on `SessionApproval`" row (line 1085) and its recompute command (line 1106), which greps `ApprovalPattern` — a name this change does not create.
  - Step 10 (line 1356): `✅` on the heading, a `Landed:` note, and the Mermaid node `S10` (line 1474).
  - "Release batches" (line 1509): "Step 10 (`feat:`, or `feat!:` if the wire shape is not made tolerant)" resolves to `feat!:`.
- `packages/pi-permission-system/docs/decisions/0006-forwarded-grant-scope-selection.md` — decision 1 describes `SessionApproval` as "(surface + one-or-more patterns)" and the mechanism as relaying that shape.
  Add a dated `#### Amendment` recording the pair form and the non-tolerant reader, following the `#### Amendment` convention ADR 0012 uses; do not rewrite the original decision text.
- `.pi/skills/package-pi-permission-system/SKILL.md` line 51 — "`bash-external-directory.ts` falls back to the bare family whenever one ask's paths disagree, which is exactly today's width and never wider" is now false.
- `packages/pi-permission-system/README.md` — add a row to the migration-guide table (lines ~206–212).

Greps run at planning time, so the list above is closed rather than sampled:

- `grep -rln "SessionApproval\|sessionApproval" src test` — 19 `src` files and 17 `test` files.
  The `src` files not listed above (`handlers/gates/{descriptor,tool,path,external-directory,bash-path}.ts`, `authority/{permission-prompter,approval-escalator,decision-source}.ts`, `session-approval-recorder.ts`, `pattern-suggest.ts`) name the type or the field but never the removed members, and compile unchanged.
- `grep -rn "SessionApproval\|session_recorded\|session-approval" docs/ README.md ../../.pi/skills/` — the four documentation targets above, plus `docs/architecture/history/` and `docs/architecture/v3-architecture.md`, which are frozen historical records and are **not** edited.
- `grep -rln "sessionApproval\|SessionApproval" docs/*.md docs/guides` — no matches, so no shipped user doc names the mechanism today.

## Test Impact Analysis

**What the reshape enables that was impractical before.**
A `SessionRules` test can now record one approval whose grants name two different surfaces and assert two rules on two surfaces — the assertion that pins the whole issue, and one that has no expressible form today because the value object cannot hold the input.
`test/authority/forwarding-io.test.ts` gains the first direct coverage of `asForwardedSessionApproval`, which has only ever been exercised transitively through `readForwardedPermissionRequest`.

**What becomes redundant.**
`test/session-approval.test.ts`'s two `toGateApproval` tests and `test/permission-gate.test.ts`'s four `{surface, pattern}` echo assertions test a value with no reader; the preparatory step replaces them with boolean assertions that pin the one thing the seam actually decides.
The `"defensive copy — mutating the source array does not affect patterns"` test survives verbatim in spirit (against `grants`), because `forGrants` still copies.

**What must stay as-is.**
`test/session-rules.test.ts`'s `directional sugar expansion` block pins ADR 0013 §9 — that `approve` on a bare family writes one rule per member.
This change routes *around* that expansion (each grant names a directional surface directly) but must not weaken it: an unproven-direction token still yields a bare-family grant that expands.
The block is rewritten only where it constructs via `multiple`.

**The reader's input domain.**
`asForwardedSessionApproval` is a matcher, so its testable surface is the input domain, not the inputs I can picture.
The reject cases enumerated for the step: `undefined`, `null`, a non-object, `{}`, the legacy `{ surface, patterns: ["x"] }`, `{ grants: [] }`, `{ grants: "x" }`, `{ grants: [null] }`, `{ grants: [{ surface: "", pattern: "x" }] }`, `{ grants: [{ surface: "path" }] }`, `{ grants: [{ pattern: "x" }] }`, and a mixed array with one bad entry.
Accept cases: one grant, and several grants naming different surfaces (with unknown sibling keys present, since the reader ignores them).

## Invariants at Risk

This change lands on the surface Phase 14 Steps 1 and 2 refactored.
Their documented outcomes and the tests that pin each:

| Invariant                                                                              | Source            | Pinned by                                                                                                                                                                           |
| -------------------------------------------------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A bash path token routes to the narrowest surface its effect names                     | Step 2 `Outcome:` | `test/handlers/gates/bash-external-directory.test.ts` → `directional routing (#807)` → "routes a proven read / write / unproven" (3 tests); `test/handlers/gates/bash-path.test.ts` |
| A bash session approval is never wider than what the gate proved                       | Step 2 `Outcome:` | the same block's `sessionApproval?.surface` assertions, rewritten here to assert grants                                                                                             |
| A session approval on a bare family expands to one rule per member (ADR 0013 §9)       | Step 1 `Outcome:` | `test/session-rules.test.ts` → `directional sugar expansion` (4 tests), which drive the **real** `SessionRules`, not a mock                                                         |
| A whole-session forwarded grant records on the serving node only (ADR 0006 decision 3) | ADR 0006          | `test/authority/forwarded-request-server.test.ts` `applyGrantScope` tests, which construct a real `SessionRules` recorder                                                           |
| Session approvals do not leak across same-cwd session switches                         | package skill     | `test/composition-root.test.ts` → "session approvals do not leak across same-cwd session switches"                                                                                  |

Each of the pinning tests above was opened during planning to confirm it drives the layer it claims to pin rather than mocking it.
`test/composition-root.test.ts` builds the real factory through `makeFakePi`, and `test/session-rules.test.ts` constructs a real `SessionRules`; neither stubs the recorder.

The quantitative invariant is the grant width, and the plan states its baseline and prediction in the Design Overview's table: 4 rules → 2 for the different-directory case, 2 → 2 for the same-directory case.
The step's tests assert the recorded ruleset, not a count in prose.

## TDD Order

### 1. `refactor:` collapse the gate result's session-approval echo to a boolean

**Prepares:** the reshape, by removing the one consumer that needs a "representative `{surface, pattern}`" — a concept that stops being meaningful once an approval carries per-grant surfaces.
Landing it first drops `src/permission-gate.ts` and `test/permission-gate.test.ts` out of the reshape commit entirely.

- **Test surface:** `test/permission-gate.test.ts` (the 4-test `approved_for_session` describe block, rewritten to assert `forSession`), `test/session-approval.test.ts` (the 2 `toGateApproval` tests removed).
- **Covers:** that the allow arm reports a session grant iff the decision is `approved_for_session` **and** the ask carried a suggestion — the only fact the seam ever decided.
- **Also changes:** `src/permission-gate.ts` (both interfaces), `src/handlers/gates/runner.ts` lines 212 and 233, and `SessionApproval.toGateApproval`'s deletion.
  All in one commit: `PermissionGateParams` has a single call site, so `tsc` will not accept the interface change and the call-site update separately.
- **Killing mutation:** make `applyPermissionGate` set `forSession: true` on the allow arm unconditionally.
  The rewritten `"does not attach when decision is approved (once)"` and `"does not attach when no sessionApproval param"` tests must go red; the positive test stays green.
- **Verify:** `pnpm --filter @gotgenes/pi-permission-system exec vitest run` (full suite — this touches a shared seam) and `pnpm run check`.
- **Commit:** `refactor(pi-permission-system): report a session grant as a boolean on the gate result`

### 2. `feat!:` carry a surface per pattern on a session approval

The type-level reshape, behavior-preserving at every gate: `single` still produces a one-grant approval and `bash-external-directory` still builds all its grants on one surface until step 3.
This must be a single commit — removing `surface`/`patterns` from an exported interface breaks every importing module and its tests at the type level in the same commit.

- **Test surface:** `test/session-approval.test.ts`, `test/session-rules.test.ts`, `test/authority/forwarding-io.test.ts` (new `asForwardedSessionApproval` block), `test/authority/{forwarded-request-server,local-user-authorizer,approval-escalator}.test.ts`, `test/handlers/gates/{path,bash-path,external-directory,tool,bash-external-directory,runner}.test.ts`.
- **Covers:**
  1. a two-grant approval naming two different surfaces records one rule on each (`SessionRules`);
  2. `toForwardedData()` round-trips every grant, not just the first;
  3. the reader accepts the pair shape and rejects the legacy shape and each malformed variant enumerated in Test Impact Analysis;
  4. `applyGrantScope` records every grant from a forwarded request onto the serving `SessionRules`;
  5. `buildRequestOptions` builds the scope labels from the first grant.
- **Also changes:** `src/approval-grant.ts` (new), `src/session-approval.ts`, `src/session-rules.ts`, `src/authority/{permission-forwarding,forwarding-io,forwarded-request-server,local-user-authorizer}.ts`, and the `SessionApproval.multiple` → `forGrants` call site in `src/handlers/gates/bash-external-directory.ts`.
- **Killing mutations**, one per equivalence class:
  - *Per-grant surface plumbing:* make `SessionRules.recordSessionApproval` call `this.approve(approval.grants[0].surface, pattern)` for every grant.
    The two-different-surfaces test goes red; the single-grant tests stay green.
  - *Round-trip completeness:* make `toForwardedData()` return `{ grants: this.grants.slice(0, 1) }`.
    The multi-grant round-trip and the `applyGrantScope` multi-grant test go red; single-grant tests stay green.
  - *Reader strictness:* make `asForwardedSessionApproval` return `{ grants: candidate.grants }` without validating entries.
    The malformed-entry and `{ grants: [] }` rejection tests go red; the accept tests stay green.
  - *Legacy rejection:* make the reader fall back to `{ grants: [{ surface: candidate.surface, pattern: candidate.patterns[0] }] }` when `grants` is absent.
    The legacy-shape rejection test goes red and nothing else moves.
- **Verify:** full suite plus `pnpm run check` (a shared interface changed) and `pnpm fallow dead-code` (confirm no orphaned constructor).
- **Commit:** `feat(pi-permission-system)!: record a session approval's surface per pattern`, with a `BREAKING CHANGE:` footer naming both breaks — the `ForwardedSessionApproval` field rename for an `Authorizer` link reading `details.sessionApproval.patterns` (remediation: read `details.sessionApproval.grants`, each `{ surface, pattern }`), and the wire shape for a version-skewed parent/child pair (remediation: restart the serving session after upgrading; the degradation is a dropped whole-session scope option, never a wider grant).

### 3. `feat:` record each external path at the direction its own token proved

The observable relief.

- **Test surface:** `test/handlers/gates/bash-external-directory.test.ts`, `directional routing (#807)`.
- **Covers:** `cat /outside/a.ts > /elsewhere/b.ts` produces grants `[{ external_directory_read, /outside/* }, { external_directory_write, /elsewhere/* }]` — replacing the `"falls back to the bare family when one ask spans two directions"` test.
  The three uniform-direction tests keep asserting one grant on the proven surface, and a new test pins the same-directory case (`cat /outside/a.ts > /outside/b.ts` → both directions on `/outside/*`) so the deliberate no-op is documented rather than discovered.
- **Also changes:** `src/handlers/gates/bash-external-directory.ts` — delete `approvalSurfaceFor` (its sole call site goes in this step), fold the `patterns` local into the `forGrants` argument, rewrite the doc-comment paragraph.
- **Killing mutations:**
  - *The narrowing itself:* make the gate build every grant with `surface: worstEntry.surface`.
    The mixed-direction test goes red; the uniform-direction tests stay green, because there `worstEntry.surface` **is** each entry's surface.
  - *The fallback's removal:* reinstate `approvalSurfaceFor` as the surface for every grant.
    The mixed-direction test goes red and the three uniform tests stay green — the two mutations are distinguishable only by the same-directory test, which the second leaves green and the first also leaves green, so it is the mixed test that discriminates both.
- **Verify:** full suite, `pnpm run check`, `pnpm run lint`.
- **Commit:** `feat(pi-permission-system): grant each external path only the direction its command proved`

### 4. `docs:` land the migration guide and the roadmap step mark

- **Deliverables:** the new `docs/migration/0810-per-pattern-approval-surfaces.md`; the README migration-table row; the ADR 0006 amendment; the `.pi/skills/package-pi-permission-system/SKILL.md` sentence; and the architecture-doc updates (module tree entries, the new `approval-grant.ts` entry, the health-metric row and its recompute command, Step 10's `✅` heading + `Landed:` note + Mermaid node, and the Release-batches `feat!:` resolution).
- **Verify:**
  - `pnpm exec rumdl check packages/pi-permission-system/docs packages/pi-permission-system/README.md .pi/skills/package-pi-permission-system/SKILL.md`
  - `grep -c 'ApprovalGrant' packages/pi-permission-system/src/session-approval.ts` — measured 0 at planning time under the roadmap's `ApprovalPattern` spelling; the rewritten row's command must read ≥ 1.
  - `grep -c 'approvalSurfaceFor' packages/pi-permission-system/src/handlers/gates/bash-external-directory.ts` — 1 at planning time, 0 after step 3.
  - `pnpm --filter @gotgenes/pi-permission-system exec pnpm pack --pack-destination /tmp && tar tzf …` — confirm the new migration guide ships and no internal doc does.
- **Commit:** `docs(pi-permission-system): document per-pattern approval surfaces and mark Phase 14 Step 10`

## Risks and Mitigations

| Risk                                                                                                                                          | Mitigation                                                                                                                                                                                                                                                                                                                                                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A third-party `Authorizer` link reading `details.sessionApproval.patterns` breaks silently at the consumer's next build.                      | It breaks at **compile** time, not runtime, which is the loud direction. The migration guide names the field and its replacement, and the `BREAKING CHANGE:` footer ships the same sentence into the changelog and the issue close comment.                                                                                                                                                            |
| A version-skewed parent/child pair loses the whole-session scope option, and the loss is silent.                                              | Verified against the published tag: the request is still accepted (`sessionApproval` is not in the reader's required set at v29.3.0), so the ask still prompts and the child still records its own narrow grant. The failure is narrow in both directions and needs no upgrade ordering — unlike [#745], whose older parent rejected the request outright. The migration guide states this explicitly. |
| Rejecting an empty `grants` array changes behavior for a producer that emits one.                                                             | No producer can: `single` always yields one grant, and `bash-external-directory` builds from a set the gate has already proven non-empty (the zero-uncovered case returns a `GateBypass` before any approval is constructed). Step 2's reader tests pin the rejection; if a producer is ever added, `applyGrantScope` silently recording nothing is the failure this tightening removes.               |
| The relief is invisible for same-directory commands, and a reader takes the roadmap's `Outcome:` line as a promise it is not.                 | Named in the Design Overview table, pinned by its own test in step 3, and restated in the architecture doc's `Landed:` note.                                                                                                                                                                                                                                                                           |
| The reshape's bulk test edits are mechanical find/replace across 12 files, where a `toMatchObject`-style assertion could absorb a wrong edit. | The affected assertions are `toEqual` / `toBe` on `sessionApproval?.surface` and `?.patterns`, which are exact. Step 2 runs the **full** package suite, not the files its own grep matched — a mock producer spells the shape as an object key that a `.patterns` call-site grep never sees.                                                                                                           |
| Deleting `SessionApproval.multiple` orphans a constructor a future gate wants.                                                                | `forGrants` subsumes it in one line (`patterns.map((pattern) => ({ surface, pattern }))`). Step 2 runs `pnpm fallow dead-code` to confirm nothing is left stranded in the other direction.                                                                                                                                                                                                             |

## Open Questions

- **The forwarded whole-session scope label under-names a multi-path grant.**
  `buildForwardedScopeLabels` renders `allow <surface> "<pattern>" for parent and all subagents` from the first grant, so a forwarded ask covering three external paths names one of them.
  This is pre-existing (it reads `patterns[0]` today) and unchanged here; ADR 0011 caps what an ask may render, so widening the label competes for the same prompt real estate [#813] will want.
  Left as an accepted residual rather than filed, since [#813] reworks this exact prompt region and should decide the label's shape with the width affordance in hand.
- **Whether `docs/session-approvals.md` should document the direction a grant lands on.**
  Deferred to [#813], where the user gains a choice worth documenting; today the direction is derived and not user-facing.

[#604]: https://github.com/gotgenes/pi-packages/issues/604
[#691]: https://github.com/gotgenes/pi-packages/issues/691
[#692]: https://github.com/gotgenes/pi-packages/pull/692
[#745]: https://github.com/gotgenes/pi-packages/issues/745
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#813]: https://github.com/gotgenes/pi-packages/issues/813
