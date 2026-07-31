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

[#610]: https://github.com/gotgenes/pi-packages/issues/610
