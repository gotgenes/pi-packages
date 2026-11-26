---
issue: 1067
issue_title: "pi-permission-system: path traversal and arbitrary JSON file write via unvalidated forwarded request.id"
---

# Retro: #1067 — pi-permission-system: path traversal and arbitrary JSON file write via unvalidated forwarded request.id

## Stage: Planning (2026-11-26T07:19:33Z)

### Session summary

Planned the Phase 16 roadmap step that bundles this issue with #1068 and #1069 (all third-party, same reporter; the maintainer had already committed to one fix).
The operator chose all recommended options: all three issues in one plan with a Zod request schema, the encoder escaping dot-only session ids, and the serving node naming its response after the drained request file instead of adding a containment assertion.
The plan has nine steps: two `refactor:`, two `test:` tidyings ahead of the schema swap, one `refactor:` schema, three `fix:`, and one `docs:`.

### Observations

- The #1068 report overstates the defect: `encodeURIComponent("../../escaped")` is `..%2F..%2Fescaped` (measured).
  Only the exact ids `.` and `..` survive the encoder, and Pi 1.0.0's `assertValidSessionId` never mints them, so the reachable trigger is a parent-session env var.
- A second #1067 shape the report omits: an id longer than about 250 characters makes the response write fail with `ENAMETOOLONG`; `recordForwardedDecision` then keeps the request, so the human is re-prompted every poll.
  The shared `isFilenameSafeRequestId` bounds the length at 128.
- The relay hop already had a filename-safety regex (`approval-escalator.ts`, from `3f8d3fd6`); the plan makes it the one rule and narrows it (drops `.`).
- Measured Zod 4.6.7: a caught malformed key comes back **present** with `undefined`, which breaks the `toStrictEqual` license tests in `forwarding-io.test.ts`.
  The plan adds a `withoutUndefinedKeys` transform at both levels.
- The Tidy-First assessor found the reader's characterization net thin (no required-field rejection, display-field tolerance, nested unknown-key stripping, or warning assertions), which became steps 3–4.
- `Co-authored-by:` for the reporter (`Dezső BICZÓ <1755573+mxr576@users.noreply.github.com>`) goes on steps 1, 2, 5, 6, and 8; the response-by-filename mechanism is our own.
- `/ship` should close #1068 and #1069 together with #1067 and reply to the reporter.
  The reporter's request for a security-disclosure policy is untracked (the 2026-11-19 triage notes it); it was not filed from this plan.

#### Deferred tidyings

- `test/authority/permission-forwarding.test.ts`: flat top-level `test()` calls (lines ~265–325) are not nested by concern.
- `src/authority/forwarding-io.ts`: the filesystem and logging helpers could split from the response reader once the request guards leave.

## Stage: Implementation — TDD (2026-11-26T07:43:40Z)

### Session summary

All 9 plan steps landed as separate commits (2 `refactor:`, 2 `test:`, 1 `refactor:` schema swap, 3 `fix:`, 1 `docs:`), plus one `test:` and one `docs:` commit fixing the reviewer's WARN findings.
The `pi-permission-system` suite went from 6578 to 6629 tests (+51); every new test was mutation-checked, and each mutation killed what the plan predicted.

### Observations

- Step 4's new required-field pins earned their keep right away: the first schema draft used `z.unknown().transform(asPromptPayload)` for `payload`, which Zod 4 treats as required (`expected nonoptional`), so every request with no `payload` was rejected.
  The fix is `.transform(...).optional()`; the "accepts a request carrying only the required fields" pin found it.
- One tolerance did tighten, caught by the reviewer's 703-input differential probe: Zod's `z.number()` rejects a non-finite `createdAt` (JSON `1e400`), which the hand-rolled reader accepted.
  No requester writes one and `src/` never reads `createdAt`, so it was kept, pinned in `forwarded-request-schema.test.ts`, and named in the architecture `Landed:` note.
- The reviewer also noted the pre-#752 id's random part can be short or empty (`Math.random().toString(36).slice(2, 10)`); both forms pass the new rule and are now pinned.
- The parsed request no longer carries `undefined`-valued keys at the top level (the old reader always emitted `payload`, `source`, etc.); the reviewer grepped and found no consumer that checks for them.
- `forwardableRequestId`'s doc comment claimed the reader validates an id only as a string; it was updated in the `fix:` commit that made it false.
- Pre-completion reviewer: WARN on the full range (the `createdAt` tolerance and the "already used" wording, plus unpinned short legacy ids), then PASS on the delta after the fixes.

## Stage: Final Retrospective (2026-11-26T07:54:04Z)

### Session summary

One session took #1067 (bundled with #1068 and #1069, all from one third-party reporter) from plan to release: 9 planned steps plus two review-fix commits, released as `pi-permission-system-v44.0.1`, and all three issues closed with co-author credit to the reporter.
The change validates the forwarded request id at the reader, names the response after the drained request file, escapes dot-only session ids, and replaces the hand-rolled request reader with a Zod schema.
The affected test files grew from 240 to 291 tests (measured at retro time by running the plan-commit copies beside the current ones).

### Observations

#### What went well

- The Tidy-First assessor's characterization-gap recommendation paid off at once: step 4's required-field pin ("accepts a request carrying only the required fields") caught the first schema draft rejecting every request with no `payload` (`z.unknown().transform(...)` is non-optional in Zod 4) before anything was committed.
- The re-derivation mandate in the reviewer dispatch produced a 703-input differential probe of old reader against new schema, which found the one tolerance the plan's "unchanged field for field" claim missed (a non-finite `createdAt`).
- Measuring the reports before planning reshaped them: #1068's headline repro (`../../escaped`) was false, and the real trigger (exact `.`/`..`, reachable only through an env var, since Pi 1.0.0's `assertValidSessionId` forbids it) came from reading the pinned Pi dist rather than the report.
- A one-file mutation runner (`/tmp/mutate.mjs`: assert each pattern occurs once, run the file, restore) kept every step's killing mutations to one tool call, and every mutation killed what the plan predicted.

#### What caused friction

- `rule-ignored` — the plan draft wrote a code span holding backticks with single-backtick delimiters (`` join(responsesDir, `${request.id}.json`) ``) in five places, and put a step's closing sentence directly after a nested list (lazy continuation); `markdown-conventions` states both rules and was loaded.
  `rumdl` passed both.
  Self-identified by a grep before the plan commit.
  Impact: two fix passes before commit; no rework after.
  The nested-backtick slip recurs (`packages/pi-permission-system/docs/retro/0957-quoted-flag-value-bypasses-flag-table.md`, `docs/retro/0902-dashed-edge-vocabulary.md`).
- `judgment` — the planning-time Zod probe covered `.optional().catch()` and key presence but not `z.unknown().transform()` on an absent key, nor a non-finite number, so the plan's sketch carried a non-optional `payload` and the plan's "tolerance unchanged" claim was wrong for `createdAt`.
  Impact: one red run plus a probe in step 5 (self-identified); two follow-up commits and a delta review for `createdAt` (reviewer-caught).
- `slip` — the step-6 mutation deleted the `.refine(...)` line together with its trailing comma, so the file failed to parse and the runner reported `no tests`.
  Self-identified; one re-run.
- `rule-ignored` — no baseline test count was captured before step 1, so the TDD stage note's 6578 was derived by subtraction rather than read from a command (AGENTS.md principle 4).
  Re-measured at retro time: the derived number was right.
  Impact: none beyond the retro-time measurement.

#### What the operator steered

- None.
  At the planning gate the operator took the three recommended options (all three issues with a Zod schema; the encoder escapes dot segments; the response is named after the request file), and every later command ran with no corrections.

### Diagnostic details

- **Model-performance correlation** — the `tidy-first-assessor` and both `pre-completion-reviewer` runs ran on `anthropic/claude-opus-5-5`, matching their definitions; all three did judgment work (a structural read, a differential probe), so the model fit the task.
  The delta re-review (16.7k tokens) was the lightest of the three and still needed the deterministic gates run fresh.

### Changes made

1. Filed #1148 (`scope:repo`): a lint check for a backtick nested inside a single-backtick code span, the recurring slip above; it goes through `/plan-issue` to measure a heuristic before any gate lands.
2. `packages/pi-permission-system/docs/architecture/architecture.md`: recorded #1148 as out of scope for the Phase 16 roadmap (operator decision), in its own commit.
