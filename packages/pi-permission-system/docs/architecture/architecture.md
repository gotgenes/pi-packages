# Architecture

This document describes the internal design of the permission system, informed by [OpenCode's permission model](https://opencode.ai/docs/permissions/).

## Design principles

1. **Unified rule model** - one `Rule` type, one evaluation function, all surfaces.
2. **Pure evaluation** - permission decisions are pure functions of (surface, pattern, rules).
   IO stays at the edges.
3. **Session approvals are just more rules** - no separate matching engine, no separate pre-check.
4. **MCP stays special** - multi-name target derivation is pre-processing, not a special evaluation path.
5. **Defaults are rules** - the universal default (`permission["*"]`) is synthesized as a low-priority rule in the array.
   No side-channel fallbacks.
6. **Flat config format** - the flat `permission: { ... }` object where each key is a surface.
   The config IS the ruleset in human-friendly form.
   Capability is a suffix on the surface name, not a nested facet (`path_read`, `external_directory_write`), and a bare `path` / `external_directory` key is load-time sugar expanding into both directions — so every channel keeps speaking one flat `(surface, pattern)` vocabulary ([ADR-0013](../decisions/0013-permission-policy-model.md) §3, §4).
7. **Preserve the two-phase model** - tool filtering (before_agent_start) and invocation gating (tool_call) remain separate.
8. **Ask = cache miss** - "ask" is the absence of a matching rule.
   The human is the oracle.
   Their decision is a rule.
   Persistence determines lifetime (once / session / config).
9. **Single-agent core, multi-agent by extension** - Pi is single-agent by deliberate design; the notion of multiple named agents is introduced entirely by external extensions (pi-subagents, pi-agent-router, some MasuRii packages), not by Pi itself.
   Per-agent `permission:` frontmatter is therefore an extension bridge layered on this single-agent core, not a core responsibility.
   The package learns the active agent from a generic `<active_agent>` signal (a system-prompt tag or an `active_agent` session entry), never from a hard dependency on any one multi-agent extension, so the bridge works with any tool that emits the signal.

## Scope and non-goals

The README carries a short charter for the boundaries that come up most often.
This is the full inventory, with the decision record or design principle each rests on.

| Non-goal                                                                             | Rests on                                                                                |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Implementing isolation — this decides and records; a sandbox contains                | [ADR-0013](../decisions/0013-permission-policy-model.md) §8                             |
| Deciding project trust — a policy enforcer, not a trust oracle                       | [ADR-0001](../decisions/0001-project-trust-adoption.md)                                 |
| Sanitizing the config merge so a project scope can only tighten                      | [ADR-0001](../decisions/0001-project-trust-adoption.md)                                 |
| Shipping permissive defaults, trust profiles, or workflow-mode presets               | Operator position; `docs/opencode-compatibility.md` divergence table                    |
| Built-in secret or sensitive-path denylists                                          | [ADR-0010](../decisions/0010-permission-log-secret-exposure.md)                         |
| Value-shape or entropy secret detection in the logs                                  | [ADR-0010](../decisions/0010-permission-log-secret-exposure.md)                         |
| Redacting the permission prompt or the forwarded request                             | [ADR-0010](../decisions/0010-permission-log-secret-exposure.md)                         |
| Disabling the review log by default, or gating `command` behind a flag               | [ADR-0010](../decisions/0010-permission-log-secret-exposure.md)                         |
| A downstream log-redactor registry                                                   | [ADR-0010](../decisions/0010-permission-log-secret-exposure.md)                         |
| Reading ambient host state (`cygpath`, MSYS detection) to interpret paths            | [ADR-0003](../decisions/0003-git-bash-posix-path-semantics.md)                          |
| Per-command argument tables in the deterministic bash layer                          | [ADR-0009](../decisions/0009-bash-path-projection-completeness-contract.md)             |
| Flooring every unprovable bash token to `ask`                                        | [ADR-0009](../decisions/0009-bash-path-projection-completeness-contract.md)             |
| Making the permission manager path-aware                                             | [ADR-0002](../decisions/0002-path-values-string-boundary.md), lint-guarded              |
| Making an LLM call, or holding model provider/prompt/threshold config                | [ADR-0007](../decisions/0007-model-judge-authorizer-chain-adr.md) §5                    |
| Letting an authorizer link `allow` on `external_directory` or a secret-shaped `path` | [ADR-0007](../decisions/0007-model-judge-authorizer-chain-adr.md) §5                    |
| Opt-out authorizer activation                                                        | [ADR-0007](../decisions/0007-model-judge-authorizer-chain-adr.md) §4                    |
| Running authorizer links on a relaying node, or a process-global registry            | [ADR-0007](../decisions/0007-model-judge-authorizer-chain-adr.md) §7                    |
| Re-deriving a forwarded request's facts at the parent                                | [ADR-0008](../decisions/0008-cross-session-access-intent.md)                            |
| A permanently tolerant dual-path wire, or a hard deny on a skewed request            | [ADR-0008](../decisions/0008-cross-session-access-intent.md) §4                         |
| Truncating or width-capping the assembled prompt message                             | [ADR-0011](../decisions/0011-prompt-presentation-contract.md) §2                        |
| Broadcasting evidence or annotations on `permissions:ui_prompt`                      | [ADR-0011](../decisions/0011-prompt-presentation-contract.md) §6                        |
| Returning model-generated annotations to the agent                                   | [ADR-0011](../decisions/0011-prompt-presentation-contract.md) §7                        |
| Echoing the agent's own tool input back in denial text                               | [ADR-0011](../decisions/0011-prompt-presentation-contract.md) §7                        |
| An in-package display for every operator's ideal (diffs, explanations)               | [ADR-0011](../decisions/0011-prompt-presentation-contract.md) §8                        |
| General agent steering from the permission dialog                                    | Operator position (issue #328)                                                          |
| Outbound bridges into another named extension's event contract                       | §"Beyond the target: a pluggable escalation seam", by analogy                           |
| A yolo mode that overrides explicit denies                                           | §"yolo is recorded authority"                                                           |
| A hard dependency on any one multi-agent extension                                   | Design principle 9                                                                      |
| A special evaluation path for MCP, or side-channel fallbacks                         | Design principles 4 and 5                                                               |
| OpenCode's top-level `"permission": "allow"` string shorthand                        | `docs/opencode-compatibility.md` divergence table                                       |
| A model that classifies access intent before `evaluate()`                            | §"Beyond the target"; [ADR-0007](../decisions/0007-model-judge-authorizer-chain-adr.md) |
| Supporting a non-Pi host that loads Pi extensions                                    | Operator position (#922)                                                                |

Three entries rest on an operator position rather than a decision record, and are marked as such above.
The host boundary is a line between two kinds of change, not a refusal to accept fixes: a payload that violates a contract this package already reads is normalized defensively, while a foreign host's bespoke tool formats, host-only tools, and separate approval authority are each declined.

The following are **not** boundaries, and must not be written as such.
Durable persistence of an approval is anticipated by design principle 8 and §"Authority lives in three places", which reserve a place for a ruling that outlives the session.
Whether a capability model replaces the actor-keyed surface list is settled: [ADR-0013](../decisions/0013-permission-policy-model.md) adds read/write capability as an axis beside the existing keys, so direction becomes expressible on `path` and on the boundary.
Which channels policy may enter through remains open in issue #799.
Multi-hop escalation, three-way grant scope, terminal-replacement registration, and non-TUI presentation are admitted-not-shipped or externally blocked, not declined.

### What would make a second host a goal

The host boundary is conditional, and the conditions are about verifiability rather than effort.
All five would have to hold; the first and the last are not this package's to satisfy.

1. **The host publishes a versioned extension-API contract.**
   Today a host adapts by rewriting imports at load time and nothing declares which extension-API version it implements, so every divergence is learned from a user's bug report.
   A stated contract is what makes a compatibility claim a claim about something.
2. **The suite executes against that host in CI.**
   A permission system's value is that its guarantees hold, so an unexecuted compatibility claim is worse than a declined one.
   This means a second lane on the host's runtime, not a mock of it.
3. **Host-only tools have a policy vocabulary.**
   A host that ships a persistent interpreter, browser control, or an editor-protocol client introduces permission surfaces with no rules, no defaults, and no documented recipes.
   They resolve to `ask` today through the universal fallback, which is safe but not expressible — a user cannot write policy about them.
4. **The dual-authority question is settled.**
   A host with its own approval layer makes this package a second authority over the same tool call, and the composition of the two — which prompts, which wins, whether an auto-approve mode bypasses these gates — has to be decided before either can be trusted.
   Getting it wrong is a silent bypass, which is this package's worst failure mode.
5. **A maintainer who uses that host owns the lane.**
   Nobody here runs it, so without an owner the lane rots into a green check that proves nothing.

Condition 1 is the one that currently fails hardest, and it is measurable.
Measured 2026-09-19 against Oh My Pi: 633 published versions, and 15 releases in the 11 days from 2026-09-08 to 2026-09-18 — roughly daily, against a pinned and slower-moving Pi.
Recheck that cadence before rereading this section as settled.

## Core data model

### Rule

```typescript
/**
 * Provenance of a rule - which source contributed it.
 *
 * Config scopes: "global", "project", "agent", "project-agent".
 * Synthesized:   "builtin" (universal default / evaluate() fallback),
 *                "baseline" (conditional MCP metadata auto-allow).
 * Runtime:       "session" (session approvals).
 * Rewrite:       "yolo" (composition-stage ask→allow rewrite under yolo mode),
 *                "fail-closed" (composition-stage allow→ask floor when an
 *                invalid non-global config scope is detected).
 */
type RuleOrigin =
  | "global"
  | "project"
  | "agent"
  | "project-agent"
  | "builtin"
  | "baseline"
  | "session"
  | "yolo"
  | "fail-closed";

interface Rule {
  /** The permission surface: "bash", "edit", "mcp", "skill", "external_directory", "path", etc. */
  surface: string;
  /** The match pattern: a command glob, tool name, file path, skill name, or "*". */
  pattern: string;
  /** The decision. */
  action: PermissionState;
  /** Custom denial reason for deny rules (optional). */
  reason?: string;
  /**
   * Origin layer - used to derive PermissionCheckResult.source after evaluation.
   * Not used by evaluate(); purely informational metadata.
   */
  layer?: "default" | "baseline" | "config" | "session";
  /** Which source contributed this rule. */
  origin: RuleOrigin;
}
```

Every config entry, default policy, session approval, and agent override normalizes into `Rule[]`.

### Ruleset

```typescript
type Ruleset = Rule[];
```

Merge precedence is array ordering.
The synthesized universal default goes first (lowest priority), then MCP baseline auto-allow rules, then config rules (global → project → agent → project-agent), and finally session rules (highest priority).
Last-match-wins: `evaluate()` scans from the end.

### Evaluate

```typescript
function evaluate(
  surface: string,
  value: string,
  rules: Ruleset,
  platform: NodeJS.Platform,
): Rule {
  for (let i = rules.length - 1; i >= 0; i--) {
    const rule = rules[i];
    // On win32 a path-surface match folds case + separators; `platform` is
    // injected from `PermissionManager` (read once at the composition root,
    // #510), never `process.platform` ambiently.
    if (ruleMatches(rule, surface, value, platform)) {
      return rule;
    }
  }
  // Unreachable when defaults are synthesized - the catch-all always matches.
  return { surface, pattern: value, action: "ask" };
}
```

The entire decision engine.
When defaults are synthesized into the array, the catch-all `{ surface: "*", pattern: "*", action: "ask" }` always matches - the fallback return is defensive only.

## Composed ruleset

All rule sources are concatenated into a single flat array.
Index position determines priority (higher index wins):

```text
  ┌─────────────────────────────────────────────────────────────────┐
  │                     Composed Ruleset (Rule[])                   │
  │                                                                 │
  │  Index 0: Synthesized universal default (layer: "default")      │
  │    { surface: "*", pattern: "*", action: permission["*"] }      │
  │                                                                 │
  │  Index 1..B: MCP baseline auto-allow (layer: "baseline")        │
  │    (only when any config rule has surface:"mcp" action:"allow") │
  │    { surface: "mcp", pattern: "mcp_status",   action: "allow" } │
  │    { surface: "mcp", pattern: "mcp_list",     action: "allow" } │
  │    { surface: "mcp", pattern: "mcp_search",   action: "allow" } │
  │    { surface: "mcp", pattern: "mcp_describe", action: "allow" } │
  │    { surface: "mcp", pattern: "mcp_connect",  action: "allow" } │
  │                                                                 │
  │  Index B+1..C: Config rules (global → project → agent,         │
  │                   layer: "config", origin: "global"|"project"   │
  │                   |"agent"|"project-agent")                     │
  │    { surface: "bash",  pattern: "*",     action: "allow",       │
  │      origin: "global" }                                         │
  │    { surface: "bash",  pattern: "git *", action: "allow",       │
  │      origin: "global" }                                         │
  │    { surface: "bash",  pattern: "rm *",  action: "deny",        │
  │      origin: "project" }                                        │
  │    { surface: "read",  pattern: "*",     action: "allow",       │
  │      origin: "global" }                                         │
  │    { surface: "mcp",   pattern: "exa:*", action: "allow",       │
  │      origin: "agent" }                                          │
  │                                                                 │
  │  Index C+1..end: Session rules (layer: "session", highest)      │
  │    { surface: "external_directory", pattern: "/other/*",        │
  │      action: "allow" }                                          │
  │                                                                 │
  │  ◄── evaluate() scans from end, first match wins ──►            │
  └─────────────────────────────────────────────────────────────────┘
```

`synthesizeDefaults()` produces a single universal catch-all from `permission["*"]`.
Per-surface catch-alls (e.g. `bash: { "*": "allow" }`) are expressed as regular config rules via `normalizeFlatConfig()` - no separate override layer is needed.

`synthesizeBaseline()` conditionally emits MCP metadata auto-allow rules.

`composeRuleset()` concatenates: defaults + baseline + config rules.
Session rules are concatenated after config rules so `evaluate()` handles them via last-match-wins - no separate per-branch pre-check.

### Default synthesis

```typescript
// Single universal catch-all from permission["*"].
function synthesizeDefaults(universalDefault: PermissionState): Ruleset {
  return [
    { surface: "*", pattern: "*", action: universalDefault, layer: "default" },
  ];
}

// MCP metadata auto-allow - only synthesized when any config rule has
// surface: "mcp" && action: "allow".
function synthesizeBaseline(configRules: Ruleset): Ruleset { ... }

// Concat in priority order: defaults, baseline, config.
function composeRuleset(defaults, baseline, config): Ruleset {
  return [...defaults, ...baseline, ...config];
}
```

## Architecture overview

```mermaid
flowchart TD
    subgraph Load["Config loading (IO boundary - PolicyLoader)"]
        GF["Global config file"]
        PF["Project config file"]
        AF["Agent frontmatter"]
        GF --> PL["PolicyLoader"]
        PF --> PL
        AF --> PL
        PL --> Norm["normalizeFlatConfig()"]
    end

    subgraph Defaults["Default synthesis"]
        DP["permission[*]"] --> Synth["synthesizeDefaults()"]
        Synth --> DR["Default Rule (lowest priority)"]
        Norm --> BL["synthesizeBaseline()"]
        BL --> BR["Baseline Rules (conditional)"]
    end

    Norm --> CR["Config Rules (layer: config)"]
    SA["Session Rules<br/>(layer: session, runtime)"]

    subgraph Compose["Rule composition"]
        DR --> Concat["composeRuleset(...) + session"]
        BR --> Concat
        CR --> Concat
        SA --> Concat
    end

    subgraph Eval["Pure evaluation (no IO)"]
        Concat --> E["evaluate(surface, value, composedRules)"]
        E --> Decision["Rule { surface, pattern, action }"]
    end

    subgraph PreProcess["Surface-specific input normalization"]
        MCP["MCP target derivation<br/>→ candidate values[]"]
        Bash["Bash command decomposition<br/>→ top-level commands[]<br/>→ most restrictive wins"]
        Skill["Skill name extraction<br/>→ skill name"]
        PathGate["Cross-cutting path gate<br/>(all file access: tools + bash)<br/>→ most restrictive wins"]
        ExtDir["External directory detection<br/>(tree-sitter-bash AST for bash; direct path for tools)<br/>→ normalized path<br/>(Pi infrastructure reads auto-allowed before gate)"]
    end

    PathGate --> E
    PreProcess --> E
```

The `Agent frontmatter` input (`AF`) is the per-agent override layer.
It only carries data when an external multi-agent extension is active (see design principle 9): the package resolves the active agent's name from a generic `<active_agent>` signal, then reads the `permission:` sub-document of that agent's definition file at `<cwd>/.pi/agents/<name>.md` (project) or `<agentDir>/agents/<name>.md` (global).
The package does not discover or enumerate agents — it reads one sub-document by name, on demand — and the `<cwd>/.pi/agents` location is a Pi platform convention this package encodes independently (no dependency on pi-subagents, ADR 0002).

## Config format

```jsonc
{
  "permission": {
    "*": "ask",
    "read": "allow",
    "bash": { "*": "allow", "git *": "allow", "npm *": "allow", "rm *": "deny" },
    "mcp": { "*": "ask", "exa:*": "allow" },
    "skill": { "*": "ask", "librarian": "allow" },
    "path": { "*": "allow", "*.env": "deny" },
    "external_directory": "ask"
  }
}
```

Each top-level key in `permission` is a surface name.
A string value is shorthand for `{ "*": action }` (surface-level catch-all).
An object value maps patterns to actions.
`permission["*"]` is the universal fallback.

### Normalization to Rule[]

`normalizeFlatConfig` (`src/policy/normalize.ts`) flattens each `permission` entry into `Rule`s: a string value expands to a single surface catch-all (`{ surface, pattern: "*", action }`), and an object value expands each `pattern → action` pair to one `Rule`.

Ahead of it, `expandDirectionalSugar` runs once per scope inside `mergeScopesWithOrigins`, rewriting a bare `path` / `external_directory` key into its two directional members so origins stay attributed to the authoring scope.
After expansion no rule lives on a bare family surface; `PermissionResolver.resolve` answers a bare-family query by folding the members most-restrictive.

## MCP pre-processing

MCP is the one surface that requires pre-processing **before** evaluation, and the one surface whose candidate list holds more than a single value.
The multi-name target derivation stays, but it feeds candidate values into the shared `evaluateAnyValue()` rather than a separate code path:

```mermaid
flowchart LR
    Input["MCP tool call input"] --> Derive["createMcpPermissionTargets(input)"]
    Derive --> Candidates["[exa_search, exa:search, exa, search, mcp_call]"]
    Candidates --> Eval["evaluateAnyValue('mcp', candidates, rules)"]
    Eval --> Scan["Last rule matching any candidate"]
    Scan --> Found{"Matched?"}
    Found -->|Yes| Return["Return rule + the first candidate it matches"]
    Found -->|No| Fallback["evaluate('mcp', candidates[0], rules)<br/>(hits synthesized default)"]
```

Rule position decides which rule wins — last-match-wins, as on every other surface.
The candidate ordering decides only which name the decision is reported under, so the most specific matching name reaches the prompt and the review log.
MCP target derivation helpers live in `src/access-intent/mcp-targets.ts`.
Input normalization for all surfaces lives in `src/access-intent/input-normalizer.ts`.

### Path-bearing tool normalization

Per-tool path patterns — e.g. `"read": { "*": "allow", "*.env": "deny" }` — are evaluated via the `access-path` intent the per-tool gate emits ([#502]).
When the pipeline calls `resolvePerToolCheck`, a present `input.path` triggers `normalizer.forPath(path)` and an `access-path` intent on the tool-name surface; the resolver unwraps it to `path-values` carrying the lexical ∪ canonical alias set before the manager evaluates the rule.
When `input.path` is missing or empty, the pipeline falls back to a `tool` intent, which `normalizeInput` collapses to `["*"]` (surface catch-all).
Path alias derivation (home-expansion, cwd-relative aliases) lives in `getPathPolicyValues` / `AccessPath` — not in `normalizeInput`, which no longer touches path surfaces (#504).
`getToolPermission()` is unaffected — it still evaluates with `"*"`, reporting the surface's own catch-all.
Tool injection no longer asks it: it asks `isToolFullyDenied()`, which probes every pattern configured on the surface (see [Phase 1](#phase-1-tool-filtering-before_agent_start)).

The cross-cutting `path` and `external_directory` gates extract paths for **extension and MCP tools too** (#352): `describePathGate` and `describeExternalDirectoryGate` call `getToolInputPath`, which reads `input.path` for built-ins, `input.arguments.path` for MCP, and a registered `ToolAccessExtractor` (or the default `input.path` convention) for any other tool.
The extractor registry (`src/tool-input/tool-access-extractor-registry.ts`) is created once in `index.ts` and shared: its lookup side is threaded into `ToolCallGatePipeline` (wrapped in the inheriting lookup below), and its registrar side is exposed cross-extension via `PermissionsService.registerToolAccessExtractor`.
Per-tool path maps for extension tools (a custom extractor key per tool) are a deferred follow-up.

A lookup that misses falls back to this node's **ancestors** in the same process (`src/authority/inherited-registrations.ts`), so a subagent child whose own registry has no extractor for a tool still sees the path that tool touches.
This is ADR 0012 decision 1's fact-shaping clause: an extractor produces a fact and decides nothing, so its *lookup* may cross an in-process node boundary while its *registration* stays node-local.
`getToolInputPath` reports which of the three sources answered, and a decision resolved from an ancestor carries `extractorSource: "inherited"` in its review-log context.
The authorizer registry has no such fallback, and `PermissionsService` deliberately exposes no reader for it — a link returns a verdict, so live authority stays converged at the adjudicating node (ADR 0007 §7).

On the bash side, which argument tokens count as filesystem operands is settled by [ADR 0009](../decisions/0009-bash-path-projection-completeness-contract.md): candidacy comes from the filesystem (a bare token is a path candidate iff it names an existing entry), the decision comes from explicit rules or the external boundary, and the ADR names both what the projection guarantees and which gaps are accepted residuals rather than bugs.
A plain `$HOME` / `${HOME}` / `$PWD` / `${PWD}` reference is resolved at token collection, upstream of classification, so an expanded token is gated exactly as its literal spelling; the resolvable set is closed at those two names by the same ADR.

## Session approvals: the cache-miss model

Session rules are stored as `Ruleset` and are generalized to all surfaces.

`evaluate()` is a **lookup** against cached decisions.
When no rule matches (or the matching rule says "ask"), the system has a cache miss - it needs the human oracle to produce a decision.

The human's response is simultaneously:

1. **The answer** for this request (allow or deny).
2. **A rule** that can be cached for future lookups.

The dialog determines **persistence** - where the rule lives:

```text
  evaluate(surface, value, composedRules)
       │
       ├── match.action = "allow" → proceed (cache hit)
       ├── match.action = "deny"  → block (cache hit)
       │
       └── match.action = "ask"   → cache miss, query oracle
                │
                ▼
           Dialog: "[surface] wants to [value]"
                │
                ├── "Yes"              → allow this request (no persistence)
                ├── "Yes, for session" → allow + store in session layer
                │                        (future lookups hit without asking)
                ├── "No"               → deny this request (no persistence)
                └── (future: "Always") → allow + store in config layer (disk)
```

### Pattern suggestions

When prompting, each surface suggests a **pattern** for the "for session" option.
The pattern determines what class of future requests auto-approve:

| Surface                | Input value                 | Suggested session pattern   | Mechanism                |
| ---------------------- | --------------------------- | --------------------------- | ------------------------ |
| bash                   | `git checkout main`         | `git checkout *`            | Arity table              |
| bash                   | `npm run dev`               | `npm run dev`               | Arity table              |
| tool (read/write/etc.) | tool surface itself         | `*` (all uses of that tool) | Tool-level               |
| mcp                    | `exa:search`                | `exa:*`                     | Server-level wildcard    |
| skill                  | `librarian`                 | `librarian`                 | Exact name               |
| external_directory     | `/other/project/src/foo.ts` | `/other/project/*`          | Directory prefix as glob |

The suggestion is shown in the dialog text so the user sees what they're approving:

```text
  ● Allow once
  ● Allow "git checkout *" for this session
  ● Deny
```

### Implementation

```mermaid
sequenceDiagram
    participant User
    participant Gate as Elicitor (ask-path)
    participant Eval as evaluate()
    participant Session as Session Rules (Ruleset)

    Gate->>Eval: evaluate("bash", "git status", composedRules)
    Eval-->>Gate: { action: "ask" } (cache miss)
    Gate->>User: "Allow 'git status'? [Once / Session: 'git status*' / Deny]"
    User-->>Gate: "Session"
    Gate->>Session: append { surface: "bash", pattern: "git status*", action: "allow" }

    Note over Gate,Session: Next similar call - cache hit
    Gate->>Eval: evaluate("bash", "git status --short", composedRules incl. session)
    Eval-->>Gate: { action: "allow" } (matched session rule)
    Note over Gate: No prompt needed
```

## Prompt presentation

What a prompt must show, what a renderer may elide, and what bounds its size are settled by [ADR 0011](../decisions/0011-prompt-presentation-contract.md).
The contract in one line: **the payload is complete, and elision is a property of a render, never of the payload**.

A gate emits structured facts rather than a sentence.
The payload's `request` group — requester and forwarded-ness, tool name and invoked tool name, gate surface and matched rule, the decision-relevant value, and for bash the unit that will actually run — is never elided by any renderer.
`evidence` is complete on the payload and elided to fit each renderer's budget, with the elision marked but uncounted; an operator must still be able to reach the complete information while the decision is pending.
The dialog is bounded by a row budget plus a per-field width cap, the review log by its own configured limits, and the `permissions:ui_prompt` broadcast receives the `request` facts only — the narrowest renderer, because the bus is the one channel an extension observes without the operator having named it.
Denial text is a fifth render of the same facts under one extra rule: it identifies the call rather than reproducing it, since the agent already holds its own tool input.

The payload exists, and the human-facing renderers are bounded.
Every gate emits a `PromptPayload` (`src/presentation/`), and `PromptPermissionDetails` requires one, so the six former assembly sites are gone.
`renderPromptDialog` renders it for the inline dialog and the `select`/`input` fallback under `promptMaxRows` plus `promptFieldMaxWidth`, and `Ctrl+O` expands the dialog to the complete request.
The cap applies to the `request` facts too: never elided means never *omitted* — a long one is shortened, marked, and reachable in full rather than dropped.
Without that reading a bounded render is unreachable, since the decision-relevant value is itself the pathological field in the reported case ([#710]).
A fact an adjacent line already states is not repeated — a bash ask's gate surface is its tool name, and a path ask's is the word its value line is labelled with — so the render spends a line only where it adds something.
That is a redundancy rule, not an elision: the fact is still on screen, which is what §3 requires.

The two cross-boundary contracts now carry facts rather than prose.
The forwarded-request wire carries the child's `PromptPayload`, so the serving node renders the child's own facts under the *parent's* budget — a forwarded bash ask reads `command : …` exactly as a local one does, and `kind: "forwarded"` narrows to meaning one thing: this ask arrived without a payload.
`permissions:ui_prompt` carries `request`, the payload's invariant core, and no evidence at all, which makes the bus the narrowest renderer (ADR 0011 §6): any loaded extension observes it without the operator having named that extension.
`toolInputPreviewMaxLength` and `toolTextSummaryMaxLength` are deprecated and ignored, superseded by the renderer budgets.

The last two consumers are renderers too, so the flat `message` string is gone.
The agent-facing text identifies a refused call rather than reproducing it (§7): it names the surface, the tool, the rule with its nested context, the flagged path or target or skill, and the operator's or human's reason — never the bash command, which is the payload that took over the viewport in [#710] and the agent's context window on every denial.
The flagged element is agent input, so it is capped rather than structurally bounded; naming it is what makes a denial correctable, since which of a call's operands a rule fired on is below tool-call granularity and the agent cannot recover it from its own arguments.
The review log persists the payload's request facts rather than the prompt sentence — stamped by `GateRunner` beside the request id, so no gate can forget them — and every string it writes is narrowed to `reviewLogFieldMaxWidth`.
That bound lives in `writeLine` beside the key-name mask, which makes the log's growth a decision the operator makes rather than a consequence of how long a command happened to be.
ADR 0011 records what each dependent item becomes under the contract.

### One dialog at a time

The host holds a single inline dialog slot, and mounting into it does not settle whatever was there: the displaced component's promise never resolves and it is never disposed.
This node raises asks from two independent tasks — the gate's local ask and the forwarded ask a poll tick drains — so whichever arrived second silently stranded the first, and a stranded forwarded ask held the forwarding inbox closed behind it ([#965]).

Every human-facing ask therefore runs through one `AskDialogQueue` per factory invocation (`authority/ask-dialog-queue.ts`), admitted by `LocalUserAuthorizer` and released by the lifecycle handler at `session_shutdown`.
The queue is unbounded: auto-denying a queued ask because the human at the head is slow is prompt-timeout behavior, which [#931] owns.

Its evidence is this node's own admissions rather than the state of the slot, which no extension can read.
So a dialog another extension mounts is outside what the queue can see, and upstream declined to arbitrate globally ([earendil-works/pi#7007](https://github.com/earendil-works/pi/issues/7007)) — the remaining exposure is that such a clobber leaves the queue's head unanswerable and the asks behind it waiting.

## Two-phase checking

### Phase 1: Tool filtering (`before_agent_start`)

`shouldExposeTool` (`src/handlers/before-agent-start.ts`) asks `isToolFullyDenied(toolName)` and exposes the tool unless every value under its surface resolves to `deny` — "could *anything* this tool does get through?"

The answer comes from `isSurfaceFullyDenied` (`src/policy/rule.ts`), which probes each pattern configured on the surface (plus the catch-all) as a representative value through the same `evaluate()`.
Ordering is therefore honored: `bash: {"*": "deny", "git *": "ask"}` keeps the tool visible, while `bash: {"git *": "ask", "*": "deny"}` does not — the later catch-all shadows the exception, so nothing is reachable.
Asking the catch-all alone (`evaluate(toolName, "*", rules)`) withheld the tool in the first case too, which is the [#815] defect.
The probe is an approximation of "does any string resolve non-deny", and being wrong in either direction only changes visibility: Phase 2 re-evaluates the real value against the same ruleset.

The set that question is asked of is the session's **tool-surface baseline** (`src/exposure/tool-surface-baseline.ts`), not the previous turn's answer.
Filtering writes its result back through `setActive`, so reading the active set again next turn returns the filtered set; narrowing that again each turn made the surface monotonically shrink and stranded a tool once its rule was relaxed ([#873]).
The baseline is rebuilt every turn from the tools still active plus the ones this extension's own filtering withheld, and the exposed set is `baseline ∩ policy`.
It only ever grows from tools observed **active**, so [#385]'s restrict-only contract holds: a tool pi left inactive never enters it.
A restored tool is callable on the turn it returns, but its `Available tools:` line reappears one turn later — pi builds the prompt parts an extension receives before that extension runs, so `systemPromptOptions.toolSnippets` carries no one-line description for a tool that was withheld last turn, and the line cannot be rendered until it is already active.

### Phase 2: Invocation gating (`tool_call`)

The gate pipeline (`src/handlers/gates/`) normalizes the input to `(surface, value)`, evaluates it against the composed ruleset, and acts on the result: `allow` proceeds, `deny` blocks, and `ask` elicits from the session's `Authorizer` — a persisted "session" decision appends a `Rule` to `sessionRules` so the next similar call is a cache hit.

Same `evaluate()`, same ruleset.
The only surface-specific logic is input normalization (what `surface` and `value` to look up) and pattern suggestion (what glob to offer for "session" approval).

`checkPermission()` uses a single evaluate path: `normalizeInput()` → `evaluateAnyValue()` → `deriveSource()` → single result object.

## Subagent detection and permission forwarding

When `ask`-state permissions arise in a headless subagent child process, the extension forwards the dialog to the parent session rather than silently denying.
This requires two detections:

1. **Is the current process a subagent?**
   - `isSubagentExecutionContext()` in `src/authority/subagent-context.ts`.
2. **What is the parent session ID?**
   - `resolvePermissionForwardingTarget()` in `src/authority/permission-forwarding.ts`.

Neither decides whether *this* node serves an inbox of its own, which is `hasUI` alone (#907).
Together with a third question — is that parent draining its inbox right now?
— they decide whether a node with a UI of its own relays instead of prompting ([#909]).

### Known extension env var inventory

| Extension                                                                           | Child-process env vars                                                                    | Parent-session env var              |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------- |
| The adapter convention (new implementations)                                        | none required                                                                             | `PI_SUBAGENT_PARENT_SESSION`        |
| pi-agent-router (original)                                                          | `PI_IS_SUBAGENT`, `PI_SUBAGENT_SESSION_ID`, `PI_AGENT_ROUTER_SUBAGENT`                    | `PI_AGENT_ROUTER_PARENT_SESSION_ID` |
| [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents)               | `PI_SUBAGENT_CHILD`, `PI_SUBAGENT_RUN_ID`, `PI_SUBAGENT_CHILD_AGENT`, `PI_SUBAGENT_DEPTH` | `PI_SUBAGENT_PARENT_SESSION`        |
| [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents)                 | none - runs fully in-process via `createAgentSession()`                                   | n/a - deferred to #29               |
| [HazAT/pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents) | `PI_SUBAGENT_NAME`, `PI_SUBAGENT_ID`, `PI_SUBAGENT_SESSION`, `PI_SUBAGENT_ACTIVITY_FILE`  | none set (see #98)                  |

### Detection (`isSubagentExecutionContext`)

`isSubagentExecutionContext()` checks three sources in priority order:

1. **Explicit registry** - the in-process half of the subagent adapter convention ([Subagent Integration](../subagent-integration.md#the-subagent-adapter-convention) is its canonical spec); the permission system's subscriber writes the entry into `SubagentSessionRegistry` synchronously.
   The registry (keyed by **child session id**) is checked first.
   Each concurrent sibling child of the same parent receives a unique session id from `sessionManager.newSession()`, so siblings occupy distinct keys - one sibling's `disposed` event cannot evict another's entry (fixes #298).
   The registry is a process-global singleton (via `getSubagentSessionRegistry()`, backed by `globalThis` + `Symbol.for()`) because each session's `ResourceLoader` creates its own `pi.events` bus: the parent's instance registers the child over the parent bus, while the child's separate jiti instance reads the same global store to detect itself and resolve its forwarding target.
2. **Env vars** (`SUBAGENT_ENV_HINT_KEYS`) - returns `true` when any key is set to a non-empty, non-whitespace value.
   Used by process-based subagent extensions.
   The list is composed from the per-extension markers plus `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES`, since a process that names a parent session is a child by definition - which is what makes the convention's single out-of-process obligation sufficient on its own (#789).
   A UI host can therefore answer `true` here too, because an implementation may export the marker from its own root process so the children it spawns inherit it.
   The predicate answers "is this process a child", not "should this node relay rather than decide": `selectAuthorizer` relays a node with a UI only when a target resolves *and* that target is serving ([#909]), and serving eligibility does not consult the predicate at all (#907).
3. **Filesystem path** - session-directory path-based fallback (child session dir is nested under `subagentSessionsDir`).

### Parent-session resolution (`resolvePermissionForwardingTarget`)

`resolvePermissionForwardingTarget()` checks two sources in priority order:

1. **Explicit registry** - if the caller provides a `sessionId` and `registry`, the registry entry's `parentSessionId` is returned when present.
   Used by in-process subagent extensions.
2. **Env vars** (`SUBAGENT_PARENT_SESSION_ENV_CANDIDATES`) - iterates candidates and returns the first non-empty, non-`"unknown"` value.
   Used by process-based subagent extensions.

Either source skips a candidate naming the requesting session itself: a request filed into one's own inbox is drained by no watcher and answered by nobody (#907).
When no candidate survives, forwarding fails with an explicit log message naming the variables checked.

The function answers only "which *other* session", so it is also what `selectAuthorizer` asks before relaying a node that has a UI: no target means the human here decides ([#909]).
That node additionally requires `ForwardingLivenessJudge` to report the target as serving, and records `forwarded_permission.relay_started` / `relay_stopped` when the answer changes — the requester-side counterpart of the serving node's own `serving_started` / `serving_stopped`.

HazAT sets no parent-session env var today, so forwarding still fails for it with that message pointing to #98.
Adding a new env var candidate when an extension adopts the convention is a one-line change to the array.

### In-process case (resolved)

In-process subagent extensions (e.g. `@gotgenes/pi-subagents`) call `createAgentSession()` directly - no child process is spawned and no env vars are ever set.
The announcement they owe, and the pre-bind ordering that makes it usable, are specified by the adapter convention in [Subagent Integration](../subagent-integration.md#the-subagent-adapter-convention); `src/authority/subagent-lifecycle-events.ts` subscribes and writes/removes the entry in `SubagentSessionRegistry` synchronously.
The registry is process-global (see `getSubagentSessionRegistry()` in `src/authority/subagent-registry.ts`) so the child's separate jiti instance reads the same store as the parent.

### External convention guide

A [permission frontmatter convention guide](../guides/permission-frontmatter-for-subagent-extensions.md) documents how upstream subagent extensions can adopt the `permission:` frontmatter key as a shared convention.
This is a documentation-only proposal - no code dependency is required.
The guide covers the two-layer model, flat format reference, composition examples, and the optional event bus runtime integration.

## Cross-extension service accessor

The primary cross-extension API is a `Symbol.for()`-backed service object on `globalThis`.
The cross-node contract governing this surface is settled in [ADR 0012](../decisions/0012-cross-node-extension-contract.md); its decisions 2, 3, and 4 are implemented here.

Pi's extension loader creates a fresh jiti instance per extension with `moduleCache: false`, isolating module-scoped state.
`Symbol.for()` and `globalThis` are process-global by spec, so they survive this isolation.

One process can host several **nodes** — one Pi session runtime each, with its own `ExtensionContext`, event bus, gates, registries, and `PermissionSession`.
A root session and each of its in-process subagent children are separate nodes, and each loads its own instance of this extension.
Registrations never cross a node boundary: a child fixes an ask's facts and runs its own gates, so the extractors and formatters it needs are the ones registered in *its* registries, and chain links are consulted only by the node that adjudicates (ADR 0007 §7).

So each node publishes its `PermissionsService` at `session_start` into a process-global map keyed by its own session id, and a consumer resolves it with `getPermissionsService(sessionId)`.
The session id travels as data on the `permissions:ready` payload, alongside `adjudicatesLocally` — a registrant needs no branch on the latter, since a link registered where no chain runs is accepted and recorded rather than refused (decision 4, `authorizer_link_vacant` in the review log).
That payload is broadcast twice per session generation: at `session_start` after the node publishes, and again at the node's first `before_agent_start`, which runs after every extension's `session_start` and before any ask (decision 3, the ready latch).
So the channel fires at least once per session and may repeat, and the ready handler alone is a sufficient registration site — a consumer needs no second attempt from its own `session_start`, only an idempotence guard.
The keyed map is the only slot.
A legacy single slot, written by every node that was not an in-process subagent child (the #302 guard) and read by a deprecated `getRootPermissionsService()`, was removed once its last downstream migrated — it answered "the process root's service", which is the wrong node in every node but the root, and keyed publication dissolves the clobbering hazard the guard existed for.
The locator's `sessionId` is required rather than optional, so a `PermissionsReadyEvent.sessionId` of `null` cannot fall through to some other node; a caller the types cannot reach (JavaScript, or a consumer compiled against an earlier major) gets `undefined` plus a once-guarded `PI_PERMISSION_SYSTEM_WARN0001` warning rather than another node's service.
The `package.json` `exports` field's `default` condition points to `src/service.ts`, which contains the interface, the accessor functions, and the `Symbol.for()` key - no extension machinery.
The `types` condition instead resolves to a bundled `dist/public.d.ts` (built by `rollup-plugin-dts` from `rollup.dts.config.mjs`, published via `prepack`) so a downstream consumer's `tsc` never follows the raw `#src/*` module graph - only the `default` condition (the jiti runtime) reads `src/` directly (#592).

Both accessors come from `import("@gotgenes/pi-permission-system")`.
The `PermissionsService` interface exposes six methods:

- `checkPermission(surface, value?, agentName?)` - full policy query.
- `getToolPermission(toolName, agentName?)` - the surface's catch-all permission state (`allow`/`deny`/`ask`).
- `isToolFullyDenied(toolName, agentName?)` - whether every value under the surface resolves to `deny`; the question tool pre-filtering asks, since a partially permissive surface reports `deny` from the catch-all.
- `registerToolInputFormatter(toolName, formatter)` - register a custom ask-prompt preview for a tool name; returns a disposer (#283).
- `registerToolAccessExtractor(toolName, extractor)` - declare the filesystem path a non-conventional tool accesses, so the cross-cutting `path`/`external_directory` gates see it; returns a disposer (#352).
- `registerAuthorizer(name, authorize)` - register a named live-authority chain link (`allow | deny | defer`, ADR 0007 §4); decides nothing until the operator names it in `authorizerChain` config, and every verdict is capped by the bounded-delegation checkpoint; returns a disposer.

`permissions:decision` and `permissions:ui_prompt` broadcasts remain on the event bus - fire-and-forget observation is the right abstraction for those channels ([#531] removed the event-bus RPC channel; the service accessor is now the sole cross-extension policy/prompt surface).

## The authority model

This section records the organizing concept the package is built around — the spine the elicitation, forwarding, and yolo machinery collapse into — plus the still-open directions that extend it.
It is current state, not a target: the `Authorizer` interface, its three implementations, once-per-activation selection, `canConfirm()`'s dissolution, serving-as-resolution, human-selectable grant-scope, and the `authority/` directory migration all shipped in Phase 9 (see [history/phase-9-authorizer-spine.md](history/phase-9-authorizer-spine.md) for why the spine is the correct model of the `@gotgenes/pi-subagents` integration — the anonymous cross-session-authority recursion behind the [#296]/[#298]/[#302] bug history — and not merely an internal tidy).
Of the ["beyond the target"](#beyond-the-target-a-non-deterministic-access-intent-classifier) extension points below, the model-triage `Authorizer` chain is now implemented (Phase 12; [ADR 0007](../decisions/0007-model-judge-authorizer-chain-adr.md)), and its named-link registration subsumes the pluggable escalation seam; the deny-first slice is dogfooded by `packages/pi-permission-model-judge`, and the allow-capable opaque-bash adjudicator ([#620]) remains the sole open Track B slice.
A non-deterministic access-intent classifier remains aspirational.

### The spine

Every action resolves against an **authority** — an entity empowered to permit or forbid it.
The only questions are *which* authority and how we reach it.

This sharpens principle 8.
That principle calls the human "the oracle," borrowing the computer-science term for a black box consulted for an answer the system cannot compute.
But a permission decision is not epistemic (who *knows* the answer); it is deontic (who has the *right* to decide).
If a bystander happened to know what the user wanted, their saying "allow" would authorize nothing.
What makes a decision binding is authority, not knowledge — so the organizing concept is authority, and the entity that holds it is an **`Authorizer`**.
The human is merely the `Authorizer` at the interactive root; another agent can hold the role equally well.

### Authority lives in three places

1. **Recorded authority** — the ruleset.
   Config (durable, on disk), session rules (this session), and synthesized defaults/baseline are all prior rulings.
   `evaluate()` *is* "consult recorded authority": an `allow` or `deny` means recorded authority is sufficient, and the decision is final.
2. **Live authority** — reached only on `ask`, when recorded authority is silent.
   An entity empowered to rule *now*, reached through one of three channels (below).
3. **Absent authority** — nothing recorded, nothing reachable.
   Least privilege applies: no authority means the action is unauthorized, so it is denied.

The three are one thing at different lifetimes.
A live ruling, once persisted, *becomes* recorded authority — principle 8's "their decision is a rule."
The "for this session" dialog option writes a session rule; a future "always" writes config.

### The `Authorizer` role

On `ask`, the gate escalates to **one `Authorizer`, selected once per session from context**, and is told the decision.

1. **`LocalUserAuthorizer`** — the session has UI and names no parent that is draining its inbox; prompt the human here.
2. **`ParentAuthorizer`** — the session is a subagent without UI, or one whose declared parent is serving ([#909]); escalate up the tree to the parent's authority.
3. **`DenyingAuthorizer`** — no authority is reachable; deny (least privilege).

There is no "can anyone answer" pre-check.
`canConfirm()` — today a boolean smeared across the gateway, prompter, and forwarder — dissolves: every `Authorizer` answers, the `DenyingAuthorizer` by denying.
The three context predicates (`hasUI`, `isSubagent`, yolo) are evaluated once, at selection, instead of repeatedly down the prompt path.

```text
evaluate(action, recorded authority)
  ├─ allow / deny ------------------> decided (recorded authority sufficient)
  └─ ask (recorded authority silent)
        └─ escalate to the session's Authorizer
              ├─ LocalUserAuthorizer -> prompt the human here
              ├─ ParentAuthorizer    -> forward up the tree, await the parent's ruling
              └─ DenyingAuthorizer    -> deny (no authority reachable)
                    |
              (a persisted ruling becomes recorded authority)
```

### The recursion

Authority is delegated **down** the session tree: the human drives the root, which spawns subagents that hold no inherent authority to approve a novel action.
So an `ask` a subagent cannot answer **escalates up** to where authority resides.
Permission-system instances form a tree mirroring the session tree, and `ParentAuthorizer` is the edge that routes a child's escalation toward the human at the root.
This is the same recursion pi-subagents describes (a subagent is a child Pi), viewed from the permission system's side: the package is itself one of the hooks on that child, and it recurses by forwarding.

### Reconstruction fidelity at the serving node

The courier hop carries facts, not judgment — but what the serving node reconstructs from a forwarded request differs by audience, and the two directions are the same rule applied to different trust boundaries.

An **in-process seam** — the `Authorizer` chain, reached through `PromptPermissionDetails` — receives the full child-fixed fact set.
A chain link is operator-opted-in via `authorizerChain` and must decide from evidence, not from parsed display text or a parent-side re-derivation of the child's path ([ADR 0008](../decisions/0008-cross-session-access-intent.md) forbids the latter outright).
The bounded-delegation checkpoint reads the same facts, so a forwarded ask is capped on the gate surface exactly as a local one is ([ADR 0007](../decisions/0007-model-judge-authorizer-chain-adr.md) §5).

A **cross-extension broadcast** — `permissions:ui_prompt` / `permissions:decision` on `pi.events` — receives the minimum needed to stay correlatable, because any loaded extension can observe it.

Maximum fidelity to the decider; minimum disclosure to the observer.
Requester identity (`requesterCwd`, `principal`) crosses to neither: it is the serving node's own resolution input (ADR 0008 §3) and stays on the wire object, with the ask details carrying only the `forwarding` provenance.

### yolo is recorded authority

yolo is not a channel and not a live concern — it is a standing authorization, and it belongs in the ruleset, not in the prompt path.
It is a composition-stage rewrite: when enabled, every `ask` action in the composed ruleset is rewritten to `allow`, tagged `origin: "yolo"` so the review log still distinguishes a yolo grant from a policy allow.

```typescript
const effective = yolo
  ? composed.map((r) => (r.action === "ask" ? { ...r, action: "allow", origin: "yolo" } : r))
  : composed;
```

This is faithful to current behavior exactly: explicit `deny` rules are not `ask`, so they pass through untouched — yolo suppresses prompts but **preserves hard denies**.
It honors principle 5 (defaults are rules; no side-channel fallbacks): `evaluate()` runs pure over the rewritten ruleset, and the prompt path loses all yolo knowledge (`shouldAutoApprovePermissionState` and `canResolveAskPermissionRequest`'s yolo arm dissolve).

The ruleset is the whole story for asks the ruleset produces.
An `ask` synthesized *after* resolution is not one: the bash wrapper floor (#481, #490) and the fail-closed `<unparseable-bash-command>` sentinel (#452) are properties of a parsed command unit, not of a pattern, so there is no rule for the rewrite to touch and they reached the prompter under yolo (#712).
A wrapper the floor no longer covers (#803) synthesizes nothing, so it never reaches that reconciliation at all — it is decided by an ordinary rule, on the inner command's text.
The reconciliation has exactly one home — `resolveYoloGrant` at `GateRunner`'s auto-approve fast path, the single choke point every gate passes through before escalating — so the contract "an `ask` never reaches `PermissionPrompter` under yolo" holds structurally for whatever floor is added next.
It is the same deny-preserving shape as the rewrite: a `deny` is not an `ask`, so it matches neither arm.
A future "disable everything" mode — overriding denies too — would be a *different*, deliberately named operation: appending a final `{ surface: "*", pattern: "*", action: "allow" }` rule (last-match-wins).
It is not built, and it would be requested by name, never conflated with yolo.

### Fail-closed on an invalid non-global scope

The mirror image of the yolo rewrite.
When a non-global config scope (project, agent, or project-agent) is present but fails to load or validate, the loader marks it invalid (`ScopeConfig.invalid`) instead of silently substituting an empty scope.
At composition the manager floors every `allow` in the composed ruleset to `ask`, tagged `origin: "fail-closed"`, so a permissive rule inherited from a lower-precedence scope cannot remain effective behind a higher scope that was meant to tighten it (#646).

```typescript
const effective =
  failClosedScopes.length > 0
    ? composed.map((r) => (r.action === "allow" ? { ...r, action: "ask", origin: "fail-closed" } : r))
    : composed;
```

Like yolo it is deny-preserving (only `allow` is touched) and applied at composition, so the display surfaces (`getComposedConfigRules`, `getToolPermission`) reflect the clamp too.
Global is excluded — it is the lowest precedence, so nothing more permissive is inherited when it fails.
The two overlays stack in order: fail-closed floors `allow`→`ask` first, then yolo (if enabled) rewrites `ask`→`allow`, so an explicit yolo opt-in still wins.

### Discriminating delegation: a model `Authorizer`

Nothing constrains an `Authorizer` to be deterministic.
`LocalUserAuthorizer` is already a non-deterministic oracle — the human — and the determinism principle governs *recorded* authority (`evaluate()`), never the live-authority layer.
A model (e.g. Claude Haiku) can hold an `Authorizer` role on the same terms: it is live authority, so it never touches `evaluate()` or the deterministic core.

The design is settled in [ADR 0007](../decisions/0007-model-judge-authorizer-chain-adr.md); the essentials follow.

**The live-authority layer is a Chain of Responsibility.**
Each link returns `allow | deny | defer`; on `defer` the next link decides.
The chain ends at a **terminal that cannot defer** — today the human (`LocalUserAuthorizer`), the headless `DenyingAuthorizer`, or `ParentAuthorizer` (terminal for its node, forwarding up to the parent node's chain — the [recursion](#the-recursion) above).
The invariant is type-level: a terminal returns only `allow | deny`, so a deferring link cannot occupy the terminal slot.
`selectAuthorizer` becomes the terminal-selection step of `composeAuthorizerChain` — registered non-terminal links, then the context-selected terminal.

**One chain per node.**
An ask is adjudicated by exactly one node's chain: the node whose terminal decides it (ADR 0007 §7).
A subagent node's terminal relays the ask to a serving node, which escalates it through *its* chain over the same child-fixed facts — so a relaying node resolves no links, and records `authorizer_chain_delegated` rather than reporting each configured name as a fail-safe skip.
An adjudicating node records `authorizer_chain_resolved` with the names it consulted, since a deferring link decides nothing and otherwise leaves no evidence it ran.

```text
ask -> [ model-judge link ] --defer--> … --defer--> [ terminal: human | Parent | Denying ]
              ├─ deny (with teaching reason)   -> denied
              ├─ allow (slice 2, if not excluded) -> permitted
              └─ defer                          -> next link
```

**The model judge is a non-terminal link**, not a decorator or a fourth channel.
It reviews an `ask`, decides the ones it is confident about, and defers the rest to its successor — a middle rung between prompt-everything and allow-everything.
Denies are decided by recorded authority and structurally never reach an `Authorizer`, so a model link cannot grant a hard deny; the safeguard for a sensitive resource stays an explicit `deny` rule, which survives the model just as it survives the yolo rewrite.

The verdict range is `allow | deny | defer` — a superset of the earlier allow-or-escalate framing — because the first use case is **deny-first**.
A light model reviews `external_directory` asks, denies an errant "typo" path with a teaching `reason` (wrong path; correct location) so the invoking model self-corrects, and defers everything else.
A second use case adjudicates **opaque bash**: the model decomposes a `bash -c "…"` / `eval` command and queries the deterministic engine per sub-command through an injected, narrow `PermissionQuery` (never a reach-through to `PermissionsService`), allowing only what the engine already grants for the pieces it identifies.
The two are one link on a **capability gradient**: the deny/defer reviewer is strictly more restrictive and ships first; the allow-capable adjudicator loosens privilege and is gated behind the full envelope (hard exclusions, audit `origin: "authorizer:model"`, non-persistence, off by default), because its safety property holds only if the model's decomposition is faithful.

Registration mirrors `registerToolAccessExtractor`: a downstream extension offers a **named** capability (`registerAuthorizer("model-judge", …)`) on `permissions:ready`, and this package makes no LLM call itself.
Three invariants govern the seam: config order (not registration order) fixes the security-relevant chain order; a missing configured link is skipped fail-safe (more prompting, never less); and **registration alone grants no authority** — a link decides nothing until the operator names it in the `authorizerChain` config (opt-in).
Bounded delegation is operator config this package enforces at a checkpoint that downgrades an excluded-surface `allow` to `defer`, with `external_directory` and secret-shaped `path` always excluded; the model's provider/prompt/threshold live in the downstream extension's own config.

This is the principled successor to the per-command argument-position work deferred from [#509].
The bash path projection surfaces a bare token that names a real file ([#645]) and deliberately accepts a fail-safe false positive (`grep id_rsa secrets.txt` prompts when an `id_rsa` file happens to exist); that false positive lives on the *ask-producing* side of `evaluate()`, and the model link dismisses it on the *ask-consuming* side without hard-coding per-command file-argument tables.
This split is the layering principle of [ADR 0009](../decisions/0009-bash-path-projection-completeness-contract.md): the deterministic layer biases toward surfacing because over-suppression is unrecoverable, and the judge absorbs the surplus.
The two compose cleanly because a promoted token emits the same structured descriptor a prefixed path does, so a link needs no promotion-specific knowledge.

**Dogfooded:** a first-party monorepo package (`packages/pi-permission-model-judge`) implements the deny-first typo-path reviewer against the real seam, so `registerAuthorizer` is born consumed (the [#267] vacant-surface guard).

### Resolved direction

These were the open decisions; they are now settled and shipped (full rationale in [history/phase-9-authorizer-spine.md](history/phase-9-authorizer-spine.md)).

1. **Serving is resolution.**
   A serving node runs `evaluate()` against its recorded authority then escalates to its own `Authorizer` on `ask`, carrying the forwarded ask's provenance as data so the `permissions:ui_prompt` broadcast stays non-degraded.
2. **Multi-level escalation: admitted, not shipped.**
   A middle node's chain terminates in a `ParentAuthorizer`, so re-escalation needs no special-casing; the tree is depth-2 today (pi-subagents' recursion guard), and a one-hop canary flags any future break.
3. **Full delegation of authority down the tree.**
   A subagent inherits its ancestors' `allow`/`deny` rules and yolo; because yolo is deny-preserving, the safeguard for a cheaper delegate is an explicit `deny` in its per-agent frontmatter, not an `ask`.
4. **Grant scope is human-selectable.**
   Approving a forwarded request "for this session" offers root / parent / requesting-subagent scope (requesting subagent pre-selected); "parent" and "root" coincide until trees deepen.

### Remaining design work

**Access-intent extraction** is the one genuinely open piece, and the foundation for the path surface of the decisions above.
The package's center of mass is not the decision engine (tiny, pure) but turning `(toolName, input)` into "what is being accessed" — bash decomposition, MCP target derivation, path extraction, external-directory detection.
This is a distinct domain (access intent) that gates should *emit* and a single `resolve(intent)` should answer, so adding a gate cannot widen the resolver surface.
The [#393] false-green (a stubbed-but-unrouted resolver method silently passing `allow`) was the probe pointing at it: the resolver surface was `resolve` + `resolvePathPolicy`, widening per gate, until Phase 6 Step 6 ([#478]) collapsed it to one `resolve(intent)`.
[#418] is a second probe, from the access-path side: both external-directory gates matched config patterns against the symlink-resolved path because a single `string` carries a path that is simultaneously a containment value (canonical, for the outside-CWD boundary) and a match value (lexical, as the user typed it), with no type distinction — so the canonical form leaked into matching and defeated a configured `/tmp/*` allow.
The same conflation lived in `BashProgram.externalPaths(): string[]`, which returned only the canonical form and so lost the typed value the matcher needed.
The fix's `getExternalDirectoryPolicyValues` helper (the union of lexical aliases and the canonical path) was the embryo of the access-path: `AccessPath` ([#476]) now holds both forms behind distinct `matchValues()` and boundary accessors, making the misuse a compile error; `BashProgram.externalPaths()` now returns `AccessPath[]` and one external-directory policy check can replace the two parallel gates that independently acquired this bug.
The tractable first slice was the access-path value object seeded by [#418]: it removed the path-representation conflation and the duplicate external-directory gate without waiting on principal identity or cross-session portability.
Principal identity and path portability across cwds — a subagent in a `pi-subagents-worktrees` worktree resolves paths against a different root than the parent — are now settled: [ADR 0008](../decisions/0008-cross-session-access-intent.md) (Phase 12) fixes a path-shaped ask's portable meaning at the child (the child's lexical ∪ canonical `matchValues()` plus canonical `boundaryValue()`), carries it onto the forwarded wire as `ForwardedAccessIntent`, and makes serving agent-scoped (`requesterAgentName` decision-participating).
A forwarded ask now resolves against the child-fixed alias set rather than a re-derivation through the parent's `PathNormalizer`/cwd.
With principal identity and path portability delivered, this domain has no further genuinely open piece; a non-path serving refinement (a per-surface `Authorizer` chain exclusion beyond `external_directory`/secret-shaped `path`) remains a candidate but is not scheduled.

### Beyond the target: a non-deterministic access-intent classifier

This is a **more distant** direction than the target above — noted as a candidate extension point, not planned work.

Access-intent extraction is deterministic by design: `(toolName, input)` becomes "what is being accessed" through bash decomposition, MCP target derivation, and path rules.
A second, independent place non-determinism could one day enter is a model that *classifies* access intent **before** `evaluate()` — deciding, for instance, that `id_rsa` in `git grep id_rsa` is a search pattern rather than a file, so no path candidate is emitted at all.

The classifier differs from the [`ModelTriageAuthorizer`](#discriminating-delegation-a-model-authorizer) in *where the model sits*.
The classifier feeds **recorded** authority — it shapes the intent `evaluate()` rules on — whereas the Authorizer holds **live** authority and answers the `ask`.
A wrong classifier call is a misread of what is being accessed; a wrong Authorizer call is a mis-granted decision.
Because the classifier changes the *input* to the deterministic core, it weakens the "same `(toolName, input)` yields the same ruling" property more subtly than the Authorizer does — the model output becomes part of the intent — so it warrants its own decision record and is deliberately out of scope for the current target.
The access-intent domain the gates emit into is the natural seam for such a pluggable classifier: deterministic today, model-assisted only if and when that trade is made by name.

### Beyond the target: a pluggable escalation seam

The **registration seam** this section anticipated is now designed: [ADR 0007](../decisions/0007-model-judge-authorizer-chain-adr.md) settles the `Authorizer` chain and its named-link registration (`registerAuthorizer`), with the model judge as its first consumer.
What remains a **more distant** direction — a candidate extension point, not planned work — is applying that same seam to *replace the terminal* (a delegation framework other than pi-subagents, a chat-approval bot, or a remote review surface *as* the authority) and refactoring the built-in subagent integration to register through it.

The [#261]/[#267] inversion made pi-subagents pure — it publishes its child lifecycle and knows nothing about consumers ([ADR-0002]) — but the purity is one-sided: this package is the integration owner.
It knows pi-subagents' event channel names (`subagent-lifecycle-events.ts`), hardcodes an env-hint inventory of known third-party subagent extensions (`SUBAGENT_ENV_HINT_KEYS`), and bakes in a session-directory heuristic.
Supporting a new delegation framework — or something that is not a subagent extension at all, such as a chat-approval bot or a remote review surface — means editing this package.

The subagent machinery decomposes into three roles a seam would name and separate:

- **Detection** — is this session a delegated context?
  This is an Authorizer-selection predicate; [#529]'s `SubagentDetection` gives it one owner.
- **Target resolution** — where does authority live for this session; which node serves the escalation (`resolvePermissionForwardingTarget` today).
- **Transport** — how an `ask` travels to that authority and the ruling returns (the file-based request/response polling today; [#530]'s escalation-up role, `ParentAuthorizer` since [#555]).

A registered provider is exactly a selection predicate plus a `ParentAuthorizer`-shaped transport: "when my predicate matches this session and recorded authority is silent, escalate through me."
The `Authorizer` spine is therefore the seam — this direction is the spine's registration story, not a mechanism beside it.

Two shapes, the second generalizing the first:

1. **A bridge extension** — a third package subscribes to pi-subagents' lifecycle and registers with this package's public seam, leaving both cores pure.
   A dedicated glue extension knowing both ends is the sanctioned complement of the rule against outbound bridges *from a core*.
2. **A dogfooded provider seam** — this package defines the registration API and implements its own built-in pi-subagents integration through it, the way `registerToolAccessExtractor` / `registerToolInputFormatter` already let extensions plug the gates; third parties register on equal terms and the zero-config default survives.

A history guard: this re-introduces an inbound registration surface of the kind [#267] retired.
It differs in kind — consumer-agnostic, documented for third parties, and consumed by the built-in provider itself, so it cannot go vacant the way the two-method `registerSubagentSession` RPC did.

Any design must honor the standing constraints: registration lands synchronously before `bindExtensions()`; cross-session visibility rides `globalThis` + `Symbol.for()` (the [#296] bus-split lesson); a provider is live authority only and never touches `evaluate()`; and a session no provider claims selects `DenyingAuthorizer` — least privilege, unchanged.
It sequences after the Phase 9 spine and warrants its own decision record.

### Naming

The concept and the code role take two grammatical forms of one root, each for what it correctly denotes:

- **`authority`** (mass noun) — the right to decide; used for the concept ("recorded authority," "where authority lives").
- **`Authorizer`** (count noun) — the entity that holds it; used for the interface and its implementations.

`Authorizer` is domain-idiomatic: AWS Lambda "authorizers" and OAuth's authorization server return allow/deny, so the term already denotes an entity that can refuse.

## Module structure

```text
src/
├── index.ts                  Extension factory - event wiring, collaborator construction (established injection-bag wiring kept inline per the anti-procedure-splitting rule)
├── service.ts                PermissionsService interface + the Symbol.for() accessors (cross-extension API) over the session-keyed map every node publishes into; public surface published as a self-contained dist/public.d.ts bundle
├── types.ts                  Core type definitions; the config-shape types (PermissionState, FlatPermissionConfig, etc.) are re-exported from config-schema.ts; domain type guards `isPermissionState`, `isDenyWithReason`
├── value-guards.ts           Runtime type guards (`toRecord`, `isPlainRecord`, `getNonEmptyString`). Constraint: `isPlainRecord` is shared by the writer's two recursive stages, so the width cap and the command mask cannot disagree about which records they descend into
├── permission-request-id.ts  `createPermissionRequestId()` — the one mint for a permission request's `perm-<uuid>` id; distinct from the host's `toolCallId`, which stays alongside it as the join back to the Pi transcript
│
├── config/               Configuration domain: everything that reads, validates, holds, or reflects configuration. Consumed by `policy/`, which never reads a file itself
│   ├── config-loader.ts     File I/O, format detection, strict zod validation (fail-closed) for config files; merges trusted `config.local.json` after shared project config for runtime knobs
│   ├── config-schema.ts     Zod schemas - single source of truth for the config shape; derives the JSON Schema (buildPermissionsJsonSchema) and the config types. `permissionSchema` names ten well-known surfaces (`*`, the `path` and `external_directory` families, `bash`, `mcp`, `skill`) as `surfaceProperty(...)` properties over a `.catchall(...)` that keeps arbitrary tool-name surfaces validating, each carrying its own description and markdownDescription so an editor binds documentation to the key under the cursor. It rejects two unusable surface-key spellings at load: a misspelled directional key (which would sit inert, failing **open** as a restriction) and an empty key. Constraints: refinements do not serialize into JSON Schema, so both are loader-only checks; `DIRECTIONAL_SURFACE_KEYS` is the loader's allowlist and is held in step with the schema's directional properties by test, not structurally
│   ├── config-store.ts      `ConfigStore` class — owns `config` + the issue list the last load produced; `ConfigReader`, `SessionConfigStore`, `CommandConfigStore`, `ConfigIssueSource` narrow interfaces. `refresh(cwd, projectTrusted)` takes no `ExtensionContext`: a load that holds one acquires UI side effects it cannot honor at factory-init time, which is how a config warning came to be recorded as delivered without being shown (#933). It loads and answers `getConfigIssues()`; the status bar is `PermissionSession.refreshConfig`'s job and the notification is `ConfigIssueReporter`'s
│   ├── config-issue-reporter.ts `ConfigIssueReporter` + `ConfigIssueSource` / `ConfigIssueWarner` / `ConfigIssueReporting` seams: decides whether the operator has already heard a config issue, latched per issue and delivered per report (three detector hits are one notification; a later report announces only what is new). `reported` is replaced rather than added to on each report, so an issue fixed and reintroduced is announced again. Delivery goes through the injected `warn` seam (`SessionLogger.warn`, reaching `PermissionSession.notify`), never a ctx parameter, because a reporter cannot be handed a context that does not exist. Driven at `session_start` and on every `before_agent_start` (#933)
│   ├── dialog-keys.ts       The inline dialog's key vocabulary: `PromptAction` (the eight decisions, whose ids are the `permissionDialogKeys` config keys; the three persistence actions are offered only to a local ask carrying a proposal), `DEFAULT_DIALOG_KEYS`, the bindable character set, and `resolveDialogKeys`. Tolerant by design - an unusable, reserved (`j`/`k`, and `t` for the save-summary toggle), or colliding override keeps its decision's default letter and is reported, so a mistyped hotkey never reaches the policy the way every other invalid field does. Collision detection settles rather than checks once: dropping an override restores its default, which can collide with an override that survived the previous look. Constraint: no SDK import, so the bindable roster is a literal held in step with pi-tui's `Key` export by test
│   ├── config-paths.ts      Path derivation
│   ├── config-reporter.ts   Structured log entries for resolved config
│   ├── config-modal.ts      /permission-system slash command UI
│   ├── extension-config.ts  Runtime knobs (debugLog, yoloMode, etc.)
│   ├── extension-paths.ts   `ExtensionPaths` value object - immutable path constants derived from `agentDir` (and optional Pi `getPackageDir()`) at startup (`computeExtensionPaths`)
│   ├── policy-loader.ts     PolicyLoader interface + FilePolicyLoader (file I/O, mtime caching); merges trusted project-local config after shared project config into the one `project` scope, and marks a present-but-unloadable non-global scope `invalid` (an absent file stays a plain empty scope) so composition can fail closed
│   ├── yaml-frontmatter.ts  Minimal YAML/frontmatter parsing (`parseSimpleYamlMap`, `extractFrontmatter`)
│   └── status.ts            Footer status bar integration
├── policy/               Policy domain: the rule model and the composition that turns configuration into a decision. Depends on `config/` for loading and on nothing above it
│   ├── rule.ts                 Rule type, Ruleset type, evaluate() (takes an injected `PathFlavor` for win32 path-surface case-folding); exports `pathMatchOptions(surface, flavor)` and `isSurfaceFullyDenied(surface, rules, flavor)`, the reachability probe tool exposure asks (each configured pattern probed through evaluate, so last-match-wins shadowing is honored)
│   ├── normalize.ts            Config → Ruleset normalization (flat format); `expandDirectionalSugar` rewrites a scope's bare `path` / `external_directory` key into its directional members before composition, sugar entries first and explicit directional entries appended after, whatever the file's key order. Constraint: no rule survives on a bare family surface — the resolver's family fold is the read path (ADR 0013 §4)
│   ├── synthesize.ts           Universal default + MCP baseline → Ruleset
│   ├── wildcard-matcher.ts     Compiled glob matching. `CompiledWildcardPattern.matches(value)` is the only match surface (no exposed `RegExp`). Constraint: the win32 `windowsSeparators` fold applies to the pattern and the matched value alike, and lives on the compiled pattern so it cannot be half-applied — folding only the pattern makes every forward-slash value unmatchable (#653)
│   ├── scope-merge.ts          Cross-scope permission merge + origin-map bookkeeping
│   ├── permission-merge.ts     Deep-shallow merge for flat permission configs
│   ├── restrictiveness.ts      The deny > ask > allow ordering, first-wins on ties: `mostRestrictiveOf` over a statically non-empty tuple (total, so the resolver's family fold has no `undefined` branch) and the empty-tolerant `pickMostRestrictive` the bash gates use. Core-layer, so `permission-resolver.ts` can depend on it
│   ├── permission-manager.ts   Scope loading + rule composition + `check(intent)` (single resolution entry point); delegates I/O to PolicyLoader; floors the composed ruleset `allow`→`ask` (origin `fail-closed`) when a non-global scope is `invalid`, and appends a fail-closed notice to `getConfigIssues`. Constraint: stays string-based — must not import `AccessPath` (the ADR 0002 string boundary, lint-guarded by `no-restricted-imports`)
│   ├── permission-resolver.ts  `ScopedPermissionResolver` interface - the single `{ resolve(intent) }` role the gate factories / runner / pipeline depend on; `PermissionResolver` concrete class holds `ScopedPermissionManager` + `SessionRules`, owns `resolve(intent)` (unwraps an `access-path` `AccessIntent` via `matchValues()` before calling `manager.check`; the concrete class also accepts a pre-fixed `path-values` intent as a passthrough — the forwarded-serving wire's producer, #597 — while the gate-facing interface stays narrow to `AccessIntent`), the surface-family fold (an intent naming a bare `path` / `external_directory` surface is resolved against each directional member and combined most-restrictive, returning the losing member's own result). Constraint: the fold lives here, not in the gates — this is the one entry point the gates, `LocalPermissionsService`, and `ServingPolicy` share, and a serving node resolving a forwarded child request against an emptied bare surface would stop hard-denying what the parent's config denies (#712, #806). Also owns raw `checkPermission` (`implements SkillPermissionChecker`, no session rules), `getToolPermission`, `isToolFullyDenied`, and `getConfigIssues`. That composition — `buildResolvedIntentFromMatchValues` plus `resolver.resolve` — is pinned by the `ServingPolicy resolves a forwarded request against real recorded authority` block in `test/authority/forwarded-request-server.test.ts`; every other test in that file stubs `policy`, so none of them would catch a regression there
│   └── permission-gate.ts      Pure deny/ask/allow gate (injected IO). Reports a whole-session grant as one optional field (`canGrantForSession` in, `sessionGrant` out) rather than echoing the suggestion, which the caller already holds and which has no single representative once an approval carries a surface per pattern. The field carries the width to record at rather than sitting beside a separate flag, so a width for a grant that never happened is unrepresentable. Both result arms carry the `DecisionSource` that answered — the gate is the one place that knows whether recorded authority or an escalation decided, so the caller reads it rather than reconstructing it from a captured decision. Its `messages` bag holds one refusal factory, not one per outcome: which sentence a refusal earns follows from the decision's own decider, dispatched at the renderer
├── session/              Session domain: the state scoped to one session's lifetime — its lifecycle owner, its approvals, its identity, and its agent name
│   ├── permission-session.ts         `PermissionSession` class - state/lifecycle owner: owns context lifecycle, session-rule lifecycle (`reset`/`shutdown`/`reload`), skill entries, the tool-surface baseline (`resolveExposedTools`), agent-name resolution, the config gateway (`refreshConfig` loads through the store, then syncs the status bar, the UI side effect keyed on the context this class owns, #933), the Tell-Don't-Ask gate inputs, and `notify(message)` (UI warn over the owned context, no-op before activation); `implements ToolCallGateInputs`. The resolve role lives in `PermissionResolver`, the recorder role in `SessionRules`; handlers depend on the concrete class + `PermissionResolver`
│   ├── session-rules.ts              Session approval store (Ruleset wrapper); records each grant on the surface that grant names, so an ask whose paths proved different directions grants each only its own; `implements SessionApprovalRecorder`; injected into `GateRunner` as the recorder role. `approve` expands a bare family surface into both directional members the same way `expandDirectionalSugar` does, because a session approval is a policy source under ADR 0013 §9
│   ├── session-approval.ts           SessionApproval value object - owns a list of `ApprovalGrant`s, built by `single` or `forGrants`; exposes `isRecordable`, `toForwardedData()`, and `atWidth(width)`, which produces the approval as recorded at a chosen width so the runner never inspects a grant's surface
│   ├── approval-grant.ts             `ApprovalGrant` interface - one pattern paired with the surface it was approved on - plus the `SessionGrantWidth` vocabulary over it: `widenGrant` folds a grant to its family, `provenDirectionOf` answers whether one direction describes a whole approval, `isSessionGrantWidth` guards the value off the forwarded wire. Its own module because both `session-approval.ts` and the forwarded wire type name it, and those two already import in one direction
│   ├── session-approval-recorder.ts  `SessionApprovalRecorder` interface - records a granted session-scoped approval into the session ruleset; implemented by `SessionRules`
│   ├── session-identity.ts           `readSessionId(ctx)` — this node's own session id, or `null` when the host exposes none; the one defensive read shared by subagent-child detection and service publication
│   └── active-agent.ts               Agent name detection from session/system prompt
├── access-intent/        Access-intent domain: turns `(toolName, input)` into what is being accessed (bash decomposition, MCP targets, path extraction, the `AccessPath` value object and `AccessIntent` union)
│   ├── path-normalization.ts  `AccessPath`'s representation backing: `normalizePathForComparison` (lexical absolute, via `flavor.comparable`), `canonicalNormalizePathForComparison` (symlink-resolved + win32-lowercased via `flavor.fold`), `normalizePathPolicyLiteral` (literal cleanup), `getPathPolicyValues` (lexical ∪ relative match set) + `PathPolicyValueOptions`; pure derivation over an injected `PathFlavor`
│   ├── access-intent.ts       `AccessIntent` discriminated union each gate emits: `tool` (raw input the manager normalizes) and `access-path` (an `AccessPath` for every path gate — `path`, `external_directory`, and the per-tool path-bearing surfaces `read`/`write`/`edit`/`grep`/`find`/`ls`). Constraint: `ResolvedAccessIntent` (`tool | path-values`) is what the manager consumes after the resolver unwraps `access-path` via `matchValues()` — `path-values` is still not gate-emitted, keeping the manager string-based (the ADR 0002 boundary), but since #597 it has a second legitimate producer: the forwarded-serving wire builds a `path-values` intent directly from a `ForwardedAccessIntent`'s child-fixed `matchValues`, via `buildResolvedIntentFromMatchValues` (`input-normalizer.ts`)
│   ├── access-path.ts         `AccessPath` value object: `matchValues(): string[]` (lexical alias union ∪ canonical, the match set), `boundaryValue(): string` (symlink-resolved + win32-lowercased), `value(): string` (lexical absolute display form), `resolvedAlias(): string | undefined` (the canonical form only when distinct, for disclosing a symlink target in a prompt/denial); `forPath(pathValue, { cwd, resolveBase?, flavor })` serves every path surface, `forLiteral(literal)` builds a literal-only path with no canonical for the unknown-base bash case, and `forDevice(devicePath)` preserves an MSYS device path verbatim. Type-distinct accessors make the lexical/canonical conflation a compile error
│   ├── tool-kind.ts           `ToolKind` string-union + `classifyToolKind(toolName)` — the single dispatch point deciding what an invocation accesses (bash command / MCP target / skill / path-bearing tool / extension) once at the normalize boundary; imports only `PATH_BEARING_TOOLS` (AccessPath-free, so `permission-manager.ts` may consume it without breaching the ADR 0002 string boundary). Also owns `isMcpCheck({ toolName, source })`, the shared MCP-ness predicate the presentation consumers dispatch on. Also owns `resolveShellInvocation`, the single dispatch point that turns native `bash` *or* a tool aliased through the `shellTools` config (`{ commandArgument, workdirArgument? }` per foreign tool name, e.g. `@howaboua/pi-codex-conversion`'s `exec_command`) into a `{ command, workdir }` shell invocation — every other tool yields `null` (#574). The gate pipeline consults it once, parses the command into a shared `BashProgram` (which owns its source command via `commandText()`, so the two bash gates read it rather than re-deriving `input.command`), and routes the aliased command through the same `resolveBashCommandCheck` + bash path/external-directory gates as native bash, so fail-closed, wrapper flooring, and `bash:` rules apply identically. The aliased tool is gated on the `bash` surface (a session "allow" writes a `bash:` rule) while the invoked tool name is preserved in the review log. A `workdirArgument` seeds the path-walk's initial base (an implicit leading `cd <workdir>`) so relative tokens resolve against it, and the workdir itself is flagged `external_directory` when outside the session cwd; containment always measures against the session cwd, never the workdir, so an aliased tool cannot widen the sandbox. Constraint: `classifyToolKind` stays config-free — the alias consult is a separate function because it needs config and returns a richer product
│   ├── input-normalizer.ts    Surface-specific input normalization → NormalizedInput
│   ├── mcp-targets.ts         MCP multi-name target derivation
│   ├── tool-input-path.ts     `getToolInputPath` (built-in / MCP / extension path extraction) + `getPathBearingToolPath` (built-in-only)
│   ├── path-surfaces.ts       Static surface/tool lookup sets (`PATH_BEARING_TOOLS`, `READ_ONLY_PATH_BEARING_TOOLS`, `PATH_SURFACES`) plus the capability-axis vocabulary: `surfaceFamilyOf`, `surfaceFamilyMembers`, `capabilitySurfaceForEffect` (the narrowest family member an attributed effect names), and `capabilitySurfaceForTool`, which routes a tool's identity through it over a private `effectProvenByTool`. The family relation is derived from a family set and a suffix list, so each of the four directional names is spelled exactly once, and every proof source reaches a surface by the one function
│   ├── effect.ts              The filesystem-effect vocabulary: `Effect` (`read` | `write`), `AttributedEffect` (adds the fail-closed `unproven`), `EffectSource` (`syntax` | `core` | `retracted` | `unproven` — the review log's blame fact), `TokenEffect`, `UNPROVEN_EFFECT`, and `mergeTokenEffects`, which keeps the effect and the first source when two attributions of one path agree and falls to unproven when they disagree. Constraint: core-layer, so it must not import from `bash/` — `path-surfaces.ts` consumes it, and a vocabulary module reaching into the bash subtree is the layering violation that relocated `restrictiveness.ts` out of `handlers/gates/`
│   └── bash/
│       ├── parser.ts                    Lazy tree-sitter-bash parser: `TSNode` interface (exported), `getParser = memoizeAsyncWithRetry(initParser)` (exported); `warmBashParser()` / `getWarmBashParser(): TSParser | null` / `resetWarmBashParser()` (test-only) expose the resolved parser synchronously after a `before_agent_start` warm-up so the advisory bash path can decompose at gate parity. Also exports `BashReparser`, the one-method view of the parser a fragment re-parser takes, narrower than the private `TSParser` because that also carries the parser's own `delete()`. Also owns the two readers of `TSNode`'s `hasError` / `previousSibling`: `parseUnresolvedAt(node)` (subtree or preceding sibling), because error recovery discards text it cannot attach in either place and a caller consulting only the subtree sees half the cases; and `parseUnresolvedWithin(node)` (subtree only), the question a walker descending statements asks and the one `unresolved-salvage.ts` asks twice — to locate a region and to refuse its re-parse. Constraints: no other module reads either member — recovering-parser behavior is a fact about tree-sitter rather than about any construct, and a hand-rolled sibling walk elsewhere is how the two placements drift apart again (#814); and the two are not interchangeable — the predecessor clause is a fact about redirects, so borrowing it for statements would condemn every statement following a failed one (#840)
│       ├── node-text.ts                 Quote-aware AST node-text resolver: `resolveNodeText` (pure), `SKIP_SUBTREE_TYPES` (node types whose *text* is never an argument — heredoc/comment), `ARG_NODE_TYPES` (argument-value node-type set), `hasComputedPart(node)` (true when a substitution, an arithmetic expansion, or an expansion other than a plain `$HOME`/`$PWD` decides the value at run time); delegates expansion nodes to `shell-variable-expansion.ts`, falling back to the node's literal text
│       ├── nested-execution.ts          Shared nested-execution vocabulary for both bash surfaces: `NESTED_EXECUTION_CONTEXTS` (substitution node type → `BashCommandContext`), `EXECUTION_HOST_TYPES` (node types that are not commands or argument values but whose subtree can host a command that really runs — redirects, heredoc/herestring bodies), and two traversals answering the two questions a consumer can have: `forEachNestedExecution(node, visit)` searches strictly within a subtree, while `forEachExecutionIn(node, visit)` is root-inclusive, visiting a node that *is* a context and delegating for one that merely contains one. Neither descends past a context it finds, which is what lets a visitor decide how to treat the interior. Constraint: the command surface and the path surface must share one definition of a nested execution, or a command gated on one surface escapes the other (#741)
│       ├── shell-variable-expansion.ts  Pure plain-reference resolver: `resolvePlainVariableExpansion(node): string | null` — `$HOME`/`${HOME}` → `os.homedir()`, `$PWD`/`${PWD}` → `.` (the base-relative marker, so the resolver's existing `resolveBase` applies it after `cd` folding). Plainness is structural (exactly one `variable_name` child, otherwise only delimiters), so an operator form (`${HOME:-/tmp}`, `${#HOME}`) is rejected without enumerating bash's expansion operators. Constraint: the resolvable set is closed at `HOME`/`PWD` — widening it is an ADR 0009 amendment, and the expansion vocabulary lives only here, never in the classifiers. A `~` token keeps its raw spelling in prompts and logs (it is shape-classified directly and never needed collection-time expansion), while a `$HOME` token displays expanded — which is what makes the prompt agree with the session-approval pattern, always derived from the expanded `AccessPath.value()`
│       ├── command-effects.ts           Pure word-based effect proofs, the two sources the package can hold without belief: `PURE_READER_CORE` (the frozen 21-word roster, grouped by admission reason with the deliberate exclusions recorded beside it) behind `proveCommandEffect(headWord, argWords)`, and `redirectDestinationEffect(operator, destinationIsDescriptor)` over the redirect operator table. Constraints: a core word matches as a **bare basename only** — a head word containing `/` or `\` proves nothing, rejected on the separator characters directly so the rule needs no `PathFlavor` and stays fail-closed on both platforms; `find`/`fd`/`sort` carry retraction guards matched fail-closed across the exact-word, long-stem (including a GNU abbreviation and an attached `=value`), and clustered-short forms, yielding `retracted` rather than a write; an operator outside the table proves nothing rather than returning `null`, since dropping a token removes a path from the gates entirely. Pure and word-based — the AST walk that produces the words stays in `token-collection.ts`. `docs/configuration.md` publishes the roster between `<!-- BEGIN PURE_READER_CORE -->` markers and a parity test in `test/access-intent/bash/command-effects.test.ts` fails on drift — edit both or neither
│       ├── token-collection.ts          Bash argument/flag tokenizer: `collectPathCandidateTokens`, `collectCommandTokens`, `collectRedirectTokens`, `extractCommandName`, `extractCommandWord` (exported); private `PATTERN_FIRST_COMMANDS` table and pattern/generic collectors, plus `collectEmbeddedOptionValues` — emits the inline value of a **generic** command's `--opt=value` argument as its own token, read from the argument nodes (a collector classifies a flag and never emits it), so an option-embedded path is classified by the ordinary shape rules without per-command option tables (#645). The table holds two classes that share one question. A pattern-first *matching* tool (`sed`, `awk`, `grep`, `rg`, `sd`) leads with an inline pattern and skips one or two positionals; an **interpreter** (`node`, `bun`, `python`, `python3`, `perl`, `ruby`) leads with nothing and declares `patternPositionals: 0`, so its program can only arrive through a `script`-role flag and a script *file* stays an operand — `node build.js /tmp/x` projects both tokens while `node -e "// x"` projects none (#863). `node` and `bun` carry identical spellings in separate objects, the sharing rule read from the other direction: identical spellings, different parsers. A pattern-first command runs that split from inside its own walker instead, because there each recognized flag carries a `PatternFlagRole` — `script` / `script-file` / `value` / `suffix`, keyed by short **and** long spelling and matched exactly, `=`-embedded, or glued — which decides at once whether the inline pattern positional is spent, whether the flag's value is a path candidate, and whether the following argument belongs to the flag at all; a pending consumption discharges on whatever node type follows, and a positional is likewise spent by any node the shell passes as a word, so a number, expansion, or substitution — as a flag's argument or as the pattern itself — cannot shift the positional count onto the operand; a redirect hosted on the command node is the one exclusion, narrow on purpose because miscounting an argument as a redirect drops an operand while the reverse only over-surfaces. The table lists a flag as consuming only when it consumes on every supported platform **and in every command sharing the entry** — which is why `grep` and `rg` split on `--context` (getopt declares it optional-argument, clap does not), why `sed -i` is `suffix` (BSD takes a separate suffix argument and GNU glues it, and the argument's own emptiness decides which without detecting the host's sed), and why `awk`/`nawk`'s GNU long forms are `unknown-arity` — the bare name is GNU awk on Fedora/RHEL and one-true-awk or mawk elsewhere, so the table claims neither arity and lets both spellings' operands through rather than guessing, while `gawk` names GNU awk outright and carries the real roles. This is an active constraint, since over-listing drops a real operand while under-listing only over-surfaces (#823). Every collector returns `PathToken[]` — the token paired with the `TokenEffect` its position proved — tagged where the token is *produced*, so a nested execution's tokens keep their own command's attribution and a redirect destination carries the operator's proof over the redirected command's. Each token also carries a `TokenRole` (`operand` | `redirect-destination`) stamped at the same site: `collectRedirectTokens` gives `redirect-destination` to the redirect's own target (`redirectTargetIndex`) when the operator proved an effect, the value is literal (not `hasComputedPart`), and it is non-empty, and every other token is an `operand`. Constraint: only the first destination takes the role, because `tree-sitter-bash` 0.25.1 parses the words after a redirect as further destinations while bash passes them to the command (#977); admitting them projected flags such as `-type` as write paths. `extractCommandName` basenames for the pattern-first tables while `extractCommandWord` returns the raw head word the core's bare-basename rule needs; the two are documented against each other. Also projects the operands of a command hosted in a redirect destination, an interpolating heredoc body, or an **argument** of either command walker; the `EXECUTION_HOST_TYPES` dispatch sits above the `SKIP_SUBTREE_TYPES` check because `heredoc_body` is in both sets and the host reading must win — its prose stays out of the path surface while its substitution's operands enter it (#741). Constraint: an argument node is read for its text *and* searched for hosted executions, because an unquoted `$(…)` parses as a `command_substitution` the ordinary recursion reaches while a quoted one parses as a `string` both walkers claim as an argument and would otherwise stop at — the search reads executions rather than text, so a single-quoted argument, which runs nothing, contributes nothing (#945). `COMMAND_PREFIX_TYPES` (`command_name`, `variable_assignment`) names the children that supply no operand of their own but can host a command that really runs, so both walkers collect a prefix-position substitution's operands while a prefix assignment's literal value stays out; the set exists because the two walkers are different state machines and would otherwise drift. Also reads the operands a statement names directly — a `for`/`select` word-list entry and a `case` subject — through one `collectStatementOperandTokens` walker parameterized by which side of the anonymous `in` keyword is the operand side. Constraints: a non-operand child, and an operand-side child outside `ARG_NODE_TYPES`, both fall through to the ordinary recursion rather than to a hosted-execution search — the first is what keeps a `do_group` reaching the loop body's commands, and the second is what keeps a substitution in the word list descended rather than read as literal text, so it retains its own command's effect attribution; a `case` pattern, a loop variable, and a function's own name are never read, the same boundary the command enumerator's `STATEMENT_TYPES` filter draws from the other side (#839)
│       ├── unresolved-salvage.ts        `withSalvagedRoots(primary, reparser, use)` — re-parses each region the primary parse could not resolve so its commands and paths are gated instead of dropped. Offers the innermost node `parseUnresolvedWithin` reports that is neither an `ERROR` nor the root, re-parses that node's own source text through the injected `BashReparser`, and admits the result only when the re-parse is clean; the trees it creates are deleted as the callback returns. Constraints: the clean-re-parse condition is the whole safety argument — error recovery invents the structure inside an unresolved region (#742) and invented structure does not re-parse, so without it `cat <> rw.txt` yields a command unit whose text is `">"`; an `ERROR` node is never a candidate and never descended for one, for the same reason; and the trigger is the parse's health rather than a node type, so the next grammar gap is not silently dropped for landing somewhere other than a `file_redirect` (#875)
│       ├── command-enumeration.ts       Bash command enumerator: `collectCommands`, `collectSalvagedCommands`, and `inlineShellPayloadNode` (exported — the same walk from a scope already marked unresolved and `salvaged`, for a region re-parsed out of a failed subtree; `salvaged` is narrower than `parseUnresolved`, which a primary unit also carries when its statement failed, and it is what lets the verdict fold ask whether the primary parse matched anything, #875) + the descend/skip tables and the node→`CommandWord` adapter; owns the `BashCommand` interface including the `wrapperKind` discriminant, the display-only `executedUnit`, and the `floorExemption` a transparent wrapper carries; strips leading `variable_assignment` prefixes from command units. Relays a `UnitScope` — the enclosing statement's execution context, whether it writes a file through a redirect, and whether its parse was resolved — because a `redirected_statement` owns the redirect its command node does not, and `TSNode` exposes no parent; a nested execution starts with a fresh scope, since an enclosing statement's redirect is not the substitution's. `unresolvedScope` marks every unit at or beneath a node whose subtree the parser could not resolve, so the verdict fold can floor it (#840); it skips `COMMAND_ENUM_DESCEND` members, since `program` / `list` / `pipeline` report an error whenever anything anywhere beneath them failed and asking there would mark every unit of the command. A compound statement (`COMPOUND_STATEMENT_TYPES`) is emitted whole and then descended through `descendStatementChildren`, which recurses only into children named by `STATEMENT_TYPES` and searches the rest for hosted executions; a `STATEMENT_GROUP_TYPES` member (`do_group`, `case_item`, `elif_clause`, `else_clause`) is descended but never emitted. Constraints: `COMMAND_ENUM_SKIP` holds only genuinely inert types (`comment`, `heredoc_end`) — a node that is not a command but can host one belongs in `EXECUTION_HOST_TYPES`, and conflating the two questions is the bypass #741 fixed; the `STATEMENT_TYPES` filter is what keeps an operand word (a loop variable, a `case` subject, a function's own name) from being emitted as a command unit; an `ERROR` node is emitted whole and never descended, because tree-sitter's error recovery invents the structure inside one (#742). A unit's text excludes its redirect (`npm install > out.txt` matches as `npm install`) — 45% of real bash commands carry a redirect, so folding it in would break exact-match rules wholesale. Quoting needs no handling: tree-sitter-bash emits a `command_substitution` under `heredoc_body` only for a bare `<<EOF`, never for `<<'EOF'`/`<<"EOF"`. `inlineShellPayloadNode(command)` answers which of a command's word nodes holds its inline-shell payload, over the shared `commandWordNodes` walk and `inlineShellPayloadIndex`; the log's command masker reads it to offset a re-parse by the payload node's `startIndex` (#923). Constraints: it peels indirection layers before answering, because `executedUnitOf` does — a payload query that stopped at `sudo bash -c '…'` would mask the secret under `executedUnit` and write it verbatim under `command`, which is the inconsistency #923 closes; it returns the *node* where `executedUnitOf` returns text, because unquoting, unwrapping nested indirection, and dropping a result that adds nothing all lose the correspondence to the command as written; and the payload set is the shell set, so an interpreter (`python3 -c`, `node -e`) answers `null` — its payload is another language, and re-parsing it as bash is how a raw-string scan came to read a secret out of embedded Python
│       ├── wrapper-analysis.ts          Pure word-based wrapper interpretation: `classifyWrapperWords` (the `WrapperKind` discriminant — `"opaque-payload"` for `bash -c`/`eval`, `"indirection"` for sudo/env/xargs/find -exec/…), `executedUnitOf` (the command a wrapper actually runs), `inlineShellPayloadIndex` (which word position holds the inline program — `eval`'s first argument, or the one after the `-c` cluster, reached through any indirection layers the private `directPayloadIndex` does not itself peel; `-1` when the unit carries none), and `isTransparentWrapper` (whether the floor still has a reason to hold), over the shared wrapper vocabulary and one private `unwrapIndirection` walk. Constraints: all three answers read one vocabulary — the shape that floors a unit, the shape that names its inner command, and the shape that exempts it cannot drift; and the two consumers of that walk must part company at an opaque payload, since `executedUnitOf` is display-only and deliberately names what runs *inside* `sh -c`, while a gateable answer read off that string would let a core-looking first word stand for an unparsed program. `isTransparentWrapper` therefore establishes its own inner command and proves it through `proveCommandEffect`, so a retracted core word (`xargs sort -o`) is not exempt. The floor sentinels are `<opaque-bash-wrapper>` (`bash`/`sh`/`dash`/`zsh`/`ksh -c`, or `eval`, #481) and `<indirection-bash-wrapper>` (`INDIRECTION_WRAPPER_NAMES` = `sudo`/`env`/`xargs`/`time`/`nohup`/`timeout`/`nice`/`parallel`/`rust-parallel`/`rush`/`doas`/`setsid`/`stdbuf`/`watch`/`flock`, plus `find`/`fd` carrying a per-result exec flag via `EXEC_CONDITIONAL_WRAPPERS`, #490, #575)
│       ├── bash-path-resolver.ts        `BashPathResolver` class (constructed with a `PathNormalizer` and an optional `workdir`): `resolve(rootNode, salvagedRoots?): ResolvedBashPaths` walks the AST once, tagging each path-candidate token with the `EffectiveBase` in force at its position and the `TokenEffect` its collector proved, and returns `{ externalAccesses: BashExternalPath[], ruleCandidates: BashPathRuleCandidate[] }`; routes every path through the injected `PathNormalizer`. A salvaged root's candidates join the same array before projection, so a path both it and the primary parse name folds to one entry; each is walked under the **unknown** base, because the fragment carries no record of the `cd` in force where it sat and resolving `cat ../secret` after `cd /outside` against the cwd would name a different file than the one that runs (#875). Constraint: both dedup loops keep the effect **out** of the dedup key and merge a repeat through `mergeTokenEffects` — keying on it would split `cat ~/a > ~/a` into two entries and show the path twice in the prompt, while the fold lands two disagreeing proofs on the bare family, which consults both directions anyway. The seeded `workdir` access carries `UNPROVEN_EFFECT`. A `redirect-destination` candidate skips both shape gates and the probe (`admittedByRole`), so a creating redirect's target reaches both surfaces whether or not it exists, then resolves against its base like any shape-qualified token. Both projections fall back to the shared `probeBareToken` for any other token the shape gates reject, admitting it only when `normalizer.entryExists` confirms it names a real entry and the effective base is known; `projectRuleCandidates` passes `this.normalizer.flavor` so a win32 backslash-relative token is recognized like its `/` form; `projectExternalPaths` decides outside-cwd from the `AccessPath`'s canonical boundary via `collectIfExternal`, treating a literal-only bash token as unconditionally external. Constraint: consults no ruleset — candidacy is a filesystem question and the decision belongs to the gates (ADR 0009). The subtlest region in the package
│       ├── redirect-analysis.ts         Reads a `file_redirect` node well enough to consult the operator table: `redirectEffectForDestination(redirect, destination)` (the effect proved for one destination, `null` for a descriptor duplication), `redirectMayWriteFile(redirect)`, and `redirectTargetIndex(redirect)` (the child index of the redirect's own target: the first named child after the operator), over one private operator lookup and one private descriptor-node set. Both ask `parseUnresolvedAt` first: a redirect the grammar could not resolve proves nothing (ADR 0013 §10's base case) and refuses the exemption outright. Constraints: the two answers carry different burdens of proof, and must not be collapsed — the token collector asks what to *attribute* to a destination, so it answers with a proof; the command enumerator asks whether it is safe to *remove* the wrapper floor, so it answers with a refusal, and a destination the parse cannot resolve (`> $OUT`, `> $(mktemp)`) counts against the exemption. Reusing the collector's literal-destination filter as a write gate is the fail-open pre-completion review caught in #803. The demotion applies to a proof and never to the `null`, or a descriptor duplication's bare number becomes a path candidate (#814)
│       ├── msys-bash-tokens.ts          Pure win32 bash-token shape classifier: `classifyWin32BashToken(token): BashTokenShape` (`device` | `drive-mount` with translated `windowsPath` | `posix-absolute` | `plain`); no filesystem, no `process.platform` read; the return type of `PathFlavor.bashTokenShape`, consumed by `PathNormalizer.forBashToken`/`interpretBashCdTarget`. The shapes follow MSYS's mount table (ADR 0003): `/dev/*` are runtime devices, `/c/…` is a deterministic drive mount, and every other POSIX absolute (`/tmp`, `/usr`, `/etc`, `/mingw64`) resolves inside the bash install root or a flavor-dependent mount, which is why it stays literal-only. `/dev/null` is the canonical device token on win32 because Pi core rewrites a Windows-style `> NUL` to `> /dev/null` before spawning the shell — MSYS does not recognize `NUL` and would create a literal, undeletable file
│       ├── token-classification.ts      Pure token classifiers: `classifyTokenAsPathCandidate` (strict: `/`, `~/`, a whole `..` segment, Windows drive-letter; a `..` inside a segment, as in a git revision range, is not a traversal), `classifyTokenAsRuleCandidate(token, flavor)` (broader: also dot-files, relative paths, the drive-letter backslash form, and — under the win32 flavor — a backslash-relative token such as `dir\file`, gated the same as `dir/file` since a backslash is a separator there, while on POSIX `\` is a legal filename character and the token stays bare; the decision is `PathFlavor.hasPathSeparator`, so the classifier never reads `process.platform`, #520; on POSIX a drive-shaped token such as `C:/foo` resolves as the real in-cwd path `./C:/foo` and stays gated by the `path` surface, since the `PathNormalizer`'s `isAbsolute` decides platform-correct routing), and `classifyBareTokenCandidate(token)` (prelude-only: returns any token whose shape does not rule out a path, for the resolver to probe). Constraint: policy-free — no classifier consults the ruleset (ADR 0009)
│       ├── sync-commands.ts             `parseBashCommandsSync(command): BashCommand[] | null` — warm-parser-backed synchronous command enumeration, salvaged regions included so the advisory answer is never weaker than the gate's; returns `null` in the pre-warm window so the advisory bash path falls back to whole-string matching
│       ├── program.ts                   Born-ready `BashProgram` value object: `parse(command, normalizer, options?)` eagerly resolves all three slices at construction, wrapping that work in `withSalvagedRoots` so a region the parse could not resolve contributes its commands and paths to every slice (#875); parameter-free getters `commands()`, `externalAccesses(): BashExternalPath[]`, `pathRuleCandidates()` — the latter two pairing each path with the effect the command stream proved for it. `commands()` splits the chain AND descends into command/process substitutions and subshells — wherever they appear, including a redirect destination and an interpolating heredoc body (#741) — tagging each nested command with its execution `context`, stripping any leading `variable_assignment` prefix, and flagging wrapper units with a `wrapperKind` so their decision floors to `ask` unless the unit also carries a `floorExemption`
│       ├── bash-arity.ts                Command arity table for bash pattern suggestions
│       └── async-cache.ts               `memoizeAsyncWithRetry` - memoizes an async factory but drops a rejected result so the next call retries; used by `access-intent/bash/parser.ts` for resilient tree-sitter parser init
├── path/                 Path-language domain: the win32-vs-POSIX decision resolved once, plus the co-rewritten path leaves
│   ├── path-flavor.ts             `PathFlavor` interface + `pathFlavorForPlatform` factory + `win32PathFlavor`/`posixPathFlavor` singletons — the platform's path *language* as one immutable collaborator (`impl`, `matchOptions`, `fold`, `comparable`, `isWithin`, `hasPathSeparator`, `lastSeparatorIndex`, `bashTokenShape`). Constraint: holds the package's only `=== "win32"` comparison, and the one separator alphabet both separator answers read; injected once from `index.ts` into `PermissionManager` / `PermissionSession` (→ `PathNormalizer`) / `SubagentDetection`. Constraint: an ESLint `no-restricted-syntax` guard scoped to `pi-permission-system/src` (exempting `index.ts`, the only reader) bans `process.platform` by text, so every path leaf takes an injected `PathFlavor`; the guard cannot see a `node:path` import, which is how `deriveApprovalPattern` kept reading the host's `dirname`/`sep` until #655 moved it onto `PathNormalizer.approvalPatternFor`
│   ├── canonicalize-path.ts       Best-effort symlink resolution via `realpathSync` — walks up to longest existing ancestor and re-appends non-existent tail; ENOENT/ENOTDIR safe, EACCES/ELOOP fall back to lexical form; takes an injected `PathFlavor`
│   ├── path-containment.ts        Pure path geometry over already-canonical operands: `isPathOutsideWorkingDirectory` (excludes safe system paths, then defers containment to `PathFlavor.isWithin`; no derivation, no filesystem)
│   ├── approval-pattern.ts        `deriveApprovalPattern` - the session-approval glob for an accessed path, scoped at the value's own last separator. Constraint: scopes on `PathFlavor.lastSeparatorIndex`, never the platform's default `sep` — the two differ for a Git Bash token on a win32 host, where `sep` widened a directory grant to its parent (#655)
│   ├── pi-infrastructure-read.ts  `isPiInfrastructureRead` - read-only-tool auto-allow within infra dirs / project-local `.pi/{npm,git}`; takes an already-canonical path + injected `PathFlavor`
│   ├── path-normalizer.ts         `PathNormalizer` class - the path-interpretation collaborator constructed once at the session edge with the injected `PathFlavor` (exposed as `readonly flavor`) and session `cwd` baked in; hands raw tokens, returns prepared values: `forPath`/`forLiteral` (build `AccessPath`s), `isAbsolute`/`resolveBase`/`joinBase` (flavor-aware `cd`-fold routing), `isWithinDirectory`/`isOutsideWorkingDirectory` (containment), `comparableValue` (lexical comparison for skill-prompt matching), `isInfrastructureRead`, `approvalPatternFor` (the session-approval glob for a built `AccessPath`, the sole home of that derivation), and `forBashToken`/`interpretBashCdTarget`/`isBoundaryOutsideWorkingDirectory` (Git Bash/MSYS bash-token interpretation — safe devices preserved, `/c/…` drive mounts translated, other POSIX absolutes literal-only). Also owns `entryExists` (lstat), the existence probe deciding whether a bare bash token names a real filesystem entry, kept here so path interpretation has a single filesystem edge alongside canonicalization (ADR 0009). A facade over the `path/` and `access-intent/path-normalization` primitives; holds no platform discriminator — every platform question delegates to `flavor`, so no consumer reads `process.platform` or threads `cwd`
│   ├── expand-home.ts             `expandHomePath`: `~` / `$HOME` / `${HOME}` expansion for patterns and path values, over one prefix table so the three spellings cannot drift; a prefix is recognized only standalone or before a separator, so `~username` / `$HOMEDIR` / `${HOME:-/tmp}` are left alone
│   ├── safe-system-paths.ts       `SAFE_SYSTEM_PATHS` (OS device files: `/dev/null`, `/dev/std{in,out,err}`) + `isSafeSystemPath`
│   └── node-modules-discovery.ts  Global node_modules resolution (walk-up + npm root -g fallback)
├── handlers/             Handler classes with narrow constructor injection
│   ├── index.ts                    Barrel re-exports
│   ├── lifecycle.ts                SessionLifecycleHandler (session: `PermissionSession` + resolver + serviceLifecycle + logger + audit + configIssues + dialogs); writes the decision-audit summary on `session_shutdown` and releases every still-pending ask there with `SESSION_ENDED_REASON`. Constraint: the release runs **before** `session.shutdown()`, which stops forwarding — a drain awaiting a forwarded ask can only write its response file once that ask is settled (#965). Constraint: `handleSessionStart` resets (and so activates) the session **before** refreshing config, because activation binds the context `PermissionSession.notify` delivers through; a refresh ahead of it has no UI to report into, which is how a config warning present at session start went unseen (#933)
│   ├── before-agent-start.ts       AgentPrepHandler (turnPrep + session + resolver + toolRegistry + logger); shouldExposeTool pure helper, which withholds a tool only when every value under its surface resolves to deny; recomputes the active set + system-prompt override every fire, applying the policy to the session's tool-surface baseline and recording each change to the effective surface as a `tool_surface.changed` debug entry
│   ├── session-turn-prep.ts        `SessionTurnPrep` (session + `warmParser: () => void` + readyAnnouncer + configIssues) behind the `TurnPreparation` seam — everything that must be true before the node answers a question this turn: the fire-and-forget tree-sitter warm-up, `session.activate`, the project-trust-gated `refreshConfig`, the config-issue report (so an issue the operator created mid-session is shown on the next turn, latched so an unchanged one is not, #933), then the once-per-session `permissions:ready` re-announcement (ADR 0012 decision 3)
│   ├── permission-gate-handler.ts  PermissionGateHandler (session + toolRegistry + pipeline + skillInputPipeline + runner); `handleToolCall` returns the internal total `GateOutcome`; validateRequestedTool + getEventInput + extractSkillNameFromInput pure helpers
│   ├── tool-call-boundary.ts       `createFailClosedToolCall(gate, reporter, audit, tracer)` - the only `pi.on("tool_call")` target and sole `GateOutcome` → SDK-shape translator; owns the `try/catch → block` (the SDK's `emitToolCall` does not catch a throwing handler), writes a `gate_error` review entry on throw with its own minted request id (the throw may come from anywhere in the pipeline, so no gate's id is available) and broadcasts the matching terminal `permissions:decision` under that same id, via a helper that swallows so the block stays unconditional, and emits a `debugLog`-gated `permission.decision` trace per call
│   └── gates/            Pure descriptor factories + runner
│       ├── types.ts                      GateOutcome, ToolCallContext
│       ├── descriptor.ts                 GateDescriptor (carrying the `PromptPayload` as its single presentation fact), GateBypass, GateResult types, plus `DecisionEventFacts` (a decision event minus the `requestId` only the runner can supply — the type that routes every emit through the runner's stamping site); also `preResolvedCheckOf` (the one expression of the `preCheck` → `preResolved` precedence, shared with `GateRunner`), `isUnconditionalDeny`, and the stable `orderDenyFirst` partition. Constraint: `promptDetails` omits both `requestId` and `payload`, which the runner stamps, so a gate cannot supply either twice. Constraint: `isUnconditionalDeny` excludes a session-sourced check, because the runner's session fast path allows it before the deny/ask/allow gate is reached (#899)
│       ├── runner.ts                     GateRunner class — constructed with `ScopedPermissionResolver`, `SessionApprovalRecorder`, `AskEscalator` (the single-method ask-escalation seam), `DecisionReporter`, plus a live `isYoloEnabled` reader (read per gate; the sole place a post-resolution ask is reconciled with yolo); `run(gate, agentName)` dispatches null / bypass / descriptor and mints the request id before the branch, so a request that never prompts is identified exactly as one that does; its private `emitDecision` is the sole site stamping that id onto a `DecisionEventFacts`
│       ├── tool-call-gate-pipeline.ts    `ToolCallGateInputs` interface (`getActiveSkillEntries`, `getInfrastructureReadDirs`, `getToolPreviewLimits`, `getPathNormalizer`, `getShellToolAliases`) + `ToolCallGatePipeline` class — constructed with `ScopedPermissionResolver` + `ToolCallGateInputs`; owns bash-command extraction + the single `BashProgram.parse`, `ToolPreviewFormatter` construction, the infra-dir list, the six gate producers, and the run loop; `evaluate(tcc, runner)` produces every gate before running any, runs an unconditionally denying one ahead of the rest, and returns the first block outcome or allow. Constraint: the deny-first pass is what keeps an earlier gate's `ask` from suspending the call ahead of a later gate's `deny`, and it is deliberately not extended to `ask` — two asking gates ask two different questions (#899). A pre-empted call records the denial alone — a gate whose answer had no consequence emits no `permissions:decision` event
│       ├── skill-input-gate-pipeline.ts  `SkillInputGateInputs` + `GateNotifier` interfaces + `SkillInputGatePipeline` class — owns the raw `checkPermission` pre-check, deny notify, `describeSkillInputGate` descriptor, and `runner.run`; `evaluate(skillName, agentName, notifier, runner)` makes the `input` path symmetric with the `tool_call` path
│       ├── helpers.ts                    deriveDecisionValue, buildDecisionEvent, resolveYoloGrant (the standing yolo grant covering a resolved check — a ruleset-rewritten allow or, under yolo, a residual ask)
│       ├── skill-read.ts                 describeSkillReadGate - pure descriptor factory
│       ├── skill-input.ts                describeSkillInputGate - pure descriptor factory; takes a pre-computed check result so the runner reuses the caller's check
│       ├── external-directory.ts         describeExternalDirectoryGate - pure descriptor/bypass factory; builds an `AccessPath`, delegates policy resolution to `resolveExternalDirectoryPolicy` on the narrowest `external_directory`-family surface the tool's identity proves (`capabilitySurfaceForTool`), uses `accessPath.boundaryValue()` for the outside-CWD boundary and infra-read checks, and discloses `accessPath.resolvedAlias()` when it names a location distinct from the typed path
│       ├── external-directory-policy.ts  Shared external-directory policy check for both gates: `resolveExternalDirectoryPolicy(path, resolver, surface, agentName)` emits an `access-path` `AccessIntent` on the caller's `external_directory`-family surface; `selectUncoveredExternalPaths(accesses, resolver, agentName)` routes each access through `capabilitySurfaceForEffect`, keeps the not-allowed entries with the surface and effect each resolved under, and selects the worst via `pickMostRestrictive`
│       ├── bash-external-directory.ts    describeBashExternalDirectoryGate - pure descriptor/bypass factory over the injected `BashProgram` (`externalAccesses()`); delegates the per-path routing, alias matching, and worst-uncovered selection to `selectUncoveredExternalPaths`, and stamps the deciding path's `effect`/`effectSource` on the log context. Records one session-approval grant per uncovered path at that path's own proven surface, so an ask mixing a proven read with a proven write grants each path only its own direction; two paths sharing a directory derive the same glob and so grant both directions there, which is what the prompt showed
│       ├── bash-path.ts                  describeBashPathGate - pure descriptor/bypass factory for bash path rules over the injected `BashProgram` (`pathRuleCandidates()`); routes each candidate through `capabilitySurfaceForEffect` on the `path` family, evaluates its `AccessPath` via an `access-path` `AccessIntent`, and selects the worst uncovered token via `pickMostRestrictive`, keeping the raw token for prompts/logs/approvals and `path.value()` for the approval pattern. The deciding token's surface is the one the descriptor, payload, access facts, decision, and session approval all carry, and its `effect`/`effectSource` ride the log context
│       ├── bash-path-extractor.ts        Thin facade (`extractExternalPathsFromBashCommand`) over `BashProgram`
│       ├── bash-command.ts               `resolveBashCommandCheck` - pure combiner over caller-supplied `BashCommand[]` units, checks each unit on the `bash` surface, tags the winning result with the offending command's execution `context`, selects via `pickMostRestrictive`; a trivially-empty command resolves whole, and when the **primary** parse matched nothing — no units at all, or only `salvaged` ones — the whole command is resolved first and an explicit `deny` covering it wins, with the `<unparseable-bash-command>` sentinel `ask` following only when there are no units to carry the verdict. Constraint: that branch keys on the primary parse, never on `commands.length === 0` — `> f <<'M' 2>&1 | rm -rf /tmp/x` yields zero primary units and one salvaged one, and keying on the combined list turned a `deny` on a context-naming rule into an `ask` (#875). `floorUnparsedUnit` is that clause's partial-failure half: a unit the enumerator marked `parseUnresolved` has its `allow` clamped to `<unparsed-bash-subtree>`, naming the **whole** command rather than the unit, because a partial parse can drop a command from enumeration entirely and `command` is also the session-approval pattern. Constraints: only an `allow` is floored, so a wrapper unit keeps its own more specific sentinel; and the result spreads the resolved check, so a `source: "session"` grant reaches `GateRunner`'s session fast path, which tests the source before the state (#840). `resolveWrapperUnit` decides a wrapper unit: the `WRAPPER_SENTINEL` floor, or — when the enumerator marked it exempt — the inner command's own `bash` rule, keeping `command` as the wrapper text so the prompt, decision value, and session-approval suggestion name what runs. Constraint: only a unit whose own text resolved to `allow` reaches it, which is what makes the exemption structurally unable to weaken an explicit `deny`/`ask` (#803)
│       ├── path.ts                       describePathGate - pure descriptor factory for cross-cutting path rules; builds an `AccessPath` and emits an `access-path` `AccessIntent` on the narrowest `path`-family surface the tool's identity proves (`capabilitySurfaceForTool`) so it matches the canonical (symlink-resolved) form like `external_directory`
│       └── tool.ts                       describeToolGate - pure descriptor factory for the per-tool gate; for path-bearing built-in tools the pipeline builds an `AccessPath` and emits an `access-path` intent on the tool-name surface so per-tool rules match lexical ∪ canonical, and the session-approval value derives from `accessPath.value()`; bash/MCP/extension tools keep the raw `tool` intent. Stamps a bash wrapper's `floorExemption` on the log context when one applies, the same routing the bash path gates give `effect`/`effectSource` — an exempt unit usually raises no prompt at all, so the fact is not a payload fact
├── authority/            Subagent detection, the Authorizer spine, and forwarded-permission escalation
│   ├── authorizer.ts                   `Authorizer` (non-terminal chain link, `authorize(details, query, log): Promise<AuthorizerVerdict>` - handed a session-scoped `PermissionQuery` and an `AuthorizerLog` review-log seam per ADR 0007 §3) + `TerminalAuthorizer` (terminal, `authorize(details): Promise<PermissionPromptDecision>` - cannot defer, enforced type-level) + `AuthorizerVerdict` (`allow | deny | defer`) + `SelectedAuthority` (`{ terminal, adjudicatesLocally, relayTarget? }`) + `AuthorizerSelectionDeps` (including the shared `dialogs` queue, which a terminal cannot own: a terminal is rebuilt on every activation, so a per-activation queue would serialize nothing) + `selectAuthorizer(ctx, deps): SelectedAuthority` - the per-activation local/relay/deny dispatch, returning the chain role that dispatch implies (`adjudicatesLocally: false` only for the relaying `ParentAuthorizer` arm, ADR 0007 §7). Constraint: a node with a UI relays only when a forwarding target resolves to another session **and** the private `resolveLiveRelayTarget` reads `serving.isServing(target) === true` - a human is present, so an unconfirmable target keeps the local dialog, the opposite burden of proof from `ParentAuthorizer.checkServingLiveness` (#909). It is re-evaluated on every activation, which is what returns a pane to its own dialog when its parent exits; `relayTarget` is the target that selection itself verified, absent on the headless arm where `ParentAuthorizer` resolves one per ask
│   ├── authorizer-chain.ts             `composeAuthorizerChain(links, terminal, query, log)` - folds non-terminal `NamedAuthorizer` links ahead of the context-selected terminal (`defer` → next link, `allow`/`deny` → decision stamped `decidedBy: {kind: "authorizer", name, verdict, reason}` at the point the loop breaks, so a link that deferred is not credited), injecting `query` and the review-log `log` into each link; zero links returns the terminal instance (identity)
│   ├── decision-source.ts              `DecisionSource` discriminated union (`user | authorizer | rule | session_approval | yolo | infrastructure_read | unavailable | gate_error | forwarded`) + depth-bounded tolerant guard `asDecisionSource` + `effectiveDecider` (unwraps a `forwarded` hop to the decider inside the responding session, so a reader asking *what* decided is not answered with *where*). Constraint: each variant is self-contained (it repeats its own surface/pattern/origin/name/reason) because the forwarded response file carries no such columns to lean on; the recursive `forwarded` variant is read off disk, so its guard is depth-bounded and rejects an over-deep chain whole rather than truncating it. Constraint: the record is stamped at the site that decides, never derived from the event name or the `resolution` value, and it is required on `PermissionPromptDecision` and `GateBypass` so a resolution path added later cannot omit it. It is not merged into `GateRunner`'s shared `logContext` — that context holds what every resolution of a gate shares, and the decider is by definition not shared — and because it is nested, both `writeLine` bounds reach it for free (pinned in `test/logging.test.ts`). The `permissions:decision` bus event does not carry it: the channel's consumers are unknown and it is the narrowest renderer under ADR 0011 §6
│   ├── decision-resolution.ts          `resolutionFor(decidedBy, outcome)` — the one place a `DecisionSource` becomes a `PermissionDecisionResolution`, shared by the gate runner and the serving node so the two records of one request cannot disagree. Constraint: exhaustive with no `default`, so a new decider variant is a compile error rather than a silent `user_approved`; `outcome` supplies only what the decider does not record (allowed, and whether the human scoped the grant to the session)
│   ├── authorizer-registry.ts          `AuthorizerRegistry` (+ `AuthorizerLookup`/`AuthorizerRegistrar` ISP interfaces) - name → link `authorize` map mirroring `ToolAccessExtractorRegistry`; one instance in `index.ts`, exposed cross-extension via `PermissionsService.registerAuthorizer`; throw-on-duplicate, identity-guarded disposer. `ObservedAuthorizerRegistrar` decorates the registrar side: a link registered on a relaying node is accepted (its chain never runs, ADR 0007 §7) and recorded as `authorizer_link_vacant` rather than refused
│   ├── delegation-envelope.ts          `encloseInDelegationEnvelope(authorize)` + `DELEGATION_EXCLUDED_SURFACES` - the bounded-delegation checkpoint (ADR 0007 §5): caps a link's `allow` on an excluded surface **family** (`external_directory`/`path` and their directional members, or an undetermined surface, fail-safe) to `defer`; deny/defer pass through. Constraint: membership is tested on `surfaceFamilyOf(surface)`, not the literal name, so a directional key cannot escape the envelope (ADR 0013 §4) while *which* families are excluded stays independently relaxable
│   ├── ask-dialog-queue.ts             `AskDialogQueue` + the `AskDialogAdmission`/`AskDialogRelease` ISP slices - the FIFO every human-facing ask this session presents runs through, so a forwarded ask and a local one cannot mount into the host's single inline dialog slot at once (#965). `run(present, released)` takes the caller's own released value at admission, because a decision is stamped at the site that decides; `releaseAll(reason)` settles every queued and in-flight ask and resets the tail. Constraints: a released ask is never presented when its turn arrives later, since the stale dialog is still answerable after a release and answering it advances the queue; the in-flight ask's own host promise stays pending and its late answer is discarded, which `Promise.withResolvers` delivers rather than a guard; and the queue is logger-free (the `transient-fs-retry.ts` precedent), a wait reading as the gap between `PermissionPrompter`'s bracketing entries. Its evidence is this node's own admissions, so a dialog another extension mounts is outside it - core declined to arbitrate globally (earendil-works/pi#7007)
│   ├── interactive-permission-choice.ts `PermissionRuleProposalData` (the grants a prompt proposes) and `PersistentPermissionChoice` - the private choice a presenter returns when the human asks for a durable write, kept off `PermissionPromptDecision` so neither the public `Authorizer` verdict nor the forwarded wire can construct one; `LocalUserAuthorizer` is the only adapter from it to a decision
│   ├── local-user-authorizer.ts        `LocalUserAuthorizer` class - `TerminalAuthorizer` for a session with UI and the single `permissions:ui_prompt` emit site: renders a forwarded ask's provenance as a non-degraded broadcast + `(Subagent)` title, then dispatches to the inline keybind dialog (TUI) or the `select`/`input` fallback. `buildRequestOptions` is the one place that decides which options an ask offers, composing four independent groups - the session label, the both-directions width, the forwarded scope, and (for a local ask with a persistence service) the durable targets - from the grants it already reads. A durable choice is written here through `PersistentApprovalService` and approved only after the write succeeded; a failed write denies with a bounded reason. Constraint: the emit and the presentation both sit inside the `AskDialogAdmission.run` region, because `permissions:ui_prompt` is documented as firing immediately before the user-facing UI is invoked - an emit at admission would alert a notification consumer for a dialog still minutes of deliberation away. `unansweredDecision(reason)` is the value a released ask settles as, mirroring `ParentAuthorizer`'s abandonment: `confirmationUnavailable` keeps it out of the user-denied family (#719) and one string serves both `denialReason` and `decidedBy.reason` (#726)
│   ├── permission-dialog.ts            Dialog option semantics + `requestPermissionDecisionFromUi` (`select`/`input` fallback, which also offers the edit and persist choices and the durable summary) + `PermissionPromptDecision` (whose `decidedBy` is required) and `UnattributedDecision` (the same minus it); the mode dispatch lives in `permission-prompt-component.ts`. `sessionGrantWidth` is orthogonal to `state` rather than a value of it, because the forwarded-response reader rejects an unrecognized `state` outright and merely drops an unrecognized field; absent means the proven direction, so a narrow grant serializes as it did before the width option existed
│   ├── permission-prompt-decision.ts   Pure decision model (`reducePrompt` + `PromptModelConfig`/`PromptViewState`) for the inline keybind dialog - hotkey arming (double-press), step transitions, per-grant pattern editing, the optional durable summary step, reason validation; no SDK/TUI imports. A session grant carries `sessionApproval` grants only when the human edited them, so an unedited grant serializes as before. `visibleActions(config)` is the single home for which options an ask offers - the width option appears iff the config carries a label for it - so the component renders the roster rather than declaring a second copy of it. A decision's identity (`PromptAction`) and the character that selects it (`PromptModelConfig.keys`) are separate values, which is what lets the character be configured
│   ├── permission-prompt-component.ts  Inline `ctx.ui.custom<UnattributedChoice>` keybind dialog (TUI) driven by the decision model + the `requestPermissionDecision` mode dispatcher (tui → inline, else fallback); the reason step delegates to the pi-tui `Input` line editor (rebuilt per visit, so a backed-out draft cannot be undone back into a later ask) and forwards Pi's `app.tools.expand` action in the decision/scope steps only, never during reason entry. Renders whichever option rows `visibleActions(config)` names rather than holding a roster of its own, reading each row's hotkey out of the resolved binding table, with `labelFor` supplying the two session rows' ask-derived labels. The pattern editor is a second pi-tui `Input`, rebuilt per grant and prefilled; `t` toggles the sticky save summary ahead of the decision table, and a confirm at the summary step counts only once the summary has been painted. Constraint: the dispatcher is the one place a human surface is chosen, so it is where the decision is attributed (`decidedBy: {kind: "user", via}`) - the dialog model and the fallback each naming themselves would be two sites that must agree with its branch
│   ├── bracketed-paste.ts              `collapsePastedNewlines(data)` - rewrites the content between a chunk's `\x1b[200~`/`\x1b[201~` markers so each newline run becomes one space, keeping a multi-line paste readable in the single-line reason field (the line editor deletes newlines outright, joining the words across a break); markers preserved, anything that is not a complete paste chunk returned unchanged
│   ├── denying-authorizer.ts           `DenyingAuthorizer` class - least-privilege `TerminalAuthorizer` for a session with no reachable authority; denies with the `confirmationUnavailable` marker so the ask path derives the `confirmation_unavailable` resolution, attributed `decidedBy: {kind: "unavailable"}`
│   ├── authorizer-selection.ts         `AuthorizerSelection` class - context-owning `AskEscalator` implementation (`escalate(details)`) and the `AdjudicationRole` seam (`adjudicatesLocally()`, read by the service lifecycle and the registration observer so neither re-derives the role from subagent detection); selects the authority once per activation, and per ask resolves the `authorizerChain` config to registered links (config order; unregistered names skipped fail-safe and handed to `AuthorizerChainAudit`; consulted names recorded as `authorizer_chain_resolved`; each wrapped in the delegation envelope), composes them via `composeAuthorizerChain`, and delegates via `PermissionPrompter`; a relaying node resolves none and records `authorizer_chain_delegated` instead (one chain per node, ADR 0007 §7), which is also what keeps a skipped-link report out of a node that was never going to run the link
│   ├── authorizer-chain-audit.ts       `AuthorizerChainAudit` class (`UnregisteredLinkAuditor`) + `unregisteredLinkMessage(name)` - reports a configured `authorizerChain` name this node's registry could not resolve: the per-ask `authorizer_chain_unregistered_link` review record for the auditor, and a warning latched once per configured name for the operator answering the ask the link did not. The message names the likeliest cause and admits the other two, since an exclusion, a load failure, and a provider declining for lack of its own config leave the identical absence. Reached only from a locally-adjudicating node's chain resolution (ADR 0007 §7)
│   ├── permission-prompter.ts          `PermissionPrompter` class (`PermissionPrompterApi`) - review-log bracketing (waiting → approved/denied) around `authorizer.authorize(details)`, recording the decision's `decidedBy` on the outcome entries only (the waiting entry has no decider yet); `PromptPermissionDetails` type (carries the child-fixed `accessIntent` facts a forwarded ask relays)
│   ├── subagent-detection.ts           SubagentDetection class - single owner of subagent detection (SubagentDetector.isSubagent); delegates to subagent-context
│   ├── subagent-context.ts             Pure subagent execution context detection (registry + env vars + filesystem)
│   ├── subagent-registry.ts            SubagentSessionRegistry class + getSubagentSessionRegistry() process-global accessor - in-process subagent session tracking
│   ├── serving-registry.ts             ServingSessionRegistry class + getServingSessionRegistry() process-global accessor, split into the `ServingAnnouncer` (poller) and `ServingLookup` (forwarding child) seams - which in-process sessions are draining a forwarded-permission inbox; `composeServingAnnouncers` fans one announcement across every channel a serving session publishes on
│   ├── forwarding-liveness.ts          The filesystem half of the same question, for a child that shares no memory with its parent: `ServingHeartbeatStore` (a `ServingAnnouncer` publishing `<forwardingDir>/serving/<id>.json` with the served session, its pid, and its refresh time; throttled, never throws, and sweeps records of dead processes once per session) + `HeartbeatReader` classifying a target as alive/absent/stale/dead_pid + `ForwardingLivenessJudge` (`TargetServingLookup`), which routes a liveness question to the channel that can answer it by the target's `self`/`registry`/`env` provenance. Constraint: the records live beside `sessions/`, never inside it, so liveness stays disjoint from the request/response cleanup ordering (#398)
│   ├── subagent-lifecycle-events.ts    subscribeSubagentLifecycle() - subscribes to @gotgenes/pi-subagents child lifecycle events and dispatches each fact to its owner: registers/unregisters child sessions in SubagentSessionRegistry on `session-created`/`disposed`, and hands a `bound` child to `ChildNodeAudit` (ADR 0002). Constraint: the `session-created` handler must stay synchronous, so the registry entry lands before `bindExtensions()` proceeds
│   ├── child-node-audit.ts             `ChildNodeAudit` (`BoundChildAuditor`) - reports an in-process child that bound its extensions without publishing a permission node of its own, so it gates nothing: a `child_node_absent` review entry per affected child, one visible warning per parent session. Constraint: the `bound` channel it reads is optional for a subagent implementation, so a child announced on neither channel is not audited (ADR 0012 decision 5 amendment). Constraint: the warn-once latch is per audit instance with no re-arm, because the factory is re-invoked per session generation — do not add one
│   ├── inherited-registrations.ts      `AncestorNodes` + `InheritingToolAccessExtractorLookup`/`InheritingToolInputFormatterLookup` - completes a node's fact-shaping lookups from its in-process ancestors, nearest first, so an excluded extractor provider cannot leave a child's tool path ungated; the local registry always wins and an inherited answer is tagged `inherited`. Constraint: fact-shaping registries only — no equivalent exists for the authorizer registry, because a link returns a verdict (ADR 0007 §7, ADR 0012 decision 1's fact-shaping clause); the `fact-shaping inheritance stops at live authority` test in `test/composition-root.test.ts` fails if one is ever wired in
│   ├── forwarder-context.ts            `ForwarderContext` read-interface + `getSessionId`/`getCwd` - shared by the escalation and serving roles
│   ├── permission-forwarding.ts        Cross-session forwarding wire types (`ForwardedPermissionRequest`, which carries the child's `PromptPayload` rather than a sentence assembled under the child's config; `ForwardedPermissionResponse`, whose optional `decidedBy` names what decided inside the responding session, distinct from the `responderSessionId` that names where; the `ForwardedAccessFacts`/`ForwardedAccessIntent` intent schema per ADR 0008) + `resolvePermissionForwardingTarget`, which returns the resolved session id together with its `self`/`registry`/`env` provenance (the routing key for which liveness channel may judge the target) + `encodeSessionIdForPath`, shared by both session-keyed layouts under the forwarding root
│   ├── approval-escalator.ts           `ParentAuthorizer` class - `TerminalAuthorizer` for a subagent session: escalates the ask up the tree via the request-write/poll machinery, completing the child-fixed facts into a `ForwardedAccessIntent` (stamps `requesterCwd`/`principal`), `ctx` bound at construction; adopts the requester's `requestId` as the forwarded request's `id` (falling back to a fresh mint when it could not safely name a file — at a relay hop that id came off disk); every abandonment path (unresolvable target, unusable directories, unwritable request, unserved target, unreadable response, timeout) denies with `confirmationUnavailable` plus a path-naming `denialReason` — reused verbatim as the `unavailable` decider's reason so the two cannot drift — and discards the request so a late answer cannot arrive; an answered request's decision is nested under a `forwarded` decider carrying the responder's own
│   ├── forwarded-request-server.ts     `ForwardedRequestServer` class (`InboxProcessor`) - serving-down role: `processInbox()` drains forwarded requests and resolves each like a local action - `ServingPolicy` (recorded authority) then `AskEscalator` on `ask`; `ServingPolicy.resolve(intent: ForwardedAccessIntent)` is intent-shaped (agent-scoped to `principal.agentName`, child-fixed `matchValues` used as-is, never re-derived through this session's `PathNormalizer`/cwd), floors to `ask` when `accessIntent` is absent (version skew); projects the request's access facts onto the escalated ask (`surface`/`matchValues`/`boundaryValue` only — `requesterCwd`/`principal` stay off the ask details, and the bounded-delegation checkpoint's exclusion reads the projected gate surface, #635); writes its decider onto the response (its own matched rule in full, the escalated decision's source, or a `gate_error` when the escalation itself threw) and carries a denying rule's own deny-with-reason text beside it, so the requesting session can tell its agent why rather than only that; the grant-scope translation rewrites the scope but never the decider; broadcasts the terminal `permissions:decision` for every ask it escalates, rendered from the same `PromptPermissionDetails` its `permissions:ui_prompt` was built from, so a prompt the requesting session's gate would answer on another bus is clearable on this one — a recorded-authority resolution stays silent on both channels; one-hop canary
│   ├── forwarding-io.ts                Forwarding filesystem helpers - request/response read-write (tolerant read of the optional `accessIntent` and `decidedBy` fields; an unusable decider is dropped without rejecting the decision it accompanies), location derivation, atomic JSON writes (owner-only; `rename` preserves the temp file's mode) and directory creation, both retried through `transient-fs-retry.ts` and recording a recovery as a debug-only `permission_forwarding.fs_retried` entry. Constraint: the readers rebuild an allowlist of known fields, so a wire field added without being listed here is silently dropped. Constraint: the retry wraps the `rename` alone - a fallback write onto the destination path would let a reader observe a partial record, and the temp write's failure shape is a write-denied directory no retry resolves (#914)
│   ├── transient-fs-retry.ts           `retryOnTransientFsError` - runs a filesystem operation again while an `EPERM`/`EBUSY`/`EACCES` lock rejects it (three attempts, ≤60 ms of blocking), reporting the attempts it took so the caller records the recovery and this module stays logger-free. Constraint: the errno set is the platform gate, since `src/` may not read `process.platform`; and unlike `graceful-fs`'s win32 rename patch it must not abandon the retry when the destination exists, because the heartbeat record and the response file are legitimate overwrites (#914)
│   └── forwarding-manager.ts           `ForwardingController` interface + `ForwardingManager` class - drives the forwarded-permission inbox polling lifecycle; tells `ForwardedRequestServer.processInbox`, and publishes the polled session id to the `ServingAnnouncer` plus a `forwarded_permission.serving_started`/`serving_stopped` review entry. Serving eligibility is `hasUI` alone - it consults no subagent detector, since a root may carry a parent-session marker it exports for its children to inherit (#907). Constraint: the per-tick re-announcement runs ahead of the processing guard, so a session whose human is deliberating at a forwarded dialog keeps announcing while `processInbox` is held open (pinned by the `re-announces while a drain is still in flight` test); it also re-resolves the live session id each tick and republishes on a change, because `processInbox` reads the live id and an announcement pinned to the id captured at `start` strands children on both sides of a mid-session change. The republish goes through `announceServing`, which withdraws the old record before marking the new one — marking the new id alone would leave two live heartbeats — and logs the `serving_stopped`/`serving_started` pair because a migration is rare and diagnosis-worthy; the unchanged case never reaches that path, which is what keeps the per-tick refresh silent
├── exposure/             Tool-exposure pass (`before_agent_start`): what the agent is shown before it starts. Exposure is not authorization — the `tool_call` gate re-evaluates every decision made here
│   ├── tool-registry.ts            ToolRegistry interface + tool name validation
│   ├── tool-surface-baseline.ts    `ToolSurfaceBaseline` class + `ToolSurfaceObservation` / `ToolSurfaceResolution` - the session's pre-filter tool surface, so each turn's exposed set is `baseline ∩ policy` rather than the previous turn's filtered output narrowed again. Rebuilt per turn from the tools still active plus the ones this extension's own filtering withheld, so a relaxed rule restores its tool while another party's deactivation sticks; the baseline only ever grows from tools observed **active**, never the registry, which is what keeps filtering restrict-only. The registry is consulted for withheld tools alone — an unregistered one is forgotten rather than left a restoration candidate, and an active tool is adopted whatever the registry reports. Constraint: `PermissionSession.reload()` must not reset it — a reload is when a relaxed policy arrives, and reseeding there strands the tool it just un-denied (#873)
│   ├── tool-surface-prompt.ts      Relocate the tool surface: remove the tool list and rules pi wrote and render this session's own at the end of the prompt, from `systemPromptOptions.toolSnippets`, each allowed tool's `promptGuidelines`, and the `systemPromptOptions.promptGuidelines` no registered tool contributes. `detectPromptLayout` picks one `PromptLayout` per prompt from the cwd layer pi wrote last (the later of a `Current working directory:` footer, through pi 0.85, and a `<cwd>` section, from 0.86): the header layout removes and renders `Available tools:` / `Guidelines:` sections, the section layout `<tools>` / `<rules>` sections. The prompt is split after that cwd layer: above it pi's surface is removed only when `piAuthoredPreamble` (no `systemPromptOptions.customPrompt`), and on the section layout only a `<tools>` / `<rules>` that closes before pi's `<docs>`, `<addendum>`, `<project_context>`, `<skills>`, or `<cwd>`; below it a relocated block in either shape is always removed, and a plain section never extends past its own body. Constraints: the block must land past every layer a subagent child inherits, and the relocation must run in every node — editing the sections in place, or relocating them in children alone, collapses the identity a child shares with its parent; and removal must not reach text pi did not write, since under a custom prompt pi writes no tool surface and every match is a user's or another extension's (ADR 0014)
│   └── skill-prompt-sanitizer.ts   Skill prompt filtering by policy
├── tool-input/           Tool-input domain: reading a tool's input and shaping it into a fact — the two serialization entry points, the formatters, and both fact-shaping registries
│   ├── tool-input-preview.ts              Pure tool-input text utilities (truncation, line counting, count formatting), serialization + default constants; `serializeToolInputPreview` (prompt, unredacted) and `serializeRedactedToolInputPreview` (log) are separate entry points because the input is flattened to a string before the writer sees its keys
│   ├── tool-input-prompt-formatters.ts    Pure per-tool prompt formatters (edit/write/read) + getPromptPath helper
│   ├── tool-preview-formatter.ts          ToolPreviewFormatter class - config-dependent prompt + log formatting; seam-first dispatch consults ToolInputFormatterLookup before built-in switch
│   ├── tool-input-formatter-registry.ts   ToolInputFormatter type, ToolInputFormatterLookup + ToolInputFormatterRegistrar interfaces, ToolInputFormatterRegistry class - persistent registry for custom previews
│   ├── tool-access-extractor-registry.ts  ToolAccessExtractor type, ToolAccessExtractorLookup (answers a resolution naming the registration's origin) + ToolAccessExtractorRegistrar interfaces, ToolAccessExtractorRegistry class - persistent registry letting extensions declare a tool's filesystem path for the path/external_directory gates
│   └── builtin-tool-input-formatters.ts   Built-in formatters registered at startup: formatMcpInputForPrompt keyed to "mcp"
├── presentation/         Prompt presentation: the payload a gate emits, and the renders over it (ADR 0011)
│   ├── prompt-payload.ts         `PromptPayload` (the `kind` discriminant, the `request` invariant core, the complete `evidence` list, the `annotations` slot) + `localRequester`/`findEvidence`/`allEvidence` + `asPromptPayload`, the all-or-nothing tolerant guard the forwarded wire's reader narrows through. Constraint: the payload is complete by contract — it never truncates and never decides what a human sees, so elision is a property of a render (ADR 0011 §2). The guard lives beside its type so a new request fact updates it next door rather than in a distant reader
│   ├── tool-ask-payload.ts       `buildToolAskPayload` — the bash, MCP, and generic-tool asks; carries the invoked tool name when a shell alias re-exposes bash (#574) and the wrapper's executed unit (#713)
│   ├── path-ask-payload.ts       `buildPathAskPayload`, `buildExternalDirectoryAskPayload`, `buildBashExternalDirectoryAskPayload` — each escaping path carries its canonical alias as that evidence entry's `detail`, so a bounded render cannot show a path while eliding what it resolves to. All three take the deciding `surface` from their gate (a directional member when a tool's identity, a redirect operator, or the pure-reader core proved a direction); the payload `kind` stays coarse so renderer dispatch is independent of the axis
│   ├── skill-ask-payload.ts      `buildSkillAskPayload`, `buildSkillPathAskPayload` — the skill is the decision-relevant value (it is what the policy names); a skill read carries the path it was reached through as evidence
│   ├── forwarded-ask-payload.ts  `buildForwardedAskPayload` — a two-branch projection, not a synthesizer: the child's own payload with only `requester` re-stamped to the request's authoritative provenance, or a degraded `kind: "forwarded"` render built from the display fields a payload-less request does carry. Constraint: the serving node is the only party that knows the ask arrived over the wire, so it re-stamps the requester and passes every other child fact through untouched
│   ├── dialog-renderer.ts        `renderPromptDialog(payload, budget, paint)` — the bounded render for the inline dialog and the `select`/`input` fallback: aligned one-fact-per-line layout, a per-field width cap, a row budget over the evidence, and whole-token highlighting of the flagged element. Also `RenderBudget`/`DEFAULT_RENDER_BUDGET`/`resolveRenderBudget` (the configured budget) and `completeViewBudget` (the complete view). Constraint: the row budget bounds evidence and the field cap bounds the core — a core fact is shortened, never dropped (ADR 0011 §3 over §5)
│   ├── line-fitting.ts           `fitLinesToWidth` — wrap-then-truncate to a terminal width, so each line is one visual row; shared by the `ctx.ui.custom` dialog, whose contract requires it, and by the renderer, which cannot count rows before wrapping
│   ├── fact-vocabulary.ts        `flaggedElements`/`flaggedElementLabel`/`valueLabel`/`describeBashCommandContext` — the render vocabulary shared by every renderer over a payload: which element an ask flags, what it is called, and how a nested execution context reads. Owned by no renderer, so the dialog, the agent text, and the review log cannot disagree about what an ask is flagging
│   ├── agent-renderer.ts         `EXTENSION_TAG` + `renderRefusal` (the single dispatch, exhaustive over `DecisionSource` with no `default`) over `renderPolicyDenial`/`renderUserDenial`/`renderUnavailableDenial`/`renderAuthorizerDenial`/`renderEscalatedPolicyDenial`/`renderGateErrorDenial` — the agent-facing render of a refused ask, chosen by what refused it. The dispatch reads the unwrapped decider *and* the outer `forwarded` frame, so a refusal decided one hop away says another session decided without naming which. `renderEscalatedPolicyDenial` names the deciding node's rule rather than the payload's `matchedPattern` (the rule that raised this session's own ask), which is why `identification` takes its rule clause as a parameter and `askRuleClause` names the local one. Constraint: it identifies the call and never reproduces it (ADR 0011 §7) — the bash command is never rendered, and the flagged path/target/skill is capped; the link name and the deciding rule's pattern are operator config rather than agent input, so they are not capped. Constraint: ADR 0011 §10 bounds what a forwarded refusal may disclose — a deciding rule's pattern, its deny reason, and an escalation's error text may cross; the responder session id and the rule's `origin` may not
│   ├── review-log-renderer.ts    `renderReviewLogFacts(payload)` — the request facts the review log persists (ADR 0011 §6), and no evidence or annotations. Constraint: exposure does not grow — evidence is the unbounded part `docs/decisions/0010-permission-log-secret-exposure.md` bounds
│   ├── pattern-suggest.ts        Per-surface approval pattern suggestions: `suggestSessionPattern` for a surface's own value vocabulary (bash command, MCP target, skill name), `suggestPathSessionPattern` for a pattern the caller's `PathNormalizer` already derived. Also the dialog's label vocabulary: `describeGrantTarget` names what an approval covers (one pattern, or a count), `buildDirectionalSessionLabels` labels the two direction widths, `buildForwardedScopeLabels` labels the forwarded scope step. Constraint: holds no path-language semantics — a path pattern arrives derived and is labelled verbatim. The forwarded scope label names the grants' shared *family*, never a directional member: it is built before the dialog runs, so a direction there could contradict a width chosen inside it
│   └── permission-prompts.ts     Agent-facing pre-check reasons (missing tool name, unknown tool) refused before any permission check runs
├── persistence/          Durable-approval domain: writing a human-approved `allow` rule into a config file. Depends on `config/` for paths and the schema and on `session/` for the grant shape; only `authority/local-user-authorizer.ts` (via the composition root) reaches it, so the relay and deny arms cannot write
│   ├── persistent-approval-service.ts  `PersistentApprovalService` (`PersistentApprovalApi`) + `PersistentApprovalTargetResolver` - resolves the two destinations (project-local only while trusted; global always, reloading without the cwd when the project is untrusted), re-resolves before the write, reloads policy through the injected `PermissionManager`, restores the file if reload throws, and writes the `permission_rule.persistence_*` review events
│   └── persistent-permission-writer.ts `PersistentPermissionWriter` - JSONC-preserving upsert of `permission.<surface>.<pattern> = "allow"` per grant (string surface expanded to `{"*": …}`, an existing pattern moved to last-match-wins position), validated against `unifiedConfigSchema` before touching the destination, with containment/symlink checks, an owner-only temp file, atomic rename, and a restore primitive
├── logging/              Logging domain: the JSONL writer plus everything bounding what it may write (name-based redaction, the review stream's width cap, owner-only modes) and the two per-session recorders that produce entries for it
│   ├── logging.ts               JSONL review/debug log writer; `prepareLogLine` names its transform stages (command masking → width cap → redacted serialization) and it creates both logs owner-only. Constraint: `writeLine` is the only place a line is produced, so every mask and bound lives there and no write path can escape one. Constraint: command masking runs ahead of the width cap and for both streams — capping first hands the masker a command the agent never ran, and the debug stream carries the same payload
│   ├── log-field-cap.ts         `capLogFieldWidths` + `resolveReviewLogFieldWidth` + `DEFAULT_REVIEW_LOG_FIELD_MAX_WIDTH` - the review log's `reviewLogFieldMaxWidth` bound. Constraint: narrows by length alone and never reads a value to decide what to shorten, which is what keeps it a cap rather than redaction. Every string the review stream writes is narrowed to `reviewLogFieldMaxWidth` (default 1000) and marked with a trailing ellipsis; the debug stream is deliberately unbounded
│   ├── log-redaction.ts         `isSensitiveName` + `redactedJsonStringify` - the sensitive-name predicate and its log-key binding form, applied at the log-write boundary. Constraint: structural, never value-shape; see `docs/decisions/0010-permission-log-secret-exposure.md`. Constraint: the predicate is a union with the pattern that predates it, so it may gain a name but never lose one
│   ├── command-redaction.ts     `redactCommandSecrets` + `maskCommandFields` - the same predicate asked about the names a bash command binds values to: a `variable_assignment` value, a `word`-shaped assignment (`env MY_KEY=…`), and an argument of the form `<sensitive-name>: <value>`. An inline-shell payload is one opaque token to the outer parse, so `collectSpansIn` re-parses it (via `inlineShellPayloadNode`) and merges the recovered spans, bounded at `MAX_PAYLOAD_DEPTH` nested layers (#923). `payloadSourceOf` decides how: a `word`, `string`, `raw_string`, or `ansi_c_string` payload is a `"slice"` — one contiguous verbatim run of the command, whose spans shift by a constant — while anything else (a `concatenation`, an expansion) is `"stitched"`, its program read by `resolveNodeText` and its whole argument masked when that program binds a secret, since an offset into a stitched program names no span of the command. Constraint: a stitched payload is masked coarsely on purpose — `bash -c 'TOKEN='"$SECRET"` loses the argument text rather than the secret, and treating it as a slice reads the wrong bytes and masks nothing at all. Constraint: every rule matches a parse node, never a substring of the command text — a raw-string scan's matches were measured as all false positives, embedded Python and `sed` patterns. Constraint: the re-parse set is the *shell* payload set and nothing wider — a heredoc body is declined, measured at 6 false positives and 0 true ones across 915 `<<'EOF'` bodies, because a body re-parsed as shell is where the anchored rule reads a secret out of embedded Python again; an interpreter payload is out for the same reason (ADR 0010's 2026-09-19 amendment). Constraint: the payload slice excludes the payload's quotes, so no recovered span can reach one and the masked payload stays quoted as written. Constraint: best-effort and never throws; a cold parser or a recovering parse yields what the walk resolved rather than blanking the field
│   ├── log-file-permissions.ts  Owner-only mode constants + best-effort `restrictExistingPathToOwner`; shared by the log writer, the logs-dir helper, and forwarding IO
│   ├── json-safe-stringify.ts   `createJsonSafeReplacer` (Error → plain object, bigint → string, cycles → `[Circular]`) + `safeJsonStringify`; separate from the writer because the prompt path serializes tool input too, and only the log path redacts
│   ├── session-logger.ts        `SessionLogger` interface + `PermissionSessionLogger` class; owns JSONL-writer composition, IO-failure warning dedup, and notify sink
│   ├── decision-reporter.ts     `DecisionBroadcaster` (emit only) + `DecisionReporter` (extends it with the review-log write) + `GateDecisionReporter` class - owns `SessionLogger` and event bus; a collaborator that only announces an outcome depends on the narrow half
│   └── decision-audit.ts        `DecisionRecorder` / `DecisionSummaryWriter` / `AuditLogger` interfaces + `DecisionAudit` class - per-session decision counters; `writeSummary` emits a `permission.session_summary` debug line on shutdown and warns on a `toolCalls != allowed + blocked + errors` invariant violation
└── service/              Cross-extension service surface: this node's outward face — the in-process `PermissionsService`, its publication lifecycle, the event channels, and the advisory bash check
    ├── permissions-service.ts   `LocalPermissionsService` class - in-process implementation of `PermissionsService`; injected with narrow collaborator interfaces (a `resolve` + `getToolPermission` + `isToolFullyDenied` resolver view, a `getPathNormalizer` session view, the formatter/access-extractor/authorizer registrars); routes path-surface queries through the resolver as an `access-path` intent so external policy queries match lexical ∪ canonical like the gates, and bash queries through `resolveBashAdvisoryCheck` for decomposed fidelity
    ├── service-lifecycle.ts     `ServiceLifecycle` + `ReadyAnnouncer` interfaces + `PermissionServiceLifecycle` class — owns this node's session-keyed service publication, both ready emits carrying the node's `sessionId`/`adjudicatesLocally` (one private `emitReady` recomputes the facts from the passed ctx, so `session_start` and the latch cannot drift), the once-per-activation latch guard (re-armed by `activate`, so a reload generation announces twice again), and session teardown ordering. Constraint: it reads the node's chain role live through the `AdjudicationRole` seam on each emit rather than caching what an earlier `permissions:ready` announced, because the role can change between activations of one session
    ├── permission-events.ts     Event channel constants, payload types, emit helpers. `PermissionsReadyEvent` carries the emitting node's `sessionId` (the key for `getPermissionsService`) and `adjudicatesLocally` — plain data, never a live capability: the bus announces, the locator provides. `permissions:ready` fires at least once per session and may repeat, so a handler must be idempotent. `PermissionUiPromptEvent` carries the payload's `request` core alongside the flat `surface`/`value` display projection — the gate surface and the display surface are two facts, not one (#292)
    ├── permission-ui-prompt.ts  Centralized construction for `permissions:ui_prompt` event payloads - `buildUiPrompt` is the single builder for direct and forwarded asks, keeping the emitted contract shape in one place. It projects the prompt payload's `request` core onto the event and nothing else: the bus is the narrowest renderer, so no evidence reaches it (ADR 0011 §6)
    └── bash-advisory-check.ts   `resolveBashAdvisoryCheck(command, agentName, resolver)` — routes an advisory `bash` query through the gate's shared `resolveBashCommandCheck` over `parseBashCommandsSync` units, falling back to a whole-string `tool` intent in the pre-warm window; kept out of `access-intent/` to avoid a domain→handler import
```

### Directory vocabulary

The tree above is a **rule**, not a description.
A new module goes to the directory named here when it is written — not when a later phase happens to rewrite it.

| Directory             | Holds                                                                       | Does not hold                                     |
| --------------------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| `config/`             | Reading, validating, holding, and reflecting configuration                  | Deciding anything from it                         |
| `policy/`             | The rule model and the composition that turns configuration into a decision | File I/O, or any gate                             |
| `session/`            | State scoped to one session's lifetime                                      | Anything a second session could share             |
| `access-intent/`      | Turning `(toolName, input)` into what is being accessed                     | Any verdict; it is policy-free (ADR 0009)         |
| `access-intent/bash/` | The bash decomposition and its lookup tables                                | Anything importing `handlers/`                    |
| `path/`               | The platform's path language and the derivations over it                    | A `process.platform` read (lint-guarded)          |
| `handlers/`           | The Pi event handlers and their narrow injection                            | Domain logic                                      |
| `handlers/gates/`     | The gate descriptors and the runner                                         | Anything a non-gate consumer needs                |
| `authority/`          | Subagent detection, the `Authorizer` spine, cross-session forwarding        | The deterministic layer's own decisions           |
| `exposure/`           | The `before_agent_start` pass deciding what the agent is shown              | Authorization — the `tool_call` gate re-decides   |
| `tool-input/`         | Reading a tool's input and shaping it into a fact                           | Deciding on that fact                             |
| `presentation/`       | The payload a gate emits and the renders over it (ADR 0011)                 | A decision, or a bound that inspects a value      |
| `logging/`            | The JSONL writer and every bound on what it may write                       | A second write path (`writeLine` is the only one) |
| `service/`            | This node's outward face: the service, its lifecycle, its channels          | A live capability on a bus payload                |

Five files stay at the root, and the list grows only by an explicit edit to this subsection:

- `index.ts` — the `pi.extensions` entry point.
- `service.ts` — the public API entry point, named by `package.json`'s sole `exports` entry and by the rollup declaration bundle.
- `types.ts`, `value-guards.ts`, `permission-request-id.ts` — package-wide leaves belonging to no domain, each read from directories that share nothing else.

The table is also encoded as fallow boundary **zones** (`boundaries` in the repo-root `.fallowrc.json`), one zone per directory plus a `pi-permission-system/core` zone for the five root files.
Each zone's `allow` list is the set of zones it imported when the zones were encoded, so the baseline reports zero violations and a **new** cross-zone edge is a finding (`boundary-violation`, severity `warn`, reported by `fallow dead-code` and `fallow audit` without failing either) and a `fallow decision-surface` `coupling-boundary` question in review.
Run `pnpm --silent fallow guard <file>` before adding a cross-directory import to see what the file's zone may import; when the new edge is intended, extend that zone's `allow` list in the same commit and say why in the commit body.
The zones are directory-scoped and coarse; the file-scoped ESLint `no-restricted-imports` rule on `permission-manager.ts` (the ADR 0002 string boundary) is finer and stays.

`policy/`'s "depends on `config/` for loading and on nothing above it" is encoded as `allowTypeOnly` for `authority`, `exposure`, and `session`: its five edges into them are all `import type` (`permission-gate.ts`, `permission-resolver.ts`), so a value import from any of the three is a violation while the type edges are not.
That check reads the `import type` **syntax**, not whether the imported symbol is a type: a plain `import { SomeType }` on one of those edges is reported.

Three allowed edges run against the table's own direction: `config/` imports `mergeFlatPermissions` from `policy/` (`config-loader.ts`), `path/` imports `wildcardMatch` from `policy/` (`pi-infrastructure-read.ts`), and `service/` imports `resolveBashCommandCheck` from `handlers/` (`bash-advisory-check.ts`).
The ratchet admits them because they predate it; each is a lead for a later discovery round, not a violation today.

This supersedes the earlier convention that a domain directory grows only in the phase that rewrites its files, and never by a bulk move.
That rule was recorded as a Phase 8 non-goal and re-applied through Phase 14, and it is the reason the layout lapsed: issue-by-issue work only ever moves the files issues happen to touch, so cold modules accumulate at the root indefinitely.
Writing the target layout down is what replaces it — a module's home is now answerable without re-deriving it, and the same-directory import convention is lint-enforced for this package so the two cannot drift silently ([#837]).

## Improvement roadmap — Phase 15: Token roles and declared effects

### Findings (planned 2026-09-05)

The declared candidate is [ADR-0013](../decisions/0013-permission-policy-model.md)'s Staging section, whose slices 4–7 Phase 14 assigned to this phase, and its unfiled remainder of slice 2 — the user-declaration half of §7, `commandEffects`, which Phase 14 split off so wrapper transparency could depend on the audited core alone.
That half is described as shipped in `docs/configuration.md` ("A user `commandEffects` declaration participates in effect classification") while no such key exists in `config-schema.ts`; the drift is corrected by [#880].

The cause is that **a bash token's role is established at collection and discarded before projection**.
The collectors know whether a token is a redirect destination, an inline script, a pattern, or an operand — that is how they attribute a `TokenEffect` — but `PathToken` carries only the effect, so `BashPathResolver` re-judges every token by shape and existence as if it were roleless.
Two open defects are that one loss seen from both sides.
A redirect destination arrives at `projectRuleCandidates` tagged `{ effect: "write", source: "syntax" }` and is dropped, because `newfile` is bare and does not exist yet ([#609]'s residual; ADR 0013 measured it as "collection is real; classification then drops the token").
An interpreter's inline script (`node -e "// comment…"`) is projected, because after quote removal the token starts with `/` ([#863]).
ADR 0013 §10 says effects attach per path token, and the collector already tags them there; threading the role the same way is the decide-once fix.
The symptom fallow sees is the `child.type === "command_name" || child.type === "variable_assignment"` disjunction spelled literally at three sites while `COMMAND_PREFIX_TYPES` exists for it — cited as a symptom, and paid down as [#609]'s tidy-first prep (reassigned to [#977] at [#609]'s planning, since none of the three sites is a function [#609] edits).

A second cause surfaced while measuring: **blame never reaches the entries a human decides**.
Each bash gate stamps `effect`/`effectSource` and the flagged paths on its `logContext`, and the runner spreads that context into the entries it writes — but on `ask` the gate writes nothing, and `PermissionPrompter` brackets the ask (`waiting`/`approved`/`denied`) from `PromptPermissionDetails`, a second projection that never sees the context.
The local review log has **zero** entries carrying an `effect` key, and every one of the 134 bash `external_directory` asks since [#807] shipped records `path: null` and no `externalPaths`.
ADR 0013 §7's "provenance is logged" and the package skill's claim that the stamped context makes a retraction readable both describe a path no ask takes; [#881] dissolves it by making the deciding path and its effect provenance **request facts**, which every writer renders.

Measured against the local review log (`scripts/measure-path-false-positives.mjs`, 2026-09-05): of 617 bash `external_directory` asks carrying paths, 28 (4.5%) flagged a token with a shape no path has, and the count is 12 → 6 → 4 → 6 by month with no revision-range ask at all (55 commands carry one, all under a known base).
The other ~95% flag real paths outside the tree, where the question is direction rather than candidacy.
`scripts/measure-core-coverage.mjs` (same date) says `external_directory_read: {"*": "allow"}` would relieve 98 of 388 recent bash asks today, and the remaining head words are led by `git` (92) and `sed` (24) — exactly the subcommand- and option-dependent readers §7's `commandEffects` was written for, though [#924] since claims the read-only share of the `sed` count for the core so that no declaration is needed for it — then wrappers and interpreters (`xargs` 61, `timeout` 30, `env` 22, `pnpm` 20, `bash` 19, `python3` 15), band C, whose only belief-free relief is §8's sandbox tier.

Corroboration (fallow, 2026-09-05): health 78 (B), dead code 0, duplication 1.3% — up from 0.1%, entirely the five `scripts/measure-*.mjs` instruments cloning one review-log-reading prelude (production `src/` still holds the same two small clone groups).
The hotspot list is led by `test/access-intent/bash/program.test.ts` (43 commits), `src/index.ts` (cooling), the two gate fixtures, and `token-collection.ts` / `command-enumeration.ts` (accelerating) — the files this phase's spine rewrites.
The repeated-discriminator sweep found one new family, the `COMMAND_PREFIX_TYPES` clone above; the rest are validation-edge `typeof` guards and per-node AST dispatch, idiomatic.

The craftsmanship scout **refuted all six** fallow large-function flags on test files (each a nested tree of behavior-named `it`s with `it.each` collapsing near-duplicates) and refuted the planner's first reading that the generic and pattern-first token walkers, or `readCommandWords` and `commandArgumentWords`, are one state machine spelled twice — their filters and outputs differ.
It found one concentrated test-design cluster: `test/handlers/gates/bash-path-extractor.test.ts` re-tests ~300 lines of `BashProgram` coverage through the facade (`/etc/[p]asswd`, the `for` word list, `$(cat /etc/hosts)`, redirect targets), so [#821] and [#839] each landed in two files.
That rides [#609] as a `test:` prep commit — [#609] would otherwise land in both files a third time.
[#609]'s planning found the facade has no production caller, so [#609] adds no case there; the cluster is [#978].
`collectPatternCommandTokens` (cognitive 45) is adjudicated a justified state machine, `runDescriptor` stays whole (Phase 14's call holds), and `src/index.ts` is unchanged since Phase 14's clearance.
The `scripts/` prelude duplication is scattered and rides whichever step next adds an instrument.

Directory check: skipped — `src/` holds five root files and every module this phase touches has a home in the directory vocabulary; [#924] and [#880] both land in `access-intent/bash/`, where effect classification already sits.

Trajectory: Phase 12's maximum step priority was 20, Phase 13's 20, Phase 14's 20; this phase's is 20 ([#880]).
No decline, so the regular improvement rotation continues.

The operator's clarification shaped the composition: the friction that matters is the **false positive** — a token that is not a path at all — not the ask about a real external file.
After [#863] and [#859] close the cases syntax or a known table decides, what remains is the shape-indistinguishable class ([#797]'s `/Sheet1/B1`, which no rule separates from `/etc/passwd`), and it has two complementary levers on opposite sides of `evaluate()`: a declaration that withdraws a *named* tool's operands ([#880]'s `effects: []`, the ask-producing side, zero tokens, permanent) and judgment that dismisses an ask for a token naming nothing on disk ([#882], the ask-consuming side, for the tool nobody declared).
That is ADR 0013 §7's own core-versus-chain layering applied to candidacy, and neither lever makes the other redundant.
[#882] exists because ADR 0007 §5 and ADR 0013 §7 contradict each other on this population — §7 says the judge absorbs the surplus, §5 excludes `external_directory` from a link's `allow`, so the judge can only defer it back to the human ([#859]'s reporter noticed; [#684] presses for a blanket opt-out this phase does not adopt).

Deferred by composition, with the reason each carries: [#804] (staging slice 7, structured bash rules) is the largest slice and depends on [#880]'s config shape as its precedent, so it waits for Phase 17 with that shape settled, Phase 16 having been given to the sandbox record ([#892]) whole; [#799] (channels) and [#780] compete with [#882] for one ADR budget, and [#882] won it because it is the one the false-positive population needs.

#### Open-issue sweep dispositions

- [#609] — adopted as a step (staging slice 4), carrying the phase's breaking change.
- [#863] and [#859] — adopted as steps (2nd consecutive sweep, scheduled).
  [#863] was closed `NOT_PLANNED` on 2026-09-07 against the sandbox-first re-sequencing and reopened on 2026-09-18 when that re-sequencing was revised; its committed plan stands as written.
  Both are shape decisions the classifier makes on tokens whose role the collector already knew, and each fix is fail-closed: a script string was never a path, and the [#645] existence probe still admits a real file named `a..b`.
- [#802] — **moved whole to Phase 16** (operator decision, 2026-09-18), where it joins [#892].
  It was adopted here as a step (staging slice 6, first two of its three parts), then scoped up by [#892] and finally moved out with it.
  Two reasons: the step publishes `PolicyScope` / `ScopeGrant` / `getPolicyScope` in `dist/public.d.ts`, and a public surface shipped before the record that decides the manifest shape is a surface the record may have to break; and its own recorded design question — how a rule pattern becomes a root, and what happens to a pattern naming no directory — is the manifest compiler's question, which should be answered once rather than twice.
- [#945] — filed by this session, split out of [#863]'s committed plan; adopted as the phase's first step, ahead of [#863].
  A command hosted in a consumed flag argument has its operands dropped, which ADR 0009 names a positional-invariance **guarantee** rather than a residual.
  Its planning session measured the same loss in three further argument positions and the operator widened the step to the class; the step above records what landed.
  It is a separate step rather than [#863]'s prep commit because the two failure directions are opposite — this one is an under-reach that drops a real operand, the unrecoverable direction, where [#863] is an over-reach that invents one — and it stands on its own merits under every future the roadmap is weighing.
- [#924] — adopted as a step, ahead of [#880].
  `sed` and `awk` are excluded from the pure-reader core outright, so `sed -n '1,80p' file` consults `external_directory_write` for a read — `sed` is 24 of the 388 recent asks this phase's findings already measure.
  It is the core side of the same boundary [#880] approaches from the declaration side, and it needs no configuration from the user to deliver relief, so it lands first and shrinks the population the declared layer must cover.
  Both edit `command-effects.ts`, so they sequence rather than parallelize.
- [#957] — filed by [#863]'s planning; adopted as a new step, after [#859] and ahead of [#609].
  A quoted `--flag='value'` on any pattern-first command bypasses the flag table, so `grep --regexp='/etc/passwd' f.txt` raises an `external_directory` ask for a file `grep` never opens.
  Measured population over 7937 corpus commands is 0 real invocations, so it makes no claim on the phase's relief budget; it is adopted anyway because it is the same over-surface family as [#863] and [#859], it lands in the same file and the same walker, and leaving it open would have [#609] rewire that walker's roles around a known gap.
  Adopted knowing ADR 0009 already declined the wider form of this fix: the step's substance is the amendment that admits the narrower one, not the ten lines of code.
- [#880] — filed for the `commandEffects` step; the unfiled remainder of staging slice 2 (ADR 0013 §7).
- [#881] — filed for the blame-threading step (staging slice 5), recast from a UX slice into a `fix:` by the measurement above.
- [#800] — **close as completed** with the config recipe: `external_directory_read: {"*": "allow"}` plus the pure-reader core delivers what it asks for `cat`/`ls`/`find`/`grep`, and [#880] covers the non-core readers it names (`strings`, `file`) by declaration.
- [#804] — deferred to **Phase 17** with recorded rationale (operator composition decision; 3rd consecutive sweep): it mirrors the `commandEffects` shape [#880] creates, and landing it in the same phase would have both steps deciding one shape.
  It was deferred to Phase 16 by the previous two sweeps; Phase 16 is now the sandbox record's alone, so the same rationale moves it one phase further rather than changing.
- [#822] — deferred to Phase 16 with recorded rationale (operator decision; 3rd consecutive sweep): a sandbox subsumes static glob expansion, so the mechanism waits for the seam that would replace it — which is now Phase 16's subject rather than a step of this phase.
- [#952] — filed by this session; deferred to **Phase 17**, beside [#804].
  An extension or MCP tool cannot declare its direction, so `effectProvenByTool` returns `unproven`, the gate names the bare `external_directory` family, and the write surface's catch-all vetoes a read a directional grant already allowed — measured on `read_session_file`, where all 5 schema-carrying prompts in the local review log record `matchedPattern: "*"` against `external_directory_write`.
  Its `toolEffects` key mirrors the config shape [#880] creates, which is the rationale [#804] and [#926] already carry: two steps deciding one config shape in one phase is the outcome to avoid.
- [#926] — deferred with recorded rationale (operator decision): transparent wrapper commands (`rtk ls` needing rules separately from `ls`) want a user-declared alias table, which mirrors the config shape [#880] creates.
  This is the same rationale [#804] carries, and it applies for the same reason: two steps deciding one config shape in one phase is the outcome to avoid.
- [#931] — out of scope for the roadmap.
  Automatic rejection when a prompt's delay is exceeded is prompt-lifecycle behavior in the presentation seam Phase 13 opened, not this phase's role loss; it also composes with [#799]'s channels, which this phase deferred.
- [#936] — out of scope for the roadmap.
  The Pi Session Inspector maintainer asks this package to confirm that `permissions:ready` / `permissions:ui_prompt` / `permissions:decision` remain a supported cross-extension contract; it wants an answer on the issue, not a step.
- [#906] — out of scope for the roadmap.
  A terminal attention signal (BEL/OSC) when a prompt opens is a presentation-layer addition sharing no step's mechanism; small and self-contained, so a cheap independent candidate for any phase.
- [#946] — filed by [#928]'s planning, which carries gap 1 alone; out of scope for the roadmap.
  Routing a registered MCP proxy tool name to the `mcp` surface edits `classifyToolKind` and adds a cross-extension registry, sharing no mechanism with this phase's bash token-role loss.
  PR [#930] is its reference implementation, and its registration API is a public surface to weigh on its own.
- [#620] — deferred with recorded rationale (explicit operator decision; **4th consecutive sweep**, not a silent re-defer).
  [#880] narrows its charter again — a declared `git log` needs no judge — and Phase 16's sandbox record answers band C without belief, so what remains for the chain is genuinely judgment; it is re-evaluated once both have landed.
  [#698] and [#706] fold into it when it is scheduled.
- [#751] — deferred with recorded rationale (explicit operator decision; 3rd consecutive sweep): still small, self-contained, and the last ADR 0011 §4 residual; a cheap independent candidate for any phase.
- [#519] — deferred with recorded rationale (explicit operator decision): externally blocked on Pi SDK `UIContext` evolution, with no in-repo lever.
- [#799] — deferred with recorded rationale (operator composition decision; 2nd consecutive sweep): the strongest non-code candidate, blocking PRs [#675], [#692], and [#638]; [#671]'s launcher env contract and [#720]'s `--yolo` flag are channels too and join its inventory.
- [#780] — deferred with recorded rationale (2nd consecutive sweep): the outbound-bridge ADR is what PR [#693] waits on; it joins [#799] in the next ADR budget.
- [#861], [#868], [#875] — deferred with recorded rationale (2nd consecutive sweep each): the same dispositions as Phase 14's, unchanged by this phase's cause — [#861] is the ADR 0007 §5 deliberation's neighbor, [#868] reopens `config-schema.ts` and may ride [#880]'s schema edit as a boy-scout tidy, and [#875] is an enumeration residual with no verdict-fold lever.
  [#861] and [#875] were then pulled forward by operator decision and shipped outside this phase, as [#899] was.
  The 2026-09-15 triage ranked [#861] 3 in Band 1, promoting it over this second deferral: an operator names a chain link, does not get it, and learns so only from the review log — measured at 48 silent skips across 13 days in one log.
  The deferral's reading held and was beside the point: the issue *is* the ADR 0007 §5 deliberation's neighbor, and it needed none of that deliberation, because the resolution was never in question and only its silence was.
  The deferral rested on a reading that did not hold: "no verdict-fold lever" was correct and irrelevant, because the lever is one layer up, in enumeration.
  The 2026-09-15 triage ranked it 2 in Band 1 after reading it end to end — a configured `deny` silently not firing on a script `bash -n` accepts is a bypass — and planning then measured the wider half the issue does not state: the dropped region's **path** operands reached neither `path` nor `external_directory` either, an ADR 0009 completeness-contract violation.
  The remedy is a fourth direction neither the issue nor ADR 0013's amendment listed, recorded in both records.
- [#874] — out of scope for the roadmap; PR [#757] moves the settings dialog off the overlay path and is its candidate close target.
- [#688] ↔ PR [#703], [#658] ↔ PR [#693], [#736] ↔ PR [#749], [#686] ↔ [#802] (now Phase 16) — each open PR is recorded against the issue it serves; none is merged, per the repo's reimplement-through-TDD practice.
- [#797] — adopted as [#880]'s named acceptance case (`commandEffects: { officecli: { effects: [] } }` produces no ask) and as the example population of [#882]; Phase 14's config-recipe answer (`external_directory: {"/Sheet1/*": "allow"}`) stands as the interim workaround.
- [#882] — filed for the ADR 0007 §5 deliberation step; PR [#684] is its close target either way.
- [#886] — filed by [#863]'s planning; deferred to a later phase.
  It is real roadmap work, but it is not this phase's cause: the phase is about a lost role producing false positives, and [#886] adds prompts in the opposite direction — 270 of 5918 corpus commands carry an interpreter inline script.
  [#880]'s `commandEffects` deliberately does not lift the wrapper floor (ADR 0013 §11) and Phase 16's sandbox record answers band C without belief, so both change its calculus before it is worth scheduling.
- [#892] — filed by [#863]'s planning; **deferred to Phase 16, which it opens** (operator decision, 2026-09-18), taking [#802] with it.
  It was briefly folded into [#802]'s step and moved ahead of every other step, on the reading that a sandbox demotes the projection to a hint and so every projection fix should wait for the record.
  That was revised for three reasons.
  The scope the fold produced — decision record, manifest compiler, `bash` tool override, a Linux seccomp-notify backend, a macOS backend, and a fallback prompt — is a phase's worth of work wearing a step's number.
  The blocking was wider than the finding supported: [#880], [#881], and [#882] are the decision layer, which the review itself called "the product", and no sandbox delivers `commandEffects`, blame on an ask, or the ADR 0007 §5 answer.
  And the two upstream reports the review filed are both still open, including [nono#1797](https://github.com/nolabs-ai/nono/issues/1797), where capability elevation never traps `O_CREAT` or `mkdir` — so the enforcement backend cannot yet see file creation.
  The review's measurements stand and are recorded in [#863]'s retro; what changed is the sequencing built on them.
- [#891] — filed by [#863]'s planning; deferred to Phase 16, behind [#892]'s record.
  Pi's built-in `powershell` tool (v0.84.3, recommended on Windows) reaches only the `tools:` surface today.
  The issue asks for a Codex-shaped static layer — a small literal subset lowered to argv, fail closed on the rest, and deliberately **no** path projection — which is a new shell surface rather than this phase's role-loss cause, and it is sequenced behind the sandbox re-planning Phase 16 opens.
- [#735] scenario 2 / [#722], [#762], [#860], [#856] — unchanged from Phase 14.
- [#890] — filed by the `pi-subagents` [#884] PR review; resolved outside this phase as `pi-subagents` Phase 22 Step 18, whose cross-package plan is [`docs/plans/0890-inherited-region-tool-surface-relocation.md`](https://github.com/gotgenes/pi-packages/blob/main/docs/plans/0890-inherited-region-tool-surface-relocation.md).
  `AgentPrepHandler`'s in-place rewrite of the child's `Available tools:` list landed inside the region `pi-subagents` keeps byte-identical with the parent's, collapsing the shared prefix for any child with a narrowed tool set.
  It is this package's `exposure/` pass, which no step in this phase opens — the spine is token roles and declared effects — so it stayed out of the phase; the tool surface is now relocated to the end of the prompt rather than edited in place ([ADR 0014](../decisions/0014-tool-surface-is-node-local-prose.md)).
- [#899] — filed by the `pi-subagents` [#889] implementation; deferred to a later phase, then pulled forward and shipped outside this phase.
  An `ask` on an earlier gate suspends the call before a later gate's unconditional `deny` is consulted, so an operator is prompted to approve a command policy already forbids and both answers end in denial — measured as a full 600 s subagent stall on a `bash` rule that resolved correctly when tested directly.
  The deferral rested on a coupling that did not hold: it predicted the fix would hoist resolution ahead of the prompt in `GateRunner.runDescriptor`, pairing it with the `runDescriptor` split this phase's `#### Deferred tidyings swept` list holds as deferred.
  Planning measured that every gate already carries its resolved state on the descriptor (`preCheck` on five, `preResolved` on the skill-read gate), so the fix is a deny-first ordering pass in `ToolCallGatePipeline.evaluate` and the runner is untouched; the `runDescriptor` split stays deferred.
  The cause remains the pipeline's run loop rather than this phase's role loss or its blame gap.
- [#907] — out of scope for the roadmap; PR [#911] is its close target.
  A root interactive session stops serving forwarded permission requests because `ForwardingManager` reads the root's own inherited `PI_SUBAGENT_PARENT_SESSION` marker as subagent evidence — an `authority/` forwarding-lifecycle defect, not this phase's role loss.
- [#909] — out of scope for the roadmap; a third-party request from the Pi Herdsman maintainer, landed as a breaking `feat!:`.
- [#962] — filed by the `pi-subagents` PR [#959] review; out of scope for the roadmap, on [#890]'s precedent. pi 0.86 replaced the `Current working directory:` footer and the `Available tools:` / `Guidelines:` headers with `<cwd>`, `<tools>`, and `<rules>` sections, so `renderToolSurface` finds none of its three anchors and appends the narrowed block below Pi's unfiltered list instead of replacing it.
  It is the same `exposure/` pass [#890] rewrote, which no step in this phase opens — the spine is token roles and declared effects — and the remedy is a prompt-shape question ([ADR 0014](../decisions/0014-tool-surface-is-node-local-prose.md)'s relocation under named sections), not a role-loss one.
  A subprocess child kept visible in its own pane adjudicated locally because `selectAuthorizer` tested `hasUI` before subagent detection — an `authority/` authority-selection dispatch, not this phase's role loss.
- [#914] — filed by [#907]'s planning; out of scope for the roadmap.
  A Windows atomic-rename failure in `forwarding-io.ts`'s shared write helper drops heartbeat and forwarded-file writes; it is platform robustness in the same layer as [#907], sharing no step's mechanism.
- [#915] — filed by [#899]'s planning; deferred to a later phase with rationale.
  Two gates that each resolve to `ask` on one tool call raise one prompt each — measured as two `escalate` calls for `cat /etc/hosts` under `external_directory: {"*": "ask"}` plus `bash: {"*": "ask"}`.
  Coalescing them needs an ADR 0011 §2 payload that composes several gates' evidence and a `SessionApproval` recording a grant per asking surface, which is the prompt-presentation seam Phase 13 opened rather than this phase's role loss.
  [#881] enriches the fields one ask carries; [#915] changes how many asks there are, so no step produces or consumes what it needs.
- [#923] — filed by [#920]'s planning; out of scope for the roadmap.
  A secret inside an inline-shell payload (`bash -c '…'`) or a heredoc body escapes the grammar-anchored command redaction [#920] adds, so one review-log record can hold the same secret masked under `executedUnit` and unmasked under `command`.
  It reads `classifyWrapperWords` and `EXECUTION_HOST_TYPES` but changes nothing about token roles or declared effects — it is a `logging/` exposure residual, and no step in this phase produces or consumes what it needs.
- [#925] — filed by [#920]'s implementation; out of scope for the roadmap.
  `composition-root.test.ts`'s forwarding-liveness test waits out the ~2 s serving grace window with real timers and flakes against Vitest's default 5 s budget when the root run puts every package in parallel; it was reproduced at the pre-implementation baseline, so it predates that work.
  Test-budget maintenance in an `authority/` integration test, which no step in this phase opens.
- [#933] — filed by [#927]'s implementation; out of scope for the roadmap.
  `index.ts` primes the store with `configStore.refresh(undefined, false)`, which records `lastConfigWarning` while `ctx?.ui.notify(…)` is a no-op, so the identical warning at `session_start` is deduped away — every issue `loadAndMergeConfigs` produces reaches the debug log and never the user.
  Its nearest neighbor is [#881], but that threads gate provenance into the ask payload where this is a store-level dedupe against a ctx that did not exist yet; it is a `config/` notification-lifecycle defect sharing no step's mechanism.
- [#941] — filed by the repo-level [#938] planning; out of scope for the roadmap.
  A heredoc absorbs the operand preceding it, so `git commit -F - <<'EOF'` enumerates as the unit `git commit -F` — an enumeration fact nothing asserts, which this repo's own project-scope permission config now depends on.
  It is a test-only regression pin over `command-enumeration.ts`'s output, not the role a collector attaches to a token, so no step in this phase produces or consumes what it needs; it is a boy-scout candidate for whichever step next edits `program.test.ts`.
- [#942] — filed by [#937]'s planning; out of scope for the roadmap.
  It applies the 18 `package-pi-permission-system` `offload` rows from the 2026-09-17 agent-doc audit — skill prose relocated into this architecture doc, ADRs, and `docs/subagent-integration.md` — and touches no `src/`, so it is doc restructuring beside the phase rather than roadmap work.
- [#951] — filed by [#923]'s planning; out of scope for the roadmap.
  `redirectMayWriteFile` proves a write for a `/dev/null` destination, so appending `2>/dev/null` to a read-only pipeline withholds [#803]'s `core-reader` exemption and floors the unit to `ask` — measured against every `<indirection-bash-wrapper>` prompt in the local review log since 2026-09-16, all of them proven core readers.
  The cause is a missing device row in `redirect-analysis.ts`'s effect proof, not the phase's role loss at projection; the two touch different modules and different seams.
  One interaction was carried forward from here: that [#609] would newly project `> /dev/null` onto `path_write`.
  [#609]'s planning measured that it already does, since `/dev/null` is absolute and passes the shape gate today, so [#609] changes nothing for it.
- [#953] — filed by [#933]'s planning; out of scope for the roadmap.
  A policy-file issue is warned only at `session_start`, unlatched, while policy is re-read from file mtimes on any turn — so a policy file broken mid-session is rejected fail-closed and the operator is told nothing.
  It is the sibling accumulation to [#933]'s, left out of that fix to keep it tight; the same `config/`–`handlers/` notification-lifecycle class, sharing no step's mechanism.
- [#955] — filed by this session; out of scope for the roadmap.
  `computeExtensionPaths` puts bare `agentDir` in `piInfrastructureDirs`, so `auth.json`, `mcp-oauth/`, and `trust.json` are auto-allowed reads, and the bypass returns from `describeExternalDirectoryGate` ahead of policy resolution, so an explicit `external_directory_read` `deny` on those paths never fires.
  The cause is the breadth of a `config/` path list and the ordering of a `handlers/gates/` short-circuit, not a token role lost at projection; no step in this phase produces or consumes what it needs.
  Small and self-contained, so a cheap independent candidate for any phase.
- [#956] — filed by this session; deferred to a later phase, behind [#955].
  The infrastructure read bypass gates on `READ_ONLY_PATH_BEARING_TOOLS`, a tool-name stand-in for "this access is a read" that predates the direction proof, so `read ~/.pi/agent/npm/…` is auto-allowed while `bash: ls` on the same directory prompts.
  It is real roadmap work — the fix consumes the `TokenEffect` this phase's spine is about — but it is a *consumer* of that proof rather than part of the role loss, which is the same posture [#952] carries.
  It is also blocked: widening the bypass to `bash` widens the `deny` override in [#955] to a surface that can compose a read into a pipeline.
  Distinct from [#800], which asked for read-only relief across *any* external directory and closed on the `external_directory_read` rule; this is the narrower case where the package has already declared the path needs no prompt and only one surface honors it.
- [#963] — filed by an operator session (2026-09-20); **becomes a new step in this phase, after [#924]** (operator decision).
  A wrapper that only changes *how* the same visible command runs (`time`, `timeout`, `nice`, `stdbuf`, `setsid`) is floored with the wrappers that change *what* runs, so `time pnpm run lint` asks where `pnpm run lint` resolves by its own rules — a deterministic false-positive ask in the phase's direction, though its mechanism is ADR 0013 §11's floor rather than a lost token role.
  It owns `wrapper-analysis.ts`, which no other step touches, and it sequences before [#880] so that step's "does not lift the floor" constraint is written against the amended §11.
- [#968] — filed by [#859]'s planning; deferred to a later phase, beside [#822].
  Bash brace expansion (`cat {..,y}/z` reads `../z`) is invisible to the projection, which resolves the literal token as one in-cwd segment; [#859]'s whole-segment rule removes the incidental unknown-base catch the substring test gave it.
  It is a missed operand, the opposite direction to this phase's false-positive cause, and it shares [#822]'s mechanism class of gating a token by what the shell expands it into.
- [#970] — filed by [#962]'s planning; out of scope for the roadmap.
  Raising the `pi-coding-agent` peer floor and devDependency pin past 0.86 is dependency upkeep that lets the footer-shaped prompt layout [#962] keeps be deleted; it is sequenced after [#962] and touches no token role or declared effect.
- [#973] — filed by the [#962] retrospective; out of scope for the roadmap.
  A test-running tool for TDD cycles is repo-wide tooling (`scope:repo`) that touches no token role or declared effect.
- [#976] — filed by [#957]'s PR review (PR #972); out of scope for the roadmap.
  It asks only for a clearer prompt reason on a parse-failure floor, which can land at any time; the parse failure involves no token role, and folding it into [#881] would make it wait on [#880].
- [#977] — filed by [#609]'s planning; **becomes a new step in this phase, directly after [#609]** (operator decision, 2026-09-24).
  `tree-sitter-bash` 0.25.1 parses every word after a redirect as another destination of it, so `git 2>/dev/null push --force` enumerates as the unit `git` and runs under a `git push *` deny, and `find ~/x 2>/dev/null -delete` proves `~/x` a read because the `-delete` guard never sees the flag — both measured through the real `resolveBashCommandCheck`.
  It is this phase's cause one layer down (the parse hands a command's argument the role of a redirect target), and [#609] lands the helper naming a redirect's real target, which this step reuses rather than re-derives.
  It also takes the `COMMAND_PREFIX_TYPES` tidy [#609] was assigned, since it edits `commandArgumentWords`, one of the three re-spelling sites.
- [#978] — filed by [#609]'s planning; **becomes a new step in this phase, after [#977]** (operator decision, 2026-09-24).
  The `bash-path-extractor.test.ts` dedup was [#609]'s assigned prep, but the facade it tests has no production caller, so [#609] adds no case there and the dedup prepared nothing; retiring or narrowing the facade keeps the test-design cluster this phase adopted.
- Feature issues [#691], [#687], [#680], [#654], [#648], [#604], [#603], [#472] — out of scope for a structural phase; [#680] is narrowed further by [#880] (a declared reader needs no floor override), and [#604] by [#813].

#### Deferred tidyings swept

`token-collection.ts`'s three near-identical prefix-skip loops and its hand-rolled child loop (recorded under [#839] and [#823]) were [#609]'s tidy-first prep and moved to [#977] at its planning; `runner.ts`'s `runDescriptor` split stays deferred on the scout's re-adjudication; the twin registries, `agent-renderer.test.ts`'s flat describes, and `service.test.ts`'s repeated `afterEach` stay scattered.

### Health metrics

| Metric                                                                        | Baseline (2026-09-05) | Phase 15 target |
| ----------------------------------------------------------------------------- | --------------------- | --------------- |
| Interpreter script-role commands in `token-collection.ts`                     | 0                     | ≥ 4             |
| Substring `..` tests in `token-classification.ts`                             | 2                     | 0               |
| Token-role vocabulary in `token-collection.ts` (`TokenRole`)                  | 0                     | ≥ 1             |
| Role-bypass site in `bash-path-resolver.ts` (`redirect-destination`)          | 0                     | ≥ 1             |
| Literal `COMMAND_PREFIX_TYPES` re-spellings in `access-intent/bash/`          | 3                     | 0               |
| `commandEffects` in `config-schema.ts`                                        | 0                     | ≥ 1             |
| Effect provenance in the ask payload (`effectSource`, `path-ask-payload.ts`)  | 0                     | ≥ 1             |
| Pure-reader core rows for `sed` / `awk` (`command-effects.ts`)                | 0                     | ≥ 2             |
| ADR 0007 amendments (`#### Amendment` headings)                               | 0                     | ≥ 1             |
| Non-path tokens flagged per month (`measure-path-false-positives.mjs`)        | 6 (2026-08)           | 0               |
| fallow health score                                                           | 78 (B)                | ≥ 78            |
| Production clone groups in `src/`                                             | 2                     | ≤ 2             |
| Dead exports                                                                  | 0                     | 0               |

Recompute commands (run from the repo root):

- Interpreter script-role commands: `grep -cE '"(node|bun|python|python3|perl|ruby)"' packages/pi-permission-system/src/access-intent/bash/token-collection.ts` (reads 6 as of 2026-09-20; `bun` is in the pattern because [#863] shipped it)
- Substring `..` tests: `grep -c 'includes("..")' packages/pi-permission-system/src/access-intent/bash/token-classification.ts`
- Token-role vocabulary: `grep -c 'TokenRole' packages/pi-permission-system/src/access-intent/bash/token-collection.ts`
- Role-bypass site: `grep -c 'redirect-destination' packages/pi-permission-system/src/access-intent/bash/bash-path-resolver.ts`
- `commandEffects` schema key: `grep -c 'commandEffects' packages/pi-permission-system/src/config/config-schema.ts`
- Effect provenance in the payload: `grep -c 'effectSource' packages/pi-permission-system/src/presentation/path-ask-payload.ts`
- Pure-reader core rows for `sed`/`awk`: `grep -cE '"(sed|awk)"' packages/pi-permission-system/src/access-intent/bash/command-effects.ts`
- ADR 0007 amendments: `grep -c '#### Amendment' packages/pi-permission-system/docs/decisions/0007-model-judge-authorizer-chain-adr.md` ([#882] records its answer as an amendment whether accepted or rejected, so the row reads ≥ 1 either way)
- Non-path tokens per month: `node packages/pi-permission-system/scripts/measure-path-false-positives.mjs` (read the latest month's `non-path` column; the log grows with use, so re-run rather than trusting the figure)
- Health / clone groups / dead exports: `pnpm fallow health --score --hotspots --targets --workspace @gotgenes/pi-permission-system` / `pnpm fallow dupes --workspace @gotgenes/pi-permission-system` (count the groups whose paths are under `src/`) / `pnpm fallow dead-code --workspace @gotgenes/pi-permission-system`
- Health vital signs as of the last phase close: `docs/fallow-snapshot.json`, written by `pnpm --silent fallow health --save-snapshot packages/pi-permission-system/docs/fallow-snapshot.json --workspace @gotgenes/pi-permission-system` and read by `fallow health --trend` for per-metric deltas

The prefix re-spelling count needs a pipeline, so it lives here rather than in the table:

```bash
grep -rn 'child.type === "command_name" || child.type === "variable_assignment"' packages/pi-permission-system/src/access-intent/bash | wc -l
```

Five rows grep for a name the phase has not created when it opens — `TokenRole`, `redirect-destination`, the `sed`/`awk` core rows, `commandEffects`, and `effectSource` in the payload module.
The step that creates each ([#609], [#609], [#924], [#880], [#881]) must either use the roadmap's name or update the metric row in the same commit, or the rename silently breaks the delivered-vs-predicted verification at phase close.
`commandEffects` is ADR 0013's own spelling (§7), so a rename there is an ADR amendment too.
The fallow health score is carried as a floor: it is blind to the type-level wins a cause-driven phase produces.

### Steps

#### ✅ [#945] A command hosted in a quoted argument keeps its operands

**Cause:** an argument node is read for its *text* and never searched for the executions it *hosts*, in both command walkers — so a double-quoted substitution loses the nested command's operands in every argument position.
Measured at planning time: `sed -e "$(cat /etc/shadow)" f.txt`, `grep "$(cat /etc/shadow)" f.txt`, `grep pat "$(cat /etc/shadow)"`, and `echo "$(cat /etc/shadow)"` all drop `/etc/shadow`.
The unquoted spellings work only because a bare `$(…)` parses as `command_substitution`, outside `ARG_NODE_TYPES`, and falls through to the ordinary recursion; quoting wraps it in a `string` both walkers claim and never descend.
The issue reported one of the four positions; the scope was widened to the class at the planning gate.
ADR 0009 calls positional invariance "a guarantee, not a residual", so this is inside the contract rather than a residual of it.

- **Smell:** Category C (two walkers omit a pairing `collectRedirectTokens` and `collectStatementOperandTokens` already perform).
- **Target:** `src/access-intent/bash/token-collection.ts` — one guarded `collectHostedExecutionTokens(child)` call per walker, each at the single point dominating every argument-node exit of its loop; `test/access-intent/bash/token-collection.test.ts` and `test/access-intent/bash/program.test.ts` for the unit and end-to-end surfaces.
- **Constraint:** the argument's own text keeps whatever role its walker already gave it — a spent pattern positional stays unprojected, a `script-file` value stays projected — so this adds the *nested command's* operands and removes nothing.
  The search reads executions, not text: a single-quoted argument runs nothing and contributes nothing.
- **Outcome:** all four positions project the nested command's operands, which keep their own command's effect attribution; the guarantee holds wherever ADR 0009 claims it.
- **Commit type:** `fix:`.
- **Impact 3 / Risk 1 / Priority 10.**
  Measured against 7653 corpus commands: 13 commands (0.17%) gain an `external_directory` candidate and 14 gain a `path` candidate, 0 lose one on either surface, and **0** gain a prompt shape they did not already have — every affected command already carried an `external_directory` candidate, so the gain is an evidence line on an ask that was already firing. 11 of the 15 gained strict tokens name real paths; 4 are git revision ranges, which is [#859]'s class.

  Landed: `fix(pi-permission-system): project the operands of a command hosted in a quoted argument` and its generic-command sibling, with a `tokensOf` test-helper tidy ahead of them and an `externalAccesses` pin behind them.

Release: independent

#### ✅ [#863] An interpreter's inline script is a script, not an operand

**Cause:** the same role loss from the other side — `node -e "…"`, `python -c "…"`, `perl -e`, `ruby -e` hand the collector a program text in a flag's argument slot, and with no role recorded the shape classifier reads its first character.
The `script` role already exists in `PATTERN_FIRST_COMMANDS` (that is how `sed -e` and `awk -f` are read since [#823]); these commands are simply absent from the table.

- **Smell:** Category C (a vocabulary that exists for this role is not consulted for these commands).
- **Target:** `src/access-intent/bash/token-collection.ts` — `PATTERN_FIRST_COMMANDS` entries for `node` and `bun` (`-e`/`--eval`, `-p`/`--print`, one config object each because they are separate parsers), `python`/`python3` (`-c`), `perl` (`-e`/`-E`), `ruby` (`-e`), each with zero pattern positionals so a script *file* operand (`node build.js /tmp/x`) stays an operand; the flag is listed as consuming only where it consumes in every implementation the name reaches, per [#823]'s rule.
- **Constraint:** the script's own contents are not projected — an interpreter payload is band C, exactly as `bash -c` is, and the token being dropped was the whole program text rather than any path inside it, so nothing the gates could act on is lost.
  This is recorded as an ADR 0009 accepted residual alongside the opaque-payload one it mirrors.
- **Outcome:** `node -e "// comment\nconsole.log(1)"` reaches the bash surface with no `external_directory` ask; measured over the review-log corpus, the interpreter command nodes contributing a non-path-shaped `path` candidate fall to the two recorded residuals.
  Not `measure-path-false-positives.mjs`'s monthly column, which counts asks that actually fired and so depends on the operator's policy: it has no 2026-09 row at all, having recorded zero bash `external_directory` asks that month.
- **Commit type:** `fix:`.
- **Impact 3 / Risk 1 / Priority 15.**

  Landed: `fix(pi-permission-system): stop projecting an interpreter's inline script as a path`, with the ADR 0009 amendment behind it.
  Measured over 7937 distinct bash commands from the local review log: interpreter command nodes contributing a non-path-shaped `path` candidate fall 219 — 18 and `external_directory` 20 — 3; 205 `path` and 17 `external_directory` accepted tokens lost, **0** gained, and no token naming a real file dropped.
  Two spellings deliberately remain and are pinned as such in `token-collection.test.ts`: a quoted `--eval='// x'` ([#957], adopted as the step below) and a clustered `perl -pe` script.

Release: independent

#### ✅ [#859] `..` is a path signal only as a whole segment

**Cause:** `classifyTokenAsPathCandidate` and `classifyTokenAsRuleCandidate` test `token.includes("..")`, a substring rule, so a git revision range (`HEAD..origin/main`, `a...b`) is a parent-traversal candidate, and under an unknown base ([#393]'s conservatism after `cd ~/x`) it is flagged external.

- **Smell:** Category C (an over-broad shape rule; the classifier is right that shape decides, and wrong about the shape).
- **Target:** `src/access-intent/bash/token-classification.ts` — `..` qualifies when the token is exactly `..`, starts with `../`, ends with `/..`, or contains `/../`; everything else falls through to `classifyBareTokenCandidate` and the [#645] existence probe, so a real file named `a..b` is still caught when it exists.
- **Outcome:** `cd ~/x && git log HEAD..origin/main` raises no `external_directory` ask; the two substring tests read 0.
- **Commit type:** `fix:`.
- **Impact 2 / Risk 1 / Priority 10.**

  Landed: `refactor(pi-permission-system): route both classifiers' .. test through one predicate` and `fix(pi-permission-system): stop reading a git revision range as a parent-directory path`, with the reporter's predicate adopted for both classifiers; the two substring tests read 0.
  Measured over 8375 distinct bash commands from the local review log against the pre- and post-fix commits: `external_directory` lost 28 tokens across 27 commands and `path` lost 93 across 86, **0** gained on either surface and no lost token carrying a whole `..` segment.
  Every lost token is a revision range, a bare `...`, or prose in a quoted argument; an ask disappears outright in only 2 commands, both false positives.
  Brace expansion (`{..,y}/z`) lost its incidental unknown-base catch and is tracked as [#968].

Release: independent

#### ✅ [#957] A quoted `--flag='value'` is still a flag

**Cause:** the flag branch of `collectPatternCommandTokens` is guarded on `child.type === "word"`, and quoting a long option's `=`-embedded value makes `tree-sitter-bash` emit a `concatenation` instead.
The argument never reaches `classifyPatternCommandFlag`, falls through to the positional path, and `embeddedOptionValueToken`'s blind `--opt=value` split — the [#645] fallback, correct precisely because it runs only for flags of *unknown* role — hands the consumed value back as a token.

- **Smell:** Category C (the role vocabulary exists and is consulted for one spelling of the same argument but not the other).
- **Target:** `src/access-intent/bash/token-collection.ts` — classify a `-`-leading argument of any node type, but act only on the recognized directives (`end-of-flags`, `consume-next`, `inline-value`) and let `regular-flag` fall through to today's positional handling.
  Dropping the type guard outright is the wrong fix: an unrecognized quoted `-`-leading argument would stop spending a pattern positional, so `sd '-old' '-new' file.txt` would join the already-broken unquoted spelling and drop `file.txt` — ADR 0009's unrecoverable direction.
  Also `docs/decisions/0009-bash-path-projection-completeness-contract.md` — the step **overturns a recorded declination**, so it amends rather than merely implements: § "What the projection deliberately omits" already names this mechanism (`rg -g'!docs'`) and declines "widening flag detection to quoted tokens" on exactly the `sd` objection above.
  That declination priced the naive widening; the narrow lever preserves `regular-flag` fall-through and so does not pay it, and [#863] is the evidence that the bullet's "over-surfaces, therefore recoverable" reasoning under-prices the cost.
- **Outcome:** `grep --regexp='/etc/passwd' f.txt` projects `f.txt` alone, matching what the unquoted spelling already does; `node --eval='// x'` projects nothing, closing the residual [#863] records, and the glued-quoted `rg -g'!docs'` and `awk -F':'` are read as their flags too.
  The Target's any-node-type lever did not survive measurement: it reads `sd '-old' '-new' file.txt` as `-n` with the value `ew` and drops `file.txt`.
  What landed (PR #972) acts on a recognized flag only in a `word` or a `concatenation` whose leading `-` is unquoted, and ADR 0009's residual bullet is narrowed to a token whose flag is quoted whole (`grep '-e' pattern f.txt`).
- **Commit type:** `fix:`.
- **Risk note:** the amendment is the step's real content; the code change is ten lines.
  Plan it as an ADR question first.
- **Impact 2 / Risk 2 / Priority 8.**

Release: independent

#### ✅ [#609] A redirect destination is projected by its role, not its shape

**Cause:** the collector proves a redirect destination names a file — that is what `redirectDestinationEffect` attributes a `syntax` write from — and then hands the projection a `PathToken` carrying only the effect, so `projectRuleCandidates` re-asks the shape classifier and the existence probe, both written for operands of unknown role, and a bare creating redirect (`> newfile`) is dropped.
ADR 0013 measured the drop and ADR 0009 lists redirect targets among the projection's guarantees, so this is inside the contract, not a residual.

- **Smell:** Category C (decided once at collection, re-decided at projection; the `COMMAND_PREFIX_TYPES` clone at three sites is the same fact fallow can see).
- **Target:** `src/access-intent/bash/token-collection.ts` — `PathToken` gains a `role` (`redirect-destination` | `operand`, and the `script` value [#863]'s table entries become if the plan folds them in), stamped where the effect is; `src/access-intent/bash/bash-path-resolver.ts` — `projectRuleCandidates` and `projectExternalPaths` admit a `redirect-destination` token without the shape gate or the existence probe, resolving it against the effective base like any operand (an unknown base still flags conservatively, per [#393]); `docs/decisions/0009-bash-path-projection-completeness-contract.md` — the wording ADR 0013 flagged.
  Tidy-first prep, reassigned at planning (operator decision, 2026-09-24): the `COMMAND_PREFIX_TYPES` re-spellings sit in functions this step does not edit and move to [#977], which edits `commandArgumentWords`; the `bash-path-extractor.test.ts` dedup rested on a facade no production code calls, so this step adds no case there and the question becomes [#978].
  The one prep this step keeps routes `token-collection.test.ts`'s effect assertions through a role-agnostic projection, so a required `role` changes only the assertions about it.
- **Constraint:** the role decides candidacy only; the direction still comes from the effect, and an unresolvable redirect ([#814]) still proves nothing and projects nothing.
  A descriptor duplication (`2>&1`) collects no token at all and is unaffected.
- **Breaking change:** a bare creating redirect newly reaches `path_write` and, under an unknown base, `external_directory_write`.
  An unconfigured install does not prompt on `echo hi > out.txt` in the working directory, because an unmatched `path` promotion stays unrestricted; it prompts only after a non-literal `cd`.
  The migration note must not recommend `path_write: {"*": "allow"}`: explicit directional entries append after the expanded sugar, so that line would out-rank a `path` deny on writes (measured: `.env` under `path: {"*.env": "deny"}` resolves `allow`).
- **Outcome:** `cat x > newfile` under `path_write: {"*": "ask"}` prompts; `PathToken` carries a role; only a redirect's first destination is admitted by role (the rest are [#977]).
- **Commit type:** `fix!:`.
- **Impact 4 / Risk 2 / Priority 16.**

  Landed: `test(pi-permission-system): assert collected token effects through a projection`, `refactor(pi-permission-system): name the child a redirect reads or writes`, `refactor(pi-permission-system): detect an argument whose value is computed at run time`, `refactor(pi-permission-system): record a redirect target's role on its collected token`, and `fix(pi-permission-system)!: check a redirect's target against path rules even when the file does not exist yet`.
  Re-measured over 8753 distinct bash commands from the local review log against the pre-change commit: `path` gained 90 tokens in 60 commands and `external_directory` 97 in 62, **0** lost on either surface, and every gained token a literal creating-redirect target (none flag-shaped, none computed).
  The input-redirect half of the role gained nothing on this corpus.

Release: independent

#### [#977] An argument after a redirect belongs to its command

**Cause:** `tree-sitter-bash` 0.25.1 declares a file redirect's target as `repeat1($._literal)`, so `cmd 2>/dev/null arg` parses `arg` as a second destination rather than an argument (upstream tree-sitter/tree-sitter-bash#233, closed while the default branch still carries `repeat1`).
Three consumers read the misparse: command enumeration drops the trailing words with the redirect, the effect proof's retraction guards never see them, and the path collector attributes them the redirect operator's effect.

- **Smell:** Category C (a token's role — argument, not destination — lost before any consumer reads it).
- **Target:** decided by the plan; the likely seam normalizes the redirected statement once so `command-enumeration.ts`, `command-effects.ts`'s guards via `token-collection.ts`, and `collectRedirectTokens` read one argument list, reusing [#609]'s redirect-target helper in `redirect-analysis.ts`.
  Tidy-first prep, reassigned from [#609]: export `COMMAND_PREFIX_TYPES` and replace its three literal re-spellings (`commandArgumentWords`, `collectEmbeddedOptionValues`, `cdLiteralTarget`), the first of which this step edits.
- **Constraint:** only the first destination is the redirect's target; `redirectMayWriteFile`'s refusal must stay fail-closed for whatever the plan cannot place.
- **Outcome:** `git 2>/dev/null push --force` is denied by `git push *`; `find ~/x 2>/dev/null -delete` retracts the read; `grep pat 2>/dev/null ~/x/f.txt` attributes `~/x/f.txt` grep's read.
- **Commit type:** `fix:`.

Release: independent

#### [#978] The bash-path facade nobody calls

**Cause:** `extractExternalPathsFromBashCommand` (`src/handlers/gates/bash-path-extractor.ts`) has no production caller (both bash path gates read `BashProgram` directly), so its 1300-line test file re-tests `BashProgram` through a seam nothing uses; that file is the concentrated test-design cluster the craftsmanship scout found.

- **Smell:** Category A (dead code kept alive by its own tests) over Category G (a test file at the wrong layer).
- **Target:** retire the facade and its test file after moving any case with no equivalent in `program.test.ts` or `token-collection.test.ts`, or keep it as a documented seam and narrow the test to the facade's own mapping; the plan decides.
- **Outcome:** no test file re-tests `BashProgram` through an unused facade; the `bash-path-extractor.ts` module-tree entry matches the decision.
- **Commit type:** `test:`/`refactor:` (no release).

Release: independent

#### [#924] `sed` and `awk` are read-only until an argument withdraws the claim

**Cause:** the pure-reader core excludes `sed` and `awk` outright — their program text and `-i` flag *can* write — so a plainly read-only `sed -n '1,80p' file` attributes its operand to both directional surfaces and takes the more restrictive answer.
It prompts under the very `external_directory_read: {"*": "allow"}` recipe [#800] recommends, where `cat` on the same file is silent.
`sed` is 24 of the 388 recent asks this phase measured, second only to `git`.

- **Smell:** Category C (a presumption-with-withdrawal pattern the core already implements for `find`, `fd`, and `sort` is not applied to the two commands whose exclusion costs the most).
- **Target:** `src/access-intent/bash/command-effects.ts` — `sed` and `awk` join the core as presumed readers whose claim a specific argument withdraws: `-i`/`--in-place` and a `w`/`W` command in the script for `sed`; `-i inplace` and a `print >` / `>>` / `|` redirect in the program text for `awk`; `docs/configuration.md` — the § pure-reader core table and the sentence documenting the exclusion.
- **Constraint:** fail closed on ambiguity, exactly as an unclassified command does today — a script read from `-f scriptfile`, a program text from a variable, or a `w` match the parser cannot place keeps consulting both surfaces.
  The bare-basename rule stands: `./sed` and `/bin/sed` prove nothing.
  `awk`'s program-text case is soundly harder than `sed`'s flag case, and the issue accepts a partial landing — `sed` alone, with `awk` restricted to its flag-based withdrawal — as real relief.
- **Outcome:** under `external_directory_read: {"*": "allow"}` with `_write` at `ask`, `sed -n '1,80p' ~/other/file` is silent while `sed -i 's/a/b/' ~/other/file` still prompts; the core table names `sed` and `awk`.
- **Commit type:** `fix:`.
- **Impact 4 / Risk 2 / Priority 16.**

Release: independent

#### [#963] An execution-modifier wrapper inherits the inner command's verdict

**Cause:** `INDIRECTION_WRAPPER_NAMES` conflates two classes [#490] floored uniformly — wrappers that change *what* runs, *as whom*, or *with which operands* (`sudo`, `doas`, `env`, `xargs`, `parallel`, `rush`, `rust-parallel`, `find -exec`, `fd -x`, `watch`) and wrappers that change only *how* the same visible command runs (`time`, `timeout`, `nice`, `stdbuf`, `setsid`).
The floor's reason — a wrapper hides the command that should be gated — is false for the second class whatever the inner command's effect: every operand is on the command line, and the wrapper adds no privilege, environment, or argument feed.
ADR 0013 §11 keys transparency on the *inner command* (a pure-reader-core head word), so `time pnpm run lint` asks under `<indirection-bash-wrapper>` while `pnpm run lint` resolves by its own rules; `resolveWrapperUnit` already computes the inherited verdict when `floorExemption` holds, so only the admission bar is missing.

- **Smell:** Category C (an exemption the gate already implements is admitted by one proof — argument-independence — when a second, per-wrapper proof would license it just as soundly).
- **Target:** `src/access-intent/bash/wrapper-analysis.ts` — the second class split out of `INDIRECTION_WRAPPER_NAMES`, and `isTransparentWrapper` admitting a unit whose outermost wrapper is in it whenever `unwrapIndirection` peels cleanly (no opaque payload, `layers ≥ 1`); `test/access-intent/bash/wrapper-analysis.test.ts` and the `bash-command.ts` gate tests; ADR 0013 §11 gains the wrapper-keyed clause; the `wrapper-analysis.ts` entry here and the `<indirection-bash-wrapper>` paragraph in `docs/configuration.md` follow.
- **Constraint:** package-audited per wrapper, never user-declared — the clause does not widen what [#880] keeps outside the floor.
  A nested first-class wrapper (`time sudo …`) stops the peel at `sudo`, which keeps its floor.
  `/usr/bin/time`'s `-o`/`--output`/`-a`/`--append` write a file, so their presence refuses the exemption; `nohup` (a tty-conditional `nohup.out`) and `flock` (creates its lock-file operand) stay floored.
  The `writesViaRedirect` refusal exists because §11's exemption *classifies* the unit as read; this clause inherits the inner verdict instead, and the plan verifies that redirect analysis on a wrapper unit is independent of the floor before dropping it for this class.
  The metamorphic pin (`time ${cmd}` never loosens the verdict) keeps holding, since the unit's verdict becomes exactly the unwrapped command's.
- **Outcome:** `time pnpm run lint >/tmp/lintout.txt 2>&1` resolves as `pnpm run lint` does, redirect gated by the path surfaces as for the unwrapped command; `time sudo rm -rf x` and `timeout 5 bash -c '…'` still floor.
- **Commit type:** `feat:`.
- **Impact 3 / Risk 2 / Priority 12.**

Release: independent

#### [#880] `commandEffects` — the user declares what their own tools do

**Cause:** ADR 0013 §7 gives the deterministic layer three effect sources and the package ships two; without the third, every subcommand- or option-dependent reader (`git log`, `sed -n`, `strings`) is unproven, consults both directional surfaces, and asks on `_write` for a read — the largest measured population left after the core (`git` 92 and `sed` 24 of 388 recent asks, the latter net of the read-only share [#924] moves into the core — what remains for a declaration is `sed -i` and the scripts the parser cannot classify).
The long tail has nowhere to live but the package's own frozen core, which is the pressure ADR 0009 refused.

- **Smell:** Category A (a declared design with no implementation, and a shipped doc describing it as present) over the Category C cause above.
- **Target:** `src/config/config-schema.ts` — top-level `commandEffects` per §7's shape (exact command basenames, `effects`, `unlessOption`, recursive `subcommands`; no patterns), with `.meta` descriptions and `pnpm run gen:schema`; `src/config/extension-config.ts` and `src/config/config-loader.ts` — carried through the runtime type and shallow-merged by command key across global and project scopes on the `shellTools` precedent, never agent frontmatter (§7, §9); `src/access-intent/bash/command-effects.ts` — `proveCommandEffect` consults declarations after syntax and core, with `unlessOption` stems matched fail-closed over attached, clustered, and `=`-embedded forms; `src/access-intent/effect.ts` — `EffectSource` gains a declared value carrying the scope; `BashProgram.parse` threads the declarations to the collectors; `docs/configuration.md` — the line describing it as shipped becomes true, with a `git`/`curl` recipe (`sed`'s read-only case having moved to the core in [#924]) and the `external_directory_read` adoption recipe beside it.
- **Constraint:** a declaration narrows uncertainty toward fewer effects and never lifts the wrapper floor (§11: `xargs sed -n` keeps its floor); undeclared is unknown; a guard retracts and never substitutes.
  The pipe-safety argument is the same as the core's: a wrong declaration is the user's own allow, at finer grain than the standing grants the record already accepts.
- **Design question the plan must settle:** whether subcommand descent is exact-word (§7) or routes through `bash-arity.ts`'s meaningful-prefix machinery so `git -C ~/other log` resolves as `git log`; §7 says exact, §10 says structural, and Phase 17's [#804] will need the same answer.
- **Acceptance case:** [#797] — `commandEffects: { officecli: { effects: [] } }` withdraws the tool's operands from the path surfaces, so `officecli set data.xlsx /Sheet1/B1` raises no `external_directory` ask while `bash: {"officecli *": …}` still governs the command; `[]` is the enforcement-relevant value §7 names beside `"read"`, and it is the ask-producing-side lever for the shape-indistinguishable class ([#882] is the ask-consuming one).
- **Outcome:** `git: { subcommands: { log: "read" } }` plus `external_directory_read: {"*": "allow"}` silences `git log ~/other`; the [#797] acceptance case passes; `scripts/measure-core-coverage.mjs` accepts a declarations file and reports the relieved share; the review log's `effectSource` can read `declared`.
- **Commit type:** `feat:`.
- **Impact 5 / Risk 2 / Priority 20.**

Release: batch "declared-effects"

#### [#881] Blame reaches the ask it explains

**Cause:** the gate's blame facts — the deciding path, its `effect`, its `effectSource` — live on the gate's `logContext`, which the runner spreads into the entries *it* writes, but on `ask` the gate writes nothing and `PermissionPrompter` brackets the request from `PromptPermissionDetails`, which carries the payload and not the context.
So the blame reaches the review log on every path except the one a human decides — zero `effect` keys in the local log, and every bash `external_directory` ask since [#807] recorded with `path: null` — and it reaches the dialog on no path at all, so the user asked about `git log ~/x` on `external_directory_write` cannot see that the effect was unproven or what would prove it.

- **Smell:** Category C (two projections of one request, one of which omits the facts the other was designed to carry).
- **Target:** `src/presentation/prompt-payload.ts` — the `request` core gains the deciding path with its effect and source as **request facts** (bounded: one path, two enums), so `renderReviewLogFacts` renders them for every writer and ADR 0011 §6's evidence exclusion is untouched; `src/presentation/path-ask-payload.ts` — the three path payload builders stamp them from the gate's `worstEntry`; `src/handlers/gates/bash-path.ts` and `bash-external-directory.ts` — the `logContext` copies go, since the payload now carries them; `src/presentation/dialog-renderer.ts` and `fact-vocabulary.ts` — a blame line (`~/b: write (redirect) → external_directory_write asks`; `unproven — declare git log in commandEffects to classify it`) in the bounded render; `asPromptPayload` and the forwarded reader's allowlist admit the new facts so a serving node renders the child's blame.
- **Constraint:** the fact set is the *deciding* path only; the full escaping-path list stays evidence and stays out of the log.
  The teaching sentence names `commandEffects`, so it lands after [#880].
- **Hard dependency:** [#880], whose `commandEffects` key the blame line names.
- **Outcome:** a bash `external_directory` ask's `waiting` entry names the path and its provenance; the dialog states why the direction was chosen; the package skill's claim about the stamped context becomes true; `effectSource` appears in the payload module.
- **Commit type:** `fix:`.
- **Impact 4 / Risk 2 / Priority 16.**

Release: batch "declared-effects"

#### [#882] May a link dismiss an `external_directory` ask for a token that names nothing on disk?

**Cause:** two decision records promise opposite things about the shape-indistinguishable false positive.
ADR 0013 §7 layers the projection over judgment ("the judge absorbs the surplus"); ADR 0007 §5 excludes the whole `external_directory` family from a link's `allow`, so on the one surface where the projection's false positives land, `model-judge` can only defer them to the human.
[#880] answers this for a tool the user has declared; the undeclared tool has no lever at all.

- **Smell:** Category F (two records, one population, contradictory boundaries) over Category C (a checkpoint that reads the surface but not the fact that would license the verdict).
- **Target:** `docs/decisions/0007-model-judge-authorizer-chain-adr.md` — an amendment, settled interactively in the pattern of ADR 0007 / 0011 / 0012, deciding the bound: nothing exists at the path, no ancestor exists short of the root, or the effect is proven `read` and the path is absent (the `_read` half of a nonexistent path is vacuous; the `_write` half is where `mkdir -p` / `install -D` / `git clone` create parents).
  If accepted, the same issue lands the narrow change: an existence fact fixed at the child on `ForwardedAccessFacts` and the payload request core (never re-derived at the serving node, ADR 0008), read by `encloseInDelegationEnvelope` beside the surface, and carried onto the `authorizer` decider's review entry so the licensing fact is auditable.
  If rejected, the amendment records why, PR [#684] closes with that reasoning, and the class stays on [#880] and the human.
- **Constraint:** this is not [#684]'s blanket flag — a link never gains `allow` over the outside-the-tree boundary for a path that exists; `path` stays excluded regardless.
- **Soft dependency:** [#881], whose request-core addition is the vehicle the existence fact rides.
- **Outcome:** ADR 0007 carries its first amendment; `officecli set data.xlsx /Sheet1/B1` with no declaration and `model-judge` in the chain either raises no prompt or the record says why it must.
- **Commit type:** `docs:` for the amendment; `feat:` if the checkpoint change lands under it.
- **Impact 4 / Risk 3 / Priority 12.**

Release: independent

### Step dependency diagram

```mermaid
flowchart TD
    S945["✅ #945<br/>Hosted commands keep their operands"] -.-> S863["✅ #863<br/>Inline scripts are scripts"]
    S863 -.-> S609["✅ #609<br/>Redirect destinations by role"]
    S859["✅ #859<br/>.. as a whole segment"] -.-> S957["✅ #957<br/>A quoted --flag=value is still a flag"]
    S957 -.-> S609
    S924["#924<br/>sed/awk presumed readers"] -.-> S963["#963<br/>Execution-modifier wrappers inherit the verdict"]
    S963 -.-> S880["#880<br/>commandEffects"]
    S880 --> S881["#881<br/>Blame reaches the ask"]
    S609 -.-> S881
    S609 -.-> S977["#977<br/>Arguments after a redirect"]
    S977 -.-> S978["#978<br/>The facade nobody calls"]
    S881 -.-> S882["#882<br/>May a link dismiss a nonexistent-path ask?"]
```

The section order under `### Steps` is the order they are meant to land, and the dashed edges here are sequencing preferences, not dependencies.
The diagram is laid out by dependency instead, so its shape and the working sequence answer different questions.
[#945], [#863], [#859], and [#957] are one-file fixes in `token-collection.ts` and `token-classification.ts`; landing them before [#609] keeps the role thread's diff about the role, and [#609]'s `TokenRole` then has a `script` value to absorb [#863]'s table entries into if the plan chooses.
[#924] and [#880] both edit `command-effects.ts`, so they sequence rather than parallelize — [#924] first, because core relief needs no configuration from the user and narrows the population a declaration has to cover.
[#963] sits between them: it owns `wrapper-analysis.ts` alone and amends ADR 0013 §11, which [#880]'s "does not lift the floor" constraint cites, so landing it first lets [#880] be written against the final clause.
[#881] stamps the deciding token's provenance onto the payload from the same `worstEntry` [#609] gives a role, so landing [#609] first means [#881] reads one shape rather than two.
[#881] hard-depends on [#880] only for its teaching sentence, which names the config key.
[#882]'s deliberation can start any time; only its code half, if any, waits on [#881]'s request-core vehicle.

### Parallel tracks

- **Track A — role-carrying projection:** [#945] → [#863] → [#859] → [#957] → [#609] → [#977] → [#978].
  [#977] also re-enters `command-enumeration.ts` and the argument words `command-effects.ts`'s guards read, which Track B's [#924] and [#880] edit — sequence it against whichever of them is in flight rather than concurrently.
  Owns `src/access-intent/bash/token-collection.ts`, `token-classification.ts`, `bash-path-resolver.ts`, and the bash-path tests.
- **Track B — proven and declared effects, and blame:** [#924] → [#963] → [#880] → [#881].
  [#924] owns `command-effects.ts` and the pure-reader core section of `docs/configuration.md`; [#963] owns `wrapper-analysis.ts` and ADR 0013 §11; [#880] owns `src/config/` and re-enters `command-effects.ts`; [#881] owns `src/presentation/` and the two bash path gates.
  [#881] touches `bash-path.ts` / `bash-external-directory.ts`; [#609]'s plan leaves both gates unchanged, but [#881]'s blame reads the candidate set [#609] widens, so sequence [#881] after [#609].
- **Track C — the judgment lane:** [#882], a deliberation first; its code half touches `authority/delegation-envelope.ts`, `authority/permission-forwarding.ts`, and the payload core [#881] owns, so it lands after [#881].

The sandbox seam that Phase 15 briefly carried as a fourth track is now Phase 16's subject in full ([#892], with [#802]).

### Release batches

- **Batch "declared-effects":** [#880], [#881] (ship together; tail = [#881]; release vehicle = [#880]'s `feat:` with [#881]'s `fix:` riding the same release).
  They ship together because [#881]'s blame line names the config key [#880] creates, and a prompt telling the user to declare an effect they cannot declare is worse than the prompt it replaces.
- Independently releasable: [#945] (`fix:`), [#863] (`fix:`), [#859] (`fix:`), [#957] (`fix:`), [#609] (`fix!:` — newly prompts on a bare creating redirect under an explicit `path`/`path_write` rule, or after a non-literal `cd`), [#977] (`fix:`), [#978] (no release), [#924] (`fix:`), [#882] (`feat:` if the checkpoint changes; a `docs:` amendment alone cuts no release).

## Refactoring history

The architecture above is the product of fourteen completed improvement phases.
Each phase's findings, step plan, dependency diagram, and health metrics are preserved in a per-phase history file under [`history/`](history/).

| Phase | Theme                                                | History                                                                                                                    |
| ----- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 1     | Preview formatter extension seam                     | [phase-1-preview-formatter-seam.md](history/phase-1-preview-formatter-seam.md)                                             |
| 2     | Complexity and duplication paydown                   | [phase-2-complexity-duplication.md](history/phase-2-complexity-duplication.md)                                             |
| 3     | State-owning collaborators                           | [phase-3-collaborator-encapsulation.md](history/phase-3-collaborator-encapsulation.md)                                     |
| 4     | Constructibility and god-object decomposition        | [phase-4-constructibility.md](history/phase-4-constructibility.md)                                                         |
| 5     | Tell-Don't-Ask and decoupling sweep                  | [phase-5-tell-dont-ask-sweep.md](history/phase-5-tell-dont-ask-sweep.md)                                                   |
| 6     | Access-intent extraction                             | [phase-6-access-intent-extraction.md](history/phase-6-access-intent-extraction.md)                                         |
| 7     | AccessPath as the universal path representation      | [phase-7-accesspath-universal-representation.md](history/phase-7-accesspath-universal-representation.md)                   |
| 8     | Tidy first for the authority spine                   | [phase-8-tidy-first-authority-spine.md](history/phase-8-tidy-first-authority-spine.md)                                     |
| 9     | The Authorizer spine                                 | [phase-9-authorizer-spine.md](history/phase-9-authorizer-spine.md)                                                         |
| 10    | Decide-once dispatch and bash-surface hardening      | [phase-10-decide-once-dispatch-bash-surface-hardening.md](history/phase-10-decide-once-dispatch-bash-surface-hardening.md) |
| 11    | Shell-tool aliasing and elicitation UX               | [phase-11-shell-tool-aliasing-elicitation-ux.md](history/phase-11-shell-tool-aliasing-elicitation-ux.md)                   |
| 12    | Cross-session access intent and the Authorizer chain | [phase-12-cross-session-intent-authorizer-chain.md](history/phase-12-cross-session-intent-authorizer-chain.md)             |
| 13    | The prompt-presentation seam                         | [phase-13-prompt-presentation-seam.md](history/phase-13-prompt-presentation-seam.md)                                       |
| 14    | The capability axis                                  | [phase-14-capability-axis.md](history/phase-14-capability-axis.md)                                                         |

[#261]: https://github.com/gotgenes/pi-packages/issues/261
[#267]: https://github.com/gotgenes/pi-packages/issues/267
[#296]: https://github.com/gotgenes/pi-packages/issues/296
[#298]: https://github.com/gotgenes/pi-packages/issues/298
[#302]: https://github.com/gotgenes/pi-packages/issues/302
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#393]: https://github.com/gotgenes/pi-packages/issues/393
[#418]: https://github.com/gotgenes/pi-packages/issues/418
[#529]: https://github.com/gotgenes/pi-packages/issues/529
[#530]: https://github.com/gotgenes/pi-packages/issues/530
[#531]: https://github.com/gotgenes/pi-packages/issues/531
[#476]: https://github.com/gotgenes/pi-packages/issues/476
[#478]: https://github.com/gotgenes/pi-packages/issues/478
[#502]: https://github.com/gotgenes/pi-packages/issues/502
[#509]: https://github.com/gotgenes/pi-packages/issues/509
[#555]: https://github.com/gotgenes/pi-packages/issues/555
[#710]: https://github.com/gotgenes/pi-packages/issues/710
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#815]: https://github.com/gotgenes/pi-packages/issues/815
[#837]: https://github.com/gotgenes/pi-packages/issues/837
[#385]: https://github.com/gotgenes/pi-packages/issues/385
[#873]: https://github.com/gotgenes/pi-packages/issues/873
[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#519]: https://github.com/gotgenes/pi-packages/issues/519
[#603]: https://github.com/gotgenes/pi-packages/issues/603
[#604]: https://github.com/gotgenes/pi-packages/issues/604
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#638]: https://github.com/gotgenes/pi-packages/issues/638
[#648]: https://github.com/gotgenes/pi-packages/issues/648
[#654]: https://github.com/gotgenes/pi-packages/issues/654
[#658]: https://github.com/gotgenes/pi-packages/issues/658
[#671]: https://github.com/gotgenes/pi-packages/issues/671
[#675]: https://github.com/gotgenes/pi-packages/issues/675
[#680]: https://github.com/gotgenes/pi-packages/issues/680
[#684]: https://github.com/gotgenes/pi-packages/issues/684
[#686]: https://github.com/gotgenes/pi-packages/issues/686
[#687]: https://github.com/gotgenes/pi-packages/issues/687
[#688]: https://github.com/gotgenes/pi-packages/issues/688
[#691]: https://github.com/gotgenes/pi-packages/issues/691
[#692]: https://github.com/gotgenes/pi-packages/issues/692
[#693]: https://github.com/gotgenes/pi-packages/issues/693
[#698]: https://github.com/gotgenes/pi-packages/issues/698
[#703]: https://github.com/gotgenes/pi-packages/issues/703
[#706]: https://github.com/gotgenes/pi-packages/issues/706
[#720]: https://github.com/gotgenes/pi-packages/issues/720
[#722]: https://github.com/gotgenes/pi-packages/issues/722
[#735]: https://github.com/gotgenes/pi-packages/issues/735
[#736]: https://github.com/gotgenes/pi-packages/issues/736
[#749]: https://github.com/gotgenes/pi-packages/issues/749
[#751]: https://github.com/gotgenes/pi-packages/issues/751
[#757]: https://github.com/gotgenes/pi-packages/issues/757
[#762]: https://github.com/gotgenes/pi-packages/issues/762
[#780]: https://github.com/gotgenes/pi-packages/issues/780
[#797]: https://github.com/gotgenes/pi-packages/issues/797
[#799]: https://github.com/gotgenes/pi-packages/issues/799
[#800]: https://github.com/gotgenes/pi-packages/issues/800
[#802]: https://github.com/gotgenes/pi-packages/issues/802
[#803]: https://github.com/gotgenes/pi-packages/issues/803
[#804]: https://github.com/gotgenes/pi-packages/issues/804
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#813]: https://github.com/gotgenes/pi-packages/issues/813
[#814]: https://github.com/gotgenes/pi-packages/issues/814
[#821]: https://github.com/gotgenes/pi-packages/issues/821
[#822]: https://github.com/gotgenes/pi-packages/issues/822
[#823]: https://github.com/gotgenes/pi-packages/issues/823
[#839]: https://github.com/gotgenes/pi-packages/issues/839
[#856]: https://github.com/gotgenes/pi-packages/issues/856
[#859]: https://github.com/gotgenes/pi-packages/issues/859
[#860]: https://github.com/gotgenes/pi-packages/issues/860
[#861]: https://github.com/gotgenes/pi-packages/issues/861
[#863]: https://github.com/gotgenes/pi-packages/issues/863
[#957]: https://github.com/gotgenes/pi-packages/issues/957
[#868]: https://github.com/gotgenes/pi-packages/issues/868
[#874]: https://github.com/gotgenes/pi-packages/issues/874
[#875]: https://github.com/gotgenes/pi-packages/issues/875
[#880]: https://github.com/gotgenes/pi-packages/issues/880
[#881]: https://github.com/gotgenes/pi-packages/issues/881
[#882]: https://github.com/gotgenes/pi-packages/issues/882
[#884]: https://github.com/gotgenes/pi-packages/pull/884
[#886]: https://github.com/gotgenes/pi-packages/issues/886
[#890]: https://github.com/gotgenes/pi-packages/issues/890
[#891]: https://github.com/gotgenes/pi-packages/issues/891
[#892]: https://github.com/gotgenes/pi-packages/issues/892
[#899]: https://github.com/gotgenes/pi-packages/issues/899
[#906]: https://github.com/gotgenes/pi-packages/issues/906
[#907]: https://github.com/gotgenes/pi-packages/issues/907
[#909]: https://github.com/gotgenes/pi-packages/issues/909
[#911]: https://github.com/gotgenes/pi-packages/pull/911
[#914]: https://github.com/gotgenes/pi-packages/issues/914
[#915]: https://github.com/gotgenes/pi-packages/issues/915
[#920]: https://github.com/gotgenes/pi-packages/issues/920
[#923]: https://github.com/gotgenes/pi-packages/issues/923
[#924]: https://github.com/gotgenes/pi-packages/issues/924
[#925]: https://github.com/gotgenes/pi-packages/issues/925
[#926]: https://github.com/gotgenes/pi-packages/issues/926
[#927]: https://github.com/gotgenes/pi-packages/issues/927
[#931]: https://github.com/gotgenes/pi-packages/issues/931
[#933]: https://github.com/gotgenes/pi-packages/issues/933
[#936]: https://github.com/gotgenes/pi-packages/issues/936
[#938]: https://github.com/gotgenes/pi-packages/issues/938
[#937]: https://github.com/gotgenes/pi-packages/issues/937
[#941]: https://github.com/gotgenes/pi-packages/issues/941
[#942]: https://github.com/gotgenes/pi-packages/issues/942
[#928]: https://github.com/gotgenes/pi-packages/issues/928
[#930]: https://github.com/gotgenes/pi-packages/pull/930
[#945]: https://github.com/gotgenes/pi-packages/issues/945
[#946]: https://github.com/gotgenes/pi-packages/issues/946
[#951]: https://github.com/gotgenes/pi-packages/issues/951
[#952]: https://github.com/gotgenes/pi-packages/issues/952
[#953]: https://github.com/gotgenes/pi-packages/issues/953
[#955]: https://github.com/gotgenes/pi-packages/issues/955
[#956]: https://github.com/gotgenes/pi-packages/issues/956
[#959]: https://github.com/gotgenes/pi-packages/pull/959
[#962]: https://github.com/gotgenes/pi-packages/issues/962
[#963]: https://github.com/gotgenes/pi-packages/issues/963
[#965]: https://github.com/gotgenes/pi-packages/issues/965
[#968]: https://github.com/gotgenes/pi-packages/issues/968
[#970]: https://github.com/gotgenes/pi-packages/issues/970
[#973]: https://github.com/gotgenes/pi-packages/issues/973
[#976]: https://github.com/gotgenes/pi-packages/issues/976
[#977]: https://github.com/gotgenes/pi-packages/issues/977
[#978]: https://github.com/gotgenes/pi-packages/issues/978
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
