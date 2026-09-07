---
issue: 878
issue_title: "pi-subagents: a released session's question affordance names a resume that will be refused"
---

# Stop advertising a resume that will be refused

## Release Recommendation

**Release:** ship independently

Phase 22 Step 15 carries `Release: independent`, and the issue appears in no `Release: batch` subsection.
The change lands as a `fix:` on the agent-visible text of four result carriers, so it cuts a patch on its own.

## Problem Statement

A child that ends its turn with a question keeps `pendingQuestion` on its record for the record's whole life.
Only `resetForResume()` (an actual resume) and `clearPendingQuestion()` (`failRun`/`failResume`) clear it.

`renderQuestionAffordance(agentId, question)` derives the entire call to action from that one field:

```text
This agent is waiting on an answer:

  <the question>

Answer by calling subagent with resume: "<id>" and your answer as the prompt.
```

`AgentTool`'s resume branch refuses that exact call on three record-level facts the renderer never sees.
The parent is told to make a call the same extension is guaranteed to decline.

The issue names the retention sweep as the trigger.
It is not the only one, and it is not the fastest.
`Subagent.completeRun()` computes `holdForResume = finalStatus === "completed" && this.pendingQuestion !== undefined`, so a child that ended with a question and was **aborted** or **steered** has its workspace disposed at run end — while `clearPendingQuestion()` deliberately leaves that child's question set ("An aborted or steered run keeps its question").
For such a child under a registered `WorkspaceProvider`, the completion nudge and the foreground return advertise a refused resume within milliseconds of the run ending, with no sweep involved.

## Goals

- No result carrier names a `resume` call that `AgentTool` would refuse.
- When a resume is unavailable, the child's question is still reported, with a reason and an action that is still possible.
- The three refusal facts are decided in one place that both the tool and the carriers read, so a fourth refusal cannot drift the affordance again.
- Not breaking: the affordance text is unchanged for every record that is genuinely resumable, and no public type loses a field or changes an existing field's type.

## Non-Goals

- **Refusing a resume of a still-running agent.**
  `SubagentManager.resume` guards on `isSessionReady()` alone, so a resume during the window between `ask_parent` and the child's turn ending is *accepted* and starts a second turn loop on the live session.
  That is a door defect, not an affordance defect: this change's predicate leaves such a record resumable, and the affordance keeps naming the resume.
  Filed as [#896] and folded into Step 16 ([#885]), which relocates the whole refusal policy to `SubagentManager`.
- **Clearing `pendingQuestion` when a resume stops being possible.**
  Considered and rejected in Design Overview; it also perturbs `resolveRetentionWindow`, which reads the field.
- **Moving `AgentTool`'s refusal *messages* to the choke point.**
  Step 16 ([#885]) owns that.
  This change moves the *decision* only; the four operator-facing sentences stay where they are, byte-for-byte.
- **Adding resumability to the public `SubagentRecord`.**
  [ADR 0005](../decisions/0005-subagent-record-admission-policy.md) governs that surface, and no consumer has asked.
- **`renderOutcomeBody`'s empty-string guard and the running-status body** — Step 17 ([#889]).

## Background

### The four carriers

| Carrier                      | Site                                  | Shape passed to the renderer                                        |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------------- |
| `get_subagent_result` report | `src/tools/get-result-report.ts:71`   | `AgentReport` (a plain object built by `GetResultTool.buildReport`) |
| Completion nudge             | `src/observation/notification.ts:406` | the live `Subagent`, via `buildPointerLines`                        |
| Resume return                | `src/tools/agent-tool.ts:132`         | the live `Subagent`, straight into `renderOutcomeAddenda`           |
| Foreground return            | `src/tools/foreground-runner.ts:144`  | the live `Subagent`, straight into `renderOutcomeAddenda`           |

`OutcomeAddenda`'s doc comment records why it is a structural shape rather than a record type: "both `Subagent` and `AgentReport` satisfy this structurally."
That constraint is why the new fact must reach the record as a **getter**, not a method — a method would not satisfy a field.

### The three refusals

`AgentTool.execute`'s resume branch, in order:

| Order | Condition                               | Message                                                                                    |
| ----- | --------------------------------------- | ------------------------------------------------------------------------------------------ |
| 1     | `!existing`                             | `Agent not found: "<id>". Records are cleared at session start/switch…`                    |
| 2     | `!isSessionReady() && sessionReleased`  | `Agent "<id>" had its session released after its retention window; resume is unavailable…` |
| 3     | `!isSessionReady() && !sessionReleased` | `Agent "<id>" has no active session to resume.`                                            |
| 4     | `workspaceDisposed`                     | `Agent "<id>" ran in an isolated workspace that no longer exists…`                         |

Refusal 1 is a manager-level fact (there is no record), so it stays in `AgentTool`.
Refusals 2–4 are facts of the record and are the ones the affordance must learn.

Refusal 3 is unreachable in production with a question set — the only way to have `pendingQuestion` without ever having had a session is a factory failure, and `failRun` clears the field — but the predicate still reports it, so the affordance fails closed rather than falling through to "resumable".

### Constraints from `AGENTS.md` and the package skill

- `outcome-delivery.ts` is documented as "Pure functions only: no SDK types, no record types."
  It already imports the `SubagentStatus` string union from `#src/lifecycle/subagent-state`; importing a second string union from the lifecycle layer keeps that rule.
- Display glyphs are not involved; the affordance is plain prose.
- The tsconfig sets no `exactOptionalPropertyTypes`, so a **required** `resumeRefusal: ResumeRefusal | undefined` forces the key to be present at every construction site while `resumeRefusal?: ResumeRefusal` would not.

## Design Overview

### The predicate

`Subagent` gains one getter, composing the three facts in `AgentTool`'s own check order:

```typescript
/** Why a resume would be refused. Undefined when one would be accepted. */
export type ResumeRefusal = "no-session" | "session-released" | "workspace-disposed";

// on class Subagent
get resumeRefusal(): ResumeRefusal | undefined {
	if (!this.isSessionReady()) return this._sessionReleased ? "session-released" : "no-session";
	if (this.workspaceDisposed) return "workspace-disposed";
	return undefined;
}
```

A getter rather than a method, so the live record structurally satisfies the carriers' field.
It sits beside `sessionReleased` and `workspaceDisposed` — the two adjective-getters it composes — rather than beside the `isX()` predicates, which is also the naming shape a reader will look for.

`AgentTool`'s three inline guards become one exhaustive switch over it, each arm returning today's message verbatim:

```typescript
const refusal = existing.resumeRefusal;
if (refusal) return textResult(resumeRefusalMessage(refusal, params.resume as string));
```

That is the whole of the "one home" change.
The messages themselves stay in `agent-tool.ts` for Step 16 to relocate.

### The affordance

`renderQuestionAffordance` gains a third parameter and keeps its existing text on the `undefined` branch:

```typescript
export function renderQuestionAffordance(
	agentId: string,
	question: string | undefined,
	refusal: ResumeRefusal | undefined,
): string
```

Resumable (byte-identical to today):

```text
This agent is waiting on an answer:

  Which config?

Answer by calling subagent with resume: "agent-7" and your answer as the prompt.
```

Not resumable:

```text
This agent ended its run with a question that can no longer be answered — its session was released after its retention window:

  Which config?

Spawn a new agent with the context it needs; this one cannot be resumed.
```

The clause after the dash is chosen per reason:

| `ResumeRefusal`      | Clause                                                        |
| -------------------- | ------------------------------------------------------------- |
| `session-released`   | `its session was released after its retention window`         |
| `workspace-disposed` | `it ran in an isolated workspace that has since been removed` |
| `no-session`         | `it has no session to resume`                                 |

The clauses echo `AgentTool`'s refusal sentences without sharing a string with them, for the same reason `STATUS_MEANINGS` splits `label` from `detail`: a standalone refusal sentence and a mid-sentence subordinate clause are different grammar, not different facts.
They live in this module as a `Record<ResumeRefusal, string>` beside `STATUS_MEANINGS`, which is the established shape for a per-variant vocabulary here.

### Threading it to the carriers

`OutcomeAddenda` and `AgentReport` each gain a **required** field:

```typescript
export interface OutcomeAddenda {
	id: string;
	runUpdates?: readonly string[];
	workspaceNotice?: string;
	pendingQuestion?: string;
	/** Why a resume would be refused; undefined when one would be accepted. */
	resumeRefusal: ResumeRefusal | undefined;
}
```

Required, not optional, so a carrier that forgets it fails `tsc` rather than silently re-advertising the resume — the fail-open shape this issue is about.
The two carriers that pass the live `Subagent` need no call-site change: the getter satisfies the required field structurally (verified against `agent-tool.ts:132` and `foreground-runner.ts:144` in the Tidy-First assessment).
`GetResultTool.buildReport` sets `resumeRefusal: record.resumeRefusal` beside the `pendingQuestion` line it already writes.
`NotificationManager.buildPointerLines` passes `record.resumeRefusal` as the third argument.

### Rejected: clearing `pendingQuestion`

The issue's framing ("nothing clears it except…") suggests clearing the field at `releaseSession()`.
Three reasons not to:

1. It fixes one of the two live paths.
   `workspaceDisposed` is reached with the session still alive, so a release-time clear leaves the aborted/steered case advertising a refused resume.
2. It erases the question from `get_subagent_result` and from the public `SubagentRecord.pendingQuestion`.
   The parent would not learn the child asked anything — strictly less information than today.
3. `resolveRetentionWindow` reads `pendingQuestion` to hold a record on the long window ("A record carrying an unanswered question is not collected").
   Clearing it inside the release path is harmless there, but the rule becomes one a later reader has to re-derive.

### Rejected: a boolean instead of a reason

A `resumable: boolean` getter is a smaller diff, but `AgentTool` would keep deriving its own three-way split, leaving the rule in two places — the shape that produced this bug.
The reason union costs one string-literal type and pays for the reason-specific clause the operator chose.

## Module-Level Changes

### `src/lifecycle/subagent.ts`

- Add the exported `ResumeRefusal` string-union type.
- Add `get resumeRefusal(): ResumeRefusal | undefined`, composing `isSessionReady()`, `sessionReleased`, and `workspaceDisposed`.
  Its doc comment names why the order matches `AgentTool`'s and that it is a getter so carriers satisfy the field structurally.

### `src/observation/outcome-delivery.ts`

- Import `ResumeRefusal`.
- Add `RESUME_REFUSAL_CLAUSES: Record<ResumeRefusal, string>` beside `STATUS_MEANINGS`.
- `renderQuestionAffordance` gains the third parameter and the second text branch; update its doc comment, which currently says "Takes the id and question rather than a record: the two facts it needs".
- `OutcomeAddenda` gains required `resumeRefusal: ResumeRefusal | undefined`; `renderOutcomeAddenda` passes it through.
- Update the module doc comment's addenda-tail sentence, which describes "the ask-back affordance".

### `src/tools/agent-tool.ts`

- Replace the three inline guards with a switch over `existing.resumeRefusal`, delegating to a module-private `resumeRefusalMessage(refusal, id)` that returns today's three strings unchanged.
- The `Agent not found` guard is untouched and stays first.

### `src/tools/get-result-report.ts`

- `AgentReport` gains required `resumeRefusal: ResumeRefusal | undefined`.

### `src/tools/get-result-tool.ts`

- `buildReport` sets `resumeRefusal: record.resumeRefusal`.

### `src/observation/notification.ts`

- `buildPointerLines` passes `record.resumeRefusal` to `renderQuestionAffordance`.

### `src/tools/foreground-runner.ts` — no change

Verified: it passes the live record into `renderOutcomeAddenda(record)`, which the getter satisfies.
Listed here because the design's claim about it must be re-checked at implementation time, not because an edit is expected.

### Tests

- `test/helpers/make-subagent.ts` — `TestSubagentOptions` gains `sessionReady?: boolean` (default `false`), assigning a stub session post-construction when true.
- `test/helpers/make-subagent.test.ts` — a case for the new option.
- `test/tools/agent-tool.test.ts`, `test/tools/foreground-runner.test.ts`, `test/observation/notification.test.ts` — the three `pendingQuestion` fixtures that assert the actionable affordance opt into `sessionReady: true`, then gain refusal-path siblings.
- `test/observation/outcome-delivery.test.ts` — `makeAddenda` gains the required field; new cases per refusal reason.
- `test/tools/get-result-report.test.ts` — `makeReport` gains the required field; new refusal case.
- `test/tools/get-result-tool.test.ts` — a case pinning that `buildReport` forwards the record's refusal.
- `test/lifecycle/subagent.test.ts` — a new `describe("Subagent — resumeRefusal", …)` block, sibling to the existing `workspaceDisposed` and `releaseSession` blocks.

### Docs

- `README.md:26` — "every result surfaces the question with the exact `resume` call that answers it" is no longer true for a child whose session or workspace is gone.
  Reword to say the result surfaces the question, with the `resume` call when one is still possible and why it is not when it is not.
- `docs/configuration.md:165` — "so the delegating agent can answer by resuming it" gains the same qualifier.
- `docs/architecture/architecture.md:364` — the `subagent.ts` module-tree entry gains that the record answers whether a resume would be refused.
  This is an active structural constraint (four carriers and the tool read it), so it earns its place in the tree per the architecture-doc convention.
- `docs/architecture/architecture.md:378` — the `outcome-delivery.ts` entry's "ask-back affordance" clause.
- `docs/architecture/architecture.md` Step 15 — the `✅` heading mark, the Mermaid node, and the `Landed:` note.
- `.pi/skills/package-pi-subagents/SKILL.md` — grepped for the affordance and its wording; the only `ask_parent` sentence describes the tool's own behavior ("records the child's question, then it ends its turn") and makes no claim about the resume advertisement, so no edit.

## Test Impact Analysis

**New tests the change enables.**
`resumeRefusal` is the first place the three refusal facts are composed into one value, so it is unit-testable in `subagent.test.ts` against real state (a released session, a disposed workspace) rather than only through `AgentTool`'s tool-result strings.
The affordance's two branches become testable in `outcome-delivery.test.ts` without any record at all.

**Tests that become redundant.**
None are removed.
`agent-tool.test.ts`'s three existing refusal-message tests (released session, no session, disposed workspace) stay exactly as they are: they now pin that the switch's arms still return the right sentence, which is the regression the refactor could introduce.

**Tests that must stay as-is.**
The four carrier tests asserting `'resume: "<id>"'` are the pin for the unchanged resumable branch.
They must keep asserting the actionable text — with `sessionReady: true` supplying the state that makes it true — because a mutation that renders the refusal text unconditionally has to turn them red.

**The input domain.**
The affordance's inputs are the cross product of `question` (absent, empty, single-line, multi-line) and `refusal` (four values).
The empty-question early return dominates the refusal, so the refusal branches only need the non-empty cases; the multi-line indent is shared by both branches and is asserted once per branch.

## Invariants at Risk

| Invariant                                                                            | Established by               | Pinned by                                                                                                                                 | Risk here                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The addenda tail renders in one fixed order: updates → workspace notice → affordance | Step 14 ([#872])             | `outcome-delivery.test.ts` — "puts where the work went before the call to action" and "composes the same text the carriers built by hand" | The second test re-composes the tail by hand and must gain the new argument, or it silently stops comparing what it claims to                                                             |
| Every result carrier surfaces a declared question with the exact `resume` call       | Step 8 ([#465])              | the four carrier tests asserting `'resume: "<id>"'`                                                                                       | Directly narrowed by this change — the invariant now holds only for a resumable record, which is why those four fixtures must be made resumable rather than have their assertions relaxed |
| A record carrying an unanswered question is held on the long retention window        | Step 11 ([#858])'s sweep fix | `subagent-manager.test.ts:1469,1478` (`resolveRetentionWindow` rows with `pendingQuestion` set)                                           | Preserved by construction: this change does not touch `pendingQuestion`. The rejected clear-the-field design would have touched it                                                        |
| A question-ending child holds its workspace for the resume it invites                | Step 10 ([#857])             | `subagent.test.ts` `workspaceDisposed` block                                                                                              | Untouched; the change reads `workspaceDisposed`, never sets it                                                                                                                            |

Each of these was opened and read, not inferred from the roadmap's `Outcome:` lines.

## TDD Order

Steps 1 and 2 are the Tidy-First preparation.

1. **`test:` add a ready-session option to `createTestSubagent`.**
   *Friction it prepares:* every fixture the helper builds has `subagentSession === undefined`, so once `resumeRefusal` exists they all read `"no-session"`; the later steps need a one-flag way to say "resumable" in three test files, two of which (`foreground-runner.test.ts`, `notification.test.ts`) import no mock-session helper today.
   *Surface:* `test/helpers/make-subagent.ts`, `test/helpers/make-subagent.test.ts`.
   *Covers:* `sessionReady: true` yields `isSessionReady() === true`; the default stays `false`.
   *Killing mutation:* make the option assign nothing — the new helper test goes red while every existing test stays green.
   *Commit:* `test(pi-subagents): add a ready-session option to createTestSubagent`.

2. **`test:` opt the three affordance fixtures into `sessionReady`.**
   *Friction it prepares:* isolates the fixture repair from the behavior change, so step 5 does not have to explain three failures in files it is not otherwise touching.
   *Surface:* `test/tools/agent-tool.test.ts` (~~211), `test/tools/foreground-runner.test.ts` ~~:34), `test/observation/notification.test.ts` (~:264).
   *Covers:* nothing new — a no-op today, green before and after.
   *Killing mutation:* none applies; this step adds no assertion.
   Verification is that the suite stays at its current count and the three tests still assert `'resume: "<id>"'`.
   *Commit:* `test(pi-subagents): make the affordance fixtures session-ready`.

3. **`refactor:` add `Subagent.resumeRefusal`.**
   *Surface:* `test/lifecycle/subagent.test.ts`, new `describe("Subagent — resumeRefusal", …)`.
   *Covers:* four equivalence classes — a record with a live session and no disposed workspace (`undefined`); a record whose session was never created (`"no-session"`); a record after `releaseSession()` (`"session-released"`); a record whose workspace the bracket disposed while its session is still live (`"workspace-disposed"`).
   Drive each through real state (assign a session stub, `await releaseSession()`, run with a stub provider), never by seeding the union value.
   *Killing mutations:* (a) return `undefined` unconditionally — all three refusal cases go red, the resumable case stays green; (b) drop the `workspaceDisposed` arm — only the workspace case goes red; (c) swap the `sessionReleased` ternary's branches — the released and never-created cases swap and both go red.
   *Commit:* `refactor(pi-subagents): answer resumability from the subagent record`.
   Typed `refactor:` because nothing observable changes yet — no carrier reads it in this commit.

4. **`refactor:` read the refusal from the record in `AgentTool`.**
   *Surface:* `test/tools/agent-tool.test.ts` — the three existing refusal-message tests, unchanged, plus the existing successful-resume tests.
   *Covers:* the switch returns each of the three messages verbatim, and a resumable record still resumes.
   *Killing mutations:* (a) drop the `"workspace-disposed"` arm so the switch falls through to the resume — the disposed-workspace test goes red; (b) return the released-session message from the `"no-session"` arm — the no-session test goes red.
   *Commit:* `refactor(pi-subagents): switch the resume refusal on one record predicate`.

5. **`fix:` stop advertising a resume that will be refused.**
   The mechanism and its whole set of call sites land together: `renderQuestionAffordance`'s third parameter, `RESUME_REFUSAL_CLAUSES`, the required field on `OutcomeAddenda` and `AgentReport`, `buildReport`, and `buildPointerLines`.
   They cannot split — making the field required breaks `tsc` at every construction site in the same commit.
   *Surface:* `test/observation/outcome-delivery.test.ts`, `test/tools/get-result-report.test.ts`, `test/tools/get-result-tool.test.ts`, `test/observation/notification.test.ts`, `test/tools/agent-tool.test.ts`, `test/tools/foreground-runner.test.ts`.
   *Covers:* the resumable branch is byte-identical to today (assert the full string, not a substring); one case per refusal reason asserting the question survives, the reason clause is present, and the text contains no `resume:` call; the tail's fixed order still holds with the refusal branch rendering; `buildReport` forwards the record's refusal; the nudge renders the refusal form for a record whose workspace was disposed.
   *Killing mutations:* (a) ignore the third parameter and always render today's text — every refusal case goes red across all four carriers, and the resumable cases stay green; (b) render the refusal form unconditionally — the four `'resume: "<id>"'` carrier tests go red; (c) have `buildReport` hard-code `resumeRefusal: undefined` — only the `get-result-tool` forwarding test and the report's refusal case go red, which is what distinguishes "the renderer works" from "the carrier supplies the fact"; (d) drop the `resumeRefusal` argument from `buildPointerLines`' call — only the nudge's refusal case goes red.
   *Commit:* `fix(pi-subagents): report an unanswerable question without naming a resume`.

6. **`docs:` update the surfaces that promise the resume.**
   *Surface:* `README.md`, `docs/configuration.md`, `docs/architecture/architecture.md` (two module-tree entries, the Step 15 `✅` mark, the Mermaid node, and the `Landed:` note).
   *Verification:* `pnpm exec rumdl check` on each edited file, and a grep for the old promise wording returning nothing.
   *Commit:* `docs(pi-subagents): record what a result promises about resuming`.

## Risks and Mitigations

| Risk                                                                                                    | Mitigation                                                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Making the field **required** turns out to break a construction site the design did not enumerate       | This is the intended failure mode — `tsc` names every site. The Tidy-First assessment already walked the four carriers and both object factories; step 5 folds them all into one commit precisely because the type change is atomic                  |
| The resumable branch drifts by a byte and every downstream assertion that used `toContain` still passes | Step 5's resumable case asserts the **full** string with `toBe`, as `outcome-delivery.test.ts`'s existing affordance test already does                                                                                                               |
| `resumeRefusal` and `AgentTool`'s message set drift apart when Step 16 adds a fifth refusal             | The exhaustive switch is the guard: a new union member makes `resumeRefusalMessage` fail to compile. Verify at implementation time that the switch is exhaustive over the union rather than defaulting                                               |
| The nudge's refusal path is asserted against a fixture rather than a real disposal                      | Step 3 drives `"workspace-disposed"` through a real `WorkspaceBracket` disposal, and step 5's nudge case reuses that construction rather than a seeded value                                                                                         |
| A carrier is added later and forgets the fact                                                           | The required field covers any carrier composing `OutcomeAddenda`. A carrier calling `renderQuestionAffordance` directly (as `notification.ts` does) is not covered by the type — the third parameter being required, not optional, is what covers it |

## Open Questions

- Should the refusal form also name the transcript path?
  `get_subagent_result` and the nudge already print it a few lines above, so repeating it would be noise there; the foreground and resume returns do not.
  Deferred until a carrier is observed where the parent has no pointer at all.

[#465]: https://github.com/gotgenes/pi-packages/issues/465
[#857]: https://github.com/gotgenes/pi-packages/issues/857
[#858]: https://github.com/gotgenes/pi-packages/issues/858
[#872]: https://github.com/gotgenes/pi-packages/issues/872
[#885]: https://github.com/gotgenes/pi-packages/issues/885
[#889]: https://github.com/gotgenes/pi-packages/issues/889
[#896]: https://github.com/gotgenes/pi-packages/issues/896
