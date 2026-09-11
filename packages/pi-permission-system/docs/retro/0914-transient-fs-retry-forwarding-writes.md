---
issue: 914
issue_title: "pi-permission-system: heartbeat and forwarded-file writes are lost on Windows when the atomic rename hits EPERM"
---

# Retro: #914 — heartbeat and forwarded-file writes are lost on Windows when the atomic rename hits EPERM

## Stage: Planning (2026-09-11T07:52:17Z)

### Session summary

Planned a bounded retry around the transient-file-lock failures in `src/authority/forwarding-io.ts`, committed as `docs/plans/0914-transient-fs-retry-forwarding-writes.md`.
The design puts the retry decision in a new `src/authority/transient-fs-retry.ts` (errno set `EPERM`/`EBUSY`/`EACCES`, three retries at 10/20/30 ms, a blocking `Atomics.wait` sleep), wraps `renameSync` in `writeJsonFileAtomic` and `mkdirSync` in `ensureDirectoryExists`, and records a recovered write as a debug-only `permission_forwarding.fs_retried` entry.
Four TDD steps: `refactor:` for the module, two `fix:` steps for the two call sites, one `docs:` step.

### Observations

- **The issue's causal claim needed correcting in both directions, and tracing the three callers is what produced the plan's framing.**
  A dropped heartbeat write does *not* generally read as `servingState: absent`: the previous record is left untouched on disk and still classifies `alive` for 5 s, and the failure leaves `published` unset so the next 250 ms tick rewrites it.
  Only the first publish and a session-id migration leave nothing behind, and a child needs 8 consecutive absent reads (2 s) before it abandons — so the reported *intermittent* lock does not reach the symptom the issue attributes to it.
  Conversely the request write, which the issue mentions only in passing, turns one `EPERM` into an immediate refused tool call with no recovery at all.
  And a lost *response* is not the ten-minute stall the issue claims: `processInbox` keeps no seen-set, so the undeleted request is re-served on the next tick — silently under recorded authority, as a duplicate dialog when it escalates.
- **Prior art was worth the two tool calls the issue asked for.**
  Pi core has no retry convention at all (four bare `renameSync` call sites, zero `EPERM` handling).
  `graceful-fs` gives the shape but carries a clause that would be a bug here: it abandons the retry as soon as the destination exists, and both the heartbeat record and the response file are legitimate overwrites.
  Node's own `fs.rmSync` (`maxRetries`/`retryDelay`, linear backoff, a synchronous API) is the precedent for blocking, verified against the v26 docs rather than recalled.
- **Two decisions were made without asking, with reasons in the plan.**
  No platform gate, because `src/` may not read `process.platform` and the errno set already answers the question; and the retry lives in its own module with an injected `sleep`/`delaysMs` so its unit tests never touch the filesystem or a clock.
- **The gate's literal event name was generalized.**
  The operator approved `permission_forwarding.write_retried` while also selecting `mkdirSync` in the same batch, so the plan uses `permission_forwarding.fs_retried` with an `operation` field — a `mkdir` is not a write.
- **A second atomic-write site exists** — `ConfigStore.save` (`src/config/config-store.ts`), same tmp→rename shape — and was offered at the gate and declined.
  Recorded in the plan's Non-Goals with the reason (one-shot, user-initiated, error-toasted, and covering it would need a shared home outside `authority/`).
- **The Tidy-First assessor recommended nothing**, and its pass-by verification is the more useful output: it confirmed both target functions already isolate the single `fs` call inside their own `try`/`catch`, and that the two fault-injecting tests in `approval-escalator.test.ts` fail with `EACCES` on the *temp write* and `ENOTDIR` on `mkdirSync` respectively — neither reaches the retry, so neither slows down.
  The `ENOTDIR` claim was spot-checked against the test source.

#### Deferred tidyings

- `test/authority/forwarding-io.test.ts` — the `let root: string;` plus `afterEach(rmSync)` temp-directory boilerplate repeats across roughly ten `describe` blocks with no shared fixture.
- `test/authority/forwarding-io.ts` module shape — the file is 538 lines mixing error formatting, two log helpers, directory lifecycle, the atomic write, five tolerant-read `asX` narrowers, and an async `sleep`.
- Package-wide test convention — thirteen test files each inline their own `vi.mock("node:fs", …)` factory with no shared helper to migrate onto.

#### Process note

`rg -rn "renameSync" src/` was run by mistake — `-r` is `--replace`, so it printed every match rewritten to `n` and dropped the line numbers, exactly as `AGENTS.md` warns.
It was re-run correctly, and the corrected run is what surfaced the second write site in `config-store.ts`.

## Stage: Implementation — TDD (2026-09-11T08:18:42Z)

### Session summary

All four planned TDD steps completed, plus two follow-up commits addressing the reviewer's WARNs.
`retryOnTransientFsError` (`src/authority/transient-fs-retry.ts`) now backs both `writeJsonFileAtomic`'s `renameSync` and `ensureDirectoryExists`'s `mkdirSync`, with a recovery recorded as a debug-only `permission_forwarding.fs_retried` entry.
Test count for `pi-permission-system`: 4157 → 4172 (+15, across two new files).

### Observations

- **Every planned killing mutation landed on exactly the predicted tests**, with one instructive exception.
  The step-1 mutation "treat every thrown value as transient" killed only one of its two predicted tests, because `transientErrorCode`'s early `"code" in error` guard returns first for a code-less `Error` — so the two non-transient claims are pinned by two *different* guards, and killing both needed both mutated.
  That is a finding the plan's single-mutation prediction would have missed.
- **Four tests were green during their Red step** (`records nothing when the rename succeeds outright`, `rethrows a lock that outlasts the budget…`, `reports failure without throwing…`, and the added `leaves an unrelated errno alone`).
  All four are deliberate invariant pins, and each was mutated explicitly rather than trusted: `attempts === 1` → `=== 0`, dropping `safeDeleteFile` from the catch, `return false` → `return true`, and adding `ENOSPC` to the errno set.
- **Two tests were added beyond the plan's list.**
  `leaves an unrelated errno alone` pins the errno-set boundary from the wiring side (the plan pinned it only in the unit tests), and `honors an injected delay sequence` pins the `delaysMs` seam the unit tests rely on.
  The plan's `it.each` row also splits into two reported tests.
- **`vi.mock("node:fs")` in a new file needed the `importOriginal` spread**, per the `testing` skill, so the temp write, the `0o600`/`0o700` mode assertions, and the cleanup all still run against a real temp directory with only one export faked.
  The reviewer confirmed no leakage into the sibling real-filesystem tests.
- **Every predicted-unchanged file stayed unchanged**, including `test/authority/forwarding-io.test.ts` and the two fault-injecting `approval-escalator.test.ts` tests — the planning trace that one fails at the un-retried temp write (`EACCES`) and the other at `ENOTDIR` held exactly.
- **Pre-completion reviewer: PASS** (full range), then **PASS** again on the two-commit delta.

#### Reviewer warnings (both addressed before stopping)

- The shared `errnoError` test fixture hardcoded a `", rename"` message suffix that the `mkdir` tests then asserted on — fixed in `733dd7eb` by taking the operation name as a parameter.
- The plan's risk table said 60 ms of worst-case blocking per heartbeat tick, but `markServing` makes *two* retryable calls (`ensureDirectoryExists` then `writeJsonFileAtomic`), so the real figure is ~120 ms — corrected in `f3f5f66e`.
  Still inside the 250 ms poll tick the safety argument rests on, and the reviewer re-derived that no other call site chains more than two retryable operations in a bounded per-tick window.
