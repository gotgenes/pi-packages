---
issue: 883
issue_title: "pi-subagents: subagents on a Claude-Agent-SDK provider (pi-claude-bridge) get 400 \"Third-party apps now draw from your extra usage\" — the inherited parent prompt is the trigger"
pr: 884
---

# Retro: #883 — Portable prompt inheritance for re-homed child prompts

## Stage: PR Review (2026-09-06T00:46:54Z)

### Session summary

PR #884 (@georgeharker) proposes an opt-in `portable` prompt-inheritance strategy so a child whose provider re-homes the prompt into another harness inherits only the parent's portable parts instead of pi's assembled base.
The underlying defect is real and reproduces on current `main`, but tracing it into `pi-claude-bridge` showed the mechanism is narrower than the PR's account: the bridge already ships a projection fix, and our own tail-stripping (#640, #801) is what defeats it.
The operator's decision is to reply to @georgeharker and to the bridge maintainer with that evidence first; PR #884 stays open and nothing lands here yet.

### Evaluation

#### Verify gate — the defect is real, on the path the PR touches

A throwaway test (written, run, deleted) built a real parent prompt with pi's own `buildSystemPrompt` from the pinned SDK `0.84.4` and pushed it through `buildAgentPrompt` on current `main`.
All three assertions passed, confirming the defect:

- the parent prompt carries both `custom providers (docs/custom-provider.md)` and `pi packages (docs/packages.md)` — the pair @georgeharker bisected to;
- an `append`-mode child inherits both verbatim, plus `operating inside pi, a coding agent harness`;
- a `replace`-mode child does too.

The line lives in pi's base preamble (`../pi/packages/coding-agent/src/core/system-prompt.ts`, the documentation-routing bullet), which pi emits *before* `<project_context>`, the skills catalogue, and the cwd footer.
`inheritedIdentity` in `packages/pi-subagents/src/session/prompts.ts` cuts at the catalogue-or-footer, so the base preamble is on the kept side by construction.
This is ADR 0006 working as designed, not a bug in the cut.

Not already fixed: `main` is at `pi-subagents` 21.4.2, the reporter's own version, and no commit in the `prompts.ts` history has ever removed the base preamble.

Not fully reproducible here: the downstream half — Anthropic's OAuth gate returning `400 Third-party apps…` — needs the bridge, a subscription token, and a zero-credit account.
It is accepted on the reporter's bisection and on the bridge's independent forensic write-up (below).

Regression risk in the other direction is low: the PR's default stays `full` and nothing changes without an opt-in.

#### Checks

Run in a scratch worktree off `pr-884` (torn down afterwards): `pnpm run check` pass, `pnpm run lint` pass (biome + eslint + rumdl), `pi-subagents` suite 1581/1581 pass.
Genuinely green.

#### Root-cause reframing — the truncation/matcher mismatch

`pi-claude-bridge` is `elidickinson/pi-claude-bridge` (npm `pi-claude-bridge`), not @georgeharker's package.
Its `diag/EXTRA-USAGE-400.md` is an independent forensic write-up of the same 400, with a replay harness, a system-prompt swap matrix, and a 13-row ruled-out table.
It reaches the same discriminator (`pi packages` inside the documentation-routing line) and then describes a fix:

> The fix treats prompt captures as an inheritance graph.
> When a new custom prompt contains an **exact previously assembled prompt**, the bridge records that byte range as an edge to the parent capture.

That fix is **already shipped in 0.7.0**, the version the issue reports.
Confirmed by pulling the published tarball: `findInheritedPrompts` appears 4 times in `package/src/prompt-capture.ts`.

It fails against this fork for a specific reason.
The matcher is an exact substring search for the parent's full assembled prompt:

```ts
for (let start = custom.indexOf(key); start !== -1; start = custom.indexOf(key, start + key.length))
```

`key` is the parent's `assembledPrompt` — catalogue, cwd footer and all.
But `inheritedIdentity` *truncates* the parent prompt before embedding it, so `indexOf` returns `-1`, no inheritance edge is recorded, and the whole pi base is forwarded verbatim.

The dates line up:

| Commit / release                                           | Date       | Effect                                            |
| ---------------------------------------------------------- | ---------- | ------------------------------------------------- |
| `449078d0` strip inherited cwd footer                      | 2026-07-24 | child no longer embeds the parent prompt verbatim |
| `pi-claude-bridge` 0.7.0 ships the exact-substring matcher | 2026-08-08 | matcher assumes verbatim embedding                |
| `610a4e9a` + `49f3e46b` strip the skills catalogue         | 2026-08-30 | divergence widens                                 |

The write-up also describes the child prompt as carrying "the child role, environment, specialization, **memory, and preloaded skills**" — that is `tintinweb/pi-subagents`, not this fork.
Memory was removed in `6ebeb91f` and skill-preloading in `93266ff4`.
So the bridge's projection was written against upstream `pi-subagents`, and our own correctness fixes (#640, #801) are what defeat it.

The issue's stated mechanism — that the matcher "can never match across the parent/child boundary" because each session loads its own extension instance — is not what fails.
`promptCaptures` is a module-level singleton in the bridge's `src/index.ts`, and pi's `loadExtensionsCached` reuses the cached factory for the same cwd, so parent and child share the map in the ordinary same-cwd case.
The matcher fails on the truncation.

#### Why our own children are unaffected

`@gotgenes/pi-anthropic-auth` strips the offending paragraphs at the transport boundary.
Its `PARAGRAPH_REMOVAL_ANCHORS` drops the paragraph beginning `Pi documentation (read only when the user asks about pi itself`, which *is* the block containing the trigger line, along with the pi identity sentence and the `In addition to the tools above` filler.

Running `shapeAnthropicOAuthSystemPrompt` over a real child prompt confirmed it:

| Stage                             | Lines | Chars | Trigger present   |
| --------------------------------- | ----- | ----- | ----------------- |
| Child as `pi-subagents` builds it | 58    | 2894  | yes, both phrases |
| Same child after shaping          | 50    | 1291  | no                |

The coverage reaches children by way of **#812**, the issue this PR follows up on: `pi-anthropic-auth` installs its wrapper with `pi.registerProvider("anthropic", { …, streamSimple })`, a configured registration, and `inheritRegisteredProviders` in `packages/pi-subagents/src/session/provider-inheritance.ts` replays exactly those onto every child's fresh `ModelRuntime`.
The `docs/architecture.md` background-agent gap does not apply — `pi-subagents` builds a real `AgentSession` through `modelRuntime`, not a bare `agentLoop` on `compat.streamSimple`.

This is why the issue is not urgent for us, and it sets the priority accordingly.

#### The capture seam is the only one available

`ctx.getSystemPromptOptions()` would remove the PR's `before_agent_start` capture, the `SubagentRuntime` mutable state, the `ParentPromptOptions` type and the snapshot field.
It is not available.
`createCommandContext()` in pi's `core/extensions/runner.ts` attaches that accessor; `createContext()` — the ordinary event context this package holds from `session_start` — never gets it.
The pinned `0.84.4` declarations agree: it is declared on `ExtensionCommandContext`, and only optionally on the internal `ExtensionContextActions`.

Recorded so a later stage does not re-derive it.

#### The `#180`/`#400` marker-vs-cache-prefix tension

@georgeharker's own suggestion 2 — expose provenance — is what the bridge's code explicitly asks for:

> If pi later exposes an inherited-system-prompt field, it should replace this inference.

But any marker placed *before* the inherited text breaks the byte-identical parent prefix that `f35e7b1b` ("perf: remove `<inherited_system_prompt>` wrapper to maximise KV cache reuse (#180)") and `1cc25cf0` (#400) exist to preserve.
This constrains any provenance design before it starts, and is likely why the PR reached for a side channel instead.

#### Code-level findings on the PR itself

Relevant only if we later reuse the PR's shape.

1. **The settings union is over-built.**
   `promptInheritance: "portable" | { default?, providers? }` buys a union type plus `normalizePromptInheritance`, `applyPromptInheritance`, `sanitizePromptInheritanceProviders`, `PromptInheritanceConfig`, and dual state `_promptInheritance` + `_promptInheritanceRaw`.
   The operator's preference is the rules object alone.
2. **Unreachable branch.**
   In `settings.ts`, `_promptInheritanceRaw` is assigned unconditionally alongside `_promptInheritance` on every load and there is no setter, so `raw === undefined` implies normalized-is-default and the `else if` reconstruction branch in the snapshot getter cannot fire.
3. **Over-wide threading.**
   `RunConfig` in `src/runtime.ts` is the turn-loop config (`defaultMaxTurns`, `graceTurns`, `midRunUpdates`).
   The PR widens it with two prompt fields, passes the whole `settings` object as `params.runConfig`, then flattens it back into two `AssemblerContext` fields and re-runs the precedence chain inside `assembleSessionConfig`.
   The package convention for `excludedExtensionPackages` is a ready-made settings view resolved in `index.ts`; since the strategy depends on the child's resolved provider, the equivalent here is a single resolver, `(provider: string | undefined) => PromptInheritance`.
4. **Hand-rolled near-copy of pi's rendering.**
   `buildPortablePrompt` in `parent-snapshot.ts` re-renders `<project_context>` without pi's `Project-specific instructions and guidelines:` lead-in and with different blank-line spacing, and joins `promptGuidelines` raw where pi renders them as `-` bullets under a `Guidelines:` heading.
   The operator's preference is to match pi byte for byte and pin the format with a test.
5. **Naming.** `PromptInheritanceConfig.def` is an abbreviation, against the `code-design` skill.
6. **Commit hygiene.**
   One commit carries the feature, the ADR, the docs, and an unrelated `sanitize` to `sanitizeTuningFields`/`isBoundedInt` tidying, which under this repo's flow is a preparatory `refactor:` commit.

Not breaking: the default is unchanged, the settings key and frontmatter key are additive, and `AgentPromptConfig` gains an optional field.
Test coverage is genuine — 25 tests, with the frontmatter over provider over default precedence pinned explicitly.

One consequence worth carrying forward regardless of direction: `createSubagentSession` passes the assembled string as `systemPromptOverride`, which becomes pi's `customPrompt` and replaces pi's base wholesale.
A `portable` child therefore loses `Available tools:` and the computed tool guidelines entirely.
That matters more than it first appears, because the bridge blocks Claude Code's own tools (`tools: []`, `--strict-mcp-config`) and serves pi's over an in-process MCP server under `mcp__custom-tools__`, so those tools are pi's and are genuinely callable.

### Decision and attribution

**Direction: reply with the evidence first.**
The truncation finding is new information for both @georgeharker and the bridge maintainer, and it may make a smaller fix — on either side — the right one.
PR #884 stays open pending those replies; nothing lands in this package yet, and #883 stays open.

Non-goals for this stage: no implementation, no merge, no close.

If we later implement, on either the provenance or the portable path, every implementation and docs commit carries:

```text
Co-authored-by: George Harker <george@george-graphics.co.uk>
```

The PR close comment thanks `@georgeharker` by name and links the implementing SHAs.
Any ADR that comes out of this also credits `elidickinson`'s `diag/EXTRA-USAGE-400.md` for the original bisection and replay methodology, which independently established the discriminator.
Reference the PR as `Refs #884`, never `Closes #884`.

## Stage: Final Retrospective (2026-09-06T01:31:36Z)

### Session summary

One session, run end to end on `anthropic/claude-opus-5`, reviewed PR #884 and landed a triage note (`e509eb33`) plus a comment on the PR.
The review's substantive output was a root-cause reframing: the bridge already ships the projection fix, and this fork's tail-stripping breaks its exact-substring matcher.
That finding arrived only after the operator asked what `pi-claude-bridge` was, on the fourth clarification round.

### Observations

#### What went well

- **The Verify gate's rule 5 did exactly its job.**
  The obvious simplification to propose was replacing the PR's `before_agent_start` capture with `ctx.getSystemPromptOptions()`.
  Checking it first — `createCommandContext()` in pi's `runner.ts` attaches that accessor, `createContext()` does not — turned a wrong recommendation into a recorded finding that the PR's seam is the only one available.
  Without that rule the review would have asked a contributor to rewrite working code onto an API that is not reachable.
- **The operator's own wire-capture log was decisive primary evidence.**
  `~/.pi/agent/bin/anthropic-system.log` (written by `pi-capture.sh`, surfaced by the `/system-prompt-wire` command) records what actually left the machine.
  Record 3 shows the `Pi documentation` block absent, settling "why does this not affect us" with an artifact rather than an inference.
  Novel: no prior session in this repo has read a wire capture as evidence.
- **Cross-package empirical verification.**
  Running `shapeAnthropicOAuthSystemPrompt` from `@gotgenes/pi-anthropic-auth` directly over a generated child prompt (2894 chars to 1291, trigger gone) proved the immunity claim rather than asserting it, and proved it for the *child*, which the wire log did not cover.
- **Pulling the third-party published tarball.**
  `pnpm view pi-claude-bridge@0.7.0 dist.tarball` plus `grep -c findInheritedPrompts` converted "the bridge's safeguard can never match" from a reporter's claim into a checkable fact, and the date table followed from it.
  This is the third-party analogue of the `AGENTS.md` rule about reading a published tag before pricing a rename.

#### What caused friction (agent side)

- `missing-context` — the decisive evidence sat in a repository named in the **first paragraph** of issue #883, and it went unread until the operator asked "What is `pi-claude-bridge`?"
  on the fourth round.
  Everything that reframed the review — the shipped `findInheritedPrompts`, `diag/EXTRA-USAGE-400.md`, the exact-substring matcher, the date table — came from a single `fetch_content` call on that repo.
  Impact: the largest in the session.
  The recommendation given at the first gate ("adopt the capability, plan a simplified design") was wrong, and the final direction ("reply with the evidence, hold the PR") is a different outcome, not a refinement of it.
  Three clarification rounds were spent getting there.
- `premature-convergence` — the first `ask-user` gate recommended a direction after evaluating only the diff and this repo's code, with no examination of the consumer whose failure motivated the PR.
  Impact: compounded the above; the recommendation had to be withdrawn twice.
- `missing-context` — the operator's deployed environment was never established.
  `@gotgenes/pi-anthropic-auth` sits beside this repo in `~/development/pi/`, is by the same author, and mitigates the exact defect under review.
  It entered the session only because the operator named it.
  Impact: the second gate bounced; "is this defect reachable by us at all" is a priority question that was answered late.
- `instruction-violation` (self-identified) — the prompt's Load-skills section names `colgrep`, `code-design`, `design-review`, and `testing`; only `package-pi-subagents` was loaded.
  Impact: no measurable rework — the relevant heuristics were already in context from `AGENTS.md` — but `colgrep` was never used and semantic search would have been the natural tool for the bridge exploration.
- `instruction-violation` (tooling-caught) — `npm view` was typed despite the pnpm-only rule, and an unquoted `--include=*.ts` glob was passed to `grep` twice despite the explicit `AGENTS.md` rule.
  Impact: three wasted tool calls; both rules already exist and were simply not applied.
- `other` — the scratch reproduction test took four consecutive attempts to import `buildSystemPrompt`: the barrel does not export it, the deep `dist/` path is not in `exports`, and `./package.json` is not either.
  Impact: four tool calls.
  Reading the SDK's `exports` map once would have cost one.

#### What caused friction (user side)

- The operator knew about `pi-anthropic-auth` and about `pi-claude-bridge`'s role from the outset and surfaced each only when a gate bounced.
  Framed as opportunity rather than criticism: the fix is structural, not behavioral — the `pr-review` prompt should require the downstream consumer and the operator's own mitigations as inputs, so the review does not depend on the operator remembering to volunteer them.
- The operator's redirects were strategic rather than mechanical throughout — "why don't I have this issue", "what is `pi-claude-bridge`", "why did the PR author remove so much" each reframed the problem rather than correcting an output.
  The third question in particular produced the finding that the PR's coarseness is a property of its seam, not a judgment its author made.

### Diagnostic details

- **Model-performance correlation** — every turn ran on `anthropic/claude-opus-5`; no subagents were dispatched.
  The multi-hop `pi-claude-bridge` trace (roughly ten calls across README, changelog, `diag/`, `src/prompt-capture.ts`, and the published tarball) is the shape `AGENTS.md` suggests delegating to an `Explore` subagent.
  It is deliberately **not** proposed as a change: the trace's output was a universal claim the whole decision rests on, which `AGENTS.md` says to keep inline rather than accept as a subagent's summary.
- **Escalation-delay tracking** — the SDK-import fumble ran four consecutive calls on the same error, just under the five-call threshold.
  No other sequence exceeded two.
- **Unused-tool detection** — `colgrep` was available and never used, tracking the skipped skill load.
  `fetch_content` on the GitHub repository was the right tool for the bridge and worked on the first call.
- **Feedback-loop gap analysis** — not applicable; this session changed no source.
  The PR branch's `check`, `lint`, and test runs were launched together in the background early, which cost nothing and had results ready before they were needed.

### Changes made

1. `.pi/prompts/pr-review.md` — added Verify-gate item 6, *Read the downstream consumer*: when the report names another project as the failure path, read that project before judging the diff, and ask there the same already-fixed question item 2 asks here (`pnpm view <pkg> dist.tarball`).
2. `.pi/prompts/pr-review.md` — added Gather-context item 6: establish whether the defect can reach us, by checking the `@gotgenes/*` extensions this repo runs under, including ones outside this monorepo.
3. `.pi/prompts/plan-issue.md` — extended Gather-context item 4's upstream-dependency rule: searching the tracker is not reading the code, so read the blamed project's source and the reporter's published tarball.
   Folded into the existing sentence rather than added as an item, because that rule already sends the session to the other project and merely stops at the tracker.
4. `.pi/prompts/plan-issue.md` — extended Gather-context item 6 with the same reachability check as change 2.
5. `AGENTS.md`, `## Reading this repo's own artifacts` — added the durable form: a third-party report's claim about the *other* side is the one to check, with #883 as the worked example, plus the separate reachability question.

The imperative is duplicated across both prompts and `AGENTS.md`; the rationale and worked example live only in `AGENTS.md` and this retro.
That split is deliberate — this session skipped two ambient `AGENTS.md` rules (glob quoting, `pnpm` over `npm`), so an ambient rule alone does not reliably fire at the point of use.

Declined during the retro: guidance about dispatching an `Explore` subagent for the downstream trace (it would contradict the existing rule to keep a decision's universal claim inline), and any change to `.pi/prompts/triage-backlog.md` (it ranks an existing backlog rather than evaluating a report's diagnosis).

One authoring note worth carrying, because it caused a near-miss in this retro's own commit.
A sentence beginning `#883` at the start of a line is read as a markdown heading by `pi-autoformat`, and the formatter then **renormalized every subsequent heading level in `AGENTS.md`** to stay consistent with the phantom `##` — 13 headings demoted one level.
Fixing the offending line did not undo that; the demotions survived into the first commit and had to be reverted by hand.
Lead with `Issue #883`, and after any `AGENTS.md` edit diff the heading lines (`git diff <base> -- AGENTS.md | grep '^[+-]#'`) before committing — `rumdl check` passes on the renormalized file, so no gate catches it.

## Stage: PR Review — Contributor Reply (2026-09-06T02:56:58Z)

### Session summary

@georgeharker replied on both #883 and #884 within the hour: he verified the byte-mismatch trace against his own captured query, posted a correction to his own root-cause chain, prototyped the bridge-side fix, and filed it as `elidickinson/pi-claude-bridge#88`.
He offered to reframe or withdraw PR #884, deferring to this repo and to `@elidickinson`.
The operator's call is to reply now with two additions and hold the disposition until `@elidickinson` responds on the bridge issue; #883 stays open, cross-linked.

### Evaluation

#### Why both root-cause analyses were correct

The most valuable thing in the reply is a reconciliation neither side could have reached alone. @georgeharker's bridge fork carried `fix/subagent-provider-registration` (`ff505ac`, 2026-08-25), which routed child streaming through the child's **own** module instance because the parent-routed path broke prompt capture — its commit message quotes the bridge's `prompt-capture: no capture for this system prompt` throw.
That was a bridge-side resolution of the same problem `f805ffc` (2026-08-28, "inherit runtime-registered providers in child sessions", #812) solved on this side.
Under his fork the capture maps genuinely were separate, so instance isolation *was* the operative mechanism; under upstream `pi-subagents` the child uses the parent's registered provider object, the singleton is shared, and bytes became the blocker.

The review's PR-side comment treated his instance-isolation claim as simply wrong.
It was configuration-dependent, and neither party could see the other's configuration.
This is the sharper form of the `AGENTS.md` rule added in this issue's retro: a third-party report's claim about the other side needs checking, but "checked and false" may mean "false in *our* configuration", not "false".

#### The prototype and what it covers

`fix/tail-stripped-inheritance-key` (`83621a3`): `record()` derives a `tailStrippedPrompt` cut at the same boundaries `inheritedIdentity` cuts at, and `findInheritedPrompts` matches under either key — both exact substring searches, no fuzzy matching.
Measured live against **default `full` inheritance**, the child's forwarded append drops from roughly 6.2k to 0.9k characters, with pi's base and both trigger phrases absent and the parent's portable parts substituted in place.
One file plus one plumbing line, no new modes, and the child's pi-side prompt is untouched, so the byte-identical parent prefix `#180`/`#400` protect is preserved.

#### Two corrections contributed back

1. **The worktree residual fails silently, not loudly.**
   An empty capture map does not surface as the bridge's `no capture for this system prompt` throw: the child's own `before_agent_start` records a self-capture, so the resolver finds an exact match and simply has no inherited edge.
   The base is forwarded verbatim and the symptom is the same silent 400.
   The underlying mechanism was confirmed here — `useExtensionCacheCwd` in pi's `core/extensions/loader.ts` calls `clearExtensionCache()` on any cwd change, so a worktree child loads a fresh bridge module.
2. **Reconstructing `Available tools:` needs snippets, not names.**
   His plan was to rebuild the section from `assembleSessionConfig`'s `toolNames`, but `registry.getToolNamesForType(type)` yields names only while pi renders `- ${name}: ${toolSnippets[name]}`.
   The snippets are already in the capture he takes: `BuildSystemPromptOptions.toolSnippets` is populated in `_baseSystemPromptOptions` beside `selectedTools`.
   Filtering the parent's snippets by the child's `toolNames` reproduces pi's list exactly, because pi itself lists only tools that have a snippet (`visibleTools = tools.filter((name) => !!toolSnippets?.[name])`).
   The sole gap is child-only tools, `ask_parent` and `notify_parent`.

#### What would remain ours after a bridge-side fix

Two cases, both narrower than #884's current framing:

1. A **worktree child**, whose differing cwd clears pi's extension cache and leaves any capture-based projection with an empty map.
2. Any **other re-homing provider** with no projection to fix.

That is a real but narrow warrant for a second inheritance strategy in a core the package skill describes as deliberately narrow, against an inheritance question ADR 0006 already settled once.
It is not zero, which is why the disposition waits rather than resolving to withdrawal.

### Decision and attribution

**Hold the disposition; reply now.**
Posted on #884: the two corrections above, and the position that `@elidickinson`'s read of bridge #88 should decide whether #884 is reframed as an escape hatch or withdrawn.
If the bridge fix lands, `portable` stops being necessary for #883 and becomes an opt-in for re-homing hosts that cannot fix their projection, plus the worktree case.
If it does not, #884 is the fallback and is taken with the six simplifications recorded in the PR Review stage.

**#883 stays open**, cross-linked to `elidickinson/pi-claude-bridge#88`.
The bridge fix mitigates the symptom for bridge users; it does not change that a `pi-subagents` child carries pi's base prompt into any provider that re-homes it.

Attribution is unchanged from the PR Review stage: `Co-authored-by: George Harker <george@george-graphics.co.uk>` on any implementation or docs commit, `@georgeharker` credited by name in the close comment, and any ADR crediting `elidickinson`'s `diag/EXTRA-USAGE-400.md` for the original bisection.

**No new ADR.**
The finding is a consequence of a decision already made, not a new one, so it lands as a Consequences bullet on ADR 0006 rather than as a `proposed` 0008 — which would also collide with the 0008 in PR #884's own diff.
The precedent is exact: 0006 already carries a bullet for `@gotgenes/pi-nocd`, whose rewrite path was premised on verbatim inheritance, tracked as #846.
`pi-claude-bridge` is the same failure shape and is now recorded beside it, tracked as #883.
ADR 0006 keeps `status: accepted` — the decision is unchanged; only its recorded consequences grew.

## Stage: PR Review — Post-#890 Disposition (2026-09-08T20:22:31Z)

### Session summary

The held disposition resolves: **adopt the capability, plan a simplified design**, with `full` staying the default and `portable` selected by a provider-keyed settings map alone.
The review re-ran the Verify gate on current `main` (post-#890), re-ran the PR's checks, and traced eight concrete stack scenarios that reframed both the surface and `portable`'s scope — including the finding that `portable` on `anthropic` is strictly worse than `full` for this repo's own stack.
Bridge PR `elidickinson/pi-claude-bridge#89` remains open with no maintainer response, so the capability is still warranted, but for a narrower reason than the PR states.

### Evaluation

#### Verify gate — still reproduces on current `main`

A scratch test (`packages/pi-subagents/test/scratch-verify-883.test.ts`, written, run, deleted) built a parent prompt matching pi `0.84.4`'s `buildSystemPrompt` shape and pushed it through `buildAgentPrompt`.
Three assertions, all passing:

- the parent carries `custom providers (docs/custom-provider.md)` and `pi packages (docs/packages.md)`;
- an `append`-mode child inherits both, plus `operating inside pi, a coding agent harness`;
- a `replace`-mode child does too, and neither child is a verbatim superstring of the parent (cwd footer and `<available_skills>` cut).

The routing line is at `../pi/packages/coding-agent/src/core/system-prompt.ts:142`, inside pi's base preamble — emitted before `<project_context>`, the catalogue, and the footer, so `inheritedIdentity`'s cut leaves it on the kept side by construction.
**#890 did not change this**; it made the identity more verbatim, not less.

#### Checks

Scratch worktree off `pr-884` (`f5d4ba9d`, unchanged since the first review), torn down after: `pnpm run check` rc=0, `pnpm run lint` rc=0, `pi-subagents` suite rc=0.
Green on its own base — but the PR is now `mergeable: CONFLICTING` / `mergeStateStatus: DIRTY`, because #890 rewrote `prompts.ts` and `prompts.test.ts`, two of the files it touches.

#### Upstream status

`elidickinson/pi-claude-bridge#88` open; PR #89 (@georgeharker's tail-stripped key) open with zero comments since 2026-09-06; `pnpm view pi-claude-bridge version` still `0.7.0`.
The bridge-side fix has not landed and has drawn no maintainer response, so the capability is not moot.

#### What #890 settled, and what it did not

| PR element                                  | Post-#890 status                                                        |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| `0008-portable-prompt-inheritance.md`       | Collides with the shipped `0008-inherited-region-is-shared-parts.md`    |
| "a portable child loses `Available tools:`" | Closed with `pi-permission-system` installed; #901 owns the absent case |
| "keep `full` for same-API children"         | Stronger — the shared prefix went from 365 chars back to ~57k           |

#### The eight-scenario trace

The decisive analysis. `pi-subagents` captures the parent's **post-extension** prompt: `parent-snapshot.ts:40` calls `ctx.getSystemPrompt()`, which returns `this.agent.state.systemPrompt`, assigned from `result.systemPrompt` after `before_agent_start` (`../pi/…/agent-session.ts:1298-1300`, `:930-932`).

| #   | Stack                           | Strategy   | Result                                                          |
| --- | ------------------------------- | ---------- | --------------------------------------------------------------- |
| 1   | subagents alone                 | `full`     | child advertises the parent's 28 tools holding 8 — this is #901 |
| 2   | subagents alone                 | `portable` | no tool prose at all (pi writes none under `customPrompt`)      |
| 3   | + permission-system             | `full`     | identity carries no tool list; child's own node renders its 8   |
| 4   | + anthropic-auth                | `full`     | trigger stripped before the wire; 2894 → 1291 chars measured    |
| 5   | + anthropic-auth                | `portable` | shaping **no-ops**; strictly worse than 4                       |
| 6   | + claude-bridge, no perm-system | `full`     | #883's 400; bridge #89 fixes it                                 |
| 7   | + claude-bridge + perm-system   | `full`     | **#890 is the precondition** that makes bridge #89 match        |
| 8   | + claude-bridge                 | `portable` | the one case `portable` is load-bearing                         |

Each downstream layer anchors on text the layer beneath leaves in place: `pi-permission-system` on the `Available tools:`/`Guidelines:` headers, `pi-anthropic-auth` on pi's role line, `pi-claude-bridge` on the parent's assembled prompt as a capture key.
`portable` removes the anchor all three key on, which is why it is correct **only** where the host harness supplies its own base.

Scenario 5 is the finding that settles `portable`'s scope.
`shapeAnthropicOAuthSystemPrompt` opens with `indexOf(PI_DEFAULT_PROMPT_PREFIX)` and returns the prompt unchanged on `-1` (`~/development/pi/pi-anthropic-auth/src/system-prompt-shaping.ts:123-126`).
A portable child has no pi role line, so shaping does nothing — and the child never receives `MINIMAL_ANTHROPIC_OAUTH_PROMPT`, which under `full` *replaces* the stripped preamble.
Combined with `general-purpose`'s `systemPrompt: ""` (`src/config/default-agents.ts:23`), a portable child on `anthropic` runs with `AGENTS.md`, a tag, an env block, and no role framing.
Under `full` the same stack already produces `portable`'s intended outcome and supplies role framing as well.

Scenario 7 is worth carrying: pre-#890 the permission system rewrote the tool list inside the identity, so the child diverged from the parent at offset ~412, a tail-stripped key would still have missed, the bridge threw `no capture`, and #889 swallowed it as an empty completion.

#### Why the precedence chain inverts

The PR ranks `inherit_prompt` frontmatter **above** the provider rule.
That resolves wrongly under a per-spawn `model:` override — the very override the PR's `assembleSessionConfig` reorder exists to honor.
An agent declaring `inherit_prompt: portable` because its `model:` names a bridge model keeps that strategy when spawned onto raw Anthropic, discarding the parent identity for a transport that never needed it.
An agent has no opinion about prompt inheritance; a **transport has a requirement**.

Provider-declared policy would be the cleanest expression and is **not reachable**: `ProviderConfigInput` in the pinned SDK `0.84.4` (`dist/core/provider-composer.d.ts:16-40`) carries `name`, `baseUrl`, `apiKey`, `api`, `streamSimple`, `headers`, `authHeader`, `oauth`, `models`, `refreshModels` — no policy field.
Recorded so a later stage does not re-derive it.

#### Why the default does not flip

With `pi-permission-system` installed, `full`'s surplus over `portable` is pi's one-sentence role line plus the doc-routing block.
Loader-registered `appendSystemPrompt` is in both; extension blocks appended at the end are in neither, since they sit past the cwd footer.
So the case for flipping is not about content — it is that flipping would undo #890's just-restored ~57k shared prefix by default, change every child's prompt on a routine upgrade with no user edit (this repo's own `feat!:` criterion), and for non-`pi-permission-system` users trade #901's wrong tool list for no tool list at all, pre-empting #901's own call.

#### Code-level findings carried forward

Still applicable if the PR's shape is reused: the settings union is over-built; `_promptInheritanceRaw`'s reconstruction branch is unreachable; `index.ts` threads the whole `SettingsManager` as `runConfig`; `buildPortablePrompt` hand-rolls `<project_context>` without pi's `Project-specific instructions and guidelines:` lead-in; `PromptInheritanceConfig.def` is an abbreviation; `buildParentSnapshot` gains a third positional.

Correction to the first review's framing: the `assembleSessionConfig` reorder is **not** high-blast-radius.
`resolveDefaultModel` reads only `ctx.parentModel`, `ctx.modelRegistry`, and `agentConfig.model`, and the function is documented side-effect-free, so swapping the two blocks is safe.
The cost of provider keying is the settings machinery, not the reorder.

### Decision and attribution

**Direction: adopt the capability, plan a simplified design.**
PR #884 is reference, not merge target — it conflicts with `main` and its precedence chain resolves wrongly.

Agreed scope:

1. **Default stays `full`.** `portable` is opt-in.
2. **Provider-keyed settings map only** — `"promptInheritance": { "claude-bridge": "portable" }`.
   No `inherit_prompt` frontmatter, no union form, no global `default` arm, no `normalizePromptInheritance`, no dual raw/normalized state.
3. **`portable` is documented as re-homing-hosts-only**, not enforced, with scenario 5 as the worked counter-example in `docs/configuration.md`.
   `genericBase` keeps its existing narrow role, including the PR's empty-capture fallback.
4. **Plan-time task:** measure how reachable an unresolved child model is (`SessionContext.model` is `Model<any> | undefined` at `src/types.ts:101`, propagated optionally at `runtime.ts:59`) and warn if it is — provider-only has no backstop there.

Adopted from the PR essentially as designed: `ParentPromptOptions` as a narrow structural slice of `BuildSystemPromptOptions`; `buildPortablePrompt` rendering from parts rather than slicing assembled text; the fail-safe that an absent or whitespace-only capture never re-embeds the full prompt; skills un-inherited with context files riding along (load-bearing — the child loader runs `noContextFiles: true`); and the `before_agent_start` capture seam, which the first review established is the only one available.

Non-goals:

- **No tool-docs work** — #890/ADR 0014 and #901 own it.
- **No provenance marker or side channel** — any marker before the inherited text breaks the prefix #890 restored; bridge #89 solves it downstream.
- **No provider-declared policy** — `ProviderConfigInput` has no field for it.
- **No worktree-specific handling** — measured to have been the permission-system rewrite, fixed by #890.
- **No change to the default.**

Spun off: **#904** — `genericBase` asserts "full access to read, write, edit files, and execute commands" to every agent type including read-only ones, the same claim ADR 0008 removed from `<sub_agent_context>` four lines above it in the same file.
Dispositioned as Phase 22 Step 20 (`760f1461`).

Attribution is unchanged.
Every implementation and docs commit carries:

```text
Co-authored-by: George Harker <george@george-graphics.co.uk>
```

The PR close comment thanks `@georgeharker` by name and links the implementing SHAs; any ADR credits `elidickinson`'s `diag/EXTRA-USAGE-400.md` for the original bisection.
Reference the PR as `Refs #884`, never `Closes #884`.

## Stage: Planning (2026-09-08T20:34:56Z)

### Session summary

Wrote `docs/plans/0883-portable-prompt-inheritance.md` (`2e7cd91e`) against the direction the PR-review stages settled: a `portable` strategy selected by a provider-keyed `promptInheritance` map, `full` unchanged as the default, no agent frontmatter.
Seven TDD steps — four `refactor:` (settings, snapshot render, runtime capture, assembler branch), one preparatory `refactor:` reorder, one `feat:` wiring commit, one `docs:` commit.
Two planning-time investigations changed the design from what the PR-review stage had recorded.

### Observations

#### `promptGuidelines` must not be inherited — a correction to PR #884

The PR includes `promptGuidelines` in the portable parts, and the PR-review stage carried that forward unexamined.
Reading Pi's `_rebuildSystemPrompt` (`../pi/packages/coding-agent/src/core/agent-session.ts`) shows it is derived per session from `this._toolPromptGuidelines.get(name)` over the session's valid tool names — it is **tool-attached** guidance.
Inheriting the parent's would assert guidance for the parent's tools to a child that may hold none, which is precisely the defect [ADR 0008] removed when it deleted `<sub_agent_context>` for naming `edit` and `write` to a child with neither.

Excluding it produced a sharper boundary than the PR had: the portable identity is `contextFiles` + `customPrompt` + `appendSystemPrompt` — **the operator's own text, and nothing Pi or a tool contributed.**
It also removed the `Guidelines:` rendering question entirely.

The same read settled the render order: Pi composes `customPrompt` → `appendSystemPrompt` → `<project_context>` in both branches of `buildSystemPrompt`, so the portable identity mirrors that.
PR #884's `buildPortablePrompt` had the order inverted (context files first) and omitted Pi's `Project-specific instructions and guidelines:` lead-in.

#### The unresolved-model residual is unreachable — the plan-time task discharged

The PR-review decision left one open item: provider-only selection has no backstop when a child resolves no model, so measure how reachable that is and warn if it is.
Measured: `ctx.model` is `agent.state.model`, and Pi leaves it `undefined` only in `core/sdk.ts:211-223`'s `formatNoModelsAvailableMessage()` branch — no authenticated model exists at all.
Such a parent cannot run a turn, so it emits no `before_agent_start`, holds no capture, and cannot spawn a child that reaches an API.
The other two paths always carry a provider: `resolveDefaultModel` falls back to `parentModel`, and a per-spawn `options.model` is a `Model<any>`.

So **no diagnostic is warranted**, and the surface stays the flat map with no backstop.
The `provider === undefined → "full"` arm is documented in the plan as defensive rather than reachable.

#### Tidy-First: no preparatory commits

The assessor found none, and its reasoning was the useful part: every interface this change touches grows by **optional** fields following patterns already in the package — `excludedExtensionPackages`' sanitize block, the `createSubagentSessionDeps` overrides factory, trailing-bag positionals — so none of the ~29 `InheritedPrompt` construction sites in `prompts.test.ts` or the ~15 deps sites in `create-subagent-session.test.ts` need touching.
It explicitly declined the `settings.ts` `sanitize()` range-check extraction as scope creep: the new block mirrors the `excludedExtensionPackages` array-filter shape, not the integer triplets the scout inventory named, so this change touches none of that debt.
It also declined converting `buildParentSnapshot` to an options object, on the local precedent that `buildAgentPrompt` has four positionals and `assembleSessionConfig` six.

One mechanical consequence it flagged and the plan records: `runtime.test.ts`'s two `toHaveBeenCalledWith(ctx, true)` assertions gain a third argument in Step 3.

#### Step 5 is a preparatory refactor the assessor did not name

The `assembleSessionConfig` model-resolution reorder is part of the change, not preparation for it — but isolating it as a pure no-op commit ahead of the wiring step keeps the `feat:` diff small against a green tree.
Verified independent at planning time: `resolveDefaultModel` reads only `ctx.parentModel`, `ctx.modelRegistry`, and `agentConfig.model`, and the function is documented side-effect-free.
This also corrects the first PR-review stage's claim that the reorder was the PR's highest-blast-radius change.

#### Scope decisions carried from the PR review, not re-litigated

The `ask_user` gate was satisfied by the PR-review stages: direction (adopt with a simplified design), default (`full` stays), surface (provider map only), and `portable`'s scope (re-homing hosts only, documented not enforced) were all decided there and are recorded in the plan's Goals and Non-Goals rather than reopened.
ADR 0009 is planned because the "no new ADR" non-goal was offered and **not** selected, and the decision needs a durable record of why the key is the provider and why the default did not flip.

#### Deferred tidyings

None — the assessor recommended no preparatory commits, and its one rejection (`settings.ts` `sanitize()` range-check triplication) is already inventoried as scattered boy-scout debt at `architecture.md:853`, so it needs no new record here.
