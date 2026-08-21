---
issue: 794
issue_title: "pi-permission-system: reclaim getPermissionsService for the keyed locator before it publishes"
---

# Reclaim `getPermissionsService` for the keyed locator

## Release Recommendation

**Release:** ship independently

`pi-permission-system` has no open improvement phase, so no roadmap step carries a `Release:` tag for this issue.
The release is nonetheless load-bearing: the `*ForSession` names exist only on unreleased `main`, so this rename must land **before** the open release-please PR [#790] merges, or the suffixed spelling escapes into a published tarball and the rename stops being free.
Shipping independently is also what unblocks [#788]: the judge consumes `@gotgenes/pi-permission-system` from the npm registry (`linkWorkspacePackages: false`, devDependency pinned at `20.10.0`), so it cannot compile against the reclaimed name until that name is published.
The order is therefore: this issue lands → [#790] merges as `27.0.0` → [#788] migrates against the published major.

## Problem Statement

The keyed locator introduced by [#699] shipped into the working tree as `getPermissionsServiceForSession(sessionId)`.
The suffix exists only because the good name was occupied by the zero-arg accessor it replaces, and [ADR 0012] decision 2 already said the keyed locator is "`getPermissionsService(sessionId)` in spirit; exact spelling is an implementation detail".

The `*ForSession` family has never been published — `26.3.1` exports only the zero-arg `getPermissionsService()` — so reclaiming the base name costs nothing externally, and a major is being cut in this window anyway.
If the name is not taken now, the ecosystem adopts `getPermissionsServiceForSession`, and reclaiming the base name later costs a second migration or never happens at all.

Two changes in this release window are breaking, and both belong in this issue's commit footer, since the [#699] and [#787] commits are already on `main` and cannot be retyped:

1. This rename — `getPermissionsService()` is published and its signature changes to require an argument.
2. The ready-channel cadence from [#787] — [ADR 0012] decision 7 classified the latch as minor on the grounds that an unguarded consumer would see "bus-caught stderr noise rather than breakage", and that estimate was refuted in practice: `pi-permission-model-judge` throws `An authorizer is already registered for 'model-judge'` on every in-process subagent start.

## Goals

- Rename the three keyed exports onto the base names, with a **required** `sessionId` first argument.
- Rename the three process-root exports to name the root explicitly, preserving the deprecated reader's window under an honest name.
- Emit a once-guarded `process.emitWarning` when `getPermissionsService` is called without a session id, so a pre-migration JS consumer does not fail silently.
- Carry both breaking changes into the release: two `BREAKING CHANGE:` footers on this issue's implementation commit.
- Amend [ADR 0012] decision 7's classification table in place, and record the migration in a shipped guide.

This change is **breaking**: it renames published exports and changes a published signature.
Suggested commit types are `feat(pi-permission-system)!:` for the rename and `feat(pi-permission-system):` / `docs(pi-permission-system):` for the follow-on cycles.

## Non-Goals

- Migrating `pi-permission-model-judge` onto the keyed channel — that is [#788], and it is blocked on this release publishing.
- Removing the process-root slot or its deprecated reader; removal stays deferred to a later major ([ADR 0012] decision 7).
- Migrating the in-package tests' *convenience* root-slot reads (`test/composition-root.test.ts`, the round-trip suites in `test/service.test.ts`) onto the keyed locator.
  Those reads are a shorthand for "the service this node published", not assertions about the root slot; converting them would require threading each test's session id and is a separate tidy.
  This change keeps them a pure rename so the diff stays reviewable.
- Any change to the `PermissionsService` interface, the `permissions:ready` payload shape, or the latch's behavior.
- Rewriting `docs/plans/` and `docs/retro/` files that mention the old spelling — they are dated records of what was decided then.

## Background

`src/service.ts` is the module `package.json`'s `exports` map points at, so every function it exports is public API.
It holds two process-global slots:

- The **root slot** — `Symbol.for("@gotgenes/pi-permission-system:service")`, a single entry written by every node that is not a registered in-process subagent child (the [#302] guard), read today by the zero-arg `getPermissionsService()`, which emits a once-guarded `DeprecationWarning` (`PI_PERMISSION_SYSTEM_DEP0001`).
- The **keyed map** — `Symbol.for("@gotgenes/pi-permission-system:session-services")`, session id → that node's service, written by every node under its own key ([ADR 0012] decision 2), read today by `getPermissionsServiceForSession(sessionId)`.

`PermissionServiceLifecycle` (`src/service-lifecycle.ts`) is the only in-package caller of the publish/unpublish functions, and the internal `readRootService()` — not the deprecated accessor — is what `unpublishPermissionsService` compares identities with, so the package never warns the host about a call the host did not make.

Constraints from `AGENTS.md` and the package skill that bear on this change:

- An export that exists only on unreleased `main` renames for free; verify against the published tag rather than `.pi/npm/node_modules/`.
  Verified: `git show pi-permission-system-v26.3.1:packages/pi-permission-system/src/service.ts` carries only `publishPermissionsService` / `getPermissionsService` / `unpublishPermissionsService`.
- A remediation named in a `BREAKING CHANGE:` footer must exist in the real surface — both remediations here are functions this change itself creates, and the ready-handler guard is the one `docs/cross-extension-api.md` already documents.
- Do not put `Closes #794` in a commit message; `/ship-issue` posts the close comment.

`pi-permission-model-judge` is **not** a touch point.
`linkWorkspacePackages: false` plus its `@gotgenes/pi-permission-system: 20.10.0` devDependency means both its source and its tests compile against the registry copy, and at runtime its own copy's zero-arg reader reads the root slot this change keeps writing.

## Design Overview

### The renamed surface

| Now (unreleased)                                            | After                                             |
| ----------------------------------------------------------- | ------------------------------------------------- |
| `getPermissionsServiceForSession(sessionId)`                | `getPermissionsService(sessionId)`                |
| `publishPermissionsServiceForSession(sessionId, service)`   | `publishPermissionsService(sessionId, service)`   |
| `unpublishPermissionsServiceForSession(sessionId, service)` | `unpublishPermissionsService(sessionId, service)` |
| `getPermissionsService()` (deprecated, process root)        | `getRootPermissionsService()` (deprecated)        |
| `publishPermissionsService(service)` (process root)         | `publishRootPermissionsService(service)`          |
| `unpublishPermissionsService(service)` (process root)       | `unpublishRootPermissionsService(service)`        |

```typescript
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

export function publishRootPermissionsService(service: PermissionsService): void;
/** @deprecated Use {@link getPermissionsService} with the ready payload's `sessionId`. */
export function getRootPermissionsService(): PermissionsService | undefined;
export function unpublishRootPermissionsService(service: PermissionsService): void;
```

The `sessionId` argument is **required**, not optional and not a second overload.
`PermissionsReadyEvent.sessionId` is `string | null`, and any shape where a `null` can reach the locator and fall through to the root slot reintroduces the wrong-node bug [ADR 0012] exists to eliminate.

All six stay exported.
The root publish/unpublish pair has an out-of-tree caller shape that is already exercised in this repo: `packages/pi-permission-model-judge/test/extension.test.ts` publishes a fake service into the slot to drive its own suite.
A consumer's test double is a legitimate reason for a publisher to be public, so this stays a pure rename rather than a surface reduction.

### The missing-argument warning

A TypeScript consumer that calls `getPermissionsService()` after upgrading gets a compile error.
A JavaScript consumer gets `sessionServices().get(undefined)` → `undefined`, which is the safest available failure — but a *silent* one, and the shape that hits it is not hypothetical.
The published `pi-permission-model-judge@1.1.4` declares `peerDependencies: { "@gotgenes/pi-permission-system": ">=20.10.0" }` and guards with `if (!service) return;`, so an install whose judge copy resolves to `27.0.0` loses the `model-judge` chain link with nothing on stderr.
That peer range is already published and cannot be retroactively narrowed, so a runtime warning is the only lever that reaches those installs.

```typescript
export function getPermissionsService(
  sessionId: string,
): PermissionsService | undefined {
  if (typeof sessionId !== "string") {
    warnMissingSessionId();
    return undefined;
  }
  return sessionServices().get(sessionId);
}
```

The guard tests `typeof sessionId !== "string"` — the JS no-argument and explicit-`null` cases — and does not police an empty string, which is a value question the map answers correctly by missing.
The warning is once-guarded per module copy, mirroring the existing deprecation guard, and carries its own code and type:

- `code: "PI_PERMISSION_SYSTEM_WARN0001"`, `type: "Warning"` — deliberately **not** `DeprecationWarning`/`DEP0001`.
  A consumer running `--no-deprecation` has opted out of deprecation noise, not out of being told that a chain link silently vanished, and a distinct code keeps the two populations separable in a log.
- The message names the missing argument, the ready payload as its source, and `getRootPermissionsService()` as the honest name for the old behavior.

`getRootPermissionsService()` keeps `PI_PERMISSION_SYSTEM_DEP0001` — it is the same deprecation, just honestly named — with its message updated to name `getPermissionsService(sessionId)` as the replacement.

### Call-site shape

The consumer's call site is unchanged in structure and one token shorter:

```typescript
pi.events.on(PERMISSIONS_READY_CHANNEL, (event) => {
  const { sessionId } = event as PermissionsReadyEvent;
  if (dispose || sessionId === null) return;
  dispose = getPermissionsService(sessionId)?.registerAuthorizer(name, authorize);
});
```

The in-package lifecycle call site is likewise a rename only — `PermissionServiceLifecycle` already holds the session id and the service it publishes, so no collaborator, parameter, or ordering changes.

### The ADR 0012 amendment

Decision 7's classification table is corrected in place, following the precedent already set in `docs/decisions/0007-model-judge-authorizer-chain-adr.md` ("Amended 2026-08-14 with §7 …"), with `status: accepted` unchanged:

- A dated amendment line in the Status section.
- The latch row reclassified minor → **major**, and a new row for this rename.
- A short paragraph recording *why* the estimate was wrong: the ADR predicted stderr noise for an unguarded consumer, and the observed failure is a throw on every in-process subagent start that prevents the consumer's own `dispose` guard from ever latching, so every subsequent emission retries.
- Decision 2's "exact spelling is an implementation detail" parenthetical gains the settled spelling.

The Context narrative is left alone — it describes the 26.x world accurately, and an ADR is a dated record, not a mirror of `main`.

## Module-Level Changes

| File                                                            | Change                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/service.ts`                                                | Rename all six exports per the table above; add the missing-argument guard, its once-flag, and its message constant; update the module header (which describes the two slots by accessor name), the `PermissionsService` interface doc comment's `{@link}` targets, and the `DEPRECATED_ACCESSOR_WARNING` text. `readRootService()` and both `Symbol.for()` keys are unchanged. |
| `src/service-lifecycle.ts`                                      | Rename the four imported call sites (keyed publish/unpublish, root publish/unpublish). No behavior change.                                                                                                                                                                                                                                                                      |
| `src/permission-events.ts`                                      | Three doc comments naming `getPermissionsServiceForSession` (the `PermissionsReadyEvent` header, the `sessionId` field, and the emit helper's contract note).                                                                                                                                                                                                                   |
| `scripts/verify-public-types.sh`                                | Replace the three `*ForSession` entries in the grepped symbol list with `getRootPermissionsService` / `publishRootPermissionsService` / `unpublishRootPermissionsService`; update the consumer probe to call `getPermissionsService("session-id")` so the external type-check pins the keyed signature rather than merely referencing the name.                                 |
| `test/service.test.ts`                                          | Rename throughout (79 mentions); the root-slot suites move to `*Root*`, the deprecation suite asserts the new DEP0001 message text, and a new suite covers the missing-argument warning.                                                                                                                                                                                        |
| `test/service-lifecycle.test.ts`                                | Rename the `vi.mock("#src/service", …)` factory keys and the hoisted mock names (18 mentions) — a missed key removes the export from the mock rather than failing type-check.                                                                                                                                                                                                   |
| `test/composition-root.test.ts`                                 | Rename the imports and 28 call sites; the keyed reads keep their meaning, the root-slot reads (including the [#302] child-guard test) become `getRootPermissionsService()`.                                                                                                                                                                                                     |
| `docs/cross-extension-api.md`                                   | Quick Start, How It Works, End-to-end wiring, Graceful Degradation, and the Ready Event table + example (12 mentions); the deprecated-accessor paragraph names `getRootPermissionsService()`; Graceful Degradation gains the missing-argument warning.                                                                                                                          |
| `docs/architecture/architecture.md`                             | The "Cross-extension service accessor" section (the keyed-locator sentence and the deprecated-slot sentence) and the `service.ts` module-tree entry if it names an accessor.                                                                                                                                                                                                    |
| `docs/configuration.md`                                         | The authorizer-chain registration sentence.                                                                                                                                                                                                                                                                                                                                     |
| `docs/guides/permission-frontmatter-for-subagent-extensions.md` | The worked example (import, call, and the `undefined` note) plus the zero-arg sentence (4 mentions).                                                                                                                                                                                                                                                                            |
| `README.md`                                                     | The `registerAuthorizer` sentence, and a new row in the docs index table for the migration guide.                                                                                                                                                                                                                                                                               |
| `docs/decisions/0012-cross-node-extension-contract.md`          | The in-place amendment described above.                                                                                                                                                                                                                                                                                                                                         |
| `docs/migration/0794-keyed-service-locator.md`                  | **New.** Both breaking changes in one guide: the renamed surface with a before/after table, the missing-argument warning and what it means for an unmigrated consumer, and the ready-cadence idempotence requirement with the guarded-handler example.                                                                                                                          |
| `.pi/skills/package-pi-permission-system/SKILL.md`              | The keyed-locator sentence and the deprecated-accessor sentence in the "Registrations are node-local" paragraph.                                                                                                                                                                                                                                                                |

Grep coverage for the file list: `ForSession` repo-wide (excluding `docs/plans/`, `docs/retro/`, and the unrelated `isForwardedPermissionRequestForSession` / `getPermissionForwardingLocationForSession` / `makeHandlerForSession` symbols) and `getPermissionsService|publishPermissionsService|unpublishPermissionsService` repo-wide, both run at planning time; `CHANGELOG.md` matches are release-please's and are not edited; `dist/` is gitignored and regenerated by `prepack`.

## Test Impact Analysis

1. **New tests the change enables.**
   The missing-argument guard is a new behavior with three assertions: a no-argument call returns `undefined`, it warns exactly once per module copy under `PI_PERMISSION_SYSTEM_WARN0001`, and a valid keyed call does not warn.
   The existing `freshServiceModule()` helper in `test/service.test.ts` (`vi.resetModules()` + dynamic import) is exactly the fixture this needs, since the flag is module-scoped.
2. **Tests that become redundant.**
   None — this is a rename plus one additive guard.
3. **Tests that must stay as-is (renamed only).**
   The [#302] child-guard round trip and the "superseded `/reload` generation" identity compare-and-delete cases genuinely exercise the root slot and stay on `getRootPermissionsService()` / `*RootPermissionsService`.
   The keyed-map cases from [#699] (per-node isolation, overwrite, identity-scoped delete) stay on the reclaimed base names.
4. **The external-consumer check is part of the suite for this change.**
   `pnpm --filter @gotgenes/pi-permission-system run verify:public-types` packs the real tarball and type-checks a throwaway consumer against it; with the probe updated to call `getPermissionsService("session-id")`, it fails if the published signature is not the keyed one.

## Invariants at risk

| Invariant                                                                                                               | Source         | Pinned by                                                                                                        |
| ----------------------------------------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------- |
| Every node publishes under its own key; an in-process child never clobbers the root slot                                | [#699], [#302] | `composition-root.test.ts` — "multi-instance global service interplay"; the keyed-map cases in `service.test.ts` |
| `permissions:ready` is emitted exactly twice per session generation (four across a reload)                              | [#787]         | `composition-root.test.ts` emission-count tests                                                                  |
| The deprecated root reader warns exactly once per module copy, and the package's own publish/unpublish path never warns | [#699]         | `service.test.ts` — "zero-arg accessor deprecation" suite                                                        |
| Unpublish is an identity compare-and-delete on both slots, so a superseded generation cannot wipe a fresh one           | [#699]         | `service.test.ts` root and keyed unpublish cases                                                                 |

Each is pinned by a test that survives this change as a rename, so a green suite is evidence rather than argument.
No quantitative invariant (byte-identical prefix, token budget, latency) is in play.

## TDD Order

1. **Reclaim the names.**
   Red: rename the exports in `src/service.ts` and update `test/service.test.ts`, `test/service-lifecycle.test.ts`, and `test/composition-root.test.ts` to the new spellings; the suite is red until `src/service-lifecycle.ts` follows.
   Green: rename the four call sites in `src/service-lifecycle.ts`, the doc comments in `src/permission-events.ts`, and the symbol list plus probe in `scripts/verify-public-types.sh`.
   Because this removes exports, every importing module and its tests break at the type level in this commit, so `src/`, `test/`, and the script land together.
   Verify: `pnpm run check`, `pnpm run lint`, `pnpm -r run test`, and `pnpm --filter @gotgenes/pi-permission-system run verify:public-types`.
   Commit: `feat(pi-permission-system)!: reclaim getPermissionsService for the keyed locator`, carrying **two** `BREAKING CHANGE:` footers — one for the rename (naming `getPermissionsService(sessionId)` and `getRootPermissionsService()` as the remediations) and one for the [#787] ready cadence (naming the idempotent-handler guard as the remediation).
2. **Warn on a missing session id.**
   Red: `test/service.test.ts` — a no-argument call (cast through `unknown` to reach the JS shape) returns `undefined` and emits one `PI_PERMISSION_SYSTEM_WARN0001` warning; a second call does not warn again; a valid keyed call never warns.
   Green: add the guard, the once-flag, and the message constant to `getPermissionsService`.
   Commit: `feat(pi-permission-system): warn when getPermissionsService is called without a session id`.
3. **Documentation and the decision record.**
   Update `docs/cross-extension-api.md`, `docs/architecture/architecture.md`, `docs/configuration.md`, `docs/guides/permission-frontmatter-for-subagent-extensions.md`, `README.md` (prose + docs-index row), and `.pi/skills/package-pi-permission-system/SKILL.md`; amend [ADR 0012]; add `docs/migration/0794-keyed-service-locator.md`.
   Verify: `pnpm exec rumdl check` on the touched markdown, then the repo-wide `ForSession` grep returns only the unrelated symbols and the historical `docs/plans/` + `docs/retro/` records.
   Commit: `docs(pi-permission-system): document the reclaimed keyed locator and the ready cadence`.

## Risks and Mitigations

| Risk                                                                                                                                                   | Mitigation                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The rename lands after [#790] merges, publishing the suffixed names                                                                                    | `Release: ship independently` with this issue's ship step merging [#790] immediately after; the sequencing is stated at the top of this plan so `/ship-issue` reads it first                                   |
| A stale `*ForSession` mention survives in prose, where no compiler will catch it                                                                       | Step 3 ends with the repo-wide grep as an explicit verification criterion, with the three unrelated `*ForSession` symbols and the historical plan/retro records named as the expected residue                  |
| `test/service-lifecycle.test.ts` mocks `#src/service` by object key, so a missed key silently removes an export from the mock instead of failing `tsc` | The mock keys are called out as their own row in Module-Level Changes; the lifecycle suite exercises every mocked function, so a missed key fails loudly at run time                                           |
| An unmigrated published consumer loses its chain link silently after upgrading                                                                         | The `PI_PERMISSION_SYSTEM_WARN0001` guard (cycle 2), the migration guide, and a comment on [#788] recommending its peer range be narrowed to `>=27.0.0` so the incompatible pairing is at least a peer warning |
| Two `BREAKING CHANGE:` footers in one commit are parsed as one note                                                                                    | `conventional-commits-parser` collects footers into a `notes` array, so each is listed separately; the release-please PR body is checked at ship time to confirm both appear under "⚠ BREAKING CHANGES"        |
| [#788] is blocked longer than expected, leaving the repo's own dogfooded judge on the deprecated path                                                  | Not a regression: the workspace judge resolves its own `20.10.0` copy, whose zero-arg reader reads the root slot this change keeps writing                                                                     |

## Open Questions

- Should the process-root slot's removal be scheduled now that the honest names exist?
  Deferred: [ADR 0012] decision 7 makes removal contingent on downstream migration, and [#788] is the only known downstream.
- Should the judge's `peerDependencies` range be narrowed to `>=27.0.0` in [#788]?
  Recorded as a comment on [#788] rather than a new issue — it is a one-line addition to work already scoped there.

[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[#302]: https://github.com/gotgenes/pi-packages/issues/302
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#790]: https://github.com/gotgenes/pi-packages/pull/790
