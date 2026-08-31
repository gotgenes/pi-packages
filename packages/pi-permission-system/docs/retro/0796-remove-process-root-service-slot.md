---
issue: 796
issue_title: "pi-permission-system: schedule the process-root service slot's removal now that its last downstream has migrated"
---

# Retro: #796 — Remove the process-root service slot

## Stage: Planning (2026-08-30T21:32:00Z)

### Session summary

Planned Phase 14 Step 6, which the roadmap scoped as a decision (an ADR 0012 amendment) with "whether code changes in this step is the step's own decision".
The clarification gate settled all three of the step's named questions in one direction: remove the process-root slot outright in a dedicated major, hard delete rather than a warning tombstone, and dissolve the [#302] child guard along with the write it protected.
The plan is five steps — two Tidy-First preparatory test-retargeting commits, the ADR amendment, the breaking removal, and the doc sweep — filed at `docs/plans/0796-remove-process-root-service-slot.md`.

### Observations

- **The decisive fact was a release-timeline one, not a code one.**
  `getRootPermissionsService` did not exist before `v27.0.0` (2026-08-21, nine days before planning); the pre-27 spelling was the zero-arg `getPermissionsService()`, which 27.0.0 already broke.
  So the deprecation window can only shelter a population created *after* the deprecation was announced — consumers who did migration work in the last nine days and deliberately chose a symbol marked `@deprecated` over the keyed locator the same migration guide recommends.
  That reframing came from reading `git tag` dates against the ADR's amendment history, not from the issue body, and it is what made "remove now" the recommended option rather than a defensible-but-aggressive one.

- **The issue's three questions are not independent.**
  The issue and the roadmap both present them as three decisions (remove the reader / stop the write / what about the guard).
  Reading the code showed they collapse: removing the reader leaves nothing that reads the slot, removing the write leaves the guard with nothing to guard, and `service-lifecycle.ts:78` is the sole production consumer of `SubagentDetection.isRegisteredChild`.
  The gate was structured to say so rather than to ask three questions whose last two have only one coherent answer.

- **A warning tombstone was offered and declined.**
  [#794] set the precedent of a runtime guard (`WARN0001`) for a caller the types cannot reach, so an always-`undefined` export with an upgraded warning was a real option.
  Rejected because it is a silent behavior change for exactly the population the window protects, and it needs its own removal later.
  The surviving `WARN0001` already names the replacement, so a `TypeError` is not an unguided failure.

- **The Tidy-First assessor corrected the design in two places.**
  It found a fourth root-slot call site in `test/service.test.ts` that the issue's enumeration missed — the `returns undefined rather than another node's service` case publishes to the root slot only to build its scenario, so a "delete suites with `Root` in the name" sweep would have removed a surviving-behavior test by accident.
  Its consolidation recommendation for `test/composition-root.test.ts` was declined after reading the block it was premised on: `shutdown teardown chain` is retargetable, not root-only, so the "two genuinely-root-only blocks" it wanted made adjacent turned out to be one block plus three redundant lines, and there is nothing to consolidate.

- **Verification instrument chosen over a test.**
  The obvious pin for "the slot is never written again" is a test reading the raw symbol after `session_start`, but deleting the publish function makes any surviving caller a compile error, which is strictly stronger.
  The plan says so explicitly and lists the type checker as step 4's killing-mutation instrument for the removal-completeness class, so an implementing session does not add a tombstone test to fill the perceived gap.

- **Baselines measured, not inferred:** ADR 0012 `#### Amendment` count is 2 (roadmap target ≥ 3), `pnpm fallow dead-code` reports 0 issues, and `RootPermissionsService` appears 14 times across 2 `src/` files.

#### Deferred tidyings

None recorded as scope creep.
The assessor declined three candidates — restructuring `service-lifecycle.test.ts`'s mock harness, reworking the `SubagentDetector`/`RegisteredChildDetector` dual-interface shape, and tidying `src/index.ts` — on the grounds that each *is* the change rather than a preparation for it, which is a correct reading, not a deferral.

## Stage: Implementation — TDD (2026-08-30T21:48:34Z)

### Session summary

Executed all five plan steps in order: two Tidy-First test-retargeting commits, the ADR 0012 amendment, the breaking removal, and the doc sweep.
The process-root slot, its reader, both writers, the `DEP0001` warning, and the [#302] child guard are gone; `PermissionServiceLifecycle` lost its detection dependency and `SubagentDetection` now implements one interface.
Test count went 3805 → 3785 (−20: ten deleted in `service.test.ts`, one describe block in `composition-root.test.ts`, six in `service-lifecycle.test.ts`, three in `subagent-detection.test.ts`), with every deterministic gate green and `fallow dead-code` still at zero.

### Observations

- **No deviations from the plan.**
  Every file in Module-Level Changes was touched and nothing outside it was, the predicted metrics all landed (`#### Amendment` 2 → 3, `RootPermissionsService` in `src/` 14 → 0, dead-code 0 → 0), and no follow-up issues were needed.

- **The Tidy-First split paid off exactly where the assessor predicted.**
  After the two retargeting commits, the removal commit's test diff was pure deletion — no site where a reviewer has to decide whether a rewrite preserved the assertion's meaning.
  The constant-key killing mutation (`publishPermissionsService` storing under a fixed key) was the right instrument for both: it turned red exactly the 7 and 11 retargeted tests predicted, and a site still reading the root slot would have stayed green.

- **Two mutations left a named pin green, and both were informative rather than failures.**
  `returns undefined rather than another node's service` survived the constant-key mutation because its claim is about the missing-argument guard, not the key — killed instead by making the zero-arg call fall back to the map's first entry.
  `removes only its own keyed entry when a node shuts down` survived for the same structural reason — killed by making `unpublishPermissionsService` clear the whole map.
  Neither is vacuous; the first mutation simply did not address their equivalence class.

- **The type checker replaced a test, deliberately.**
  The plan declined a runtime pin asserting the symbol slot stays empty, on the grounds that deleting the publish function makes any surviving caller a compile error.
  Verified by mutation: re-adding `publishRootPermissionsService(this.service)` to `activate()` fails `tsc` with `TS2552`.
  A third mutation — restoring the removed import in `scripts/verify-public-types.sh`'s consumer probe — confirmed the packaged-declaration gate catches a resurrection at the published surface (`TS2724`).

- **Two test cases turned out to be worth keeping rather than deleting**, both discovered by opening the blocks rather than trusting the plan's file-level classification.
  `does not warn for the session-keyed accessors` sat inside the `process-root accessor deprecation` describe but asserts a surviving invariant, so the describe was renamed around it instead of deleted.
  `shutdown teardown chain` in `composition-root.test.ts` was retargetable, not root-only — which is why the assessor's consolidation recommendation (its item 3) was correctly declined at planning time; there was only ever one block to excise, not two.

- **Decorative comment rules broke an `Edit` batch, as AGENTS.md warns.**
  Two `// ── section ───` lines in `test/service.test.ts` have different dash counts (78 and 74), so an `oldText` spanning one was rejected and took the whole atomic batch with it.
  Deleting the range by line number with `sed` and reconstructing the rule programmatically was faster than retyping it.

- **Pre-completion reviewer: PASS.**
  It re-derived [#302]'s failure modes from the issue body rather than accepting the claim that keyed publication carries the invariant, diffed the deleted `multi-instance global service interplay` block against the surviving `session-keyed service publication` block, and confirmed the retargeted teardown cases needed the added `activate()` call (the new `teardown()` unpublishes only when `publishedSessionId !== null`, where the old root unpublish was unconditional).
  No warnings.

## Stage: Sync (worktree) (2026-08-30T21:50:11Z)

### Session summary

Pre-push checks (`pnpm run lint`, `pnpm fallow dead-code`) both passed clean with no fixes needed.
The plan's `**Release:** ship independently` marker applies — nothing to defer, no follow-ups filed during implementation.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-796--/2026-08-30T21-05-09-070Z_01a0547d-8bce-7272-9b07-41726bb1acbb.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

Clean sync; rebasing onto `origin/main` next.

## Stage: Final Retrospective (2026-08-31T00:37:30Z)

### Session summary

Shipped #796 end to end across four sessions — planning, TDD implementation, worktree sync (peer), and the root land — removing the process-root service slot, its reader, both writers, the `DEP0001` warning, and the [#302] child guard in one breaking major.
`pi-permission-system-v29.0.0` released cleanly; the root ship ran 27 tool calls with zero rework and no deviations from the plan at any stage.

### Observations

#### What went well

- **The decisive fact was found by dating the tags, not by reading the issue.**
  Planning established that `getRootPermissionsService` did not exist before `v27.0.0` (nine days before planning) and that 27.0.0 had already broken the pre-27 zero-arg spelling — so the deprecation window could only shelter consumers created *after* the deprecation was announced.
  That reframing is what turned "remove now" from a defensible-but-aggressive call into the recommended one, and it came from `git tag` dates read against the ADR's amendment history.
  Worth generalizing: for any deprecation-window question, the window's *age* relative to the symbol's introduction is a cheap measurement that often settles it outright.

- **The type checker was chosen over a test, and then that choice was itself verified.**
  The plan declined a runtime pin asserting the symbol slot stays empty, on the grounds that deleting the publish function makes any surviving caller a compile error.
  Implementation did not leave that as an argument — it mutated the code back and confirmed `TS2552`, then restored the removed import in `scripts/verify-public-types.sh`'s consumer probe and confirmed `TS2724` at the packaged-declaration surface.
  A claim that an instrument is stronger than a test is exactly the kind of claim that normally ships unverified.

- **The Tidy-First assessor paid for itself in both directions.**
  It found a fourth root-slot call site in `test/service.test.ts` that the issue's enumeration missed — a case that publishes to the root slot only to build its scenario, which a "delete suites with `Root` in the name" sweep would have removed by accident.
  Its one *declined* recommendation (consolidating `test/composition-root.test.ts`) was then confirmed correct at implementation time: `shutdown teardown chain` turned out retargetable, so there was one block to excise rather than the two the recommendation presumed.
  A rejected suggestion that later validates the rejection is a useful signal that the planning triage was reading the real code.

- **Two killing mutations left a named pin green, and both were diagnosed rather than papered over.**
  `returns undefined rather than another node's service` and `removes only its own keyed entry when a node shuts down` both survived the constant-key mutation because their claims sit in a different equivalence class.
  Each was killed by a second, targeted mutation instead of being rewritten to satisfy the first — the plan's per-class mutation guidance working as intended.

- **Model assignment matched task weight without anyone tuning it.**
  Judgment-heavy stages (planning's clarification gate, the ADR amendment, breaking-change classification, TDD) ran on `claude-opus-5`; mechanical stages (sync checks and rebase, the root ff-merge/CI/release/teardown) ran on `claude-sonnet-5`.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — the decorative comment-rule hazard in `AGENTS.md` § Edit tool batches bit twice inside TDD Step 4.
  Two `// ── section ───` lines in `test/service.test.ts` carry different dash counts (78 and 74); an `Edit` batch spanning one was rejected, and a second `Edit` was rejected again even after a fresh `Read` of the region.
  The rule as written covers *deleting* a padded rule line ("copy it from a fresh `Read`"), but this step needed to **rewrite** one — a new section label with recomputed padding — where copying has nothing to copy.
  Resolved by deleting the range with `sed` by line number and writing the replacement line programmatically (`'─' * (78 - len(label))`).
  Impact: roughly eight extra tool calls (dash-width probing with `cat -A`, two rejected `Edit` batches, two `python3` reconstructions); no rework to committed content and no effect on the final diff.

- `instruction-violation` (not noticed in-session) — `cd` prefixes into the working directory and into package subdirectories, against both the system prompt's working-directory rule and `AGENTS.md`'s `pnpm --filter` guidance.
  Most were `cd packages/pi-permission-system && pnpm exec vitest …`; one (TDD turn 147) was a `cd` into the worktree root itself, the literal case the rule names.
  Impact: none — every command succeeded.
  Noise only, and the rule already exists in two places, so this is a salience miss rather than a missing rule.

- `other` — a mistyped absolute path in this retro session's first `Edit` (`/Users/chris/development/pi/pi-permission-system/…`, dropping the `pi-packages/packages/` segment) tripped the `external_directory` gate.
  Impact: one denied call; the gate's message named the correct path, so recovery was immediate.
  This is the failure mode `AGENTS.md` predicts for hand-built absolute paths, and the argument for repo-relative paths held up exactly as written.

#### What caused friction (user side)

- A mid-session disconnect cancelled `ci_watch` at 165 s; the follow-up prompt was enough to resume against the same run ID with no lost state.
  No change suggested — the run-ID handoff made this recoverable by construction.

- Involvement across all four sessions was a single clarification gate at planning (the three ADR 0012 questions) plus the disconnect.
  That is the intended shape: the one intervention was strategic (which removal posture), and nothing else needed mechanical oversight.

### Diagnostic details

- **Model-performance correlation** — planning and TDD on `anthropic/claude-opus-5` (clarification gate, ADR amendment, mutation design); sync and root ship on `anthropic/claude-sonnet-5` (lint, rebase, ff-merge, CI watch, release merge, teardown); this retrospective on `claude-opus-5`.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on their pinned `anthropic/claude-sonnet-5`.
  No mismatch found in either direction — no reasoning-weak model on judgment work, no premium model on mechanical work.

- **Escalation-delay tracking** — no `rabbit-hole` friction points.
  The decorative-rule sequence is the only run of consecutive calls on one error (≈8, spanning two rejected `Edit` batches).
  It does not meet the "dispatch a subagent" bar — the blocker was a tool-mechanics detail, not a comprehension gap — but the strategy switch (from `Edit` to programmatic write) came two calls later than the first rejection warranted.

- **Feedback-loop gap analysis** — no gap.
  `pnpm run check`, `lint`, `test`, and `fallow dead-code` all ran at baseline before any edit; each TDD step ran its own file-scoped `vitest`; `pnpm run check` ran mid-step-4 on the signature change; all four gates ran again before the docs commit and once more at cycle end.
  Verification was incremental throughout rather than deferred to the end.

- **Unused-tool detection** — nothing notable.
  No friction point traced to missing context that `colgrep`, an `Explore` dispatch, or `web_search` would have supplied; planning's exploration was inline and sufficient.

### Changes made

1. `AGENTS.md` § Edit tool batches — added a sentence covering the **rewrite** case for a decorative comment rule, extending the existing deletion-only guidance: when the rule line's label changes, the padding must be recomputed, so `Edit` has nothing to copy and the line is written programmatically.

Declined during this retro: a rule about `cd` prefixes (already stated in both the system prompt and `AGENTS.md` — a salience miss, not a rule gap), and a deprecation-window dating rule extending the shipped-export check (a genuine insight from planning, but supported by a single data point).

[#302]: https://github.com/gotgenes/pi-packages/issues/302
[#794]: https://github.com/gotgenes/pi-packages/issues/794
