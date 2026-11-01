# Configuration

`pi-autoformat` uses extension-owned config files.

## Config locations

Configuration is loaded from these files, in order:

1. global: `~/.pi/agent/extensions/pi-autoformat/config.json`
2. project: `.pi/extensions/pi-autoformat/config.json`

Project config overrides global config.

> If the `PI_CODING_AGENT_DIR` environment variable is set, Pi uses that directory instead of `~/.pi/agent`, and the global config is read from `$PI_CODING_AGENT_DIR/extensions/pi-autoformat/config.json`.

## Schema validation

The config file is designed to support JSON Schema validation and autocomplete.

You can point `$schema` at either:

- the default-branch URL for the latest published schema
- a pinned release-tag URL for reproducible validation

Examples:

Latest:

```json
{
  "$schema": "https://raw.githubusercontent.com/gotgenes/pi-autoformat/main/schemas/pi-autoformat.schema.json",
  "commandTimeoutMs": 10000,
  "formatters": {
    "biome": {
      "command": ["biome", "check", "--write", "--files-ignore-unknown=true"]
    }
  },
  "chains": {
    ".ts": ["biome"],
    ".tsx": ["biome"],
    ".json": ["biome"]
  }
}
```

Pinned tag:

```json
{
  "$schema": "https://raw.githubusercontent.com/gotgenes/pi-autoformat/v2.4.1/schemas/pi-autoformat.schema.json"
}
```

## Settings reference

### `commandTimeoutMs`

Timeout in milliseconds for each formatter command.

Example:

```json
{
  "commandTimeoutMs": 10000
}
```

### `formatScope`

Boundary used to filter the touched-files queue.
Paths outside the configured scope are dropped silently.

Allowed values:

- `"repoRoot"` (default) — detect the Git toplevel via `git rev-parse --show-toplevel` and use it as the scope.
  Falls back to `cwd` when not in a Git repo.
- `"cwd"` — strict cwd subtree.
- `string[]` — explicit allowlist of roots, each resolved relative to `cwd`.
  A path is in scope if it falls under any configured root.

Symlinks are resolved on both sides via `fs.realpath`, so a symlinked workspace dep that resolves outside the scope is correctly filtered, and a symlink pointing into the scope is correctly included.

Example:

```json
{
  "formatScope": ["packages/server", "packages/shared"]
}
```

### `shellMutationDetection`

Opt-in detection of files mutated by shell (`bash`) commands.
Disabled by default; enable to surface files touched by `sed -i`, `mv`, `cp`, `touch`, `tee`, redirections, or user-declared codegen wrappers.

Defaults:

```json
{
  "shellMutationDetection": {
    "enabled": false,
    "argumentParsing": true,
    "snapshotGlobs": [],
    "wrappers": []
  }
}
```

Fields:

- `enabled` — master switch.
  Defaults to `false`.
- `argumentParsing` — parse a small whitelist of known mutating commands (`sed -i`, `mv`, `cp`, `touch`, `tee`, plus simple `>` / `>>` redirections).
  Bails on pipelines, command substitutions, sequencing, and unknown flags so the surface stays auditable.
- `snapshotGlobs` — globs whose mtimes are sampled before and after each `bash` invocation.
  Files whose mtime advanced are treated as touched.
  Capped at 5,000 entries with a warning on overflow.
  Defaults to `[]`.
- `wrappers` — shell command prefixes that already print the files they touched on stdout.
  Each entry has a `prefix` (matched at the start of the bash command) and optional `outputFormat` (currently only `"lines"`).

Example:

```json
{
  "shellMutationDetection": {
    "enabled": true,
    "snapshotGlobs": ["src/**/*.ts", "docs/**/*.md"],
    "wrappers": [{ "prefix": "pnpm codegen", "outputFormat": "lines" }]
  }
}
```

Merge semantics: `snapshotGlobs` and `wrappers` arrays replace lower-precedence values rather than merging — consistent with other array fields in this config.

### `customMutationTools`

Declare additional tool names whose results should be treated as file mutations and routed into the touched-files queue.
Useful for project- or extension-specific tools that the agent calls directly.

Each entry must specify the tool name and exactly one of `pathField`, `pathFields`, or `patchField`, each a dotted path into the tool's `input` payload.
Path fields may resolve to a string or a string array; arrays are flattened.
`patchField` must resolve to an OpenAI-style patch string delimited by `*** Begin Patch` and `*** End Patch`.
The `*** Add File:`, `*** Delete File:`, and `*** Update File:` headers supply paths.
If an update has a `*** Move to:` header, its destination replaces the update path.

Defaults to `[]`.

Example:

```json
{
  "customMutationTools": [
    { "toolName": "my-codegen", "pathField": "output" },
    { "toolName": "refactor", "pathFields": ["src", "dest"] },
    { "toolName": "apply-patch", "patchField": "args.patch" }
  ]
}
```

Paths are normalized and scope-filtered by the same pipeline used for `write`/`edit`, so you do not need to restate scope rules per tool.

### `eventBusMutationChannel`

Lets peer extensions publish touched files onto Pi's shared event bus and have them flow through the same prompt-end formatter pipeline.

Defaults:

```json
{
  "eventBusMutationChannel": {
    "enabled": true,
    "channel": "autoformat:touched"
  }
}
```

Fields:

- `enabled` — subscribe to the channel when Pi exposes `pi.events`.
  Defaults to `true`.
- `channel` — channel name to subscribe to.
  Defaults to `"autoformat:touched"`.

Payload shape (best-effort; malformed payloads are silently ignored):

```ts
{ path: string }            // single file
{ paths: string[] }         // multiple files
```

Paths are resolved relative to the session `cwd` and pass through the same scope filter as every other mutation source.

### `formatterOutput`

Optional surfacing of formatter `stdout` / `stderr` in failure reports.
Defaults preserve concise reporting: nothing extra is printed and the option is fully opt-in.

Successful runs are **never** annotated with output, even when this option is enabled — the goal is debugging failures, not chatter on the happy path.

Fields:

- `onFailure` (`"none" | "stderr" | "both"`, default `"none"`) — which streams of a failed run to include beneath each failure line.
  `"stderr"` is sufficient for most formatters (parser errors, lint diagnostics).
  `"both"` also includes `stdout`, useful for tools that report on `stdout` (some compilers / type-checkers).
- `maxBytes` (integer, default `4096`) — hard byte cap per stream per failed run, applied to UTF-8 byte length.
  When the cap is exceeded, the **tail** of the output is preserved (which is where stack traces and parser errors usually sit) and a `... (truncated, N earlier bytes)` marker is prefixed.
- `maxLines` (integer, default `40`) — hard line cap per stream per failed run, applied after byte trimming.
  When exceeded, a `... (truncated, N earlier lines)` marker is prefixed.

Example (enable `stderr` surfacing with the defaults):

```json
{
  "formatterOutput": {
    "onFailure": "stderr"
  }
}
```

Example (more aggressive caps for terse environments):

```json
{
  "formatterOutput": {
    "onFailure": "both",
    "maxBytes": 1024,
    "maxLines": 20
  }
}
```

The rendered failure block looks like:

```text
Formatter failures in 1 batch:
prettier (exit 2): src/foo.ts
  stderr:
    src/foo.ts: SyntaxError: Unexpected token (3:11)
    > 3 | export const = 3
        |              ^
```

Identical content is used in both the interactive TUI (via `notify`) and non-interactive log output (via `console.warn`).

### `hideSummariesInTui`

Whether formatter **success** summaries should be hidden in the interactive TUI.

When the extension is loaded in a Pi UI, each prompt-end flush updates a persistent footer status line (`setStatus("autoformat", ...)`).
A happy-path flush renders a one-line success indicator like `✓ autoformat: 3 files (biome, prettier)`.
Failures additionally fire a `notify(..., "warning")` toast and leave an error-styled status (`✗ autoformat: 1 batch failed (prettier) — 2 ok`) so the user can revisit them later in the session.

Set `hideSummariesInTui` to `true` to suppress the success status line.
Failures still surface via both the warning notification and an error-styled footer status regardless of this setting.
In non-interactive contexts (no UI), this setting has no effect: success summaries are never written, and failures still go to `console.warn`.

Example:

```json
{
  "hideSummariesInTui": false
}
```

### `formatters`

Formatter registry keyed by formatter name.

Each formatter can define:

- `command: string[]`
- `environment?: Record<string, string>`
- `disabled?: boolean`

> **Deprecated:** earlier versions accepted an `extensions: string[]` field on each formatter.
> It was never read by dispatch and has been removed.
> The loader still accepts on-disk configs that carry it but emits a single deprecation notice and ignores the value — remove `extensions` from your formatter entries and rely on `chains` to declare which extensions a formatter runs against.

**Batch dispatch.**
Touched file paths are appended to `command` as trailing arguments.
The executor runs each formatter once per chain group, passing every file in the group as a single invocation.
Do not include file paths or the legacy `$FILE` token in `command` — it is rejected at config-load time.

Formatter command resolution stays intentionally simple:

- commands run from the project `cwd`
- commands inherit the extension process environment and `PATH`
- the extension does not try to auto-detect and invoke project-local binaries on its own
- if your repo needs wrappers such as `pnpm exec`, `npx`, or `mise x`, configure them explicitly in `command`

Example:

```json
{
  "formatters": {
    "prettier": {
      "command": ["pnpm", "exec", "prettier", "--write"]
    },
    "markdownlint-cli2": {
      "command": ["pnpm", "exec", "markdownlint-cli2", "--fix"],
      "environment": {
        "CI": "1"
      }
    }
  }
}
```

### `chains`

Ordered formatter chains keyed by file extension.

No default chains are shipped — formatting is fully opt-in.
If no `chains` are declared, `pi-autoformat` does not run any formatter for any file.
This avoids surprises from a default formatter (e.g. prettier) conflicting with the project's chosen tool (e.g. biome).

The chain order is explicit and should be preserved.

A chain entry is an array of *steps*.
Each step is one of:

- a formatter name (string) — runs that formatter (current behavior).
- a fallback group (`{ "fallback": [name, name, ...] }`) — runs the first listed formatter whose command is on `PATH`.

Example:

```json
{
  "chains": {
    ".ts": ["biome"],
    ".tsx": ["biome"],
    ".json": ["biome"],
    ".md": ["markdownlint-cli2"]
  }
}
```

Fallback example:

```json
{
  "chains": {
    ".ts": [{ "fallback": ["biome", "prettier"] }],
    ".tsx": [{ "fallback": ["biome", "prettier"] }],
    ".md": [
      { "fallback": ["biome", "prettier"] },
      "markdownlint-cli2"
    ]
  }
}
```

#### Fallback semantics

The only fallthrough trigger is **command not found in `PATH`**.
Non-zero exit codes are treated as real failures and surfaced — they are not masked by trying the next alternative.

| Outcome of formatter N in the group | Behavior                                              |
| ----------------------------------- | ----------------------------------------------------- |
| Command not on `PATH`               | Skip, try N+1                                         |
| Command runs, exits 0               | Success, stop the group                               |
| Command runs, exits non-zero        | Failure, stop the group, report                       |
| All formatters missing from `PATH`  | Group is a no-op (no batch run emitted)               |

The `PATH` probe is cached per flush, so the same command is probed at most once across a single agent turn even when many extensions share the same fallback group.

When a non-first alternative wins, the formatter name in success and failure summaries is annotated with which earlier alternatives were skipped (e.g. `prettier (fallback after biome unavailable)`).

#### Choosing a chain strategy

Prefer **project-level** `chains` over relying on global fallback.
Global `chains` are convenient defaults, but become ambiguous in repositories that use multiple alternative tools.
A project-level `chains` declaration in `.pi/extensions/pi-autoformat/config.json` is explicit, predictable, and survives team handoffs.

Treat global fallback (`[{ "fallback": ["biome", "prettier"] }]`) as a "what to do when no project config has opinions" backstop — useful for ad-hoc repos, not load-bearing for projects you maintain.

#### Fallback caveat

Fallback chooses the first formatter whose command is on `PATH`.
It does **not** check whether the tool has a project config to apply.
A globally installed Biome will win a `[biome, prettier]` fallback even in repos that use Prettier — and Biome will format the file with its built-in defaults.
If both alternatives are realistic in your environment, declare a project-level chain to disambiguate.

#### Wildcard chain key (`*`)

In addition to per-extension keys, `chains` may declare a single `"*"` entry that applies to **every** touched file (including files without an extension).
The wildcard chain runs first across the full batch.
Files that any built-in dispatcher (see [built-in formatters](#built-in-formatters) below) reports as unhandled fall through to the per-extension chain for their extension; files claimed by the wildcard chain are removed from the per-extension pass to avoid double-formatting.

```json
{
  "chains": {
    "*": [{ "fallback": ["treefmt-nix", "treefmt"] }],
    ".ts": [{ "fallback": ["biome", "prettier"] }],
    ".md": ["prettier", "markdownlint-cli2"]
  }
}
```

This pattern lets a project-level dispatcher (`treefmt` or `treefmt-nix`) handle anything it knows about, while per-extension chains backstop the rest.

#### Built-in formatters

Two formatter names are shipped as built-ins and may be referenced in `chains` without a `formatters` entry:

- `treefmt` — discovers `treefmt.toml` (preferred) or `.treefmt.toml`
  by walking up from each touched file, then invokes
  `treefmt --config-file <found> -- <paths...>` from the discovered
  root.
- `treefmt-nix` — discovers `flake.nix` together with `treefmt.nix`
  (or `nix/treefmt.nix`) by walking up from each touched file, then
  invokes
  `nix fmt --no-update-lock-file --no-write-lock-file -- <paths...>`
  from the flake root.

Discovered config-root paths are cached for the lifetime of the autoformatter, so repeated flushes within a session do not re-walk the filesystem.

Both built-ins translate documented "no formatter for path" output into a clean **skip** outcome so chain composition (especially `fallback` and the wildcard-then-per-extension flow) works naturally:

- `treefmt`: stderr lines matching `no formatter for path: <p>` mark that file as unhandled.
  An exit-0 run where every input file was unhandled is treated as a full skip.
- `treefmt-nix`: stderr containing `emitted 0 files for processing`
  is treated as a full skip; transient `nix` daemon errors
  (e.g. `cannot connect to socket`) are also skipped so a downstream
  fallback alternative can take over.

Anything else with a non-zero exit is reported as a real failure and is never silently swallowed.

When both `treefmt` and `treefmt-nix` appear inside the same `fallback` group and both are on `PATH` and both resolve to a config at the **same** root, `treefmt-nix` wins regardless of declaration order.
When the roots differ, the user-declared order is preserved.

Declaring a `formatters` entry whose key matches a built-in name still works — the user-declared definition wins, providing an escape hatch for custom flags — but the loader emits a single non-fatal config issue so the shadowing is visible.

#### Scoping formatters to subdirectories (monorepos)

In a monorepo, different subprojects often use different formatters, and a tool may be shared across several subprojects.
File extension alone is not enough to decide which formatter runs — one subproject may use `eslint` while another uses a different tool for the same `.ts` files.

The supported way to express this is the built-in [`treefmt`](#built-in-formatters) dispatcher: scope each formatter with `includes`/`excludes` globs in a `treefmt.toml`, and reference `treefmt` from a single wildcard chain.
`treefmt` matches each touched file to the formatters whose globs cover it and runs each formatter against only its matching files — many subprojects, many tools, one pass.

```toml
[formatter.eslint]
command = "eslint"
options = ["--fix"]
includes = ["project/foo/**/*.{js,ts}"]

[formatter.prettier]
command = "prettier"
options = ["--write"]
includes = ["project/bar/**/*.{js,ts}"]
```

Reference the dispatcher from a wildcard chain so the whole touched batch flows through `treefmt`:

```json
{
  "chains": {
    "*": ["treefmt"]
  }
}
```

Subdirectory scoping lives in `treefmt.toml`, not in `pi-autoformat` config — `pi-autoformat` only references the `treefmt` dispatcher.
Because scoping is per-formatter glob matching rather than a single per-formatter directory, the same tool name can serve several subprojects, and multiple tools coexist under one config.

Per-subproject local tool config is resolved by the formatters themselves.
Tools such as `eslint`, `prettier`, and `biome` walk up from each file to find their nearest config, so a subproject-local `.eslintrc` (or equivalent) is picked up automatically from the file paths `treefmt` hands each formatter.
This follows the same principle as the rest of `pi-autoformat`: trust formatters to discover their own project configs rather than reimplementing config resolution.

This is intentionally not a per-formatter `baseDir` setting.
A single `baseDir` per formatter could not express one tool (e.g. `eslint`) used by several subprojects without redeclaring the formatter under synthetic names, and `pi-autoformat`'s batch dispatch (all touched files of a chain group are passed to one invocation) conflicts with a single per-formatter working directory when a turn touches multiple subprojects.
`treefmt`'s per-formatter `includes` plus its own per-formatter execution resolve both cleanly.

## Merge behavior

Merge order:

1. built-in defaults (scalar settings only — no default chains are shipped)
2. global config
3. project config

Recommended merge semantics:

- top-level scalar values override by precedence
- `formatters` merge by formatter name (built-in `prettier` and `markdownlint-cli2` definitions are available for convenience but inert without chains)
- `chains` merge by extension key — no built-in chains exist, so only user-declared chains take effect
- when a project config defines a formatter or chain key, that key replaces the lower-precedence value for that entry

This keeps repo-local formatter behavior explicit while still allowing users to set global defaults such as `commandTimeoutMs`.

## Notes

- Config is intentionally separate from Pi's shared `settings.json`.
- A dedicated config file avoids collisions with Pi core settings and makes strict schema validation practical.
- Schema URLs can point at either the default branch or pinned release tags depending on whether you want latest or reproducible validation behavior.
