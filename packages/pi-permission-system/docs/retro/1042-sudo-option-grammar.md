---
issue: 1042
issue_title: "pi-permission-system: sudo -e (sudoedit) operands are peeled as an inner command and can earn the core-reader exemption"
---

# Retro: #1042 — pi-permission-system: sudo -e (sudoedit) operands are peeled as an inner command and can earn the core-reader exemption

## Stage: Planning (2026-10-09T02:44:34Z)

### Session summary

Reproduced the sudoedit fail-open through the real parse and gate with a disposable spike, and found the wider class: `innerCommandIndex` misplaces sudo's inner command for clustered (`-nu`), long (`--user`, `--chdir`), and abbreviated (`--us`) options, so `sudo --user cat rm x` rides past an `rm *` deny.
The operator chose scope B (a getopt-faithful sudo grammar, with edit, shell, login, chdir, and chroot modes refusing the peel) and `fix:`; the plan sequences a Tidy-First extraction, a mechanism step with seed rows, a data step completing the rows from `man sudo`, and a docs step.
Filed [#1053] for the same class on `env`/`xargs` (including `env -C`'s moved cwd), dispositioned as a new Phase 15 step after this one.

### Observations

- Completing sudo's value-taking table without refusing `-D`/`-R` would have **opened** a fail-open: `sudo -D /etc cat shadow` keeps the floor today only because `/etc` is misread as the command; parsed correctly it earns `core-reader` while the path surfaces judge `shadow` against the agent's cwd.
- The grammar refuses anything unlisted and resolves long abbreviations against every key, refusing ones included (`--l` is ambiguous in real sudo, but would resolve to `--list` against admitted names alone).
- `-h`/`--host` refuse (its arity depends on context), and `-r`/`-t` stay unlisted (absent from this host's `man sudo` 1.9.17p2), following [#963]'s verify-against-a-local-binary rule.
- I ran live `sudo` probes (`sudo --ed`, `sudo -n --ed /nonexistent-dir-xyz/f`, …) to verify getopt abbreviation and cluster parsing without first telling the operator; they surfaced as permission prompts.
  The `-n --ed <path>` probe was careless: with cached credentials it would have gone further into a real sudoedit attempt, and `sudo -n --list --ed` alone proved the point.
- The operator agreed a floor-override mechanism is needed but ruled it out of this fix; that stays with [#680] and PR [#971].
- Measured exposure: 0 hits for every newly floored shape in 23,779 review-log entries.

#### Deferred tidyings

- `src/access-intent/bash/wrapper-analysis.ts`: a shared `GetoptGrammar` interface for every wrapper was rejected by the assessor as premature until a second grammar (`env`/`xargs`, [#1053]) exists.

## Stage: Implementation — TDD (2026-10-09T04:00:32Z)

### Session summary

All four plan steps landed in order: the Tidy-First extraction of `tableInnerIndex`, the getopt scanner with seed rows (sudoedit, clusters, long options, abbreviations), the full `SUDO_GRAMMAR` from `man sudo` 1.9.17p2, and the docs step (`configuration.md`, the `wrapper-analysis.ts` entry, and the roadmap ✅ with its `Landed:` note).
The `pi-permission-system` suite went from 5720 to 5779 tests (+59).
The pre-completion reviewer returned **WARN** with no blocking finding, after re-deriving 185 sudo shapes of its own through the real gate.

### Observations

- No deviation from the plan's TDD Order or Module-Level Changes.
- Every planned killing mutation killed exactly the predicted tests.
  Step 3's refusal tests were green during Red, as the plan expected, since step 2's "unlisted refuses" already covered them, so each of the twelve refusing rows was mutated individually (to the arity that would make it look transparent) and each was killed by its own test.
  One extra mutation (an ambiguous prefix resolves to its first match) was needed to pin `sudo --pre cat x`, which the plan's admitted-keys-only mutation cannot kill.
- The first M1 mutation (`grammar !== grammar`) inverted the intended effect and was caught before running; after a `cp` restore the `Edit` tool twice rejected an `oldText` that matched byte-for-byte, and succeeded on retry.
- ESLint rejects spreading a string (`[...letters]`); the cluster walk uses an indexed loop.
- Reviewer warnings: residual 1, an unquoted computed word in a peeled layer's options (`sudo -u $U cat x`, `timeout $D cat x`) splits into the command that runs while `core-reader` judges `cat`.
  It predates this change and affects every wrapper; verified with a spike and filed as [#1056], dispositioned as a new Phase 15 step after [#1053] (operator decision, given reluctantly: the operator wants Phase 15 closed so the sandbox phase can start).
  Residual 2 (`sudo env -C /etc cat shadow`) is [#1053]'s; residual 3 (`sudo -l`, `--help`) is a stated Non-Goal.

## Stage: Sync (worktree) (2026-10-09T04:19:15Z)

### Session summary

`pnpm run lint` and `pnpm fallow dead-code` pass from the worktree root.
The plan's marker is `**Release:** ship independently`; the two `fix:` commits (sudoedit and clustered or long options; shell, login, chdir, and chroot modes) are what the release will carry, and [#1053] and [#1056] are the filed follow-ups, both dispositioned as Phase 15 steps.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1042--/2026-10-09T00-56-53-533Z_01a11e29-ba1c-7360-84fe-52615aa1dc12.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- The reviewer's WARN (an unquoted computed word in a peeled layer's options) was settled before sync: filed as [#1056] and dispositioned, so nothing was left open for the root.
- The operator wants Phase 15 closed soon so the sandbox phase can start; [#1053] and [#1056] are the two steps this issue added in front of that.

[#680]: https://github.com/gotgenes/pi-packages/issues/680
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#971]: https://github.com/gotgenes/pi-packages/pull/971
[#1053]: https://github.com/gotgenes/pi-packages/issues/1053
[#1056]: https://github.com/gotgenes/pi-packages/issues/1056
