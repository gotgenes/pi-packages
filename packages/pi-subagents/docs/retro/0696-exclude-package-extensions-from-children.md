---
issue: 696
issue_title: "pi-subagents: allow children to exclude selected package extensions"
pr: 697
---

# Retro: #696 — allow children to exclude selected package extensions

## Stage: PR Review (2026-08-13T04:57:29Z)

### Session summary

Third-party PR [#697](https://github.com/gotgenes/pi-packages/pull/697) from `@beilo` (leipeng) adds an `excludedExtensionPackages` key to layered `subagents.json` so in-process child sessions skip selected Pi package extensions, motivated by a concrete OOM: four concurrent children each re-initialize `@cortexkit/pi-magic-context` and scan a ~1.1 GB Pi session store in the shared V8 heap, aborting near the ~4.1 GB limit (exit 134).
The underlying problem was confirmed real on current `main` — children inherit every parent package extension with no opt-out of any kind — and [ADR-0002] explicitly reserved a prevent-load seam for exactly this trigger condition.
The operator chose **adopt the capability, plan a simplified design**: keep the capability and its exact-source semantics, use the PR as reference rather than the merge target, and let `/plan-issue` weigh the two candidate mechanisms and the ADR-shape question with fuller context.

### Evaluation

#### Verify gate — defect confirmed on current `main`

A throwaway test (since deleted) against `main` asserted that `createSubagentSession` passes **no** filtering seam whatsoever to the child resource loader, and it passed:

- `packages/pi-subagents/src/lifecycle/create-subagent-session.ts:184` calls `deps.io.createResourceLoader({...})` with no `settingsManager`, no `extensionsOverride`, and no `noExtensions`.
- Pi's `DefaultResourceLoader` therefore falls back to `SettingsManager.create(this.cwd, this.agentDir)` (`resource-loader.js:119`), resolves every configured package via `packageManager.resolve()`, and binds every parent extension in the child.

Not already fixed in an earlier release: `git log --oneline -S "noExtensions" -- packages/pi-subagents/` surfaces `3cc682ec feat!: always inherit extensions; make the recursion guard unconditional (#264)`, which deliberately *removed* the seam.
Nothing re-added it since.

The real boundary is correct: the OOM originates in the child extension factory at `bindExtensions()`, and dropping the package's extension paths in the child loader means the factory never runs.

Regression risk in the other direction is low — an absent or empty setting preserves today's behavior exactly, so the change is additive (`feat:`), not breaking.

#### Checks run independently

Run from a scratch worktree on the PR head (`6237ceb4`), not trusted from the PR body:

| Check                                           | Result                      |
| ----------------------------------------------- | --------------------------- |
| `pnpm run check`                                | pass                        |
| `pnpm run lint` (Biome + ESLint + `rumdl`)      | pass, no findings           |
| `pnpm --filter @gotgenes/pi-subagents run test` | pass — 64 files, 1141 tests |

#### ADR context — this is the trigger, not a relapse

[ADR-0002] evicted per-agent extension policy but was explicit that prevent-load is different:

> Prevent-load (refusing to bind an extension because of load-time side effects, cost, or true sandboxing) is genuinely generative and cannot be reduced to observation, so it is left as a *latent* (un-built) provider seam, added only if a real consumer needs it.

Magic Context is that real consumer.
So admitting the capability honors the ADR's "no vacant hooks" rule rather than reversing Phase 14.

#### What is valuable

- The capability itself, and the decision to match **exact Pi package source strings** rather than inventing a glob dialect.
- Disabling only the matched package's extensions while its skills and other resources stay available.
- The `settingsManager` loader option is a **real** seam, not invented — `DefaultResourceLoaderOptions.settingsManager?: SettingsManager` is present in the pinned `@earendil-works/pi-coding-agent@0.80.5` types.
- The `extensions: []` disable idiom is semantically correct: `applyPackageFilter` in `package-manager.js` comments "Empty array explicitly disables all resources of this type", and it matches the convention this repo already documents in `AGENTS.md`.
- Sanitization in `settings.ts` (`sanitize`) is careful — type-filters, trims, drops empties, dedupes — and is well covered by `test/settings.test.ts`.

#### What I would change

1. **The `Proxy` is the wrong instrument.**
   `createChildSettingsManager` in `create-subagent-session.ts` hand-rolls a `get` trap that rebinds every function to the target.
   It silently forwards a growing SDK surface, would break on any future `SettingsManager` method that returns `this`, and is untypable in practice — it needs `target as unknown as Record<PropertyKey, unknown>` and `Reflect.apply(...) as unknown` within eight lines.
   Pi already exposes a first-class alternative: `DefaultResourceLoaderOptions.extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult`, which is a pure function over the loaded extension set with no proxy and no settings mutation.

2. **Blast radius wider than the problem.**
   The PR passes the *same* proxied manager as the child **session's** `settingsManager` in `createSession({ settingsManager })`, not only the loader's.
   Every session-level settings read in the child — npm command, project trust, model config, and any future consumer — now observes a mutated `packages` array.
   Nothing in the stated problem requires that; the change should be scoped to the loader.

3. **Silent hole for `autoload: false` entries.**
   `disableExcludedPackageExtensions` sets `extensions: []` on the package entry, but `collectPackageResources` routes an entry with `autoload: false` to `applyPackageDeltaFilter`, which **returns early when the pattern array is empty**.
   For such a user the exclusion silently does nothing.
   No test covers this path.

4. **Shape versus [ADR-0002].**
   The ADR specifies prevent-load as a rationed **provider seam** (generative, registered by a consumer), not a config list the core reads.
   The PR instead adds a core-owned `subagents.json` key — structurally the `extensions: string[]` shape Phase 14 evicted, relocated from agent frontmatter to settings — and **amends the ADR to permit itself** rather than satisfying it as written.
   Choosing config-key ergonomics over the seam is a legitimate call, but it should be a deliberate decision with its own ADR reasoning.

5. **`snapshot()` return shape becomes non-uniform.**
   In `settings.ts`, `snapshot()` gains a conditionally-spread optional `excludedExtensionPackages?: string[]` while every other field is unconditional — apparently so existing `toEqual` assertions keep passing.
   Since the PR's own README text says the setting is not exposed in `/subagents:settings`, it likely does not belong in `snapshot()` at all.

6. **Integration test asserts the stub, not the behavior.**
   The new case in `test/lifecycle/create-subagent-session.test.ts` asserts against a stub `SettingsManager`, so it pins that the proxy wraps two methods — it does not pin the load-bearing assumption that Pi actually disables the extension for an `extensions: []` entry.
   A test at the seam would survive a mechanism swap; this one will not.

7. **Dependency-bag growth.**
   `getExcludedExtensionPackages: () => readonly string[]` becomes a fifth field on `SubagentSessionDeps`, whose doc comment describes it as "the IO boundary plus the two static domain deps".
   A policy getter threaded into the assembly factory is worth a second look under the `design-review` dependency-width check.

### Decision and attribution

**Direction: adopt the capability, plan a simplified design.**
The PR is reference material, not the merge target.
`/plan-issue #696` should plan around this recorded decision rather than re-litigate whether the capability is wanted — it is.

Two questions are deliberately deferred to planning, with both candidates recorded here:

- **Mechanism** — Pi's `extensionsOverride` loader option (pure filter, loader-scoped, no proxy) versus a plain filtered settings snapshot with no `Proxy`.
  Planning evaluates both; whichever wins must close the `autoload: false` hole and carry a test at the seam rather than at a stub.
- **Config shape** — an `excludedExtensionPackages` settings key (operator ergonomics, requires a deliberate [ADR-0002] amendment) versus the registerable provider seam the ADR specifies.
  Planning weighs ergonomics against the ADR and proposes either the amendment or the seam.

Agreed scope: exact Pi package-source matching, extensions only (skills and other package resources stay available), parent behavior unchanged, absent or empty setting preserves today's child behavior.

Non-goals: no restoration of per-agent `extensions:` / `isolated:` / `noSkills` frontmatter, no tool-permission semantics (that remains `@gotgenes/pi-permission-system`'s `permission:` frontmatter), and no glob or fuzzy package matching.

**Attribution.**
Every implementation and docs commit for this work carries, after a blank line at the end of the body:

```text
Co-authored-by: leipeng <leipeng950504@gmail.com>
```

The ship-stage close comment thanks `@beilo` by name and links the implementing SHA(s).
Reference the PR as `Refs #697` or `(#697)` — never `Closes #697`, which would pre-empt the curated close comment.

## Stage: Planning (2026-08-13T05:13:33Z)

### Session summary

Produced `docs/plans/0696-exclude-package-extensions-from-children.md` and resolved the three questions the PR-review stage deferred: settings key plus a deliberate [ADR-0002] amendment, `SettingsManager.fromStorage` over a read-only filtering storage, and loader-only scoping.
Deeper reading of Pi's `resource-loader.js` and `package-manager.js` **refuted two of the PR review's own critiques**, which materially changed the design.
The plan lands as five TDD steps and is a non-breaking, ship-independently feature.

### Observations

#### Two PR-review critiques were wrong, and planning caught both

- **`extensionsOverride` is unusable, not the better seam.**
  The review recommended replacing the `Proxy` with Pi's `extensionsOverride` loader option.
  Reading `resource-loader.js` showed it runs at line 279 — *after* `loadFinalExtensionSet` already called `loadExtensionsCached` (modules imported into the heap, so the OOM cost is already paid) and *before* `applyExtensionSourceInfo` at line 280 (so `extension.sourceInfo` is unpopulated and the callback cannot match by package source at all).
  The contributor's settings-level approach was right on the mechanism.
- **The claimed `autoload: false` "silent hole" does not exist.**
  The review asserted `applyPackageDeltaFilter`'s early return on an empty array meant the exclusion silently no-ops.
  In delta mode the filter starts from nothing and only *adds* matched patterns, so `extensions: []` yields "add none" — the desired outcome.
  `extensions: []` is correct in both modes.

The generalizable lesson: a PR review that reads the diff plus one layer of the dependency is not enough to judge a mechanism.
Both errors came from reading `DefaultResourceLoaderOptions`' type surface without tracing the call order in the compiled `.js`.

#### What survived from the review

The `Proxy` critique and the blast-radius critique both held.
`SettingsManager` has a `private constructor` (no subclassing) and `applyOverrides` only touches the private merged `settings` field, not the per-scope accessors the package manager reads — so `SettingsManager.fromStorage`, which is public and takes a one-method `SettingsStorage`, is the only clean seam.
It yields a real, fully typed manager with no proxy and no casts.

#### New finding: a data-loss path the PR only accidentally avoided

`saveAndNotify` persists `snapshot()` through a whole-file `writeFileSync`, so any key absent from `snapshot()` is destroyed on the next `/subagents:settings` edit.
A hand-edited project-scoped `excludedExtensionPackages` would be silently erased by an unrelated grace-turns change.
The review had dismissed the PR's conditional-spread in `snapshot()` as test-appeasement; it was actually preventing this.
The plan keeps the conditional field but gives it a named `SettingsSnapshot` type, the real rationale in a doc comment, and its own regression test (TDD step 2, committed as a `fix:` before the feature).

#### Design divergence from the PR: keep policy out of the factory

The PR threads `getExcludedExtensionPackages: () => readonly string[]` into `SubagentSessionDeps` and branches inside `createSubagentSession`.
Applying the `code-design` rule "thread decisions, not discriminators", the plan instead resolves the policy at the `index.ts` composition boundary and hands the factory the *product* via a new `SessionFactoryIO.createLoaderSettingsManager(parent)` member.
The factory gains no policy knowledge, no fifth dependency-bag field, and no conditional; the no-exclusions path is identity.

#### Adjacent issue reframes the feature

Issue [#709] (child disposal skips `session_shutdown`, leaking extension-owned processes) explicitly names #696/#697 a *workaround* with a different failure mode — excluding `pi-mcp-adapter` also removes the child's MCP tools.
The two are complementary, not substitutes, and the plan says so in Non-Goals and in the README cross-reference.
This did not surface from the issue body; it came from the open-issue sweep.

#### ADR reasoning inverted the expected answer

[ADR-0002] reserved prevent-load as a provider seam, which reads like an argument against the settings key.
But the same ADR's "no vacant hooks" rule — a seam with no consumer "is not extensibility — it is a speculative abstraction that taxes every reader, and `fallow` flags it as dead" — argues *against* building the seam here, since no external extension wants to supply a prevent-load policy.
The amendment records that reasoning rather than quietly rewriting the ADR to match the patch, which is what the PR did.

#### Risks carried forward

- The storage adapter must discard writes.
  Forwarding one would persist synthesized `extensions: []` into the user's real `settings.json`, disabling those packages for the parent and every future session.
  A dedicated test pins this.
- The new module may read as dead code between TDD steps 3 and 4; the plan names fold-forward as the remedy rather than a `fallow` suppression.

## Stage: Implementation — TDD (2026-08-13T16:58:42Z)

### Session summary

Implemented all five planned TDD cycles plus two preparatory Tidy-First commits, landing `excludedExtensionPackages` as an opt-in prevent-load seam for child sessions.
Tests went from 66 files / 1175 tests to 67 / 1199 (+24); `check`, root `lint`, `test`, and `fallow dead-code` are all green.
The pre-completion reviewer returned **PASS**, but only on a second dispatch — the first run was interrupted after it escalated an SDK-symbol lookup into a filesystem-wide `find /`.

### Observations

#### Tidy First paid off exactly as advertised

The `tidy-first-assessor` recommended two mechanical extractions — hoisting `deps.io.createSettingsManager(...)` out of the `createSession` argument literal, and naming `snapshot()`'s inline return type `SettingsSnapshot`.
Both turned a would-be move-and-add diff into a pure addition, and the assessor correctly **rejected** the one tidying the dispatch prompt had suggested (a shared `snapshot()` expectation fixture), on the grounds that the optional-when-empty design means none of the six existing `toEqual` literals change.
That rejection was right and saved touching six lines the change never needed.

#### Planning's mechanism call held up under implementation

Nothing in the build contradicted the plan's two reversals of the PR review.
`extensions: []` disabled the package in both filter modes as predicted, and the `SettingsManager.fromStorage` seam produced a real, fully typed manager — the `private constructor` ruled out subclassing, and `applyOverrides` would not have worked because it only touches the private merged `settings` field.

#### The step-2 `fix:` was the highest-value commit

The `snapshot()` round-trip guard is the one change no one asked for.
Its red test failed exactly as predicted: `applyGraceTurns` erased a hand-edited `excludedExtensionPackages` from the project file, because `saveAndNotify` whole-file-rewrites from `snapshot()`.
Worth remembering as a general hazard: **any** future `subagents.json` key without a `/subagents:settings` affordance has this data-loss path, and the plan's Open Questions already flags merge-on-write as the general fix if a second such key appears.

#### Test design closed PR #697's real gap

The PR's integration test asserted against a stub `SettingsManager`, so it pinned that a proxy wrapped two methods rather than that Pi disables anything.
The replacement builds a real `SettingsManager` via `fromStorage` and asserts resolved `packages`, plus a case proving a write through `withLock` never reaches the parent.
The reviewer independently re-verified the `applyPackageFilter` empty-array semantics against the pinned `0.80.5` SDK rather than taking the plan's word for it.

#### Deviation: an unplanned agent-hardening commit

One commit outside the plan — `34230776 docs(agents): bound pre-completion-reviewer searches to the repo`.
The first reviewer dispatch ran `grep -rn "…" …/dist/*.d.ts`, which globs one level only and so missed `dist/core/settings-manager.d.ts`, got `(no output)`, and escalated to `find /` rather than fixing the glob.
The agent's existing "read-only commands only" instruction did not constrain it, because `find /` **is** read-only.
The walk also resolved to a stale `0.79.1` copy in the pnpm store instead of the pinned `0.80.5`, so the escalation produced a subtly wrong source as well as an expensive one.
The fix adds an explicit repo-scope bound, a fix-the-pattern-before-widening ladder, and a rule to pin the dependency version when reading installed types.
Re-dispatching with the same guardrail restated in the prompt produced a clean PASS in 149 s versus the first run's 556 s.

#### Two permission-system issues surfaced from the same incident

Investigating why `find /` was not gated turned up findings unrelated to this issue but worth recording:

- The gate **did** fire and a prompt **was** raised (`forwarded_permission.prompted`), then resolved `approved` 21.5 s later — but the log records no responder identity beyond a session ID, so a human approval is indistinguishable from an auto-approval.
  Filed as [#726].
- `authorizer_chain_unregistered_link` fires for the configured `model-judge` link on every subagent request (41 occurrences vs. 8 `model_judge.decision` across three weeks), so the configured authorizer chain never adjudicates subagent requests.
  Filed as [#727], which also records that [#699]'s "benign but noisy — authorization still works" impact assessment appears to understate this; a comment on [#699] cross-references it.

Neither blocks this issue, and neither changed the implementation.

### Pre-completion reviewer

**PASS** — ready for `/ship-issue`.
No WARN findings.
The reviewer flagged one item as `[visual-check-needed]`: the four-concurrent-children OOM-avoidance claim is a runtime memory property that unit tests cannot observe, though it independently confirmed the underlying mechanism against the pinned SDK.
It also noted a pre-existing `mock.calls[0][0]` access in an untouched test block, introduced by neither this change nor worth fixing here.

## Stage: Final Retrospective (2026-08-13T17:19:44Z)

### Session summary

One continuous session carried issue #696 from third-party PR triage through planning, TDD implementation, and release as `pi-subagents@19.3.0`.
The capability from PR #697 (@beilo) was adopted with a re-implemented design; nine commits landed, tests went 1175 → 1199, and PR #697 was closed with credit rather than merged.
A mid-session permission anomaly the operator caught produced two extra issues ([#726], [#727]) and a hardening commit to the `pre-completion-reviewer` agent.

### Observations

#### What went well

1. **The stage separation caught two of my own wrong technical claims before any code existed.**
   The PR Review stage concluded that Pi's `extensionsOverride` was the better seam and that `extensions: []` had a silent `autoload: false` hole.
   Both were wrong.
   The Planning stage, reading the compiled `resource-loader.js` and `package-manager.js` rather than the `.d.ts`, refuted both and reversed the mechanism decision.
   This is the multi-stage workflow doing exactly what it exists for — the cost of the error was one stage of re-reading, not a shipped `Proxy` or a wasted implementation.

2. **The `tidy-first-assessor` rejected a suggestion planted in its own dispatch prompt.**
   The dispatch asked, as question 2, whether a shared `snapshot()` expectation fixture was warranted before adding a seventh field.
   It came back with "the prompt's premise doesn't hold against the actual design," showed that the optional-when-empty shape leaves all six existing `toEqual` literals untouched, and declined it as tidying code the change never touches.
   A subagent resisting a leading question from its dispatcher is worth noting; the two tidyings it *did* recommend both landed and both shrank the commits that followed.

3. **A data-loss bug was found by reasoning, not by a failure.**
   Nothing reported it and no test caught it.
   Planning traced `saveAndNotify` → `snapshot()` → `saveSettings`' whole-file `writeFileSync` and predicted that a hand-edited `excludedExtensionPackages` would be erased by any unrelated `/subagents:settings` edit.
   The red test in TDD step 2 failed exactly as predicted.
   Notably this inverted an earlier judgment: the PR Review stage had dismissed PR #697's conditional-spread in `snapshot()` as test-appeasement, when it was incidentally preventing this.

#### What caused friction (agent side)

1. `missing-context` — the PR Review evaluated Pi's seams from the `.d.ts` type surface without checking the compiled call order.
   `DefaultResourceLoaderOptions.extensionsOverride` looks like a clean filter seam and is one; it simply runs after `loadExtensionsCached` has already imported the modules and before `applyExtensionSourceInfo` populates `sourceInfo`.
   Neither fact is visible in the types.
   Impact: two incorrect claims were committed to `main` in the triage note (`7dc384b1`) and corrected one stage later at planning.
   No code rework, but the recorded evaluation the contributor may read is wrong on both points until the planning stage entry corrects it.

2. `missing-context` — dispatched a subagent, then never inspected what it ran.
   The first `pre-completion-reviewer` dispatch escalated a failed `grep` into `find /`.
   The operator caught this; I did not.
   I had the interrupted result in hand and was ready to move on.
   Impact: user-caught, and it was the operator's question — not my own review — that surfaced a whole-filesystem walk, a stale-SDK-version read, and two latent permission-system bugs.

3. `instruction-violation` (self-identified) — broke a file's parse with a partial block edit.
   `AGENTS.md` states: "When wrapping existing lines in a new enclosing block (a `describe`, function, or `try`), emit the opening and closing braces as two `edits[]` entries in one `Edit` call (or use `Write`) — a lone opening brace fails the whole file parse."
   The TDD step 1 edit replaced the sanitizer `describe`'s closing `});` with a bare `describe(`, and Biome reported two parse errors.
   Impact: one wasted edit cycle, caught immediately by the autoformat hook; no rework beyond the repair.

4. `missing-context` — typed a new test-helper stub more strictly than its siblings.
   `createLoaderSettingsManager: vi.fn((parent: unknown): unknown => parent)` failed `tsc` with `Type 'unknown' is not assignable to type 'SettingsManager'`, while the `createSettingsManager` stub one line above already showed the working pattern (`vi.fn().mockReturnValue({})`).
   Impact: one extra `pnpm run check` cycle.

#### What caused friction (user side)

1. **The highest-leverage intervention in the session was a question, not a correction.**
   "What justification did it have running `find /`?" was strategic oversight of exactly the kind this workflow wants from the operator — it questioned an agent's *judgment* rather than its output, and it found things no deterministic gate would have.
   Worth repeating as a pattern.

2. **A durable principle arrived late and only in chat.**
   "As a core principle, we should be improving our provenance and observability" is a design constraint for every package here, but it exists only in this session's transcript.
   Opportunity: principles stated in passing during a retro or review are worth promoting to `AGENTS.md` or the `code-design` skill at the moment they are stated, rather than being rediscovered.

3. **No opportunity to intervene earlier on the mechanism error.**
   The `extensionsOverride` claim was wrong on a detail (compiled call order) that the operator had no reason to hold in working memory.
   This one was mine to catch, and the process did catch it.

### Diagnostic details

- **Model-performance correlation** — the session ran three model phases, and the split matched task shape well.
  `anthropic/claude-opus-5` covered PR review, planning, TDD implementation, the permission-incident investigation, and issue drafting (all judgment-heavy).
  `anthropic/claude-sonnet-5` covered `/ship-issue` — procedural work (push, CI watch, close, merge) with no design judgment, and it executed cleanly.
  The retro returned to `opus-5`.
  Both subagent types (`tidy-first-assessor`, `pre-completion-reviewer`) are pinned to `anthropic/claude-sonnet-5` and both produced strong reports; the reviewer's `find /` lapse was a missing scope guardrail rather than a model-tier mismatch, since its actual review reasoning was sound in both dispatches.
- **Escalation-delay tracking** — no agent-side rabbit holes.
  The longest single-error sequence was two tool calls (the parse-error repair, and the mock-typing fix).
  The one genuine escalation failure was the subagent's: **one** failed `grep` → immediate `find /`, with no intermediate attempt to widen the glob depth.
  That is under-escalation of *thinking* rather than over-escalation of tool calls — the opposite of the pattern this lens usually catches, and not detectable by a call-count threshold.
- **Unused-tool detection** — for friction point 1 (the `.d.ts`-only reading), an `Explore` subagent with `model: "sonnet-5"` over `resource-loader.js`/`package-manager.js` was available and is explicitly recommended by `AGENTS.md` for multi-hop SDK traces.
  It was not dispatched at PR-review time; the trace was done inline one stage later during planning, which is where the correction came from.
- **Feedback-loop gap analysis** — verification was incremental and clean.
  Each TDD step ran its own test file before committing; `pnpm run check` ran immediately after every step that touched a shared type (steps 3 and 4); `pnpm fallow dead-code` ran at step 3 specifically because the plan predicted a transient dead-code window there.
  Root `pnpm run lint` ran only at the end and at ship, but per-commit Biome/ESLint pre-commit hooks covered the interval.
  No gap worth acting on.

### Changes made

1. `AGENTS.md` — extended the Pi SDK-internals paragraph: existence in the `.d.ts` does not establish a seam's call order or the data populated when it fires; those live only in the compiled `.js`.
2. `AGENTS.md` — added a read-only scope bound to "Background agent guardrails", which previously addressed only write agents.
3. `.pi/skills/code-design/SKILL.md` — new `### Decision provenance` subsection under "Structural Design": record what decided and on what basis, not only the outcome.
4. `.pi/prompts/pr-review.md` — added step 5 to the Verify gate: an alternative seam named in an evaluation is a claim about unrun code and must be verified to the same standard as the defect.
5. `.pi/agents/pre-completion-reviewer.md` — landed earlier in the session (`34230776`), before this retro: an explicit repo-scope bound, a fix-the-pattern-before-widening ladder, and a rule to pin the dependency version when reading installed types.

[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#709]: https://github.com/gotgenes/pi-packages/issues/709
[#726]: https://github.com/gotgenes/pi-packages/issues/726
[#727]: https://github.com/gotgenes/pi-packages/issues/727
[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
