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

## Stage: Implementation — Build (2026-10-07T15:52:38Z)

### Session summary

I completed the plan's single step in a1bd95cc.
It deletes the zsh lines from `AGENTS.md` `### Shell`, drops the zsh pointer and the zsh `echo` trap from `shell-traps`, adds the bash glob rule there, and rewords the `plan-improvements.md` line 193 parenthetical.

### Observations

- No deviations from the plan.
- Verification checks 1–4 gave the predicted output: the absence grep is empty, and only `scripts/release/lib.sh` lines 24 and 26 still mention zsh.
- Pre-completion reviewer: PASS.

## Stage: Final Retrospective (2026-10-07T16:00:06Z)

### Session summary

Planning, build, ship, and retro all ran in one trunk session.
I removed the zsh-only guidance from `AGENTS.md`, `shell-traps`, and `plan-improvements.md` in a1bd95cc, moved the one rule that still holds under bash into `shell-traps`, and closed #1040 with no package release.

### Observations

#### What went well

- Each rule was re-checked in a scratch directory under the real `bash` tool, so every keep/delete call rested on that rule's printed output, not on what bash is supposed to do.
  The table those commands produced became the build step's checks and the reviewer's evidence, with nothing re-derived.
- The admission test settled both operator gates in a single `ask_user` round: drop the identity line (question 1) and move the glob rule to the skill (question 2).

#### What caused friction (agent side)

- `other` — `ci_find` found the run for a57a5ad3, then failed on its jobs fetch with `HTTP 404` (`gh run view 37647919187 --json jobs`).
  The run had only just been created.
  The cause is in `packages/pi-github-tools/src/lib/ci.ts`: the jobs fetch goes through `ghJsonRetrying`, and `isTransientError` does not treat this 404 as transient, so the error is thrown instead of retried.
  Impact: one fallback `ci_list` call before `ci_watch`, and no rework.

#### What caused friction (user side)

- None; the operator answered both gates the first time.

### Diagnostic details

- **Model-performance correlation** — the `pre-completion-reviewer` ran on `anthropic/claude-sonnet-5-5` (taken from its transcript) and finished in three turns.
  For a mechanical docs-only review that is a good fit.

### Changes made

1. Filed [#1041] (`pi-github-tools`) so `ci_find` keeps polling when the jobs fetch for a run it just listed returns 404.
   `roadmap-fit` exited at step 1 because `pi-github-tools` has no architecture doc and so no open phase.

[#1041]: https://github.com/gotgenes/pi-packages/issues/1041
