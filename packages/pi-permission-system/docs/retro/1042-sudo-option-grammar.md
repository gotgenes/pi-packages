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

[#680]: https://github.com/gotgenes/pi-packages/issues/680
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#971]: https://github.com/gotgenes/pi-packages/pull/971
[#1053]: https://github.com/gotgenes/pi-packages/issues/1053
