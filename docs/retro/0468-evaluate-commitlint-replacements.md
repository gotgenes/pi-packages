---
issue: 468
issue_title: "Evaluate commitlint replacements (convco, cocogitto, committed) for commit-message linting"
---

# Retro: #468 — Evaluate commitlint replacements (convco, cocogitto, committed)

## Stage: Planning (2026-06-24T00:00:00Z)

### Session summary

Produced an evaluate-and-execute plan for replacing the `commitlint` `commit-msg` gate with one of `convco` / `cocogitto` / `committed`.
The plan defines a four-fixture harness (the two acceptance cases plus the two correct breaking forms), a decision matrix, a best-fit-per-tool distribution table, and a new `docs/decisions/` ADR as the durable deliverable.
Confirmed via `ask_user` that the operator wants the swap executed in-cycle if a candidate wins, the comparison recorded as an ADR, and distribution chosen per winning tool.

### Observations

- The `pkg:pi-subagents` label is incongruent — the gate is monorepo-wide root infra, so the plan lives in `docs/plans/` (same call as predecessor [#457], whose `pkg:pi-permission-system` label was also incongruent).
- Release recommendation is **ship independently**: no package source changes, no roadmap batch tag for `#468`.
- Key empirical uncertainty deferred to implementation: whether each tool rejects `feat!(scope):` (the load-bearing `!`-placement guarantee from [#452]/[#457]), and whether `convco check` can lint a single pending message file at all (it is built for commit ranges / `pre-push`, a likely disqualifier for the `commit-msg` use case).
- Distribution landscape: `rumdl` is the precedent (prek remote-repo hook + npm-wrapper devDep used by `pnpm run lint`).
  `committed` has a first-party prek repo (cleanest fit); `cocogitto`/`convco` would need a `mise` `[tools]` entry (the repo provisions no managed tools today — `mise.toml` is `[env]`-only).
- `fallow` runs `unused-dev-dependencies: error` in CI — a commit-msg-only npm-wrapper devDep has no script call site (unlike `rumdl`), so the plan prefers prek/`mise` provisioning and flags `.fallowrc.json` `ignoreDependencies` as the fallback.
- Doc-grep for the removed `commitlint` symbol found only `README.md:63`, `AGENTS.md:207`, `AGENTS.md:218`; no `package-*/SKILL.md` reference.
  `docs/decisions` must be added to `release-please-config.json` `exclude-paths` (root-level dir does not exist yet).
- No follow-up issue filed — the swap is in-cycle, and the CI-backstop / commitlint-custom-parser items stay deferred (Open Questions) without speculative issues.

## Stage: Implementation — Build (2026-06-24T00:00:00Z)

### Session summary

Executed all four build steps (Branch A — a candidate won).
Installed `convco`, `cocogitto`, and `committed` via `brew` and ran the four-fixture harness: all three cleared the acceptance bar (case1 `#N`-body pass, case2-before `feat!(scope):` fail, case3-after / case4-noscope pass).
The tie-break selected `committed`; wired it as a `prek` remote-repo `commit-msg` hook (`crate-ci/committed` `v1.1.11`) with a repo-root `committed.toml`, removed `commitlint` config + devDeps, authored the ADR, and updated `AGENTS.md` / `README.md`.

### Observations

- All three candidates support single-pending-message linting — the plan's worry that `convco check` could not was resolved by its `--from-stdin` flag (`cog verify --file -`, `committed --commit-file -` likewise).
  So the choice fell entirely to the tie-break, not the acceptance bar.
- `committed` is the only candidate with a first-party `.pre-commit-hooks.yaml` (`stages: [commit-msg]`, `language: python` prebuilt-wheel — the same mechanism as the repo's existing `rumdl` remote hook); `convco`/`cocogitto` return 404 for that file, so each would have needed `brew`/`mise` PATH provisioning.
  This made `committed` self-provisioning via `prek install` with no PATH dependency — decisive.
- `committed` only enforces conventional format with `style = "conventional"`; its defaults (`subject_capitalized`, `subject_length = 50`, `style = "none"`) reject the repo's lowercase conventional subjects, so `committed.toml` disables those and sets `subject_length = 120`, `line_length = 0`, and `allowed_types` aligned with release-please.
- The load-bearing `!`-placement rejection was verified **live** through the installed prek hook (rejected `feat!(pi-subagents): bad placement test`, exit 1), not just via the binary; the config validated cleanly against `HEAD~80..HEAD` of real history.
- No npm devDependency was added (the gate is a prek remote-repo hook), so the `fallow unused-dev-dependencies` risk the plan flagged did not materialize — `fallow dead-code` is clean.
- The `mise` `[tools]` distribution path the plan listed for `cocogitto`/`convco` was not needed, since `committed` won.
- Pre-completion reviewer: **PASS** — ready for `/ship-issue`.
  No WARN findings (the 3 `useTemplate` biome infos in pi-permission-system are pre-existing and unrelated).

## Stage: Final Retrospective (2026-06-25T02:00:00Z)

### Session summary

Shipped the `commitlint` → `committed` swap, but the first CI push failed on the `release-please` job with `Bad credentials`.
Diagnosed it as secondary rate-limiting from release-please walking the default 500-commit history every run, then fixed it by pinning an auto-advanced `last-release-sha` baseline (`release-please-config.json` + a `ci.yml` write-back step), dropping the walk to ~29 commits.
Closed #468 once CI went green (the swap releases nothing — root paths only).

### Observations

#### What went well

- The `ask_user` gate before implementing the deep-walk fix surfaced the `commit-search-depth`-vs-`last-release-sha` choice and let the user's domain knowledge redirect to the adaptive solution **before** any code was committed — the gate did its job, catching a wrong-shaped fix pre-implementation.
- Infra changes were verified empirically: CI run `28140425763` showed the walk drop 500 → 29 commits with no `Bad credentials`, and the jq SHA extraction was validated locally plus `actionlint` before the write-back commit landed.
- The diagnosis was linear and efficient (run logs → secret metadata → run history → per-component tag depths → release-please config research), no flailing.

#### What caused friction (agent side)

1. `missing-context` (user-caught, indirectly) — the write-back step was first written against `steps.release.outputs.sha`, which is **empty in this repo**: all components live at non-root paths, so release-please emits only path-prefixed `<path>--sha`, no top-level `sha`.
   The `[ -z "$RELEASE_SHA" ]` guard would have made the write-back a silent, permanent no-op.
   It surfaced only because the user asked how rebase-merge affects the SHA, which prompted reading the action's output contract — a check that belonged **before** authoring the step.
   Impact: required fix commit `56d21ea5`; would have shipped a silent no-op otherwise.
2. `premature-convergence` (mild) — first leaned toward `commit-search-depth` (a fixed constant) as the simple fix; it is the wrong shape for a high-volume, release-batching monorepo, where the walk counts **total** repo commits (~40/day), not per-package.
   Reframed to the adaptive `last-release-sha` only after the user's two probing questions.
   Impact: extra conversational rounds, no rework — the `ask_user` gate caught it before implementation.

#### What caused friction (user side)

- The PAT-switch context arrived during diagnosis rather than at ship time; volunteered promptly when relevant, so minimal impact and not really actionable.
- The user's domain knowledge (rebase-merge of the release PR, total commit volume, release batching) drove the correct solution shape through **redirecting questions** rather than corrections — the high-value bidirectional pattern.
  The rebase-merge question in particular caught the latent `<path>--sha` bug before it merged.

### Diagnostic details

- **Unused-tool** — for the `missing-context` bug, `fetch_content` (or `curl`) could have confirmed the release-please output contract before authoring the step; it was available and was ultimately what found the answer, just reactively.
- **Feedback-loop gap** — strong overall (CI-verified the read-side fix; `actionlint` + local jq test before the write-back commit), with one gap: commit `8a16681d` landed before the action's output contract was verified, which the `missing-context` finding covers.
- **Escalation-delay** — no sequences over 5 consecutive tool calls on one error.
- **Model-performance** — no subagents this session (the `pre-completion-reviewer` ran in the Build session); nothing notable.

### Deferred follow-up

- Migrating release-please auth from the fine-grained PAT to a GitHub App token (`actions/create-github-app-token`) — optional hygiene (no token expiry, higher secondary-rate-limit headroom), explicitly deferred by the operator since the deep-walk fix removed the failure trigger.
  File an issue if/when the PAT expiry becomes a maintenance burden.

### Changes made

1. `AGENTS.md` — added a 3-sentence note after the rebase-merge release guidance documenting the `last-release-sha` baseline + `ci.yml` write-back (do-not-remove), and the path-prefixed `<path>--sha` output gotcha (no top-level `sha` in this non-root-component monorepo).
