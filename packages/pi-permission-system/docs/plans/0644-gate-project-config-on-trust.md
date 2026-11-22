---
issue: 644
issue_title: "pi-permission-system: project policy is loaded without checking project trust"
---

# Gate project-scoped config loading on `ctx.isProjectTrusted()`

## Release Recommendation

**Release:** ship independently

This issue is not part of any architecture-roadmap batch — it is a standalone security fix.
It is a breaking behavior change (untrusted projects stop contributing project-scoped config on upgrade), so it cuts a major release on its own.

## Problem Statement

The globally installed extension loads project-scoped configuration from the current working directory without ever consulting `ctx.isProjectTrusted()`.
Because project (and project-agent) scopes have higher precedence than global, an untrusted repository can ship `.pi/extensions/pi-permission-system/config.json` that **loosens** an operator's global restrictions — e.g. flipping a global `bash: deny` to `bash: allow`, or setting `yoloMode: true` — before the user has granted project trust.
This is inconsistent with Pi's own trust model, which withholds project-local skills, prompts, and agents from untrusted directories.
ADR-0001 (`docs/decisions/0001-project-trust-adoption.md`) already confirmed the gap and scoped the fix; this issue is the deferred implementation.

## Goals

- When `ctx.isProjectTrusted()` is `false`, do **not** load any project-scoped configuration; only global and global-agent scopes participate in policy and runtime-config resolution.
- Cover **both** untrusted-project load paths that are keyed on `ctx.cwd`:
  1. Permission **policy** — `PermissionManager.configureForCwd` (project + project-agent `permission` blocks).
  2. Extension **runtime config** — `ConfigStore.refresh` → `loadAndMergeConfigs` (project `config.json` scalars: `yoloMode`, `permissionReviewLog`, `piInfrastructureReadPaths`, `shellTools`, `authorizerChain`, …).
- **Loudly warn** the user (UI notification + review-log entry) whenever project config is skipped because the project is untrusted, so the reduced-scope state is never silent.
- Preserve the existing trust-grant recovery: when the user grants trust after startup, Pi fires `resources_discover` with `reason: "reload"`, and the reload path re-reads trust and loads project policy.
- **Breaking:** this changes observable behavior on upgrade for untrusted directories with no user edit.
  Ship as `fix(pi-permission-system)!:` with a `BREAKING CHANGE:` footer.

## Non-Goals

- Registering a `project_trust` handler or deciding trust actively — the extension observes the decision via `ctx.isProjectTrusted()`, it is not a trust oracle (ADR-0001 alternative, rejected).
- Changing the merge model to a restrict-only project merge — the override semantics for trusted projects stay intentional (ADR-0001 alternative, rejected).
- Reloading the extension **runtime config** (`yoloMode` etc.) on the trust-grant `resources_discover reload`.
  Today `reload()` re-reads policy only, not runtime config; that asymmetry is pre-existing and its safe direction (global-only runtime until the next session start) is acceptable here.
  Tracked in Open Questions.
- Per-agent frontmatter tolerance and the fail-closed clamp for invalid higher-precedence scopes (#646) — untouched.
  An untrusted project's config is simply not loaded, so its validity is never evaluated.

## Background

Relevant modules and how they relate:

- `src/handlers/lifecycle.ts` — `SessionLifecycleHandler.handleSessionStart(event, ctx)` calls `session.refreshConfig(ctx)` (runtime-config path) then `session.resetForNewSession(ctx)` (policy path).
  `handleResourcesDiscover(event)` calls `session.reload()` on `reason: "reload"`.
  Both handlers receive an `ExtensionContext` from `pi.on(...)`; the resources_discover registration in `index.ts` currently drops the `ctx` argument.
- `src/permission-session.ts` — `PermissionSession.refreshConfig(ctx?)` delegates to `configStore.refresh(ctx)`; `resetForNewSession(ctx)` calls `permissionManager.configureForCwd(ctx.cwd)`; `reload()` calls `permissionManager.configureForCwd(this.context?.cwd)`.
- `src/permission-manager.ts` — `configureForCwd(cwd)` rebuilds the `FilePolicyLoader`.
  `derivePolicyLoaderOptions(agentDir, cwd)` already yields `projectGlobalConfigPath: undefined` / `projectAgentsDir: undefined` when `cwd` is `undefined`, so passing `undefined` cwd loads **global-only** policy.
  This is the existing lever the gate reuses.
- `src/config-store.ts` — `ConfigStore.refresh(ctx?)` calls `loadAndMergeConfigs(agentDir, cwd ?? "", EXTENSION_ROOT)` and normalizes the merged runtime config.
  Passing an **empty** cwd here is unsafe: `getProjectConfigPath("")` yields a relative `.pi/…` path that `existsSync` resolves against `process.cwd()` — so the runtime-config path needs an **explicit** project-skip flag, not an empty cwd.
- `src/config-loader.ts` — `loadAndMergeConfigs(agentDir, cwd, extensionRoot)` merges (1) legacy global, (2) legacy extension config, (3) new global, (4) legacy project policy, (5) new project config.
  Steps 4–5 are the project-scope steps to gate.
- `ctx.isProjectTrusted(): boolean` — verified present on `ExtensionContext` in `@earendil-works/pi-coding-agent@0.79.1` (`dist/core/extensions/types.d.ts`).
  It is a live call reflecting the current (including remembered/temporary) decision, so a stored ctx re-reports updated trust after a grant.

AGENTS.md / skill constraints that apply:

- Default to least privilege — when gating, the reduced-scope (global-only) state is the safe default.
- Keep schema, example config, `docs/configuration.md`, and `README.md` aligned — but this change adds **no** config field, so the schema is untouched.
- The published tarball ships `docs/*.md`, `docs/migration`, `README.md` — a migration note lands in `docs/migration/`.

## Design Overview

### Decision model

Read the trust decision **once** at the lifecycle boundary (the only place that owns `ctx`) and thread it as an explicit `projectTrusted: boolean` down each config-load operation.
The parameter is **required** (no default) at every internal seam, so TypeScript forces every call site to make the trust decision consciously — there is no silent "trusted by default" fallback for a security gate.

```typescript
// handlers/lifecycle.ts — handleSessionStart
const projectTrusted = ctx.isProjectTrusted();
this.session.refreshConfig(ctx, projectTrusted); // runtime-config path
this.session.resetForNewSession(ctx, projectTrusted); // policy path
this.session.logResolvedConfigPaths();
if (!projectTrusted) {
  this.logger.review("project_trust.skipped", {
    cwd: ctx.cwd,
    phase: "session_start",
  });
  this.logger.warn(UNTRUSTED_PROJECT_MESSAGE);
}
// … existing agent-name / policy-issue / serviceLifecycle.activate flow …
```

```typescript
// handlers/lifecycle.ts — handleResourcesDiscover(event, ctx)
if (event.reason !== "reload") return Promise.resolve();
const projectTrusted = ctx.isProjectTrusted();
this.session.reload(projectTrusted); // policy path
if (!projectTrusted) {
  this.logger.review("project_trust.skipped", {
    cwd: ctx.cwd,
    phase: "resources_discover",
  });
  this.logger.warn(UNTRUSTED_PROJECT_MESSAGE);
}
// … existing lifecycle.reload debug log …
```

`this.logger.warn(...)` is the existing user-facing warning channel (it is what surfaces policy issues today and calls the injected `notify` → `ctx.ui.notify`), so reusing it satisfies the "loud warning" requirement and is asserted the same way as policy-issue warnings.
The paired `logger.review(...)` entry records the skip in the permission review log for audit.

### Policy path — reuse the `undefined`-cwd lever

`PermissionSession` withholds the project cwd from the manager when untrusted:

```typescript
resetForNewSession(ctx: ExtensionContext, projectTrusted: boolean): void {
  this.permissionManager.configureForCwd(projectTrusted ? ctx.cwd : undefined);
  this.skillEntries = [];
  this.activate(ctx);
}

reload(projectTrusted: boolean): void {
  this.permissionManager.configureForCwd(
    projectTrusted ? this.context?.cwd : undefined,
  );
  this.skillEntries = [];
}
```

Passing `undefined` cwd makes `derivePolicyLoaderOptions` omit the project paths, so the loader resolves global-only — no new manager code, and it composes correctly with the #646 fail-closed clamp (an untrusted project's config is never read, so `projectConfig.invalid` never fires).
The session still `activate`s the real ctx (forwarding, normalizer, authorizer selection all bind to the true cwd) — only the **policy scope** is narrowed.

### Runtime-config path — explicit project-skip flag

`loadAndMergeConfigs` gains an options object; `ConfigStore.refresh` passes the trust decision through:

```typescript
// config-loader.ts
export function loadAndMergeConfigs(
  agentDir: string,
  cwd: string,
  extensionRoot: string,
  options: { includeProjectScope?: boolean } = {},
): MergedConfigResult {
  const includeProjectScope = options.includeProjectScope !== false;
  // … steps 1–3 (legacy global, legacy ext, new global) unchanged …
  if (includeProjectScope) {
    // step 4: legacy project policy
    // step 5: new project config
  }
  // …
}
```

```typescript
// config-store.ts — refresh(ctx, projectTrusted)
const mergeResult = loadAndMergeConfigs(this.deps.agentDir, cwd ?? "", EXTENSION_ROOT, {
  includeProjectScope: projectTrusted,
});
```

`includeProjectScope` defaults to `true`, so the existing `loadAndMergeConfigs` test callers (which omit it) are unaffected; only `ConfigStore.refresh` opts a project out when untrusted.
The `config.loaded` debug entry gains a `projectTrusted` field for traceability.

### Warning message

A module-level constant in `lifecycle.ts`:

```typescript
const UNTRUSTED_PROJECT_MESSAGE =
  "pi-permission-system: project is not trusted — skipping project-scoped " +
  "permission configuration. Only global policy applies. Grant project trust " +
  "to load this project's permission rules.";
```

### Signature cascade (why the gate lands in one commit)

Making `projectTrusted` required changes the signatures of `ConfigStore.refresh`, `PermissionSession.{refreshConfig,resetForNewSession,reload}`, and the two lifecycle handlers, plus the `index.ts` resources_discover registration.
These are a single compile-coupled chain (each caller is the sole consumer of the next), so the gate + all consumer + test updates land together — the TDD-plan lift-and-shift rule for a cascading signature change.

## Module-Level Changes

- `src/config-loader.ts` — add `options?: { includeProjectScope?: boolean }` (4th param) to `loadAndMergeConfigs`; guard steps 4–5 on it; update the function doc comment.
- `src/config-store.ts` — change `SessionConfigStore.refresh` (interface) and `ConfigStore.refresh` (impl) to `refresh(ctx: ExtensionContext | undefined, projectTrusted: boolean)`; forward `{ includeProjectScope: projectTrusted }`; add `projectTrusted` to the `config.loaded` debug entry.
- `src/permission-session.ts` — `refreshConfig(ctx: ExtensionContext | undefined, projectTrusted: boolean)`, `resetForNewSession(ctx, projectTrusted)`, `reload(projectTrusted)`; withhold cwd from `configureForCwd` when untrusted; update the method doc comments.
- `src/handlers/lifecycle.ts` — add `UNTRUSTED_PROJECT_MESSAGE`; `handleSessionStart` reads `ctx.isProjectTrusted()`, threads it, warns + review-logs on skip; `handleResourcesDiscover(event, ctx)` gains the `ctx` param, reads trust, threads it into `reload`, warns + review-logs on skip.
- `src/index.ts` — update the `resources_discover` registration to `(event, ctx) => lifecycle.handleResourcesDiscover(event, ctx)`.
- `test/helpers/handler-fixtures.ts` — `makeCtx` adds `isProjectTrusted: vi.fn().mockReturnValue(true)` (default trusted preserves existing behavior; untrusted tests override).
- `test/handlers/lifecycle.test.ts` — update `configStore.refresh` / `resetForNewSession` assertions to the two-arg form; `handleResourcesDiscover` calls now pass `ctx`; add untrusted-path tests (skip + warn + review-log for both handlers).
- `test/permission-session.test.ts` — update `resetForNewSession` / `reload` / `refreshConfig` calls to pass the trust arg; add trusted-vs-untrusted `configureForCwd` assertions.
- `test/config-store.test.ts` — update `refresh` calls to the two-arg form; assert `includeProjectScope` is forwarded per trust.
- `test/session-start.test.ts` — the hand-built `mockCtx` gains `isProjectTrusted: () => true`.
- `test/composition-root.test.ts` — the ctx builders (`makeUiCtx`, `makeChildCtx`, `makeSessionApprovingCtx`, and inline ctx literals) gain `isProjectTrusted: () => true`; add one end-to-end untrusted test (global `bash: deny` survives an untrusted project `bash: allow`).
- `docs/decisions/0001-project-trust-adoption.md` — update Status from "Accepted — defer implementation to a follow-up issue" to implemented, referencing issue #644 and its release.
- `docs/configuration.md` — add a "Project trust" subsection near the scope table describing that project + project-agent scopes are withheld until trust is granted, and the reduced-scope warning.
- `README.md` — add a one-line trust note by the scope table (lines ~104–109).
- `docs/migration/0644-project-trust-gating.md` — new migration note (breaking): what changed, who is affected (untrusted directories), how to restore prior behavior (grant project trust or set `defaultProjectTrust`), following the `strict-config-validation.md` pattern.
  Add its link to the README doc-index table.

## Test Impact Analysis

1. **New unit tests enabled.**
   The explicit `projectTrusted` seam makes the trust decision directly assertable at each layer: `loadAndMergeConfigs` project-skip (loader unit), `ConfigStore.refresh` forwarding (store unit), `PermissionSession` cwd-withholding (session unit), and handler skip/warn behavior (handler unit) — none of which existed before because trust was never consulted.
2. **Redundant tests.**
   None become redundant; the existing trusted-path tests remain valid as the `projectTrusted: true` case (they now pass the arg explicitly).
3. **Tests that must stay as-is.**
   `test/permission-manager-unified.test.ts` `configureForCwd(cwd) applies project config` and the #646 fail-closed clamp tests genuinely exercise the trusted/loaded path and the manager merge; they are unchanged (the gate never reaches the manager when untrusted).

## Invariants at risk

- **#646 fail-closed clamp** (`floorAllowsToAsk` on an invalid non-global scope) — pinned by `test/permission-manager-unified.test.ts` and the config-loader fail-closed tests.
  This change does not touch `resolvePermissions`; when untrusted, the project scope is not loaded so `projectConfig.invalid` never fires — no interaction, no regression.
  Verified by leaving those tests untouched and green.
- **Trust-grant recovery** (ADR-0001) — pinned by a new `handleResourcesDiscover` reload test asserting `session.reload(true)` loads project policy after trust flips to `true`.
- **`refreshConfig` before `resetForNewSession` ordering** — pinned by the existing `calls refreshConfig before resetForNewSession` test; preserved (both simply gain the trust arg).

## TDD Order

1. **Loader project-scope skip.**
   Test surface: `test/config-loader.test.ts`.
   Covers: `loadAndMergeConfigs(agentDir, cwd, root, { includeProjectScope: false })` omits both the new project config and the legacy project policy (global-only merge); default / `true` still merges project.
   Commit: `feat(pi-permission-system): support skipping project scope in loadAndMergeConfigs`.

2. **Gate both load paths on project trust + loud warning.**
   Test surfaces: `test/handlers/lifecycle.test.ts`, `test/permission-session.test.ts`, `test/config-store.test.ts`, `test/session-start.test.ts`, `test/composition-root.test.ts`, and the `makeCtx` fixture.
   Covers: `handleSessionStart` reads `ctx.isProjectTrusted()` and calls `refreshConfig(ctx, trusted)` / `resetForNewSession(ctx, trusted)`; when untrusted it warns (`UNTRUSTED_PROJECT_MESSAGE`) and review-logs, and withholds the project cwd (`configureForCwd(undefined)`) and skips project runtime config (`includeProjectScope: false`); `handleResourcesDiscover(event, ctx)` gates `reload` on trust, warns on skip, and loads project policy after a trust grant; an end-to-end test proves a global `bash: deny` survives an untrusted project `bash: allow`.
   This single commit lands the required-parameter signature cascade across `config-loader` consumer, `config-store`, `permission-session`, `lifecycle`, `index.ts`, and all affected fixtures/tests (they break at the type level together).
   Commit: `fix(pi-permission-system)!: gate project-scoped config on project trust` with a `BREAKING CHANGE:` footer.

3. **Docs: ADR status, configuration, README, migration note.**
   Covers: ADR-0001 Status → implemented (Refs #644); `docs/configuration.md` project-trust subsection; `README.md` scope-table trust note + migration-doc index row; `docs/migration/0644-project-trust-gating.md`.
   Commit: `docs(pi-permission-system): document project-trust gating for project config`.

## Risks and Mitigations

- **Risk:** an empty cwd passed to the runtime-config path resolves project paths against `process.cwd()`, defeating the gate.
  **Mitigation:** gate the runtime path with an explicit `includeProjectScope: false` flag, never an empty/undefined cwd; asserted in the config-store unit test.
- **Risk:** breaking-change surprise for users who rely on project config in untrusted directories.
  **Mitigation:** loud UI warning + review-log entry on every skip; a migration note explaining how to restore behavior (grant trust or set `defaultProjectTrust`); `fix!` + `BREAKING CHANGE:` footer so the changelog and close comment surface it.
- **Risk:** trust granted mid-session does not pick up the project's runtime knobs (`yoloMode` etc.) until the next session start.
  **Mitigation:** documented as an accepted limitation (the safe direction — global-only runtime); policy still reloads immediately via `resources_discover`.
  Tracked in Open Questions.
- **Risk:** a hand-built test ctx lacking `isProjectTrusted` throws at `ctx.isProjectTrusted()`.
  **Mitigation:** default `makeCtx` to trusted and audit every ctx builder (`session-start`, `composition-root`) for the method in cycle 2.

## Open Questions

- Should the `resources_discover reload` path also re-run `refreshConfig` so a trust grant immediately reloads the project **runtime** config (not just policy)?
  Deferred — today's reload re-reads policy only, and global-only runtime is the safe interim state.
  If desired, file a follow-up to unify the reload to refresh both; not created now (nothing concrete depends on it).
- Is there value in surfacing the trust state in the `/permission-system` status/UI (beyond the transient warning)?
  Deferred; out of scope for the enforcement fix.
