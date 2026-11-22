---
issue: 382
issue_title: "pi-permission-system: external_directory base permission doesn't auto-detect or allow overrides for pi docs directory when installed via npm on Windows"
---

# Retro: #382 — Windows case-insensitive `external_directory` matching and Pi-install auto-detect

## Stage: Planning (2026-06-10T00:00:00Z)

### Session summary

Traced the reported bug to a Windows-only path-comparison asymmetry: the path under test is canonicalized and lowercased on `win32` (`normalizePathForComparison` / `canonicalNormalizePathForComparison`), but infra-dir containment (`isPathWithinDirectory`, case-sensitive `startsWith`) and config-pattern matching (`compileWildcardPattern`, case-sensitive `RegExp`) keep native case — so both the infrastructure auto-allow and explicit `external_directory` overrides silently fail.
Produced `docs/plans/0382-windows-external-directory-case-insensitive.md` with a 6-step TDD order covering `path.relative` containment, case/separator-folded path-surface matching, and Pi-install auto-detect via `getPackageDir()`.

### Observations

- The user steered the design with two questions ("is there a builtin node path library?" / "how does pi handle this itself?").
  Confirmed `path.win32.relative` folds case natively, and Pi's own idiom (`getCwdRelativePath`, `getPiDocsClassification` in `packages/coding-agent/src/utils/paths.ts` and `core/tools/read.ts`) is `relative()` + `..`/absolute check with no manual lowercasing — adopted as the containment approach.
- `path.matchesGlob` was rejected: its `*` does not cross separators and it is case-sensitive even on `win32`, so it would change the established `*`→`.*` semantics without fixing the case bug.
- Two `ask_user` calls settled scope: (1) comparison fix **plus** pi-API auto-detect, (2) adopt `path.relative` broadly; a follow-up picked `getPackageDir()` (whole Pi install dir) over docs-only paths.
- Key dependency constraint: `getPackageDir()` / `getDocsPath()` are only re-exported from `@earendil-works/pi-coding-agent`'s entry point as of `v0.79.0` (commit `eb43bd44`); the installed devDependency `0.75.4` exports only `getAgentDir` + `VERSION`.
  The plan therefore bumps the peer floor `>=0.75.0` → `>=0.79.0` (the reporter runs `0.79.1`).
- Testability decision: stubbing `process.platform` does **not** switch Node's top-level `path` functions to `win32`, so production code selects `path.win32`/`path.posix` from an injected, defaulted `platform` parameter and tests pass `"win32"` + `C:\…` paths.
  This also satisfies the AGENTS.md "no `process.platform` inside library functions" guidance.
- `evaluate` in `rule.ts` is the single surface-aware matching site; folding is scoped to a new exported `PATH_SURFACES` set (`PATH_BEARING_TOOLS` ∪ `{ external_directory, path }`) so `bash`/`skill`/`mcp` stay case-sensitive.
- Classified as a non-breaking `fix:` — POSIX behavior is unchanged and the peer bump does not alter runtime behavior/config on upgrade.
- Deferred (non-goals): removing the now-redundant `win32` lowercasing in `normalizePathForComparison`, and dissolving `subagent-context.ts`'s duplicate containment helper.

## Stage: Implementation — TDD (2026-06-10T19:17:00Z)

### Session summary

Implemented the Windows case-insensitive path-matching fix across 7 commits (6 TDD cycles + 1 docs): `path.relative`-based containment in `isPathWithinDirectory`, `WildcardMatchOptions` (case-insensitive + Windows-separator folding) on the matcher, case-insensitive infra-read auto-allow, path-surface case folding in `evaluate` via a new `PATH_SURFACES` set, an optional `piPackageDir` on `computeExtensionPaths`, and `getPackageDir()` wiring at the composition root (with the `@earendil-works/pi-coding-agent` / `pi-tui` floor bump `>=0.75.0` → `>=0.79.0`, devDeps `0.79.1`).
Test count went from 1902 to 1921 (+19); full suite, `check`, `lint`, and `fallow dead-code` all green.

### Observations

- Pre-completion reviewer: PASS.
- Reviewer warnings: one non-blocking WARN — `evaluateFirst` / `evaluateMostRestrictive` delegate to `evaluate` without exposing `platform`, so they are not unit-testable for Windows case-folding on a POSIX CI (runtime behavior is correct because `process.platform` is `win32` in production; the Windows path is covered compositionally by the `evaluate`-level tests).
  Left as-is; a future change could thread `platform` through them if dedicated Windows coverage is wanted.
- Deviation 1: did **not** thread `platform` into `isPathOutsideWorkingDirectory` (the plan suggested it).
  Its internal `isPathWithinDirectory` call already captures the runtime platform via the default param, and the `win32` path there is not unit-testable on a POSIX CI because `canonicalizePath` splits on `/`.
  Avoided an untested parameter.
- Deviation 2: reordered the plan's steps — the `wildcard-matcher` options had to land **before** `isPiInfrastructureRead` consumed them (the plan listed infra-read first and the matcher options later).
  A real dependency-ordering correction.
- Deviation 3: skipped the plan's brittle end-to-end external-directory gate integration test (Red C).
  Flipping `process.platform` does not switch Node's `path.win32` dispatch on a POSIX runner, and the gate's `canonicalNormalizePathForComparison` only lowercases on real `win32`, so a darwin-runner integration test would be unreliable.
  Coverage is provided by the composed unit tests at the `evaluate` / wildcard / `path-utils` levels.
- The `pnpm install` after the dep bump printed "Already up to date" but did update `pnpm-lock.yaml` (+205 lines adding `0.79.1`); verified the installed `index.d.ts` re-exports `getPackageDir` before wiring `index.ts`.

## Stage: Final Retrospective (2026-06-10T20:30:00Z)

### Session summary

Shipped the Windows case-insensitive `external_directory` fix end-to-end across planning, TDD, and release: 7 implementation commits, `+19` tests, `pi-permission-system` `v10.10.0` released and issue #382 closed.
The session was clean throughout — no rabbit-holes, no instruction violations, all gates green on the first push, and a PASS pre-completion review.
The one dominant friction was a planning-stage `missing-context` gap that the user redirected with two well-aimed questions.

### Observations

#### What went well

- The injected-`platform`-parameter testability pattern (select `path.win32`/`path.posix` from a defaulted `platform` arg, pass `"win32"` + `C:\…` in tests) cleanly solved the "can't stub `process.platform` to switch Node's `path` dispatch" problem.
  Reusable for any cross-platform path logic.
- Empirical verification before designing: a throwaway `node -e` script confirmed `path.win32.relative` folds case, and reading the local pi checkout (`~/development/pi/pi`) surfaced `getCwdRelativePath` / `getPiDocsClassification` / `getPackageDir` before committing to an approach.
- Tight feedback loop: `vitest run <file>` after every Red and Green, `pnpm run check` after each type-affecting step, full suite before commits touching shared helpers (`isPathWithinDirectory`, `evaluate`).
  No end-of-session verification surprises.
- Execution-time adaptation: caught a plan dependency-ordering inversion (the `wildcard-matcher` options had to land before `isPiInfrastructureRead` consumed them) and reordered without rework.

#### What caused friction (agent side)

- `missing-context` — during planning I converged on a hand-rolled case-folding fix (lowercase both sides / case-insensitive regex) without first checking whether Node's `path` module had a containment primitive or how the upstream host `@earendil-works/pi-coding-agent` solves the same problem.
  The user's two questions ("is there a builtin node path library?" / "how does pi handle this itself?") supplied exactly the missing checks, which redirected the design to `path.win32.relative` (native case-folding) and `getPackageDir()` (robust auto-detect).
  Self-identified: no (user-caught, via redirecting questions).
  Impact: no rework — caught in planning before the plan was written — but without the redirect the plan would have shipped more complex hand-rolled containment instead of the cleaner builtin-based design.
- `other` (plan dependency-ordering miss) — the plan listed the infra-read folding step before the `wildcard-matcher` options step it depended on.
  Self-identified at execution; reordered with no rework.

#### What caused friction (user side)

- The high-leverage context (prefer Node builtins; check how pi-coding-agent itself solves filesystem/platform problems) arrived as a mid-planning redirect rather than being available up front.
  Framed as opportunity: encoding "check pi-coding-agent's implementation first for path/platform bugs" in the package skill lets the agent do this proactively without the redirect.
  The intervention style — two redirecting questions instead of a correction — was ideal and worth preserving.

### Diagnostic details

- **Model-performance correlation** — one subagent dispatched (`pre-completion-reviewer`, judgment-heavy review).
  It returned a structured PASS with a genuine non-blocking WARN (the `evaluateFirst`/`evaluateMostRestrictive` testability gap) — appropriate quality for the task; no model/task mismatch.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; longest run on a single error was the expected Red→Green cycle (1–2 tool calls).
- **Unused-tool detection** — the `missing-context` gap was not a tool-usage failure: once pointed at `~/development/pi/pi`, exploration via `grep`/`Bash`/`node -e` was efficient.
  The gap was "did not think to check the upstream host implementation," not "checked it inefficiently."
- **Feedback-loop gap analysis** — no gap; verification ran incrementally after each change, not deferred to the end.

### Changes made

1. `.pi/skills/package-pi-permission-system/SKILL.md` — added a 4th item to the Debugging section: for path/filesystem/platform bugs, check how `@earendil-works/pi-coding-agent` solves it first and prefer Node `path` builtins over hand-rolled comparison.
