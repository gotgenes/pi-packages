---
issue: 1040
issue_title: "Scrub zsh guidance now that the bash tool runs bash"
---

# Scrub zsh guidance from live agent docs

## Release Recommendation

**Release:** ship independently

Every edited file sits outside `packages/`, so no package release scope is touched and `/ship` dispatches nothing; the issue is in no roadmap.

## Problem Statement

The `bash` tool now runs Homebrew bash, but `AGENTS.md`, the `shell-traps` skill, and the `/plan-improvements` prompt still tell every session that the shell is zsh.
On [#1036]'s build that guidance produced a zsh-only `${=FILES}`, which bash rejected with `bad substitution`.

## Goals

- Remove the claim that the `bash` tool runs zsh from all live agent guidance.
- Delete the zsh-only traps (`$status` read-only, `=word` equals expansion, no word-split of an unquoted parameter, zsh `echo` decoding escapes).
- Keep the one trap that still holds under bash (an unquoted glob silently substituting a matched filename), reworded for bash and moved to the `shell-traps` skill body.
- Not breaking: docs and prompts only, no package code.

## Non-Goals

- `pi-permission-system`'s `zsh` entries (`SHELL_WRAPPER_NAMES`, its tests, `docs/configuration.md`, `docs/architecture/architecture.md`, `docs/decisions/0010-…`) and the two `measure-*.mjs` scripts: product behavior, since a user's command can still invoke `zsh -c`.
- Historical plans, retros, triage notes, and `docs/agent-docs-audit/2026-09-29/inventory-workflow.md` (which records `plan-improvements.md`'s zsh parenthetical as "keep"): they describe what was true at the time.
- `scripts/release/lib.sh` lines 24–26: predicted **unchanged**.
  The comment guards against sourcing the file from an interactive zsh, and the operator's login shell is still zsh (`$SHELL` = `/opt/homebrew/bin/zsh`, measured), so it still applies.
- Stating which shell the `bash` tool runs: the operator chose to drop the line rather than replace it, since a model assumes bash unaided.

## Background

Measured in this session's `bash` tool: `$BASH_VERSION` is `5.3.20(1)-release`, `$0` is `/opt/homebrew/bin/bash`.
The cause is `"shellPath": "/opt/homebrew/bin/bash"` in `~/.pi/agent/settings.json`; `$SHELL` still reports the login zsh.

Each existing rule, re-checked under bash in a scratch directory holding `a.ts` (measured):

| Rule                                      | Location                   | Bash behavior                                                    | Disposition                        |
| ----------------------------------------- | -------------------------- | ---------------------------------------------------------------- | ---------------------------------- |
| "The `bash` tool runs zsh."               | `AGENTS.md:39`             | false                                                            | delete                             |
| Unquoted glob expands against cwd         | `AGENTS.md:40–41`          | `echo *.ts` → `a.ts`; `echo *.xyz` → `*.xyz` (silent either way) | reword, move to `shell-traps`      |
| Unquoted parameter not word-split         | `AGENTS.md:42`             | `printf '[%s]\n' $FILES` → `[x]` `[y]`                           | delete (standard bash)             |
| `=word` equals expansion                  | `AGENTS.md:43`             | `echo ===` → `===`                                               | delete                             |
| `$status` read-only                       | `AGENTS.md:44`             | `status=3` succeeds                                              | delete                             |
| zsh facts "stay in `AGENTS.md`"           | `shell-traps/SKILL.md:11`  | pointer to deleted text                                          | rewrite                            |
| `echo` decodes `\u2014`                   | `shell-traps/SKILL.md:19`  | `echo '\u2014'` → `\u2014`; `xpg_echo` off                       | delete                             |
| "the shell is zsh; its 1-indexed arrays…" | `plan-improvements.md:193` | bash arrays are 0-indexed                                        | keep the rule, drop the zsh reason |

The `AGENTS.md` admission test drove the two operator calls: the shell-identity line fails question 1 (a model assumes the `bash` tool runs bash), and the glob rule fails question 2 (generic bash behavior, not an environment fact), so it moves to its topic skill.

Search scope, run at planning time: `rg -l -i zsh` across the repo excluding plans, retros, triage, history, and changelogs returned only `AGENTS.md`, `scripts/release/lib.sh`, the audit inventory, and `pi-permission-system` files; `rg -n -i 'zsh|\$status|equals expansion|no matches found|print -r' AGENTS.md .pi/` returned only the lines in the table above.
No open issue or PR besides #1040 matches `zsh` or `shell-traps`.

## Design Overview

### `AGENTS.md` `### Shell`

Delete lines 39–44.
The section keeps its one remaining line, the `pi-permission-system` deny-rule tripwire pointer, which still holds.

### `.pi/skills/shell-traps/SKILL.md`

Replace line 11 (the zsh-facts pointer) with nothing; the intro keeps "Load this skill before composing a non-trivial `bash` call."
Delete line 19 (zsh `echo`).
Add the glob rule under `## Command flags and state`, worded for bash:

```markdown
Quote a glob pattern meant for a command rather than the shell — `--include='*.ts'`, `find . -name '*.ts'`.
Unquoted, bash expands it against the cwd first and silently substitutes any matched filename; with no match it passes the pattern through, so the bug surfaces only in a directory that happens to hold a match.
```

The skill's frontmatter `description` names pipelines, loops, heredocs, in-place edits, and `gh … --body`; a glob argument is covered by "a non-trivial `bash` call" in the body and needs no trigger change.

### `.pi/prompts/plan-improvements.md:193`

Replace the parenthetical `(the shell is zsh; its 1-indexed arrays silently shift titles relative to bodies)` with `(an off-by-one in the index silently pairs a title with the wrong body)`.

## Module-Level Changes

- `AGENTS.md` — delete `### Shell` lines 39–44.
- `.pi/skills/shell-traps/SKILL.md` — rewrite intro line 11, delete line 19, add the bash glob rule.
- `.pi/prompts/plan-improvements.md` — reword line 193's parenthetical.
- `scripts/release/lib.sh` — predicted unchanged (see Non-Goals).

## Test Impact Analysis

The testable surface is the commands the new text prescribes and the absence of zsh guidance.
Dry-run at planning time, to re-run in `/build-plan`:

1. Glob behavior the new rule describes, in a scratch dir holding only `a.ts`: `echo *.ts` prints `a.ts`; `echo *.xyz` prints `*.xyz`; `echo '*.ts'` prints `*.ts`.
2. Absence check, expected to print nothing: `rg -n -i 'zsh|\$status|equals.expansion|no matches found|print -r' AGENTS.md .pi/skills .pi/prompts .pi/agents`.
3. Survivor check, expected to print `scripts/release/lib.sh` lines 24 and 26 only: `rg -n -i zsh scripts/`.
4. `pnpm exec rumdl check AGENTS.md .pi/skills/shell-traps/SKILL.md .pi/prompts/plan-improvements.md` passes.

## Invariants at risk

- The `AGENTS.md` `## Index` row "compose a bash call with a pipeline, loop, …" still routes to `shell-traps`; no edit touches it.
- The deny-rule tripwire line in `### Shell` must survive the deletion; check 2 does not cover it, so read the section after the edit.

## TDD Order

Docs-only; run with `/build-plan`.

1. Edit `AGENTS.md`, `.pi/skills/shell-traps/SKILL.md`, and `.pi/prompts/plan-improvements.md` as above; run checks 1–4.
   Commit: `docs: drop zsh shell guidance now that the bash tool runs bash (#1040)`.

## Risks and Mitigations

- A session in a different environment (another operator, no `shellPath`) could run zsh again.
  Mitigation: none; the guidance tracks this repo's operator, and the deleted text is recoverable from git.
- An em-dash in the new glob rule could arrive split (see `markdown-conventions`); re-read the inserted lines after the edit.

## Open Questions

None.

[#1036]: https://github.com/gotgenes/pi-packages/issues/1036
