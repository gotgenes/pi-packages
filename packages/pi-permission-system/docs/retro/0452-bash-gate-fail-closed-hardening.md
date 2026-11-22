---
issue: 452
issue_title: "Bash permission gates silently fail after model changes, denial events, or session compaction git add/commit/push/gh pr create bypass all rules"
---

# Retro: #452 — Make the bash permission gate fail closed instead of silently allowing

## Stage: Planning (2026-06-20T00:00:00Z)

### Session summary

Planned a defense-in-depth, fail-closed hardening of the bash permission gate in response to a third-party bug report (`k0valik`) with a detailed-but-speculative log analysis.
Decomposed the single reported "bug" into four confirmable code defects (A1–A4) plus one unreproducible asymmetry (C), verified each against source and the Pi SDK, and produced a five-step TDD plan filed at `packages/pi-permission-system/docs/plans/0452-bash-gate-fail-closed-hardening.md`.

### Observations

- The keystone finding is A1: the SDK's `emitToolCall` (`runner.js`) calls `await handler(event, ctx)` with **no** try/catch, unlike `emitUserBash` directly below it.
  A thrown `handleToolCall` therefore yields no block and the command runs ungated with no trace — this is what turns every other latent error into a silent bypass.
- A2: `parserPromise ??= initParser()` in `bash-program.ts` caches a *rejected* promise forever; `config.loaded` does not re-run the factory module, matching "stays broken until process restart."
- A3: `resolveBashCommandCheck`'s empty-commands fallback resolves the whole string, so `cd X && git push` rides a permissive top-level `*: allow`.
  When parse succeeds the chain splits correctly, so the bypass is only reachable via empty-parse.
- A4: the shipped example config sets `bash.*: ask` (safe); the reporter's config omitted it, inheriting the permissive top-level `*`.
- Ruled out three of the reporter's theories from source (handler deregistration — contradicted by `rm` staying gated; mid-parse tree-sitter corruption — single-threaded synchronous parse; denial poisoning state — no such code path).
- Could **not** reconcile the `git`-bypasses-while-`rm`-gated asymmetry (C) from static reading; scoped it as diagnosable-on-recurrence rather than guessing a fix.
- Operator decisions via `ask_user` (third-party issue gate): defense-in-depth scope; fallback fails closed to `ask`; emit a non-fatal config warning for the footgun; single plan covering A1–A4 + observability.
- Behavior-changing pieces (A1 block-on-error, A3 ask-on-unparseable) are treated as breaking (`fix!:` + `BREAKING CHANGE:` footer) with a verified opt-out remediation (`"bash": { "*": "allow" }`).
- Release: ship independently (not in any roadmap batch).

### Observations — architectural fold-in (revision)

After a follow-up design discussion, folded structural recommendations into the plan so the fix prevents the bug *class*, not just the instances.

- Reframed A1 from "wrap `handleToolCall` in try/catch" to a single **fail-closed boundary adapter** (`createFailClosedToolCall`, the only `pi.on("tool_call")` target): it owns the `try/catch → block` and is the sole place the internal `GateOutcome` is translated to the SDK result shape.
  Insight that motivated it: "allow" is the implicit default at five separate exits, and the SDK's `emitToolCall` (unlike `emitUserBash`) does not catch a throwing handler.
- `handleToolCall` now returns the internal total `GateOutcome` (already defined in `gates/types.ts`); the `reporter` moved to the boundary, so the handler constructor does not widen.
  Cost: a mechanical ripple through `tool-call*.test.ts` assertions, folded into the A1 step.
- Added A5: a `DecisionAudit` collaborator (per-session counters) + `debugLog`-gated per-call trace + `session_shutdown` summary, so an evaluated-and-allowed call is distinguishable from a never-evaluated one without hand-reconciling logs.
  Review log stays quiet on allow (no churn).
- Added totality tests: a metamorphic `cd X && <cmd>` no-weaker property (pins A3) and a boundary contract test (throw → block; pins the SDK assumption).
- Deliberately did **not** add a separate parser health signal (redundant — init failure surfaces via the boundary's `gate_error`) and deferred full session-JSONL reconciliation and a first-class `ask` `GateOutcome` variant to follow-ups.
- Plan grew from 5 to 6 TDD steps; A5 flagged as separable, but the A1 boundary is the structural keystone and stays in #452.
- Behavior-changing pieces (A1 boundary block-on-error, A3 ask-on-unparseable) are breaking (`fix!:` + `BREAKING CHANGE:` footer) with a verified opt-out (`"bash": { "*": "allow" }`).
- Next: `/tdd-plan` — six red→green→commit steps.

## Stage: Implementation — TDD (2026-06-20T19:45:00Z)

### Session summary

Executed all six TDD steps (A2 parser resilience, A4 config footgun warning, A1 fail-closed boundary, A3 unparseable-bash fallback, A5 decision trace + summary, docs) as seven commits (the sixth split a follow-up architecture-doc cleanup off the docs commit).
The gate now fails closed everywhere: a thrown gate blocks with a `gate_error` review entry, an unparseable bash command resolves to `ask` (`<unparseable-bash-command>` sentinel) instead of riding a permissive top-level `*`, and a startup warning fires when `*: allow` leaves bash ungated.
Test count went 2034 → 2064 (+30 across five new test files); `pnpm run check`, root `pnpm run lint`, and `pnpm fallow dead-code` all green.

### Observations

- Deviation (step sequencing): the plan put `DecisionAudit.writeSummary` + `decision-audit.test.ts` in step 5, but biome's `noUnusedPrivateClassMembers` rejects write-only counters, so `writeSummary` and its test were implemented in step 3 (the `fix!` commit).
  Step 5 then only wired `audit` into `SessionLifecycleHandler.handleSessionShutdown` and added the `debugLog`-gated boundary trace.
  Lesson: a counters-only class is not lint-clean in isolation — its reader (`writeSummary`) must land with it.
- Deviation (trace fields): the per-call `permission.decision` trace logs `toolName` + `action` (+ `reason` for block) but not `matchedPattern`, because `GateOutcome` carries only `action`/`reason`.
  Widening `GateOutcome` was a deferred open question in the plan, so the trace intentionally drops the pattern; the decision-event channel still carries `matchedPattern` separately.
- A4 lint friction: the bash-surface lookup needed a runtime-undefined guard that the `FlatPermissionConfig` index signature hides from `tsc`, so eslint's `no-unnecessary-condition` flagged it as always-truthy.
  An explicit `| undefined` annotation did not help (flow narrows to the non-undefined initializer); reading through a `Partial<FlatPermissionConfig>` view made the optional access type-honest and lint-clean.
- A1 ripple: changing `handleToolCall` from the SDK shape to `GateOutcome` broke return-shape assertions in `tool-call.test.ts`, `external-directory-integration.test.ts`, and `external-directory-session-dedup.test.ts` (not just the two files the plan named).
  All updated in the A1 commit; `.reason` reads needed a `(result as { reason?: string })` cast since the union does not expose it without narrowing.
  Sed-based bulk edits bypassed pi-autoformat and left a biome format error that only surfaced at commit time — ran `biome check --write` on the touched files to fix.
- The metamorphic totality tests passed immediately (real tree-sitter parse splits `cd /repo && <cmd>` into chain units, so the empty-parse path is never hit for a `cd` prefix); they pin that the A3 weakening cannot recur, rather than driving new code.
- Pre-completion reviewer: PASS.
  Reviewer warnings: one WARN on `docs/architecture/architecture.md` staleness (three new modules missing from the file tree, stale `lifecycle.ts`/`bash-command.ts` entries) — resolved in commit `50786e89` before finishing.
- Process note: a `cd ..`-chained verification command walked outside the repo root and tripped the `external_directory` gate (correctly).
  Reaffirmed the AGENTS.md rule — never `cd`; use `pnpm --filter` for package-scoped runs.

## Stage: Final Retrospective (2026-06-21T01:30:00Z)

### Session summary

Shipped #452 via `/ship-issue` (CI green, issue closed, release-please PR #455 merged → `pi-permission-system@15.1.0`), then discovered the breaking change had shipped as a **minor** bump instead of a **major**.
Root-caused it to a malformed commit header — `fix!(pi-permission-system):` puts the `!` before the scope, which the Conventional Commits grammar rejects, so release-please silently dropped the commit (no changelog entry, no major bump).
Rolled forward to `16.0.0` with a correctly-formatted `fix(pi-permission-system)!:` commit, added a preventive `AGENTS.md` rule, and deprecated `15.1.0` on npm with a pointer to `16.0.0`.

### Observations

#### What went well

- The roll-forward recovery was clean and correctly reasoned: cut a new `16.0.0` rather than force-pushing `main` (npm immutability plus the already-published `15.1.0` made a history rewrite both unsafe and ineffective), verified the new release-please PR body showed `16.0.0` with a `⚠ BREAKING CHANGES` section **before** merging, then deprecated `15.1.0`.
- Diagnosed the root cause at the grammar level: traced the conventional-commits header regex `^(\w*)(?:\((.*)\))?!?:` and showed why `fix!(scope):` fails to match, rather than guessing.
- `web_search` confirmed release-please's documented `fix!:` → major semantics, separating "release-please is buggy" from "our commit was malformed."

#### What caused friction (agent side)

- `missing-context` — used the plan's verbatim `fix!(pi-permission-system):` commit header without validating it against the Conventional Commits grammar.
  The `!`-before-scope form is malformed; release-please dropped the commit, shipping the breaking change as `15.1.0` instead of `16.0.0`.
  Impact: a mis-versioned release published to npm (immutable), a roll-forward to `16.0.0`, and a manual `15.1.0` deprecation.
  User-caught (the user questioned why a `fix!` produced a minor bump).
- `other` (premature rationalization) — when the release came out `15.1.0`, fabricated a confident but self-contradictory explanation ("the `BREAKING CHANGE:` footer doesn't trigger a major in v0.x … the current version is 15.x so it does bump minor") instead of flagging the anomaly.
  A `fix!` yielding a minor bump is a contradiction that should have triggered investigation, not an explanation.
  Impact: no rework (the user's pushback corrected course immediately), but it briefly asserted a falsehood and delayed detection.

#### What caused friction (user side)

- Opportunity, not criticism: the user's redirect — "A `fix!` should bump the major version IMO.
  What am I missing?" — was the ideal intervention, reframing the wrong explanation as a question to investigate rather than just flagging it as wrong.
  Nothing the user could have done earlier: the malformed header originated in the plan from a prior session.

### Diagnostic details

- **Unused-tool / feedback-loop gap** — no commit-message validation runs at commit time (the pre-commit hooks cover formatting and lint, not conventional-commit grammar), so the malformed header passed every local gate.
  Both backstops that *should* have caught it failed: the pre-completion-reviewer's conventional-commits check explicitly validated `fix!(pi-permission-system):` as "valid breaking-change form," and `/ship-issue` step 6 reads the release-please PR's version bump but never checks it against the commit types.
- **Escalation-delay** — none; the post-pushback investigation was a tight, converging ~6-call sequence (config read → commit-body read → `web_search` → registry query), not a rabbit-hole.

### Changes made

1. `AGENTS.md` — tightened the breaking-commit rule to rule + example + `Refs #452` (rationale moved here); the `!` goes after the scope (`fix(pkg)!:`), never `fix!(pkg):`.
2. Filed issue #457 — add a `commit-msg` hook (`@commitlint/cli` + `config-conventional`) to reject malformed Conventional Commit headers at commit time.
   The user chose this deterministic commit-time gate over the two prompt-level detection proposals (a `/ship-issue` semver-consistency check and a `pre-completion-reviewer` `!`-position check), which it supersedes; both are recorded here but were not implemented.
