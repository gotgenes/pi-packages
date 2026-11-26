---
issue: 1108
issue_title: 'pi-permission-system: agent frontmatter "*": deny does not override a global allow'
---

# Retro: #1108 — pi-permission-system: agent frontmatter "*": deny does not override a global allow

## Stage: Planning (2026-11-26T04:19:27Z)

### Session summary

Reproduced the third-party report through `FilePolicyLoader` over real config and agent files.
Prototyped the per-scope fold in place: the full suite went 6562 passed / 1 failed, and the failing test encodes the bug.
Planned the fix as a new pure `composeScopes` (`src/policy/scope-composition.ts`) that replaces `mergeScopesWithOrigins` and its origin map, in five steps: a test reorder, two `fix!:` steps, one `fix:` step, and docs.
Filed #1147 (a pattern map under the universal `"*"` is accepted and ignored); the operator folded it into #1127, and that disposition is committed separately.

### Observations

- Operator decisions at the gate:
  - direction: per-scope rule bands (the roadmap Outcome), not a reorder inside `mergeFlatPermissions`;
  - the universal `"*"` stays the fallback ("least surprising as a user"), not a rule that overrides earlier scopes;
  - "Align it now" for `config-loader.ts`'s `mergeFlatPermissions`, which feeds only `detectPermissiveBashFallback`.
- The operator asked what "first/last scope" meant and which checks reach `permission["*"]` before answering.
  The first gate assumed those terms were understood; lead with the slot table next time.
- The operator also assumed the `config-loader.ts` merge was legacy configuration.
  It merges the current `config.json` files too (only its `permission` half is down to one reader), so the question was re-asked with that context.
- The design drops an earlier rule whose `(surface, pattern)` a later scope redefines: it moves rather than duplicates.
  Without the drop, `synthesizeBaseline` would see a shadowed `mcp` allow and `/permission-system show` would list each redefined pair twice.
- The Tidy-First assessor confirmed `writtenRules` must be its own fold, not `rules` minus the relocated copies, and supplied the counter-example now in TDD step 3.
- I narrowed the gate's "redefined keys move" for `mergeFlatPermissions` to the presence change only: its one reader checks key presence, never order.
- Breaking changes found beyond the issue:
  - object-after-string: `ls` goes `ask` → `allow` when global has `bash: "allow"` and project has `bash: {"rm *": "deny"}`;
  - per-scope relocation of top-level `mcp__` keys.
  Both are named for the `BREAKING CHANGE:` footers and the README `Upgrading` entry.
- The `Co-authored-by:` trailer for @smb374 (GitHub id 13521730, from `gh api users/smb374`) is resolved in TDD step 2.

#### Deferred tidyings

- `src/policy/normalize.ts` `normalizeFlatConfig`: it stamps `origin: "builtin"`, and its one `src` caller overwrites it.
  An `origin` parameter fits once `composeScopes` is its caller, but it would touch about 20 `normalize.test.ts` call sites.
- `src/policy/permission-merge.ts`: after this change its only consumer is in `config/`; consider moving it with #1028.

## Stage: Implementation — TDD (2026-11-26T04:42:41Z)

### Session summary

All five TDD steps landed in order, plus two follow-up commits for the reviewer's WARN findings.
In source, `composeScopes` (`src/policy/scope-composition.ts`) replaced `mergeScopesWithOrigins`, and `mergeFlatPermissions` was aligned.
The docs gained an Upgrading entry, and the roadmap step is marked done.
The `pi-permission-system` suite went from 6563 to 6578 tests (+15: 14 new unit tests in `scope-composition.test.ts`, +8 manager tests, +1 `permission-merge`, +1 `config-loader`, minus the 9 deleted `scope-merge` tests).

### Observations

- Every planned killing mutation killed its predicted class, including both tests that stayed green during Red.
  - The prepend mutation also reddened existing tests ("Project-level config overrides base bash patterns", "System-agent config overrides project-level bash patterns").
  - It did not redden "lets a later scope's own key order decide": there the drop step removes the earlier `"*"`, so the order is preserved under prepend too.
- The global-allow-overridden test ("does not auto-allow mcp discovery from an mcp allow a later scope overrides") was green during Red.
  The old merge already dropped the global allow, so this test pins that behavior across the refactor; the no-filter mutation proved it.
- Step 4 added a second mutation (the base string wins over the override's own `"*"`) for the pin "a pattern-map override that sets its own catch-all replaces the string base".
  It also reddened the existing `config-loader.test.ts` "object replaces string when override uses object for same surface".
- Deviation: `FlatPermissionConfig[string]` failed `tsc` (the `"*"` property is optional), so `universalFallbackOf` takes `FlatPermissionConfig["*"]`.
- Deviation: `mergeFlatPermissions` was restructured with two named booleans so the eslint `no-unnecessary-condition` disable wraps only the defensive checks.
- `fallow health` reports no complexity finding on `scope-composition.ts` or `permission-manager.ts`.
- Pre-completion reviewer: the first round returned WARN with four doc items: the stale ASCII band order, the duplicated baseline sentence, the stale test name at `permission-manager.test.ts:191` that the plan's rename list missed, and an understated YAML comment.
  All four were fixed in "test(pi-permission-system): name the cross-scope pattern test for what it pins" and "docs(pi-permission-system): show the composed config band in scope order".
  The delta re-review returned PASS.
- The reviewer noted outside the delta that `architecture.md` line 210's box-drawing line is one column short.
  It predates this work and was left alone.

## Stage: Sync (worktree) (2026-11-26T06:34:07Z)

### Session summary

Root `pnpm run lint` and `pnpm fallow dead-code` pass, and the branch is rebased onto local `main`.
The plan's marker is `**Release:** ship independently`.
The branch carries two `fix!:` commits, so the release is a pi-permission-system major, and the README Upgrading entry names it "the major after 43.x".

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1108--/2026-11-25T17-40-39-933Z_01a213cb-997c-7493-a2ab-c916ad1d9218.jsonl`.
Read it with `read_session_file({ path: "<path>" })`.

### Observations

- Follow-up #1147 (a pattern map under the universal `"*"` is accepted and ignored) is filed and folded into #1127.
  Its roadmap disposition is committed on this branch as "docs(pi-permission-system): disposition #1147 against Phase 16".
- The close comment should credit the reporter, @smb374, whose expected ordering is the constraint the fix adopts.
  The "place a later scope's patterns after an earlier scope's" commit already carries their `Co-authored-by:` trailer.

## Stage: Final Retrospective (2026-11-26T06:53:44Z)

### Session summary

The worktree branch fast-forwarded onto `main`, the root lint and `fallow dead-code` gates passed on the merged tree, and CI passed on `42a7bfd7`.
Issue #1108 closed with a comment crediting @smb374, and `pi-permission-system-v44.0.0` released.
The worktree and branch are torn down.
Across planning, TDD, sync, and ship, the issue needed no re-plan, no CI fix-forward, and no re-dispatch.

### Observations

#### What went well

- Planning prototyped the fix in place before the first gate and ran the full suite against it (6562 passed / 1 failed).
  The one failure was a test that passed only because of the bug, and it became TDD step 1 ("put the project-agent skill catch-all before its exception").
  The gate's before/after table came from that measurement, not from reasoning.
- TDD verified every pin with a scripted mutation harness (`/tmp/mut.mjs`, `/tmp/mut3.mjs`, `/tmp/mut4.mjs`).
  Each script applied a named mutation, ran the policy tests, listed the reds, and restored the file, with a `diff -q` against a saved green copy as the restore check.
  Nine mutations each killed their predicted class, and the two tests that stayed green during Red were proven as pins rather than assumed.
- The `ask-user-text-first.ts` guard blocked the #1147 roadmap-fit gate once, because the briefing was in a thinking block.
  The agent followed the block reason on the first try: plain-text options, no retry, end of turn.
  The operator answered "Fold it." in chat.
- The worktree-lane `/ship` ran with no rejection: `merge-base --is-ancestor` predicted the fast-forward, `origin/main..main` was 0, and the release `prepare`/`publish`/`github-release` jobs all passed on the first dispatch.

#### What caused friction

- `rule-ignored` — the first planning gate used "last scope" and "first scope" without defining them, and did not say which checks reach `permission["*"]`.
  `clarification-gates` ("Define a gate's terms of art before its substance") was loaded at that point.
  The operator answered the universal-`"*"` question with a question instead of a selection.
  Impact: one extra round trip (a terminology message with the slot table, then a re-ask); no rework.
  Self-identified in the planning stage note ("lead with the slot table next time").
- `judgment` — the same gate described the warning merge as "`config-loader.ts` still calls `mergeFlatPermissions` (global + project)" without saying it also merges the current `config.json` files.
  The operator picked "Align it" on the premise that it was legacy configuration.
  Impact: one re-asked gate with the context added; the answer held ("Align it now").
  Self-identified: the agent re-asked instead of proceeding on the operator's mistaken premise.
- `slip` — planning turn 8 ran `cd packages/pi-permission-system; …`, and the `cd packages/*` permission rule denied it.
  Impact: one denied call, retried at once with root-relative paths.
- `judgment` — the pre-completion reviewer returned WARN with four doc findings: the ASCII band diagram still in the old order, a duplicated baseline sentence, a test name the plan's rename list missed, and an understated YAML comment.
  Step 5's stale-phrase grep could not see a diagram's row order or a test name absent from the list.
  Impact: two follow-up commits and one delta re-review (PASS).
  Caught by the mechanism built for it.
- `slip` — `FlatPermissionConfig[string]` failed `tsc`, because `"*"` is optional; it was fixed to `FlatPermissionConfig["*"]` after one `check` run.
  Impact: one edit; no rework.

#### What the operator steered

The operator picked the recommended option at every gate (direction, universal `"*"`, warning merge, #1147 disposition), so no `steer:choice` went against a recommendation.
Two gate answers were clarification requests rather than redirects:

- "Help me out with terminology.
  Last scope meaning last to be read?
  First scope as first to be read?
  What cases hit a `permission["*"]` rule?", after the gate offered "Stays the fallback" / "Overrides earlier scopes" without defining the scope order.
  Then: "That was helpful.
  As a user, I'm least surprised by "Stays the fallback" behavior."
- "This is legacy configuration right?
  It's time to deprecate it, if so.", attached to "Align it"; the premise was wrong, and the re-ask corrected it.

### Diagnostic details

- **Model-performance correlation** — every turn in the peer session (planning, TDD, sync) and in this root session (ship, retro) ran on `anthropic/claude-opus-5-5`.
  The three subagents (one `tidy-first-assessor`, two `pre-completion-reviewer`) also ran on `anthropic/claude-opus-5-5`, read from their own transcripts.
  All three are judgment-heavy reviews, so the model fits; no mechanical task went to a subagent.
- **Escalation-delay tracking** — no stretch exceeded five calls on one error; the longest was the `tsc` fix (two calls).
- **Feedback-loop gap analysis** — TDD ran the scoped tests, `check`, and `fallow dead-code` after every step, ran the full root gates before the reviewer, and the pre-push gates ran again on the merged tree at ship.
  No gap.

### Proposals considered and not made

- Terms-of-art miss: ten earlier retros match `rg -l "terms of art|Help me out with terminology|terminology question"` (for example `packages/pi-permission-system/docs/retro/1016-on-disk-spelling-alias.md`, `packages/pi-permission-model-judge/docs/retro/0905-map-forced-tool-choice-per-provider-api.md`, `packages/pi-session-tools/docs/retro/0944-branch-aware-transcript-rendering.md`).
  A `rule-ignored` finding calls for a mechanism or deletion, never a louder rule.
  No deterministic check can tell whether a briefing defines the terms its options use, and deleting the rule would drop guidance that the operator's questions keep validating.
  Nothing is proposed; the cost per occurrence stays at one round trip.
- `cd packages/*` slip: it recurs across many retros, but the deny rule is already the mechanism, and it fired with a reason that redirected the next call.
- Pre-completion doc WARN: the reviewer is the mechanism that catches stale diagrams and missed renames, and it caught them here.
