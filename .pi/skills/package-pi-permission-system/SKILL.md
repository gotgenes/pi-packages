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
When the implementation completes a numbered roadmap step, mark it complete in `docs/architecture/architecture.md` in the implementation doc-update commit (`/tdd-plan` step 7 / `/build-plan`), not a deferred `/ship` commit — `✅` on both the step heading and its Mermaid diagram node, plus any stale health-metric/target rows in the same commit.
Deferring the marker to ship splits it from the work and risks it falling through entirely.
A dated `Baseline (<date>)` column is a fixed phase-open snapshot recomputed at phase close, not a per-step value — do not edit it as work lands.

## Where a module goes

`src/` is partitioned by domain, and the partition is a rule rather than a description — `docs/architecture/architecture.md` § Directory vocabulary is the canonical table.
A new module goes to its named directory when it is written, not when a later phase happens to rewrite it — growing a directory only in the phase that rewrites its files lets cold modules pile up at the root.
The directories are `config/` (read and hold configuration), `policy/` (turn it into a decision), `session/` (state scoped to one session), `access-intent/` (+ `bash/`) (what is being accessed, policy-free), `path/` (the platform's path language), `handlers/` (+ `gates/`) (Pi event handlers and the gate descriptors), `authority/` (subagent detection, the `Authorizer` spine, forwarding), `exposure/` (the `before_agent_start` pass), `tool-input/` (shaping tool input into a fact), `presentation/` (the ask payload and its renders), `logging/` (the writer and its bounds), and `service/` (this node's outward face).
Only five files sit at the root — `index.ts`, `service.ts`, `types.ts`, `value-guards.ts`, `permission-request-id.ts` — and that list grows only by editing the vocabulary table.

Within the package, `./` names a same-directory module and `#src/`/`#test/` names a cross-directory one.
Both halves are lint-enforced here (`local-rules/no-parent-relative-imports` and `local-rules/no-own-directory-alias-imports` in the repo-root `eslint.config.js`), each with an auto-fix, so `eslint --fix` settles a specifier rather than a judgment call.
Neither rule sees a `vi.mock()` specifier, which is a call argument rather than an import — write those as `#src/…` by hand.

Each directory is also a fallow boundary zone, allow-listed to the zones it already imports (`policy/` to type-only edges into `authority/`, `exposure/`, and `session/`).
Run `pnpm --silent fallow guard <file>` before adding a cross-directory import: it lists what that file's zone may import, and an intended new edge extends the zone's `allow` list in `.fallowrc.json` in the same commit.

## Implementation Priorities

- Default to least privilege — when in doubt, prompt (`ask`), do not silently allow.
- Enforce permissions deterministically; the same policy + same input must always produce the same decision.
- Keep config files the source of truth; do not bake policy into code.
- Hide denied tools from the agent before it starts (tool filtering + the tool-surface prompt pass), but only when the surface is *fully* denied.
  `shouldExposeTool` asks `isToolFullyDenied`; the baseline that question is asked of, the prompt relocation, and their constraints are `docs/architecture/architecture.md` § Two-phase checking and ADR 0014.
- Keep block/ask/allow decisions reviewable: write to the permission review log by default.
- Preserve the `/permission-system` slash command name — renaming it is a breaking change.
- In the flat permission format, `permission["*"]` is the universal fallback; pattern ordering is last-match-wins.
  Every surface resolves through the one multi-value evaluator, `evaluateAnyValue` (#928) — rule position decides, and candidate order decides only which name the decision is reported under in `PermissionCheckResult.target`.
  Do not reintroduce a per-surface evaluator: `mcp` is the only surface producing multiple candidates, and a first-candidate-wins scan there let a catch-all mask a later rule.
- The four path layers (`path`, `external_directory`, per-tool, `bash`) compose with **most-restrictive-wins** across surfaces: a more-permissive rule on one surface cannot loosen a more-restrictive rule on another (`ask` > `allow`).
  So a `path` allow cannot suppress an `external_directory: ask` prompt — allow outside-CWD directories on `external_directory`, not `path`.
- `path` and `external_directory` each carry a **read/write axis** (ADR 0013 §3–§4, Refs #806), and the two directions are independent bits, not tiers — a `path_write` allow grants no read, a `path_read` deny floors no write.
  A bare family key is **load-time sugar**: `expandDirectionalSugar` (`src/policy/normalize.ts`), called once per scope inside `mergeScopesWithOrigins` before origin bookkeeping and the merge, rewrites it into both directional members, sugar entries first and explicit directional entries appended after, whatever the file's key order.
  The mechanism — the resolver's family fold, per-token effect proofs, per-pattern session grants, and their constraints — is ADR 0013 and `docs/architecture/architecture.md` (`normalize.ts`, `permission-resolver.ts`, `command-effects.ts`, `session-approval.ts` entries).
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
That subscription also drives `ChildNodeAudit` (`src/authority/child-node-audit.ts`) on the **optional** third channel `subagents:child:bound`; `docs/subagent-integration.md` § The optional `bound` channel is its spec, and the module's entry in `docs/architecture/architecture.md` carries its constraints.
The dependency direction is inverted — pi-subagents has zero knowledge of pi-permission-system.
The `session-created` handler MUST stay synchronous: the core emits it on the same call stack right before `bindExtensions()`, and the event bus dispatches listeners synchronously, so a synchronous handler lands the registry entry before binding proceeds.
The contract is named the **subagent adapter convention**, and `docs/subagent-integration.md` is its canonical spec (ADR 0012 decisions 5–6): cite that section rather than restating channel names, payload shapes, or the pre-bind ordering in another doc.
An implementation owes only the announcement — the two events in-process, `PI_SUBAGENT_PARENT_SESSION` out-of-process — and `SUBAGENT_ENV_HINT_KEYS` is composed from `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` so naming a parent session is itself a detection hint, which is what makes that single obligation sufficient.
Do not split the two lists back apart by adding a parent-session name to only one of them.

Serving announcement, forwarding liveness, relay selection, and refusal rendering are `docs/subagent-integration.md` § When nobody answers and `docs/architecture/architecture.md` (the `serving-registry.ts`, `forwarding-liveness.ts`, `forwarding-manager.ts`, `authorizer-selection.ts`, and `agent-renderer.ts` entries); ADR 0011 §10 bounds what a forwarded refusal may disclose.

**The `SubagentSessionRegistry` is process-global.**
Access it via `getSubagentSessionRegistry()` (`src/authority/subagent-registry.ts`), backed by `globalThis` + `Symbol.for("@gotgenes/pi-permission-system:subagent-registry")`.
This is necessary because each session's `ResourceLoader` creates its own `pi.events` bus: the parent emits `subagents:child:session-created` on its bus and only the parent's instance receives it.
The child's separate jiti instance runs on a different bus and never receives the event — but `getSubagentSessionRegistry()` returns the same global store, so the parent's registration is visible to the child when it checks `isSubagentExecutionContext()`.
Do not instantiate `new SubagentSessionRegistry()` in production code; use the accessor.

## Configuration

Unified config follows the `pi-autoformat` convention (`extensions/<id>/config.json`), with a user-local project override used only for explicit persistent approvals.

- **Global config**: `~/.pi/agent/extensions/pi-permission-system/config.json` (respects `PI_CODING_AGENT_DIR`)
- **Shared project config**: `<cwd>/.pi/extensions/pi-permission-system/config.json`
- **Project-local config**: `<cwd>/.pi/extensions/pi-permission-system/config.local.json`
- **Per-agent overrides**: YAML frontmatter in agent definition files

Merge precedence: shared project overrides global; project-local overrides shared project; global-agent and project-agent frontmatter remain higher.
Automatic project persistence writes only trusted-project `config.local.json`, never the shared project file.
The `permission` object uses deep-shallow merge; scalar fields use simple replacement.

- Zod source of truth: `src/config/config-schema.ts` (the composable schemas, the `z.infer` config types, and `buildPermissionsJsonSchema`).
- Schema: `schemas/permissions.schema.json` — **generated** from `config-schema.ts` via `pnpm run gen:schema`; never edit it by hand.
  A parity test in `test/config-schema.test.ts` fails on drift.
- Example: `config/config.example.json`
- Keep `config-schema.ts`, example config, `docs/configuration.md`, and `README.md` aligned when the config shape changes — the schema and the config types are both derived from `config-schema.ts`, so it is the one edit point.
- `docs/architecture/architecture.md` inline-copies the core `rule.ts` types (`Rule`, `RuleOrigin`, `Ruleset`).
  Adding or removing a field on one of these must update that listing too — a module-move check misses it, and only the pre-completion reviewer catches it otherwise.
- Config **files** are validated strictly against `unifiedConfigSchema` (`config-schema.ts`) and rejected **fail-closed** on any invalid field (empty scope → universal `ask`), with a clear per-issue message.
  A rejected **non-global** scope (project / agent / project-agent) additionally floors the composed policy `allow`→`ask` (origin `fail-closed`) at composition, so a lower scope's `allow` cannot be silently inherited behind an invalid higher scope; `deny` is preserved, global is excluded, and `yoloMode` re-permits the floored `ask`.
  The loader marks such a scope `ScopeConfig.invalid` (a present-but-unloadable file; an absent file stays a plain empty scope); the manager reads the flags in `resolvePermissions` and appends a fail-closed notice to `getConfigIssues`.
  Per-agent frontmatter stays tolerant — `policy-loader.ts` extracts only its `permission` block via `normalizeFlatPermissionValue`, since frontmatter carries non-config keys; only a whole-file read/parse failure of an existing agent file marks the scope invalid, not a tolerantly-dropped per-key entry.
- When removing a config field, drop it from `unifiedConfigSchema`; configs that still set it are then rejected.
  For a soft-deprecation window, keep the field optional in the schema and ignore its value.
- When adding an optional field to `PermissionSystemExtensionConfig`, do not include it in `DEFAULT_EXTENSION_CONFIG` with an explicit `undefined` value — tests use `deepEqual` and it breaks equality.
- When adding a field, define it in `unifiedConfigSchema` (`config-schema.ts`, with `.meta({ description, markdownDescription })`) and regenerate the schema (`pnpm run gen:schema`); `UnifiedPermissionConfig` is inferred from it.
  Then carry it through `PermissionSystemExtensionConfig` (`extension-config.ts`) and merge it in `mergeUnifiedConfigs()` (`config-loader.ts` — a number goes in its "Number scalars" loop).
  A field on the runtime type but not the merge intermediate is silently dropped before runtime.
  Omitting a field from `UnifiedPermissionConfig` that `normalizePermissionSystemConfig` reads is a **compile error** — `normalizePermissionSystemConfig` reads fields directly from the typed `UnifiedPermissionConfig` parameter, so `tsc` catches the gap immediately.
- When a config example sets a policy for `write`, include the same policy for `edit` — both tools modify files and users expect them gated together.
- `promptMaxRows` (24) and `promptFieldMaxWidth` (400) bound what an ask prompt renders; `resolveRenderBudget` (`src/presentation/dialog-renderer.ts`) owns their defaults, so neither belongs in `DEFAULT_EXTENSION_CONFIG`.
  `reviewLogFieldMaxWidth` (1000) bounds what the review log persists, with its default in `resolveReviewLogFieldWidth` (`src/logging/log-field-cap.ts`), for the same reason.

## Log writes

Both JSONL logs are created owner-only (`0600`, in a `0700` directory) and key-name redacted; the permission-forwarding request/response files are mode-restricted too (but **not** redacted — the parent reads them to render the ask-prompt).
Do not add a log write path that bypasses `writeLine` in `src/logging/logging.ts`, and do not pass a `mode`-less `appendFileSync`/`writeFileSync`/`mkdirSync` for an artifact holding tool input.
`writeLine` is also where the review stream's width bound and both streams' masking live; the `logging.ts`, `log-field-cap.ts`, and `review-log-renderer.ts` entries in `docs/architecture/architecture.md` carry the mechanism.
A width cap is **not** redaction and must not be conflated with it: it narrows by length alone and never reads a value to decide what to shorten, and the two compose — a sensitive-keyed value is masked whole however long it was.

Every terminal entry also carries a `decidedBy` provenance record (`DecisionSource`, `src/authority/decision-source.ts`) naming what decided; it is stamped at the site that decides, never inferred — do not add a branch that infers one.
The record's shape, where it is and is not carried, and the bounds that reach it are the `decision-source.ts` entry in `docs/architecture/architecture.md`.
Redaction is **structural, never value-shape**: `isSensitiveName` (`src/logging/log-redaction.ts`) masks a value because of the name it is bound to, and a provider-prefix/entropy list was measured against a real 6.7 MB log and declined (403 `sk-` hits, all false positives from `task-*`; zero true positives).
The boundary to repeat verbatim in any doc or reply: a value bound to a sensitive name is masked — whether the name is a log key, a shell variable, or a request header field — and a secret with no name bound to it, such as one typed as a `grep` pattern, is not.
Governing record: `docs/decisions/0010-permission-log-secret-exposure.md` (Refs #647, #920, #923).
A shell variable is found inside an inline-shell payload (`bash -c '…'`, including behind a wrapper such as `sudo`/`xargs`) as well as at the top level, because the package already knows that argument is shell; a heredoc body and an interpreter payload are declined, measured, as the class where an anchored rule reads a secret out of embedded Python.
A payload query must peel indirection exactly as `executedUnitOf` does, or a secret reads masked under `executedUnit` and verbatim under `command` in one record.

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
That keyed map is the **only** service slot; there is no process-root slot and no child guard against clobbering, because keyed publication makes clobbering impossible (the pure `isRegisteredSubagentChild` stays, called by `isSubagentExecutionContext`).
Do not reintroduce a process-root accessor: it answers "the process root's service", which is the wrong node in every node but the root.
The locator's `sessionId` is required, and a no-argument call answers `undefined` with a once-guarded `PI_PERMISSION_SYSTEM_WARN0001` warning rather than guessing a node — a consumer built against the pre-rename `*ForSession` major reaches that path.
That warning is deliberately not a `DeprecationWarning`, so `--no-deprecation` cannot silence a registration that never landed.
A link registered on a relaying node is **accepted and observed**, never refused: `ObservedAuthorizerRegistrar` (`src/authority/authorizer-registry.ts`) records `authorizer_link_vacant`, so registering everywhere stays the correct default for a sibling author and nothing is silent (ADR 0012 decision 4).
`permissions:ready` is broadcast **twice** per session generation — at `session_start` after publication, and again at the node's first `before_agent_start`, which runs after every extension's `session_start` and before any ask (ADR 0012 decision 3, the ready latch, #787).
So the channel fires at least once per session and may repeat: the ready handler alone is a sufficient registration site, and a consumer needs only an idempotence guard, never a second attempt from its own `session_start`.
The contract is fully implemented: the docs consolidation landed in #789, and `pi-permission-model-judge` — its named migration test case — registers from the ready handler alone since #788, with its peer range floored at `>=27.0.0`.

The in-process implementation of `PermissionsService` is `LocalPermissionsService` (`src/service/permissions-service.ts`).
It routes policy queries through the `PermissionResolver`, not `PermissionManager` directly: a path-shaped surface (`path` / `external_directory` / `read` / `write` / `edit` / `grep` / `find` / `ls`) query builds an `AccessPath` via `buildAccessIntentForSurface` and emits an `access-path` intent, so external queries match the lexical ∪ canonical set the gates do (#503); the normalizer is fetched per call from the session (`getPathNormalizer()`), so the published service answers against the parent cwd.
A `bash` query routes through `resolveBashAdvisoryCheck` (`src/service/bash-advisory-check.ts`), which decomposes a chained/nested command into its command-pattern units and resolves most-restrictive at parity with the gate (via the shared `resolveBashCommandCheck`), backed by a parser warmed at `before_agent_start`; in the pre-warm window it falls back to a whole-string match, so the advisory answer is never weaker than the gate (#309).
Service publication, both `permissions:ready` emits, and session teardown ordering are owned by `PermissionServiceLifecycle` (`src/service/service-lifecycle.ts`), and the `before_agent_start` routine by `SessionTurnPrep` (`src/handlers/session-turn-prep.ts`); route a change to publication timing or teardown order through them, not `index.ts`.
Their entries in `docs/architecture/architecture.md` carry the wiring and the chain-role seam they read.
Do not propose module-scoped singletons or Node.js module-cache sharing as a cross-extension communication mechanism — module isolation keeps them invisible to other extensions.

[earendil-works/pi#5905]: https://github.com/earendil-works/pi/issues/5905

The `path` and `external_directory` gates are path-aware for **all** tools, not just the six built-ins (#352); the extractor registry and its in-process ancestor fallback are `docs/architecture/architecture.md` § Path-bearing tool normalization and its `inherited-registrations.ts` entry.
Do **not** add the same fallback for `AuthorizerRegistry`, and do not add a `getAuthorizer` reader to `PermissionsService`: a link returns a verdict, so live authority stays converged at the adjudicating node (ADR 0007 §7), and a `fact-shaping inheritance stops at live authority` composition-root test fails if it is ever wired in.

The live-authority layer is a Chain of Responsibility (ADR 0007, `docs/decisions/0007-model-judge-authorizer-chain-adr.md`): `composeAuthorizerChain(links, terminal, query)` (`src/authority/authorizer-chain.ts`) runs registered non-terminal `Authorizer` links (`allow | deny | defer`) ahead of the context-selected `TerminalAuthorizer` (which cannot defer).
The `AuthorizerRegistry` (`src/authority/authorizer-registry.ts`) mirrors `ToolAccessExtractorRegistry`: one instance in `index.ts`, its lookup threaded into `AuthorizerSelection` and its registrar exposed cross-extension via `PermissionsService.registerAuthorizer(name, authorize)`.
**One chain per node** (ADR 0007 §7, Refs #727): an ask is adjudicated by the node whose terminal decides it, so a relaying subagent node (`adjudicatesLocally: false` on the `SelectedAuthority` that `selectAuthorizer` returns) resolves **no** links and records `authorizer_chain_delegated` instead — its terminal forwards, and the serving node runs its own chain over the same child-fixed facts.
Do not "fix" a child's empty chain by making `AuthorizerRegistry` process-global: that double-adjudicates every deferring ask and lets a link short-circuit before the serving node sees the request.
Per-ask chain resolution, the delegation envelope, and the query each link is handed are ADR 0007 and the `authorizer-selection.ts` / `delegation-envelope.ts` entries in `docs/architecture/architecture.md`.

## Testing

Shared test fixtures live in `test/helpers/`:

- `session-fixtures.ts` — real-instance builders for `PermissionSession` / `PermissionResolver` tests: `makeRealSession` (builds a real `PermissionSession` from per-collaborator fakes; returns `{ session, paths, logger, forwarding, permissionManager, sessionRules, configStore, gateway }`), `makeFakePermissionManager` (fake `ScopedPermissionManager` with `vi.fn()` stubs — unannotated return type for full mock access; exposes a single `check(intent, sessionRules?)` stub, the one resolution entry point since #478), `makeRealResolver` (real `PermissionResolver` over a fake manager + `SessionRules`; pass shared instances to connect it to a session's manager/rules), plus `makePaths` / `makeLogger` / `makeConfigStore` / `makeGateway` / `makeForwarding`.
  Tests exercising `resolveAgentName` must mock `active-agent` in their own file (the `vi.hoisted` / `vi.mock` pattern), since that mock is module-scoped.
- `handler-fixtures.ts` — `makeCtx`, `makeEvents`, `makeToolRegistry`, `makeToolCallEvent`, `makeCheckResult` (neutral default, override-driven), `makeHandler` (builds a **real** `PermissionSession` + `PermissionResolver` wired into the handler and pipelines exactly as `index.ts`; the `session` override bag maps `checkPermission` onto `permissionManager.checkPermission` and `getActiveSkillEntries` / `getInfrastructureReadDirs` / `getToolPreviewLimits` / `resolveAgentName` onto `vi.spyOn` overrides of the real session; accepts optional `tools: string[]` and `prompter: AskEscalator` (the single-method ask-escalation seam that replaced `GatePrompter` in #556 — stub it as `{ escalate }`); returns `{ handler, events, session, logger, toolRegistry, prompter, recorder, permissionManager, forwarding }` — `session.activate` is the real method, so assert `forwarding.start` instead), `makeSurfaceCheck` / `makeBashCommandCheck` (surface-/bash-dispatching `checkPermission` mocks — pass the result as `session.checkPermission`, applied to `permissionManager.checkPermission`; a `makeSurfaceCheck` key naming a bare family answers for its directional members too, modeling sugar expansion, so key on `path_read` only when the two directions need different verdicts), `getDecisionEvents`, `makeConfigIssueReporter` (the `ConfigIssueReporting` double the `session_start` and turn-prep handlers each take; unannotated return type so `report` keeps full `vi.fn()` access for call-order assertions).
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
This resolver-internal boundary is a deliberate, formalized seam, not transitional scaffolding (see `packages/pi-permission-system/docs/decisions/0002-path-values-string-boundary.md`, #506): the manager stays string-based and must not import `AccessPath` — a `no-restricted-imports` lint rule on `src/policy/permission-manager.ts` guards it — pinned by literal path, so it must move with the file (a `files:` glob that stops matching fails open with every gate green).

- Test permission resolution (allow/deny/ask decisions across tools, bash, MCP, skills, special).
- Test wildcard matching (bash patterns, skill globs) including over-match and under-match cases.
- Test policy merge precedence: global → project → per-agent frontmatter.
- Test the tool-surface prompt pass (pi's sections removed, this session's rendered at the tail, denied tools and their guidelines absent, the identity ahead of them left byte-identical).
- Test the external-directory guard for path-bearing file tools, including extension and MCP tools (default-on path gating, #352).
- Test config loading, validation issues, and tolerance of deprecated keys.
- When a change reads a **new** `ExtensionContext` field/method (e.g. `ctx.isProjectTrusted()`), update `makeCtx` **and** grep every hand-built ctx literal — `grep -rln "hasUI:" test/` (18 files cast `as unknown as ExtensionContext` / `as never`).
  These casts bypass `tsc`, so a missing field fails only at the full-suite run, not `check` or the cycle-scoped file (#644: `permission-events.test.ts` surfaced `ctx.isProjectTrusted is not a function` at runtime).
  The same applies to a hand-built **event payload**: `composition-root.test.ts` fires `before_agent_start` through an untyped fake, so a handler reading a new payload field compiles clean and throws at run time.
- To test the file-based permission-forwarding round-trip (a subagent's `ask` reaching the parent), do not `await` the child's `pi.fire("tool_call", …)` directly — `ParentAuthorizer.authorize` (`src/authority/approval-escalator.ts`) polls for a response until `getTimeoutMs()` elapses (the `forwardingTimeoutMs` config default is ten minutes).
  Instead: fire without awaiting, poll the parent's `requests/` dir (`createPermissionForwardingLocation(forwardingDir, parentSessionId)`) for the child's request file, write an approval JSON to `responses/<id>.json`, then await the fire.
  Such a test must also announce that the parent is serving — it answers by hand instead of running the parent's poll timer, and without the announcement the child correctly abandons the request as unserved after ~2 s.
  Which announcement depends on how the test's child resolves its target: `getServingSessionRegistry().markServing(parentSessionId)` for an in-process child, and `publishServingHeartbeat(forwardingDir, parentSessionId)` (`test/helpers/forwarding-fixtures.ts`) for one resolving from `PI_SUBAGENT_PARENT_SESSION`.
  See the `subagent registry sharing` and `out-of-process forwarding liveness` tests in `test/composition-root.test.ts`.
  A `ParentAuthorizer` unit test builds its deps with `makeParentAuthorizerDeps` (`test/helpers/forwarding-fixtures.ts`), whose `serving` default reports every target as serving and whose `getTimeoutMs` override makes the timeout path testable without waiting it out.
  A test that targets a liveness path passes `makeLivenessJudge({ forwardingDir, registry?, isProcessAlive? })` instead — the real judge over real records, so a double cannot drift from the routing under test.
- A `test/authority/` forwarding-liveness failure reporting an absurd duration (minutes for a sub-second test) is host load, not a regression — the poll loops are wall-clock.
  A different pair fails on each run and all pass in isolation; re-run the file alone before investigating.
- To test Windows behavior on a POSIX CI, construct a `win32` `PathNormalizer` with `win32PathFlavor` (or pass `flavor: win32PathFlavor` to `makeRealSession` / the manager) — never `vi.mock("node:path")`.

## Debugging

When investigating a reported bug:

1. Check the runtime environment: which extensions are loaded, from which paths, and whether any are loaded more than once.
2. Check `.pi/settings.json` and `~/.pi/agent/settings.json` for overlapping package entries.
3. Instrument only after confirming the bug reproduces in isolation.
4. When the bug involves path, filesystem, or platform semantics, check how `@earendil-works/pi-coding-agent` solves it first (local checkout or published source).
   Prefer Node `path` builtins (`path.relative`, `path.win32`/`path.posix`) over hand-rolled comparison; pi's containment idiom is `relative()` + a `..`/absolute-prefix check (case-insensitive on Windows).
   The win32-vs-POSIX decision has a single home, `pathFlavorForPlatform` (`src/path/path-flavor.ts`); `index.ts` performs the one `process.platform` read and injects the resolved `PathFlavor`, and a lint guard blocks any other read inside `src/` — the `path-flavor.ts`, `path-normalizer.ts`, and `approval-pattern.ts` entries in `docs/architecture/architecture.md` carry the collaborator and its constraints.
5. A bypass claim is reproduced live and a gate change is priced against the review log: `docs/architecture/investigating-a-report.md`.

The gate fails closed (#452): every `tool_call` goes through `createFailClosedToolCall` (`src/handlers/tool-call-boundary.ts`), a thrown gate is blocked, an unparseable or partially parsed bash command floors to `ask`, and a wrapper unit floors to `ask` unless its inner command is a proven pure reader.
The boundary, the salvage, the floors, and the enumerator's node-type sets are the `tool-call-boundary.ts`, `bash-command.ts`, `unresolved-salvage.ts`, `command-enumeration.ts`, `wrapper-analysis.ts`, and `redirect-analysis.ts` entries in `docs/architecture/architecture.md`; ADR 0009 and ADR 0013 §10–§11 govern them.

The bash enforcement stack is not limited to the native `bash` tool: the `shellTools` config maps a foreign tool name to `{ commandArgument, workdirArgument? }`, and `resolveShellInvocation` (`src/access-intent/tool-kind.ts`) is the single dispatch point that turns native `bash` *or* an aliased tool (e.g. `@howaboua/pi-codex-conversion`'s `exec_command`) into a `{ command, workdir }` shell invocation — every other tool yields `null` (#574).
The `tool-kind.ts` entry in `docs/architecture/architecture.md` carries how the aliased command is gated.

## Windows and Git Bash

Platform facts verified against Pi core source:

- **Pi core executes every bash tool command through Git Bash on Windows** (`pi/packages/coding-agent/src/utils/shell.ts`): resolution order is custom `shellPath` → `%ProgramFiles%\Git\bin\bash.exe` → any `bash.exe` on PATH (MSYS2/Cygwin); there is no cmd/PowerShell branch.
  So bash tokens gated on a `win32` host carry POSIX/MSYS path semantics, while tool-input paths (`read`/`write`/`edit`) carry Node `fs` win32 semantics — the two surfaces have **different platforms** on the same host.
  The token interpretation that follows from this — MSYS devices preserved, `/c/` mounts translated, other POSIX absolutes literal-only, the symmetric win32 match fold — is ADR 0003 (`docs/decisions/0003-git-bash-posix-path-semantics.md`) and the `msys-bash-tokens.ts`, `path-normalizer.ts`, and `wildcard-matcher.ts` entries in `docs/architecture/architecture.md`.

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

The bash `external_directory` gate only sees tokens that `classifyTokenAsPathCandidate` accepts, the broader `path` surface sees what `classifyTokenAsRuleCandidate` accepts, a bare filename is promoted into both when the existence probe finds it on disk, and a redirect's literal first destination reaches both by its `redirect-destination` role whether or not it exists; token shape is judged **after** `$HOME`/`$PWD` expansion, whose vocabulary lives only in `access-intent/bash/shell-variable-expansion.ts` — do not add a `$HOME` branch to a classifier.
The classifiers, the probe, the option-value and statement-operand walkers, and their constraints are ADR 0009 (`docs/decisions/0009-bash-path-projection-completeness-contract.md`) and the `token-classification.ts`, `shell-variable-expansion.ts`, `token-collection.ts`, and `bash-path-resolver.ts` entries in `docs/architecture/architecture.md`.

When a plan or test asserts a specific bash repro string, trace the token through the classifier first — an issue's headline repro can describe a symptom whose literal input never reaches the gate being changed.

[#261]: https://github.com/gotgenes/pi-packages/issues/261
[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
