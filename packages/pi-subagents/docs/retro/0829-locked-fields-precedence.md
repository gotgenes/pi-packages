---
issue: 829
issue_title: "pi-subagents: agent frontmatter silently discards subagent tool parameters; narrow the guard to explicitly locked fields"
---

# Retro: #829 — Narrow the frontmatter guard to explicitly locked fields

## Stage: Planning (2026-08-29T22:16:47Z)

### Session summary

Planned Phase 22 Step 3: flip the `subagent` tool door's precedence to caller-wins, add a `locked:` frontmatter opt-out, report discarded overrides in the tool result, and fold in [#834]'s thinking-level validation.
The design gate settled six decisions; a Tidy-First assessment produced one preparatory `refactor:` step and two design corrections.
Plan committed at `packages/pi-subagents/docs/plans/0829-locked-fields-precedence.md` with an eight-step TDD order.

### Observations

The framing in the issue understated how localized the change is.
`resolveAgentInvocationConfig` has exactly one production call site (`resolveSpawnConfig`), and the SDK door already resolves caller-over-config in `assembleSessionConfig` and `SubagentSession.runTurnLoop`.
So caller-wins is not a new policy in the package — the plan makes the tool door agree with the door that already had it.
That reframing is what made "lock scope: tool door only" the cheap answer rather than a compromise.

Traced [#834]'s open question at planning time instead of deferring it.
Measured against the installed `@earendil-works/pi-ai@0.84.4`: `clampThinkingLevel(model, "bananas")` returns `"off"`, because an unknown level misses the ordered table and falls to `availableLevels[0]`.
An unrecognized thinking level therefore silently *disables* thinking rather than being ignored — the strongest argument for rejecting at the door, and a fact no amount of reading the type would have produced.
Two doc defects fell out of the same trace: `off` is valid at runtime but absent from the `ThinkingLevel` this package re-exports, and `max` is missing from every doc and from the tool schema.

Established that `THINKING_LEVEL_OPTIONS` is internal to `@earendil-works/pi-coding-agent` and absent from its public `index.d.ts`, so the package must carry its own level list.
Planned two complementary checks rather than a literal assertion: a `satisfies` clause (catches an entry the SDK does not declare) and a runtime SDK-parity test against `getSupportedThinkingLevels` (catches a level the SDK adds).
The residual — a level the SDK adds *and* gates behind `thinkingLevelMap` — is stated in the plan rather than papered over.

Release finding worth carrying forward: the roadmap names this issue the `front-door-majors` batch tail, but [#828] (the other member) is still open, and it is `refactor!:` — a hidden changelog type that cannot cut a release alone.
So the marker is `mid-batch — defer`: hold the release-please PR open until [#828] joins it.
The batch's tail designation is about which commit is the *release vehicle*, not about landing order.

Rejected [#641] (operator-configured `defaultMaxTurns` floors) as out of scope with a recorded reason: a floor is a clamp at the settings layer, a lock is a choice at the agent-file layer, and folding them together would put settings into a merge that is currently agent-file-only.
Phase 22's sweep line for [#641] is unchanged; the exclusion lives in the plan's Non-Goals.

Chose `locked: true | [fields]` over a list-only form specifically for the migration story: `true` means "lock every field this file sets", which is byte-identical to today's behavior and makes the `BREAKING CHANGE:` footer a one-line remedy.
The two forms also differ on the bare-lock case deliberately — a list entry denies the caller even when the file sets nothing, `true` cannot express that.

#### Deferred tidyings

- `packages/pi-subagents/test/config/invocation-config.test.ts` — nesting the flat `describe` into a scenario tree; declined because the precedence flip inverts nearly every assertion, so the nesting is cheaper inside the rewrite commit than as a separate `test:` step.
- `packages/pi-subagents/src/config/custom-agents.ts` — extracting `loadFromDir`'s per-agent object literal into a `buildAgentConfig()` helper; declined as scope creep, since `locked:` adds one more field parse and no readability friction.
- `packages/pi-subagents/src/tools/agent-tool.ts` — restructuring the parameter schema block; declined, the change is a rewrite of `description` strings with no structural friction.

[#641]: https://github.com/gotgenes/pi-packages/issues/641
[#828]: https://github.com/gotgenes/pi-packages/issues/828
[#834]: https://github.com/gotgenes/pi-packages/issues/834
