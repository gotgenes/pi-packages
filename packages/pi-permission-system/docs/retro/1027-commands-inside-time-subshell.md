---
issue: 1027
issue_title: "pi-permission-system: commands inside `time ( … )` are not enumerated as units"
---

# Retro: #1027 — pi-permission-system: commands inside `time ( … )` are not enumerated as units

## Stage: Planning (2026-10-08T06:57:32Z)

### Session summary

Planned a shared recognizer, `timedSubshellOf`, in `nested-execution.ts` (`time` plus one `subshell` word).
The enumerator descends the timed subshell as a bare `( … )` and exempts the `time` unit (`"execution-modifier"`); the path resolver walks the subshell so its `cd` folds and resets.
The plan has four steps (one `refactor:` moving `commandWordNodes`, two `fix:`, one `docs:`), and follow-up [#1043] was filed for the remaining `time` shapes.

### Observations

- The operator chose option A for the `time` unit: keep it emitted, exempt it, and resolve it by its `( … )` text, the way a bare subshell's whole emit resolves.
  Rejected: keeping the floor (no relief) and dropping the unit (loses `time *` rule reach).
- The brace group `time { …; }` stays floored and was filed as [#1043], with `time -p ( … )`, `time for …`, and `time ! …`; it is deferred to a later phase (operator decision, recorded in the roadmap sweep list).
  The review log holds 0 `time {` asks and 10 `time (` asks (measured, `permission_request.waiting`).
- Path-side finding: `BashPathResolver` already collected tokens inside `time ( … )` with the right effects; the only gap is the `cd` fold (measured: `time (cd /tmp && cat ./x)` → `<cwd>/x`, while the bare subshell gives `/tmp/x`).
- A prototype of the whole design, patched into `src/` and reverted, ran the full suite: 5687 passed, 2 failed, both rows that pin the old floor (`program.test.ts` floor-exemption row, metamorphic floor-list row).
  `time (echo $(rm x))` emitted `rm x` once only because the hosted-command walk skips the subshell; that is a named mutation in step 2.
- Probe: `2>./err time (rm x)` hosts its redirect inside the `command` node, so the resolver's non-subshell-child collection is reachable and is tested in step 3.
- Recognizer scope is `time` only; `sudo (rm x)` / `nice (rm x)` are bash syntax errors and keep today's floor.
- The tidy-first assessor recommended moving `commandWordNodes` to `nested-execution.ts` so the recognizer shares one filter; I verified the no-cycle claim by reading the import lines.

## Stage: Implementation — TDD (2026-10-08T07:17:11Z)

### Session summary

Completed all four plan steps in four commits:

- `refactor`: share the command word filter from `nested-execution.ts`.
- `fix`: commands inside `time ( … )` are gated on their own rules.
- `fix`: a `cd` inside `time ( … )` resolves the paths after it in that subshell.
- `docs`: document the timed-subshell descent and mark #1027 complete.

The package suite went from 5688 to 5720 tests.

### Observations

- Every killing mutation the plan named killed the predicted class; I also mutation-checked each pin that stayed green during Red.
  - Dropping the whole `time` unit emit reddened the explicit `time *` ask/deny rows.
  - Dropping the `time` text test reddened the `sudo`/`nice`/quoted rows.
- Deviation: ESLint (`no-unnecessary-condition`) rejected `argument?.type` on a destructured element, which it types as non-nullish even when the word list is short, so `timedSubshellOf` checks `words.length !== 2` explicitly.
- Finding: that length check is defensive only.
  I added a row expecting `time (rm x) y` to be unrecognized, but the grammar wraps `time (rm x)` in an `ERROR` and parses `y` as a separate command, so the inner `command` node still has exactly two words.
  The `ERROR` is emitted whole and floored before the recognizer matters, so the row moved to `program.test.ts` as a unit-level pin (killed by making the `ERROR` branch descend).
  A `[time, subshell, word]` word list was never observed, so mutating the length check to `< 2` survives.
- `TSNode` has no `id`, so the subshell child is excluded by `startIndex`, in both the enumerator and `walkTimedSubshell`.
- Plan literal corrected in step 3: `sub` in `time ( cd sub && cat ./x )` is not projected (it does not exist on disk), so the rule-candidate row compares against the bare subshell's output as its oracle, plus one concrete match value.
- Pre-completion reviewer: PASS.
  The reviewer ran its own probes of shapes that reach the recognizer: process substitution, `for` inside, chains, background, heredoc redirect.
  It found no command riding the exemption ungated.

## Stage: Final Retrospective (2026-10-08T15:49:38Z)

### Session summary

One trunk session ran all four stages: plan, TDD, ship, and this retro.
`time ( … )` subshells are now enumerated and the `time` unit exempted, and a `cd` inside folds on the path side.
The change shipped as `pi-permission-system` 40.1.1, and the residual `time` shapes were filed as [#1043] (deferred).

### Observations

#### What went well

- Prototyping the whole design into `src/` at planning time, then reverting it, paid off exactly.
  It predicted the two tests that flipped (`program.test.ts` floor row, metamorphic floor row) and showed that `time (echo $(rm x))` needs the subshell excluded from the hosted walk.
  Implementation then hit no unplanned test breakage.
- The gate's numbers came from the real review log: 10 `time (` asks and 0 `time {` asks.
  That made the brace-group deferral an easy, grounded call rather than a guess.
- Mutation-checking the pins that stayed green during Red worked.
  Dropping the whole `time` emit reddened the explicit `time *` rows, which proved the never-weaker invariant is pinned, not assumed.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — the ellipsis in `time ( … )` was emitted wrong four times, the last while writing this entry.
  It came out as tabs in a `command-enumeration.ts` comment, and as a literal `\u2026` escape in a `bash-path-resolver.ts` comment and in two retro bullets.
  All four sat inside backticks, which is the unicode-escape gate's deliberate escape hatch, so no hook caught them; each was found only by a manual grep.
  Impact: four repair edits and one `--amend`; no shipped damage.
- `missing-context` (self-identified) — the plan's step 3 rule-candidate row was authored from expectation rather than run through the prototype that existed.
  It assumed `sub` would be projected, but `sub` does not exist on disk, so it is not.
  The `/plan-issue` rule "run each case the TDD Order names through the prototype" covered it.
  Impact: one extra red-debug cycle; the row was rewritten to use the bare subshell as its oracle.
- `missing-context` (self-identified) — a recognizer row for `time (rm x) y` was written without probing the parse.
  The grammar wraps `time (rm x)` in an `ERROR`, so the row was false at Green, and the length check it targeted turned out to be unreachable.
  Impact: three tool calls; the row moved to a program-level pin.
- `other` — the planning prototype used `TSNode.id`, which the type does not declare, and ran green because Vitest does not typecheck.
  The plan inherited the prototype's shape, so `tsc` caught it only at Green.
  Impact: one edit.

#### What caused friction (user side)

- None: the three `ask_user` gates (`time` unit resolution, brace-group scope, #1043 disposition) were each answered in one round.

### Diagnostic details

- **Model-performance correlation** — both subagents ran on `anthropic/claude-sonnet-5-5`, read from their transcripts.
  The `tidy-first-assessor`'s recommendation (move `commandWordNodes`) and the `pre-completion-reviewer`'s probes (twelve shapes beyond the tests) were judgment work suited to it.
- **Feedback-loop gap analysis** — `check` ran after every Green and the full suite before each commit.
  The one late catch (`TSNode.id`) traces to the untypechecked planning prototype, not to the TDD loop.

### Changes made

1. `.pi/skills/markdown-conventions/SKILL.md`: one sentence after the backtick-hatch rule saying the hatch also hides a mis-emitted glyph, with the `rg` that finds an escape inside a code span.
2. Filed [#1044] (`scope:repo`): `invisible-characters.mjs` should reject a tab inside an inline code span, which is the tab form of this session's misses.
   The repo has 0 such tabs today (measured), so the check needs no allowlist.
   Flagging typographic escapes inside code spans was considered and declined, since 119 deliberate quotes exist (measured).

[#1043]: https://github.com/gotgenes/pi-packages/issues/1043
[#1044]: https://github.com/gotgenes/pi-packages/issues/1044
