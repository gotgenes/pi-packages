---
issue: 914
issue_title: "pi-permission-system: heartbeat and forwarded-file writes are lost on Windows when the atomic rename hits EPERM"
---

# Retry the forwarding filesystem write when a transient file lock blocks it

## Release Recommendation

**Release:** ship independently

The architecture roadmap lists this issue under Phase 15's open-issue sweep as out of scope for the roadmap — "platform robustness in the same layer as [#907], sharing no step's mechanism" — so it belongs to no release batch.
It lands as a `fix:` for `pi-permission-system` alone and cuts its own patch release.

## Problem Statement

On Windows 11 a forwarded-permission write is intermittently lost, reported as a side observation on [#907]:

```text
permission_forwarding.error — EPERM: operation not permitted, rename
…\permission-forwarding\serving\<id>.json.<pid>.<ts>.tmp -> …\<id>.json
```

`writeJsonFileAtomic` (`src/authority/forwarding-io.ts`) writes a `<file>.<pid>.<ts>.tmp` sibling and `renameSync`s it into place.
On Windows that rename is not the POSIX atomic replace: an antivirus scanner, the search indexer, or any other process holding a transient handle on either path fails it with `EPERM`, and the helper deletes the temp file and rethrows — the write is simply gone.

Three callers share the helper, and tracing each one changes the severity ranking the issue assumes.
The constants are `PERMISSION_FORWARDING_POLL_INTERVAL_MS` 250 ms, `SERVING_HEARTBEAT_REFRESH_MS` 1 s, `SERVING_HEARTBEAT_STALE_MS` 5 s, `PERMISSION_FORWARDING_SERVING_GRACE_MS` 2 s, and a `forwardingTimeoutMs` default of ten minutes.

| Caller                                                                    | What a lost write actually costs                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ParentAuthorizer`'s request write (`approval-escalator.ts`)              | An immediate hard denial of the child's tool call ("The forwarded permission request could not be written"), with no retry and no self-healing. The sharpest case, and the one the issue does not name.                                                                                                                                               |
| `ServingHeartbeatStore.markServing` (`forwarding-liveness.ts`)            | Mostly self-healing. The previous record is left untouched on disk and still reads `alive` for 5 s, and the failure leaves `published` unset so the next tick rewrites. A child reads `absent` only on the **first** publish or immediately after a session-id migration, and must then see `absent` on 8 consecutive polls (2 s) before it abandons. |
| `ForwardedRequestServer`'s response write (`forwarded-request-server.ts`) | Not a ten-minute stall: the request file is left undeleted and `processInbox` keeps no seen-set, so the next tick re-serves it — silently when recorded authority resolves it, as a duplicate dialog for the human when it escalates.                                                                                                                 |

So the issue's own causal claim is too strong in one direction and too weak in another.
A dropped heartbeat write reads as `servingState: absent` only in the two windows where no prior record exists, and only under a lock sustained across 8 poll ticks; the reporter described the failures as intermittent.
Meanwhile the request write — which the issue mentions only as "the same helper writes the forwarded request and response files" — turns a single intermittent `EPERM` into a refused tool call with no recovery path at all.

## Goals

- A transient `EPERM`/`EBUSY`/`EACCES` on the atomic rename no longer loses a forwarded-permission write, when the lock clears inside a bounded budget.
- The same bounded retry covers `mkdirSync` in `ensureDirectoryExists`, whose failure denies a child's forwarded ask outright in exactly the same way.
- The retry mechanism is its own unit-testable module, with no dependency on a logger, a clock, or a platform.
- A write that only succeeded after retrying is visible to a Windows user diagnosing the condition, without adding noise to the permission-decision record.
- Both properties the issue names are preserved: no temp file is left behind on a terminal failure, and there is no fallback to a non-atomic `writeFileSync` onto the destination path.

Not breaking.
The retry is additive: a write that succeeds today still succeeds on its first attempt with no sleep, no log entry, and no observable difference.

## Non-Goals

- **The temp `writeFileSync` is not retried.**
  The report names the rename, and `test/authority/approval-escalator.test.ts`'s `reports an unwritable request as unavailable` shows the other shape of that failure — a permanently write-denied directory, where retrying would buy nothing and only delay the verdict.
- **`safeDeleteFile`'s `unlinkSync` is not retried.**
  A failed delete is the duplicate-dialog path described above, which already recovers on its own; it is a separate defect class if it ever proves real.
- **`ConfigStore.save` (`src/config/config-store.ts`) is not touched**, although it uses the same tmp→rename shape for the `/permission-system` toggles.
  That write is one-shot, user-initiated, and reports its failure through an error toast the user can retry by hand, and covering it would need a shared home for the helper outside `authority/` — a directory-vocabulary table edit for a path nobody has reported.
- **No platform gate.**
  The errno set is the gate.
  `src/` may not read `process.platform` (an ESLint `no-restricted-syntax` guard scoped to this package exempts `index.ts` alone), and threading a `PathFlavor` into a free function to answer a question the errno already answers is not worth the width.
- **No change to the liveness thresholds, the heartbeat throttle, or the grace window.**
  The retry makes a lost write rarer; it does not re-tune what a child concludes from a missing record.
- **No change to `ParentAuthorizer`'s or `ForwardedRequestServer`'s own error handling.**
  Both keep their existing catch blocks; they inherit the retry through the shared helper, which is what the issue asks for.
- [#735] scenario 2 and [#722] (a parent that does not drain its inbox) are unrelated and stay open.

## Background

The three write sites and their failure handling:

- `writeJsonFileAtomic(logger, filePath, value)` — `src/authority/forwarding-io.ts`.
  Writes the temp with `OWNER_ONLY_FILE_MODE`, then `renameSync`s it.
  `rename` is what carries the mode onto the destination, which is why there is no `chmod` anywhere near it.
  On any throw it deletes the temp and rethrows.
- `ensureDirectoryExists(logger, path, description)` — same file.
  `mkdirSync(path, { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE })`, returning `false` and logging a `permission_forwarding.error` on failure rather than throwing.
  Called three times per `ensurePermissionForwardingLocation`, once per `markServing`, and once per `processInbox` tick that finds requests.
- `ServingHeartbeatStore.markServing` — `src/authority/forwarding-liveness.ts`.
  Throttled to `SERVING_HEARTBEAT_REFRESH_MS`, advancing `published` only on success, and documented as never throwing: "it runs from a timer, and a filesystem failure must degrade to the pre-existing timeout rather than break the poll loop."

Prior art, checked because the issue asks for it:

- **Pi core has no convention to follow.**
  Every `renameSync` in `@earendil-works/pi-coding-agent` (`migrations.ts`, `utils/tools-manager.ts`, `utils/windows-self-update.ts`) is a bare call, and the package contains no `EPERM`/`EBUSY`/`EACCES` handling at all.
- **`graceful-fs`** patches `fs.rename` on win32 only, retrying `EACCES`/`EPERM`/`EBUSY` with a +10 ms backoff capped at 100 ms, for up to 60 s — asynchronously, and only while the destination does **not** exist (it gives up the moment a `stat` of the destination succeeds).
  That last clause must not be copied here: the heartbeat record and the response file are both legitimate overwrites of an existing path.
- **Node's own `fs.rmSync`** documents `maxRetries` and `retryDelay`, retrying `EBUSY`/`EMFILE`/`ENFILE`/`ENOTEMPTY`/`EPERM` "with a linear backoff wait of `retryDelay` milliseconds longer on each try", default `retryDelay` 100 ms. It is a synchronous API, so its retry necessarily blocks — which is the precedent for blocking here.

Constraints from `AGENTS.md` and the package skill that bear on this change:

- A new module goes in its named directory when it is written; `authority/` owns forwarding.
- `src/` must not read `process.platform`.
- Module-scoped state persists across same-cwd session switches, so any module-level value must be safe to share between sessions.
- Within the package, a same-directory import is `./`, a cross-directory one is `#src/`; both halves are lint-enforced.

## Design Overview

One new module owns the retry decision; the two call sites own what to do with the outcome.

```typescript
// src/authority/transient-fs-retry.ts

/** Tuning seams, injected so a unit test asserts the backoff without sleeping. */
export interface TransientFsRetryOptions {
  delaysMs?: readonly number[];
  sleep?: (ms: number) => void;
}

/** How an operation that eventually succeeded got there. */
export interface TransientFsRetryRecord {
  /** Attempts made, counting the first — `1` when it succeeded outright. */
  attempts: number;
  /** The transient errno that forced the retries, or `null` when there were none. */
  code: string | null;
}

export function retryOnTransientFsError(
  operation: () => void,
  options?: TransientFsRetryOptions,
): TransientFsRetryRecord;
```

Module-private, because none of it is a caller's decision: the errno set `EPERM`/`EBUSY`/`EACCES`, the default delay sequence `[10, 20, 30]`, and the blocking sleep.
An error whose `code` is outside the set is rethrown immediately, with no sleep — a permanent `ENOTDIR` or `ENOENT` must stay as fast as it is today.
An exhausted budget rethrows the last error, so every caller's existing catch block keeps working unchanged.

The sleep is synchronous because all three callers are, and one of them (`markServing`) satisfies a `void` seam that a timer drives.
`Atomics.wait` on a never-notified `Int32Array` is the standard blocking sleep and is permitted on Node's main thread (measured: a 35 ms wait returned `"timed-out"` after 40 ms on Node 26.8.2).
The buffer is a module-level constant — safe under the module-state rule above precisely because nothing ever writes to it.

Consumer call sites, which is where the Tell-Don't-Ask question lives:

```typescript
// writeJsonFileAtomic — the temp write stays outside the retry
writeFileSync(tempPath, JSON.stringify(value), {
  encoding: "utf-8",
  mode: OWNER_ONLY_FILE_MODE,
});
recordFsRetry(logger, "rename", filePath, retryOnTransientFsError(() => {
  renameSync(tempPath, filePath);
}));

// ensureDirectoryExists
const record = retryOnTransientFsError(() => {
  mkdirSync(path, { recursive: true, mode: OWNER_ONLY_DIRECTORY_MODE });
});
recordFsRetry(logger, "mkdir", path, record);
return true;
```

Returning a record rather than taking an `onRetry` callback keeps the retry module free of any logging dependency, and keeps "what gets recorded" in the file that already owns the forwarding log vocabulary.
`recordFsRetry` is module-private in `forwarding-io.ts`, returns early when `attempts === 1`, and writes one **debug-stream** entry:

```jsonc
{ "event": "permission_forwarding.fs_retried", "operation": "rename", "path": "…", "attempts": 3, "code": "EPERM" }
```

Debug-only because a recovered write decided nothing, so it does not belong in the permission-decision record; and because `debugLog` is off by default, the entry costs nothing until a Windows user turns it on to diagnose exactly this.
The event is named `fs_retried` rather than the `write_retried` spelling the design gate used, because the same entry now reports a `mkdir`, which is not a write.

Predicted effects.
Every figure is **computed** from the delay sequence, not measured — the only measured number in this plan is the `Atomics.wait` probe above.

| Scenario                                                                              | Today                                                                            | After                                                                           |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Write succeeds first try (every POSIX run, the overwhelming majority of Windows runs) | one `renameSync`                                                                 | one `renameSync`, no sleep, no log entry                                        |
| Lock clears within 60 ms                                                              | write lost; heartbeat re-publishes next tick, request write denies the tool call | write lands; one debug entry recording the attempt count and errno              |
| Lock outlives 60 ms                                                                   | write lost immediately                                                           | write lost after ≤60 ms of blocking, with today's `permission_forwarding.error` |
| Permanent non-transient failure (`ENOTDIR`, `ENOENT`)                                 | fails immediately                                                                | fails immediately, unchanged                                                    |
| Permanent `EACCES` directory (POSIX `chmod 0500`) reached through `mkdirSync`         | fails immediately                                                                | fails after ≤60 ms per call                                                     |

The 60 ms budget is sized against the two windows it has to fit inside.
It is well under one 250 ms poll tick, so a retrying heartbeat write cannot push the serving node's timer into the next tick, and it is far under the 2 s grace a forwarding child waits out — a parent retrying its own writes can never be the reason a child fast-fails.
Blocking the event loop is the cost, and 60 ms is the answer to "how long may a UI host stall to save a write".

## Module-Level Changes

| File                                            | Change                                                                                                                                                                                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/authority/transient-fs-retry.ts`           | **New.** `retryOnTransientFsError`, `TransientFsRetryOptions`, `TransientFsRetryRecord`; module-private errno set, default delay sequence, and `Atomics.wait` sleep.                                                                                       |
| `src/authority/forwarding-io.ts`                | `writeJsonFileAtomic` wraps its `renameSync`; `ensureDirectoryExists` wraps its `mkdirSync`; new module-private `recordFsRetry` emitting `permission_forwarding.fs_retried` on the debug stream. Imports `./transient-fs-retry` (same directory, so `./`). |
| `test/authority/transient-fs-retry.test.ts`     | **New.** Unit tests over a fake operation and a fake sleep.                                                                                                                                                                                                |
| `test/authority/forwarding-io-fs-retry.test.ts` | **New.** Wiring and invariant tests with `node:fs` mocked through `importActual` + an overridden `renameSync`/`mkdirSync`.                                                                                                                                 |
| `docs/architecture/architecture.md`             | Module-tree entry for `transient-fs-retry.ts`; amend the `forwarding-io.ts` entry's atomic-write clause.                                                                                                                                                   |
| `docs/troubleshooting.md`                       | One `Common Issues` row for the Windows symptom.                                                                                                                                                                                                           |

Predicted **unchanged** despite sitting in the blast radius — each a falsifiable claim, with the claim it rests on:

| File                                                                                                                       | Why it should not need an edit                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/authority/forwarding-io.test.ts`                                                                                     | Its `writeJsonFileAtomic` and `ensureDirectoryExists` tests assert steady-state mode bits and tolerant reads under ordinary permissions, so every call succeeds on its first attempt and no debug entry fires.                                                                                                                                                                                      |
| `test/authority/approval-escalator.test.ts`                                                                                | `reports an unwritable request as unavailable` fails at the un-retried temp `writeFileSync` (`EACCES` creating a file in a `0o500` directory), so it never reaches the rename. `reports unusable forwarding directories as unavailable` writes a **file** where the forwarding root must be a directory, so `mkdirSync` throws `ENOTDIR` — outside the retry set. Both stay first-attempt failures. |
| `test/authority/forwarding-liveness.test.ts`                                                                               | `ServingHeartbeatStore` publishes and reads under ordinary permissions; `published`, the throttle, and the stale/dead-pid classification are untouched.                                                                                                                                                                                                                                             |
| `test/authority/forwarded-request-server.test.ts`                                                                          | Response writes run under ordinary permissions.                                                                                                                                                                                                                                                                                                                                                     |
| `src/authority/approval-escalator.ts`, `src/authority/forwarded-request-server.ts`, `src/authority/forwarding-liveness.ts` | They inherit the retry through the shared helper; no signature, catch block, or log entry of theirs changes.                                                                                                                                                                                                                                                                                        |
| `src/config/config-store.ts`                                                                                               | Out of scope per Non-Goals.                                                                                                                                                                                                                                                                                                                                                                         |

Symbol and doc greps run while writing this list:

- No export is removed or renamed, so there is no stale-symbol sweep to do.
- `rg -n "permission_forwarding\." docs/ README.md` matches only two archived plans and one retro — no user-facing doc enumerates the forwarding log events, so the new event name has no index to update.
- `.pi/skills/package-*/SKILL.md` names neither `forwarding-io` nor `writeJsonFileAtomic`, so the skill's forwarding section has no mechanism description to refresh.
- `docs/subagent-integration.md` describes the heartbeat record and the upgrade-ordering requirement, not how it is written; the retry does not change what a child concludes from an absent record, so the doc's claims stay true.
- `package.json`'s `files` allowlist already ships `src` recursively and `docs/*.md`, so neither new module nor the troubleshooting row needs an allowlist edit.

## Test Impact Analysis

The extraction enables tests that are impractical today: the current code can only be driven to an `EPERM` rename by a real filesystem, and no POSIX CI host produces one on demand.
With the decision in its own module, the retry policy is testable over a fake operation, and the wiring is testable with a single overridden `fs` export.

New unit tests (`test/authority/transient-fs-retry.test.ts`), all with an injected `sleep` so nothing waits:

| Test                                            | Claim                                                                  |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| succeeds on the first attempt                   | `{ attempts: 1, code: null }`, and `sleep` is never called             |
| retries an `EPERM` then succeeds                | `{ attempts: 2, code: "EPERM" }`, `sleep` called once with `10`        |
| retries `EBUSY` and `EACCES` the same way       | the errno set is the gate, not `EPERM` alone                           |
| rethrows a non-transient error immediately      | an `ENOENT` operation throws, `sleep` never called, no further attempt |
| exhausts the budget and rethrows the last error | four attempts, `sleep` called with `10`, `20`, `30` in that order      |
| rethrows a thrown value with no `code`          | a bare `Error` or a string is not transient                            |

New wiring tests (`test/authority/forwarding-io-fs-retry.test.ts`), mocking `node:fs` through `importActual` and overriding one export at a time, so the real `writeFileSync`/`statSync`/`existsSync` still run against a real temp directory.
These accept the real `[10, 20, 30]` sleeps — at most 60 ms per test.

| Test                                                  | Claim                                                                                                               |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| a rename failing `EPERM` twice still lands the file   | destination contains the JSON, mode `0o600`, no `.tmp` sibling left                                                 |
| the recovered write logs one debug entry              | `permission_forwarding.fs_retried` with `operation: "rename"`, `attempts: 3`, `code: "EPERM"`, and no `review` call |
| a clean write logs nothing                            | neither `debug` nor `review` is called with `fs_retried`                                                            |
| a permanently `EPERM` rename rethrows                 | throws, the temp is deleted, and the destination does **not** exist — no non-atomic fallback                        |
| `mkdirSync` failing `EPERM` once still returns `true` | plus one `fs_retried` entry with `operation: "mkdir"`                                                               |
| a permanently `EPERM` `mkdirSync` returns `false`     | it logs `permission_forwarding.error` and does not throw                                                            |

No existing test becomes redundant.
Two must stay exactly as they are, because they pin the invariants below: `writes a forwarded request owner-only` and `creates a forwarding directory owner-only` in `test/authority/forwarding-io.test.ts`.

## Invariants at risk

| Invariant                                                                                                                                 | Constituency                                                                                                                                          | Pinned by                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rename` carries `OWNER_ONLY_FILE_MODE` onto the destination — the helper never `chmod`s and never writes through to the destination path | any local user who could otherwise read another user's forwarded tool input                                                                           | `writes a forwarded request owner-only` (existing); extended by the new `a permanently EPERM rename rethrows` test, which asserts the destination stays absent |
| A forwarding directory is created `0o700`                                                                                                 | same                                                                                                                                                  | `creates a forwarding directory owner-only` (existing)                                                                                                         |
| No temp file is left behind on a terminal failure                                                                                         | `tryRemoveDirectoryIfEmpty`, which would otherwise see a session root that is permanently non-empty and never clean it up ([#398]'s cleanup ordering) | currently pinned by nothing — the new `a permanently EPERM rename rethrows` test adds it                                                                       |
| `ensureDirectoryExists` returns `false` rather than throwing                                                                              | `markServing`, documented as never throwing because a timer drives it                                                                                 | new `a permanently EPERM mkdirSync returns false` test                                                                                                         |
| `ServingHeartbeatStore` advances its throttle only on a successful publish, so a failed write is retried on the next tick                 | a forwarding child reading the heartbeat                                                                                                              | unchanged code; the existing `forwarding-liveness.test.ts` publish tests still cover it                                                                        |
| A child's request-write failure still ends as `confirmationUnavailable` with the same `denialReason`                                      | the requesting agent, which reads that sentence                                                                                                       | `reports an unwritable request as unavailable` (existing, unchanged — the temp write is not retried)                                                           |

No quantitative invariant is at risk: the retry adds no work to a successful write beyond one function call and one `try`/`catch`.

## TDD Order

The Tidy-First assessor read the two target functions and both new test files' neighbors and recommended **no** preparatory commits: each function already isolates the single `fs` call inside its own `try`/`catch`, so threading the retry is a same-size in-place edit rather than an extraction, and both new test files are greenfield with no legacy structure to migrate.

### 1. `refactor(pi-permission-system): add a bounded retry for transient filesystem errors`

Create `src/authority/transient-fs-retry.ts` and `test/authority/transient-fs-retry.test.ts` with the six unit tests above.
Nothing imports the module yet, so the commit is `refactor:` however new the code is.

Killing mutations:

- Drop the loop — return after the first attempt regardless.
  Must turn the three retry tests and the exhaustion test red, and must leave `succeeds on the first attempt` and `rethrows a non-transient error immediately` green (one mutation, one equivalence class).
- Treat every thrown value as transient — delete the errno-set check.
  Must turn `rethrows a non-transient error immediately` and `rethrows a thrown value with no code` red, and leave the `EPERM`/`EBUSY`/`EACCES` tests green.
- Sleep before the first attempt instead of between attempts.
  Must turn `succeeds on the first attempt` red on the `sleep` assertion, and turn `exhausts the budget` red on the delay sequence.

### 2. `fix(pi-permission-system): keep a forwarded write when a file lock blocks the atomic rename`

Wrap `renameSync` in `writeJsonFileAtomic`, add the module-private `recordFsRetry`, and add the four rename-facing tests in `test/authority/forwarding-io-fs-retry.test.ts`.
The whole lifecycle of the new debug entry — when it is emitted, what it carries, and when it is suppressed — lands in this one step, so no later step can contradict it.

Killing mutations:

- Replace `retryOnTransientFsError(() => renameSync(...))` with a bare `renameSync(...)`.
  Must turn `a rename failing EPERM twice still lands the file` and `the recovered write logs one debug entry` red.
- Make `recordFsRetry` log unconditionally (drop the `attempts === 1` early return).
  Must turn `a clean write logs nothing` red.
- Route `recordFsRetry` through `logPermissionForwardingWarning` instead of `logger?.debug`.
  Must turn `the recovered write logs one debug entry` red on its "no `review` call" assertion.
- Delete the `safeDeleteFile` call from the catch block.
  Must turn `a permanently EPERM rename rethrows` red on the no-`.tmp`-sibling assertion.

### 3. `fix(pi-permission-system): retry forwarding directory creation blocked by a file lock`

Wrap `mkdirSync` in `ensureDirectoryExists` and add the two `mkdir`-facing tests.
Kept separate from step 2 because it is a different call site with a different failure contract (`false`, not a throw), and the two are independently reviewable.

Killing mutations:

- Replace the wrapped call with a bare `mkdirSync(...)`.
  Must turn `mkdirSync failing EPERM once still returns true` red.
- Return `true` from the catch block.
  Must turn `a permanently EPERM mkdirSync returns false` red.

Run the full package suite here rather than the two new files, since `ensureDirectoryExists` is called from three modules.

### 4. `docs(pi-permission-system): record the transient filesystem retry`

Add the `transient-fs-retry.ts` module-tree entry, amend `forwarding-io.ts`'s atomic-write clause, and add the troubleshooting row.
The module-tree entries describe current behavior; the one issue citation they carry is the active constraint — the rename must not be replaced by a write onto the destination, and the retry must not adopt `graceful-fs`'s destination-exists give-up clause, because the heartbeat and response files are legitimate overwrites.

Verification: `pnpm exec rumdl check packages/pi-permission-system/docs/architecture/architecture.md packages/pi-permission-system/docs/troubleshooting.md`, plus `pnpm run check`, `pnpm run lint`, `pnpm -r run test`, and `pnpm fallow dead-code` across the whole change.

## Risks and Mitigations

| Risk                                                                                                                                           | Mitigation                                                                                                                                                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The synchronous sleep blocks the serving node's event loop, including its UI                                                                   | Bounded at 60 ms per write, and only reached when an `fs` call actually throws a transient errno. The heartbeat path is additionally throttled to one write per second, so the worst sustained case is 60 ms of blocking per second on a host whose filesystem is already failing writes.                                                                     |
| A permanent `EACCES` directory on POSIX now costs 60 ms per `ensureDirectoryExists` call, three times per `ensurePermissionForwardingLocation` | That path already ends in an abandoned forward, so the latency lands on a request that was going to be refused either way. `ENOTDIR` and `ENOENT` — the shapes the existing tests exercise — are outside the retry set and stay immediate.                                                                                                                    |
| 60 ms is too short for a real antivirus hold, so the reported failures continue                                                                | Honest residual, and the reason the debug entry carries `attempts` and `code`: the log distinguishes "retried and recovered" from "retried and still lost", which is the measurement needed to argue for a larger budget. `graceful-fs` waits up to 60 s for this exact condition, but asynchronously; buying that here would mean blocking a UI for seconds. |
| The retry masks a genuine permission misconfiguration by making it slower to surface                                                           | The verdict is unchanged in every case — only its latency moves, by at most 60 ms — and `permission_forwarding.error` still fires with the original errno.                                                                                                                                                                                                    |
| Mocking `node:fs` in a new test file breaks sibling exports                                                                                    | The factory spreads `await importActual<typeof import("node:fs")>("node:fs")` and overrides one export, per the `testing` skill's rule about object-literal `node:*` factories.                                                                                                                                                                               |
| A test that passes before the fix looks like proof                                                                                             | Each step names its killing mutations above, and a new test authored after Green gets mutated explicitly before the commit.                                                                                                                                                                                                                                   |

## Open Questions

None.
The three design questions — which operations the retry wraps, the attempt budget, and where a recovered retry is recorded — were settled at the planning gate; the `ConfigStore.save` site and the two unwrapped operations are recorded in Non-Goals with their reasons rather than deferred to a follow-up issue, since no one has reported either.

[#398]: https://github.com/gotgenes/pi-packages/issues/398
[#722]: https://github.com/gotgenes/pi-packages/issues/722
[#735]: https://github.com/gotgenes/pi-packages/issues/735
[#907]: https://github.com/gotgenes/pi-packages/issues/907
