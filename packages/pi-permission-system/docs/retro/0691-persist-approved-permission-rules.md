---
issue: 691
issue_title: "pi-permission-system: persist approved permission rules at project or global scope"
---

# Retro: #691 — pi-permission-system: persist approved permission rules at project or global scope

## Stage: Planning (2026-08-01T15:41:52Z)

### Session summary

Filed and reconciled issue #691, then produced the committed implementation plan for trusted project-local and global persistent approvals.
The plan covers prompt choices, JSONC-preserving atomic mutation, source precedence, trust and tracking checks, review logging, tests, documentation, and release guidance.

### Observations

- Automatically written project rules go only to trusted-project `config.local.json`; shared project `config.json`, Pi `settings.json`, frontmatter, and `.gitignore` remain manually owned.
- Closed PR #73 is credited as prior art, but its stale patch is not resurrected; any source carried forward must preserve `rienkim`'s authorship.
- Issue #603 is the direct narrower project-persistence request, while #604 remains related through editable session patterns.
- Forwarded asks retain their current once/session choices in the first release because requester-side project persistence requires a protocol round trip and a trust check in the requesting session.
- Open PR #675 may change the policy-source merge implementation before TDD begins, so cycle 1 must rebase and extend its merge/cache primitives if it lands.
- Design review found that persistence should enter through a local-authorizer factory plus prompt/persistence collaborators rather than widening `AuthorizerSelectionDeps` and `LocalUserAuthorizerDeps`.

## Stage: Implementation — TDD (2026-08-01T16:29:19Z)

### Session summary

Implemented trusted project-local and global durable approvals through red/green cycles covering source precedence, JSONC-preserving atomic writes, trust/tracking revalidation, interactive choices, session proposal editing, fail-closed reload, and documentation.
The final workspace suite passes with 2,698 `pi-permission-system` tests; type checking, root lint, and `pnpm fallow dead-code` also pass.

### Observations

- Durable prompts use the SDK `select` / `input` flow in every UI mode so editable text, exact destination confirmation, and typed acknowledgements have one implementation; the existing four-choice fast path remains in the inline keybind component.
- `PersistentApprovalTargetResolver` and orchestration live in one focused service module rather than the plan's two target/service files.
- Project writes are contained beneath the trusted cwd even when an intermediate config directory is a symlink; global writes are contained beneath the Pi agent directory.
- A persistence or reload failure restores the original bytes, emits `permission_rule.persistence_failed`, and returns a denied prompt decision, so the pending call cannot execute under an unsaved approval.
- Session approvals now return and record the complete edited multi-pattern proposal rather than only the original representative pattern.
- PR #675 remained open, so no settings-policy merge helper was available to extend.
- No source was copied from PR #73; its design prior art is credited in the plan, issue, and README, so no source commit needed a co-author trailer.
- The planned Tidy-First and pre-completion subagent dispatchers were unavailable in this harness; the plan's structural review was applied directly, including the narrowed local-authorizer factory.
- Pre-completion review: **WARN** — all deterministic gates and acceptance checks pass, but `mmdc` is unavailable for Mermaid validation and requester-side forwarded persistence is tracked only as follow-up bead `ai-82g.4`, not a separate public issue.

## Stage: Ship (worktree) (2026-08-01T16:30:12Z)

### Session summary

Root lint, type checking, the full workspace test suite, and `pnpm fallow dead-code` pass.
The plan recommends shipping independently; requester-side forwarded persistence remains deferred.

**Peer session transcript:** unknown — recover through the session-file listing for this worktree if needed.

### Observations

The branch is ready to rebase onto `origin/main` and publish to the contributor fork for upstream review.

## Stage: Hands-on UX correction (2026-08-01)

### Session summary

Manual testing exposed two UX problems that automated acceptance checks had missed: durable choices had temporarily bypassed the established inline shortcuts, and the planned confirmation flow stacked hotkey confirmation, a summary, and typed acknowledgements.
The inline shortcuts were restored first; subsequent user testing removed Git tracking detection and all typed acknowledgements, while retaining the exact-rule summary as a sticky, default-on preference.

### Observations

- `e` and persistence choices that open a summary are non-destructive navigation, so they should not require double-press before opening their sub-step.
- The summary remains useful because it shows the exact stored pattern and destination, but users can toggle **Show summary before saving** with `t` or `/permission-system`; the global preference persists across restarts.
- Persisting a machine-local file does not warrant special Git tracking detection or a typed `tracked` acknowledgement; documentation still recommends ignoring `config.local.json`.
- Global persistence no longer requires typing `global`; selecting the explicit global action provides sufficient intent, with the optional summary available for review.
