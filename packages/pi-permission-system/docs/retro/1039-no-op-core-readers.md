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
