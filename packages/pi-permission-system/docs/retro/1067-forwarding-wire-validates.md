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
