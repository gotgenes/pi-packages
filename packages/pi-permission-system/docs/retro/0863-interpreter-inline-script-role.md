---
issue: 863
issue_title: "pi-permission-system: a `node -e` script whose first line is a `//` comment is classified as an external_directory path, raising false asks"
---

# Retro: #863 — An interpreter's inline script is classified as an external_directory path

## Stage: Planning (2026-09-06T17:38:36Z)

### Session summary

Planned Phase 15 Step 1 as `packages/pi-permission-system/docs/plans/0863-interpreter-inline-script-role.md`: interpreter rows in `PATTERN_FIRST_COMMANDS` plus a preparatory fix to the consumed-flag-argument branch, an ADR 0009 amendment, and the roadmap/doc updates.
The issue is third-party (`kuoruan`), so the direction went through an `ask_user` gate; the operator chose the roadmap's five interpreters **plus `bun`**, the cluster spellings as a documented residual, and a filed follow-up for the opacity question.
A second gate on a newly discovered defect chose to fix it inside this change rather than defer it.

### Observations

- **The issue under-reports its own defect.**
  The script token reaches the broader `path` surface as well as `external_directory`, because it contains `/`.
  `python3 -c "# c\nprint(1)"` and `ruby -e '# x'` reach `path` with no `//` anywhere, so a classifier-only narrowing would have fixed the reported repro and left the family standing.
  This is the package skill's "trace the token through the classifier first" rule paying off before any design was written.
- **The newline collapse is a `tree-sitter-bash` property, and it killed the obvious alternative lever.**
  A multi-line double-quoted string parses as one `string_content` per line and `resolveNodeText` concatenates them, so the newlines are gone by the time any classifier sees the token.
  "A token containing a newline is not a path" would never have fired on the reported command.
  A single-quoted `raw_string` keeps them, so the two quoting styles resolve differently — worth remembering before anyone reasons about token text from the source command.
- **The scope-collision check earned its place in the workflow.**
  ADR 0009 § "Where the bound sits" forbids adding a command `PATTERN_FIRST_COMMANDS` does not name, in those words, and says such a change "needs its own decision".
  Found before the first gate, it became part of the gate's substance and a plan step; found after the design settled it could only have been argued around.
- **A new defect surfaced from measuring rather than from reading.**
  `collectPatternCommandTokens` discharges a consumed flag argument and `continue`s without searching it for hosted executions, so `sed -e "$(cat /etc/shadow)" f.txt` projects only `f.txt`.
  ADR 0009 calls positional invariance "a guarantee, not a residual", so this is inside the contract — a pre-existing violation this change would have widened to the interpreter population.
  Measured population: 0 of 5922 corpus commands.
  Operator chose to fix it as a separate preparatory step.
- **The corpus diff is what made "no protection is lost" a measurement instead of an argument.**
  Applying the rows as a spike and diffing accepted tokens over 5918 real commands: 105 lost (103 non-path-shaped script text, 2 `perl` `s|a|b|` substitution scripts), 0 gained, 0 real paths.
  The `qualitative cost claim is measurable too` rule applied directly — the first draft of the gate said "nothing is lost", and the diff is what turned that into a number.
- **Every table row but one was verified by running the binary.**
  `node` 26.8.1, `bun` 1.4.1, `python3` 3.14.7, `perl` 5.34.1, `ruby` 4.0.6.
  Two findings came only from execution: `node -p t.js` evaluates the file name as source (so `-p` always consumes a following argument, despite tolerating none at all), and `ruby -E` is `--encoding` rather than a script flag — which is why `perl` and `ruby` cannot share a config object.
  `python` is absent from this host and is the one row shipping on a stated basis rather than a run; the plan names it as the implementing session's check.
- **`node -pe` is not getopt and `perl -ne` is.**
  That asymmetry is why the cluster class cannot be closed with one rule, and it is the substance behind deferring it.
  Measured at 12 of 270 interpreter inline invocations.
- **Tidy-First returned an empty result, correctly.**
  The assessor declined a shared config-builder for the new rows under Sandi Metz's corollary — the per-parser separation is the point — and confirmed both changes land in code already shaped for them.

#### Deferred tidyings

None.
The assessor found nothing preparatory; its one considered candidate (a `scriptFlagsConfig` factory for the interpreter rows) was rejected as a stylistic choice about new code rather than a tidying of existing code, and as one that would invite treating the per-parser configs as interchangeable.

### Follow-ups filed

- [#886] — should an interpreter's inline script floor to `ask` like `bash -c`?
  Filed because #863 removes the last accidental signal that an interpreter payload is opaque, even though it removes no real protection.
  Disposition recorded against Phase 15 as deferred to a later phase (commit `1f5b983c`): it adds prompts in the opposite direction from this phase's cause, and Steps 4 and 6 change its calculus before it is worth scheduling.

[#886]: https://github.com/gotgenes/pi-packages/issues/886
