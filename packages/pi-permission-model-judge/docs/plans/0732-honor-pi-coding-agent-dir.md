---
issue: 732
issue_title: "pi-permission-model-judge: global config path ignores PI_CODING_AGENT_DIR, diverging from pi-permission-system"
---

# Honor `PI_CODING_AGENT_DIR` for the global config scope

## Release Recommendation

**Release:** ship independently

`@gotgenes/pi-permission-model-judge` has no `docs/architecture/` roadmap, so this issue belongs to no release batch.
It is a self-contained `fix:` in one package with no cross-package coupling, so it cuts a release on its own at ship time.

## Problem Statement

`loadModelJudgeConfig` resolves the global config scope from a hardcoded `join(homedir(), ".pi", "agent")` rather than from the SDK's `getAgentDir()`, which reads `PI_CODING_AGENT_DIR`.
The production call site — `packages/pi-permission-model-judge/src/extension.ts:48` — invokes `loadModelJudgeConfig({ cwd })` with no `agentDir`, so the hardcoded default always wins.

With `PI_CODING_AGENT_DIR` set, the global `pi-permission-model-judge/config.json` is never found, `loadModelJudgeConfig` returns `{ config: undefined }`, `tryRegister()` returns early forever, and the `model-judge` link is never registered.
Every ask in that session then logs `authorizer_chain_unregistered_link` — a failure mode indistinguishable in the review log from "the extension is not installed".

`@gotgenes/pi-permission-system` resolves the same scope through `getAgentDir()`, so the two packages disagree about where the global scope lives whenever that variable is set.

## Goals

- The global config scope resolves from the same directory `@gotgenes/pi-permission-system` uses, honoring `PI_CODING_AGENT_DIR`.
- The env read happens once at the extension boundary and is injected downward, leaving `config-loader.ts` free of SDK imports and hidden global reads.
- The production wiring — not just the loader's default — is covered by a test, since the wiring is where the defect lived.

This change is **not** breaking.
A user who has `PI_CODING_AGENT_DIR` set and a config sitting at `~/.pi/agent/extensions/pi-permission-model-judge/config.json` will stop having that file read, but the extension was only finding it there by accident: it was already ignoring the scope the rest of Pi uses.
The commit is `fix:` with the behavior change described in the body, not `fix!:`.

## Non-Goals

- **`pi-autoformat`'s identical defect.**
  `packages/pi-autoformat/src/config-loader.ts:61` has the byte-identical `defaultAgentDir()` and the same never-overridden call at `src/extension.ts:625`.
  Filed as [#762]; this plan stays single-package.
- **The subagent chain-registration failure.**
  [#727] and [#699] describe a different cause of `authorizer_chain_unregistered_link` records — a child session reusing the parent's service.
  This plan fixes only the config-scope path, which is a separate and independent cause of the same log line.
- **The config layering itself.**
  The two-scope global-then-project merge, the shallow-merge semantics, and the fail-safe `{ config: undefined }` degradation are unchanged.
- **`docs/configuration.md`.**
  Line 5 already states the global path "respects `PI_CODING_AGENT_DIR`" — the documentation was correct and the code was wrong.
  No doc edit is needed; do not "fix" a line that becomes true with this change.
- **`README.md` and `schemas/`.**
  Neither names `agentDir`, the global path, or the environment variable.

## Background

Three modules are in scope.

`packages/pi-permission-model-judge/src/config-loader.ts` is a pure library module — no SDK imports, all IO through `node:fs`.
It exports `getGlobalConfigPath(agentDir = defaultAgentDir())` and `loadModelJudgeConfig(options?: { cwd?: string; agentDir?: string })`, both of which fall back to module-private defaults that read process globals (`homedir()` and `process.cwd()`).

`packages/pi-permission-model-judge/src/extension.ts` is the SDK boundary.
It already imports from `@earendil-works/pi-coding-agent` (as a type-only import) and constructs the default `loadConfig` seam at line 48.

The SDK's `getAgentDir()` (verified in the installed 0.79.1 at `dist/config.js:393`) reads `process.env.PI_CODING_AGENT_DIR`, tilde-expands it, and otherwise falls back to `join(homedir(), ".pi", "agent")`.
It reads the variable at call time, not at module scope.

Two conventions apply, and they agree.

The `code-design` skill states that library and utility functions must not read `process.env` or `process.cwd()` internally, and that Pi SDK imports stay out of business-logic modules.
The repo's dominant wiring convention matches: `packages/pi-permission-system/src/index.ts:56` resolves `getAgentDir()` once at the entry point and passes it down, `packages/pi-colgrep/src/extension.ts:59` calls `getGlobalConfigPath(getAgentDir())` at the extension layer, and `packages/pi-permission-system/src/permission-manager.ts:375` carries a comment naming this explicitly:

> Setting agentsDir explicitly from agentDir removes the hidden `getAgentDir()` env-read that FilePolicyLoader's default would perform.

`packages/pi-permission-system/src/policy-loader.ts:107` is the counter-example the issue points at — it calls `getAgentDir()` as a loader-internal default.
That is the pattern being moved away from, per the `permission-manager.ts` comment above, so this plan follows the boundary-injection form rather than replicating it.

## Design Overview

Delete `defaultAgentDir()` and make both scope inputs required, supplied by the extension.

```typescript
// src/config-loader.ts — after
export function getGlobalConfigPath(agentDir: string): string;

export function loadModelJudgeConfig(options: {
  cwd: string;
  agentDir: string;
}): LoadConfigResult;
```

The `process.cwd()` default goes with `homedir()` in the same change.
Both are hidden global reads in the same two lines of the same function, and the extension already has the authoritative `cwd` from `ctx.cwd` — keeping one default while removing the other would leave the module half-pure for no benefit.

The call site resolves the scope:

```typescript
// src/extension.ts — the consumer's call site
const loadConfig =
  dependencies.loadConfig ??
  ((cwd: string) => loadModelJudgeConfig({ cwd, agentDir: getAgentDir() }));
```

Three properties of this shape are deliberate:

1. **`getAgentDir()` is called inside the lambda, not hoisted above it.**
   Hoisting to the `createModelJudgeExtension` body would read the env even when a test injects `loadConfig`, and would freeze the value at extension-construction time.
   Calling it lazily means the env read happens only on the production path, matches `policy-loader.ts`'s "deferred until call-time, not module scope" convention, and lets a test use `vi.stubEnv` without `vi.resetModules()`.
   The cost is one `process.env` read plus a `join` per `session_start`.
2. **The `ModelJudgeDependencies.loadConfig` seam signature is unchanged** — still `(cwd: string) => LoadConfigResult`.
   The `agentDir` is a production wiring detail, not something a test needs to vary through the seam, so no existing test changes.
3. **The `ExtensionAPI` import widens from type-only to a value import**: `import { type ExtensionAPI, getAgentDir } from "@earendil-works/pi-coding-agent";`.

### Why the loader-default alternative was rejected

Putting `getAgentDir()` inside `defaultAgentDir()` is a one-line diff and would fix the symptom.
It was rejected because it leaves the *actual* defect — a production call site that supplies no scope — structurally intact and untested, and because it moves an SDK import and an env read into the one module in this package that is currently free of both.

### Design review

Run against the `design-review` checklist, since this bug fix is a wiring change.

| Check                   | Finding                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------ |
| Dependency width        | `{ cwd, agentDir }` — two fields, both read by `loadModelJudgeConfig`. No smell.                 |
| Law of Demeter          | No chained access introduced; `getAgentDir()` is a free function.                                |
| Output arguments        | None; the loader returns a value.                                                                |
| Parameter relay         | `agentDir` travels one hop, boundary → loader, and is consumed there. No intermediary relays it. |
| Repeated discriminators | None introduced.                                                                                 |
| Test mock depth         | The new test injects only `complete`; it adds no mock of the loader.                             |

## Module-Level Changes

`packages/pi-permission-model-judge/src/config-loader.ts`:

- Remove `defaultAgentDir()`.
- Remove the now-unused `import { homedir } from "node:os";` — `homedir` is that import's only binding.
- `getGlobalConfigPath(agentDir: string)` — parameter required, default removed.
- `loadModelJudgeConfig(options: { cwd: string; agentDir: string })` — options bag and both fields required; the `?? defaultAgentDir()` and `?? process.cwd()` fallbacks are deleted.

`packages/pi-permission-model-judge/src/extension.ts`:

- Widen the `@earendil-works/pi-coding-agent` import to bring in `getAgentDir` as a value.
- Line 48's default `loadConfig` lambda passes `{ cwd, agentDir: getAgentDir() }`.

`packages/pi-permission-model-judge/test/extension.test.ts`:

- Add a `describe("global config scope")` block covering the production wiring.

Verified unchanged, with the greps that establish it:

- `grep -rn "agentDir|getGlobalConfigPath|loadModelJudgeConfig"` across the package returns only the two `src/` files above, `test/config-loader.test.ts`, and `docs/plans/0600-dogfood-model-judge-authorizer.md`.
  The 0600 plan is a historical record of a landed change and is not edited.
- `test/config-loader.test.ts` already passes `{ cwd, agentDir }` explicitly at all six call sites and `getGlobalConfigPath(agentDir)` at line 37, so making the parameters required costs no test churn.
- `ls .pi/skills/` confirms there is no `package-pi-permission-model-judge` skill, so the skill-grep step has no target in this package.
- `packages/pi-permission-model-judge/docs/` contains only `configuration.md`, `plans/`, and `retro/` — no `architecture/` tree with a module listing or roadmap step to mark.

## Test Impact Analysis

**What the change enables that was previously untested.**
`createModelJudgeExtension` has seven existing tests, and every one injects `loadConfig`.
The default seam — the line that carried the bug — had zero coverage.
The new test is the first to drive `session_start` with no injected `loadConfig`, so it pins the production path end to end: env var → `getAgentDir()` → `getGlobalConfigPath` → `readLayer` → `safeParse` → `registerAuthorizer` → the authorizer's model call.

**What becomes redundant.**
Nothing.
The existing extension tests exercise registration ordering, idempotency, disposal, and the authorizer verdict — all orthogonal to scope resolution.
The six `config-loader.test.ts` cases exercise merge and validation semantics with explicit scopes and remain exactly as valuable.

**What must stay as-is.**
`test/config-loader.test.ts` in full: it is the layering contract, and it already passes both scopes explicitly, which is precisely the shape this change makes mandatory.

**The false-green hazard, measured at planning time.**
A test that asserts only "`registerAuthorizer` was called" is not a valid red.
I wrote the test as a disposable spike and ran it against unfixed `main`: `registerAuthorizer` **passed**, because this machine has a real `~/.pi/agent/extensions/pi-permission-model-judge/config.json` that the hardcoded default happily loaded.
The same assertion would have failed on CI, where that file is absent — an environment-dependent test that proves nothing about the fix.

The test must therefore assert on config *content* that only the temp scope can supply.
The measured shape: write a global config under the stubbed `PI_CODING_AGENT_DIR` whose `instructions` and `typoPatterns` carry a marker string, drive the registered authorizer with a path matching that marker pattern, and assert the injected `complete` stub received a context whose `systemPrompt` is the marker.
`reviewPath` sets `context.systemPrompt = inputs.config.instructions` (`src/model-review.ts:138`), so the assertion reads the loaded config directly.

Measured result: pre-fix, `complete` is called 0 times (the home config's patterns do not match the marker path, so `typo-reviewer` short-circuits at `pattern-miss`); post-fix, it is called once with the marker system prompt.
That red is machine-independent — it fails both with and without a real home config present.

## Invariants at risk

- **The deny-first fail-safe** (`src/typo-reviewer.ts`, ADR 0007 invariant 2 in `@gotgenes/pi-permission-system`): every failure path defers, and this slice never emits `allow`.
  Pinned by the existing `typo-reviewer.test.ts` and `model-review.test.ts` suites.
  This change touches no decision path.
- **Registration idempotency across the two triggers** (`session_start` and `permissions:ready`, either order): pinned by three existing tests in `test/extension.test.ts`.
  The new test drives the same guard through the un-injected path and must not weaken it.
- **Config-error degradation** — an invalid config yields no registration rather than a wrong deny: pinned by `registers nothing when config is absent` plus the `config-loader.test.ts` validation cases.
  Unchanged, since only the path resolution moves.

## TDD Order

1. **Red → Green → Commit: the global scope honors `PI_CODING_AGENT_DIR`.**
   Add `describe("global config scope")` to `test/extension.test.ts` with the content-discriminating assertion described above: `mkdtempSync` an `agentDir` and an empty project `cwd`, write a marker global config, `vi.stubEnv("PI_CODING_AGENT_DIR", agentDir)`, construct the extension injecting only `complete`, fire `session_start` with `ctx.cwd` pointed at the temp project, publish the service, emit ready, then invoke the registered authorizer with a path matching the marker pattern and assert `complete` received `systemPrompt: MARKER_INSTRUCTIONS`.
   Clean up with `vi.unstubAllEnvs()` and `rmSync` in `afterEach`.
   Confirm red, then make it green with both `src/` edits from Module-Level Changes — the signature change and the call-site change must land together, since `tsc` rejects a required parameter with no argument.

   Commit: `fix(pi-permission-model-judge): resolve the global config scope via getAgentDir`

   Body notes that the global scope now honors `PI_CODING_AGENT_DIR`, matching `@gotgenes/pi-permission-system`, and that a user with that variable set and a config at `~/.pi/agent` must move it to the directory the variable names.
   `Refs #732`.

2. **Verify.**
   `pnpm --filter @gotgenes/pi-permission-model-judge run check`, then the package suite, then `pnpm -r run test` and `pnpm fallow dead-code` — the latter because `defaultAgentDir()` is being removed and `homedir` drops out of the import list.

One cycle is correct here.
Splitting the `process.cwd()` removal into its own `refactor:` commit was considered and rejected: it edits the two adjacent lines the fix already rewrites, so a split would produce a commit that changes a signature nothing calls differently.

## Risks and Mitigations

| Risk                                                                                           | Mitigation                                                                                                                                                                                              |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The new test false-greens on a developer machine that has a real global config                 | The assertion discriminates on config content, not on registration. Measured red on this machine with a real config present.                                                                            |
| Env stubbing leaks into sibling tests in the same file                                         | `vi.unstubAllEnvs()` in `afterEach`. `getAgentDir()` reads the env at call time, so no `vi.resetModules()` is needed — verified in the spike.                                                           |
| A downstream consumer deep-imports `src/config-loader.ts` and breaks on the required parameter | The package publishes no `exports` map and documents `src/index.ts` as its only entry; `pi.extensions` names that file alone. The break is theoretical, and the changed functions are internal helpers. |
| A user with `PI_CODING_AGENT_DIR` set silently loses a config that currently works             | Called out in the commit body and the issue close comment. The extension already warns on config *issues* but not on absence, by design — an absent config is the normal not-configured state.          |
| `getAgentDir()` is invoked per `session_start` rather than once per process                    | One `process.env` read and a `join`; negligible, and the laziness is what keeps the test hermetic.                                                                                                      |

## Open Questions

- Should the extension emit a one-time notice when `authorizerChain` names `model-judge` but no config was found?
  That would have surfaced this bug directly, but the signal lives in `@gotgenes/pi-permission-system` (which knows the chain), not here (which only knows its own config).
  Deferred — it is a cross-package observability change, not part of this fix, and [#727] is already open on the adjacent `authorizer_chain_unregistered_link` reporting.
- `packages/pi-autoformat` has the same defect ([#762]) and `packages/pi-session-tools/src/session-file.ts:59` computes a `DEFAULT_SESSIONS_ROOT` from `homedir()` at module scope.
  Whether the latter is a bug or a deliberate default is not established; it is out of scope here and not filed.

[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#727]: https://github.com/gotgenes/pi-packages/issues/727
[#762]: https://github.com/gotgenes/pi-packages/issues/762
