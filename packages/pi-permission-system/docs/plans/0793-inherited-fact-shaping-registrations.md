---
issue: 793
issue_title: "pi-permission-system: close or announce the split-provider access-extractor gap in excluded children (ADR 0012 decision 6)"
---

# A child inherits its parent's fact-shaping registrations

## Release Recommendation

**Release:** ship independently

Phase 14 Step 8 carries `Release: independent` in `docs/architecture/architecture.md`, and it belongs to no release batch.
Step 6 below is a `feat:` commit, so the merge cuts a release on its own.

## Problem Statement

ADR 0012 decision 6 names a hazard and states the contract cannot prevent it: excluding an extractor or formatter **provider** from child sessions weakens the child's own gates, because the tool's custom path key goes unextracted.

Checked against pi-subagents' actual exclusion semantics the hazard is narrower than that reads, and correspondingly sharper.
Excluding a package normally keeps the tools it registers out of children too, since its factory never runs there — so exclusion removes a tool and its extractor together and nothing is weakened.
A gap needs a **split** between providers:

- Package **A** registers tool `deploy`, whose path lives under a non-standard key (`input.target`).
- Package **B** registers `registerToolAccessExtractor("deploy", …)` for it.
- The operator excludes **B** from children for load-time cost.

The child then has `deploy` and no extractor.
`getToolInputPath` falls back to the `input.path` convention, finds nothing, and returns `null`, so the path never reaches the child's `path` / `external_directory` gates at all.
The parent still gates its own `deploy` calls correctly, so the weakening is visible nowhere.

Preview formatters split the same way.
Their consequence is legibility rather than gating: the child builds the prompt preview in its own pipeline and forwards it, so the human answering the parent's prompt sees the JSON default instead of the registered preview.

## Goals

- A tool call in an in-process child resolves its access extractor from the parent chain when the child's own registry has no entry, so the split-provider condition cannot weaken a child's path gating.
- The same holds for tool-input formatters, so a forwarded ask renders with the preview its provider registered.
- Every gate decision that used an inherited extractor records that fact, so a child's dependence on another node is never invisible.
- ADR 0012 gains the rule this repairs against — an extension of decision 1's existing axis, not a new concept — and decision 6's hazard statement is narrowed to the split-provider condition it actually describes.
- The interim by-hand check [#789] shipped in pi-subagents' `docs/configuration.md` is replaced by a statement of the closed condition.
- **This change is not breaking.**
  Two read methods are added to `PermissionsService` (additive), and the reshaped `ToolAccessExtractorLookup` is package-internal — `package.json` `exports` resolves only `src/service.ts`, which never re-exports it.

## Non-Goals

- **Chain-link inheritance is explicitly out of reach.**
  A locally-adjudicating child whose config names a link its extension set does not provide skips the link and logs `authorizer_chain_unregistered_link`.
  That shares this issue's cause and not its remedy, and it is filed as [#861] (deferred to a later phase by recorded disposition).
  Step 6 adds a guard test pinning the boundary, because the whole safety argument below rests on it.
- **Out-of-process children.**
  They share no `globalThis`, so the parent's service is unreachable and an extractor is a closure that cannot be serialized; repairing it there would mean an inter-process round trip per tool call.
  The by-hand doc check remains their only cover, and the ADR amendment names this as a residual rather than glossing it as "out of scope".
- **A declarative capability manifest.**
  The deep root cause is that fact-shaping intent is never declared anywhere — an extractor is registered imperatively by whatever loads, so a node cannot statically know it is missing one, which is why the repair has to be a runtime resolution rather than a load-time check.
  Recorded here as the root, deliberately not planned and not filed: it is a large additive surface, and existing functional extractors cannot be expressed declaratively.
- **Formatter provenance stamping.**
  A formatter's effect is the rendered text itself, and it decides nothing; only the extractor is a security surface, so only it is stamped.
- **`ToolInputFormatterRegistry` / `ToolAccessExtractorRegistry` consolidation.**
  The two are near-identical twins, and the Tidy-First assessor rejected merging them: this change modifies neither class's internals, and the generality it needs lives in the new decorators, which are generic over the interfaces rather than the implementations.

## Background

The relevant machinery already exists and is small.

- `ToolAccessExtractorRegistry` and `ToolInputFormatterRegistry` are structurally identical: a `Map`, throw-on-duplicate `register`, an identity-guarded disposer, and an ISP `Lookup` / `Registrar` split.
  One instance of each is created in `index.ts` and threaded into `ToolCallGatePipeline`.
- The consumers are single call sites: `ToolAccessExtractorLookup.get` is called only from `getToolInputPath` (`src/access-intent/tool-input-path.ts:45`), and `ToolInputFormatterLookup.get` only from `ToolPreviewFormatter` (`src/tool-preview-formatter.ts:110`).
- `ToolCallGatePipeline` already takes both as **interfaces** (`customFormatters?`, `customExtractors?`), so a decorator substitutes at the composition root with no change to any gate's wiring.
- "Who is my in-process parent" is solved: `getSubagentSessionRegistry().get(sessionId)?.parentSessionId`, the same lookup `resolvePermissionForwardingTarget` uses for `source: "registry"`.
- Each node publishes its service under its own session id since [#699], read with `getPermissionsService(sessionId)`.
  What is missing is a **reader** — the service exposes registrars and no getters.

Constraints from `AGENTS.md` and the package skill that bear on this change:

- The four path layers compose most-restrictive-wins across surfaces, so adding a path check can never loosen a decision.
- `getPermissionsService` must be resolved per use, never cached — the decorators hold a thunk, not a reference.
- Registrations are node-local (ADR 0012 decision 1); this change does not move any registration.
- The `SubagentSessionRegistry` is process-global and must be reached through `getSubagentSessionRegistry()`.

## Design Overview

### The rule the amendment states

ADR 0012 decision 1 splits registrations into **recorded authority** (config, resolved node-locally) and **live authority** (chain links, converging at the adjudicating node).
It is silent on a third category, because that category was assumed complete in every node:

| Category                              | Produces              | Read by               | Node-local?                     |
| ------------------------------------- | --------------------- | --------------------- | ------------------------------- |
| Fact-shaping (extractors, formatters) | a fact about the call | the requesting node   | landing yes; lookup may inherit |
| Recorded authority (config)           | a rule                | the resolving node    | yes                             |
| Live authority (chain links)          | a verdict             | the adjudicating node | yes                             |

This issue is the discovery that fact-shaping can be **incomplete** in a child, and that nothing said what happens then.
The amendment adds one clause: a fact-shaping registration, being non-authority, may be **read** across an in-process node boundary to complete a child's own fact-gathering.
Where a registration lands is unchanged, and the recorded/live authority split is untouched.

Three properties keep the clause from generalizing into the authority registries:

1. An extractor returns a path, a formatter returns display text.
   Neither decides anything, so no authority crosses a node boundary.
2. The extractor path is **monotone**: with no extractor the gate does not run at all, and adding one can only add a check that most-restrictive-wins composition cannot loosen.
   A link has no such property — it can return `allow`.
3. The two cases differ in declared intent.
   An extractor appears in no config, so excluding its provider carries no operator statement about the tool's path visibility.
   A link name is written in `authorizerChain`, so excluding its provider contradicts a statement the operator made — a conflict to resolve ([#861]), not a capability to restore.

### Resolution shape

Only the extractor needs provenance, so only its lookup carries it.
The formatter's lookup keeps today's shape, because `ToolPreviewFormatter` has nothing to record.

```typescript
export type RegistrationOrigin = "local" | "inherited";

export interface ResolvedToolAccessExtractor {
  extractor: ToolAccessExtractor;
  origin: RegistrationOrigin;
}

/** Read side consumed by `getToolInputPath` (ISP — no registration surface). */
export interface ToolAccessExtractorLookup {
  resolve(toolName: string): ResolvedToolAccessExtractor | undefined;
}
```

`ToolAccessExtractorRegistry.get` becomes `resolve`, answering `origin: "local"`.
It has exactly one caller, so the reshape is contained; the new service reader unwraps it (`resolve(name)?.extractor`), keeping one lookup method on the class rather than two that differ only in return shape.

`getToolInputPath` reports where the path came from:

```typescript
export type ToolPathSource = "convention" | "local_extractor" | "inherited_extractor";

export interface ToolInputPathResult {
  path: string | null;
  source: ToolPathSource;
}
```

The Tidy-First assessor checked for a cheaper seam and found none: every alternative pushes provenance into the interface both plain registries and the decorator implement, which is a wider blast radius than widening one function's return at its two call sites.

### The parent-chain walk

The shared core is one generic function; the two decorators are thin wrappers over it.

```typescript
const inherited = resolveFromParentChain(
  nodeIdentity.currentSessionId(),
  getSubagentSessionRegistry(),
  (service) => service.getToolAccessExtractor(toolName),
);
```

`resolveFromParentChain` walks `parentSessionId` upward, resolving each hop with `getPermissionsService(id)` (per use, never cached) and returning the first non-`undefined` answer, with a visited `Set` guarding against a cycle.

The walk is transitive rather than immediate-parent-only.
Exclusion applies to every descendant equally, so in a nested spawn the grandchild's immediate parent is itself missing the extractor — stopping at one hop would repair the child and not the grandchild, for no saving.

`NodeIdentity` is a one-method seam (`currentSessionId(): string | null`) satisfied by `PermissionServiceLifecycle`, which already reads `readSessionId(ctx)` at `activate` and holds it as `publishedSessionId`.
That keeps this node's identity in the one place that already owns it rather than introducing a second holder.

### Consumer call sites

The gate side, after the reshape:

```typescript
const { path: filePath, source } = getToolInputPath(tcc.toolName, tcc.input, extractors);
if (!filePath) return null;
// …
logContext: buildPathGateLogContext(tcc, filePath, source),
```

`buildPathGateLogContext` stamps `extractorSource: "inherited"` **only** when the source is `inherited_extractor`, leaving the field absent otherwise.
The [#807] precedent (`effect` / `effectSource`) stamps unconditionally because both of its values are informative; here one value would be stamped on effectively every record in the log while carrying no information, so the field earns its place only when it is true.

### Cost

The decorator is consulted only in `getToolInputPath`'s `skill` / `extension` branch, so built-in tools, MCP tools, and bash never reach it.
On a local hit it is one `Map` lookup, unchanged from today.
On a miss in a root session the subagent registry has no entry for the node, so the walk terminates immediately.
Only a miss in a child costs a walk, bounded by nesting depth.

### Failure modes, and why each is safe

- A parent that has torn down has unpublished its service, so `getPermissionsService` answers `undefined` and the lookup falls through to the convention — today's behavior.
- A cycle in `parentSessionId` terminates on the visited set.
- A `/reload` in the parent can change the answer for the same call in the same child.
  This is the one real cost — the child is no longer explainable from the child alone — and it is what the provenance stamp exists to record.

## Module-Level Changes

- `src/tool-access-extractor-registry.ts` — `ToolAccessExtractorLookup.get` becomes `resolve`, returning `ResolvedToolAccessExtractor`; add the `RegistrationOrigin` and `ResolvedToolAccessExtractor` types.
  `ToolAccessExtractorRegistry.resolve` answers `origin: "local"`.
- `src/tool-input-formatter-registry.ts` — unchanged.
- `src/access-intent/tool-input-path.ts` — `getToolInputPath` returns `ToolInputPathResult`; the `skill` / `extension` branch maps a resolution's origin onto `local_extractor` / `inherited_extractor`, and every other branch reports `convention`.
- `src/handlers/gates/helpers.ts` — new `buildPathGateLogContext` and `buildPathGatePromptDetails`, extracted from the two gates' identical literals (Tidy-First step 2), with the log builder taking the extractor source.
- `src/handlers/gates/path.ts`, `src/handlers/gates/external-directory.ts` — destructure the new return shape and build `logContext` / `promptDetails` through the helpers.
- `src/handlers/gates/tool-call-gate-pipeline.ts` — `customExtractors` takes the reshaped lookup.
- `src/authority/inherited-registrations.ts` (new) — `resolveFromParentChain`, `NodeIdentity`, `InheritingToolAccessExtractorLookup`, `InheritingToolInputFormatterLookup`.
  Placement confirmed by the assessor against the directory vocabulary: it joins `subagent-registry.ts`, `child-node-audit.ts`, and `forwarding-liveness.ts` as cross-node machinery, and it reads both.
- `src/service.ts` — `PermissionsService` gains `getToolAccessExtractor(toolName)` and `getToolInputFormatter(toolName)`, documented as the read face of a fact-shaping registry and as cross-node readable by design.
- `src/permissions-service.ts` — implement both; the two registry constructor parameters widen from `*Registrar` to `*Registrar & *Lookup`.
- `src/service-lifecycle.ts` — `PermissionServiceLifecycle` gains `currentSessionId()`, satisfying `NodeIdentity`.
- `src/index.ts` — wrap both registries in the inheriting lookups and pass those to `ToolCallGatePipeline`; the undecorated registries still back the service's registrars.

Documentation, verified by grep against the symbols and phrases each names:

- `docs/decisions/0012-cross-node-extension-contract.md` — an `#### Amendment` extending decision 1 with the fact-shaping clause, narrowing decision 6's hazard statement to the split-provider condition, and naming the out-of-process residual and the [#861] boundary.
- `docs/cross-extension-api.md` — the two readers, and the statement that fact-shaping registrations are cross-node readable while authority registrations are not.
- `docs/subagent-integration.md` — its loading-asymmetry section states the hazard decision 6 names; it becomes the closed condition plus the out-of-process residual.
- `docs/configuration.md` — the review-log field table gains `extractorSource`.
- `packages/pi-subagents/docs/configuration.md` — the "Excluding a permission extension" subsection's split-provider hand check is replaced by the closed statement; the `#793` tracking link goes.
  This is the only file outside `pi-permission-system`, and it is documentation, so the plan stays single-package (the [#789] precedent).
- `docs/architecture/architecture.md` — Step 8 `✅` on the heading and the Mermaid node, a `Landed:` note, and the health-metric row for split-provider tests.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the cross-extension section describes the extractor registry and `PermissionsService`'s surfaces; both change.

Greps run to build that list: `registerToolAccessExtractor`, `ToolAccessExtractorRegistry`, `getToolInputPath`, `split-provider`, and `child_node_absent` across `src/`, `test/`, `packages/*/docs/`, and `.pi/skills/`.

## Test Impact Analysis

New unit tests the change enables, none of which were previously possible:

- `resolveFromParentChain` over a fake registry and a fake locator: a hit at the immediate parent, a hit two hops up, no parent, a parent with no published service, and a cycle.
  Each of these is a pure function test today only because the walk is extracted rather than inlined into a decorator.
- The two decorators: local hit does not consult the parent at all (a spy on the locator thunk), local miss returns the parent's answer tagged `inherited`, and a miss everywhere answers `undefined`.
- The service readers, against a real registry.

Existing tests that must stay as-is:

- `test/access-intent/tool-input-path.test.ts` genuinely exercises the convention/MCP/extension branch selection, which no lower-level test replaces.
  It changes shape (assertions move to `.path`) but not coverage.
- `test/handlers/gates/external-directory.test.ts`'s existing `logContext` assertions pin the extraction in Tidy-First step 2.

Redundant afterwards: none identified.
The change adds a layer rather than replacing one.

Characterization test added first: `test/handlers/gates/path.test.ts` has **zero** `logContext` assertions today (`grep -c logContext` reports 0, against 3 in its external-directory sibling), so the shared-helper extraction would land on it unguarded.

The roadmap metric `grep -rl 'split-provider' packages/pi-permission-system/test | wc -l` measures **0** today.
Step 6 names its composition-root block `split-provider extractor inheritance`, taking it to 1 and using the roadmap's own predicted name so the metric row needs no rewrite.

## Invariants at risk

This change touches surfaces three shipped phase steps already refactored.

- **Step 7 ([#792]) — the absent-child alarm.**
  Its outcome is that a child with no permission node is announced.
  Inheritance must not mask it: a child with no node publishes no service, has no gates, and inherits nothing, so the alarm is orthogonal.
  Pinned by the `child_node_absent` blocks in `test/composition-root.test.ts`, which Step 6 must leave green and untouched.
- **Step 6 ([#796]) — no process-root service slot.**
  The walk must resolve each hop through `getPermissionsService(sessionId)` and never reintroduce a root reader.
  Pinned by `test/service.test.ts`; Step 5's own tests assert the walk consults the keyed locator with each parent's id.
- **ADR 0007 §7 — one chain per node.**
  This is the invariant the whole safety argument rests on, and it currently lives in prose plus the `authorizer_chain_unregistered_link` skip in `src/authority/authorizer-selection.ts:143-155`.
  No existing test pins that a child does **not** obtain an authorizer registered only in its parent, because until now there was no mechanism by which it could.
  Step 6 adds that test.

I opened the tests named above rather than citing them by name: `test/composition-root.test.ts`'s child-node-absent block drives the real factory through `makeFakePi`, so it exercises the audit rather than mocking it.

No quantitative invariant (a byte-identical prefix, a token budget, a latency characteristic) is at risk — the decorator adds one `Map` miss on a branch built-in tools never reach.

## TDD Order

1. `test:` — characterize `describePathGate`'s `logContext`.
   Surface: `test/handlers/gates/path.test.ts`.
   Covers the fields the shared helper is about to own, mirroring the existing external-directory assertion, so step 2's extraction has a net.
   Killing mutation: drop `path` from `describePathGate`'s `logContext` literal — the new assertion must go red.
   Commit: `test(pi-permission-system): characterize the path gate's log context`.

2. `refactor:` — extract `buildPathGateLogContext` / `buildPathGatePromptDetails` into `src/handlers/gates/helpers.ts` and use them from both path gates.
   Prepares step 6, which otherwise adds the same field to two near-duplicate literals and tests it twice.
   Surface: existing `path.test.ts` and `external-directory.test.ts` assertions, unchanged.
   Killing mutation: make `buildPathGateLogContext` return `source: "skill"` instead of `"tool_call"` — both gates' assertions must go red from one edit, which is the point of the extraction.
   Commit: `refactor(pi-permission-system): share the path gates' fact builders`.

3. `refactor:` — reshape the extractor lookup to `resolve` and widen `getToolInputPath` to `ToolInputPathResult`.
   No behavior change: with no decorator wired, every answer is `convention` or `local_extractor`.
   Surface: `test/access-intent/tool-input-path.test.ts` (assertions move to `.path`, plus new `.source` assertions for the convention and local-extractor branches), both gate tests.
   Killing mutation: make the `extension` branch report `source: "convention"` when a registered extractor answered — the new `.source` assertion must go red while every `.path` assertion stays green.
   Commit: `refactor(pi-permission-system): report where a tool's path came from`.

4. `feat:` — `PermissionsService.getToolAccessExtractor` / `getToolInputFormatter`, implemented by `LocalPermissionsService`.
   A published API surface a consumer can call the moment it ships, hence `feat:` rather than `refactor:`.
   Surface: `test/permissions-service.test.ts`, `test/service.test.ts`.
   Killing mutation: have `getToolAccessExtractor` return `undefined` unconditionally — the round-trip test (register, then read back) must go red.
   Commit: `feat(pi-permission-system): expose the registered extractor and formatter for a tool`.

5. `refactor:` — the new `src/authority/inherited-registrations.ts`: `resolveFromParentChain`, `NodeIdentity`, and the two inheriting lookups.
   Nothing imports it yet, so it is `refactor:` however new it is.
   Surface: new `test/authority/inherited-registrations.test.ts`.
   Mechanism and data are one small unit here, but the walk's equivalence classes are distinct, so each gets its own mutation:
   - Walk: make `resolveFromParentChain` stop after the first hop — the two-hops-up test must go red and the immediate-parent test must stay green.
   - Cycle guard: delete the visited-set insert — the cycle test must hang or overflow rather than answering `undefined`.
   - Local precedence: have `InheritingToolAccessExtractorLookup.resolve` consult the parent before the local registry — the "local hit does not consult the parent" spy assertion must go red.
   Commit: `refactor(pi-permission-system): add parent-chain resolution for fact-shaping lookups`.

6. `feat:` — wire the inheriting lookups in `index.ts`, add `PermissionServiceLifecycle.currentSessionId()`, and stamp `extractorSource` on an inherited resolution.
   The observable change.
   Surface: `test/composition-root.test.ts`, in a block named `split-provider extractor inheritance` — publish a parent service, register an extractor on it for a tool the child will call, register the child in the subagent registry, fire the child's `tool_call`, and assert the path gate saw the extracted path and the review entry carries `extractorSource: "inherited"`.
   Plus the boundary guard: an authorizer registered only in the parent, named in the child's `authorizerChain`, is **not** resolved by the child — `authorizer_chain_unregistered_link` is still recorded and the link never runs.
   Killing mutations, one per class:
   - Inheritance: pass the bare `accessExtractorRegistry` to `ToolCallGatePipeline` instead of the decorator — the inheritance assertion goes red, and every existing gate test stays green (which is what makes the new test discriminating).
   - Stamp: stamp `extractorSource` unconditionally rather than only on `inherited_extractor` — the assertion that a locally-resolved extractor leaves the field absent must go red.
   - Boundary: add the authorizer registry to the inheriting wiring — the guard test must go red.
   Commit: `feat(pi-permission-system): resolve a child's missing extractor from its parent node`.

7. `docs:` — the ADR 0012 amendment and every doc listed in Module-Level Changes, including pi-subagents' `docs/configuration.md` and the architecture-doc step mark.
   Landing the roadmap `✅` here rather than deferring it to ship time, per the package skill.
   Commit: `docs(pi-permission-system): record the fact-shaping inheritance rule (ADR 0012)`.

## Risks and Mitigations

| Risk                                                      | Mitigation                                                                                                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The clause is quoted later to justify link inheritance    | The amendment states the boundary by category, and step 6 ships a guard test that fails if the authorizer registry is ever added to the wiring                                     |
| A child's behavior depends on a node it does not control  | The extractor path is monotone, so the dependence cannot loosen a gate; the `extractorSource` stamp makes every affected decision self-describing                                  |
| The reshape of `getToolInputPath` silently drops a branch | Step 3 keeps every existing `.path` assertion and adds `.source` assertions per branch; the mutation named there fails only the new assertions                                     |
| Test fixtures constructing the old `{ get }` lookup shape | `ToolAccessExtractorLookup` has one production caller and two test fakes, both in `tool-input-path.test.ts`; step 3 migrates them in the same commit, as the type checker requires |
| The walk runs on a hot path                               | It is reached only from `getToolInputPath`'s skill/extension branch and only on a local miss; a root session's walk terminates on the first registry lookup                        |

## Open Questions

- Whether the ADR amendment should also record the declarative-manifest root cause named in Non-Goals as a future direction, or leave it to this plan.
  Deferred until the amendment is drafted in step 7; it is a paragraph either way and nothing depends on it.

[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#789]: https://github.com/gotgenes/pi-packages/issues/789
[#792]: https://github.com/gotgenes/pi-packages/issues/792
[#796]: https://github.com/gotgenes/pi-packages/issues/796
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#861]: https://github.com/gotgenes/pi-packages/issues/861
