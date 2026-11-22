---
issue: 987
issue_title: "pi-subagents: `resume` ignores `run_in_background`, so resuming a background agent blocks the parent until the resumed run finishes"
---

# Honor `run_in_background` on a `subagent` resume

## Release Recommendation

**Release:** ship independently

Issue #987 is not referenced by any roadmap step in `docs/architecture/architecture.md`, and the package has no open improvement phase, so it is its own release vehicle.
The behavior commits are `fix:`; the release is a patch.

## Problem Statement

The `subagent` tool accepts `resume` and `run_in_background` in one call, and nothing in its schema or guidelines says they cannot be combined.
`AgentTool.execute` handles `params.resume` first and returns before it reads the background mode, and `resumeExisting` awaits `manager.resume(...)` until the resumed run is terminal.
So a parent that asks for a background resume blocks for the whole resumed run, and the result never says `run_in_background` was ignored.
The ask-back flow makes this common: a child ends its turn with a question, the parent answers with `resume`, and a long answer pins the parent's turn.

Planning found a second defect that any fix must clear first.
A carrier claim (the flag that suppresses the completion nudge because someone else is delivering the outcome) is never released after the carrier delivers.
`spawnAndWait` claims, the tool's resume claims (`claimOutcome: true`), and `get_subagent_result(wait: true)` claims; `SubagentState.resetForResume` deliberately keeps the claim.
An unclaimed resume of any agent a carrier already delivered is therefore never announced.
A background resume that merely dropped the `await` would tell the parent "you will be notified" and then never notify it, in exactly the ask-back loop the issue describes.
The service's `resume` contract already promises the opposite ("By default the resumed outcome is announced to the parent like any other background completion"), so the service door has the same latent defect today.

## Goals

- A `subagent` call with `resume: "<id>"` and an explicit `run_in_background: true` returns the agent ID immediately, runs the resumed turn loop in the background, and the parent is notified when it finishes.
- A refused background resume answers immediately with the same refusal sentence the foreground door uses.
- An unclaimed resume (the tool's background door, or the service's `resume` without `claimOutcome`) is announced on completion even when an earlier carrier claimed the agent's previous outcome.
- One renderer formats the background launch message and its `AgentDetails` for both the spawn door and the resume door (folds in [#988]).

This change is **not breaking**.
A call that omits `run_in_background` resumes in the foreground exactly as today; an agent file's `run_in_background:` default and `locked:` are not consulted on resume.
The calls whose behavior changes are the ones the parameter's own description already covers ("Returns agent ID immediately.
You will be notified when it completes."), and the service change makes the documented `resume` announcement contract true.
No `SubagentRecord` field, `ResumeResult` shape, event payload, or default changes.

## Non-Goals

- **Frontmatter-driven background resumes.**
  The operator chose the explicit flag only.
  The merged config value would also flip resumes of agents whose frontmatter declares `run_in_background: true`, and it reads the frontmatter of the call's restated `subagent_type`, which can differ from the record's actual type.
- **`maxConcurrent` admission for a background resume.**
  Every resume starts immediately today, and so will this one.
  Queueing needs a queued-for-resume state, a refusal for a record queued for resume (`resumeRefusal` treats a non-running record as resumable), and an abort-while-queued path; filed as [#1013].
- **Widget row for a foreground-spawned agent resumed in the background.**
  `AgentWidget.listBackgroundAgents` filters on the spawn-time `isBackground`, so such a run shows no row; it still gets the completion notice.
  Filed as [#1012].
- **The service `resume` call shape.**
  It stays the one service call that waits; a consumer that does not need the outcome can already ignore the promise, and this plan's claim fix is what makes that ignored promise announce.
- **The foreground resume path (`resumeExisting`).**
  It keeps `claimOutcome: true`, its signal wiring, and `markConsumed()` unchanged.

## Background

- `src/tools/agent-tool.ts`: `AgentTool.execute` resolves config, then branches `resume` → `resumeExisting` (awaits `manager.resume(id, prompt, { signal, claimOutcome: true })`, words refusals via `resumeRefusalMessage`, marks consumed, renders the outcome), else background → `spawnBackground`, else `runForeground`.
  `AgentToolManager` is the tool's narrow manager interface.
- `src/tools/background-spawner.ts`: `spawnBackground` calls `manager.spawn` and hand-builds the launch text (`Agent started|queued in background.`, `Agent ID`, `Type`, `Description`, optional `Output file`, optional `Position`, the notification and follow-up lines, "Do not duplicate this agent's work.") and an `AgentDetails` literal with `status: "background"`.
- `src/lifecycle/subagent-manager.ts`: `SubagentManager.resume` is the resume choke point.
  It refuses `unknown-agent` or `record.resumeRefusal`, claims when `claimOutcome`, then awaits `agent.resume(prompt, signal)` and returns `{ kind: "resumed", record }`.
  The refusal checks are synchronous, but the method is `async`, so no caller can see a refusal without awaiting the whole run.
- `src/lifecycle/subagent.ts`: `Subagent.resume` stores the run in `_promise` (the `promise` getter) and returns it; `runResume` always resolves.
  `claim()`/`release()` delegate to `SubagentState`.
- `src/lifecycle/subagent-state.ts`: `_claimed` is documented as caller-scoped and live across `resetForResume`; nothing releases it after a carrier delivers.
- `src/observation/notification.ts`: `sendCompletion` and `emitIndividualNudge` return early when `record.claimed`.
  `SubagentEventsObserver.onSubagentResumed` routes every resumed terminal state into `sendCompletion`.
- `src/handlers/interrupt.ts`: a parent ESC aborts all subagents (per policy) through `manager.abortAll()`; a background resume needs no tool-call signal for that, same as a background spawn.
- AGENTS.md constraint: the package's `README.md` documents the tool parameters and the service `resume` contract; both are in this change's doc surface.

## Design Overview

### Observed scenario (the parent's terms)

1. The parent spawns a background agent; it ends its turn with a question.
2. The parent calls `subagent` with `resume`, its answer, and `run_in_background: true`.
3. Today: the call blocks until the resumed run is terminal and returns the outcome inline.
   After this change: the call returns "Agent resumed in background." with the agent ID; the widget shows the run (the agent was background-spawned); a completion notice arrives when it finishes.

If the parent had answered an earlier question with a foreground resume, or had waited on the agent with `get_subagent_result(wait: true)`, step 3's notice would never arrive without the claim fix.
A throwaway Vitest spike against the real `SubagentManager` confirmed that hazard: after `spawnAndWait` then an unclaimed `resume`, `record.claimed` was still `true`; after a claimed then an unclaimed `resume`, still `true` (spike removed; the fix's tests reproduce both).

### Manager: a synchronous start, and the claim set per resume

```typescript
/** What starting a resume produced: the record now running it, or why nothing started. */
export type ResumeStart =
  | { kind: "started"; record: Subagent }
  | { kind: "refused"; reason: ResumeRefusalReason };

startResume(id: string, prompt: string, options: ResumeCallOptions = {}): ResumeStart {
  const agent = this.agents.get(id);
  if (!agent) return { kind: "refused", reason: "unknown-agent" };
  const refusal = agent.resumeRefusal;
  if (refusal) return { kind: "refused", reason: refusal };
  // Each resume's caller decides who carries this run's outcome; a claim a
  // previous carrier left behind belongs to an outcome already delivered.
  if (options.claimOutcome) agent.claim(); else agent.release();
  void agent.resume(prompt, options.signal); // published as agent.promise; always resolves
  return { kind: "started", record: agent };
}

async resume(id: string, prompt: string, options: ResumeCallOptions = {}): Promise<ResumeOutcome> {
  const start = this.startResume(id, prompt, options);
  if (start.kind === "refused") return start;
  await start.record.promise;
  return { kind: "resumed", record: start.record };
}
```

`Subagent.resume` can reject only when the session is missing, which `resumeRefusal` already refuses as `no-session`, so dropping its returned promise loses nothing; the `void` is not a semantic discard because `record.promise` is the same promise and `resume` awaits it.
The implementing step confirms `agent.promise` is that promise (it is assigned in `Subagent.resume` before return) rather than trusting this paragraph.

The claim release is safe because a resume requires a settled record: a `get_subagent_result(wait: true)` on a settled record returns at once, so no live carrier holds a claim at the moment a resume starts.

### Tool: a background-resume branch on the explicit flag

```typescript
if (params.resume) {
  const id = params.resume as string;
  const prompt = params.prompt as string;
  if (params.run_in_background === true) {
    return this.resumeInBackground(id, prompt, config.identity.displayName, config.presentation.detailBase);
  }
  return this.resumeExisting(id, prompt, signal, config.presentation.detailBase);
}
```

`resumeInBackground` calls `this.manager.startResume(id, prompt, {})`: no signal (a background run is not tied to the tool call; ESC is the interrupt handler's job) and no claim (the notification channel carries the outcome).
A refusal returns `textResult(resumeRefusalMessage(reason, id))`.
A start returns the shared launch renderer with the headline `Agent resumed in background.`; it never calls `markConsumed()`.
`resumeExisting` and `resumeInBackground` stay two methods: they differ in await vs. immediate return, claim vs. none, and consumption vs. none, so a `background: boolean` merge would be the wrong abstraction.

### Shared launch renderer ([#988])

```typescript
export interface BackgroundLaunch {
  headline: string;               // "Agent started|queued|resumed in background."
  id: string;
  displayName: string;
  description: string;
  detailBase: SpawnPresentation["detailBase"];
  notes?: readonly string[];      // spawn notes; resume passes none
  outputFile?: string;
  queuePosition?: { maxConcurrent: number }; // spawn's queued arm only
}

export function renderBackgroundLaunch(launch: BackgroundLaunch): AgentToolResult<AgentDetails>
```

It lives in `background-spawner.ts`, which already "owns launch message formatting" and which `agent-tool.ts` already imports.
It takes plain fields, not a `Subagent` or settings (ISP): the spawn door maps `record.status === "queued"` to `queuePosition` and its headline itself.
The resume door passes `record.outputFile` (it survives `releaseSession`) and keeps the "Do not duplicate this agent's work." line, because a resumed agent carries the same duplication hazard; both doors therefore render one template.
The `notes` parameter type follows whatever `renderSpawnNotes` accepts today; the implementing step reads it rather than this sketch.

Description for the resume launch is the call's `description` param (`config.execution.description`), matching what the foreground resume reports; `Type` is the call's resolved display name, as `detailBase` already is on the foreground resume.

### Tool description

The `resume` parameter description gains one clause so the combination is discoverable: `Optional agent ID to resume from. Continues from previous context. Combine with run_in_background: true to resume without waiting.` No new guideline bullet (the guidelines block sits in every session's tool description; the parameter is where the combination is decided).

## Module-Level Changes

- `src/tools/background-spawner.ts`: add exported `BackgroundLaunch` and `renderBackgroundLaunch`; `spawnBackground` delegates its text and details to it.
  Output byte-identical for the spawn door.
- `src/lifecycle/subagent-manager.ts`: add exported `ResumeStart` and `SubagentManager.startResume`; `resume` composes it.
  Claim set per resume (`claim()` or `release()`); update the `resume` doc comment and the "Before the resume starts" comment to describe `startResume`.
- `src/lifecycle/subagent.ts`: update the comment on `release()` that names its callers (it currently lists `get-result-tool.ts` and `agent-tool.ts`) to include the manager's `startResume`.
- `src/tools/agent-tool.ts`: `AgentToolManager` gains `startResume`; `execute` routes the explicit-flag resume to a new private `resumeInBackground`; `resume` parameter description gains the clause above.
- `test/tools/background-spawner.test.ts`: unchanged assertions (they pin the refactor); add direct `renderBackgroundLaunch` tests for the resume headline and the omitted-optional-lines shape.
- `test/lifecycle/subagent-manager.test.ts`: `startResume` tests (`started` shape before the run settles, synchronous refusals); stale-claim tests via a real `NotificationManager` wired to `onSubagentResumed`.
- `test/helpers/make-deps.ts`: default fixture manager gains `startResume`; add `mockResumeStart(deps, overrides)` and `mockResumeStartRefusal(deps, reason)` beside `mockResumeRecord`/`mockResumeRefusal`.
- `test/tools/agent-tool.test.ts`: new `describe("background resume")` under the resume path.
- `README.md`: the `subagent` parameter section gains a sentence that `resume` plus `run_in_background: true` resumes without waiting and notifies on completion, and that an agent file's `run_in_background` default does not apply to a resume.
  The service `resume` contract text is already correct after the claim fix; no edit.
- `docs/architecture/architecture.md`: the `SubagentManager` class-diagram node (`+resume(id, prompt, signal)`, line ~216) gains `+startResume(id, prompt, options)`; the `subagent-manager.ts` module-tree entry (line ~369) notes the synchronous start a non-waiting door uses.
  The `background-spawner.ts` module-tree entry is checked and updated if it describes the launch message.
- `CHANGELOG.md`: generated at release; no hand edit.

Predicted unchanged, in the blast radius:

- `src/service/service-adapter.ts` and `test/service/service-adapter.test.ts`: the adapter forwards to `manager.resume`, whose signature is unchanged; the test asserts only the forwarded options.
- `src/observation/notification.ts` and its tests: they call `record.claim()` directly; the claim predicate they read is unchanged.
- `src/tools/get-result-tool.ts` and its tests: they claim and release their own records, not through the manager.
- `.pi/skills/package-pi-subagents/SKILL.md`: no passage describes resume dispatch or claim lifetime (grepped `resume`: only the domain table's "Spawn, abort, resume" wording, still accurate).
- `docs/configuration.md`: its ask-back passage names "the resume" as a carrier without saying it blocks; still accurate.

## Test Impact Analysis

1. New tests enabled: `startResume` makes a resume's start observable without awaiting its run, so a test can assert the `started` shape and running status while the turn loop is still gated.
   `renderBackgroundLaunch` can be tested without a manager.
2. Redundant tests: none; the existing `spawnBackground` tests keep pinning the spawn door end to end.
3. Tests that stay as-is: every `AgentTool — resume path` test (they drive `manager.resume` through `resumeExisting`, which is unchanged); the manager's `resume` tests (they pin `resume`'s behavior across the split); `claims the outcome before the turn loop starts when the caller asks` pins the claim ordering the split must preserve.

## Invariants at risk

- **Claim before reset** (`subagent-manager.test.ts`, `claims the outcome before the turn loop starts when the caller asks`): the claim must be set before `agent.resume()` runs `resetForResume` synchronously.
  `startResume` keeps the order; this test pins it for the tool's foreground door and the service door.
- **Foreground resume claims and consumes** (`agent-tool.test.ts`, `claims the outcome as it resumes, so the resume is never announced` and `marks the resumed record consumed`): unchanged path; the stale-claim fix must not touch a claimed resume.
- **Spawn launch text** (`background-spawner.test.ts`, all cases): the renderer extraction must leave the spawn door's text and details byte-identical.
- **Resume refusals are prompt** (README `resume` contract; manager `refused` tests): `resume` still returns refusals without running a turn loop, now through `startResume`.

## TDD Order

1. **`refactor(pi-subagents): extract the background launch message renderer`** Extract `renderBackgroundLaunch` from `spawnBackground` in `src/tools/background-spawner.ts`; `spawnBackground` maps its record to `headline`/`queuePosition`/`outputFile` and delegates.
   Add direct tests in `test/tools/background-spawner.test.ts`: the `Agent resumed in background.` headline with `Output file:` present, and a launch with no notes, no output file, and no queue position (full-string `toBe`).
   Killing mutation: in `renderBackgroundLaunch`, emit `Output file:` unconditionally (`` `Output file: ${launch.outputFile}\n` ``) — the no-output-file test goes red.
   Verify: the existing `spawnBackground` tests pass unmodified.
   Re-read the moved code against the `code-design` skill before committing (an extraction copies the source's shape into a shared function).
   Prepares: the resume door's launch message in step 5, and closes [#988]'s duplication before it exists.

2. **`refactor(pi-subagents): start a resume synchronously through startResume`** Add `ResumeStart` and `SubagentManager.startResume`; `resume` composes it.
   Claim semantics unchanged in this step (`if (options.claimOutcome) agent.claim();`).
   Tests in `test/lifecycle/subagent-manager.test.ts` under the resume `describe`, in a new nested `describe("startResume")`:
   - returns `{ kind: "started", record }` with `record.status === "running"` while `resumeTurnLoop`'s promise is gated by `Promise.withResolvers` (resolve it at the end);
   - returns `{ kind: "refused", reason: "still-running" }` for a running record and `"unknown-agent"` for an unknown id, without calling `resumeTurnLoop`.
   Killing mutations: (a) make `startResume` return `{ kind: "started", record: agent }` before calling `agent.resume(...)` — the running-status test goes red; (b) delete the `resumeRefusal` check — the `still-running` test goes red.
   Verify: every existing `resume` test passes unmodified.
   Prepares: a non-waiting door (step 5) and the single site for the claim fix (step 3).

3. **`fix(pi-subagents): announce a resumed agent's outcome even after an earlier carrier delivered it`** In `startResume`, `if (options.claimOutcome) agent.claim(); else agent.release();`, with the comment from the Design Overview; update the `release()` caller comment in `src/lifecycle/subagent.ts`.
   Tests in `test/lifecycle/subagent-manager.test.ts`, new `describe("resume announcement after a delivered outcome")`, using a real `NotificationManager` wired as `onSubagentResumed: (r) => notifications.sendCompletion(r)` with the parent run idle:
   - after `spawnFg` (which claims), an unclaimed `resume` sends one completion message (`sendMessage` called once) and leaves `claimed === false`;
   - after a `claimOutcome: true` resume, an unclaimed `resume` sends one completion message;
   - a `claimOutcome: true` resume after `spawnFg` sends none (pins that the fix does not over-release).
   Killing mutation: revert to `if (options.claimOutcome) agent.claim();` — the first two tests go red, the third stays green.
   This is the service door's fix too; its commit body says so (an unclaimed `SubagentsService.resume` of an agent that was foreground-spawned or waited on now announces, as the README contract states).

4. **`refactor(pi-subagents): give the subagent tool's manager seam startResume`** Add `startResume` to `AgentToolManager` in `src/tools/agent-tool.ts`; add it to `createToolDeps`'s default manager and add `mockResumeStart`/`mockResumeStartRefusal` in `test/helpers/make-deps.ts`, mirroring `mockResumeRecord`/`mockResumeRefusal` (typed `vi.fn` implementations per the `testing` skill so the fixture satisfies the interface).
   No behavior change; `pnpm --filter @gotgenes/pi-subagents run check` after the commit confirms `SubagentManager` still satisfies `AgentToolManager` at the composition root.

5. **`fix(pi-subagents): resume a subagent in the background when the call asks for run_in_background`** Add the explicit-flag branch and `resumeInBackground` to `AgentTool`; extend the `resume` parameter description.
   Tests in `test/tools/agent-tool.test.ts`, new `describe("background resume")` inside `AgentTool — resume path`:
   - with `run_in_background: true`, calls `manager.startResume` with `("agent-1", "continue", {})` and never `manager.resume`, and returns the full launch text (`Agent resumed in background.`, `Agent ID: …`, `Type: …`, `Description: …`, notification lines) via `toBe`;
   - the result's `details` carry `status: "background"` and `agentId`;
   - the started record is not marked consumed (`record.consumed === false`);
   - a refusal returns the same sentence the foreground door returns for that reason (one `it.for` over `unknown-agent`, `still-running`);
   - without `run_in_background`, a resume of a type whose agent file declares `run_in_background: true` still calls `manager.resume` (registry override with a custom agent config);
   - with `run_in_background: false`, `manager.resume` is called.
   Killing mutations, one per class: (a) delete the background branch so every resume goes to `resumeExisting` — the `startResume` call test goes red; (b) route on `config.execution.runInBackground` instead of `params.run_in_background === true` — the frontmatter-default test goes red; (c) pass `{ claimOutcome: true }` to `startResume` — the exact-arguments assertion goes red; (d) call `record.markConsumed()` in `resumeInBackground` — the consumed test goes red; (e) render the launch message before checking `kind === "refused"` — the refusal tests go red.
   Commit body credits the reporter's diagnosis and expected behavior; final paragraph:

   ```text
   Refs #987

   Co-authored-by: Sungbin Jo <goranmoomin@daum.net>
   ```

6. **`docs(pi-subagents): document background resume`** `README.md` parameter-section sentence; `docs/architecture/architecture.md` class-diagram node and module-tree entries listed in Module-Level Changes.
   Verify with `pnpm exec rumdl check` on both files.

## Risks and Mitigations

- **A silent background resume.**
  Without step 3 the tool's new door would report "you will be notified" and never notify for an already-delivered agent.
  Step 3 lands before step 5, and its tests run the real `NotificationManager`, so the risk is pinned at the layer that suppresses the nudge rather than by a mock.
- **Over-release of a live claim.**
  `release()` at resume start would wrongly drop a carrier that is still delivering.
  A resume requires a settled record (`resumeRefusal` refuses `still-running`), and a wait on a settled record returns at once, so no carrier is live at that point; step 3's third test pins that a claimed resume still suppresses.
- **Dropped promise hides a rejection.**
  `startResume` discards `agent.resume()`'s return; it rejects only for a missing session, which `resumeRefusal` refuses first.
  `resume` awaits `record.promise`, the same promise, so the waiting door observes everything it did before.
- **Spawn launch text drifts during extraction.**
  The existing `spawnBackground` tests assert the text and must pass unmodified in step 1.
- **Concurrent background resumes exceed `maxConcurrent`.**
  Accepted for now (same as every resume today); tracked in [#1013].

## Open Questions

- Whether the widget should show a foreground-spawned agent during a background resume, and through which mechanism, is [#1012].

[#988]: https://github.com/gotgenes/pi-packages/issues/988
[#1012]: https://github.com/gotgenes/pi-packages/issues/1012
[#1013]: https://github.com/gotgenes/pi-packages/issues/1013
