---
issue: 815
issue_title: "pi-permission-system: bash tool hidden entirely when surface catch-all is deny, even with more permissive nested patterns"
---

# Retro: #815 — bash tool hidden entirely when surface catch-all is deny

## Stage: Planning (2026-09-02T06:45:43Z)

### Session summary

Reproduced the third-party report with a throwaway spike against an in-memory `PermissionManager`, confirmed it is not bash-specific (every per-tool path map with a `deny` catch-all is hidden too), and found that `docs/configuration.md`'s own `Restricted Bash Surface` recipe is broken by it.
The operator's gate settled all three open choices: fix it, add a separate `isToolFullyDenied` predicate published cross-extension (leaving `getToolPermission` semantics untouched), and compute reachability with an ordering-aware pattern probe.
Plan committed at `packages/pi-permission-system/docs/plans/0815-reachable-non-deny-tool-exposure.md` — six steps, two of them Tidy-First preparations.

### Observations

- The spike measured three cases that drove the design.
  `bash: {"*":"deny","git *":"ask"}` hides Bash while the gate would answer `ask` for `git status`; `bash: {"git *":"ask","*":"deny"}` is correctly fully denied because last-match-wins shadows the exception; `read: {"*":"deny","~/notes/*":"allow"}` hides `read`.
  The second case is what rules out the cheap "does any non-deny rule exist on this surface" scan, and it is the reason the plan probes through `evaluate` rather than scanning rule actions.
- A non-obvious defect found only by spiking: `compileWildcardPattern` runs `expandHomePath` on the **pattern** side only, so probing with the raw pattern text makes a `~/notes/*` rule fail to match itself and the probe wrongly reports fully-denied.
  The candidate must be home-expanded to mirror the compile step.
  Verified the self-match invariant across eleven pattern shapes.
- `permission["*"]` composes as a `layer: "default"` rule that `getComposedConfigRules()` filters out, so an early spike using the display accessor gave a wrong answer.
  The probe must read `resolvePermissions().composedRules`, the same list `getToolPermission` uses.
- Placement was decided on the `code-design` "shared predicate, different burden of proof" heuristic: `getToolPermission` is a classifier ("what does the catch-all say?"), exposure is a guard ("is every invocation denied?"), and reusing the first as the second is the whole defect.
  Rejected alternative: redefining `getToolPermission` as "least restrictive reachable state" — it fixes every consumer at once but also changes the answer for configs that work today (`bash: {"*":"ask","git *":"allow"}` would report `allow`), which is a cross-extension behavior change on a published method.
- Deliberately kept off `PermissionQuery` (the narrow view handed to `Authorizer` chain links) per ISP — tool pre-filtering is a `PermissionsService` use, and no link needs it.
- `linkWorkspacePackages: false` means `packages/pi-permission-model-judge` resolves the **published** `@gotgenes/pi-permission-system@27.0.0`, so its `makeService` fake is not broken by the new interface member and this stays a single-package plan.
- The Tidy-First assessor found two exact-duplicate mock literals that the change's two new required interface members would otherwise force into two and three places; both became steps 1 and 2.
  It also verified every file/line pointer in the design summary against the real files with no contradictions.

#### Deferred tidyings

- `packages/pi-permission-system/src/rule.ts:143` — a stale duplicate doc comment on `evaluateMostRestrictive` describing a different function (also flagged by the Phase 14 craftsmanship scout); in a file this change touches, but not at its insertion point, so the assessor declined it as scope creep.
- `packages/pi-permission-system/test/helpers/authorizer-fixtures.ts` and `test/authority/{authorizer-chain,delegation-envelope,forwarded-request-server}.test.ts` — the narrow `PermissionQuery` mock (`{ checkPermission, getToolPermission }`) is hand-rolled in four places; untouched by this change because `PermissionQuery` deliberately does not gain the new member.

## Stage: Implementation — TDD (2026-09-02T07:16:30Z)

### Session summary

All six planned TDD steps landed in order, plus two unplanned cleanup commits, for eight commits on the branch.
Tool exposure now asks `isToolFullyDenied` — backed by the pure `isSurfaceFullyDenied` probe in `src/rule.ts` — instead of `getToolPermission`'s catch-all lookup, and the predicate is published on `PermissionsService`.
Test count went 3862 → 3897 in `pi-permission-system` (+35); every deterministic gate is green.

### Observations

- Every killing mutation the plan named behaved as predicted, with one instructive exception.
  Mutation 1 for step 4 (`isToolFullyDenied` reverts to `getToolPermission(...) === "deny"`) killed the three manager tests but **not** the handler exposure test, because `before-agent-start.test.ts` drives a fake `permissionManager` and never runs the real implementation.
  The wiring is pinned instead by two other mutations: deleting the `shouldExposeTool` call site, and reverting the call site to the pre-fix `getToolPermission(...) === "deny"` lookup.
  Both killed the same three handler tests, so the seam is covered — but the plan attributed the coverage to the wrong mutation.
- Two findings the plan did not anticipate, both landed as `ed37c239`.
  `fallow` began reporting `PermissionResolver.getToolPermission` as an unused class member: its last concrete-typed caller was the handler, and after the rewire it is reached only through `LocalPermissionsService`'s structural `ResolverForService` view, which the tracer cannot follow but `tsc` enforces.
  Suppressed with the reason recorded beside it, since the `fallow` skill's preferred `implements` fix would require exporting a consumer-owned narrow interface backwards into the provider.
  Biome also flagged `noTemplateCurlyInString` on the `${HOME}` probe pattern, which is a shell expansion the matcher must handle; suppressed with the same wording sibling test files already use.
- One file was touched that the plan's Module-Level Changes did not list: `test/service.test.ts` carries a **second** local resolver fake (the service-adapter suite's `makeResolver`, distinct from the `makeService` the Tidy-First prep consolidated), which needed the new member too.
  The plan's grep found the three `PermissionsService` literals and missed this `ResolverForService`-shaped one.
- The plan's home-expansion finding held up under implementation: dropping `expandHomePath` from the probe candidate turns all five `~`/`$HOME`/`${HOME}` tests red and leaves every bash-surface test green, exactly as predicted.
- Pre-completion reviewer: WARN (1 non-blocking finding), now fixed.

#### Reviewer warnings

- The reviewer found that `docs/cross-extension-api.md`'s interface listing — and the source JSDoc it was copied from in `src/service.ts` — still recommended `getToolPermission` "for pre-filtering tools before creating a child session", contradicting the corrected prose five lines below it in the same file.
  Fixed exhaustively in `774827c6` by grepping every `pre-filter` occurrence across `src/` and `docs/` rather than only the two the reviewer named.
- The reviewer independently re-derived seven adversarial configs against `isSurfaceFullyDenied` (shadowing, universal deny, cross-surface leakage, re-shadowing, floor interaction) and traced the fail-closed/yolo and exposure-is-not-authorization claims through the code rather than accepting them from the plan; all held.

## Stage: Sync (worktree) (2026-09-02T15:15:31Z)

### Session summary

Pre-push checks pass clean on this branch: root `pnpm run lint` (0 findings) and `pnpm fallow dead-code` (0 issues, 6 suppressed, all justified in the TDD stage).
The plan's `**Release:** ship independently` marker stands — #815 is in no roadmap batch, so the root should name `pi-permission-system` in the release dispatch without asking.
No deferred work or follow-ups beyond the `rule.ts:143` stale-comment tidying already recorded under Deferred tidyings above.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-815--/2026-09-02T06-26-19-120Z_01a060cc-0770-77b1-966f-cadb217ed418.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Nothing beyond the TDD-stage findings above; this sync only confirmed the pre-push gates and captured the transcript path for the root's final `/retro`.

One process note, the [#549] hazard caught live: the first sync pass rebased onto `origin/main` and declared the branch fast-forward-ready, but local `main` carried an unpushed root commit (`docs(triage): prioritize backlog for 2026-09-02`) that `origin/main` did not.
`/ship-worktree` merges into **local** `main`, so the ff-merge would have been rejected.
Re-rebased onto local `main`; `git diff` against the pre-rebase tip is exactly that one triage commit, so all 12 commits replayed unchanged.
The check that matters is `git merge-base --is-ancestor main HEAD`, not the `origin/main` comparison the template's step 4 names — the two agree only when the root has nothing unpushed.

## Stage: Final Retrospective (2026-09-02T16:27:17Z)

### Session summary

## 815 landed on `main` and released as `pi-permission-system` v30.1.0: tool exposure now asks `isToolFullyDenied` (backed by the `isSurfaceFullyDenied` probe) instead of `getToolPermission`'s catch-all lookup, so a surface with a `deny` catch-all and a reachable non-deny pattern is no longer hidden outright

The land itself took two attempts — the first `git merge --ff-only` was rejected because local `main` carried an unpushed root commit that `origin/main` did not show, which is the [#549] hazard in its sharpest form.
Every deterministic gate stayed green, CI passed on the first push, and the release ran clean through `prepare` → `publish` → `github-release`.

### Observations

#### What went well

- The abort path cost nothing, which is a property of the template's ordering rather than luck.
  `/ship-worktree` gathers the release decision from the plan's `**Release:**` marker *before* any irreversible step, so when the ff-merge was rejected there was no push, no tag, no closed issue, and no torn-down worktree to undo — the session simply stopped.
- The peer amended its own sync stage note with the divergence, the correct predicate, and a caveat that the eventual push would carry the root's triage commit.
  That is the right instinct for a worktree session: the note survives teardown, and the transcript path it recorded is what made this retrospective's root-cause analysis possible at all.
- The operator's intervention was a redirecting *question*, not a correction — "Are you checking origin/main or main (local)?"
  It named the ambiguity without supplying the answer, and the peer diagnosed and fixed the defect itself, then generalized the lesson unprompted.
  This is a markedly cheaper intervention shape than stating the fix.

##### What caused friction (agent side)

- `missing-context` — the root session misattributed the failed ff-merge.
  It ran `git log --oneline issue-815..main | wc -l` and got `1`, then narrated a cause from the nearby subjects in `git log -5 main`, reporting that "#810 landed and `pi-permission-system` released as 30.0.0 after the peer's rebase."
  Both claims were wrong: `f6d046fb` and the #810 retro sit *below* the merge base and were already in the branch's history, and the one genuinely divergent commit — `0ded864b docs(triage): prioritize backlog for 2026-09-02` — predated the peer's session entirely.
  The command that would have settled it was the same one minus `wc -l`.
  Impact: the handoff report named the wrong cause and did not give the peer the divergent commit, so the peer re-ran its sync against the same stale ref and reported "nothing to do"; the operator's question was needed to break the loop.
  One wasted peer round trip.
- `missing-context` — the root never compared local `main` to `origin/main`.
  Step 1's `git pull --ff-only` printed `Already up to date.` and that was read as "main is in sync with the remote".
  It is not: verified empirically this session in a throwaway repo, `git pull --ff-only` prints `Already up to date.` and exits 0 when local `main` is merely *ahead* of `origin/main`.
  Impact: the precondition that guaranteed the ff-merge failure was invisible at exactly the step meant to establish it, and the eventual `git push` carried an unrelated root commit into the #815 land without the final report mentioning it.
- `other` — the root read the sync stage note once, during Release coordination, and never again.
  The peer amended that note during its second sync with the divergence paragraph and an explicit caveat that the push would carry the triage commit, so the root's picture of the handoff was frozen before the peer's most important finding existed.
  Impact: the final report omitted that the push included unrelated root work; no rework.

##### What caused friction (user side)

- The `docs(triage)` commit was made on `main` at 06:20Z and left unpushed while a worktree branch was pending, six minutes before the #815 peer session started.
  [#549]'s rule in `AGENTS.md` covers the general hazard, but the unpushed variant is strictly worse than the one it describes: the peer rebases onto `origin/main`, cannot see the commit at all, and its rebase is a no-op — so the failure is guaranteed and the peer cannot self-correct.
  Pushing that commit, or landing #815 before making it, would have removed the whole detour.
  Framed as opportunity: the cheapest fix is mechanical, and both proposals below aim to make the condition self-announcing rather than relying on the discipline.

#### Diagnostic details

- **Model-performance correlation** — the peer session ran `anthropic/claude-opus-5` for planning, TDD, and the sync correction (152 turns) and `anthropic/claude-sonnet-5` for the initial sync stage (23 turns).
  The `origin/main`-only check slipped on a sonnet turn that followed the template's step 4 literally; the opus turn questioned the template once prompted and found the defect.
  Stated as observation, not causation — a single sample cannot separate model strength from the fact that the sonnet turn was executing a routine templated step while the opus turn was answering a pointed question.
  Both subagents (`tidy-first-assessor` at planning, `pre-completion-reviewer` at TDD close) were dispatched with no `model` override, so both used their agent-file frontmatter; no mismatch to flag.
- **Escalation-delay tracking** — no sequence exceeded five tool calls on one error, and the notable failure was the inverse.
  The root diagnosed the ff-merge rejection in a single command batch and committed to a narrative from it; under-investigation, not a rabbit hole.
  The generalizable form: a *stop-and-report* branch deserves the same evidentiary bar as a fix, because the report is what the next session acts on.
- **Unused-tool detection** — nothing was missing from the toolbox.
  The gap was one more git command, not an unavailable subagent or search tool, so no dispatch would have helped.
- **Feedback-loop gap analysis** — nothing to flag.
  The root ship flow runs no build gates by design (CI is the gate), and the peer ran `pnpm run lint` and `pnpm fallow dead-code` both before the first sync and again after the re-rebase, rather than trusting the pre-rebase run.

### Changes made

1. `.pi/prompts/ship-worktree.md` — added step 1.4, checking `git rev-list --count origin/main..main` for unpushed root commits, since `git pull --ff-only` cannot distinguish "in sync" from "local is ahead".
2. `.pi/prompts/ship-worktree.md` — rewrote step 2.3 to report the divergent commits from `git log --oneline <branch>..main` rather than a cause inferred from recent `main` subjects.
3. `.pi/prompts/ship-worktree.md` — corrected the preamble's "rebased onto `origin/main`" to local `main`, which the ff-merge actually targets.
4. `.pi/prompts/sync-worktree.md` — rewrote step 4 to rebase onto local `main`, stop when local `main` is behind the remote, and verify with `git merge-base --is-ancestor main HEAD`; updated the step 5 handoff line to match.
5. `AGENTS.md` — extended the [#549] worktree guardrail with the unpushed-root-commit variant and the two commands that make it visible.

[#549]: https://github.com/gotgenes/pi-packages/issues/549
