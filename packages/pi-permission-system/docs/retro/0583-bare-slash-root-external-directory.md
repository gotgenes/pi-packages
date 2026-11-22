---
issue: 583
issue_title: "pi-permission-system: bare-slash `find /` bypasses the external_directory gate"
---

# Retro: #583 — bare-slash `find /` bypasses the external_directory gate

## Stage: Planning (2026-07-13T00:00:00Z)

### Session summary

Traced the `find /` bypass to the `/^\/+$/` bare-slash branch in `rejectNonPathToken` (`src/access-intent/bash/token-classification.ts`), the single point that drops `/`, `//`, `///` before all three bash classifiers.
Confirmed downstream resolution needs no change — a `/` candidate resolves external (`isBoundaryOutsideWorkingDirectory("/")` is `true`, `/` is not a safe system path) and `//`/`///` normalize to `/`.
Wrote a single-cycle `fix:` plan that removes the branch and inverts the encoding tests.

### Observations

- Classified as a non-breaking `fix:`, not `fix!:` — matches sibling gate-tightening fixes #481 and #490, which both added new prompts under `fix:`.
  No config default changes; the fix only makes the `external_directory` gate honor its already-documented `ask` default where a token escaped it.
- The `echo /` now-prompts behavior change is deliberate and consistent with the command-agnostic path model (`echo /etc/passwd` already prompts).
  Surfaced it explicitly in Risks rather than treating it as an alternative; no `ask-user` gate needed since author is the operator and the direction is unambiguous.
- The two `bash-external-directory.test.ts` "guard is still needed" tests encode the removed branch as necessary defense-in-depth — they are deleted, not migrated, since their premise is now false.
- Left the historical plan `0533-win32-git-bash-posix-paths.md:151` parenthetical about the bare-slash rejection unchanged (completed plan record; its `//server/share` conclusion stays correct).
- Ships independently — no roadmap step references #583.

## Stage: Implementation — TDD (2026-07-13T19:41:00Z)

### Session summary

One red→green→commit cycle implemented the whole fix: removed the `/^\/+$/` bare-slash branch from `rejectNonPathToken` (`src/access-intent/bash/token-classification.ts`) so a bare `/`, `//`, `///` reaches the external_directory and path surfaces, and inverted/rewrote the tests that encoded the dropped behavior.
Tidy-First assessor reported no preparatory tidying warranted (single-branch subtraction, already-atomic tests).
Test count unchanged at 2387 (net-zero: 2 unit tests inverted in place, 7 integration tests rewritten 1:1 including a new `find /` regression test replacing the two deleted "guard is still needed" tests).

### Observations

- Empirically confirmed during GREEN that `//` and `///` normalize to lexical `/`, so the resolved external set is `["/"]` for all three — the plan's predicted expectation held exactly.
- No deviations from the plan.
  `find /` now resolves to external root `["/"]`; verified `pnpm run check`, root `pnpm run lint`, full `pnpm run test` (2387), and `pnpm fallow dead-code` all green; no lockfile changes.
- Pre-completion reviewer: WARN (single non-blocking finding) → resolved.
  It caught a stale "seven shared rejection cases" comment in the test file header (line 13) that mirrored the source-module comment I had already corrected to "six"; fixed and amended into the fix commit before it was pushed.
- Deliberately left the historical plan `0533-win32-git-bash-posix-paths.md` parenthetical unchanged, as the plan specified.

## Stage: Final Retrospective (2026-07-13T20:05:00Z)

### Session summary

A single session carried #583 end-to-end: live-repro bug confirmation, issue authoring, planning, one-cycle TDD, and shipping `pi-permission-system` v20.5.0.
The root cause (the `/^\/+$/` branch in `rejectNonPathToken`) was diagnosed on the first trace, the plan predicted the `["/"]` resolution exactly, and TDD landed with zero deviations.
Friction was minimal — one absolute-path typo (caught by the very gate under repair) and one mirror-comment miss (caught by the pre-completion reviewer before push).

### Observations

#### What went well

- Clean diagnosis-to-fix arc: the bug was traced to a single predicate branch on first read, and every downstream prediction held — `//`/`///` normalizing to lexical `/`, the `["/"]` external set, and the net-zero test count were all correct in the plan before implementation.
- The pre-completion reviewer earned its keep: it caught a stale "seven shared rejection cases" comment in `token-classification.test.ts:13` that mirrored the source-module header I *had* corrected ("seven" → "six") but whose test-file twin I missed.
  Caught before push, fixed via amend — no `style:` follow-up commit needed.
- Correct handling of the release-please merge edge case: `release_pr_merge` refused with `UNSTABLE`, but `statusCheckRollup` showed a real `check` job `IN_PROGRESS` (not the empty-rollup `GITHUB_TOKEN` case), so I waited two poll cycles for it to finish and retried `release_pr_merge` rather than falling back to a manual `gh pr merge` while a check was running — exactly the step-6.4 protocol.

#### What caused friction (agent side)

- `other` (absolute-path typo) — during planning a `Read` used `/Users/chris/development/pi/pi-permission-system/packages/pi-permission-system/test/bash-external-directory.test.ts`, collapsing `pi-packages` into `pi-permission-system`.
  The permission system denied it as an `external_directory` access.
  Impact: one retry with the corrected path, no rework.
  Notable irony — the gate under repair caught my own mistake; a reminder that relative paths avoid this entirely.
- `other` (mirror-comment miss) — fixed the rejection-case count in the source module header but not the identical comment in the sibling test file; relied on the reviewer to catch it.
  Impact: one amend into the unpushed fix commit, no rework.

#### What caused friction (user side)

- None.
  The user's interventions were well-placed: confirming the bug reproduced ("Do we agree we have a bug?"), then delegating the standard flow.
  No mechanical oversight was required.

### Diagnostic details

- **Model-performance correlation** — both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `anthropic/claude-sonnet-5`, appropriate for read-only judgment work; the reviewer's WARN finding confirms the model was capable of the self-consistency check.
  No mismatch.
- **Escalation-delay tracking** — no `rabbit-hole` friction; the longest same-target loop was the deliberate 3-cycle poll of the release PR's in-progress check, which is correct protocol, not an escalation delay.
- **Unused-tool detection** — none missed.
  `grep`/`Read` were the right tools for a single-symbol trace (`rejectNonPathToken`, `^\/+$`); a semantic `colgrep` would have added noise.
- **Feedback-loop gap analysis** — verification was incremental: RED confirmed before GREEN, affected-file tests during the cycle, then full `test`/`check`/`lint`/`fallow` after.
  No end-only batching.

### Changes made

1. Appended this Final Retrospective stage entry to `packages/pi-permission-system/docs/retro/0583-bare-slash-root-external-directory.md`.
2. No `AGENTS.md` or `.pi/prompts/` changes — the operator confirmed retro-file-only; both friction points were one-retry, no-rework, and already absorbed by existing safety nets (the `external_directory` gate and the pre-completion reviewer).
