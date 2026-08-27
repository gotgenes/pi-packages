---
issue: 721
issue_title: "pi-permission-system: liveness detection for out-of-process forwarded permission requests"
---

# Out-of-process forwarding liveness — a serving heartbeat on the filesystem

## Release Recommendation

**Release:** ship independently

This issue is Phase 13 Step 5 in `docs/architecture/architecture.md`, annotated `Release: independent`.
It belongs to no batch, and the payoff — a detached subagent that fails in seconds instead of burning ten minutes per `ask` against a parent that exited yesterday — is worth releasing on its own.

## Problem Statement

A subagent whose `ask` is forwarded to a parent session that nobody is draining waits out `PERMISSION_FORWARDING_TIMEOUT_MS` (600 s) and then reports a denial no user made.

[#719] fixed that for an **in-process** child: the parent's `ForwardingManager` marks itself in the process-global `ServingSessionRegistry`, and `ParentAuthorizer` abandons a target that has looked unmarked for `PERMISSION_FORWARDING_SERVING_GRACE_MS` (2000 ms).
That judgement is deliberately gated on `target.source === "registry"` — a child in a separate `pi` process shares no `globalThis` with its parent, so an absent mark tells it nothing and it is never fast-failed.

[#735] is the report [#721] was parked waiting for.
A detached `pi-subagents` run outlives the interactive session that spawned it, still resolves `PI_SUBAGENT_PARENT_SESSION` to the now-dead parent id, and forwards into an inbox nobody will ever drain.
The reporter measured ~10 minutes per `ask` surface and 30+ minutes per child, with orphaned request files left behind in the dead session's `requests/` directory.

The filesystem is the only channel an out-of-process child shares with its parent, so the signal has to live there.

## Goals

- A serving session publishes a liveness record to the filesystem while it drains its inbox, and withdraws it when it stops.
- An out-of-process child (`target.source === "env"`) that finds no live record for its target abandons after the same 2 s grace an in-process child already uses, with `confirmationUnavailable: true` and a path-naming `denialReason` — resolving [#735] scenario 1.
- The judgement of "is this target being served" moves out of `ParentAuthorizer` into one collaborator that dispatches on how the target was resolved, so the in-process and out-of-process rules cannot drift.
- The abandonment review entry names *which* channel answered and *why* the target read as unserved (absent record, stale record, dead pid), so a stall stays diagnosable in one log line.
- No new configuration field: the thresholds join `PERMISSION_FORWARDING_SERVING_GRACE_MS` as constants, and `forwardingTimeoutMs` remains the only operator-facing forwarding knob.

This change is **not** breaking in the API or config sense: no export is removed from the package's public surface, no config default changes, and every same-version deployment behaves as before or better.

It does carry an **upgrade-ordering requirement**, which Goals states plainly rather than burying in Risks.
A child on this version whose parent session is still running an older version sees no heartbeat, reads that as "not serving," and denies in ~2 s where a human might have approved at 30 s.
The window is a `pi-permission-system` upgrade that lands while a parent session is already running.
The remedy is the same one [#745] documented for the payload contracts — upgrade the parent first, i.e. restart the interactive session after upgrading — and it goes in `docs/subagent-integration.md` rather than a `docs/migration/` note, because nothing about the contract requires a user edit.

## Non-Goals

- **[#735] scenario 2** — a parent that is alive and polling but whose turn is occupied by a blocking `subagent_wait`.
  A heartbeat says the parent is draining its inbox, which in that scenario is true; the deadlock is a serving-side scheduling problem tracked with [#722].
- **The claim artifact.**
  [#721] names a per-request claim as the second candidate mechanism, and the operator declined it this round (see Design Overview for what it would and would not have bought).
  A serving loop that runs but never picks a particular request up remains [#722]'s territory.
- **Any new config field.**
  Operator decision: constants only.
- **Root-causing [#722].**
  This plan adds a second diagnostic signal to the same review log, which helps, but the diagnosis is not its deliverable.
- **Sweeping foreign request inboxes.**
  Since [#719] a child deletes its own request on every abandonment path (`discardRequest`), which is what [#735]'s orphan complaint was about.
  A global sweep of other sessions' `requests/` directories is not in scope; this plan prunes only the heartbeat records it introduces.
- **Any change to `@gotgenes/pi-subagents`.**
  The issue carries both `pkg:` labels, but every change lands in `pi-permission-system` — the out-of-process path is driven by third-party extensions setting an env var, and their side of the contract is unchanged.
  This is a single-package plan.

## Background

### The forwarding round trip today

`ParentAuthorizer.waitForForwardedApproval` (`src/authority/approval-escalator.ts`) resolves a `PermissionForwardingTarget`, ensures `<forwardingDir>/sessions/<target>/{requests,responses}/`, writes a request, and polls `responses/<id>.json` every `PERMISSION_FORWARDING_POLL_INTERVAL_MS` (250 ms) until `getTimeoutMs()` elapses.

The serving side is `ForwardingManager` (`src/authority/forwarding-manager.ts`), a `setInterval` started from `PermissionSession.activate` for any context that has a UI and is not a subagent.
Each tick calls `ForwardedRequestServer.processInbox`, guarded by a `processing` flag so a slow drain does not overlap itself.

### What [#719] already put in place

- `resolvePermissionForwardingTarget` returns `{ sessionId, source }` where `source` is `"self" | "registry" | "env"` — the provenance this plan dispatches on.
- `ServingSessionRegistry` (`src/authority/serving-registry.ts`) splits into two seams by design: `ServingAnnouncer` (`markServing` / `clearServing`) for the poller, `ServingLookup` (`isServing` / `servingIds`) for the child.
  `markServing` is already idempotent (`Set.add`).
- `ForwardingManager.announceServing` marks the polled id and logs `forwarded_permission.serving_started` **once per session id**, because `start(ctx)` runs on every `before_agent_start` / `input` / `tool_call`.
- `ParentAuthorizer.checkServingLiveness` holds the `source !== "registry"` guard and the `unservedSince` window; `abandon()` is the single helper every abandonment path returns through.
- `test/helpers/forwarding-fixtures.ts` supplies `makeParentAuthorizerDeps` with an `alwaysServing` default, so a new dep lands in one place.

### AGENTS.md and package constraints that apply

- The architecture roadmap's health-metrics table greps `ls packages/pi-permission-system/src/authority | grep -c "forwarding-liveness"`, measured **0** at planning time, target **1**.
  The step that creates the module must use that filename or update the row in the same commit — using it.
- A module no code imports yet is `refactor:` however new it is; the commit that wires it up carries the `feat:`/`fix:`.
- The package skill's "Event-based subagent integration" section states the in-process-only restriction explicitly and links [#721] as its follow-up; the doc step rewrites it.
- `docs/architecture/architecture.md` module-tree entries describe current behavior, and an issue ref belongs there only when it encodes an active constraint.
- Log artifacts holding tool input are written owner-only through the helpers in `forwarding-io.ts`; a heartbeat holds no tool input but lives in the same tree and uses the same mode constants for consistency.

## Design Overview

### 1. Why a heartbeat and not a claim

Both candidates in [#721] are filesystem records the serving side writes.
They differ in granularity, and the code constrains the choice more than the issue text suggests.

A **claim artifact** (`claims/<requestId>.json`, written on pickup) would catch one failure a heartbeat cannot: a serving loop that runs but never picks a particular request up — [#722]'s undiagnosed shape.
But `processInbox` drains its inbox **serially**, awaiting each escalation: while a human deliberates on request A, request B sits in the same directory unclaimed for minutes.
A naive claim would falsely abandon B. Claiming the whole scanned batch up front fixes that, but then the artifact means "the loop saw you," not "I am working on you" — and it still adds a third per-request file needing cleanup on both sides, inside the same `requests/`/`responses/` tree whose removal ordering already produced the [#398] ENOENT write loop.

A **serving heartbeat** is one record per serving session, answers exactly the question the in-process registry answers, and therefore lets one judgement rule cover both target kinds.
It detects the four shapes that matter here: a parent that exited cleanly (record withdrawn), one that was killed (recorded pid no longer alive), one alive but no longer polling (record unrefreshed), and one that never served at all (no record).
It does not detect [#722]'s shape, which is out of scope.

### 2. Where the record lives

```text
<forwardingDir>/
├── sessions/<encoded-session-id>/{requests,responses}/   ← unchanged
└── serving/<encoded-session-id>.json                     ← new
```

A **sibling** directory rather than a file inside `sessions/<id>/`, for one concrete reason: `cleanupPermissionForwardingLocationIfEmpty` removes `requests/`, `responses/`, and `sessionRootDir` when empty, and a heartbeat inside that root would make it permanently non-empty and entangle liveness with the [#398] ordering.
Disjoint placement keeps that logic untouched and makes "who is serving" a single `readdir` for the diagnostic.

The `serving/` directory is created on demand and **never removed**.
Removing it would reintroduce exactly the race [#398] was: one session's cleanup deleting the directory between another session's `ensureDirectoryExists` and its write.
One empty directory under `forwardingDir` is the cheaper trade.

The session-id encoding is shared, not re-derived: `encodeSessionIdForPath` becomes an export of `permission-forwarding.ts` so both layouts cannot drift.

```typescript
export interface ServingHeartbeat {
  sessionId: string;
  /** The serving process, so a killed session is detectable without waiting out staleness. */
  pid: number;
  updatedAt: number;
}
```

### 3. Timing, derived from the existing poll interval

```typescript
/** How often a serving session rewrites its heartbeat — four poll ticks. */
export const SERVING_HEARTBEAT_REFRESH_MS =
  4 * PERMISSION_FORWARDING_POLL_INTERVAL_MS; // 1000

/** How long a heartbeat may go unrefreshed before its writer is presumed gone — five refreshes. */
export const SERVING_HEARTBEAT_STALE_MS = 5 * SERVING_HEARTBEAT_REFRESH_MS; // 5000
```

Both are code facts derived from `PERMISSION_FORWARDING_POLL_INTERVAL_MS = 250`, not estimates.
The resulting write rate is **one ~90-byte atomic write per second per serving session**, and the resulting fast-fail latencies are:

| Target state                       | Detected by            | Latency (measured from constants)                    |
| ---------------------------------- | ---------------------- | ---------------------------------------------------- |
| Parent exited cleanly              | Record absent          | ≤ 2 s grace + one 250 ms tick                        |
| Parent killed / crashed            | Recorded pid not alive | ≤ 2 s grace + one 250 ms tick                        |
| Parent alive but no longer polling | Record older than 5 s  | ≤ 5 s staleness + 2 s grace                          |
| Parent polling, human deliberating | Record fresh           | Not abandoned — waits the full `forwardingTimeoutMs` |

Against the 600 s the same cases cost today.

### 4. One class, two seams — mirroring `ServingSessionRegistry`

`ServingSessionRegistry` is one class implementing a narrow announce seam and a narrow query seam.
The heartbeat store follows it exactly, so the two liveness channels read the same way:

```typescript
/** Read side, consumed by the liveness judge. */
export type HeartbeatState = "alive" | "absent" | "stale" | "dead_pid";

export interface HeartbeatReader {
  read(sessionId: string): HeartbeatState;
  servingIds(): readonly string[];
}

/** One store; `ForwardingManager` sees only the announcer, the judge only the reader. */
export class ServingHeartbeatStore implements ServingAnnouncer, HeartbeatReader {
  constructor(deps: {
    forwardingDir: string;
    logger: DebugReviewLogger;
    /** Injected for the throttle and staleness tests. */
    now?: () => number;
    /** Injected so a test can control which pids look alive. */
    isProcessAlive?: (pid: number) => boolean;
    pid?: number;
  });
}
```

`markServing` is idempotent by the seam's existing contract and internally **throttled**: it rewrites only when `now() - lastWriteAt >= SERVING_HEARTBEAT_REFRESH_MS`, so a caller may invoke it on every 250 ms tick without four writes per second.
The first `markServing` for a session id also **prunes** `serving/` of records whose pid is no longer alive, which is what keeps the directory from growing one file per killed session forever.
Pruning is bounded (one `readdir` at session start) and safe under pid reuse: the wrongly-pruned owner rewrites within `SERVING_HEARTBEAT_REFRESH_MS` (1 s), inside the 2 s grace, so no child abandons in the window.

`clearServing` deletes the record via `safeDeleteFile` and leaves the directory.

Process liveness is `process.kill(pid, 0)`: `ESRCH` means gone, `EPERM` means alive under another user (treated as alive — the safe direction), and the forwarding tree is `0700` so cross-user records should not appear anyway.

### 5. The judgement moves out of `ParentAuthorizer`

Today `ParentAuthorizer` holds a `ServingLookup` plus the `source !== "registry"` switch.
Adding a second channel there would give it two lookups and a three-way branch — the connascence-of-algorithm shape [#719] avoided by returning `source` from the resolver in the first place.
Instead, one seam answers for a **target**, and owns the dispatch:

```typescript
/**
 * Query-side seam: is the session a forwarding target names being drained?
 *
 * Keyed on the target rather than a session id because the answer depends on
 * how the target was resolved — an in-process target is judged by the
 * process-global registry, an out-of-process one by the filesystem heartbeat,
 * and a `self` target not at all.
 */
export interface TargetServingLookup {
  /** `true` serving, `false` not serving, `null` not judgeable for this target kind. */
  isServing(target: PermissionForwardingTarget): boolean | null;
  /** What the judge observed, for the abandonment review entry. */
  describe(target: PermissionForwardingTarget): ServingObservation;
}

export interface ServingObservation {
  channel: "registry" | "heartbeat" | "none";
  /** Why a heartbeat channel read as unserved; `null` on the registry channel. */
  state: HeartbeatState | null;
  servingIds: readonly string[];
}

export class ForwardingLivenessJudge implements TargetServingLookup {
  constructor(deps: { registry: ServingLookup; heartbeats: HeartbeatReader });
}
```

`describe` is called once, on the abandonment path, so the per-tick question stays a single boolean and no diagnostic object is allocated four times a second.

`ParentAuthorizer.checkServingLiveness` then collapses to a question with no branch on provenance:

```typescript
private checkServingLiveness(
  target: PermissionForwardingTarget,
  unservedSince: number | null,
): number | null {
  // `null` (not judgeable) and `true` (serving) both reset the window.
  return this.serving.isServing(target) === false
    ? (unservedSince ?? Date.now())
    : null;
}
```

`"self"` returns `null` from the judge and stays unreachable in production, exactly as [#719] left it: `selectAuthorizer` never builds a `ParentAuthorizer` for a UI context.

### 6. The refresh must not sit behind the `processing` guard

This is the sharpest correctness detail in the plan.

`ForwardingManager`'s interval callback early-returns while `processing` is true — which is precisely the state a parent is in while a human deliberates at the forwarded dialog, for as long as they take.
A refresh placed after that guard would let the heartbeat go stale exactly when the parent is most demonstrably alive, and every *other* forwarding child would fast-fail against it.

So the refresh runs first:

```typescript
this.timer = setInterval(() => {
  // Before the processing guard: a session whose human is deliberating at the
  // dialog is still serving, and must not read as stale to another child.
  this.refreshServing();
  if (!this.context || this.processing) {
    return;
  }
  // …unchanged drain…
}, PERMISSION_FORWARDING_POLL_INTERVAL_MS);
```

`refreshServing()` calls `this.deps.serving.markServing(this.servingSessionId)` when that id is non-null.
The `serving_started` / `serving_stopped` log lines keep their existing change-detected placement in `announceServing` / `withdrawServing`, so per-tick refreshing adds no log volume.

### 7. Composition

`ForwardingManager` keeps its single `serving: ServingAnnouncer` dep; the two channels are fanned out by a composer placed beside the interface it composes:

```typescript
// src/authority/serving-registry.ts
export function composeServingAnnouncers(
  ...announcers: readonly ServingAnnouncer[]
): ServingAnnouncer;
```

```typescript
// src/index.ts
const servingRegistry = getServingSessionRegistry();
const heartbeats = new ServingHeartbeatStore({
  forwardingDir: paths.forwardingDir,
  logger,
});
const livenessJudge = new ForwardingLivenessJudge({
  registry: servingRegistry,
  heartbeats,
});

new ForwardingManager({
  ...,
  serving: composeServingAnnouncers(servingRegistry, heartbeats),
});

new AuthorizerSelection({ ..., serving: livenessJudge });
```

A child process constructs the store too and never writes with it: its `ForwardingManager.start` takes the non-qualifying branch, so `withdrawServing` early-returns on a `null` id and `markServing` is never called.

### 8. The abandonment record

The model-visible reason is unchanged — one string for both channels:

```text
Session '<target>' is not serving forwarded permission requests
```

The discriminator belongs in the log, not the block message: the agent cannot act on "stale versus absent," and ADR 0011 §7's agent renderer identifies the call rather than narrating infrastructure.
`forwarded_permission.no_serving_session` gains the observation, keeping its existing `servingSessionIds` key so an existing log reader still parses:

```typescript
this.logger.review("forwarded_permission.no_serving_session", {
  requestId,
  requesterSessionId,
  targetSessionId,
  servingChannel: observation.channel,   // "registry" | "heartbeat" | "none"
  servingState: observation.state,       // "absent" | "stale" | "dead_pid" | null
  servingSessionIds: observation.servingIds,
});
```

## Module-Level Changes

### New files

| File                                         | Contents                                                                                                                                                                                                                                                             |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/authority/forwarding-liveness.ts`       | `ServingHeartbeat`, `HeartbeatState`, `HeartbeatReader`, `ServingHeartbeatStore`, `TargetServingLookup`, `ServingObservation`, `ForwardingLivenessJudge`, `SERVING_HEARTBEAT_REFRESH_MS`, `SERVING_HEARTBEAT_STALE_MS`, `servingHeartbeatDir`/`servingHeartbeatPath` |
| `test/authority/forwarding-liveness.test.ts` | Store write/throttle/withdraw/prune, reader classification across all four states, judge dispatch across all three `source` values                                                                                                                                   |

### Changed source files

| File                                     | Change                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/authority/permission-forwarding.ts` | Export `encodeSessionIdForPath` so the heartbeat layout shares the session-id encoding rather than re-deriving it                                                      |
| `src/authority/serving-registry.ts`      | Add `composeServingAnnouncers`; note on `markServing` that it doubles as the refresh call and must stay idempotent                                                     |
| `src/authority/forwarding-manager.ts`    | Refresh the announcement on each tick, **before** the `processing` guard; `serving_started`/`serving_stopped` logging unchanged                                        |
| `src/authority/approval-escalator.ts`    | `ParentAuthorizerDeps.serving` becomes `TargetServingLookup`; `checkServingLiveness` loses its `source` branch; the `no_serving_session` entry carries the observation |
| `src/authority/authorizer.ts`            | `AuthorizerSelectionDeps.servingRegistry: ServingLookup` → `serving: TargetServingLookup`; `selectAuthorizer` threads it into `ParentAuthorizer`                       |
| `src/index.ts`                           | Construct `ServingHeartbeatStore` and `ForwardingLivenessJudge`; compose the announcers for `ForwardingManager`; pass the judge to `AuthorizerSelection`               |

### Changed test files

| File                                        | Change                                                                                                           |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `test/authority/forwarding-manager.test.ts` | Refresh-per-tick assertions, including refresh while `processing` is true and no extra `serving_started` lines   |
| `test/authority/approval-escalator.test.ts` | `serving` fake becomes a `TargetServingLookup`; new env-target fast-fail and fresh-heartbeat-keeps-waiting cases |
| `test/authority/authorizer.test.ts`         | Renamed `AuthorizerSelectionDeps` field                                                                          |
| `test/helpers/authorizer-fixtures.ts`       | `servingRegistry:` default becomes a `serving:` `TargetServingLookup`                                            |
| `test/helpers/forwarding-fixtures.ts`       | `alwaysServing` becomes a target-keyed `TargetServingLookup`; add a heartbeat-writing helper for the round trip  |
| `test/composition-root.test.ts`             | New end-to-end case: an env-resolved target with no heartbeat denies fast; with a fresh one, it keeps waiting    |

Verified by grep at planning time: `ServingLookup` has exactly three `src/` references (`approval-escalator.ts`, `authorizer.ts`, `serving-registry.ts`) and `servingRegistry` exactly three (`index.ts` ×2, `authorizer.ts`); the six touched test files are the complete set matching `ServingLookup|servingRegistry|markServing|getServingSessionRegistry`.
No export is removed — `ServingLookup` and `ServingSessionRegistry` both remain, since the judge consumes them.
No file listed here is claimed as unchanged in Non-Goals.

### Documentation

| File                                               | Change                                                                                                                                                                                                                                    |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/subagent-integration.md`                     | Rewrite lines 71–72 ("This liveness signal is process-local … still waits the full timeout"), which this change makes false; add the heartbeat, the four detected states, and the upgrade-ordering note                                   |
| `docs/configuration.md`                            | Line 106's `forwardingTimeoutMs` row says "A child whose **in-process** parent is not draining its inbox gives up in ~2 s regardless" — widen to both channels                                                                            |
| `docs/architecture/architecture.md`                | Module-tree entry for `authority/forwarding-liveness.ts`; amend the `forwarding-manager.ts` and `approval-escalator.ts` entries; mark Step 5 `✅` on the heading and the `S5` Mermaid node with a `Landed:` note; health-metric row 0 → 1 |
| `.pi/skills/package-pi-permission-system/SKILL.md` | Line 64 states the judgement applies **only** to `source: "registry"` and links [#721] as the follow-up — rewrite for the two-channel judge                                                                                               |

Greps run at planning time to build this list: `in-process|out-of-process|process-local` across `docs/*.md`, `README.md`, and `.pi/skills/package-*/SKILL.md` (the reworded-prose case, which carries no removed symbol to match) returned exactly the four rows above plus three unrelated mentions (`cross-extension-api.md` on service publication, `subagent-integration.md` lines 6/33/99–100 on registration and the extension table, `README.md` line 25 on registration) that stay correct.

## Test Impact Analysis

**Newly possible tests.**
Injecting `now`, `pid`, and `isProcessAlive` into `ServingHeartbeatStore` makes throttling, staleness, and dead-pid classification pure unit tests with no sleeping and no real process manipulation — today none of these behaviors exists to test.
`ForwardingLivenessJudge` makes the three-way provenance dispatch directly assertable, where [#719] could only observe it indirectly through `ParentAuthorizer`'s poll loop.
The refresh-while-`processing` invariant (§6) is a new test that has no equivalent today because the announcement was previously made once per session and never decayed.

**Tests that become redundant.**
None.
`test/authority/serving-registry.test.ts` still pins the in-process contract, which this change consumes rather than replaces.

**Tests that must stay as-is.**
`test/authority/forwarding-io.test.ts` pins the [#398] `responses/`-removal ordering — untouched, and the sibling-directory placement (§2) is what keeps it untouched.
`test/composition-root.test.ts`'s `subagent registry sharing` test pins the [#296] cross-instance registry contract and the [#302] publication guard.
The existing in-process fast-fail tests in `approval-escalator.test.ts` keep their behavior; only the fake's type changes.

## Invariants at risk

| Invariant                                                                           | Source               | Pinned by                                                                                   |
| ----------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------- |
| An in-process target that *is* serving is waited on for the full timeout            | [#719]               | `test/authority/approval-escalator.test.ts` (existing)                                      |
| Every abandonment path sets `confirmationUnavailable` with a path-naming reason     | [#719]               | `test/authority/approval-escalator.test.ts` (existing; new path routes through `abandon()`) |
| Abandonment discards the request so a late answer cannot arrive                     | [#719]               | Existing `discardRequest` assertions; add one on the env path                               |
| `responses/` is never removed while a request is pending                            | [#398]               | `test/authority/forwarding-io.test.ts` — untouched by construction                          |
| `serving_started` is logged once per session id, not per tick                       | [#719]               | `test/authority/forwarding-manager.test.ts` — extend with the refresh case                  |
| A serving session with a human at the dialog still reads as alive to other children | **new, this change** | New `forwarding-manager.test.ts` case: refresh fires while `processing` is true             |

The invariant this change **deliberately** breaks is [#719]'s "an `env`-resolved target is never fast-failed."
That is the issue's entire purpose, and the replacement rule (absence of a heartbeat means not serving) was chosen at the clarification gate over the skew-proof alternative.

Quantitative claims, all derived from constants read at planning time rather than estimated: `PERMISSION_FORWARDING_POLL_INTERVAL_MS = 250`, `PERMISSION_FORWARDING_SERVING_GRACE_MS = 2000`, `PERMISSION_FORWARDING_TIMEOUT_MS = 600000`, refresh `1000`, staleness `5000`, write rate 1/s per serving session.
The health metric `ls packages/pi-permission-system/src/authority | grep -c "forwarding-liveness"` was measured at **0** and targets **1**.

## TDD Order

Steps 1–3 build the module nothing imports yet, so they are `refactor:` regardless of newness (AGENTS.md); step 4 is the first observable behavior.

1. **Heartbeat store — publish and withdraw.**
   Red: `test/authority/forwarding-liveness.test.ts` — `markServing` writes `<forwardingDir>/serving/<encoded>.json` containing `{ sessionId, pid, updatedAt }` at owner-only mode; a second `markServing` inside the refresh window does not rewrite; one after it does; `clearServing` deletes the record and leaves the directory; `clearServing` on an unmarked id is a no-op.
   Green: `src/authority/forwarding-liveness.ts` (record, constants, path helpers, write side) plus exporting `encodeSessionIdForPath` from `permission-forwarding.ts`.
   `refactor(pi-permission-system): add a filesystem serving-heartbeat store`
2. **Heartbeat store — read, classify, prune.**
   Red: `read()` returns `absent` with no file, `alive` for a fresh record with a live pid, `stale` past `SERVING_HEARTBEAT_STALE_MS`, `dead_pid` when `isProcessAlive` says otherwise, and `absent` for an unparseable record; `servingIds()` lists decoded ids; the first `markServing` prunes dead-pid records and leaves live ones.
   Green: read side and prune on `ServingHeartbeatStore`.
   `refactor(pi-permission-system): read, classify, and prune serving heartbeats`
3. **The liveness judge.**
   Red: `isServing` returns the registry's answer for `source: "registry"`, the heartbeat's for `"env"`, and `null` for `"self"`; `describe` names the channel, the heartbeat state, and the ids from the channel that answered.
   Green: `TargetServingLookup`, `ServingObservation`, `ForwardingLivenessJudge`.
   `refactor(pi-permission-system): judge forwarding-target liveness by resolution source`
4. **Publish the heartbeat while draining.**
   Red: `test/authority/forwarding-manager.test.ts` — the tick refreshes the announcement; it refreshes **while `processing` is true**; a refresh logs no additional `serving_started`; `stop()` still clears.
   Green: `composeServingAnnouncers` in `serving-registry.ts`, the refresh-before-guard in `ForwardingManager`, `index.ts` composition.
   `feat(pi-permission-system): publish a serving heartbeat while draining the inbox`
5. **Fast-fail an unserved out-of-process target.**
   Red: `test/authority/approval-escalator.test.ts` — an `env` target with no heartbeat abandons after the grace with `confirmationUnavailable` and the not-serving reason; one with a fresh heartbeat keeps waiting; the review entry carries `servingChannel`/`servingState`; the request is discarded.
   Green: `ParentAuthorizerDeps.serving: TargetServingLookup`, the collapsed `checkServingLiveness`, the enriched review entry, the `AuthorizerSelectionDeps` rename, `index.ts`, and both fixtures.
   One commit: the dep's type change breaks every construction site at the type level, so the extraction, the consumers, and the consumer tests cannot be split.
   `fix(pi-permission-system): fail fast when an out-of-process parent is not serving`
6. **End-to-end coverage.**
   Red: `test/composition-root.test.ts` — an env-resolved forwarded ask whose target has no heartbeat denies promptly instead of hanging; one with a hand-written fresh heartbeat is still waiting when the parent answers.
   Green: no production change expected; if one is needed the wiring is wrong.
   `test(pi-permission-system): cover the out-of-process forwarding round trip`
7. **Documentation and the roadmap mark.**
   `docs/subagent-integration.md`, `docs/configuration.md`, `docs/architecture/architecture.md` (module-tree entry, Step 5 `✅` on heading and Mermaid node, `Landed:` note, metric row 0 → 1), `.pi/skills/package-pi-permission-system/SKILL.md`.
   `docs(pi-permission-system): document out-of-process forwarding liveness`

## Risks and Mitigations

| Risk                                                                                            | Mitigation                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **A parent with a human at the dialog goes stale, and every other child fast-fails against it** | The refresh runs before `ForwardingManager`'s `processing` guard (§6), pinned by a dedicated test in step 4. This is the failure the design is most exposed to and the one test that must not be dropped |
| A parent session on an older version is fast-failed by a newer child                            | The operator's decision at the clarification gate, taken with the cost stated. The denial is truthful and names the target; `docs/subagent-integration.md` carries the upgrade-the-parent-first ordering |
| Pid reuse makes a dead parent's record look alive                                               | Classification falls through to staleness, so the target still fast-fails ~5 s later — the safe direction, and no worse than 600 s                                                                       |
| Pruning deletes a live session's record after pid reuse                                         | The owner rewrites within `SERVING_HEARTBEAT_REFRESH_MS` (1 s), inside the 2 s grace, so no child abandons in the window                                                                                 |
| A shared or networked `forwardingDir` makes pid comparison meaningless                          | `forwardingDir` is derived under the local agent dir (`extension-paths.ts`); noted as an assumption rather than defended, since a shared forwarding tree breaks the file protocol in other ways already  |
| Write churn — one atomic write per second per serving session                                   | Measured from the constants, not estimated. A `utimesSync` touch would be cheaper but the read needs the pid anyway, and a whole-file write keeps the record self-describing; deferred, not adopted      |
| The `serving/` directory is never removed                                                       | Deliberate: removing it reintroduces the [#398] ENOENT write-race class. One empty directory is the cheaper trade, and it is stated in the module doc comment so it does not read as an oversight        |
| The dep-type change in step 5 touches six test files at once                                    | The change is a fake's shape (`isServing(id)` → `isServing(target)`), not a rewrite; `pnpm run check` catches every site, and the fixture defaults absorb it in two places                               |

## Open Questions

- Whether [#722]'s undiagnosed stall turns out to be a shape the heartbeat cannot see (a running loop that skips a request).
  If it does, the per-request claim declined here becomes the obvious next mechanism — but it needs [#722]'s diagnosis first, not a speculative build, so nothing is filed for it now.
- Whether the 5 s staleness threshold is generous enough on a heavily loaded host where a synchronous parse or a large `readdirSync` can delay a Node timer.
  It is five consecutive missed refreshes, and the dead-pid check covers the crash case independently, so the exposure is narrow; revisit only if a report shows a false `stale` classification.

[#296]: https://github.com/gotgenes/pi-packages/issues/296
[#302]: https://github.com/gotgenes/pi-packages/issues/302
[#398]: https://github.com/gotgenes/pi-packages/issues/398
[#719]: https://github.com/gotgenes/pi-packages/issues/719
[#721]: https://github.com/gotgenes/pi-packages/issues/721
[#722]: https://github.com/gotgenes/pi-packages/issues/722
[#735]: https://github.com/gotgenes/pi-packages/issues/735
[#745]: https://github.com/gotgenes/pi-packages/issues/745
