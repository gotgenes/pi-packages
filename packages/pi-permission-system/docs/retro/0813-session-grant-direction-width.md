---
issue: 813
issue_title: "pi-permission-system: let a bash session approval choose its direction width"
---

# Retro: #813 — pi-permission-system: let a bash session approval choose its direction width

## Stage: Planning (2026-09-02T06:24:38Z)

### Session summary

Produced `docs/plans/0813-session-grant-direction-width.md`, the plan for Phase 14 Step 11: a conditional fifth option row at the ask prompt (`b`) that records a session grant on the bare family surface instead of the proven directional member.
The operator settled three questions at a clarification gate — affordance shape, symmetry, and label wording — and the Tidy-First assessor contributed two preparatory refactorings that lead the TDD order.
Eight steps: two preparatory `refactor:`, three unobservable mechanism `refactor:` steps, one `fix:` for a residual [#810] deferred here, the shipping `feat:`, and the doc/roadmap commit.

### Observations

#### Measurement drove the symmetry decision

Scanning the local review log (`~/.pi/agent/extensions/pi-permission-system/logs/`) over the six days since [#807] landed produced 107 distinct asks, deduplicated by `requestId`: 40 (37.4%) on `external_directory_read`, 51 on `bash`, 16 on the bare family, and **zero** on `external_directory_write` or `path_*`.
So the issue's own motivating example — write, then read — did not occur in the window, while its mirror occurred 40 times.
That reframed the symmetry question from "should we also offer it on reads" into "reads are the only case that will actually fire, and widening there grants a write", which is what the operator answered.
A write-proven-only rule would have shown the affordance zero times.

#### The wire shape was priced against the shipped reader, not argued

`git show pi-permission-system-v30.0.0:…/forwarding-io.ts` shows `readForwardedPermissionResponse` gating on `isPermissionDecisionState(parsed.state)` and rebuilding an allowlist of known fields.
So a new `PermissionDecisionState` value would make a v30.0.0 child reject the whole response and poll to the full ten-minute `forwardingTimeoutMs`, while an added optional key is silently dropped.
That measurement, not a preference, is why the width travels as an orthogonal `sessionGrantWidth` field.

#### The roadmap's `Outcome:` line needed a correction

Phase 14 Step 11 promises "the review log's `decidedBy` names which width was chosen".
`decidedBy` is a `DecisionSource` — it answers *who decided*, and for a human ask it is `{ kind: "user", via: "dialog" }` with no room for a grant property.
The plan records the width as its own field on the terminal review entry instead, and step 8 writes the correction into the step's `Landed:` note rather than leaving a reader to derive it.

#### Step ordering keeps the affordance in one commit

The first draft put the dialog before the recording path, which would have left a `main` commit where pressing `b` did nothing.
Reversed: the mechanism lands as three unobservable `refactor:` steps (gate result, vocabulary, recording, wire), and the `feat:` is the single commit that makes the option appear — matching AGENTS.md's rule that a commit is typed by what a user can observe.

#### Preparatory refactorings accepted from the Tidy-First assessor

Both Recommended items became steps 1 and 2: single-sourcing the duplicated `OPTION_ORDER` between `permission-prompt-decision.ts` and `permission-prompt-component.ts`, and replacing `PermissionGateResult`'s `forSession?: true` with a single `sessionGrant?: { width }` field that cannot represent an illegal state before a second dependent bit is added beside it.

The assessor also corrected the design summary: the option roster has a **third** representation — `permission-dialog.ts`'s `select`/`input` fallback, built from plain label strings rather than hotkeys.
It declined to fold that into the same extraction, and the plan follows: the fallback gains a fifth string and is not abstracted with the keyed pair.

#### Deferred tidyings

- `src/authority/local-user-authorizer.ts` — `buildRequestOptions` gains a second special case beside its forwarded-`sessionScope` branch.
  The assessor flagged it as worth watching but not worth a preparatory extraction, since the offer-rule predicate has nowhere else to live yet.

#### Residuals resolved rather than re-deferred

Plan 0810 left two items "deferred to #813": the forwarded whole-session scope label naming one grant out of several, and whether `docs/session-approvals.md` should document a grant's direction.
Both are in this plan — the first as its own `fix:` step (step 6), the second as part of step 8's doc work.
The scope label names the shared **family** rather than a directional member, because those labels are built before the dialog runs and cannot vary with a width chosen inside it.

#### `rg -r` trap hit once

`rg -rn 'suggestPathSessionPattern' …` rewrote every match to `n` in the output, exactly as AGENTS.md warns.
Re-ran with `grep -rn`.

## Stage: Implementation — TDD (2026-09-02T07:14:54Z)

### Session summary

Executed all eight planned TDD steps plus one operator-requested test-hygiene commit and one reviewer-prompted doc fix — ten commits.
The ask prompt now offers a conditional fifth option (`b`) recording a session grant on the bare family surface, with the width threaded through `applyPermissionGate`, `GateRunner`, and the forwarded-response wire.
Package test count went 3862 → 3940 passed (+78), 2 expected fail unchanged; `check`, root `lint`, `test`, `fallow dead-code`, and `verify:public-types` all green.

### Observations

Pre-completion reviewer: **WARN** — one non-blocking finding, since fixed in `65343336`.

#### Reviewer warnings

- The `permission-prompt-component.ts` module-tree entry in `architecture.md` still described the pre-#813 component, though the plan's Documentation table named the file.
  Fixed before handoff.
  Worth noting the shape of the miss: the docs commit updated the entries whose *described contract* changed and skipped the one whose change was "deletes a local constant, imports it instead" — which is exactly the structural fact a module tree should carry.

The reviewer's five-part re-derivation mandate (this change widens a grant) came back clean on all five, including the one worth stating: no auto-approve path can produce `"family"`, because both the yolo and session-hit fast paths `return` before `applyPermissionGate` is reached, so `sessionGrant` is unreachable without an escalation a human answered.

#### Two plan predictions were wrong, both recorded rather than papered over

- Step 1's killing mutation was "reverse the exported order — the component's row-order assertions must fail."
  There were no row-order assertions: the component test never pinned the rendered option order, so the plan's predicted red could not have fired.
  Added the pin first, then did the refactor — the mutation then killed it as intended.
  A `refactor:` step's mutation is where a missing pin surfaces, because the step has no red of its own to hide behind.
- Step 4 predicted its `width: "family"` mutation would redden three #807 narrowing tests; it reddened two.
  The third ("covers a later write with an approved write") asserts a *positive* coverage that widening preserves, so it cannot discriminate that mutation by construction.
  Counting reds against the prediction is what turned this into a one-line finding instead of an unexamined pass.

#### Sequencing kept the affordance in a single commit

The plan deliberately landed the mechanism (gate result, vocabulary, recording, wire) as four unobservable `refactor:` steps before the `feat:` that renders the option.
This paid off: no commit on the branch has a key the user can press that does nothing, and the `feat:` diff is the affordance alone.
One forced deviation — `PermissionPromptDecision.sessionGrantWidth` had to land in step 4 rather than step 7, because `applyPermissionGate` cannot read a field that does not exist.

#### An operator-requested tidy landed mid-implementation

The operator questioned `if (x.kind !== "render") throw new Error("expected render")` in the tests I was writing.
It was the file's own convention (18 occurrences on `main`) and it was doing real work — type narrowing, which `expect()` cannot do — but it reported outside the assertion library.
`expect.unreachable` returns `never`, so an `assertRender` assertion signature narrows *and* reports; each site became a one-line swap.
Done as its own `test:` commit ahead of the feature, at the operator's direction, which meant setting the in-flight step-7 work aside (`cp` to `/tmp`, `git checkout HEAD --`, tidy, commit, restore) rather than mixing it into the feature diff.
The swap was scripted because it was strictly single-line per site; the *helper insertion* was a hand `Edit`, and I still miscounted the decorative `// ── Helpers ───` rule's dash run and corrupted the line — recovered by restoring that one line byte-exactly from `git show HEAD:<path>` rather than retyping it.

#### Type checking caught what the suite could not

`decisionFn.mock.calls[0][3]` compiled in my head but not in `tsc`: the fixture's `??` override widens `decisionFn` to the plain function type, erasing `Mock`.
Rewrote those five assertions onto the file's existing `toHaveBeenCalledWith` convention.
This is the `testing` skill's "annotation erases `Mock<...>` methods" rule arriving from the other direction — worth running `pnpm run check` before believing a new fixture accessor.

#### Doc-comment defaults are a contract worth stating once

`sessionGrantWidth` is absent-means-`"proven"` in four places (the decision, the gate result, the wire, the review log) — except the review log, which writes `"proven"` explicitly because a log is read rather than consumed and a reader should not have to know the default.
That asymmetry is deliberate and is stated in `recordedGrantWidth`'s doc comment.

## Stage: Sync (worktree) (2026-09-02T18:29:14Z)

### Session summary

Pre-push checks pass clean: `pnpm run lint` and `pnpm fallow dead-code` both green with no fixes needed.
The plan's Release Recommendation is **ship independently**; no other package or in-flight worktree branch touches these files, so nothing is deferred at land time.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-813--/2026-09-02T05-58-16-961Z_01a060b2-5c81-7791-9bb6-dc89e65892af.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.
One continuous session spans planning, TDD implementation, and this sync stage — no separate spawn per stage, so this single file carries the whole history.

### Observations

Nothing to add beyond the TDD stage's own observations — this stage is a clean pass-through: checks were already green from the TDD session's end-of-cycle gates, re-run here unchanged.

[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#810]: https://github.com/gotgenes/pi-packages/issues/810
