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
  Extending the lint rule repo-wide would flag 76 sites in `pi-subagents`, which `issue-870` holds right now.
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

[#870]: https://github.com/gotgenes/pi-packages/issues/870
[#877]: https://github.com/gotgenes/pi-packages/issues/877
