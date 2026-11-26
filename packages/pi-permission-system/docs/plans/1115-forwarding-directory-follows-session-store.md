---
issue: 1115
issue_title: "pi-permission-system: the forwarding directory ignores PI_CODING_AGENT_SESSION_DIR, leaving the per-second heartbeat in the agent config dir"
---

# The forwarding directory follows a relocated session store, and the heartbeat slows to 30 seconds

## Release Recommendation

**Release:** ship independently

The Phase 16 roadmap tags this step `Release: independent`, and its `Release batches` subsection says there is no batch.
This is a `fix:` release carrying two `fix:` commits (location, then cadence); the preparatory `refactor:` steps cut none.

## Problem Statement

An operator who sets `PI_CODING_AGENT_SESSION_DIR` to move Pi's session store out of `~/.config/pi/agent` still gets a file rewritten once a second, per open interactive session, inside the directory they moved sessions out of.
The file is the serving heartbeat (`<agentDir>/sessions/permission-forwarding/serving/<id>.json`), written by temp file plus rename.
The reporter measured about 77 FSEvents/s from 11 idle sessions under a Synology Drive-backed `~/.config`, around the clock.
`computeExtensionPaths` (`src/config/extension-paths.ts`) derives the forwarding directory from `agentDir` alone, and short of `PI_CODING_AGENT_DIR`, which relocates settings and packages too, nothing moves it.

Issue [#1052] is the same path's cost on another axis: the heartbeat is written every second whether or not any forwarding child is waiting, about 4.1 KB/s of physical writes per session on Linux/ext4 (reporter-measured).
The heartbeat serves only a child Pi running as a separate process (a third-party spawner setting `PI_SUBAGENT_PARENT_SESSION`); `@gotgenes/pi-subagents` children run in-process and read the process-global registry instead.
The Phase 16 roadmap adopted both issues as one step, with PR [#1107] as the reference implementation for the location.

## Goals

- With `PI_CODING_AGENT_SESSION_DIR` set to a non-empty value, the forwarding tree (requests, responses, and the serving heartbeat) lives at `<that dir, ~ expanded>/permission-forwarding`; with it unset or empty, nothing changes.
- An idle serving session rewrites its heartbeat every 30 seconds instead of every second.
- A parent that exited or was killed is still abandoned in about two seconds (`PERMISSION_FORWARDING_SERVING_GRACE_MS`), unchanged.
- A heartbeat deleted underneath its live owner reappears at the owner's next poll tick (250 ms), inside the grace window — a stronger bound than today's one second.
- Not breaking: no config key, default policy, or output shape changes.
  The one observable difference for a user without the variable is that a suspended parent, or a killed one whose pid was reused, is judged stale after up to 90 seconds instead of five; both still end in the same "not serving" denial.

## Non-Goals

- Honoring `--session-dir` or `settings.sessionDir`.
  Parent and child rendezvous in this directory, so its location may depend only on what both are guaranteed to share; an inherited environment variable is that, and a per-invocation flag or a project-scoped setting can split them (nicobailon/pi-subagents passes `--session-dir` to its children and never sets the variable, per a GitHub code search).
- A liveness signal with no idle writes at all — filed as [#1149] (open-ended; candidate: the forwarded request is itself the liveness ping), deferred to a later phase by operator decision.
- The `.unref()` of the poll timer and async inbox I/O raised in a comment on [#1052]: a different concern (process exit and event-loop lag), not where or how often the heartbeat is written.
- Protecting the forwarding tree from agent writes at its resolved location — [#1121] reads `ExtensionPaths.forwardingDir` and lands after this.
- Narrowing `PermissionSession`'s `ExtensionPaths` dependency to the two fields it reads (Tidy-First assessor, rejected as scope creep).
- `src/authority/forwarding-manager.ts`: the roadmap names it as a target, but it needs no change — it already announces on every tick and leaves throttling to `ServingHeartbeatStore` (see Module-Level Changes, predicted unchanged).

## Background

- `computeExtensionPaths(agentDir, piPackageDir?)` returns `ExtensionPaths`: `agentDir`, `sessionsDir`, `subagentSessionsDir`, `forwardingDir`, `globalLogsDir`, and the infrastructure read roots.
  `src/index.ts` calls it once with `getAgentDir()` and `getPackageDir()`.
  In `src/`, `sessionsDir` and `agentDir` are read by nothing but the line deriving `forwardingDir`; `PermissionSession` reads only `piInfrastructureDirs` and `piInfrastructureExcludedDirs` (`permission-session.ts`).
- Pi resolves its session directory as `--session-dir` > `PI_CODING_AGENT_SESSION_DIR` (through `expandTildePath`) > `settings.sessionDir` (pinned 1.0.0 `dist/main.js`, unchanged in the `../pi` checkout).
  Pi does not export `ENV_SESSION_DIR` from its package entry, so the name is spelled out here.
  With a custom directory Pi writes `.jsonl` files straight into it, and its session listing reads only `*.jsonl`, so a `permission-forwarding/` subdirectory beside them is harmless.
- `ServingHeartbeatStore` (`src/authority/forwarding-liveness.ts`) publishes `<forwardingDir>/serving/<id>.json` (`sessionId`, `pid`, `updatedAt`).
  `markServing` runs on every 250 ms poll tick (`ForwardingManager.refreshServing`) and writes only when `isThrottled` says the last write is at least `SERVING_HEARTBEAT_REFRESH_MS` (4 ticks, 1 s) old.
  A reader classifies a record `alive`, `absent`, `dead_pid`, or `stale` (unrefreshed for `SERVING_HEARTBEAT_STALE_MS`, 5 refreshes, 5 s).
- A forwarding child (`ParentAuthorizer.pollForForwardedResponse`, `approval-escalator.ts`) abandons after `isServing` reads `false` for the 2 s grace window.
  An interactive child (`resolveLiveRelayTarget`, `authorizer.ts`) relays only on a one-shot `alive` read.
- The package skill's composition-root rule: tests that run the factory stub `PI_CODING_AGENT_DIR` to a tmpdir; this change adds a second ambient variable the factory reads.
- `index.ts` is the composition root and the only place a `process.*` read belongs (`code-design`: no `process.env` inside library functions).

## Design Overview

### How the evidence was produced

The location trace is read from source: `computeExtensionPaths` and its single production caller, Pi's session-dir precedence in the pinned `dist/main.js`, and Pi's `listSessionsFromDir`.
The FSEvents and write-volume figures are the reporters' measurements, not reproduced here.
The predicted reduction (1 write/s → 1 write per 30 s per session; at the reporter's ~7 events per write, about 77/s → about 2.6/s across 11 sessions) is **estimated** from those figures; step 5's test measures the write count in the unit (3 writes over 60 simulated seconds of ticks, against 61 today).

### Location

`computeExtensionPaths` takes an options object (step 2) and gains `sessionDir`:

```typescript
export interface ExtensionPathOptions {
  /** Pi's own install directory (`getPackageDir()`); auto-allowed for reads. */
  readonly piPackageDir?: string;
  /** Pi's relocated session store (`PI_CODING_AGENT_SESSION_DIR`), as inherited. */
  readonly sessionDir?: string;
}

export function computeExtensionPaths(
  agentDir: string,
  options: ExtensionPathOptions = {},
): ExtensionPaths;
```

```typescript
// src/index.ts — the one env read
const paths = computeExtensionPaths(agentDir, {
  piPackageDir: getPackageDir(),
  sessionDir: process.env.PI_CODING_AGENT_SESSION_DIR,
});
```

```typescript
// inside computeExtensionPaths
const forwardingRoot = sessionDir
  ? expandHomePath(sessionDir)
  : join(agentDir, "sessions");
const forwardingDir = join(forwardingRoot, "permission-forwarding");
```

Edge cases, each pinned in step 3:

- Unset or empty string → `<agentDir>/sessions/permission-forwarding` (Pi also treats an empty value as unset).
- `~` / `~/x` → under `homedir()`.
- A relative value passes through unchanged and resolves against the process cwd at use, as Pi's own store does.
- `subagentSessionsDir`, `globalLogsDir`, and the infrastructure roots stay `agentDir`-rooted.

`config → path` is an allowed zone edge (`fallow guard`, checked by the assessor), so importing `expandHomePath` into `extension-paths.ts` adds no boundary.

### Cadence

```text
parent: tick 250 ms → markServing → write if last write ≥ 30 s old, OR own record missing (stat, no write)
        stale after 90 s unrefreshed
child:  tick 250 ms → read → alive | absent | dead_pid | stale; not alive for 2 s → abandon
```

| Parent state                         | Today                     | After                                                         |
| ------------------------------------ | ------------------------- | ------------------------------------------------------------- |
| Exited (record withdrawn)            | absent → abandon in 2 s   | unchanged                                                     |
| Killed (pid gone)                    | dead_pid → abandon in 2 s | unchanged                                                     |
| Alive, polling, deliberating         | alive                     | alive (refresh runs ahead of the processing guard, unchanged) |
| Record deleted underneath            | reappears ≤ 1 s           | reappears at the next tick (≤ 250 ms)                         |
| Suspended, or killed with pid reused | stale after 5 s → abandon | stale after up to 90 s → abandon                              |

The constants become `SERVING_HEARTBEAT_REFRESH_MS = 30_000` and `SERVING_HEARTBEAT_STALE_MS = 3 * SERVING_HEARTBEAT_REFRESH_MS` (90 s).
Three refreshes rather than five: the multiplier was generous for a delayed one-second Node timer, and a 30-second timer is not delayed by 60 seconds on a live process.
The refresh constant no longer derives from `PERMISSION_FORWARDING_POLL_INTERVAL_MS`, so that import leaves `forwarding-liveness.ts`.

`isThrottled` becomes "recent enough **and present** to leave alone": when the time check would throttle, it also checks `existsSync(servingHeartbeatPath(...))` and lets the write through when the record is gone.
A stat produces no FSEvent and no physical write; the same tick already runs `existsSync` and `readdirSync` on the inbox.
The probe is what keeps `sweepDeadRecordsOnce`'s pid-reuse safety argument ("a wrongly swept owner republishes … shorter than the grace") true at a 30-second refresh.

## Module-Level Changes

| File                                         | Change                                                                                                                                                                                                                                                                              | Step                |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| `src/config/extension-paths.ts`              | Drop `sessionsDir` and `agentDir` from `ExtensionPaths`; options object; `sessionDir` roots `forwardingDir`; refresh the stale `ExtensionRuntime`/#129/#130 doc-comment history                                                                                                     | 1, 2, 3             |
| `src/index.ts`                               | Pass `{ piPackageDir, sessionDir: process.env.PI_CODING_AGENT_SESSION_DIR }`                                                                                                                                                                                                        | 2, 3                |
| `test/helpers/session-fixtures.ts`           | `makePaths` drops `agentDir` and `sessionsDir`                                                                                                                                                                                                                                      | 1                   |
| `test/config/extension-paths.test.ts`        | Remove the `agentDir`/`sessionsDir` assertions; rename "derives forwardingDir as sessionsDir/…"; options-object call sites; relocation tests                                                                                                                                        | 1, 2, 3             |
| `test/composition-root.test.ts`              | `beforeEach` stubs `PI_CODING_AGENT_SESSION_DIR` to `undefined`; file header names the variable; relocated-rendezvous test in `out-of-process forwarding liveness`                                                                                                                  | 3                   |
| `src/authority/forwarding-liveness.ts`       | Existence probe in `isThrottled`; constants and their docs; `sweepDeadRecordsOnce` doc; drop the poll-interval import                                                                                                                                                               | 4, 5                |
| `test/authority/forwarding-liveness.test.ts` | Rewrite "republishes at the next refresh boundary…" to advance one tick; literal cadence and staleness tests                                                                                                                                                                        | 4, 5                |
| `docs/subagent-integration.md`               | Line 167: `<agent dir>/sessions/…` → the forwarding directory, rooted at `PI_CODING_AGENT_SESSION_DIR` when set, and why only the variable; table row "several seconds" → "about a minute and a half"                                                                               | 3, 5                |
| `docs/architecture/architecture.md`          | `extension-paths.ts` module entry (line ~940, "derived from `agentDir`") names the session-dir root; `forwarding-liveness.ts` entry (line ~1058) names the 30 s refresh and the missing-record republish; the roadmap step's `✅` heading, Mermaid node `S1115`, and `Landed:` note | 3, 4, 5, completion |

Predicted unchanged, with the claim each rests on:

- `src/authority/forwarding-manager.ts` and `test/authority/forwarding-manager.test.ts` — the manager calls `markServing` every tick against a mocked announcer; the throttle lives in the store.
- `test/helpers/forwarding-fixtures.ts` (`publishServingHeartbeat`) — callers pass an explicit `forwardingDir`; the first `markServing` is never throttled.
- `src/authority/approval-escalator.ts`, `src/authority/authorizer.ts` — they read liveness through `TargetServingLookup`; only the store's constants move.
- `test/session-start.test.ts`, `test/permission-events.test.ts` — they run the factory with `hasUI: false`, so no heartbeat is written and `computeExtensionPaths` creates nothing (assessor-checked); no stub needed.
- `test/composition-root.test.ts`'s seven literal `join(agentDir, "sessions", "permission-forwarding")` sites — valid once `beforeEach` stubs the variable undefined.
- `.pi/skills/package-pi-permission-system/SKILL.md` — grep finds no `sessionsDir` or forwarding-path literal; it names `forwardingDir` only as a parameter.

## Test Impact Analysis

- New unit coverage: `computeExtensionPaths` with each `sessionDir` shape (step 3); the store's republish-on-missing (step 4); cadence and staleness against literal clock values (step 5).
- Redundant: the `agentDir`/`sessionsDir` field assertions disappear with the fields (step 1).
- Kept as-is: every `ServingHeartbeatStore.read` staleness test (relative to the constant, still meaningful); `timing constants` (90 s > 2 × 30 s, 30 s > 250 ms); "does not rewrite within the refresh window" (the record exists, so the probe throttles — it now also pins that the probe does not write a present record).

## Invariants at risk

| Invariant                                                               | Constituency                                                         | Pinned by                                                                                               |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| An exited parent is abandoned in about 2 s                              | out-of-process children                                              | `composition-root.test.ts` › "blocks promptly when the out-of-process parent published no heartbeat"    |
| A killed parent reads `dead_pid` regardless of age                      | out-of-process children                                              | `forwarding-liveness.test.ts` › "names the dead process rather than the age, when the record is both"   |
| A deliberating parent keeps announcing                                  | second child forwarding to a busy parent                             | `forwarding-manager.test.ts` › "re-announces while a drain is still in flight"                          |
| A record deleted underneath its owner reappears inside the grace window | out-of-process children; `sweepDeadRecordsOnce`'s pid-reuse argument | step 4's rewritten test (today's version passes at 30 s only because it advances a full refresh window) |
| Records live beside `sessions/`, never inside (#398 cleanup ordering)   | the request/response cleanup                                         | `forwarding-liveness.test.ts` › "places the record beside the sessions tree, not inside it"             |
| Records and directories are owner-only                                  | anyone reading the forwarding tree                                   | "creates the record owner-only inside an owner-only directory"                                          |
| Unset variable → today's layout                                         | every user without the variable                                      | step 3's unset/empty tests, and the composition-root tests' literal agent-dir paths                     |

## TDD Order

Steps 1–2 are the Tidy-First assessor's recommendations; step 4 is the mechanism half of the cadence change and step 5 its data half.
Each leaves the suite green.
Step 3 adopts PR [#1107]'s mechanism and step 5 adopts [#1052]'s "slower refresh with a scaled staleness window" remedy; their commits carry, in the final paragraph below `Refs #1115`:

```text
Co-authored-by: George Harker <george@george-graphics.co.uk>
```

```text
Co-authored-by: dopamine911 <263391389+dopamine911@users.noreply.github.com>
```

1. **`refactor(pi-permission-system): drop the unread sessionsDir and agentDir paths`**
   - Prepares: step 3 would otherwise have to decide what `sessionsDir` means once the store moves; PR [#1107] set it to the relocated directory, which leaves a field naming the wrong place for any later reader.
   - Remove both fields from `ExtensionPaths` and `computeExtensionPaths`'s return (keep the local `join(agentDir, "sessions")` for `forwardingDir`); drop them from `makePaths`; delete "sets agentDir from argument" and "derives sessionsDir as agentDir/sessions"; reduce "two calls with different agentDirs" to `forwardingDir`; rename "derives forwardingDir as sessionsDir/permission-forwarding" to say `agentDir/sessions/permission-forwarding`.
   - Verify: `rg -n 'sessionsDir|paths\.agentDir' packages/pi-permission-system/src packages/pi-permission-system/test` prints nothing; `pnpm --filter @gotgenes/pi-permission-system run check`.
   - No new tests (removal).
2. **`refactor(pi-permission-system): pass computeExtensionPaths options as an object`**
   - Prepares: a third positional optional would put two adjacent optional strings side by side, swappable without a type error, with an `undefined` placeholder in every test call.
   - `computeExtensionPaths(agentDir, { piPackageDir })`; update `src/index.ts` and the two `extension-paths.test.ts` call sites that pass it (including "omits piPackageDir when given an empty string").
   - No new tests; the existing `piPackageDir` tests pin it.
3. **`fix(pi-permission-system): the forwarding directory follows a relocated PI_CODING_AGENT_SESSION_DIR`**
   - Red, `extension-paths.test.ts` in a new `describe("forwarding directory")`: `{ sessionDir: "/data/pi" }` → `forwardingDir` is `/data/pi/permission-forwarding`; `"~/pi-data"` → `join(homedir(), "pi-data", "permission-forwarding")`; `""` → `/test/agent/sessions/permission-forwarding`; `"rel/dir"` → `join("rel/dir", "permission-forwarding")`; with `"/data/pi"`, `subagentSessionsDir`, `globalLogsDir`, and `piInfrastructureExcludedDirs` are unchanged.
   - Red, `composition-root.test.ts`: add `vi.stubEnv("PI_CODING_AGENT_SESSION_DIR", undefined)` to `beforeEach` and name the variable in the file header; add "rendezvouses under a relocated PI_CODING_AGENT_SESSION_DIR" to `out-of-process forwarding liveness` (PR [#1107]'s test: heartbeat published under `<sessionDir>/permission-forwarding`, the child's request approved there, the fire resolves unblocked, and `<agentDir>/sessions` does not exist).
   - Green: the derivation in Design Overview; the env read in `index.ts`.
   - Docs: `docs/subagent-integration.md` line 167 and the `extension-paths.ts` architecture entry.
   - Killing mutations:
     - Make `computeExtensionPaths` ignore `options.sessionDir`: the relocation unit tests and the composition-root test go red.
     - Drop `sessionDir` from the `index.ts` call: only the composition-root test goes red (pins the wiring).
     - Replace `expandHomePath(sessionDir)` with `sessionDir`: the `~` test goes red.
     - Change `sessionDir ?` to `sessionDir !== undefined ?`: the empty-string test goes red.
4. **`refactor(pi-permission-system): republish a missing serving heartbeat at the next tick`**
   - Prepares: step 5's 30 s refresh would otherwise leave a deleted record missing for up to 30 s, past the 2 s grace.
     At today's 1 s refresh no user can observe the difference, hence `refactor:`.
   - `isThrottled` also requires the record to exist (`existsSync`); rewrite its doc comment (the probe's cost argument now runs the other way) and `sweepDeadRecordsOnce`'s.
   - Test: rewrite "republishes at the next refresh boundary when the record was removed underneath it" as "republishes at the next tick when the record was removed underneath it": `markServing`, `rmSync` the record, `clock += 250`, `markServing`, then `readRecord(...).updatedAt === clock`.
   - Architecture entry for `forwarding-liveness.ts` names the republish.
   - Killing mutations:
     - Delete the `existsSync` clause: the rewritten test goes red.
     - Make the clause always report missing: "does not rewrite within the refresh window" goes red.
5. **`fix(pi-permission-system): an idle serving session rewrites its heartbeat every 30 seconds, not every second`**
   - `SERVING_HEARTBEAT_REFRESH_MS = 30_000`, `SERVING_HEARTBEAT_STALE_MS = 3 * SERVING_HEARTBEAT_REFRESH_MS`; rewrite both doc comments; drop the `PERMISSION_FORWARDING_POLL_INTERVAL_MS` import if unused.
   - Tests in a new `describe("cadence")` with literal times, not the constants:
     - Announcing every 250 ms from `t` to `t + 60_000` writes three distinct `updatedAt` values (`t`, `t + 30_000`, `t + 60_000`).
     - A record 60 000 ms old reads `alive`; one 90 000 ms old reads `stale`.
   - Docs: `docs/subagent-integration.md`'s "several seconds" row; the `forwarding-liveness.ts` architecture entry's cadence.
   - Killing mutations:
     - Restore `4 * PERMISSION_FORWARDING_POLL_INTERVAL_MS`: the write-count test goes red (61 values).
     - Restore `5 *` on the staleness multiplier: the 90 s `stale` test goes red.

At completion `/tdd-plan` marks the roadmap step `✅` (heading and Mermaid node `S1115`) and adds its `Landed:` note.

## Risks and Mitigations

- **A spawner overrides the variable for its child.**
  Parent and child then compute different directories and the child abandons in about 2 s with "not serving", a deny, never an allow.
  The searched spawners pass `--session-dir` instead; `docs/subagent-integration.md` states that both sides must see the same value.
- **Version skew with the variable set.**
  A newer parent and an older child (a project-pinned install) look in different directories; same fail-closed outcome, the same window `docs/subagent-integration.md` § Upgrading already describes.
- **Home-prefix spelling differs from Pi's.**
  `expandHomePath` also expands `$HOME` and `${HOME}` and does not convert `file://`; Pi's `expandTildePath` does the reverse.
  For those spellings the forwarding tree lands away from Pi's store, but parent and child still agree, and a shell has already expanded `$HOME` in any normally exported value.
- **The extension creates the relocated directory first.**
  `ensureDirectoryExists` creates missing ancestors `0700`, so a not-yet-existing session directory is created owner-only rather than by Pi with umask defaults; Pi still writes into it.
- **A suspended or pid-reused parent is detected later.**
  Up to 90 s instead of 5 s before the same denial; [#1149] owns a mechanism that removes the trade-off.
- **Tests run inside a Pi session that exports the variable.**
  The `beforeEach` stub keeps the seven existing tests that build `join(agentDir, "sessions", "permission-forwarding")` from looking in the wrong directory (PR [#1107] hit exactly this).

## Open Questions

- Whether [#1149]'s request-as-ping mechanism replaces the heartbeat entirely — deferred to a later phase.

[#1052]: https://github.com/gotgenes/pi-packages/issues/1052
[#1107]: https://github.com/gotgenes/pi-packages/pull/1107
[#1121]: https://github.com/gotgenes/pi-packages/issues/1121
[#1149]: https://github.com/gotgenes/pi-packages/issues/1149
