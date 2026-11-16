---
issue: 1077
issue_title: "pi-permission-model-judge: the test fixture's PromptPayload lacks matchedSpelling and decidingPath"
---

# Retro: #1077 — pi-permission-model-judge: the test fixture's PromptPayload lacks matchedSpelling and decidingPath

## Stage: Planning (2026-10-17T03:53:49Z)

### Session summary

I ran the real bump to `@gotgenes/pi-permission-system` 40.3.0 (the first version with `decidingPath`) in the worktree, then reverted it.
It breaks three things, not the one the issue predicted: the payload fixture (TS2739), `makeService()` in `test/extension.test.ts` (TS2322, three new `PermissionsService` methods), and the loading of `test/extension.test.ts` at runtime.
The plan has two steps: a `test:` commit that drops the judge's Vitest `#src`/`#test` alias, then a `build:` commit that bumps the dev pins and repairs the fixtures.

### Observations

- **The runtime break is a resolver collision, not a packaging defect.**
  The published `src/service.ts` value-re-exports through its own `#src/...` subpath imports.
  The judge's global Vitest `resolve.alias` maps every `#src` (a dependency's included) into the judge's `src/`.
  With the alias removed, Vite resolves `package.json` `imports` per package, and 69 of 69 tests pass on both 27.0.0 and 40.3.0.
  The alias dates from #157, when the mapping existed only in tsconfig `paths`.
- **Operator decisions.**
  Bump `@earendil-works/pi-ai`/`pi-coding-agent` to 1.0.0 too, which clears the unmet `>=1.0.0` peer that 40.3.0 declares (the bump #1005 deferred).
  Remove the alias in the judge only, and file the repo-wide sweep as #1078.
  Prune the `minimumReleaseAgeExclude` versions the bump orphans (`27.0.0`, `0.84.4`).
- **`pnpm add` edits the exclude list itself.**
  It rewrote the entry to `'@gotgenes/pi-permission-system@27.0.0 || 40.3.0'`, matching #788's retro.
- **#1078 notes that `pi-nocd` and `pi-session-tools` have no `imports` field.**
  Their alias is load-bearing, so the sweep is not a blind deletion.
- The tidy-first assessor recommended no tidying beyond the alias-removal step.
  It confirmed that `makeService()` has two callers and that `src/` reads only `getPermissionsService`/`registerAuthorizer`.
- No architecture doc or open phase for this package, so `roadmap-fit` exited at Step 1 for #1078.

#### Deferred tidyings

None — the assessor's rejected items (dropping tsconfig `paths`, a shared `makeService` fixture, a payload builder) were declined as unnecessary, not deferred.

## Stage: Implementation — TDD (2026-10-17T04:27:14Z)

### Session summary

I completed both TDD steps as planned: the `test:` commit that drops the judge's Vitest `#src`/`#test` alias, then the `build:` commit that bumps the dev pins to `pi-permission-system` 40.3.0 and Pi 1.0.0 and repairs the two test literals.
The test count is unchanged at 69; `src/` and `peerDependencies` are untouched, and `next-version.sh` reports nothing to release.

### Observations

- No deviations from the plan.
  Every red, green, and killing mutation produced the result the plan predicted.
  - Step 1: pointing `#src/*` at `./lib/*` failed all 7 test files.
  - Step 2: deleting `decidingPath` gave TS2741, deleting `isToolFullyDenied` gave TS2322, and restoring the alias reproduced `Cannot find module '#src/service/permission-events'` (1 file failed, 55 passed).
- `pnpm add` again added `minimumReleaseAgeExclude` entries automatically, rewriting the entry as `27.0.0 || 40.3.0`.
  The prune that followed was gated on `grep -c '0\.84\.4\|27\.0\.0' pnpm-lock.yaml` reporting 0, and `pnpm install --frozen-lockfile` passed afterward.
- Pre-completion reviewer: PASS.
  It independently enumerated every `#src`/`#test` specifier in the judge and confirmed that no workspace package depends on a pruned version.

## Stage: Sync (worktree) (2026-10-17T08:09:39Z)

### Session summary

Root `pnpm run lint` and `pnpm fallow dead-code` both passed before the rebase.
The plan's `**Release:**` marker is `ship independently`, with only `test:` and `build:` commits, so `/ship` should find nothing to release for `pi-permission-model-judge`.
The follow-up for the repo-wide `#src` alias sweep is filed as #1078.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1077--/2026-10-17T03-44-40-941Z_01a147f6-37ec-76cb-b732-afe4619c93b9.jsonl` — read with `read_session_file` for message-level verification at land/retro time.

### Observations

- `/ship` should confirm `./scripts/release/next-version.sh pi-permission-model-judge` prints nothing rather than dispatch a release.
- The `build:` commit touches `pnpm-lock.yaml` and `pnpm-workspace.yaml`; a peer landing first with lockfile changes would conflict, and the rebase would stop for the operator.

## Stage: Final Retrospective (2026-10-17T15:50:23Z)

### Session summary

The worktree lane ran four stages: planning, TDD, and sync in one peer session, then ship at the root.
The ship landed `23c08264` by fast-forward merge, CI passed on its first run, #1077 closed citing `d6c7e721`, and no release was dispatched because `next-version.sh` printed nothing for the judge.
No stage needed rework: the plan's predictions held at every red, green, and killing mutation, and no stage was re-run.

### Observations

#### What went well

- **Planning measured the real bump and did not trust the issue's prediction.**
  The issue predicted one TS2741 on the fixture and stated that the fixture was the only code that constructs the type.
  A first spike typechecked against the downloaded `public.d.ts` through tsconfig `paths`, which can see only compile-time breaks.
  The real `pnpm add` followed by `vitest run` surfaced the other two: the `makeService()` TS2322 and the runtime `#src` alias collision.
  Planning cost about 48 tool calls before the single `ask_user` gate, and that up-front measurement is why TDD had zero deviations.
- **A killing mutation for a config-only `test:` step.**
  Pointing `package.json`'s `#src/*` at `./lib/*` failed all 7 test files, which proves that the `imports` field (not some leftover alias) is what resolves the specifiers after the alias is removed.
  That is a reusable shape for any commit that only deletes configuration.
- **Model routing matched the work.**
  Planning and TDD ran on `claude-opus-5-5`; sync and both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `claude-sonnet-5-5`, per their transcripts.
  Both reviews were correct and independently re-derived their claims (every `#` specifier enumerated; the lockfile grepped for the pruned versions).

#### What caused friction (agent side)

- `other` — the `pre-completion-reviewer` definition hard-codes its valid Conventional Commits types as `feat`, `fix`, `docs`, `test`, `refactor`, `style`, `chore`, `ci`, and says to FAIL any other.
  `committed.toml`'s `allowed_types` also allows `build`, `perf`, and `revert`, and this issue's `build(pi-permission-model-judge):` commit fell into the gap.
  The reviewer reasoned past it ("`build` is not in this reviewer's listed valid types, but … I treat it as valid").
  Impact: no rework, but a literal reading of the definition would have produced a false FAIL on a `build:` commit.
- `other` — in the ship session, one stray `sleep 1` tool call and a meaningless `[ $? ]` in the merge-and-lint batch.
  Impact: one wasted call, no rework.

#### What caused friction (user side)

- None.
  The operator's one involvement was the planning gate (bump Pi to 1.0.0 as well, remove the alias in the judge only, prune the exclude list), which was a strategic decision rather than oversight.

### Changes made

1. `.pi/agents/pre-completion-reviewer.md`: the commit-type check now defers to `committed.toml`'s `allowed_types` instead of its hand-written list of eight types, which omitted `build`, `perf`, and `revert`.
