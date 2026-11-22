---
issue: 523
issue_title: "Trim non-runtime dev files from published packages"
---

# Retro: #523 — Trim non-runtime dev files from published packages

## Stage: Planning (2026-07-03T00:00:00Z)

### Session summary

Produced a cross-package build plan (`docs/plans/0523-trim-non-runtime-dev-files.md`) to stop shipping non-runtime dev files (`test/`, `tsconfig.json`, `vitest.config.ts`, `AGENTS.md`, `.pi/`, `.prettierignore`) to npm.
The operator chose to standardize **all 8 packages** on a single `files` allowlist mechanism and remove every `.npmignore`, rather than following the [#484] per-package allowlist-vs-denylist split.
Plan is packaging-only: seven commits (six `build(<pkg>):`, one `docs:` for AGENTS.md), each verified by `pnpm pack` inspection.

### Observations

- Author is `gotgenes` (the operator), so the proposed direction was treated as the working hypothesis; still ran the `ask-user` gate because the mechanism choice was a genuine fork.
- Clarified with the operator that [#484] only narrowed `pi-permission-system`'s allowlist; the four `.npmignore` denylists came from an earlier commit (`3e1bf9c6`), and AGENTS.md codified the split.
  The operator elected to supersede that split with a single allowlist mechanism.
- Key safety check: `#test/*` in each `package.json` is a **self-referencing** internal subpath alias, not a consumer of another package's published `test/`; the only cross-package dep (`pi-subagents-worktrees` → `pi-subagents`) resolves through `exports`, so dropping `test/` from every tarball is safe.
- The surviving `.npmignore` files in `pi-permission-system` and `pi-subagents` are fully redundant once an allowlist exists (they target paths outside the allowlist), so deleting them yields an identical tarball — verified by design, to be confirmed per-step with `pnpm pack`.
- These are `build:` commits (hidden changelog type): the plan's Release Recommendation is "ship independently" but explicitly notes the work will not cut its own release — it auto-batches into the next `feat:`/`fix:` release (Refs #479 guidance).
- No architecture-roadmap, README, or package-skill references to `#523` need updating; only AGENTS.md's docs-in-distribution convention changes.
- Next stage is `/build-plan` (no test cycles — packaging config and docs only).

## Stage: Implementation — Build (2026-07-03T00:30:00Z)

### Session summary

Executed all 7 build steps from the plan: added `files` allowlists to `pi-autoformat`, `pi-nocd`, `pi-session-tools`, and `pi-subagents-worktrees`; trimmed the `test` entry from `pi-permission-system` and the dev-file entries (`vitest.config.ts`, `AGENTS.md`, `.prettierignore`) from `pi-subagents`; deleted all six now-redundant `.npmignore` files; rewrote AGENTS.md's docs-in-distribution convention for the single-mechanism end state.
Each step was verified with `pnpm pack` + `tar tzf` before committing, matching the plan's target `files` arrays exactly.

### Observations

- No deviations from the plan — every tarball matched the Design Overview's target `files` arrays on the first attempt.
- `pi-subagents`' `pnpm run verify:public-types` (packs the tarball, type-checks an external consumer against both public entries) passed after trimming its allowlist, confirming the `dist/*.d.ts` bundles still ship correctly.
- No `src/`/`test/` files were touched, so the full test suite was not required by the build-plan protocol; `pnpm run check` and `pnpm run lint` were run after every step regardless.
- Pre-completion reviewer: **PASS** — all deterministic checks green, all 6 tarballs independently re-verified via `pnpm pack`/`tar tzf` to exclude `test/`, `tsconfig.json`, `vitest.config.ts`, `AGENTS.md`, `.pi/`, `.prettierignore`, `docs/plans/`, `docs/retro/` while retaining runtime code, `dist/` type bundles, and user docs; commit messages and AGENTS.md rewrite confirmed accurate.
  No WARN findings.
- Next stage: `/ship-issue`.

## Stage: Final Retrospective (2026-07-03T22:12:22Z)

### Session summary

Shipped the cross-package packaging change across three stages (plan, build, ship) with zero rework: 7 implementation commits landed, CI passed on the first push, and issue #523 closed.
No release was cut — every commit is a `build:` (hidden changelog type) or touches an excluded path, so the work auto-batches into the next `feat:`/`fix:` release per the plan's "ship independently" marker.

### Observations

#### What went well

- **Plan-to-implementation fidelity was exact.**
  Every one of the six packages' tarballs matched the plan's target `files` arrays on the first `pnpm pack` attempt — no allowlist tuning, no dropped runtime files, no follow-up commits.
  The planning-stage decision to enumerate each package's runtime entry, user docs, and extra top-level ship targets in a table paid off directly at build time.
- **Per-step `pnpm pack` + `tar tzf` verification** gave deterministic confidence for a change class (packaging) that has no unit-test coverage.
  `pi-subagents`' `verify:public-types` additionally confirmed the `dist/*.d.ts` bundles still ship after trimming its allowlist.
- **The `ask-user` mechanism fork resolved cleanly via bidirectional feedback** (see below) — a genuine design decision was surfaced and settled before any code was written, so the build stage had no open questions.

#### What caused friction (agent side)

- None material.
  The session had no rework, no `rabbit-hole`, no `instruction-violation`, and no `scope-drift`.
  The one scope-discipline call at build time (declining to also update the new-package checklist in `AGENTS.md`, since the plan scoped the docs change to the docs-in-distribution section only) was correct and required no correction.

#### What caused friction (user side)

- None.
  The user's mid-planning clarifying question was a net positive, not friction (see bidirectional feedback).

#### Bidirectional feedback (a win worth promoting)

- During planning, the initial `ask-user` offered two mechanisms (convert to allowlists vs. extend denylists) for the four no-allowlist packages.
  The user redirected with a **question** rather than a correction — "What did we do for 484?
  Didn't we do both `files` and `.npmignore`?" — which prompted a git-history check (`3282369a`, `3e1bf9c6`) that clarified #484 established a per-package split, not a single mechanism.
  That context reframed the decision from "how to trim the four" to "do we keep the split or standardize all 8," and the operator chose the cleaner standardize-on-allowlists outcome.
  The lesson: a clarifying question that sends the agent back to primary sources (commit history) produced a better plan than either originally-offered option.

### Diagnostic details

- **Feedback-loop gap analysis** — `pnpm run lint` and `pnpm pack` ran after **every** build step (not just at the end), and `pnpm run check`/`pnpm run lint`/`pnpm fallow dead-code` ran again at ship time.
  Incremental verification was used correctly throughout; no gap.
- **Escalation-delay / unused-tool / rabbit-hole lenses** — nothing notable; no error sequences, so no lens produced an actionable finding.
- **Model-performance correlation** — the pre-completion-reviewer subagent was dispatched once during the build stage on a judgment-heavy verification task (tarball-contents inspection across 6 packages + convention-accuracy check); appropriate use of a fresh-context reviewer.

### Changes made

1. Appended this Final Retrospective stage entry to `docs/retro/0523-trim-non-runtime-dev-files.md`.
   No prompt or `AGENTS.md` changes were warranted — the session surfaced no recurring friction or instruction gap.

[#484]: https://github.com/gotgenes/pi-packages/issues/484
