---
issue: 1056
issue_title: "pi-permission-system: an unquoted computed word in a wrapper's options can split into the command the core-reader exemption never judged"
---

# Retro: #1056 — pi-permission-system: an unquoted computed word in a wrapper's options can split into the command the core-reader exemption never judged

## Stage: Planning (2026-10-13T15:47:55Z)

### Session summary

Reproduced the issue's seven rows through the real parse and gate, plus glob, brace, escape, quoted, nested, and `NAME=value` variants, then prototyped the guard and measured it against 11,206 distinct review-log bash commands (532 indirection units; 1 changes).
The operator chose to refuse every computed layer word, to place one guard among `floorExemptionOf`'s shared preconditions (retiring `isAdmittedModifierLayer`'s own checks and its assignment exemption), and `fix:` over `fix!:`.
The plan is four steps: Tidy-First pins, the `fix:` guard, the `refactor:` removal, and the docs.

### Observations

- The outermost `command_name` word reads `computed: true` (`isSpelledExactly` has no `command_name` case), so a guard scanning from index 0 floors every wrapper; the guard skips index 0, as `isAdmittedModifierLayer` already does.
  Nothing else reads the bit (the path speller skips `command_name`), so no follow-up was filed.
- The documented claim that "an environment assignment does not split" (ADR 0013's 2026-10-05 amendment, `docs/configuration.md`, `architecture.md`, from commit `1ed420e0`) is false in a wrapper's argument position: bash 5.3 prints `[nice][FOO=1][rm][y][cat][x]`.
  It described the code's skip, not a verified shell fact; Step 4 corrects all three.
- Double-quoted admission was rejected on the package's own split model (ADR 0013's 2026-09-29 amendment: a nameref to an array splits `"$U"`, and `"$@"` can vanish), verified in bash: `sudo -u "$@" cat rm` runs `rm` as user `cat`.
- The only corpus shape that flips is `env -i HOME="$HOME" PATH="$PATH" TERM=dumb true`, from `"$PATH"`.
- The prototype ran the full suite green at both the guard step and the removal step (6079 tests); after the removal, deleting the guard turns 12 existing modifier tests red, so the guard is pinned at its one site.
- The Tidy-First assessor recommended one preparatory `test:` commit pinning literal layers and session patterns; `nice -n $N mytool a` survives deleting `sessionCommandIndex`'s computed refusal on `main` and goes red only after Step 3 (measured).
- A side probe found `find . -delete -exec cat {} +` earns `core-reader`; not filed, since only a unit whose own visible text already resolved `allow` reaches the exemption, so the write is not hidden by the wrapper.

#### Deferred tidyings

- `src/access-intent/bash/node-text.ts`: `WordReader.argWord` reads a `command_name` node as computed; harmless today, but a future reader of `words[0].computed` would be misled.

## Stage: Implementation — TDD (2026-10-13T16:41:47Z)

### Session summary

All four TDD steps landed as planned: the Tidy-First pins (`test:`), the shared `carriesComputedWord` precondition in `floorExemptionOf` (`fix:`), the removal of `isAdmittedModifierLayer`'s redundant `computed` checks (`refactor:`), and the ADR 0013 / `configuration.md` / `architecture.md` updates (`docs:`), plus one reviewer-driven docs fix.
The `pi-permission-system` suite went from 6077 to 6122 tests (+45).
Every killing mutation the plan named produced the predicted reds, including the two measured at planning time (12 existing modifier tests once the guard is the only pin; `nice -n $N mytool a` red only after Step 3).

### Observations

- One deviation: `sudo -u "$(whoami)" cat x` enumerates a second unit (`whoami`), so it moved out of the `it.each` table into its own test asserting `[undefined, undefined]`.
- The baseline full suite flaked twice on timing tests (`composition-root.test.ts`, `approval-escalator.test.ts`) at a load average near 33; both passed in isolation, and the suite ran green once load dropped.
- Two tooling traps hit during mutation checks: a restoring `cp` batched beside the mutating `Edit` ran concurrently and overwrote the mutation (a false "survived"), and a `Read` right after an `Edit` once saw the file mid-rewrite by `pi-autoformat` (1 line, then 1166).
  Running every restore in its own call and diffing against the saved green copy before reading results caught both.
- Pre-completion reviewer: WARN, then PASS on the delta.
  The WARN was the #1056 roadmap step's `Target:` line still saying a double-quoted word "cannot split"; fixed in `docs(pi-permission-system): the #1056 roadmap target no longer says a quoted word cannot split`.
  The reviewer's independent 6,640-command sweep found no computed-layer wrapper earning an exemption at HEAD (7,848 failures on base) and byte-identical session patterns.
  It re-noted that `find . -exec cat {} + -delete` earns `core-reader` on base and HEAD alike (words after the exec terminator are not layer words); planning had already judged this not a floor bypass.

## Stage: Sync (worktree) (2026-10-14T14:46:09Z)

### Session summary

`pnpm run lint` and `pnpm fallow dead-code` pass from the worktree root; the TDD stage's reviewer WARN was already settled (PASS on the delta), so nothing was open.
The plan's marker is `**Release:** ship independently`; the `fix(pi-permission-system): a computed word in a wrapper's options keeps the indirection floor` commit is what the release will carry, and no follow-up issues were filed.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1056--/2026-10-13T04-25-36-556Z_01a13382-402c-7372-8308-ba2caa8d68bb.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- The one deferred tidying (`WordReader.argWord` reading a `command_name` node as computed) is recorded under the Planning stage's `#### Deferred tidyings`.
- The baseline full suite flaked on two timing tests under heavy machine load; if the root's pre-push run hits one, re-run the file alone before suspecting this change.

## Stage: Final Retrospective (2026-10-14T15:56:35Z)

### Session summary

The peer worktree planned (Opus), implemented (Opus), and synced (Sonnet) the computed-word guard in `floorExemptionOf`; the root fast-forward-merged it, CI passed, #1056 closed, and `pi-permission-system-v40.2.1` released.
The design held from planning to ship: every mutation the plan named killed what it predicted, and the corpus measurement (1 changed unit in 532) matched the reviewer's independent sweep.

### Observations

#### What went well

- Planning measured against organic data before asking: a disposable spike through the real parse and gate, a prototype run over 11,206 review-log commands, and bash 5.3 probes of the split model.
  The one `ask_user` gate settled three decisions (quoted words, one rule vs two, `fix:` vs `fix!:`) with no bounce.
- The planning probe caught a false documented claim ("an environment assignment does not split") that three docs had carried since `1ed420e0`, and the plan corrected it rather than preserving it.
- The pre-completion reviewer ran its own 6,640-command sweep instead of trusting the stage notes' coverage claim, and caught one stale roadmap `Target:` phrase.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — TDD mutation checks batched a call with an `Edit` on the same file three times, and each produced a misleading result.
  Turn 19 batched `git checkout`, the mutating `Edit`, and the `git diff --stat; vitest run` in one block, and the diff read the file as wholly deleted.
  Turn 35 batched the restoring `cp /tmp/green.ts` with the next mutation's `Edit`, so the copy overwrote the mutation (a false "survived").
  Turn 53 batched an `Edit` with a `Read` of the same file, which saw 1 line.
  The TDD breadcrumb attributed the first and third to `pi-autoformat` rewriting the file; the common cause is that calls in one batch run concurrently with the `Edit` and its format pass.
  `.pi/prompts/tdd-plan.md` already says the restoring `cp` "gets its own call too", and the same class recurred in [#609], [#951], and [#979], each answered with one more clause naming one more pairing.
  Impact: about six extra tool calls to detect and redo; no wrong result landed, because the peer diffed against the green copy before reading each run.
- `missing-context` (self-identified, at retro) — the ship's fold-in scan grepped `docs/roadmap*` and `docs/*.md`, which miss the package roadmap in `docs/architecture/architecture.md`, so the check for a step heading naming a second issue never ran.
  `.pi/prompts/ship.md` names the heading shape but not the file.
  Impact: none here (the #1056 heading names no second issue, confirmed at retro), but a real fold-in would have stayed open.
- `other` — the planning and TDD stages read file regions with `sed -n` and `awk` in `bash` about a dozen times where `Read` with an offset was the instructed tool.
  Impact: added friction but no rework.

#### What caused friction (user side)

- Nothing notable; the operator's involvement was the one strategic design gate and the stage handoffs.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `claude-opus-5-5`, sync on `claude-sonnet-5-5` (mechanical; appropriate), and all three subagents (the `tidy-first-assessor`, 10 turns; the `pre-completion-reviewer`, 32 then 7 turns) on `claude-sonnet-5-5`, attributed from their own transcripts.
  The reviewer's judgment work was sound (a real finding plus an independent sweep), so no mismatch.
- **Feedback-loop gap analysis** — verification was incremental: per-file Red/Green runs, a full package suite and `check` before each source commit, root gates before the reviewer, and the pre-push gates again on the merged tree.

### Changes made

1. `.pi/prompts/tdd-plan.md`: one general rule ahead of the step loop (never batch an `Edit`/`Write` with a call that reads, runs, copies, or diffs the same file) replaces the Red-step and save-copy concurrency clauses, and the restoring `cp` now rides the mutation's run command instead of getting its own call.
2. `.pi/prompts/ship.md`: the fold-in rule names the package's `docs/architecture/architecture.md` as where the roadmap step heading lives.

[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#951]: https://github.com/gotgenes/pi-packages/issues/951
[#979]: https://github.com/gotgenes/pi-packages/issues/979
