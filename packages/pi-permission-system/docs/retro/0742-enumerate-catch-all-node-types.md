---
issue: 742
issue_title: "pi-permission-system: commands inside control-flow bodies, declarations, and test commands are not enumerated against the bash rules"
---

# Retro: #742 — Enumerate commands in every catch-all node type

## Stage: Planning (2026-08-29T21:37:10Z)

### Session summary

Planned [#742] (Phase 14 Step 4) as a peer-worktree session on branch `issue-742-pi-permission-system-commands-inside-con`.
The plan closes the last member of the [#306] / [#741] nested-command bypass family on the command surface, plus the one path-surface position that misses the same shape, and lands in `packages/pi-permission-system/docs/plans/0742-enumerate-catch-all-node-types.md` as six TDD steps.
Two residuals were filed and dispositioned against Phase 14 during the session: [#839] (deferred to Phase 15) and [#840] (adopted as Step 14).

### Observations

- **The design was prototyped end to end before the plan was written, not after.**
  Patching `command-enumeration.ts`, `nested-execution.ts`, and `token-collection.ts` and running the real suite turned every claim in the plan into a measurement: 3699 tests pass unmodified, 189 of 4276 intact review-log commands gain units (+829), and `pathRuleCandidates()` / `externalAccesses()` change on **zero**.
  The patch was reverted before writing.
  Three separate design errors surfaced this way and would not have surfaced from reading.
- **The first two prototypes were wrong in ways only real traffic showed.**
  A blanket "descend everything" emitted `for` word-list entries, `case` subjects, and function names as bash command units (`pkg`, `pi-colgrep`, `norm`, `/tmp/ca-health.json`) — never weaker, but a prompt naming `pi-colgrep` as the offending *command* is wrong on its face.
  The fix is a statement-typed descent filter, which is now the design's load-bearing idea and appears nowhere in the issue body.
- **A dataset artifact nearly became a design constraint.**
  The review log's `reviewLogFieldMaxWidth` cap (1000) stores a long heredoc without its terminator, so it re-parses as garbage.
  That inflated the `ERROR` population from **1** to **111** and drove an entire `ask_user` option set priced at "108 commands would newly prompt".
  The operator's question — "is the bash command *actually* malformed?"
  — is what exposed it.
  The rule this instance teaches: a measurement taken through a lossy instrument measures the instrument.
  Check the field cap before treating a review-log string as the command that ran.
- **`ERROR` is not always malformed input, and that changed the argument rather than the conclusion.**
  Probing found `git commit -F - <<'MSG' 2>&1 | tail -4` is valid bash that `tree-sitter-bash` 0.25.1 cannot parse, though `<<'MSG' | tail` and `<<'MSG' 2>&1` each parse alone.
  No upgrade lever exists (0.25.1 is npm's latest).
  It strengthened the "never descend an `ERROR`" decision — when the parse fails on *valid* bash, the recovered structure is certainly not the real structure — and it became the strongest paragraph of [#840]'s body.
- **The elaboration round was worth three rounds of the gate.**
  All three `ask_user` questions came back as elaboration requests, and each one corrected something: the `ERROR` numbers were wrong, the before/after tables were raw JSON the operator could not read (they looked like a LIFO stack), and the `context` question had not said whether it affects the **assessment** or only the **presentation**.
  A one-line grep settled the third — `BashCommand.context` is read at exactly one site and never reaches rule matching — and that fact should have been in the first gate.
- **The residual split followed the blast radius, not the subject matter.**
  [#742] and its path-surface half change zero path candidates; the `for`/`case` operand gap ([#839]) newly asks on `external_directory` for 17 measured commands.
  Keeping them apart is what lets [#742] be described as backwards-compatible hardening, which is also what settles `fix:` over `fix!:` — the same reasoning [#741] used against [#645]'s precedent.
- **ADR 0009's wording overclaims in the [#839] direction.**
  Its "what the projection guarantees" list says a shape-classified absolute token reaches the surfaces, which reads as covering `for f in /etc/shadow`.
  This is the mirror of [#741]'s lesson, where the ADR's residual list read as *sanctioning* a gap; the plan adds a one-sentence known-gap note so a future reader does not conclude it is handled.
- **The Tidy-First assessor returned no required tidyings and one useful confirmation.**
  It verified the design summary against the real files (the six-branch if-chain, the two different prefix-skip state machines, `program.test.ts`'s existing `it.each` convention) and reported only two cosmetic optionals, both folded into the steps they touch rather than taken as commits.

#### Deferred tidyings

- `src/access-intent/bash/command-enumeration.ts` — extracting `collectCommandsInto`'s if-chain into a dispatch table; rejected as scope creep, since encoding "emit?
  / descend-how?
  / scope-transform?"
  per node type is a redesign of working code rather than a preparation, and readability holds at ~70 lines with this comment density.
- `src/access-intent/bash/command-enumeration.ts` — merging `descendCommandChildren` and `descendStatementChildren` into one parameterized loop; rejected as the wrong-abstraction trap, since the discriminator would sit over a real behavioral difference (unconditional recurse vs. recurse-or-fallback).

## Stage: Implementation — TDD (2026-08-29T22:24:59Z)

### Session summary

Executed all six TDD steps on branch `issue-742-pi-permission-system-commands-inside-con`, each as its own commit leaving the tree green, plus two follow-on `docs:` commits from pre-completion review.
The enumerator gained a third node-type question (`STATEMENT_TYPES` plus a filtered `descendStatementChildren`), an explicit non-descending `ERROR` branch, and a hosted-execution descent on the catch-all; the path surface gained `COMMAND_PREFIX_TYPES`, closing the command-name and env-var-prefix positions.
The pi-permission-system suite went 3699 → 3752 passing (+53 tests, 2 expected fail unchanged).

### Observations

- **The plan's design survived contact intact; every one of its named killing mutations killed.**
  Ten mutations were applied and reverted across steps 1–5, including one per node type in `COMPOUND_STATEMENT_TYPES` and `STATEMENT_GROUP_TYPES`.
  Each removed type failed exactly and only its own row, which is what the plan wanted from writing every row as a real parse rather than as an assertion about a set's contents.
  The one test that passed during its Red step — "leaves a function's own name unemitted" — was resolved by mutation rather than assumed: dropping the `STATEMENT_TYPES` filter kills it, so it is a genuine pin and not a broken probe.
- **A `git checkout HEAD -- src` inside a measurement loop silently reverted an uncommitted Green step, twice.**
  The before/after measurement swapped `src/` between the landing state and `6ffdf1af`, and restoring with `git checkout HEAD` restores *HEAD*, which at that moment was the previous step's commit — not the working tree.
  The suite caught it both times, but the second occurrence also fought a denied `rm -rf` in the restore command, leaving the tree in a three-file mixed state.
  The rule this teaches: back up with `cp` to a temp path before a measurement that swaps source, and never use `git checkout <ref> -- <path>` as the restore half when the thing being protected is uncommitted.
- **`c_style_for_statement` emits its arithmetic initializer as a unit, and that is correct rather than a leak.**
  `for ((i=0; i<3; i++))` yields a `variable_assignment` child, which `STATEMENT_TYPES` names, so `i=0` becomes a unit.
  It reads like the operand-word leak the filter exists to prevent, but it is not: the initializer really can host an execution (`for ((i=$(rm x); …))`), and a top-level `X=$(rm q)` produces the same shape.
  The distinction between the two positions is not expressible in a node-type set, and emitting is the never-weaker direction.
- **The plan's measured numbers reproduced in kind, not exactly, and the difference was the corpus.**
  Re-measured at the landing commit: 191 of 4348 intact commands gain units (plan: 189 of 4276) and +842 units (plan: +829), with `pathRuleCandidates()` / `externalAccesses()` changing on **zero** — the number that carries the non-breaking claim, and the one that reproduced exactly.
  The wrapper-headed count read 11 against the plan's 5; six are `/usr/bin/time -p wezterm …` entries the planning corpus did not contain.
  Re-measuring rather than defending the plan's figures is what surfaced that.
- **The pre-completion reviewer's one WARN was a real convention violation, and fixing it produced a better instrument than the one it replaced.**
  The numbers were produced by a throwaway vitest file that diffed HEAD against `6ffdf1af` — not re-runnable by a later reader, which this package's own precedent (`measure-core-coverage.mjs`, `measure-wrapper-transparency.mjs`) forbids.
  The committed replacement transcribes *both* enumerators and diffs them over one real parse, so the delta is derivable at any commit with no baseline checkout, and it independently reproduced 191 / +842 / 11.
  It also added a row the throwaway could not: `prefix-position substitution: 0` bounds the path half's blast radius from above, which re-derives "zero path-slice changes" as a forward measurement instead of a historical diff.
- **A second reviewer round on the delta caught that the upper-bound argument was stated on the diff's footprint rather than on behavior.**
  The same commit range also rewrites `collectHostedExecutionTokens` onto `forEachExecutionIn`, which reaches call sites well outside prefix position; it is output-identical, so the bound holds, but a reader re-deriving it has to know to check that first.
  The script header now says so.
- **Pre-completion reviewer: PASS** (second round, scoped to the WARN fix).
  The first round returned WARN with the single instrument finding above; its six-item re-derivation mandate came back clean, including an independently-parsed sweep for statement types missing from the sets.
  It found one pre-existing grammar limitation worth recording: `coproc NAME { … }` is not recognized as a distinct construct by `tree-sitter-bash` 0.25.1 at all — it parses as two garbled `command` nodes, so a coprocess body's commands are unreachable to the enumerator.
  Unchanged by this work and claimed nowhere, but it is the one shape a reader might assume the statement descent now covers.

## Stage: Ship (worktree) (2026-08-29T22:28:58Z)

### Session summary

Pre-push checks pass clean from the worktree root: `pnpm run lint` and `pnpm fallow dead-code` both report zero issues.
All six TDD steps plus two pre-completion follow-on `docs:` commits are already on this branch; the plan's `**Release:**` marker is "ship independently," so the root should release at land time rather than deferring.
No deferred work remains — both residuals the planning session identified are filed and dispositioned ([#839] deferred to Phase 15, [#840] adopted as Phase 14 Step 14).

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-742--/2026-08-29T21-39-47-258Z_01a04f76-e5ba-746d-8d08-cc5ad957270e.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Concise breadcrumb only — the final `/retro 742` at the root captures the retrospective proper, including the TDD-stage observations already recorded above.

## Stage: Final Retrospective (2026-08-29T23:00:38Z)

### Session summary

Landed the peer worktree branch onto `main` as a clean fast-forward, verified CI, closed [#742] with a four-SHA close comment, released `pi-permission-system` 27.1.3, and tore down the worktree.
The issue spanned four sessions — planning and TDD in the peer worktree on `claude-opus-5`, the worktree ship on `claude-sonnet-5`, and land plus this retrospective at the root on `claude-opus-5`.
Across all four the design survived contact intact, the operator's three planning elaborations each corrected a real defect, and the one substantial friction was a measurement harness that twice destroyed uncommitted work.

### Observations

#### What went well

- **The measure-then-plan discipline paid three separate times, and each payment was a different kind.**
  Planning prototyped the whole change and reverted it, which caught the operand-word leak that made the statement-typed descent filter the design's load-bearing idea.
  TDD re-measured rather than restating the plan's figures, which surfaced a corpus difference (11 wrapper-headed units against the plan's 5).
  Pre-completion review then rejected the numbers for having no committed instrument, and the replacement `scripts/measure-statement-descent.mjs` is strictly better than what it replaced — it derives the delta at any commit with no baseline checkout, and its `prefix-position substitution: 0` row converts "zero path-slice changes" from a historical diff into a forward bound.
- **The three planning `ask_user` rounds were the highest-value thing in the issue, and all three were elaboration requests rather than answers.**
  The operator's "is the bash command *actually* malformed?"
  collapsed a 111-command `ERROR` population to 1 and voided an entire option set priced on it.
  "Are you showing me a command stack, represented as a LIFO array?"
  rejected raw JSON as a before/after presentation.
  "Is it our ability to correctly assess … or merely about the presentation?"
  was settled by a one-line grep the first gate should have carried.
  None of the three was a preference question; each was a defect report against the gate.
- **Per-step killing mutations caught a vacuous test that the Red step could not have.**
  Step 4's "leaves a function's own name unemitted" passed during its own Red step.
  Rather than assuming it was a broken probe, the session mutated away the `STATEMENT_TYPES` filter and confirmed the test dies — so it is a genuine pin.
  Ten mutations across steps 1–5, one per node type, each failing exactly and only its own row.
- **Incremental verification is what made the destroyed-work incident survivable.**
  The full package suite ran after every step, so both silent reverts were caught within one tool call of happening.
  A session that verified only at the end would have committed a reverted Step 4.

#### What caused friction (agent side)

- `rabbit-hole` — the Step 4 blast-radius measurement swapped `src/` between the landing state and the pre-change commit using `git checkout <ref> -- src`, and restored with `git checkout HEAD -- src`.
  HEAD was the *previous step's commit*, so the restore silently reverted the uncommitted Green step — twice.
  The second recovery compounded it: the restore command led with `rm -rf packages/pi-permission-system/src`, which this package's own gate denied mid-command, leaving three files in a mixed state.
  Impact: roughly 13 consecutive tool calls (peer TDD turns 76–91) spent on restore-and-reverify rather than on the step, and two full-suite runs to prove the tree was whole again.
  The working shape was found only on the third attempt — `git show <ref>:<path>` into a temp dir for the baseline, `cp` for the current state, and `cp` in both directions to swap.
- `missing-context` — the planning session read the package skill, which already says a command longer than `reviewLogFieldMaxWidth` is stored with a trailing `…` and that a scan needing whole commands must exclude those.
  It then scanned the log for parse failures without that filter and reported 111 `ERROR` commands.
  Impact: an entire `ask_user` option set was drafted and priced on "108 commands would newly prompt", and only the operator's question retired it.
  The rule existed and was read; it did not fire at the moment it applied, which makes this a salience problem rather than a documentation gap.
- `other` — a Step 3 `Edit` failed against a decorative `// ── … ──` comment rule the change needed to rename, costing about five calls before the session recomputed the pad width with a short `python3` script.
  Impact: added friction, no rework.
  `AGENTS.md` already warns about this class and prescribes copying the rule line from a fresh `Read`; the programmatic width recompute is arguably the better technique for the rename case.
- `other` — one measurement harness run failed on a guessed module path (`#src/access-intent/path-normalization` for what is `#src/path-normalizer`).
  Impact: three tool calls, no rework.

#### What caused friction (user side)

- Nothing to correct — the three planning elaborations were the ideal intervention shape: a question that redirects rather than a correction that patches.
  The one opportunity worth naming is that the `ERROR`-population question ("is the bash command *actually* malformed?") was available to the agent as a self-check, and the operator should not have had to be the one to ask it.
  That is an agent-side salience fix, recorded above, not a request for different user behavior.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5` (judgment-heavy: design gates, mutation reasoning, ADR amendments) and the worktree ship on `anthropic/claude-sonnet-5` (mechanical: two gates, a stage note, a rebase).
  Both assignments fit the work.
  The `tidy-first-assessor` subagent cost 141.6s and 81k tokens to return no required tidyings and one structural confirmation — a correct dispatch whose value was the verification, not the suggestions.
  The `pre-completion-reviewer` ran twice; round one's WARN is what produced the committed instrument.
- **Escalation-delay tracking** — the `git checkout` incident ran about 13 consecutive tool calls on the same failure mode, well past the 5-call threshold.
  A subagent was not the missing lever here; the missing move was stopping after the *first* silent revert to re-derive why the restore did not restore, instead of retrying variations of the same command shape.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` and the package suite ran inside every step, killing mutations were verified before each commit, and root-level `lint` / `fallow dead-code` ran at end-of-cycle and again at ship.
  This is the discipline that bounded the one real incident to rework rather than a bad commit.

### Changes made

1. `AGENTS.md` — added the `git checkout <ref> -- <path>` A/B-measurement hazard to the git-hazards cluster: the restore half restores HEAD, not the working tree, so back both sides up as files and swap with `cp`, never leading the restore with `rm -rf`.
2. `.pi/skills/package-pi-permission-system/SKILL.md` — sharpened the existing review-log truncation caveat from a hedge ("should exclude or account for those") into a directive that names the filter and the concrete failure it prevents.
   Net zero lines; the rule already existed and was read without firing.
3. `packages/pi-permission-system/docs/retro/0742-enumerate-catch-all-node-types.md` — this Final Retrospective stage entry.

One proposal was declined at the clarification gate: an `AGENTS.md` bullet requiring a gate that proposes a new data-structure field to name that field's read sites first.
It had the smallest evidence base of the three — a single bounced question.

[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#839]: https://github.com/gotgenes/pi-packages/issues/839
[#840]: https://github.com/gotgenes/pi-packages/issues/840
