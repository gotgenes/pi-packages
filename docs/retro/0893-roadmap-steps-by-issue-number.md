---
issue: 893
issue_title: "Improvement roadmap: identify steps by issue number, order sections by working sequence"
---

# Retro: #893 — Improvement roadmap: identify steps by issue number, order sections by working sequence

## Stage: Planning (2026-09-07T19:40:44Z)

### Session summary

Planned the roadmap-format change that replaces step ordinals with GitHub issue numbers and makes section order the working sequence.
The plan lands in `docs/plans/0893-roadmap-steps-by-issue-number.md` as six `docs:` commits across eight `.pi/` files — three more than the issue listed.
Filed [#900] for a `rumdl` pin re-evaluation the operator asked about mid-gate, keeping it out of this change.

### Observations

The issue's touchpoint list was three files short.
`.pi/prompts/tdd-plan.md` L150 and `.pi/prompts/build-plan.md` L115 both hardcode `grep -c '✅.*Step <N>'` as a hard gate, which returns 0 against a new-format heading — the first new-format step to land would have failed its own completion verification.
`.pi/prompts/retro.md` L218 carries stale "numbered step" vocabulary.
The operator scoped the change to all eight; `.pi/skills/package-pi-permission-system/SKILL.md` L21 stays as a recorded residual.

The sharpest finding is that only `/finish-phase` needs genuine dual-shape detection.
Re-keying the `✅` gate on the issue number instead of the ordinal is shape-agnostic: `grep -cE '✅.*#878\b'` returns 2 against both the live ordinal roadmap and a new-format sample, because the heading already carries `([#878])` and the Mermaid node already carries `(#878)`.
That turned a predicted compatibility burden into a simplification.

Everything asserted about the format was measured rather than argued: `rumdl check` and `fmt` byte-identity under the pinned 0.2.24 **and** under 0.2.68, `mmdc` on the `S<issue>` node form, the dual regex at 19 / 7 / 2 against the two live roadmaps and a sample with zero false positives, and the falsification that both current commands return 0 under the new shape.
The `rumdl` sample check needed `--config .rumdl.toml` — the tool does not discover repo config for a file outside the repository, so an uninstrumented run reports spurious MD013 line-length findings against the default 80-character limit and reads as a format failure.

The scripted-edit hazard is the main implementation risk.
`plan-improvements.md`, `finish-phase.md`, and `retro.md` each number their **own** workflow steps (`### Step 1`–`### Step 8`, `## Step 1`–`## Step 6`, `## Step 1`–`## Step 10`), so a `Step N` sweep would destroy them.
Every Build Order step's verify includes a heading-count assertion for exactly that reason.

On the operator's `rumdl` question: rvben/rumdl#840 is closed but is **not** what holds our pin — `pnpm-workspace.yaml` names rvben/rumdl#811, also closed.
Measured 0.2.68 anyway: 481 MD013 findings across 305/1132 files versus 0 at 0.2.24, mixing genuine violations with a still-live false join where a sentence opening with a reference link is spliced onto the previous line.
That shape is common in this repo's long-lived docs, so the bump needs its own triage — filed as [#900].
The `roadmap-fit` skill exited at its first step: [#900] is `scope:repo` with no `pkg:*` label and no resolvable package, so there is no open phase to disposition it against.

The Tidy-First assessment was skipped per the `tidy-first` skill's applicability gate — this change touches no `src/` or `test/` files.

[#900]: https://github.com/gotgenes/pi-packages/issues/900
