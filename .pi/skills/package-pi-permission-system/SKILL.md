---
name: package-pi-permission-system
description: |
  Package-specific context for @gotgenes/pi-permission-system.
  Load when working on code, tests, or docs in packages/pi-permission-system/.
---

# pi-permission-system

Pi extension that enforces deterministic permission gates over tool, bash, MCP, skill, and special operations so the agent cannot silently exceed the policy a user has configured.

This package is a full fork of [`MasuRii/pi-permission-system`](https://github.com/MasuRii/pi-permission-system).
It began as a config-layout divergence (#10) and has since diverged substantially in config format, internal architecture, and permission model.
The `/permission-system` slash command name is the only upstream identity preserved.

Read `docs/plans/` before making architectural changes.
Pre-monorepo plans from the upstream fork live in `docs/plans/archive/` — issue numbers there refer to the upstream repo, not this monorepo.

`docs/architecture/architecture.md` tracks the improvement phases as a flat numbered step list plus a Mermaid graph — one issue per step, never a chain inside a single node label.
When a plan touches that roadmap, enumerate the whole phase: search dependents too (`gh issue list --search "#N"`), not just the issues the current one references.
When the implementation completes a numbered roadmap step, mark it complete in `docs/architecture/architecture.md` in the implementation doc-update commit (`/tdd-plan` step 7 / `/build-plan`), not a deferred `/ship-issue` commit — `✅` on both the step heading and its Mermaid diagram node, plus any stale health-metric/target rows in the same commit.
Deferring the marker to ship splits it from the work and risks it falling through entirely (Refs #479, #480).
A dated `Baseline (<date>)` column is a fixed phase-open snapshot recomputed at phase close, not a per-step value — do not edit it as work lands (Refs #573).

## Implementation Priorities

- Default to least privilege — when in doubt, prompt (`ask`), do not silently allow.
- Enforce permissions deterministically; the same policy + same input must always produce the same decision.
- Keep config files the source of truth; do not bake policy into code.
- Hide denied tools from the agent before it starts (tool filtering + system-prompt sanitization).
- Keep block/ask/allow decisions reviewable: write to the permission review log by default.
- Preserve the `/permission-system` slash command name — renaming it is a breaking change.
- In the flat permission format, `permission["*"]` is the universal fallback; pattern ordering is last-match-wins.
- The four path layers (`path`, `external_directory`, per-tool, `bash`) compose with **most-restrictive-wins** across surfaces: a more-permissive rule on one surface cannot loosen a more-restrictive rule on another (`ask` > `allow`).
  So a `path` allow cannot suppress an `external_directory: ask` prompt — allow outside-CWD directories on `external_directory`, not `path`.
- `path` and `external_directory` each carry a **read/write axis** (ADR 0013 §3–§4, Refs #806), and the two directions are independent bits, not tiers — a `path_write` allow grants no read, a `path_read` deny floors no write.
  A bare family key is **load-time sugar**: `expandDirectionalSugar` (`src/normalize.ts`), called once per scope inside `mergeScopesWithOrigins` before origin bookkeeping and the merge, rewrites it into both directional members, sugar entries first and explicit directional entries appended after, whatever the file's key order.
  Expanding after composition would attribute every expanded rule to `builtin`; do not move it.
  `SessionRules.approve` expands the same way, because a session approval is a policy source under §9.
  After expansion **no rule lives on a bare family surface**, so a bare-family query is answerable only because `PermissionResolver.resolve` folds it over the members, most-restrictive, returning the losing member's own result (the §10 blame fact).
  The fold sits at the resolver, not the gates, because that is the one entry point the gates, `LocalPermissionsService`, and `ServingPolicy` share — a serving node resolving a forwarded child request against an emptied bare surface would stop hard-denying what the parent's config denies (the #712 defect class), so neither bash path gate needed a routing diff.
  Do not "simplify" it back down into the gates.
  That composition — `buildResolvedIntentFromMatchValues` plus `resolver.resolve` — is pinned by the `ServingPolicy resolves a forwarded request against real recorded authority` block in `test/authority/forwarded-request-server.test.ts`; every other test in that file stubs `policy`, so none of them would catch a regression there.
  The family vocabulary lives in `src/access-intent/path-surfaces.ts` (`surfaceFamilyOf`, `surfaceFamilyMembers`, `capabilitySurfaceForEffect`, `capabilitySurfaceForTool`) and derives the relation from a family set plus a suffix list, so each of the four names is spelled exactly once; a literal-name grep therefore reads zero by design.
  Every proof source reaches a surface through `capabilitySurfaceForEffect(family, effect)`; `capabilitySurfaceForTool` is that function over a private `effectProvenByTool`, so a tool's identity and a bash proof cannot route differently.
  A gate names the narrowest surface *something* proves — `read`/`grep`/`find`/`ls` → `*_read`, `write` → `*_write`, and `edit`, an MCP tool, or an extension tool → the bare family, which folds both.
  Since #807 a **bash path token** carries its own `TokenEffect` (`src/access-intent/effect.ts`) rather than always falling to the family: a redirect operator proves its destination (`>`/`>>`/`>|`/`&>` write, `<`/`<<<` read, a descriptor destination collects no token at all), and the frozen 21-word `PURE_READER_CORE` in `src/access-intent/bash/command-effects.ts` proves a read for the tokens its command owns.
  Attribution is per **token**, tagged where the token is produced, so `cat ~/a | tee ~/b` reads `~/a` and leaves `~/b` unproven, and a nested execution keeps its own command's attribution.
  Three constraints carry the safety argument and must not be relaxed casually: a core word matches as a **bare basename only** (`./grep` proves nothing — rejected on the separator characters directly, so the module needs no `PathFlavor` and stays fail-closed on both platforms); `find`/`fd`/`sort` carry retraction guards whose match is fail-closed over the option forms and which yield `{ effect: "unproven", source: "retracted" }` rather than a write; and an unrecognized redirect operator proves nothing rather than dropping the token, since dropping removes a path from the gates entirely.
  Both dedup loops in `bash-path-resolver.ts` keep the effect **out** of the dedup key and merge a repeat through `mergeTokenEffects` — keying on it would split `cat ~/a > ~/a` into two prompt entries, and two disagreeing proofs fold to unproven, which consults both directions anyway.
  A bash session approval is narrowed to the proven direction, so a write grant does not silence a later read of the same path (#813 is the affordance to widen it at the prompt); `bash-external-directory.ts` falls back to the bare family whenever one ask's paths disagree, which is exactly today's width and never wider.
  Each bash gate stamps `effect`/`effectSource` on its `logContext`, so `{ effect: "unproven", effectSource: "retracted" }` reads as "`find` is core and `-delete` withdrew the claim" rather than "nobody knows".
  `docs/configuration.md` publishes the roster between `<!-- BEGIN PURE_READER_CORE -->` markers and a parity test in `test/access-intent/bash/command-effects.test.ts` fails on drift — edit both or neither.
  Doc guidance to repeat: the useful *grants* are `*_read: allow` and the bare key; `*_write` earns its keep as a *restriction* (`path_write: {"*": "deny"}` is a read-only-agent posture), and a `*_write: allow` alone does not silence an `edit`, which also reads.
- Wildcard matching must be explicit and tested — silent over-matching is a permission bypass.
- `*` already crosses directory boundaries; `**` is not a distinct globstar and compiles identically.
  Write `~/dev/*`, never `~/dev/**` — in config examples, ADRs, schema descriptions, and tests alike (Refs #806).
- Prefer config patterns over new runtime mechanisms.
  Mechanism is forever; docs are reversible.
- Treat any declared config field not read at runtime as a maintenance trap.

### Single source of truth for tool policy

Pi-subagents removed its `disallowed_tools` frontmatter field and `extensions: string[]` allowlist (pi-subagents Phase 14, #237, #238, #239 — shipped).
This package is the **sole authority** for tool access control.
Users migrating from `disallowed_tools` should use `permission:` frontmatter in agent definitions:

```yaml
# Before (pi-subagents, removed in Phase 14)
disallowed_tools: bash

# After (pi-permission-system)
permission:
  bash: deny
```

### Event-based subagent integration

`@gotgenes/pi-subagents` emits a child-execution lifecycle on `pi.events` (`subagents:child:*`); this package subscribes via `subscribeSubagentLifecycle` (`src/authority/subagent-lifecycle-events.ts`) and registers/unregisters child sessions in the `SubagentSessionRegistry` on `session-created` / `disposed` (pi-subagents [#261], [ADR-0002]).
The dependency direction is inverted — pi-subagents has zero knowledge of pi-permission-system.
The `session-created` handler MUST stay synchronous: the core emits it on the same call stack right before `bindExtensions()`, and the event bus dispatches listeners synchronously, so a synchronous handler lands the registry entry before binding proceeds.
The contract is named the **subagent adapter convention**, and `docs/subagent-integration.md` is its canonical spec (ADR 0012 decisions 5–6): cite that section rather than restating channel names, payload shapes, or the pre-bind ordering in another doc.
An implementation owes only the announcement — the two events in-process, `PI_SUBAGENT_PARENT_SESSION` out-of-process — and `SUBAGENT_ENV_HINT_KEYS` is composed from `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` so naming a parent session is itself a detection hint, which is what makes that single obligation sufficient (Refs #789).
Do not split the two lists back apart by adding a parent-session name to only one of them.

A serving session announces that it is draining a forwarded-permission inbox on **two** channels, and `ForwardingManager` publishes to both through one `ServingAnnouncer` (`composeServingAnnouncers`), so adding or removing a channel never reaches the poll loop.
`ParentAuthorizer` asks one collaborator — `ForwardingLivenessJudge` (`src/authority/forwarding-liveness.ts`), a `TargetServingLookup` — whether its **target** is being drained, and abandons a request whose target has looked unserved for `PERMISSION_FORWARDING_SERVING_GRACE_MS` instead of waiting out the full timeout and reporting the block as a user denial (Refs #719, #721).
The judge routes on `PermissionForwardingTarget.source`, which `resolvePermissionForwardingTarget` already produces, so "which channel can answer" is decided where the target is found and never re-derived at the poll loop:

- `source: "registry"` (an in-process child) → the process-global `ServingSessionRegistry` (`src/authority/serving-registry.ts`, accessor `getServingSessionRegistry()`).
  A stale mark left by a session that died without `session_shutdown` suppresses the fast-fail and falls back to the timeout — the safe direction.
- `source: "env"` (a child in its own process, sharing no `globalThis`) → the filesystem heartbeat at `<forwardingDir>/serving/<encoded-session-id>.json`, holding the served session id, the serving pid, and its refresh time.
  `absent` / `dead_pid` / `stale` all count as unserved; only `alive` keeps the child waiting.
  Absence is deliberately **not** the safe direction here — a cleanly exited parent leaves nothing behind, which is the reported case (#735 scenario 1) — so a parent session running a pre-heartbeat version is fast-failed until it restarts.
  That upgrade-ordering requirement is documented in `docs/subagent-integration.md`; do not "fix" it by treating absence as unknown, which would restore the ten-minute stall.
- `source: "self"` → no channel; the target is never judged.

The heartbeat records live **beside** `sessions/`, never inside it: a record under `sessions/<id>/` would make that session root permanently non-empty and entangle liveness with the request/response cleanup whose removal ordering produced the #398 ENOENT write loop.
For the same reason the `serving/` directory is created on demand and never removed.
`ForwardingManager` re-announces on every poll tick, and that refresh runs **ahead of the `processing` guard** — a parent holding `processInbox` open for a deliberating human is serving throughout, and refreshing behind the guard would let its record decay exactly when it is most demonstrably alive, fast-failing every other child.
A regression test pins it ("re-announces while a drain is still in flight").
Every `ParentAuthorizer` abandonment path sets `confirmationUnavailable: true` with a path-naming `denialReason`; `renderUnavailableDenial` renders that reason, so `PermissionGateParams.unavailableReason` is a function of the decision (as `userDeniedReason` already was), not a precomputed string.
The `forwarded_permission.no_serving_session` entry records `servingChannel` and `servingState` beside the ids observed, since "exited", "killed", and "polling a different session id" are different diagnoses the shared denial string does not distinguish.

**The `SubagentSessionRegistry` is process-global.**
Access it via `getSubagentSessionRegistry()` (`src/authority/subagent-registry.ts`), backed by `globalThis` + `Symbol.for("@gotgenes/pi-permission-system:subagent-registry")`.
This is necessary because each session's `ResourceLoader` creates its own `pi.events` bus: the parent emits `subagents:child:session-created` on its bus and only the parent's instance receives it.
The child's separate jiti instance runs on a different bus and never receives the event — but `getSubagentSessionRegistry()` returns the same global store, so the parent's registration is visible to the child when it checks `isSubagentExecutionContext()`.
Do not instantiate `new SubagentSessionRegistry()` in production code; use the accessor.
This lesson comes from issue [#296]: the regression where `permission-bridge.ts` was retired in favour of `pi.events` registration but the per-session bus split meant the child never saw the registration.

## Configuration

One unified config file per scope, following the `pi-autoformat` convention (`extensions/<id>/config.json`).

- **Global config**: `~/.pi/agent/extensions/pi-permission-system/config.json` (respects `PI_CODING_AGENT_DIR`)
- **Project config**: `<cwd>/.pi/extensions/pi-permission-system/config.json`
- **Per-agent overrides**: YAML frontmatter in agent definition files

Merge precedence: project overrides global; per-agent frontmatter overrides both.
The `permission` object uses deep-shallow merge; scalar fields use simple replacement.

- Zod source of truth: `src/config-schema.ts` (the composable schemas, the `z.infer` config types, and `buildPermissionsJsonSchema`).
- Schema: `schemas/permissions.schema.json` — **generated** from `config-schema.ts` via `pnpm run gen:schema`; never edit it by hand.
  A parity test in `test/config-schema.test.ts` fails on drift (Refs #547).
- Example: `config/config.example.json`
- Keep `config-schema.ts`, example config, `docs/configuration.md`, and `README.md` aligned when the config shape changes — the schema and the config types are both derived from `config-schema.ts`, so it is the one edit point.
- `docs/architecture/architecture.md` inline-copies the core `rule.ts` types (`Rule`, `RuleOrigin`, `Ruleset`).
  Adding or removing a field on one of these must update that listing too — a module-move check misses it, and only the pre-completion reviewer catches it otherwise.
- Config **files** are validated strictly against `unifiedConfigSchema` (`config-schema.ts`) and rejected **fail-closed** on any invalid field (empty scope → universal `ask`), with a clear per-issue message (Refs #547).
  A rejected **non-global** scope (project / agent / project-agent) additionally floors the composed policy `allow`→`ask` (origin `fail-closed`) at composition, so a lower scope's `allow` cannot be silently inherited behind an invalid higher scope; `deny` is preserved, global is excluded, and `yoloMode` re-permits the floored `ask` (Refs #646).
  The loader marks such a scope `ScopeConfig.invalid` (a present-but-unloadable file; an absent file stays a plain empty scope); the manager reads the flags in `resolvePermissions` and appends a fail-closed notice to `getConfigIssues`.
  Per-agent frontmatter stays tolerant — `policy-loader.ts` extracts only its `permission` block via `normalizeFlatPermissionValue`, since frontmatter carries non-config keys; only a whole-file read/parse failure of an existing agent file marks the scope invalid, not a tolerantly-dropped per-key entry.
- When removing a config field, drop it from `unifiedConfigSchema`; configs that still set it are then rejected.
  For a soft-deprecation window, keep the field optional in the schema and ignore its value.
- When adding an optional field to `PermissionSystemExtensionConfig`, do not include it in `DEFAULT_EXTENSION_CONFIG` with an explicit `undefined` value — tests use `deepEqual` and it breaks equality.
- When adding a field, define it in `unifiedConfigSchema` (`config-schema.ts`, with `.meta({ description, markdownDescription })`) and regenerate the schema (`pnpm run gen:schema`); `UnifiedPermissionConfig` is inferred from it.
  Then carry it through `PermissionSystemExtensionConfig` (`extension-config.ts`) and merge it in `mergeUnifiedConfigs()` (`config-loader.ts` — a number goes in its "Number scalars" loop).
  A field on the runtime type but not the merge intermediate is silently dropped before runtime (the #332 / #347 bug class).
  After #356, omitting a field from `UnifiedPermissionConfig` that `normalizePermissionSystemConfig` reads is a **compile error** — `normalizePermissionSystemConfig` reads fields directly from the typed `UnifiedPermissionConfig` parameter, so `tsc` catches the gap immediately.
- When a config example sets a policy for `write`, include the same policy for `edit` — both tools modify files and users expect them gated together.
- `promptMaxRows` (24) and `promptFieldMaxWidth` (400) bound what an ask prompt renders; `resolveRenderBudget` (`src/presentation/dialog-renderer.ts`) owns their defaults, so neither belongs in `DEFAULT_EXTENSION_CONFIG`.
  `reviewLogFieldMaxWidth` (1000) bounds what the review log persists, with its default in `resolveReviewLogFieldWidth` (`src/log-field-cap.ts`), for the same reason.

## Log writes

Both JSONL logs are created owner-only (`0600`, in a `0700` directory) and key-name redacted; the permission-forwarding request/response files are mode-restricted too (but **not** redacted — the parent reads them to render the ask-prompt).
Do not add a log write path that bypasses `writeLine` in `src/logging.ts`, and do not pass a `mode`-less `appendFileSync`/`writeFileSync`/`mkdirSync` for an artifact holding tool input.
`writeLine` is also where the **review** stream's width bound lives (`capLogFieldWidths`, `src/log-field-cap.ts`): every string it writes is narrowed to `reviewLogFieldMaxWidth` (1000) and marked with an ellipsis, so no write path can escape the bound and no producer needs to remember it (the debug stream is deliberately unbounded).
A width cap is **not** redaction and must not be conflated with it: it narrows by length alone and never reads a value to decide what to shorten, and the two compose — a sensitive-keyed value is masked whole however long it was.
The review log persists the payload's request facts (`renderReviewLogFacts`, `src/presentation/review-log-renderer.ts`), stamped by `GateRunner` beside the request id, and no evidence or annotations (ADR 0011 §6); it does **not** persist a prompt sentence — `message` and `renderLegacyMessage` were removed in #746.

Every terminal entry also carries a `decidedBy` provenance record (`DecisionSource`, `src/authority/decision-source.ts`) naming what decided — a human and which surface they answered on, the chain link, a rule, a session grant, yolo, an infrastructure read, an unreachable authority, a gate error, or another session with its own decider nested inside (Refs #726).
It is **stamped at the site that decides**, never derived from the event name or the `resolution` value, and it is required on `PermissionPromptDecision` and `GateBypass` so a resolution path added later cannot omit it; do not add a branch that infers one.
It is not merged into `GateRunner`'s shared `logContext` — that context holds what every resolution of a gate shares, and the decider is by definition not shared.
Because it is nested, both `writeLine` bounds reach it for free (`capLogFieldWidths` recurses through plain objects and arrays; the redaction replacer descends by nature), pinned by regression tests in `test/logging.test.ts`.
The forwarded `ForwardedPermissionResponse.decidedBy` is optional and read through the **depth-bounded** `asDecisionSource` guard: the value comes off disk, and a recursive reader over another process's file is a stack-overflow surface.
The `permissions:decision` bus event deliberately does **not** carry it — the channel's consumers are unknown and it is the narrowest renderer under ADR 0011 §6.
That event is emitted by whichever session *decides*, so a serving session broadcasts one for every forwarded ask it escalates (`ForwardedRequestServer`, #610): the ask's own gate lives in the requesting session, on another bus entirely for an out-of-process child, so a parent-side consumer that marks an agent blocked on `permissions:ui_prompt` would otherwise never see it cleared.
It is rendered from the same `PromptPermissionDetails` the prompt was, carries an optional `forwarding` context, and does **not** fire for a request the serving node's recorded authority resolves — silent there stays silent on both channels.
Redaction is **structural, never value-shape**: `isSensitiveLogKey` (`src/log-redaction.ts`) masks a value because of the key name it is bound to, and a provider-prefix/entropy list was measured against a real 6.7 MB log and declined (403 `sk-` hits, all false positives from `task-*`; zero true positives).
The boundary to repeat verbatim in any doc or reply: a value bound to a sensitive key name is masked; a secret embedded in a bash command string is not.
Redaction is applied at **two** points, and the second is not redundant — `getToolInputPreviewForLog` flattens tool input to a string before the writer sees it, so `serializeRedactedToolInputPreview` (`src/tool-input-preview.ts`) is the only place its keys still exist.
Never redact `formatToolInputForPrompt`: the user must see the real input to decide.
Governing record: `docs/decisions/0010-permission-log-secret-exposure.md` (Refs #647).

The dialog's size bounds are not redaction and must not be conflated with it: `renderPromptDialog` (`src/presentation/dialog-renderer.ts`) applies a *quantity* cap uniformly, never reads a value to decide what to hide, and keeps the complete text one keystroke away (`Ctrl+O`).
A proposed bound that inspects the value to choose what to shorten has become redaction by another name (Refs #710).

## Cross-Extension Integration

### Single-agent core

Pi is single-agent by design; multiple named agents are an external-extension concept (pi-subagents, pi-agent-router), not Pi core.
Per-agent `permission:` frontmatter is an extension bridge on this single-agent core — see `docs/architecture/architecture.md` design principle 9.
Do not propose pushing agent-awareness (an agents directory, frontmatter parsing) into the SDK or core.

### Jiti isolation

Pi's extension loader keeps each extension's module isolated — a variable set in this extension's module is invisible to other extensions.

**Module-scoped state no longer resets per session.**
Since [earendil-works/pi#5905] (shipped in pi-coding-agent — "cache extension imports for session switches"), the loader caches the imported factory function per `(extensionPath, cwd)`.
The factory is still **re-invoked** on every `/new` / `/resume` / `/fork` / `/import` switch (with a fresh `pi`/`ExtensionContext`), so everything constructed *inside* the factory body — `PermissionSession`, `SessionRules`, subscriptions, `pi.on(...)` registrations — is rebuilt fresh each session, and `session_shutdown` still fires.
But the module itself is imported only once per cwd; the cache clears only on `/reload` or a cwd change (`clearExtensionCache`).
So module-scoped mutable state (top-level `let`, module-level caches, memoized values like `getParser = memoizeAsyncWithRetry(...)` in `access-intent/bash/parser.ts`) now persists across same-cwd session switches instead of being reborn each session.
This is safe today (the package's module-scoped state is read-only lookup tables plus the stateless tree-sitter parser — persisting the parser is a win), but **do not park session-scoped or permission-relevant state at module level assuming a per-session reset** — it will leak between sessions in the same cwd.
Keep per-session state inside the factory closure (where it is rebuilt) or in the `session_start`/`session_shutdown`-driven lifecycle.
A regression guard lives in `test/composition-root.test.ts` ("session approvals do not leak across same-cwd session switches").

Shared communication channels:

- **`pi.events`** (the event bus) — for fire-and-forget broadcasts (`permissions:ready` / `permissions:ui_prompt` / `permissions:decision`).
- **`globalThis` + `Symbol.for()`** — process-global by spec, survives jiti isolation.
  Use for direct service access.

The deprecated event-bus RPC channel (`permissions:rpc:check` / `permissions:rpc:prompt`) was removed in #531; the `Symbol.for()` service accessor is the sole cross-extension policy/prompt surface.

**Registrations are node-local** (ADR 0012, `docs/decisions/0012-cross-node-extension-contract.md`, Refs #699, #786).
One process hosts several **nodes** — one session runtime each, with its own gates, registries, and chain — and every node publishes its own service into a session-keyed process-global map, read with `getPermissionsService(sessionId)`.
The key travels as data on the `permissions:ready` payload, which also carries `adjudicatesLocally`; the bus announces, the locator provides, so never put a live capability on a bus payload.
`getRootPermissionsService()` still reads the legacy process-root slot (with the #302 child guard intact) but is deprecated, emitting a once-guarded `process.emitWarning` (`PI_PERMISSION_SYSTEM_DEP0001`) — removal is a future major.
Use the internal `readRootService()` for any in-package read, or the package warns the host about a call the host did not make.
The locator's `sessionId` is required, and a no-argument call answers `undefined` with a once-guarded `PI_PERMISSION_SYSTEM_WARN0001` warning rather than falling back to the root slot — the names were reclaimed from the `*ForSession` spelling in #794, so a consumer built against the pre-rename major reaches that path.
A link registered on a relaying node is **accepted and observed**, never refused: `ObservedAuthorizerRegistrar` (`src/authority/authorizer-registry.ts`) records `authorizer_link_vacant`, so registering everywhere stays the correct default for a sibling author and nothing is silent (ADR 0012 decision 4).
`permissions:ready` is broadcast **twice** per session generation — at `session_start` after publication, and again at the node's first `before_agent_start`, which runs after every extension's `session_start` and before any ask (ADR 0012 decision 3, the ready latch, #787).
So the channel fires at least once per session and may repeat: the ready handler alone is a sufficient registration site, and a consumer needs only an idempotence guard, never a second attempt from its own `session_start`.
The contract is fully implemented: the docs consolidation landed in #789, and `pi-permission-model-judge` — its named migration test case — registers from the ready handler alone since #788, with its peer range floored at `>=27.0.0`.

The in-process implementation of `PermissionsService` is `LocalPermissionsService` (`src/permissions-service.ts`).
It routes policy queries through the `PermissionResolver`, not `PermissionManager` directly: a path-shaped surface (`path` / `external_directory` / `read` / `write` / `edit` / `grep` / `find` / `ls`) query builds an `AccessPath` via `buildAccessIntentForSurface` and emits an `access-path` intent, so external queries match the lexical ∪ canonical set the gates do (#503); the normalizer is fetched per call from the session (`getPathNormalizer()`), so the published service answers against the parent cwd.
A `bash` query routes through `resolveBashAdvisoryCheck` (`src/bash-advisory-check.ts`), which decomposes a chained/nested command into its command-pattern units and resolves most-restrictive at parity with the gate (via the shared `resolveBashCommandCheck`), backed by a parser warmed at `before_agent_start`; in the pre-warm window it falls back to a whole-string match, so the advisory answer is never weaker than the gate (#309).
The `session_start`-gated publication (session-keyed plus the #302-guarded root slot), both ready-event emits carrying the node's `sessionId`/`adjudicatesLocally`, and session teardown ordering are all owned by `PermissionServiceLifecycle` (`src/service-lifecycle.ts`), which is injected into `SessionLifecycleHandler` as `ServiceLifecycle` and into `SessionTurnPrep` (`src/handlers/session-turn-prep.ts`) as `ReadyAnnouncer`.
One private `emitReady` builds both payloads from the ctx it is handed, so the `session_start` emission and the latch emission cannot drift; `activate` re-arms the once-per-activation guard, so a reload generation announces twice again.
`SessionTurnPrep` is the `before_agent_start` routine — warm the bash parser, `session.activate`, trust-gated `refreshConfig`, then announce — extracted from `AgentPrepHandler` so the handler keeps the one job its name describes (#787).
It reads the node's chain role through the `AdjudicationRole` seam on `AuthorizerSelection` (whose `activate` runs first, inside `PermissionSession.resetForNewSession`); do not re-derive that role from `detection.isSubagent(ctx)` — `selectAuthorizer` tests `hasUI` first, so a subagent with its own UI adjudicates locally.
Changes to publication timing or teardown order should go through `PermissionServiceLifecycle`, not `index.ts`.

Do not propose module-scoped singletons or Node.js module-cache sharing as a cross-extension communication mechanism — module isolation keeps them invisible to other extensions.

[earendil-works/pi#5905]: https://github.com/earendil-works/pi/issues/5905

The `path` and `external_directory` gates are path-aware for **all** tools, not just the six built-ins (#352).
`getToolInputPath` (`src/access-intent/tool-input-path.ts`) extracts a path for built-ins (`input.path`), MCP (`input.arguments.path`), and extension tools (default `input.path`, or a custom key via a registered extractor); `getPathBearingToolPath` stays built-in-only and now drives the per-tool gate's `AccessPath` (the pipeline builds `normalizer.forPath(getPathBearingToolPath(...))` and emits an `access-path` intent on the tool-name surface, #502), plus the raw decision/log value.
The `ToolAccessExtractorRegistry` (`src/tool-access-extractor-registry.ts`) mirrors `ToolInputFormatterRegistry`: one instance created in `index.ts`, its lookup threaded into `ToolCallGatePipeline`, its registrar exposed cross-extension via `PermissionsService.registerToolAccessExtractor`.
Extension/MCP path gating is default-on (no registration needed); per-tool path maps for extension tools (a custom extractor key that supplies the path via a registered `ToolAccessExtractor`) are a deferred follow-up.

The live-authority layer is a Chain of Responsibility (ADR 0007, `docs/decisions/0007-model-judge-authorizer-chain-adr.md`): `composeAuthorizerChain(links, terminal, query)` (`src/authority/authorizer-chain.ts`) runs registered non-terminal `Authorizer` links (`allow | deny | defer`) ahead of the context-selected `TerminalAuthorizer` (which cannot defer).
The `AuthorizerRegistry` (`src/authority/authorizer-registry.ts`) mirrors `ToolAccessExtractorRegistry`: one instance in `index.ts`, its lookup threaded into `AuthorizerSelection` and its registrar exposed cross-extension via `PermissionsService.registerAuthorizer(name, authorize)`.
`AuthorizerSelection.escalate` resolves the `authorizerChain` config **per ask** (not at `activate`) so a link registered in a late `permissions:ready` handler is honored before the session's first ask (ADR 0007 §4); resolution is config-order, skips an unregistered name with a logged `authorizer_chain_unregistered_link` review event (fail-safe), records the consulted names as `authorizer_chain_resolved` before they run, and wraps each link in the bounded-delegation envelope (`src/authority/delegation-envelope.ts`) so an `allow` on an excluded surface (`external_directory` / `path`) is capped to `defer`.
**One chain per node** (ADR 0007 §7, Refs #727): an ask is adjudicated by the node whose terminal decides it, so a relaying subagent node (`adjudicatesLocally: false` on the `SelectedAuthority` that `selectAuthorizer` returns) resolves **no** links and records `authorizer_chain_delegated` instead — its terminal forwards, and the serving node runs its own chain over the same child-fixed facts.
Do not "fix" a child's empty chain by making `AuthorizerRegistry` process-global: that double-adjudicates every deferring ask and lets a link short-circuit before the serving node sees the request.
The envelope excludes on the **gate** surface (`details.accessIntent.surface`), falling back to the display surface only when no facts are present, so a forwarded ask must carry the child-fixed facts or it is judged on the child's tool name and escapes the exclusion — `buildForwardedAskDetails` (`src/authority/forwarded-request-server.ts`) therefore projects `surface`/`matchValues`/`boundaryValue` off the request, and only those three: `requesterCwd`/`principal` stay off the ask details (Refs #635).
Each link is handed a narrow, session-scoped `PermissionQuery` (`Pick`-style projection of `PermissionsService`: `checkPermission` / `getToolPermission`) so it queries the engine at gate parity rather than reaching for the service via `Symbol.for()`.
The secret-shaped-`path` refinement of the checkpoint and the allow-capable opaque-bash adjudicator that consumes the query are deferred to #620.

## Testing

Shared test fixtures live in `test/helpers/`:

- `session-fixtures.ts` — real-instance builders for `PermissionSession` / `PermissionResolver` tests: `makeRealSession` (builds a real `PermissionSession` from per-collaborator fakes; returns `{ session, paths, logger, forwarding, permissionManager, sessionRules, configStore, gateway }`), `makeFakePermissionManager` (fake `ScopedPermissionManager` with `vi.fn()` stubs — unannotated return type for full mock access; exposes a single `check(intent, sessionRules?)` stub, the one resolution entry point since #478), `makeRealResolver` (real `PermissionResolver` over a fake manager + `SessionRules`; pass shared instances to connect it to a session's manager/rules), plus `makePaths` / `makeLogger` / `makeConfigStore` / `makeGateway` / `makeForwarding`.
  Tests exercising `resolveAgentName` must mock `active-agent` in their own file (the `vi.hoisted` / `vi.mock` pattern), since that mock is module-scoped.
- `handler-fixtures.ts` — `makeCtx`, `makeEvents`, `makeToolRegistry`, `makeToolCallEvent`, `makeCheckResult` (neutral default, override-driven), `makeHandler` (builds a **real** `PermissionSession` + `PermissionResolver` wired into the handler and pipelines exactly as `index.ts`; the `session` override bag maps `checkPermission` onto `permissionManager.checkPermission` and `getActiveSkillEntries` / `getInfrastructureReadDirs` / `getToolPreviewLimits` / `resolveAgentName` onto `vi.spyOn` overrides of the real session; accepts optional `tools: string[]` and `prompter: AskEscalator` (the single-method ask-escalation seam that replaced `GatePrompter` in #556 — stub it as `{ escalate }`); returns `{ handler, events, session, logger, toolRegistry, prompter, recorder, permissionManager, forwarding }` — `session.activate` is the real method, so assert `forwarding.start` instead), `makeSurfaceCheck` / `makeBashCommandCheck` (surface-/bash-dispatching `checkPermission` mocks — pass the result as `session.checkPermission`, applied to `permissionManager.checkPermission`; a `makeSurfaceCheck` key naming a bare family answers for its directional members too, modeling sugar expansion, so key on `path_read` only when the two directions need different verdicts), `getDecisionEvents`.
  `MockGateHandlerSession` now covers only the pipeline-input surface (`ToolCallGateInputs & SkillInputGateInputs`); the wide 17-field intersection mock and the standalone `makeSession` factory are gone (#341).
- `gate-fixtures.ts` — `makeDescriptor`, `makeGateRunner` (constructs a `GateRunner` with four role mocks and returns `{ runner, deps }` so tests can invoke `runner.run(...)` and assert on `deps.reporter.*`, `deps.resolve`, etc.; accepts optional `resolveResult: PermissionCheckResult` shortcut — wraps `resolve` in a `vi.fn` returning that value, taking precedence over the default allow result), `makeReporter` (`DecisionReporter` mock with `writeReviewLog`/`emitDecision` vi.fn stubs), `makeResolver` (`ScopedPermissionResolver` mock — plain object with a single `vi.fn` `resolve` stub; pass a `PermissionCheckResult` to set its default return value; omitting the arg leaves it returning `undefined` so callers must call `mockReturnValue` or pass a result explicitly, #478), `makePathDispatchResolver` (resolver whose single `resolve` dispatches on the `AccessIntent` kind — `tool` keys on `intent.input.path`, `access-path` on any matching entry in `intent.path.matchValues()` — pass a `byPath` map and a `defaultResult`; since #486 the emitted union is `tool | access-path` only, #393, #478, #486), `makeTcc` (bash defaults: `toolName: "bash"`, `input: { command: "cat .env" }` — passing `{ input: { command: "cat .env" } }` explicitly is redundant and can be omitted), `makeGateCheckResult` (path-surface defaults: `toolName: "path"`, `source: "special"`, `origin: "global"`), `makeGateInputs` (mock of `ToolCallGateInputs` for `ToolCallGatePipeline` unit tests — stubs the three query methods `getActiveSkillEntries`, `getInfrastructureReadDirs`, `getToolPreviewLimits`; the resolver is now a separate `makeResolver(makeCheckResult())` passed as the first arg to `ToolCallGatePipeline` — `makeGateInputs` no longer stubs `resolve`), `makeSkillInputInputs` (mock of `SkillInputGateInputs` for `SkillInputGatePipeline` unit tests — single-method stub for `checkPermission`; returns `makeCheckResult()` by default), `makeNotifier` (`GateNotifier` mock — unannotated return type so callers retain full `vi.fn()` access on `warn`).
  `makeRunnerDeps` has been deleted; `GateRunnerDeps` no longer exists.
- `manager-harness.ts` — `createManager` (filesystem-backed `PermissionManager`), `createManagerWithProject` (two-level harness with global + project config dirs and per-level agent files; returns `{ manager, cleanup }` — use when testing project-level or project-agent precedence), `createManagerWithConfig` (permission-map shorthand delegating to `createManager`), `createManagerWithScopes` (global + optional project permission maps delegating to `createManagerWithProject`), `createMissingConfigManager` (manager over nonexistent paths; universal `ask` default), `createInMemoryPolicyLoader` + `createInMemoryManager` (in-memory `PolicyLoader`, no filesystem — pass the loader directly when overriding `platform`), `createAgentDirHarness` (agentDir-layout harness via `getGlobalConfigPath` / `getProjectConfigPath`), and `sessionRule(surface, pattern, action?)` (session-layer `Rule` builder, default action `allow`).
  These were extracted from `permission-manager-unified.test.ts` in #525 (Phase 8 Step 1); import them instead of redefining local manager factories.
- `make-fake-pi.ts` — `makeFakePi` (composition-root harness): runs the real `piPermissionSystemExtension(pi)` factory against a fake `ExtensionAPI` with a real `createEventBus()`, an inspectable `handlers` map, captured `commands`, and a `fire(event, input, ctx)` driver.
  Use it for composition-root wiring tests (handler-registration completeness, shared-instance contracts, teardown, event ordering) — see `test/composition-root.test.ts`.
  Composition-root tests must `vi.stubEnv("PI_CODING_AGENT_DIR", <tmpdir>)` and clear every `Symbol.for()` global slot (`:service`, `:session-services`, `:subagent-registry`, `:serving-registry`) in `afterEach`, since the factory mutates process-global state.

Import from these instead of redefining factories inline.
When a call site needs different defaults from `makeCheckResult`, pass explicit overrides (e.g. `makeCheckResult({ state: "deny", matchedPattern: "*" })`).

Since #478 the manager and resolver each expose a single resolution method (`ScopedPermissionManager.check(intent)` / `ScopedPermissionResolver.resolve(intent)`), so the #393 false-green class is structurally impossible — there is no second method a fixture can stub-but-forget.
`makeHandler` routes the `makeSurfaceCheck` / `makeBashCommandCheck` override onto `permissionManager.check` via an intent→(surface, input) adapter: a `path-values` intent maps to `surfaceCheck(intent.surface, { path: intent.values[0] }, …)` so `path` / `external_directory` overrides apply to bash tokens and tool paths alike (#418).
A test that queries `PermissionManager` **directly** sits below the resolver's family fold, so it must name a directional surface — a bare `path:` config expands onto both members, which is why `permission-manager-unified.test.ts`'s `checkPath` helper defaults to `path_read` (#806).
An inline handler that mocks `permissionManager.check` directly must dispatch on `intent.kind` (`path-values` carries `values`, `tool` carries `input`) and `intent.surface`, or external-directory checks false-green to `allow`.
The gate emitting the intent picks the surface: since #486 every path gate emits `access-path` — the tool/bash path gates on `"path"` and the external-directory gates on `"external_directory"` — and since #502 the per-tool gate also emits `access-path` on the tool-name surface (`read`/`write`/`edit`/`grep`/`find`/`ls`); the resolver unwraps it via `AccessPath.matchValues()` to match a path's typed and symlink-resolved aliases, so the `path` surface and the per-tool surfaces now match the canonical form too (#418, #486, #502).
The gate-emitted `path-values` variant was removed; `path-values` survives only as the resolver-internal `ResolvedAccessIntent` form the string-based manager consumes (so `permissionManager.check` and the `makeHandler` adapter at line above still see `tool | path-values`).
This resolver-internal boundary is a deliberate, formalized seam, not transitional scaffolding (see `packages/pi-permission-system/docs/decisions/0002-path-values-string-boundary.md`, #506): the manager stays string-based and must not import `AccessPath` — a `no-restricted-imports` lint rule on `permission-manager.ts` guards it.

- Test permission resolution (allow/deny/ask decisions across tools, bash, MCP, skills, special).
- Test wildcard matching (bash patterns, skill globs) including over-match and under-match cases.
- Test policy merge precedence: global → project → per-agent frontmatter.
- Test system-prompt sanitization (denied tool lines narrowed out of the `Available tools:` listing, allowed tools preserved).
- Test the external-directory guard for path-bearing file tools, including extension and MCP tools (default-on path gating, #352).
- Test config loading, validation issues, and tolerance of deprecated keys.
- When a change reads a **new** `ExtensionContext` field/method (e.g. `ctx.isProjectTrusted()`), update `makeCtx` **and** grep every hand-built ctx literal — `grep -rln "hasUI:" test/` (18 files cast `as unknown as ExtensionContext` / `as never`).
  These casts bypass `tsc`, so a missing field fails only at the full-suite run, not `check` or the cycle-scoped file (#644: `permission-events.test.ts` surfaced `ctx.isProjectTrusted is not a function` at runtime).
- To test the file-based permission-forwarding round-trip (a subagent's `ask` reaching the parent), do not `await` the child's `pi.fire("tool_call", …)` directly — `ParentAuthorizer.authorize` (`src/authority/approval-escalator.ts`) polls for a response until `getTimeoutMs()` elapses (the `forwardingTimeoutMs` config default is ten minutes).
  Instead: fire without awaiting, poll the parent's `requests/` dir (`createPermissionForwardingLocation(forwardingDir, parentSessionId)`) for the child's request file, write an approval JSON to `responses/<id>.json`, then await the fire.
  Such a test must also announce that the parent is serving — it answers by hand instead of running the parent's poll timer, and without the announcement the child correctly abandons the request as unserved after ~2 s.
  Which announcement depends on how the test's child resolves its target: `getServingSessionRegistry().markServing(parentSessionId)` for an in-process child, and `publishServingHeartbeat(forwardingDir, parentSessionId)` (`test/helpers/forwarding-fixtures.ts`) for one resolving from `PI_SUBAGENT_PARENT_SESSION`.
  See the `subagent registry sharing` and `out-of-process forwarding liveness` tests in `test/composition-root.test.ts`.
  A `ParentAuthorizer` unit test builds its deps with `makeParentAuthorizerDeps` (`test/helpers/forwarding-fixtures.ts`), whose `serving` default reports every target as serving and whose `getTimeoutMs` override makes the timeout path testable without waiting it out.
  A test that targets a liveness path passes `makeLivenessJudge({ forwardingDir, registry?, isProcessAlive? })` instead — the real judge over real records, so a double cannot drift from the routing under test.

## Debugging

When investigating a reported bug:

1. Check the runtime environment: which extensions are loaded, from which paths, and whether any are loaded more than once.
2. Check `.pi/settings.json` and `~/.pi/agent/settings.json` for overlapping package entries.
3. Instrument only after confirming the bug reproduces in isolation.
4. When the bug involves path, filesystem, or platform semantics, check how `@earendil-works/pi-coding-agent` solves it first (local checkout or published source).
   Prefer Node `path` builtins (`path.relative`, `path.win32`/`path.posix`) over hand-rolled comparison; pi's containment idiom is `relative()` + a `..`/absolute-prefix check (case-insensitive on Windows).
   The win32-vs-POSIX decision has a single home: `pathFlavorForPlatform` (`src/path/path-flavor.ts`), which resolves the host `platform` into a `PathFlavor` — the platform's path *language* (syntax `hasPathSeparator`, semantics `bashTokenShape`, equivalence `fold`/`comparable`/`isWithin`/`matchOptions`, plus Node's `impl`) — as one of two cached singletons (`win32PathFlavor` / `posixPathFlavor`) holding the package's only `=== "win32"` comparison (#562).
   `index.ts` performs the one `process.platform` read and injects the resolved flavor into `PermissionManager`, `PermissionSession` (→ `PathNormalizer`, built at the session edge with the flavor + session `cwd`, exposed via `PermissionSession.getPathNormalizer()`, #510), and `SubagentDetection`; the `getPlatform()` accessor was retired once both #511 and #502 folded their reads (#513).
   Hand the normalizer raw tokens (`forPath`/`forLiteral`/`isAbsolute`/`resolveBase`/`joinBase`/`isWithinDirectory`/`isOutsideWorkingDirectory`/`comparableValue`/`isInfrastructureRead`/`approvalPatternFor`); do **not** read `process.platform` inside `src/` — an ESLint `no-restricted-syntax` guard scoped to `pi-permission-system/src` (exempting `index.ts`, the only reader) blocks it, and every path leaf (`path/path-containment` / `access-intent/path-normalization` / `path/pi-infrastructure-read` / `path/canonicalize-path` / `path/approval-pattern` / `rule.ts` / `authority/subagent-context`) takes an injected `PathFlavor`, never a raw `platform` (the `path-utils.ts` grab-bag was dissolved into those focused modules in #505; the three co-rewritten path leaves relocated into `src/path/` in #562).
   The guard bans `process.platform` by text and cannot see a `node:path` import, which is how `deriveApprovalPattern` kept reading the host's `dirname`/`sep` until #655 moved it onto `PathNormalizer.approvalPatternFor`.
   A session-approval glob is scoped on the separator the path value itself carries (`PathFlavor.lastSeparatorIndex`), not the platform's default `sep` — the two differ for a Git Bash token on a win32 host, and using `sep` there widened a directory grant to its parent once the `windowsSeparators` fold normalized both operands.
   To test Windows behavior on a POSIX CI, construct a `win32` `PathNormalizer` with `win32PathFlavor` (or pass `flavor: win32PathFlavor` to `makeRealSession` / the manager) — never `vi.mock("node:path")`.
5. When a report claims a path/permission **bypass** (or that a rule is evadable), or reports a concrete prompt or decision the gate should not have produced, reproduce the literal repro against the running extension before concluding it is already handled — a live decision is stronger evidence than unit tests and can surface adjacent bugs (#493's bypass claim was already fixed, but the live repro exposed a misleading prompt, filed as #507; #712's yolo repro confirmed the report and exposed an unrelated deny-masking hole in the same branch).
6. To quantify a proposed gate change's blast radius, mine the local review log (`~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`) — each `toolName: "bash"` entry carries the unredacted `command`, so a `node -e` scan over the deduplicated set yields a measured percentage instead of an estimate (#694: 2767 commands, three competing options).
   Since #746 a command longer than `reviewLogFieldMaxWidth` (1000) is stored shortened with a trailing `…`, so a scan that must see whole commands should exclude or account for those (measured: 4.3% of command entries).
   The same log answers diagnostic questions: counting an `event` per day and against an adjacent event's timestamps separates populations a code reading treats as one (#727: 43 identical warnings split into 15 relay false alarms and 23 genuine misconfigurations).
   A long-lived JSONL log is a schema-drift surface: entries from 2026-08-17 carry `surface`/`matchedPattern` and no `message`, so a `message`-keyed scan silently drops them.
   Validate a scan against a raw sample from each era before aggregating, and commit the script beside any number a durable record cites (Refs #639).

The gate fails closed (#452).
Every `tool_call` goes through `createFailClosedToolCall` (`src/handlers/tool-call-boundary.ts`), the only `pi.on("tool_call")` target and the sole place an internal `GateOutcome` is translated to the SDK result shape.
A thrown gate is blocked (not allowed), recorded as a `permission_request.blocked` review entry with `resolution: "gate_error"`, and broadcast as a `permissions:decision` under that same minted id — the SDK's `emitToolCall` does not catch a throwing handler, so this boundary must absorb it.
An unparseable bash command (a non-empty command that parses to zero command units) resolves to `ask` with the `<unparseable-bash-command>` sentinel `matchedPattern`, instead of falling through to a permissive top-level `*` — unless an explicit `deny` covers the whole command, which is resolved first so the synthetic ask cannot mask a hard deny into an approvable prompt (Refs #712).
A wrapper unit is flagged by the command enumerator with a `wrapperKind` discriminant (`classifyWrapperWords`, `access-intent/bash/wrapper-analysis.ts`) and floored from `allow` to `ask` via the `WRAPPER_SENTINEL` map: `"opaque-payload"` (`bash`/`sh`/`dash`/`zsh`/`ksh -c`, or `eval`) → `<opaque-bash-wrapper>` (#481); `"indirection"` (`INDIRECTION_WRAPPER_NAMES` = `sudo`/`env`/`xargs`/`time`/`nohup`/`timeout`/`nice`/`parallel`/`rust-parallel`/`rush`/`doas`/`setsid`/`stdbuf`/`watch`/`flock`, plus `find`/`fd` carrying a per-result exec flag via `EXEC_CONDITIONAL_WRAPPERS`) → `<indirection-bash-wrapper>` (#490, extended #575) — so `bash -c "…"` and `sudo aws …` prompt even under a permissive `allow` (an explicit `deny` still wins; a bare `find`/`fd` search is unaffected).
The same module's `executedUnitOf` names the command a wrapper actually runs (`xargs grep foo` → `grep foo`), carried as `BashCommand.executedUnit` → `PermissionCheckResult.executedUnit` → `PromptPayload.request.executedUnit`.
It fails to `null` rather than to a guess, and it deliberately unwraps **through** an opaque payload — `xargs -I{} sh -c 'grep -l x {}'` names `grep -l x {}` — because it answers "what runs", which is a display question.
All three wrapper answers read one vocabulary by design — the shape that floors a unit, the shape that names its inner command, and the shape that exempts it must not drift.

Since #803 the floor is **not** applied to a wrapper whose inner command is a proven pure reader: `isTransparentWrapper` (same module) requires an indirection kind, an inner command reached without passing an opaque layer, `proveCommandEffect(...).effect === "read"` on it, and no write-proving redirect on the enclosing statement.
That unit resolves by the *inner* command's own `bash` rule instead — keeping `command` as the wrapper text, so the prompt, decision value, and session-approval suggestion name what runs — and records `floorExemption: "core-reader"` on the check and the gate's `logContext`.
The branch fires only where the floor would have (the unit's own text resolved to `allow`), which is what makes it structurally unable to weaken an explicit `deny`/`ask`; a `deny` on the *inner* command now reaches the wrapper, which the floor had softened to a prompt.
Do not rebuild the predicate on `executedUnitOf`'s string — that is the fail-open it exists to avoid — and do not test core *membership* in place of the effect proof, or `xargs sort -o /tmp/x` is exempted.
User `commandEffects` declarations deliberately do **not** lift the floor (ADR 0013 §11), and `sudo`/`doas` are ordinary wrappers: the path surfaces gate `sudo cat X` exactly as `cat X`, and `bash: {"sudo *": "ask"}` is the one-line answer, shipped as a `docs/configuration.md` recipe.
The redirect fact comes from `access-intent/bash/redirect-analysis.ts`, the single owner of reading a `file_redirect` node (shared with `token-collection.ts`), because tree-sitter-bash hangs the redirect off the parent `redirected_statement` and `TSNode` exposes no parent; the enumerator relays it down a `UnitScope`, and a nested execution starts fresh.
Both floors and the unparseable sentinel are synthesized *after* the resolver returns, so the composition-stage yolo rewrite cannot reach them; `resolveYoloGrant` (`src/handlers/gates/helpers.ts`), consumed at `GateRunner`'s auto-approve fast path, grants any residual `ask` under `yoloMode` and is the single place that reconciliation lives — do not add a second yolo read to a gate (Refs #712).
The enumerator also strips a leading `variable_assignment` prefix from each command unit so an env-var prefix (`AWS_PROFILE=prod aws …`) cannot defeat a command-pattern rule (#481).
A nested command is enumerated wherever its substitution sits — argument position, a **redirect destination** (`echo hi > $(rm *.txt)`, `cat < <(rm c)`), or an **interpolating heredoc body** (`cat <<EOF` with `$(rm e)`) — and its path operands are projected on the `path`/`external_directory` surfaces from the same positions (#741).
The two questions "is this node a command?"
and "can this node host one?"
are answered by separate sets: `COMMAND_ENUM_SKIP` holds only genuinely inert types (`comment`, `heredoc_end`), while `EXECUTION_HOST_TYPES` (`src/access-intent/bash/nested-execution.ts`, shared with the path surface via `forEachNestedExecution`) holds the redirect and heredoc/herestring types whose subtrees are descended but never emitted.
Conflating them is exactly the bypass #741 fixed, so do not "simplify" a host type back into the skip set.
Quoting needs no handling: tree-sitter-bash emits a `command_substitution` under `heredoc_body` only for a bare `<<EOF`, never for `<<'EOF'`/`<<"EOF"`.
The enclosing unit's text still excludes its redirect (`npm install > out.txt` matches as `npm install`) — 45% of real bash commands carry a redirect, so folding it in would break exact-match rules wholesale.
With `debugLog` on, the boundary writes one `permission.decision` trace per call and a `permission.session_summary` line on shutdown (via `DecisionAudit`); a `toolCalls != allowed + blocked + errors` mismatch logs a warning — a re-opened silent path.

The bash enforcement stack is not limited to the native `bash` tool: the `shellTools` config maps a foreign tool name to `{ commandArgument, workdirArgument? }`, and `resolveShellInvocation` (`src/access-intent/tool-kind.ts`) is the single dispatch point that turns native `bash` *or* an aliased tool (e.g. `@howaboua/pi-codex-conversion`'s `exec_command`) into a `{ command, workdir }` shell invocation — every other tool yields `null` (#574).
The gate pipeline consults it once, parses the command into a shared `BashProgram` (which owns its source command via `commandText()`, so the two bash gates read it rather than re-deriving `input.command`), and routes the aliased command through the same `resolveBashCommandCheck` + bash path/external-directory gates as native bash — so fail-closed, wrapper flooring, and `bash:` rules apply identically.
The aliased tool is gated on the `bash` surface (a session "allow" writes a `bash:` rule) while the invoked tool name is preserved in the review log.
A `workdirArgument` seeds the path-walk's initial base (an implicit leading `cd <workdir>`) so relative tokens resolve against it, and the workdir itself is flagged `external_directory` when outside the session cwd; containment always measures against the session cwd, never the workdir, so an aliased tool cannot widen the sandbox.
`classifyToolKind` stays config-free — the alias consult is a separate function because it needs config and returns a richer product.

## Windows and Git Bash

Platform facts verified against Pi core source during #533 planning:

- **Pi core executes every bash tool command through Git Bash on Windows** (`pi/packages/coding-agent/src/utils/shell.ts`): resolution order is custom `shellPath` → `%ProgramFiles%\Git\bin\bash.exe` → any `bash.exe` on PATH (MSYS2/Cygwin); there is no cmd/PowerShell branch.
  So bash tokens gated on a `win32` host carry POSIX/MSYS path semantics, while tool-input paths (`read`/`write`/`edit`) carry Node `fs` win32 semantics — the two surfaces have **different platforms** on the same host.
- Node `fs` on Windows genuinely resolves `/dev/null` to `C:\dev\null`, so a *tool-input* `/dev/null` prompting is correct behavior; a *bash* `> /dev/null` prompting is a bug — Git Bash's MSYS runtime maps it to the NUL device and never touches the filesystem.
- Pi core rewrites Windows-style `> NUL` redirects to `> /dev/null` before spawning the shell (`normalizeNulRedirects()`, [earendil-works/pi#4731]), because MSYS does not recognize `NUL` and would create a literal undeletable file.
  So `/dev/null` is the canonical device token the gates see on win32 — core actively produces it.
- MSYS interprets POSIX-shaped absolute paths through its mount table: `/dev/*` are runtime devices; `/c/…` is a deterministic drive mount for `C:\…`; `/tmp` is a mount whose Windows target **varies by bash flavor** (Git Bash → `%TEMP%`; MSYS2 → `<msysroot>\tmp`; Cygwin → its own root) and other absolutes (`/usr`, `/etc`, `/mingw64`) resolve inside the install root.
  This package therefore must never map `/tmp` (or any non-drive-mount POSIX absolute) to a concrete Windows path — no `cygpath` shell-outs, no `os.tmpdir()` reads; determinism (same policy + same input → same decision) forbids both.
- Git Bash also accepts Windows-shaped paths (`C:/foo`, `C:\foo`) unchanged, so the drive-letter token handling (#508) and win32 case folding (#382) apply to those shapes on both surfaces — the MSYS semantics above are *additive* branches for POSIX-shaped tokens, not a replacement.
- On win32 a backslash is a path separator, so a backslash-relative bash argument (`cat dir\file`) is gated by the `path` surface the same as `dir/file` ([#520]); the broad rule-candidate classifier recognizes it via `PathFlavor.hasPathSeparator` (the win32 flavor counts `\` as a separator), and it resolves through the ordinary win32 `forBashToken` (`plain`) branch.
  On POSIX `\` is a legal filename character, so the token stays bare there.
- The bash-token interpretation layer implementing these semantics (exact `/dev/*` devices preserved, `/c/` mounts translated, other POSIX absolutes literal-only external) shipped in #533: `PathNormalizer.forBashToken`/`interpretBashCdTarget`/`isBoundaryOutsideWorkingDirectory` branch on the shape returned by the pure `access-intent/bash/msys-bash-tokens.ts` classifier, and `BashPathResolver` routes every bash token (both the `external_directory` and `path` surfaces) through `forBashToken`.
  See `docs/decisions/0003-git-bash-posix-path-semantics.md`.
- A win32 non-mount POSIX absolute (`/tmp/foo`) is a literal-only `AccessPath` matched and displayed exactly as typed, and a `/tmp/*` allow rule suppresses its prompt.
  This works because the win32 path fold (`pathMatchOptions` in `rule.ts` → `PathFlavor.matchOptions`) normalizes separators on **both** the rule pattern and the matched value.
  Folding only the pattern — the pre-#653 behavior — made every forward-slash match value unmatchable, silently voiding a rule like `path: {"/dev/null": "allow"}` on Windows.
  Keep the fold symmetric: matching goes through `CompiledWildcardPattern.matches(value)`, which owns both halves, and the compiled pattern exposes no raw `RegExp` a caller could `.test()` with an unfolded value.
  A win32 path shape therefore needs no hand-built backslash match alias (#533's was removed in #653).

## Notes for Agents

Before implementing, understand:

1. The problem being solved.
2. Which permission surface is involved (tools / bash / mcp / skills / special / external_directory).
3. The merge precedence between global, project, and per-agent policies.
4. Whether the change renames the `/permission-system` slash command — if yes, it is breaking.
5. The need to keep schema, example config, loader, and docs aligned.

Do not assume "allow" is a safe default.
Do not add a permission surface without also adding a policy field, schema entry, and example.

When writing documentation that claims this extension lacks a feature, verify by searching `src/`, `docs/retro/`, and closed issues.

When planning a refactoring that targets testability, read the test files alongside the production code.

When planning a refactoring that touches handler wiring or shared interfaces, load the `design-review` skill to audit for structural smells before writing the plan.

The bash `external_directory` gate only sees tokens that `classifyTokenAsPathCandidate` accepts — absolute (`/…`), home-relative (`~/…`), parent-traversal (`..`), and Windows drive-letter absolute paths (`C:/…` or `C:\…`).
A token's shape is judged **after** expansion resolution, not before: `resolveNodeText` resolves a plain `$HOME`/`${HOME}` reference to `os.homedir()` and a plain `$PWD`/`${PWD}` reference to `.` at collection time (`access-intent/bash/shell-variable-expansion.ts`), so `$HOME/x` reaches the strict gate as an ordinary absolute token — independent of the existence probe — and `$PWD/x` is gated exactly as `./x` ([#694]).
Do not add a `$HOME` branch to a classifier: the expansion vocabulary lives in that one module precisely so it cannot drift from the classifiers again, which is the defect [#694] fixed.
Plainness is structural (exactly one `variable_name` child, otherwise only delimiters), so `${HOME:-/tmp}` and `${#HOME}` stay literal; the resolvable set is closed at `HOME`/`PWD`, and any other variable, a command substitution, or a variable reached through an assignment (`CURRENT="$HOME"; ls "$CURRENT"`) remains an accepted residual under ADR 0009.
A `~` token keeps its raw spelling in prompts and logs (it is shape-classified directly and never needed collection-time expansion), while a `$HOME` token now displays expanded — which is what makes the prompt agree with the session-approval pattern, always derived from the expanded `AccessPath.value()`.
A plain `./relative` token (e.g. `cat ./link/hosts`) is dropped before that gate and is instead gated by the broader `path` surface (`classifyTokenAsRuleCandidate`).
The broader classifier also recognizes the backslash drive form (`D:\…`) — the forward-slash form is caught by `includes("/")`.
On win32 the broad classifier additionally recognizes a backslash-relative token (`dir\file`, no leading `.`, no `/`, no `..`, not a drive-letter absolute) as a `path`-surface candidate — gated the same as its forward-slash equivalent `dir/file` ([#520]) — while on POSIX `\` is a legal filename character so the token stays bare; the decision is `PathFlavor.hasPathSeparator`, which the win32 flavor answers by counting `\`, so the classifier never reads `process.platform`.
On POSIX, a drive-shaped token (`C:/foo`) resolves as the real in-CWD path `./C:/foo` and remains gated by the `path` surface; the `PathNormalizer`'s `isAbsolute` decides platform-correct routing.
Once a token passes classification, its resolution is platform-aware on win32: `PathNormalizer.forBashToken` applies Git Bash/MSYS semantics (safe `/dev/*` devices preserved, `/c/…` drive mounts translated to `C:\…`, other POSIX absolutes kept literal-only) before building the `AccessPath`, so a plan must not assume a leading-`/` win32 bash token resolves with `node:path.win32` rules (#533; see the Windows and Git Bash section).
A bare filename (`cat id_rsa`, `cat outside-link`), which has none of the broad classifier's accepted shapes, is promoted into **both** path projections when it names an existing filesystem entry — the existence probe (`BashPathResolver.probeBareToken` → `PathNormalizer.entryExists`, lstat) that replaced [#509]'s rule-driven promotion in [#645].
Candidacy comes from the filesystem and the decision from explicit rules or the cwd boundary, so no classifier consults the ruleset; `docs/decisions/0009-bash-path-projection-completeness-contract.md` is the governing record.
Because a promoted token flows through the ordinary `AccessPath` canonicalization, a symlink is matched by rules naming its **target** — the case raw-token matching could never see — and one resolving outside the tree reaches `external_directory` exactly like `cat /tmp/x`.
A bare token naming nothing is dropped (`git status` never prompts, even under `path: {"*": "deny"}`), and a promoted token matching no explicit rule stays unrestricted via the `matchedPattern === undefined` guard, so promotion cannot turn the universal fallback into a prompt firehose.
The probe requires a **known** effective base, so a bare token after a non-literal `cd` stays unpromoted ([#393] conservatism).
An `--opt=value` token additionally has its value emitted as its own token at collection (`collectEmbeddedOptionValues`), so `grep --file=/tmp/patterns` gates the embedded path while `--format=json` yields a bare `json` that names nothing ([#645]).
When a plan or test asserts a specific bash repro string, trace the token through the classifier first — an issue's headline repro can describe a symptom whose literal input never reaches the gate being changed.

[#261]: https://github.com/gotgenes/pi-packages/issues/261
[#296]: https://github.com/gotgenes/pi-packages/issues/296
[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#509]: https://github.com/gotgenes/pi-packages/issues/509
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#520]: https://github.com/gotgenes/pi-packages/issues/520
[#694]: https://github.com/gotgenes/pi-packages/issues/694
[earendil-works/pi#4731]: https://github.com/earendil-works/pi/issues/4731
[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
