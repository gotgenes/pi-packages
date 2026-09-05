---
issue: 837
issue_title: "pi-permission-system: 42% of src files sit at the package root, in a package that already has the directories for them"
---

# Retro: #837 — Apply the package's directory vocabulary to the `src/` root

## Stage: Planning (2026-09-04T23:08:40Z)

### Session summary

Planned Phase 14 Step 13 — the bulk reorganization of `pi-permission-system`'s 64 root `src/` files into seven new domain directories plus three existing ones, with the `test/` tree mirrored and the resulting layout written into `docs/architecture/architecture.md` as a convention.
Four operator gates settled the partition depth (root 64 → 5), the import-specifier policy, the test mirroring, and per-directory commit granularity.
The plan is `docs/plans/0837-apply-directory-vocabulary.md`; a follow-up ([#877]) was filed for the repo-wide lint rollout.

### Observations

- **The issue's own counts were stale.**
  The body reports 62 root files at 27.1.2; the working tree has 64 (`restrictiveness.ts` and `approval-grant.ts` landed since).
  The roadmap step's title and Outcome still say 62 and should be read as approximate, not as an assertion to verify against.
- **A live convention is being superseded, not merely ignored.**
  `architecture.md:1012` records "grow a domain directory in the phase that rewrites its files, never as a big-bang move", originating as a Phase 8 non-goal and re-applied in Phase 13's directory check.
  The Step 13 sweep disposition already overrules it by operator decision, but nothing said so in the convention's own location.
  The plan makes the supersession an explicit deliverable of the documentation commit, so the rule is not restored later on the strength of the same two phase histories.
- **The operator's stated import rule turned out to be the repo's recorded one.**
  The gate asked what convention exists; the answer was in the header comment of the hand-written `noParentRelativeImports` ESLint rule ("Same-directory `./` imports are intentionally allowed").
  Only the parent-relative half is enforced, which is the same unguarded-prose failure mode the issue diagnoses for the directory layout.
  That symmetry is what turned the guard from a nice-to-have into a plan step.
- **The Tidy-First assessor corrected three of my measurements.**
  Own-directory alias imports are 101 in `src/` (not 92) — my loop used `find -mindepth 2` and so missed 9 in root files, where the "own directory" is `src/` itself.
  Mixed-style files are 9, not 15 — my pattern degenerated to "any `#src/` import" for root files.
  `test/` is 14, exact.
- **It also refuted my stated rationale.**
  I justified the conformance pass as shrinking each move commit's import churn; only 9 of 101 `src/` fixes and 0 of 14 `test/` fixes are in files any move touches.
  The pass is real but justified as the precondition for enabling the rule.
  The plan says that, and the step-1 commit body is instructed to say it too.
- **Two findings the design would have shipped as defects.**
  `scripts/generate-permissions-schema.ts:10` imports `../src/config-schema.ts` from outside `tsconfig`'s `include` and outside CI, so a broken specifier there fails silently.
  And eight `vi.mock` calls across six test files name moving modules by `../src/…` relative path — a `CallExpression` argument, invisible to both the existing ESLint rule and its planned extension, so a `#src/`-only sweep would have broken six test files quietly.
  Both are now explicit plan steps.
- **The sharpest risk is a lint guard that stops matching.**
  `eslint.config.js:192` pins `src/permission-manager.ts` for the ADR-0002 `AccessPath` ban; the file moves to `policy/`.
  A stale `files:` glob disables the rule with `tsc`, the suite, and `eslint` all reporting success.
  Step 8 therefore probes both package-scoped guards with a real forbidden import rather than eyeballing the glob.
- **Alternatives considered and rejected.**
  A `util/` directory for `value-guards`/`async-cache`/`json-safe-stringify` — rejected as a bag that would re-accumulate what this issue clears; `async-cache` went to its sole consumer's directory and the other two to real domains.
  Moving `service.ts` under `service/` (option C at the gate) — rejected in favour of leaving the `exports` map, rollup input, and `verify:public-types` untouched.
  `#src/`-everywhere (pi-subagents' actual practice, zero relative imports across 66 files and 8 subdirectories) — rejected because it contradicts the repo's recorded convention and would be a repo-wide decision, not a per-package one.
- **A peer-worktree collision shaped the scope.**
  Extending the lint rule repo-wide would flag 80 sites in `pi-subagents`, which `issue-870` holds right now.
  The rule is scoped to `packages/pi-permission-system/**` via a `files:` block — matching the two package-scoped blocks already in that file — and the rollout is [#877].

#### Phase handoff

Step 13 is Phase 14's last unmarked step (16 total, 15 already `✅`), so `/finish-phase` for the capability-axis phase becomes available once this lands.

#### Roadmap disposition owed to pi-subagents

[#877] carries `pkg:pi-subagents`, and `pi-subagents` has an open Phase 22 (Front-door contract parity and delivery fixes).
Operator disposition: **deferred to a later phase, with rationale** — Phase 22's cause is front-door contract parity, and an import-specifier lint convention shares neither its mechanism nor any step's sequencing.
The bullet is deliberately **not** written yet: `issue-870` holds `packages/pi-subagents/docs/architecture/architecture.md` and edits the same `#### Open-issue sweep dispositions` list.
Write it there after [#870] lands, before Phase 22 closes.

#### Deferred tidyings

- `src/authority/` (18 files), `src/access-intent/` and `access-intent/bash/` (12), the pre-existing members of `src/path/` (4) and `src/presentation/` (8), `src/handlers/` (1), and `test/helpers/` (6) — 106 own-directory alias imports the assessor rejected as scope creep *for the move*.
  They are nonetheless in this plan's step 1, because the ESLint rule cannot be enabled while they report as errors.
  Recorded here so the rejection and the override are both visible.

## Stage: Implementation — TDD (2026-09-05T03:36:36Z)

### Session summary

Executed all 14 plan steps as 15 commits: three preparatory (import conformance, the new lint rule, `vi.mock` specifier normalization), ten move commits, one documentation commit, and one correcting a figure the pre-completion reviewer caught. 59 of 64 `src/` root modules and 65 of 71 `test/` root files moved into ten destinations, leaving the five entry points and package-wide leaves the plan predicted.
Test count held at 157 files / 4117 tests at every commit — the invariant that separates a moved test from a silently uncollected one.
Pre-completion reviewer: **WARN** (no blocking findings).

### Observations

- **`tsc` verifying the rewrite "exhaustively" was the plan's most load-bearing wrong claim.**
  Three classes of module reference are invisible to it, and each was found by a probe rather than a gate.
  `scripts/generate-permissions-schema.ts` imports `config-schema` by relative path from outside `tsconfig`'s `include`; with the stale import in place `tsc` still exits 0 and no workflow runs `gen:schema`.
  `test/config-schema.test.ts` resolves two files through `import.meta.dirname` + `".."`.
  And nine `vi.mock`/`typeof import(...)` specifiers named modules by `../src/…` — a `CallExpression` argument is not an `ImportDeclaration`, so neither lint rule nor a `#src/`-keyed grep reaches them.
- **A `files:`-scoped lint guard fails permissively, and the biome one fails invisibly.**
  Reverting the biome pin to its stale path surfaces `expand-home.ts`'s live `"${HOME}"` only as a *warning*, so `biome check` exits 0 and `pnpm run lint` reports PASS with the exemption voided.
  The plan predicted the pin "is silently voided otherwise"; the measurement was worse than that — not even the linter's exit code catches it.
  A biome pin's gate is a finding count, never an exit status.
- **Both eslint guards were probed at their new paths rather than eyeballed**, and both fired: an `AccessPath` import in the moved `permission-manager.ts`, a `process.platform` read in the moved `rule.ts`.
  The second glob is depth-agnostic and was expected to survive; confirming one of a pair proves nothing about the other.
- **The same counting error was made twice and caught twice.**
  The Tidy-First assessor corrected my own-directory import count for `pi-permission-system` (101, not 92) because my loop used `find -mindepth 2` and skipped package-root files, where a `#src/<sibling>` import is an own-directory violation.
  I fixed it for that package and never re-ran it for `pi-subagents`, so the sibling figure shipped as 76 into five documents and the body of [#877].
  The pre-completion reviewer caught it by running the actual rule: 80 (72 `src/`, 8 `test/`).
  Re-running the *corrected* command against every input it applies to would have closed this the first time.
- **The release rationale in the plan was wrong and was corrected in place.**
  The plan reasoned that `refactor:`/`test:`/`ci:`/`docs:` are all skipped changelog types.
  `^docs` is a **visible** group in `cliff.toml`, and the documentation commit touches three shipped, non-release-excluded user docs, so `next-version.sh` now prints `pi-permission-system-v31.1.1`.
  That is the right outcome — those docs ship in the tarball and their content changed — but the plan asserted the opposite.
  Reasoning about release from commit types instead of running the script is what produced it.
- **Two deviations from the plan.**
  `test/bash-external-directory.test.ts` could not move to `test/handlers/gates/` under its own name (a file by that name already tests the gate); it landed as `bash-path-extractor.test.ts`, matching the `src/` module it actually exercises and which had no test of its own.
  And the new ESLint rule covers `ExportNamedDeclaration`/`ExportAllDeclaration` as well as imports, because one own-directory re-export exists in `access-intent/bash/`.
- **The module tree carried a stale entry predating this change** — `handlers/gates/index.ts`, listed but not on disk.
  Found only because the tree was verified against the filesystem programmatically rather than read; the reviewer independently confirmed 152 entries against 152 files.
- **The permission prompts during this session were measurable, and the guess was wrong in an instructive way.**
  The operator reported heavy prompting; my first three hypotheses (chain length, bare-token promotion after `cd`, `/tmp` traffic) all produced *zero* prompts.
  The review log showed 4 prompts in 4 hours, all `bash`/`<unparsed-bash-subtree>` — one per heredoc commit.
  Because that floor is synthesized after the resolver returns, no `bash:` allow rule can suppress it.
  Switching commit messages from `git commit -F - <<'EOF'` to a `Write`-authored file plus `git commit -F <file>` eliminated them.
  Worth noting for [#875]: Step 14 measured this floor's cost at 0.038% of logged commands, but against this repo's own Conventional-Commit workflow it was 4 for 4.

### Reviewer warnings

- The `pi-subagents` own-directory count was cited as 76 in five places and measures 80.
  Corrected in the plan, this retro, the architecture roadmap, the rule's comment, and [#877]'s body before the rollout could inherit it.

## Stage: Sync (worktree) (2026-09-05T03:40:20Z)

### Session summary

Pre-push checks pass clean: root `pnpm run lint` and `pnpm fallow dead-code` both exit 0.
No deferred work rides this branch — all 14 plan steps landed, the pre-completion reviewer's one WARN (the `pi-subagents` count) was corrected in place before this stage.
Plan's `**Release:**` marker is `ship independently`; `./scripts/release/next-version.sh pi-permission-system` prints `pi-permission-system-v31.1.1` (corrected from the plan's original "no release" claim during implementation — the documentation commit touches three shipped user docs, and `^docs` is a visible changelog group).
Follow-up [#877] (repo-wide own-directory lint rollout, deferred against `pi-subagents` Phase 22) is filed and open; its roadmap disposition bullet is intentionally **not yet written** to `pi-subagents/docs/architecture/architecture.md` — `issue-870` holds that file, and the bullet lands after it does.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-837--/2026-09-04T19-12-08-237Z_01a06dd5-e02c-734c-a240-5e977df91527.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

Nothing new since the TDD stage note — this session ran only the pre-push gates and this breadcrumb.
The final `/retro 837` is deliberately not run here; it runs at the root after `/ship-worktree 837`.

[#870]: https://github.com/gotgenes/pi-packages/issues/870
[#875]: https://github.com/gotgenes/pi-packages/issues/875
[#877]: https://github.com/gotgenes/pi-packages/issues/877
