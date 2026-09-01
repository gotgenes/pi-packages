---
issue: 866
issue_title: "chore: refresh common dev tooling (pnpm, fallow, rumdl, biome, eslint, vitest, rollup)"
---

# Retro: #866 — chore: refresh common dev tooling (pnpm, fallow, rumdl, biome, eslint, vitest, rollup)

## Stage: Final Retrospective (2026-09-01T22:29:14Z)

### Session summary

Upgraded the shared dev toolchain in four grouped `chore:` commits — pnpm 11.5.2 to 11.25.0, biome/eslint/typescript-eslint/globals, vitest/rollup/rollup-plugin-dts, and fallow 3.2.0 to 3.22.0 — after an unplanned scope negotiation that ran the whole issue without `/plan-issue`.
Three of the four upgrades surfaced findings that had to be resolved in the same commit to keep the tree gated-clean, and the rumdl bump turned out to be a destructive regression that was pinned at 0.2.24 rather than taken.
Filed [#867] for the TypeScript 7 blocker and commented our corpus numbers on the upstream rumdl report.

### Observations

#### What went well

- **Reading the TypeScript 7 tarball beat reasoning about it.**
  The question "can we take TS 7" was settled by fetching `dist.tarball` and listing `package/lib/`, which contains only `version.cjs`, `getExePath.js`, and `tsc.js` — no `lib/typescript.js`.
  That turned a hedged "probably blocked by typescript-eslint's peer range" into a demonstrated hard blocker: `@typescript-eslint/typescript-estree` calls `require("typescript")` in 18 places for an API that no longer ships.
  This is `AGENTS.md`'s "run the tool when the answer gates a boundary" applied to a dependency decision rather than a security boundary, and it produced an issue body that will not need re-litigating.

- **Bisecting rumdl over released binaries produced a pin the upstream report could not give.**
  Fifteen `pnpm dlx rumdl@<version>` probes narrowed two distinct regressions and established 0.2.24 as the newest version clean on all 1086 files.
  The upstream issue independently reports the same 0.2.44/0.2.45 boundary for its own corpus, but 0.2.44 still produces 7 findings here — so the bisect was what justified 0.2.24 over the "last good" version a reader would infer from the report.

- **Catching `biome migrate` corrupting the root config.**
  The migration wrote `"root": false` into the top-level `biome.json`, which would have sent Biome looking for a parent config above the repo.
  Rejecting one hunk of a tool's own automated migration is the kind of thing that passes review silently.

#### What caused friction (agent side)

- `missing-context` — did not check rumdl's issue tracker before bisecting.
  The operator asked "Have you already searched rumdl's issues to see if complaints have been filed for these regressions?"
  and the answer was no. One `gh issue list --repo rvben/rumdl --search` found [rvben/rumdl#811](https://github.com/rvben/rumdl/issues/811), open since 2026-08-12, carrying the same mechanism (a bold lead-in ending `.**` followed by a line opening with a code span) and the same 0.2.44/0.2.45 bisect boundary I had just spent fifteen probes deriving.
  User-caught.
  Impact: the bisect was still needed to pick 0.2.24 for our corpus, but knowing the mechanism first would have made it a targeted confirmation instead of a from-scratch hunt, and would have removed the standing doubt about whether the fault was in our `.rumdl.toml`.

- `missing-context` — proposed a `@types/node` 22 to 26 bump with the disproving evidence already in context.
  The first two tool calls of the session read `engines.node: ">=22"` from `package.json` and `node-version: 22` from `ci.yml`.
  The bump was still surfaced as a Tier 2 candidate, and the operator had to ask whether pi pins Node 22.
  It does: `@earendil-works/pi-coding-agent` 0.84.4 declares `>=22.19.0` and dev-depends on `@types/node` 22.19.19, having moved *down* from 24.12.4 in 0.79.1.
  User-caught.
  Impact: one clarification round; no rework, because the bump was dropped before any install.

- `other` (debugging strategy) — synthesized a minimal reproduction from a hypothesis three times before reducing from the real failing file.
  Attempt one was invalid for an unrelated reason (a `/tmp` scratch file does not pick up the repo's `.rumdl.toml`, so MD013 fell back to line-length 80), which was diagnosed correctly.
  Attempts two and three were valid tests of the wrong hypothesis and reproduced nothing.
  Switching to "take the real failing file, cut it down" hit the trigger on the first try and isolated it to a single line two calls later.
  Impact: roughly six tool calls spent guessing at a trigger that reduction found immediately.

- `instruction-violation` — bundled a three-question clarification gate in which one question carried no substance.
  `AGENTS.md` § Clarification gates requires presenting concrete examples in a message before the `ask_user` call.
  The rumdl and SVG questions each got a worked example; the `void` operator question got a prose description of the rule and the tsconfig reasoning, but never showed the flagged code.
  The operator answered two and bounced the third with "Sorry, I don't understand this and need more information.
  Provide more context, including the code getting flagged."
  User-caught.
  Impact: one extra gate round-trip.
  The generalization is that in a bundled gate the least-supported question gates the whole batch, so per-question substance is what matters, not per-message.

- `other` (destructive git near-miss) — `git reset --soft HEAD~1` after a hook-rejected commit clobbered the previous commit.
  A probe commit written to verify the new `rumdl-fmt` prek rev was correctly rejected by the hook, so `HEAD` never moved.
  The cleanup `git reset --soft HEAD~1` therefore undid the *fallow* commit `de6dec60` instead of the probe.
  Self-identified from `git status --short` showing the fallow commit's five files staged again.
  Impact: three tool calls to repair; the commit was restored byte-identically, confirmed with an empty `git diff de6dec60 HEAD`.
  `AGENTS.md` line 473 covers confirming `HEAD` before `git commit --amend`, but frames the hazard as a concurrent session — not as a local commit that never happened.

- `scope-drift` (minor) — proposed excluding all `*.svg` from Biome when the finding was two vendored logo files.
  The operator narrowed it with "Or just these SVG files."
  Impact: none beyond the correction; the committed exclusion names both paths explicitly and dropped the checked-file count from 648 to 646, which confirmed the scope.

#### What caused friction (user side)

- Both of the session's highest-value interventions arrived as redirecting questions rather than corrections — "are we not pinned to Node v22?"
  and "have you already searched rumdl's issues?"
  — and both were right.
  That is the cheap shape, but it also means two pieces of durable project knowledge lived only in the operator's head: that this repo's Node floor is set by pi's `engines.node`, and that a third-party tool regression is worth checking upstream before investigating.
  Both are candidates for `AGENTS.md` so the next session does not need the operator present to get them right.

- The session ran without `/plan-issue`, so no plan existed for `/ship-issue` to read.
  That was reasonable for a dependency refresh, but it meant the release decision, the scope tiers, and the acceptance criteria were negotiated interactively mid-flight instead of being settled once.
  Four of the five `ask_user` calls were scope negotiation that a planning stage would have absorbed.

### Diagnostic details

- **Model-performance correlation** — one continuous session on `anthropic/claude-opus-5` (sampled at the retro-stage turns via `read_session`; the mid-session client disconnect did not start a new session file).
  Zero subagent dispatches, which was the right call rather than a gap: the `Subagent.release` reachability question was three in-repo greps, and the rumdl bisect was stateful and sequential, so a subagent would have had to re-derive the `.rumdl.toml` scoping that made the probes meaningful.

- **Escalation-delay tracking** — the synthetic-reproduction rabbit hole ran three write-then-check cycles, each under the five-call threshold individually, but repeating the same strategy after it had already failed twice.
  The trigger to switch was available from the start: a real failing file existed, so reduction was possible without any hypothesis.

- **Unused-tool detection** — `gh issue list --repo rvben/rumdl --search` was available throughout and cost a single call when finally used.
  It was not reached for until the operator asked, after the bisect was complete.

- **Feedback-loop gap analysis** — no gap.
  `pnpm run check`, `pnpm run lint`, and `pnpm -r run test` ran after each of the four commit groups rather than once at the end, which is what surfaced the Biome 2.5 formatter churn immediately after the Biome bump instead of at push time.
  `grep -c 'lint/'` was used on each lint log to catch warning-level findings that exit 0.

### Changes made

1. `AGENTS.md` § Commits — added one line after the existing `git reset --soft HEAD~N` guidance, covering the case where a pre-commit hook rejected the commit so `HEAD` never moved.
   The neighbouring `git commit --amend` rule already required confirming `HEAD`, but attributed the risk to a concurrent session rather than a local commit that never happened.
2. `AGENTS.md` § Clarification gates — added one line making the substance requirement per question rather than per message, since the least-supported question in a bundled gate bounces the whole batch.
3. `docs/retro/0866-refresh-common-dev-tooling.md` — this file.

Two further proposals were declined by the operator and are recorded here rather than landed: searching a dependency's upstream tracker before reducing a regression, and a note that `@types/node` tracks pi's own pin rather than npm `latest`.
No `AGENTS.md` rule was found stale or contradicted this session, so nothing was removed alongside the two additions.

[#867]: https://github.com/gotgenes/pi-packages/issues/867
