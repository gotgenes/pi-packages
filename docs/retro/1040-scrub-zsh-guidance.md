---
issue: 1040
issue_title: "Scrub zsh guidance now that the bash tool runs bash"
---

# Retro: #1040 — Scrub zsh guidance now that the bash tool runs bash

## Stage: Planning (2026-10-07T15:46:38Z)

### Session summary

I confirmed the `bash` tool runs Homebrew bash 5.3 (`shellPath` in `~/.pi/agent/settings.json`), then re-checked each zsh rule under bash in a scratch directory.
The plan deletes the zsh-only rules from `AGENTS.md`, `shell-traps`, and `plan-improvements.md`, and moves the one surviving rule (unquoted glob substitution) to `shell-traps`.
The change is docs-only and goes to `/build-plan`.

### Observations

- Operator gate: drop the "The `bash` tool runs zsh." line outright rather than replace it with a bash identity line plus a `$SHELL` caveat, because a model assumes bash unaided.
- Operator gate: move the glob rule to the `shell-traps` skill body (admission question 2: generic bash, not an environment fact) rather than keep it in `AGENTS.md`.
- `$SHELL` still reports `/opt/homebrew/bin/zsh` (the login shell), so `scripts/release/lib.sh` lines 24–26 stay as written.
- `docs/agent-docs-audit/2026-09-29/inventory-workflow.md` records the old zsh parenthetical as "keep"; it is historical and left alone.
