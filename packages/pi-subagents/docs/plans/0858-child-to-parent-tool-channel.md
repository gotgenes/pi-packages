---
issue: 858
issue_title: "pi-subagents: child-initiated mid-run channel so a blocked child can ask without terminating"
---

# Replace the ask-back marker with two child-to-parent tools

## Release Recommendation

**Release:** ship independently

Phase 22 Step 11 carries `Release: independent` in `docs/architecture/architecture.md`, and no release batch names it.
The plan's release vehicle is the `feat:` commit that gives a child the `ask_parent` tool; the `refactor:` and `docs:` commits ride along in the same bump.

## Problem Statement

A child can reach its parent only by ending its run.
The parent-initiated direction exists (`steer_subagent`); the reverse does not.

This issue asks for a mid-run channel so a blocked child can ask without terminating, and names three motivations.
Investigation reduced them to one real gap and one bug, and turned up a fourth problem the issue does not mention.

- **The workspace motivation is already closed.** [#857] holds a question-ending child's worktree open for the resume its question invites.
- **The retention motivation is a bug in the sweep.**
  `SubagentManager.sweep()` picks its window from `record.consumed`, so once the parent reads the question the child's session is released after `consumedSessionRetentionMinutes` (10).
  A record with an unanswered question is not finished being talked to.
- **The blocking ask duplicates what [#465] already ships.**
  A tool that blocks until the parent answers delivers the same outcome as the end-and-resume loop — child needs an answer, parent supplies it, child continues with full context — differing only in which status the child sits in, which parent tool answers, and which clock bounds the wait.
  Shipping both would make the child choose between two protocols taught by two prompt blocks, and the parent recognize two answer paths.
- **The one-way update has no counterpart at all.**
  A running child that discovers something material — a course change, a wrong premise, a scope problem — cannot say so without abandoning its run.
- **The ask-back marker is a tool wearing a protocol's clothes.**
  `src/session/ask-back.ts` is 222 lines, of which roughly 120 exist solely because the marker is embedded in free text a model also writes prose in: `QuotedRegions` and its forward-only cursor, `findFencedRanges`, `findInlineCodeRanges`, `nextUnquoted`, and the "last well-formed block wins" rule.
  Its test file is another 184 lines.
  None of it has a reason to exist if the child calls a tool.

## Goals

- A running background child can send its parent a one-way update and keep working, with the parent free to reply through the existing `steer_subagent`.
- A child declares a question by calling a tool rather than by emitting a text marker, so capture is exact and the parser disappears.
- A child whose question is unanswered keeps its session for the long retention window instead of the short one.
- The `tools:` allowlist boundary is narrowed in prose to say what it actually means, rather than being contradicted in silence.
- Not a breaking change.
  No public export, `SubagentRecord` field, event payload, settings key, or default is removed or retyped.
  The marker is not a documented user surface: it appears in no `README.md` or `docs/` file and `parseQuestionForParent` is exported from neither public entry.

## Non-Goals

- **A blocking ask.**
  Analysed and rejected as duplicating [#465]'s end-and-resume loop; see Background.
  Roadmap Step 11's outcome — "a running child can signal its parent and receive a reply without terminating" — is met asynchronously instead: the child sends an update, the parent replies with `steer_subagent`, and the child picks the reply up at its next turn boundary having never terminated.
- **Structured interview questions.**
  `pi-intercom`'s `interview_request` shape (a question list with a JSON reply contract) is a richer form with no consumer here.
  No issue filed; it is a deferral, not a named follow-up.
- **A published child-tool registration seam.**
  Letting a consumer package install its own tool into a child is a new public surface and an [ADR-0002] question.
  This plan keeps the seam private to `createSubagentSession`.
- **Rate-limiting or quota on updates.**
  The lever is the `midRunUpdates` setting and the tool's own description; a per-run cap is policy the core does not need until a chatty child is observed.
- **Widening the allowlist from a user-authored key.** [#768] and [#612] stay closed on their own grounds; see Background.
- **Widget rendering of an update.** `AgentWidget` implements `SubagentManagerObserver`, but it has no use for the new hook, and a vacant hook is refused by [ADR-0002]'s governing rule.
- **[#870]'s post-result addendum delivery.**
  Phase 22 Step 12, unaffected by this plan.
- **Fixing `tools: none`.**
  Found while planning this change, filed as [#871], and adopted as Phase 22 Step 13 by operator decision.
  This plan's allowlist append must be correct over an empty base list either way, which is a test case here rather than shared work.

## Background

### What [#465] shipped, and what it costs

A child ends its turn with a `<question-for-parent>` block.
`parseQuestionForParent` splits it out of the terminal text, `pendingQuestion` is set, all four carriers render it with the exact `subagent` + `resume` call that answers it, and since [#857] a workspace-backed child holds its worktree for that resume.

The retro for that work records what the parser cost: the protocol block tripped its own parser during implementation; a reviewer found an inline-code-span hole; fixing that exposed a second defect where quoting was applied after block-building, so a quoted opening tag had already consumed a real question's closing tag; and a second review round found the matcher was O(n²), parsing a 50k-mention document in 1.25 s.
One documented limitation survives — a single-backtick span crossing a line break is not treated as quoting.

It is also fragile in a way a tool is not.
The marker is read off the child's **final** assistant message, so a child that declares its question, then makes three more tool calls and writes a new closing message, loses the question entirely.

### Why the blocking ask was dropped

Three findings, each verified rather than assumed:

1. **It deadlocks in the foreground.** `runForeground` awaits `spawnAndWait`, so the parent cannot call `steer_subagent` while inside its own tool execution.
2. **The reply cannot travel through the SDK.**
   `Agent.steer()` enqueues into `steeringQueue`, drained *between* turns (`pi/packages/agent/src/agent.ts:283`), so a tool blocked awaiting an answer blocks its own delivery.
   The reply would have to be intercepted in `Subagent.steer()`.
3. **It duplicates end-and-resume.**
   See Problem Statement.

Dropping it also deletes the wait state, the timeout setting, the limiter-slot cost (a blocked background child would hold one of four slots), and the foreground special case.

### The allowlist contract, and why this change narrows it

`AgentTypeRegistry.getToolNamesForType` returns the agent's `tools:` list, or `BUILTIN_TOOL_NAMES` when the key is absent, and `createSubagentSession` hands it to the SDK as the session's `tools` allowlist.
So **every** child has an explicit allowlist, and no child anywhere receives a new extension tool without an agent-file edit — not only the agents that declare `tools:`.

`README.md` and the architecture doc's scope table carry a matching Non-Goal:

> *Widening a child's tool allowlist on the agent's behalf.*
> An agent's `tools:` frontmatter is the complete allowlist and the only mechanism that widens it, because a settings-level list would hand a read-only `Explore` agent write-capable tools from a file its author never saw.

Its history matters.
[#612] was closed by the maintainer on two concrete failure modes: it unioned in the parent's write-capable built-ins, so a read-only `Explore` would silently gain `edit`/`write`, and it re-admitted `subagent`, reopening the recursion guard.
[#768] proposed an `additionalTools` settings key and was closed by its own author on the published charter.
[#775]'s evidence file lists the question as an open gap and predicts it will be "the single most likely place a charter sentence will be tested next."

This change is a **carrier swap**, not a widening.
The core already installs its own protocol in every child on its own authority: `buildAgentPrompt` injects `<active_agent>`, `parentContext` is prepended to the run prompt, and [#465] taught every child the marker in both prompt modes unconditionally.
Changing that protocol's carrier from a text marker to a tool schema grants no machine capability — neither tool touches the filesystem, the shell, or the network; each can only put text into the session that spawned the child — and neither re-admits `subagent`.
[#612]'s two failure modes are untouched, and [#768]'s objection to a *user-authored* key naming tools from outside the agent file still stands.

Force-inclusion is structurally required rather than merely convenient: an opt-in `ask_parent` would silently delete ask-back from every agent that declares `tools:`.

### The SDK seam

`CreateAgentSessionOptions.customTools?: ToolDefinition[]` is the mechanism.
Verified present at the declared peer floor `>=0.81.0` and at the installed `0.84.4`, and verified in the compiled `agent-session.js` at **both** versions that `_refreshToolRegistry` runs every custom tool through `isAllowedTool` — so a `customTools` entry is dropped unless its name is also in `tools`.
Appending the names to the allowlist is therefore required, not incidental.

`src/index.ts`'s real `createSession` destructures `{ sessionManager, resourceLoader, modelRegistry, ...rest }` and forwards `...rest` into `createAgentSession`, so `customTools` rides the spread with no change to the composition root — only this package's own `CreateSessionOptions` type needs the field.

### Related work that is not this

PR #740's "non-blocking status kick-back" enriches what `get_subagent_result` reports about a **running** child.
That is the parent pulling status; this is the child pushing it.
They do not overlap, and neither closes the other.

### Constraints from `AGENTS.md`

- Architecture-doc module-tree entries describe current behavior and carry an issue ref only when it encodes an active constraint.
- `docs/plans/`, `docs/retro/`, and `docs/architecture/` are excluded from release scope.
- Every semantic display glyph lives in `src/ui/glyphs.ts`; this plan adds none, reusing `GLYPHS.agentsActive`.

## Design Overview

### The two tools

Two tools rather than one with a `reason`: a model selects among tools more reliably than among enum values, and each gets its own description and guidance in the child's prompt.

```typescript
// src/session/ask-parent-tool.ts
export class AskParentTool {
  constructor(private readonly record: (question: string) => void) {}
  // execute → this.record(params.question); returns the end-your-turn instruction
  toToolDefinition(): ToolDefinition; // name: "ask_parent"
}

// src/session/notify-parent-tool.ts
export class NotifyParentTool {
  constructor(private readonly announce: (message: string) => void) {}
  // execute → this.announce(truncated); returns immediately
  toToolDefinition(): ToolDefinition; // name: "notify_parent"
}
```

Both follow the established `src/tools/` shape — a class with a private-deps constructor, an `execute()`, and a `toToolDefinition()` returning `defineTool({...})`.
They live in `src/session/` rather than `src/tools/` for two reasons: every module in `src/tools/` is registered on the **parent** session by `index.ts`, and `ask-back.ts` — the protocol these replace — is a `src/session/` module.
This also keeps the dependency arrow pointing `lifecycle → session`, where `create-subagent-session.ts` already reaches.

No shared base class: the two have no common logic beyond the convention they both follow, and abstracting over two implementations is premature.

### Tool text

This ships into every child's system prompt, so it is specified here rather than left to implementation.

```text
ask_parent
  promptSnippet: Ask the delegating agent a question, then end your turn.
  description: Record a question for the agent that delegated this task. Use it when
    you cannot finish without information only the delegating agent has, and the answer
    changes what you would do; otherwise state your assumption and continue. After
    calling this, end your turn immediately — the delegating agent answers by resuming
    you, and you continue with your context intact.
  parameters: { question: string }
  result: Question recorded for the delegating agent. End your turn now — it will
    answer by resuming you, and you will continue with your context intact.

notify_parent
  promptSnippet: Send the delegating agent a one-way update without pausing.
  description: Send a one-way update to the agent that delegated this task and keep
    working. Use it only for a material finding that changes what the delegating agent
    would do — a course change, a wrong premise, a scope problem — not for routine
    progress. It does not wait for a reply; the delegating agent may steer you if it
    wants to redirect.
  parameters: { message: string }
  result: Update sent to the delegating agent. Continue working; it may steer you if
    it wants to redirect.
```

`notify_parent` truncates `message` at 2000 characters and says so in its result, because a nudge is the message's only carrier — there is no `get_subagent_result` fallback to pull the full text from.
`ask_parent` leaves `question` uncapped, matching the marker it replaces, whose value reaches the public `SubagentRecord.pendingQuestion` whole.

### Who gets which tool

| Tool            | Foreground child | Background child          | Settings gate                                 |
| --------------- | ---------------- | ------------------------- | --------------------------------------------- |
| `ask_parent`    | yes              | yes                       | none — it replaces a protocol every child has |
| `notify_parent` | no               | yes, when `midRunUpdates` | `midRunUpdates`, default `true`               |

`notify_parent` is withheld from a foreground child because its message cannot arrive in time to matter: the parent is blocked inside `spawnAndWait`, and `NotificationManager` withholds nudges while the parent's run is active, flushing at `agent_settled` — after the child's own result has already returned.
A tool whose every call is late is worse than no tool.

Superseded by #872: the same blockage occurs on a resume and on a `get_subagent_result` wait, which spawn mode cannot express, so the row above now reads "yes" for both columns and lateness is avoided by rendering the update into the blocked carrier's own return.

### The call path

```typescript
// Subagent.run(), at the createSubagentSession call
const runConfig = this.execution.getRunConfig?.();   // hoisted above the call
this.subagentSession = await this.execution.createSubagentSession({
  // …existing fields…
  askParent: (question) => this.state.setPendingQuestion(question),
  notifyParent:
    this.isBackground && (runConfig?.midRunUpdates ?? true)
      ? (message) => this.execution.observer?.onUpdateSent?.(this, message)
      : undefined,
});
```

`createSubagentSession` builds a definition for each callback it was given, appends their names to the allowlist, and passes them as `customTools`:

```typescript
const childTools = buildChildTools(params);            // [] when neither callback is supplied
const { session } = await deps.io.createSession({
  // …existing fields…
  tools: [...cfg.toolNames, ...childTools.map((t) => t.name)],
  customTools: childTools,
  excludeTools: EXCLUDED_TOOL_NAMES,
});
```

The spread is correct over an empty `cfg.toolNames`, which is what [#871] will make `tools: none` produce.

`ask_parent` announces nothing itself.
The question reaches the parent through the terminal-transition nudge that already renders it via `renderQuestionAffordance`, exactly as today — so a child that asks and then ends its turn produces one announcement, not two.

`notify_parent` announces immediately, through a new observer hop that mirrors the existing terminal one:

```text
NotifyParentTool → Subagent (callback)
  → SubagentLifecycleObserver.onUpdateSent?
  → SubagentManagerObserver.onSubagentUpdate?      (optional; the widget does not implement it)
  → CompositeSubagentObserver fan-out
  → SubagentEventsObserver: emit "subagents:update" + notifications.sendUpdate(record, message)
```

Both new observer methods are optional, matching `SubagentLifecycleObserver`'s existing mix of required-by-shape and `?`-optional members, and sparing `AgentWidget` a hook it has no use for.

### `completeRun` and `completeResume` after the parse

`pendingQuestion` is now written mid-run by the tool, so the terminal transitions read state instead of parsing text:

```typescript
// completeRun
const holdForResume = finalStatus === "completed" && this.pendingQuestion !== undefined;
const finalResult = holdForResume
  ? result.responseText
  : result.responseText +
    this.workspaceBracket.dispose({ status: finalStatus, description: this.description });
```

The trailing `this.state.setPendingQuestion(question)` is deleted outright, and `spliceOut` disappears with the parser because the question was never in the body.
`completeResume` mirrors this.
[#857]'s invariant is preserved by construction: the hold now keys off *when* the tool was called during the run rather than off text found afterwards.

**One behavior the tool would otherwise change.**
The parse never ran on the error path, so an errored child carries no `pendingQuestion` today; with a mid-run tool it could.
`failRun()` and `failResume()` therefore clear it.
An error result already tells the parent to look, and "answer by resuming" is not the right next action after a failure.
Aborted and steered runs keep their question, matching today's parse, which runs for all three terminal statuses.

### The withheld-announcement queue

`NotificationManager.pendingNudges` is `Map<string, Subagent>`, keyed by id.
`Map.set` on an existing key updates in place without reordering, which is what makes a re-completion collapse to one delivery while preserving its queue position.
A single id-keyed map cannot hold both a completion and one-or-more updates for the same child, nor represent their relative order, so it becomes an ordered list:

```typescript
type PendingAnnouncement =
  | { kind: "completion"; record: Subagent }
  | { kind: "update"; record: Subagent; message: string };

private pending: PendingAnnouncement[] = [];
```

`sendCompletion` while withheld replaces an existing `completion` entry for that id **in place**, or appends; `sendUpdate` always appends.
The flush walks the list in order.

The gates differ by kind, and deliberately:

| Gate              | Completion | Update   | Why                                                                          |
| ----------------- | ---------- | -------- | ---------------------------------------------------------------------------- |
| `disposed`        | skip       | skip     | the session is gone; an unrecallable `followUp` would escape                 |
| `parentRunActive` | withhold   | withhold | [#661]'s withhold-and-flush; an update is as unrecallable as a nudge         |
| `claimed`         | skip       | deliver  | the claim is a commitment to deliver **the outcome**, which an update is not |
| `consumed`        | skip       | deliver  | consumption records that the outcome was collected, which an update is not   |

### The update nudge

A distinct `customType`, because the existing renderer would misreport an update.
`resolveStatusPresentation` has no `"running"` branch and falls through to the success glyph and the text `completed`, so reusing `subagent-notification` would render a still-running child as finished.

```text
<subagent-update>
<task-id>ID</task-id>
<summary>Subagent "&lt;description&gt;" sent an update</summary>
<message>…</message>
</subagent-update>
The agent is still running. Steer it with steer_subagent to redirect, or let it continue.
```

Registered in `index.ts` beside the existing renderer, with details `{ id, description, message }` and `GLYPHS.agentsActive` as the icon — an existing glyph, so no monospace-coverage measurement is owed.

### The retention fix

`sweep()`'s two-way selection becomes an exported pure function over the four fields it reads, so the new branch gets a plain-object unit test rather than a spawned agent behind `(manager as any).sweep()`:

```typescript
/** Only what the sweep reads. Narrower than Subagent so a caller cannot come to depend on more. */
export interface RetentionCandidate {
  consumed: boolean;
  completedAt: number | undefined;
  consumedAt: number | undefined;
  pendingQuestion: string | undefined;
}

export function resolveRetentionWindow(
  record: RetentionCandidate,
  policy: RetentionPolicy,
): { referenceAt: number; windowMinutes: number };
```

The rule: **a record carrying a pending question is not treated as consumed.**
The parent read the question but has not answered it, so the outcome is not fully collected.

No new settings key.
The alternative — a dedicated `pendingQuestionRetentionMinutes` — was rejected: it needs a default number with no principled basis, and an operator who worries about a worktree held by [#857] already has `unconsumedSessionRetentionMinutes` as the lever.

### The boundary amendment

`README.md`, the architecture scope table, and § "Child tool selection" are narrowed to state what the boundary actually protects:

> The core installs its own protocol in every child — the `<active_agent>` tag, the parent-context prefix, and the `ask_parent` / `notify_parent` tools — and that protocol grants no capability over the machine.
> Capability widening is per-agent-file: an agent's `tools:` list is the only thing that admits a capability tool, and no settings key may name one.

## Module-Level Changes

### Added

| File                                      | What                                                               |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `src/session/ask-parent-tool.ts`          | `AskParentTool`; `ask_parent` definition                           |
| `src/session/notify-parent-tool.ts`       | `NotifyParentTool`; `notify_parent` definition, 2000-character cap |
| `test/session/ask-parent-tool.test.ts`    | callback invocation, result text, cap behavior                     |
| `test/session/notify-parent-tool.test.ts` | same                                                               |

### Removed

| File                            | What                                |
| ------------------------------- | ----------------------------------- |
| `src/session/ask-back.ts`       | deleted whole (222 lines)           |
| `test/session/ask-back.test.ts` | deleted whole (184 lines, 24 tests) |

### Changed — `src/`

| File                                             | What                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/session/prompts.ts`                         | drop the `ask-back` import and the `ASK_BACK_PROTOCOL` interpolation in `buildPromptHeader`; rewrite the "Both modes carry the ask-back protocol" comment. `activeAgentTag` already ends in `\n\n`, so the correct edit is `` `${activeAgentTag}${envBlock}` `` with no added separator — inserting one leaves a stray blank line |
| `src/lifecycle/create-subagent-session.ts`       | `CreateSubagentSessionParams` gains `askParent?` / `notifyParent?`; `CreateSessionOptions` gains `customTools?: ToolDefinition[]`; the `createSession` call appends the tool names to `tools` and passes `customTools`                                                                                                            |
| `src/lifecycle/subagent.ts`                      | drop the `parseQuestionForParent` import; hoist `runConfig`; supply both callbacks; `completeRun`/`completeResume` read `this.pendingQuestion`; `failRun`/`failResume` clear it; `SubagentLifecycleObserver` gains `onUpdateSent?`                                                                                                |
| `src/lifecycle/subagent-manager.ts`              | `SubagentManagerObserver` gains optional `onSubagentUpdate?`; `buildObserver` delegates `onUpdateSent`; `sweep()` calls the extracted `resolveRetentionWindow`, which is exported alongside `RetentionCandidate`                                                                                                                  |
| `src/observation/composite-subagent-observer.ts` | fan out `onSubagentUpdate` through the existing `dispatch` helper                                                                                                                                                                                                                                                                 |
| `src/observation/subagent-events-observer.ts`    | implement `onSubagentUpdate`: emit `subagents:update`, call `notifications.sendUpdate`                                                                                                                                                                                                                                            |
| `src/observation/notification.ts`                | ordered `PendingAnnouncement` queue; `NotificationSystem`/`NotificationManager` gain `sendUpdate`; add `formatUpdateNotification` and `buildUpdateDetails`                                                                                                                                                                        |
| `src/observation/renderer.ts`                    | `createUpdateRenderer()` for the new `customType`                                                                                                                                                                                                                                                                                 |
| `src/index.ts`                                   | register the update renderer beside the existing one. **No change to `createSession`** — `customTools` rides the `...rest` spread                                                                                                                                                                                                 |
| `src/runtime.ts`                                 | `RunConfig` gains `readonly midRunUpdates: boolean`                                                                                                                                                                                                                                                                               |
| `src/settings.ts`                                | `midRunUpdates` field, getter/setter, toggle, `applySettings` branch, `sanitize` entry, default `true`                                                                                                                                                                                                                            |
| `src/ui/subagents-settings.ts`                   | a toggle descriptor mirroring `abortAllOnInterrupt`                                                                                                                                                                                                                                                                               |

### Changed — `test/`

| File                                                          | What                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/session/prompts.test.ts`                                | delete `describe("ask-back protocol injection")` (3 tests)                                                                                                                                                                                               |
| `test/lifecycle/subagent.test.ts`                             | 15 tests across `"workspace hold for a declared question"` (3), `"disposing a held workspace"` (6 of 7), and `"ask-back"` (6), plus the `heldWorkspaceAgent()` helper, all migrate from marker text to the tool/state trigger; add the errored-run clear |
| `test/lifecycle/create-subagent-session.test.ts`              | the `tools`/`excludeTools` forwarding assertions gain the appended names; new `customTools` assertions; a case over an empty `cfg.toolNames`                                                                                                             |
| `test/lifecycle/subagent-manager.test.ts`                     | new unit tests for `resolveRetentionWindow`                                                                                                                                                                                                              |
| `test/observation/notification.test.ts`                       | queue-order and `sendUpdate` tests                                                                                                                                                                                                                       |
| `test/observation/subagent-events-observer.test.ts`           | `onSubagentUpdate` emission and delegation                                                                                                                                                                                                               |
| `test/observation/composite-subagent-observer.test.ts`        | fan-out of the optional method                                                                                                                                                                                                                           |
| `test/settings.test.ts`, `test/ui/subagents-settings.test.ts` | the new toggle                                                                                                                                                                                                                                           |

### Documentation

Greps run at planning time: `ASK_BACK_PROTOCOL`, `parseQuestionForParent`, and `ParsedOutcome` appear in no file outside `src/session/` and `test/session/`; the literal `question-for-parent` appears in no `README.md` or `docs/` file in any package.
So the doc work is behavioral prose, not symbol references.

| File                                                      | What                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/pi-subagents/README.md`                         | line 26 "Ask-back" bullet reworded to the tool; a bullet for mid-run updates; the "Widening a child's tool allowlist" Non-Goal narrowed                                                                                                                                                                            |
| `packages/pi-subagents/docs/configuration.md`             | § "Tool selection" — "A child session gets exactly the tools it names" is now false; state the two core-installed tools beside the three always-removed names. § "Persistent Settings" — `midRunUpdates` in the runtime-tuning list, the defaults sentence, and the example                                        |
| `packages/pi-subagents/docs/architecture/architecture.md` | scope-table row 42; § "Child tool selection"; module tree (`ask-back.ts` out, two tools in, revised entries for `create-subagent-session.ts`, `notification.ts`, `subagent-manager.ts`, `outcome-delivery.ts`); domain table Session 11 → 12 and total 65 → 66; Step 11 ✅ with a `Landed:` note; Mermaid `S11` ✅ |
| `.pi/skills/package-pi-subagents/SKILL.md`                | the "A child's tool set is exactly its agent's `tools:` frontmatter list" paragraph; the Session row of the domain table (module list and count)                                                                                                                                                                   |

## Test Impact Analysis

**What the change makes newly testable.**
The two tools are pure callback wrappers with no SDK dependency, so their behavior — callback invocation, result text, the 2000-character cap — is unit-testable without a session.
`resolveRetentionWindow` becomes a plain function over a four-field object, replacing seven `(manager as any).sweep()` integration reaches with direct unit tests for the branch under change.

**What becomes redundant.**
All 24 tests in `test/session/ask-back.test.ts` and the 3 in `prompts.test.ts`'s ask-back block: they pin a parser and a prompt block that no longer exist.
Nothing replaces them, because nothing they covered survives.

**What must stay.**
The 15 `subagent.test.ts` tests keep their assertions and change only their input mechanism — they pin the workspace hold, the resume round-trip, and `pendingQuestion` propagation, all of which must hold under the new trigger.
The four carriers' question-affordance tests (`foreground-runner`, `agent-tool`, `get-result-report`, `notification`) are untouched: `renderQuestionAffordance` and its inputs do not change.

**The seam this plan is most likely to get wrong** is the allowlist append, because `customTools` is silently dropped when its name is missing from `tools` — no error, no warning, the tool simply is not there, which is exactly [#725]'s finding.
The test must assert both halves separately (see step 3's killing mutations), and include an empty-`cfg.toolNames` case so the spread is pinned over the input [#871] will produce.

## Invariants at risk

| Invariant                                                                                                        | Pinned by                                       | Risk here                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [#857]: a completed child that declared a question holds its workspace; every other outcome disposes at run end  | `test/lifecycle/subagent.test.ts:803-871`       | The trigger changes from parsed text to tool-set state. Opened and read: these tests assert on the real `WorkspaceBracket` through a stub provider, not a mock of the layer under test, so they pin the behavior rather than the call             |
| [#465]: all four carriers render a question with the exact resume call                                           | carrier tests naming `renderQuestionAffordance` | Untouched — the rendering path and its inputs do not change                                                                                                                                                                                       |
| [#661]: nudges are withheld during the parent's run and flushed at `agent_settled`, each re-checking consumption | `notification.test.ts` § "parent-turn boundary" | Directly rewritten by the queue change. The pinned test is `"collapses a re-completion during the same turn into a single delivery"`; **no existing test pins multi-record flush order**, so step 5 must add that coverage rather than inherit it |
| [#725]: the recursion denylist survives every tool-registry rebuild                                              | `create-subagent-session.test.ts`               | `excludeTools` is untouched; the assertion is edited only because `tools` changes alongside it                                                                                                                                                    |
| [#640] / [#801]: the inherited-prompt identity prefix is cut at Pi's own layers                                  | `prompts.test.ts`                               | `buildPromptHeader` is downstream of the identity prefix, so the cut is unaffected; only the ask-back block leaves                                                                                                                                |

**Quantitative note.**
Removing `ASK_BACK_PROTOCOL` shrinks every child's system prompt by the size of that block.
It sits after the cacheable identity prefix, so no cached prefix changes; the effect is a small reduction in per-child prompt bytes, replaced by the two tools' schemas.
Neither direction is pinned by a byte-count test today and this plan adds none — there is no `toMatchSnapshot` of the header (verified).

## TDD Order

1. **`refactor(pi-subagents): extract the retention-window selection from the sweep`** Export `resolveRetentionWindow` and `RetentionCandidate`; `sweep()` calls it.
   Behavior-preserving.
   Add unit tests for both existing branches (consumed → short window measured from the later of completion and consumption; unconsumed → long window from completion).
   *Killing mutation:* make `resolveRetentionWindow` always return the unconsumed window — the new consumed-branch test goes red while the existing integration sweep tests, which drive a consumed record, also go red.
   Prepares step 2 by making its branch unit-testable.

2. **`fix(pi-subagents): keep a child's session alive while its question is unanswered`** A record with `pendingQuestion` set takes the unconsumed window.
   New test: a consumed record carrying a question holds past the short window.
   *Killing mutation:* delete the `pendingQuestion` term — the new test goes red and step 1's two branch tests stay green, which is the evidence that the three cases are separately pinned.

3. **`feat(pi-subagents): let a child ask its parent a question with a tool`** `AskParentTool`; `CreateSubagentSessionParams.askParent`; `CreateSessionOptions.customTools`; the allowlist append; `Subagent.run()` supplies the callback with `runConfig` hoisted; `failRun`/`failResume` clear `pendingQuestion`.
   The marker still works — both mechanisms coexist for one commit, which is what keeps step 4's large test migration off this commit.
   *Killing mutations:* (a) drop the append, leaving `tools: cfg.toolNames` — the allowlist assertion goes red while the `customTools` assertion stays green; (b) pass `askParent: undefined` unconditionally — the "a child session is given `ask_parent`" test goes red; (c) make `execute` skip the callback — the "calling `ask_parent` records the question" test goes red; (d) delete the `failRun` clear — the errored-run test goes red.

4. **`refactor(pi-subagents): retire the question-for-parent marker`** Delete `ask-back.ts` and its test; drop the prompt block and fix the seam whitespace; drop both parse call sites; migrate the 15 `subagent.test.ts` tests and the `heldWorkspaceAgent()` helper to the tool trigger; delete `prompts.test.ts`'s ask-back block.
   `refactor:` rather than `feat!:`: the capability is unchanged and reaches the parent by the same four carriers; the marker was never a documented user surface, and `parseQuestionForParent` is exported from neither public entry.
   *Killing mutations:* (a) restore the `completeRun` parse and delete the tool's state write — the migrated question tests go red; (b) delete the workspace hold at its new site (`holdForResume` forced to `false`) — [#857]'s three hold tests go red, which is the check that a relocated invariant is still pinned.

5. **`refactor(pi-subagents): order the withheld announcement queue`** Replace the id-keyed map with the `PendingAnnouncement` list.
   Behavior-preserving for completions.
   Add the missing multi-record arrival-order coverage.
   *Killing mutations:* (a) append instead of replacing in place — `"collapses a re-completion during the same turn into a single delivery"` goes red; (b) flush in reverse — the new arrival-order test goes red and the collapse test stays green.
   Prepares step 6.

6. **`refactor(pi-subagents): announce a child's mid-run update to its parent`** `NotificationManager.sendUpdate`, `formatUpdateNotification`, `buildUpdateDetails`, `createUpdateRenderer` and its registration, the two optional observer methods, the composite fan-out, and the `subagents:update` emission.
   Nothing calls `sendUpdate` yet, so this is `refactor:` by the observable-outcome rule.
   *Killing mutations:* (a) make `sendUpdate` ignore `parentRunActive` — the withhold test goes red; (b) make it return early on `record.consumed` — the "an update is announced even after an earlier outcome was consumed" test goes red, which is the assertion that separates the update gates from the completion gates.

7. **`feat(pi-subagents): let a running background child send its parent an update`** `NotifyParentTool`; `CreateSubagentSessionParams.notifyParent` and its definition; `Subagent.run()` supplies it under `isBackground && midRunUpdates`; `RunConfig.midRunUpdates`; the settings field and its `/subagents:settings` row.
   *Killing mutations:* (a) supply it regardless of `isBackground` — the "a foreground child is not given `notify_parent`" test goes red; (b) supply it regardless of the setting — the `midRunUpdates: false` test goes red; (c) remove the 2000-character truncation — the cap test goes red.

8. **`docs(pi-subagents): document the child-to-parent tools and narrow the tool-widening boundary`**
   README, `configuration.md`, `architecture.md` (including Step 11 ✅, its `Landed:` note, and the Mermaid mark), and the package skill, per Module-Level Changes.

## Risks and Mitigations

| Risk                                                                                                                                                                                           | Mitigation                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Terminality becomes advisory.** A child that calls `ask_parent` and then keeps working leaves a question recorded while it continues, and could render a stale question if it answers itself | Accepted, and net better than today: the current marker is read off the final message, so a child that continues loses its question outright. The tool result instructs the child to end its turn, and `resetForResume` clears the field on the answer                 |
| **A chatty child.** A tool that can interrupt will be used to interrupt                                                                                                                        | The tool description names the bar ("only for a material finding that changes what the delegating agent would do"), background-only delivery keeps it off the blocking path, and `midRunUpdates` is the operator's lever. No per-run cap until a real case is observed |
| **The allowlist append silently no-ops.** A `customTools` entry whose name is missing from `tools` is dropped with no error — [#725]'s exact finding                                           | Step 3's killing mutation (a) pins the two halves separately, so dropping the append fails a test rather than shipping a tool nobody can see                                                                                                                           |
| **The charter amendment is read as reopening [#612] / [#768]**                                                                                                                                 | The amendment states the distinction positively (core-installed protocol versus user-authored capability widening) and both closed items remain refused under it. Recorded in prose per the operator's decision; no ADR                                                |
| **The queue rewrite regresses [#661] without a red test**, since no existing test pins cross-record order                                                                                      | Step 5 adds that coverage *before* step 6 introduces a second entry kind, and its second killing mutation (flush in reverse) is the check that the new coverage discriminates                                                                                          |
| **`prompts.ts` seam whitespace.** `activeAgentTag` already ends in `\n\n`, so a naive deletion adds a blank line no test catches                                                               | Named explicitly in Module-Level Changes; re-read the region after the edit, since autoformat reflow makes a whitespace slip easy to miss                                                                                                                              |

## Open Questions

- **Should `ask_parent` announce immediately for a background child, rather than waiting for the terminal nudge?**
  It would shorten the gap between asking and being answered, at the cost of a second announcement per asking child.
  Deferred until a real ask-back run shows the gap matters; the current design preserves today's one-announcement behavior exactly.
- **Does `notify_parent` want a `severity` or `kind` field?**
  `pi-intercom` gets by with one free-text update.
  Deferred — a second field with no consumer is a vacant parameter.

[#465]: https://github.com/gotgenes/pi-packages/issues/465
[#612]: https://github.com/gotgenes/pi-packages/issues/612
[#640]: https://github.com/gotgenes/pi-packages/issues/640
[#661]: https://github.com/gotgenes/pi-packages/issues/661
[#725]: https://github.com/gotgenes/pi-packages/issues/725
[#768]: https://github.com/gotgenes/pi-packages/issues/768
[#775]: https://github.com/gotgenes/pi-packages/issues/775
[#801]: https://github.com/gotgenes/pi-packages/issues/801
[#857]: https://github.com/gotgenes/pi-packages/issues/857
[#870]: https://github.com/gotgenes/pi-packages/issues/870
[#871]: https://github.com/gotgenes/pi-packages/issues/871
[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
