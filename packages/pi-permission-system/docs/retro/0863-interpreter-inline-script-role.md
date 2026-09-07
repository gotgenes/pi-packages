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

## Stage: Strategic review (2026-09-07T04:18:01Z)

### Session summary

After the plan was committed, the operator stepped back and asked whether the bash path projection is in diminishing returns, whether prior art exists for deterministic command evaluation, and whether a different approach would be more effective.
The answer to all three was yes, and the session measured it rather than argued it: Pi's `bash` override seam, nono's per-command cost, rollback, denial reporting, nesting, and Linux capability elevation with a webhook backend were each verified by execution on macOS and in a Docker Linux container.
The outcome is [#892] (the sandbox ADR, folded into Step 6 and moved first), [#891] (PowerShell, deferred), two upstream nono reports, and the decision **not** to implement this plan.

### Observations

- **The projection is the part that diminishes; the decision layer is the product.**
  What a sandbox cannot do is the whole rest of the package: `bash:` prefix rules on actions the sandbox permits (`git push --force`), in-process `read`/`write`/`edit` prompts with session grants, tool/MCP/skill surfaces, tool exposure, per-agent precedence, forwarding a child's ask to its parent, the review log's `decidedBy`, and the authorizer chain.
  Pi core ships no permission layer and no sandbox (verified: the only `sandbox` reference in `packages/coding-agent/src` is a workaround for running *under* nono), which is why the package is popular.
  Every third-party issue in two months (#797, #800, #684, #859, #863) is a false positive of the one layer a sandbox replaces.
- **Codex is prior art for the architecture, with the same parser.**
  `codex-rs/shell-command/src/bash.rs` uses `tree-sitter-bash` to *reject* any script beyond plain word commands joined by `&& || ; |`; `is_dangerous_command.rs` is one denylist entry plus `sudo`/`env`/`trap`/`bash -lc` unwrapping; the PowerShell module lowers "a deliberately small literal subset" and fails closed.
  A well-resourced team holding our parser chose not to build the projection.
  Every Phase 13–15 fix made the enumerator descend *deeper*; Codex's design says the safe direction for a static analyzer is to recognize *less* and hand the rest to something that enforces.
- **Measured, not inferred** (nono 0.75.0): per-command overhead ~95 ms `run` / ~40 ms `wrap` on macOS, ~20 ms on Linux; `--rollback --no-rollback-prompt` restores a failed run's writes; nono refuses to nest, so per-command and whole-process are alternatives; macOS `--diagnostics-json` reports denials for the **direct child only** (`bash -c 'cat X'` reports nothing, `bash -c 'exec cat X'` reports) — posted on nolabs-ai/nono#1796; Linux `capability_elevation` + `webhook` traps a grandchild's `open` mid-syscall with `{path, access: Read|Write|ReadWrite}` and a `granted` answer lets the same `cat` proceed, but creation (`O_CREAT`, `mkdir`) is never trapped — filed as nolabs-ai/nono#1797.
- **`tree-sitter-bash` drops newlines from a multi-line double-quoted string** (one `string_content` per line, concatenated), so the issue's "collapsed" token is a parser property, and a "contains a newline" rule would never have fired on the reported command.
  Worth remembering before anyone reasons about token text from the source command.
- **The two measurement scripts this session wrote were throwaway spikes**, not committed instruments, because the numbers they produced argue for *not* landing the change they priced.
  The corpus diff (105 tokens lost, 0 real paths, 0 gained over 5918 commands) is recorded in the plan's Background for whoever revisits.

#### Phase handoff

- **Candidate cause:** the bash path projection infers a shell command's filesystem effects from its text and uses the inference as a security boundary; the problem is undecidable in general, each fix adds a table row that "rots silently" (ADR 0009's own words), and the unrecoverable failure (a dropped operand) is the one no corpus can measure.
- **Sequencing call:** [#892] opens *before* this issue's implementation.
  Step 6 folds it in, is scoped up from "export + launcher" to "decision record + manifest compiler + `bash` override + Linux webhook backend + macOS re-run backend + fallback prompt", and lands ahead of Steps 1–5 and 7, each of which is re-evaluated once the record exists.
  Recorded in the roadmap's sweep list and Track C (commit `42458eb0`).
- **What this plan becomes:** not implemented as written.
  Its Change A (a consumed flag argument is searched for hosted executions) is a genuine ADR 0009 guarantee violation and may land alone; its Change B (interpreter rows) amends the ADR 0009 bound the record would rather freeze.
  [#863] and [#859] close against the sandbox, or [#859] lands as its one-regex fix.
- **Open upstream dependencies:** nolabs-ai/nono#1796 (macOS denial reporting below the direct child) and nolabs-ai/nono#1797 (Linux elevation does not trap creation).
  Neither blocks; each narrows how often the fallback prompt fires instead of the kernel-named one.
- **Windows:** keeps the frozen projection for Git Bash, advisory; PowerShell is [#891]; WSL2 is the sandboxed path.

[#859]: https://github.com/gotgenes/pi-packages/issues/859
[#886]: https://github.com/gotgenes/pi-packages/issues/886
[#891]: https://github.com/gotgenes/pi-packages/issues/891
[#892]: https://github.com/gotgenes/pi-packages/issues/892

## Stage: Sync (worktree) (2026-09-07T04:26:01Z)

### Session summary

Pre-push checks pass (`pnpm run lint`, `pnpm fallow dead-code`), rebase onto local `main` is clean, and this branch is docs-only: the plan's `**Release:** ship independently` marker refers to the code change as originally scoped, which was never implemented — the Strategic review stage above records why (folded into [#892]).
Nothing here should dispatch a release; the five commits are the plan, its planning retro, this sync note, and three roadmap dispositions (#886, #891, #892).

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-863--/2026-09-06T04-26-34-471Z_01a074f7-d666-74ca-8763-acc838562474.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

No deferred work beyond what [#892], [#891], and [#886] already track.
The final `/retro 863` at the root is where the strategic-review turn (the sandbox-vs-projection discussion, the nono measurements, the two upstream reports) should be synthesized — this session's transcript above is the primary source for it, since the Strategic review stage note is a summary, not a transcript.
