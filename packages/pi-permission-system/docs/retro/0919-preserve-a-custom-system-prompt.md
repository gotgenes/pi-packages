---
issue: 919
issue_title: "pi-permission-system: renderToolSurface appends duplicate Available tools and Guidelines when a custom SYSTEM.md is used"
---

# Retro: #919 — pi-permission-system: renderToolSurface appends duplicate Available tools and Guidelines when a custom SYSTEM.md is used

## Stage: Planning (2026-09-16T16:40:02Z)

### Session summary

Planned a region-scoped rework of `renderToolSurface` so the pass removes a tool-surface section only where Pi or this package wrote it, and only as far as the section's own body.
Mid-session the operator surfaced [#932], a second third-party report of the same mechanism; a live reproduction against pi 0.85.1 showed the two issues are one defect, so the plan covers both and [#932] closes with it.
Plan committed at `packages/pi-permission-system/docs/plans/0919-preserve-a-custom-system-prompt.md`.

### Observations

- **The issue's suggested one-line fix could not ship.**
  `systemPromptOptions.customPrompt` is truthy in **every** `@gotgenes/pi-subagents` child, not only for a user `SYSTEM.md`: `create-subagent-session.ts:251` sets `systemPromptOverride`, which becomes `ResourceLoader.systemPrompt` (`dist/core/resource-loader.js:329`) and then `customPrompt` (`dist/core/agent-session.js:761`).
  Skipping the pass on that field would strip the tool block from every child — the case ADR 0014 built render-from-parts for.
  The existing handler test pinning the child case builds its event without `customPrompt`, so the regression would have shipped green; the plan's step 3 adds the killing-mutation test.
- **Live reproduction beat reasoning.**
  A temp `PI_CODING_AGENT_DIR` plus a dump extension capturing `ctx.getSystemPrompt()` after the `before_agent_start` chain (via a `setTimeout(…, 0)` inside a handler, since the runner threads `currentSystemPrompt` through the chain) showed a blast radius neither issue reported: a `SYSTEM.md` with literal headers lost its tool list, both guideline bullets, its own trailing instruction, **and** Pi's `<project_context>` opening tag — swept because Pi's lead-in `Project-specific instructions and guidelines:` ends with a colon.
  That is the mechanism behind [#932]'s "pi agent send the default one"; `SYSTEM.md` loading itself is not broken.
- **The triage entry was a lead, not a finding.**
  `docs/triage/2026-09-15-backlog.md` recorded that "#919's remedy is buildable exactly as proposed" — true of the field's availability in the pinned SDK, and wrong about the remedy, because it did not trace who else sets that field.
- **ADR 0014 had already named the fix.**
  Its first accepted residual says the headers are matched on trimmed text "with nothing tying them to Pi's authorship", and nominates anchoring to Pi's own position — the footer `pi-subagents` anchors on — as "the fix if one is ever needed".
  [#919] and [#932] are that residual being reported by two users.
  `docs/plans/archive/0033-fix-findsection-greedy-end.md` had half-fixed the same boundary years earlier and recorded the masking assumption in its Non-Goals.
- **Gate decisions.**
  Direction: preserve-and-append (never remove text we did not write; still render the block).
  Boundary: full repair — own-region plus body-only section end, closing the ADR residual and the `APPEND_SYSTEM.md` exposure in the same mechanism.
  Issues: one plan, both closed, both reporters credited.
  Standing aside entirely for an operator-authored prompt, and a config switch, were both offered and declined; they are recorded in the plan's Non-Goals with the condition that would reopen them.
- **First-occurrence matching needed no change.**
  `findSection` already starts at the first match, so under the default prompt Pi's own section is always the one removed; the `AGENTS.md`-heading exposure existed only in the `customPrompt` branch, which the authorship gate covers.
  The plan records this as a predicted-unchanged claim rather than a step.

#### Deferred tidyings

- `src/exposure/tool-surface-prompt.ts` — the assessor declined splitting the module into a removal half and a render half: the render half is untouched, the split would not shrink the diff, and it would add cross-file imports for one cohesive concept.
- `src/exposure/tool-surface-prompt.ts` — extracting the `CUSTOM_TOOLS_FILLER_PREFIX` filter into its own function was rated Optional only; `removeToolSurfaceSections` is rewritten in the same commit, so it buys no isolation and is folded into step 3.

## Stage: Implementation — TDD (2026-09-16T21:00:19Z)

### Session summary

Executed all five planned TDD cycles plus a WARN-fix commit: the fixture rename, the body-only section boundary, the region/authorship split with its handler wiring, the scoped blank-line collapse, and the doc updates.
`pi-permission-system` went from 4337 to 4350 tests (+13); `check`, root `lint`, and `fallow dead-code` are green.
The pre-completion reviewer returned WARN on two documentation findings, both fixed, and PASS on the delta re-review.

### Observations

- **A killing mutation caught a non-discriminating test.**
  The planned "anchors on Pi's footer" test put the decoy footer line *above* the real one with nothing beneath it, so `findIndex` and `findLastIndex` produced identical output and the mutation killed nothing.
  Rewritten to put the operator's own `Guidelines:` section *between* the decoy and Pi's footer, which is the case the anchor actually protects; the mutation then reddened it.
  This is the plan's own "count the reds against the prediction" rule paying for itself.
- **One planned mutation could not kill its test alone.**
  `keeps the project-context block Pi wrapped around its own layers` survives every single-change mutation, because destroying that tag needs *both* the greedy end boundary and the missing authorship gate — which is exactly the shipped behavior the two issues reported.
  Verified by applying both mutations together: six tests go red, reproducing the measured #932 defect.
- **Deviation: the byte-identical guarantee split across steps 3 and 4.**
  The custom-head case falls out of `settleRegion`'s `!removalAllowed` early return, so it landed in step 3; step 4's own test moved to the **tail** region — another extension's appended prose, which is where the `kept.length === lines.length` guard does its real work.
  The plan's step-4 test as written would have been vacuous.
- **A parallel `cp`-restore and `Edit` on the same file raced.**
  Issued in one tool block, the restore landed after the edit, so a mutation run reported "killed nothing" against an unmutated file.
  Sequence a mutation's restore and its next edit; a no-kill result is worth re-checking for this before believing it.
- **`pi-autoformat` fused two sentences in `docs/configuration.md`.**
  A new bullet continuation ending without a period was joined to the pre-existing sentence after it.
  The reviewer caught it (`rumdl` does not); fixed by reordering so the new sentence lands last, with both terminated.
- **Reviewer verdict:** WARN → PASS.
  Findings were the fused sentence above and a plan-promised docstring note plus test for the no-footer edge that had not landed; both fixed in `docs(pi-permission-system): record the footerless-prompt edge in the tool-surface pass`.
  The re-review re-derived the new test's discrimination independently and confirmed the docstring's cross-package claim about `pi-subagents` reading the same footer line.
- **Two `test/authority/` forwarding-liveness tests failed once at 101 s** in a full-workspace run and passed on a directory-scoped re-run — the host-load flakiness the package skill documents, not a regression.

## Stage: Sync (worktree) (2026-09-16T21:38:06Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) passed clean, no fixes needed.
The plan's `**Release:** ship independently` marker stands — this issue is not in any roadmap batch, so `/ship` should release `pi-permission-system` now rather than deferring.
No work was deferred from this stage.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-919--/2026-09-16T04-50-26-942Z_01a0a88d-49fe-7596-90f1-ffe48e5d1c60.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

No new observations beyond the Implementation stage above; this is a clean handoff to the root session's `/ship 919`.

## Stage: Final Retrospective (2026-09-16T22:34:14Z)

### Session summary

Shipped the region-scoped `renderToolSurface` fix through the worktree lane: ff-merged the peer branch, pushed, verified CI, closed [#919] and its duplicate [#932] with contributor credit, and released `pi-permission-system` 32.0.6 to npm.
The release was blocked for three consecutive `prepare` failures by a **pre-existing, unrelated** SIGPIPE race in `scripts/release/lib.sh`, diagnosed and fixed in `acc05e72` before the release could proceed.
That diagnosis, not the shipped change, consumed the bulk of the session.

### Observations

#### What went well

- **A timing delta localized a failure inside an untraced script.**
  The failing runs died 10 ms after `SHA guard passed`; the last successful run took 13.5 s to reach the very next log line.
  That single comparison proved `git-cliff` was never reached and collapsed the search space to the handful of statements in between — with no tracing available in the step and no ability to add `set -x` to a CI-only reproduction.
  This is a reusable diagnostic for any opaque CI step failure, and it is what turned `exit code 141` into a located defect.
- **A per-package measurement turned "one package is broken" into a mechanism.**
  Tabulating each package's tag-listing size showed `pi-permission-system` at 4180 bytes as the only package over one 4096-byte stdio buffer, against 45–3634 for the other eight.
  Without that table the fix would have rested on a plausible story; with it, the "only this package, only now" shape was explained rather than assumed.
- **The Docker container earned its keep by exonerating the script, not by finding the bug.**
  Running the real script end to end on `ubuntu:24.04` with the real `git-cliff` 2.14.1 binary established that the logic was sound on Linux, which is what redirected attention to the race rather than to the code.
- **The mid-ship clarification gate prevented over-fixing.**
  Changing release tooling during a ship is preference-sensitive, and the gate surfaced it.
  The operator declined both an issue and the defensive hardening of two adjacent pipes, trimming the change to the one proven defect.
- **The peer session's dangling-SHA check fired for real.**
  `/sync-worktree` found `d906f9a1` cited in the TDD stage note and invalidated by the rebase, then rebuilt both retro commits via `git reset --soft` to remove it — the `AGENTS.md` rule about SHAs written before a rebase (Refs #814) catching its own case.

#### What caused friction (agent side)

- `rabbit-hole` — built a local-clone reproduction of the release script before comparing the failing run against the last successful run's log.
  The scratch clone introduced a `mise` trust failure that surfaced as `git-cliff` exiting 1, which read as a finding rather than an artifact of the throwaway environment.
  Impact: about 7 consecutive tool calls on the repro path plus one false lead; no rework to shipped code.
- `rabbit-hole` — cycled through several hypotheses (shallow clone, `git-cliff` version drift, `PATH` for `/home/runner/.cargo/bin`, a git pager, the checkout token) before reading the passing run's log.
  Each was cheap individually, but the decisive comparison was available from the moment the first failing log was fetched.
  Impact: roughly 20 tool calls before the timing comparison; no rework.
- `other` — nearly discarded the correct signal after finding it.
  Having measured the 8.5 ms gap, the reasoning wavered ("maybe the log line was buffered and flushed at exit") and briefly set the timing aside before returning to it.
  Impact: no rework, but the wavering is what let the hypothesis cycle above continue longer than it needed to.
- `other` — the shipped fix carries no automated test.
  `scripts/release/` has no test harness, so `latest_tag` was verified by 10 functional trials, `verify-cliff-parity.sh`, `shellcheck`, and a byte-for-byte equivalence check across all 9 packages — thorough, but nothing in CI would catch a reintroduction.
  Impact: none this session; a standing gap noted rather than a friction cost.

#### What caused friction (user side)

- Nothing blocking.
  One opportunity: the failure was diagnosed to completion before the operator was consulted at all.
  Surfacing it after the **second** identical `prepare` failure — "this looks pre-existing and unrelated to #919; dig now, or defer the release?" — would have offered the choice while the cost was still small.
  The gate that did fire came only once the answer was already known, so it settled scope rather than direction.

### Diagnostic details

- **Model-performance correlation** — the peer implementation session ran 176 turns on `claude-opus-5` (planning and TDD) and its final 26 on `claude-sonnet-5` (the `/sync-worktree` stage, from entry 391).
  That split is well matched: judgment-heavy planning and TDD on the stronger model, the mechanical sync stage on the cheaper one — and `sonnet-5` still handled the non-mechanical part of that stage correctly, detecting the rebase-invalidated SHA and rebuilding two commits with `git reset --soft`.
  Three subagents were dispatched, all from their own frontmatter models with no override: one `tidy-first-assessor` and two `pre-completion-reviewer` runs (the WARN and the delta re-review).
  This ship session ran entirely on `claude-opus-5`; given that it turned into an undiagnosed-CI-failure investigation rather than the mechanical land it was planned as, that was the right model to be on.
- **Escalation-delay tracking** — the local-repro path ran about 7 consecutive tool calls on the same failing approach, past the 5-call flag threshold.
  No subagent was dispatched, and none was the right answer here: the evidence lived in CI logs rather than in the codebase, so neither `Explore` nor `colgrep` would have reached it.
  The correct escalation was cheaper than a subagent — one `ci_list` plus one `gh run view --log` on the last **successful** run, which is where the 13.5 s baseline came from and which was eventually the decisive call.
- **Unused-tool detection** — `ci_list` was available from the start and used late.
  Its output (the last green run's id) is the precondition for the timing comparison, so calling it second rather than twentieth would have short-circuited the whole hypothesis cycle.
- **Feedback-loop gap analysis** — no gap.
  `/ship`'s step-5 gates (`pnpm run lint`, `pnpm fallow dead-code`) ran on the merged tree before the push as specified.
  After the `lib.sh` edit, verification ran incrementally and before the commit: `shellcheck`, `bash -n`, a 10-trial functional check of `next-version.sh`, `verify-cliff-parity.sh` across all 9 packages, then root `lint` and `fallow dead-code`.
  CI was re-verified on the new HEAD before the release was re-dispatched.

### Changes made

1. `scripts/release/lib.sh` — replaced `latest_tag`'s `git tag --list | head -1` with `git for-each-ref --count=1`, removing the pipe and with it the SIGPIPE race (landed during the ship as `acc05e72`, ahead of this retro).
2. `AGENTS.md` — added the early-exiting-reader SIGPIPE trap to § Shell and search, beside the existing `rg -r`, glob-quoting, and `sed` line-mode traps.
3. `.pi/prompts/ship.md` — step 11.2 now caps a `prepare` re-dispatch at once, names a second identical failure a defect rather than flake, and records the failing-versus-passing log-timestamp comparison as the first diagnostic for an opaque exit code.

### Follow-ups not implemented

- **No test harness covers `scripts/release/`.**
  The SIGPIPE fix was verified by 10 functional trials, `verify-cliff-parity.sh`, `shellcheck`, and a byte-for-byte equivalence check across all 9 packages, but nothing in CI would catch a reintroduced pipe.
  `lib.sh` carries a "keep this pipe-free" comment as the only guard.
  A harness is past this retro's scope — file an issue and run `/plan-issue` if it is worth building.

[#932]: https://github.com/gotgenes/pi-packages/issues/932
