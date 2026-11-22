---
issue: 96
issue_title: "Subagent permission forwarding broken for all major pi-subagent extensions"
---

# Broaden subagent env hint keys for major pi-subagent extensions

## Problem Statement

Permission forwarding relies on `SUBAGENT_ENV_HINT_KEYS` to detect whether the current process is running as a subagent.
Those three keys (`PI_IS_SUBAGENT`, `PI_SUBAGENT_SESSION_ID`, `PI_AGENT_ROUTER_SUBAGENT`) are not set by any of the three major pi-subagent extensions.
As a result, `isSubagentExecutionContext()` returns `false` in child sessions spawned by nicobailon/pi-subagents or HazAT/pi-interactive-subagents, and `resolvePermissionForwardingTargetSessionId()` returns `null` because `PI_AGENT_ROUTER_PARENT_SESSION_ID` is also never set by those extensions.
Any `ask`-state permission in such a headless child session silently denies instead of forwarding the dialog to the parent.

The tintinweb extension runs subagents fully in-process — no env vars are ever set, so detection there cannot rely on env vars at all.
That case is deferred to #29 (event bus RPC).

## Goals

- Broaden `SUBAGENT_ENV_HINT_KEYS` to include the env vars that nicobailon/pi-subagents and HazAT/pi-interactive-subagents actually set in child processes.
- Add a `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` list covering known parent-session env vars so parent-session resolution succeeds for each extension where that information is available.
- Emit a structured debug/review log entry when parent-session resolution fails so users get an actionable message instead of a silent denial.
- Add tests covering detection and parent-session resolution for each extension's env var pattern.
- Document which extensions are now covered and which remain deferred (tintinweb in-process case → #29).

## Non-Goals

- Fixing the tintinweb in-process subagent case (no child process → no env vars; tracked in #29).
- Proposing or enforcing a shared upstream convention across extensions (tracked in #98).
- Changing the file-based forwarding protocol or polling logic.
- Modifying how `yolo-mode` short-circuits the `ask` path.

## Background

### Permission surfaces involved

This issue touches the **forwarding** path that sits above all permission surfaces: when a permission resolves to `ask` in a headless subagent context the extension must forward the dialog to the parent session rather than blocking or silently denying.
No surface-level rule evaluation changes — only the subagent detection and parent-session resolution steps.

### Relevant modules

`src/permission-forwarding.ts`
: Declares `SUBAGENT_ENV_HINT_KEYS`, `SUBAGENT_PARENT_SESSION_ENV_KEY`, and `resolvePermissionForwardingTargetSessionId()`.
    These are the primary targets of this fix.

`src/subagent-context.ts`
: `isSubagentExecutionContext()` iterates `SUBAGENT_ENV_HINT_KEYS` and falls back to session-dir path comparison.
    The path-based fallback works only when the session directory happens to be nested under `subagentSessionsDir`, which is path-layout-dependent and fragile for external extensions.

`src/forwarded-permissions/polling.ts`
: `waitForForwardedPermissionApproval()` calls both `isSubagentExecutionContext()` and `resolvePermissionForwardingTargetSessionId()`.
    When either returns a falsy result the function logs a forwarding error and returns `{ approved: false, state: "denied" }` — the silent denial.

`tests/subagent-context.test.ts`
: Existing tests cover the three original `SUBAGENT_ENV_HINT_KEYS` and the session-dir path fallback.
    New tests for the additional keys go in the same file.

### Extension env var inventory

| Extension                      | Child-process env vars                                                                    | Parent-session env var        |
| ------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------- |
| nicobailon/pi-subagents        | `PI_SUBAGENT_CHILD`, `PI_SUBAGENT_RUN_ID`, `PI_SUBAGENT_CHILD_AGENT`, `PI_SUBAGENT_DEPTH` | none set (no mechanism today) |
| tintinweb/pi-subagents         | none (in-process, deferred)                                                               | n/a                           |
| HazAT/pi-interactive-subagents | `PI_SUBAGENT_NAME`, `PI_SUBAGENT_ID`, `PI_SUBAGENT_SESSION`, `PI_SUBAGENT_ACTIVITY_FILE`  | none set (no mechanism today) |

Neither extension currently sets a parent-session env var.
Parent-session resolution for these extensions will fail at the `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` lookup.
The fix improves the error log to surface this explicitly so users can track progress against #98.

## Design Overview

### 1. Broaden env hint keys

Add the known child-indicator vars from each extension to `SUBAGENT_ENV_HINT_KEYS` in `src/permission-forwarding.ts`:

```typescript
export const SUBAGENT_ENV_HINT_KEYS = [
  // pi-agent-router (original)
  "PI_IS_SUBAGENT",
  "PI_SUBAGENT_SESSION_ID",
  "PI_AGENT_ROUTER_SUBAGENT",
  // nicobailon/pi-subagents
  "PI_SUBAGENT_CHILD",
  "PI_SUBAGENT_RUN_ID",
  "PI_SUBAGENT_CHILD_AGENT",
  "PI_SUBAGENT_DEPTH",
  // HazAT/pi-interactive-subagents
  "PI_SUBAGENT_NAME",
  "PI_SUBAGENT_ID",
  "PI_SUBAGENT_SESSION",
  "PI_SUBAGENT_ACTIVITY_FILE",
] as const;
```

This makes `isSubagentExecutionContext()` return `true` for child processes from both extensions without changing the function's signature or logic.

### 2. Add parent-session env var candidates

The existing `SUBAGENT_PARENT_SESSION_ENV_KEY` is a single string (`"PI_AGENT_ROUTER_PARENT_SESSION_ID"`).
Replace it with an ordered array of candidates so `resolvePermissionForwardingTargetSessionId()` can try each in turn:

```typescript
/** Ordered list of env var names to check for the parent session ID. */
export const SUBAGENT_PARENT_SESSION_ENV_CANDIDATES: readonly string[] = [
  // pi-agent-router (original)
  "PI_AGENT_ROUTER_PARENT_SESSION_ID",
] as const;
```

Neither nicobailon nor HazAT currently sets a parent-session env var, so only the original key appears now.
The array design lets a future step (or a #98 adoption) add more candidates without changing call sites.

`resolvePermissionForwardingTargetSessionId()` is updated to iterate the candidates:

```typescript
export function resolvePermissionForwardingTargetSessionId(options: {
  hasUI: boolean;
  isSubagent: boolean;
  currentSessionId?: string | null;
  env?: NodeJS.ProcessEnv;
}): string | null {
  if (options.hasUI) {
    return normalizePermissionForwardingSessionId(options.currentSessionId);
  }
  if (!options.isSubagent) {
    return null;
  }
  for (const key of SUBAGENT_PARENT_SESSION_ENV_CANDIDATES) {
    const resolved = normalizePermissionForwardingSessionId(options.env?.[key]);
    if (resolved) return resolved;
  }
  return null;
}
```

`SUBAGENT_PARENT_SESSION_ENV_KEY` is kept as a deprecated re-export alias for one release so external callers are not broken:

```typescript
/** @deprecated Use SUBAGENT_PARENT_SESSION_ENV_CANDIDATES */
export const SUBAGENT_PARENT_SESSION_ENV_KEY =
  SUBAGENT_PARENT_SESSION_ENV_CANDIDATES[0];
```

### 3. Improve the failure log message

In `waitForForwardedPermissionApproval()` in `src/forwarded-permissions/polling.ts`, the existing error message names only `PI_AGENT_ROUTER_PARENT_SESSION_ID`.
Update it to list all candidates and mention the open tracking issue:

```typescript
logPermissionForwardingError(
  deps.logger,
  `Permission forwarding target session could not be resolved. ` +
    `Checked env vars: ${SUBAGENT_PARENT_SESSION_ENV_CANDIDATES.join(", ")}. ` +
    `If you are using nicobailon/pi-subagents or HazAT/pi-interactive-subagents, ` +
    `parent-session forwarding is not yet supported for those extensions (see issue #98).`,
);
```

### Edge cases

- A `PI_SUBAGENT_DEPTH=0` value is a non-empty string and will correctly trigger detection; depth-0 is still a subagent context.
- `PI_SUBAGENT_ACTIVITY_FILE` is a file path string; any non-empty value marks the child as a subagent.
- The session-dir path-based fallback in `isSubagentExecutionContext()` is unchanged and remains as a secondary guard.
- Adding keys increases the surface area of "what counts as a subagent"; this is intentional and aligned with least-privilege (forward/ask rather than silently allow in a falsely-non-subagent context).

### Merge precedence impact

No config-level policy change.
The forwarding path sits above rule evaluation; this fix only changes when the extension *decides* to attempt forwarding rather than what decision it makes.

## Module-Level Changes

`src/permission-forwarding.ts`
: - Replace `SUBAGENT_ENV_HINT_KEYS` tuple with the expanded list.
: - Add `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` array.
: - Keep `SUBAGENT_PARENT_SESSION_ENV_KEY` as a deprecated alias.
: - Update `resolvePermissionForwardingTargetSessionId()` to iterate candidates.

`src/forwarded-permissions/polling.ts`
: - Update the "could not resolve" error log message to name all candidates and reference #98.

`tests/subagent-context.test.ts`
: - Add detection tests for each new env hint key (nicobailon group and HazAT group).
: - Add a test asserting `SUBAGENT_ENV_HINT_KEYS` contains every key from both groups.

`tests/permission-forwarding.test.ts` *(new file)*
: - Test `resolvePermissionForwardingTargetSessionId()`:

- hasUI=true returns current session ID.
- isSubagent=false returns null.
- isSubagent=true, none of the candidates set → returns null.
- isSubagent=true, first candidate (`PI_AGENT_ROUTER_PARENT_SESSION_ID`) set → returns its value.
- isSubagent=true, first candidate absent but a hypothetical second set → returns second's value (future-proofing).
- Test `SUBAGENT_PARENT_SESSION_ENV_KEY` is still exported and equals the first candidate.

`docs/architecture/target-architecture.md`
: - Update the subagent-detection section to name the three extensions and their env var sets.
: - Note the tintinweb in-process case as deferred to #29.

## TDD Order

### Step 1 — tests: new env hint key detection

File: `tests/subagent-context.test.ts`

Add test cases that `isSubagentExecutionContext()` returns `true` for each newly added key: `PI_SUBAGENT_CHILD`, `PI_SUBAGENT_RUN_ID`, `PI_SUBAGENT_CHILD_AGENT`, `PI_SUBAGENT_DEPTH`, `PI_SUBAGENT_NAME`, `PI_SUBAGENT_ID`, `PI_SUBAGENT_SESSION`, `PI_SUBAGENT_ACTIVITY_FILE`.

Add a "covers all declared SUBAGENT_ENV_HINT_KEYS" guard test that reads the exported array and asserts each key has an individual test.

These tests are **red** until Step 2.

Commit: `test: cover nicobailon + HazAT subagent env hint keys (#96)`

### Step 2 — feat: broaden SUBAGENT_ENV_HINT_KEYS

File: `src/permission-forwarding.ts`

Expand `SUBAGENT_ENV_HINT_KEYS` with the eight new keys.
No other logic changes.

Step 1 tests turn **green**.

Commit: `feat: broaden SUBAGENT_ENV_HINT_KEYS for nicobailon + HazAT extensions (#96)`

### Step 3 — tests: SUBAGENT_PARENT_SESSION_ENV_CANDIDATES and updated resolver

File: `tests/permission-forwarding.test.ts` *(new)*

Cover:

- `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` is an array containing `"PI_AGENT_ROUTER_PARENT_SESSION_ID"`.
- `SUBAGENT_PARENT_SESSION_ENV_KEY` equals `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES[0]` (deprecated alias still present).
- `resolvePermissionForwardingTargetSessionId` with hasUI=true, isSubagent=false, isSubagent=true+none set, isSubagent=true+first candidate set.

These tests are **red** until Step 4.

Commit: `test: cover SUBAGENT_PARENT_SESSION_ENV_CANDIDATES and resolver (#96)`

### Step 4 — feat: add SUBAGENT_PARENT_SESSION_ENV_CANDIDATES, iterate in resolver

File: `src/permission-forwarding.ts`

- Add `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES`.
- Keep `SUBAGENT_PARENT_SESSION_ENV_KEY` as a deprecated alias.
- Update `resolvePermissionForwardingTargetSessionId()` to iterate the candidates array.

File: `src/forwarded-permissions/polling.ts`

- Update the forwarding-failure log message to list all candidates and reference #98.

Step 3 tests turn **green**.

Commit: `feat: add SUBAGENT_PARENT_SESSION_ENV_CANDIDATES, iterate in resolver (#96)`

### Step 5 — docs: update target architecture

File: `docs/architecture/target-architecture.md`

Document the three extensions, their env vars, and the tintinweb in-process deferral.

Commit: `docs: update target-architecture subagent detection for #96`

## Risks and Mitigations

| Risk                                                                                                                           | Mitigation                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| New env hint keys over-match — a non-subagent process happens to have one of these vars set and is wrongly treated as headless | `PI_SUBAGENT_DEPTH=0` and similar are specific to these extensions; over-match risk is low. The consequence of a false positive is that the extension tries to forward rather than silently allow, which still prompts the user — not a silent bypass. |
| Could this silently weaken a permission?                                                                                       | No. Broadening detection makes more sessions *attempt* forwarding rather than silently denying. The only failure mode is a forwarding attempt that cannot resolve a parent session, which already emits a denial — not an allow.                       |
| `SUBAGENT_PARENT_SESSION_ENV_KEY` removal breaks external callers                                                              | Kept as a deprecated alias for at least one release.                                                                                                                                                                                                   |
| Parent-session resolution still fails for nicobailon and HazAT (no parent-session env var)                                     | The improved error message makes this explicit and points to #98. The silent-denial behavior is unchanged for this specific sub-case until #98 lands.                                                                                                  |
| `PI_SUBAGENT_SESSION` from HazAT is the *child's* session ID, not the parent's                                                 | It is added to `SUBAGENT_ENV_HINT_KEYS` (detection only), not to `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` (resolution). No confusion possible.                                                                                                         |

## Open Questions

- **#98 adoption**: Once nicobailon and HazAT adopt a shared parent-session env var, add it to `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES`.
  Plan is intentionally array-shaped to make that a one-line change.
- **`PI_SUBAGENT_DEPTH=0`**: Depth-0 could mean "top-level orchestrator in a subagent run".
  If that case should be excluded from subagent detection, a depth check could be added — deferred until there is a concrete user report.
- **tintinweb in-process**: No env var approach can fix this; deferred to #29 (event bus RPC).
