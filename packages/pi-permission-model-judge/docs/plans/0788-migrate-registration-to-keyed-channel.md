---
issue: 788
issue_title: "pi-permission-model-judge: migrate registration to the ADR 0012 keyed channel"
---

# Migrate registration to the ADR 0012 keyed channel

## Release Recommendation

**Release:** ship independently

`@gotgenes/pi-permission-model-judge` has no `docs/architecture/` roadmap, so this issue belongs to no release batch, and `@gotgenes/pi-permission-system` has no open improvement phase carrying a `Release:` tag for it either.
It is a self-contained change in one package — a breaking one — so it cuts its own major release at ship time.

## Problem Statement

`@gotgenes/pi-permission-system` `27.0.0` published the keyed service locator: `getPermissionsService` now requires the session id of the node whose service you want, and a zero-arg call answers `undefined` with a once-guarded `PI_PERMISSION_SYSTEM_WARN0001` warning.
This package's `src/extension.ts` still calls the zero-arg form, so against `27.0.0` it resolves no service and the `model-judge` link is **never registered** — silently, apart from that one warning.

The registration itself is also the workaround [ADR 0012] decision 3 exists to kill.
`tryRegister()` is called from both `session_start` and `permissions:ready` behind a `dispose` idempotency guard, because either ordering was possible before the ready latch, and a nine-line header comment exists to explain why.
With the latch — `permissions:ready` re-emitted at the node's first `before_agent_start`, which runs after every extension's `session_start` — the ready handler alone is a sufficient registration site.

[ADR 0012] decision 7 names this package the contract's migration test case and its proof: if the migrated registration is not smaller than the workaround it replaces, the contract has failed its own test.

## Goals

- Registration collapses to config loading in `session_start` plus one idempotent `permissions:ready` handler: keyed lookup via the event's `sessionId`, `registerAuthorizer`, a `dispose` guard.
- The dual-path registration, its explanatory header comment, and the ordering caveat are deleted.
- The `@gotgenes/pi-permission-system` peer range narrows to `>=27.0.0`, so an incompatible pairing is a package-manager warning at install time.
- A node whose service cannot be resolved while a config is loaded reports it once per session, rather than registering nothing in silence.
- The registration path is measurably smaller than the workaround it replaces.

This change is **breaking**.
A user on `@gotgenes/pi-permission-system` `20.10.0`–`26.x` who upgrades this package sees the `model-judge` link stop registering: a pre-`27` ready payload carries no `sessionId`, so the keyed lookup has no key.
The commit is `fix(pi-permission-model-judge)!:` with a `BREAKING CHANGE:` footer naming the remediation — upgrade `@gotgenes/pi-permission-system` to `27.0.0` or later.

## Non-Goals

- **A root-accessor compatibility shim.**
  Falling back to `getRootPermissionsService()` when the payload carries no `sessionId` would keep `>=20.10.0` working and hold the release to a minor.
  It was considered and rejected at the clarification gate: it resurrects the dual-path branch this issue exists to delete, and on `26.x` the fallback has to call the zero-arg `getPermissionsService()` — which on `27.x` is the `WARN0001` path.
  Node-locality is the point of the migration; a root fallback is the wrong-node bug by another name.
- **Any change to the reviewer.**
  `typo-reviewer.ts`, `model-review.ts`, `typo-patterns.ts`, `config-loader.ts`, `config-schema.ts`, `schemas/`, and `config/config.example.json` are untouched.
  What the link decides, and how it logs, is unchanged; only where it registers changes.
- **Any change to `@gotgenes/pi-permission-system` source.**
  Both `pkg:` labels are on the issue because the contract spans the two packages, but the code that changes is this package's alone (plus the root lockfile and, if the release-age gate bites, `pnpm-workspace.yaml`), so this is a single-package plan.
- **Disposing the `permissions:ready` subscription at `session_shutdown`.**
  `pi.events.on` returns an unsubscribe this package has never used; the extension factory is re-invoked per session generation, so the stale subscription dies with its closure.
  Left as an Open Question.
- **Editing [ADR 0012] to mark decision 7 implemented.**
  The [#787] plan settled this for the same record: it is an accepted decision, not a status board.
- **`docs/configuration.md`.**
  It documents the chain policy and the log entries, and says nothing about registration timing or the service accessor.

## Background

### The consumer today

`packages/pi-permission-model-judge/src/extension.ts` (106 lines, measured) holds four pieces of registration machinery (~31 lines, measured):

- A header comment whose second paragraph (nine lines) explains the dual path and the ordering ambiguity.
- A `sessionStarted` flag, assigned in three places (lines 61, 86, 102).
- `tryRegister()` (lines 66–79), guarding on `dispose || !sessionStarted || !config`, then calling the zero-arg `getPermissionsService()`.
- Two call sites: one at the end of the `session_start` handler (line 92), one in the `permissions:ready` handler (lines 95–97).

The published `1.1.4` declares `"@gotgenes/pi-permission-system": ">=20.10.0"` as a peer dependency and pins `20.10.0` as a devDependency.
`linkWorkspacePackages: false` in `pnpm-workspace.yaml` means this package consumes the sibling from the npm registry, not through a workspace symlink — so the migration compiles against the published tarball, and the devDependency bump is what makes the new API visible.

### What `27.0.0` provides

Verified against the published tarball's `dist/public.d.ts` (`pnpm view @gotgenes/pi-permission-system@27.0.0 dist.tarball`):

```typescript
declare function getPermissionsService(sessionId: string): PermissionsService | undefined;
declare function getRootPermissionsService(): PermissionsService | undefined;
declare function publishPermissionsService(sessionId: string, service: PermissionsService): void;
declare function unpublishPermissionsService(sessionId: string, service: PermissionsService): void;

interface PermissionsReadyEvent {
  sessionId: string | null;
  adjudicatesLocally: boolean;
}
```

`PermissionsReadyEvent` is exported as a type from the package root, alongside `PERMISSIONS_READY_CHANNEL`.
`PermissionServiceLifecycle` publishes only when the host exposed a session id, and emits the ready payload with `sessionId: readSessionId(ctx)` — so `sessionId: null` and "no keyed service published" are the same condition.

The canonical consumer shape is `packages/pi-permission-system/docs/migration/0794-keyed-service-locator.md` and `docs/cross-extension-api.md` §`permissions:ready`.
Both spell the handler with a dynamic `import()` because they address a consumer that may not depend on the package; this package has it as a peer dependency and already imports statically, so the static import stays.

### Constraints from AGENTS.md

- `@gotgenes/pi-permission-system` `27.0.0` published at `2026-08-21T21:19Z`, so a local `pnpm add` inside the 24-hour window trips `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`.
  `minimumReleaseAgeExclude` **is** honored during resolution (it is the lockfile verification pass it does not reach), and `trustLockfile: true` covers CI's frozen install.
- `!` goes after the scope: `fix(pi-permission-model-judge)!:`, never `fix!(...)`.
- A `BREAKING CHANGE:` footer's remediation must name a real surface — here, a published version of a real package.

## Design Overview

### The migrated wiring

`session_start` does only what its name says — load config, capture the model registry, report config issues.
The `permissions:ready` handler is the whole registration:

```typescript
pi.events.on(PERMISSIONS_READY_CHANNEL, (data) => {
  // Ready fires at least once per session and may repeat (ADR 0012 decision 3),
  // so a second emission must be a no-op. A config-less session registers
  // nothing and says nothing: that is the operator declining the link.
  if (dispose || !config) {
    return;
  }
  const sessionId = readySessionId(data);
  const service = sessionId === null ? undefined : getPermissionsService(sessionId);
  if (!service) {
    warnUnresolvedService();
    return;
  }
  dispose = service.registerAuthorizer(
    LINK_NAME,
    createTypoReviewer({ getConfig: () => config, getRegistry: () => registry, complete }),
  );
});
```

The bus hands a handler only the payload, typed `unknown`, so the session id is read through a module-private narrowing:

```typescript
/** The payload's session id, or `null` for any shape that cannot key the locator. */
function readySessionId(data: unknown): string | null {
  const sessionId = (data as Partial<PermissionsReadyEvent> | undefined)?.sessionId;
  return typeof sessionId === "string" ? sessionId : null;
}
```

Reading the id from the payload — rather than from `ctx.sessionManager.getSessionId()` captured at `session_start` — is deliberate.
The payload's `sessionId` is by construction the key the emitting node published under, including the `null` case where it published nothing; a separately captured id is a second source of truth that can disagree with the publisher.

`adjudicatesLocally` is deliberately **not** read.
Under [ADR 0012] decision 4 a link registered on a relaying node is accepted and observed, never refused, so branching on it would reimpose the placement ceremony the contract dissolved.

### Node-locality, concretely

Each node's `ResourceLoader` builds its own `pi.events` bus, so this extension's instance in a given node only ever hears that node's ready emissions.
Keying the lookup on the payload's `sessionId` therefore resolves *this* node's service: an in-process subagent child registers into the child's own registry — the one its own chain reads — instead of reaching the parent's and throwing the [#699] duplicate-registration error.

### Ordering, under the latch

| Emission                                  | When                                    | `config` loaded? | Result                                      |
| ----------------------------------------- | --------------------------------------- | ---------------- | ------------------------------------------- |
| 1 (pps `session_start`)                   | before this extension's `session_start` | no               | early return, silent                        |
| 1 (pps `session_start`)                   | after this extension's `session_start`  | yes              | registers                                   |
| 2 (the latch, first `before_agent_start`) | always after every `session_start`      | yes              | registers, or no-ops on the `dispose` guard |

Neither ordering needs a second attempt from this package's `session_start`, which is exactly what makes the dual path deletable.

### The vacancy warning

Emitted through the existing `warn()` helper (which prefixes `[pi-permission-model-judge]`), guarded by a factory-closure `warnedUnresolvedService` flag so the latch's second emission does not repeat it.
It fires only on the path where the extension *would* have registered — a config is loaded and the guard has not latched — so "no config file" stays silent, as today.

The message names the cause and the fix: the node published no keyed service, which is what an installed `@gotgenes/pi-permission-system` older than `27.0.0` looks like from here, and the remedy is upgrading it.
The flag is reset in `session_shutdown` alongside `config`, `registry`, and `dispose`, so "once per session" holds by construction rather than by relying on the extension loader re-invoking the factory per session generation.

### Size, the contract's own test

| Measure                                         | Before         | After            |
| ----------------------------------------------- | -------------- | ---------------- |
| `src/extension.ts` total lines                  | 106 (measured) | ~100 (estimated) |
| Registration machinery                          | ~31 (measured) | ~26 (estimated)  |
| Vacancy warning (new capability, counted apart) | 0              | ~10 (estimated)  |

The migration's own line count is the one that answers [ADR 0012] decision 7; the vacancy warning is capability chosen at this issue's clarification gate, not part of the workaround being replaced.
TDD step 1 records the measured before/after numbers.

## Module-Level Changes

### `packages/pi-permission-model-judge/src/extension.ts`

- Rewrite the header comment: drop the nine-line dual-path/ordering paragraph, replace it with a short note that the ready event fires at least once per session and may repeat, so the handler is a sufficient registration site needing only an idempotence guard.
- Delete `sessionStarted` (all three sites) and `tryRegister()` (all of it, plus both call sites).
- Change the import from `getPermissionsService` alone to `getPermissionsService` plus the `PermissionsReadyEvent` type; `PERMISSIONS_READY_CHANNEL` stays.
- Add module-private `readySessionId(data: unknown): string | null`.
- Add the `warnedUnresolvedService` flag and a `warnUnresolvedService()` that warns once through the existing `warn()` helper.
- Move the registration body into the `permissions:ready` handler.
- `session_start` keeps `loadConfig` / `registry` capture / issue reporting and loses its `tryRegister()` call.
- `session_shutdown` keeps disposing and clearing `config` / `registry` / `dispose`, drops `sessionStarted`, and resets `warnedUnresolvedService`.

### `packages/pi-permission-model-judge/test/extension.test.ts`

- `publishPermissionsService` / `unpublishPermissionsService` take `(sessionId, service)`; add a `SESSION_ID` constant and thread it through every call, including the `afterEach` cleanup.
- Ready emissions carry a real payload: `{ sessionId: SESSION_ID, adjudicatesLocally: true }` instead of `{}`.
- Delete `"registers when the service is ready before this session_start (pps-first order)"` — it asserts the dual path.
- Replace it with a latch-ordering test: a ready emission *before* `session_start` registers nothing, and the second (latch) emission registers.
- Keep and retitle `"registers only once across both triggers"` as a latch-idempotence test: two ready emissions, one registration.
- Add a node-locality test: publish two services under two session ids, emit ready with one of them, assert only that service received `registerAuthorizer`.
- Add a vacancy test: ready with `sessionId: null` (and a loaded config) registers nothing and warns exactly once across two emissions; a config-less session warns not at all.
- `"registers nothing when no service is published"` stays, with a payload-carried session id nothing published under.
- The authorize-callback test and the `describe("global config scope")` block keep their assertions; only their publish/emit lines change.

### `packages/pi-permission-model-judge/package.json`

- `peerDependencies["@gotgenes/pi-permission-system"]`: `">=20.10.0"` → `">=27.0.0"`.
- `devDependencies["@gotgenes/pi-permission-system"]`: `"20.10.0"` → `"27.0.0"`.

### `pnpm-lock.yaml`

- Re-resolved for the devDependency bump.

### `pnpm-workspace.yaml`

- Only if `pnpm add` fails the 24-hour gate: add `'@gotgenes/pi-permission-system@27.0.0'` to `minimumReleaseAgeExclude`.
  Leave the entry in place afterwards, matching the existing `fallow@3.2.0` entries — it is version-pinned, self-documenting, and inert once the window passes.

### `packages/pi-permission-model-judge/README.md`

- The Install section's requirements sentence (line 57) names the peer dependency without a version; add that it requires `@gotgenes/pi-permission-system` `27.0.0` or later, and why (the keyed service locator).

### `.pi/skills/package-pi-permission-system/SKILL.md`

- Line 187 reads "The still-unimplemented half of that contract is the judge migration (#788) and the docs consolidation (#789)."
  [#789] has already landed and [#788] lands here, so rewrite the sentence to state the contract is fully implemented.

### Checked and not changed

- `packages/pi-permission-model-judge/docs/configuration.md` — no registration-timing or accessor prose (grepped for `permissions:ready`, `session_start`, `getPermissionsService`).
- `packages/pi-permission-model-judge/schemas/`, `config/config.example.json` — no config surface changes.
- `packages/pi-permission-system/**` — consumer-side migration only.
- `package.json`'s `files` allowlist — no new ship targets, so no `pnpm pack` re-verification is needed.

## Test Impact Analysis

**Newly possible.**
Node-locality was untestable before: with a single process-root slot there was no second service to register into by mistake.
The two-services-one-key test is the migration's actual proof, and it is the assertion that would fail if someone later reintroduced a root fallback.

**Newly redundant.**
`"registers when the service is ready before this session_start (pps-first order)"` exists only to pin the dual path.
Its replacement asserts the opposite guarantee — that an early ready emission is a no-op and the latch emission carries the registration — so the behavior is still covered, by a test that describes the contract instead of the workaround.

**Must stay as-is.**
`"registers an authorize callback that denies a matched typo path"` and `describe("global config scope")` exercise the reviewer and the config seam, not registration; they change only where they publish and what they emit, never what they assert.
The global-scope test is [#732]'s regression pin and must stay content-discriminating (asserting on the loaded `instructions` reaching `complete`).

## Invariants at risk

- **[#732] — the global config scope honors `PI_CODING_AGENT_DIR`.**
  Pinned by `describe("global config scope")` in `test/extension.test.ts`, which drives the production `loadConfig` seam through `session_start`.
  This plan rewrites the surrounding wiring, so the test's `publishPermissionsService` / ready-emission lines change; its assertion must not.
- **The link registers exactly once per session.**
  Pinned today by `"registers only once across both triggers"`; after the migration the same guarantee is pinned by the latch-idempotence test.
  This matters more, not less, after the change: the latch guarantees a repeat emission every session, where `/reload` used to be the only repeat.
- **No `PI_PERMISSION_SYSTEM_WARN0001` or `DEP0001` in this package's own runs.**
  Both warnings are the symptom of an unmigrated consumer.
  Verification greps the suite output for both codes; a hit means the migration left a zero-arg or root-slot call behind.
- **Registration is smaller than the workaround** ([ADR 0012] decision 7's proof).
  Measured with `wc -l` on `src/extension.ts` before and after, plus the machinery count from Design Overview; recorded in the step-1 commit body.

## TDD Order

1. **Red → Green → Commit: keyed registration.**
   Bump the dependency first — `pnpm --filter @gotgenes/pi-permission-model-judge add -D @gotgenes/pi-permission-system@27.0.0` — and edit `peerDependencies` to `">=27.0.0"` in the same package.json pass.
   If the add fails with `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`, add the version-pinned `minimumReleaseAgeExclude` entry from Module-Level Changes and re-run.
   Then rewrite `test/extension.test.ts` per Module-Level Changes and run the suite: the red is behavioral, not just a type error — vitest strips types, so the unchanged `tryRegister()` calls the zero-arg accessor against `27.0.0`, gets `undefined`, and every registration assertion fails.
   Confirm red, then migrate `src/extension.ts` (minus the vacancy warning, which is cycle 2) and confirm green with `pnpm --filter @gotgenes/pi-permission-model-judge run check` as well as the suite — `tsc` is red in the interim and must be green here.
   Record `wc -l src/extension.ts` before and after.

   Commit: `fix(pi-permission-model-judge)!: register the model-judge link on the keyed ready channel`

   Body states that registration now happens only from `permissions:ready`, keyed by the payload's `sessionId`, and cites the measured line counts.
   Footer: a `BREAKING CHANGE:` paragraph naming the dropped support for `@gotgenes/pi-permission-system` below `27.0.0` and the remediation (upgrade to `27.0.0` or later), then `Refs #788`.

2. **Red → Green → Commit: the vacancy warning.**
   Add the vacancy tests: a ready payload with `sessionId: null` and a loaded config registers nothing and warns once across two emissions; a config-less session does not warn.
   Spy on `console.warn`.
   Confirm red, then add `warnedUnresolvedService` / `warnUnresolvedService()` and its `session_shutdown` reset.

   Commit: `feat(pi-permission-model-judge): warn once when the node's permission service cannot be resolved`

   `Refs #788`.

3. **Commit: documentation.**
   The README requirements sentence and the `package-pi-permission-system` skill line.

   Commit: `docs(pi-permission-model-judge): require pi-permission-system 27 for the keyed channel`

   `Refs #788`.

4. **Verify.**
   `pnpm --filter @gotgenes/pi-permission-model-judge run check`, then `pnpm -r run test` (redirected to a file, not piped), `pnpm run lint`, and `pnpm fallow dead-code` — the last because `tryRegister` and `sessionStarted` are being removed.
   Grep the test output for `PI_PERMISSION_SYSTEM_WARN0001` and `PI_PERMISSION_SYSTEM_DEP0001`; both must be absent.

## Risks and Mitigations

| Risk                                                                                                      | Mitigation                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The 24-hour `minimumReleaseAge` gate blocks the local `pnpm add` (`27.0.0` published `2026-08-21T21:19Z`) | The version-pinned `minimumReleaseAgeExclude` entry, which is honored at resolution; `trustLockfile: true` already covers CI's frozen install                                                                |
| A user on `@gotgenes/pi-permission-system` `20.10.0`–`26.x` silently loses the link after upgrading       | Three signals: the narrowed peer range (install-time), the `BREAKING CHANGE:` footer and CHANGELOG entry, and the new once-per-session runtime warning                                                       |
| The rewritten tests keep the old assertions but stop exercising the production seam                       | The `describe("global config scope")` block constructs the extension with only `complete` injected, so the real `loadConfig` still runs; its content-discriminating assertion on `systemPrompt` is unchanged |
| A future edit reintroduces a root-slot fallback "for compatibility"                                       | The node-locality test (two services, one key) fails on any fallback that resolves the wrong node                                                                                                            |
| The ready payload narrowing accepts a malformed shape                                                     | `readySessionId` returns `null` for anything that is not a string, and a `null` never reaches the locator — so a malformed payload takes the vacancy path, not the `WARN0001` path                           |

## Open Questions

- Should the `permissions:ready` subscription be disposed at `session_shutdown`?
  `pi.events.on` returns an unsubscribe this package has never used, and the factory closure is rebuilt per session generation, so nothing leaks today.
  Deferred until a concrete symptom appears; not filed.
- Should the vacancy warning distinguish "the payload carried no session id" (an old `@gotgenes/pi-permission-system`) from "the keyed lookup missed" (the extension is loaded but published nothing)?
  One message covering both is enough while the first cause is the only one seen in practice; split it if a report cannot be diagnosed from it.

[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#732]: https://github.com/gotgenes/pi-packages/issues/732
[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#789]: https://github.com/gotgenes/pi-packages/issues/789
