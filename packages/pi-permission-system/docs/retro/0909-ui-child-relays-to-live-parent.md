---
issue: 909
issue_title: "pi-permission-system: honor explicit parent forwarding for subprocess children with their own UI"
---

# Retro: #909 — pi-permission-system: honor explicit parent forwarding for subprocess children with their own UI

## Stage: Planning (2026-09-11T06:04:49Z)

### Session summary

Planned [#909], a third-party issue from [@boadij](https://github.com/boadij) (maintainer of Pi Herdsman): a subprocess child that has its own TUI adjudicates `ask` permissions locally even when its spawner named a parent session in `PI_SUBAGENT_PARENT_SESSION`.
The operator's clarification gate settled the direction as **implicit trigger, liveness-gated**: a UI node relays when a forwarding target resolves to another session *and* that target is demonstrably draining its inbox; otherwise it keeps its local dialog.
The plan is committed at `packages/pi-permission-system/docs/plans/0909-ui-child-relays-to-live-parent.md` — three preparatory commits, one breaking `feat!:`, a boundary/end-to-end test step, a transition-record step, and a docs step.

### Observations

- The reporter's diagnosis was accurate and verified inline: `selectAuthorizer` (`src/authority/authorizer.ts`) tests `ctx.hasUI` before subagent detection.
  Herdsman's spawn path was read directly from its source (`extension/index.ts:5057-5061`, plus the nested-agent inheritance at `:4862-4864`) rather than taken from the issue body — it confirms every pane in a `lead → agent → agent` tree names the root lead.
- Three separate questions ride on `hasUI` in this package, and only one moves: serving eligibility (`ForwardingManager`, fixed by [#907], untouched), child detection (`isSubagentExecutionContext`, untouched), and authority selection (this change).
  Naming that split up front is what kept the change from re-opening [#907].
- `resolvePermissionForwardingTarget`'s `hasUI` arm — returning `{ source: "self" }` — turned out to be **dead in production** and actively wrong under the new design (a relaying UI node would file requests into the inbox it drains).
  Removing it is the first preparatory commit.
- Alternatives rejected at the gate: an explicit second env var from the spawner, an operator config key, and declining outright.
  The liveness gate was chosen over hard-relay so a pane with a live human is never refused for a dead parent, and it also avoids a composite terminal whose `adjudicatesLocally` would be ambiguous mid-ask (ADR 0007 §7 has no room for that).
- The change is classified **breaking** (`feat!:`): an existing configuration changes where its human is prompted, with no user edit.
  The opt-out is the spawner's — spawn the child without the marker.
- No new ADR: ADR 0007 §7's rule is untouched and only its incidental example ("a node with UI decides locally") is narrowed; `docs/subagent-integration.md` is the canonical spec that carries the new rule.
- An in-process `@gotgenes/pi-subagents` child never binds an `ExtensionUIContext` (pi's `agent-session.ts` sets it only from `bindings.uiContext`, which interactive/rpc modes supply), so the registry channel's new arm is unreachable for it in production — it is exercised only by hand-built ctx literals in `composition-root.test.ts`.
- Filed no follow-up issues: the one concrete residual (a relaying pane shows nothing while it waits) is already tracked as [#658] / PR [#693], and the rest are Open Questions with no reported symptom.

#### Deferred tidyings

- `src/authority/authorizer-selection.ts` and `src/authority/forwarding-manager.ts` — the assessor declined extracting a shared "log on transition only" helper for the two change-detection sites: they track different state shapes (a bare session id vs. a role plus optional target) and would be the abstraction's only two call sites.
  Revisit only if a third appears.

[#658]: https://github.com/gotgenes/pi-packages/issues/658
[#693]: https://github.com/gotgenes/pi-packages/pull/693
[#907]: https://github.com/gotgenes/pi-packages/issues/907
