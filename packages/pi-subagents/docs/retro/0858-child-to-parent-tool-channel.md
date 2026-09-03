---
issue: 858
issue_title: "pi-subagents: child-initiated mid-run channel so a blocked child can ask without terminating"
---

# Retro: #858 — Child-to-parent tool channel

## Stage: Planning (2026-09-03T04:25:11Z)

### Session summary

Planned Phase 22 Step 11.
The issue asked for a blocking mid-run channel; the plan that came out drops the blocking half as redundant with [#465], adds a one-way `notify_parent`, and replaces the `<question-for-parent>` text marker with an `ask_parent` tool — a net deletion of 406 lines of parser and parser tests.
Committed `docs/plans/0858-child-to-parent-tool-channel.md` (8 TDD steps), filed [#871] and recorded it as Phase 22 Step 13 by operator decision.

### Observations

- **The issue's own author had deferred it** ("I would not build this until #465 has shipped and the end-and-resume loop has been used enough to show where it actually falls short").
  [#465] has since shipped, so the deferral was satisfied — but reading it as a live constraint is what made the first design question "does the blocking ask still earn itself?"
  rather than "how do we build it?".
- **Three of the issue's own premises did not survive checking.**
  The workspace motivation was closed by [#857]; the retention motivation turned out to be a bug in `sweep()`'s two-way branch rather than a missing channel; and the claim that a new child tool is invisible "to every agent that declares one" understates it — `BUILTIN_TOOL_NAMES` is *also* an explicit allowlist, so no child anywhere receives a new extension tool without an agent-file edit.
- **The operator reversed my recommendation twice, and was right both times.**
  I recommended the blocking ask, then had to withdraw it when the operator asked whether the update belonged in a consumer package: pricing that question surfaced that the blocking half duplicates the end-and-resume loop while the one-way update has no counterpart.
  Then the operator asked whether `question-for-parent` was "a tool masquerading in a protocol trenchcoat" — which is exactly what it is, and reframing it that way dissolved the charter problem rather than escalating it.
- **The charter collision was found late and nearly shipped silently.**
  `README.md` and the architecture scope table forbid "widening a child's tool allowlist on the agent's behalf", [#612] was closed on it by the maintainer, [#768] by its own author, and [#775]'s evidence file names it an open gap and predicts it will be "the single most likely place a charter sentence will be tested next."
  I only found it while enumerating doc touch points, three gates after the design had settled on force-inclusion.
  A scope-and-non-goals grep belongs earlier — before the first design gate, not during Module-Level Changes.
- **The carrier-swap framing is what makes the amendment defensible.**
  The core already installs protocol in every child unconditionally (`<active_agent>`, `parentContext`, and [#465]'s own marker block), so changing the carrier grants no capability.
  [#612]'s two concrete failure modes — write-capable built-ins leaking in, `subagent` re-admitted — are both untouched.
- **Every external fact in the plan was verified against the real surface, and one was wrong.**
  `customTools` was confirmed present in `dist/core/sdk.d.ts` at the declared peer floor `>=0.81.0` (fetched from the registry) and at the installed `0.84.4`, and the allowlist filter over `customTools` was confirmed in the compiled `agent-session.js` at both.
  My first reading took the installed version to be `0.79.1`; that was a different package's entry in the pnpm store, and the assessor's `0.84.4` was correct.
- **`Agent.steer()` was traced in Pi's own source** rather than assumed: it enqueues into `steeringQueue`, drained between turns, so a blocking child tool would have blocked its own reply.
  That fact eliminated one of three candidate designs.
- **A fail-open was found next door and filed rather than folded.**
  `tools: none` resolves to all seven built-ins including `edit`, `write`, and `bash`, because `getToolNamesForType` uses `?.length` where it needs to distinguish absent from empty.
  Confirmed with a disposable spike test rather than by reading, then filed as [#871]; the operator adopted it as Step 13 rather than the deferral I recommended.

#### Deferred tidyings

- `src/lifecycle/subagent-manager.ts` — the assessor declined to propose migrating the seven `(manager as any).sweep()` integration reaches onto the extracted pure function; only the new branch gets a unit test.
  The existing reaches stay as they are, matching the scout inventory's standing note.
- `src/observation/subagent-events-observer.ts` — the inline `{id, type, description}` payload triad gains a fourth instance with `subagents:update`.
  Pre-existing scattered duplication on the boy-scout path; not introduced by this change and not extracted by it.

#### Tidy-First assessment

Dispatched twice — the second time because the design changed materially after the operator's trenchcoat question, and a stale assessment can only contradict the plan it was meant to shape.
The second pass returned no new Recommended items, confirmed the two I had already planned (ordered announcement queue; retention-window extraction), and supplied three corrections that reached the plan: `index.ts` needs no change because `customTools` rides its `...rest` spread; `buildPromptHeader`'s `activeAgentTag` already ends in `\n\n`, so deleting the block naively leaves a stray blank line; and the 15-test migration in `subagent.test.ts` cannot be front-loaded as prep because it is not landable green against today's parse-based code.
It also established that **no** existing test pins multi-record nudge flush order, which turned step 5 from "behavior-preserving refactor" into "refactor plus the coverage it rests on".
