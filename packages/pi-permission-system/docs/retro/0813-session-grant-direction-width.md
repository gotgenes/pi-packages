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

[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#810]: https://github.com/gotgenes/pi-packages/issues/810
