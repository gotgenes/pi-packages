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

## Stage: Implementation — TDD (2026-11-18T07:31:25Z)

### Session summary

I implemented all 10 TDD steps: 7 `refactor:` steps, 1 `test:` fixture, 1 `feat:`, and 1 `docs:`.
The new `allow_units` verdict narrows a bash chain's ask, and `narrowedGrants` carries the narrowed session grant back to the local runner, the serving node, and a forwarded child.
The `pi-permission-system` suite grew from 6488 to 6550 tests, and every killing mutation the plan named turned its tests red.

### Observations

- `makeBashChainPromptDetails`, built from the real `describeToolGate`, became the oracle for `narrowAsk`.
  A narrowed ask must equal the gate's ask with the settled units absent, so every step 5 test is one `toStrictEqual` against the fixture rather than a hand-written expectation.
- Step 6 deviation: the old `decideFromVerdict` read an unknown verdict kind as `defer` only implicitly, by falling off the switch.
  A step object had to state that fallback, so the step added a test pinning it, since this is the version-skew property the plan's "distinct kind" decision rests on.
  Biome's `noUselessSwitchCase` then moved the fallback from a `default:` arm to a statement after the switch.
- `fallow dead-code` found an import cycle: `prompt-details-fixtures.ts` imported `makeTcc` from `gate-fixtures.ts`, which already imports it back.
  The fixture now builds the tool-call context inline.
  That fix and the lint fix were autosquashed into their steps, since nothing was pushed.
- The plan listed `docs/cross-extension-api.md` for the verdict list, but that bullet lives in `docs/architecture/architecture.md`, so `cross-extension-api.md` is unchanged.
  The `package-pi-permission-system` skill also named the three-verdict range, and was updated although the plan did not list it.
- The first integration attempt failed for two reasons, neither of them a code defect:
  - the test link's assignment regex (`\S*`) rejected `F="a/b.txt c/d.txt"`, which contains a space;
  - the serving context had no `sessionManager`, so `LocalUserAuthorizer`'s `describeSession` threw before the dialog.
- Pre-completion reviewer:
  - Round 1 was WARN, with three non-blocking hardenings, all folded into the feat commit with discriminating tests:
    - `narrowAsk` narrows only a `bash`-surface ask;
    - a narrowed ask offers a session grant only if the original did;
    - `withNarrowedGrants` keeps a terminal's own `narrowedGrants`.
  - Round 2 (delta) was WARN, about prose only: ADR 0007 §9 now states those three behaviors.
    The plan was left as a planning-time snapshot.

## Stage: Sync (worktree) (2026-11-18T16:52:18Z)

### Session summary

Root `pnpm run lint` and `pnpm fallow dead-code` both pass on the branch, and neither reviewer WARN left an operator decision open.
The plan's marker is `**Release:** ship independently`, so root's `/ship` names `pi-permission-system` on its own.
The follow-up #1131 (serving-node narrowing) is filed and linked from the plan and ADR 0007 §9.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1101--/2026-11-18T06-26-36-074Z_01a1ed55-f5a9-7089-98d0-0bb29f4f450a.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

The feat commit carries the `Co-authored-by:` trailer for Raymond Neilson, who proposed `allow_units` on #1095; confirm it survives the ff-merge with `git interpret-trailers --parse` before the close comment names him.
