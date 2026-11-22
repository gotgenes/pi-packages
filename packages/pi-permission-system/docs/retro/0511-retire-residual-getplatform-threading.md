---
issue: 511
issue_title: "pi-permission-system: retire the residual getPlatform() threading (infra-read + skill-prompt sanitization)"
---

# Retro: #511 — Retire the residual `getPlatform()` threading (infra-read + skill-prompt sanitization)

## Stage: Planning (2026-06-28T23:10:40Z)

### Session summary

Produced a numbered plan to route the two residual `platform`-threading sites (external-directory infra-read and skill-prompt sanitization) through the session's `PathNormalizer`, adding two methods (`comparableValue`, `isInfrastructureRead`) and dropping the `platform` parameters from `describeExternalDirectoryGate`, `describeSkillReadGate`, and the skill-sanitizer functions.
Filed follow-up #513 for the final `getPlatform()` removal, which neither #511 nor #502 can complete alone (the pipeline reads `getPlatform()` once and threads it to three gates; the tool gate keeps it until #502 lands).

### Observations

- The issue raises a genuine fork for skill sanitization (carry `AccessPath`s vs. resolve through the normalizer).
  Resolved decisively against carrying `AccessPath`s: `AccessPath.forPath` eagerly computes the canonical alias via `realpathSync` (`canonicalize-path.ts`), so it would add per-entry, per-turn filesystem access and shift lexical matching toward canonical — both behavior changes against a behavior-preserving refactor.
  Chose a lexical `comparableValue` method instead.
  Did not invoke `ask_user` because the behavior-preservation invariant removes the real choice (one option violates it).
- Confirmed `tcc.cwd === ctx.cwd === normalizer.cwd` (set in `permission-gate-handler.ts` and rebuilt on `session.activate`), which is what makes moving the `cwd` argument onto the baked normalizer behavior-preserving.
- `isInfrastructureRead` takes the already-built `AccessPath` (not a raw path) so the gate does not re-run `forPath`/`realpathSync` — Tell-Don't-Ask plus no double FS.
- Steps 1–4 of Phase 7 (#502–#505) are all still OPEN, so this plan deliberately leaves `getPlatform()` in place rather than removing it; the dependency, not ambiguity, forces that.
- `getPlatform()` removal depends only on #511 + #502 (the only two `getPlatform()` readers are `before-agent-start.ts` and the pipeline; the pipeline's read survives for the tool gate until #502).
  It does not depend on #503/#504, which touch `input-normalizer.ts` (that file gets `platform` elsewhere, not via `getPlatform()`).
- Doc surface to update: `architecture.md` (normalizer method list + the residual-threading subsection) and the package `SKILL.md` (normalizer method list in Debugging).
  Plans/retros under `docs/` are historical and left untouched.

## Stage: Implementation — TDD (2026-06-28T19:32:00Z)

### Session summary

Completed all four planned TDD cycles: added `PathNormalizer.comparableValue` + `isInfrastructureRead`, routed the external-directory infra-read through the normalizer, routed skill-prompt sanitization through the normalizer, and updated the architecture doc + package `SKILL.md`.
Test count went 2189 → 2195 (+6 new `PathNormalizer` tests); full suite, `check`, `lint`, and `fallow dead-code` all green.
Pre-completion reviewer returned PASS.

### Observations

- Pre-completion reviewer: PASS.
  No WARN findings.
- Deviation: also updated `test/handlers/external-directory-symlink-acceptance.test.ts` (not in the plan's listed test files) — it threaded the same `platform` arg into `describeExternalDirectoryGate`; `pnpm run check` caught it after the Step 2 production edit.
  Noted in the Step 2 commit body.
- The plan's lexical-no-FS decision held up: `comparableValue` delegates to `normalizePathForComparison` (no `realpathSync`), and `forPath` is intentionally absent from all skill-entry code paths.
- Self-inflicted friction: a blind `sed 's/"linux"/normalizer/g'` over the two skill test files also rewrote the `"linux"` inside the `new PathNormalizer("linux", cwd)` const declarations themselves (→ `new PathNormalizer(normalizer, cwd)`), which surfaced as a `ReferenceError: Cannot access 'normalizer' before initialization`.
  Fixed with a follow-up targeted `sed`.
  Lesson: exclude the constructor lines (or add the const after the bulk replacement) when mass-replacing a platform literal.
- `getPlatform()` left in place as planned (still feeds `describeToolGate` until #502); the `ToolCallGatePipeline.evaluate` `const platform` read remains.
  Final removal tracked in #513.
- biome's pre-commit hook reflowed the Step 3 sanitizer test (collapsed now-short multi-line calls); re-staged and committed cleanly.

## Stage: Final Retrospective (2026-06-28T23:53:50Z)

### Session summary

Shipped #511 end-to-end in one continuous session (plan → TDD → ship): a behavior-preserving refactor routing the two residual `platform`-threading sites through `PathNormalizer`, landing 4 commits, +6 tests (2189 → 2195), pre-completion PASS, CI green, issue closed.
No release was cut — every commit is `refactor:` (hidden changelog type) or `docs:` on an `exclude-paths` directory, so the work auto-batches into the next releasing commit, exactly as the plan's `**Release:** ship independently` rationale predicted.
The session was clean: the two friction points were minor, self-inflicted, and each caught immediately by a deterministic check (`tsc` / a test run).

### Observations

#### What went well

- **Hard-invariant resolution of an issue-flagged "decision."**
  The issue explicitly forked skill sanitization (carry `AccessPath`s vs. route through the normalizer).
  The behavior-preservation invariant (`AccessPath.forPath` eagerly calls `realpathSync` via `canonicalize-path.ts`) made one branch a behavior change, collapsing the fork to a single correct answer (a lexical `comparableValue` method) without spending an `ask_user` round.
  Recognizing when a constraint — not preference — settles a flagged decision kept planning tight.
- **Proactive cross-issue follow-up (#513).**
  The final `getPlatform()` removal cannot be completed by #511 or #502 alone (the pipeline reads it once and threads it to three gates; the tool gate keeps it until #502).
  Filing #513 during planning gave that order-independent cleanup an explicit home rather than leaving an untracked dangling accessor.
- **Incremental feedback loop did its job.**
  `pnpm run check` ran after each signature-changing step and caught the one un-planned test file (`external-directory-symlink-acceptance.test.ts`) the moment Step 2's production edit landed — no end-of-session surprise.
- **Pre-completion reviewer PASS on first dispatch** (ran on `anthropic/claude-sonnet-4-6`, model well-matched to judgment-heavy review).

#### What caused friction (agent side)

- `missing-context` (self-identified) — the plan's Module-Level Changes listed only `external-directory.test.ts` for the external-directory gate, but the planning-stage `grep -rln describeExternalDirectoryGate test/` had already surfaced `external-directory-symlink-acceptance.test.ts` too.
  The grep result was in hand; it just wasn't carried into the plan's test-file list.
  Impact: one extra `sed` fix during TDD Step 2, caught instantly by `tsc`.
  No rework beyond that; noted in the Step 2 commit body.
- `other` (self-identified) — a blind `sed 's/"linux"/normalizer/g'` over the two skill test files also rewrote the literal inside the `new PathNormalizer("linux", cwd)` const declarations I had just added (→ `new PathNormalizer(normalizer, cwd)`), producing `ReferenceError: Cannot access 'normalizer' before initialization`.
  Impact: ~2 extra tool calls (one failed test run + one targeted `sed`).
  Self-caught on the next test run.
  Lesson: when mass-replacing a literal, guard the new symbol's own declaration (replace before introducing the const, or exclude the constructor line).

#### What caused friction (user side)

- None.
  The session ran autonomously across all three stages with no user correction or redirect needed.

### Diagnostic details

- **Model-performance correlation** — one subagent dispatched (pre-completion-reviewer) on `anthropic/claude-sonnet-4-6`; appropriate for judgment-heavy review (acceptance criteria, design, invariants).
  No mismatch.
- **Feedback-loop gap analysis** — no gap: `pnpm run check` ran after each shared-signature step, the affected test file ran per Red/Green cycle, and the full suite + `lint` + `fallow` ran once before the pre-completion dispatch.
  Verification was incremental, not deferred.
- Escalation-delay and unused-tool lenses found nothing notable (no rabbit-hole exceeded 1 follow-up tool call; no missing-context warranted a subagent).

### Changes made

1. Added this Final Retrospective stage entry to `packages/pi-permission-system/docs/retro/0511-retire-residual-getplatform-threading.md`.
   No `AGENTS.md` or prompt changes — the session's two friction points were minor, self-caught by deterministic checks, and already covered by existing guidance (confirmed with the operator).
