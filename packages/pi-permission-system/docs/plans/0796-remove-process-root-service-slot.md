---
issue: 796
issue_title: "pi-permission-system: schedule the process-root service slot's removal now that its last downstream has migrated"
---

# Remove the process-root service slot

## Release Recommendation

**Release:** ship independently

Phase 14 Step 6 carries `Release: independent` in `docs/architecture/architecture.md`, and it belongs to no release batch.
The removal is a semver-major cut of its own; nothing else in the roadmap is waiting to ride it.

## Problem Statement

The package publishes its `PermissionsService` into two process-global slots.
The **keyed** slot — a `Map<sessionId, PermissionsService>` under `Symbol.for("@gotgenes/pi-permission-system:session-services")`, read by `getPermissionsService(sessionId)` — is the supported cross-extension surface under ADR 0012 decision 2.
The **root** slot — a single entry under `Symbol.for("@gotgenes/pi-permission-system:service")`, read by the deprecated `getRootPermissionsService()` — answers "the process root's service", which is the wrong question in every node but the root.

ADR 0012 decision 7 deferred the root slot's removal to "an unscheduled future major, contingent on downstream migration".
That condition fired during [#788]'s ship: `pi-permission-model-judge` 2.0.0 registers through `getPermissionsService(sessionId)` and floors its peer range at `>=27.0.0`.
The trigger's only record was an Open Question in a shipped plan plus a table row in the ADR, neither of which backlog triage sweeps — a decision with a fired trigger and no owner.

Today the slot is written on every non-child `session_start` and read by nothing in production.

## Goals

- Delete the root slot outright: `getRootPermissionsService`, `publishRootPermissionsService`, `unpublishRootPermissionsService`, the internal `readRootService()`, the `SERVICE_KEY` symbol, and the `PI_PERMISSION_SYSTEM_DEP0001` warning machinery.
- Stop writing the slot, and dissolve the [#302] child guard that existed only to protect it: `RegisteredChildDetector` and `SubagentDetection.isRegisteredChild` go, and `PermissionServiceLifecycle` loses its `detection` constructor argument.
- Record the decision as a third `#### Amendment` on ADR 0012, where the backlog sweep will find it.
- Rewrite the `PI_PERMISSION_SYSTEM_WARN0001` message, which currently names `getRootPermissionsService()` as the way to reach the old behavior.
- Land the whole cut as **one breaking change** — `feat(pi-permission-system)!:` with a `BREAKING CHANGE:` footer naming `getPermissionsService(sessionId)` as the remediation.

**This change is breaking.**
Three published exports disappear from the package's type surface, and a caller the type checker cannot reach (plain JavaScript) gets a `TypeError` rather than a warning.

## Non-Goals

- **The keyed locator's own surface.**
  `getPermissionsService` / `publishPermissionsService` / `unpublishPermissionsService`, the `sessionServices()` map, and the `WARN0001` once-guard all survive; only the `WARN0001` message text changes.
- **The pure `isRegisteredSubagentChild` function** (`src/authority/subagent-context.ts`).
  `isSubagentExecutionContext` still calls it, so it stays exported and tested.
- **Roadmap Step 7 ([#792])**, the absent-child alarm.
  It also lives in `src/service-lifecycle.ts`, but it asks a different question — a parent enumerating its registered children, not a node asking whether it is one — so it does not need `isRegisteredChild` retained speculatively.
- **A runtime tombstone.**
  No shim, no always-`undefined` export, no test asserting the symbol slot stays empty.
  Deleting the function makes any surviving caller a compile error, which is a stronger instrument than a runtime assertion.
- **Historical records.**
  `docs/plans/` and `docs/retro/` describe the state at their own time; their `RootPermissionsService` mentions are history, not current-behavior claims, and are left alone.

## Background

### Why the deprecation window is thinner than it reads

`getRootPermissionsService` did not exist before `v27.0.0` (tagged 2026-08-21).
Before that release the root reader was spelled `getPermissionsService()` with no argument, and 27.0.0 already broke that spelling: a pre-27 consumer calling it today gets `undefined` plus a once-guarded `PI_PERMISSION_SYSTEM_WARN0001`, not the root service.

So every possible caller of `getRootPermissionsService()` is a consumer that did migration work inside the last nine days and deliberately typed a symbol marked `@deprecated` at first sight, in preference to the keyed locator the same migration guide recommends.
The window is not sheltering a legacy population; it can only shelter one created after the deprecation was announced.

### The in-repo state

No package outside `pi-permission-system` references the root-slot API, and no open PR touches it.
Inside the package the accessor has no production caller — only its own definition, the `DEP0001` warning text, and the tests that pin its preserved behavior.

### Why the three questions collapse into one

Removing the reader leaves nothing that reads the slot, so the write goes with it.
Removing the write leaves the [#302] guard with nothing to guard: `service-lifecycle.ts:78` is the sole production consumer of `SubagentDetection.isRegisteredChild`, and [#302]'s real invariant — a child must not take over the parent's service — is already structural under keyed publication, where each node holds its own key.

### Constraints from AGENTS.md

- The commit must spell the breaking marker `feat(pi-permission-system)!:`, never `feat!(pi-permission-system):`.
- The `BREAKING CHANGE:` footer ships verbatim to the release-please CHANGELOG, so its named remediation must be verified against the real surface.
- Test edits here are hand edits, not a scripted `Root` sweep: a scripted substitution cannot tell a mock producer from an assertion, and this file set mixes genuine root-slot assertions with incidental handles.

## Design Overview

### What `src/service.ts` looks like afterward

```typescript
const SESSION_SERVICES_KEY = Symbol.for(
  "@gotgenes/pi-permission-system:session-services",
);

export function publishPermissionsService(
  sessionId: string,
  service: PermissionsService,
): void;
export function getPermissionsService(
  sessionId: string,
): PermissionsService | undefined;
export function unpublishPermissionsService(
  sessionId: string,
  service: PermissionsService,
): void;
```

One slot, three functions, one warning guard.
The module header, which today opens "There are two slots, because one process can host several **nodes**", becomes a single-slot description that keeps the node vocabulary — the reason for keying is node-locality, not the slot count.

### The `WARN0001` message

The guard's behavior is unchanged: a zero-argument call answers `undefined` and warns once per module copy under `type: "Warning"` (deliberately not a `DeprecationWarning`, so `--no-deprecation` cannot silence "your registration never landed").
Only the text changes.
It currently ends with a sentence directing the caller to the deprecated root reader; after this change it names `getPermissionsService(sessionId)`, the `permissions:ready` payload as the source of the id, and the docs URL — and nothing else.

### `PermissionServiceLifecycle` after the cut

```typescript
activate(ctx: ExtensionContext): void {
  this.announced = false;
  const sessionId = readSessionId(ctx);
  if (sessionId !== null) {
    publishPermissionsService(sessionId, this.service);
    this.publishedSessionId = sessionId;
  }
  this.emitReady(ctx);
}
```

`teardown()` loses its trailing `unpublishRootPermissionsService(this.service)` and keeps the identity-scoped keyed unpublish, which is what protects a superseded `/reload` generation from evicting the fresh one.

### Design-review audit

The change is a pure narrowing, so the `design-review` checklist finds no new smell to guard against:

| Check                   | Effect                                                                                                                     |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Dependency width        | `PermissionServiceLifecycle` goes 5 constructor deps → 4; `SubagentDetection` implements two role interfaces → one         |
| Parameter relay         | `detection` was relayed from `index.ts` for a single call; the relay ends                                                  |
| Test mock depth         | `test/service-lifecycle.test.ts` loses its `mockIsRegisteredChild` fake and the `detection` destructure in `makeLifecycle` |
| Repeated discriminators | None added; `isSubagentExecutionContext` keeps its single dispatch over the pure function                                  |

### Why a hard delete rather than a warning tombstone

[#794] kept a runtime guard (`WARN0001`) for exactly the population the types cannot reach, and that guard stays.
Adding a second one for a removed export would mean the export is not removed — it would answer `undefined` forever, which is a silent behavior change for precisely the consumer the deprecation window was protecting, and it would need its own removal later.
A `TypeError` at the call site, with the migration note and the surviving `WARN0001` both naming the replacement, is the honest signal.

## Module-Level Changes

### Production

| File                                  | Change                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/service.ts`                      | Delete `SERVICE_KEY`, `publishRootPermissionsService`, `getRootPermissionsService`, `unpublishRootPermissionsService`, `readRootService`, `DEPRECATED_ACCESSOR_WARNING`, `warnedDeprecatedAccessor`. Rewrite the module header (two slots → one) and `MISSING_SESSION_ID_WARNING`. Drop the `{@link getRootPermissionsService}` reference from the `PermissionsService` interface doc comment. |
| `src/service-lifecycle.ts`            | Drop the root publish block in `activate()`, the root unpublish in `teardown()`, the `RegisteredChildDetector` import and constructor parameter, and the class doc-comment bullets describing root publication.                                                                                                                                                                                |
| `src/authority/subagent-detection.ts` | Delete the `RegisteredChildDetector` interface and `SubagentDetection.isRegisteredChild()`; the class implements `SubagentDetector` alone. `SubagentDetectionDeps.registry` stays — `isSubagent` reads it.                                                                                                                                                                                     |
| `src/index.ts`                        | Drop the second argument from the `new PermissionServiceLifecycle(...)` call and rewrite the comment above it, which cites [#302]. `subagentDetection` itself stays (two other consumers).                                                                                                                                                                                                     |

### Tests

| File                                        | Change                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/service.test.ts`                      | Retarget (step 1) the three convenience-handle suites and the `returns undefined rather than another node's service` case; delete (step 4) the `globalThis accessor` suite, the `process-root accessor deprecation` suite, and the `does not populate the legacy root slot` case; rewrite the `WARN0001` message assertion. |
| `test/composition-root.test.ts`             | Retarget (step 2) 12 incidental handles and drop the redundant `seen` array in `publishes the service before emitting permissions:ready`; delete (step 4) the `multi-instance global service interplay` block and the local `SERVICE_KEY` constant with its `afterEach` clear.                                              |
| `test/service-lifecycle.test.ts`            | Delete the `vi.mock` entries for the two root functions, `makeDetection`/`mockIsRegisteredChild`, the `detection` destructure in `makeLifecycle`, and the three cases that exercise the deleted branch.                                                                                                                     |
| `test/authority/subagent-detection.test.ts` | Delete the `isRegisteredChild` describe block.                                                                                                                                                                                                                                                                              |

### Scripts and docs

| File                                                            | Change                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/verify-public-types.sh`                                | Drop the three `*RootPermissionsService` entries from the required-symbol list; drop `getRootPermissionsService` from the consumer probe's import and its `void` reference; add one inverted `grep -q` asserting the symbol is **absent** from `dist/public.d.ts`.                                                                                                                                                      |
| `docs/decisions/0012-cross-node-extension-contract.md`          | New `#### Amendment (2026-08-30, [#796])` under decision 7; the decision-7 table gains a row for the removal; the decision-2 paragraph naming the deprecated reader points at the amendment.                                                                                                                                                                                                                            |
| `docs/cross-extension-api.md`                                   | Delete the two-paragraph block describing the legacy slot and `DEP0001`.                                                                                                                                                                                                                                                                                                                                                |
| `docs/migration/0796-remove-process-root-slot.md`               | New note: what disappeared, the one-line remediation, why the window closed.                                                                                                                                                                                                                                                                                                                                            |
| `docs/migration/0794-keyed-service-locator.md`                  | The "What has not changed" bullet asserting the root slot still resolves is falsified; replace it with a forward pointer to the new note.                                                                                                                                                                                                                                                                               |
| `docs/guides/permission-frontmatter-for-subagent-extensions.md` | One sentence citing the deprecated accessor.                                                                                                                                                                                                                                                                                                                                                                            |
| `docs/architecture/architecture.md`                             | Prose at the "Cross-extension service accessor" section (the legacy-slot paragraph and the `DEP0001` sentence); module-tree entries for `service.ts` and `service-lifecycle.ts`; the `subagent-detection.ts` entry, which names `RegisteredChildDetector.isRegisteredChild`; Step 6 heading ✅ plus the Mermaid `S6` node plus a `Landed:` note; the "ADR 0012 amendments recording the root-slot decision" metric row. |
| `README.md`                                                     | Add the new migration note to the migration table.                                                                                                                                                                                                                                                                                                                                                                      |
| `.pi/skills/package-pi-permission-system/SKILL.md`              | The paragraph describing `getRootPermissionsService()`, the `readRootService()` in-package rule, and the `WARN0001` sentence's reference to the root fallback.                                                                                                                                                                                                                                                          |

## Test Impact Analysis

### What the removal enables

Nothing new — this is a deletion.
The retargeting steps do improve the surviving tests: three `test/service.test.ts` suites and roughly a dozen `test/composition-root.test.ts` assertions currently prove their point through an accessor that is not the supported surface, so afterward they exercise the API a real consumer calls.

### What becomes redundant

- `test/service.test.ts`'s `globalThis accessor` suite (6 cases) and `process-root accessor deprecation` suite (4 cases) test only the removed mechanism.
- `does not populate the legacy root slot` asserts a keyed publish leaves the root slot alone; with one slot the claim is vacuous.
- `test/composition-root.test.ts`'s `multi-instance global service interplay` block is [#302]'s round trip against the root slot.
  Its invariant survives in the adjacent `session-keyed service publication` block, whose `gives an in-process child its own service, so a sibling's link registration does not collide` and `removes only its own keyed entry when a node shuts down` cases assert the same thing structurally.
- The `seen` array in `publishes the service before emitting permissions:ready` is already shadowed by the `seenKeyed` array three lines below it.
- `test/service-lifecycle.test.ts`'s three cases covering the `isRegisteredChild` branch, and `test/authority/subagent-detection.test.ts`'s `isRegisteredChild` block.

### What must stay

- `test/service.test.ts`'s `session-keyed accessor` suite and the `keyed accessor called without a session id` suite — the surviving surface and its `WARN0001` guard.
- `test/composition-root.test.ts`'s `session-keyed service publication` and `ready emitted after service publication` blocks, which pin ADR 0012 decisions 2 and 3.
- `test/authority/subagent-detection.test.ts`'s `isSubagent` coverage and all of `test/authority/subagent-context.test.ts`, which exercises the surviving pure functions.

## Invariants at Risk

Each entry names the test that pins it.
All were opened rather than grepped; none of them mocks the layer it pins.

| Invariant                                                                                                                                       | Source                        | Pinned by                                                                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A node's service resolves under its own session id, and an in-process child gets its own, not the parent's                                      | ADR 0012 decision 2, [#699]   | `gives an in-process child its own service, so a sibling's link registration does not collide` (`test/composition-root.test.ts`) — real factory through `makeFakePi`, real `session_start` |
| A child's shutdown removes only its own entry; the parent's survives                                                                            | [#302], restated structurally | `removes only its own keyed entry when a node shuts down` (same block)                                                                                                                     |
| `permissions:ready` fires at `session_start` and once more at the first `before_agent_start`, with the payload's `sessionId` already resolvable | ADR 0012 decision 3, [#787]   | `re-emits permissions:ready once at the first before_agent_start` — untouched; its sibling case in the same describe is edited in step 2, so the block must stay green throughout          |
| A zero-argument locator call answers `undefined` and warns once under `WARN0001`, never another node's service                                  | [#794]                        | `keyed accessor called without a session id` (3 cases in `test/service.test.ts`) — one of them is retargeted in step 1, the message assertion is rewritten in step 4                       |
| Teardown unpublishes the node's service                                                                                                         | ADR 0012 decision 2           | `unpublishes the service and unsubscribes the lifecycle on shutdown` (retargeted in step 2) and `removes only its own keyed entry when a node shuts down`                                  |

Quantitative baselines, measured at planning time on this worktree:

| Measure                                                                         | Baseline          | Predicted |
| ------------------------------------------------------------------------------- | ----------------- | --------- |
| `grep -c '#### Amendment' docs/decisions/0012-cross-node-extension-contract.md` | 2                 | 3         |
| `pnpm fallow dead-code --workspace @gotgenes/pi-permission-system`              | 0 issues          | 0 issues  |
| `grep -rc RootPermissionsService` across `src/`                                 | 14 across 2 files | 0         |

The dead-code prediction is the one that could surprise: `isRegisteredSubagentChild` keeps a consumer (`isSubagentExecutionContext`), and `SubagentDetectionDeps.registry` keeps one (`isSubagent`), so removing `RegisteredChildDetector` must not orphan either.

## TDD Order

The first two steps are the Tidy-First assessor's accepted preparatory refactorings.
They land as their own commits, leave the tree green, and shrink step 4's diff to a pure excision — which is what turns "did the sweep silently drop coverage?"
from a question a reviewer must re-derive per site into a visible property of the diff.

1. **`test:` retarget `test/service.test.ts`'s incidental root-slot handles onto the keyed locator.**
   Prepares: without this, step 4 must simultaneously delete a root-only suite and rewrite three suites that merely borrowed the accessor as a handle, in the same commit.
   Rewrite `service round-trip through the global slot`, `registerToolInputFormatter delegation`, and `registerToolAccessExtractor delegation` onto `publishPermissionsService(sessionId, …)` / `getPermissionsService(sessionId)!` with a fixed local session-id constant and a keyed `afterEach`; rename the first block's heading to name the keyed locator.
   Also rewrite the `returns undefined rather than another node's service` case, whose setup publishes to the root slot to build its scenario — the assessor found this one; it is not in the issue body's enumeration.
   Green with no production change.
   Killing mutation: make `publishPermissionsService` store under a constant key instead of `sessionId`.
   Every retargeted assertion must go red; a site still reading the root slot would stay green, which is exactly the incompleteness this step exists to exclude.
   Commit: `test(pi-permission-system): retarget service tests onto the keyed service locator`

2. **`test:` retarget `test/composition-root.test.ts`'s incidental root-slot handles.**
   Prepares: the same friction at 12 call sites spread across ~900 lines, interleaved with the two genuinely root-only assertions.
   Retarget the handles in `shutdown teardown chain`, `service and gate share one formatter registry`, `service and gate share one access extractor registry`, `service and chain share one authorizer registry` (2 sites), `single source of truth for session state`, `service path queries evaluate the supplied path (#503)`, `project trust gates project-scoped config (#644)` (2 sites), and `session approvals do not leak across same-cwd session switches` (2 sites).
   Each sits in a context that already holds its session id from `makeBaseCtx`/`makeChildCtx`/`makeUiCtx`.
   Drop the redundant `seen` array in `publishes the service before emitting permissions:ready`, whose `seenKeyed` sibling already asserts the ordering contract.
   Do this by hand, one site at a time — the session ids differ per test and a blind substitution would pair the wrong id with the wrong service instance.
   Leave `multi-instance global service interplay` untouched; it is step 4's excision.
   Green with no production change.
   Killing mutation: the same constant-key mutation of `publishPermissionsService`; every retargeted assertion must go red.
   Commit: `test(pi-permission-system): retarget composition-root tests onto the keyed service locator`

3. **`docs:` amend ADR 0012 decision 7.**
   Add `#### Amendment (2026-08-30, [#796])` recording: the trigger fired at [#788]'s ship; the window's population can only have been created after the deprecation, because the name did not exist before `v27.0.0`; the removal is a hard delete, the write stops with it, and the [#302] guard dissolves because keyed publication already carries its invariant; classification **major**.
   Add the removal row to the decision-7 classification table and point the decision-2 paragraph at the amendment.
   Verify: `grep -c '#### Amendment'` reports 3; `pnpm exec rumdl check` passes.
   This is the roadmap step's named deliverable, and it lands before the code it authorizes.
   Commit: `docs(pi-permission-system): amend ADR 0012 to remove the process-root service slot`

4. **`feat!:` remove the process-root service slot.**
   Red: rewrite the `warns once, naming the ready payload and the root reader` assertion in `test/service.test.ts` to require the `WARN0001` text to name `getPermissionsService(sessionId)` and to contain no `getRootPermissionsService` mention, and rename the case accordingly.
   It fails against the current message.
   Green: the production deletions above, plus the new `MISSING_SESSION_ID_WARNING` text.
   Then delete the redundant tests named in Test Impact Analysis, update `scripts/verify-public-types.sh` (symbol list, probe, new inverted grep), and drop the local `SERVICE_KEY` constant and its `afterEach` clear from `test/composition-root.test.ts`.
   Killing mutations, one per class:
   - Message class — leave `MISSING_SESSION_ID_WARNING` unchanged; the rewritten assertion goes red.
   - Removal-completeness class — re-add `publishRootPermissionsService(this.service)` to `activate()`; it does not compile, because the function no longer exists.
     The type checker is the instrument here, which is why no runtime tombstone test is planned.
   - Published-surface class — revert only the `scripts/verify-public-types.sh` probe edit; the type-check against the packed tarball fails on the missing export.

   Verify: `pnpm run check`, `pnpm run lint` (unpiped), `pnpm -r run test`, `pnpm fallow dead-code --workspace @gotgenes/pi-permission-system` (must stay at 0), and `bash packages/pi-permission-system/scripts/verify-public-types.sh`.
   Commit: `feat(pi-permission-system)!: remove the deprecated process-root service accessor`, with a `BREAKING CHANGE:` footer naming `getPermissionsService(sessionId)` and the session id's source on the `permissions:ready` payload.

5. **`docs:` retire the slot from the user-facing docs and mark the roadmap step.**
   Write `docs/migration/0796-remove-process-root-slot.md`; replace the falsified "What has not changed" bullet in `docs/migration/0794-keyed-service-locator.md` with a pointer to it; add the row to `README.md`'s migration table; delete the legacy-slot block from `docs/cross-extension-api.md`; fix the one sentence in the frontmatter guide.
   Update `docs/architecture/architecture.md`: the cross-extension-accessor prose, the three module-tree entries, Step 6's heading ✅ and Mermaid `S6` node, a `Landed:` note, and the ADR-amendments metric row.
   Update the `package-pi-permission-system` skill's three affected sentences.
   Verify: `pnpm exec rumdl check` on every edited file, and `grep -rn RootPermissionsService packages/pi-permission-system README.md .pi/skills` returns hits only under `docs/plans/` and `docs/retro/`.
   Commit: `docs(pi-permission-system): retire the process-root service slot from the docs`

## Risks and Mitigations

| Risk                                                                                                       | Mitigation                                                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An unseen external consumer calls `getRootPermissionsService()` and gets a `TypeError`                     | The name has existed for nine days and was `@deprecated` for all of them; the migration note, the `BREAKING CHANGE:` footer, and the surviving `WARN0001` all name the one-line replacement |
| A mechanical `Root` sweep across the test files drops coverage of surviving behavior                       | Steps 1 and 2 retarget every incidental handle by hand first, so step 4's test diff is deletion only; the constant-key killing mutation proves each retarget actually reads the keyed slot  |
| Removing `RegisteredChildDetector` orphans `isRegisteredSubagentChild` or `SubagentDetectionDeps.registry` | Both keep a consumer through `isSubagentExecutionContext` / `isSubagent`; `pnpm fallow dead-code` gates it at 0 in step 4                                                                   |
| The `WARN0001` message is rewritten but its assertion still passes on a substring                          | The rewritten assertion adds a negative clause (no `getRootPermissionsService` mention), which the old text fails                                                                           |
| Roadmap Step 7 ([#792]) later wants a registered-child predicate                                           | It asks the inverse question and reads the registry directly; if it needs a predicate, adding one then is cheaper than carrying dead code now                                               |
| The architecture doc's Step 6 mark is deferred past implementation                                         | It is step 5 of this plan, not a ship-time commit, per the package skill                                                                                                                    |

## Open Questions

None.
The three questions the roadmap step named — remove or keep the window, stop writing the slot, and what becomes of the [#302] guard — were settled at the planning clarification gate as remove / stop / dissolve.
No follow-up issues are filed; nothing in this plan defers work.

[#302]: https://github.com/gotgenes/pi-packages/issues/302
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#792]: https://github.com/gotgenes/pi-packages/issues/792
[#794]: https://github.com/gotgenes/pi-packages/issues/794
