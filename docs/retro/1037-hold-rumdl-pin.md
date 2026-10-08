---
issue: 1037
issue_title: "Lift the rumdl pin off 0.2.24 now that the MD013 reflow regressions are fixed upstream"
---

# Retro: #1037 — Lift the rumdl pin off 0.2.24 now that the MD013 reflow regressions are fixed upstream

## Stage: Planning (2026-10-08T03:29:59Z)

### Session summary

Measured `rumdl` 0.2.78 against the whole tree: 593 MD013 findings, 366 of the 574 `fmt` hunks joins, mostly sentences opening with `[#N]` or a lowercase word.
The operator chose to keep the pin at 0.2.24, refresh both pin comments, and file upstream; filed as rvben/rumdl#933 from a minimal repro verified in an empty directory.
The plan is a single config-comment step for `/build-plan`.

### Observations

- Sibling #900 asked the same thing at 0.2.68; `/ship` should close it alongside #1037.
- `require-sentence-capital = false` (fixed upstream in rvben/rumdl#852) was measured and rejected: 12 joins, but about 56 false splits after `etc.`, `..."`, and closing quotes (a heuristic estimate).
- Measurement needed a scratch `git archive` copy with `mise.toml` removed (mise refuses an untrusted config) and `--no-cache` because of #879; the dlx `rumdl` binary was called by path.
- The issue's step 4 holds: `#981 shipped the fix.` gets no MD018 finding under either version.
- The operator asked what `magiclink` does and what rumdl's AI-submission policy is (none stated; a YAML bug-report form exists); the upstream report followed that form and the `github-voice` skill, kept short at the operator's request.

## Stage: Implementation — Build (2026-10-08T03:36:43Z)

### Session summary

Completed the plan's single step: rewrote the `rumdl` pin comments in `pnpm-workspace.yaml` and `prek.toml` to cite the measured 0.2.78 reason and rvben/rumdl#933, leaving the 0.2.24 pin, the lockfile, and `.rumdl.toml` unchanged.
All verify criteria held: the frozen install, `pnpm run lint`, an empty `rumdl#811` grep, and `rumdl 0.2.24`.

### Observations

- No deviations from the plan.
- Amended the unpushed commit once so its body names `rvben/rumdl#816` in full; the bare `#816` would have cross-linked this repo's #816.
- Pre-completion reviewer: WARN.
  Its one finding was n = 1 per measurement condition, which the plan already states and justifies because rumdl is deterministic.
- `/ship` should close #900 alongside #1037.

## Stage: Final Retrospective (2026-10-08T03:44:54Z)

### Session summary

One process ran plan, build, ship, and retro.
The issue's proposed bump turned into a measured decision to keep the pin: 0.2.78 joins sentences that open with `[#N]` or a lowercase word, filed upstream as rvben/rumdl#933.
The shipped change is two config comments (`03e26233`); #1037 and #900 closed, nothing released.

### Observations

#### What went well

- Classifying `rumdl fmt` hunks by line-count delta (more removed lines means a join, more added means a split) on a scratch `git archive` copy turned 593 findings into a decision in about three tool calls.
  It separated the regression class (joins) from the genuine fixes (splits) without reading 369 files.
- Searching the upstream tracker surfaced `require-sentence-capital` (rvben/rumdl#852), and measuring it, rather than offering it as an untested option, showed it trades about 56 false splits for the joins.
- The upstream repro was re-run in an empty directory with a four-line config before filing, so #933 does not depend on this repo's `.rumdl.toml`.

#### What caused friction (agent side)

- `instruction-violation` (user-caught) — the first `ask_user` gate reported the issue's MD018 `magiclink` check without saying what `magiclink` does, and offered to file upstream without saying what the target repo expects of a report.
  The operator answered both questions with questions instead of choosing an option.
  `clarification-gates` already requires defining a gate's terms of art.
  Impact: one extra round trip; no rework.
- `missing-context` — the offer to file upstream did not check rvben/rumdl's issue templates or any policy on AI-written submissions; the operator had to ask.
  Impact: one round trip, then two `gh api` reads that should have come before the gate.
- `other` — the scratch copy carried the repo's `mise.toml`, and mise refused the untrusted config, so the first two `pnpm dlx`/`cd` probes in `/tmp/probe1037` failed until the file was deleted and the dlx binary was called by path.
  Impact: two failed tool calls.
- `other` (self-identified) — the build commit's body wrote a bare `#816` meaning `rvben/rumdl#816`, which would cross-link this repo's #816.
  Impact: one amend before push.

#### What caused friction (user side)

- Nothing material.
  The operator's questions in place of a choice were the right response to an under-briefed gate.

### Diagnostic details

- **Model-performance correlation** — planning and build ran on `claude-opus-5-5` (corpus measurement and the hold/bump judgment), ship on `claude-sonnet-5-5` (mechanical), and the `pre-completion-reviewer` subagent on `claude-sonnet-5-5`, per its transcript.
  All appropriate for their tasks.
  The reviewer piped its gates through `tail` (`pnpm run check 2>&1 | tail -5`), which hides exit status; it read the output text, so no verdict was affected.

#### Unverified lead

- `markdown-conventions` says the `pi-autoformat` pass joins a sentence onto the previous line when it opens with a lowercase token.
  In this session's 0.2.24 repro, `release-please reads ...` after a bold `**...**` line was **not** joined.
  The quirk may depend on the preceding line's shape; not investigated.

### Changes made

1. `.pi/skills/clarification-gates/SKILL.md`: under `## The option space`, an option that files on a third-party tracker now names that tracker's issue template and any AI-submission policy, read before the gate.
