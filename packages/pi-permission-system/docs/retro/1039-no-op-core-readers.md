---
issue: 1039
issue_title: "pi-permission-system: exact allow for sudo -n true still triggers the indirection-wrapper ask"
---

# Retro: #1039 — pi-permission-system: exact allow for sudo -n true still triggers the indirection-wrapper ask

## Stage: Planning (2026-10-08T04:06:23Z)

### Session summary

Reproduced the third-party report through the real parser and `PermissionResolver` with a disposable spike, then put four directions to the operator: admit no-ops to the core (A), an exact-literal wrapper rule lifting the floor (B), both, or decline.
The operator chose A, a data-only addition of `true`, `false`, `:` to `coreAdmissions()`, and the plan was committed with a two-step TDD Order (feat + docs).

### Observations

- A full-suite spike with the admission group added measured 2 failures out of 5668, both the `PURE_READER_CORE` parity tests; no other behavior assertion moves.
- Finding surfaced in the gate: an exempt wrapper resolves by the *inner* command's rule, so under `{"*": "ask", "sudo -n pwd": "allow"}` `sudo -n pwd` already asks today, and `sudo -n true` will do the same after this change.
  No config line can make a wrapper unit's own exact allow stand; that was direction B, declined, and it overlaps open PR #971 (rnavarro's `xargs` rule-pinning).
- Direction B would have needed an ADR 0013 §11 amendment ("v1 exemption is package-audited only").
- The Tidy-First assessor recommended no preparatory tidyings and caught that `docs/configuration.md`'s roster list must change in the same commit as the code (doc-parity test); sorted order puts `:` first and `false` before `fd`.
- `Co-authored-by: aisensiy` is recorded in Step 1's commit message because the report's source pointer named the missing core admission the fix adds.
- No follow-up issues filed; no roadmap step references #1039, so it ships independently.

## Stage: Implementation — TDD (2026-10-08T05:46:13Z)

### Session summary

Both plan steps landed: the `feat` commit admitting `true`, `false`, `:` to `coreAdmissions()` with tests in four files plus the doc roster, and the `docs` commit adding the `sudo -n true` example and the 26-word roster count.
The `pi-permission-system` suite went from 5668 to 5688 tests (+20), all green, with check, lint, and `fallow dead-code` clean.

### Observations

- The plan's third killing mutation (drop the `PATH_SEPARATORS` check in `isBareCoreWord`) was vacuous: the exact-set lookup already rejects `./true` and `/bin/true`, so the guard is redundant for these inputs and every test survived.
  The discriminating mutation for that class is basenaming the head word (`PURE_READER_CORE.has(headWord.split("/").at(-1))`), which killed all six path-qualified negatives, the four new ones and the two existing `xargs ./grep`/`xargs /usr/bin/grep` ones.
- Red differed slightly from the plan: the doc-parity test stays green until the code changes, because it compares the doc to `PURE_READER_CORE`, not to `ROSTER`; it went red under the delete-the-group mutation as expected.
- An extra unplanned mutation (ignore `writesViaRedirect` in `floorExemptionOf`) confirmed the `sudo true > /tmp/x` row pins the redirect refusal.
- Pre-completion reviewer: PASS.
  Its non-blocking observation was a pre-existing fail-open: `sudo -e` (sudoedit) operands are peeled as an inner command, so `sudo -e cat` earns `core-reader`.
  Filed as #1042; the operator dispositioned it as a new Phase 15 step directly after #1027 (committed separately as the roadmap bookkeeping commit).
- The base ref handed to the reviewer was not resolved with `git rev-parse` and did not exist; the reviewer fell back to the plan commit's parent.
  Resolve the SHA before dispatch.
