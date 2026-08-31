---
issue: 798
issue_title: "pi-subagents: foreground subagent results omit the agent ID that resume requires"
---

# Retro: #798 — pi-subagents: foreground subagent results omit the agent ID that resume requires

## Stage: Planning (2026-08-31T03:56:15Z)

### Session summary

Planned Phase 22 Step 7: the foreground and resume-return result edges gain an `Agent ID: <id>` line so the model can act on the handle the background door already delivers.
Design settled at one operator gate (shape, edges, inline-vs-helper); the tidy-first assessor found no preparatory tidying warranted and confirmed the fixtures already express the new assertions.
Plan committed as `packages/pi-subagents/docs/plans/0798-deliver-resume-handle-in-foreground-results.md` — two TDD cycles (the three delivery edges, then the roadmap step-mark).

### Observations

- The defect is a delivery-channel asymmetry, not a missing capability: `buildDetails` already sets `details.agentId`, but `details` is renderer metadata and never reaches the model.
  The issue's own comment sharpened it further — the background door has *two* model-visible channels (spawn result and completion nudge), the foreground door has none.
- Operator decisions at the gate: bare `Agent ID: <id>` header line (byte symmetry with `background-spawner.ts`, no restated resume hint); all three edges including the foreground error branch and the resume-return edge; the literal written **inline** at each site rather than extracted into a `tools/helpers.ts` helper.
- The inline decision keeps the roadmap's health-metric row valid as written — its recompute command greps `'Agent ID'` in `foreground-runner.ts` specifically, so a helper extraction would have forced a same-commit row rewrite.
  Measured baseline `0`; predicted `2` after the change (success and error branches).
- Named an invariant the existing suite does not actually pin: Phase 22 Step 3's spawn-notes prefix (`renderSpawnNotes`) must keep leading the result, but the `fellBack` test asserts only containment and is order-blind.
  The plan strengthens it into an index comparison and gives it its own killing mutation.
- Two things the handle unlocks, not one — `resume` and `get_subagent_result(id, verbose: true)` for a truncated foreground summary.
  Worth remembering if a later step reconsiders the line's placement.
- Scope held to delivery: recognizing that a result *is* a question belongs to Step 8 ([#465]), whose soft dependency on this step is exactly the handle.

#### Deferred tidyings

- `packages/pi-subagents/test/` — the raw `result.content[0].text` index access repeats 7× in `test/tools/foreground-runner.test.ts`, 13× in `test/tools/agent-tool.test.ts`, and across 5 test files package-wide with no helper anywhere; the assessor declined it as a package-wide craftsmanship item rather than local friction for this change.

## Stage: Implementation — TDD (2026-08-31T04:10:09Z)

### Session summary

Executed both plan cycles from a green baseline: one `fix:` commit adding the `Agent ID: <id>` line to the three model-visible delivery edges (`runForeground`'s success and error returns, the resume-return edge in `AgentTool.execute`) with five new tests, and one `docs:` commit marking Phase 22 Step 7 landed.
`pi-subagents` test count went 1353 → 1358.
All four of the plan's killing mutations were applied and reverted before the commit; the pre-completion reviewer returned PASS.

### Observations

- One deviation, in the plan's prediction rather than the code: mutation (a) — deleting the ID term from the success branch — killed **three** tests, not the two the plan named.
  The ordering test ("keeps the spawn notes ahead of the agent ID line") rides the success path too, so its `indexOf` assertion goes `-1` when the line disappears.
  A superset of the prediction, not a shortfall, but it is the kind of miss that would read as a vacuous test if the count had gone the other way.
- The ordering test earns its place twice over: mutation (a) kills it by absence and mutation (d) — hoisting the ID line above `${noteText}` — kills it by reordering, while every `toContain` assertion in the suite stays green under (d).
  That mutation is the whole reason the plan upgraded Step 3's order-blind `fellBack` containment assertion.
- Mutation (c) restored `agent-tool.ts` to a byte-identical copy of its `HEAD` content — `git diff --stat` printed nothing — which is a useful confirmation that the mutation is the exact inverse of the green edit, and a reminder that an empty diff there is not evidence the mutation failed to apply.
- The note string in the ordering assertion was copied from its producer (`buildFallbackNote` in `spawn-config.ts`), not from the plan's prose: `Note: Unknown agent type "<type>" — using general-purpose.`, em-dash included.
- The reviewer's independent enumeration of all 18 `textResult(...)` call sites in `src/tools/` found no missed edge.
  The `steer-tool.ts` and resume-error returns already interpolate the caller-supplied ID into their sentences, and every remaining ID-less site has no record to name.
- Pre-completion reviewer: PASS — ready for `/ship-issue`.
  No warnings.

## Stage: Sync (worktree) (2026-08-31T04:19:16Z)

### Session summary

Pre-push checks passed clean (`pnpm run lint`, `pnpm fallow dead-code`), no fixes needed.
The plan's `**Release:** ship independently` marker applies — no batch to coordinate, release now.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-798--/2026-08-31T03-41-03-084Z_01a055e8-00ec-76f4-bd72-34a7144715d8.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Nothing new since the TDD stage — branch is ready to rebase onto `origin/main` and hand off.

## Stage: Final Retrospective (2026-08-31T15:32:20Z)

### Session summary

Shipped the foreground resume handle across four stages — planning, TDD, worktree sync, and root land — with no rework at any boundary and no reviewer findings.
The root `/ship-worktree` run was clean end to end: fast-forward merge, push, CI green, issue closed, `pi-subagents-v21.0.3` released, worktree torn down.
The issue's substance was small; what this retro has to say is mostly about the mutation-testing discipline that made the TDD stage unusually well-pinned, and one self-inflicted detour at the land.

### Observations

#### What went well

- The step's mutation predictions were checked against reality in the right direction.
  Mutation (a) killed **three** tests where the plan named two, and the TDD session classified that as a superset rather than quietly accepting it — the prompt's rule flags a mutation killing *fewer* tests than predicted, and getting the asymmetry right is what makes the check meaningful.
- Mutation (c) restored `agent-tool.ts` to a byte-identical copy of `HEAD`, so `git diff --stat` printed nothing.
  The session read that correctly — as confirmation the mutation is the exact inverse of the green edit, not as evidence the mutation failed to apply.
  That distinction is the difference between a verified pin and a no-op.
- The ordering test earned its place under two independent mutations: deletion of the ID line kills it by absence, and hoisting the line above `${noteText}` kills it by reordering — while every `toContain` assertion in the suite stays green under the reorder.
  This is exactly the "assertion passes under both outcomes" hazard, caught concretely, and it justified upgrading Phase 22 Step 3's order-blind `fellBack` containment assertion into an index comparison.
- The assertion string was copied from its producer (`buildFallbackNote` in `spawn-config.ts`), em-dash included, rather than transcribed from the plan's prose — the practice AGENTS.md prescribes after `#772` and `#844`.

#### What caused friction (agent side)

- `rabbit-hole` — at the land, `git rev-parse HEAD` returned a correct 40-character SHA and the session asserted it had "too many characters, 41 of them", then spent tool calls disproving its own miscount.
  The same doubt recurred a few turns later on the fix commit's SHA ("I think that's 40 characters, but let me double-check").
  Impact: four extra tool calls (`cat -A`, `git log -1 --format='%H'`, and `wc -c` twice), no rework — CI verification and the close comment both used the right value.
  The durable cost is not the calls but the false claim in visible output: a confident wrong statement about a value the command produces to spec.
- `missing-context` — `cat -A` is a GNU coreutils flag; macOS `cat` rejects it (`cat: illegal option -- A`, supporting `-e`/`-t`/`-v` instead).
  It failed visibly here, and the peer session reached for it too inside a pipeline (`… | cat -A | sed … | cut …`), where the failure was masked — verified during this retro: `echo hi | cat -A 2>/dev/null | cut -c1-5` exits 0 with empty output.
  Impact: one wasted call here; in the peer it produced an empty result that a subsequent call had to re-establish.

#### What caused friction (user side)

Nothing to report.
The operator's involvement across all four stages was a single `ask_user` gate at planning — shape, edges, inline-vs-helper — answered decisively, after which no stage needed an intervention.
The design gate's third option (inline over a `helpers.ts` extraction) is what kept the roadmap's health-metric row valid as written, so that one answer did real downstream work.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5` (the design gate and the four-mutation reasoning are judgment-heavy; appropriate), the worktree sync on `anthropic/claude-sonnet-5` (lint, `fallow`, rebase — mechanical; appropriate), and the root land on `anthropic/claude-sonnet-5` (orchestration; appropriate, though the SHA detour happened here).
  Two subagents were dispatched in the peer session — `tidy-first-assessor` and `pre-completion-reviewer` — both on their own frontmatter defaults.
  No quality mismatch found.
- **Escalation-delay tracking** — the SHA doubt ran two consecutive calls, twice, which is under the five-call flag threshold.
  The notable part is the recurrence inside one session rather than the depth of either instance.
- **Unused-tool detection** — none applicable.
  Neither friction point was a knowledge gap a subagent, `colgrep`, or `web_search` would have closed; the SHA detour was self-inflicted arithmetic doubt, whose remedy is a rule rather than a tool.
- **Feedback-loop gap analysis** — no gap.
  The TDD session ran the full battery (`check`, `lint`, `test`, `fallow dead-code`) as a green baseline **before** writing any code, ran `check` + `lint` + the scoped test files immediately after the green edit, and the full battery again at the end.
  Verification was incremental, not end-loaded.

### Changes made

1. `packages/pi-subagents/docs/retro/0798-deliver-resume-handle-in-foreground-results.md` — this Final Retrospective entry.

Two `AGENTS.md` § Shell and search additions were proposed and declined by the operator: a rule against hand-verifying the width of a value a command produces to spec, and a `cat -A` portability note.
Neither was landed.

[#465]: https://github.com/gotgenes/pi-packages/issues/465
