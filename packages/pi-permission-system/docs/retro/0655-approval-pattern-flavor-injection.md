---
issue: 655
issue_title: "deriveApprovalPattern reads node:path ambiently instead of the injected PathFlavor"
---

# Retro: #655 — `deriveApprovalPattern` reads `node:path` ambiently instead of the injected `PathFlavor`

## Stage: Planning (2026-08-18T04:09:10Z)

### Session summary

Traced all five production call sites of `deriveApprovalPattern` and found they all pass `AccessPath.value()`, and that every `AccessPath` in the package is constructed by `PathNormalizer` — which already holds the flavor.
Measured both the current and proposed derivation algorithms against `path.win32` / `path.posix` and found the issue understates its own consequence 2: the mixed-separator output is not merely incoherent, it silently widens a directory-token session approval to the parent directory on win32.
Wrote `docs/plans/0655-approval-pattern-flavor-injection.md` with seven lift-and-shift cycles.

### Observations

- Flavor injection alone does **not** fix the win32 output.
  `win32.dirname("/dev/null")` is `/dev` while `win32.sep` is `\`, so a win32-flavored version of today's algorithm still emits `/dev\*`.
  The separator has to come from the value, not the platform default — which the win32 flavor supports for free, since it counts both `/` and `\` as separators.
- Replacing the four branches with one rule ("value up to and including its last separator, plus `*`") is **measured byte-identical on POSIX** across all 10 values including every case the suite pins, and fixes four win32 rows.
- The widening is reachable, not theoretical: `PathNormalizer.forBashToken` routes a win32 non-mount POSIX absolute to `forLiteral`, which preserves a trailing `/` ([#533]), so `grep -r x /tmp/logs/` on a Git Bash host derives `/other/project\*`-shaped patterns.
  Under [#653]'s symmetric fold that pattern matches siblings of the approved directory.
  The `/foo` case fails the other way — `/\*` folds to `\\*` and matches nothing, so the grant is inert.
- Operator chose `PathNormalizer.approvalPatternFor(accessPath)` over `AccessPath.approvalPattern()`, and re-typed the migration commit from the roadmap's `refactor:` to `fix:` once the win32 widening was surfaced.
  Step 8's `Outcome:` and the `Release batches` line in `architecture.md` need that correction in the doc commit.
- The per-tool gate takes the **product**, not the collaborator: `ToolCallGatePipeline.resolvePerToolCheck` already holds both the normalizer and the `AccessPath`, so it derives the pattern once and hands `describeToolGate` a `ToolPathAccess` pair.
  This keeps `pattern-suggest.ts` free of path-domain imports and touches 2 of 17 `describeToolGate(` test call sites instead of all 17.
  The two bash gates take the normalizer itself, because entry selection happens inside them and the pipeline cannot pre-derive.
- `suggestSessionPattern`'s `"path"` / `"external_directory"` arms are unreachable in production (its one caller passes `"bash"` or a tool name), and its path-bearing arm becomes unreachable once `tool.ts` routes through the new entry point.
  Removing them was an explicit operator decision.
  `buildLabel`'s corresponding arms were already unreachable before this change and are left alone — folding that cleanup into [#604] is cheaper than a standalone issue.
- Sibling issue [#604] (`sessionApprovalScope` config knob) targets this same derivation; it lands more easily on a flavor-injected version, so no coordination is needed beyond noting it in Non-Goals.

## Stage: Implementation — TDD (2026-08-18T04:43:43Z)

### Session summary

Landed all seven planned TDD cycles plus one tidy-first prep commit and one post-review test cleanup — nine commits.
`deriveApprovalPattern` moved from `session-rules.ts` (ambient `node:path`) to a flavor-parameterized leaf `src/path/approval-pattern.ts`, reached through the new `PathNormalizer.approvalPatternFor`; `PathFlavor` gained `lastSeparatorIndex`; the five call sites migrated and `pattern-suggest.ts` split into a text and a path entry point.
Test count went 3136 → 3162 (+26) with all 145 pi-permission-system files green; the quantitative target (`grep -c "node:path" src/session-rules.ts`, 1 → 0) was met.

### Observations

- **The first red probes were false.**
  The four gate-level tests I wrote for the win32 defect (a `/tmp/logs/` Git Bash directory token) **passed before the fix**.
  The reason is the defect itself: the old code read `sep` off the *host*, so a `win32PathFlavor`-parameterized test on a POSIX CI exercised POSIX separators and could not see win32 behavior at all — exactly consequence 1 of the issue, met head-on.
  The discriminating input turned out to be a **native Windows path** (`c:\projects\app\src\foo.ts`), which the host's POSIX `dirname` collapses to `./*`.
  All five gate-level probes were rewritten around that and go genuinely red.
  The testing skill's rule — "a new test that passes during Red is either an invariant pin or a broken probe, decide which" — paid for itself here.
- **The widening is real, and was verified against the matcher, not argued.**
  A throwaway test approved the pre-fix pattern `/tmp\*` on `SessionRules` and evaluated `/tmp/other/secrets.env` under `win32PathFlavor`: `allow`.
  That measurement is what justified retyping the commit `fix:` rather than the roadmap's `refactor:`, and it is now pinned by the leaf suite's "bounds a win32 directory token to itself" round-trip.
- **Two plan deviations, both small.**
  `ToolPathAccess` was declared in `handlers/gates/tool.ts` rather than `tool-call-gate-pipeline.ts` — it is `describeToolGate`'s own parameter type and the pipeline already imports from `./tool`.
  And an unplanned file needed the new gate parameter: `test/handlers/external-directory-symlink-acceptance.test.ts`, a `describeBashExternalDirectoryGate` call site outside `test/handlers/gates/`.
  The plan's grep for gate call sites stopped at the gates' own test directory; `tsc` caught it immediately.
  Conversely, two files the plan listed as possible touch points needed nothing (`tool-call-gate-pipeline.test.ts`, `test/helpers/gate-fixtures.ts`).
- **The `pathAccess` pair paid off as predicted.**
  Replacing `describeToolGate`'s `accessPath?` parameter with the `{ path, approvalPattern }` pair (rather than adding a required `normalizer` parameter) touched 4 of 17 call sites in `tool.test.ts` instead of all 17, and kept `pattern-suggest.ts` free of path-domain imports.
- **The tidy-first assessor found exactly one thing and it was the right one:** `bash-external-directory.test.ts` had duplicated `describeGate` / `describeGateWin32` normalizer construction, so threading the new parameter would have hit two places.
  Consolidating first (mirroring `bash-path.test.ts`) made step 4 a one-line change there.
- **Pre-completion reviewer: WARN** (no FAILs), both findings addressed in a follow-up `test:` commit:
  a stale test title still naming the removed `deriveApprovalPattern` symbol (also upgraded from a `toBeDefined` placeholder to a real pattern assertion), and the one remaining non-differentiating win32 gate test, now labelled as the invariant pin it is — it guards against a *future* rewrite that scopes on `flavor.impl.sep`, not against the pre-fix code.
- **`buildLabel`'s `path` / `external_directory` arms remain unreachable**, as planned.
  They predate this change; folding their removal into [#604] stays the cheaper path.

## Stage: Final Retrospective (2026-08-18T05:03:58Z)

### Session summary

One continuous session carried #655 from plan through TDD to ship: `deriveApprovalPattern` moved off its ambient `node:path` read onto `PathNormalizer.approvalPatternFor` over a new flavor-parameterized leaf, and `pi-permission-system` v26.2.2 published.
Planning's measurement turned what the issue framed as cosmetic into a real win32 defect — a session approval on a Git Bash directory token silently widened to the parent directory — which retyped the commit `refactor:` → `fix:`.
Shipping surfaced an unrelated one-line `release-please-config.json` gap that would have published no-op `pi-github-tools` versions indefinitely.

### Observations

#### What went well

- **Measurement changed the decision twice, at two layers.**
  Planning ran both derivation algorithms through `node -e` against `path.win32`/`path.posix` rather than reasoning about them, which is what exposed the widening and drove the commit-type change.
  Implementation then re-verified it one layer down, against the *real* matcher: a throwaway test approved the pre-fix pattern `/tmp\*` on `SessionRules` and evaluated `/tmp/other/secrets.env` under `win32PathFlavor`, returning `allow`.
  Neither step would have been convincing as prose — and the second could have contradicted the first, since the `windowsSeparators` fold sits between the algorithm and the observable outcome.
- **The `testing` skill's broken-probe rule fired exactly as designed, on a new mechanism.**
  The rule ("a new test that passes during Red is either an invariant pin or a broken probe — decide which") was written for a probe *string* that matched elsewhere ([#760]).
  Here the probe string was fine and the input was wrong, for a reason specific to the defect being fixed.
  The rule still caught it.
- **The `pre-completion-reviewer` did genuine verification, not pattern-matching.**
  It independently re-derived the false-red finding by *running* the old ambient algorithm against the real `forBashToken` values, confirmed five probes were genuine, and caught a sixth I had missed — the `/tmp/logs/` case, which passes either way on POSIX.
  A reviewer that had only read the diff would have accepted my claim wholesale.
- **`/ship-issue`'s "note an unrelated bump" gate paid for itself.**
  Diagnosing rather than merely reporting the `pi-github-tools: 4.3.1` entry found that `packages/pi-github-tools/docs/retro` was missing from `exclude-paths` — the only such gap across all packages, and one that had already published at least one no-op version.

#### What caused friction (agent side)

- `missing-context` — the first four win32 gate probes passed **before** the fix.
  The plan's own Problem Statement says an ambient `sep` "resolves against the host, so a `win32PathFlavor` unit test running on POSIX CI exercises POSIX separators" — I wrote that sentence and then designed probes that violated it, choosing POSIX-shaped inputs (`/tmp/logs/`) whose ambient and injected derivations coincide on a POSIX host.
  Impact: ~6 tool calls to diagnose (two throwaway probe files) and a rewrite of five gate tests around a native Windows path.
  No production rework; the diagnosis itself became the strongest evidence in the close comment.
- `missing-context` — the plan's call-site grep for the two bash gates stopped at `test/handlers/gates/`, missing `test/handlers/external-directory-symlink-acceptance.test.ts` one directory up.
  Impact: none beyond one extra edit inside the same commit; `tsc` flagged it immediately.
- `instruction-violation` (self-identified) — emitted an `Edit` call carrying a stray `oldText2` key, which `AGENTS.md` documents as silently ignored while still reporting success.
  Impact: none — the four real array entries applied and the count matched — but it cost a verification read to confirm.
- `other` — wrote an incoherent doc comment ("the separator spellings this platform recognizes, newest-first is irrelevant") into `path-flavor.ts` and had to correct it before committing.
  Impact: one extra edit, no commit churn.

#### What caused friction (user side)

- The `ask_user` scope option labelled "Fold in, keep `refactor:`" described the *action* but not its *consequence*, prompting the note "What issue follows up with the win32 fix?"
  The clarification gate worked — re-asking changed the answer from `fold-refactor` to `fold-fix` — but the round trip was avoidable had the option said "no follow-up issue" outright.
  Opportunity: an option whose differentiator is *what happens next* should name that outcome in its own label or description.

### Diagnostic details

- **Model-performance correlation** — all main-session turns ran on `anthropic/claude-opus-5`; both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) on `anthropic/claude-sonnet-5` per their frontmatter.
  No mismatch: both subagent tasks are judgment-heavy read-only review, and the reviewer's empirical re-derivation of the false-red finding shows the tier was adequate.
- **Escalation-delay tracking** — no sequence exceeded the 5-call threshold.
  The false-red episode resolved in four tool calls (write probe → run → write second probe carrying the old algorithm inline → run), because the first probe printed both algorithms' outputs side by side rather than only the failing one.
- **Unused-tool detection** — nothing missed.
  The two `missing-context` points were both cheap greps, not codebase-understanding gaps an `Explore` dispatch would have closed.
- **Feedback-loop gap analysis** — verification ran incrementally throughout: per-file `vitest run` at every Red and Green, `pnpm run check` after each interface-touching step (1, 3, 5, 6), full `pnpm run test` after step 4 and at the end, and root `pnpm run lint` plus `pnpm fallow dead-code` at the baseline and before push.
  The step-5 `check` caught the two stale `AccessPath` arguments in `tool.test.ts` immediately; the step-6 `lint` caught an orphaned `import type` that `tsc` accepts.

### Changes made

1. `.pi/skills/testing/SKILL.md` — added the ambient-vs-injected red-probe rule beside the existing broken-probe entry: when a fix replaces an ambient global read with an injected value, pick a probe input where the two differ on the CI host.
2. `.pi/prompts/ship-issue.md` — step 6.3 now says to *diagnose* an unrelated package bump rather than only note it, naming the missing `exclude-paths` entry as the usual cause.
3. `release-please-config.json` — added `packages/pi-github-tools/docs/retro` to `exclude-paths` (landed during the ship stage as `fe3ce3b2`, not in the retro commit).
4. `docs/architecture/architecture.md` — added disposition entries for [#751] and [#753], the two issues born inside Phase 13 that never reached the sweep list.
5. `docs/architecture/architecture.md` — folded [#753] into Step 10's scope (heading, `Target:`, and `Outcome:`), since it is the same defect class at a second site and consumes the request id Step 9 mints.
6. `docs/architecture/architecture.md` — narrowed Step 2's `Outcome:` to name the inline dialog, with the `select`/`input` fallback's missing escape hatch tracked as [#751].
7. Filed [#767] — evaluate spun-off issues for roadmap fit at filing time.

Declined: an automated `exclude-paths` completeness check.
The gap is closed and the sharpened ship-time diagnosis covers a recurrence; a CI gate would be structural work needing its own plan.

### Follow-up: mid-phase issues escaped roadmap disposition

Four issues were born inside Phase 13.
[#752] and [#610] surfaced during *planning* sessions and got numbered steps plus disposition entries; [#751] and [#753] surfaced during *implementation* and got neither.
The split tracks when each was noticed, not how it relates to the phase — filing without scope-creeping was the correct local move in both cases, but nothing carried them back up to the roadmap.

Nothing downstream closes that gap.
The `pre-completion-reviewer` verifies a named follow-up was **filed**, not **dispositioned**.
`/finish-phase`'s hard gate enumerates only issues with a numbered step, and its archive step records only the abandoned/parked issues the roadmap already names — so a phase-born issue with no disposition entry disappears from the phase history entirely.

The cost is not only bookkeeping: [#753] would have folded into Step 10 at filing time (same defect class, and it consumes Step 9's request id), and [#751]'s absence left Step 2's `Outcome:` overclaiming a capability the `select`/`input` fallback never received.
Both were backfilled by hand here.
The operator's framing for the fix: an issue should be evaluated for roadmap fit **at spin-off time** — in retro or in planning — not at phase close, when it is too late to fold anything in.
Filed as [#767]; the open design question is whether that evaluation lives in a shared skill the three filing templates load, a step duplicated across them, or the `improvement-discovery` skill that already owns the phase model.

[#610]: https://github.com/gotgenes/pi-packages/issues/610
[#751]: https://github.com/gotgenes/pi-packages/issues/751
[#752]: https://github.com/gotgenes/pi-packages/issues/752
[#753]: https://github.com/gotgenes/pi-packages/issues/753
[#767]: https://github.com/gotgenes/pi-packages/issues/767

[#533]: https://github.com/gotgenes/pi-packages/issues/533
[#604]: https://github.com/gotgenes/pi-packages/issues/604
[#653]: https://github.com/gotgenes/pi-packages/issues/653
[#760]: https://github.com/gotgenes/pi-packages/issues/760
