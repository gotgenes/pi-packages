---
issue: 309
issue_title: "Unify the advisory checkPermission/RPC bash path with the gate's decomposed fidelity"
---

# Advisory bash decomposition parity

## Release Recommendation

**Release:** ship independently

Architecture roadmap Phase 10 Step 4 (`docs/architecture/architecture.md`) tags this issue `Release: independent`, and the release-type note classes it a behavior change that cuts a release (`feat:`, not a hidden `refactor:`).
It is not part of any batch — Steps 3–6 are each independently releasable — so it ships on its own once green.

## Problem Statement

The bash enforcement gate decomposes a chained or nested command and evaluates each sub-command, so `cd /repo && npm install x` denies on the `npm *` rule (most-restrictive wins).
The synchronous advisory path — `LocalPermissionsService.checkPermission("bash", …)` (`src/permissions-service.ts`) — instead matches bash as a single whole string: `buildAccessIntentForSurface` emits one `{ kind: "tool", surface: "bash", input: { command } }` intent, so the whole string matches the leading `cd *` and returns `allow`.

So the same question — "would this bash command be allowed?" — gets two different answers depending on which door you ask at.
This is not an enforcement gap (the gate is already decomposed and consistent after #306); it is an *advisory* consistency gap.
Other extensions and pre-flight checks querying the published `PermissionsService` get a lower-fidelity answer than the gate will actually enforce.

The constraint: `PermissionsService.checkPermission` is synchronous by contract (returns `PermissionCheckResult`, not a `Promise`), and external extensions depend on that.
The gate's decomposition is async only because the tree-sitter parser initializes lazily (`await getParser()`).
Unifying fidelity therefore means making the *parse* synchronous after a warm-up, not making the public API async.

## Goals

- Route the advisory bash query through the same decomposed orchestration the gate uses (`resolveBashCommandCheck` over `BashCommand[]`), so a chained/nested advisory query returns the gate's most-restrictive decision.
- Warm the tree-sitter parser at `before_agent_start` and expose a synchronous parse for callers that run after warm-up.
- Preserve the synchronous `checkPermission` contract — no `Promise` in the public signature.
- Degrade gracefully in the pre-warm window: a bash advisory query before the parser is warm falls back to the pre-#309 whole-string match rather than blocking.
- Behavior change is a **strengthening** of the advisory answer (a previously-`allow` chained command may now return `deny`/`ask`), aligning advisory with enforcement; ship as `feat:` with a release note (per the owner's roadmap decision — no external consumer exercises bash advisory queries yet, so this is `feat:`, not `feat!:`).

## Non-Goals

- **Changing enforcement.**
  The gate is already decomposed (#301, #306); this touches only the advisory path.
- **Making `checkPermission` async.**
  The sync contract is preserved; only the parse becomes synchronous (after warm-up).
- **Structured (name + argv) rule matching.**
  Bash rules stay text/glob-matched against command text.
- **Decomposing the forwarded-request serving path** (`servingPolicy.check` in `index.ts`, the `ForwardedRequestServer`).
  A forwarded child request already carries the child gate's decomposed sub-command decision; the roadmap Step 4 target names only `permissions-service.ts`, not the serving path.
- **The bash path / external-directory advisory surfaces.**
  An advisory `checkPermission("bash", cmd)` answers only the bash command-pattern surface, exactly as today — it does not run the derived path/external-directory gates the enforcement pipeline runs.
- **Modifying `input-normalizer.ts`'s `buildAccessIntentForSurface`.**
  The roadmap target text mentions it, but the design keeps the intent builder pure and routes the decompose-or-fallback decision in the service layer; `buildAccessIntentForSurface` remains the fallback intent builder for non-bash surfaces (see Design Overview).

## Background

Relevant existing modules (current `main`, post-#308/#306/#531):

- `src/permissions-service.ts` — `LocalPermissionsService.checkPermission(surface, value?, agentName?)` builds an intent via `buildAccessIntentForSurface` and calls `this.resolver.resolve(intent)`.
  The bash branch produces a whole-string `tool` intent.
  The RPC channel the issue references was removed in #531 (`Symbol.for()` service accessor is now the sole cross-extension policy surface), so "service + RPC" collapses to just the service.
- `src/handlers/gates/bash-command.ts` — `resolveBashCommandCheck(command, commands: BashCommand[], agentName, resolver)` is the **already-shared** decompose-and-combine orchestrator the issue's step 2 asked for (#308 landed it): pure, synchronous, checks each unit on the `bash` surface, floors opaque wrappers to `ask`, tags nested-command context, and picks most-restrictive.
  It also owns the #452 fail-closed edge (non-empty command that parses to zero units → `<unparseable-bash-command>` ask) and the trivially-empty passthrough.
- `src/access-intent/bash/command-enumeration.ts` — `collectCommands(node: TSNode): BashCommand[]` walks the AST into command units (chains + nested substitutions/subshells, #306); pure over `TSNode`.
- `src/access-intent/bash/parser.ts` — `getParser = memoizeAsyncWithRetry(initParser)`; `TSParser.parse` is synchronous once initialized.
- `src/access-intent/bash/program.ts` — `BashProgram.parse(command, normalizer, …)` async factory used by the gate pipeline; produces all three slices.
  The advisory path needs only `commands()`, so it will not build a full `BashProgram`.
- `src/handlers/before-agent-start.ts` — `AgentPrepHandler.handle` runs on the async `before_agent_start` hook, which precedes any tool call.
- `src/handlers/gates/tool-call-gate-pipeline.ts` — the gate consumer: `await BashProgram.parse(...)` then `resolveBashCommandCheck(command, bashProgram.commands(), …)`.
  Note the gate feeds the **raw** command to the parser (tree-sitter skips comment nodes during enumeration); it does not pre-strip comments.
  The advisory path mirrors this.

AGENTS.md / package-SKILL constraints that apply:

- **Module-scoped state persists across same-cwd session switches** (per the package SKILL).
  The warmed-parser cache is read-only/stateless, so persisting it is safe and strictly beneficial (a later same-cwd session starts warm).
  Do not park permission-relevant state at module level.
- **Least privilege / fail-closed** — the cold-start fallback must never be *weaker* than the current whole-string behavior; when warm, the decomposed path inherits `resolveBashCommandCheck`'s #452 fail-closed.
- Mark the roadmap step complete (`✅` on the Step 4 heading and its Mermaid node) in the implementation doc-update commit, not a deferred ship commit.

## Design Overview

Three seams: (1) a warm-parser lifecycle with a synchronous accessor, (2) a synchronous bash-command parse plus a decompose-or-fallback resolver, (3) service routing and a `before_agent_start` warm-up trigger.

### 1. Warm-parser lifecycle (`access-intent/bash/parser.ts`)

Add a module-level cache of the resolved parser and a warm-up that populates it:

```ts
let warmedParser: TSParser | null = null;

// Best-effort: on failure the sync accessor stays cold and callers fall back.
// Idempotent + cheap after the first success, so calling it every turn is free.
export async function warmBashParser(): Promise<void> {
  if (warmedParser) return;
  try {
    warmedParser = await getParser();
  } catch {
    // leave cold → advisory falls back to whole-string
  }
}

export function getWarmBashParser(): TSParser | null {
  return warmedParser;
}

// Test-only: reset module state so cold/warm cases are isolatable.
export function resetWarmBashParser(): void {
  warmedParser = null;
}
```

`getParser` (the async memoized factory) is unchanged and still drives the gate's `BashProgram.parse`.

### 2. Synchronous command parse + advisory resolver

New `src/access-intent/bash/sync-commands.ts` — warm-parser-backed synchronous enumeration (no path slices, no normalizer; command-pattern surface only):

```ts
export function parseBashCommandsSync(command: string): BashCommand[] | null {
  const parser = getWarmBashParser();
  if (!parser) return null; // cold → caller falls back to whole-string
  const tree = parser.parse(command);
  if (!tree) return [];
  try {
    return collectCommands(tree.rootNode);
  } finally {
    tree.delete();
  }
}
```

New `src/bash-advisory-check.ts` — the decompose-or-fallback resolver, reusing the gate's orchestrator so advisory and enforcement can never drift:

```ts
export function resolveBashAdvisoryCheck(
  command: string,
  agentName: string | undefined,
  resolver: ScopedPermissionResolver,
): PermissionCheckResult {
  const commands = parseBashCommandsSync(command);
  if (commands === null) {
    // Pre-warm window: preserve pre-#309 whole-string advisory behavior.
    return resolver.resolve({
      kind: "tool",
      surface: "bash",
      input: { command },
      agentName,
    });
  }
  return resolveBashCommandCheck(command, commands, agentName, resolver);
}
```

`ScopedPermissionResolver` is the `{ resolve(intent) }` role (ISP-clean); the service's resolver view satisfies it.
`bash-advisory-check.ts` lives at the service layer (top-level `src/`) because it imports `resolveBashCommandCheck` from `handlers/gates/` — keeping this composition out of `access-intent/` avoids a domain→handler layer inversion.

### 3. Service routing + warm-up trigger

`LocalPermissionsService.checkPermission` branches bash to the new resolver; every other surface is unchanged:

```ts
checkPermission(surface, value, agentName) {
  if (surface === "bash") {
    return resolveBashAdvisoryCheck(value ?? "", agentName, this.resolver);
  }
  const intent = buildAccessIntentForSurface(
    surface, value, this.session.getPathNormalizer(), agentName,
  );
  return this.resolver.resolve(intent);
}
```

Warm-up trigger injected into `AgentPrepHandler` (roadmap names `before-agent-start.ts` as the trigger site) as a `() => void` collaborator, called fire-and-forget at the top of `handle` so it never delays agent start:

```ts
// index.ts wiring:
new AgentPrepHandler(session, resolver, toolRegistry, () => {
  void warmBashParser();
});

// AgentPrepHandler.handle:
this.warmParser();
```

Fire-and-forget (not awaited) is deliberate: the issue accepts a bounded pre-warm window with graceful fallback, and the idempotent early-return makes the every-turn call free after the first success.

### Consumer call-site sketch (Tell-Don't-Ask check)

The service tells the resolver-view to answer; `resolveBashAdvisoryCheck` owns the decompose-vs-fallback decision internally rather than the service asking `getWarmBashParser()` and branching:

```ts
// service (no reach-through):
service.checkPermission("bash", "cd /repo && npm install x");
//   → resolveBashAdvisoryCheck(cmd, agent, resolver)
//   → parseBashCommandsSync(cmd)  // warm: ["cd /repo", "npm install x"]
//   → resolveBashCommandCheck(...)  // deny (npm *) wins
```

No new Law-of-Demeter chain, no output arguments, no mutation.

### Edge cases

- **Value-less bash query** (`checkPermission("bash")`) → `resolveBashAdvisoryCheck("", …)`.
  Warm: `collectCommands("")` → `[]` → `resolveBashCommandCheck` trivially-empty passthrough resolves `{ command: "" }`.
  Cold: whole-string fallback on `{ command: "" }`.
  Consistent.
- **Unparseable non-empty command, warm** → `resolveBashCommandCheck` fails closed to `<unparseable-bash-command>` ask (#452 parity on the advisory path).
- **Opaque wrapper** (`bash -c "…"`), warm → floored to `ask` via the enumerator's `opaque` flag, exactly as the gate.
- **Cold start** → whole-string tool intent, i.e. pre-#309 advisory behavior (never weaker than before).

### Design-review checklist result

- Dependency width: `AgentPrepHandler` gains one narrow `() => void` param (4 total) — acceptable, no field cluster.
- LoD / output args / scattered resets: none introduced.
- ISP: `resolveBashAdvisoryCheck` and `parseBashCommandsSync` take only what they read (`{ resolve }`, a `string`).
- No new repeated discriminator (the `surface === "bash"` branch is a single dispatch site in the service).

## Module-Level Changes

Added:

- `src/access-intent/bash/sync-commands.ts` — `parseBashCommandsSync(command): BashCommand[] | null`.
- `src/bash-advisory-check.ts` — `resolveBashAdvisoryCheck(command, agentName, resolver): PermissionCheckResult`.
- `test/access-intent/bash/sync-commands.test.ts`, `test/bash-advisory-check.test.ts`.

Changed:

- `src/access-intent/bash/parser.ts` — add `warmBashParser()`, `getWarmBashParser()`, `resetWarmBashParser()` (test-only) and the `warmedParser` module cache.
- `src/handlers/before-agent-start.ts` — inject `warmParser: () => void` (4th ctor param) and call it fire-and-forget in `handle`.
- `src/permissions-service.ts` — bash surface routes to `resolveBashAdvisoryCheck`; non-bash unchanged.
- `src/index.ts` — pass `() => { void warmBashParser(); }` to `AgentPrepHandler`.
- `test/access-intent/bash/parser.test.ts` — add warm-up + sync-accessor cases (with `resetWarmBashParser()` in `beforeEach`).
- `test/permissions-service.test.ts` — mock `#src/bash-advisory-check`; assert the bash surface delegates to `resolveBashAdvisoryCheck(command, agentName, resolver)`; re-point the existing "non-path surface → tool intent" assertion to a non-bash surface (e.g. `skill`) so it still covers the `buildAccessIntentForSurface` path.
- `test/handlers/before-agent-start.test.ts` — update the `makeSetup` `new AgentPrepHandler(...)` call to pass a `vi.fn()` warm trigger and assert it is invoked on `handle`.

Docs (in the implementation doc-update commit):

- `docs/cross-extension-api.md` — under `#### checkPermission`, note that a bash `value` containing a chained/nested command is decomposed and evaluated most-restrictive at parity with the gate (a previously-`allow` chain may return `deny`/`ask`), with a cold-start whole-string fallback in the brief pre-warm window.
- `docs/architecture/architecture.md` —
  - update the `parser.ts` inline listing (line ~751) to add `warmBashParser` / `getWarmBashParser` (+ `resetWarmBashParser` test hook);
  - update the `before-agent-start.ts` listing (~762) to note the warm-up trigger;
  - update the `permissions-service.ts` listing (~787) to note bash advisory decomposition;
  - add `sync-commands.ts` under the `access-intent/bash/` tree and `bash-advisory-check.ts` under the flat `src/` listing;
  - mark **Step 4 ✅** on its heading (~938) and its Mermaid node (~978).

Grep sweep performed (removed/added symbol references): no symbols are removed or renamed — all changes are additive plus one service branch.
`checkPermission` and `resolveBashCommandCheck` are referenced in `docs/architecture/architecture.md` and `docs/cross-extension-api.md` (both listed above); no `.pi/skills/package-*/SKILL.md` prose describes the advisory-whole-string behavior as a named mechanism to reword.

## Test Impact Analysis

This is an additive change (plus one service branch), not an extraction, so the extraction-specific lens is light:

1. **New unit tests enabled:**
   - `sync-commands.test.ts` — cold (`getWarmBashParser()` null → `parseBashCommandsSync` returns `null`); warm (`await warmBashParser()` → chained command yields multiple `BashCommand[]` units, comment-only yields trivially-empty).
   - `bash-advisory-check.test.ts` — warm chained command → most-restrictive `deny` wins; cold → single whole-string `tool` resolve; opaque wrapper floored to `ask`; unparseable non-empty warm → `<unparseable-bash-command>`.
   These directly test the seam that was previously untestable (there was no sync parse).
2. **Existing tests that become redundant:** none removed.
   `permissions-service.test.ts`'s bash assertion changes from "asserts a whole-string tool intent" to "asserts delegation to `resolveBashAdvisoryCheck`" — the decomposition behavior itself is covered at the lower `bash-advisory-check` layer, so the service test narrows to delegation only.
3. **Tests that must stay as-is:** `bash-command.test.ts` / `bash-command-metamorphic.test.ts` (they pin `resolveBashCommandCheck`, now shared by both callers); `command-enumeration` tests; the gate-pipeline bash tests (enforcement path unchanged).

## Invariants at risk

Both prior steps' invariants live behind existing tests; reusing their code on the advisory path preserves them:

- **#308 — `resolveBashCommandCheck` is a pure combiner over `BashCommand[]`.**
  Pinned by `test/handlers/gates/bash-command.test.ts`.
  The advisory path calls it with sync-parsed `commands`; purity is unchanged.
- **#306 — nested commands (substitutions/subshells) are enumerated and never weaken the decision.**
  Pinned by `command-enumeration` + `bash-command-metamorphic` tests; the advisory path reuses `collectCommands`.
- **#452 — a non-empty command parsing to zero units fails closed to `<unparseable-bash-command>` ask.**
  Pinned in `bash-command.test.ts`; inherited by the warm advisory path, and newly asserted in `bash-advisory-check.test.ts`.
- **Cold-start floor** — the fallback must not be weaker than pre-#309 whole-string.
  New assertion in `bash-advisory-check.test.ts` (cold → single whole-string resolve).

## TDD Order

1. **Warm-parser lifecycle + sync command parse.**
   Red: `parser.test.ts` (`getWarmBashParser()` null before warm; populated after `await warmBashParser()`; `resetWarmBashParser()` clears) and new `sync-commands.test.ts` (cold → `null`; warm → decomposed `BashCommand[]`; comment-only → trivially-empty; chained → multiple units).
   Green: add the warm-up/accessor to `parser.ts` and `sync-commands.ts`.
   Commit: `feat(pi-permission-system): add warm tree-sitter parser and sync bash-command parse`

2. **Advisory decompose-or-fallback resolver.**
   Red: `bash-advisory-check.test.ts` — warm chained → `deny` wins (most-restrictive); cold → single whole-string `tool` resolve; opaque wrapper floored to `ask`; unparseable non-empty warm → `<unparseable-bash-command>`.
   Use `resetWarmBashParser()` / `warmBashParser()` to select cold vs warm per case.
   Green: add `src/bash-advisory-check.ts`.
   Commit: `feat(pi-permission-system): add bash advisory decompose-or-fallback resolver`

3. **Route the service bash query through it.**
   Red: `permissions-service.test.ts` — mock `#src/bash-advisory-check`; assert `checkPermission("bash", cmd, agent)` delegates to `resolveBashAdvisoryCheck(cmd, agent, resolver)`; re-point the existing non-path-surface assertion to `skill` so `buildAccessIntentForSurface` stays covered; keep the "returns resolver result" contract.
   Green: branch bash in `LocalPermissionsService.checkPermission`.
   Note the public-semantics strengthening in the commit body (advisory bash answers now decomposed/most-restrictive at gate parity; no `Promise` in the signature).
   Commit: `feat(pi-permission-system): decompose advisory bash checkPermission at gate parity`

4. **Warm the parser on `before_agent_start`.**
   Red: `before-agent-start.test.ts` — assert the injected warm trigger is invoked on `handle`; update `makeSetup` to pass a `vi.fn()` as the 4th `AgentPrepHandler` arg.
   Green: add the `warmParser: () => void` ctor param + fire-and-forget call in `AgentPrepHandler.handle`; wire `() => { void warmBashParser(); }` in `index.ts`.
   Commit: `feat(pi-permission-system): warm bash parser on before_agent_start`

5. **Docs + roadmap.**
   Update `docs/cross-extension-api.md` (checkPermission bash decomposition note) and `docs/architecture/architecture.md` (inline listings for `parser.ts` / `before-agent-start.ts` / `permissions-service.ts`, add the two new modules to the tree, mark **Step 4 ✅** on heading + Mermaid node).
   Commit: `docs(pi-permission-system): document advisory bash decomposition and complete roadmap step 4`

## Risks and Mitigations

- **Warm-up race (pre-warm window).**
  A bash advisory query before the parser warms briefly reintroduces dual fidelity.
  Mitigation: `parseBashCommandsSync` returns `null` when cold and `resolveBashAdvisoryCheck` falls back to the exact pre-#309 whole-string match — never weaker, and the window closes on the first `before_agent_start` (which precedes any tool call).
  Warm-up is idempotent so subsequent turns stay warm.
- **Public-semantics change.**
  Advisory bash answers become decomposed/most-restrictive, so a chained command that previously returned `allow` may now return `deny`/`ask`.
  Mitigation: it is a strengthening that aligns advisory with enforcement; ship `feat:` with a release note (owner decision — no external consumer exercises bash advisory queries yet), and update `docs/cross-extension-api.md`.
- **Warm-up failure poisoning the sync path.**
  A tree-sitter WASM init failure must not throw out of `before_agent_start`.
  Mitigation: `warmBashParser` swallows errors (best-effort); the sync accessor stays cold and the advisory path falls back.
  `getParser`'s `memoizeAsyncWithRetry` still retries on the next call.
- **Cross-test module-state leakage.**
  `warmedParser` persists across tests in a file (and across same-cwd sessions in production).
  Mitigation: `resetWarmBashParser()` in `beforeEach` for the parser/sync-commands/advisory tests; the service test mocks `bash-advisory-check` entirely and never touches real parser state.

## Open Questions

- None blocking.
  The forwarded-request serving path (`servingPolicy.check`) is deliberately out of scope (Non-Goals); if a future consumer needs decomposed serving decisions, that is a separate issue — not filed now (speculative).
