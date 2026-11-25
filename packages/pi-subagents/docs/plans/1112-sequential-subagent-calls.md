---
issue: 1112
issue_title: "Foreground subagent calls in one assistant message run concurrently, contradicting the tool's own guideline"
---

# Run a message's subagent calls one at a time

## Release Recommendation

**Release:** ship independently

No roadmap step in `docs/architecture/architecture.md` references this issue, and the package has no open improvement phase, so it carries no `Release:` batch tag.
The change is breaking (see Goals), so it cuts a major.

## Problem Statement

The `subagent` tool tells the model "For parallel work, use run_in_background: true on each agent.
Foreground calls run sequentially — only one executes at a time."
Nothing enforces the second sentence.
The reporter (@richardaubin) saw four foreground `research` spawns issued in one assistant message run at once: all four finished with the same 1486.7 s duration, and one Esc aborted all four together.
`maxConcurrent` bounded none of them, because foreground spawns bypass the limiter on the premise that "they block the parent anyway" — true for one foreground call in flight, false for several in one message.

## Goals

- The `subagent` tool declares `executionMode: "sequential"`, Pi's documented switch for a tool that must not run concurrently with other calls, so the foreground calls in one assistant message run one at a time.
- The guideline bullet states the behavior that now holds, including that every other tool call in such a message runs one at a time too.
- README and code comments describing foreground concurrency match the new behavior.
- **Breaking.**
  On upgrade, with no user edit, several foreground `subagent` calls in one message take the sum of their durations instead of the longest, and every other tool call in a message that includes a `subagent` call runs in series.
  The fix commit is `fix(pi-subagents)!:` with a `BREAKING CHANGE:` footer.

## Non-Goals

- **Raising the Pi floor to 1.6.0.**
  Filed as [#1146].
  Below Pi 1.6.0, an Esc during a serialized batch leaves the calls the loop had not reached without a tool result, and pi-ai pads them with "No result provided" (see Risks); this plan keeps `>=1.0.0`.
- **An in-package foreground gate** that would serialize only foreground `subagent` runs and leave sibling tools parallel.
  The operator chose Pi's own mechanism over a new runtime mechanism this package would own.
- **Bounding `SubagentsService.spawnAndWait` callers.**
  `executionMode` governs only the LLM's tool calls; an extension calling the service concurrently still starts concurrent foreground runs, as today.
  `src/lifecycle/subagent-manager.ts` changes in comments only.
- **Routing foreground spawns through the `maxConcurrent` limiter.**
  A foreground call would then wait behind background agents while blocking the parent.
- **Merging the overlapping `run_in_background` guideline bullets** (the first bullet and "Use run_in_background for work you don't need immediately").
  That is prompt-wording work beyond this defect.

## Background

- `src/tools/agent-tool.ts` — `AgentTool.toToolDefinition()` builds the `guidelines` string array (first bullet at line 198) and passes an object literal to `defineTool({ name: "subagent" as const, label: "Subagent", … })`.
  No file under `packages/pi-subagents/src` mentions `executionMode`.
- `src/lifecycle/subagent-manager.ts` — `create()` schedules on the limiter only when `isBackground && !options.bypassQueue`; `spawnAndWait`'s JSDoc says "Foreground agents bypass the concurrency queue", and the module header says foreground runs bypass the limiter "(they block the parent anyway)".
- `src/tools/background-spawner.ts` — `spawnBackground` is synchronous: it calls `manager.spawn` and returns the launch text without awaiting the run, so serializing a background call serializes only its launch.
- `README.md` § Concurrency (line 242): "Foreground agents bypass the queue — they block the parent anyway; so does a foreground resume."

### Pi facts the design rests on

Verified in the compiled `.js` of the pinned `@earendil-works/pi-agent-core@1.0.0` and `@earendil-works/pi-coding-agent@1.0.0`, and unchanged in the Pi checkout's `main` (tag `v1.6.0`):

- `executeToolCalls` (`agent-loop.js`) runs the whole batch through `executeToolCallsSequential` when `config.toolExecution === "sequential"` **or any** call in the batch names a tool whose `executionMode === "sequential"`; otherwise every call runs concurrently.
  There is no per-tool exclusivity: one sequential tool serializes all its siblings.
- `pi-coding-agent` never sets `toolExecution`, and none of its built-in tools declares `executionMode`, so a message's calls run in parallel by default.
- `wrapToolDefinition` copies `definition.executionMode` onto the agent tool, so the field on a `defineTool` literal reaches the loop.
- `NestedToolCallRunner` (codemode) makes a nested call to a sequential tool wait on a shared queue, so `Promise.all` over `subagent` calls inside a codemode script also serializes; nested calls to parallel tools do not wait on it.
- `ToolDefinition` declares `executionMode?: ToolExecutionMode` (`core/extensions/types.d.ts`), so the literal needs no cast.
- Pi's `docs/extensions.md` documents the field for "a tool that must not run concurrently with other calls", and its `question.ts` example declares it.
- Before Pi 1.6.0 the sequential loop `break`s once the signal aborts; earendil-works/pi@4438c58ba (upstream earendil-works/pi#9986, first in `v1.6.0`) answers each remaining call with "Operation aborted" instead.

### Evidence

- The concurrency defect is confirmed by source reading (above) and by the reporter's unpatched session log (four spawns, one 1486.7 s duration each, one Esc).
- The fix's effect is the reporter's measurement, not ours: with the field in place, two foreground runs did not overlap (the second started 6.7 s after the first ended), background launches still ran four at once, and a fifth queued as "queued (max 4 concurrent)".
  Step 4 reproduces the foreground half in a fresh session.

## Design Overview

One declarative field and one string.

```typescript
return defineTool({
	name: "subagent" as const,
	label: "Subagent",
	executionMode: "sequential",
	// …
});
```

The first guideline bullet becomes:

```text
- Tool calls in a message that includes a subagent call run one at a time, so foreground agents never overlap. For parallel work, use run_in_background: true on each agent.
```

The bullet keeps the "for parallel work" advice and states the batch-wide effect, so a model that wants a long `bash` alongside a foreground agent learns to split them across messages or background the agent.

### Behavior by scenario

| Message contents                                             | Before                                           | After                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------ | ----------------------------------------------------------------------------------- |
| One foreground `subagent` call                               | runs                                             | unchanged                                                                           |
| Several foreground `subagent` calls                          | all run at once                                  | one at a time, in call order                                                        |
| Several background `subagent` calls                          | launched at once; limiter admits `maxConcurrent` | launched one after another, each returning at once; limiter unchanged               |
| `subagent` plus other tools (`read`, `bash`)                 | all concurrent                                   | all in series, in call order                                                        |
| No `subagent` call                                           | parallel                                         | unchanged                                                                           |
| Codemode script calling `subagent` several times             | concurrent                                       | `subagent` calls serialize; other nested calls do not wait                          |
| Esc during the first of several foreground calls, Pi < 1.6.0 | all had started; each answered "aborted"         | the first is answered; the rest get no result, padded "No result provided" by pi-ai |
| Same, Pi >= 1.6.0                                            | as above                                         | the first is answered; the rest are answered "Operation aborted" without spawning   |

### Edge cases

- A foreground resume (`resume` without `run_in_background`) is a `subagent` call, so it serializes like a foreground spawn; README's "so does a foreground resume" clause is rewritten in step 1.
- The pi-permission-system `tool_call` prompt for a later call in the batch now appears only after the earlier calls finish (in parallel mode, every call's `tool_call` handler ran before any executed).
  This is Pi's sequential contract, not ours to test.

## Module-Level Changes

| File                                                      | Change                                                                                                                                                                                                                                                  |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-subagents/src/tools/agent-tool.ts`           | Add `executionMode: "sequential"` to the `defineTool` literal; rewrite the first guideline bullet.                                                                                                                                                      |
| `packages/pi-subagents/test/tools/agent-tool.test.ts`     | New `describe("execution mode")` inside `describe("AgentTool")`: the field and the guideline text.                                                                                                                                                      |
| `packages/pi-subagents/src/lifecycle/subagent-manager.ts` | Comments only: the module header's "(they block the parent anyway)" and `spawnAndWait`'s JSDoc say that the `subagent` tool runs a message's foreground calls one at a time, while the manager itself does not bound concurrent `spawnAndWait` callers. |
| `packages/pi-subagents/README.md`                         | § Concurrency: replace line 242 with the new behavior (foreground spawns and resumes bypass the queue; the `subagent` tool runs the calls of one message one at a time, other tools in that message included).                                          |
| `.pi/skills/package-pi-subagents/SKILL.md`                | `## Upstream assumptions`: add a row for the `executionMode` batch semantics.                                                                                                                                                                           |
| `.pi/skills/pi-extension-lifecycle/SKILL.md`              | § Tool call sequencing within a turn: replace the false claim that Pi's built-in coding tools use sequential execution, and scope the "full lifecycle before the next `tool_call`" paragraph to sequential batches.                                     |

Predicted unchanged, each a falsifiable claim:

- `src/tools/foreground-runner.ts`, `src/tools/background-spawner.ts`, `src/lifecycle/concurrency-limiter.ts` — the fix acts in Pi's loop, before `execute` is called; no runtime code in this package changes.
- `src/service/service.ts`, `src/service/service-adapter.ts` — service callers are a Non-Goal.
- `docs/architecture/architecture.md` — `rg -n -i "foreground.*(concurren|parallel)|bypass the queue|block the parent"` over it matched nothing that describes foreground concurrency (line 723 lists "its admission through the concurrency gate" as a per-run fact, which still holds).
- `docs/configuration.md` § Abort on interrupt — "A foreground agent aborts on ESC regardless of this setting" still holds: the running call aborts, and an unreached call never spawns.
- Plans and retros that quote the old wording (`docs/plans/0594-…`, `docs/retro/0662-…`) are history, not current-behavior docs.

No other test asserts the old guideline sentence: `rg -n "run sequentially" packages/pi-subagents/test` matches nothing.

## Test Impact Analysis

1. New tests: the tool definition's `executionMode`, and the rewritten guideline line, both in the definition-shape block of `test/tools/agent-tool.test.ts`.
2. No existing test becomes redundant.
3. The `AgentTool — foreground execution` and `— background execution` blocks call `execute` directly with a mocked manager; they never pass through Pi's batch loop, so they are unaffected and pin nothing about sequencing.
   The sequencing itself is Pi's contract, guarded by the new upstream-assumptions row (step 3) and checked live in step 4.

## Invariants at risk

- **Background calls still launch without waiting for their runs** (the reporter's B/C rows), so serializing their launch costs milliseconds.
  Pinned by `spawnBackground` being synchronous: `test/tools/background-spawner.test.ts` (`describe("spawnBackground")`) asserts its return value directly, without awaiting a run.
- **`maxConcurrent` still admits background runs and queues the excess.**
  Unchanged code; pinned by the existing limiter and manager tests.
  Step 4 checks that background spawns in one message still run concurrently.

## TDD Order

1. `fix(pi-subagents)!: run the tool calls of a message that includes a subagent call one at a time`
   - Red: in `test/tools/agent-tool.test.ts`, add `describe("execution mode")` inside `describe("AgentTool")` with:
     - "declares sequential execution so Pi runs a message's calls one at a time": `expect(def.executionMode).toBe("sequential")`.
     - "tells the model that calls in a message with a subagent call run one at a time": `expect(def.description).toContain(<new bullet, verbatim>)` and `expect(def.description).not.toContain("Foreground calls run sequentially")`.

   - Green: add `executionMode: "sequential"` after `label` in the `defineTool` literal (no cast; confirm with `pnpm --filter @gotgenes/pi-subagents run check`), and replace the first `guidelines` entry with the new bullet.

   - Same commit: README § Concurrency line 242 and the two `subagent-manager.ts` comments (Module-Level Changes), so the docs describe the behavior the commit ships.

   - Killing mutations:
     - Delete the `executionMode: "sequential"` line: the first test goes red.
     - Restore the old bullet text: the second test goes red on both assertions.

   - Commit footer:

     ```text
     BREAKING CHANGE: the subagent tool now declares executionMode "sequential", so Pi
     runs every tool call in an assistant message that includes a subagent call one at a
     time. Several foreground subagent calls in one message take the sum of their
     durations instead of running at once, and other tools in that message (read, bash)
     no longer run alongside them. Background launches still return at once and run
     concurrently under maxConcurrent.

     Co-authored-by: Richard Aubin <37956997+richardaubin@users.noreply.github.com>
     ```

2. `docs: correct Pi's tool-call sequencing facts in pi-extension-lifecycle`
   - Rewrite § Tool call sequencing within a turn from the Background facts: calls run in parallel by default; one tool declaring `executionMode: "sequential"` (or `toolExecution: "sequential"`, which `pi-coding-agent` never sets) runs the whole batch in series; no built-in tool declares it.
     The ordering paragraph ("an extension's `tool_result` handler for tool N runs before `tool_call` for tool N+1") holds only in a sequential batch; in a parallel batch every call's `tool_call` runs before any executes.
   - Verify: `rg -n "executionMode" $(ls -d node_modules/.pnpm/@earendil-works+pi-coding-agent@1.0.0_*/node_modules/@earendil-works/pi-coding-agent/dist)/core` matches only `tool-definition-wrapper.js` and `nested-tool-calls.js` (measured at planning time), so no built-in declares it.
   - No test; no release (outside `packages/`).
3. `docs: watch Pi's executionMode batch semantics for pi-subagents`
   - Add a row to `.pi/skills/package-pi-subagents/SKILL.md` § Upstream assumptions: "A tool declaring `executionMode: "sequential"` makes Pi run every call in that assistant message one at a time, and makes codemode's nested calls to it wait on a shared queue" — upstream files `packages/agent/src/agent-loop.ts` (`executeToolCalls`), `packages/coding-agent/src/core/nested-tool-calls.ts`, `packages/coding-agent/src/core/tools/tool-definition-wrapper.ts` — "Behavioral-silent: foreground subagents in one message overlap again".
4. Live check (no commit), in a fresh Pi session launched from this worktree's root (the root `.pi/settings.json` loads `../packages/pi-subagents`):
   - Ask for two foreground `general-purpose` subagents in one message, each running `date -u +%T.%N; sleep 15; date -u +%T.%N` and reporting both times; the windows must not overlap.
   - Ask for three background ones in one message with the same body; their windows must overlap.
   - Record both results in the TDD stage note.

## Risks and Mitigations

- **Sibling tools lose parallelism** in any message with a `subagent` call.
  Accepted by the operator; the guideline says so, so the model can split such work across messages, and the BREAKING CHANGE footer tells users.
- **Esc on Pi < 1.6.0 leaves unreached calls without a tool result**, padded by pi-ai's `closePendingToolCalls` with "No result provided"; the model sees a generic error instead of an abort.
  Pi already does this for any sequential batch, but this change makes it common for `subagent`.
  Tracked by [#1146] (raise the floor to 1.6.0); no unreached call spawns a child either way, so no run is orphaned.
- **The guideline overstates the effect if Pi later adds per-tool exclusivity.**
  The upstream-assumptions row (step 3) puts that change on the `/upstream-impact` watchlist.

## Open Questions

- Whether to accept the reporter's offered PR instead of implementing in-house is a `/ship`-time courtesy question; the plan credits the mechanism with a `Co-authored-by:` trailer either way.

[#1146]: https://github.com/gotgenes/pi-packages/issues/1146
