---
issue: 691
issue_title: "pi-permission-system: persist approved permission rules at project or global scope"
---

# Persist approved permission rules

## Release Recommendation

**Release:** ship independently

Issue #691 is not part of an architecture-roadmap release batch.
It adds an opt-in permission-prompt capability without changing existing policy defaults, so it should ship as an independent feature release.

## Problem Statement

An interactive `ask` decision can currently approve one request or add the gate's suggested rule to the in-memory session ruleset.
Persisting the same approval requires the user to reconstruct its permission surface and wildcard, find the right config file, and edit policy outside the decision context.
That repetition creates approval fatigue and makes accidental over-broad policy more likely.

Issue #603 already requests project-scoped persistence from the prompt.
Issue #691 subsumes that narrower request and adds global scope, editable suggestions, a project-local destination, trust gating, an optional sticky summary, atomic writes, audit logging, and fail-closed behavior.
Issue #604 remains related because editing the proposal also lets a user widen a local session approval manually, but this issue does not add a configurable default suggestion granularity.

## Goals

- Let a direct interactive user approve once, approve an editable proposal for the session, or persist it at project or global scope.
- Make the exact surface, complete pattern list, action, scope, and destination available in an optional pre-save summary.
- Write automatic project approvals only to trusted-project `.pi/extensions/pi-permission-system/config.local.json`.
- Load the local project file after shared project `config.json` while keeping global-agent and project-agent policy higher in precedence.
- Preserve unrelated JSONC comments, formatting, fields, rule order, and rules while appending the approved rule at last-match-wins precedence.
- Validate and write atomically, reload policy immediately, and block the pending call when persistence fails.
- Keep explicit denies and most-restrictive cross-surface composition authoritative.
- Record persistence requests, success, and failure in the permission review log.
- Credit [PR #73] and preserve its authorship for any source code carried forward.

This change is not breaking.
Existing hotkeys and decisions keep their behavior, no rule is written without a new explicit user choice, and project-local policy remains trust-gated.

## Non-Goals

- Do not persist approvals selected in forwarded subagent prompts in this release.
  Forwarded prompts keep their current once, requesting-session, and serving-session choices without edit or durable options.
  Requester-side persistence requires a separate forwarding-protocol change so the requester can check its own project trust and report write failure before execution.
- Do not let an `Authorizer` chain link, model judge, non-UI terminal, or automatic decision write policy.
- Do not modify shared project `config.json`, Pi `settings.json`, per-agent frontmatter, or `.gitignore` automatically.
- Do not add a configurable default pattern breadth for #604.
- Do not alter the capability or permission-surface model being considered in #639.
- Do not make a global rule override higher-precedence project or per-agent policy.
- Do not weaken `path` / `external_directory` most-restrictive composition or the authorizer delegation envelope.

## Background

The current ask path is:

1. A gate creates a `SessionApproval` carrying the evaluated surface and one or more suggested patterns.
2. `GateRunner` passes its serializable projection through `PromptPermissionDetails`.
3. `AuthorizerSelection` invokes the live chain and then `LocalUserAuthorizer` for a direct UI session.
4. `requestPermissionDecision` dispatches to the inline TUI component or the `select()` / `input()` fallback.
5. `GateRunner` records the original proposal in `SessionRules` only for `approved_for_session`.

The inline prompt is already split between a pure reducer (`permission-prompt-decision.ts`) and a thin TUI adapter (`permission-prompt-component.ts`).
The fallback path in `permission-dialog.ts` remains the supported UI abstraction for RPC and custom frontend embeddings, so durable choices must work there as well as in TUI mode.

`FilePolicyLoader` currently reads one dedicated project file, and `loadAndMergeConfigs` uses the same source for runtime config.
Both paths are gated by the `projectTrusted` decision added in #644.
The new local file must participate in both paths after shared project config and must inherit the same invalid-higher-scope fail-closed behavior.

[PR #73] by `rienkim` implemented valuable prior art: editable candidate patterns, project/global persistence, config upsert, atomic temporary-file replacement, tests, and documentation.
It closed unmerged without discussion or a stated reason, its branch was deleted, and current `main` is thousands of commits beyond its base.
Its design wrote shared project config directly, lacked current trust and confirmation boundaries, and rewrote JSONC wholesale, so the implementation should port applicable concepts rather than resurrect the patch.
If source is copied or closely adapted from commit `1b27ab6`, the relevant commit must retain `Co-authored-by: rienkim25 <github@rienkim.com>`.

Open [PR #675] adds Pi `settings.json` policy sources.
Whether or not it lands first, the new dedicated local file has one stable precedence requirement: global sources < shared project settings/config < project-local config < global-agent policy < project-agent policy.
If #675 lands before implementation, extend its source-merging helper and cache stamp rather than introducing a parallel merge path.

Package constraints that apply:

- Config is the source of truth, and all file input is strictly validated.
- Project policy is unavailable until `ctx.isProjectTrusted()` returns `true`.
- Pattern maps are last-match-wins.
- `path`, `external_directory`, per-tool, and `bash` gates compose most-restrictively.
- Review-log writes go through `PermissionSessionLogger` so existing structural redaction and owner-only file modes remain in force.
- `PermissionManager` stays string-based and must not import `AccessPath`.

## Design Review

Adding persistence directly to the existing dependency bags would make already-wide wiring worse.
The following structural corrections belong in this feature rather than a separate refactor.

| Smell                          | Location                                                                                 | Evidence                                                                                         | Planned correction                                                                                    |
| ------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Wide interface                 | `AuthorizerSelectionDeps`                                                                | Seven fields; three exist only to construct `LocalUserAuthorizer`                                | Replace those three fields with a `createLocalAuthorizer(ctx)` factory                                |
| Growing dependency bag         | `LocalUserAuthorizerDeps`                                                                | Five fields before persistence; adding paths, trust, writer, and logger would exceed one concern | Inject `PermissionPromptPresenter` and `PersistentApprovalService` collaborators beside the event bus |
| Scope-coupled result           | Prompt returns `PermissionPromptDecision` directly                                       | UI choice and policy mutation would otherwise be conflated                                       | Return a private `InteractivePermissionChoice`, then resolve it at the local-authority boundary       |
| Raw dependency cluster         | Destination path, trust state, and scope                                                 | These values must agree at summary and write time                                                | Introduce a `PersistentApprovalTarget` value object resolved by one service                           |
| Repeated persistence mechanics | `ConfigStore.save` and forwarding writes already implement partial atomic-write patterns | Reusing either directly would rewrite JSONC or couple unrelated policy                           | Add one focused JSONC-preserving permission writer and leave existing writers unchanged               |

No current Law of Demeter reach-through, output-argument mutation, or scattered reset needs a preparatory refactor.
The decision-state comparisons remain centralized in the prompt reducer, prompt-to-authority adapter, and pure gate, so new variants must extend those exhaustive dispatch points rather than adding ad hoc string checks.

## Design Overview

### Interactive choice is separate from final authority

The prompt layer returns a private choice rather than performing file IO:

```typescript
type InteractivePermissionChoice =
  | { kind: "allow_once" }
  | {
      kind: "allow_session";
      proposal: PermissionRuleProposalData;
      grant: "requesting_session" | "serving_session";
    }
  | {
      kind: "persist";
      scope: "project" | "global";
      proposal: PermissionRuleProposalData;
      target: PersistentApprovalTarget;
    }
  | { kind: "deny"; reason?: string };

interface PermissionRuleProposalData {
  surface: string;
  patterns: readonly string[];
}
```

`LocalUserAuthorizer` is the only adapter from this choice to `PermissionPromptDecision`.
An allow-once choice maps to the existing `approved` decision.
A session choice maps to the existing session state and carries the edited proposal back to `GateRunner`, which records that returned proposal instead of the descriptor's original one.
A durable choice calls `PersistentApprovalService.persist()` and returns `approved` only after the service succeeds.
A persistence failure maps to a denied decision with an actionable reason, so the pending tool call is blocked.

The public cross-extension `Authorizer` verdict remains `allow | deny | defer` and cannot construct a durable choice.
Forwarded asks do not receive durable or edit options, and the forwarding request/response schema is unchanged.

### Prompt behavior

Local asks start with the gate's complete proposal, including every pattern from multi-path `external_directory` gates.
The user may edit patterns before choosing session, project, or global scope.
For multiple patterns, the editor presents each pattern explicitly rather than flattening them into an ambiguous delimiter-separated string.
Blank patterns and duplicates are rejected before confirmation.

The inline reducer gains `edit` and optional `persistent-confirm` steps while retaining its pure state-machine design.
The TUI component renders state, translates keystrokes, and persists the sticky `showPersistenceSummary` preference through the config store.
The fallback uses `select()` and `input()` to expose the same choices to RPC/custom frontends.

When enabled, the durable summary displays:

```text
Scope:   project-local
Surface: bash
Patterns:
  - gh workflow run *
Action:  allow
File:    <cwd>/.pi/extensions/pi-permission-system/config.local.json
```

The summary defaults on and can be toggled persistently with `t` in the inline prompt or through `/permission-system` settings.
When disabled, a project or global persistence choice saves without a separate summary or typed acknowledgement.
Cancellation at any edit or summary step returns to a safe earlier step or denies without writing.

### Target resolution and trust

`PersistentApprovalTargetResolver` derives only two targets:

```typescript
interface PersistentApprovalTarget {
  scope: "project" | "global";
  path: string;
}
```

The project target is unavailable when `ctx.isProjectTrusted()` is false.
The service rechecks trust immediately before a project write to close the prompt-to-write race.
Global persistence remains available in an untrusted directory, but policy reload must pass `undefined` rather than that cwd so the reload cannot accidentally activate untrusted project config.

The extension does not inspect Git tracking state or edit `.gitignore`.

The writer rejects a destination that resolves outside the expected global or project root and does not follow a final-component symlink.
It uses a unique owner-only temporary file in the destination directory and an atomic rename.

### JSONC-preserving rule mutation

Add `jsonc-parser` as a direct runtime dependency and use its edit API rather than serializing the parsed object.
The writer:

1. Reads the original bytes or starts from an empty object.
2. Rejects an existing file that cannot be parsed or validated.
3. Upserts `permission.<surface>.<pattern> = "allow"` for every proposed pattern.
4. Converts a string surface shorthand to `{ "*": <old-action>, ...newRules }` without changing its meaning.
5. Moves an existing identical pattern to the end of that surface map so the approved rule has the documented last-match-wins position.
6. Preserves unrelated comments, whitespace, fields, and pattern order.
7. Parses and validates the complete candidate against `unifiedConfigSchema` before touching the destination.
8. Writes and fsyncs a unique temporary file, then renames it over the destination.
9. Restores the original bytes atomically if the subsequent policy reload throws.

The writer mutates only the chosen destination.
Project persistence never falls back to shared `config.json` when `config.local.json` cannot be written.

### Project-local source precedence

Add `getProjectLocalConfigPath(cwd)` and thread it through both config pipelines.

For runtime config, `loadAndMergeConfigs` merges trusted project sources in this order:

1. Legacy project policy.
2. Shared project `config.json`.
3. Project `config.local.json`.

For policy, `FilePolicyLoader.loadProjectConfig()` merges the shared and local dedicated files into the existing `project` scope before global-agent and project-agent frontmatter are applied.
Its cache stamp and resolved-path report include both files.
An invalid present local file marks the project scope invalid, preserving #646's allow-to-ask clamp.
An untrusted project reads neither shared nor local project sources.

### Immediate application and deny preservation

After a validated atomic write, `PersistentApprovalService` rebuilds the active `PermissionManager` with the same trust decision used by the lifecycle gate.
The pending request is allowed by the direct human decision only after write and reload succeed.
Subsequent requests resolve through the normal file-backed policy.

A persisted allow affects only its originating surface.
A `path` or `external_directory` deny on another gate still blocks through the existing sequential gates and most-restrictive composition.
Higher-precedence per-agent policy also remains authoritative.
The confirmation explains when a global rule may still be restricted by project or agent policy; persistence does not claim to override that policy.

### Review logging

`PersistentApprovalService` writes structured events through `ReviewLogger`:

- `permission_rule.persistence_requested`
- `permission_rule.persistence_succeeded`
- `permission_rule.persistence_failed`

Each entry records request ID, scope, surface, patterns, destination, and a bounded failure category/message.
`PermissionPrompter` keeps its existing waiting/approved/denied bracket, with durable success distinguished by metadata on the final local decision.
No automatic authorizer path receives the persistence service.

## Module-Level Changes

### New production modules

- `src/authority/interactive-permission-choice.ts` — private choice and proposal-data unions shared by TUI and fallback presenters.
- `src/persistent-approval-target.ts` — target value object, project/global path resolution, and trust eligibility.
- `src/persistent-permission-writer.ts` — JSONC-preserving rule upsert, strict candidate validation, path/symlink checks, atomic replace, and restoration primitive.
- `src/persistent-approval-service.ts` — prepare/persist orchestration, trust recheck, policy reload, failure mapping, and review logging.

### Changed production modules

- `src/config-paths.ts` — add `getProjectLocalConfigPath(cwd)`.
- `src/config-loader.ts` — load trusted `config.local.json` after shared project config for runtime config and report its issues.
- `src/policy-loader.ts` — add the local path option/cache stamp, merge it after shared project policy, preserve invalid-scope semantics, and report its resolved path.
- `src/permission-manager.ts` — derive the local project path in `PolicyLoaderOptions`; keep trust-sensitive reload callers passing cwd or `undefined` explicitly.
- `src/config-reporter.ts` — include project-local path/existence in resolved-config review entries.
- `src/authority/permission-prompt-decision.ts` — add local edit/project/global choices and confirmation states while preserving existing once/session/deny behavior.
- `src/authority/permission-prompt-component.ts` — render/edit complete proposals and durable confirmations; return `InteractivePermissionChoice`.
- `src/authority/permission-dialog.ts` — make the fallback return the same private choice and expose edit/final-confirm flows through `select()` / `input()`.
- `src/authority/local-user-authorizer.ts` — resolve choices, invoke persistence only for local direct asks, carry edited session proposals, and preserve the pre-dialog UI event.
- `src/authority/authorizer.ts` — replace the three local-construction dependencies with `createLocalAuthorizer(ctx)` and keep the UI/subagent/deny dispatch centralized.
- `src/authority/authorizer-selection.ts` — accept the narrowed factory-based selection dependencies without changing per-ask chain composition.
- `src/authority/permission-prompter.ts` — include durable decision metadata in the existing review-log bracket.
- `src/permission-gate.ts` — return the edited session proposal selected by the direct prompt instead of assuming the original descriptor proposal.
- `src/handlers/gates/runner.ts` — record the proposal returned by the gate result; persistent decisions arrive as ordinary approved decisions only after successful mutation.
- `src/index.ts` — construct the target resolver, writer, persistent service, and local-authorizer factory from per-session dependencies.
- `package.json` and root `pnpm-lock.yaml` — add the audited `jsonc-parser` runtime dependency.

If #675 lands first, its `settings-policy.ts`, scope merge helper, policy path report, and related tests become additional touch points.
The implementation must rebase before cycle 1 and update this file list rather than duplicating its source machinery.

### Tests

- `test/config-paths.test.ts`
- `test/config-loader.test.ts`
- `test/config-pipeline.test.ts`
- `test/policy-loader.test.ts`
- `test/permission-manager-unified.test.ts`
- `test/config-reporter.test.ts`
- `test/config-store.test.ts`
- `test/authority/permission-prompt-decision.test.ts`
- `test/authority/permission-prompt-component.test.ts`
- `test/authority/permission-dialog.test.ts`
- `test/authority/local-user-authorizer.test.ts`
- `test/authority/authorizer.test.ts`
- `test/authority/authorizer-selection.test.ts`
- `test/authority/permission-prompter.test.ts`
- `test/permission-gate.test.ts`
- `test/handlers/gates/runner.test.ts`
- `test/composition-root.test.ts`
- New focused tests for target resolution, JSONC mutation, and persistence orchestration.

### User-facing and architecture documentation

- `README.md` — add durable prompt choices, destinations, trust behavior, and precedence.
- `docs/configuration.md` — document `config.local.json`, source precedence, the sticky summary preference, JSONC preservation, rollback/removal, and global limitations.
- `docs/session-approvals.md` — distinguish once, edited session, project-local, and global lifetimes.
- `docs/troubleshooting.md` — include the local path in resolved-config output and persistence-failure guidance.
- `docs/architecture/architecture.md` — add the new modules and project-local source to current-behavior diagrams/module trees without adding roadmap provenance.

No schema regeneration is needed because the `permission` shape is unchanged.

## Test Impact Analysis

1. New pure prompt tests cover option availability, local pattern editing, multi-pattern navigation, confirmation strength, cancellation, and forwarded-option suppression.
2. New writer tests cover empty files, JSONC comments, string-surface expansion, existing-pattern relocation, multi-pattern atomicity, invalid input, symlinks, destination escape, rename failure, and restoration.
3. New source-loading tests cover global/shared-project/local-project/global-agent/project-agent precedence and invalid local fail-closed behavior.
4. New service tests cover trust loss between prepare and persist, global reload in an untrusted cwd, successful reload, reload rollback, and review events.
5. Existing fallback dialog tests remain and are updated to assert the new private choice rather than a final decision.
6. Existing TUI reducer/component tests remain the regression surface for once/session/deny/reason/scope hotkeys.
7. Existing forwarding tests remain unchanged and gain assertions that forwarded asks expose no edit/project/global choices and emit no persistence event.
8. Existing `GateRunner` tests remain the layer test for recording session rules; new cases prove edited patterns replace the original proposal while durable success does not add a session rule.
9. Existing composition-root trust and same-cwd session-isolation tests remain unchanged and are supplemented by one filesystem-backed local/global persistence round trip.

## Invariants at Risk

- **Project trust gating (#644).**
  `config.local.json` must be skipped on both runtime and policy paths when untrusted, and trust must be rechecked at mutation time.
  Pin with config-loader, lifecycle/composition, and service tests.
- **Invalid higher scope fails closed (#646).**
  A present invalid local file must mark project scope invalid and floor inherited allows to `ask`.
  Pin with policy-loader and manager integration tests.
- **Single UI-prompt event site (#292/#555).**
  `LocalUserAuthorizer` must emit `permissions:ui_prompt` once before any interactive choice.
  Preserve the ordering assertion in `local-user-authorizer.test.ts`.
- **Authorizer links are live-only (ADR 0007).**
  Chain `allow` continues to map only to `approved`; no registry or chain interface receives persistence capability.
  Pin with authorizer-chain and local-authorizer construction tests.
- **Forwarding disclosure and authority boundary (ADR 0008).**
  No requester cwd, target, or durable choice enters the forwarding schema in this release.
  Pin with existing tolerant parser tests plus option-suppression tests.
- **Most-restrictive path composition.**
  Persisting an allow on one surface must not bypass `path` or `external_directory` deny on another.
  Pin with composition-root tests that persist a per-tool allow while a cross-cutting deny remains blocking.
- **Session approvals remain ephemeral.**
  The existing session option writes only `SessionRules`, even after editing, and still clears on shutdown.
  Pin with existing shutdown tests plus edited-session round-trip coverage.
- **JSONC source integrity.**
  Unrelated comments, formatting, fields, and rule order remain byte-identical outside the edited spans.
  Pin with full-string writer assertions, not parsed-object subset assertions.

## TDD Order

1. **Project-local source loading.**
   Add red path/loader/policy/reporter tests for `config.local.json`, precedence, trust skipping, cache invalidation, and invalid-local fail-closed behavior.
   Implement the path and both load pipelines, adapting to #675 first if it has landed.
   Run package typecheck and the full package suite because `PolicyLoaderOptions` and `ResolvedPolicyPaths` are shared interfaces.
   Commit: `feat(pi-permission-system): load project-local permission overrides (#691)`.

2. **JSONC-preserving atomic writer.**
   Audit and add `jsonc-parser`, then add focused red tests for rule upsert, string-surface expansion, last-match order, multi-pattern atomicity, preservation, validation, containment, symlink rejection, IO failure, and restoration.
   Implement `persistent-permission-writer.ts` and keep it independent of UI and session state.
   Commit: `feat(pi-permission-system): add atomic persistent rule writer (#691)`.

3. **Persistent target and orchestration service.**
   Add red tests for target paths, trust eligibility/recheck, global reload without untrusted project scope, project reload, review events, and rollback on reload failure.
   Implement the target resolver and service over narrow writer/reloader/logger interfaces.
   Commit: `feat(pi-permission-system): orchestrate durable approval persistence (#691)`.

4. **Pure interactive-choice model.**
   Add red reducer tests for local edit/project/global choices, multiple patterns, cancellation, sticky summary enablement, and complete summary data.
   Keep forwarded configuration on the current four-option model.
   Implement the private choice union and pure state transitions alongside the existing final-decision types so the repository remains type-correct.
   Commit: `feat(pi-permission-system): model durable permission choices (#691)`.

5. **TUI and fallback presentation.**
   Add red component and fallback tests that render the same choices, edit every proposed pattern, show the exact destination when enabled, and persist the sticky summary preference.
   Change both presenters to return `InteractivePermissionChoice` while keeping current once/session/deny behavior and non-TUI support.
   Update all presenter test fixtures in the same commit because the return type changes across the TUI/fallback boundary.
   Commit: `feat(pi-permission-system): present editable durable approval choices (#691)`.

6. **Local authority and session-proposal wiring.**
   Add red local-authorizer, pure-gate, runner, and selection tests for edited session recording, durable success/failure, forwarded suppression, and no persistence capability in the authorizer chain.
   Introduce the local-authorizer factory, narrow the dependency bags, resolve private choices, and thread returned edited session proposals through `PermissionPromptDecision` → `applyPermissionGate` → `GateRunner` in one compile-coupled commit.
   Preserve the UI-event ordering and prompt review-log bracket.
   Commit: `feat(pi-permission-system): apply direct durable approval choices (#691)`.

7. **Composition and security regressions.**
   Add filesystem-backed composition tests for bash, path-bearing tools, `path`, `external_directory`, project/global precedence, project trust, write failure, reload failure, session shutdown, and cross-surface denies.
   Fix only integration gaps revealed by those tests; do not broaden forwarding.
   If code from [PR #73] was carried forward in cycles 2–6, add its `Co-authored-by` trailer to the corresponding implementation commit before publication.
   Commit: `test(pi-permission-system): cover persistent approval integration (#691)`.

8. **Documentation.**
   Update the README, configuration, session approval, troubleshooting, and current architecture documentation.
   Document how to remove a persisted rule, why project-local files should be ignored, how the sticky summary preference behaves, and why higher-precedence denies still win.
   Commit: `docs(pi-permission-system): document persistent approvals (#691)`.

## Risks and Mitigations

- **A malicious or stale project loosens global policy.**
  Require Pi project trust at load, offer, and write time; write only the local project file; retain higher-precedence and cross-surface denies.
- **A convenience feature becomes an automatic policy-writing capability.**
  Keep the private choice and persistence service exclusively behind `LocalUserAuthorizer`; automatic links never receive them.
- **A write corrupts config or strips operator context.**
  Use JSONC edits, validate the complete candidate, write a same-directory temporary file, and preserve/restore original bytes on failure.
- **A local file leaks personal paths or policy if committed.**
  Keep it in a dedicated `config.local.json` and document that users should ignore it rather than modifying `.gitignore` automatically.
- **An existing surface string loses catch-all meaning.**
  Expand it to an explicit `"*"` entry before appending the narrower rule and test exact resulting text and behavior.
- **A global rule appears ineffective because a higher source wins.**
  State this in the confirmation and docs; never bypass project, project-agent, or another permission surface to make the global rule win.
- **Open PR #675 creates source-order conflicts.**
  Rebase before implementation and extend its merge/cache primitives if present; a precedence integration test pins the combined order.
- **Prompt complexity harms the fast path.**
  Keep existing hotkeys and double-press behavior, show durable choices only for local asks with a proposal, and place editing/confirmation in explicit substeps.
- **Multi-pattern asks persist only what the UI happened to display.**
  Carry and show the complete proposal list and write it as one atomic batch.

## Open Questions

- The exact TUI keys for project, global, and edit may be adjusted during cycle 4 if they conflict with current editor behavior, but the semantic choices and confirmation requirements are fixed.
- If `jsonc-parser` cannot satisfy byte-preservation assertions for an existing-key relocation, prefer a smaller custom span edit for that operation rather than falling back to whole-file serialization.
- Requester-side persistence for forwarded asks is deferred until the protocol can return the human choice to the requester, which must check its own trust and perform the write.

[PR #73]: https://github.com/gotgenes/pi-packages/pull/73
[PR #675]: https://github.com/gotgenes/pi-packages/pull/675
