---
issue: 829
issue_title: "pi-subagents: agent frontmatter silently discards subagent tool parameters; narrow the guard to explicitly locked fields"
---

# Retro: #829 — Narrow the frontmatter guard to explicitly locked fields

## Stage: Planning (2026-08-29T22:16:47Z)

### Session summary

Planned Phase 22 Step 3: flip the `subagent` tool door's precedence to caller-wins, add a `locked:` frontmatter opt-out, report discarded overrides in the tool result, and fold in [#834]'s thinking-level validation.
The design gate settled six decisions; a Tidy-First assessment produced one preparatory `refactor:` step and two design corrections.
Plan committed at `packages/pi-subagents/docs/plans/0829-locked-fields-precedence.md` with an eight-step TDD order.

### Observations

The framing in the issue understated how localized the change is.
`resolveAgentInvocationConfig` has exactly one production call site (`resolveSpawnConfig`), and the SDK door already resolves caller-over-config in `assembleSessionConfig` and `SubagentSession.runTurnLoop`.
So caller-wins is not a new policy in the package — the plan makes the tool door agree with the door that already had it.
That reframing is what made "lock scope: tool door only" the cheap answer rather than a compromise.

Traced [#834]'s open question at planning time instead of deferring it.
Measured against the installed `@earendil-works/pi-ai@0.84.4`: `clampThinkingLevel(model, "bananas")` returns `"off"`, because an unknown level misses the ordered table and falls to `availableLevels[0]`.
An unrecognized thinking level therefore silently *disables* thinking rather than being ignored — the strongest argument for rejecting at the door, and a fact no amount of reading the type would have produced.
Two doc defects fell out of the same trace: `off` is valid at runtime but absent from the `ThinkingLevel` this package re-exports, and `max` is missing from every doc and from the tool schema.

Established that `THINKING_LEVEL_OPTIONS` is internal to `@earendil-works/pi-coding-agent` and absent from its public `index.d.ts`, so the package must carry its own level list.
Planned two complementary checks rather than a literal assertion: a `satisfies` clause (catches an entry the SDK does not declare) and a runtime SDK-parity test against `getSupportedThinkingLevels` (catches a level the SDK adds).
The residual — a level the SDK adds *and* gates behind `thinkingLevelMap` — is stated in the plan rather than papered over.

Release finding worth carrying forward: the roadmap names this issue the `front-door-majors` batch tail, but [#828] (the other member) is still open, and it is `refactor!:` — a hidden changelog type that cannot cut a release alone.
So the marker is `mid-batch — defer`: hold the release-please PR open until [#828] joins it.
The batch's tail designation is about which commit is the *release vehicle*, not about landing order.

Rejected [#641] (operator-configured `defaultMaxTurns` floors) as out of scope with a recorded reason: a floor is a clamp at the settings layer, a lock is a choice at the agent-file layer, and folding them together would put settings into a merge that is currently agent-file-only.
Phase 22's sweep line for [#641] is unchanged; the exclusion lives in the plan's Non-Goals.

Chose `locked: true | [fields]` over a list-only form specifically for the migration story: `true` means "lock every field this file sets", which is byte-identical to today's behavior and makes the `BREAKING CHANGE:` footer a one-line remedy.
The two forms also differ on the bare-lock case deliberately — a list entry denies the caller even when the file sets nothing, `true` cannot express that.

#### Deferred tidyings

- `packages/pi-subagents/test/config/invocation-config.test.ts` — nesting the flat `describe` into a scenario tree; declined because the precedence flip inverts nearly every assertion, so the nesting is cheaper inside the rewrite commit than as a separate `test:` step.
- `packages/pi-subagents/src/config/custom-agents.ts` — extracting `loadFromDir`'s per-agent object literal into a `buildAgentConfig()` helper; declined as scope creep, since `locked:` adds one more field parse and no readability friction.
- `packages/pi-subagents/src/tools/agent-tool.ts` — restructuring the parameter schema block; declined, the change is a rewrite of `description` strings with no structural friction.

[#641]: https://github.com/gotgenes/pi-packages/issues/641
[#828]: https://github.com/gotgenes/pi-packages/issues/828
[#834]: https://github.com/gotgenes/pi-packages/issues/834

## Stage: Implementation — TDD (2026-08-29T23:05:01Z)

### Session summary

Executed all eight plan steps as eleven commits, plus two review-driven follow-ups.
The `subagent` tool door now lets a caller's parameter win, with `locked: true` / `locked: [<fields>]` as the opt-in guard; [#834] landed alongside as `src/config/thinking-level.ts` with validation at all three producers. pi-subagents tests went 1266 → 1337 (+71); `pnpm run check`, root `pnpm run lint`, `pnpm run test`, and `pnpm fallow dead-code` are green.

### Observations

The plan's killing mutation for the thinking-level step did not kill, and finding that out is the session's most useful result.
The planned SDK-parity test built its `thinkingLevelMap` from `THINKING_LEVELS` itself, so dropping `"max"` from the list also dropped it from the map, `getSupportedThinkingLevels` stopped reporting it, and the test stayed green.
The check was vacuous for exactly the levels that could plausibly drift — `xhigh` and `max` are the only gated ones.
Replaced with two directional checks: an ungated-parity assertion (catches a level the SDK adds without a gate) and a per-level `clampThinkingLevel(model, level) === level` loop (catches an entry the SDK does not know, since it clamps an unknown level to `off`).
Both were verified with mutations that do kill.
The residual — a level the SDK adds *and* gates — is recorded in the module's doc comment rather than left implicit.

[#834]'s open question ("I have not traced what the SDK does with an unrecognized level") was answered by measurement during planning, and the answer drove the design: `clampThinkingLevel` misses an unknown level in its ordered table and returns `availableLevels[0]`, which is always `off`.
A typo therefore *disables* thinking rather than being ignored, which is why all three producers reject or drop rather than pass through.

Two deviations from the plan's Module-Level Changes, both deliberate.
The planned lock-note test in `test/tools/foreground-runner.test.ts` was not added: steps 1 and 2 already pin both runners rendering `config.notes` content-independently, so a lock-note variant would re-assert the same mechanism with different strings.
A fallback-plus-lock ordering test went into `test/tools/spawn-config.test.ts` instead — that composition was the genuinely unpinned claim, and it needs a registry whose `general-purpose` override is itself locked.
Step 1 also revealed that `background-spawner.ts` rendered no notes at all, so an unknown agent type routed to background fell back silently; fixing that became its own `fix:` step rather than riding along in a `refactor:`.

The `locked: true` / list split earned its keep during implementation.
`true` locks only what the file sets and the list locks what it names, so the two forms are not redundant: `true` is the exact pre-change behavior (hence the one-line migration in the `BREAKING CHANGE:` footer), while the list can deny an override for a field the file supplies no value for.
The four-case precedence table needed a mutation per form to prove the distinction was pinned.

Pre-completion reviewer: WARN → WARN → PASS over three rounds.
Round 1 caught a README sentence *this PR added* that overclaimed — the SDK door fills `model`, `thinkingLevel`, and `maxTurns` from frontmatter but never `inheritContext`, which `service-adapter.ts` resolves to `false` before the manager sees it.
Round 1 also flagged that `resolveField`'s `!== undefined` presence check was correct but unpinned, a bug class this package has shipped before; round 2 flagged the remaining `model: ""` gap and, usefully, that filing the README correction under `test:` would leave an incorrect public claim shipped visibly under `docs:` with its fix hidden.
Split into a `docs:` commit and a `test:` commit before pushing.

### Diagnostic details

- **Feedback-loop gap analysis** — the plan's own predicted metric (`agentConfig?.` merges 5 → 0) was re-measured at step 8 rather than asserted; it landed at 0 as predicted.
- **Escalation-delay tracking** — three consecutive lint failures on the same helper (`describeRejected`) before abandoning `JSON.stringify` for an explicit `typeof` ladder; `@typescript-eslint/no-base-to-string` and `no-unnecessary-condition` pulled in opposite directions because `JSON.stringify`'s declared return type omits the `undefined` it returns for functions and symbols.

## Stage: Ship (worktree) (2026-08-29T23:17:46Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both passed clean on the first run — no fixes needed.
The plan's `**Release:** mid-batch — defer (batch "front-door-majors")` marker carries forward: [#828] (`refactor!:`, the batch's other member) has not landed, so the root should leave the `pi-subagents` release-please PR open until [#828]'s commit joins this one, per `AGENTS.md`'s per-package release-PR guidance.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-829--/2026-08-29T21-44-24-322Z_01a04f7b-2002-754d-9958-37f16a660d21.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

No new friction at this stage — the TDD stage's three pre-completion review rounds already caught and closed everything substantive before this branch reached ship.

## Stage: Final Retrospective (2026-08-29T23:33:37Z)

### Session summary

Landed the worktree branch onto linear `main` (ff-merge, CI green, `61895afa`), closed [#829] and [#834] with commit-anchored summaries, deferred the release per the plan's `mid-batch — defer` marker, and tore down the worktree.
The issue ran four stages across two sessions — planning, TDD, and worktree ship in the peer; land and this retrospective at the root — shipping eleven commits and taking pi-subagents from 1266 to 1337 tests.

### Observations

#### What went well

- The `/tdd-plan` "Verify the pins" step caught a defect in the **plan** rather than in the implementation, which is a first across these retros.
  Step 3's plan-named killing mutation (drop `"max"` from `THINKING_LEVELS`) left the SDK-parity test green because the test built its `thinkingLevelMap` from `THINKING_LEVELS` itself — the fixture derived from the thing under mutation, so the check was circular and vacuous for exactly the two gated levels (`xhigh`, `max`) that could plausibly drift.
  The implementing session replaced it with two directional checks and verified all three replacements with mutations that do kill.
  A plan-authored mutation is written before the test exists, so it cannot see a fixture that will later derive from the mutated symbol; the Verify step is the only place that gap closes.
- Planning answered [#834]'s open question by **measuring** the SDK rather than reading its types: `clampThinkingLevel(model, "bananas")` returns `"off"` because an unknown level misses the ordered table and falls to `availableLevels[0]`.
  That an unrecognized level silently *disables* thinking — rather than being ignored — is what drove rejection at all three producers, and no amount of reading `ThinkingLevel` would have produced it.
- Round 2 of the pre-completion review caught a **commit-typing** defect rather than a code defect: filing the README correction under `test:` would ship an incorrect public claim visibly under `docs:` while its fix stayed hidden.
  The session reset and re-split into `docs:` + `test:` before pushing.
  This is the `AGENTS.md` "type a commit by what a user can observe" rule applied to a *correction*, where the observable is the claim being withdrawn.

#### What caused friction (agent side)

- `instruction-violation` (self-identified, at retro) — the land session skipped the release without asking, though the marker it read said `confirm at ship time`.
  `/land-worktree` step 6.1 says `mid-batch — defer` → " **skip releasing**", while `/ship-issue` step 2 says the same marker → "ask the operator **now**".
  The canonical marker string `/plan-issue` writes (line 148) ends with `confirm at ship time`, so the worktree path contradicts the text it is reading.
  Impact: no rework — deferring was the right call — but the operator never got the confirmation the plan requested, on a `fix!:` breaking change.
- `other` — the same divergence has a **timing** half.
  `/ship-issue` gathers the release decision in a step 0 explicitly placed "before any irreversible work," reasoning that "a decision presented early from the plan is far less likely to be reversed than one inferred from prose at the cancel point." `/land-worktree` reads the marker at step 6 — after push, CI, and issue close — so even if it asked, it would ask at exactly the cancel point the trunk path was designed to avoid.
  Impact: latent; it did not bite here because the answer was "defer", which needs no rollback.
- `missing-context` — the plan's step 3 killing mutation was self-referential (see above).
  Impact: roughly six tool calls of rework at TDD step 3, all pre-commit.
- `missing-context` — the README correction was initially bundled into a `test:` commit.
  Impact: one `git reset HEAD~1` and a re-split into two commits.
- `other` — the land session ran `git rev-parse HEAD | wc -c` to count the characters of a SHA it already held.
  Impact: one wasted call, no consequence.

#### What caused friction (user side)

- The operator ran all four stages hands-off with no interventions, which suited a well-specified roadmap step.
  The one place operator judgment was genuinely wanted — whether to hold the release for [#828] on a breaking change — is precisely the decision the `/land-worktree` gap swallowed.
  This is a prompt defect rather than an operator one: the flow should have surfaced it without being asked.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5` (thinking high), appropriate for a breaking-change design plus an eleven-commit implementation.
  Worktree ship and land ran on `anthropic/claude-sonnet-5`, appropriate for mechanical checks, rebase, and merge.
  Worth noting that the release-deferral judgment landed on the sonnet-5 land session, and it is the step where the prompt/marker conflict needed catching — the gap is in the prompt, but a cheaper model reading a contradictory instruction is where it surfaces.
  Subagent dispatches: one `tidy-first-assessor` at planning, three `pre-completion-reviewer` rounds at TDD; all produced substantive findings, so no capability mismatch is evident.
- **Feedback-loop gap analysis** — no gap.
  All four baseline gates ran before the first TDD step, `pnpm run check` ran after nearly every green step, and the full suite plus lint plus `fallow dead-code` ran at each commit boundary.
- **Escalation-delay tracking** — the longest same-error sequence was roughly four check/lint rounds on the `describeRejected` helper, where `@typescript-eslint/no-base-to-string` and `no-unnecessary-condition` pulled in opposite directions.
  Already recorded in the TDD stage note; below the five-call threshold for a subagent dispatch.

### Changes made

1. `.pi/prompts/land-worktree.md` — added a `## Release coordination (decide before step 1)` section mirroring `/ship-issue`'s step 0, so the plan's `**Release:**` marker is read and (on `mid-batch — defer`) confirmed with the operator **before** the ff-merge, push, CI, and issue close.
2. `.pi/prompts/land-worktree.md` — rewrote step 6.1 to apply the decision recorded up front instead of reading the marker at the cancel point.
3. `AGENTS.md` (line 190) — the release-batching sentence now names `/ship-issue` **and** `/land-worktree` as reading the marker early, so the doc no longer describes the two paths' divergence as intended behavior.
4. Filed [#843] — rename the worktree ship-flow commands; `/ship-worktree` prepares and does not ship, while `/land-worktree` is the half that actually ships and is the true sibling of `/ship-issue`.
   Raised by the operator at this retro's clarification gate.
   Left to its own issue rather than landed inline: the rename touches two prompt files plus references in `AGENTS.md`, `README.md`, and four other prompts, and the choice of names is itself the substance.

[#843]: https://github.com/gotgenes/pi-packages/issues/843
