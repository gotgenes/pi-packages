---
issue: 1011
issue_title: 'pi-permission-system: review log labels config/default-covered external_directory bypasses as "session_approved"'
---

# Bash external-directory bypass: stamp `session_approved` only for a session grant

## Release Recommendation

**Release:** ship independently

Issue #1011 is not a step in the package's architecture roadmap (`grep '#1011' docs/architecture/architecture.md` finds nothing), so it carries no `Release:` batch tag.

## Problem Statement

When every outside-CWD path in a bash command is already allowed, `describeBashExternalDirectoryGate` short-circuits with a `GateBypass` that writes `permission_request.session_approved` and `decidedBy: { kind: "session_approval", surface: "external_directory", pattern: null }`.
It does so whatever allowed the paths: a session grant, a config rule, or the synthesized universal fallback.
So under `{ "permission": { "*": "allow" } }`, `head -1 /etc/hostname` shows no prompt yet logs a session approval nobody gave.
An operator auditing the log reads "the gate fired and was approved" when the gate never fired, and the reporter ran with an open boundary for about three weeks believing it was verified.
Genuine session grants and policy allows are indistinguishable in the log.

The reporter (a third party) also points out that the `external_directory` docs never say what happens when the key is absent, while the `path` surface does.

## Goals

- A bash command whose external paths are all allowed by config or the universal default writes **no** review-log entry: that is how `GateRunner` already treats every policy allow, and how `bash-path.ts`'s sibling bypass already behaves.
- A bash command whose external paths are all allowed, with **at least one** covered by a session grant, keeps the `session_approved` bypass, and its `externalPaths` lists only the session-covered paths, so the entry never attributes a config-covered path to a grant.
- `docs/configuration.md` states the absent-`external_directory`-key behavior, mirroring the `path` surface's sentence.
- Non-breaking: no default, decision, or `permissions:decision` event changes (the bypass never emitted one); only mislabeled review-log lines disappear or narrow.
  Commit type `fix(pi-permission-system):`.

## Non-Goals

- A new "policy allowed" review event or a `kind: "rule"` bypass (the issue's alternative suggestion).
  The operator chose consistency with the runner: no gate logs a policy allow today, and adding one for this gate alone would make it the only surface that does.
- Logging policy allows across all gates — a separate product decision, not filed.
- `bash-path.ts`: its bypass already requires `allSessionCovered`, so it never mislabels; its "all session" (versus this plan's "any session") rule stays as is.
  The assessor declined unifying the two: they differ in the `matchedPattern === undefined` compatibility skip and the deny short-circuit.
- The single-path tool gate `external-directory.ts` and its tests: config allows go through `GateRunner`, which already logs nothing and attributes session hits correctly.
- Emitting a `permissions:decision` event from the bypass (the runner's session-hit path emits one; this bypass never has) — unchanged here.
- Issue [#881] (path-surface ask blame) also edits `bash-external-directory.ts`, but only the descriptor's `logContext`, not the bypass branch; no sequencing dependency, at most a textual rebase.

## Background

- `src/handlers/gates/external-directory-policy.ts` — `selectUncoveredExternalPaths(accesses, resolver, agentName)` resolves each external access on its effect's `external_directory`-family surface and keeps the entries whose `check.state !== "allow"` as `uncovered`, plus the `worstCheck`.
  It filters on state, not source, deliberately: a config allow must suppress the prompt just as a session allow does.
  Its only `src/` consumer is `describeBashExternalDirectoryGate`; `UncoveredExternalPaths` has no importers.
- `src/handlers/gates/bash-external-directory.ts` — when `uncovered` is empty it returns the bypass with the hardcoded `session_approval` stamp.
- `src/handlers/gates/runner.ts` — `run(null)` returns `{ action: "allow" }` with no side effects; a bypass writes `gate.log` with `decidedBy` and allows.
  So swapping a bypass for `null` changes only the review log, never the allow.
- A resolved `PermissionCheckResult` distinguishes the three coverage sources: a session rule gives `source: "session"`; a config rule gives `source: "special"` with `matchedPattern`; the universal fallback gives `source: "special"` with `matchedPattern` undefined (`buildCheckResult` / `deriveSource` in `src/policy/permission-manager.ts`).
- The package skill's log-writes rule: every `decidedBy` "is stamped at the site that decides, never inferred" — this fix makes the stamp true rather than adding inference.

## Design Overview

### Reproduction

Reproduced through the real `PermissionManager` (`createManager`) + `PermissionResolver` + `SessionRules`, a real `BashProgram.parse`, and the reporter's literal command `head -1 /etc/hostname` (a disposable spike, deleted).
Measured results:

| Config                                                                  | Gate result                                    | Path check                                                            |
| ----------------------------------------------------------------------- | ---------------------------------------------- | --------------------------------------------------------------------- |
| `{ "*": "allow" }`                                                      | bypass, `session_approval`, `session_approved` | `allow`, `source: "special"`, no `matchedPattern`, `origin: "global"` |
| `{ "*": "ask", external_directory: { "*": "ask", "/etc/*": "allow" } }` | bypass, `session_approval`, `session_approved` | `allow`, `source: "special"`, `matchedPattern: "/etc/*"`              |
| `{ "*": "ask" }`                                                        | ask descriptor                                 | `ask`, `source: "special"`                                            |

The operator's own review log (measured, 23122 lines) holds 10472 `session_approved` entries carrying `externalPaths` (this bypass) against 169 `approved_for_session` external-directory grants; one grant can cover many calls, so the share that was config-covered is estimated, not measured, to be most of them.

### Decision model

Over the resolved per-path checks, with `allowed` meaning `state === "allow"`:

| Paths                                     | Result                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| Any path not allowed                      | ask/deny descriptor (unchanged)                                                |
| All allowed, none session-covered         | `null` — no review entry                                                       |
| All allowed, at least one session-covered | `GateBypass`, `session_approval`, `externalPaths` = session-covered paths only |

"At least one" rather than "all": a session grant was consumed, and recording that is the audit fact; listing only the session-covered paths keeps a config-covered path out of the grant's entry.
`pattern: null` stays (paths may match different session patterns).

### Shape change

```typescript
/** Every external path's coverage, split by what the gate does with it. */
export interface ExternalPathCoverage {
  uncovered: UncoveredExternalPath[];
  /** Allowed paths whose winning rule was a session grant (`source: "session"`). */
  sessionCovered: AccessPath[];
  worstCheck: PermissionCheckResult | undefined;
}
```

The selector loop gains one branch beside the existing `state !== "allow"` push:

```typescript
if (check.state !== "allow") {
  uncovered.push({ path, surface, effect, check });
} else if (check.source === "session") {
  sessionCovered.push(path);
}
```

The gate's empty-`uncovered` branch becomes:

```typescript
if (uncoveredEntries.length === 0) {
  if (sessionCovered.length === 0) return null;
  return { action: "allow", decidedBy: { kind: "session_approval", … },
    log: { …, details: { …, externalPaths: sessionCovered.map((p) => p.value()) } } };
}
```

`sessionCovered` carries `AccessPath` only (the one field the gate reads), not the full entry — ISP.

## Module-Level Changes

- `src/handlers/gates/external-directory-policy.ts` — rename `UncoveredExternalPaths` → `ExternalPathCoverage` (step 1); add `sessionCovered` and the `else if` branch; reword the selector JSDoc (step 2).
  The function name `selectUncoveredExternalPaths` stays: it still selects the uncovered set, and renaming it churns one `src/` and five test call sites.
- `src/handlers/gates/bash-external-directory.ts` — destructure `sessionCovered`; split the empty-`uncovered` branch into `null` / bypass; `externalPaths` from `sessionCovered`; reword the function JSDoc ("Returns a `GateBypass` when all paths are allowed (by config or session rule)"), the comment above the selector call, and the bypass comment.
- `test/handlers/gates/external-directory-policy.test.ts` — new `sessionCovered` tests.
- `test/handlers/gates/bash-external-directory.test.ts` — the config-allowed bypass test flips to `null`; new default-coverage, mixed-coverage, and real-resolver tests; the session-covered test asserts the full log details.
- `test/handlers/external-directory-symlink-acceptance.test.ts` — the bash case (line ~169, config allow on the symlinked path) flips `isGateBypass(result)` → `expect(result).toBeNull()`; its comment changes to "covered by a config allow → no gate, no prompt".
- `docs/architecture/architecture.md` — the `external-directory-policy.ts` and `bash-external-directory.ts` module-tree entries (lines ~977–978): the selector also returns the session-covered paths; the bypass fires only when a session grant covered at least one path, and config/default-only coverage returns `null`.
- `docs/configuration.md` — `### external_directory Surface`: one paragraph stating that with no `external_directory` key the universal fallback applies, so `"*": "allow"` lets every outside-CWD access through with no prompt and, like every policy allow, no review-log entry.

Predicted unchanged (blast radius checked):

- `test/handlers/tool-call.test.ts` (~418, `external_directory` allow → `{ action: "allow" }`): `null` also allows.
- `test/handlers/gates/bash-effect-invariants.test.ts`: no `isGateBypass` or `session_approved` assertions (assessor-verified; re-check in step 2's full run).
- `test/handlers/gates/external-directory.test.ts`: the single-path gate's bypasses (infrastructure reads), untouched.
- `test/composition-root.test.ts` directional-relief cases: outcomes are prompt counts and block flags, which `null` preserves.
- `docs/session-approvals.md` `## Review Log Entries` and `docs/cross-extension-api.md` resolution table: `session_approved` still means "matched an existing session rule", which is now true for every entry.

## Test Impact Analysis

1. New tests enabled: the selector's three-way split (uncovered / session-covered / config-or-default-covered) is directly unit-testable; a real-resolver test pins the reporter's scenario end to end.
2. Redundant tests: none; the config-allowed bypass test is rewritten, not removed, because its prompt-suppression claim (no descriptor) still holds as `null`.
3. Kept as-is: the uncovered/worst-check/directional/grant tests exercise the descriptor branch this change does not touch.

## Invariants at risk

- [#418] alias matching (a config allow on the typed symlink path covers the canonical target): pinned by `external-directory-symlink-acceptance.test.ts`, real manager + resolver; after step 2 it asserts `null` (allowed, no gate), which still fails if the allow stopped matching (that yields a descriptor).
- Config allows suppress the prompt (the reason the selector filters on state): pinned by the rewritten config-allowed test, which asserts `null`, not a descriptor.
- [#810] per-path directional grants: the descriptor branch is unchanged; pinned by the existing `directional routing` tests.
- `decidedBy` stamped at the deciding site: after the fix, a `session_approval` stamp appears only when `sessionCovered` is non-empty; pinned by the new tests.

## TDD Order

1. **`refactor(pi-permission-system): name the external-path selector result for coverage, not only the uncovered set`** Rename `UncoveredExternalPaths` → `ExternalPathCoverage` in `external-directory-policy.ts` (type is unimported; one-line rename plus JSDoc).
   Prepares step 2, which adds `sessionCovered` to a type whose old name it would contradict.
   No test change; verify with `pnpm --filter @gotgenes/pi-permission-system run check`.
2. **`fix(pi-permission-system): stop logging config- and default-allowed bash external paths as session approvals`**
   - `test/handlers/gates/external-directory-policy.test.ts` (new `describe("session coverage")`): a `source: "session"` allow lands in `sessionCovered` and not `uncovered`; a config allow (`source: "special"`, `matchedPattern` set) and a default allow (no `matchedPattern`) land in neither; an ask lands in `uncovered` only.
   - `test/handlers/gates/bash-external-directory.test.ts`:
     - rewrite "returns GateBypass when all external paths are config-level allowed" → "writes no entry when every path is config-allowed": `expect(result).toBeNull()`.
     - new: default-covered (`makeCheckResult("allow")`, no `matchedPattern`) → `null`.
     - strengthen the session-covered test to `toEqual` on the full `log` (`event`, and `details` including `externalPaths: ["/outside/project/file.ts"]`).
     - new mixed: `diff /outside/a.ts /outside/b.ts` with `a` session-allowed and `b` config-allowed → bypass whose `details.externalPaths` is exactly `["/outside/a.ts"]`.
     - new real-resolver describe (`createManagerWithConfig` + `PermissionResolver` + `SessionRules`): `{ "*": "allow" }` with the reporter's `head -1 /etc/hostname` → `null`; same config after `sessionRules.approve("external_directory_read", "/etc/*")` → `session_approved` bypass.
   - `test/handlers/external-directory-symlink-acceptance.test.ts`: flip the bash case to `toBeNull()` in the same commit (it breaks here).
   - Implement the `sessionCovered` branch and the `null`/bypass split; reword the JSDoc and comments named in Module-Level Changes.
   - Killing mutations:
     - make the selector's branch `else { sessionCovered.push(path); }` (drop the `source === "session"` test) → the selector's config/default tests and the gate's config/default/real-resolver `null` tests go red.
     - delete `if (sessionCovered.length === 0) return null;` → every `null` test goes red (bypass returned).
     - build `externalPaths` from `externalAccesses` instead of `sessionCovered` → the mixed test goes red.
   - Run the full package suite (shared selector), then `check`.
   - Commit body ends with `Refs #1011`, then a final trailer paragraph: `Co-authored-by: Aleksander Kruszelnicki <10740345+alkrusz@users.noreply.github.com>` (the reporter supplied the diagnosis and the "stamp `session_approval` only when a session-layer rule matched" mechanism the session branch adopts).
3. **`docs(pi-permission-system): say what external_directory does when the key is absent`** `docs/configuration.md` paragraph, and the two `docs/architecture/architecture.md` module-tree entries.
   Verify with `pnpm exec rumdl check` on both files.

## Risks and Mitigations

- **An operator relying on the old entries to see outside-CWD bash activity loses them.**
  They were mislabeled; the honest record of a policy allow is the one every other gate gives (none), and the docs paragraph names the absent-key fallback that caused the reporter's surprise.
- **Mixed coverage now lists fewer `externalPaths`.**
  Intentional (operator decision); the mixed test pins it.
- **A future fourth coverage source (a new rule layer) defaults to "not session"**, so it writes no entry rather than a false grant — the fail-honest direction.

## Open Questions

None.

[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#810]: https://github.com/gotgenes/pi-packages/issues/810
[#881]: https://github.com/gotgenes/pi-packages/issues/881
