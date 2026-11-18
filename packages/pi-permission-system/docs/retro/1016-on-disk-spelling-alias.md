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
