---
issue: 596
issue_title: "pi-permission-system: carry the structured access intent onto the forwarded-permission wire"
---

# Carry the structured access intent onto the forwarded-permission wire

## Release Recommendation

**Release:** mid-batch — defer (batch "cross-session-intent"); confirm at ship time

This issue is Step 2 of Phase 12 Track A, the middle member of release batch "cross-session-intent" (Steps 1, 2, 3; tail = Step 3, [#597]).
The roadmap step (`docs/architecture/architecture.md`) tags it `Release: batch "cross-session-intent"`, and Step 2 is not the batch tail.
Its plan-execution commits are `feat:`/`test:`/`docs:` on `main`; the whole batch ships together once [#597] lands and cuts the release.

## Problem Statement

When an `ask`-state permission arises in a subagent child with no UI, the extension forwards it up the session tree for a decision.
The gate that raised the ask computed a full `AccessIntent` — for a path-shaped ask, an `AccessPath` carrying the lexical ∪ canonical alias set (`matchValues()`) and the canonical boundary form (`boundaryValue()`) — and then discarded it.
`PromptPermissionDetails` and `ForwardedPermissionRequest` carry only display strings (`surface`/`value`), so by the time an ask reaches the serving node the structured facts it needs are unrecoverable.

ADR 0008 (`docs/decisions/0008-cross-session-access-intent.md`, Step 1) settled the contract: **the child owns the facts; the parent owns the judgment.**
The facts are fixed at the origin child and carried unchanged across every hop; no node re-derives them.
This step threads those child-fixed facts from the point of decision (the gate) through the escalation edge (`ParentAuthorizer`) and onto the forwarded wire as the `ForwardedAccessIntent` field ADR 0008 specifies.
It does not yet make serving *consume* the field — that is Step 3 ([#597]).
Threading the intent onto the wire is the structural half of dissolving [#565] items 2–3 (path re-interpretation at the wrong node; undefined agent-scope semantics); the serving half lands in Step 3.

## Goals

- Declare the `ForwardedAccessIntent` wire schema (per ADR 0008 §2) in `src/authority/permission-forwarding.ts` and add it as an optional field on `ForwardedPermissionRequest`.
- Carry the gate-fixed access facts (`surface`, `matchValues`, `boundaryValue`) from every path and non-path gate onto `PromptPermissionDetails`, so they flow through the runner into the escalation edge.
- Stamp the requester-identity portion (`requesterCwd`, `principal`) at the escalation edge (`ParentAuthorizer`), where session identity is known, and serialize the complete `ForwardedAccessIntent` onto the forwarded request.
- Read the new field tolerantly in `src/authority/forwarding-io.ts` (version-skew: an older child's request without the field still reads and floors to `ask` as today).
- Honor the ADR-0002 string boundary: the wire carries strings only, never an `AccessPath` instance.
- This change is **non-breaking**: it adds an optional field with a tolerant read; no config, schema, default, or observable decision changes on upgrade.

Verify criterion (from the roadmap): `grep -c ForwardedAccessIntent src/authority/permission-forwarding.ts` goes 0 → ≥ 1.

## Non-Goals

- **Serving consumption of the intent** — Step 3 ([#597]) reworks `ServingPolicy`/`forwarded-request-server.ts` to resolve the forwarded intent directly and retires the legacy `(surface, value)` re-derivation.
  This step leaves `servingPolicy` in `index.ts` and `forwarded-request-server.ts` untouched; serving still re-derives from display strings, and `grep -c ForwardedAccessIntent forwarded-request-server.ts` stays 0.
- **Removing the `hasDisplayFields` floor** — the display-field escalation floor is Step 3's symptom to dissolve; the display fields (`source`/`surface`/`value`) continue to ride the wire unchanged.
- **Agent-scoped serving evaluation** — `requesterAgentName` graduates to decision-participating only when Step 3 resolves against it; this step carries `principal.agentName` on the wire but changes no resolution behavior.
- **Multi-surface fact set and multi-hop principal identity** — ADR 0008's two explicitly deferred edges; out of scope here.

## Background

Relevant existing modules and how they relate:

- **`src/access-intent/access-path.ts`** — the `AccessPath` value object.
  `matchValues()` returns the lexical alias union ∪ canonical form (the [#418]/[#486] match set); `boundaryValue()` returns the canonical (symlink-resolved) form or `""`; `value()` the lexical absolute form.
  Every path gate already builds one.
- **`src/access-intent/access-intent.ts`** — the gate-emitted `AccessIntent` union (`tool | access-path`).
  The `access-path` variant holds the `AccessPath`.
  ADR-0002 (`docs/decisions/0002-path-values-string-boundary.md`) keeps the manager string-based: `AccessPath` never crosses into the manager or the wire; producers convert to strings.
- **Gate factories** (`src/handlers/gates/`) — each builds a pure `GateDescriptor`.
  `path.ts`, `external-directory.ts` (tool surfaces) and `bash-path.ts`, `bash-external-directory.ts` (bash surfaces) hold an `AccessPath`; `tool.ts` holds one for the per-tool path-bearing surfaces (`accessPath?`); `skill-input.ts`/`skill-read.ts` are non-path.
- **`src/handlers/gates/runner.ts`** — `GateRunner.runDescriptor` spreads `descriptor.promptDetails` into `this.prompter.escalate({ requestId, ...descriptor.promptDetails, ... })`.
  Anything on `promptDetails` reaches the escalation edge.
- **`src/authority/permission-prompter.ts`** — `PromptPermissionDetails` is the ask payload.
  `GateDescriptor.promptDetails` is `Omit<PromptPermissionDetails, "requestId">`, so a new optional field on `PromptPermissionDetails` is automatically available on every descriptor's `promptDetails`.
- **`src/authority/approval-escalator.ts`** — `ParentAuthorizer.authorize(details)` builds a `ForwardedPermissionRequest` via `buildForwardedRequest` and writes/polls it.
  It already computes `requesterSessionId` (`getSessionId(ctx)`) and `requesterAgentName`.
- **`src/authority/forwarder-context.ts`** — `ForwarderContext`, the narrow read-interface `ExtensionContext` satisfies structurally, plus `getSessionId(ctx)`.
  `ExtensionContext.cwd` exists (used at `permission-gate-handler.ts:73`, `lifecycle.ts:59`), but `ForwarderContext` does not currently expose it.
- **`src/authority/permission-forwarding.ts` / `forwarding-io.ts`** — the `ForwardedPermissionRequest` type and its tolerant reader `readForwardedPermissionRequest`, which reconstructs an allowlist of known fields with per-field `asX` narrowers (`asUiPromptSource`, `asNullableDisplayString`, `asForwardedSessionApproval`).

Constraint from AGENTS.md / the package skill applied here:

- **ADR-0002 string boundary** — the wire schema carries `string[]`, never `AccessPath`; each gate converts via `matchValues()`/`boundaryValue()` at emit.
- **Architecture-doc convention** — module-tree entries describe current behavior; cite an issue only for an active constraint.
  The roadmap Step 2 heading + Mermaid `S2` node get `✅` + a `Landed:` note at implementation completion (not deferred to ship).
- **Tolerant-reader touch point** ([#558]) — `readForwardedPermissionRequest` reconstructs an allowlist, so a new field is silently dropped unless the reader is extended.
  That extension is in scope.

## Design Overview

### The fact / identity split

ADR 0008 groups a forwarded ask into *what is being accessed* (fixed at the child gate) and *who/where is requesting* (a property of the requester session).
This plan mirrors that split across the two layers that own each half:

- **The gate emits the access facts** — `surface`, `matchValues`, `boundaryValue`.
  Only the gate can produce `matchValues`/`boundaryValue` (they live on the `AccessPath`), and they must not be re-derived downstream.
- **The escalation edge stamps the requester identity** — `requesterCwd` (the session cwd, `ctx.cwd`) and `principal` (`sessionId`, `agentName`).
  `ParentAuthorizer` already knows both.

This keeps each gate producing only what it genuinely fixes (no per-gate cwd threading) and localizes principal-stamping to the one edge that owns session identity.

### Data shapes

Declared in `src/authority/permission-forwarding.ts` (strings only — ADR-0002):

```typescript
/**
 * The child-fixed facts a gate emits: the surface it evaluated and the match
 * set it computed. `principal` and `requesterCwd` are stamped at the
 * escalation edge, so a gate carries only what it alone can produce.
 */
export interface ForwardedAccessFacts {
  /** Gate surface: "path", "external_directory", "bash", a tool name, or a skill name. */
  surface: string;
  /**
   * Child-fixed match set. Path surface: AccessPath.matchValues() (absolute ∪
   * cwd-relative ∪ canonical). Non-path surface: the already-portable single
   * value as a one-element array. Strings only.
   */
  matchValues: string[];
  /** AccessPath.boundaryValue() for a path surface; null for a non-path surface. */
  boundaryValue: string | null;
}

/** The forwarded-wire access intent (ADR 0008 §2): access facts + requester identity. */
export interface ForwardedAccessIntent extends ForwardedAccessFacts {
  /** Requester cwd, for provenance/disclosure — never for parent re-derivation. */
  requesterCwd: string;
  /** Who is requesting. */
  principal: {
    sessionId: string;
    agentName: string;
  };
}
```

`ForwardedPermissionRequest` gains an optional field:

```typescript
export type ForwardedPermissionRequest = {
  // …existing fields (id, createdAt, requesterSessionId, targetSessionId,
  //   requesterAgentName, message, source?, surface?, value?, sessionApproval?)…
  /**
   * The child-fixed access intent (ADR 0008 §2). Optional for version-skew
   * tolerance: an older child omits it, and the serving node floors to `ask`
   * (Step 3). Present on a current child's request for every gate surface.
   */
  accessIntent?: ForwardedAccessIntent;
};
```

`PromptPermissionDetails` (`permission-prompter.ts`) gains the gate-facts half only:

```typescript
export interface PromptPermissionDetails {
  // …existing fields…
  /**
   * The child-fixed access facts the raising gate computed. Rides through the
   * runner to the escalation edge, which completes them into a
   * ForwardedAccessIntent (adding requesterCwd + principal). Absent for a
   * serving-node local prompt reconstructed from a forwarded request.
   */
  accessIntent?: ForwardedAccessFacts;
}
```

### Gate emission (call sites)

Each gate sets `promptDetails.accessIntent`.
Because `GateDescriptor.promptDetails` is `Omit<PromptPermissionDetails, "requestId">`, no change to the `GateDescriptor` interface in `descriptor.ts` is needed — the facts ride on `promptDetails`, satisfying the issue's "onto the descriptor/details" target.

- **Path surfaces** (`path.ts`, `external-directory.ts`, `bash-path.ts`, `bash-external-directory.ts`): the gate already holds the deciding `AccessPath` (`accessPath` / `worstEntry.path` / the worst uncovered entry's path).
  Emit:

  ```typescript
  accessIntent: {
    surface: /* "path" | "external_directory" */,
    matchValues: accessPath.matchValues(),
    boundaryValue: accessPath.boundaryValue() || null,
  }
  ```

  For `bash-external-directory.ts`, select the `AccessPath` of the uncovered entry whose `check === worstCheck` (the same entry `preCheck` came from), mirroring how `bash-path.ts` finds `worstEntry`.

- **Per-tool gate** (`tool.ts`, `describeToolGate`): when `accessPath` is present (path-bearing surfaces `read`/`write`/`edit`/`grep`/`find`/`ls`) emit the path-facts form with `surface: gateSurface`; otherwise (bash / MCP / plain tool) emit the single-value form `{ surface: gateSurface, matchValues: [decision.value], boundaryValue: null }`, reusing the already-computed `descriptor.decision.value`.

- **Skill surfaces** (`skill-input.ts`, `skill-read.ts`): non-path — `{ surface: "skill", matchValues: [skillName], boundaryValue: null }`.

### Escalation-edge completion (`ParentAuthorizer`)

`forwarder-context.ts` exposes the session cwd:

```typescript
export interface ForwarderContext {
  hasUI: boolean;
  ui: PermissionDecisionUi;
  cwd: string; // new — ExtensionContext already provides this
  sessionManager: { /* …unchanged… */ };
}

/** Reads the current session cwd off `ctx`. */
export function getCwd(ctx: ForwarderContext): string {
  return ctx.cwd;
}
```

`ParentAuthorizer.authorize` threads `details.accessIntent` into `buildForwardedRequest`, which completes it (Tell-Don't-Ask: the edge stamps identity from data it already holds; it never asks the wire object to compute anything):

```typescript
// ParentAuthorizer.buildForwardedRequest — illustrative
const accessIntent: ForwardedAccessIntent | undefined = facts
  ? {
      ...facts, // surface, matchValues, boundaryValue (child-fixed)
      requesterCwd: getCwd(ctx),
      principal: { sessionId: requesterSessionId, agentName: requesterAgentName },
    }
  : undefined;
return {
  id, createdAt, requesterSessionId, targetSessionId, requesterAgentName, message,
  ...(forwarded ? { source, surface, value } : {}),
  ...(sessionApproval ? { sessionApproval } : {}),
  ...(accessIntent ? { accessIntent } : {}),
};
```

The full `ForwardedAccessIntent` is what Step 3 will read off the request (`request.accessIntent`) and hand to `resolver.resolve`, using `matchValues` as-is with no parent-side `PathNormalizer` re-derivation.

### Tolerant read (`forwarding-io.ts`)

Add an `asForwardedAccessIntent(value): ForwardedAccessIntent | undefined` narrower alongside the existing `asX` helpers, accepting only a well-formed shape (string `surface`, all-string `matchValues` array, `string | null` `boundaryValue`, string `requesterCwd`, `principal` with string `sessionId`/`agentName`); anything else → `undefined`.
Wire it into `readForwardedPermissionRequest`'s reconstruction block: `accessIntent: asForwardedAccessIntent(parsed.accessIntent)`.
Absent or malformed → `undefined`, which Step 3 floors to `ask`.

### Edge cases

- **Empty boundary** — `AccessPath.boundaryValue()` is `""` for a literal-only path (e.g. a relative bash token after a non-literal `cd`).
  Emit `null` for an empty boundary so the wire's `boundaryValue: string | null` is honest (`accessPath.boundaryValue() || null`).
- **Multiple external paths** — the bash external-directory gate carries only the worst (deciding) path's facts; a multi-path/multi-surface fact set is an ADR-deferred edge and floors to `ask` at the serving node.
- **`unknown` requester identity** — `getSessionId`/`requesterAgentName` already fall back to `"unknown"`; `principal` carries those fallbacks verbatim (no new behavior).

## Module-Level Changes

- **`src/authority/permission-forwarding.ts`** — add `ForwardedAccessFacts` and `ForwardedAccessIntent` interfaces; add optional `accessIntent?: ForwardedAccessIntent` to `ForwardedPermissionRequest`. (Satisfies the roadmap grep verify.)
- **`src/authority/forwarding-io.ts`** — add `asForwardedAccessIntent` narrower; import `ForwardedAccessIntent`; wire `accessIntent` into `readForwardedPermissionRequest`.
- **`src/authority/permission-prompter.ts`** — add optional `accessIntent?: ForwardedAccessFacts` to `PromptPermissionDetails`; import `ForwardedAccessFacts` (module already imports `ForwardedSessionApproval` from `permission-forwarding`).
- **`src/authority/forwarder-context.ts`** — add `cwd: string` to `ForwarderContext`; add `getCwd(ctx)` helper.
- **`src/authority/approval-escalator.ts`** — thread `details.accessIntent` from `authorize` into `waitForForwardedApproval` → `buildForwardedRequest`; compose and serialize the full `ForwardedAccessIntent` (`requesterCwd` via `getCwd(ctx)`, `principal` from the already-computed `requesterSessionId`/`requesterAgentName`).
- **`src/handlers/gates/path.ts`** — set `promptDetails.accessIntent` from `accessPath` (surface `"path"`).
- **`src/handlers/gates/external-directory.ts`** — set `promptDetails.accessIntent` from `accessPath` (surface `"external_directory"`).
- **`src/handlers/gates/bash-path.ts`** — set `promptDetails.accessIntent` from `worstEntry.path` (surface `"path"`).
- **`src/handlers/gates/bash-external-directory.ts`** — select the worst uncovered entry's `AccessPath`; set `promptDetails.accessIntent` (surface `"external_directory"`).
- **`src/handlers/gates/tool.ts`** — set `promptDetails.accessIntent`: path-facts when `accessPath` present, else `[decision.value]` single-value form.
- **`src/handlers/gates/skill-input.ts`, `src/handlers/gates/skill-read.ts`** — set `promptDetails.accessIntent` to the `{ surface: "skill", matchValues: [skillName], boundaryValue: null }` form.
- **`test/helpers/forwarding-fixtures.ts`** — `makeForwarderContext` gains a `cwd?` option with a default (e.g. `"/repo"`), so fakes built through it satisfy the widened `ForwarderContext`.
- **Inline `ForwarderContext` fakes** — grep `test/` for inline `{ hasUI, ui, sessionManager }` object literals that do not go through `makeForwarderContext` and add `cwd`.
  Candidate files (from the `ForwarderContext` reference grep): `test/authority/forwarding-manager.test.ts`, `test/authority/forwarded-request-server.test.ts`, `test/authority/authorizer.test.ts`, `test/authority/authorizer-selection.test.ts`, `test/composition-root.test.ts` — verify each at implementation time; those using `makeForwarderContext` need no edit.
- **`docs/architecture/architecture.md`** — mark Phase 12 Step 2 complete: `✅` on the Step 2 heading and the Mermaid `S2` node, add a `Landed:` note.
  Update the module-tree entries that now name the mechanism to describe current behavior: `permission-forwarding.ts` (carries the `ForwardedAccessIntent` wire schema), `forwarding-io.ts` (tolerant read of `accessIntent`), `approval-escalator.ts` (`ParentAuthorizer` stamps `requesterCwd`/`principal` and serializes the intent), `permission-prompter.ts` (`PromptPermissionDetails` carries the child-fixed access facts), `forwarder-context.ts` (adds `cwd`/`getCwd`).
  The `Forwarded-wire structured intent` metric row now reads ≥ 1; note it in the `Landed:` line but leave the fixed `Baseline` snapshot column unedited (per the package skill).

Contradiction check: no file appears in both Module-Level Changes and Non-Goals — `forwarded-request-server.ts` and `index.ts`'s `servingPolicy` are named in Non-Goals only and are not touched here.

## Test Impact Analysis

1. **New unit tests enabled by the structured field:**
   - `forwarding-io` round-trip: a request with a well-formed `accessIntent` reconstructs it; a malformed one drops to `undefined`; an absent one reads as `undefined` (version skew).
   - `approval-escalator`: `buildForwardedRequest` stamps `principal` (`sessionId`/`agentName` from the requester) and `requesterCwd` (from `ctx.cwd`) onto `request.accessIntent`; a `details` without `accessIntent` omits the field.
   - Per-gate emission: each gate's descriptor carries `promptDetails.accessIntent` with the expected surface and match set (path facts from the `AccessPath` for path surfaces; single-value form for bash/MCP/skill/plain-tool).
     These assert on the pure descriptor (no runner needed).
2. **Existing tests that become redundant:** none.
   The display-field (`source`/`surface`/`value`) and `sessionApproval` forwarding tests continue to exercise the paths that remain unchanged; nothing is superseded until Step 3 reworks serving.
3. **Existing tests that must stay as-is:** the forwarding round-trip and display-field tolerance tests (they pin the display fields still riding the wire), and every gate's existing resolution/descriptor test (the `access-path` resolve call and `preCheck` are untouched — the facts are read off the same `AccessPath`).

## Invariants at risk

This step touches surfaces earlier phase steps refactored; each invariant below has a pinning test.

- **Display fields still ride the wire** (the [#557]/[#292] non-degraded-broadcast contract) — adding `accessIntent` must not drop `source`/`surface`/`value`.
  Pinned by the existing forwarding display-field tests (`test/authority/approval-escalator.test.ts`, `test/authority/permission-forwarding.test.ts`).
  Add an assertion that both display fields and `accessIntent` are present on the same request.
- **ADR-0002 string boundary** — no `AccessPath` crosses onto the wire.
  Pinned by the `no-restricted-imports` lint on `permission-manager.ts` (untouched) plus a new test asserting `request.accessIntent.matchValues` are strings and `boundaryValue` is `string | null`.
- **Gate resolution unchanged** — the `access-path` intent each gate emits to the resolver, and the resulting `preCheck`/decision, are unchanged (the facts are a read-only projection of the same `AccessPath`).
  Pinned by the existing per-gate resolution tests, which must stay green with no edits to their decision assertions.

## TDD Order

1. **`test:` → `feat:` — wire type + tolerant read.**
   Add `ForwardedAccessFacts`/`ForwardedAccessIntent` and the optional `ForwardedPermissionRequest.accessIntent` field; add `asForwardedAccessIntent` and wire it into `readForwardedPermissionRequest`.
   Test surface: `test/authority/permission-forwarding.test.ts` (or the forwarding-io test) — round-trip well-formed / malformed / absent.
   The type and reader land together (the reader references the type).
   Commit: `feat(pi-permission-system): declare ForwardedAccessIntent wire schema with tolerant read (#596)`.
2. **`feat:` — escalation-edge serialization + prompt-details facts + context cwd.**
   Add `cwd`/`getCwd` to `forwarder-context.ts`; add `accessIntent?: ForwardedAccessFacts` to `PromptPermissionDetails`; thread `details.accessIntent` through `ParentAuthorizer` and stamp `requesterCwd`/`principal` onto `request.accessIntent`.
   Update `makeForwarderContext` and every inline `ForwarderContext` fake in the same commit (the widened interface breaks them at compile time).
   Test surface: `test/authority/approval-escalator.test.ts`.
   Commit: `feat(pi-permission-system): serialize the child-fixed access intent onto the forwarded request (#596)`.
3. **`feat:` — tool-surface path gates emit facts.**
   `path.ts` + `external-directory.ts`.
   Test surface: their gate tests.
   Commit: `feat(pi-permission-system): emit access-intent facts from the tool path gates (#596)`.
4. **`feat:` — bash-surface path gates emit facts.**
   `bash-path.ts` + `bash-external-directory.ts` (worst-entry `AccessPath` selection).
   Commit: `feat(pi-permission-system): emit access-intent facts from the bash path gates (#596)`.
5. **`feat:` — per-tool gate emits facts.**
   `tool.ts` (path form when `accessPath` present; single-value form otherwise).
   Commit: `feat(pi-permission-system): emit access-intent facts from the per-tool gate (#596)`.
6. **`feat:` — skill gates emit facts.**
   `skill-input.ts` + `skill-read.ts` (single-value skill form).
   Commit: `feat(pi-permission-system): emit access-intent facts from the skill gates (#596)`.
7. **`docs:` — mark Step 2 complete + refresh module-tree entries.**
   `docs/architecture/architecture.md`: `✅` heading + `S2` node, `Landed:` note, updated module-tree entries for the touched `authority/` modules.
   Commit: `docs(pi-permission-system): mark Phase 12 Step 2 complete (#596)`.

Each gate step (3–6) is independently type-safe: adding an optional `promptDetails.accessIntent` is additive, and the field is not yet consumed for any decision, so no cross-module compile break forces gates into one commit.
Step 2's `cwd` addition is the one interface tightening; its fixture updates ride the same commit.

## Risks and Mitigations

- **Silent field drop on read** ([#558]) — the tolerant reader reconstructs an allowlist, so an unwired field never round-trips.
  Mitigation: Step 1 wires `asForwardedAccessIntent` and tests the round-trip explicitly.
- **`AccessPath` leaking onto the wire** (ADR-0002 violation) — mitigation: gates convert to strings at emit; a Step-1 test asserts the serialized shape is strings only; the existing `permission-manager.ts` import lint is unaffected.
- **Interface tightening breaks fakes** — widening `ForwarderContext` with a required `cwd` breaks inline fakes at compile time.
  Mitigation: centralize via `makeForwarderContext`'s default and grep `test/` for inline constructions in the same commit (the AGENTS.md fixture-grep rule for tightened shared types).
- **Over-reaching into Step 3** — the temptation is to also make serving consume the field.
  Mitigation: Non-Goals fences `forwarded-request-server.ts`/`servingPolicy`; the serving-read metric stays 0 until [#597].
- **Empty boundary ambiguity** — a literal-only path has `boundaryValue() === ""`.
  Mitigation: emit `null` for an empty boundary so the wire distinguishes "no canonical" cleanly.

## Open Questions

- **Whether `principal` should reuse the top-level `requesterSessionId`/`requesterAgentName` rather than nest a copy.**
  Resolved for this plan: nest a self-contained `principal` per ADR 0008 §2, since Step 3 reads `intent.principal.agentName` and a self-contained fact object is cleaner than reaching across the request; the top-level fields remain for routing/display and backward compatibility.
  No follow-up needed.
- No deferred follow-up issues: Step 3 ([#597]) already exists as the serving-consumption step, and the ADR's two deferred edges are recorded in ADR 0008.

[#292]: https://github.com/gotgenes/pi-packages/issues/292
[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#486]: https://github.com/gotgenes/pi-packages/issues/486
[#557]: https://github.com/gotgenes/pi-packages/issues/557
[#558]: https://github.com/gotgenes/pi-packages/issues/558
[#565]: https://github.com/gotgenes/pi-packages/issues/565
[#597]: https://github.com/gotgenes/pi-packages/issues/597
