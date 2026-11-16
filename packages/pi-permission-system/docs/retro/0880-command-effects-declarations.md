---
issue: 880
issue_title: "pi-permission-system: commandEffects — user-declared command effects (ADR 0013 §7)"
---

# Retro: #880 — pi-permission-system: commandEffects — user-declared command effects (ADR 0013 §7)

## Stage: Planning (2026-10-16T04:18:48Z)

### Session summary

Planned the `commandEffects` config key as ten TDD steps: two Tidy-First refactors (`option-guards.ts` extraction, `BashParseOptions`), four `refactor:` steps building the scoped config fold, the declaration prover, the collector relay, and the inert-operand projection drop, two `feat:` steps wiring config to the gate and reporting core-shadowed declarations, then the measurement instrument and docs.
The operator settled the two open design questions at the gate: subcommand descent is exact-word, and the pure-reader core wins over a declaration (with a load-time warning).
Release is mid-batch ("declared-effects"); [#881] is the tail.

### Observations

- The issue's design question assumed `bash-arity.ts` could resolve `git -C ~/other log` as `git log`; reading `prefix()` showed it counts tokens and returns `["git", "-C"]`, so ADR 0013 §10's sentence describes no existing mechanism.
  Skipping dash words was rejected as fail-open (`git -C diff commit` would read as `git diff`); an option-value grammar is [#804]'s.
  Measured on the local log (crude regex, 1563 bash asks): 38 `git -C` and 2 `git -c` occurrences stay unproven under exact descent, against roughly 147 direct reader-subcommand forms.
- Following `docs/configuration.md`'s existing `commandEffects` sentence today does worse than a no-op: `unifiedConfigSchema` is strict, so the whole file is rejected and the scope floors to `ask`.
- ADR 0013 §7's `sed`/`sort` examples and the issue's `sed` example are core words since [#924], so they become shadowed declarations; the docs recipe uses `git`, `curl`, and `officecli`.
- `effects: []` is modeled as a `TokenRole` (`inert-operand`), not an effect: the role already decides candidacy.
  `projectRuleCandidates` must record the inert token's absolute spelling before dropping it, or a `bash` deny written against an absolute path would stop matching the command (a fail-open on the `bash` surface).
  Inert tokens carry `{unproven, declared-…}` so a projection that forgets the role fails closed.
- The Tidy-First assessor caught a design defect: putting the scoped map on `PermissionSystemExtensionConfig` would be dropped by `ConfigStore.save()`, which rebuilds the config via `normalizePermissionSystemConfig`.
  The map now lives as a private `ConfigStore` field behind `SessionConfigStore.declaredCommandEffects()`.
  It also corrected the relay count to 7 collectors (about 21 call sites), not 12.
- Fallow zones forbid `config/` → `access-intent/`, so the shadow detector gets `PURE_READER_CORE` injected through `ConfigStoreDeps` from `index.ts`.
- JSON-sourced record lookups need `Object.hasOwn`; a head word `constructor` would otherwise read `Object.prototype`.
- A zod 4.4.3 spike confirmed a getter-recursive entry schema validates and emits `$defs/commandEffectsEntry`; `z.infer` over the getter may still need an explicit interface (risk recorded).
- Third-party PR [#1073] (ancestor project configs) rewrites the same `loadAndMergeConfigs` project step; whichever lands second reconciles.
- boadij's comment asks for agent-specific declarations; that is [#799]'s channel question, left out of scope per ADR 0013 §7/§9.
- No follow-up issues filed: every deferral maps to an existing issue ([#799], [#804], [#881], [#882], [#952], [#926]).

#### Deferred tidyings

- `src/config/config-loader.ts`: the five legacy/global/project blocks in `loadAndMergeConfigs` repeat one load-warn-merge shape; the assessor rejected splitting them as unrelated to this change.
- `test/access-intent/bash/token-collection.test.ts` (1535 lines): restructuring was rejected as scope creep; new declaration tests go to a new file.

## Stage: Implementation — TDD (2026-10-16T05:16:14Z)

### Session summary

All ten planned TDD steps landed, plus one review-driven `feat:` and two docs follow-ups: two Tidy-First refactors, four `refactor:` steps building the fold, prover, collector relay, and inert-role projection drop, two `feat:` steps wiring the key and the core-shadow warning, the measurement instrument, and the docs.
The `pi-permission-system` suite went from 6187 to 6316 tests (+129).
The pre-completion reviewer returned FAIL on the first round and WARN on the delta re-review.

### Observations

- **Guard applied only when a stem is declared (step 5).**
  The core's `optionGuard` retracts on any computed word that may lead with `-`, so an unguarded declaration retracted on `officecli x $(cat ~/a)`; the token-collection role test caught it and `proveDeclaredEffect` now skips the guard when no stem was met.
- **Fold-order mutation needed the reversed command (step 6).**
  Moving the inert skip after the fold only shows when the inert token comes second (`cat ~/x; officecli x ~/x`), so that order joined the test; the plan's single order would have left the mutation alive.
- **Plan deviations.**
  Program-level tests went to a new `program-declared-effects.test.ts` and to `bash-effect-invariants.test.ts` (real resolver, real manager) rather than `program.test.ts`/`program-external-accesses.test.ts`; the schema's `$defs` test gained the fourth entry the plan predicted; the docs recipe dropped `curl`, since `curl -d @file` reads a file and an `effects: []` recipe for it would be unsafe advice.
- **Reviewer FAIL, fixed in `feat(pi-permission-system): ignore and report a commandEffects declaration keyed by a wrapper`.**
  A declaration keyed by a wrapper word (`xargs: read`, `sudo: []`) attributed, or withdrew from the path gates, the inner command's operands, since wrapper words are not core words and fell through to the declarations.
  `collectCommandTokens` now passes no declarations for a head in `WRAPPER_COMMAND_NAMES` (exported from `wrapper-analysis.ts`; the check sits in `token-collection.ts` because `wrapper-analysis.ts` already imports `command-effects.ts`), and config load names such a key beside the core-shadowed ones.
  The plan's invariant table pinned the inner-command case (`xargs git log` with `git log` declared) and missed the wrapper-key case, which is the same invariant entered from the other side.
- **Reviewer non-blocking, fixed.**
  `git log` and `git show` accept `--output=<file>` too, so the recipe, example config, and schema example guard `--output` on `git` itself.
- **Reviewer WARN, documented rather than fixed.**
  Prefix commands outside the floor's list (`command`, `exec`, `builtin`, `busybox`, `ionice`) are still read as ordinary declarations; `docs/configuration.md` now says not to declare one, and the family is [#926]'s territory.
- **Process slip.**
  Twice a green-copy `cp` or a mutation `Edit` ran in the same parallel batch as the call it depended on; once a mutation survived into the tree until the full-suite run caught it.
  The `/tdd-plan` rule against batching an `Edit` with a call that reads or copies the same file is the one that bit.
- **Measured relief** (`scripts/measure-core-coverage.mjs --declarations`, nine-subcommand `git` recipe plus `officecli: []`): recent asks relieved go from 172/975 (17.6%) to 186/975 (19.1%); `git` stays the top blocker because most asked `git` units are writers.
- Pre-completion reviewer: FAIL (round 1, wrapper-keyed declarations), then WARN (round 2, non-floor prefix commands; the retro entry, now written).

[#799]: https://github.com/gotgenes/pi-packages/issues/799
[#804]: https://github.com/gotgenes/pi-packages/issues/804
[#881]: https://github.com/gotgenes/pi-packages/issues/881
[#882]: https://github.com/gotgenes/pi-packages/issues/882
[#924]: https://github.com/gotgenes/pi-packages/issues/924
[#926]: https://github.com/gotgenes/pi-packages/issues/926
[#952]: https://github.com/gotgenes/pi-packages/issues/952
[#1073]: https://github.com/gotgenes/pi-packages/pull/1073

## Stage: Sync (worktree) (2026-10-16T05:19:25Z)

### Session summary

Pre-push `pnpm run lint` and `pnpm fallow dead-code` passed on the branch; the plan's marker is `**Release:** mid-batch — defer (batch "declared-effects")`, so the root's `/ship` must not name `pi-permission-system` for release until #881 (the batch tail) lands.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-880--/2026-10-16T03-52-10-529Z_01a142d6-b820-7617-99e2-dff73c2834c5.jsonl` — read with `read_session_file({ path: "<path>" })`.

### Observations

- No operator decision is open: the second pre-completion review's WARN (prefix commands outside the floor's list) is documented in `docs/configuration.md` and left to #926.
- The close comment should credit boadij's scout-agent report (agent-specific declarations stay #799's question) and the planning-session data point on `git log` pathspecs.

## Stage: Final Retrospective (2026-10-16T05:29:44Z)

### Session summary

One peer session in the `issue-880` worktree ran planning, TDD, and sync; the root session fast-forward-merged the 17 commits, passed CI, closed #880, and deferred the `pi-permission-system` release to the "declared-effects" batch tail ([#881]) at the operator's confirmation.
The `commandEffects` key shipped as three `feat:` commits on six preparatory `refactor:` commits, with the suite growing by 129 tests.
This retro reviewed the peer transcript and the permission review log alongside the stage notes.

### Observations

#### What went well

- Two fresh-context subagents each caught a defect the main session had designed in.
  The Tidy-First assessor found that the scoped map would be dropped by `ConfigStore.save()` before any code existed, and the pre-completion reviewer's FAIL found that a wrapper-keyed declaration (`xargs: read`, `sudo: []`) reached the inner command's operands.
  Both ran on `claude-sonnet-5-5` and both findings shipped as fixes, not WARNs.
- Reading `bash-arity.ts` during planning overturned the issue's own premise (`prefix()` counts tokens and returns `git -C`), and the planning session priced the consequence from the local review log (38 `git -C` asks against roughly 147 direct reader forms) before putting it to the operator.
- Mutation checks did real work: the reversed-order command (`cat ~/x; officecli x ~/x`) was added because the plan's single order left the fold-position mutation alive.

#### What caused friction (agent side)

- `instruction-violation` — the TDD session's `refactor(pi-permission-system): attribute a declared command's operands during token collection` commit failed its `biome` hook, and the retry spelled the message as `git commit -q -F /dev/stdin <<'EOF'`.
  The repo's deny rules (`git commit*-F`, `git commit*-F-`) do not match that spelling; a probe against `BashProgram.parse` and `wildcardMatch` showed the unit text is `git commit -q -F /dev/stdin`, which neither pattern matches.
  It raised two approval prompts (the `external_directory` surface for `/dev/stdin`, then the `bash` surface's `<unparsed-bash-subtree>`), about 75 seconds of operator time by the review log's timestamps.
  The review log holds the same spelling approved once before, on 2026-09-10.
  Self-identified: no; found in this retro.
  Impact: two manual approvals, no rework.
- `instruction-violation` — the plan commit was spelled `docs(pi-permission-system): plan … (#880)`, while `/plan-issue` prescribes `docs: plan <summary> (#N)`.
  `/ship` derives `PLAN` with `--grep="docs: \(re-\)\?plan .*(#N)"`, so `PLAN` came back empty in the ship session and `git diff "$PLAN"^..HEAD` failed with `bad revision '^..HEAD'`.
  The worktree lane's `PRE_MERGE` anchor (`12e693a6`, the plan commit's parent) covered steps 9 and 10, so nothing was missed.
  Measured over history: the unscoped pattern matches 592 plan commits and a scope-tolerant one 595, so the scoped spelling has slipped three times.
  Self-identified: in the ship session, when the command errored.
  Impact: one failed command; a trunk-lane ship, which has no `PRE_MERGE`, would have needed a hand-derived anchor.
- `instruction-violation` — `/tdd-plan`'s rule against batching an `Edit` with a call that reads, runs, or copies the same file was broken at least three times (a green-copy `cp` and a mutation `Edit` in one batch; an `Edit` batched with the `vitest` run over it).
  Once, a mutation stayed in the tree until the full-suite run caught it.
  Self-identified: yes, recorded in the TDD stage note.
  Impact: one manual revert.
- `other` — the sync session's retro `Edit` left a literal `\u2014` inside a code span, where the escape-lint gate does not look; the session saw it and amended the sync commit.
  Impact: one amend.

#### What caused friction (user side)

- The operator cleared the two `/dev/stdin` approval prompts by hand.
  The deny rule's reason string already says what to do instead, so a matching rule would have turned that into feedback to the agent with no human approval needed.

### Diagnostic details

- **Model-performance correlation:** planning and TDD ran on `anthropic/claude-opus-5-5` and the mechanical sync stage on `anthropic/claude-sonnet-5-5`.
  All three subagents (the Tidy-First assessor and both pre-completion reviews) ran on `claude-sonnet-5-5` according to their own transcripts, and each delivered a judgment-level finding, so no mismatch.
- **Feedback-loop gap analysis:** the TDD session ran the cycle-scoped `vitest` file and `pnpm --filter … run check` after every step, plus a full-suite run before each commit; no gap.

### Changes made

1. `.pi/extensions/pi-permission-system/config.json`: added a `git commit*-F /dev/stdin*` deny rule beside the two existing heredoc-commit rules, with the same redirect-to-a-file reason.
   A probe confirmed it matches the unit text `git commit -q -F /dev/stdin` and not `git commit -F /tmp/msg.txt`.

Proposed and declined by the operator: widening `/ship`'s plan-commit grep to accept a scoped `docs(<pkg>): plan` subject.
