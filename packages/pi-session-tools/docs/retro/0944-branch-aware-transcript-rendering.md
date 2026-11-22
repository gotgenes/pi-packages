---
issue: 944
issue_title: "pi-session-tools: transcript rendering ignores parentId, presenting abandoned branches as history"
---

# Retro: #944 — pi-session-tools: transcript rendering ignores parentId, presenting abandoned branches as history

## Stage: Planning (2026-09-19T20:48:55Z)

### Session summary

Planned branch-aware transcript rendering as a new `src/session-tree.ts` module prepended to the `selectEntries` pipeline, with the live path as the default for all three read tools and a `branches: "live" | "all"` parameter as the escape hatch.
The operator settled both questions at an `ask_user` gate after bouncing the first attempt with a question about how the live path is identified.
The plan is `packages/pi-session-tools/docs/plans/0944-branch-aware-transcript-rendering.md`: seven steps, breaking (`fix(pi-session-tools)!:`, 2.2.0 → a major), shipped independently since this package has no improvement roadmap.

### Observations

- The first gate was premature and the operator answered it with a question — "how do you identify the live path?"
  The substance message had led with corpus numbers and the defect's cost, and never stated the algorithm.
  Answering it took one message (leaf resolution in two halves, the `parentId` walk, where it can be wrong) and the re-asked gate was answered immediately.
  The `clarification-gates` rule about defining terms of art before substance covers this; the miss was treating "live path" as self-evident because I had just read `buildSessionPath`.
- The mechanism was verified in Pi's own source rather than inferred: `SessionManager._buildIndex()` assigns `this.leafId = entry.id` for every entry in order, so the last line of a file is the leaf Pi resumes into.
  That turns "walk back from the last entry" from a heuristic of ours into a reproduction of Pi's rule, which also satisfies the README non-goal about not owning Pi's storage format.
  `getLeafId()` and `getBranch()` were confirmed in the pinned `0.79.1` declaration bundle **and** in the published `0.75.0` tarball, which is the package's `peerDependencies` floor — the floor check is what the design's `read_session` call site rests on.
- Measured, not estimated: 998 session files under `~/.pi/agent/sessions/`, 71 (7.1%) with at least one fork; off-path share min 0.3% / median 11.6% / p90 39.9% / max 95.7%; max 6 fork points in one file; 29 of 71 carry a `branch_summary`, so 42 have no marker of any kind; 6 of 71 have non-contiguous off-path runs.
  The issue's own figure was 6 of the 120 most recent sessions for one cwd; the wider sweep raised it and produced the two facts the design turns on — the 42 marker-less files (why the omission marker is load-bearing) and the non-contiguity (why markers are placed per run rather than per fork point).
- A disposable spike ran the real `selectEntries`/`formatTranscript`/`summarizeEntries` over two real forked session files to price the change: 609 entries / 312,237 chars / 287 messages today versus 278 / 180,312 / 139 on the live path.
  That 148-turn gap in a single file is what the gate's substance led with, in the reader's terms rather than the mechanism's.
- The Tidy-First assessor's two recommendations were both accepted (name the params bag; add `getLeafId` to `read-session.test.ts`'s `makeCtx` before the wiring step), and it correctly found the stub gap the design summary had not mentioned.
  Its universal claim that existing fixtures are "strictly linear `1→2→3→4`, never branching" was **wrong**, and re-deriving it found `test/format-transcript.test.ts` L137, whose entries are `[id 1, id 3 (parent 2), id 2 (parent 1)]` — file order and tree order deliberately disagree.
  Its conclusion survived (that test calls `formatTranscript` directly and bypasses `selectEntries`), but only because branch resolution lives in `entry-selection.ts`.
  That fixture is now recorded in the plan as a predicted-unchanged file and as the concrete reason the new stage cannot live in the formatter.
  The assessor also cited SDK version `0.84.4`, where the package pins `0.79.1` — it read a different `node_modules`; the plan cites the versions I checked.
- The scope collision was raised **at** the gate rather than argued around afterward: the README's "a new capability arrives as a new tool rather than as another parameter" line is what killed an opt-in flag in #943.
  The counter-precedent that settled it is in the 2026-09-18 triage verbatim — "an `offset` bound is not a new capability, so the new-tool rule does not reach #940" — so a branch selector is the same class.
- One behavior change rides along and is called out separately rather than folded into the headline: #546's phantom `model_change` pruning now runs on the branch-resolved array, so a live marker whose only following assistant turn was on an abandoned branch becomes phantom.
  Measured on both spike files the live `modelChanges` count did not move (4→4, 1→1), so the fixture that exercises the flip has to be constructed deliberately.
- A `read_session_branch({ leafId })` tool was offered at the gate and declined in favour of the parameter.
  Declined, not deferred — no follow-up issue filed, matching how #943 handled its transcript footer.

#### Deferred tidyings

- `packages/pi-session-tools/src/index.ts` — the `Type.Object` parameter blocks of `read_parent_session` (L323) and `read_session_file` (L431) are word-for-word identical for `types`/`offset`/`limit`/`elide_user_text`, while `read_session`'s (L249) carries intentionally richer prose; the assessor rated a two-way extraction Optional and a three-way one the wrong-abstraction trap, and I took neither, so adding `branches` touches three sites.
- `packages/pi-session-tools/test/` — `makeCtx` remains duplicated across four suites with differing signatures (carried over from #943's deferral); this change adds `getLeafId` to one copy only, since only `read_session` calls it.

## Stage: Implementation — TDD (2026-09-19T22:52:08Z)

### Session summary

Executed all seven planned steps as separate commits, plus one follow-up `test:` commit closing the pre-completion reviewer's two coverage warnings.
The package went from 12 test files / 183 tests at baseline to 13 / 228.
All four gates (`check`, root `lint`, `test`, `fallow dead-code`) were green at baseline and at HEAD, and the reviewer returned PASS on re-dispatch.

### Observations

- Every killing mutation the plan named behaved as predicted except one, and the exception was a finding rather than a pass.
  The plan claimed *treat an entry with no string `id` as abandoned* would redden "the mixed-array and no-ids tests"; it reddened only the mixed-array test, because the no-ids cases are guarded by a different half of the rule (an unresolvable leaf returns the input unchanged) and short-circuit before `isAbandoned` runs.
  A second mutation — returning `new Set(byId.keys())` from that guard, which is exactly the fail-open direction the plan's risk table names — reddened the two no-ids tests, so the class is pinned; the plan just attributed it to the wrong mutation.
- One planned probe was vacuous and had to be rewritten before it could discriminate.
  The test for "branch resolution runs before `filterByTypes`" used a fixture whose live path did not actually pass *through* a filtered-out entry, so reordering the two stages produced identical output.
  Replacing it with a fixture whose live path runs `1 → 3 → 4` across a `model_change` made the reorder mutation kill it.
  This is the `testing` skill's "name both outcomes and confirm your assertion's value differs between them" rule, caught by counting reds against the plan's prediction rather than by reading the test.
- Two tests in the new `read_session` branch suite passed during Red, for a reason worth recording: `buildTranscriptResult` already called `selectEntries(allEntries, params)`, so the raw `branches` tool parameter flowed straight into `EntrySelection.branches` by name before any wiring was written.
  The plan had predicted exactly this coupling and made removing it part of step 6 ("build the selection object explicitly"), but the consequence for the Red step was not anticipated.
  Both were mutated explicitly afterward and both discriminate.
- The Tidy-First step that added `getLeafId` to `read-session.test.ts`'s `makeCtx` was load-bearing exactly as the assessor predicted: the stub is behind an `as unknown as ExtensionContext` cast, so nothing would have caught its absence until the suite ran.
- `Omit<BranchMarkerEntry, "type">` does not distribute over a discriminated union, so a single `marker(fields)` factory failed `tsc` on `count`; three small typed factories replaced it.
  Relatedly, every test that builds a marker has to go through a factory returning `BranchMarkerEntry` — a fresh object literal passed to `formatTranscript` trips TypeScript's excess-property check against `TranscriptEntry`, which is `{ type: string }`.
- Deviation from the plan's Module-Level Changes: the README's canonical end-to-end sample transcript did **not** gain a marker line as the table claimed.
  That sample is a linear, unforked session, so a marker there would show output it cannot produce; the marker examples went into the new `#### Rewound sessions` subsection instead.
  The reviewer confirmed this reading in the delta round.
- Every other predicted-unchanged claim held, including the interesting one: `test/format-transcript.test.ts`'s `handles parallel tool calls with out-of-order results` fixture (file order `1, 3, 2`, tree order `1 → 2 → 3`) is untouched and green, because that suite calls `formatTranscript` directly and never reaches `resolveBranches`.
  That fixture is the concrete reason branch resolution had to live in `entry-selection.ts`.
- Pre-completion reviewer: WARN on the first round, PASS on the second.
  The two WARNs it raised were real gaps on this issue's own mechanism and were closed rather than accepted: `test/session-tree.test.ts` gained a multi-root array, a `leafId` naming an island node, and an ancestor stranded above a broken parent link; `test/read-session.test.ts` gained the tool-level case combining a `types` filter with a forked session, which is how `/retro`'s model-attribution lens actually calls it.
  All five were authored after Green, so they were mutated explicitly, and the reviewer re-derived both mutations itself rather than accepting the report.

## Stage: Sync (worktree) (2026-09-19T22:55:13Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both passed on the first run with no fixes needed.
The plan's Release Recommendation is **ship independently** — `pi-session-tools` has no architecture roadmap, so no batch holds this issue.
Nothing was deferred to the root session beyond the standard land steps; the change is breaking (`fix(pi-session-tools)!:`) and the `BREAKING CHANGE:` footer's remediation (`branches: "all"`) is already verified present as a real declared parameter on all three tools.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-944--/2026-09-19T20-24-59-290Z_01a0bb57-f69a-70fc-bcdf-74a53a15300b.jsonl` — read with `read_session_file({ path: "<path above>" })` for message-level verification at land/retro time.

### Observations

No friction in this stage.
The TDD stage's implementing session and the pre-completion reviewer both already re-derived the breaking-change classification, the corpus measurements, and the follow-up-tool decline (no issue filed, matching #943's precedent), so this sync found nothing new to surface.

## Stage: Final Retrospective (2026-09-19T23:09:06Z)

### Session summary

Shipped #944 through the worktree lane with no rework: one fast-forward merge, green pre-push gates, one CI run, one release dispatch, `pi-session-tools` 2.2.0 → 3.0.0.
The retrospective spans four stages across two sessions — planning and TDD in the peer worktree, sync in the peer, ship and retro at the root.
The dominant finding is not in this session but upstream of it: the `tidy-first-assessor` returned two precise, confidently-stated facts that were both wrong, and only the planning agent's habit of re-deriving them kept either out of the plan.

### Observations

#### What went well

- The worktree convergence ran exactly as the `worktrees` skill describes, with no lane-specific surprise.
  The ff-merge was predicted before it ran, `PRE_MERGE` turned out to equal `"$PLAN"^` so both range anchors agreed, and the co-shipped-issue scan found only #944's own files.
  Thirty-seven tool calls, zero corrections, zero retries.
- The #945 SHA-shape guardrail fired in reasoning and held.
  At step 7 the ship session registered a doubt about the pushed SHA's shape and declined to measure or re-run it, passing the `git rev-parse` output through to `ci_find` unexamined — which matched.
  This is the first observed instance of that rule being tested since it landed.
- The pre-completion reviewer re-derived its own claims instead of reporting them.
  On the delta round it reverted both described mutations itself against a backup and confirmed the discrimination counts (4 of 22 in `test/session-tree.test.ts`, 3 of 50 for the `filterByTypes` exemption), rather than accepting the implementing session's report.
  That is the `delegation` skill's posture executed by the subagent on its own input.
- The operator's single intervention across all four stages was a redirecting question at the planning gate — "how do you identify the live path?" — not a correction after the fact.
  It cost one message to answer and the re-asked gate was answered immediately.

#### What caused friction (agent side)

- `missing-context` — the `tidy-first-assessor` verified the design's SDK claims against the wrong package's `node_modules`.
  Its report cites `@earendil-works/pi-coding-agent@0.84.4`; `packages/pi-session-tools/package.json` pins `0.79.1` and declares a `>=0.75.0` peer floor.
  Re-derived during this retro: seven of the nine packages resolve `0.79.1`, and only `pi-subagents` and `pi-permission-model-judge` carry `0.84.4` — so a workspace-wide read lands on a sibling's copy roughly a fifth of the time, while staying fully inside the repo.
  Impact: no rework, because the planning agent re-resolved the versions and the plan cites `0.79.1` and the `0.75.0` floor it checked.
  The governing rule already exists — the `code-design` skill's "resolve the version from the package's own `devDependencies` pin" — but it lives in a skill a fresh-context subagent never loads, and `.pi/agents/tidy-first-assessor.md` says nothing about it.
- `missing-context` — the same report's universal claim about existing fixtures was false, and carried a precise count that made it read as measured.
  It stated that `format-transcript.test.ts`'s 41 `parentId` occurrences form "strictly linear `1→2→3→4` chains, never branching"; L137's fixture is `[id 1, id 3 (parent 2), id 2 (parent 1)]`, where file order and tree order deliberately disagree.
  The planning agent caught it by re-deriving, per the `AGENTS.md` principle that a subagent's universal claim is the one to verify, and the assessor's conclusion survived anyway.
  Impact: none beyond the re-derivation, but two false verified-sounding facts from one dispatch is a pattern, not a slip — and the plan is better for it, since the fixture is now recorded as the concrete reason branch resolution had to live in `entry-selection.ts`.
- `other` — this retrospective's own transcript tools are the pre-#944 build.
  The ff-merge replaced `packages/pi-session-tools/src/` under a root session that had loaded the extension at startup, so every `read_session`/`read_session_file` call in this retro rendered in file order, not live path.
  No impact here — every session read was linear, so no `[abandoned branch]` marker was due — but the lens sentence `4d4f24d4` added to `.pi/prompts/retro.md` describes behavior the very session that ships it cannot exercise.
  `AGENTS.md`'s staleness passage is written for a session that *edits* `packages/<pkg>/src/`; a ship session merges, which has the same effect and is not named.
- `other` — the peer session's `git commit -F -` from a heredoc was denied mid-TDD by the `pi-permission-system` deny rule.
  Impact: one extra tool call — it wrote `/tmp/msg944.txt` and re-ran with `-F <file>`, with no retry loop and no question to the operator.
  Recording it as evidence the deny rule's reason string is actionable rather than merely obstructive.

#### What caused friction (user side)

Nothing to flag.
The one intervention was the redirecting question noted above, which is the intended shape.

### Diagnostic details

- **Model-performance correlation** — attributed from the inline `[provider/model]` labels in type-unfiltered `read_session`/`read_session_file` calls, and for the subagents from their own task transcripts via `list_subagent_sessions`, not from the agent definitions.
  Planning and TDD turns ran `anthropic/claude-opus-5`; Sync and Ship ran `anthropic/claude-sonnet-5`; this retrospective runs `anthropic/claude-opus-5`.
  All three subagent dispatches — `tidy-first-assessor` once, `pre-completion-reviewer` twice — ran `anthropic/claude-sonnet-5`.
  The apparent mismatch is not a model one: the assessor produced two wrong quantified facts on the same model where the reviewer was clean across two rounds, and the difference between them is that the reviewer re-derives its own claims by protocol and the assessor does not.
- **Escalation-delay tracking** — no sequence exceeded five consecutive tool calls on one error.
  The longest was the TDD investigation of two tests that passed during Red: four calls, resolved by writing a disposable `/tmp/dbg.test.ts` probe, reading its output, and deleting it.
- **Feedback-loop gap analysis** — no gap.
  `check`, `vitest`, and `lint` ran after every TDD step rather than once at the end, and the ship session ran `lint` and `fallow dead-code` after the ff-merge, on the exact tree it then pushed.
- **Unused-tool detection** — nothing notable; no friction point traced to a subagent or tool that was available and never dispatched.

### Changes made

1. `.pi/agents/tidy-first-assessor.md` — added a dependency-verification rule to the read-only bash paragraph: resolve a version from the target package's own `package.json` pin and read that package's own `node_modules/`.
   The equivalent rule already lives in the `code-design` skill, which a fresh-context subagent never loads; the agent definition is the only text it reads.
2. `AGENTS.md` § Stale in-process extension code — the opening sentence now names a fast-forward merge alongside an edit, since a `/ship` session never edits `packages/<pkg>/src/` and the staleness it produces is identical.
