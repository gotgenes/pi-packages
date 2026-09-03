# Configuration

`@gotgenes/pi-subagents` has two configuration surfaces: **agent definition files** that describe an agent type, and a **`subagents.json`** settings file that tunes the runtime.
Neither is required — every field has a default.

For the tools, commands, events, and service API, see the [README](../README.md).

## Default Agent Types

| Type              | Tools                      | Model                         | Prompt Mode            | Description                                                                                      |
| ----------------- | -------------------------- | ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------ |
| `general-purpose` | all 7                      | inherit                       | `append` (parent twin) | Inherits the parent's full system prompt — same rules, CLAUDE.md, project conventions            |
| `Explore`         | read, bash, grep, find, ls | haiku (falls back to inherit) | `replace`              | Fast codebase exploration (read-only); inherits the parent prompt as a base                      |
| `Plan`            | read, bash, grep, find, ls | inherit                       | `replace`              | Software architect for implementation planning (read-only); inherits the parent prompt as a base |

The `general-purpose` agent is a **parent twin** — it receives the parent's entire system prompt plus a sub-agent context bridge, so it follows the same rules the parent does.
Explore and Plan use `replace` mode: the parent prompt is the cacheable base and their specialist read-only instructions are appended last, giving them the final say.

Default agents can be **overridden** by creating a `.md` file with the same name (e.g. `.pi/agents/general-purpose.md`), or **disabled** per-project with `enabled: false` frontmatter.

## What a child inherits from the parent's prompt

Pi assembles a system prompt in layers.
Its own preamble and tool guidelines come first, then your `AGENTS.md` or `CLAUDE.md` project context, then the catalogue of available skills, then a `Current working directory:` footer — and finally whatever extensions append each turn.

A child inherits only the **stable identity** layers: everything up to, but not including, the skills catalogue.
The layers after it are resolved against one session, so Pi and the child's own extensions rebuild them for the child rather than the child borrowing the parent's:

| Layer                                         | Where a child's copy comes from                          |
| --------------------------------------------- | -------------------------------------------------------- |
| Pi preamble, tool guidelines, project context | inherited from the parent, byte for byte                 |
| Skills catalogue                              | rebuilt by Pi for the child's own directory and tool set |
| `Current working directory:`                  | rebuilt by Pi for the child's own directory              |
| Extension-appended blocks                     | rebuilt by the child's own extensions                    |

This matters most for a child that runs somewhere other than the parent — one given an isolated workspace by a `WorkspaceProvider`.
Its skills resolve from its own workspace, and its working-directory claim names that workspace.
Inheriting the parent's copies instead would give such a child a catalogue of skills it may not have and a directory claim that walks it back out of its workspace.

Inheriting the identity rather than the whole prompt also keeps the child's leading text byte-identical to the parent's, which prefix-caching providers and local inference engines reuse instead of reprocessing.

If you write extensions that add to the system prompt, see [Extensions that append to the system prompt](../README.md#extensions-that-append-to-the-system-prompt).
The reasoning behind the boundary is recorded in [ADR 0006](decisions/0006-inherited-prompt-is-identity-only.md).

## Custom Agents

Define custom agent types by creating `.md` files.
The filename becomes the agent type name.
Any name is allowed — using a default agent's name overrides it.

Agents are discovered from two locations (higher priority wins):

| Priority    | Location                                                                         | Scope                         |
| ----------- | -------------------------------------------------------------------------------- | ----------------------------- |
| 1 (highest) | `.pi/agents/<name>.md`                                                           | Project — per-repo agents     |
| 2           | `$PI_CODING_AGENT_DIR/agents/<name>.md` (default `~/.pi/agent/agents/<name>.md`) | Global — available everywhere |

Project-level agents override global ones with the same name, so you can customize a global agent for a specific project.
The global location follows the upstream `PI_CODING_AGENT_DIR` env var — set it to relocate all pi-coding-agent state (agents, skills, settings) to a custom directory.

### Example: `.pi/agents/auditor.md`

```markdown
---
description: Security Code Reviewer
tools: read, grep, find, bash
model: anthropic/claude-opus-4-6
thinking: high
max_turns: 30
---

You are a security auditor.
Review code for vulnerabilities including:

- Injection flaws (SQL, command, XSS)
- Authentication and authorization issues
- Sensitive data exposure
- Insecure configurations

Report findings with file paths, line numbers, severity, and remediation advice.
```

Then spawn it like any built-in type:

```text
subagent({ subagent_type: "auditor", prompt: "Review the auth module", description: "Security audit" })
```

### Frontmatter Fields

All fields are optional — sensible defaults for everything.

| Field               | Default        | Description                                                                                                                                                                                                                                                                                                             |
| ------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `description`       | filename       | Agent description shown in tool listings                                                                                                                                                                                                                                                                                |
| `display_name`      | —              | Display name for UI (e.g. widget, agent list)                                                                                                                                                                                                                                                                           |
| `tools`             | all 7          | The agent's complete tool allowlist — built-in or extension-registered names. `none` for no tools. See [Tool selection](#tool-selection)                                                                                                                                                                                |
| `model`             | inherit parent | Model — `provider/modelId` or fuzzy name (`"haiku"`, `"sonnet"`)                                                                                                                                                                                                                                                        |
| `thinking`          | inherit        | off, minimal, low, medium, high, xhigh, max. An unrecognized value is dropped, and the agent inherits the parent's level                                                                                                                                                                                                |
| `max_turns`         | unlimited      | Max agentic turns before graceful shutdown. `0` or omit for unlimited                                                                                                                                                                                                                                                   |
| `prompt_mode`       | `append`       | `replace`: parent prompt is the cacheable base; body is appended last with full control (no `<sub_agent_context>` bridge, no `<agent_instructions>` wrapper). `append`: parent prompt is the base; body is wrapped in `<agent_instructions>` and a sub-agent context bridge is injected (agent acts as a "parent twin") |
| `inherit_context`   | `false`        | Fork parent conversation into agent                                                                                                                                                                                                                                                                                     |
| `run_in_background` | `false`        | Run in background by default                                                                                                                                                                                                                                                                                            |
| `enabled`           | `true`         | Set to `false` to disable an agent (useful for hiding a default agent per-project)                                                                                                                                                                                                                                      |
| `locked`            | —              | Fields a `subagent` tool caller may not override. `true` or a list of field names. See [Locking fields against callers](#locking-fields-against-callers)                                                                                                                                                                |

The caller decides, and the agent file fills the gaps.
A `subagent` tool parameter wins over the agent file's value for `model`, `thinking`, `max_turns`, `inherit_context`, and `run_in_background`; the agent file supplies whichever of those the caller left unset.

### Locking fields against callers

An agent whose model, thinking level, or turn limit is a correctness requirement rather than a default can withhold it from callers with `locked`.

```yaml
---
model: anthropic/claude-haiku-4-5
max_turns: 10
locked: true
---
```

`locked: true` withholds every field this file sets — here `model` and `max_turns`, while `thinking`, `inherit_context`, and `run_in_background` stay open because the file names no value for them.
This is the behavior every agent file had before locking became opt-in, so it is the one-line way to keep an existing file working unchanged.

A list withholds exactly the fields it names, in either YAML spelling:

```yaml
locked: model, thinking            # comma-separated
locked: [model, max_turns]         # flow sequence
```

The list form also withholds a field this file leaves unset — `locked: [model]` with no `model:` denies the caller a model override and lets the child inherit the parent's.
An entry naming anything other than `model`, `thinking`, `max_turns`, `inherit_context`, or `run_in_background` is ignored.

A lock is never silent: when a caller passes a value for a locked field, the tool result says which agent locked which parameters.

A lock binds the `subagent` tool only.
[`SubagentsService.spawn`](../README.md#for-extension-authors) is a programmatic caller rather than a model guessing at harness settings, so its options win regardless.

### Tool selection

`tools` is the agent's **complete allowlist** of capability tools, not a filter over the built-ins.
No tool that touches the filesystem, the shell, or the network reaches a child unless the agent names it — whoever registered it.

Entries may name built-in tools (`read`, `bash`, `edit`, `write`, `grep`, `find`, `ls`) or tools registered by any extension:

```yaml
---
description: Browser-driving researcher
tools: read, grep, find, agent_browser
---
```

Naming an extension's tool is the supported way to give a child access to it.
This matters because a child loads the parent's extensions and runs their setup functions, so an extension **does** call `registerTool` inside the child — and Pi then drops that tool, because the allowlist is applied before the child's tool registry is built.
The registration reports no error; the tool simply is not there.
List the tool by name and it is admitted the moment its extension registers it.

Three names are always removed from a child, even when an agent lists them: `subagent`, `get_subagent_result`, and `steer_subagent`.
This is the recursion guard — without it, an agent could spawn agents of its own without bound.

Two names are always **added**, whatever an agent lists: `ask_parent` and `notify_parent`.
These are the child's channel back to the agent that delegated to it — protocol the core installs in every child, like the `<active_agent>` tag and the parent-context prefix.
Neither reaches the filesystem, the shell, or the network, so a read-only agent stays read-only.
`ask_parent` records a question and tells the child to end its turn, so the delegating agent can answer by resuming it; `notify_parent` sends a one-way update and returns at once.
`notify_parent` is given only to a background agent — a foreground parent is blocked awaiting its child, so the update could not reach it until after the result did — and only while [`midRunUpdates`](#persistent-settings) is on.

Accepted forms, all equivalent:

```yaml
tools: read, grep, find      # comma-separated
tools: [read, grep, find]    # YAML flow sequence
tools:                       # YAML block sequence
  - read
  - grep
  - find
tools: none                  # no tools at all
```

Omitting `tools` entirely gives the agent all seven built-ins and no extension tools.

Two other settings interact with this list:

- [`excludedExtensionPackages`](#excluding-package-extensions-from-children) stops an extension from loading in children at all, so naming one of its tools has no effect there.
- When [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system) is installed, its `permission:` frontmatter narrows the set further, per turn.
  Use it to deny a tool; use `tools` to decide what the agent has in the first place.

## Persistent Settings

Runtime tuning values set via `/subagents:settings` (max concurrency, default max turns, grace turns, the two session-retention windows, the abort-on-interrupt policy, and the mid-run update channel) persist across pi restarts.
A completed subagent's record is kept for the whole parent session (so `get_subagent_result` never misses); only its heavy in-memory session is released — after `consumedSessionRetentionMinutes` once the result has been collected, or after the `unconsumedSessionRetentionMinutes` safety cap if it never was.
An agent that asked a question and has not been answered holds the safety cap rather than the consumed window, because reading a question is not finishing with the agent — the answer is delivered by resuming the very session the short window would release.

Set `midRunUpdates` to `false` to withhold `notify_parent` from background agents, leaving them no way to interrupt you before they finish.
`ask_parent` is unaffected: a blocked agent can still end its turn with a question.
Two files, merged on load:

- **Global:** `~/.pi/agent/subagents.json` — your machine-wide defaults.
  Edit by hand; the `/subagents:settings` command never writes here.
- **Project:** `<cwd>/.pi/subagents.json` — per-project overrides.
  Written by `/subagents:settings`.

**Precedence:** project overrides global on any field present in both.
Missing fields fall back to the hardcoded defaults (max concurrency `4`, default max turns unlimited, grace turns `5`, consumed-session retention `10` minutes, unconsumed-session retention `720` minutes, abort-all-on-interrupt `true`, mid-run updates `true`).

**Example — global defaults for a beefy machine:**

```bash
mkdir -p ~/.pi/agent
cat > ~/.pi/agent/subagents.json <<'EOF'
{
  "maxConcurrent": 16,
  "graceTurns": 10,
  "unconsumedSessionRetentionMinutes": 1440,
  "abortAllOnInterrupt": false,
  "midRunUpdates": true
}
EOF
```

Every project now starts with concurrency 16, grace 10, and ESC left to the parent, without ever touching the command.
Individual projects can still override via `/subagents:settings`.

**Failure behavior:** missing file is silent; malformed JSON logs a `[pi-subagents] Ignoring malformed settings at …` warning to stderr; invalid/out-of-range field values are dropped per-field; write failures downgrade the `/subagents:settings` toast to a warning with `(session only; failed to persist)`.

### Excluding package extensions from children

Some package extensions are parent-scoped or expensive to initialize per session.
Because children run in the parent's process, such an extension initializing once per child multiplies its cost in a single heap — enough, in the case that motivated this feature, to exhaust the V8 heap with four concurrent children.

List the offending packages under `excludedExtensionPackages` to keep their extensions out of child sessions:

```json
{
  "excludedExtensionPackages": ["npm:@cortexkit/pi-magic-context"]
}
```

Entries must match Pi's configured package source string exactly, as it appears in your Pi `settings.json` `packages` array — there is no glob or prefix matching.

What this does and does not do:

- Only the matched packages' **extensions** are disabled, and only in children.
  Their skills, prompts, and themes stay available to children.
- The parent session is unaffected, as is the child's own settings — only the child's resource loading is filtered.
- The exclusion happens during package resolution, so the extension's module is never imported and its factory never runs in the child.
- Excluding a package keeps the **tools** that extension registers out of child sessions too: its factory never runs there, so an agent that names one of those tools in [`tools`](#tool-selection) gets nothing.
  If you need the tools but want the extension's resources released when the child is disposed, exclusion is the wrong lever — see [Child session lifecycle](../README.md#child-session-lifecycle).

This key is hand-edited in the global or project `subagents.json`; `/subagents:settings` does not expose it, but it is preserved when you change other settings there.
An absent or empty list reproduces the default behavior, in which children inherit every parent extension.

#### Excluding a permission extension

When [`@gotgenes/pi-permission-system`](https://github.com/gotgenes/pi-packages/tree/main/packages/pi-permission-system) is installed, it rides into children harmlessly by construction, so exclusion is an optimization and never a correctness requirement.
Excluding an extension that only registers an authorizer chain link costs nothing but saves its load time: the node that adjudicates an ask still judges every descendant's request.

One case used to weaken a child, and recent versions of that extension close it.
An extension can declare the filesystem path *another* package's tool accesses, so that the permission system's `path` and `external_directory` gates can see it.
Excluding such a declaring package left the tool present in the child with its path undeclared, and the child's own gates stopped seeing it — silently, because the parent's gating is unaffected and still looks correct.

The condition needed both halves, so most exclusions could never hit it:

- Package **A** registers a tool whose path lives under a non-standard input key.
- Package **B** registers the path extractor for A's tool.
- You exclude **B** but not **A**.

If one package supplies both the tool and its extractor, excluding it removes both together and no gap opens.

Since the version of `@gotgenes/pi-permission-system` that closed this, a child session that has no extractor of its own for a tool borrows one from the session that spawned it, so the split above no longer leaves a path ungated.
Preview formatters resolve the same way, so an approval prompt for such a tool still shows its registered preview rather than raw JSON.
The borrowed declaration is recorded: the child's review-log entry carries `extractorSource: "inherited"`.
Nothing is borrowed across a process boundary — children here run in the parent's process, which is what makes it possible.

One thing exclusion still does **not** weaken, by design: an authorizer chain link is never borrowed from another session, because a link decides rather than describes.

Excluding `@gotgenes/pi-permission-system` itself is a different matter: a child then loads no permission node at all, so nothing gates its tool calls, no `permission:` frontmatter applies, and no `ask` is forwarded.
See [Subagent Integration](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/subagent-integration.md#loading-asymmetry) for the full rule.

This one does not pass silently.
This extension announces each child once its extensions have bound, and a recent `@gotgenes/pi-permission-system` uses that announcement to notice a child with no node of its own: it records the child in its permission review log and warns once per session that the child's tool calls are ungated.
The warning names this setting as the likeliest cause, because a failure to load that extension in the child leaves the same absence and the parent cannot tell the two apart.
Remove the entry to restore gating in child sessions; keep it, knowing the children it spawns are unguarded.

### Abort on interrupt

By default, pressing ESC to interrupt the parent agent also aborts every subagent.
Set `abortAllOnInterrupt` to `false` (or flip it from `/subagents:settings`) to keep background and queued subagents running when you interrupt the parent — useful when you spawn long background work and then want to steer the parent without losing it.

A foreground agent aborts on ESC regardless of this setting.
It holds the parent's own run signal for the duration of its blocking tool call, so the interrupt reaches it directly; the policy governs background and queued agents.

The policy is read at the moment ESC fires, so flipping it mid-session applies to the very next interrupt.

## Model providers in child sessions

A subagent inherits every model provider the parent can reach, including providers an extension registered at runtime with `pi.registerProvider` rather than through `models.json` or `auth.json`.
This is what lets a child run under a dynamically registered provider such as `pi-claude-bridge`.

The child does not share the parent's provider pool — it gets its own, with the parent's registrations copied onto it.
An extension loaded in a child can therefore register or unregister providers without disturbing the parent or any sibling agent.

Inheritance is a **snapshot taken when the agent spawns**.
A provider registered in the parent after a child has started does not appear in that running child; agents spawned afterwards pick it up.
This matches the rest of the parent state a child captures at spawn — working directory, model, and system prompt are all frozen the same way.

Provider inheritance needs no configuration.
It does require Pi 0.81.0 or newer, which is the floor this package declares — that is the release where the model registry began exposing every runtime registration for replay.

One thing the child does still share with the parent: when a provider's API key is a shell command (`"apiKey": "!my-command"`), Pi caches the command's resolved output process-wide, so parent and children reuse one result rather than re-running it per agent.
That cache is Pi's, not this extension's, and it predates provider inheritance.
