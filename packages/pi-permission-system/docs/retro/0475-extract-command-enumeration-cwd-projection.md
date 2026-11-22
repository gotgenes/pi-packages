---
issue: 475
issue_title: "pi-permission-system: extract command enumeration and cwd projection; relocate the bash sub-domain (Phase 6 Step 3)"
---

# Retro: #475 — Extract command enumeration and cwd projection; relocate the bash sub-domain

## Stage: Planning (2026-06-25T13:35:00Z)

### Session summary

Produced a four-cycle plan for Phase 6 Step 3 (the `bash-program-decomposition` batch tail): extract command enumeration to `command-enumeration.ts`, the `cd`-fold projection to `cwd-projection.ts`, relocate the slimmed `BashProgram` to `access-intent/bash/program.ts`, and relocate `bash-token-classification.ts` to `access-intent/bash/token-classification.ts`, repointing all gate consumers and tests.
The plan embeds four rendered-and-validated Mermaid diagrams: a shared data-flow view plus three module-layout variants (A/B/C) for the facade-scope decision, written at the operator's request so they can render them in a browser before choosing.

### Observations

- The one genuine design fork is **facade thinness / `EffectiveBase` encapsulation**, surfaced via `ask_user` (operator's own issue, so the gate confirmed a real design choice rather than direction): A = strict lift-and-shift (facade keeps `externalPaths`/`pathRuleCandidates`, reads `EffectiveBase` internals across the new boundary); B = thin facade (projection moves to `cwd-projection.ts`, `EffectiveBase` fully encapsulated); C = A plus a `resolveCandidateBase()` helper.
- The operator inclined toward B but asked for the data flow and a comparison diagram before committing, then asked for the plan to be written "as is" with the diagrams embedded for browser rendering.
  Plan recommends B and is written for B, with A/C deltas noted inline; the decision is flagged **pending visual review** — the one gate before TDD.
- Corrected the operator's initial framing of B: B's win is **cohesion/encapsulation** (one module owns the `cd`-projection lifecycle end to end; `EffectiveBase` never crosses a boundary), not new test surface.
  The projection functions' natural input is parse output, so existing parse-driven tests stay as facade coverage rather than converting to isolated unit tests.
- `BashCommand` moves to `command-enumeration.ts` (its producer); only `bash-command.ts` imports it externally.
  `BashPathRuleCandidate` has no external importer (public return type only), so under B it co-locates with `cwd-projection.ts`.
- Mermaid pitfall hit during validation: `class` and `enum` are reserved flowchart node ids (`Expecting 'SPACE', got 'SQS'`); renamed to `clsf` / `enm`.
  All four diagrams validated with `mmdc`; `rumdl` clean.
- Batch-tail release caveat recorded: all three steps are `refactor:`, so release-please derives no version bump from them — "ship now" means "nothing holds the batch back," not "force a release."
  Folded in the [#474]-deferred architecture `Outcome:` fix ("≤ 670 LOC" vs actual 695).
- No follow-up issues filed: Step 4 ([#476], `AccessPath`) already exists; the external-directory gate collapse is tracked as Phase 6 Step 5.

[#474]: https://github.com/gotgenes/pi-packages/issues/474
[#476]: https://github.com/gotgenes/pi-packages/issues/476

## Stage: Planning — design revision (2026-06-25T14:30:00Z)

### Session summary

A Socratic design dialogue with the operator expanded the plan well past the issue's lift-and-shift framing.
Three decisions landed: (1) `BashProgram` becomes born-ready — `parse(command, cwd: string)` resolves eagerly and the slice methods become parameter-free getters; (2) the `ToolCallContext.cwd` type widening is fixed package-wide; (3) the facade-scope fork resolves to Option B because born-ready leaves no call-time orchestration for the facade to retain.
The plan and both Mermaid diagrams were rewritten to the decided design; the three A/B/C comparison diagrams were dropped (they described the superseded lazy model and would contradict born-ready during implementation).

### Observations

- **Born-ready insight** — the operator pushed on "why is `cwd` not available at parse time?" then "why pass `cwd` to `parse()` rather than store it?"
  Resolution: `parse(command, cwd)` is the async factory (constructors can't be async); `cwd` is consumed during birth to produce the resolved arrays, so it is a factory parameter, not a retained field (storing it would be dead state).
  `PathCandidate` / `EffectiveBase` become fully internal to `cwd-projection.ts` — never on the instance.
- **`cwd` type widening is a real error** — verified `ExtensionContext.cwd: string` (non-optional; the same SDK interface marks `model` / `signal` as `| undefined`, so `cwd`'s presence is deliberate).
  The widened `ToolCallContext.cwd: string | undefined` spawned dead `cwd`-undefined branches in **five** gates (`bash-external-directory`, `external-directory`, `skill-read`, `path`, `tool`) plus three obsolete "no CWD" tests.
  This is a package-wide gate-layer cleanup, orthogonal to the bash relocation but coupled to born-ready at the pipeline seam (`parse` needs a `string`).
- **Scope decision (`ask_user`)** — operator chose **all-in #475** (relocation + born-ready + full `cwd` fix) over splitting the type fix into a prerequisite issue or deferring born-ready.
  Recorded as Alternatives considered in the plan.
- **`BashProgram` is a function masquerading as a class** — acknowledged: under eager resolution the three getters return stored arrays, so the class is close to a data holder.
  Deliberately **not** collapsed to a function-returning-record here — that reshape is deferred to Step 4 ([#476]), which already retypes `externalPaths` for `AccessPath`.
- TDD order grew to five cycles: cwd type fix (independent, lands first) → command enumeration → cwd projection + born-ready (largest) → relocation → docs.
  Still all `refactor:` / `docs:` — no user-facing behavior change, so the batch-tail release caveat (no version bump from refactors) stands.
- Both rewritten diagrams validated with `mmdc`; `rumdl` clean.

## Stage: Implementation — TDD (2026-06-25T17:40:00Z)

### Session summary

Completed all five planned TDD cycles in one session: (1) narrowed `ToolCallContext.cwd` to `string` and removed five dead `cwd`-undefined gate branches plus two obsolete tests; (2) extracted `command-enumeration.ts` with `BashCommand` and `collectCommands`; (3) extracted `cwd-projection.ts` with the full `cd`-fold walk and born-ready projection functions, rewrote `BashProgram` with `parse(command, cwd)` and parameter-free getters, updated all callers and tests; (4) relocated `bash-program.ts` → `access-intent/bash/program.ts` and `bash-token-classification.ts` → `access-intent/bash/token-classification.ts`, repointed six source files and seven test files, deleted old locations; (5) updated `docs/architecture/architecture.md` with the new layout entries, `✅` Step 3 markers, Track A completion, and corrected health metrics.
Test count moved from 2107 (baseline) → 2105 (Step 1: −2 dead tests) → 2104 (Steps 2–3: −1 no-cwd test) and held at 2104 through Steps 4–5.
Pre-completion reviewer: PASS.

### Observations

- **No red phase**: every cycle was behavior-preserving; the suite stayed green throughout.
  The only "failures" were type errors caught by `tsc` that guided the consumer update scope (four extra test files needed `parse(cmd, cwd)` beyond what the plan listed).
- **Deviation — extra consumer test files**: the plan listed `bash-program.test.ts`, `bash-external-directory.test.ts`, `bash-path.test.ts`, `bash-command-metamorphic.test.ts`, `tool-call-gate-pipeline.test.ts`, and `external-directory-symlink-acceptance.test.ts` for the born-ready `parse(cmd, cwd)` update.
  `tsc` after Step 3 also surfaced `test/handlers/gates/bash-path.test.ts` and `test/handlers/gates/bash-external-directory.test.ts` parse-helper locals — both corrected in the same commit.
- **Deviation — `vi.mock` path**: the pipeline test's `vi.mock("#src/handlers/gates/bash-program", …)` assertion needed updating after the relocation (Step 4) — caught as a live test failure (the mock silently stopped intercepting), corrected immediately.
- **Step 3 was the largest**: the `bash-program.test.ts` rewrite touching ~90 call sites (`parse(cmd)` → `parse(cmd, cwd)`, `.externalPaths(cwd)` / `.pathRuleCandidates(cwd)` → parameter-free) was done as a full `Write` per AGENTS.md guidance; no logic changed, only call-site shape.
- **Biome `noRedeclare` / `noUnusedVariables` fires**: when `collectCommands` was imported from the new module but the old local definition was still present, Biome's pre-commit hook caught both as errors — exactly the correctness gate the plan predicted.
- **`program.ts` born-ready LOC**: 102 (plan estimated ~110); `cwd-projection.ts`: 493 (plan estimated ~420 — the difference is the projection functions' dedup and loop bodies plus fuller doc comments).
- Pre-completion reviewer: PASS — all categories clean; noted `cwd-projection.ts` at 493 LOC is intentional (Option B encapsulation); no WARNs.

## Stage: Ship (2026-06-25T18:10:00Z)

### Session summary

Shipped the `bash-program-decomposition` batch tail: pushed six commits, CI green, closed #475 plus the two stacked predecessors (#473, #474) with curated implemented-in comments, and merged release-please PR #483 (rebase) to cut `pi-permission-system-v16.0.2`.
Correctly identified that every #475 commit is inert for release purposes (all `refactor:` or `docs:` on `exclude-paths`), so the version bump came from the one releasable commit already in the unreleased range — the #473 `docs(pi-permission-system):` architecture entry that predated `docs/architecture` joining `exclude-paths`.

### Observations

- **Inert-batch analysis held**: the plan's batch-tail caveat ("all `refactor:` → no bump") matched reality exactly; the 16.0.2 patch was driven by a stranded #473 docs commit, not by #475's work.
  The ship flow surfaced this rather than forcing a fake `fix:`.
- **Release-changelog wrinkle (config-timing, not agent friction)**: 16.0.2's changelog lists only the #473 architecture entry because `packages/pi-permission-system/docs/architecture` was added to `exclude-paths` after #473's commit landed but before #474/#475's architecture commits — so the later (richer) doc commits are inert while the earliest one still drove the release.
  Harmless; the decomposition is internal-only and has no user-facing changelog story anyway.
- **`ci_watch` tool quirk**: the first `ci_watch` returned `aborted: cancelled by user` at 105 s without any user action; a re-run with a longer timeout streamed progress and reported `success`.
  Transient tool artifact, no agent rework.
- **CI write-back working as designed**: `ab93e61d chore: advance release-please last-release-sha baseline [skip ci]` landed automatically after the release (Refs #468) — the baseline auto-advance, not a manual step.

## Stage: Final Retrospective (2026-06-25T18:25:00Z)

### Session summary

Phase 6 Step 3 ran the full multi-session lifecycle (plan → design revision → TDD → ship → retro) and shipped clean: the bash engine now lives entirely under `src/access-intent/bash/`, `BashProgram` is a 102-LOC born-ready facade, and a latent `ToolCallContext.cwd` type-widening bug (five dead gate branches) was found and fixed along the way.
Released as `pi-permission-system-v16.0.2`, completing the `bash-program-decomposition` batch (#473, #474, #475).

### Observations

#### What went well

- **The planning `ask_user` gate did real design work, not just direction confirmation** — it surfaced the facade-scope fork (A/B/C), and the ensuing Socratic dialogue expanded the change to born-ready construction *and* uncovered a latent type-widening defect (`ToolCallContext.cwd: string | undefined` vs the SDK's non-optional `ExtensionContext.cwd: string`) with five dead branches across unrelated gates.
  A planning gate finding and fixing a real bug orthogonal to the issue's stated scope is the standout of this arc.
- **Born-ready emerged from operator pushback, not a correction** — "why is `cwd` not available at parse time?" then "why store it rather than pass it to `parse()`?" reframed the value object cleanly: `cwd` is a factory parameter consumed at birth, not a retained field (storing it would be dead state); `PathCandidate` / `EffectiveBase` never reach the instance.
- **Cross-session retro bridging worked end to end** — each stage's notes (planning → revision → TDD) carried decisions forward, so no ground was re-litigated; the design-revision stage's born-ready spec drove the five-cycle TDD order without rediscovery.
- **`tsc`-guided, behavior-preserving TDD** — the born-ready signature change is a type-level break, so `tsc` enumerated every stale call site immediately; verification ran incrementally (check + full suite per cycle), and the suite stayed green throughout with zero rework.
  Pre-completion reviewer PASS, ship clean.

#### What caused friction (agent side)

- `missing-context` (minor) — the plan's Module-Level Changes listed six test files for the born-ready `parse(cmd, cwd)` update but missed two gate-test parse-helper locals (`describeGate` wrappers in `bash-path.test.ts` / `bash-external-directory.test.ts`) and the pipeline `vi.mock` factory path.
  Impact: none beyond same-commit fixes — `tsc` and one live test failure caught all of them inside the commits that introduced the change; no follow-up commits, no rework.
  The type-level break made the feedback loop authoritative.

#### What caused friction (user side)

- None.
  The operator's interventions were strategic redirects (the born-ready and cwd-widening questions), which functioned as the design gate working as intended — the opposite of mechanical oversight.

### Diagnostic details

- **Model-performance correlation** — the only subagent dispatch, `pre-completion-reviewer`, ran on its frontmatter default (`anthropic/claude-sonnet-4-6`), appropriate for the judgment-heavy review (29 tool uses, 217 s); no mismatch.
  Session-level `model_change` entries are dominated by transient menu selections with no attributed turns and were not over-counted.
- **Escalation-delay tracking** — no `rabbit-hole` friction; the lone retry (`ci_watch`) was a one-shot tool re-run, not a stuck approach.
- **Feedback-loop gap analysis** — no gap: `pnpm run check` + full suite ran after every TDD cycle, and `lint` + `fallow dead-code` after the relocation and again pre-push.

### Candidate rules considered and rejected

Two durable-rule candidates were considered and rejected as over-fitting a clean, self-correcting session (mirroring #474's retro discipline):

1. A `code-design` "born-ready construction / a parameter consumed at birth is not a field" heuristic — the operator drove this successfully via dialogue, and the pattern is already implicit in the skill's DIP and output-argument guidance; codifying it on one data point risks premature abstraction.
2. A `plan-issue` / `design-review` "scan for type-widening against SDK contracts" prompt rule — the existing SDK-contract-verification guidance already covers it; the win here was the dialogue, not a checklist gap.

Recorded here rather than promoted.

### Changes made

1. Appended the Ship and Final Retrospective stage entries to `packages/pi-permission-system/docs/retro/0475-extract-command-enumeration-cwd-projection.md` (this file).
2. No prompt or `AGENTS.md` changes — the operator confirmed retro-only; both candidate rules were considered and rejected as over-fitting a clean session (recorded above).
