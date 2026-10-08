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

[#1043]: https://github.com/gotgenes/pi-packages/issues/1043
