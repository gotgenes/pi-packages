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
