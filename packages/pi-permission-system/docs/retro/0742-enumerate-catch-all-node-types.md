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

[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#839]: https://github.com/gotgenes/pi-packages/issues/839
[#840]: https://github.com/gotgenes/pi-packages/issues/840
