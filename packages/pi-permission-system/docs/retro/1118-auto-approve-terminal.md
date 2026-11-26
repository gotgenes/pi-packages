---
issue: 1118
issue_title: "pi-permission-system: replace yolo with auto-approve, a terminal after the authorizer chain"
---

# Retro: #1118 — pi-permission-system: replace yolo with auto-approve, a terminal after the authorizer chain

## Stage: Planning (2026-11-26T20:42:07Z)

### Session summary

Planned the replacement of yolo with auto-approve per ADR 0016 §5: a terminal decorator (`AutoApprovingAuthorizer`) over a locally adjudicating node's terminal, driven by per-session `AutoApproval` scopes (`own`, `forwarded`, `agent <name>`) set by `--auto-approve` or `/permission-system:auto-approve`.
The plan has ten steps: three test-wiring preparations, two `refactor:` steps that land the decider and its composition unwired, `feat:` setters, `feat:` headless serving, the `feat!:` yolo removal, the [#868] schema ride-along, and docs.

### Observations

- Operator decisions at the gate: the `"yolo"` origin is **removed** with no replacement `RuleOrigin` (an auto-approved event reports the asking rule's origin + `auto_approved`; the setter lives on `decidedBy`); the command registers as `/permission-system:auto-approve` ahead of [#1103]'s namespace; a headless node **serves** forwarded asks while auto-approve covers them, because otherwise `pi -p --auto-approve` with subagents regresses (children used to read the shared `yoloMode` and approve locally; traced, not run).
- A relaying node never consults its own auto-approve (ADR §5, "set at the serving node"); it records `auto_approve_delegated`, mirroring `authorizer_chain_delegated`.
- `yoloMode` stays schema-valid and deprecated (the `toolInputPreviewMaxLength` precedent) so an old global file is not rejected into an empty scope; it must stay in `mergeUnifiedConfigs`' loop or the warning never fires.
- Measured: Pi 1.0.0's `parseArgs` lets a boolean extension flag swallow the next positional (`pi --auto-approve "fix the bug"` loses the message); Pi's `main` checkout is unchanged.
  Documented as a safe-spelling note; reporting upstream is an Open Question.
- The tidy-first assessor caught a sequencing defect: the config-derived status sync (`PermissionSession.refreshConfig`, every `before_agent_start`) would erase the auto-approve indicator, so status ownership moves in the setters step, not the removal step.
  It also found three hand-rolled factory fakes (`session-start.test.ts` ×2, `permission-events.test.ts`) that would throw on `registerFlag`, and two dead yolo fixture options, one of which `tsc` would not flag because it is spread into the manager's options.
- Measured 80 `as unknown as ExtensionAPI` casts in `composition-root.test.ts` (the roadmap said 79).
- Review-log shape changes are part of the break: one `permission_request.auto_approved` entry becomes `waiting` + `approved`, and a served ask logs `forwarded_permission.prompted` even though no human is asked.
- Credit: `Co-authored-by` ReStranger (PR [#990]'s session command) and maksimr ([#720]'s launch flag) on the setters commit; close [#720], [#1031], and PR [#990] at ship.

#### Deferred tidyings

- `src/authority/authorizer-selection.ts`: chain-link resolution (`linksFor`, `resolveConfiguredLinks`, and four deps) is a separable `ChainLinkResolver`; it does not shrink this change.

[#720]: https://github.com/gotgenes/pi-packages/issues/720
[#868]: https://github.com/gotgenes/pi-packages/issues/868
[#990]: https://github.com/gotgenes/pi-packages/pull/990
[#1031]: https://github.com/gotgenes/pi-packages/issues/1031
[#1103]: https://github.com/gotgenes/pi-packages/issues/1103
