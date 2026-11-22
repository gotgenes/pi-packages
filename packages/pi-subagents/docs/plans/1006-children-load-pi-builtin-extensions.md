---
issue: 1006
issue_title: "pi-subagents: children never load Pi's built-in codemode, MCP, and tool_search extensions"
---

# Load Pi's codemode, tool_search, and MCP built-ins in the children that name them

## Release Recommendation

**Release:** ship independently

No roadmap step in `docs/architecture/architecture.md` references #1006, and pi-subagents has no open improvement phase (`grep '^## Improvement roadmap — Phase'` matches nothing).
The release is a major: the peer floor rises to Pi 1.0.0.

## Problem Statement

Pi 0.99.0 shipped codemode, `tool_search`, and MCP as built-in extensions, but a pi-subagents child never loads any of them.
An agent whose `tools:` list names `codemode`, `tool_search`, or an `mcp__<server>__<tool>` tool runs without it, and nothing reports the missing tool.

Pi passes its built-ins to the resource loader only in `main.ts` (`[...builtInExtensions, ...]`), and the package does not export `builtInExtensions`.
The child's loader (`new DefaultResourceLoader(opts)` at `src/index.ts`) passes no extension factories, so the child's `tools` allowlist then filters the unknown names out without an error.

A contributor (rharish101) asked on the issue for whole-server selection as well: allow every tool an MCP server exposes, not only named tools.
The operator confirmed that is the usability crux.
An MCP server such as GitHub's exposes dozens of tools (estimated: the count depends on its enabled toolsets), and their Pi names carry a hash suffix when they exceed 64 characters or collide, so a hand-written list is long and brittle.

## Goals

- A child whose `tools:` names `codemode` loads Pi's codemode extension, `tool_search` loads tool-search, and any `mcp__…` name (or one of MCP's three resource tools) loads MCP.
- A child that names none of them loads none of them: no MCP server process, no `<mcp_servers>` prompt section.
- A `tools:` entry starting with `mcp__` that contains `*` is a pattern, expanded at child creation against the tool names the **parent** has registered (for example `mcp__github__*`).
- The child honors the operator's built-in settings the way the parent does: `"extensions": ["-builtin:mcp"]` keeps MCP out of children too, and a third-party extension that replaces a built-in replaces it in children too.
- **Breaking:** the `@earendil-works/pi-ai`, `pi-coding-agent`, and `pi-tui` peer floors rise to `>=1.0.0` (from `>=0.75.0` / `>=0.81.0` / `>=0.75.0`), with the devDependencies pinned at `1.0.0`.
  The factories exist from 0.99.0; 1.0.0 matches pi-permission-system's floor (operator decision).
  The bump commit is `feat(pi-subagents)!:` with a `BREAKING CHANGE:` footer.
- Fold in [#1004]'s fixture fix, which the bump requires, so [#1004] closes with this work.

## Non-Goals

- Glob patterns on non-MCP tool names (`github_*`): operator decision; a `*` in any entry not starting with `mcp__` stays a literal name, which Pi ignores.
- Adding `codemode` or `tool_search` to a child's allowlist automatically when its MCP tools need them.
  The README charter forbids widening a child's allowlist with capability tools on the agent's behalf.
  The docs say instead which exposure needs which tool.
- A child-only exclusion of a built-in (`excludedExtensionPackages: ["builtin:mcp"]`).
  Demand-driven loading already keeps MCP out of every child that names no MCP tool, and Pi's own `-builtin:mcp` setting covers the rest.
- Removing the pre-0.86 prompt-renderer arms the new floor makes dead (`src/session/prompts.ts`, `project-context.ts`, `parent-snapshot.ts`, and the `docs/configuration.md` sentence about "Pi releases before 0.86"): filed as [#1017].
- Loading Pi's `llama.cpp` built-in: #812 already replays the parent's providers onto the child's model runtime.
- #1002 (pi-permission-system declares a fully denied direct MCP tool): another package.
- Re-expanding a pattern when the child's own MCP server later lists new tools: Pi's allowlist is fixed at session creation, so a child sees the tools the parent had at spawn time.

## Background

- `src/lifecycle/create-subagent-session.ts`:
  - `createSubagentSession` builds the child's loader through `deps.io.createResourceLoader(ResourceLoaderOptions)`.
  - It hands the SDK `tools: [...cfg.toolNames, ...childTools]` as the allowlist.
  - `ResourceLoaderOptions` is a narrow structural copy of the SDK options.
    Its sole construction site in `src/` is `src/index.ts:121`, which passes `opts` straight to `new DefaultResourceLoader(opts)`.
- `SubagentSessionDeps` already carries one root-resolved policy, `resolvePromptInheritance`.
  The parent's tool list arrives the same way: a resolver built at the composition root.
- `cfg.toolNames` comes from `assembleSessionConfig` (`src/session/session-config.ts`), which reads `registry.getToolNamesForType(type)`.
  When an agent omits `tools`, that falls back to `BUILTIN_TOOL_NAMES`, which names no built-in extension.
- `parseListField` (`src/config/custom-agents.ts`) trims and splits on commas and does not strip `*`, so `mcp__github__*` survives frontmatter parsing.
  The tidy-first assessor read this function to confirm it.
- **Pi 1.0.0, verified against the published tarballs of 0.99.0 and 1.0.0:**
  - The root exports `createCodemodeExtension`, `createToolSearchExtension`, `createMcpExtension`, and the `InlineExtension` type.
    `InlineExtension` carries `builtin?` and `replaceable?`.
  - `DefaultResourceLoader` sends `builtin: true` entries through the package manager as `builtin:<name>` resources.
    `isEnabledByOverrides` there honors the user's `extensions` setting (`-builtin:mcp`).
  - `omitReplacedExtensions` drops a `replaceable` built-in when another extension registers the same tool, command, or flag.
  - Pi's own names are `codemode`, `tool-search`, and `mcp` (`packages/coding-agent/src/extensions/index.ts`).
    A user's `-builtin:<name>` matches only if our names are identical.
- MCP tool names are `mcp__<server>__<tool>`, with non-`[A-Za-z0-9_]` characters replaced by `_` and a hash suffix past 64 characters or on collision (`createMcpToolName`).
  - The resource tools are `list_mcp_resources`, `list_mcp_resource_templates`, and `read_mcp_resource`.
  - An MCP tool's default exposure is `codemode`, so it is callable only from a `codemode` script.
    `deferred` needs `tool_search`; `direct` is declared to the model.
  - Pi's allowlist is an exact-match `Set` (`_isAllowedTool`), and it also filters the tools a codemode script can reach.
- The parent's `pi.getAllTools()` returns every registered tool, MCP tools included, with `name`, `exposure`, and `namespace`.
  No `src/` or `test/` file calls it today.
- AGENTS.md constraints that apply:
  - Releases are dispatched, never automatic.
  - The package skill's `## Upstream assumptions` row "Children load no Pi built-in extension" becomes false and must be rewritten.

## Design Overview

### How the design was checked

These were measured with throwaway scripts against the real `@earendil-works/pi-coding-agent@1.0.0` in this worktree, then reverted:

| Probe                                                                                 | Result                                                                               |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `DefaultResourceLoader` with no factories                                             | extensions `[]`                                                                      |
| Same, with the three factories as `{ builtin: true, replaceable: true }`              | `builtin:codemode:[codemode]`, `builtin:tool-search:[tool_search]`, `builtin:mcp:[]` |
| Same, with the user settings `extensions: ["-builtin:mcp"]`                           | codemode and tool-search only                                                        |
| `createAgentSession({ tools: ["read","codemode","tool_search"] })` + `bindExtensions` | active: `read, codemode, tool_search`                                                |
| MCP loaded, one configured stdio server, child `tools: ["read"]`                      | server process started anyway (count 1 → 2)                                          |
| devDeps → 1.0.0: `tsc` / `vitest`                                                     | one error (#1004's line ~395) / 81 files, 1937 tests pass                            |

The last row but one is why loading follows the allowlist rather than the parent: MCP connects every enabled server on `session_start`, whether the child can reach its tools or not.

### Two pure modules

`src/session/builtin-extensions.ts` maps tool names to the built-ins that supply them (data plus a small selector):

```typescript
import { createCodemodeExtension, createMcpExtension, createToolSearchExtension, type InlineExtension } from "@earendil-works/pi-coding-agent";

/** Pi's built-in extensions a child may load, each keyed by the tool names that call for it. */
const BUILTINS = [
  { name: "codemode", factory: createCodemodeExtension(), provides: (tool: string) => tool === "codemode" },
  { name: "tool-search", factory: createToolSearchExtension(), provides: (tool: string) => tool === "tool_search" },
  { name: "mcp", factory: createMcpExtension(), provides: (tool: string) => tool.startsWith("mcp__") || MCP_RESOURCE_TOOLS.has(tool) },
];

export function builtinExtensionsFor(toolNames: readonly string[]): InlineExtension[];
// → [{ name, factory, builtin: true, replaceable: true }] for each entry whose provides() matches a name
```

The factories are module constants.
Each `create*Extension()` returns `(pi) => { … }` whose state lives inside that call, so one factory value serves every child.
Pi's own `builtInExtensions` is module-level the same way.

`src/session/mcp-tool-patterns.ts` expands patterns:

```typescript
export interface ExpandedTools {
  /** The allowlist: literal entries kept, each pattern replaced by its matches, deduplicated, order preserved. */
  toolNames: string[];
  /** Patterns that matched no available tool — reported under PI_SUBAGENTS_DEBUG=1. */
  unmatchedPatterns: string[];
}

export function expandMcpToolPatterns(declared: readonly string[], available: readonly string[]): ExpandedTools;
```

- An entry is a pattern iff it starts with `mcp__` and contains `*`.
- `*` matches any run of characters, including none, and the whole name must match.
  Other regex metacharacters are escaped.
- A pattern never survives into `toolNames`.
  As a literal name it would match nothing.
- `mcp__*` is legal and admits every MCP tool the parent has.

Both functions take only `string` arrays, so neither has an ISP question.

### Wiring

`createSubagentSession` gains two lines of logic and no new branches:

```typescript
const { toolNames, unmatchedPatterns } = expandMcpToolPatterns(cfg.toolNames, deps.listParentToolNames());
for (const pattern of unmatchedPatterns) debugNote(`agent ${type}: tools pattern ${pattern} matched no tool the parent has`);
const loader = deps.io.createResourceLoader({ …, extensionFactories: builtinExtensionsFor(toolNames) });
…
tools: [...toolNames, ...childTools.map((tool) => tool.name)],
```

- `ResourceLoaderOptions` gains `extensionFactories?: InlineExtension[]`.
  The composition root's `new DefaultResourceLoader(opts)` accepts it unchanged.
- `SubagentSessionDeps` gains `listParentToolNames: () => readonly string[]`.
  `src/index.ts` supplies `() => pi.getAllTools().map((tool) => tool.name)`, called lazily at each child's creation so tools the parent registered after load (MCP servers connect in the background) are seen.
- Builtins are selected from the **expanded** names.
  A pattern that matched nothing therefore loads no MCP and starts no server process.
- The resolver goes on `SubagentSessionDeps` rather than in `AssemblerContext`, as the tidy-first assessor recommended:
  - It matches the existing `resolvePromptInheritance` resolver.
  - The factory is the one place that needs both the expanded names (for the loader) and the parent's list.
  - `assembleSessionConfig` and its tests stay untouched.

The import edges are `lifecycle → session` and `lifecycle → core` (`#src/debug`), both already allowed in `.fallowrc.json`.
Neither new module imports from `lifecycle/`, so there is no cycle.

### Edge cases

- A child whose cwd is a relocated workspace with its own project `.pi/mcp.json` may register different servers from the parent.
  Its patterns still expand from the parent's tools.
  The docs say so.
- A parent whose MCP server has not connected yet (still connecting, failed sign-in, disabled) has no tools for it.
  The pattern expands to nothing and the debug note names it.
- A literal `mcp__…` name the parent lacks is kept as written.
  It still loads MCP, because the agent asked for it by name.
- `tools: none` (empty) or an omitted `tools` gets `extensionFactories: []`, as today.

## Module-Level Changes

| File                                                              | Change                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/pi-subagents/package.json`                              | Peer floors `>=1.0.0` for `pi-ai`, `pi-coding-agent`, `pi-tui`; devDependencies `1.0.0`                                                                                                                                                               |
| `pnpm-lock.yaml` (and `pnpm-workspace.yaml` if pnpm writes to it) | Regenerated by `pnpm install`; 1.0.0 is already in the lockfile via pi-permission-system (the spike's install took 2.6 s)                                                                                                                             |
| `src/session/builtin-extensions.ts`                               | **New**: catalogue + `builtinExtensionsFor`                                                                                                                                                                                                           |
| `src/session/mcp-tool-patterns.ts`                                | **New**: `expandMcpToolPatterns`, `ExpandedTools`                                                                                                                                                                                                     |
| `src/lifecycle/create-subagent-session.ts`                        | `ResourceLoaderOptions.extensionFactories`; `SubagentSessionDeps.listParentToolNames`; expand, select, note unmatched; doc comment on `CreateSessionOptions.tools`                                                                                    |
| `src/index.ts`                                                    | Supply `listParentToolNames` from `pi.getAllTools()`                                                                                                                                                                                                  |
| `test/session/builtin-extensions.test.ts`                         | **New**                                                                                                                                                                                                                                               |
| `test/session/mcp-tool-patterns.test.ts`                          | **New**                                                                                                                                                                                                                                               |
| `test/lifecycle/create-subagent-session.test.ts`                  | #1004 `ExecuteCtx` fix; new describe blocks for built-in loading and pattern expansion                                                                                                                                                                |
| `test/helpers/subagent-session-io.ts`                             | `createSubagentSessionDeps` gains a `listParentToolNames` override defaulting to `() => []`                                                                                                                                                           |
| `test/composition-root.test.ts`                                   | `makePi()` gains `getAllTools`; a test that `deps.listParentToolNames()` reads the parent's tools at call time                                                                                                                                        |
| `test/config/custom-agents.test.ts`                               | One test pinning that `tools: read, mcp__github__*` parses to `["read", "mcp__github__*"]`                                                                                                                                                            |
| `docs/configuration.md`                                           | `### Tool selection`: new subsection on codemode, `tool_search`, and MCP tools with the GitHub example and patterns; line ~365's "requires Pi 0.81.0 or newer, which is the floor" sentence updated to the new floor                                  |
| `docs/architecture/architecture.md`                               | Module tree: the two new `session/` files; `create-subagent-session.ts` row mentions built-in selection; `### Child tool selection` gains a paragraph on demand-driven built-ins and parent-resolved patterns                                         |
| `.pi/skills/package-pi-subagents/SKILL.md`                        | Upstream-assumptions row "Children load no Pi built-in extension…" rewritten to the new assumption (Pi's built-in names and `builtin`/`replaceable` semantics); Session domain row 13 → 15 modules and the two names; "seven domains (70 files)" → 72 |

Predicted **unchanged**, each a falsifiable claim:

- `src/session/session-config.ts`: the expansion happens in the factory, not the assembler.
- `src/config/custom-agents.ts`: `parseListField` keeps `*` (the assessor read it; the new parsing test pins it).
- `src/session/package-exclusions.ts`: its storage view rewrites only `packages`, so the user's `extensions` setting (`-builtin:mcp`) passes through.
  The spike confirmed this with the plain settings manager.
  The wrapped view copies every other field unchanged.
- `README.md`: its charter already says `tools:` is the only thing that admits a capability tool, and patterns are still written in `tools:`.
  `grep -n "tools:" README.md` shows no tool-list prose to update.
- `docs/architecture/architecture.md` Mermaid session subgraph: it lists six representative modules, not all thirteen (`package-exclusions` is absent today), so no node is added.

## Test Impact Analysis

1. **New tests the change enables:**
   - Pure unit tests of the name→built-in table and of pattern expansion.
     Before this change there was no seam: the loader received no factories at all.
   - One real-SDK test verifies the table's external facts against Pi itself.
     It builds a `DefaultResourceLoader` in a temp agent dir from `builtinExtensionsFor([...])`, then asserts the loaded `builtin:<name>` paths, and that a `-builtin:mcp` user setting removes MCP.
     This is the check that one row is right, written before the rows.
     If our `name` drifts from Pi's, the `-builtin:` assertion fails.
     It does not need a model or a session, and the spike ran it in about a second.
2. **Redundant tests:** none.
   The existing `createSubagentSession` loader assertions use `expect.objectContaining`, so they neither duplicate nor break on the new field.
3. **Tests that stay as-is:**
   - The `tools` allowlist assertions (`tools: ["read"]`, `["read", "ask_parent"]`, `["ask_parent"]`) still pin that a pattern-free agent's allowlist is unchanged.
   - The recursion-guard `excludeTools` assertion still pins the denylist.

## Invariants at risk

| Invariant                                                                                    | Serves                                                  | Pinned by                                                                                                                                                        |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A child's capability tool set is exactly its `tools:` list plus `ask_parent`/`notify_parent` | Agent authors; the README charter                       | `create-subagent-session.test.ts` "the core's own child tools" (exact `tools` arrays) — unchanged, plus new tests that a pattern contributes only matching names |
| No child loads MCP unless it names an MCP tool                                               | Operators with MCP servers (process count, prompt size) | New test: agent `tools: ["read"]` → `extensionFactories` `[]`                                                                                                    |
| Recursion guard: `subagent`, `get_subagent_result`, `steer_subagent` always denied           | Every parent                                            | Existing "recursion guard" test                                                                                                                                  |
| `excludedExtensionPackages` still prevents a package's extensions from loading               | #696's operators                                        | Existing `package-exclusions` tests; the loader still receives `loaderSettings` (existing "derived settings view" test)                                          |

## TDD Order

1. **Derive the custom-tool `execute` context type in the test** (#1004).
   - In `test/lifecycle/create-subagent-session.test.ts`, add `type ExecuteCtx = Parameters<NonNullable<CreateSessionOptions["customTools"]>[number]["execute"]>[4];` and pass `STUB_CTX as ExecuteCtx` at the line ~395 call.
   - Verify `pnpm --filter @gotgenes/pi-subagents run check` passes on 0.84.4 **before** the bump.
     The assessor could not confirm that; it is this step's gate.
   - No behavior change, so there is no killing mutation.
     The red is `tsc` after step 2 without this step.
   - Commit: `test(pi-subagents): type the stub tool context from the execute signature (#1004)`.
2. **Raise the Pi floor to 1.0.0.**
   - Bump the three peer floors to `>=1.0.0` and the three devDependencies to `1.0.0`, then `pnpm install`.
   - Update the floor sentence in `docs/configuration.md` (line ~365): the replay requirement is now covered by the higher floor, so rephrase it to name the declared floor without a version-specific justification.
   - Verify `check`, `test`, `lint`, and `verify:public-types`.
   - No behavior to mutate.
   - Commit: `feat(pi-subagents)!: require Pi 1.0.0 or later`.
     The body explains why (the built-in extension factories, from 0.99.0).
     Footer: `BREAKING CHANGE: @earendil-works/pi-ai, pi-coding-agent, and pi-tui must now be 1.0.0 or later. On an older Pi, stay on the current pi-subagents major.`
3. **Add the name→built-in table** (`src/session/builtin-extensions.ts`, `test/session/builtin-extensions.test.ts`).
   - Write the real-SDK row check first (see Test Impact Analysis 1): `builtinExtensionsFor(["mcp__x__y"])` loads `builtin:mcp`, and `-builtin:mcp` removes it.
   - Then the pure selection tests, one equivalence class each:
     - `codemode` → codemode only
     - `tool_search` → tool-search only
     - `mcp__a__b` → mcp
     - each of the three resource names → mcp
     - `["read","grep"]` → `[]`
     - all of them → three entries in catalogue order, each `builtin: true, replaceable: true`
   - Killing mutations:
     - Rename the `"mcp"` entry to `"mcp-builtin"`: the real-SDK `-builtin:mcp` test goes red.
     - Change the MCP predicate to `tool.startsWith("mcp__")` only: the resource-tool tests go red.
     - Set `replaceable: false`: the shape test goes red.
   - No consumer yet.
     Commit: `refactor(pi-subagents): map tool names to the Pi built-in extensions that supply them`.
4. **Children load the built-ins their tools name.**
   - Add `ResourceLoaderOptions.extensionFactories` and pass `builtinExtensionsFor(cfg.toolNames)` from `createSubagentSession`.
   - New `describe("Pi built-in extensions")` in `create-subagent-session.test.ts`:
     - an agent with `toolNames: ["read", "codemode", "mcp__github__get_issue"]` → the loader receives exactly the `codemode` and `mcp` entries (assert the names with `toEqual`)
     - the default `Explore` lookup (`["read"]`) → `extensionFactories: []`
   - Killing mutation: pass `extensionFactories: []` unconditionally.
     The first test goes red; the second pins absence and survives by design.
   - Second killing mutation: pass `builtinExtensionsFor(["codemode","tool_search","mcp__x"])`.
     The second test goes red.
   - Commit: `feat(pi-subagents): load codemode, tool_search, and MCP in a child whose tools: names them`.
5. **Add pattern expansion** (`src/session/mcp-tool-patterns.ts`, `test/session/mcp-tool-patterns.test.ts`).
   - Classes:
     - literal entries pass through in order
     - `mcp__github__*` → every `mcp__github__…` name in `available` order, and no `mcp__gitlab__…`
     - `mcp__github__get_*` → the prefix subset
     - `mcp__*` → every MCP tool
     - duplicates between a literal and a pattern match appear once
     - a pattern with no match → absent from `toolNames`, present in `unmatchedPatterns`
     - `github_*` (no `mcp__` prefix) → kept literally, not expanded
     - a `.` in a pattern is escaped: `mcp__a.b*` does not match `mcp__aXb_c`
   - Killing mutations:
     - Drop the `startsWith("mcp__")` guard: the `github_*` test goes red.
     - Anchor without `$`: a test with `available` holding `mcp__github__x` and pattern `mcp__git*x`, plus a decoy `mcp__github__xy`, goes red.
     - Keep the pattern itself in `toolNames`: the no-match test goes red.
     - Remove the regex escaping: the `.` test goes red.
   - No consumer yet.
     Commit: `refactor(pi-subagents): expand mcp__ tool patterns against a list of tool names`.
6. **Prepare the deps helper.**
   - `createSubagentSessionDeps` in `test/helpers/subagent-session-io.ts` gains `listParentToolNames?: () => readonly string[]`, defaulting to `vi.fn((): readonly string[] => [])`.
   - It is a no-op until step 7; a variable with an extra property still satisfies `SubagentSessionDeps`.
   - Commit: `test(pi-subagents): give the session deps helper a parent tool list`.
   - (Prepares the ~22 `createSubagentSessionDeps` call sites, which step 7 then leaves untouched.)
7. **A child's `tools:` admits a whole MCP server.**
   - Add `SubagentSessionDeps.listParentToolNames`.
   - In `createSubagentSession`, expand via `expandMcpToolPatterns(cfg.toolNames, deps.listParentToolNames())`, feed the expanded names to both `builtinExtensionsFor` and `tools:`, and `debugNote` each unmatched pattern.
   - Supply `() => pi.getAllTools().map((tool) => tool.name)` in `src/index.ts`.
   - Add the frontmatter parsing test (`tools: read, mcp__github__*`).
   - `create-subagent-session.test.ts` tests:
     - `toolNames: ["read", "mcp__github__*"]` with parent tools `["read", "mcp__github__a", "mcp__github__b", "mcp__gitlab__c"]` → `tools: ["read", "mcp__github__a", "mcp__github__b"]` and the loader gets `mcp`
     - the same pattern with parent tools lacking any github tool → `tools: ["read"]` and `extensionFactories: []`
   - Composition-root test: give `makePi()` a `getAllTools` mock, and assert `deps.listParentToolNames()` returns its names after the mock's return value changes post-construction (pins laziness).
   - Killing mutations:
     - Pass `cfg.toolNames` to `tools:` instead of the expanded names: the first test goes red.
     - Select built-ins from `cfg.toolNames` (unexpanded): the second test goes red, because the raw pattern starts with `mcp__`.
     - In `src/index.ts`, capture `pi.getAllTools()` once at construction: the composition-root test goes red.
   - Commit: `feat(pi-subagents): let tools: name a whole MCP server with mcp__<server>__*`.
   - Trailer (final paragraph, below `Refs #1006`): `Co-authored-by: Harish Rajagopal <25344287+rharish101@users.noreply.github.com>`.
     Verify it with `git interpret-trailers --parse`.
8. **Document it.**
   - `docs/configuration.md` `### Tool selection`: a subsection on codemode, `tool_search`, and MCP tools covering:
     - which name loads which built-in
     - the MCP naming rule
     - that `codemode`-exposed tools (the default) also need `codemode`, and `deferred` ones need `tool_search`
     - the GitHub example with exact names versus `mcp__github__*`
     - that patterns resolve from the parent's tools at spawn time, including the relocated-workspace and not-yet-connected caveats
     - that `-builtin:<name>` settings apply to children
   - `docs/architecture/architecture.md`: module tree and the `### Child tool selection` paragraph.
   - `.pi/skills/package-pi-subagents/SKILL.md`: the upstream row, the Session domain row, and the file count.
     Re-derive both counts with `find packages/pi-subagents/src -name '*.ts' | wc -l` and `ls packages/pi-subagents/src/session | wc -l`; they were 70 and 13 at planning time.
   - Commit: `docs(pi-subagents): document codemode, tool_search, and MCP tools in children`.

## Risks and Mitigations

| Risk                                                                                           | Mitigation                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Our built-in `name` drifts from Pi's, so `-builtin:<name>` silently stops applying to children | Step 3's real-SDK test asserts `-builtin:mcp` removes MCP; the rewritten upstream-assumptions row names `packages/coding-agent/src/extensions/index.ts` for `/upstream-impact` |
| A child spawned before the parent's MCP server connects gets no tools from a pattern           | `debugNote` names the unmatched pattern; docs state the spawn-time resolution                                                                                                  |
| `pi.getAllTools()` throws if called outside an active session                                  | It is called only inside `createSubagentSession`, which runs during a parent turn or a service spawn; both have a bound session                                                |
| The 1.0.0 bump surfaces a runtime change the suite does not cover                              | Measured: suite green at 1.0.0 (1937 tests); the major version and the release notes carry the floor change                                                                    |
| Each MCP-using child starts its own MCP server processes                                       | Accepted cost, limited to children that name MCP tools; documented                                                                                                             |

## Open Questions

- Whether a child should announce an unmatched pattern beyond `PI_SUBAGENTS_DEBUG` (for example in the spawn result).
  Defer until someone reports confusion; the debug note is the cheap first step.

[#1004]: https://github.com/gotgenes/pi-packages/issues/1004
[#1017]: https://github.com/gotgenes/pi-packages/issues/1017
