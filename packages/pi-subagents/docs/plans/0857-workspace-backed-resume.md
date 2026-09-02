---
issue: 857
issue_title: "pi-subagents: a resumed child re-enters a session whose workspace completeRun() already disposed"
---

# Hold a question-ending child's workspace open, and refuse a resume into a torn-down one

## Release Recommendation

**Release:** ship independently

Phase 22 Step 10 carries `Release: independent` in `docs/architecture/architecture.md`, and no release batch names it.
The plan also lands a `docs(pi-subagents-worktrees):` commit, and `docs` is a visible changelog type, so it cuts a patch for that package too — the ship dispatch names both `pi-subagents` and `pi-subagents-worktrees`.

## Problem Statement

`Subagent.completeRun()` disposes the child's provider-supplied workspace on every terminal transition and folds `WorkspaceBracket.dispose()`'s addendum into the result text.
`Subagent.resume()` reuses the existing `SubagentSession` and never re-prepares anything.
A child spawned under a registered `WorkspaceProvider` therefore resumes into a working directory the provider has already torn down, with no signal — the one outcome that tells nobody anything.

This bounds the ask-back loop [#465] shipped as Phase 22 Step 8 for exactly the delegated-implementation agents most likely to hold a workspace: the child asks a question, the parent answers by resuming, and the answer lands in a child whose worktree is gone.

## Goals

- A child that ends a run **completed with a declared question** keeps its workspace live for the resume that question invites.
- A resume into a workspace that was already torn down is **refused with a message naming the mechanism**, the way a released session already is.
- Every other terminal outcome — aborted, steered, errored, or completed without a question — disposes exactly as it does today, including the `Changes saved to branch …` addendum in the result text.
- Not a breaking change: no signature, default, or config change; `WorkspaceProvider`, `Workspace`, and `WorkspaceDisposeOutcome` are untouched.
  The commits are `fix:` / `refactor:` / `test:` / `docs:`.

## Non-Goals

- **Re-preparing a workspace on resume.**
  Ruled out on evidence, not preference; see Background.
- **A reopenable-workspace seam.**
  Giving `WorkspaceProvider` a way to hand back a workspace it previously disposed (or to be told a workspace must survive a run) is a seam redesign with no committed consumer.
  No issue filed — it is a deferral, not a named follow-up.
- **Delivering the addendum produced at the deferred disposal edge.**
  When a question-ending child is never resumed, its workspace disposes at `releaseSession()`/`disposeSession()` and the returned addendum has no reader.
  Filed as [#870] and adopted as Phase 22 Step 12; this plan accepts the drop.
- **Suppressing the question affordance.** `renderQuestionAffordance` stays as it is: under this plan a question-ending workspace-backed child is genuinely resumable, so the affordance is correct.
- **Changing retention windows or the sweep.** `consumedSessionRetentionMinutes` / `unconsumedSessionRetentionMinutes` keep their meaning and defaults.
- **Extending `SubagentRecord`.**
  The new `workspaceDisposed` accessor is on the `Subagent` class, read by the Agent tool; it does not enter the public snapshot.

## Background

### The disposal edge today

`src/lifecycle/subagent.ts`:

```typescript
const finalResult =
  result.responseText +
  this.workspaceBracket.dispose({ status: finalStatus, description: this.description });

const { question, body } = parseQuestionForParent(finalResult);
this.state.setPendingQuestion(question);
```

The question is parsed **after** disposal already happened, out of the concatenation of the response text and the addendum.
`failRun()` disposes in a best-effort `try`/`catch`.
`completeResume()`, `failResume()`, `releaseSession()`, and `disposeSession()` never touch the bracket.

`WorkspaceBracket.dispose()` is a real disposal, guarded only by whether a workspace was prepared, and it does not clear `prepared` — a second call disposes again.

### Why re-prepare is not available

The one real provider is `@gotgenes/pi-subagents-worktrees`.
Three independent blockers, each verified in source:

1. **The session's cwd is frozen.**
   `createSubagentSession` takes `cwd` as a value (`src/lifecycle/create-subagent-session.ts:159`) and hands it to `createSessionManager(cwd, …)` and `createSettingsManager(cwd, …)`.
   Nothing re-sets it, so a re-prepared workspace at a new path is not where the resumed child runs.
2. **The path is randomized.** `createWorktree` appends `randomUUID().slice(0, 8)` to the worktree path (`packages/pi-subagents-worktrees/src/worktree.ts`), so a second `prepare()` cannot return the first path even in principle.
3. **The child's work is not in the new tree.**
   `cleanupWorktree` commits a dirty tree to `pi-agent-<id>` and removes the worktree; a fresh `git worktree add --detach <path> HEAD` checks out the *parent's* HEAD.
   The resumed child would find none of its own edits, and the second cleanup would collide on the branch name and fall back to `pi-agent-<id>-<timestamp>`, scattering the work across two branches.

### Prepared is not the same as provider-registered

`WorktreeWorkspaceProvider.prepare()` returns `undefined` for any agent type not listed in `worktreeAgents`.
So `WorkspaceBracket.hasProvider()` is true for every child in a session with the extension installed, while only opted-in agents actually hold a workspace.
The refusal must key on an actually-prepared-and-disposed workspace, or it would break resume for the majority of children.

### Constraints from `AGENTS.md`

- The core has no knowledge of git or worktrees; this plan adds none.
- Architecture-doc module-tree entries describe current behavior and carry no issue refs.
- `docs/architecture/` is excluded from release scope; `docs/plans/` and `docs/retro/` likewise.

## Design Overview

### The rule

> A terminal transition disposes the child's workspace **unless** the outcome is `completed` and the child declared a question.
> A pending question is an invitation to resume, so the run is not over.
> The catch-all is session release: `releaseSession()` and `disposeSession()` dispose any workspace still held, best-effort.

The hold applies to `completed` only.
An abort, a steer-termination, or an error disposes at once, so a user who stopped a child still gets its rescue branch immediately rather than minutes or hours later.
The only case the two candidate rules differ on is a child that emitted a question marker and was then aborted or steer-terminated before settling normally; that case disposes.

### State on `WorkspaceBracket`

```typescript
export class WorkspaceBracket {
  private prepared?: Workspace;
  private disposedWorkspace = false;

  /** True once a prepared workspace has been torn down — the run's cwd is gone. */
  wasDisposed(): boolean {
    return this.disposedWorkspace;
  }

  dispose(outcome: WorkspaceDisposeOutcome): string {
    const workspace = this.prepared;
    if (!workspace) return "";
    this.prepared = undefined;
    this.disposedWorkspace = true;
    return workspace.dispose(outcome)?.resultAddendum ?? "";
  }
}
```

Clearing `prepared` before calling through makes `dispose()` idempotent, which the deferred design needs: the held-workspace catch-all in `releaseSession()`/`disposeSession()` can now fire on a record whose run already disposed, and no-op.
The flag is set before the call rather than after, so a provider whose `dispose()` throws still leaves the bracket reporting a torn-down workspace — resume is unsafe either way, and the throw still propagates (the best-effort `try`/`catch` stays at the call site, per the seam's own doc comment).
`prepare()` is called once per agent at run start, so the flag needs no reset.

### The three sites on `Subagent`

`completeRun()` becomes:

```typescript
const finalStatus: SubagentStatus = result.aborted ? "aborted" : result.steered ? "steered" : "completed";
const { question, body } = parseQuestionForParent(result.responseText);
const holdForResume = finalStatus === "completed" && question !== undefined;
const finalBody = holdForResume
  ? body
  : body + this.workspaceBracket.dispose({ status: finalStatus, description: this.description });
```

`completeResume()` applies the same rule, where the status is always `completed`, so the condition reduces to `question !== undefined`.
`failResume()` gains the best-effort disposal `failRun()` already has — today it needs none, because the workspace was gone before the resume started.

The catch-all:

```typescript
// In releaseSession() and disposeSession(), after the existing session guard:
if (!this.isActive()) this.disposeWorkspaceQuietly(this.status);
```

The `isActive()` guard keeps today's behavior for a running child.
`SubagentManager.dispose()` calls `disposeSession()` on every record including running ones; a running child's workspace is already disposed by `failRun()` when its turn loop rejects, and disposing it out from under a live child would be a new behavior this fix has no reason to introduce.

### The refusal

`AgentTool.execute()`'s resume branch gains a third guard, after the `isSessionReady()` / `sessionReleased` pair and before `existing.claim()`:

```typescript
if (existing.workspaceDisposed) {
  return textResult(
    `Agent "${id}" ran in an isolated workspace that no longer exists; resume is unavailable ` +
      `because the agent would re-enter a directory that has been removed. Spawn a new agent ` +
      `instead — the agent's result records where any work was saved.`,
  );
}
```

`Subagent.workspaceDisposed` is a one-line getter delegating to `this.workspaceBracket.wasDisposed()`, matching the `sessionReleased` getter beside it.
It is false for a child that never had a workspace and false for one holding a live workspace, so only the genuinely-broken resume is refused.

### Interaction table

| Terminal outcome                         | Question declared | Workspace at run end                                      | Resume                                                |
| ---------------------------------------- | ----------------- | --------------------------------------------------------- | ----------------------------------------------------- |
| completed                                | yes               | held, addendum deferred                                   | allowed; disposes at the resume's terminal transition |
| completed                                | no                | disposed, addendum in result                              | refused                                               |
| aborted / steered                        | either            | disposed, addendum in result                              | refused                                               |
| error                                    | n/a               | disposed (best-effort)                                    | refused                                               |
| any, no provider or not opted in         | either            | never prepared                                            | allowed, as today                                     |
| held workspace, retention window expires | —                 | disposed at `releaseSession()`, addendum dropped ([#870]) | refused as "session released"                         |

A child that asks, is resumed, answers without asking again, and then is resumed a second time is refused on that second call — correct, since its workspace went at the first resume's terminal transition.

### Call-site sketch

```typescript
// Agent tool, resume branch — tell by id, with an outcome, no reaching through
const existing = this.manager.getRecord(id);
if (!existing.isSessionReady()) { /* not-found / released messages, unchanged */ }
if (existing.workspaceDisposed) return textResult(WORKSPACE_GONE_MESSAGE);
existing.claim();
```

The tool asks the record one boolean question and never reaches into the bracket, the workspace, or the provider.

## Module-Level Changes

### `packages/pi-subagents/src/lifecycle/workspace-bracket.ts`

- Add the private `disposedWorkspace` flag and the `wasDisposed()` accessor.
- `dispose()` clears `prepared` and sets the flag before delegating; it becomes idempotent.
- Update the module doc comment: dispose is idempotent and the bracket reports whether it tore a workspace down.

### `packages/pi-subagents/src/lifecycle/subagent.ts`

- `completeRun()`: parse the question from `result.responseText` before the dispose decision; add the `holdForResume` condition.
- `completeResume()`: same rule; dispose and append the addendum when no question is declared.
- `failResume()`: best-effort disposal, mirroring `failRun()`.
- `failRun()`: call the extracted `disposeWorkspaceQuietly(status)` instead of its inline `try`/`catch`.
- New private `disposeWorkspaceQuietly(status: SubagentStatus): void` — best-effort dispose, `debugLog` on failure, addendum discarded.
- `releaseSession()` / `disposeSession()`: dispose a still-held workspace when the record is not active.
- New `get workspaceDisposed(): boolean` delegating to the bracket.

### `packages/pi-subagents/src/tools/agent-tool.ts`

- Third refusal guard in the resume branch.

### `packages/pi-subagents/test/helpers/make-workspace.ts` (new) and `make-workspace.test.ts` (new)

- `makeWorkspace(cwd, disposeResult?)` and `makeWorkspaceProvider(workspace)`, lifted from the two near-duplicate copies in `test/lifecycle/workspace-bracket.test.ts` and `test/lifecycle/subagent.test.ts` with their signatures reconciled on the object form (`{ resultAddendum }`).
- Every file in `test/helpers/` has a sibling `.test.ts`; the new helper follows that convention.

### `packages/pi-subagents/test/lifecycle/workspace-bracket.test.ts`

- Import the shared builders; drop the local `makeWorkspace` / `makeProvider`.
- New tests for `wasDisposed()` and dispose idempotency.

### `packages/pi-subagents/test/lifecycle/subagent.test.ts`

- Import the shared builders; drop the local copies.
- New tests for the hold rule across `completeRun`, `completeResume`, `failResume`, and the release/dispose catch-all.

### `packages/pi-subagents/test/tools/agent-tool.test.ts`

- New test for the workspace refusal, building the record with `makeStubExecution({ getWorkspaceProvider })` and driving `await agent.run()` so the workspace is disposed by real code rather than seeded state.

### `packages/pi-subagents/README.md`

- The `**Session resume**` feature bullet gains the condition: an agent that ran in a provider-supplied workspace is resumable only while that workspace is live.

### `packages/pi-subagents-worktrees/README.md`

- The `## Behavior` list gains a bullet: a child that ends its turn with a question keeps its worktree until the parent's resume settles (or until the subagents core releases its session).

### `packages/pi-subagents/docs/architecture/architecture.md`

- Module-tree entries: `workspace-bracket.ts` gains "idempotent dispose; reports whether a workspace was torn down", and `subagent.ts` gains `resume` to its parenthetical.
- Phase 22 Step 10: `✅` mark on the heading, the `S10` Mermaid node, and a `Landed:` note.

### Greps performed at planning time

- `.pi/skills/package-pi-subagents/SKILL.md` — two hits on "workspace" (the Lifecycle domain-table row and the Phase 16 note).
  Neither becomes false; no edit.
- `packages/pi-subagents/docs/` — `configuration.md` mentions `WorkspaceProvider` only for skill resolution and the cwd claim; no ADR describes the disposal edge's timing.
- `packages/pi-subagents/README.md` — `resume` appears at lines 7, 24, 25, 124, 207; only line 24's feature bullet becomes incomplete.
- `packages/pi-subagents-worktrees/README.md` — the `## Behavior` list states "when the child finishes" twice; one bullet is added rather than rewriting them.
- No export is removed or renamed, so the removal greps do not apply.

## Test Impact Analysis

### What the change makes newly testable

- `WorkspaceBracket` gains an observable answer to "did you tear a workspace down?", which is unit-testable directly rather than inferred from a `dispose` spy on a stub.
- Dispose idempotency becomes assertable (`dispose()` twice, `workspace.dispose` called once).

### Existing tests that stay

All the ask-back tests in `test/lifecycle/subagent.test.ts` stay as they are — they run without a workspace provider, so the hold rule cannot change their outcomes, and they are the pins for [#465]'s invariants.
The workspace tests in the same file (`createRunnableAgent({ workspaceProvider })`) stay: they assert the addendum lands in the result for a no-question completion, which is exactly the branch this plan preserves.

### Tests that become redundant

None.
The lifted `makeWorkspace`/`makeProvider` builders are deduplicated, but every assertion survives.

### The reorder's one behavioral edge

Parsing the question from `result.responseText` instead of from `responseText + addendum` is not byte-identical in one case: a child whose question block ends its output **and** whose workspace returns an addendum.
Today `spliceOut` strips the addendum's leading `\n\n` and rejoins with a single `\n`; after the reorder the addendum is concatenated onto the already-spliced body with its leading blank line intact.
Under the new rule that intersection cannot arise for a `completed` outcome (it holds instead of disposing), and it can only arise for an aborted or steered run that declared a question and held a workspace.
No existing test combines the two (`subagent.test.ts` has question tests without a provider and provider tests without a question), so the reorder step is green as written — but the claim is "no existing test covers the intersection", not "the reorder is byte-identical".

### Baseline

Measured: `pnpm --filter @gotgenes/pi-subagents run test` → **1447 tests across 74 files**, matching the Step 9 close.
Estimated after: 75 files (the new helper's sibling test), roughly 15–20 added tests.

## Invariants at risk

| Invariant                                                                                   | Source                                               | Pin                                                                                          | Risk here                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| A declared question is split out before the result is stored, so it renders once            | Step 8 ([#465]) `Landed:`                            | `subagent.test.ts` — "records a declared question and strips it from the stored result"      | Step 1 moves the parse; opened and confirmed it asserts both `pendingQuestion` and the stripped `result`                           |
| An aborted run's declared question is still recorded                                        | Step 8 ([#465])                                      | `subagent.test.ts` — "records a question an aborted run declared before it ran out of turns" | The hold rule deliberately excludes `aborted`; this test pins that the *question* still records even though the workspace disposes |
| A resumed run's follow-up question is recorded and stripped                                 | Step 8 ([#465])                                      | `subagent.test.ts` — "records a follow-up question a resumed run declares"                   | `completeResume` gains a branch around the same parse                                                                              |
| The claim is caller-scoped: `resetForResume` clears `consumedAt` but not the claim          | Step 8 ([#465]) `Landed:`                            | `subagent.test.ts` resume/claim tests                                                        | The new refusal returns **before** `existing.claim()`, so a refused resume claims nothing                                          |
| `Workspace.dispose()` throws propagate; the best-effort wrap belongs at the call site       | Phase 16 Step 2 (`workspace-bracket.ts` doc comment) | `workspace-bracket.test.ts` — "propagates a throwing dispose (does not swallow)"             | The flag is set before delegating, so the throw still escapes                                                                      |
| `releaseSession()` is idempotent and a repeated sweep tick does not start a second teardown | [#617]                                               | `subagent.test.ts` — the release/dispose no-op tests                                         | The added workspace disposal sits after the existing session guard, and bracket dispose is idempotent                              |
| The resume-return delivery edge carries `Agent ID: <id>`                                    | Step 7 ([#798]) `Landed:`                            | `agent-tool.test.ts` resume-return tests                                                     | The new guard is an early return above that path; the successful-resume return is untouched                                        |

## TDD Order

### 1. `refactor(pi-subagents): parse a child's declared question before disposing its workspace`

Prepares Step 4 by untangling `completeRun()`: today the question is parsed out of `responseText + addendum` **after** disposal, and the hold rule needs the question **before** the dispose decision.
Reorder to parse `result.responseText`, derive `finalStatus`, then dispose and append the addendum to the already-split `body`.
Disposal stays unconditional; no test changes, no new tests.

Verify: full package suite green (1447).

### 2. `refactor(pi-subagents): extract disposeWorkspaceQuietly from failRun`

Prepares Step 5.
`failRun()` already wraps `workspaceBracket.dispose(...)` in a swallow-and-`debugLog` `try`/`catch`; Step 5 needs the same at three more sites.
Extract `private disposeWorkspaceQuietly(status: SubagentStatus): void` and call it from `failRun()`.
No test changes, no new tests.

Verify: full package suite green.

### 3. `test(pi-subagents): share the workspace stub builders across test files`

Prepares Steps 4–6.
`workspace-bracket.test.ts` and `subagent.test.ts` each define a near-identical `makeWorkspace` plus provider builder with different second-parameter shapes (`resultAddendum` string vs. `{ resultAddendum }` object), and Step 6 needs a third copy in `agent-tool.test.ts`.
Lift both into `test/helpers/make-workspace.ts` on the object form, add the sibling `make-workspace.test.ts` the helper directory's convention requires, and point both existing files at it.

Killing mutation: make `makeWorkspace`'s `dispose` return `undefined` unconditionally — the helper's own addendum test and the existing bracket addendum tests go red.

Verify: full package suite green; the count rises only by the new helper test file's own tests.

### 4. `refactor(pi-subagents): report whether a child's workspace was torn down`

`WorkspaceBracket` gains `disposedWorkspace` and `wasDisposed()`; `dispose()` clears `prepared` first and becomes idempotent; `Subagent` gains the `workspaceDisposed` getter.
Nothing reads the accessor yet, which is why this is `refactor:`.

Tests (`workspace-bracket.test.ts`, `subagent.test.ts`):

- `wasDisposed()` is false on a fresh bracket, false after a `prepare()` that resolved `undefined`, false after a `prepare()` that yielded a workspace, true after `dispose()`.
- A second `dispose()` returns `""` and does not call `workspace.dispose` again.
- A throwing `dispose()` still propagates **and** leaves `wasDisposed()` true.
- `Subagent.workspaceDisposed` is false before a run and true after a run that disposed one.

Killing mutations, one per class:

- Make `wasDisposed()` return `false` unconditionally → the four bracket-state tests and the `Subagent` getter test go red; the idempotency test stays green.
- Delete `this.prepared = undefined;` from `dispose()` → the idempotency test goes red; the state tests stay green.
- Move the flag assignment below `workspace.dispose(...)` → the throwing-dispose test goes red; every other test stays green.

Verify: `pnpm run check`, then the full package suite.

### 5. `fix(pi-subagents): keep a question-ending child's workspace alive for its resume`

The behavior change.
`completeRun()` gains `holdForResume = finalStatus === "completed" && question !== undefined`; `completeResume()` gains the same rule reduced to the question check; `failResume()` calls `disposeWorkspaceQuietly("error")`; `releaseSession()` and `disposeSession()` dispose a still-held workspace when `!this.isActive()`.

Tests (`subagent.test.ts`), by equivalence class:

- **Hold:** a run whose `responseText` carries a `<question-for-parent>` block and whose execution has a workspace provider leaves `workspace.dispose` uncalled, and `agent.result` carries no addendum.
- **Dispose otherwise:** the same provider with (a) no question, (b) a question plus `aborted: true`, (c) a question plus `steered: true` each call `workspace.dispose` once, with the matching `status` in the outcome, and the addendum in `agent.result`.
- **Resume terminal:** a held agent resumed to a plain answer disposes with `status: "completed"` and the addendum rides the resume result; a held agent whose `resumeTurnLoop` rejects disposes best-effort and the throw does not escape `resume()`.
- **Resume asks again:** a held agent whose resume declares another question stays held.
- **Catch-all:** a held agent's `releaseSession()` disposes the workspace; a held agent's `disposeSession()` disposes it; a **running** agent's `disposeSession()` does not.

Killing mutations:

- Force `holdForResume = false` in `completeRun` → the hold test goes red; every dispose-otherwise test stays green.
- Force `holdForResume = true` in `completeRun` → the three dispose-otherwise tests go red; the hold test stays green.
- Drop the `finalStatus === "completed"` conjunct → the aborted and steered dispose tests go red; the no-question test stays green.
- Delete the dispose call in `completeResume` → the resume-terminal disposal test goes red.
- Delete the `disposeWorkspaceQuietly` call in `releaseSession` → the release catch-all test goes red; the `disposeSession` one stays green.
- Delete the `!this.isActive()` guard → the running-agent test goes red; the two catch-all tests stay green.

Verify: `pnpm run check`, full package suite, `pnpm fallow dead-code`.

### 6. `fix(pi-subagents): refuse a resume into a workspace that no longer exists`

The third guard in `AgentTool.execute()`'s resume branch, plus the `README.md` feature-bullet condition.

Test (`agent-tool.test.ts`): a record built with `makeStubExecution({ getWorkspaceProvider: () => makeWorkspaceProvider(makeWorkspace("/ws/dir")) })` and driven through `await agent.run()` (its stub turn loop resolves `"done"` with no question, so the workspace disposes) is refused — the returned text names the removed directory and `manager.resume` is never called.
A sibling test pins the negative: a record with no workspace resumes normally.

Killing mutation: delete the guard block → the refusal test goes red on both assertions; the existing not-found, released-session, and successful-resume tests stay green.

Verify: `pnpm run check`, full package suite.

### 7. `docs(pi-subagents-worktrees): note that a question-ending child keeps its worktree`

One bullet in the `## Behavior` list.

Verify: `pnpm exec rumdl check packages/pi-subagents-worktrees/README.md`.

### 8. `docs(pi-subagents): mark Phase 22 Step 10 complete`

The `✅` heading mark, the `S10` Mermaid node, the `Landed:` note, and the two module-tree entries.

Verify: `pnpm run lint`, and render the Mermaid block per the `mermaid` skill.

## Risks and Mitigations

**A held workspace outlives its usefulness.**
A question-ending child that is never resumed holds its workspace until the retention sweep releases the session — 10 minutes after consumption by default, 720 if never consumed.
Mitigated by the catch-all in `releaseSession()`/`disposeSession()`, and bounded by the same windows that already bound session retention.
The residual — the addendum produced there has no reader — is [#870].

**A held worktree is misreported as preserved.**
`ActiveWorktrees.remove()` is called from `WorktreeWorkspace.dispose()`, so a held workspace stays registered as live and `findPreservedWorktrees` continues to exclude it.
Deferring disposal therefore cannot make the preserved-worktree warning fire spuriously — verify by reading `packages/pi-subagents-worktrees/src/preserved.ts` during Step 5 rather than assuming it.

**Double disposal.**
`SubagentManager.dispose()` calls `disposeSession()` on records whose run already disposed.
Mitigated structurally by clearing `prepared` in `dispose()`, and pinned by Step 4's idempotency test — the guarantee is a test, not an argument.

**Disposing under a running child.**
Guarded by `!this.isActive()` in the catch-all, with a test that a running agent's `disposeSession()` leaves the workspace alone.

**A provider whose `dispose()` throws leaves the bracket claiming success.**
Deliberate: the flag is set before delegating, because a failed teardown makes resume no safer.
The throw still propagates from `dispose()`; only the internal call sites swallow it.

**The refusal fires for a child that never had a workspace.**
Prevented by keying on an actually-prepared workspace rather than `hasProvider()`, which is true for every child in a session with the worktrees extension installed.
Pinned by Step 6's negative sibling test.

## Open Questions

- Should a held workspace have a bound shorter than the session-retention window?
  Deferring until someone reports a worktree held for 12 hours; the window is already the sweep's, not a new one.
- Should the `subagents:resumed` event or the `child-lifecycle` events carry the workspace's state?
  No consumer asks for it today; revisit under [#870] or Step 11 ([#858]), whichever designs the post-result channel first.

[#465]: https://github.com/gotgenes/pi-packages/issues/465
[#617]: https://github.com/gotgenes/pi-packages/issues/617
[#798]: https://github.com/gotgenes/pi-packages/issues/798
[#858]: https://github.com/gotgenes/pi-packages/issues/858
[#870]: https://github.com/gotgenes/pi-packages/issues/870
