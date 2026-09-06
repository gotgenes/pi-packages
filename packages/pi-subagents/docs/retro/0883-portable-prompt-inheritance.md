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
