---
issue: 1101
issue_title: "pi-permission-system: dialog shows the unit the authorizer link accepted, not the one still asking"
---

# Retro: #1101 — pi-permission-system: dialog shows the unit the authorizer link accepted, not the one still asking

## Stage: Planning (2026-11-18T06:43:00Z)

### Session summary

I planned a partial authorizer verdict, `allow_units`, for this third-party report.
The chain narrows a bash chain's ask to the units a link left undecided, and the narrowed session grant travels back to whichever node records it.
The operator chose the partial verdict over deferring to #1129 or declining, and chose to carry each asking unit's own matched rule (one wire field) rather than all four per-unit display facts or none.
I filed #1131 for the serving-node analogue.

### Observations

- A disposable spike through the real gate stack ran on post-#1095 `main`.
  It showed the dialog already names `git commit` as `also asks`, but it still leads with the assignment, and `(s)` still grants the assignment's pattern. #1095 narrowed the report without closing it.
- The verdict is a distinct kind, not `allow` with a `units` field.
  An older chain's `decideFromVerdict` switch falls through on an unknown kind and reads it as `defer`, which is fail-safe.
  `allow` plus `units` would fail open there.
- The grant does not follow the details the chain narrows.
  The runner records `descriptor.sessionApproval` and the serving node records `request.sessionApproval`, so the decision gains `narrowedGrants`, and the forwarding response carries it like `sessionGrantWidth`.
  The Tidy-First assessor flagged that absent and empty mean different things here: absent falls back to the wide grant, so a narrowed session decision is stamped `[]` rather than left absent.
- The assessor also found that `bash-chain-session-approval.test.ts` stubs `AskEscalator.escalate`, which sits above the chain.
  So the integration case wires a real `AuthorizerSelection` instead.
- Accepted residual: an older child reading a newer serving node's response drops `narrowedGrants`, and a child-scope grant then records the full approval.
- Tidy-First:
  - recommended: extract `otherAskingUnits(commands, value)` (TDD step 1);
  - optional, both folded in: a decided/continue chain step (step 6) and a `makeBashChainPromptDetails` fixture (step 4).

#### Deferred tidyings

- `src/handlers/gates/runner.ts`: `runDescriptor` is about 170 lines, and step 6 could be extracted.
  Declined because the change adds about 5 lines there.
- `src/authority/forwarding-io.ts`: an asking unit's fields are listed three times (the cast type, the guard, and `copyAskingUnits`).
  Declined because a table-driven version would be the wrong abstraction for an explicit allowlist.
