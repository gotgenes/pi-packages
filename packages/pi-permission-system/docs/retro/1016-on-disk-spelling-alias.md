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
