---
issue: 899
issue_title: "pi-permission-system: an ask on an earlier gate pre-empts an unconditional deny on a later one"
---

# A deny on any gate is decided without a prompt

## Release Recommendation

**Release:** ship independently

This issue is not a numbered step of Phase 15 — it appears in the roadmap's `#### Open-issue sweep dispositions` list, which carries no `Release:` tag, so no batch claims it.
The behavior step is a `fix:`, which cuts a patch release on its own.

## Problem Statement

`ToolCallGatePipeline.evaluate` runs six gate producers in a fixed order and short-circuits only on a `block` outcome.
An `ask` on an earlier gate suspends the tool call and escalates to the user **before** a later gate's unconditional `deny` is ever consulted.
The operator is therefore asked to approve a command the policy already forbids, and both answers end in denial — the prompt cannot change the outcome.

In a subagent the prompt is forwarded to the parent, so an unanswered one costs the full `forwardingTimeoutMs` (ten minutes by default) before the child continues.
The denial that eventually lands is attributed to the wrong rule: `resolution: "confirmation_unavailable"` on `external_directory`, rather than the `bash` rule that actually decided.

## Goals

- A tool call that any gate resolves to an unconditional `deny` is blocked without escalating to a human or a forwarded parent.
- The resulting denial names the rule that caused it — the deciding gate's own surface, matched pattern, and deny reason.
- No tool call that runs today stops running.
- The change is **not** breaking: it removes a prompt and changes a refusal's attribution, never a config's meaning or a default.

## Non-Goals

- **Coalescing multiple `ask` gates into one prompt.**
  Two gates that each resolve to `ask` still raise one prompt each, measured as two `escalate` calls for `cat /etc/hosts` under `external_directory: {"*": "ask"}` plus `bash: {"*": "ask"}`.
  Filed as [#915] and deferred to a later phase.
  Dropping the second ask would let one surface's answer stand in for another surface's distinct question, which is the cross-surface interaction ADR 0013 §4 exists to avoid; the right shape coalesces rather than drops, and needs a composing `PromptPayload` plus a multi-surface `SessionApproval`.
- **Splitting `GateRunner.runDescriptor` into phases.**
  The roadmap's `#### Deferred tidyings swept` list holds that split as deferred on the scout's re-adjudication, and it stays deferred.
  Step 1 below extracts one small reader from it; it does not perform that split.
- **Any change to the six gate producers or to `applyPermissionGate`.**
  Each gate already resolves its own state; the defect is the order in which the pipeline consumes them.
- **Recording a trace of the suppressed ask.**
  Decided with the operator: the blocked review entry already names the deciding surface, rule pattern, and reason, and a gate skipped after a block leaves no trace today either.
- **Amending ADR 0013.**
  Decided with the operator: §5 already states that most-restrictive composition between the layers is "the correct consequence of that difference rather than an arbitrary precedence rule", so the change implements the recorded model rather than revising it.
  The user-facing half of the rule is documented instead (Step 4).

## Background

### The pipeline today

`ToolCallGatePipeline.evaluate` (`src/handlers/gates/tool-call-gate-pipeline.ts`) builds six lazy gate producers and runs them in this order:

1. `describeSkillReadGate`
2. `describePathGate`
3. `describeExternalDirectoryGate`
4. `describeBashExternalDirectoryGate`
5. `describeBashPathGate`
6. `describeToolGate` — the only gate that consults the `bash` command patterns, via `resolvePerToolCheck` → `resolveBashCommandCheck`

```typescript
for (const produce of gateProducers) {
  const outcome = await runner.run(await produce(), tcc.agentName);
  if (outcome.action === "block") {
    return outcome;
  }
}
```

`GateRunner.run` resolves a descriptor through the session fast path, the yolo fast path, and then `applyPermissionGate`, whose `ask` arm awaits `promptForApproval()`.
An `ask` at gate 4 therefore suspends inside the loop; approving it returns `{ action: "allow" }` and the loop proceeds to gate 6, which denies.

### The issue's diagnosis needs one correction

The issue says the fix must hoist the permission resolve out of `GateRunner.runDescriptor`, and calls that "the bulk of the work".
It is already hoisted.
Every gate carries its resolved state on the descriptor before the runner sees it:

| Gate                                | Field                    | Source                                           |
| ----------------------------------- | ------------------------ | ------------------------------------------------ |
| `describeSkillReadGate`             | `preResolved: { state }` | the matched skill entry                          |
| `describePathGate`                  | `preCheck`               | `resolver.resolve` on the `path` family          |
| `describeExternalDirectoryGate`     | `preCheck`               | `resolveExternalDirectoryPolicy`                 |
| `describeBashExternalDirectoryGate` | `preCheck`               | worst uncovered external path                    |
| `describeBashPathGate`              | `preCheck`               | worst uncovered token                            |
| `describeToolGate`                  | `preCheck`               | stamped by `resolvePerToolCheck` in the pipeline |

`runDescriptor`'s third branch — `this.resolver.resolve(...)` — is unreachable from this pipeline.
It is still reachable from `SkillInputGatePipeline` in principle and is exercised directly by `runner.test.ts`, so it stays.

The consequence is that `runner.ts` needs no restructuring, which removes the roadmap's stated reason for deferring this issue (that it wanted to move together with the deferred `runDescriptor` split).

### The model already says most-restrictive-wins across surfaces

`docs/configuration.md` teaches that the four layers compose with most-restrictive-wins, and ADR 0013 §5 states that composition between the boundary rule and the pattern surfaces "is the correct consequence of that difference rather than an arbitrary precedence rule".
Both illustrate the rule only with `ask` beating `allow`.
The pipeline implements that half — an unapproved `ask` blocks — and not the `deny` beating `ask` half.
`pickMostRestrictive` (`src/policy/restrictiveness.ts`) already applies the full `deny > ask > allow` ordering *within* a surface, which is what [#301] fixed for a chained bash command.

ADR 0013 §4's caution about cross-surface interaction is about bare-family sugar introducing no *new* surface to reason about; it does not reach this ordering, and no surface's resolved value changes here.

### Constraints from AGENTS.md that apply

- Default to least privilege — the change may only remove prompts that cannot change an outcome, never grant anything.
- The gate fails closed; `createFailClosedToolCall` stays the sole `tool_call` target.
- A `fix:` commit cuts a release, so the docs step must not claim a version number.

## Design Overview

### The rule

Produce all six gate results first, then run them in a **deny-first** order: any gate whose descriptor resolves to an unconditional `deny` runs ahead of the rest, and the remainder never runs because that gate blocks.

This is option B of the three the operator weighed.
It runs **only** the denying gate, so a call pre-empted by a deny records the denial and nothing else — no `policy_allow` decision event from a gate whose answer had no consequence, and no `session_approved` or `auto_approved` line from a gate that never got to matter.

Eager production is not a regression: today's loop already produces every gate unless one blocks, so the only calls that newly pay for producing gates 2–6 are the ones an earlier gate denies.
Gate production is side-effect-free (resolver reads plus, for the bash path gate, the existing bare-token `lstat` probe); all logging and event emission happens inside `runner.run`.

### Why a deny may pre-empt and an ask may not

`deny` is absorbing: wherever it sits in the order, the call is refused, so no other gate's answer can change the outcome.
Skipping a moot question is an ordering change.

`ask` is not absorbing.
Two asking gates ask two different questions — *may this cross the working-directory boundary* and *may this command run* — and answering one does not answer the other.
That is [#915], and it is deliberately out of scope.

### The predicate

```typescript
/** The check a descriptor already carries, or null when it resolves nothing. */
export function preResolvedCheckOf(
  descriptor: GateDescriptor,
): PermissionCheckResult | null;

/** Whether this gate blocks without any escalation, whatever else the pipeline finds. */
export function isUnconditionalDeny(gate: GateResult): boolean;
```

`isUnconditionalDeny` is subordinate to `GateRunner.runDescriptor`'s own precedence, which tests `check.source === "session"` **before** it reaches `applyPermissionGate`.
A session-sourced check therefore is not a pre-emptive deny even if its state were `deny`, because the runner would allow it.
`SessionRules` records only `action: "allow"`, so that combination is unreachable today; the clause is kept because it makes the predicate correct on its own terms rather than correct by way of a distant invariant, and it errs toward today's behavior (it declines to pre-empt).

Yolo needs no clause: `resolveYoloGrant` matches only an `allow` of origin `yolo` and an `ask`, so a `deny` survives yolo exactly as it does today.

### The call site

```typescript
const gates: GateResult[] = [];
for (const produce of gateProducers) {
  gates.push(await produce());
}

for (const gate of orderDenyFirst(gates)) {
  const outcome = await runner.run(gate, tcc.agentName);
  if (outcome.action === "block") {
    return outcome;
  }
}

return { action: "allow" };
```

`orderDenyFirst` is a stable partition: denying gates keep their relative order, then everything else keeps its relative order.
Stability is what preserves today's behavior when two gates deny — the earlier one still decides — and when none does, the array is returned unchanged.

### Why a shared reader rather than a mirrored one

`isUnconditionalDeny` needs to know the state a descriptor already carries, which is the same question `runDescriptor`'s first two branches answer.
Writing it twice would make the predicate correct only as long as someone remembers to mirror a change in `runner.ts`.
Step 1 therefore extracts `preResolvedCheckOf` from `runDescriptor` and has both read it, collapsing `runDescriptor`'s three-branch block into:

```typescript
const check =
  preResolvedCheckOf(descriptor) ??
  this.resolver.resolve({
    kind: "tool",
    surface: descriptor.surface,
    input: descriptor.input,
    agentName: agentName ?? undefined,
  });
```

`??` short-circuits, so the resolver is still consulted only when neither field is present.
The `preResolved` branch's synthesis of `{ toolName: descriptor.surface, source: "tool", origin: "builtin" }` moves into the shared function unchanged.

The Tidy-First assessor rejected this extraction as scope creep, on the ground that the design summary it was given declared `runner.ts` out of scope.
That boundary was the planning agent's own premise rather than a decision, and the assessor's reasoning otherwise agrees the duplication is real ("a shared function is the textbook fix for 'must mirror'"), so it is adopted here as Step 1.
It is a pure, behavior-preserving move of roughly ten lines, and `runner.test.ts` already exercises all three branches.

### Measured behavior

Spiked at `82864e50`'s parent tree, driving `PermissionGateHandler.handleToolCall` through `makeHandler` with the issue's literal command and a policy of `bash: { "find / *": deny, "*": allow }` plus `external_directory: { "*": "ask" }`:

|        | `escalate` calls | Outcome                                                  |
| ------ | ---------------- | -------------------------------------------------------- |
| Before | 1 (measured)     | `block` — `Denied by policy: 'bash' … (rule 'find / *')` |
| After  | 0 (measured)     | `block` — identical reason                               |

Full existing suite under the spike: **4156 of 4157 pass (measured)**; the single failure is the one named in Module-Level Changes below, and it is an assertion about a record this design deliberately stops writing.

### What can and cannot change for a user

The change can only produce two transitions:

- *prompt, then policy denial* → *policy denial* — the issue's case.
- *prompt, human declines, `user_denied`* → *policy denial, `policy_denied`* — the refusal sentence and review-log resolution change; the outcome does not.

It cannot turn an allow into a deny, because a `deny` already blocks wherever it sits today and no gate's resolved value changes.

One knock-on is worth stating: today, approving a doomed ask "for this session" records a session grant that outlives the denied call, so a later command can be covered by a grant the user gave for a command that never ran.
After the change no such grant is recorded, so that later command prompts.
This is strictly more restrictive and is not a regression.

## Module-Level Changes

### Source

- `src/handlers/gates/descriptor.ts` — **add** `preResolvedCheckOf(descriptor)` and `isUnconditionalDeny(gate)`, plus an `orderDenyFirst(gates)` stable partition.
  `isUnconditionalDeny` and `orderDenyFirst` are not type guards, so they go under their own section heading rather than into `// ── Type guard helpers ──`.
  Imports gain `PermissionCheckResult` from `#src/types` (already imported for `preCheck`).
- `src/handlers/gates/runner.ts` — `runDescriptor`'s three-branch check resolution becomes `preResolvedCheckOf(descriptor) ?? this.resolver.resolve(...)`.
  No other change; the session fast path, yolo fast path, and `applyPermissionGate` call are untouched.
- `src/handlers/gates/tool-call-gate-pipeline.ts` — `evaluate` produces all gate results into an array, then runs `orderDenyFirst(gates)`.
  The `gateProducers` array itself, `resolvePerToolCheck`, the single `BashProgram.parse`, and the `ToolPreviewFormatter` construction are unchanged.

Nothing is removed or renamed, so no export grep is required.
`descriptor.preCheck` and `descriptor.preResolved` keep their shapes and remain read by tests (`path.test.ts`, `bash-external-directory.test.ts`, `bash-path.test.ts`).

### Predicted unchanged, with the claim each rests on

- `src/policy/permission-gate.ts` — the deny arm already writes `permission_request.blocked` with `resolution: "policy_denied"` and `decidedBy: decidedByRule`, which is exactly the attribution the issue asks for.
- All six gate producers (`skill-read.ts`, `path.ts`, `external-directory.ts`, `bash-external-directory.ts`, `bash-path.ts`, `tool.ts`) — each already resolves its own state onto the descriptor; the change reads those fields and writes none.
- `src/handlers/gates/skill-input-gate-pipeline.ts` — a single-gate pipeline, so there is no ordering to fix.
- `src/handlers/permission-gate-handler.ts` and `src/handlers/tool-call-boundary.ts` — `evaluate`'s `GateOutcome` return type is unchanged.
- `src/handlers/gates/helpers.ts` — `resolveYoloGrant` is unchanged; the predicate does not consult it because yolo cannot rewrite a `deny`.

### Tests

- `test/helpers/gate-fixtures.ts` — **add** `makeSurfaceDenyingResolver(surface, overrides?)`, generalizing the local `pathDenyingResolver()` closure currently at `test/handlers/gates/tool-call-gate-pipeline.test.ts` line ~369.
- `test/handlers/gates/tool-call-gate-pipeline.test.ts` — update the one `pathDenyingResolver()` call site to the shared fixture; add a `describe` for deny-first ordering.
  The existing `short-circuits after the first blocking gate without evaluating later ones` test mocks `runner.run` wholesale while the resolver answers `allow`, so no gate is a pre-emptive deny and the test's expectation of a single `run` call still holds — verify rather than assume.
- `test/handlers/gates/runner.test.ts` — no change expected; it drives all three resolution branches and the extraction preserves them.
- `test/handlers/tool-call.test.ts` — add the end-to-end pin for the issue's repro.
- `test/handlers/external-directory-integration.test.ts` — **rewrite** `emits separate decision events for external_directory and write surfaces` (the one measured breakage).
  Its arrangement is `external_directory: allow`, per-tool `write: deny`, and it asserts that *both* an `external_directory_write` allow event and a `write` deny event are emitted.
  Under the new rule the `write` gate is the only one that runs.
  Rewrite it to assert the deny event and the **absence** of the external-directory event, which is the behavior this change introduces; keep the sibling test `blocks write to external path when external_directory allows but write is deny` unchanged, since its outcome assertion still holds.

### Docs

- `docs/configuration.md` — the `Four orthogonal layers compose with most-restrictive-wins` section (around line 548) teaches the `ask` > `allow` half only.
  Add the `deny` half: a `deny` on any layer decides the call without a prompt, whichever layer it is written on, and the refusal names that layer's rule.
- `README.md` — the two-line summary at line ~98 carries the same `ask` > `allow` sentence; add the `deny` clause there too.
- `docs/architecture/architecture.md` module tree — update the `descriptor.ts` entry (line ~915) for the new exports and the `tool-call-gate-pipeline.ts` entry (line ~917), whose current text reads "the run loop; `evaluate(tcc, runner)` returns the first block outcome or allow".
  The deny-first ordering is a structural invariant someone could "simplify" away, so the entry cites `#899` — a bare `#N` with no reference definition, since the tree is a fenced block.
- `docs/architecture/architecture.md` sweep list — the `[#899]` entry records the issue as deferred and predicts a mechanism ("the fix hoists resolution ahead of the prompt in `GateRunner.runDescriptor`") that this plan measured to be already done.
  Correct it in place: note that it was pulled forward and that the predicted coupling to the deferred `runDescriptor` split did not hold.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the paragraph beginning "The four path layers … compose with **most-restrictive-wins** across surfaces" states the rule with `ask` > `allow` only.
  Add that a `deny` on any of them pre-empts another's `ask` at the pipeline, and where the predicate lives.

Greps run to bound the doc set: `most-restrictive|most restrictive|compose` across `docs/`, `README.md`, and `.pi/skills/`; `gateProducers|ToolCallGatePipeline|first block` across `docs/` and `.pi/skills/`.
`docs/plans/0413-document-external-directory-allow-list.md` line 55 describes the gate order too, but it is a historical plan and is left alone.

## Test Impact Analysis

This is a behavior fix, not an extraction, so the three extraction questions apply only to Step 1.

**What Step 1 newly enables.**
`preResolvedCheckOf` becomes independently testable: the `preResolved` branch's synthesis of `{ toolName, source: "tool", origin: "builtin" }` is asserted directly today only through `runner.test.ts`'s emitted decision events.
A direct unit test is cheap and pins the synthesis without routing through the runner.

**What becomes redundant.**
Nothing.
`runner.test.ts`'s three branch tests still exercise the runner's own dispatch, which is where a regression would land.

**What must stay.**
`runner.test.ts`'s `blocks an explicit deny under yolo without prompting` builds its descriptor with `makeDescriptor()` (no `preCheck`) and a `resolveResult`, so it is the only coverage of the resolver fallback.
Step 1 must leave it green unmodified.

**New tests the fix enables.**
The deny-first ordering is a property of the pipeline, so it is testable at two levels: a `ToolCallGatePipeline` unit test asserting which gate `runner.run` receives first, and a handler-level test asserting that `prompter.escalate` is never called.
The second is the one that pins the reported symptom, because the first can pass while an escalation still happens somewhere else.

The input domain worth covering is *which* pairing of (asking gate, denying gate) is exercised.
The four non-bash gates (`skill-read`, `path`, `external_directory`, `tool`) are reachable with the existing mock `BashProgram` (whose `pathRuleCandidates()` and `externalAccesses()` default to empty), so both bash path gates return `null` in a pipeline unit test unless the mock is extended.
The plan covers the bash gates at the handler level instead, through the issue's real repro, which parses a real command.

## Invariants at risk

| Invariant                                                                 | Pinned by                                                                                                                                                  | Why it is at risk                                                                                                       |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| An explicit `deny` survives yolo ([#712])                                 | `runner.test.ts` → `blocks an explicit deny under yolo without prompting`                                                                                  | Step 1 rewrites the check-resolution block immediately above the yolo fast path                                         |
| A synthetic `ask` sentinel is preserved under yolo ([#452], [#840])       | `runner.test.ts` → `preserves the synthetic sentinel that raised a yolo-granted ask`, `auto-approves an unparsed-subtree ask under yolo without prompting` | same block                                                                                                              |
| A session-covered gate takes the session fast path                        | `runner.test.ts` → the `session_approved` block                                                                                                            | the predicate must not classify a session-sourced check as a pre-emptive deny                                           |
| A chained bash command resolves most-restrictive ([#301])                 | `tool-call.test.ts` → `blocks a chain when a later sub-command is denied (#301)`                                                                           | unchanged in mechanism, but it is the gate-6 deny the reordering now runs first                                         |
| The gate fails closed ([#452])                                            | `tool-call-boundary.test.ts`                                                                                                                               | `evaluate`'s return type and throw behavior are unchanged; a produced gate that throws still propagates to the boundary |
| The review log persists the payload's request facts (ADR 0011 §6, [#746]) | `logging.test.ts`, `review-log-renderer.test.ts`                                                                                                           | unchanged — `GateRunner` still stamps them; only which gates reach the runner changes                                   |

Two quantitative baselines, both measured at this plan's tree:

- Full package suite: 4157 tests in 157 files, all green.
  Predicted after Step 3: 4157 green, with one test rewritten rather than added.
- The issue's repro: `escalate` called once before, zero after.

The `permissions:decision` channel's constituency is worth naming separately, because this design stops emitting some `allow` events.
Its known consumer pattern is marking an agent blocked on `permissions:ui_prompt` and clearing on `permissions:decision` (PR [#693] / [#658]).
No stuck state can result: `ui_prompt` is emitted inside `LocalUserAuthorizer` during `escalate`, so a gate that is skipped emits neither event, and the gate that blocks emits its own deny event.

## TDD Order

1. **`refactor(pi-permission-system): read a descriptor's pre-resolved check through one function`** Extract `preResolvedCheckOf(descriptor: GateDescriptor): PermissionCheckResult | null` into `src/handlers/gates/descriptor.ts` and have `GateRunner.runDescriptor` consume it as `preResolvedCheckOf(descriptor) ?? this.resolver.resolve(...)`.
   Prepares Step 3: the deny predicate needs the same precedence, and a second copy of it would be correct only by mirroring.
   Add a unit test file `test/handlers/gates/descriptor.test.ts` covering all three answers (`preCheck` wins over `preResolved`; `preResolved` synthesizes `{ toolName: surface, source: "tool", origin: "builtin" }`; neither present yields `null`).
   Behavior-preserving: `runner.test.ts` must stay green unmodified.
   **Killing mutation:** make `preResolvedCheckOf` return `null` whenever `preCheck` is set — the new unit test goes red, and `runner.test.ts`'s pre-check-driven tests go red because the resolver's default answer replaces the gate's.

2. **`test(pi-permission-system): share a surface-denying resolver fixture`** Move `tool-call-gate-pipeline.test.ts`'s local `pathDenyingResolver()` into `test/helpers/gate-fixtures.ts` as `makeSurfaceDenyingResolver(surface, overrides?)`, parameterized by the surface string, and update its one call site.
   Prepares Step 3: each deny-first ordering test names a different (asking, denying) surface pairing, and each would otherwise re-derive a `mockImplementation`.
   **Killing mutation:** make `makeSurfaceDenyingResolver` answer `allow` for the named surface — `forwards extractors so a custom-shaped tool is path-gated` goes red.

3. **`fix(pi-permission-system): deny a forbidden command without prompting first`** Add `isUnconditionalDeny` and `orderDenyFirst` to `descriptor.ts`, and rewrite `ToolCallGatePipeline.evaluate` to produce all gate results before running them in deny-first order.
   Rewrite `external-directory-integration.test.ts`'s `emits separate decision events…` in the same commit — the assertion it makes is exactly the record this change stops writing, so it cannot land separately.
   Tests, by class:
   - `descriptor.test.ts` — `isUnconditionalDeny` is true for a `deny` `preCheck`, true for a `deny` `preResolved`, false for `ask`/`allow`, false for a bypass, false for `null`, and false for a `deny` whose `source` is `"session"`.
   - `descriptor.test.ts` — `orderDenyFirst` is identity when no gate denies, moves a single deny to the front, and preserves the relative order of two denies and of the non-denying remainder.
   - `tool-call-gate-pipeline.test.ts` — with `path` asking and the per-tool surface denying, `runner.run` receives the tool gate first, and receives it exactly once.
   - `tool-call.test.ts` — the issue's literal repro: `ls /tmp/… ; find / -maxdepth 2 …` under `bash: { "find / *": deny }` plus `external_directory: { "*": "ask" }` blocks with the `find / *` rule named, and `prompter.escalate` is never called.
   - `tool-call.test.ts` — the inverse pin: with `external_directory` asking and **no** gate denying, `prompter.escalate` is still called, so the fix did not simply stop prompting.

   **Killing mutations**, one per class:
   - Make `isUnconditionalDeny` return `false` unconditionally — the ordering test, both repro tests' escalation assertions, and the rewritten integration test go red; the `orderDenyFirst` unit tests stay green, which is expected, since they take gate results directly.
   - Delete the `source !== "session"` clause from `isUnconditionalDeny` — only the session-sourced predicate test goes red.
   - Make `orderDenyFirst` sort denies to the **end** instead of the front — the ordering test and both repro tests go red.
   - Make `orderDenyFirst` an unstable partition (reverse the non-denying remainder) — the relative-order unit test goes red and nothing else does, which is the point of asserting it separately.

4. **`docs(pi-permission-system): document that a deny on any layer needs no prompt`** Update `docs/configuration.md`, `README.md`, the two `docs/architecture/architecture.md` module-tree entries, the roadmap's `[#899]` sweep entry, and `.pi/skills/package-pi-permission-system/SKILL.md` as listed in Module-Level Changes.
   Verification: `pnpm exec rumdl check` on each edited markdown file, and a re-grep of `most-restrictive|most restrictive` across `docs/`, `README.md`, and `.pi/skills/` to confirm no remaining passage states the rule with `ask` > `allow` alone.

## Risks and Mitigations

- **The predicate drifts from `GateRunner`'s precedence.**
  Step 1 removes the mirroring by sharing `preResolvedCheckOf`.
  The residual coupling is the `source === "session"` clause, which duplicates the runner's fast-path condition; it is covered by its own unit test and by the `session_approved` runner tests, and it fails toward today's behavior if it drifts.

- **Eager gate production costs work on a denied call.**
  Producing gates 2–6 now happens even when gate 1 denies.
  The cost is resolver reads plus the bash path gate's existing bare-token `lstat` probes; the single `BashProgram.parse` already runs before the loop.
  Today's loop already produces every gate on every call that is not blocked, so the added cost applies only to calls that end in a block — where a ten-minute forwarding stall is the alternative.

- **A gate producer throws during the new eager pass.**
  Today a producer after a blocking gate never runs, so a throw in it is unreachable; after the change it is reachable.
  The mitigation is that `createFailClosedToolCall` already converts a thrown gate into a block with `resolution: "gate_error"`, so the direction of the change is fail-closed.
  This risk asserts what happens when a mechanism is **absent**, so verify it by spiking a producer that throws and confirming the boundary blocks — do not infer it from the boundary's existing tests, which throw from inside `evaluate` rather than from a producer.

- **Losing the earlier gate's `allow` record hides diagnosis.**
  Accepted, and chosen deliberately: the operator selected option B over the variant that preserves those records.
  The blocked entry names the deciding surface, its matched pattern, and its reason, which is the attribution the issue asks for.

- **A pairing the plan did not test still prompts before a deny.**
  The pipeline unit test covers the non-bash gates and the handler test covers the bash gates through a real parse, but the matrix is not exhaustive.
  The mitigation is that `orderDenyFirst` is gate-agnostic — it reads only the resolved state — so a pairing's correctness follows from the predicate rather than from the gate's identity.

## Open Questions

- Whether `preResolvedCheckOf`'s `preResolved` branch should stop synthesizing `source: "tool"` for a skill-read gate, which is not a tool check.
  Out of scope: it is today's behavior, and changing it would alter what the review log records for a denied skill read.
  Not filed — it is an observation, not committed work.

[#301]: https://github.com/gotgenes/pi-packages/issues/301
[#452]: https://github.com/gotgenes/pi-packages/issues/452
[#658]: https://github.com/gotgenes/pi-packages/issues/658
[#693]: https://github.com/gotgenes/pi-packages/issues/693
[#712]: https://github.com/gotgenes/pi-packages/issues/712
[#746]: https://github.com/gotgenes/pi-packages/issues/746
[#840]: https://github.com/gotgenes/pi-packages/issues/840
[#915]: https://github.com/gotgenes/pi-packages/issues/915
