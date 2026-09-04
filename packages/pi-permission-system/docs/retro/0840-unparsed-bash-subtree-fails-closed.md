---
issue: 840
issue_title: "pi-permission-system: an unparsed bash subtree is matched as an ordinary unit instead of failing closed (ADR 0013 §10)"
---

# Retro: #840 — An unparsed bash subtree fails closed

## Stage: Planning (2026-09-04T14:41:36Z)

### Session summary

Planned ADR 0013 §10's last combinator clause — flooring a command unit produced from an unresolved bash parse.
Measuring the real corpus before designing overturned both the issue's diagnosis and the roadmap Step 14 Target it was written into, so the plan's mechanism is not the one the roadmap predicted.
Committed the plan at `packages/pi-permission-system/docs/plans/0840-unparsed-bash-subtree-fails-closed.md`, filed follow-up [#875] for the enumeration residual, and recorded its Phase 14 disposition.

### Observations

- **The issue's own headline example does not do what the issue says.**
  The body claims the enumerator "emits the unparsed subtree's text as one ordinary unit".
  Measured with the real parser, `git commit -F - <<'MSG' 2>&1 | tail -4` emits `[{ text: "git commit -F" }]` — the `ERROR` sits under `heredoc_redirect → file_redirect`, an `EXECUTION_HOST_TYPES` member that is descended for substitutions and never read for text.
  The tail command is in no unit at all.
- **Measured corpus** (local review log): 5636 deduplicated `bash` commands, 367 truncated by the 1000-character cap, 5269 intact.
  Two have `rootNode.hasError`; **zero** emit an `ERROR` node's text as a command unit.
  So the roadmap's Target — "a marker on `BashCommand` set on the `ERROR` branch Step 4 introduces" — fires zero times on real input, and the population it does reach is input `bash -n` rejects.
  Step 14's `Outcome:` line ("1 command in 4276") counted `ERROR`-node presence, not units a floor on that branch would reach.
  This is the `Outcome:`-line hazard `AGENTS.md` records for [#810], hit again on a different step.
- **The sharper failure mode is a dropped unit, not a permissively matched one.**
  `git add -A . && git commit -F - <<'MSG' 2>&1 | rm -rf /tmp/x` is valid bash (`bash -n` accepts it) and enumerates without `rm -rf /tmp/x`, so an explicit `bash: {"rm -rf *": "deny"}` is never consulted.
  The floor cannot restore that; filed as [#875].
- **Design gate.**
  First gate offered trigger conditions A/B/C; the operator asked what would be *observably* different between B and C rather than picking.
  Answering it — the prompt value, and the session-approval pattern, both read from `check.command` — produced a hybrid (D) that neither option had: the enumerator marker's cheap wiring with the program-level option's whole-command blame.
  Under B the recorded session grant would have been `git commit -F`, an exact-match pattern on a *fragment* that silently covers any later `git commit -F - <<'X' 2>&1 | <anything>`.
- **I told the operator something false and corrected it.**
  The second gate's substance claimed a floored unit re-prompts every invocation even after a session grant, because `resolveBashCommandCheck` clamps on state with no `source` check.
  That is true of the clamp but not of the system: `GateRunner.runGateCheck` tests `check.source === "session"` **before** state and returns allow, and `resolveWrapperUnit` spreads `...base`, so `source` survives the floor.
  The exemption the operator chose is therefore already the behavior and costs no code — it just was not pinned by a test, which the plan now adds.
  The lesson is the ordinary one: I reasoned from one function to a system claim instead of following the value to its consumer.
- **Bump settled as `fix:`** (non-breaking) on the operator's call, against the package's own calibration: [#821] shipped `fix:` at 2 of 3995, [#839] shipped `fix!:` at 3 of 5191.
  This one is 2 of 5269, and both measured commands already appear as `session_approved`.
- **Roadmap disposition:** [#875] deferred to a later phase — its three candidate fixes (an upstream grammar fix with no lever, a heredoc pre-pass, an ADR §10 amendment to hard-deny) are none of them capability-axis questions.

#### Deferred tidyings

- `src/access-intent/bash/command-enumeration.ts` — `makeUnit` hand-chains a ternary per optional field (`scoped` → `flagged` → `named` → return); the assessor proposed rewriting it as a single conditional-spread build.
  Declined as optional: the existing pattern scales one field at a time and this change adds exactly one.

### Diagnostic details

- **Escalation-delay tracking** — the corpus measurement was the third spike, after two smaller AST dumps.
  Running it first would have saved both; the signal that it was needed (the issue's example not matching the code) was visible in the very first dump.
- **Feedback-loop gap analysis** — the `GateRunner` session-fast-path error above was caught only because the plan's Risks section forced me to name what pins the exemption.
  Nothing earlier in the workflow would have caught it, and it had already shipped to the operator inside an `ask_user` gate.
- **Model-performance correlation** — the `tidy-first-assessor` subagent returned two corrections worth more than its tidying: `collectHostedCommands`' fresh scope literal, and `program.test.ts` as an uncounted call site (its `#742` block asserts exact `BashCommand[]` literals via `.toEqual`).
  Both are in the plan; the second was not in the target file list I handed it.

## Stage: Implementation — TDD (2026-09-04T15:35:49Z)

### Session summary

Executed all five planned TDD cycles with no reordering: the Tidy-First extraction, the enumerator marker, the fail-closed floor, the end-to-end pins, and the docs.
Test count went 4029 → 4086 (+57) in `pi-permission-system`; `check`, root `lint`, full `test`, and `fallow dead-code` are green, and the roadmap's `grep -c '<unparsed'` metric moved 0 → 2 as predicted.
Pre-completion reviewer: PASS.

### Observations

- **The planned mechanism survived contact with the code.**
  Every prediction the plan made about which nodes carry the marker held, because planning spiked the real parse trees first rather than reasoning from the enumerator's source.
- **The step-4 killing mutation did what the plan said it would**, and it is the finding worth keeping: restricting the enumerator to the `ERROR`-node branch — the trigger the roadmap's Target line named — turns the two real corpus commands and the `<>` read-write open red while every malformed row stays green.
  Without that mutation the change would look indistinguishable from the roadmap's original design.
- **Two mutation predictions in the plan were wrong, in opposite directions.**
  The container-exclusion mutation was predicted to kill the clean-chain tests; it cannot, because a clean parse has nothing to mark either way, so a separate "mark unconditionally" mutation was run for those four.
  And one pin — "leaves an explicit ask on a marked unit unchanged" — survived all five planned mutations, so a sixth (floor every state, not just `allow`) was added to prove it discriminates.
  Counting reds against the plan's prediction is what surfaced both.
- **The session-grant exemption needed no code at all**, confirming the correction recorded in the planning stage.
  `GateRunner` tests `check.source === "session"` before it tests state, so spreading the resolved check is the whole mechanism.
  It was behavior nothing pinned; the `runner.test.ts` row and the `bash-command.test.ts` row now do, and the M4 mutation (build the floored result fresh instead of spreading) kills exactly one test.
- **Deviation from the plan's TDD step 1.**
  `resolveCommandUnit` was extracted with three parameters, not the plan's four — the `command` parameter arrives in step 3 with the caller that reads it, because an unused parameter fails lint.
  Recorded in the commit body.
- **Deviation in file scope.**
  Two source files outside the plan's Module-Level Changes were touched, both comment-only: `src/bash-advisory-check.ts` and `src/handlers/gates/helpers.ts` each enumerate the fail-closed sentinels and would otherwise have gone stale.
  Isolated to the `docs:` commit.
- **Hit the heredoc-skips-autoformat trap** documented in `AGENTS.md`: appending the metamorphic block with a shell heredoc bypassed `pi-autoformat`, and root `lint` failed on formatting until `biome check --write` ran on that one file.
  Appending TypeScript with `Write`/`Edit` would have avoided it.

### Reviewer warnings

PASS with three non-blocking notes, none fixed in code:

- The planning-time corpus measurement (5269 intact commands, 2 with a parse error) could not be independently re-derived — it depends on a local review log outside the repository.
  The reviewer reported it as unverifiable rather than accepting it, which is the right handling.
- The `test:` commit body (`4d2f27a4`) undercounts the step-4 mutation's kill set: it names the two `git commit -F` rows, but the mutation also kills the `cat <> rw.txt` row (3 inputs, 8 test failures).
  Left as written rather than rewriting a mid-stack commit.
- The plan's `grep -c '<unparsed'` prediction of 2 is correct, but its gloss "the constant and its use" is imprecise — the second match is a doc-comment mention, since the use site is a symbol reference rather than a literal.
  Corrected here rather than in the plan, per the convention that `Landed:` notes carry corrections.

The reviewer independently reproduced eight of the plan's named mutations and ran a 30-input adversarial spike against the `collectHostedCommands` scope-reset boundary, attacking the marker-completeness invariant; all 30 held.

[#810]: https://github.com/gotgenes/pi-packages/issues/810
[#821]: https://github.com/gotgenes/pi-packages/issues/821
[#839]: https://github.com/gotgenes/pi-packages/issues/839
[#875]: https://github.com/gotgenes/pi-packages/issues/875

## Stage: Sync (worktree) (2026-09-04T16:06:48Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both pass with no fixes needed, and the branch is a clean fast-forward candidate onto local `main` (`git merge-base --is-ancestor main HEAD` holds).
No new commits were added in this stage — the branch lands exactly as the TDD session left it, six commits deep from the plan.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-840--/2026-09-04T03-28-41-223Z_01a06a76-1f07-7ebe-a062-9d8497599af0.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

Plan's `**Release:** ship independently` — nothing to batch or defer; `/ship-worktree` should release `pi-permission-system` on landing.
Between the pre-completion review and this sync, the session explored an unrelated detour (adding a `find /` deny-with-reason rule to the operator's global config, outside this repo) and returned here without committing anything from it — the working tree was already clean at sync start.
No deferred work or follow-ups beyond what the TDD stage note already recorded ([#875], filed and dispositioned against Phase 14 during planning).

## Stage: Final Retrospective (2026-09-04T16:23:02Z)

### Session summary

Landed the peer worktree branch on `main` as a clean fast-forward, verified CI, closed #840 with a commit-anchored summary, released `pi-permission-system` v31.0.2, and tore down the worktree.
The ship half ran 28 tool calls with no rework, no corrections, and nothing skipped.
This retrospective synthesizes all four stages — planning, TDD, sync, and ship — from the peer transcript recorded in the Sync stage note plus this session's own.

### Observations

#### What went well

- **Measuring the corpus before designing overturned two written artifacts at once.**
  The planning stage measured 5269 intact real `bash` commands and found the issue's own headline example does not do what the issue says, *and* that the roadmap Step 14 `Target` line named a trigger that fires zero times on real input.
  Both were prose written before anyone traced the mechanism.
  This is the `Outcome:`-line hazard `AGENTS.md` records for [#810], caught here at planning time rather than at test-writing time — which is the whole point of the rule.
- **Counting mutation reds against the plan's prediction caught two wrong predictions in opposite directions.**
  The container-exclusion mutation could not kill the clean-chain tests (a clean parse has nothing to mark either way), and one pin survived all five planned mutations.
  A sixth mutation was added to prove that pin discriminates.
  Neither would have surfaced from a green suite; both surfaced from comparing the red *count* to the plan's named kill set.
- **Rendering the real output caught a defect that inspection would not have.**
  During the mid-session `find /` detour, building the actual denial sentence exposed a double period — `reasonClause` appends its own `.`, so a config reason ending in one renders `resources..`.
  The rule that follows is general: a config value that feeds a rendered sentence has to be rendered, not read.
- **Correcting a false statement already delivered to the operator.**
  The planning stage's second `ask_user` gate claimed a floored unit re-prompts every invocation even after a session grant.
  That was true of the clamp and false of the system — `GateRunner` tests `check.source === "session"` before it tests state.
  The session found this while writing the plan's Risks section, corrected it in the retro, and added the test that pins the behavior nothing had pinned.

#### What caused friction (agent side)

- `rabbit-hole` — during the `find /` detour, six consecutive tool calls went into hand-building a `PromptPermissionDetails` payload for a throwaway spike, patching one missing required field at a time (`requester`, then the payload shape, then the helper's module name guessed as `prompt-payload-fixtures` instead of `prompt-details-fixtures`).
  The pivot to the existing `test/helpers/` builder was correct and self-identified, but arrived after five failed attempts, and even then the module path was guessed rather than grepped, costing two more calls.
  Impact: roughly six wasted tool calls in the detour; no rework to committed artifacts, since every spike file was removed and the working tree stayed clean.
- `instruction-violation` (self-identified) — appended the metamorphic test block with a shell heredoc, bypassing `pi-autoformat`, and root `lint` failed on formatting until `biome check --write` ran on that one file.
  `AGENTS.md` documents this exact trap ("append source with `Write`/`Edit` too, not just markdown").
  Impact: one extra fix call; no rework.
  Notable as a **recurrence** — the rule exists, is specific, and was still missed, which is a salience signal rather than a coverage gap.
- `instruction-violation` (self-identified) — an `Edit` call carried a stray `oldText2`/`newText2` key pair, which the tool silently ignores while still reporting success.
  The session caught it immediately and verified both intended edits had landed.
  Impact: one verification call; the `AGENTS.md` rule ("count reported blocks against intended edits") worked exactly as written.

#### What caused friction (user side)

- None on the ship path.
  The `find /` request arrived mid-stage — after the pre-completion review, before `/sync-worktree` — and was handled cleanly with the working tree left clean, but interleaving an unrelated config investigation into an implementation session is the kind of context switch that costs more than it appears to.
  Raising it as a separate session after the land would have cost nothing and kept the stage boundary crisp.
- The detour turned out to be a **premise correction**, not a task: the operator believed `find /` was ungated, and it was already denied by an existing `"find / *"` rule.
  Checking the live config first would have reframed the request from "add this" to "add a reason to this" before any work started.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `claude-opus-5` (judgment-heavy: a measurement that overturned the issue's diagnosis, three `ask_user` design gates, six mutation rounds) — appropriate.
  Sync and ship ran on `claude-sonnet-5` (deterministic gate sequences with no design decisions) — also appropriate, and the ship stage's zero-rework run supports it.
  Two subagents dispatched, both in the peer session: `tidy-first-assessor` at planning (returned two corrections worth more than its tidying — a scope-literal bug and an uncounted call site not in the file list it was handed) and `pre-completion-reviewer` at TDD close (PASS; independently reproduced eight named mutations and ran a 30-input adversarial spike).
  No mismatches.
- **Escalation-delay tracking** — one sequence over the threshold: the six-call fixture-construction loop described above.
  The signal to stop was available at attempt two, when the second missing required field appeared; the correct move was `grep -rn "makePromptPayload" test/helpers/` before writing the first spike, which is what eventually resolved it.
- **Unused-tool detection** — that same loop had `colgrep` and a plain `grep` over `test/helpers/` available from the start and used neither until call five.
  No subagent was warranted; this was a one-grep answer, not a hunt.
- **Feedback-loop gap analysis** — verification ran incrementally and correctly throughout: `pnpm run check` after each type-touching step, targeted `vitest run` per file at Red and Green, root `lint` before each commit, and the full four-gate baseline before the first TDD step.
  No gap found.

### Changes made

1. `packages/pi-permission-system/docs/retro/0840-unparsed-bash-subtree-fails-closed.md` — appended this Final Retrospective stage entry.
2. `.pi/skills/testing/SKILL.md` — added a Test factories bullet requiring a spike that constructs a domain object to locate the shared `test/helpers/` builder by grep before hand-building one.

#### Deferred

- `docs/configuration.md` has no note that a `denyWithReason` value must not end in punctuation — `reasonClause` appends its own period, so a reason ending in `.` renders a double period to the agent (measured during the `find /` detour).
  Proposed and declined here rather than cutting a patch release for one sentence; fold it into the next change that touches this package's docs.
