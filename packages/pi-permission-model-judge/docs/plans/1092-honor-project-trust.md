---
issue: 1092
issue_title: "pi-permission-model-judge: project config is read even when the project is untrusted"
---

# Withhold an untrusted project's model-judge config

## Release Recommendation

**Release:** ship independently

`@gotgenes/pi-permission-model-judge` has no `docs/architecture/` roadmap, so this issue belongs to no release batch.
It is a self-contained security fix in one package, so it cuts its own (major) release at ship time.

## Problem Statement

The judge loads the project-scope config (`<cwd>/.pi/extensions/pi-permission-model-judge/config.json`) whether or not the operator trusts the project.

The observed scenario, in order:

1. The operator clones a repository that ships `.pi/extensions/pi-permission-model-judge/config.json` and launches Pi.
2. Pi sees `.pi/extensions/` (one of its `TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES`) and asks whether to trust the project; the operator declines, or a non-UI mode defaults to untrusted.
3. `pi-permission-system` warns "project is not trusted — skipping project-scoped permission configuration" and applies global policy only.
4. The model judge loads the project file anyway: its `provider`, `model`, `instructions`, `typoPatterns`, and `timeoutMs` override the operator's global config, so the untrusted repository chooses which provider receives the reviewed tool input and the prompt it is reviewed under.
   Nothing tells the operator.

The code path: the `session_start` handler in `src/extension.ts` calls `loadConfig(ctx.cwd)`, and `loadModelJudgeConfig` (`src/config-loader.ts`) reads the global and project layers unconditionally.
Nothing consults `ctx.isProjectTrusted()`.

## Goals

- In an untrusted project, the project model-judge config contributes nothing: it is not read, not parsed, and produces no config issue.
- When an untrusted project *has* a model-judge config file, the operator is told it was skipped; an untrusted project without one stays silent.
- `session_start` warnings (the trust skip and the existing config-issue warnings) reach the operator as a Pi notification when the session has a UI, falling back to `console.warn` otherwise.
- The trust fact is required at the loader, so a caller that forgets it fails to compile rather than failing open.

This change is **breaking**.
On upgrade, without any user edit, an untrusted project's model-judge config stops applying.
It follows the `pi-permission-system` precedent for the same gate (`f264e711`, `fix(pi-permission-system)!: gate project-scoped config on project trust`): the trust-gate step is `fix(pi-permission-model-judge)!:` with a `BREAKING CHANGE:` footer.

## Non-Goals

- **The `typoPatterns` 1,000-entry bound from [#1090].**
  Its plan named this issue's path as the untrusted-reachable one; after this change the project file is reachable only when trusted, but the bound stays as defense in depth for both scopes.
  `test/config-loader.test.ts`'s bound test keeps passing (through the trusted `load()` helper).
- **The unresolved-service warning's sink.**
  `warnUnresolvedService` fires from a `pi.events` handler that holds no `ctx`; it stays on `console.warn`.
  Unifying it would need a stored `ctx` and is out of scope.
- **Mid-session trust changes.**
  Pi resolves trust inside `resourceLoader.reload()` before extensions receive `session_start`, and the judge loads config only at `session_start` (which also fires on `/reload`).
  A trust change takes effect at the next `session_start`, matching how the judge already treats config edits.
- **A fallback for a Pi without `ctx.isProjectTrusted()`.**
  The method landed in Pi 0.79.1; the package's peer floor is `>=0.84.3`.
- **`pi-permission-system`.**
  Its trust gate already exists; no change there.
- **`readLayer` and the shallow-merge semantics.**
  Unchanged for a trusted project.

## Background

`src/config-loader.ts` is a pure library module (no SDK imports, IO through `node:fs`).
`loadModelJudgeConfig({ cwd, agentDir })` reads the global layer, then the project layer, shallow-merges them (project wins), and validates the merge with zod.
It has three return sites: the neither-file early return, the invalid-merge return, and the success return.

`src/extension.ts` is the SDK boundary.
Its `ModelJudgeDependencies.loadConfig?: (cwd: string) => LoadConfigResult` seam defaults to a lambda calling `loadModelJudgeConfig({ cwd, agentDir: getAgentDir() })`.
The `session_start` handler loads config, captures `ctx.modelRegistry`, and reports each `result.issues` entry through a module-private `warn()` that writes `console.warn("[pi-permission-model-judge] …")`.

How `pi-permission-system` does it: `SessionLifecycleHandler.handleSessionStart` reads `ctx.isProjectTrusted()` and passes it into `refreshConfig`, whose loader takes `includeProjectScope`; on `false` it warns with `UNTRUSTED_PROJECT_MESSAGE` (`packages/pi-permission-system/src/handlers/lifecycle.ts`).

Verified Pi facts (Pi checkout and the pinned `@earendil-works/pi-coding-agent@1.0.0` `dist/`):

- `ctx.isProjectTrusted(): boolean` is on `ExtensionContext` (`dist/core/extensions/types.d.ts`).
- `hasTrustRequiringProjectResources(cwd)` (`trust-manager`) returns true when `<cwd>/.pi/extensions` exists, so a project carrying our config file always goes through trust resolution; the list is identical in the pinned `dist/core/trust-manager.js`.
- `resolveProjectTrusted` returns `false` for a declined prompt, `defaultProjectTrust: "never"`, or no UI with no saved decision.
- Interactive mode starts the TUI before `session_start` ("Start the UI before initializing extensions so session_start handlers can use interactive dialogs"), and neither Pi nor its TUI captures `console.*` output, so a `console.warn` from `session_start` is a raw stderr write under a live TUI.
  Whether it survives the next repaint is unverified; that is why the operator chose `ctx.ui.notify` when `ctx.hasUI`.

The established in-repo sink convention is `pi-autoformat`'s `reportMessage` (`packages/pi-autoformat/src/extension.ts`): `ctx.hasUI ? ctx.ui.notify(message, type) : console.warn(...)`.

## Design Overview

### Decisions settled with the operator

| Question                    | Decision                                                                                                                                    |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| When to warn about the skip | Only when the project is untrusted **and** the project config file exists                                                                   |
| Warning sink                | `ctx.hasUI` → `ctx.ui.notify(text, "warning")`, else `console.warn(text)`, for every `session_start` warning (trust skip and config issues) |

### Loader

```typescript
export interface LoadConfigResult {
  config: ModelJudgeConfig | undefined;
  issues: ConfigIssue[];
  /** The project config file left unread because the project is untrusted; absent otherwise. */
  untrustedProjectConfigPath?: string;
}

export function loadModelJudgeConfig(options: {
  cwd: string;
  agentDir: string;
  projectTrusted: boolean;
}): LoadConfigResult;
```

- `projectTrusted` is **required**: an omitted argument is a type error, never an implicit trust.
- When `projectTrusted` is `false`, `readLayer(getProjectConfigPath(cwd))` is not called, so a malformed untrusted file records no issue.
- `untrustedProjectConfigPath` is computed once (`!projectTrusted && existsSync(projectPath) ? projectPath : undefined`) and carried by all three return sites.
  `existsSync` reads no content from the untrusted project.
- Untrusted with no global config: `{ config: undefined, issues: [], untrustedProjectConfigPath? }`, so the link is not registered, as for any unconfigured session.

### Extension

```typescript
export interface ModelJudgeDependencies {
  loadConfig?: (cwd: string, projectTrusted: boolean) => LoadConfigResult;
  complete?: CompleteFn;
}

pi.on("session_start", (_event, ctx) => {
  const result = loadConfig(ctx.cwd, ctx.isProjectTrusted());
  config = result.config;
  registry = ctx.modelRegistry;
  if (result.untrustedProjectConfigPath !== undefined) {
    reportWarning(ctx, untrustedProjectMessage(result.untrustedProjectConfigPath));
  }
  for (const issue of result.issues) {
    reportWarning(ctx, `config issue at ${issue.sourcePath ?? "(merged)"} — ${issue.path}: ${issue.message}`);
  }
});
```

- `reportWarning(ctx: Pick<ExtensionContext, "hasUI" | "ui">, message)` is a module-private helper beside `warn()`: it builds the same `[pi-permission-model-judge] <message>` text for both sinks, calls `ctx.ui.notify(text, "warning")` when `ctx.hasUI`, and `console.warn(text)` otherwise.
  The narrow `Pick` mirrors `pi-autoformat`'s `AutoformatExtensionContext`.
- Existing `injected loadConfig: () => CONFIG_RESULT` test seams stay assignable to the two-parameter signature.
- Untrusted-skip message text (exact, pinned by tests):
  `project is not trusted — skipping its model-judge config at <path>. Only the global config applies; grant project trust to load it.`
- Ordering: the trust-skip warning precedes the config-issue warnings.

### Edge cases and the steps that pin them

| Edge case                                       | Behavior                                      | Step                |
| ----------------------------------------------- | --------------------------------------------- | ------------------- |
| Untrusted, global + project both present        | Global values only                            | 4                   |
| Untrusted, project file malformed, global valid | Global config, `issues: []`                   | 4                   |
| Untrusted, project only                         | `config: undefined`, link not registered      | 4                   |
| Trusted                                         | Unchanged layering (project overrides)        | 4 (production seam) |
| Untrusted, project file present                 | One skip warning naming the path              | 5                   |
| Untrusted, no project file                      | No warning                                    | 5                   |
| Trusted, project file present                   | No skip warning                               | 5                   |
| `hasUI` true / false                            | `ui.notify(…, "warning")` / `console.warn(…)` | 3                   |

## Module-Level Changes

- `packages/pi-permission-model-judge/src/config-loader.ts`: required `projectTrusted` option; conditional project read; `untrustedProjectConfigPath` on `LoadConfigResult`; module header comment and `loadModelJudgeConfig` doc comment state the trust gate.
- `packages/pi-permission-model-judge/src/extension.ts`: `loadConfig` seam gains `projectTrusted`; the production lambda forwards it; `session_start` passes `ctx.isProjectTrusted()`; new `reportWarning(ctx, message)` and `untrustedProjectMessage(path)`; config-issue warnings move to `reportWarning`.
  `warn()` stays for `warnUnresolvedService`.
- `packages/pi-permission-model-judge/test/extension.test.ts`: `ctxWithRegistry` widens to a session context (`isProjectTrusted`, `hasUI`, `ui.notify`) with overrides; `bringUpSession` forwards them; new describes for the warning sink, trust forwarding, and the skip warning; the `global config scope` describe gains trusted and untrusted end-to-end cases.
- `packages/pi-permission-model-judge/test/config-loader.test.ts`: a local `load()` helper wraps the seven `loadModelJudgeConfig({ cwd, agentDir })` calls; new untrusted cases.
- `packages/pi-permission-model-judge/README.md` (line 100): "a project file … overrides the global one" gains "when the project is trusted", with the skip warning.
- `packages/pi-permission-model-judge/docs/configuration.md` (line 8): same caveat after the scope list.
- `.pi/skills/package-pi-permission-model-judge/SKILL.md`: a new `## Upstream assumptions` row: `ctx.isProjectTrusted()` holds the final trust decision by `session_start`, and `<cwd>/.pi/extensions` makes a project trust-requiring.
  Upstream files `packages/coding-agent/src/core/resource-loader.ts` (`reload`), `packages/coding-agent/src/core/trust-manager.ts` (`TRUST_REQUIRING_PROJECT_CONFIG_RESOURCES`); breaks as behavioral-silent.

Predicted unchanged, with the claim each rests on:

- `src/config-schema.ts`, `src/typo-reviewer.ts`, `src/model-review.ts`: none reads a config path or trust; they consume the validated `ModelJudgeConfig`.
- `schemas/model-judge.schema.json`: trust is not a config field.
- `CHANGELOG.md`: `git-cliff` generates it at release time.
- `packages/pi-permission-system/**`: no doc there names the judge's project config path (grepped `pi-permission-model-judge/config.json` across the repo's markdown).

## Test Impact Analysis

1. New tests enabled: the loader's untrusted cases are plain tmpdir tests; the extension's sink split needs only the widened fixture; the `global config scope` describe exercises the real loader through the production lambda, so trust forwarding is pinned end-to-end, not only at the mocked seam.
2. Redundant tests: none; no existing test asserts config-issue warnings on either sink (verified by the Tidy-First assessor and the extension test's `console.warn` spy lines).
3. Stay as-is: the registration, latch, and unresolved-service tests; the `unresolvable permission service` describe counts `console.warn` calls, which stays correct because the fixture's `hasUI` defaults to `false` and its configs carry no issues.

## Invariants at risk

- **Global scope honors `PI_CODING_AGENT_DIR` ([#732]).**
  Pinned by `global config scope > reads the global config from the directory PI_CODING_AGENT_DIR names` (real loader, no mock).
  The widened fixture defaults to trusted, so this test keeps its behavior; step 4's new trusted/untrusted cases share its `beforeEach`.
- **Registration from the ready handler, once per session ([#788]).**
  Pinned by the `createModelJudgeExtension` describe; this change touches only the config `session_start` reads, not the ready path.
- **Fail-safe degradation: a config problem registers no link, never a wrong deny.**
  Untrusted-with-project-only yields `config: undefined`; pinned in step 4.

## TDD Order

1. **`test(pi-permission-model-judge): give the extension test context trust and UI fields`**
   - Friction it prepares: steps 3 and 4 need `ctx.hasUI`/`ctx.ui.notify` and `ctx.isProjectTrusted()`; without this, each would edit the shared fixture alongside its behavior tests, and calling `ctx.isProjectTrusted()` on today's `{ cwd, modelRegistry }` fixture throws `TypeError` in every test.
   - `ctxWithRegistry(cwd = "/project", overrides: { trusted?: boolean; hasUI?: boolean } = {})` adds `isProjectTrusted: () => trusted ?? true`, `hasUI: hasUI ?? false`, `ui: { notify: vi.fn() }`; it returns the ctx so a test can read `ctx.ui.notify`.
     `bringUpSession(pi, cwd?, overrides?)` forwards the overrides.
     Zero-arg call sites stay unchanged.
   - No new tests; verify the full package suite and `pnpm --filter @gotgenes/pi-permission-model-judge run check` stay green.
2. **`test(pi-permission-model-judge): route loader tests through a local load helper`**
   - Friction it prepares: step 4 makes `projectTrusted` required, which would otherwise edit seven `loadModelJudgeConfig({ cwd, agentDir })` calls in the behavior commit.
   - Add `function load(): LoadConfigResult { return loadModelJudgeConfig({ cwd, agentDir }); }` inside the describe and route the seven calls through it; step 4 changes that one line to `load(projectTrusted = true)`.
   - No new tests; verify the file stays green.
3. **`fix(pi-permission-model-judge): show session-start config warnings as a Pi notification in interactive sessions`**
   - Red: a new `describe("session_start warnings")` in `test/extension.test.ts`, injecting `loadConfig: () => ({ config: undefined, issues: [{ path: "model", message: "Required", sourcePath: "/g/config.json" }] })`:
     - with `hasUI: true`: `ctx.ui.notify` called with `("[pi-permission-model-judge] config issue at /g/config.json — model: Required", "warning")` and `console.warn` not called;
     - with `hasUI: false`: `console.warn` called with that text and `ui.notify` not called.
   - Green: add `reportWarning(ctx, message)`; route the issue loop through it.
   - Killing mutations: make `reportWarning` always call `console.warn` (kills the `hasUI: true` test); make it always call `ctx.ui.notify` (kills the `hasUI: false` test).
4. **`fix(pi-permission-model-judge)!: ignore an untrusted project's model-judge config`**
   - Red (`test/config-loader.test.ts`): `load(projectTrusted = true)` passes the new option; new `describe("an untrusted project")`:
     - global `model: "claude-haiku"` + project `model: "claude-sonnet"`, `load(false)` → `config.model` is `"claude-haiku"` with `typoPatterns`/`timeoutMs` from global (full `toEqual`);
     - valid global + `writeProjectRaw("{ not valid json ")`, `load(false)` → `issues` equals `[]` and the global config loads;
     - project only, `load(false)` → `config` undefined and `issues` `[]`.
   - Red (`test/extension.test.ts`):
     - a `loadConfig` `vi.fn` receives `("/project", false)` for an untrusted ctx and `("/project", true)` for a trusted one;
     - `global config scope`: write a project config with distinct `instructions` into `projectCwd`; untrusted → `complete` receives the global `SCOPED_INSTRUCTIONS` as `systemPrompt`; trusted → it receives the project instructions.
   - Green: required `projectTrusted` option and the conditional project read in the loader; the two-parameter seam and its production lambda; `session_start` passes `ctx.isProjectTrusted()`; update the loader's header and doc comments.
   - Killing mutations: in the loader, read the project layer regardless of `projectTrusted` (kills all three loader cases and the untrusted end-to-end case); in `session_start`, pass the literal `true` (kills the untrusted seam and end-to-end tests); pass the literal `false` (kills the trusted seam and end-to-end tests).
   - Commit footer: `BREAKING CHANGE: In an untrusted project, <cwd>/.pi/extensions/pi-permission-model-judge/config.json no longer applies; only the global config does. Grant project trust to load it.`
   - Run `pnpm --filter @gotgenes/pi-permission-model-judge run check` after the commit (shared seam signature change).
5. **`fix(pi-permission-model-judge): warn when an untrusted project's model-judge config is skipped`**
   - Red (`test/config-loader.test.ts`): `untrustedProjectConfigPath` equals `getProjectConfigPath(cwd)` when untrusted with a project file (assert in each of the three return shapes: global present, project only, malformed project); is `undefined` when untrusted with no project file; is `undefined` when trusted with a project file.
   - Red (`test/extension.test.ts`): an injected `loadConfig` returning `untrustedProjectConfigPath: "/p/.pi/extensions/pi-permission-model-judge/config.json"` → exactly one warning with the exact text `[pi-permission-model-judge] project is not trusted — skipping its model-judge config at /p/.pi/extensions/pi-permission-model-judge/config.json. Only the global config applies; grant project trust to load it.` (through `console.warn` with `hasUI: false`; through `ui.notify(…, "warning")` with `hasUI: true`); a result without the field → no warning; `global config scope` untrusted case → the warning names the real `projectCwd` path.
   - Green: compute `untrustedProjectConfigPath` once in the loader and carry it at all three return sites; add `untrustedProjectMessage(path)` and the `reportWarning` call ahead of the issue loop.
   - Killing mutations: drop the `existsSync` condition (kills "untrusted, no project file"); drop the `!projectTrusted` condition (kills "trusted, project file"); omit the field at the early `global === undefined && project === undefined` return (kills the project-only case); delete the extension's `reportWarning` call for the skip (kills the extension warning tests).
6. **`docs(pi-permission-model-judge): document the project-trust gate on the project config`**
   - `README.md` line 100 and `docs/configuration.md` line 8: the project layer applies only when the project is trusted; an untrusted project's file is skipped with a warning.
   - `.pi/skills/package-pi-permission-model-judge/SKILL.md`: the `## Upstream assumptions` row from Module-Level Changes.
   - Verify: `pnpm exec rumdl check` on the three files.

## Risks and Mitigations

- **A test ctx without `isProjectTrusted` throws.**
  Step 1 widens the one fixture every extension test builds its ctx through; every `session_start` invocation in the file goes through `ctxWithRegistry`.
- **`ui.notify` at `session_start` reaching no UI.**
  Pi starts the TUI before `session_start` so handlers can use dialogs; `hasUI: false` modes (print, subagent children) fall back to `console.warn`.
- **Optional result field and exact assertions.**
  `toEqual` ignores `undefined`-valued keys, so the existing `toEqual({ config: undefined, issues: [] })` assertions stay green when the field is present as `undefined`; step 5's tests assert the field directly.
- **Required option ripple.**
  `loadModelJudgeConfig` has one production caller (the extension's default lambda) and seven test callers, all routed through step 2's helper.

## Open Questions

None.

[#732]: https://github.com/gotgenes/pi-packages/issues/732
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#1090]: https://github.com/gotgenes/pi-packages/issues/1090
