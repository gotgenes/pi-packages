---
issue: 574
issue_title: "Support configurable shell-tool aliases for exec_command"
---

# Gate aliased shell invocations through the bash stack

## Release Recommendation

**Release:** ship now — batch "shell-tool-aliases" tail (this issue completes the batch)

This is Phase 11 Step 3 of the pi-permission-system improvement roadmap, tagged `Release: batch "shell-tool-aliases"`.
The batch has two members — Step 2 ([#580], the `shellTools` config surface, already landed on `main` as a deferred `feat:`) and Step 3 ([#574], this issue, the enforcement gate that consumes it).
Step 3 is the batch tail, so landing it cuts the release that carries both: the deferred Step 2 `feat:` commit and this step's `feat:` commits batch into one `feat(pi-permission-system)` release.

## Problem Statement

`classifyToolKind` answers "what does this invocation access?" from a closed set of hardcoded built-in tool names.
A tool that carries bash semantics under a different name — `@howaboua/pi-codex-conversion` replaces the native `bash` tool with `exec_command` (`cmd` + optional `workdir`) — is classified as a generic extension tool, so it never receives command decomposition, wrapper flooring ([#490]), bash path / external-directory token gates, or `bash:` config rules.
A user's `bash:` deny rules silently do not apply, and the same shell operation is gated differently depending on which toolset is active — an enforcement gap, not a polish item.

Step 2 ([#580]) delivered the `shellTools` config surface (tool name → `{ commandArgument, workdirArgument? }`) with strict validation, cross-scope merge, and docs, but **nothing reads it yet**.
This step consumes it: once the alias is recorded, the dispatch point must route an aliased invocation through the same enforcement the native `bash` tool gets, at parity.

## Goals

- Consume `shellTools` at gate time so an aliased shell tool (e.g. `exec_command`) is gated at parity with native `bash`: command decomposition, wrapper flooring, the `<unparseable-bash-command>` fail-closed sentinel, bash path + external-directory token gates, and `bash:` config rules.
- Introduce **one dispatch point** — `resolveShellInvocation(toolName, input, aliases)` in `access-intent/tool-kind.ts` — that decides "does this invocation carry shell semantics, and what is its command + workdir?" for native bash and aliased tools alike, so the bash gates stop hardcoding `toolName === "bash"` and `input.command`.
- Full `workdir` parity: the alias's `workdirArgument` value becomes the effective resolve base for the aliased command's relative tokens, and `workdir` is itself gated by `external_directory` when it resolves outside the session cwd.
- Preserve the invoked tool's real name in the review log and prompts (`exec_command`, not `bash`) while recording the effective command — a user must see which tool ran what.
- A session "allow for this session" on an aliased shell command adds a `bash:` session rule (so it applies to native `bash` and the alias alike), not an `exec_command:` rule.
- Not breaking: with no `shellTools` config, every tool is classified and gated exactly as today; the new behavior is inert until a user records an alias.

## Non-Goals

- **No new config surface.**
  `shellTools` shipped in Step 2 ([#580]); this step only consumes it.
  Reintroducing the `ShellToolAlias` export (dropped as a speculative export in [#580]'s `e7cc7260`) happens here as its first real consumer.
- **No per-tool path-map for the aliased command's non-command fields.**
  Only `commandArgument` (the shell command) and `workdirArgument` (the effective base) are consumed; any other input field on the aliased tool is ignored, matching the Step 2 config contract.
- **No tool-removal or toolset lever.**
  `shellTools` only ever *tightens* enforcement and is inert when the named tool is unregistered.
  Opting out of a shell-aliasing extension is a package-disable concern Pi owns, not a permission change.
- **No change to native `bash` behavior.**
  The refactor routes native `bash` through the same `resolveShellInvocation` seam, but its resolved `{ command: input.command, workdir: undefined }` reproduces today's behavior exactly — pinned by the existing bash-gate regression suites.

## Background

Relevant existing modules (from the `package-pi-permission-system` skill and the code):

- `src/access-intent/tool-kind.ts` — `classifyToolKind(toolName): ToolKind` is the single dispatch point for "what does this invocation access?", consumed by `input-normalizer`, `tool-input-path`, the tool-call gate pipeline, `permission-manager`'s `deriveSource`, and the presentation consumers.
  It imports only `PATH_BEARING_TOOLS` (AccessPath-free), so `permission-manager.ts` may consume it without breaching the ADR-0002 string boundary.
- `src/handlers/gates/tool-call-gate-pipeline.ts` — `ToolCallGatePipeline.evaluate` parses the bash command **once** into a shared `BashProgram` (guarded by `classifyToolKind(tcc.toolName) === "bash" && command`, with `command` read from `toRecord(tcc.input).command`), runs the six gate producers in order, and resolves the per-tool check (routing bash through `resolveBashCommandCheck`).
  Its narrow `ToolCallGateInputs` interface is what `PermissionSession` satisfies structurally.
- `src/handlers/gates/bash-path.ts` and `bash-external-directory.ts` — both open with `if (tcc.toolName !== "bash") return null;` and re-derive `command` from `toRecord(tcc.input).command`.
  They read their path slices from the injected `BashProgram` (`pathRuleCandidates()` / `externalPaths()`).
- `src/access-intent/bash/program.ts` — `BashProgram.parse(command, normalizer, isPromotablePathToken?)` parses once (tree-sitter) and eagerly resolves the three slices via `BashPathResolver`.
- `src/access-intent/bash/bash-path-resolver.ts` — walks the AST once, threading an `EffectiveBase` (`{ kind: "known"; offset }` | `{ kind: "unknown" }`) seeded at `CWD_BASE = { kind: "known", offset: "" }`.
  `foldCd` folds a literal `cd` target into the base via `normalizer.interpretBashCdTarget`.
  `resolveBase(offset)` resolves a relative-or-absolute offset against the baked cwd; containment (`isBoundaryOutsideWorkingDirectory`) always measures against the baked cwd.
- `src/path-normalizer.ts` — bakes the session cwd for the **containment boundary** only (`canonicalCwd`); the **resolve base** is threaded per-token via `forPath`/`forBashToken`'s `resolveBase` option and the walk's `EffectiveBase`.
  This separation is what makes `workdir` a small addition.
- `src/access-intent/input-normalizer.ts` — `normalizeInput(toolName, input, mcpServerNames)` maps a raw invocation to `{ surface, values, resultExtras }`; the bash branch reads `record.command`.
- `src/access-intent/tool-input-path.ts` — `getPathBearingToolPath` (built-in only) and `getToolInputPath` (extension/MCP-aware) extract the file path for the cross-cutting `path` / `external_directory` gates; both return `null` for `bash`.
- `src/handlers/gates/tool.ts` — `describeToolGate` builds the per-tool descriptor; `deriveSuggestionValue` and `helpers.ts`'s `deriveDecisionValue` dispatch on `classifyToolKind(tcc.toolName)` to pick the decision/suggestion value shape (command / target / path).
- `src/permission-session.ts` — exposes `getPathNormalizer`, `getToolPreviewLimits`, etc. to the pipeline; `get config()` returns `configStore.current()`, which now carries `shellTools` (Step 2).

Constraints from AGENTS.md / the package skill that apply:

- The gate fails closed ([#452]): a non-empty command that parses to zero command units resolves to `ask` with the `<unparseable-bash-command>` sentinel — this must hold for aliased commands too.
- Default to least privilege; wildcard/over-match is a bypass — new classification must be explicit and tested.
- Keep one dispatch point (OCP): route native bash *and* aliased tools through the same `resolveShellInvocation`, do not scatter `toolName === "bash" || isAlias(...)` across the gates.
- `permission-manager.ts` must not import `AccessPath`; the alias data is plain strings (`ShellToolsConfig`), so it respects the string boundary.
- Keep the invoked tool name in logs (skill: "the review log records both the invoked tool name and the effective command").

## Design Overview

### The single dispatch point

Add to `src/access-intent/tool-kind.ts` (AccessPath-free, string-only — safe for every consumer):

```typescript
import type { ShellToolsConfig } from "#src/config-schema";

/** A shell invocation's effective command and optional working directory. */
export interface ShellInvocation {
  /** The shell command string to decompose and gate. */
  command: string;
  /** The working directory the command runs in, if the tool projects one. */
  workdir: string | undefined;
}

/**
 * Decide whether a tool invocation carries shell semantics, and if so extract
 * its command and working directory. Native `bash` and any tool recorded in
 * `shellTools` both yield a {@link ShellInvocation}; every other tool yields
 * `null`. The single dispatch point the bash gates consume instead of
 * re-deriving `toolName === "bash"` and reading `input.command`.
 */
export function resolveShellInvocation(
  toolName: string,
  input: unknown,
  aliases: ShellToolsConfig | undefined,
): ShellInvocation | null;
```

Behavior:

- `toolName === "bash"` → `{ command: getNonEmptyString(input.command) ?? "", workdir: undefined }` (native — reproduces today's extraction).
- `aliases?.[toolName]` present → read `input[alias.commandArgument]` as the command and, when `alias.workdirArgument` is set, `input[alias.workdirArgument]` as the workdir (both via `getNonEmptyString`, `undefined` when absent/empty).
- otherwise → `null`.

Design notes:

- `classifyToolKind` stays **unchanged and config-free** — it still answers the static "what kind of built-in is this name?" question the presentation consumers and the manager need without config.
  The alias consult is a **separate** function because it needs config (the alias map) and its product (`{ command, workdir }`) is richer than a `ToolKind` string.
  This keeps `classifyToolKind`'s AccessPath-free / config-free contract intact (the ADR-0002 string boundary, the presentation consumers that have no config) while giving the gates one place to ask "is this a shell, and what is it running?".
- `ShellInvocation` is a value object the pipeline threads down; the gates never re-read `input`.

### workdir is an implicit leading `cd`

The `PathNormalizer` bakes the session cwd for the **containment boundary** only; the **resolve base** for a relative token is threaded per-token as the walk's `EffectiveBase.offset` (that is how inline `cd` already shifts the base).
So `workdir` is conceptually "an implicit leading `cd <workdir>`" and reuses that machinery — no rearchitecture of the containment / `AccessPath` / cd-fold layers.

Two contained additions inside the bash parse layer:

1. **Seed the walk's initial base from `workdir`.**
   `BashPathResolver.collectPathCandidates` seeds at `CWD_BASE = { offset: "" }` in one place.
   `BashProgram.parse` gains an optional `workdir` and computes the initial `EffectiveBase` from it, reusing the existing `cd`-target interpretation so absolute / relative / win32-MSYS all behave identically to an inline `cd <workdir>`.
   Factor the target→base fold currently inline in `foldCd` into a small reusable helper (`deriveBaseFromCdTarget(base, target)`) and call it from both `foldCd` and the initial seed.
   With no `workdir`, the seed stays `CWD_BASE` (native behavior unchanged).

2. **Add `workdir`'s own `AccessPath` to the external set when it resolves outside the session cwd.**
   A real `cd /etc && …` flags `/etc` via the `cd` argument *token*; the seeded base has no such token, so `BashProgram.parse` explicitly resolves `workdir` (`normalizer.forBashToken(workdir)`), and when `isBoundaryOutsideWorkingDirectory` is true, prepends it to `resolvedExternalPaths` (deduped by canonical form).
   The existing `describeBashExternalDirectoryGate` then flags it with **no gate-signature change** — it just reads `externalPaths()`.

Containment stays measured against the **session** cwd throughout, so `workdir: "/etc"` with a relative token `passwd` resolves to `/etc/passwd` (correct base) and is flagged external (escaped the session sandbox), and `workdir: "/etc"` itself is flagged.
A `workdir` inside the session cwd shifts the base but produces no external prompt.

### Threading the resolved command into the bash gates

The two bash gates stop hardcoding `toolName === "bash"` and `input.command`.
They accept the resolved `command: string | null` (from `resolveShellInvocation(...)?.command`) and the shared `BashProgram | null`:

```typescript
// describeBashPathGate(tcc, command, bashProgram, resolver)
if (!command || !bashProgram) return null;
// … unchanged: read bashProgram.pathRuleCandidates(), resolve on "path" surface …
```

The pipeline resolves the shell invocation once and threads it:

```typescript
async evaluate(tcc, runner) {
  const aliases = this.inputs.getShellToolAliases();
  const shell = resolveShellInvocation(tcc.toolName, tcc.input, aliases);
  const normalizer = this.inputs.getPathNormalizer();

  const bashProgram = shell?.command
    ? await BashProgram.parse(
        shell.command,
        normalizer,
        this.inputs.getPromotablePathTokenMatcher(tcc.agentName ?? undefined),
        { workdir: shell.workdir },
      )
    : null;
  // bash gates receive shell?.command ?? null and bashProgram
  // per-tool gate: shell ? resolveBashCommandCheck(shell.command, bashProgram.commands(), …) : …
}
```

The gate producers pass `shell?.command ?? null` to `describeBashPathGate` / `describeBashExternalDirectoryGate`, and `resolvePerToolCheck` routes on `shell` (not `classifyToolKind === "bash"`).
Because `resolveBashCommandCheck` already emits its intents on the **`bash` surface**, an aliased command is evaluated against `bash:` rules automatically, and the per-tool descriptor's decision/session-approval surface is `bash` (see below).

### Presentation: bash surface, real tool name in logs

For a shell invocation, the per-tool descriptor (`describeToolGate`) must:

- derive its decision value and session-approval pattern from the **command** on the **`bash` surface** (so "allow for session" writes a `bash:` rule, and the decision value is the command) — not from `classifyToolKind("exec_command")` (which is `extension` → would yield the tool name);
- keep `toolName: tcc.toolName` (`exec_command`) in `logContext` / `promptDetails` so the review log shows which tool ran.

`describeToolGate` (and its `deriveSuggestionValue`, plus `helpers.deriveDecisionValue`) therefore need the effective shell command / surface for aliased tools.
Thread an optional `shell: ShellInvocation | null` (or the effective surface + value) into `describeToolGate` so a shell invocation uses `{ surface: "bash", value: command }` for the decision and `SessionApproval.single("bash", pattern)`, while native bash (already `toolName === "bash"`) is unchanged.
The bash path / external-directory gates already set `toolName: tcc.toolName` in their log contexts, so they preserve `exec_command` for free once they run.

### Consumer call-site sketch (pipeline → gates)

```typescript
// pipeline
const shell = resolveShellInvocation(tcc.toolName, tcc.input, aliases); // one consult
// … parse once with workdir seed …
() => describeBashExternalDirectoryGate(tcc, shell?.command ?? null, bashProgram, this.resolver),
() => describeBashPathGate(tcc, shell?.command ?? null, bashProgram, this.resolver),
() => { const { toolCheck } = this.resolvePerToolCheck(tcc, shell, bashProgram, command, normalizer); … },
```

This follows Tell-Don't-Ask: the gates receive the resolved command and program; they never reach back into `tcc.input` for the field name or re-classify the tool.

## Module-Level Changes

- `src/access-intent/tool-kind.ts` — add `ShellInvocation` interface + `resolveShellInvocation(toolName, input, aliases)`; import `ShellToolsConfig` (string-only, AccessPath-free — respects ADR-0002).
  Reintroduce the value-object's field types as needed; `classifyToolKind` itself is untouched.
- `src/handlers/gates/tool-call-gate-pipeline.ts` — resolve `shell` once via `resolveShellInvocation` (through a new `inputs.getShellToolAliases()`); parse `BashProgram` from `shell.command` with the `{ workdir }` seed; thread `shell?.command ?? null` into the two bash gates; route `resolvePerToolCheck` on `shell`; pass `shell` into the per-tool descriptor.
  Replace both `classifyToolKind(tcc.toolName) === "bash"` sites.
- `src/handlers/gates/tool-call-gate-pipeline.ts` (`ToolCallGateInputs`) — add `getShellToolAliases(): ShellToolsConfig | undefined`.
- `src/permission-session.ts` — implement `getShellToolAliases()` returning `this.config.shellTools`.
- `src/handlers/gates/bash-path.ts` — signature `describeBashPathGate(tcc, command, bashProgram, resolver)`; drop the `tcc.toolName !== "bash"` guard and the internal `toRecord(tcc.input).command` read; guard `if (!command || !bashProgram) return null`.
- `src/handlers/gates/bash-external-directory.ts` — same signature change and guard rework; the `externalPaths()` read is unchanged (workdir enters via `BashProgram`).
- `src/access-intent/bash/program.ts` — `parse(command, normalizer, isPromotablePathToken?, options?: { workdir?: string })`; compute the initial base from `workdir` and add the workdir external `AccessPath` when outside cwd.
- `src/access-intent/bash/bash-path-resolver.ts` — accept an injected initial `EffectiveBase` (default `CWD_BASE`); factor the target→base fold out of `foldCd` into `deriveBaseFromCdTarget` and reuse it for the workdir seed; optionally expose the workdir-external contribution (or compute it in `program.ts`).
- `src/handlers/gates/tool.ts` — `describeToolGate` (and `deriveSuggestionValue`) accept the effective shell command/surface so a shell invocation uses the `bash` surface + command value while keeping `tcc.toolName` in logs.
- `src/handlers/gates/helpers.ts` — `deriveDecisionValue` yields the command for a shell invocation (via the threaded shell command / effective surface), not the tool name.
- `src/access-intent/input-normalizer.ts` — the `normalizeInput` bash branch is reached by the manager's `checkPermission(toolName, input)` entry; make its command extraction alias-aware **only if** a consumer routes an aliased `(toolName, input)` through it.
  Grep confirms the enforcement path is the gate pipeline (which uses `resolveShellInvocation` directly), and the advisory service resolves `bash` by explicit command string, so `normalizeInput` may not need the alias.
  Decide during TDD step 3 by tracing `normalizeInput` callers; if untouched, note it in the retro.
- `test/*` — new + updated gate-parity tests (see TDD Order).
- `config/config.example.json`, `docs/configuration.md` — the `shellTools` block already documents the config; add a short "what enforcement it triggers" note pointing at the bash-parity behavior now that it is live (Step 2 documented the *shape*; Step 3 documents the *effect*).
- `README.md` — the `shellTools` mention already exists (Step 2); update only if it claims "config only / no enforcement".
- `docs/architecture/architecture.md` — mark Phase 11 Step 3 complete (`✅` on the Step 3 heading and Mermaid node `S3`); update the `shellTools` health-metric row to note gate-parity is tested/live if the wording implies config-only.
  No `rule.ts`-type listing changes (no `Rule`/`Ruleset` field added).

Grep confirmation performed during planning: the bash gates' `toolName !== "bash"` guards live only in `bash-path.ts` and `bash-external-directory.ts`; the pipeline's two `classifyToolKind === "bash"` sites are the only pipeline-level bash discriminators; `BashProgram.parse` has three call sites (`tool-call-gate-pipeline.ts`, `bash-advisory-check.ts`, `bash-path-extractor.ts`) — the new optional `options` arg is backward-compatible, so the advisory and extractor callers are untouched.

## Test Impact Analysis

This step consumes an existing seam and threads a resolved value; it is not a pure extraction, but the questions still apply:

1. **New tests enabled** —
   - `resolveShellInvocation` unit tests (native bash, aliased with/without workdir, unknown tool, missing command field, empty fields) — a new pure dispatch point testable in isolation.
   - Gate-parity tests: an aliased `exec_command` invocation gets command decomposition, wrapper flooring, the `<unparseable-bash-command>` sentinel, `bash:` rules, bash path + external-directory token gates, and (workdir) relative-base resolution + workdir-escape prompts — asserted against the *same* expectations as native bash.
   - `BashProgram.parse` workdir-seed unit tests (relative token resolves against workdir; workdir-escape adds an external path; absolute token base-independent; no-workdir reproduces `CWD_BASE`).
2. **Redundant tests** — none removed.
   The native-bash gate suites stay as-is and become the parity oracle the aliased cases assert against.
3. **Tests that must stay** — the native-bash bash-path / bash-external-directory / pipeline suites genuinely exercise the surface being generalized; they pin that the `resolveShellInvocation` refactor did not change native behavior (the `{ command: input.command, workdir: undefined }` path).

## Invariants at risk

This step touches the bash gate pipeline, the bash parse layer, and the per-tool descriptor — surfaces earlier phase steps refactored.

- **[#452] fail-closed sentinel** — a non-empty command parsing to zero command units resolves to `ask` with `<unparseable-bash-command>`.
  Pinned by the existing bash-command fail-closed tests; add an aliased-tool case so an `exec_command` opaque payload also fails closed.
- **[#308] parse-once invariant** — the three bash gates share a single `BashProgram`.
  Pinned by the pipeline tests; the workdir seed keeps parsing to one `BashProgram.parse` call per evaluate.
- **[#490] wrapper flooring** — `sudo`/`bash -c`/`eval`/… floor `allow` → `ask`.
  Pinned by the wrapper-flooring suite; add an aliased-tool case (`exec_command` running `sudo …` floors).
- **[#418]/[#486]/[#502] path-surface canonical matching** — bash path candidates resolve on the `access-path` intent with lexical ∪ canonical aliases.
  Unchanged; the aliased command's tokens flow through the identical `BashPathResolver`.
- **[#533] win32 Git Bash semantics** — bash tokens carry MSYS semantics on win32.
  The workdir seed reuses `interpretBashCdTarget`, so a win32 `workdir` (`/c/x` drive-mount, `/tmp` non-mount) is interpreted consistently with an inline `cd`; add a win32 workdir-seed test (`win32PathFlavor`).

No earlier step's documented `Outcome:` invariant is regressed — native bash routes through the same seam with identical extraction, and the new behavior is inert without a `shellTools` config.

## TDD Order

1. **Single dispatch point** (`test: add resolveShellInvocation cases` → `feat(pi-permission-system): add resolveShellInvocation dispatch point`).
   - Red: unit tests for `resolveShellInvocation` — native bash yields `{ command, workdir: undefined }`; an aliased tool with `{ commandArgument: "cmd", workdirArgument: "workdir" }` extracts both; `workdirArgument` absent → `workdir: undefined`; missing/empty command field → `command: ""`; unknown tool + no alias → `null`; `aliases: undefined` → native-bash-only.
   - Green: add `ShellInvocation` + `resolveShellInvocation` to `tool-kind.ts` (import `ShellToolsConfig`; reintroduce any needed alias field type).
   - Verify: `pnpm run check`, the new tests, `pnpm fallow dead-code` (the new export has its consumer added in step 3 — if `dead-code` flags it before then, fold step 3's first consumer into this commit, or land steps 1–3 together; see the batch note below).

2. **Bash gates consume the resolved command** (`refactor(pi-permission-system): thread resolved command into bash gates`).
   - Red: update `bash-path.test.ts` / `bash-external-directory.test.ts` to the new `(tcc, command, bashProgram, resolver)` signature; native-bash expectations unchanged (pass `input.command` as the threaded command).
   - Green: change both gate signatures; drop the `toolName !== "bash"` guards and internal `command` re-derivation; guard `if (!command || !bashProgram) return null`.
     Update the pipeline's two gate-producer call sites to pass the (still `input.command`-derived, this step) command.
   - Verify: `pnpm run check`, the two gate suites + the pipeline suite green (native behavior identical — `refactor:` is a `hidden:` changelog type, correct for a no-behavior-change step).
   - Note: this is a lift-and-shift enabling step — native bash still supplies the command; step 3 swaps the source to `resolveShellInvocation`.

3. **Pipeline routes aliased tools through the bash stack** (command-surface parity) (`feat(pi-permission-system): gate aliased shell tools through the bash stack`).
   - Red: pipeline / integration tests — with `shellTools: { exec_command: { commandArgument: "cmd" } }`, an `exec_command` call with `{ cmd: "npm install" }` evaluates against `bash:` rules (deny/ask honored), decomposes a chained command, floors a `sudo`/`bash -c` wrapper, fails closed on an opaque payload, and gates an absolute-path token via bash path / external-directory — all against the native-bash oracle.
     Assert the review log records `toolName: "exec_command"` with the effective command, and a session "allow" writes a `bash:` rule.
   - Green: add `getShellToolAliases` to `ToolCallGateInputs` + `PermissionSession`; resolve `shell` once in the pipeline and thread `shell?.command` / `shell` into the bash gates, `resolvePerToolCheck`, and the per-tool descriptor; update `describeToolGate` / `deriveSuggestionValue` / `deriveDecisionValue` for the effective `bash` surface + command value while preserving `tcc.toolName` in logs.
     Trace `normalizeInput` callers; make the bash branch alias-aware only if a real consumer needs it (else leave it and note in retro).
   - Verify: `pnpm run check`, `pnpm -r run test` for the package, `pnpm fallow dead-code`.

4. **workdir full parity** (`feat(pi-permission-system): resolve and gate aliased shell workdir`).
   - Red: `BashProgram.parse` workdir-seed tests (relative token resolves against `workdir`; workdir-escape `/etc` adds an external path; absolute token base-independent; no-workdir == `CWD_BASE`; win32 `workdir` via `win32PathFlavor`) plus a pipeline test that an `exec_command` with `{ cmd: "cat passwd", workdir: "/etc" }` prompts `external_directory` for both `/etc` and `/etc/passwd`.
   - Green: add the `{ workdir }` option to `BashProgram.parse`; factor `deriveBaseFromCdTarget` out of `foldCd`; seed `BashPathResolver`'s initial `EffectiveBase` from `workdir`; add the workdir external `AccessPath` when outside cwd; pass `shell.workdir` from the pipeline.
   - Verify: `pnpm run check`, `pnpm -r run test`, `pnpm fallow dead-code`.

5. **Docs + example + roadmap** (`docs(pi-permission-system): document live shellTools enforcement`).
   - Update `docs/configuration.md` (and `README.md` / `config.example.json` if they imply config-only) to state the enforcement `shellTools` now triggers (bash parity, workdir base + external_directory gating).
   - Mark Phase 11 Step 3 complete in `docs/architecture/architecture.md` (`✅` on the Step 3 heading and Mermaid node `S3`); update the `shellTools` health-metric row wording to reflect live gate-parity.
   - Verify: `pnpm exec rumdl check` on the edited markdown; `config.example.json` still parses/validates.

Batch note: steps 1–4 add `feat:` behavior; the `resolveShellInvocation` export in step 1 has no consumer until step 3, which the `fallow dead-code` gate flags (the [#580] speculative-export lesson).
Either fold step 1's export into step 3, or land steps 1–3 in close succession and run `fallow dead-code` only after step 3.
Prefer keeping the commits separate but running the `dead-code` gate at the step-3 boundary, not the step-1 boundary.

## Risks and Mitigations

- **Native-bash regression from the `resolveShellInvocation` refactor** — mitigated by step 2 being a pure `refactor:` with the native-bash suites as the unchanged oracle, and step 1's `resolveShellInvocation` reproducing `{ command: input.command, workdir: undefined }` exactly.
- **Silent classification bypass (an aliased tool not routed to bash)** — mitigated by explicit parity tests asserting `bash:` rules, wrapper flooring, and the fail-closed sentinel fire for the aliased tool, against the native oracle.
- **workdir base vs. containment confusion** — the design keeps the containment boundary at the session cwd (baked in the normalizer) and only shifts the resolve base; pinned by the `/etc` + relative-token test asserting *both* `/etc` and `/etc/passwd` prompt.
- **Presentation leak (log shows `bash` not the real tool)** — mitigated by the log-context assertion (`toolName: "exec_command"`) in step 3 and by keeping the bash gates' existing `toolName: tcc.toolName` log fields.
- **`fallow dead-code` on the step-1 export** — mitigated by the batch note (run the gate at the step-3 boundary); the [#580] retro flagged this exact class.
- **`normalizeInput` divergence** — if a consumer routes an aliased `(toolName, input)` through the manager's `checkPermission`, the advisory/manager path could disagree with the gate; mitigated by tracing callers in step 3 and adding alias-awareness only where a real consumer needs it.

## Open Questions

- Whether `normalizeInput`'s bash branch needs alias-awareness depends on whether any consumer routes an aliased `(toolName, input)` through `permission-manager.checkPermission` (vs. the gate pipeline, which uses `resolveShellInvocation` directly).
  Resolved during TDD step 3 by tracing callers; recorded in the retro.
  No follow-up issue filed pre-emptively — the enforcement path is the gate pipeline, and the advisory service resolves `bash` by explicit command string.

[#308]: https://github.com/gotgenes/pi-packages/issues/308
[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#452]: https://github.com/gotgenes/pi-packages/issues/452
[#486]: https://github.com/gotgenes/pi-packages/issues/486
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#502]: https://github.com/gotgenes/pi-packages/issues/502
[#533]: https://github.com/gotgenes/pi-packages/issues/533
[#574]: https://github.com/gotgenes/pi-packages/issues/574
[#580]: https://github.com/gotgenes/pi-packages/issues/580
