# Glossary

The terms this package uses, each with the meaning it has here.
An entry defines a term; the record it links to decides how the thing behaves.
Terms are grouped by topic, and each heading is a stable anchor (`glossary.md#surface`) that other docs and agents may link to.

## Decisions

### Action

The outcome a rule assigns: `allow`, `ask`, or `deny`.
`allow` lets the call proceed, `deny` blocks it, and `ask` escalates it to live [authority](#authority).
A `deny` may carry a reason, which the agent is shown.

### Decision

The final `allow` or `deny` for one request, after any escalation.
The [review log](#review-log) records it with `decidedBy`, naming what decided: a rule, a session approval, [yolo](#yolo), the user, an [authorizer link](#link), or a forward.

### Verdict

What an [authorizer link](#link) returns for an `ask`: `allow`, `deny`, or [`defer`](#defer).
A [terminal](#terminal) returns only `allow` or `deny`.
See [ADR 0007](decisions/0007-model-judge-authorizer-chain-adr.md) decisions 1 and 2.

### Judgment

A decision made by live authority (the human, or a model behind an [authorizer link](#link)) on an `ask`, as opposed to the deterministic resolution of recorded authority.
Judgment may be non-deterministic; the package's determinism guarantee covers recorded authority only.
The layering rule is "surface deterministically, discriminate with judgment" ([ADR 0009](decisions/0009-bash-path-projection-completeness-contract.md)).

## Policy

### Rule

One `(surface, pattern) → action` entry, carrying its [origin](#origin).
Every policy source, config file or session approval, is normalized to rules before a check consults them.
See [Core data model](architecture/architecture.md#core-data-model).

### Pattern

The match side of a rule: a command glob, tool name, file path, MCP target, skill name, or `*`.
`*` matches any run of characters, including `/`, and `?` matches one character; `**` is not a separate globstar and behaves exactly like `*`.

### Surface

The key a rule is filed under, naming the kind of access it governs.
Surfaces are tool names (`read`, `write`, `edit`, `bash`, …), `mcp`, `skill`, and the directional path surfaces (`path_read`, `path_write`, `external_directory_read`, `external_directory_write`).
One tool call can be checked on several surfaces; see [gate](#gate).
The `*` key, `permission["*"]`, is the universal fallback for any surface without a matching rule.

### Surface family

`path` and `external_directory` each name a family of two directional surfaces, `_read` and `_write`.
The two directions are independent: a `path_write` allow grants no read, and a `path_read` deny blocks no write.
See [ADR 0013](decisions/0013-permission-policy-model.md) decisions 3 and 4.

### Sugar

A bare `path` or `external_directory` key in config.
It is expanded at load time, separately for each [scope](#scope) and before scopes are merged, into both directional surfaces of its family; explicit directional entries are placed after the expanded ones.

### Path

The `path` family governs a file path wherever it is, matched against both its typed spelling and its symlink-resolved one.
Its idiomatic use is carving denials such as `~/.ssh/*`; granting access outside the working directory is the job of [external directory](#external-directory).

### External directory

The `external_directory` family fires on a path's relation to the session's working directory (being outside it), not on how the path is spelled.
It answers "is this in scope at all", while `path` answers "is this particular access permitted", and a call must pass both.
Granting an outside root takes one line: `external_directory_read: { "~/dev/*": "allow" }`.
See [ADR 0013](decisions/0013-permission-policy-model.md) decision 5.

### Effect

What an access does to a file: `read` or `write`.
A bash path operand's effect is proven by syntax (a redirect), by the built-in set of pure-reader commands, or by the user's `commandEffects` declarations; an operand whose effect is unproven consults both directions.
`commandEffects` classifies commands; it is not a rule and grants nothing by itself.
See [ADR 0013](decisions/0013-permission-policy-model.md) decisions 2 and 7.

### Ruleset

The composed, ordered list of rules a check consults, built in layers: the synthesized default, then the MCP baseline, then config rules, then session rules.
Evaluation is [last-match-wins](#last-match-wins), so a later layer overrides an earlier one.
See [Composed ruleset](architecture/architecture.md#composed-ruleset).

### Origin

Which source contributed a rule (`RuleOrigin`): `global`, `project`, `agent`, `project-agent`, `builtin`, `baseline`, `session`, `yolo`, or `fail-closed`.
It is reported on the `permissions:decision` event and in the review log, so a surprising outcome traces to its source.

### Scope

A config source with a fixed precedence position: `global` (the global config file), `project` (the project config file), `agent` (global agent frontmatter), and `project-agent` (project agent frontmatter), in that order.
A later scope overrides an earlier one on an identical pattern, and a pattern only the later scope defines is placed after the earlier scope's.
A pattern both define keeps the earlier scope's position, so a later catch-all does not override an earlier scope's specific patterns ([ADR 0016](decisions/0016-policy-channels.md) measurement 4, changing in [#1108]).
The two project scopes load only for a trusted project; see [project trust](#project-trust).

### Channel

Any path by which something that changes a check's outcome reaches the package: a scope's file, agent frontmatter, the session layer, or a runtime knob such as `yoloMode`.
Which channels are admissible, and at what precedence, is decided in [ADR 0016](decisions/0016-policy-channels.md).
The authority model's "three channels" for reaching live authority, and its statement that yolo "is not a channel", use the word in that narrower sense.

### Relax and tighten

A change relaxes policy when it can move an outcome toward `allow` (`deny` or `ask` to `allow`), and tightens it when it moves the other way.

### Last-match-wins

Within one surface, the last matching rule in the [ruleset](#ruleset) decides, so a later layer overrides an earlier one; for scopes, see [scope](#scope).

### Most-restrictive-wins

Across the surfaces one tool call is checked on, the most restrictive outcome wins (`deny` over `ask` over `allow`), so an allow on one surface cannot loosen another.

### Session rule

A rule created when the human answers "for this session" at a prompt, also called a session approval.
It is held in memory, appended after every config rule (the session layer), and cleared when the session ends.
For bash, the suggested pattern comes from the arity table (`git checkout main` suggests `git checkout *`).
See [docs/session-approvals.md](session-approvals.md).

### Yolo

The `yoloMode` runtime knob.
When on, every `ask` becomes `allow` and every `deny` is preserved; the decision's origin is `yolo`.
A rule's `ask` is rewritten when the ruleset is composed, and an `ask` a gate synthesizes after resolution (the bash wrapper floor, an unparseable command) is granted at the gate.
Under yolo an `ask` never reaches live authority, so no [authorizer link](#link) or human is consulted.
See [yolo is recorded authority](architecture/architecture.md#yolo-is-recorded-authority).

### Fail-closed floor

When a non-global scope is present but invalid, every composed `allow` becomes `ask` (origin `fail-closed`), so a permissive lower scope cannot survive behind a broken higher one.
It is applied before yolo.
See [Fail-closed on an invalid non-global scope](architecture/architecture.md#fail-closed-on-an-invalid-non-global-scope).

### Default and baseline

The universal default is a synthesized catch-all rule from `permission["*"]` (`ask` when unset), placed first in the ruleset.
The baseline is a small set of synthesized MCP metadata allows, placed after the default and before config, so a config rule overrides it.

### Runtime knob

A config field that changes behavior without being a rule, such as `yoloMode`, `debugLog`, `permissionReviewLog`, or `promptTimeoutMs`.

### Propagation

When a running session sees a changed policy source.
Rules in config files and agent frontmatter are re-read at the next tool call; runtime knobs are re-read at the next [prompt](#prompt).

### Project trust

Pi's per-directory decision to trust a project's local resources, which this package observes through `ctx.isProjectTrusted()` and never makes itself.
See [ADR 0001](decisions/0001-project-trust-adoption.md).

## Checking

### Tool call

One invocation of a tool by the model.
Pi emits a `tool_call` event before the tool runs, where this package's [gates](#gate) check it and may block it.

### Gate

One check a tool call must pass: it names a surface and a value, resolves them against the ruleset, and acts on the [action](#action).
A tool call passes through a fixed sequence of six gates (skill read, path, external directory, bash external directory, bash path, tool), and the first block stops the call (an unconditionally denying gate is checked ahead of the rest); for a shell tool, the tool gate checks each command unit.
A `/skill:` invocation typed by the user has its own input gate.

### Access intent

The description of what a call accesses (a tool's input, a bash command unit, a set of paths), built without consulting policy and handed by a gate to the resolver.

### Exposure

The check run at `before_agent_start` that hides a tool from the model when every value on its surface resolves to `deny`.
It is the first of two phases; gating at each tool call is the second.
See [Two-phase checking](architecture/architecture.md#two-phase-checking).

### Review log

The permission review log, a JSONL file recording each gate decision with its request facts and `decidedBy`.
Values bound to sensitive names are masked.

## Authority

### Authority

The right to decide whether an action may happen.
Recorded authority is the [ruleset](#ruleset); live authority is reached only on `ask`, when recorded authority is silent; absent authority (nothing recorded, nothing reachable) means the action is denied.
See [The authority model](architecture/architecture.md#the-authority-model).

### Authorizer

The entity that holds live authority for an `ask`.
The [terminal](#terminal) authorizers are `LocalUserAuthorizer` (prompt the human here), `ParentAuthorizer` (forward to the parent), and `DenyingAuthorizer` (no authority reachable); [links](#link) are the non-terminal ones.

### Chain

The ordered sequence an `ask` passes through: the [links](#link) the operator names in `authorizerChain`, in config order, then the [terminal](#terminal).
Each link decides or defers.
There is one chain per [node](#node); a relaying node runs none and forwards instead.
See [ADR 0007](decisions/0007-model-judge-authorizer-chain-adr.md).

### Link

A named, non-terminal authorizer that another extension registers with `registerAuthorizer`.
It decides nothing until the operator names it in `authorizerChain`, and it returns a [verdict](#verdict).

### Terminal

The last authorizer in a chain, which must decide and cannot defer.

### Defer

A link's verdict meaning "not mine to decide": the `ask` passes to the next link, and in the end to the terminal.

### Envelope

The bounded-delegation checkpoint this package applies to every link verdict, so a link can never exceed the operator's policy.
A link's `allow` on the `path` or `external_directory` families becomes [`defer`](#defer), except on an `external_directory` ask carrying the nothing-on-disk [license](#license).
A `deny` rule never reaches the chain at all.

### License

A fact a gate computes that lets a link's otherwise-capped `allow` through the [envelope](#envelope).
The one license today is nothing-on-disk: every flagged path of a bash `external_directory` ask names nothing that exists.

## Sessions and nodes

### Session

One Pi conversation, from `session_start` to `session_shutdown`; `/new`, `/resume`, and `/fork` each start a new one.
Session rules live exactly this long.

### Prompt

One user submission and the agent loop it starts, from `agent_start` to `agent_end`.
`before_agent_start` fires once per prompt; this package refreshes its runtime config and runs [exposure](#exposure) there.

### Turn

One model response and the tool calls it requests, from `turn_start` to `turn_end`.
A single [prompt](#prompt) can run many turns.

### Node

One Pi session runtime: one `ExtensionContext`, one event bus, one set of gates, its own registries.
A node is not a process: one process can host several, such as a parent and its in-process subagent children.
See [ADR 0012](decisions/0012-cross-node-extension-contract.md).

### Requesting, relaying, serving, and adjudicating nodes

The roles in forwarding: the requesting node raises the `ask`; a relaying node forwards it instead of deciding; the serving node drains forwarded asks; the adjudicating node is the one whose chain and terminal decide.

### Forwarding

How a subagent that cannot decide sends its `ask` up the session tree: its `ParentAuthorizer` hands the request to the serving parent, whose chain and terminal decide.
See [docs/subagent-integration.md](subagent-integration.md).

## Packaging

### This package

`@gotgenes/pi-permission-system`, an npm package containing one Pi [extension](#extension).

### Extension

Code Pi loads into a session; it receives `ExtensionAPI` and registers event handlers, tools, and commands.
An extension is fully trusted code in Pi's process, so the boundaries this package draws are about operator attention, not about what other extensions are able to do.

### Pi package

Pi's installable unit (`pi install npm:…`, `git:…`, or a local path), bundling extensions, skills, prompt templates, and themes.

### Downstream extension

An extension that integrates with this package through its published service (`getPermissionsService(sessionId)`, with `registerAuthorizer`, `registerToolAccessExtractor`, and the query methods) or its `permissions:*` events, such as `@gotgenes/pi-permission-model-judge`.
The dependency points toward this package, never away from it.
See [docs/cross-extension-api.md](cross-extension-api.md).

[#1108]: https://github.com/gotgenes/pi-packages/issues/1108
