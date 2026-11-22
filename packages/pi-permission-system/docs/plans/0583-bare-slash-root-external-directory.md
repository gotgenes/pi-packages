---
issue: 583
issue_title: "pi-permission-system: bare-slash `find /` bypasses the external_directory gate"
---

# Treat a bare `/` as a filesystem-root path candidate

## Release Recommendation

**Release:** ship independently

This is a standalone gate-tightening bug fix, not a member of any roadmap batch.
The architecture roadmap has no step referencing #583, so it releases on its own as a `fix:` — the same class as the sibling gate-tightening fixes #481 (floor opaque wrappers) and #490 (floor `find`/`fd` exec wrappers), both shipped as independent `fix:` commits.

## Problem Statement

`find /` scans the entire filesystem from root, but its `/` argument is dropped before any path gate sees it, so a whole-filesystem search runs with no `external_directory` prompt.
The only external-directory access in that command rides on the single `/` token, and every bash token classifier runs a shared rejection prelude, `rejectNonPathToken`, whose `/^\/+$/` branch drops any all-slashes token as "never meaningful path arguments in practice."
That premise is wrong for search and list tools: `find /`, `ls /`, `grep -r pat /`, and `rg x /` all pass a bare `/` as a deliberate filesystem-root argument — exactly the external-directory access the gate exists to catch.
The rejection came from the upstream fork's #68, which over-corrected to suppress a spurious prompt on `echo //` and in doing so silenced a legitimate high-risk access.

## Goals

- A bare `/` (and `//`, `///`) reaching the bash gate is treated as an absolute path resolving to filesystem root, which is outside any project cwd, so it triggers the `external_directory` gate under the default `ask` policy.
- The same tokens become `path`-surface rule candidates, so a `path` rule for `/` can match them, consistent with every other absolute token.
- Behavior stays consistent with the package's command-agnostic path model: a bare `/` is gated the same way `/etc` and `/usr` already are, regardless of which command consumes it.

## Non-Goals

- No command-awareness.
  This fix does not make the gate distinguish `find /` (real access) from `echo /` (prints a slash); the package gates path-shaped tokens regardless of the consuming command, and `echo /etc/passwd` already prompts today.
  `echo /` prompting is the consistent consequence, not a separate feature.
- No change to any config default.
  The `external_directory` default remains `ask`; a user with `external_directory: allow` sees no change.
- No win32-specific new mechanism.
  On win32 a bare `/` already resolves through the existing `posix-absolute` literal-only branch (#533) and is foreign to the win32 cwd, so it is external there too — no new code path is needed.

## Background

The relevant module is `src/access-intent/bash/token-classification.ts`, which exports three pure classifiers consumed by `src/access-intent/bash/bash-path-resolver.ts`:

- `classifyTokenAsPathCandidate` — the strict gate feeding `projectExternalPaths` (the `external_directory` surface).
- `classifyTokenAsRuleCandidate` — the broad gate feeding `projectRuleCandidates` (the `path` surface).
- `classifyPromotedRuleCandidate` — rule-driven promotion of a bare filename (#509).

All three call the private `rejectNonPathToken` prelude first.
Its bare-slash branch is the single point that drops `/`:

```typescript
// Bare-slash tokens (/, //, ///) resolve to filesystem root and are never
// meaningful path arguments in practice.
if (/^\/+$/.test(token)) return true;
```

Removing this branch flips all three classifiers together, which is the desired, consistent outcome:

- `classifyTokenAsPathCandidate("/")` then returns `/` via its `token.startsWith("/")` branch.
- `classifyTokenAsRuleCandidate("/", posixPathFlavor)` returns `/` via `flavor.hasPathSeparator("/")`.
- `classifyPromotedRuleCandidate` no longer pre-rejects `/`, though promotion still requires a matching specific `path` rule.

Downstream resolution needs no change.
In `projectExternalPaths`, a `/` candidate is absolute (not relative), so it takes the main branch: `forBashToken("/")` yields lexical value `/` and boundary value `/`, and `isBoundaryOutsideWorkingDirectory("/")` is `true` because `/` is an ancestor of any project cwd (`path.posix.relative(cwd, "/")` starts with `..`).
`//` and `///` normalize to `/` (verified: `path.posix.normalize("//") === "/"`), so all three collapse to the same external root.
`/` is not in `SAFE_SYSTEM_PATHS` (only the four `/dev/*` device files are), so the safe-path exclusion in `isPathOutsideWorkingDirectory` does not suppress it.

AGENTS.md constraints that apply:

- Default to least privilege; when in doubt, prompt.
  This fix restores a prompt the gate should already produce.
- Wildcard/shape matching must be explicit and tested — silent over-matching (or here, silent under-matching) is a permission bypass.
  The flipped tests pin the corrected shape.

## Design Overview

The change is the removal of one predicate branch plus its now-inverted tests.

Decision model, before and after, for a bare `/` token:

| Surface              | Classifier                      | Before                | After                                                     |
| -------------------- | ------------------------------- | --------------------- | --------------------------------------------------------- |
| `external_directory` | `classifyTokenAsPathCandidate`  | `null` (dropped)      | `/` → resolved external → prompt                          |
| `path`               | `classifyTokenAsRuleCandidate`  | `null` (dropped)      | `/` → rule candidate                                      |
| `path` (promotion)   | `classifyPromotedRuleCandidate` | `null` (pre-rejected) | eligible; promoted only if a specific `path` rule matches |

Edge cases:

- `//` and `///` normalize to `/` and follow the same external path.
  The integration tests assert the resolved external set is `["/"]` for each.
- `@/foo` is unaffected: the `@`-guard admits `@/…`, and the removed bare-slash branch never matched a token with content after the slashes.
- `//server/share` (a UNC-shaped token, relevant only on win32) is unaffected: it has content after the leading slashes, so `/^\/+$/` never matched it — its behavior was already governed by the resolver, not this branch.
- The `echo //` → `/` outcome is the deliberate, documented behavior change (see Risks).

No new collaborator, type, or module is introduced; this is a subtraction from an existing pure predicate, so there is no Tell-Don't-Ask or ISP surface to sketch.

## Module-Level Changes

- `src/access-intent/bash/token-classification.ts` — remove the `/^\/+$/` branch from `rejectNonPathToken`.
  Update the private predicate's JSDoc (currently lists "bare-slash tokens" among what it rejects) and the module header's rejection-case summary so they no longer claim bare-slash is dropped.
- `test/access-intent/bash/token-classification.test.ts` — invert the two `"bare-slash token → null"` tests: `classifyTokenAsPathCandidate("/" | "//" | "///")` now returns the token; `classifyTokenAsRuleCandidate("/" | "//", posixPathFlavor)` now returns the token.
  Rename the test titles to reflect acceptance (e.g. `"bare-slash token → accepted as root path"`).
- `test/bash-external-directory.test.ts` — rewrite the `describe("bare-slash tokens are skipped")` block to `describe("bare-slash tokens resolve to external root")`:
  - `echo /`, `echo //`, `echo ///` each now return `["/"]`.
  - `echo // hello` now returns `["/"]`.
  - Delete the two "guard is still needed" defense-in-depth tests (they assert the removed branch is necessary; that premise is now false).
  - `cat /etc/hosts; echo //` now returns both `/etc/hosts` and `/`.
  - Add a regression test for the issue's headline: `find /` (and optionally `find / -path "*/pi-coding-agent/*.d.ts"`) returns `["/"]`.

No production symbol is removed or renamed, so no `src/`/`test/` import graph, README, or architecture-layout listing needs updating.
The historical plan `docs/plans/0533-win32-git-bash-posix-paths.md:151` mentions "the bare-slash rejection in `rejectNonPathToken`" in a parenthetical; it is a completed plan record describing the state at that time and is intentionally left unchanged (its conclusion about `//server/share` remains correct).
Grep confirms the package skill and `docs/architecture/` do not reference the bare-slash rejection, so neither needs a doc update.

## Test Impact Analysis

1. New coverage enabled: a direct regression test that `find /` resolves to an external `/` — the exact repro from #583 that produced no prompt.
2. Redundant tests removed: the two "bare-slash guard is still needed" tests in `test/bash-external-directory.test.ts` document the removed branch as necessary defense-in-depth; they are deleted, not migrated.
3. Tests that stay (inverted, not removed): the `token-classification.test.ts` bare-slash unit tests and the `bash-external-directory.test.ts` bare-slash integration block continue to pin the classifier's treatment of `/`, `//`, `///` — now asserting acceptance-as-root rather than rejection.
   They remain the guard against a future re-introduction of the rejection.

## Invariants at risk

This surface was last reworked by #533 (win32 Git Bash POSIX path semantics).
Its documented outcome — a win32 non-mount POSIX absolute resolves literal-only and external — is unaffected here: `/` on win32 still routes through the `posix-absolute` branch and is external.
No #533 test changes behavior.
The #418 external-directory lexical-vs-canonical invariant is likewise untouched: `/` has identical lexical and canonical forms.
No prior step's `Outcome:` invariant is regressed; the flipped tests are additive assertions on a previously-dropped token, not a relaxation of an existing gate.

## TDD Order

1. **`fix`: treat a bare `/` as a filesystem-root path candidate (#583)**
   - RED — invert the classifier unit tests in `test/access-intent/bash/token-classification.test.ts` (both `classifyTokenAsPathCandidate` and `classifyTokenAsRuleCandidate` bare-slash cases now expect the token returned), and rewrite the `bash-external-directory.test.ts` bare-slash block to assert `echo /` / `echo //` / `echo ///` resolve to `["/"]`, add the `find /` regression test, and update `cat /etc/hosts; echo //` to expect both paths.
     Delete the two "guard is still needed" tests.
     Run the suite to confirm the new assertions fail against current code.
   - GREEN — remove the `/^\/+$/` branch from `rejectNonPathToken` in `src/access-intent/bash/token-classification.ts`; update the predicate JSDoc and the module-header rejection summary to drop the bare-slash claim.
   - COMMIT — `fix(pi-permission-system): treat bare / as a filesystem-root path candidate (#583)`.

The whole change is one logical subtraction (one predicate branch) that flips both the classifier and integration surfaces simultaneously; splitting it across commits would leave the integration tests unable to be red after the impl lands, so it is a single red→green→commit cycle.

## Risks and Mitigations

- **Risk: broader prompting.**
  After the fix, any bare `/` token prompts under the default `ask` policy, including harmless cases like `echo /`.
  **Mitigation / rationale:** this is consistent with the package's command-agnostic path model, where `echo /etc/passwd` already prompts today; a bare `/` is no more special than `/etc`.
  It is a fail-safe tightening (over-prompt, never under-gate), which the package explicitly prefers (least privilege; #509 accepts an analogous fail-safe false positive).
  It is a `fix:`, not `fix!:`, matching how #481 and #490 (both added new prompts) were classified — no config default changes, and the gate's documented `ask` contract is merely honored where a token previously escaped it.
- **Risk: reintroducing the original #68 spurious prompt.**
  Issue #68 fixed `echo //` prompting.
  **Mitigation:** that "spurious" prompt was never spurious under the command-agnostic model — it is the same class as `echo /etc` prompting.
  The current tree-sitter parser feeds real argument tokens (not `path.normalize` output), so no manufactured `/` is involved; the flip is deliberate and covered by the rewritten tests.

## Open Questions

None.
The direction is unambiguous and the change is a single-branch subtraction with inverted tests.
