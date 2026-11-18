---
issue: 1016
issue_title: "pi-permission-system: a path deny misses a case- or Unicode-normalization variant the filesystem opens as the same file"
---

# Retro: #1016 — pi-permission-system: a path deny misses a case- or Unicode-normalization variant the filesystem opens as the same file

## Stage: Planning (2026-11-18T03:37:37Z)

### Session summary

Measured the bypass and the candidate fix through the real gates (`describePathGate`, `describeBashPathGate`, `describeExternalDirectoryGate`) with a disposable spike, once on `main` and once with `canonicalizePath` calling `realpathSync.native`.
The operator chose native-only (document the non-disk-spelling residual) and POSIX-only (win32 keeps the JS `realpathSync`).
The plan puts the choice on `PathFlavor.realpath`, preceded by a test-only step that gives the 11 `node:fs` `realpathSync` mocks a `native` twin.

### Observations

- The operator asked what NFC/NFD meant mid-gate; the first scope question assumed the term.
  Define Unicode normalization forms before offering options that hinge on them.
- Rejected options:
  - NFC/NFD match aliases (over-match an allow on Linux, where the two spellings are distinct files).
  - macOS case-fold matching (over-matches an allow on case-sensitive APFS).
  - Native on win32 (8.3/`subst`/UNC effects unmeasurable here; CI is ubuntu-only).
- The swap loosens as well as tightens.
  An allow on the on-disk spelling now covers variants, and an in-cwd case-variant path no longer asks `external_directory` (measured ask → no gate).
  The plan calls this the correction, under a non-breaking `fix:`.
- The direct native call failed 27 tests in 10 files (measured).
  The tidy-first assessor separated the failures into two modes:
  - full-replace mocks throw a `TypeError` that `canonicalizePath`'s catch swallows;
  - `importActual`-spread mocks silently bypass the spy for the real native function.
- An earlier `?? realpathSync` fallback spike stayed green only because it kept the mocks in control; it was not evidence the mocks tolerate native.
- The acceptance file is gated on a filesystem probe and skips on Linux CI.
  The mocked `canonicalize-path.test.ts` discrimination tests carry the CI signal.
- No follow-up issues filed: the residual and the win32 question are documented in the plan's Non-Goals and Open Questions.

#### Deferred tidyings

- The `node:fs` mocks in 8 test files are near-duplicate `importActual` spreads; unifying them is a separate test-hygiene round (`test/access-intent/`, `test/path/`, `test/handlers/gates/`, `test/service/`).

## Stage: Implementation — TDD (2026-11-18T03:58:46Z)

### Session summary

All three plan steps landed:

1. The `node:fs` `realpathSync` mocks gained a `native` twin.
2. `PathFlavor.realpath` resolves through `realpathSync.native` on POSIX and JS `realpathSync` on win32, and `canonicalizePath` uses it.
3. The docs refresh.

A follow-up architecture-doc commit fixed two entries the plan's doc list missed.
The package suite went from 6443 to 6459 tests: 15 in the new `filesystem-alias-acceptance.test.ts`, and 1 net in `canonicalize-path.test.ts`.

### Observations

- Step 1's preparation was verified before committing it.
  With the direct `.native` swap applied temporarily, the 11 mocked files ran green (39 files, 2508 tests), where the planning measurement had failed 27 tests in 10 files.
- Every killing mutation killed what the plan predicted:
  - POSIX → JS `realpathSync`: 21 reds (8 `canonicalize-path` + 13 acceptance).
  - win32 → native: 2 reds.
  - Reverting the relocated call in `canonicalizePath`: 21 reds.
- The two residual pins stayed green through Red by design.
  A lowercase+NFC basename fold mutation turned both red, so they discriminate.
- The acceptance file's cwd-variant test uppercases the mkdtemp basename (`fs-alias-acc-…` → `FS-ALIAS-ACC-…`) to get a case-variant ancestor inside the cwd.
- Pre-completion reviewer: WARN (full review), then WARN (delta).
  - **Stale architecture entries:** the `path-normalization.ts` and `access-path.ts` entries still said "symlink-resolved + win32-lowercased"; fixed in a separate `docs(pi-permission-system)` commit.
  - **`excludedDirs` fails toward allow:** the plan's Risks claimed an infra-read spelling mismatch fails toward an ask, but `isPiInfrastructureRead`'s lexical `excludedDirs` fail toward an allow.
    Verified as a pre-existing defect: a symlinked `agentDir`, or an agent typing the canonical spelling, already reached it, so this change adds no capability.
    Filed as #1130; no improvement phase is open, so no roadmap disposition was recorded.
  - **Bash dedup collapse:** it can drop a non-disk-spelling alias; accepted as the documented residual.
  - **Remaining wording:** "symlink-resolved" without the on-disk qualifier at `architecture.md:994` (the `describePathGate` entry) and `.pi/skills/package-pi-permission-system/SKILL.md:269`; left as is.
    `README.md:78` is directly followed by the new on-disk sentence.
- Deviation from the plan: one extra docs commit for the two architecture entries.
  The plan's Risks section is wrong about the `excludedDirs` direction; #1130 records the correction.

## Stage: Final Retrospective (2026-11-18T04:09:18Z)

### Session summary

One process ran all four stages on `main`: plan, TDD (3 steps plus 1 extra docs commit), ship, and this retro.
The change shipped as `pi-permission-system` 42.0.3 with CI green.
One follow-up was filed: #1130, the infra-read exclusion compared lexically against a canonical path.

### Observations

#### What went well

- The planning spike drove the real gates (`describePathGate`, `describeBashPathGate`, `describeExternalDirectoryGate`) twice, on `main` and with the native swap.
  That produced a before/after table the operator's scope gate and the plan's Goals were built from, and the acceptance tests later reproduced every row.
- The tidy-first assessor found a failure mode the planning spike had masked.
  The 8 `importActual`-spread mocks do not throw on `.native`; they silently bypass the spy for the real function.
  The spike's `?? realpathSync` fallback had kept those mocks in control, so its green full suite said nothing about them.
  Re-measuring with the direct call (27 failures in 10 files) gave the plan its accurate number.
- Step 1's preparatory commit was verified before landing, by applying the step-2 swap temporarily and running the 11 mocked files green.
  A test-only tidying otherwise has no killing mutation to prove it does its job.
- The residual characterization pins were mutation-checked (a lowercase+NFC basename fold turned both red), so the two always-green tests are known to discriminate.
- The pre-completion dispatch carried a re-derivation mandate ("enumerate the consumers of `boundaryValue()` yourself, and the fail direction of each").
  That mandate is what surfaced the `excludedDirs` fail-toward-allow case.

#### What caused friction (agent side)

- `instruction-violation` — the first scope `ask_user` offered "NFC/NFD aliases" without defining NFC/NFD, against `clarification-gates`' "define a gate's terms of art before its substance".
  User-caught: the operator answered with "What does NFC NFD mean?"
  and then "Show me scope options again".
  Impact: two extra round trips; no rework.
- `missing-context` — the plan's Risks section said an infra-read spelling mismatch fails toward an ask.
  It treated `isPiInfrastructureRead` as one comparison, but the function makes two that fail in opposite directions: the allow-list roots and the `excludedDirs` exclusion.
  Reviewer-caught.
  Impact: a wrong claim in a committed plan, follow-up #1130, and a delta review round.
- `instruction-violation` — the plan's doc list grepped `symlink-resolved` in `README.md` and `docs/*.md` but not `docs/architecture/`.
  Two module-tree entries (`path-normalization.ts`, `access-path.ts`) kept describing the canonical form as "symlink-resolved + win32-lowercased".
  The `plan-issue` rule for reworded mechanisms names `.pi/skills/package-*/SKILL.md` and `test/` comments but not the package's `docs/` tree, so following it literally would still have missed them.
  Reviewer-caught.
  Impact: one extra `docs(pi-permission-system)` commit and a delta review.
- `instruction-violation` — a planning-spike call ran `vitest run … >/dev/null` with a `-t` filter, against `testing`'s "run Vitest bare".
  It hung until the 180 s tool timeout.
  The bare re-run took under a second; the cause of the hang was not established.
  Self-identified.
  Impact: 180 s lost; no rework.

#### What caused friction (user side)

- None of note.
  The operator's one-word bounce ("What does NFC NFD mean?") was the cheapest possible redirect for an undefined term.

### Diagnostic details

- **Model-performance correlation** — planning, TDD, and retro ran on `claude-opus-5-5`; ship ran on `claude-sonnet-5-5`, appropriate for its mechanical steps.
  All three subagents (tidy-first assessor, pre-completion reviewer, delta reviewer) ran on `claude-sonnet-5-5` per their transcripts.
  The full reviewer's consumer re-derivation was judgment-heavy and correct, so no mismatch.
- **Feedback-loop gap analysis** — `check` ran after each `src` step and the full suite before each commit, so there was no end-only verification.

### Changes made

1. `.pi/prompts/plan-issue.md` (Module-Level Changes): the reworded-mechanism grep now names the whole `packages/<PKG>/docs/` tree and the descriptive phrase (e.g. `symlink-resolved`), not only the package skill and `test/` comments.
2. `.pi/prompts/plan-issue.md` (Design Overview): when a change alters a value consumers compare against, list each comparison per consumer with its mismatch fail direction (an exclusion fails toward allow, an allow-list toward ask).
3. Commented on #1130 linking it to #1018: the same canonical-versus-lexical comparison in `isPiInfrastructureRead`, with #1018 the allow-list side (fails closed) and #1130 the exclusion side (fails open), sharing one fix site.
