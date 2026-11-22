---
issue: 640
issue_title: "Child inherits parent's stale 'working directory' claim, defeats WorkspaceProvider/worktree isolation"
---

# Retro: #640 — Child inherits parent's stale 'working directory' claim, defeats WorkspaceProvider/worktree isolation

## Stage: Planning (2026-07-25T02:35:00Z)

### Session summary

Confirmed the third-party report's root cause empirically rather than by reading alone, then wrote a cross-package plan (`docs/plans/0640-redact-inherited-working-directory-claims.md`) covering `pi-subagents` and `pi-nocd`.
`pi-subagents` will strip the inherited `Current working directory: <parent cwd>` line from the parent prompt it embeds; `pi-nocd` will rewrite an inherited `# Working Directory` block to name the current session's cwd instead of deferring to it.
`pi-subagents-worktrees` gets no change — it is the trigger, not the defect site.

### Observations

- Two throwaway probes (`/tmp/probe640.mjs`, `/tmp/probe640c.mjs`) drove the whole design.
  They imported the installed SDK's `buildSystemPrompt` and reconstructed the child prompt end to end, proving that Pi appends a *correct* `Current working directory: <child cwd>` footer for free (from the child session's own cwd, nothing passed by us) and that the stale claim sits mid-prompt at the inherited tail.
  The operator asked "are we confident pi puts the correct footer?" — the probe answered it in a way that reading `agent-session.js` alone would not have.
- The operator asked to see examples of each redaction option "including overcorrections", and that request changed the outcome.
  Rendering the global `replaceAll(parentCwd, childCwd)` option against a realistic prompt exposed that it rewrites a valid `.pi/npm/node_modules/…/SKILL.md` skill location (gitignored, absent from a `git worktree add` checkout) into a 404, plus three prefix collisions (`issue-640-worktrees/issue-448`, `-archive`, `pi-packages2`).
  Strip won on that evidence.
- Decisions locked with the operator: strip rather than rewrite the footer (exactly one canonical claim, always); no precedence sentence in the child's `# Environment` block; include the pi-nocd fix, making this a cross-package plan.
- Design-review call: the parent's prompt and the cwd it claims travel as one `InheritedPrompt` parameter rather than two adjacent optional strings, since the cwd exists in that signature solely to redact the prompt.
- Considered and rejected: stripping at capture time in `buildParentSnapshot`, which would need no signature change anywhere.
  It conflates capturing the parent's prompt with sanitizing it for another session, and would leave `ParentSnapshot.systemPrompt` silently lossy for any future consumer.
- Upstream precedent noted but not followed: Pi's own `ssh` and `gondolin` example extensions *replace* the footer line in place.
  They need to, having no other way to state a remote cwd; we already get a correct footer from the child session, so replacing would only add a redundant third claim.
- `pkg:pi-nocd` already existed as a label; added it to the issue.
- Not filed as follow-ups (deliberately, as neither is concrete yet): sanitizing the inherited *conversation* under `inherit_context`, and asserting `# Environment` precedence over non-footer stale claims.

## Stage: Implementation — TDD (2026-07-25T02:45:00Z)

### Session summary

Executed all six planned TDD steps plus one adopted preparatory tidy, across `@gotgenes/pi-subagents` (footer strip) and `@gotgenes/pi-nocd` (inherited-block rewrite), in seven commits.
Test count went from 1073 to 1081 in pi-subagents (+8) and 7 to 11 in pi-nocd (+4).
The pre-completion reviewer returned PASS with no warnings.

### Observations

- No deviations from the plan's Module-Level Changes: every listed file was touched and nothing else, including the prediction that `packages/pi-subagents/src/index.ts` needs no edit because it passes `buildAgentPrompt` by reference and structural typing carries the new signature.
- Adopted one of the `tidy-first-assessor`'s two recommendations — extracting `SENTENCE_PREFIX` in pi-nocd before the rewrite branch, so the detector reads a constant the builder already uses rather than restating the sentence.
  Declined the other (a `withParent` passthrough fixture for `prompts.test.ts`'s nine positional call sites): as specified it was a no-op wrapper with an unused `cwd` parameter, and it would have hidden the parent cwd that the new footer tests exist to vary.
  The nine-site migration is compiler-enforced, which is the stronger backstop; it landed clean in one atomic `Edit` batch.
- The two guard tests in each `fix:` step's red phase passed before the implementation existed, by design — "leaves a footer naming a different directory alone" and "leaves a parent prompt without a footer unchanged" in pi-subagents, "foreign block untouched" and "stable under repeat application" in pi-nocd.
  They pin what must *not* change, so a trivially-green red phase is the correct signal for them; the behavioral cases (5 and 2 respectively) failed first as expected.
- `buildAgentPrompt`'s edge behavior was preserved exactly by writing `inherited?.systemPrompt ?? genericBase`: an empty-string parent prompt still yields an empty identity, matching the old `parentSystemPrompt ?? genericBase`, because `??` does not treat `""` as nullish.
- The pi-nocd rename commit was rejected once by the pre-commit hook — biome reordered the test file's named imports alphabetically after the `sed` rename.
  Re-staging and re-committing was enough; worth remembering that a `sed`-driven rename can leave import order dirty.
- The reviewer independently ran `verify:public-types` and confirmed `InheritedPrompt` stays internal, and grepped both packages to confirm neither references the other — the ADR-0002 inward-arrow constraint held, with each package repairing only the text it owns.
- The plan specified an **unconditional** strip; the shipped fix strips only when the child's cwd differs from the parent's.
  The operator asked for a before/after prompt comparison to check prompt caching, and measuring it changed the design after the pre-completion review had already passed.
  Against a realistic parent prompt (this repo's `AGENTS.md` plus 15 skills, ~8,599 tokens) the unconditional strip cost 342 characters (~86 tokens, 1.0%) of the byte-identical prefix a child shares with its parent — five times the 67-character footer, because the parent's trailing extension-appended blocks (pi-nocd's) shift offset and prefix matching cannot resume past the removed line.
  A same-cwd child now comes out byte-identical to pre-change output (verified by diffing against the pre-change function extracted from git).
  The plan's Design Overview records the amendment and the measurement.
- Worth carrying forward: Anthropic was never exposed to this class of regression, because its `cache_control` breakpoint covers the entire system block (`packages/ai/src/api/anthropic-messages.ts:975-989`) and a child's block never equaled its parent's — the child always appends the bridge, `<active_agent>` tag, and env block.
  The "identical byte prefix with the parent session" rationale in `buildAgentPrompt`'s docstring only pays off on implicit token-prefix caching (OpenAI, Gemini, OpenRouter).
  Any future change to the inherited prefix should be measured against those providers, not Anthropic.
- Method note: the comparison was run by extracting the pre-change `prompts.ts` from git into a scratch module and diffing both functions' real output, rather than reimplementing the old behavior.
  Pi's `buildSystemPrompt` is not in the SDK's `exports` map, so the realistic parent prompt was generated by a plain-node script importing the dist path directly and handed to the vitest scratch through a temp file.

## Stage: Final Retrospective (2026-07-25T14:04:06Z)

### Session summary

Shipped a cross-package fix for a third-party bug report across four stages in one session: plan, TDD, ship, retro.
`@gotgenes/pi-subagents` 18.1.2 strips the inherited parent cwd footer when a child's workspace differs; `@gotgenes/pi-nocd` 1.0.1 rewrites an inherited `# Working Directory` block to name the current session's directory.
The operator's post-review question about prompt caching caught a performance regression that the pre-completion reviewer had passed, producing one additional fix and a history rewrite before the push.

### Observations

#### What went well

- **Empirical grounding beat inference at every decision point.**
  The root cause, the redaction choice, the caching measurement, and the prompt-ordering question were each settled by running the real code (six throwaway node/vitest probes) rather than by reading and reasoning.
  The redaction choice in particular flipped on evidence: option C looked strictly better on paper (it repaired pi-nocd's block for free) until the probe showed it rewrites a valid `.pi/npm/.../SKILL.md` skill path — gitignored, so absent from a `git worktree add` checkout — into a 404, plus three path-prefix collisions.
- **Extracting the pre-change function from git to diff against.**
  `git show a9b3e543^:packages/pi-subagents/src/session/prompts.ts > test/scratch-old-prompts.ts` let the before/after comparison run both *real* implementations in one process instead of reimplementing the old behavior from memory.
  This is worth reusing whenever a change's effect must be measured rather than described.
- **The non-interactive squash recipe worked cleanly under a `nvim` `$EDITOR`.**
  `git commit --fixup=<sha>` plus a hand-written `amend! <subject>` commit, then `GIT_SEQUENCE_EDITOR=true GIT_EDITOR=true git rebase -i --autosquash`, collapsed seven commits to the intended shape with zero editor prompts — and `committed` passes `fixup!`/`amend!` headers through, so the `commit-msg` hook needed no bypass.
  A `git tag backup-640` before the rewrite made `git diff backup-640 HEAD` a one-command correctness proof afterward.

#### What caused friction (agent side)

1. `premature-convergence` — the plan named the KV-cache byte-prefix invariant under "Invariants at risk" and then discharged it with a prose argument ("the footer sits at the parent prompt's tail, so the cached prefix ahead of it is unaffected") instead of measuring it.
   The test added to pin it asserted surrounding *content* survived, not prefix *length*, so it could not have caught the regression.
   Measurement later showed the unconditional strip cost 342 characters (~86 tokens) of shared prefix in *every* child — five times the 67-character footer, because pi-nocd's trailing block shifts offset and prefix matching cannot resume.
   User-caught, after the pre-completion reviewer returned PASS.
   Impact: the largest rework of the session — one extra `fix:` commit, four doc edits, a plan amendment, and a seven-commit history rewrite to collapse it.
2. `missing-context` — spent turns 9–17 (nine tool calls) grepping the *installed* SDK's `dist/` bundles and `.js.map` `sourcesContent` to find `buildSystemPrompt`, not knowing the full Pi source was checked out at `~/development/pi/pi`.
   The operator supplied that location unprompted; one `rg` against source then answered immediately.
   Impact: nine tool calls of awkward sourcemap archaeology that a single question would have avoided.
3. `other` (shell quoting) — an unquoted `grep --include=*.ts` pattern aborted with `zsh: no matches found` four separate times (turns 10, 12, 51, 93); zsh glob-expands the bare form against the cwd.
   Impact: four wasted tool calls, each needing an immediate retry with a different formulation.
4. `instruction-violation` (self-identified) — the first `ask_user` call asked about pi-nocd scope before establishing where the defect actually lived, prompting the operator to ask "We're talking about pi-subagents-worktrees to be clear, right?"
   The `ask-user` skill's handshake requires summarizing neutral context *before* asking; the mechanism summary that resolved it was written only in the follow-up.
   Impact: one extra `ask_user` round-trip.
5. `instruction-violation` (user-caught, ship stage) — after `git rev-parse HEAD` returned the correct 40-character SHA, the model second-guessed its length, ran `wc -c`, and then passed a **39-character truncated** value to `ci_find` (dropping the trailing `a`).
   The ship prompt says to pass the `git rev-parse` value exactly and never type a SHA from memory.
   Worse, the resulting 125-second timeout was then misdiagnosed as "`ci_find` just missed the window" rather than as a bad argument.
   Impact: 125 seconds of timeout plus two recovery tool calls.
6. `instruction-violation` (self-identified) — `/plan-issue` says to load the `colgrep` skill before code exploration; it was never loaded and `colgrep` was never used.
   Exact-symbol greps were the right tool for this issue, so the outcome was unaffected, but the gate was skipped rather than consciously judged.
   Impact: none beyond the skipped step.
7. `other` (harness plumbing) — four consecutive calls (turns 139–142) fighting Vitest's reporter swallowing `console.log`, resolved by shadowing `console` and writing to a temp file.
   Preceded by two other harness dead ends: Vitest refusing the SDK's `dist/` path (blocked by its `exports` map) and a `Skill` fixture missing `filePath`/`baseDir`/`sourceInfo`.
   Impact: roughly eight tool calls of scaffolding before the first real measurement.

#### What caused friction (user side)

- The Pi source checkout at `~/development/pi/pi` was the single highest-leverage piece of context in the session and arrived only after nine tool calls of dist archaeology.
  Mentioning it in `AGENTS.md` (or at the first sign of SDK-internals digging) would generalize beyond this issue — several past issues have needed Pi's own source.
- The two redirecting questions were both excellent and both changed the outcome: "show me examples of each, including overcorrections" turned a plausible-looking option into a rejected one, and "I want to make sure we didn't break prompt caching" caught a regression that had already passed review.
  Both arrived as questions rather than corrections, which is what made them productive.

### Diagnostic details

- **Model-performance correlation** — planning, TDD, and the post-review measurement ran on `claude-opus-5` (judgment-heavy; appropriate).
  The ship stage ran on `claude-sonnet-5` and produced two character-counting confusions on SHAs within eight turns, one of which truncated a SHA and cost a 125-second timeout.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) are pinned to `claude-sonnet-5`; the reviewer returned PASS on a plan whose quantitative invariant was discharged in prose, and its "Cross-step invariants" check repeated the plan's own unmeasured claim back as verification.
  That is the one dispatch where the model tier and the judgment demanded may be mismatched.
- **Escalation-delay tracking** — the nine-call SDK-internals hunt (turns 9–17) exceeded the five-call threshold and was broken by operator-supplied context, not by self-escalation; an `Explore` subagent or a direct question would have resolved it sooner.
  The four-call Vitest reporter fight (turns 139–142) sat just under the threshold.
- **Unused-tool detection** — `colgrep` was never dispatched despite being the prompt's recommended first step for exploration; no `Explore` subagent was dispatched for the SDK-internals hunt, which is exactly the read-heavy, context-expensive task it exists for.
- **Feedback-loop gap analysis** — `pnpm run check` and per-file Vitest ran after every TDD step, with the full suite plus root `lint` and `fallow dead-code` at each package boundary; no gap in the *correctness* loop.
  The gap was that no *performance* feedback loop existed at all until the operator asked for one — the caching invariant had no harness, no baseline, and no assertion, only prose.

### Changes made

1. `.pi/prompts/plan-issue.md` — extended the **Invariants at risk** bullet: a quantitative invariant (byte-identical prefix, token budget, cache or latency characteristic) must have its baseline measured and its post-change value predicted at planning time, because a prose argument is not evidence and a test pinning adjacent content does not pin the number.
2. `AGENTS.md` (Workflow) — added a line directing SDK-internals questions to Pi's own source at the sibling checkout `../pi` when present, rather than the installed `dist/` bundles or their sourcemaps.
   The operator flagged that an absolute machine-specific path would be fragile; `PI_SOURCE_DIR` was considered and rejected because no tooling reads it, so the convention would have to be taught as well as followed.
3. `AGENTS.md` (Code Style) — added the glob-quoting rule next to the `colgrep`/`grep` guidance.
   The first draft framed this as zsh- and `grep`-specific; the operator corrected both.
   The universal hazard is that any shell expands an unquoted pattern against the cwd before the command sees it — bash silently substitutes a matched filename (the worse, quiet failure), while zsh aborts loudly — and it applies to any command taking a pattern (`find -name`, `rsync --filter`), not just `grep --include`.
4. `.pi/prompts/ship-issue.md` — added a recovery branch to step 4.2: on a `ci_find` timeout, re-check the SHA passed against `git rev-parse HEAD` before assuming a timing miss.

Considered and not implemented: a `pre-completion-reviewer` rule for performance invariants (the defect was upstream in the plan, so this would treat the symptom); re-tiering the subagents off `claude-sonnet-5` (one data point, and the plan gave the reviewer nothing measurable to check); documenting the `amend!`/`--autosquash` squash recipe in `AGENTS.md` (the mechanism is already covered there, and the full recipe belongs in this retro).
