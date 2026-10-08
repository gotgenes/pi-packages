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
