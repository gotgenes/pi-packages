# Evidence brief: pi-colgrep

## Purpose signal

The package exists to expose the external [ColGrep](https://github.com/lightonai/next-plaid#colgrep) semantic code-search CLI to the Pi agent as a tool, and to keep that CLI's index warm across a session.
`packages/pi-colgrep/README.md` states it "integrates ColGrep semantic code search as a tool available to the agent" and that it "exposes ColGrep as a Pi tool that complements (not replaces) the built-in `grep`".
`packages/pi-colgrep/docs/architecture/architecture.md` opens with the same two-part framing: "a Pi extension that exposes the ColGrep semantic code-search CLI as an agent tool and keeps its index current across a session".
The architecture document names the two cooperating concerns explicitly — a **search path** (agent invokes the tool) and an **index-management path** (the extension keeps the index warm) — "both reaching the CLI through the shared `Exec` seam".

The shipped skill states what the tool is for at the decision level, not the feature level: `packages/pi-colgrep/skills/colgrep/SKILL.md` says "use `colgrep` for intent-based exploration, use `grep` for exact pattern matching", and that the skill's own purpose is to stop the agent "defaulting to `grep` for everything".

The origin story is a scaffold-then-fill sequence: `packages/pi-colgrep/docs/plans/0089-scaffold-pi-colgrep.md` covers "only the infrastructure scaffold", `0090-register-colgrep-search-tool.md` adds the tool, `0091-auto-reindex-on-session-start-and-file-mutations.md` adds index management, `0092-ship-colgrep-usage-skill.md` adds the skill, and `0389-configurable-startup-indexing.md` makes indexing non-blocking and disable-able.

## In-scope signal

The 62-commit history shows five kinds of change being accepted.

Tool-surface work — arg building, result formatting, availability probing, and rendering (`commit 80ba0dba` `feat: add colgrep CLI argument builder`, `commit efad4e77` `feat: add colgrep result formatting`, `commit 4bf98934` `feat: add colgrep availability check`, `commit 0ad2bbdc` `feat: register colgrep search tool`).

Index-lifecycle work — the debounce/queue/coalesce/shutdown state machine and its wiring into session events (`commit 84356bef` through `commit 9a878697` for issue #91; `commit 9f4cea6f` `feat: coalesce concurrent reindex runs and track in-flight promise`).

Agent-guidance work — the shipped skill and its prompt hints (`commit 5eacbe71` `feat: add colgrep usage skill`, `commit fa164a19` `fix: self-identify colgrep in limit guideline`, `commit 75ceffda` `docs: add package-pi-colgrep skill`).

Configuration and startup behavior in response to a third-party report — issue #389 from an external contributor (graelo) was accepted and shipped as background indexing plus an `indexOnStartup` boolean (`commit 42681b37`, `commit a4738a8f` `feat: run startup index in background, gated by indexOnStartup`, `commit f5505ae5` `feat: gate write/edit reindex on existing index with one-time skip warning`).

Monorepo-hygiene work that lands across all packages — import normalization, ESLint adoption, README standardization, SDK bumps (`commit f7c8af75`, `commit f509a208`, `commit 4c270ada`, `commit 704f3b34`).

## Candidate non-goals

- **Replacing, removing, or deactivating Pi's built-in `grep`** — `colgrep` is positioned as a complement, and the framing was deliberately corrected away from the upstream skill's "default to colgrep for any code search" stance.
  Citations: `packages/pi-colgrep/docs/plans/0090-register-colgrep-search-tool.md` Non-Goals ("Removing or deactivating the built-in `grep` — `colgrep` is a complement"); `packages/pi-colgrep/docs/plans/0092-ship-colgrep-usage-skill.md` Problem Statement ("The upstream ColGrep project ships a SKILL.md, but it positions colgrep as a primary/replacement search tool, which is wrong for our context") and its "What needs adaptation" item 1.

- **Blocking Pi startup on index construction** — startup indexing is fire-and-forget by design, and the package skill states the rule as a prohibition.
  Citations: `packages/pi-colgrep/docs/architecture/architecture.md` design principle 4 ("Non-blocking by default … Startup never waits on indexing"); `.pi/skills/package-pi-colgrep/SKILL.md` ("Startup indexing is non-blocking — `session_start` fires `reindexer.runNow()` fire-and-forget.
  Never re-add an `await` there"); `commit a4738a8f`; issue #389.

- **Proactively indexing a directory the operator never searches** — the write/edit auto-reindex is gated on an index already existing, so edit activity alone never creates an index.
  Citations: `packages/pi-colgrep/docs/architecture/architecture.md` design principle 5 ("Index only what is searched"); `packages/pi-colgrep/docs/plans/0389-configurable-startup-indexing.md` Goals and "File mutations" section; `commit f5505ae5`.

- **Trigger-policy heuristics for when to index (git-repo detection, well-known-directory lists, allow/deny lists)** — the external requester proposed exactly these; the recorded decision declined them in favor of one boolean plus the existence gate.
  Citation: `packages/pi-colgrep/docs/plans/0389-configurable-startup-indexing.md` Non-Goals ("Git-repo or well-known-directory trigger heuristics (graelo's other suggestions).
  A single `indexOnStartup` boolean plus the index-existence gate covers the reported pain without a policy enum.
  Revisit if users ask for finer control"), against the request text in issue #389; also its Open Questions ("Should a future config add finer trigger policy (git-only, allow/deny dir lists)?
  Deferred").

- **Overriding or suppressing the colgrep CLI's own auto-index-on-search behavior** — leaving upstream's lazy indexing intact is what makes the extension's opt-out correct, so the extension deliberately does not intervene.
  Citations: `packages/pi-colgrep/docs/plans/0389-configurable-startup-indexing.md` Non-Goals ("Changing the colgrep CLI's own auto-index-on-search behavior — leaving it intact is what makes lazy indexing correct"); `.pi/skills/package-pi-colgrep/SKILL.md` ("Lazy indexing is free; the extension never needs to force an index just so search works").

- **Reindexing in response to `bash` tool results (file mutations from shell commands)** — triggers are scoped to `write` and `edit` because inferring mutation from a shell command is judged unreliable.
  Citations: `packages/pi-colgrep/docs/plans/0091-auto-reindex-on-session-start-and-file-mutations.md` Non-Goals ("Reindexing on `bash` tool results that may mutate files — detecting file mutations from shell commands is complex and out of scope") and its Open Questions ("Detecting file mutations from bash is unreliable.
  Defer unless user feedback suggests coverage gaps").

- **Tunable debounce or reindex-timeout configuration** — declined twice, in the plan that introduced the timings and again when config was added.
  Citations: `packages/pi-colgrep/docs/plans/0091-auto-reindex-on-session-start-and-file-mutations.md` Non-Goals ("Customizable debounce timing or reindex timeout via config"); `packages/pi-colgrep/docs/plans/0389-configurable-startup-indexing.md` Non-Goals ("Customizable debounce or timeout config (already deferred in issue #91)").

- **A separate config key to disable write/edit reindexing independently of index existence** — the existence gate is held to cover the need.
  Citation: `packages/pi-colgrep/docs/plans/0389-configurable-startup-indexing.md` Non-Goals ("A config key to disable write/edit reindexing independently of index existence — the existence gate already suppresses proactive indexing in opted-out directories").

- **Re-probing index existence mid-session** — the probe runs once at `session_start` and is only flipped by `/colgrep-reindex`.
  Citation: `packages/pi-colgrep/docs/plans/0389-configurable-startup-indexing.md` Open Questions ("Should `indexExists` be re-probed mid-session (e.g. after a `colgrep clear`)?
  Out of scope").

- **Full CLI parity in the tool's parameter surface** — the exposed parameters are a curated subset; several upstream capabilities are documented as CLI-only, reachable through `bash`, not through the tool.
  Citations: `packages/pi-colgrep/skills/colgrep/SKILL.md` ("Flags marked 'CLI only' are available when running `colgrep` via bash but are not exposed as tool parameters", covering `--exclude` and `--exclude-dir`); `packages/pi-colgrep/docs/plans/0092-ship-colgrep-usage-skill.md` Design Overview ("Remove multi-file and multi-directory search (our tool only accepts a single `path`)" and "filtered to flags our tool supports").

- **Throwing or failing hard when the colgrep binary is missing, broken, or slow** — the package treats the CLI as an optional external dependency and degrades instead.
  Citations: `packages/pi-colgrep/docs/architecture/architecture.md` design principle 3 ("Degrade, never throw — colgrep is an optional external binary … so a missing or failing CLI never blocks the agent"); `.pi/skills/package-pi-colgrep/SKILL.md` Implementation Priorities.

- **Bundling, installing, or managing the colgrep binary** — the binary is stated as a user-supplied prerequisite on `PATH`, and the design principle above names it "an optional external binary".
  Citations: `packages/pi-colgrep/README.md` Prerequisites ("ColGrep installed and available on `PATH`"); `packages/pi-colgrep/docs/architecture/architecture.md` design principle 3.
  This is the weakest item in this list: the artifacts consistently treat installation as the user's responsibility, but no artifact records a decision *against* bundling or installing it.

- **Pi SDK imports inside `src/lib/`** — an internal structural boundary rather than a capability boundary, but it is recorded prescriptively in two places, so it belongs in a charter's boundary discussion.
  Citations: `packages/pi-colgrep/docs/architecture/architecture.md` design principles 1 and 2 ("SDK-free libraries"; "One narrow seam to the outside world … The CLI is never spawned directly from a library module"); `.pi/skills/package-pi-colgrep/SKILL.md` Implementation Priorities.

## Adjacent routing signal

Exact pattern or symbol matching -> Pi's built-in `grep`.
This is the package's primary routing statement and it is repeated at every level: `packages/pi-colgrep/README.md`, the tool's `promptGuidelines` (per `packages/pi-colgrep/docs/plans/0090-register-colgrep-search-tool.md`), and the "When to Use What" table in `packages/pi-colgrep/skills/colgrep/SKILL.md` ("Exact string or regex match -> `grep` (built-in)"; "Find all usages of a symbol -> `grep` (built-in)").

Finding files by name or glob -> Pi's built-in `find`.
Citation: `packages/pi-colgrep/skills/colgrep/SKILL.md` "When to Use What" table, and its "What needs adaptation" note in `docs/plans/0092-ship-colgrep-usage-skill.md` item 4, which remaps the upstream skill's Claude Code tool names (`Search`/`Grep`/`Glob`) onto Pi's `grep` and `find`.

Index freshness on an actual search -> the upstream colgrep CLI, deliberately.
Citation: `packages/pi-colgrep/docs/plans/0389-configurable-startup-indexing.md` Non-Goals and Background ("`colgrep search` auto-indexes if the index is missing or stale — lazy indexing is already supported by the CLI").
The extension delegates the correctness of lazy indexing to the binary rather than reimplementing it.

Advanced filtering (`--exclude`, `--exclude-dir`, multi-directory search) -> the colgrep CLI invoked through `bash`.
Citation: `packages/pi-colgrep/skills/colgrep/SKILL.md` notes on CLI-only flags.

Config-file convention -> borrowed from `pi-github-tools` and `pi-subagents-worktrees` rather than invented.
Citation: `packages/pi-colgrep/docs/plans/0389-configurable-startup-indexing.md` "Sibling config convention" ("The new config module mirrors this exactly with `EXTENSION_ID = 'pi-colgrep'`").
No sibling package in this monorepo owns search; the root `README.md` package table lists pi-colgrep as the sole "Semantic code search" entry, so there is no intra-repo capability handoff to record.

One redirected request exists, and it is process-level rather than capability-level.
Issue #93 ("Add tests for pi-colgrep", filed by the maintainer) was closed as NOT_PLANNED and its content routed into the feature issues: "Closing in favor of integrating these tests directly into the feature issues via TDD … Writing tests alongside the features they exercise is more reliable than backfilling them after the fact."

The only external request in the record, issue #389 (graelo), was **accepted but re-scoped**: the reporter's suggested trigger rules were declined and replaced with `indexOnStartup` plus the index-existence gate, a redirection confirmed through operator dialogue (`packages/pi-colgrep/docs/retro/0389-configurable-startup-indexing.md`, Planning stage: "Operator-driven refinements beyond the raw proposal … background + disable-able, not a trigger-policy enum").

The query for unmerged external PRs mentioning colgrep returned no results.
The query for colgrep-related issues closed as NOT_PLANNED returned exactly one, #93 above.

## Gaps

**Fixing, forking, patching, or upstreaming to the colgrep CLI.**
The premise worth checking held: this is *not* a recorded boundary.
The closest recorded statement is the narrower non-goal about not overriding the CLI's auto-index-on-search behavior (plan `0389`), plus a consistent *adaptation* posture in risk tables — "Pin to the observed shape from colgrep 1.2.0; add defensive parsing" (`0090`), "Parse the stable negative signal `No index found`; … One-line fix if the string changes" (`0389`), "Skill content diverges from upstream ColGrep as the CLI evolves … Update when ColGrep ships breaking changes" (`0092`).
Every one of these describes absorbing upstream change locally, never contributing to or forking upstream.
That is strong circumstantial evidence but not a decision; the operator must supply the boundary.
An explicit statement ("bugs in the colgrep binary are reported upstream, not patched here") would confirm it.

**Supporting a semantic-search backend other than colgrep.**
Absence only.
Every artifact assumes the colgrep binary; nothing records a decision against pluggable backends.
A rejected request for a different embedding engine, or a charter line, would confirm it.

**Managing colgrep's own settings on the user's behalf** (for example `colgrep settings --ignore <dir>`).
Issue #389's body raises `colgrep settings --ignore` as an impractical manual workaround, and the resulting plan solved the problem a different way without stating whether the extension should ever write colgrep's settings.
This reads as an unexamined option rather than a declined one.

**Searching or indexing anything other than the local working directory** — remote repositories, network endpoints, non-code corpora.
Absence only.
The `Exec` seam and `cwd`-bound design make it structurally implausible, but no artifact states it as a boundary.

**Telemetry, analytics, or any network egress.**
No artifact addresses it either way.
The package's "fully local" framing is quoted from upstream's description of colgrep, not asserted as a policy of this extension.

**Prompt-surface ownership.**
Plan `0092` lists "Changing the existing `promptSnippet` or `promptGuidelines`" as a non-goal, but that is issue-scoped sequencing, not a durable boundary — `commit fa164a19` changed a guideline immediately afterward.
Do not promote it to a charter non-goal.

**A user-facing statement of any of the above.**
All the confirmed non-goals live in `docs/plans/`, `docs/architecture/`, and `.pi/skills/` — none appear in `packages/pi-colgrep/README.md`, which is the only artifact most users read.
That is the gap the charter section closes.
