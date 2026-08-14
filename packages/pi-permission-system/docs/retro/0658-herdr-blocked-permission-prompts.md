---
issue: 658
issue_title: "pi-permission-system: report active permission prompts as blocked to Herdr"
---

# Retro: #658 — pi-permission-system: report active permission prompts as blocked to Herdr

## Stage: Planning (2026-07-31T20:30:49Z)

### Session summary

Planned a targeted compatibility fix that brackets `LocalUserAuthorizer`'s human decision wait with Herdr's blocked lifecycle events.
The plan preserves the package-owned permission broadcasts, adds direct and forwarded prompt coverage, and keeps listener failures observational.

### Observations

The issue was filed by a third party, so the direction was confirmed with the operator before planning.
The operator chose the direct [#658] integration over the broader [#610] correlatable-event contract and a local-only workaround.
`LocalUserAuthorizer` is already the single direct and forwarded UI path, so no new collaborator or alternate forwarding path is needed.

## Stage: Implementation — TDD (2026-07-31T20:50:40Z)

### Session summary

Completed one TDD cycle that brackets direct and forwarded permission dialogs with best-effort `herdr:blocked` active and inactive events.
The implementation added four tests for pending-state ordering, forwarded prompts, rejection cleanup, and listener-failure isolation, taking the package suite to 2675 tests.
Updated the README, cross-extension guide, and architecture module tree to document the compatibility behavior.

### Observations

No preparatory Tidy-First refactoring was warranted because the change fits the existing event-bus dependency and the focused `LocalUserAuthorizer` test seam.
The first final-check process failed at the lint step because Biome required one line wrap; the source commit was rebuilt after formatting, and the full test, type-check, lint, and dead-code gates then passed.
The configured reviewer subagent was unavailable in this harness, so a manual pre-completion review covered the same changed-file, acceptance, security, documentation, and commit checks and returned PASS with no findings.

[#610]: https://github.com/gotgenes/pi-packages/issues/610
