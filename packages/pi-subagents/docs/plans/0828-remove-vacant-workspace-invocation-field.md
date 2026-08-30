---
issue: 828
issue_title: "pi-subagents: remove the vacant WorkspacePrepareContext.invocation field from the workspace seam"
---

# Remove the vacant `WorkspacePrepareContext.invocation` field and its dead storage chain

## Release Recommendation

**Release:** ship now — batch "front-door-majors" tail (this issue completes the batch)

`architecture.md`'s Phase 22 puts this issue at Step 4 and batches it with Step 3 ([#829]) as `front-door-majors`.
The batch's own line names Step 3 the tail because a `refactor!:` commit is a `hidden: true` changelog type that cannot cut a release by itself.
Step 3 landed first and deferred, and `docs/plans/0829-locked-fields-precedence.md` states the case exactly: "Hold the `pi-subagents` release-please PR open until [#828]'s commit joins it, then merge once for both."
That PR is open now — #842, `chore(main): release pi-subagents 21.0.0` — against a published 20.1.0.
This issue is therefore the batch's last remaining member: its commit joins PR #842, the `BREAKING CHANGE:` footer reaches the changelog under Step 3's existing major bump, and the PR merges.

## Problem Statement

`WorkspacePrepareContext` — the context the core hands a registered `WorkspaceProvider` at run-start — carries an `invocation?: AgentInvocation` field that no consumer has ever read.
The seam exists for exactly one consumer, `@gotgenes/pi-subagents-worktrees` ([#263]), whose `WorktreeWorkspaceProvider.prepare` uses `ctx.agentType`, `ctx.baseCwd`, and `ctx.agentId` and never touches the field.
That is not an oversight: worktree isolation is a per-agent-type policy, not a per-call one.

The contents would not serve a provider that wanted per-call facts anyway.
`AgentInvocation` is a UI display snapshot, and `modelName` is a display string — `model.name.replace(/^Claude\s+/i, "").toLowerCase()`, and `undefined` whenever it equals the parent's model (`src/tools/spawn-config.ts:120-125`).
A container provider sizing by model would receive `"haiku"` or `undefined`, never a `Model`.

This is the case `architecture.md`'s governing rule names outright: a provider seam with no consumer is a speculative abstraction that taxes every reader.
Latent extensibility is the deliverable; a vacant hook is not.

## Goals

- `WorkspacePrepareContext` carries exactly the three fields a provider reads: `agentId`, `agentType`, `baseCwd`.
- The storage chain that fed the vacant field — `AgentSpawnConfig.invocation` → `SubagentInit.invocation` → `Subagent.invocation` → the seam — is removed in full, leaving no field the core stores and nobody reads.
- The change is **breaking**: `WorkspacePrepareContext` is re-exported from `src/service/service.ts` and ships in `dist/public.d.ts`, released at `@gotgenes/pi-subagents@20.0.0`.
  It lands as `refactor(pi-subagents)!:` with a `BREAKING CHANGE:` footer naming the removed field.
- The seam context's shape is pinned by a test that actually discriminates, so the field cannot silently reappear.
- The `AgentInvocation` type survives as `spawn-config.ts`'s local display snapshot; only its storage on the record and its crossing of the manager boundary go away.

## Non-Goals

- **Replacing the field with a purpose-built per-call shape** (`isBackground`, `model: Model`, `maxTurns`).
  No consumer has asked for one, and inventing a second vacant hook to replace the first repeats the mistake.
  The `BREAKING CHANGE:` note tells a provider author to open an issue naming the fact they need.
- **Removing or reshaping `AgentInvocation`, `buildInvocationTags`, or `SpawnExecution.agentInvocation`.**
  `spawn-config.ts:134` builds one locally and hands it to `buildInvocationTags` for the tool result's display tags; that path is live and untouched.
- **Bumping `@gotgenes/pi-subagents-worktrees`' dependency or peer range.**
  Its `peerDependencies` entry is `>=16.4.0` and its `devDependencies` entry is `^16.4.0`, both resolved from the registry (`linkWorkspacePackages: false`).
  `WorktreeWorkspaceProvider` never reads the removed field, so the range stays accurate and no bump is warranted.
- **Reworking `ADR 0005`'s admission rules.**
  Only its display-snapshot example is amended, because the field it names ceases to exist.
- **Re-litigating the batch.**
  The release decision is settled above and in [#829]'s plan; this issue does not reopen it.

## Background

Relevant modules and how they relate.

| Module                                                              | Role in the chain                                                                            |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/lifecycle/workspace.ts`                                        | Defines `WorkspacePrepareContext`, the seam's input; holds the vacant field.                 |
| `src/lifecycle/subagent.ts`                                         | `SubagentInit.invocation` → `readonly invocation` → the `prepare({...})` literal in `run()`. |
| `src/lifecycle/subagent-manager.ts`                                 | `AgentSpawnConfig.invocation` → the `new Subagent({...})` literal in `create()`.             |
| `src/tools/background-spawner.ts`, `src/tools/foreground-runner.ts` | The two producers; each passes `execution.agentInvocation` into the manager.                 |
| `src/tools/spawn-config.ts`                                         | Builds the `AgentInvocation` and hands it to `buildInvocationTags`; **survives**.            |
| `src/service/service.ts`                                            | Re-exports `WorkspacePrepareContext` into the public entry (`dist/public.d.ts`).             |

Hard dependency, now satisfied: [#724] (Phase 22 Step 1) removed the widget's `record.invocation?.runInBackground` read in favor of `Subagent.isBackground`, which was the chain's only other terminal reader.
It is closed and landed, so this change can proceed.

Constraints from `AGENTS.md` that apply:

- A `refactor:` commit is a `hidden: true` changelog type and cuts no release on its own; the `!`/`BREAKING CHANGE:` footer still forces a major and still reaches the changelog.
  Confirmed in `release-please-config.json` (`refactor` and `test` both carry `"hidden": true`).
- Before pricing a rename or removal of an export as breaking, read the file at the published tag.
  `pnpm view @gotgenes/pi-subagents version` reports `20.1.0`, and `WorkspacePrepareContext` has shipped with the field since `20.0.0` — so this is genuinely semver-major, not a free rename.
- Do not name an unreleased version in docs.
  The migration note describes the condition, not a number.
- Before naming a remediation in a breaking-change migration note, verify it exists.
  There is no replacement field, so the note says so rather than pointing at one.

## Design Overview

The change is a deletion along a linear chain, with one design decision inside it: **what pins the seam context's shape afterwards**.

### The seam context after the change

```typescript
/** Context the core hands a provider when a child run starts. */
export interface WorkspacePrepareContext {
  agentId: string;
  agentType: SubagentType;
  baseCwd: string;
}
```

The consumer's call site is unchanged and already reads only these three (`packages/pi-subagents-worktrees/src/workspace-provider.ts:77-89`):

```typescript
async prepare(ctx: WorkspacePrepareContext): Promise<Workspace | undefined> {
  if (!this.config.worktreeAgents.includes(ctx.agentType)) return undefined;
  const info = createWorktree(ctx.baseCwd, ctx.agentId);
  ...
  return new WorktreeWorkspace(ctx.baseCwd, info, this.live);
}
```

Three fields, each read; no field the provider must ignore.
This satisfies ISP in the direction that matters for a seam — the core hands the provider exactly what a provider uses.

### The pin: `toStrictEqual`, not `toHaveBeenCalledWith`

`test/lifecycle/subagent.test.ts`'s "calls prepare with the run-start context" looks like the guard against the field reappearing:

```typescript
expect(provider.prepare).toHaveBeenCalledWith({
  agentId: "run-1",
  agentType: "general-purpose",
  baseCwd: "/parent",
  invocation: undefined,
});
```

It is not.
`toHaveBeenCalledWith` compares with `toEqual` semantics, which **ignore a key whose value is `undefined`**.

Measured at planning time, on a spike that removed the field from `WorkspacePrepareContext` and from the `prepare({...})` literal in `Subagent.run()` while leaving this assertion untouched:

| Instrument                                                 | Result on the partial removal |
| ---------------------------------------------------------- | ----------------------------- |
| `pnpm --filter @gotgenes/pi-subagents run check`           | passes                        |
| `pnpm fallow dead-code --workspace @gotgenes/pi-subagents` | `✓ No issues found`           |
| `vitest run test/lifecycle/subagent.test.ts`               | 101 passed                    |

A second probe confirmed the matcher semantics directly: `expect(fn).toHaveBeenCalledWith({a, b, c: undefined})` passes against a call of `{a, b}`, while `expect(fn.mock.calls[0][0]).toStrictEqual({a, b})` fails against a call of `{a, b, c: undefined}`.

Two consequences follow, and both shape the plan.

1. The existing assertion is replaced with a `toStrictEqual` on the recorded call argument, which does discriminate.
   That is the step's killing mutation and the guard the issue's Goals ask for.
2. The issue's claim that `pnpm fallow dead-code` gates a partial removal is **false**, and the plan does not rely on it.
   Nothing mechanical forces the whole chain into one commit; TypeScript's excess-property checking forces only the pairings (each interface field with the object literal that sets it).
   The chain lands in one commit because a half-removed chain leaves a stored-and-unread field — the exact defect this issue exists to remove — not because a gate would catch it.

### Doc comments that name the removed field

Two comments explain themselves by reference to `Subagent.invocation` and go stale the moment it is gone:

- `src/lifecycle/subagent.ts:97-102` — the `isBackground` doc comment: "so a consumer asks the record rather than re-deriving it from the `invocation` display snapshot, which only the tool door builds."
- `src/ui/agent-widget.ts:166-168` — "It formerly read the `invocation` display snapshot, which only the tool door builds — so every SDK-spawned agent was filtered out permanently (#724)."

Both keep their reason and drop the dangling name: the point is that the mode was re-derived from a **per-call display snapshot the SDK door never built**, and that reason survives the field.
Neither is a behavior change.

### `ADR 0005`'s display-snapshot exclusion class

`docs/decisions/0005-subagent-record-admission-policy.md:52` names the fourth exclusion class by its only instance:

> **display snapshots** (rule 4) — `invocation`, which only the tool door builds.

After this change that class has no live instance, and a reader who greps for `invocation` on the record finds nothing.
The bullet is amended in place to say the field was removed outright by this issue, keeping the rule traceable rather than pointing at a symbol that no longer exists.
The ADR's `status:` and its four rules are untouched.

## Module-Level Changes

Greps run before finalizing this list: `invocation` across `packages/pi-subagents/src`, `packages/pi-subagents/test`, `packages/pi-subagents/docs`, `packages/pi-subagents/README.md`, `packages/pi-subagents-worktrees/`, and `.pi/skills/`; `WorkspacePrepareContext` across `packages/` and `.pi/`.
`README.md:380` ("a per-invocation argument") is unrelated prose.
`.pi/skills/package-pi-subagents/SKILL.md` names `invocation-config.ts` only — a different module — and does not mention the seam field.
`scripts/verify-public-types.sh` references `WorkspacePrepareContext` for a symbol-presence check and a `prepare()` signature annotation; it constructs no context literal, so it needs no edit.
Historical plans and retros that mention the field are left alone.

### Source

| File                                | Change                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/lifecycle/workspace.ts`        | Delete `invocation?: AgentInvocation` from `WorkspacePrepareContext` (`:22`) and the now-unused `AgentInvocation` import (`:15`).                                                                                                                                                                                                                                    |
| `src/lifecycle/subagent.ts`         | Delete `SubagentInit.invocation` (`:83`), the `readonly invocation?: AgentInvocation` field (`:103`), its constructor assignment (`:227`), and `invocation: this.invocation` from the `workspaceBracket.prepare({...})` literal in `run()` (`:268`). Drop `AgentInvocation` from the `#src/types` import (`:22`). Reword the `isBackground` doc comment (`:97-102`). |
| `src/lifecycle/subagent-manager.ts` | Delete `AgentSpawnConfig.invocation` with its doc comment (`:99-100`) and `invocation: options.invocation` from the `new Subagent({...})` literal in `create()` (`:251`). Drop `AgentInvocation` from the `#src/types` import (`:22`).                                                                                                                               |
| `src/tools/background-spawner.ts`   | Delete `invocation: execution.agentInvocation,` from the `manager.spawn({...})` literal (`:43`).                                                                                                                                                                                                                                                                     |
| `src/tools/foreground-runner.ts`    | Delete `invocation: execution.agentInvocation,` from the `manager.spawnAndWait({...})` literal (`:92`).                                                                                                                                                                                                                                                              |
| `src/ui/agent-widget.ts`            | Reword the historical clause in `listBackgroundAgents()`'s doc comment (`:166-168`). Prose only.                                                                                                                                                                                                                                                                     |

`src/types.ts`, `src/tools/spawn-config.ts`, and `src/ui/display.ts` are unchanged: `AgentInvocation` keeps its definition, its local construction, and its display-tag consumer.

### Tests

| File                                                              | Change                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/helpers/make-subagent.ts`                                   | Drop `invocation` from `TestSubagentOptions` (`:30`), the destructure (`:64`), and the `new Subagent({...})` literal (`:84`); drop `AgentInvocation` from the `#src/types` import (`:5`).                                                                                                                                               |
| `test/lifecycle/subagent.test.ts`                                 | Same three edits on the local `MakeSubagentOptions`/`makeSubagent` helper (`:30`, `:42`, `:48`) and the import (`:7`); drop the `expect(record.invocation)` assertion from "passes through optional identity fields" (`:72-79`); replace the seam-context assertion at `:685-694` with the `toStrictEqual` form (see TDD Order step 1). |
| `test/lifecycle/workspace-bracket.test.ts`                        | Drop `invocation: undefined` from the module-level `ctx` literal (`:22`).                                                                                                                                                                                                                                                               |
| `test/service/service-adapter.test.ts`                            | Drop `invocation: { modelName: "haiku" }` from the `createTestSubagent({...})` call (`:67`) and the now-vacuous `expect(result).not.toHaveProperty("invocation")` assertion (`:75`); rename the test to drop "and the invocation display snapshot". The other four `not.toHaveProperty` assertions stay.                                |
| `packages/pi-subagents-worktrees/test/workspace-provider.test.ts` | Drop `invocation: undefined` from the `ctx()` helper's returned literal (`:26`). Hygiene: the literal is not annotated as `WorkspacePrepareContext`, and the package resolves pi-subagents from the registry at `^16.4.0`, so it compiles either way.                                                                                   |

No other test constructs a `WorkspacePrepareContext`, and `service-adapter.test.ts:67` is the only caller that passes `invocation` to `createTestSubagent` (verified across `observation/notification.test.ts`, `observation/composite-subagent-observer.test.ts`, `observation/subagent-events-observer.test.ts`).

### Docs

| File                                                      | Change                                                                                                                                                                               |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `docs/decisions/0005-subagent-record-admission-policy.md` | Amend the display-snapshot bullet (`:52`) to record that `invocation` was removed outright by this issue.                                                                            |
| `docs/architecture/architecture.md`                       | Mark Phase 22 Step 4 `✅` (heading and, if the phase carries one, its Mermaid node) with a `Landed:` note; update the `invocation` storage-chain metric row's target cell to `0 ✅`. |

## Test Impact Analysis

1. **New tests enabled.**
   None — this is a deletion, and it introduces no new unit.
   One existing test is *strengthened*: the seam-context assertion gains real discriminating power (`toStrictEqual` on the recorded call argument) that the `toHaveBeenCalledWith` form measurably did not have.
2. **Tests that become redundant.**
   Two assertions go vacuous and are removed rather than left passing for the wrong reason:
   - `test/service/service-adapter.test.ts:75` — `expect(result).not.toHaveProperty("invocation")` would pass because the source no longer carries the field, not because `toSubagentRecord` strips it.
     The sibling test 20 lines below states this hazard explicitly ("The source really carries all four, so the assertions below are not vacuous"), so leaving it would contradict the file's own standard.
   - `test/lifecycle/subagent.test.ts:73-75` — `expect(record.invocation).toEqual({ modelName: "haiku" })` asserts a field that ceases to exist.
     The surrounding test keeps its other assertions (`abortController`, the zeroed stats).
3. **Tests that must stay as-is.**
   The four remaining `not.toHaveProperty` assertions in `service-adapter.test.ts` (`subagentSession`, `abortController`, `promise`, `execution`, `notification`) — the source genuinely carries those, so they discriminate.
   Every workspace test in `test/lifecycle/workspace-bracket.test.ts` and `test/lifecycle/subagent.test.ts`'s workspace block — they exercise the prepare/dispose bracket, which this change does not touch beyond the context's shape.
   `test/ui/agent-widget.test.ts` § "AgentWidget — background-only filtering" — [#724]'s pin, untouched.

## Invariants at risk

| Invariant                                                                              | Source                                                           | Pinned by                                                                                                                                                  | Exposure                                                                                                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Subagent.isBackground` is first-class record state and the widget filter reads it     | Phase 22 Step 1 `Outcome:` ([#724])                              | `test/ui/agent-widget.test.ts` § "AgentWidget — background-only filtering" (`:331-390`), which drives the widget over stub records carrying `isBackground` | None: this change edits only the doc comment beside the field. The widget test mocks `listAgents`, so it pins the widget's predicate, not the manager's stamping; the manager side is pinned by `test/lifecycle/subagent-manager.test.ts` (`:222-240`) and `test/service/service-adapter.test.ts` (`:393-433`), both untouched. |
| The core hands a registered provider a run-start context and consumes the returned cwd | Phase 16 Step 2 ([#262])                                         | `test/lifecycle/subagent.test.ts` workspace block (`:676-715`) and `test/lifecycle/workspace-bracket.test.ts`                                              | Direct — the context's shape is what changes. Step 1 replaces the shape assertion with a discriminating one rather than merely deleting a key from it.                                                                                                                                                                          |
| `SubagentRecord` withholds display snapshots                                           | `docs/decisions/0005-subagent-record-admission-policy.md` rule 4 | Nothing, after this change: the class's only instance is removed with the field, and its assertion goes vacuous                                            | Accepted and recorded. The rule survives as prose; the amended bullet says the instance was removed rather than implying a live field. A future display-snapshot proposal is answered by the rule, not by a test.                                                                                                               |

Quantitative invariant — the roadmap's grep row, recomputed at planning time:

```bash
grep -rEn 'invocation\??:|\.invocation\b' \
  packages/pi-subagents/src/lifecycle packages/pi-subagents/src/ui/agent-widget.ts \
  --include='*.ts' | wc -l
```

Baseline in the roadmap table is 8; it reads **7** today because Step 1 already removed the widget-filter site.
Predicted after this change: **0**.
No exclusion reconciles against that number — the grep root is `src/lifecycle` plus one UI file, so `spawn-config.ts`'s surviving `agentInvocation: AgentInvocation` (in `src/tools`) is outside it, and the reworded doc comments match neither alternative in the pattern.

## TDD Order

### 1. Remove the field and its storage chain, and strengthen the seam-context pin

Test surface: `test/lifecycle/subagent.test.ts`, `test/lifecycle/workspace-bracket.test.ts`, `test/service/service-adapter.test.ts`, `test/helpers/make-subagent.ts`.

Rewrite the seam-context assertion first, against the current code, so it is red before the production edit:

```typescript
it("calls prepare with exactly the run-start context", async () => {
  const prepare = vi.fn(async () => makeWorkspace("/ws/dir"));
  const agent = createRunnableAgent({ workspaceProvider: { prepare }, baseCwd: "/parent" });
  await agent.run();
  // toStrictEqual, not toHaveBeenCalledWith: the latter compares with toEqual
  // semantics, which ignore an explicitly-undefined key — so it cannot see a
  // vacant field reappearing on the seam context (measured, #828).
  expect(prepare.mock.calls[0][0]).toStrictEqual({
    agentId: "run-1",
    agentType: "general-purpose",
    baseCwd: "/parent",
  });
});
```

A locally declared `vi.fn` is used instead of `makeWorkspaceProvider(...)` so the spy is reachable without a `ReturnType<typeof vi.fn>` cast.

Then apply every source and test edit in the Module-Level Changes tables in the same commit.
TypeScript's excess-property checking forces the pairings anyway (an interface field and the object literal that sets it must move together), and a half-removed chain would leave exactly the stored-and-unread field this issue exists to delete.

Covers: the seam context carries exactly three fields; the record no longer stores a display snapshot; neither tool door passes one.

Killing mutations:

- **Seam shape** — restore `readonly invocation?: AgentInvocation` on `Subagent` and re-add `invocation: this.invocation` to the `prepare({...})` literal in `run()`.
  The new `toStrictEqual` assertion must go red.
  Measured: the pre-change `toHaveBeenCalledWith` form stays **green** under this same mutation, which is why the step replaces it rather than editing a key out of it.
- **Type-only reappearance** — re-add `invocation?: AgentInvocation` to `WorkspacePrepareContext` and nothing else.
  Nothing goes red, and the plan predicts that: `tsc`, `fallow dead-code`, and the full package suite were all measured green on exactly this state.
  The guard is the call-site assertion above, which sees what the core passes, not what the type permits.

Verify: `pnpm --filter @gotgenes/pi-subagents run check`, `pnpm --filter @gotgenes/pi-subagents run lint`, `pnpm --filter @gotgenes/pi-subagents run test`, `pnpm fallow dead-code --workspace @gotgenes/pi-subagents`, `pnpm --filter @gotgenes/pi-subagents run verify:public-types`, and the grep row above returning `0`.

Commit:

```text
refactor(pi-subagents)!: drop the unread invocation field from the workspace seam

BREAKING CHANGE: `WorkspacePrepareContext` no longer carries `invocation`. A
`WorkspaceProvider` that read `ctx.invocation` must drop the read; there is no
replacement field. The value was a UI display snapshot — `modelName` was a
lowercased display string, and `undefined` whenever it matched the parent's
model — so it never carried usable per-call facts. If a provider needs one,
open an issue naming the fact: the seam will grow a purpose-built field
(`isBackground`, `model`, `maxTurns`), not the display snapshot.

Refs #828, #262, #263, #724
```

### 2. Drop the dead fixture key in `pi-subagents-worktrees`

Test surface: `packages/pi-subagents-worktrees/test/workspace-provider.test.ts`.

Delete `invocation: undefined` from the `ctx()` helper's returned literal (`:26`).

Covers: nothing new — this is a fixture that sets a key the provider never reads and that the seam no longer defines.

Killing mutation: none exists, and the plan says so.
The literal is structurally typed and never annotated as `WorkspacePrepareContext`, so no production behavior distinguishes the two states.
This is hygiene, kept out of step 1's breaking commit because it is a second package's test file.

Verify: `pnpm --filter @gotgenes/pi-subagents-worktrees run check` and `pnpm --filter @gotgenes/pi-subagents-worktrees run test` stay green.

Commit: `test(pi-subagents-worktrees): drop the removed invocation key from the prepare fixture (#828)`

### 3. Land the doc updates

Test surface: none.

- Amend `docs/decisions/0005-subagent-record-admission-policy.md:52`'s display-snapshot bullet.
- Mark Phase 22 Step 4 `✅` in `docs/architecture/architecture.md` with a `Landed:` note, and set the `invocation` storage-chain metric row's target cell to `0 ✅`.

Verify: `pnpm exec rumdl check` on both files; re-run the grep row and confirm the recorded number.

Commit: `docs(pi-subagents): record the vacant-seam-field removal (#828)`

Both paths are in `release-please-config.json`'s `exclude-paths`, so this commit cuts no release on its own.

## Risks and Mitigations

| Risk                                                                                   | Mitigation                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The seam-shape assertion is edited into a form that still does not discriminate        | Step 1's first killing mutation is stated as an edit a reader can apply, and the measurement showing the old form's failure is recorded in Design Overview. Apply the mutation and observe red before committing.                                                                                                                                                                                   |
| A half-removed chain lands, leaving a stored-and-unread field                          | Step 1 is one commit by construction. The plan explicitly does **not** rely on `fallow dead-code` to catch a partial removal — that was measured false.                                                                                                                                                                                                                                             |
| The `BREAKING CHANGE:` footer names a remediation that does not exist                  | The footer states outright that there is no replacement field and directs a provider author to file an issue. Every claim in it is verified: `modelName`'s derivation at `spawn-config.ts:120-125`, and the published surface via `pnpm view @gotgenes/pi-subagents version` plus `git show pi-subagents-v20.0.0:packages/pi-subagents/src/lifecycle/workspace.ts` (the field is present at `:22`). |
| The reworded doc comments drop the reason along with the removed name                  | Both rewordings keep the mechanism ("re-derived from a per-call display snapshot the SDK door never built") and its `#724` reference; only the dangling symbol name goes.                                                                                                                                                                                                                           |
| `pnpm run verify:public-types` fails on the regenerated `dist/public.d.ts`             | The script checks symbol presence, not field presence, and `WorkspacePrepareContext` still exports. It is run in step 1's verify list regardless, since this is a public-surface change.                                                                                                                                                                                                            |
| The release ships without joining PR #842, splitting one intended major across two     | The `Release:` marker is `ship now — batch tail`. `/ship-worktree` merges PR #842 after this commit lands; do not merge it before.                                                                                                                                                                                                                                                                  |
| The commit's `refactor!` type is mistaken for non-releasing and the batch is left open | `release-please-config.json` marks `refactor` hidden, but a `BREAKING CHANGE:` footer forces a major regardless. PR #842 is already at 21.0.0 from [#829]'s `fix!`, so this commit updates that PR rather than creating a second one.                                                                                                                                                               |

## Open Questions

- Should the seam eventually carry per-call facts (`isBackground`, `model: Model`, `maxTurns`)?
  Deferred and deliberately not filed: no consumer has named one, and filing a speculative issue re-creates the vacant hook in the tracker instead of the type.
  The `BREAKING CHANGE:` note is the intake path.
- Should `ADR 0005`'s display-snapshot exclusion class keep a live pinning test?
  Not with this change — there is nothing left to pin.
  Revisit if a future field is declined under rule 4; the declining test would land with it.

[#262]: https://github.com/gotgenes/pi-packages/issues/262
[#263]: https://github.com/gotgenes/pi-packages/issues/263
[#724]: https://github.com/gotgenes/pi-packages/issues/724
[#829]: https://github.com/gotgenes/pi-packages/issues/829
