---
issue: 557
issue_title: "pi-permission-system: serving is resolution — rebuild processInbox on evaluate() + the serving session's Authorizer"
---

# Retro: #557 — serving is resolution — rebuild `processInbox` on `evaluate()` + the serving session's `Authorizer`

## Stage: Planning (2026-07-08T00:00:00Z)

### Session summary

Planned Phase 9 Step 3 across two session branches: an exploration branch mapped the resolution pipeline and uncovered that the issue's literal "escalate to the serving `Authorizer`" would silently re-degrade the forwarded `permissions:ui_prompt` broadcast (the #292 D3/D4 "not degraded" hardening, a documented public contract in `docs/cross-extension-api.md`); this branch stepped back to the phase level, amended the Phase 9 roadmap (commit `21472cf9`: Step 3 fidelity invariant, resolved-direction-1 provenance sentence, Step 4 target reworded to the post-Step-3 topology), and committed the plan (`0557-serving-is-resolution.md`, commit `14cdeea5`).
Filed follow-up #565 for post-ship validation of the recorded decisions.

### Observations

- **Phase-planning gap class**: the roadmap recorded the policy invariant ("parent rules govern children") but not the presentation invariant ("observers see forwarded prompts undegraded") — a step that reroutes an emission path must be checked against `docs/cross-extension-api.md` contracts, not just `src/` behavior.
  The pre-completion reviewer only catches invariants the roadmap documents, so the amendment (not just the plan) was the right fix.
- **Decide-gate outcomes** (operator-confirmed via `ask_user`): (1) fidelity becomes a documented Step 3 invariant with the threaded design — provenance as data on `PromptPermissionDetails`, rendered by `LocalUserAuthorizer`, the single emit site; (2) amendment scope = Step 3 + resolved direction 1 + Step 4 target; (3) serving evaluates the **base** ruleset (`agentName` undefined; requester agent name is display-only).
- **"Threading" smell concern resolved**: operator asked for reassurance that threading isn't a compromise.
  Verified against the taxonomy — not tramp data (every hop reads/relays it), not a control flag (rendered, not branched on), and it echoes the architecture doc's own principal-identity requirement; the rejected alternatives (server-side emission + emit-suppressed authorize; per-request decorator) each re-create a smell Phase 9 kills.
- **Wiring findings**: `ForwardingManager.start` already gates polling on `hasUI && !isSubagent`, so the server's internal `ctx.hasUI` guard is removable dead defense; `index.ts` needs a construction reorder (`prompter` → `authorizerSelection` → `resolver` → `servingPolicy` → `requestServer`), with the `session.getPathNormalizer()` read deferred via the existing logger-`notify`-sink precedent.
- **Accepted behavior shifts** (named for the `feat:` commit body): explicit `deny` now wins under yolo on the serving path; legacy field-less requests prompt instead of yolo-approving; policy-decided requests emit no `permissions:ui_prompt`.
- Deferred: single-surface re-resolution fidelity, base-agent-scope revisit, and notification-consumer verification all live in #565.

## Stage: Implementation — TDD (2026-07-09T12:45:00Z)

### Session summary

Implemented all four planned TDD cycles plus one pre-completion fix, landing Phase 9 Step 3.
Step 1 (`refactor`) added `buildUiPrompt` (folding `buildDirectUiPrompt`/`buildForwardedUiPrompt`), extended `PromptPermissionDetails` with `ForwardedAskProvenance` + `surface`/`value`, and made `LocalUserAuthorizer` render forwarded provenance (non-degraded broadcast + `(Subagent)` title).
Step 2 (`feat`) rebuilt `ForwardedRequestServer` on the `ServingPolicy` + `AskEscalator` seams with the one-hop canary, rewired `index.ts` (resolver moved up, `servingPolicy` adapter with deferred `getPathNormalizer`), and removed the old builders.
Steps 3–4 (`docs`) added ADR-0005 and marked the roadmap step complete.
Test count went 2280 → 2290 (+10, net of removed `buildDirectUiPrompt`/`buildForwardedUiPrompt` cases and added `buildUiPrompt`/server/authorizer cases); all 116 files green.

### Observations

- **Pre-completion reviewer: PASS** (after one FAIL→fix cycle).
  First pass returned **FAIL** on the sole quantitative target: `processSingleForwardedRequest` landed at 74 lines vs. the plan/issue `< 60` commitment.
  Operator chose to fix; extracted `recordForwardedDecision` (the "respond" half symmetric to the existing `resolveDecision` "decide" half) — a genuine SRP split, not number-forcing — dropping the method to 43 lines.
  Re-dispatch returned PASS.
  Lesson: the deterministic gate (`fallow dead-code`) does not catch a `fallow health` line-count/complexity target, so a plan's LOC commitment needs an explicit `fallow health` check before declaring done.
- **Plan-grep miss (minor deviation)**: the plan's Module-Level Changes listed only `local-user-authorizer.ts` as a `buildDirectUiPrompt` consumer, but `approval-escalator.ts` (`ParentAuthorizer.authorize`) also imported it to compute the forwarded request's display projection.
  Switched it to `buildUiPrompt` in Step 2 — behavior-identical (the old builder was a thin wrapper), and correct for the multi-hop-ready design (it now honors an explicit `surface`/`value`/`forwarding` override).
  The reviewer confirmed benign; the pre-existing `approval-escalator.test.ts` stayed green unchanged.
- **Provenance types identical by design**: `ForwardedAskProvenance` (declared in `permission-prompter.ts` to keep that layer free of an events import) is structurally identical to the event's `ForwardedPromptContext`, so `PromptPermissionDetails` flows straight into `buildUiPrompt` with no copying — as the plan intended.
- **Behavior shifts shipped as documented**: parent `allow`/`deny` now govern children's escalations; explicit `deny` wins under yolo on the serving path; field-less legacy requests escalate instead of yolo-auto-approving; policy-decided requests emit no `permissions:ui_prompt` (one sentence added to `cross-extension-api.md`, the "not degraded" guarantee preserved verbatim).
- All cross-step invariants held (reviewer-confirmed), notably the #292 non-degraded broadcast (re-pinned by composing `LocalUserAuthorizer` + server-details tests) and the escalate-requires-activated-selection timing invariant added to the plan this session.

## Stage: Final Retrospective (2026-07-09T16:59:56Z)

### Session summary

Shipped Phase 9 Step 3 end-to-end: folded two plan tightenings (escalate-timing invariant, drain serialization) into the plan, executed all four TDD cycles plus a pre-completion FAIL→fix, then pushed, closed #557, and merged release-please PR #566 (`pi-permission-system` v20.2.0).
The run was clean apart from one substantive rework (a plan LOC target missed until the reviewer measured it) and three trivial self-corrected tool slips.

### Observations

#### What went well

- **The pre-completion reviewer earned its keep on a target the deterministic gates cannot see.**
  Every green check passed (`check`, `lint`, `test` 2290, `fallow dead-code`), yet the plan's `processSingleForwardedRequest < 60 lines` commitment was unmet at 74 lines.
  Only the reviewer (on `anthropic/claude-sonnet-5`) measured it and returned FAIL — a genuine value-add, since `fallow dead-code` does not measure LOC/complexity.
- **The planning-stage foresight paid off at implementation.**
  Because the prior session amended the Phase 9 roadmap to record the #292 non-degraded-broadcast invariant as a documented Step 3 outcome, the reviewer could verify it and the threaded-provenance design preserved it with a green suite — the presentation invariant did not silently regress.
- **Clean release-please UNSTABLE handling.**
  The `release_pr_merge` refusal was a genuinely `IN_PROGRESS` CI check (not the empty-rollup `GITHUB_TOKEN` case), so the ship flow waited for CI (`ci_watch` on the PR head SHA) and retried, rather than force-merging — the protocol's distinction held.

#### What caused friction (agent side)

- `missing-context` — the plan committed to `processSingleForwardedRequest < 60 lines`, but no TDD-loop step measured it; `fallow health` never ran during implementation (only `fallow dead-code`, which does not measure LOC).
  The miss surfaced only as a pre-completion FAIL.
  Impact: one extra `refactor:` commit (`4b103618`, extracting `recordForwardedDecision`) and a full FAIL→fix→re-dispatch reviewer cycle (~350s of reviewer time across two dispatches).
  The fix itself was a genuine decide/respond SRP split, not number-forcing.
- `instruction-violation` (self-identified) — a defensive `cd /Users/chris/.../pi-permission-system 2>/dev/null; cd ...` prefix on a vitest command hit the `external_directory` permission gate (the first path does not exist at that level) and was denied; AGENTS.md bans prefixing a command with `cd` into the working directory.
  Impact: one wasted tool call, immediately re-run without the `cd`.
- `instruction-violation` (self-identified) — during the ship UNSTABLE-wait, passed the literal string `HEAD` to `ci_find`'s `expected_sha` instead of a resolved 40-char SHA; the ship prompt says pass the exact SHA, never a value from memory.
  Impact: one ~125s non-blocking `ci_find` timeout, recovered via `gh pr view --json headRefOid` + `ci_watch`.
- `other` (self-identified) — an `Edit` batch on `index.ts` carried a stray `newText_unused` key and was rejected wholesale; re-issued correctly.
  Impact: one wasted tool call.

#### What caused friction (user side)

- None material.
  The operator's one substantive decision (fix vs. skip the 74-line FAIL) was answered promptly and correctly; the earlier "are we ready?" check surfaced two real plan tightenings before implementation, which is the intended pre-flight.

### Diagnostic details

- **Model-performance correlation** — the only subagent dispatches were the two `pre-completion-reviewer` runs on `anthropic/claude-sonnet-5`; judgment-heavy review (acceptance-criteria verification, precise LOC measurement, invariant cross-checking) is well-matched to that model, and it caught the quantitative miss the deterministic gates missed.
  No mismatch.
- **Escalation-delay tracking** — no `rabbit-hole` points; no error ran longer than one corrective tool call.
  The 74-line FAIL resolved in a single extraction.
- **Unused-tool detection** — `pnpm fallow health` was the available-but-unused tool: running it on the touched file before the reviewer dispatch would have caught the LOC miss locally.
- **Feedback-loop gap analysis** — incremental verification was otherwise strong (`pnpm run check` after each shared-type change, per-file red/green vitest, full suite before commits).
  The single gap was the `fallow health` LOC/complexity check, which never ran in the TDD loop — the direct cause of the FAIL→fix cycle.

### Changes made

1. Appended this Final Retrospective stage entry to `packages/pi-permission-system/docs/retro/0557-serving-is-resolution.md`.
2. Proposed adding a `pnpm fallow health` quantitative-target check to `.pi/prompts/tdd-plan.md` ("After the last TDD step"); operator declined — no prompt change made.
   The observation stays recorded here as the session's primary friction finding.
