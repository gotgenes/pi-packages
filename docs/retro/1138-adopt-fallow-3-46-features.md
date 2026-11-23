---
issue: 1138
issue_title: "Evaluate fallow 3.46 features: mutation, audit --staged, publicFiles, package-cycle, V8 coverage, test_reach"
---

# Retro: #1138 — Evaluate fallow 3.46 features: mutation, audit --staged, publicFiles, package-cycle, V8 coverage, test_reach

## Stage: Planning (2026-11-23T02:23:50Z)

### Session summary

Measured each of the seven features (six from the issue body and `private-type-leak` from its comment) on the real tree and in a throwaway worktree of `d193e6f1`, then put a decision per feature to the operator.
Wrote a five-step build plan (`docs/plans/1138-adopt-fallow-3-46-features.md`).
Filed [#1140] for the barrel/`publicFiles` work and recorded its Phase 16 disposition in pi-permission-system (`b6c8a833`).

### Observations

- **Operator decisions:**
  - `mutation`: on-demand recipe only (no reviewer or CI step).
  - `audit --staged`: pre-commit hook.
  - `package-cycle`: raised to `error`.
  - `private-type-leaks`: `off`, re-enabled in [#1140].
  - Coverage: swap Istanbul for `@vitest/coverage-v8`.
  - `publicFiles`: declined pending [#1140].
  - `test_reach`: declined.
- **`fallow mutation` cannot find tests from the repo root** (`test-files-not-discovered`), because the package Vitest configs have no `root`.
  `root: import.meta.dirname` fixes it, and pi-autoformat's `projects` inherit it (measured).
  `--base` cannot be narrowed to one package: `--workspace` is rejected, and so are paths combined with `--base`.
- **CI's `audit --base` step is PR-only**, so main-lane commits never saw audit's complexity and duplication checks before this change.
  Replaying the last 60 `src` commits: 2 fail, 8 warn, about 2 s each.
- **The V8 swap was first offered as "keep Istanbul".**
  The operator asked about the trade-offs, which prompted the side-by-side measurement: identical fallow results, and a bare `vitest run --coverage` fails today because V8 is Vitest's default provider.
- **The `private-type-leak` decision moved once barrels came up.**
  The operator pointed out that the `code-design` rule added in `68b62894` makes `index.ts` the directory API, so exporting a type from its file stops widening anything once a barrel exists.
  A spike (6 exports in `notification-renderer.ts`) cleared 10 leaks with no `dead-code` fallout.
- **The `ask_user` guard rejected four calls as thinking-only.**
  The rejected messages carried their briefing only in thinking blocks.
  Two decisions were then taken in plain chat.
- **Tidy First skipped:** no `src/` or `test/` file changes; the only `packages/` edits are the nine `vitest.config.ts` files.
- **Issue #155 checked:** it removed unused barrel re-exports, which is consistent with the new `index.ts` rule, and [#1140] cites it.

## Stage: Implementation — Build (2026-11-23T03:11:03Z)

### Session summary

Landed all five build steps as separate commits (`bc0bcbe3`, `16ed3bf5`, `be1cd70d`, `28ad7dfb`, `285adc19`).
The commits root the Vitest configs, swap in `@vitest/coverage-v8`, set the two `.fallowrc.json` rules, add the `fallow audit --staged` pre-commit hook, and add the `fallow` skill updates.
Per-package test counts are identical to the pre-change baseline, and every verification command the plan's Test Impact Analysis names reproduced its planned result.

### Observations

- **Deviation (step 2): `pnpm install` does not drop a removed package that is still a resolved optional peer.**
  `@vitest/coverage-istanbul` stayed in every `vitest@5.1.1(...)` lockfile key and stayed installed after its root devDependency was removed.
  Neither `--fix-lockfile` nor `pnpm update -r vitest` cleared it, and `pnpm dedupe` rewrote about 500 unrelated lines, so it was reverted.
  The fix was a hand edit: strip the peer suffix and the orphaned entries, then `pnpm install` and `--frozen-lockfile`.
- **Pre-completion reviewer: WARN, then PASS on the delta.**
  The WARN found an orphan the hand edit missed (`@istanbuljs/schema`), and a commit body that credited `pnpm install` with pruning it.
  Both were fixed by rewriting the unpushed step-2 commit (`c81b2c73` → `16ed3bf5`); the replayed commits keep the same patch ids.
  The delta PASS noted one wording nit in the rewritten body: `js-tokens` became non-optional rather than "a required dependency".
- **The delta review's first test run failed 3 heartbeat tests** in pi-permission-system under machine load (files took 333 s and 168 s); its rerun and a second full run passed.
- **The hook ran on this session's own commits** and skipped each one, because none staged code or JSON after `prek.toml` landed.

## Stage: Final Retrospective (2026-11-23T04:23:16Z)

### Session summary

One session ran planning, the five-step build, ship, and this retro.
Planning turned a seven-feature evaluation into measured decisions: three adoptions, two config rules, two declines, and follow-up [#1140].
The build landed in five commits, and one pre-completion WARN (a lockfile orphan plus a wrong commit body) was fixed by rewriting an unpushed commit.
CI passed on the first push, and no package released.

### Observations

#### What went well

- **Replaying history in a throwaway worktree priced a gate before adopting it.**
  Planning checked out each of the last 60 `src` commits in `/tmp/wt-1138` and ran `fallow audit --base <sha>~1` and `review --brief` there.
  That turned "would a pre-commit audit be noisy?" into 2 fails and 8 warns, and "is `test_reach` useful?" into 2 leads, both false, before either went to the operator.
- **A one-file spike settled a design question in a gate.**
  Exporting the six local types in `notification-renderer.ts` cleared 10 of the 48 leaks with no `dead-code` fallout.
  That turned the operator's barrel question into evidence rather than an argument.

#### What caused friction

- `slip`: four `ask_user` calls were blocked as thinking-only.
  The session file shows each blocked message as only thinking blocks plus a `toolCall`, with no text block (entries 171, 173, 175, 208).
  Each still spent over 1,100 output tokens: the briefing was written inside the reasoning, and the response went straight from reasoning to the tool call.
  The stored thinking summary of entry 171 even says "ask a quick confirmation through ask_user, with visible text in the same message".
  Both passing calls (125, 423) were long reports written after tool work; all four failures were short follow-up gates right after an operator chat reply.
  The same slip is recorded in `docs/retro/1137-refresh-tooling.md` and `packages/pi-permission-system/docs/retro/0609-redirect-target-by-role.md`.
  Issue #1137's guard message change did not stop it recurring.
  Impact: 4 rejected calls, and two decisions taken in plain chat instead of the structured form.
  Tool-caught.
- `other`: the retries rested on a misdiagnosis that blamed the tool.
  After the third block, the reasoning read "The guard keeps stopping my visible text, so it seems the system only registers my thinking."
  The guard's message said the opposite, and correctly: there was no visible text to stop.
  Believing the text existed and was being dropped, the session never changed how it emitted the briefing; it switched to plain chat as a workaround for the tool, not as a fix to its own output.
  Impact: the cause went unrecorded until this retro (the Planning stage note says only "carried their briefing only in thinking blocks").
  Operator-caught in this retro.
- `rule-ignored`: the first coverage option recommended "Keep Istanbul".
  It rested only on the raw `NODE_V8_COVERAGE` probe and never priced the cheapest viable alternative, the `@vitest/coverage-v8` provider swap.
  `clarification-gates` was loaded and says "When rejecting a candidate on cost, price its cheapest viable form first."
  Impact: the operator answered with "It's hard for me to understand the tradeoffs", and the gate took a second round plus a scratch-worktree install and comparison.
  Operator-caught.
- `rule-ignored`: `/plan-issue` says to load `code-design`, and planning never read it.
  The `private-type-leak` options then called exporting the types "widening each module's apparent API".
  That ignored the `index.ts`-is-the-directory-API rule (added in `68b62894`), which the session had itself grepped while measuring `publicFiles`.
  Impact: one more question-and-answer round, plus a spike, before the operator's decision.
  Operator-caught.
- `fact`: removing a package that another dependency declares as an optional peer leaves it in `pnpm-lock.yaml`'s peer-suffixed `vitest@5.1.1(...)` keys, and still installed.
  `pnpm install --fix-lockfile` and `pnpm update -r vitest` left it; `pnpm dedupe` cleared it but rewrote about 500 unrelated lines.
  Impact: about 12 tool calls in step 2 (above the 5-call escalation bar).
  The hand edit that resolved it missed one orphan (`@istanbuljs/schema`) and misread re-added blocks as removals, so the commit body was wrong, and fixing that took a rebase and a second review round.
  Reviewer-caught.
- `slip`: a `/tmp/lock.bak` backup was taken after `--fix-lockfile` instead of before it, so restoring it reinstated a 506-line diff.
  Impact: 2 tool calls; recovered with `git checkout pnpm-lock.yaml`.
  Self-identified.
- `slip`: a `(cd packages/pi-autoformat && …)` subshell was denied by the `cd packages/*` policy.
  The `testing` skill and the deny rule already cover it, and #1137's retro records the same slip.
  Impact: 1 call.
  Tool-caught.

#### What the operator steered

- `steer:fact`: "What's the alternative to turning private-type-leaks off?
  Why are we tripping it?
  Do you have some illustrative examples?", answered with a question instead of a selection after the agent recommended `off`.
- `steer:choice`: "Perhaps this is something we can work towards as improvements?", on declining `publicFiles`; it led to filing [#1140].
  The operator's words left its reach unstated.
- `steer:fact`: "It's hard for me to understand the tradeoffs between the two dependencies, though.", after the agent recommended keeping Istanbul.
- `steer:rule`: "Would the `index.ts` barrel also address the exporting of 48 new types which are not intended to be the public API outside of that package?
  We added a new architectural design rule to promote the barrel files for the public API, right?"; this pointed at `code-design`'s `index.ts` rule.
- `steer:choice`: "Yes, off now.
  I'm fine staying with Istanbul unless the V8 swap is straightforward."
  The operator's words left its reach unstated, and no earlier retro records a `steer:choice` on coverage providers or type-leak rules.
- `steer:fact`: "Why did the agent think it wasn't still replying in thinking mode?
  Are you able to see the tool invocations to see what's going wrong?", in place of a selection at this retro's proposal gate.
  It led to reading the session file's content blocks.
- `steer:fact`: "Here's a chain of events I'm referring to; is this the same one you're thinking of?", quoting the thinking summaries that ended in the misdiagnosis above.
- `steer:choice`: "Implement that proposal.
  I'm not interested in Proposal 2 at this point.", declining the optional-peer `fact` for `code-design`.
  The operator's words left its reach unstated.

### Diagnostic details

- **Model-performance correlation:** planning, build, and retro ran on `anthropic/claude-opus-5-5`; ship ran on `anthropic/claude-sonnet-5-5` (12 turns).
  Both `pre-completion-reviewer` dispatches ran on opus, as their transcripts under this session's `tasks/` show.
  Sonnet fits the mechanical ship, and opus fits the judgment-heavy review, whose first round caught the lockfile orphan.
  The delta review took 1,360 s, mostly a full suite rerun under machine load.
- **Escalation-delay tracking:** the step-2 lockfile stretch ran about 12 consecutive calls (`install`, `--fix-lockfile`, `dedupe`, restore, `update -r`, two hand edits) before converging.
  A pause to state the pnpm behavior and ask the operator whether a hand edit was acceptable would have cost one turn and settled the approach before the misread.
- **Feedback-loop gap analysis:** none; `lint`, `check`, and `fallow dead-code` ran before every build commit, and `test` ran after step 1 and at the end.

### Changes made

1. `.pi/extensions/ask-user-text-first.ts`: the guard counts consecutive blocks, and a message with visible text resets the count.
   From the second block in a row, the reason says the briefing is still in thinking, tells the agent to stop calling `ask_user`, and asks for the briefing and questions as plain reply text that ends the turn.
   A stub-API probe confirmed the sequence: the first thinking-only call gets the thinking reason; the second and third get the repeat reason; a text reply passes and resets the count; a bare call after that gets the no-text reason.

Proposed and declined: a `code-design` § Tooling bullet recording that pnpm keeps a removed package that is still a resolved optional peer.

[#1140]: https://github.com/gotgenes/pi-packages/issues/1140
