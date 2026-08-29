---
issue: 812
issue_title: "pi-subagents: runtime-registered providers (e.g. pi-claude-bridge) unresolvable in child sessions"
pr: 811
---

# Retro: #812 — Runtime-registered providers unresolvable in child sessions

## Stage: PR Review (2026-08-29T01:15:56Z)

### Session summary

[PR #811](https://github.com/gotgenes/pi-packages/pull/811) from @georgeharker reports that a subagent cannot resolve any provider registered at runtime via `pi.registerProvider` — `pi-claude-bridge` is the common trigger, failing every child with `No API key found for claude-bridge`.
The defect is real and reproduces on current `main`: Pi 0.80.8 replaced `createAgentSession`'s `modelRegistry` option with `modelRuntime`, so the child silently builds a fresh `ModelRuntime` that carries none of the parent's runtime registrations.
The operator chose to **adopt the capability with a simplified design**: rather than forwarding the parent's runtime instance through a private-field reach (the PR's mechanism), replay the parent's runtime registrations onto a fresh child runtime using only public `ModelRegistry` API.

### Evaluation

#### Verify gate — defect confirmed

Pi's own changelog, `## [0.80.8] - 2026-07-16`, states: "Replaced the SDK's `CreateAgentSessionOptions.authStorage` and `modelRegistry` options with the async `modelRuntime` option."
Confirmed in both installed surfaces — `0.80.5` (our pinned devDependency) declares `modelRegistry?: ModelRegistry` and no `modelRuntime`; `0.84.3` (the `pi` that actually runs) declares `modelRuntime?: ModelRuntime` and no `modelRegistry`.

Reproduced with a scratch script against the installed 0.84.3 bundle (since deleted): a provider registered at runtime on a parent `ModelRuntime`, then a child session created each way.

```text
parent registry sees provider: true
PR-base  (modelRegistry only): child sees claude-bridge = false / sameInstance=false
PR-fix   (modelRuntime)      : child sees claude-bridge = true  / sameInstance=true
```

The real boundary is `packages/pi-subagents/src/index.ts:119-125`, which the PR touches.
Runtime registrations live in per-instance maps (`model-runtime.ts:135-136`, `extensionProviders` and `nativeExtensionProviders`), and `sdk.ts:180` builds a fresh `ModelRuntime.create()` whenever `modelRuntime` is absent — so the child's `getAuth()` throws the reported error verbatim.
Not already fixed: `git log -S modelRuntime -- packages/pi-subagents/src/index.ts` is empty on `main`.

#### Checks run

On a scratch worktree of the PR branch: `pnpm run check` passed, `pnpm run lint` passed with zero `lint/` findings, and the pi-subagents suite passed 68 files / 1230 tests.
The PR's own claim of passing checks holds.

#### What is valuable

The diagnosis is correct and precisely located, and the version-straddling guard is functional rather than speculative — `0.80.5`'s `ModelRegistry` has no `runtime` field, so the PR's conditional spread genuinely no-ops on the pinned SDK.

#### What we would change

1. **No test, in an untestable location.**
   The PR is one file, +12/−0, source only.
   `packages/pi-subagents/test/` has no `index` test file, and the package's convention (`SessionFactoryIO`, `EnvironmentIO`, `createLoaderSettingsManager`) is narrow structural contracts testable with plain stubs.
   A source-only bug fix is not eligible for adopt-as-is.
2. **Law of Demeter violation.**
   `ModelRegistry.runtime` is `private readonly` (`model-registry.ts:33`), and the PR reaches it through a duplicated `as unknown as { runtime?: unknown }` cast plus an `as never`.
3. **Shared mutable provider state.**
   Forwarding the parent's runtime instance means every child shares it (`sameInstance=true`), so a child-loaded extension calling `pi.registerProvider`/`unregisterProvider` mutates the parent's pool (`agent-session.ts:2649-2657`).
   No teardown hazard — `AgentSession.dispose()` does not dispose the runtime — and `agentDir` is identical for parent and child (`create-subagent-session.ts:181`), so no auth-scope divergence.

#### The private-field gap is intentional, and the facade already covers us

`sdk.md:1177-1178` and `ModelRegistry`'s own doc comment draw the line deliberately: `ModelRuntime` is the SDK-application surface, `ModelRegistry` is the synchronous extension facade.
`ExtensionContext` therefore exposes `modelRegistry` only — no `session`, no `modelRuntime`. pi-subagents is the unanticipated case, an extension that behaves like an SDK application.

On Pi ≥ 0.80.8 the facade nonetheless exposes everything required, as public API: a public `constructor(runtime: ModelRuntime)`, plus `getRegisteredProviderIds()`, `getRegisteredProviderConfig(id)`, and `getRegisteredNativeProvider(id)`.
`model-runtime.ts:441` shows `getRegisteredProviderIds()` returns exactly `extensionProviders ∪ nativeExtensionProviders` — precisely the set a fresh child runtime lacks.

The replay alternative was verified end-to-end against the installed 0.84.3, covering both registration kinds:

```text
before replay, child sees: claude-bridge=false native-bridge=false
after  replay, child sees: claude-bridge=true  native-bridge=true
session runtime sees claude-bridge: true
ISOLATION — child is a distinct instance:            true
ISOLATION — parent unaffected by child registration: true
ISOLATION — parent survives child unregister:        true
```

`0.80.5`'s `ModelRegistry` has a `private constructor()` and none of the `getRegistered*` accessors, so the replay path requires ≥ 0.80.8 — the same floor the SDK-pin decision independently selected.

### Decision and attribution

**Direction — adopt the capability, plan a simplified design.**
Use PR #811 as reference, not as the merge target.

Agreed scope:

1. **Mechanism — replay, not instance-forwarding.**
   Build a fresh child `ModelRuntime` and replay the parent's runtime registrations onto it through public `ModelRegistry` API.
   No private-field reach, and the child's provider pool is isolated from the parent's.
2. **Seam — extract and test it.**
   The replay belongs in a named module taking a narrow structural source (`getRegisteredProviderIds`, `getRegisteredProviderConfig`, `getRegisteredNativeProvider`) and a register target, matching the package's `SessionFactoryIO` convention.
   `index.ts` keeps a one-line call.
   Ship a regression test that fails without the fix — exercising the injected seam, not ambient host behavior.
3. **SDK pin — bump and narrow.**
   Move the `@earendil-works/pi-coding-agent` devDependency to `0.84.4` and narrow the peer range from `>=0.80.5` to `>=0.80.8`.
   This deletes the two-option straddle and is what makes the public replay path available.
   Narrowing a published peer range is breaking for users on `0.80.5`–`0.80.7`, so the change carries a `!` and a migration note.
4. **Semantics — snapshot at spawn.**
   A provider registered in the parent *after* a child spawns will not appear in that running child.
   This is the committed contract, consistent with how `ParentSnapshot` already captures cwd, model, and system prompt at spawn.
   Document it in `docs/configuration.md`.

Non-goals: no upstream Pi issue — the extension facade intentionally withholds `ModelRuntime` and already exposes sufficient public API, so we work within the split rather than around it.
No dual-mechanism fallback path.

**Attribution.**
Every implementation and docs commit for this issue carries, in its final paragraph:

```text
Co-authored-by: George Harker <george@georgeharker.com>
```

The PR close comment thanks `@georgeharker` by name, links the implementing SHA(s), and credits the diagnosis — the root-cause analysis pinpointing the 0.80.8 option rename is what made the fix tractable.
Reference the PR as `Refs #811`, never `Closes #811`.

## Stage: Planning (2026-08-29T01:46:40Z)

### Session summary

Wrote `docs/plans/0812-runtime-registered-providers-in-child-sessions.md`, a three-step plan implementing the replay design the PR-review stage settled.
A scratch-worktree spike de-risked the two load-bearing unknowns before the plan was written: bumping the three Pi SDK devDependencies to `0.84.4` leaves exactly one type error (the `modelRegistry` option this change removes), and the full design compiles clean with all 68 test files / 1230 tests still green.
The Tidy-First assessor recommended no preparatory refactorings.

### Observations

- **The spike changed the plan's shape.**
  Before measuring, the SDK bump looked like it might be a large migration across `SessionManager`, `ResourceLoader`, and `AgentSession` surfaces.
  It is not — after bumping `pi-coding-agent`, `pi-ai`, and `pi-tui` together, the only error is the one being fixed.
  Bumping `pi-coding-agent` alone leaves two dual-version `pi-tui` errors, which is why all three move as a set.
- **Step 2 is deliberately unsplittable.**
  Bumping the SDK without rewiring leaves `src/index.ts` failing `tsc`; rewiring without bumping is impossible because `0.80.5` has neither the `modelRuntime` option nor a public `ModelRegistry` constructor.
  The peer-range narrowing was folded in rather than split off so no commit on `main` advertises support for a Pi version its own code cannot run on.
- **The regression test had to be the composition-root test, not the unit test.**
  The `inheritRegisteredProviders` unit tests pass whether or not the root is wired, so they do not satisfy the fails-without-the-fix bar.
  `test/print-mode.test.ts` establishes that the extension factory can be driven with a fake `pi` and a mocked `createSubagentSession`, which is what makes capturing `subagentSessionDeps` and calling `io.createSession` directly feasible.
  The file name follows `packages/pi-permission-system/test/composition-root.test.ts`.
- **The registrar interface splits an SDK overload on purpose.**
  `ModelRegistry.registerProvider` is overloaded; a structural interface mirroring it cannot be satisfied by a plain `vi.fn()` without a cast.
  Two distinct method names plus a four-line adapter at the root keeps the native-versus-configured branch — the part most likely to regress — under test.
- **Alternative rejected: typing the seam as the SDK `ModelRegistry`.**
  It would have removed the generics, but `ModelRegistry` carries a private field, so test doubles would need `as unknown as` casts, which both `code-design` and the `testing` skill warn against.
  Generics were also forced by the SDK not exporting `ProviderConfigInput` from its package entry.
- **Peer floor verified rather than assumed.**
  `git tag --contains 9993c9690` in the sibling Pi checkout lists `v0.80.8` first, confirming the public `ModelRegistry` constructor and the three `getRegistered*` accessors landed exactly there.
  The published `@gotgenes/pi-subagents@19.3.5` declares `>=0.80.5`, so narrowing is breaking against a shipped contract.
- **Migration remediation verified.**
  `pi update --help` confirms `pi update --self`; the note does not guess a flag.
- **No follow-up issues filed.**
  The only tangential item — the other eight packages still pinning SDK `0.79.1` — is unrelated churn, so the plan records it as an explicit Non-Goal rather than a tracked follow-up.
  `roadmap-fit` was therefore not exercised.

#### Deferred tidyings

- `packages/pi-subagents/src/index.ts` — the `subagentSessionDeps.io` object literal holds several multi-statement inline lambdas (`createLoaderSettingsManager`, `createSession`) that could be extracted to named functions; the assessor declined it as general composition-root tidiness that would not shrink this change.

## Stage: Implementation — TDD (2026-08-29T02:12:34Z)

### Session summary

Completed all three planned TDD cycles: the SDK-free `provider-inheritance.ts` replay seam with unit tests, the composition-root rewiring with the SDK bump and peer narrowing, and the doc updates.
The pre-completion reviewer returned FAIL on the first round with one blocking defect — a wrong peer floor — which was fixed and re-reviewed to PASS.
Test count moved from 1230 to 1238 across 68 → 70 files in `pi-subagents`.

### Observations

- **The reviewer caught a real, shipped-if-missed defect, and it was mine.**
  The plan asserted the peer floor was `>=0.80.8`, verified with `git tag --contains 9993c9690`.
  That commit added the public `ModelRegistry` constructor, `getRegisteredProviderIds()`, and `getRegisteredProviderConfig()` — but **not** `getRegisteredNativeProvider()` or the native `registerProvider(provider)` overload, which landed three days later in `019e4ad68`, first tagged `v0.81.0`.
  `inheritRegisteredProviders` calls `getRegisteredNativeProvider` unconditionally for every registered id, so on Pi `0.80.8`–`0.80.10` every subagent spawn would have thrown `TypeError: modelRegistry.getRegisteredNativeProvider is not a function` — a worse failure than the bug being fixed.
- **The generalization is the lesson.**
  I checked *one* commit for a *set* of three accessors and quantified over all of them.
  This is exactly the universal-claim failure AGENTS.md warns about, made against an external surface rather than a subagent report.
  The correct check enumerates each API independently: `git show <tag>:<path> | grep <symbol>` per symbol per candidate tag, which is what the fix used.
- **Rewriting history was the right call, not a convenience.**
  The wrong floor lived in the `BREAKING CHANGE:` footer, which release-please copies verbatim into an uneditable `CHANGELOG.md`.
  Nothing had been pushed (6 commits ahead of `origin/main`), so `git reset --soft` + rebuild produced a correct footer; a follow-up commit could not have.
  Verified the rewrite with `git diff backup-812 HEAD`, which showed exactly the two intended edits and nothing else.
- **The plan's false claim was corrected in place rather than deleted.**
  A blockquote above the wrong sentence records what was wrong and why the verification method missed it, so the gap stays legible to anyone reusing `git tag --contains` the same way.
- **The composition-root test earned its cost.**
  The `inheritRegisteredProviders` unit tests pass whether or not the root calls them, so they never satisfied the fails-without-the-fix bar.
  Only `test/composition-root.test.ts` goes red on a reverted wiring; the reviewer independently traced that it fails on four separate assertions.
- **Mutation-tested the branch-order pin.**
  Swapping the native/config order in the implementation failed exactly one test ("prefers the native form"), confirming that pin is not vacuous.
- **Deviation from the plan's Module-Level Changes.**
  The architecture doc's health-metrics row also needed updating (LOC `8,323` → `8,416`, files `61` → `62`, maintainability `91.0` → `91.1`), which the plan's table did not list.
  Values were re-measured with `fallow health` and a direct line count rather than incremented by hand; the old LOC figure was already 13 lines stale.
- **Reviewer's non-blocking find, folded in.**
  Provider *registrations* are isolated per child, but Pi's `resolve-config-value.ts` keeps a module-scope `commandResultCache` shared process-wide, so a shell-command API key (`"apiKey": "!cmd"`) resolves once for parent and children together.
  Pre-existing SDK behavior, but adjacent enough to the isolation claim that `docs/configuration.md` now says so.
- **The SDK bump was far cheaper than feared** — the planning spike had already established that bumping `pi-coding-agent`, `pi-ai`, and `pi-tui` together leaves exactly one type error (the one being fixed), so implementation hit no surprises there.
- **Pre-completion reviewer: FAIL (round 1) → PASS (round 2).**
  Round 1's blocking defect was the peer floor.
  Round 2 was scoped to the delta and confirmed `>=0.81.0` is both correct and minimal, the footer's every factual claim holds, all three commits retained the `Co-authored-by` trailer through the rewrite, and the shell-command-cache note is accurate.

## Stage: Final Retrospective (2026-08-29T02:35:09Z)

### Session summary

One session carried #812 through all four stages — third-party PR triage, planning, TDD implementation, and ship — landing `@gotgenes/pi-subagents@20.0.0` with a breaking peer-range narrowing.
The capability from @georgeharker's PR [#811] was adopted with a different mechanism: replay the parent's runtime provider registrations onto an isolated child `ModelRuntime` through public `ModelRegistry` accessors, rather than forwarding the parent's runtime instance through a private-field reach.
The session's decisive moments were both external to the implementing agent — an operator question that dissolved the private-field reach, and a `pre-completion-reviewer` FAIL that caught a wrong dependency floor before it shipped.

### Observations

#### What went well

- **The `pre-completion-reviewer` caught a defect that would have shipped, and it was a design-level catch, not a lint-level one.**
  The plan pinned the peer floor at `>=0.80.8`.
  `inheritRegisteredProviders` calls `getRegisteredNativeProvider()` unconditionally for every registered id, and that accessor does not exist until `v0.81.0` — so on Pi `0.80.8`–`0.80.10` every subagent spawn would have thrown `TypeError`, a worse failure than the bug being fixed.
  This is the strongest validation of that agent so far: the wrong floor was already in the plan, `package.json`, the `BREAKING CHANGE:` footer, and `docs/configuration.md`, and every deterministic gate (`check`, `lint`, `test`, `fallow`) was green over it.
- **The operator's one substantive intervention changed the design.**
  After the PR-review evaluation concluded the private-field reach into `ModelRegistry.runtime` was "currently unavoidable", the operator asked whether the omission might be intentional and what Pi's own docs say.
  It is intentional (`sdk.md` lines 1177-1178 split `ModelRuntime` as the SDK-application surface from `ModelRegistry` as the extension facade) — and the facade already exposed `getRegisteredProviderIds()` / `getRegisteredNativeProvider()` / `getRegisteredProviderConfig()`, which made the reach unnecessary.
  The resulting design also removed a hazard the PR carried: sharing one mutable provider pool between parent and every child.
- **Measurement replaced argument at three separate decision points.**
  A throwaway script against the installed 0.84.3 bundle proved the defect (`child sees claude-bridge = false`) rather than trusting the PR body; a second proved the replay alternative end-to-end including both registration forms and three isolation properties; a scratch-worktree spike established that the SDK bump leaves exactly one type error before the plan was written.
- **Mutation-testing a new pin, cheaply.**
  Swapping the native/config branch order in `inheritRegisteredProviders` failed exactly one test ("prefers the native form"), confirming the pin was not vacuous — about 30 seconds of work.
- **The `tidy-first-assessor` correctly returned "none".**
  Its reasoning was that the plan's own new-module step *was* the tidy-first move, mirroring `package-exclusions.ts`'s established shape — a more useful answer than manufacturing a preparatory commit.

#### What caused friction (agent side)

- `missing-context` — the peer floor was derived from `git tag --contains 9993c9690`, a commit that added the public `ModelRegistry` constructor, `getRegisteredProviderIds()`, and `getRegisteredProviderConfig()` — but **not** `getRegisteredNativeProvider()` or the native `registerProvider(provider)` overload, which landed three days later in `019e4ad68` (first tagged `v0.81.0`).
  One commit was checked; a claim was then made about a set of five APIs.
  Reviewer-caught, not self-caught, and not user-caught.
  Impact: the wrong floor propagated into four artifacts before detection, and correcting it required rewriting two unpushed commits (the `BREAKING CHANGE:` footer ships verbatim to an uneditable `CHANGELOG.md`, so a follow-up commit could not fix it) plus one extra correction commit, `be47ef70`.
- `other` — the PR-review evaluation asserted the private-field reach was "currently unavoidable" after checking that `ExtensionContext` exposes no `modelRuntime` and that `ModelRegistry` has no `runtime` accessor, but without enumerating what `ModelRegistry` *does* expose.
  The negative was verified; the alternative surface was not.
  Impact: no rework — the operator's question caught it before the plan was written — but the recorded evaluation would otherwise have committed the repo to a private-field design.
- `instruction-violation` (self-identified) — `/plan-issue` instructs checking `docs/architecture/` for "layout listings, complexity tables, health metrics" affected by added modules; the plan's Module-Level Changes table listed the Mermaid node and module tree but omitted the health-metrics row.
  Caught at `/tdd-plan`'s own plan-vs-actual cross-check step.
  Impact: none beyond folding the row into the existing docs commit; the stale figures were re-measured (`fallow health`, direct line count) rather than incremented, which also corrected a pre-existing 13-line drift.

#### What caused friction (user side)

- None.
  The single intervention was strategic rather than mechanical, and it arrived at the cheapest possible moment — after the evaluation was written but before the plan committed to a design.
  It is the model case for a redirecting question over a correction.

### Diagnostic details

- **Model-performance correlation** — directly observed from inline transcript labels: the ship stage ran on `anthropic/claude-sonnet-5`, the retrospective on `anthropic/claude-opus-5`.
  All three subagent dispatches (one `tidy-first-assessor`, two `pre-completion-reviewer`) ran `anthropic/claude-sonnet-5` per their agent frontmatter.
  The session recorded three model changes (`opus-5` → `sonnet-5` → `opus-5`), which places the PR-review, planning, and TDD stages on `opus-5`.
  No quality mismatch found, and one finding worth keeping: the peer-floor defect was *made* on `opus-5` during planning and *caught* on `sonnet-5` by the fresh-context reviewer.
  The corrective is procedural (verify each symbol), not a model upgrade — the stronger model made the error, and fresh context, not more capability, is what found it.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; longest single-error sequence was two iterations on `composition-root.test.ts` lint findings (mock parameter typing, then an unnecessary optional chain), well under the five-call threshold.
- **Unused-tool detection** — nothing actionable.
  `colgrep` went unused all session, correctly: every search was for an exact symbol in a sibling checkout, which is grep's case per the `colgrep` skill's own decision table.
  An `Explore` dispatch for the SDK archaeology was considered and correctly skipped — `AGENTS.md` reserves it for multi-hop hunts, and these were targeted reads of known files.
- **Feedback-loop gap analysis** — no gap.
  A full green baseline (`check`, `lint`, `test`, `fallow dead-code`) was established before the first TDD cycle; `pnpm run check` ran after each step; root-level `pnpm run lint` ran before committing step 2 and caught two errors that a package-scoped run would have surfaced identically but later.
  The one thing no gate could see was the peer floor — it is a claim about *other* installations, invisible to every local check, which is precisely why it needed a source-level per-symbol verification rather than a green suite.

### Changes made

1. `AGENTS.md` — added the dependency-floor verification rule to the enumerated-external-facts paragraph: a floor is a claim about each symbol the change uses, `git tag --contains <sha>` answers only which release carries one commit, and every symbol needs resolving against the candidate floor before pinning it.
2. `packages/pi-subagents/docs/retro/0812-runtime-registered-providers-in-child-sessions.md` — this Final Retrospective stage entry.

#### Proposed and declined

- An `AGENTS.md` rule requiring the owning type's full public surface to be enumerated before recording a private-field reach, cast, or shim as unavoidable — drawn from the "currently unavoidable" conclusion the operator's question overturned.
  Declined this round: the operator judged it sufficiently covered by the existing universal-claim and SDK-seam guidance, and it cost no rework here.
  Revisit only if the same shape recurs.

[#811]: https://github.com/gotgenes/pi-packages/pull/811
