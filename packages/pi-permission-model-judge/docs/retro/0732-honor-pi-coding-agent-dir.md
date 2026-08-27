---
issue: 732
issue_title: "pi-permission-model-judge: global config path ignores PI_CODING_AGENT_DIR, diverging from pi-permission-system"
---

# Retro: #732 — pi-permission-model-judge: global config path ignores `PI_CODING_AGENT_DIR`

## Stage: Planning (2026-08-17T17:00:34Z)

### Session summary

Confirmed the defect by reading `src/config-loader.ts` and `src/extension.ts` side by side against the installed SDK's `getAgentDir()` (`dist/config.js:393`), then chose boundary injection over a loader-internal default and wrote `docs/plans/0732-honor-pi-coding-agent-dir.md`.
Ran a disposable spike test to measure the red before planning the TDD cycle, and filed the identical `pi-autoformat` defect as a follow-up.

### Observations

- The spike was the session's most valuable step.
  A test asserting only that `registerAuthorizer` was called **passed against unfixed `main`** on this machine, because a real `~/.pi/agent/extensions/pi-permission-model-judge/config.json` exists here and the hardcoded default loaded it.
  That same test would have failed on CI — an environment-dependent false green.
  The plan therefore mandates a content-discriminating assertion (`complete` receives `systemPrompt` equal to a marker `instructions` string from the temp scope), which was measured red pre-fix and green post-fix.
- The issue proposed mirroring `pi-permission-system/src/policy-loader.ts:107`, which calls `getAgentDir()` as a loader-internal default.
  Rejected in favor of resolving at the extension boundary: `pi-permission-system/src/index.ts:56` and `pi-colgrep/src/extension.ts:59` both do it that way, and `pi-permission-system/src/permission-manager.ts:375` carries a comment explicitly framing the removal of "the hidden `getAgentDir()` env-read" as the intent.
  The `policy-loader.ts` form is the pattern being migrated away from, not the convention to copy.
- `docs/configuration.md:5` already claimed the global path "respects `PI_CODING_AGENT_DIR`", so the docs were right and the code was wrong.
  Listed under Non-Goals so implementation does not "fix" a line that becomes true.
- The `process.cwd()` default is the same class of hidden global read on the adjacent line, so it is removed in the same commit rather than split into a preparatory `refactor:`.
  A split would produce a signature-only commit with no caller change.
- All six existing `config-loader.test.ts` cases already pass `{ cwd, agentDir }` explicitly, so making both required costs zero test churn — which is what made boundary injection cheap rather than invasive.
- Every one of the seven existing `createModelJudgeExtension` tests injects `loadConfig`, so the default seam — the exact line carrying the bug — had zero coverage.
  That coverage gap is why the bug shipped, and closing it is the point of the new test.
- Filed [#762] for the byte-identical defect in `packages/pi-autoformat/src/config-loader.ts:61` / `src/extension.ts:625`.
  Noted but did not file: `packages/pi-session-tools/src/session-file.ts:59` computes `DEFAULT_SESSIONS_ROOT` from `homedir()` at module scope, which may be deliberate.
- Classified as `fix:`, not `fix!:`, per the operator's choice of a clean fix with no legacy fallback.
  The behavior change on upgrade is real but narrow, and is called out in the commit body and the close comment.

## Stage: Implementation — TDD (2026-08-17T17:31:51Z)

### Session summary

Landed the plan's single TDD cycle plus one Tidy-First preparatory commit: `config-loader.ts` no longer reads `homedir()` or `process.cwd()`, and `extension.ts` supplies both scopes with `agentDir` resolved from the SDK's `getAgentDir()`.
Package tests went 47 → 48; `check`, root `lint`, full `test`, and `fallow dead-code` are green, and the pre-completion reviewer returned PASS.

### Observations

- The `tidy-first-assessor` returned exactly one Recommended item — widen `ctxWithRegistry()` to take a `cwd` — and it was the right call: the new test is the first in that file to need a `ctx.cwd` other than the hardcoded `"/project"` while still needing the same `modelRegistry` shape.
  Its Optional `RegisteredAuthorizer` type alias was folded into the same `refactor:` commit so the `fix:` commit stayed purely behavioral.
- It explicitly declined two things worth recording: a `driveAuthorizer()` helper wrapping the system-under-test call (against the `testing` skill's rule that the repeated act *is* the test subject), and sharing a temp-config fixture with `config-loader.test.ts` (same mechanics, different logical purpose — unit-testing merge semantics vs. an end-to-end wiring fixture).
  It also checked, rather than assumed, that Vitest's outer-then-inner `beforeEach` / inner-then-outer `afterEach` ordering lets a nested `describe` add env stubbing without fighting the file-scoped hooks.
- The planning session's spike paid off exactly as intended.
  The landed red was `complete` called 0 times, not a registration failure — on this machine the link *did* register from the real `~/.pi/agent` config, which is the false green the plan predicted and designed the assertion around.
- No deviations from the plan's Module-Level Changes: all three listed files were touched and nothing listed went untouched.
  `docs/configuration.md` correctly needed no edit — it already claimed `PI_CODING_AGENT_DIR` support, so the fix made an existing line true.
- A tool call in this session tripped the permission system's own `external_directory` gate by dropping the `pi-packages/packages/` prefix from a `Read` path — the exact typo-path class this package exists to judge, and a live reminder to pass file-tool paths repo-relative.
- Pre-completion reviewer: PASS, no warnings.
  It independently confirmed the missed-caller grep, the teardown ordering, and the `fix:` (not `fix!:`) typing.

## Stage: Final Retrospective (2026-08-17T18:42:50Z)

### Session summary

All three stages — planning, TDD, and ship — ran in a single session, landing `@gotgenes/pi-permission-model-judge` v1.1.3 with the global config scope resolved through the SDK's `getAgentDir()`.
The implementation itself was one preparatory `refactor:` commit plus one `fix:` commit and finished clean on the first pass.
The ship phase coincided with a live GitHub incident that broke the release automation twice and required two separate manual recoveries.

### Observations

#### What went well

- The planning-time spike was the highest-leverage thing in the session, and it worked exactly as the `/plan-issue` guidance intends.
  Writing the intended regression test as a throwaway and *running* it against unfixed `main` disproved the obvious assertion: `registerAuthorizer` was called, and passed, because this machine has a real `~/.pi/agent/extensions/pi-permission-model-judge/config.json` that the hardcoded default happily loaded.
  A registration-only test would have been green locally and red on CI — an environment-dependent false green shipped as a regression test.
  The plan therefore specified a content-discriminating assertion (`instructions` reaching the model as `systemPrompt`), and the landed red was `complete` called 0 times, exactly as measured.
- Splitting REST from GraphQL turned out to be the key diagnostic during the incident.
  `gh api repos/...` stayed healthy while `gh pr view --json` and `gh pr merge` (both GraphQL) returned HTTP 503, which made it possible to read PR state and confirm outcomes throughout.
- Verifying before retrying prevented a real hazard.
  The third `release_pr_merge` attempt failed *on the merge mutation itself* rather than on its precheck; probing `gh api .../pulls/763 --jq .merged` returned `false`, which is what made the fourth attempt safe.
  A blind retry there could have acted on an already-merged PR.
- Closing #732 *before* merging the release PR was deliberate and worth keeping.
  Release-please renders `closes #732` into the PR body, so merging first risks GitHub auto-closing the issue and pre-empting the curated comment that `AGENTS.md` exists to protect.
- The `tidy-first-assessor`'s rejections carried more value than its single recommendation.
  It declined a `driveAuthorizer()` helper by citing the `testing` skill's rule that the repeated act is the test subject, declined a shared temp-config fixture on structural grounds, and — rather than assuming — checked that Vitest's outer-then-inner `beforeEach` ordering let a nested `describe` add env stubbing without disturbing the file-scoped hooks.
- The package under test caught the agent's own mistake mid-session: a `Read` with a malformed absolute path was denied by the `external_directory` gate with a teaching reason naming the correct path — the exact typo-path class this extension judges.

#### What caused friction (agent side)

- `other` — `fetch_content` on `githubstatus.com` returned the *resolved* Aug 6–7 incident rather than current status, so it could not confirm the operator's report.
  Impact: one wasted call, no rework; disclosed rather than presented as current, and replaced with a live API probe that produced better evidence (an actual 503).
  The generalizable lesson is that a live read-only API call is stronger evidence of degradation than a status page.
- `instruction-violation` (self-identified) — one `Read` used a hand-built absolute path that dropped the `pi-packages/packages/` prefix, tripping the `external_directory` gate.
  `AGENTS.md` already states this rule verbatim (Refs #726).
  Impact: one denied tool call, no rework; corrected immediately with a repo-relative path.
  No doc change is warranted — the rule exists, the gate fired, and the failure was caught in one step.
- `other` — `release_pr_merge` has no transient-error retry, so a single logical merge took four tool calls during the incident.
  Impact: four calls where one should suffice, plus the manual state verification between them.
  This is a tooling gap in `pi-github-tools`, not a process gap.
- `other` — the manual-publish recovery failed on `ERR_PNPM_OTP_NON_INTERACTIVE` because the registry required a one-time password and the agent has no interactive TTY.
  Impact: one failed publish attempt and an extra round trip to hand the command to the operator.
  The `AGENTS.md` runbook names `pnpm login` but does not flag that the publish itself must be operator-run under 2FA.

#### What caused friction (user side)

- The GitHub-incident context arrived after the first CI failure rather than before it.
  This is timing, not omission — the incident manifested mid-ship — but it is a good example of operator-held context that the agent could not obtain reliably on its own, since the status-page fetch returned stale data.
- The "hold everything" decision was reversed roughly ten minutes later, and the incident had not cleared: the post-tag failure the hold was meant to avoid then happened anyway.
  Framed as opportunity, the two genuinely distinct options were a substantially longer wait or accepting the recovery cost up front; a short pause was not a third option.
  Worth noting the caution was still correct — the risk flagged before merging is precisely the one that materialized.
- The question "How is this normally done, though?"
  was a well-placed redirect.
  It moved the recovery from reconstruction-from-memory to reading `.github/workflows/ci.yml:95–126`, which produced a faithful reproduction: the same `jq` mutation and the same `chore: advance release-please last-release-sha baseline [skip ci]` message the bot uses.

### Diagnostic details

- **Model-performance correlation** — the main session ran on `anthropic/claude-opus-5` throughout.
  Both subagents ran on `anthropic/claude-sonnet-5` per their frontmatter: `tidy-first-assessor` (preparatory-refactor triage) and `pre-completion-reviewer` (quality gate).
  Both are judgment-heavy read-only tasks, so the assignment is appropriate; no reasoning-weak model on judgment work and no high-cost model on mechanical work.
- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The longest same-error sequence was four `release_pr_merge` attempts against transient 503s, which is retrying infrastructure rather than persisting with a wrong approach, and each retry was gated on a fresh state check.
  Nothing crossed the five-call escalation bar.
- **Feedback-loop gap analysis** — no gap.
  All four gates (`check`, root `lint`, `test`, `fallow dead-code`) ran as a green baseline before any edit; `vitest` plus `tsc` ran after the tidy commit; the red was confirmed before implementing; the package suite and `tsc` ran before the `fix:` commit; and all four gates ran again afterward.
  `pnpm run check` immediately followed the required-parameter signature change, which is what the `testing` skill prescribes for a shared-signature edit.
- **Unused-tool detection** — nothing to flag.
  `colgrep` went unused, correctly: every search in this issue was exact-symbol matching (`getAgentDir`, `defaultAgentDir`, `agentDir`), which is grep's case per the `colgrep` skill's decision table.

### Changes made

1. `AGENTS.md` — extended the state-mutating-command bullet in § Workflow with the verify-before-retry rule: a transient 5xx on `gh pr merge` may follow a merge that landed, so probe `gh api repos/OWNER/REPO/pulls/N --jq .merged` (REST stays up when GraphQL is degraded) before retrying.
2. `AGENTS.md` — noted on the manual-publish command that it needs an interactive terminal under registry 2FA (`ERR_PNPM_OTP_NON_INTERACTIVE`), so the operator runs it rather than the agent.
3. Filed #764 against `pi-github-tools` — `release_pr_merge` needs transient-error retry and, more importantly, must re-read merge state before reporting a failure of the merge call itself, so a caller never has to guess whether a retry is safe.
   A parallel session picked it up and shipped it during this retro; #764 closed the same day.
4. `packages/pi-permission-system/docs/architecture/architecture.md` — marked Phase 13 Step 7 complete (heading plus Mermaid node `S7`), added a `**Landed:**` note for the divergence from the stated Target, and repointed the health metric and its recompute command from `config-loader.ts` to `extension.ts`.
   Caught by the operator after the retro commit, not by the workflow.

#### Missed roadmap step (found post-retro)

- `missing-context` (user-caught) — #732 was Step 7 of `pi-permission-system`'s Phase 13 roadmap, and nothing in planning, TDD, or ship noticed.
  The planning step that greps `packages/<PKG>/docs/architecture/architecture.md` for the issue number ran against `PKG = pi-permission-model-judge`, whose `docs/` has no `architecture/` directory, so it correctly found nothing and stopped.
  The issue carried **both** `pkg:pi-permission-system` and `pkg:pi-permission-model-judge` labels, and the roadmap lives in the package whose code the fix does *not* touch — the one place the single-package `PKG` never pointed.
  Impact: the step went unmarked through the whole lifecycle and was fixed only when the operator asked; one follow-up `docs:` commit.
- The same miss hid a second, worse problem.
  Step 7's stated Outcome was `grep -c "getAgentDir" …/src/config-loader.ts` going 0 → ≥ 1, but the operator's planning decision put the resolution in `extension.ts` instead.
  That grep now returns 1 anyway — matching a doc comment, with no resolution site in the file — so the metric would have read as satisfied for entirely the wrong reason.
  The roadmap even anticipates this: it states that the step creating each grepped name "must either use the roadmap's name or update the metric row in the same commit."
  Had the roadmap been read at planning time, the divergence between its Target and the chosen design would have surfaced in the `ask_user` gate rather than after the release.

Considered and deliberately not changed: the repo-relative path rule (already in `AGENTS.md`, Refs #726, and self-identified here), a `githubstatus.com` staleness note (too narrow; its actionable half is covered by change 1), the `/plan-issue` spike guidance (already prescribes planning-time measurement and worked as written), and `/ship-issue` steps 4 and 6b (both performed correctly under the failure).

[#762]: https://github.com/gotgenes/pi-packages/issues/762
