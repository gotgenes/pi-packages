---
issue: 829
issue_title: "pi-subagents: agent frontmatter silently discards subagent tool parameters; narrow the guard to explicitly locked fields"
---

# Narrow the frontmatter guard to explicitly locked fields

## Release Recommendation

**Release:** mid-batch — defer (batch "front-door-majors"); confirm at ship time

`architecture.md`'s Phase 22 puts this issue at Step 3 and batches it with Step 4 ([#828]) as `front-door-majors`, naming Step 3 the tail.
Step 3 is the tail because Step 4 is `refactor!:` — a `hidden: true` changelog type that cannot cut a release by itself — so the batch needs this issue's `fix!:` as its release vehicle.
[#828] is still open and unplanned at the time of writing, so the batch is not complete when this issue lands.
Hold the `pi-subagents` release-please PR open until [#828]'s commit joins it, then merge once for both.
If [#828] has already landed by ship time, this issue is the tail and the release goes out immediately.

## Problem Statement

`resolveAgentInvocationConfig` gives an agent `.md` file's frontmatter blanket priority over the `subagent` tool's own parameters for five fields — `model`, `thinking`, `max_turns`, `inherit_context`, `run_in_background` — with no way for an agent author to opt out.
A deliberate, correct override from an operator-authored prompt is discarded silently, with no warning and no note in the result.

The measurement in [#829]: dispatching the built-in `Explore` agent with `model: "sonnet-5"` runs it on `claude-haiku-4-5-20251001`, because `DEFAULT_AGENTS` sets a model for `Explore` and `agentConfig.model` wins.
The tool schema says the opposite ("Omit to use the agent type's default"), and this repo's `AGENTS.md` instructs agents to do exactly that dispatch.
That instruction has never worked.

The behavior comes from upstream `tintinweb/pi-subagents` commit `91236678`, whose recorded rationale is specific and sound: it guards against a **non-deterministic caller** — the parent model — guessing harness knobs it does not understand.
It was applied as a blanket over every field and every caller, which is why an operator's deliberate override is discarded alongside a model's guess.

[#834] joins this issue because it lives on the same line.
Neither door validates the thinking level it receives; `invocation-config.ts:47` and the mirrored cast at `service-adapter.ts:65` both widen an arbitrary `string` to `ThinkingLevel`.

## Goals

- Caller-explicit parameters win at the `subagent` tool door; agent frontmatter fills the fields the caller left unspecified.
- An agent file may declare a lock — `locked: true` or `locked: [model, thinking]` — over fields a tool caller may not override.
- A discarded override is reported to the model rather than dropped in silence.
- An unrecognized `thinking` value is rejected at both doors instead of silently disabling thinking ([#834]).
- The `subagent` tool's parameter descriptions and `docs/configuration.md` describe the behavior the code actually has.

Breaking.
The effective model, thinking level, turn limit, context inheritance, and background mode change for any existing agent `.md` that declares them and is invoked with an overriding tool parameter.
Commit the behavior flip as `fix(pi-subagents)!:` with a `BREAKING CHANGE:` footer naming `locked: true` as the one-line restoration of the previous behavior.

## Non-Goals

- **Lock enforcement at the SDK door.**
  `SubagentsService.spawn` is a deterministic caller; the upstream rationale does not reach it.
  It also already behaves this way — `assembleSessionConfig` resolves `options.model ?? agentConfig.model` and `options.thinkingLevel ?? agentConfig.thinking` (`session-config.ts:169-171`), and `SubagentSession.runTurnLoop` resolves `opts.maxTurns ?? agentMaxTurns ?? defaultMaxTurns` (`subagent-session.ts:91-92`).
  Caller-wins is not a new policy in this package; it is what the other door already does, and this change makes the tool door agree with it.
  A lock therefore constrains the tool door only, and `service-adapter.ts` gains no lock logic.
- **Operator-configured floors ([#641]).**
  Phase 22's sweep folded [#641] into this step as design input, to be settled or explicitly excluded.
  Excluded, with reason: a floor is a different operator (clamp two values) at a different layer (the `subagents.json` settings file) than a lock (choose one of two) in an agent file.
  Folding it in would make one release carry two precedence mechanisms and would put settings into a merge that is currently agent-file-only.
  [#641] stays open; its roadmap disposition line is unchanged.
- **Narrowing the public `SpawnOptions.thinkingLevel` to the level union.**
  A compile-time gate for TypeScript SDK consumers only — it does nothing for a JavaScript caller or for frontmatter, both of which the runtime validation in this plan already covers.
  Recorded in Open Questions rather than filed.
- **Any change to `resolveBackgroundMode` or the manager's spawn resolution.**
  [#724] settled where background mode is resolved; this issue only changes the value the tool door computes before committing to it.
- **The `subagents.json` settings layer**, `maxConcurrent`, and `graceTurns`.

## Background

### Where the guard actually lives

```text
AgentTool.execute
  → resolveSpawnConfig (src/tools/spawn-config.ts:92)
    → resolveAgentInvocationConfig (src/config/invocation-config.ts:44-52)   ← the blanket guard, sole call site
  → spawnBackground | runForeground → manager

SubagentsServiceAdapter.spawn
  → manager.spawn(…)                                                        ← no merge; caller values flow through
    → createSubagentSession → assembleSessionConfig                          ← options ?? agentConfig (caller wins)
```

`resolveAgentInvocationConfig` has exactly one production call site.
The blanket precedence is therefore a property of the tool door, not of the package.

### The five merges the metric row counts

`architecture.md:779` tracks `Blanket agentConfig?.<field> ?? params precedence merges in invocation-config.ts` with a baseline of 5 and a Phase 22 target of 0.
Measured at planning time on current `main`:

```text
$ grep -cE 'agentConfig\?\..*\?\?' packages/pi-subagents/src/config/invocation-config.ts
5
```

Predicted after this change: **0**.
Two independent reasons, either of which suffices: the precedence inverts, and `agentConfig` becomes a required `AgentConfig` parameter (`registry.resolveAgentConfig` already returns a non-optional `AgentConfig`, so the `| undefined` in today's signature is defensive dead weight).
`resolveBackgroundMode`'s `agentConfig.runInBackground ?? request.isBackground` does not match the pattern today and will not after — it has no `?.`, which is why the current count is 5 and not 6.
No excluded site inflates the predicted number: the file's only other `??` uses are on `params`/`request`.

### What the SDK does with an unrecognized thinking level

[#834] asked for this trace before choosing a remedy.
Measured against the installed `@earendil-works/pi-ai@0.84.4`:

```text
getSupportedThinkingLevels(reasoningModel)   → ['off','minimal','low','medium','high','xhigh','max']
clampThinkingLevel(reasoningModel, 'bananas') → 'off'
```

`clampThinkingLevel` looks the requested level up in its ordered table, gets `-1`, and returns `availableLevels[0]` — which is always `'off'`.
`createAgentSession` calls it unconditionally (`sdk.ts:253`).
So an unrecognized level does not throw and is not ignored: it **silently disables thinking entirely**, the opposite of what any author writing `thinking: <something>` intends.
That is the strongest argument for rejecting rather than warning-and-continuing.

Two doc defects fall out of the same trace.
`docs/configuration.md:79`, `README.md:120`, and the tool schema all list `off, minimal, low, medium, high, xhigh`: `off` is valid at runtime but absent from the `ThinkingLevel` this package re-exports (pi-ai's, which excludes `off` and includes `max`), and `max` is missing from every doc.
`off` reaches the SDK today only because `custom-agents.ts:62` casts the raw frontmatter string.

### Constraints from `AGENTS.md` and the package skill

- **No policy enforcement in core.**
  A lock is agent-file configuration read by the agent's own spawn path, not tool permission policy; `docs/configuration.md` already documents the five fields as agent-file config.
- **Mechanism and data are separate steps.**
  The `locked:` parser and the precedence rewrite are sequenced apart, and `THINKING_LEVELS` — a table of external facts — gets its verifying check written before its rows.
- **Do not name an unreleased version.**
  The migration note describes the condition ("an agent file written against the previous blanket precedence"), not a version number.

## Design Overview

### The precedence rule

One rule, applied per field:

```typescript
// src/config/invocation-config.ts

/** Which field a lock names, spelled as the frontmatter key an author writes. */
export const LOCKABLE_FIELDS = ["model", "thinking", "max_turns", "inherit_context", "run_in_background"] as const;
export type LockableField = (typeof LOCKABLE_FIELDS)[number];

/** `true` locks every field the agent file sets; a list locks exactly the fields it names. */
export type LockDeclaration = true | readonly LockableField[];

/** One field's precedence outcome. `source` says which side supplied the value. */
interface FieldResolution<T> {
  value: T | undefined;
  source: "caller" | "agent" | "none";
  discarded: boolean;
}

function resolveField<T>(
  field: LockableField,
  agentValue: T | undefined,
  callerValue: T | undefined,
  locked: LockDeclaration | undefined,
): FieldResolution<T>;
```

`resolveField` is total over four cases:

| Lock state | Caller passed | Result                                                                 |
| ---------- | ------------- | ---------------------------------------------------------------------- |
| unlocked   | yes           | caller's value, `source: "caller"`                                     |
| unlocked   | no            | agent's value (or none), `source: "agent"`/`"none"`                    |
| locked     | yes           | agent's value (or none), `discarded: true` unless the values are equal |
| locked     | no            | agent's value (or none)                                                |

`isLocked` differs by declaration form, and the difference is the whole point of offering both:

- `locked: true` — locked **iff the agent file sets the field**.
  This is exactly today's blanket behavior, which makes it the one-line migration for a file written against it.
- `locked: [model]` — locked whether or not the file sets `model`.
  A *bare lock* denies the caller and lets the child inherit the parent's value, so an author can say "never let a caller change my model" without pinning one.

### `AgentConfig` and the frontmatter parser

```typescript
// src/types.ts — AgentConfig gains one field
  /** Fields a `subagent` tool caller may not override. Omitted — every field is overridable. */
  locked?: LockDeclaration;
```

`custom-agents.ts` reuses the scalar-or-sequence parser `tools:` already has, so both spellings work:

```yaml
locked: true                       # lock every field this file sets
locked: model, thinking            # comma-separated scalar
locked: [model, max_turns]         # YAML flow sequence
```

An entry that is not in `LOCKABLE_FIELDS` is dropped with a `debugLog` — an agent file is operator-authored, and failing its whole load over one typo is worse than ignoring the entry.
`DEFAULT_AGENTS` locks nothing: `Explore`'s haiku is a cost choice, not a correctness one, and unlocking it is what makes `AGENTS.md`'s standing instruction true.

### Reporting a discarded override

The tool result is the model-visible channel, and `foreground-runner.ts:115` already uses it for the analogous case:

```text
Note: Unknown agent type "auditr" — using general-purpose.
```

`background-spawner.ts` builds no such note, so an unknown type routed to background falls back silently today.
Both notes get one home on the resolved config, and both spawners render it:

```typescript
// src/tools/spawn-config.ts — ResolvedSpawnConfig gains one field
  /** Model-visible advisories about how this spawn was resolved. Rendered by both runners. */
  notes: string[];
```

The discard note names the agent and the frontmatter spellings of the discarded parameters, so the model can read it as an instruction not to retry:

```text
Note: agent "reviewer" locks model, max_turns — those subagent parameters were ignored.
```

### Thinking-level validation ([#834])

A new `src/config/thinking-level.ts` owns the level vocabulary:

```typescript
import type { ThinkingLevel as SdkThinkingLevel } from "@earendil-works/pi-ai";

/**
 * Every level Pi accepts. `off` is valid at runtime but absent from pi-ai's
 * `ThinkingLevel`; the `satisfies` clause catches an entry the SDK does not
 * know, and the SDK-parity test catches a level the SDK adds that this list omits.
 */
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const satisfies readonly (SdkThinkingLevel | "off")[];

export type SubagentThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Narrow an unvalidated value to a level, or undefined when it is not one. */
export function parseThinkingLevel(value: unknown): SubagentThinkingLevel | undefined;

/** The message a door reports for a value `parseThinkingLevel` rejected. */
export function thinkingLevelError(value: string): string;
```

`src/types.ts` widens its own alias in one line — every internal consumer already imports `ThinkingLevel` from `#src/types`, so nothing else moves:

```typescript
export type ThinkingLevel = SubagentThinkingLevel;
```

Validation lands at three points, one per producer:

| Producer                                        | On an unrecognized value               | Why                                                                                                    |
| ----------------------------------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| agent `.md` frontmatter (`custom-agents.ts:62`) | drop the field, `debugLog`             | The agent still loads and inherits the parent's level; failing the file over one typo is worse.        |
| `subagent` tool parameter (`spawn-config.ts`)   | return the existing `SpawnConfigError` | The model reads the error and can correct itself, exactly as it does for an unresolvable model string. |
| `SubagentsService.spawn` (`service-adapter.ts`) | throw                                  | Matches the adapter's three existing throws; a fourth documented case.                                 |

Both `as ThinkingLevel` casts disappear: `AgentInvocationParams.thinking` narrows to `SubagentThinkingLevel` because `resolveSpawnConfig` validates before merging, and `service-adapter.ts` narrows through `parseThinkingLevel`.

### `modelFromParams` under the new precedence

`resolveAgentInvocationConfig` returns `{ modelInput, modelFromParams }` rather than a resolved model, because `resolveInvocationModel` branches on `modelFromParams` to choose error-vs-silent-fallback when the string does not resolve (`model-resolver.ts:38-48`).
Its meaning must change with the precedence: it becomes "the winning model input came from the caller", i.e. `resolveField("model", …).source === "caller"`.

The observable consequence is deliberate.
An unresolvable model string in an agent file still falls back to the parent model silently, because the author is not present to read an error.
An unresolvable string from a tool caller now surfaces an error **even when the agent file also sets a model** — where today the agent's value would quietly win and the caller's typo would vanish.
The name stays; its doc comment in both `invocation-config.ts` and `model-resolver.ts` is corrected in the same commit.

### Consumer call sites

```typescript
// src/tools/spawn-config.ts
const invalidThinking = params.thinking != null && parseThinkingLevel(params.thinking) === undefined;
if (invalidThinking) return { error: thinkingLevelError(params.thinking as string) };

const agentConfig = registry.resolveAgentConfig(subagentType);
const resolved = resolveAgentInvocationConfig(agentConfig, params);
const notes = [...fallbackNote(identity), ...lockNotes(agentConfig.name, resolved.discarded)];
```

```typescript
// src/tools/background-spawner.ts and src/tools/foreground-runner.ts
const noteText = config.notes.length > 0 ? `${config.notes.join("\n")}\n\n` : "";
```

Both runners read `config.notes` and never build note text themselves — one producer, two renderers, which is what makes the discard note a one-line addition rather than two.

### Design review notes

- **Tell-Don't-Ask.** `resolveField` answers a question; no consumer inspects a lock declaration and decides for itself. `isLocked` is private to `invocation-config.ts`.
- **ISP.** `resolveAgentInvocationConfig` takes the whole `AgentConfig` because it reads six of its fields, which is the object's own purpose; no narrower slice would be honest.
- **Scattered decisions.**
  Note construction moves from one runner's inline expression to one producer read by both.
- **Dependency width.** `thinking-level.ts` imports one type from pi-ai and nothing else; `invocation-config.ts` gains no new import beyond it.
- **No vacant hooks.** `LOCKABLE_FIELDS` has one consumer (`custom-agents.ts`'s parser) and `notes` has two; neither is speculative.

## Module-Level Changes

Greps backing this list, run at planning time over `packages/pi-subagents/` plus `.pi/skills/` and `AGENTS.md`:

- `resolveAgentInvocationConfig` — `src/tools/spawn-config.ts:11,92` and `test/config/invocation-config.test.ts` only.
- `AgentInvocationParams` — `src/config/invocation-config.ts` only (plus one archived plan).
- `ThinkingLevel` — imported from `#src/types` by nine `src/` modules; only `src/types.ts:5` imports it from pi-ai.
- `fellBack` — `src/tools/spawn-config.ts`, `src/tools/foreground-runner.ts:115`, `test/helpers/make-spawn-config.ts`, and three test files.
- "are locked for that agent" / "Frontmatter is authoritative" — `docs/configuration.md:86-88` only.
- No `.pi/skills/**` file names any symbol or mechanism this change touches. `AGENTS.md:117` asserts the `Explore` + `model: "sonnet-5"` dispatch; that claim becomes true and needs no edit.

### Source

| File                              | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/thinking-level.ts`    | New. `THINKING_LEVELS`, `SubagentThinkingLevel`, `parseThinkingLevel`, `thinkingLevelError`.                                                                                                                                                                                                                                                                                                                                                                      |
| `src/config/invocation-config.ts` | `LOCKABLE_FIELDS`, `LockableField`, `LockDeclaration`, private `isLocked`/`resolveField`. `resolveAgentInvocationConfig`'s first parameter becomes a required `AgentConfig`; precedence inverts; the return gains `discarded: LockableField[]`; `AgentInvocationParams.thinking` narrows to `SubagentThinkingLevel`; the `as ThinkingLevel` cast is deleted; `modelFromParams`'s doc comment is corrected. `BackgroundRequest`/`resolveBackgroundMode` untouched. |
| `src/types.ts`                    | `AgentConfig.locked?: LockDeclaration`. `ThinkingLevel` alias widened to `SubagentThinkingLevel` (one line; every consumer already imports from here).                                                                                                                                                                                                                                                                                                            |
| `src/config/custom-agents.ts`     | Parse `locked:` via the existing `parseListField`, filtering to `LOCKABLE_FIELDS` with a `debugLog` for a dropped entry; `true` passes through as the boolean form. `thinking` parses through `parseThinkingLevel` instead of `str(...) as ThinkingLevel`.                                                                                                                                                                                                        |
| `src/config/default-agents.ts`    | Update the `general-purpose` comment block that cites `resolveAgentInvocationConfig`'s old lock semantics. Add no `locked:` to any built-in.                                                                                                                                                                                                                                                                                                                      |
| `src/tools/spawn-config.ts`       | `ResolvedSpawnConfig` gains `notes: string[]`. Move the fallback-note construction here from `foreground-runner.ts`; append lock notes. Guard `params.thinking` before the merge and return `SpawnConfigError` for an invalid level.                                                                                                                                                                                                                              |
| `src/tools/foreground-runner.ts`  | Delete the local `fallbackNote` computation; render `config.notes`.                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/tools/background-spawner.ts` | Render `config.notes` (it renders none today).                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/tools/agent-tool.ts`         | Rewrite the `model`/`thinking`/`max_turns`/`inherit_context`/`run_in_background` parameter descriptions for caller-wins-unless-locked; correct the `thinking` level list to include `max`.                                                                                                                                                                                                                                                                        |
| `src/service/service-adapter.ts`  | Validate `options?.thinkingLevel` through `parseThinkingLevel` and throw on failure; delete the `as ThinkingLevel` cast at line 65 and its `#834` comment.                                                                                                                                                                                                                                                                                                        |
| `src/session/model-resolver.ts`   | Doc-comment only: `modelFromParams` now means "the winning input came from the caller".                                                                                                                                                                                                                                                                                                                                                                           |

### Tests

| File                                    | Change                                                                                                                                                                                                                                                                         |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `test/config/thinking-level.test.ts`    | New. `parseThinkingLevel` accept/reject table; error-message content; SDK-parity test pinning `THINKING_LEVELS` against `getSupportedThinkingLevels` for a synthetic all-capabilities model.                                                                                   |
| `test/config/invocation-config.test.ts` | Substantially rewritten — nearly every assertion inverts. The `undefined` agent-config case (line 46) is deleted with the optional parameter. New scenario groups: unlocked caller-wins, `locked: true`, list lock, bare lock, `discarded` contents, `modelFromParams` source. |
| `test/config/background-mode.test.ts`   | Unchanged; must stay green (see Invariants at risk).                                                                                                                                                                                                                           |
| `test/config/custom-agents.test.ts`     | New cases: `locked: true`; comma-separated and sequence list forms; an unknown entry dropped; an invalid `thinking` dropped; a valid `off`/`max` preserved.                                                                                                                    |
| `test/tools/spawn-config.test.ts`       | New: the fallback note appears in `notes`; a lock produces a discard note; an invalid `thinking` param returns `SpawnConfigError`. Existing merge assertions adjust to caller-wins.                                                                                            |
| `test/tools/foreground-runner.test.ts`  | The `fellBack` note case (line 77) must stay green with the text unchanged after it moves. New: a discard note reaches the foreground result.                                                                                                                                  |
| `test/tools/background-spawner.test.ts` | New: notes reach the background result. The `explicit` background-request case (line 39) is unchanged and must stay green.                                                                                                                                                     |
| `test/service/service-adapter.test.ts`  | New: `spawn` throws for an unrecognized `thinkingLevel`; a valid one still reaches `manager.spawn`.                                                                                                                                                                            |
| `test/helpers/make-spawn-config.ts`     | `createResolvedSpawnConfig` gains `notes`, computing the fallback text from its `fellBack`/`rawType` options so `foreground-runner.test.ts`'s hand-built config still carries it.                                                                                              |

### Docs

| File                                       | Change                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `docs/configuration.md`                    | Replace lines 86-88 ("Frontmatter is authoritative… only fill fields the agent config leaves unspecified") with the new precedence and a `locked` row in the frontmatter table. Add the `locked:` subsection with both forms and the bare-lock rule. Correct the `thinking` row's level list to include `max`. State that a lock binds the `subagent` tool only. |
| `README.md`                                | Tool table (line 120): correct the `thinking` levels; note caller-wins-unless-locked for the five fields. `spawn` contract: add the fourth throw case (unrecognized `thinkingLevel`) and state that agent-file locks do not constrain the SDK door.                                                                                                              |
| `docs/architecture/architecture.md`        | Mark `#### Step 3` ✅ with a `Landed:` note; add ✅ to the `S3` Mermaid node. Update the `agentConfig?.` metric row's achieved value to 0. Module tree line 339: extend `invocation-config.ts`'s entry to name locked-field precedence; add `thinking-level.ts`. Domain-model diagram: add a `ThinkingLevel` node to the `config` subgraph.                      |
| `.pi/skills/package-pi-subagents/SKILL.md` | Config-domain row: file count 4 → 5, add `thinking-level.ts`.                                                                                                                                                                                                                                                                                                    |

## Test Impact Analysis

**Newly possible.**
`resolveField` is a pure function over (agent value, caller value, lock declaration), so all twelve precedence cases — four lock states × three declaration forms — become table tests with no registry, no params bag, and no session.
Today the precedence is only reachable through `resolveAgentInvocationConfig`'s full five-field object, so a single-field case cannot be stated in isolation.

**Newly required, because a green suite would otherwise hide the defect.**
`THINKING_LEVELS` is a table of external facts, so its verifying check is written before its rows.
The check runs against the installed SDK rather than asserting a literal:

```typescript
const everyLevel = { ...fakeModel, reasoning: true, thinkingLevelMap: Object.fromEntries(THINKING_LEVELS.map(l => [l, "x"])) };
expect([...THINKING_LEVELS].sort()).toEqual(getSupportedThinkingLevels(everyLevel).sort());
```

Measured at planning time: `getSupportedThinkingLevels` returns exactly those seven for such a model.
Residual, stated rather than hidden: a level the SDK adds *and* gates behind a `thinkingLevelMap` key escapes the check, because the map is built from our own list.
The `satisfies` clause covers the other direction — an entry pi-ai does not declare fails `pnpm run check`.

**Becomes redundant.**
`test/config/invocation-config.test.ts`'s "uses tool-call params when no agent config is available" (line 45) goes away with the optional parameter; the registry never hands `resolveSpawnConfig` an undefined config.

**Must stay as-is.**
`test/config/background-mode.test.ts`'s four cases and `test/tools/background-spawner.test.ts:39` pin [#724]'s door-commitment contract, which this change does not touch.
`test/tools/foreground-runner.test.ts:77` pins the fallback note's exact text; the text relocates and must not change.

## Invariants at risk

| Invariant                                                                                          | Source                                                  | Pinned by                                       | Action                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| The tool door sends `{ kind: "explicit" }` — it merges frontmatter itself and routes on the answer | [#724] plan, Design Overview                            | `test/tools/background-spawner.test.ts:39`      | Unchanged. The door still merges and still commits; only the merge's outcome changes. Re-run without editing.                                 |
| `resolveBackgroundMode`: explicit honored verbatim; default defers to frontmatter                  | [#724] Step 3                                           | `test/config/background-mode.test.ts` (4 cases) | Unchanged and untouched. The `default` branch's config-wins is correct for a door with no commitment, and only the SDK door produces it.      |
| A disabled agent type is rejected at the manager choke point                                       | [#724] Step 1 `Outcome:`                                | `test/lifecycle/subagent-manager.test.ts`       | Untouched — this change adds no resolution to the manager.                                                                                    |
| `Subagent.isBackground` is first-class record state; the widget filters on it                      | [#724] Step 1 `Outcome:`                                | manager and widget suites                       | Untouched.                                                                                                                                    |
| `SubagentRecord` is produced-not-implemented, by value, under the [#830] admission policy          | `docs/decisions/0005-…`                                 | `test/service/service-adapter.test.ts`          | Untouched — the adapter gains a throw, not a field. Re-run the strip assertions.                                                              |
| The unknown-agent-type note's exact text                                                           | `foreground-runner.ts:115`                              | `test/tools/foreground-runner.test.ts:77`       | The construction moves to `resolveSpawnConfig`; the text must be byte-identical. The test helper must produce the same string.                |
| `off` remains a working frontmatter value                                                          | `docs/configuration.md:79`; works today only via a cast | Nothing                                         | New test in `test/config/custom-agents.test.ts` — `parseThinkingLevel` must accept `off`, or the widening silently breaks a documented value. |

No quantitative invariant is touched: this change does not reach prompt assembly, so the cacheable-prefix byte count and token budget are unaffected.
The one numeric target is the `agentConfig?.` metric row, predicted above at 0 from a measured baseline of 5.

## TDD Order

1. **`refactor(pi-subagents): carry the Agent tool's spawn notes on the resolved config`** Prepares step 7: the discard note must reach both runners, and today only `foreground-runner.ts` has note machinery — a locally built `fallbackNote` — while `background-spawner.ts` has none.
   Moving the construction into `resolveSpawnConfig` as `notes: string[]` turns "add notes in two places" into "append to one list".
   Red: a `spawn-config.test.ts` case asserting `notes` carries the fallback text for a fell-back type and is empty otherwise.
   Green: the field, the relocation, `foreground-runner.ts` reading it, and `createResolvedSpawnConfig` computing it.
   The foreground note test must stay green with unchanged text.
   Background still renders nothing — that is step 2.
   Killing mutation: make `resolveSpawnConfig` always return an empty `notes` array.

2. **`fix(pi-subagents): report an unknown agent type on background spawns`** Red: a `background-spawner.test.ts` case asserting the result text carries the fallback note for a fell-back type.
   Green: `spawnBackground` renders `config.notes` ahead of its launch message.
   Killing mutation: make `spawnBackground` drop `config.notes` when building the result text.

3. **`refactor(pi-subagents): add the thinking-level vocabulary and parser`** Red: `test/config/thinking-level.test.ts` — the SDK-parity test above, an accept table over all seven levels, a reject table (`"bananas"`, `""`, `"HIGH"`, a number), and the error message naming every valid level.
   Green: `src/config/thinking-level.ts` and the one-line `ThinkingLevel` widening in `src/types.ts`.
   `refactor:`, not `feat:` — no door consumes it until step 4.
   Killing mutations, one per class: drop `"max"` from `THINKING_LEVELS` (the SDK-parity test must go red); make `parseThinkingLevel` return its input unchanged (the reject table must go red).

4. **`fix(pi-subagents): reject an unrecognized thinking level instead of silently disabling thinking`** Red: a `spawn-config.test.ts` case that an invalid `thinking` param returns `SpawnConfigError` with the level message; a `service-adapter.test.ts` case that `spawn` throws for an invalid `thinkingLevel` and still passes a valid one through; a `custom-agents.test.ts` case that an invalid frontmatter `thinking` is dropped while `off` and `max` survive.
   Green: the guard in `resolveSpawnConfig`, the narrowed `AgentInvocationParams.thinking` (deleting the cast in `invocation-config.ts`), the adapter's validation (deleting its cast and `#834` comment), and `custom-agents.ts` parsing through `parseThinkingLevel`.
   Refs [#834] in the body.
   Killing mutations, one per door: skip the `params.thinking` guard in `resolveSpawnConfig`; restore the cast in `service-adapter.ts`; restore `str(fm.thinking) as ThinkingLevel` in `custom-agents.ts`.
   Each should turn exactly its own door's case red — a mutation that leaves another door green confirms the three are independently pinned.

5. **`refactor(pi-subagents): parse the locked frontmatter key into AgentConfig`** Data half, sequenced apart from the mechanism that reads it.
   Red: `custom-agents.test.ts` cases — `locked: true` yields `true`; `locked: model, thinking` and `locked: [model, max_turns]` yield the field arrays; an unknown entry is dropped; `locked: none` and an omitted key yield `undefined`.
   Green: `LOCKABLE_FIELDS`, `LockableField`, `LockDeclaration` in `invocation-config.ts`, `AgentConfig.locked` in `types.ts`, and the parser reusing `parseListField`.
   `refactor:` — nothing reads the field until step 6.
   Killing mutations: make the parser return `undefined` for `locked: true`; make it accept any string without filtering to `LOCKABLE_FIELDS`.

6. **`fix(pi-subagents)!: honor subagent tool parameters over agent frontmatter unless the agent locks the field`** The behavior flip.
   Red: a rewritten `invocation-config.test.ts` — for each of the five fields, caller-wins with no lock; agent value fills when the caller omits; `locked: true` reproduces the previous outcome for a field the file sets and does *not* lock one it leaves unset; a list lock holds the agent's value; a bare list lock yields no value at all; `modelFromParams` is true only when the caller's input won.
   Green: required `agentConfig`, `isLocked`, `resolveField`, the inverted merges, and the corrected `modelFromParams` doc comments in `invocation-config.ts` and `model-resolver.ts`.
   Same commit: the `agent-tool.ts` schema descriptions, since they are the contract this commit makes true, and the `default-agents.ts` comment that cites the old semantics.
   `BREAKING CHANGE:` footer naming `locked: true` as the one-line restoration.
   Subject names the observable outcome; it ships to the changelog verbatim.
   Killing mutations, one per class: restore `agentConfig.model ?? params.model` (the caller-wins cases go red); make `isLocked` return `true` unconditionally (the unlocked cases go red); make the list form skip a field the agent file does not set (the bare-lock case goes red); make `locked: true` lock every listed field regardless of whether the file sets it (the `locked: true` unset-field case goes red).

7. **`fix(pi-subagents): report a locked field that discarded a subagent parameter`** Red: an `invocation-config.test.ts` case that `discarded` lists exactly the locked fields whose caller value differed, and is empty when the values match; `spawn-config.test.ts`, `foreground-runner.test.ts`, and `background-spawner.test.ts` cases that the note reaches each result text naming the agent and the frontmatter spellings.
   Green: `discarded` on the resolution, `lockNotes` in `resolveSpawnConfig`.
   Killing mutation: make `resolveAgentInvocationConfig` return an empty `discarded` array — every note assertion in all four files must go red.

8. **`docs(pi-subagents): document locked-field precedence and the corrected thinking levels`** `docs/configuration.md` (precedence, the `locked` table row and subsection, the `thinking` level list, the tool-door-only scope), `README.md` (tool table, `spawn`'s fourth throw, the SDK-door exemption), `architecture.md` (Step 3 ✅ + `Landed:`, `S3` Mermaid node ✅, the metric row's achieved 0, module tree, config-domain diagram node), and the package skill's config-domain row.
   Re-run the metric command and record the actual number rather than the predicted one.
   Verify both Mermaid diagrams render before committing.

## Risks and Mitigations

| Risk                                                                                                                | Mitigation                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An existing agent file relying on the blanket lock changes behavior silently on upgrade                             | `locked: true` restores it in one line, and the `BREAKING CHANGE:` footer names it. Step 6 pins the equivalence with a test asserting `locked: true` reproduces the previous outcome for every field the file sets.                                                                                                                |
| `modelFromParams`'s meaning shifts, so a caller's model typo now errors where the agent's value used to win quietly | Deliberate and stated in Design Overview. Step 6 pins both directions: an agent-file typo still falls back silently, a caller typo errors.                                                                                                                                                                                         |
| The relocated fallback note's text drifts, breaking a green assertion's meaning rather than the assertion           | Step 1 moves the string verbatim and the existing foreground test must stay green *unedited*; the test helper is updated to produce the same string rather than an approximation of it.                                                                                                                                            |
| The SDK-parity test is circular for a map-gated level the SDK adds                                                  | Stated as a residual in Test Impact Analysis. The `satisfies` clause covers the opposite direction, and the two together are the strongest check available without an SDK export of the level list (`THINKING_LEVEL_OPTIONS` is internal to `@earendil-works/pi-coding-agent` and absent from its public `index.d.ts` — verified). |
| Widening the `ThinkingLevel` alias to include `off` breaks a call into the SDK                                      | `CreateSessionOptions.thinkingLevel` reaches `createAgentSession`, whose own `ThinkingLevel` (from `@earendil-works/pi-agent-core`) is exactly the seven-level set including `off`. `pnpm run check` is the gate; the widening is a superset of nothing the SDK rejects.                                                           |
| A `toMatchObject`/`objectContaining` assertion absorbs a wrong `notes` or `discarded` shape                         | Re-read the note and discard assertions in all four touched test files by hand after steps 1, 2, and 7 rather than trusting the green run.                                                                                                                                                                                         |
| `fallow dead-code` flags `LOCKABLE_FIELDS` or `thinkingLevelError` between steps 3/5 and their consumers            | Both are exported and consumed within the same plan; run `pnpm fallow dead-code` at the end of step 6, not after each of the two `refactor:` steps.                                                                                                                                                                                |
| The release ships without [#828], splitting one intended major across two                                           | The `Release:` marker is `mid-batch — defer`; the release-please PR stays open until [#828]'s commit joins it.                                                                                                                                                                                                                     |

## Open Questions

- Should `SpawnOptions.thinkingLevel` be narrowed from `string` to the level union?
  Deferred, not filed: it is a compile-time convenience for TypeScript SDK consumers only, and the runtime validation in step 4 already closes the hole for JavaScript callers and frontmatter.
  Revisit if a consumer asks, or fold it into the next `dist/public.d.ts` major.
- Should a settings-layer lock exist alongside the agent-file lock, so an operator can pin a field globally?
  Adjacent to [#641] and deliberately out of scope here; the agent-file lock is the smaller mechanism and should be exercised before a second layer is added.

[#641]: https://github.com/gotgenes/pi-packages/issues/641
[#724]: https://github.com/gotgenes/pi-packages/issues/724
[#828]: https://github.com/gotgenes/pi-packages/issues/828
[#829]: https://github.com/gotgenes/pi-packages/issues/829
[#830]: https://github.com/gotgenes/pi-packages/issues/830
[#834]: https://github.com/gotgenes/pi-packages/issues/834
