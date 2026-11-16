---
issue: 1090
issue_title: "upgrade zod dependency - versions below 4.6.6 are affected by CVE-2023-54404"
---

# Retro: #1090 — upgrade zod dependency - versions below 4.6.6 are affected by CVE-2023-54404

## Stage: Planning (2026-10-28T03:28:52Z)

### Session summary

I planned the change for a third-party report asking for zod 4.6.6 or later.
The plan is cross-package: it raises `zod` to `^4.6.7` in `pi-permission-system` and `pi-permission-model-judge`, and bounds all six config arrays at 1,000 entries with `.max()`.
I also filed [#1092] for `pi-permission-model-judge` reading an untrusted project's config.

### Observations

- **Reading zod's source changed the direction.**
  The compiled zod 4.6.7 `$ZodArray` showed the upstream fix only pre-checks `.max()` / `.length()` / `.size()`.
  An unbounded array still records one issue per element, so the reporter's "may not be completely fixed" comment was right.
  On the operator's direction ("propose a bound for the array"), the plan bounds every array, not just the floor.
- **Exposure.**
  `pi-permission-system` parses only operator-owned configs (the project scope is trust-gated).
  `pi-permission-model-judge` parses an untrusted project's config, which is the one attacker-controlled zod input; that trust gap is [#1092].
- **Operator decisions.**
  - All six arrays, one shared cap of 1,000.
  - Breaking (`fix(<pkg>)!:`), chosen over non-breaking hardening.
  - Floor at the latest published version, `^4.6.7`, not `^4.6.6`.
  - File [#1092].
- **Measured with the published tarballs:**
  - 1,001 invalid entries gives 1,002 issues on 4.4.3 and 1 on 4.6.7 with `.max(1000)`.
  - 1,000,000 invalid entries on an unbounded array gives 1,000,000 issues in 672 ms.
  - The spike worktree passed every package's tests on 4.6.7, and both `gen:schema` outputs were unchanged.
- **The Tidy-First assessor caught a vacuous assertion.**
  At a union site (`declaredEffectsSchema`) the top-level issue count is 1 under every zod version.
  The plan's tests flatten `invalid_union` `errors` and assert exactly one `too_big` leaf and no element-indexed leaf (measured: 1,003 leaves on 4.4.3, 2 on 4.6.7).
- **Rejected options.**
  - `pnpm dedupe`: it churned 689 lockfile lines in the spike.
  - Capping `z.record` maps: zod 4.6.7 has no pre-walk cap for records (`capSize` covers only array, map, and set), and every record is read from trusted input only.
  - A shared `boundedArray` helper.
- Roadmap-fit: neither package has an open improvement phase, so [#1092] got no disposition.

## Stage: Implementation — TDD (2026-10-28T03:43:17Z)

### Session summary

I ran all four TDD steps, each as its own commit: two `fix(<pkg>)` zod 4.6.7 bumps (each crediting the reporter with a `Co-authored-by` trailer), then the two `fix(<pkg>)!:` array bounds.
Tests went from 6413 to 6428 in `pi-permission-system` and from 69 to 72 in `pi-permission-model-judge`.
The pre-completion reviewer returned PASS.

### Observations

- **Lockfile path.**
  Step 1's `pnpm install` left intermediate peer-variant entries, so Step 2's lockfile diff alone showed 467 changed lines.
  The net diff from the plan commit was exactly the spike's 110 lines of zod-only swaps, with zero `zod@4.4.3` entries.
  Judge a multi-step lockfile change by its net diff, not the per-commit stat.
- **Union-path deviation.**
  zod reports an `invalid_union` arm's issues with paths relative to the union, not absolute (`[]`, not `["t", "effects"]`).
  The `leafIssues` test helper now prefixes each union's own path while it recurses.
  The plan's assertion design held; only the helper's path handling changed.
- **Mutations:** every one killed exactly the predicted tests, plus the schema-parity pin.
  - Dropping `authorizerChain`'s `.max` killed 1 row; dropping `piInfrastructureReadPaths`' killed its row and the loader test.
  - Dropping `declaredEffectsSchema`'s `.max` killed all 3 effects rows.
  - Cap 999 killed all 7 acceptance rows.
  - Pinning zod 4.4.3 killed all 7 rejection rows and the loader test, while the acceptance rows stayed green.
  - In model-judge, both mutations killed the predicted tests.
- **Doc deviation:** the plan predicted `architecture.md` unchanged, but its `config-schema.ts` module-tree entry got a constraint sentence on the array bound; the reviewer judged it sound.
- I first inserted the `pi-permission-system` `commandEffects` cap sentence between two table rows; I moved it below the table before committing.
- Pre-completion reviewer: PASS.
  It re-derived six `z.array` sites, all bounded, and found one zod resolution (4.6.7) in the lockfile.

## Stage: Final Retrospective (2026-10-28T03:53:13Z)

### Session summary

One process ran all four stages: planning and TDD on `claude-opus-5-5`, ship on `claude-sonnet-5-5`, and this retro on `claude-opus-5-5`.
It shipped `pi-permission-system` 42.0.0 and `pi-permission-model-judge` 4.0.0, which raise zod to `^4.6.7` and cap every config array at 1,000 entries.
It also filed [#1092] for the judge reading an untrusted project's config.

### Observations

#### What went well

- **Reading the dependency's compiled source reshaped the fix.**
  The reporter only hedged that 4.6.6 "may not be completely fixed".
  Reading `capSize` in zod 4.6.7's `v4/core/schemas.js` confirmed it: unbounded arrays still walk every element, and records are not capped at all.
  That turned a version bump into a bound on every array.
- **A test that pins the dependency floor.**
  The rejection rows assert one `too_big` issue and no per-element issue, which only zod 4.6.6 and later produce.
  Pinning the lockfile back to `zod@4.4.3` as a killing mutation turned all seven rows and the loader test red while the acceptance rows stayed green.
  A dependency floor became a tested claim rather than a manifest line.
- **The Tidy-First assessor's value was a test-design catch, not a tidying.**
  It recommended no preparatory commit, but it probed zod and found that at a union site the top-level issue count is 1 under every version, so the planned assertion would have passed on 4.4.3.
  The plan switched to flattened leaf issues before any test was written.

#### What caused friction (agent side)

- `instruction-violation` (tool-caught): the first `ask_user` gate went out with no visible briefing; the substance existed only in reasoning, and the tool rejected the call.
  The operator then asked exactly what the briefing would have answered (are we exposed, and is the CVE really fixed upstream?).
  Impact: one rejected gate and one question round, no rework.
  The `clarification-gates` "Substance first" rule already covers this, and the tool now enforces it.
- `premature-convergence`: in that first option set I marked "raise the floor in both packages" as recommended, even though my own source read showed the floor alone does not bound the memory our unbounded arrays can force.
  The option that met the goal (floor plus `.max()`) carried a "behavior change" price and no recommendation.
  The operator redirected ("propose a bound for the array").
  Impact: one extra gate round; the plan was written once, after the redirect.
- `missing-context`: the planning probe measured leaf-issue counts at union sites, but not leaf paths. zod reports an `invalid_union` arm's issues relative to the union, so Step 3's path assertion failed until `leafIssues` prefixed the union's own path.
  Impact: one extra edit and test run during Green.
  The probe validated a different value than the one the test asserts.
- `other`: I anchored a docs insertion on a table row, which put a paragraph inside the `commandEffects` field table.
  I also guessed a heading anchor (`#configuration-files`).
  I caught both by grepping before lint.
  Impact: two extra edits.

#### What caused friction (user side)

- None that cost rework.
  The operator's question about exposure and the upstream fix's completeness, and the direction to "propose a bound", were the decisive strategic inputs.
  Both arrived because the first gate under-briefed, not because context was withheld.

### Diagnostic details

- **Model-performance correlation:** planning and TDD ran on `claude-opus-5-5`; ship, which was mechanical (gates, CI watch, release dispatch), ran on `claude-sonnet-5-5`.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `claude-sonnet-5-5`, per their transcripts.
  The assessor's union-assertion finding shows a sonnet assessor producing high-value judgment; no mismatch.
- **Feedback-loop gap analysis:** every TDD step ran its own test files, then the package suite, `check`, and `lint`, before its commit; no gap.

### Changes made

1. `.pi/skills/clarification-gates/SKILL.md`: under `## The option space`, added the mirror of the `recommended`-option rule.
   Recommending a cheap option the evidence shows misses the goal now requires naming why the residual is acceptable.

[#1092]: https://github.com/gotgenes/pi-packages/issues/1092
