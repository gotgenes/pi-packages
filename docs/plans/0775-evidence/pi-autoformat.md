# Evidence brief: pi-autoformat

## Purpose signal

The package exists to move formatting **earlier** in the agent workflow so that formatting never surprises the agent (or a commit) after the fact.
`packages/pi-autoformat/README.md` states it directly: "`pi-autoformat` is a Pi extension package that automatically formats files after the agent edits them", motivated by the failure loop where "pre-commit hooks or CI run formatters later, files mutate after the fact, commits fail or the agent has to recover from surprise formatting changes".

`packages/pi-autoformat/docs/plans/0001-initial-implementation-plan.md` frames the same problem and names the goal: "provide a Pi-native auto-formatting solution that runs *before* commit time, so agents do not need to remember formatter commands and do not get surprised by late formatting changes".

The mechanism is narrow by design: watch the files Pi's mutation tools touched, and run **repository-configured** formatter commands against just those files.
`README.md` lists the design goals as "format only files the agent touched", "flush between turns so commits see formatted files", "notify the agent inline only when formatting actually changed content or failed", "support repository-specific formatter commands and ordered chains", "surface formatter failures without blocking the original edit", and "delegate formatter configuration to the formatters themselves".

The `package-pi-autoformat` skill (`.pi/skills/package-pi-autoformat/SKILL.md`) restates these as standing implementation priorities, including "Format only files touched by the agent, not the whole repository" and "Trust formatters to discover their own project configs".

## In-scope signal

The 74-commit history and the 18 plans show a consistent set of accepted change kinds.

**Widening mutation-source coverage, always opt-in and explicit.**
`docs/plans/0003-additional-pi-mutation-tools.md` added `customMutationTools` and the `autoformat:touched` EventBus channel; `docs/plans/0004-shell-driven-mutation-coverage.md` added `shellMutationDetection` (argument parsing, mtime snapshot globs, user-declared wrappers) plus the uniform `formatScope` boundary.
Both plans state the same constraint: "Keep behavior explicit, opt-in, and predictable — no repository-wide scans".

**Changing the formatter dispatch model.**
`docs/plans/0014-batch-by-default-formatter-dispatch.md` replaced per-file `$FILE` substitution with batch dispatch (a declared breaking change); `docs/plans/0013-fallback-chain-step-type.md` added the `{ "fallback": [...] }` chain step; `docs/plans/0015-builtin-treefmt-and-treefmt-nix-support.md` added the `treefmt` / `treefmt-nix` built-ins and the wildcard `"*"` chain key.

**Changing flush timing and agent notification.**
`docs/plans/0027-format-before-agent-exit-follow-up-turn.md` removed `formatMode` and added an `agent_end` follow-up turn; `docs/plans/0031-turn-end-flush-with-change-detection.md` then moved the primary flush to `turn_end` with SHA-256 change detection and steering messages, removing `notifyAgent`.

**Refining the reporting surface.**
`docs/plans/0002-richer-tui-formatter-summaries.md` moved success summaries from toasts to a persistent `setStatus` footer; `docs/plans/0016-detailed-formatter-output-on-failure.md` added the opt-in `formatterOutput` block; `docs/plans/0202-pi-autoformat-message-tags.md` normalized user-visible tags to `pi-autoformat` (commit `fa1ab2dd`, commit `dd7ce59c`).

**Pruning config surface that dispatch does not read.**
`docs/plans/0012-remove-unused-formatter-extensions-field.md` removed `FormatterDefinition.extensions` because "no code in the dispatch path reads it", with a tolerant loader that accepts the legacy key and emits one non-fatal notice.
The skill generalizes this: "Treat any declared config field not read by the dispatcher as a maintenance trap."

**Tightening types against the real Pi SDK.**
`docs/plans/0022-pi-coding-agent-types.md` replaced duck-typed `*Like` aliases with real `@earendil-works/pi-coding-agent` types (dev-dependency, types only).

**Test-infrastructure work on the real-CLI acceptance suite.**
`docs/plans/0010-acceptance-test-coverage.md`, `0067`, `0618`, and `0678` are all test-only; `0678` segregated the real-CLI spawns into a separate `acceptance` vitest project (commit `160011ea`, commit `38d47503`).

**Documentation as the resolution of a feature request.**
`docs/plans/0459-treefmt-for-subdirectory-scoped-formatters.md` answered a third-party request with a `docs/configuration.md` subsection and no runtime mechanism (commit `5c357576`).

## Candidate non-goals

- **Whole-repository formatting** — `docs/plans/0001-initial-implementation-plan.md` lists "whole-repository formatting after every response" as out of scope; `docs/plans/0004-shell-driven-mutation-coverage.md` Non-Goals repeats "Filesystem watchers or whole-repo rescans after each `bash` call"; the `package-pi-autoformat` skill states "Format only files touched by the agent, not the whole repository."

- **Git staging and commit orchestration** — `docs/plans/0001-initial-implementation-plan.md` lists "automatic staging or commit orchestration" as out of scope.
  `docs/plans/0031-turn-end-flush-with-change-detection.md` Non-Goals 1 and 2 decline both "Re-staging formatted files in the git index" and "Command detection for `git commit` at `tool_call`", each with a session-data rationale (`git add` and `git commit` always share one bash command, in a turn after formatting).

- **Replacing pre-commit hooks** — `docs/plans/0001-initial-implementation-plan.md` lists "replacing existing pre-commit hooks" as out of scope.
  The package moves formatting earlier so hooks stop failing; it does not claim to be the enforcement gate.

- **A per-formatter working directory or scope filter (`baseDir`)** — declined on issue #459 (a third-party request from `michaelmior`), closed with a comment explaining the rejection and pointing at `treefmt`.
  `docs/configuration.md` records the boundary in the shipped docs: "This is intentionally not a per-formatter `baseDir` setting", because a singular `baseDir` cannot express one tool used by several subprojects, and conflicts with batch dispatch when a turn touches multiple subprojects.
  `docs/plans/0459-treefmt-for-subdirectory-scoped-formatters.md` Non-Goals: "No `baseDir` config key, no per-formatter `cwd`/`workingDir` option, no scope-filter-per-formatter mechanism."

- **Reimplementing formatter-side config resolution** — `docs/configuration.md` (subdirectory-scoping subsection): "Per-subproject local tool config is resolved by the formatters themselves… trust formatters to discover their own project configs rather than reimplementing config resolution."
  The skill states it as a priority: "Do not reimplement formatter-side config resolution inside this extension."

- **Auto-detecting or invoking project-local formatter binaries** — `docs/configuration.md`: "the extension does not try to auto-detect and invoke project-local binaries on its own… if your repo needs wrappers such as `pnpm exec`, `npx`, or `mise x`, configure them explicitly in `command`."
  `docs/plans/0001-initial-implementation-plan.md` Open Question 1 is answered the same way.

- **Inferring which formatter a repository "really" uses** — `docs/plans/0013-fallback-chain-step-type.md` Non-Goals: "Auto-detecting which formatter a repo 'really' uses based on its config files."
  `docs/configuration.md` ships this as a documented caveat: fallback "does **not** check whether the tool has a project config to apply", and the answer is a project-level chain, not smarter detection.

- **Shipping default formatter chains** — `docs/configuration.md`: "No default chains are shipped — formatting is fully opt-in… This avoids surprises from a default formatter (e.g. prettier) conflicting with the project's chosen tool (e.g. biome)."
  `README.md` repeats it in the quick start.

- **Inferring mutation intent from tool names, schemas, or output** — `docs/plans/0003-additional-pi-mutation-tools.md` Non-Goals: "Inferring mutation intent from tool names, schemas, or output content.
  All recognition is opt-in and explicit."

- **Implicit repo-wide mutation detection via `git status --porcelain`** — `docs/plans/0004-shell-driven-mutation-coverage.md` has a dedicated "Explicitly Deferred" section rejecting it on six grounds (implicit repo-wide behavior, false positives from IDE saves and watchers, dirty-tree interaction, ambiguous untracked files, silent no-op outside Git, loss of per-command attribution).

- **Tracking arbitrary shell side effects** — `docs/plans/0004-shell-driven-mutation-coverage.md` Non-Goals: "Tracking arbitrary side effects of complex shell pipelines"; `docs/plans/0001-initial-implementation-plan.md` lists "perfect detection of every file mutated by arbitrary shell commands" as out of scope.
  The argument parser is documented to "bail on pipelines, command substitutions, sequencing, and unknown flags so the surface stays auditable" (`docs/configuration.md`).

- **A "no scope check" escape hatch** — `docs/plans/0004-shell-driven-mutation-coverage.md`: "we deliberately do not provide a 'no scope check' escape hatch."
  Users who need a wider boundary configure `formatScope` roots.

- **Blocking the original edit on a formatter failure** — `README.md` design goals: "surface formatter failures without blocking the original edit." `docs/plans/0001-initial-implementation-plan.md` Core Product Decision 4 and its answered Open Question 4 both hold this line.
  Note the framing is "no strict mode should be added yet" — later plans (`0016` Non-Goals) still route strict-mode changes to a separate issue, so this is a firm current stance with an acknowledged open question, not a closed door.

- **Masking a formatter's non-zero exit** — `docs/configuration.md` fallback semantics: "Non-zero exit codes are treated as real failures and surfaced — they are not masked by trying the next alternative"; the built-ins section adds "Anything else with a non-zero exit is reported as a real failure and is never silently swallowed."

- **Annotating successful runs with formatter output** — `docs/configuration.md`: "Successful runs are **never** annotated with output, even when this option is enabled — the goal is debugging failures, not chatter on the happy path."
  `docs/plans/0016-detailed-formatter-output-on-failure.md` Non-Goals: "Surfacing successful-run output."

- **Persisting formatter output or summaries** — `docs/plans/0016-detailed-formatter-output-on-failure.md` Non-Goals: "Persisting full output to disk (e.g. `.pi/extensions/pi-autoformat/last-run.log`).
  Defer until someone asks; mechanism is forever." `docs/plans/0002-richer-tui-formatter-summaries.md` Non-Goals: "Persisting summaries across sessions."

- **A richer TUI surface than a footer status plus a warning toast** — `docs/plans/0002-richer-tui-formatter-summaries.md` Non-Goals declines a `setWidget` per-file table ("the user's framing… does not justify the screen real estate"), a `summarySurface` config key ("Premature; one good default beats a knob"), and theme overrides beyond the standard color names.
  `docs/plans/0016-detailed-formatter-output-on-failure.md` also declines "A separate widget / pane / file for full output."

- **Byte-level diffs or line-change summaries in agent notifications** — `docs/plans/0031-turn-end-flush-with-change-detection.md` Non-Goal 4: "file names and failure details are sufficient."

- **An explicit flush tool or slash command for agents** — `docs/plans/0031-turn-end-flush-with-change-detection.md` Non-Goal 3.

- **Per-file outcome attribution from formatter output** — `docs/plans/0014-batch-by-default-formatter-dispatch.md` Non-Goals: "Per-file outcome parsing from formatter stdout/stderr… v1 reports per-batch only."
  `docs/plans/0015-builtin-treefmt-and-treefmt-nix-support.md` declines the `treefmt` variant: "Detecting which specific formatter inside `treefmt` failed… per-formatter attribution stays inside `treefmt`'s own output."

- **Parallel execution anywhere in the pipeline** — declined three times: chain groups (`docs/plans/0014-batch-by-default-formatter-dispatch.md`, "Parallel chain-group execution"), fallback probes (`docs/plans/0013-fallback-chain-step-type.md`, "Parallel probing of fallback alternatives"), and wildcard-vs-per-extension passes (`docs/plans/0015-builtin-treefmt-and-treefmt-nix-support.md`, "Wildcard runs first, per-extension chains run after").

- **A general built-in formatter library, glob chain keys, or wrapped `treefmt` flags** — `docs/plans/0015-builtin-treefmt-and-treefmt-nix-support.md` Non-Goals: "Adding general-purpose 'named built-in formatters' beyond these two", "Introducing arbitrary glob keys (`"*.tsx.snap"`, `"src/**"`).
  Only the literal `"*"` token is supported", and "Wrapping arbitrary `treefmt` flags through config… users who need custom flags can declare a regular `formatters` entry instead."

- **Configurable formatting timing** — `docs/plans/0027-format-before-agent-exit-follow-up-turn.md` Goal 1 removes `formatMode` entirely: "The runtime always uses prompt-end timing", after judging `"tool"` mode "actively harmful in multi-tool turns" and `"session"` mode useless because "the agent is completely gone and cannot react."

- **Storing configuration in Pi's shared `settings.json`** — `docs/configuration.md` Notes: "Config is intentionally separate from Pi's shared `settings.json`.
  A dedicated config file avoids collisions with Pi core settings and makes strict schema validation practical."
  The skill adds: "Do not move package configuration into Pi `settings.json` without explicit discussion."

- **Auto-rewriting users' on-disk config files** — `docs/plans/0012-remove-unused-formatter-extensions-field.md` Non-Goals.
  The deprecation policy is instead "accept the legacy key, emit a single non-fatal config issue per occurrence describing the deprecation, and discard the value" (`.pi/skills/package-pi-autoformat/SKILL.md`).

- **A stable, versioned public TypeScript API for cross-extension use** — `docs/plans/0003-additional-pi-mutation-tools.md` Non-Goals: "We expose only the existing `pi.events` channel; everything else stays internal." `docs/plans/0022-pi-coding-agent-types.md` Non-Goals adds "Adding `@earendil-works/pi-coding-agent` to `dependencies` or `peerDependencies`.
  Pi is the loader, not a consumer of our package."

- **A generic Pi-extension test harness, or LLM-backed tests in default CI** — `docs/plans/0010-acceptance-test-coverage.md` Non-Goals: "Building a generic Pi-extension test harness… the fixtures… exist solely to drive the autoformatter pipeline", and "default CI must not require API keys."
  `docs/testing.md` records the same boundary for the LLM-gated tier.

## Adjacent routing signal

| Capability                                                  | Routed to                                                                                                 | Evidence                                                                                                                                                                                                        |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scoping formatters to subdirectories in a monorepo          | `treefmt` / `treefmt-nix` (external tool, referenced as a built-in chain step)                            | Issue #459 closed with a comment recommending `treefmt` `includes`/`excludes` over a `baseDir` mechanism; `docs/configuration.md` "Subdirectory scoping lives in `treefmt.toml`, not in `pi-autoformat` config" |
| Per-subproject formatter config discovery                   | The formatter itself, walking up the tree                                                                 | `docs/configuration.md` subdirectory-scoping subsection; `.pi/skills/package-pi-autoformat/SKILL.md`                                                                                                            |
| Per-formatter failure attribution inside a dispatcher       | `treefmt`'s own output                                                                                    | `docs/plans/0015-builtin-treefmt-and-treefmt-nix-support.md` Non-Goals                                                                                                                                          |
| Mutations made by another extension's or MCP server's tools | The peer extension, via the `autoformat:touched` EventBus channel, or the user, via `customMutationTools` | `docs/plans/0003-additional-pi-mutation-tools.md`: "we expose only the existing `pi.events` channel"; `docs/configuration.md` `eventBusMutationChannel`                                                         |
| Codegen and wrapper scripts that mutate files               | The user, via declared `shellMutationDetection.wrappers` prefixes                                         | `docs/plans/0004-shell-driven-mutation-coverage.md` Strategy 3: "a precise escape hatch without us having to model every codegen tool"                                                                          |
| Custom formatter flags beyond the built-in argv shapes      | A user-declared `formatters` entry                                                                        | `docs/plans/0015-builtin-treefmt-and-treefmt-nix-support.md` Non-Goals                                                                                                                                          |
| Commit-time enforcement                                     | Existing pre-commit hooks, left in place                                                                  | `docs/plans/0001-initial-implementation-plan.md` out-of-scope list                                                                                                                                              |

No routing to a sibling `@gotgenes/` package is recorded anywhere in this package's artifacts.
The only cross-package interaction the history describes is the generic `pi.events` channel, which names no specific peer.

## Gaps

**No declined external contributions.**
`gh pr list --state closed` filtered to unmerged, non-`gotgenes` PRs returned no PR touching `pi-autoformat` at all — the 24 such PRs are all `pi-subagents`, `pi-permission-system`, or `pi-subagents-worktrees`.
`gh issue list --state closed --search 'autoformat'` filtered to `NOT_PLANNED` returned only `#93 Add tests for pi-colgrep`, which is unrelated.
The single third-party request in this package's history (#459, `michaelmior`) was closed `COMPLETED` via documentation, not declined outright.
So the recorded boundaries all come from the operator's own plans, not from turning outsiders away.

**Strict / blocking failure mode is deferred, not decided.**
Every plan that touches it routes it to a separate issue rather than rejecting it (`docs/plans/0016-detailed-formatter-output-on-failure.md`, `0003`, `0004` Non-Goals all cite the strict-mode issue).
The charter must state whether "non-blocking" is permanent or provisional.

**A settings or config-editor UI is absence, not a boundary.**
`docs/plans/0001-initial-implementation-plan.md` Phase 7 lists "optional settings command / config editor UI — not yet started."
Nothing declines it.
Confirming it as a non-goal requires an operator decision.

**On-demand or manual formatting is absence, not a boundary.**
There is no tool, command, or config to format a file the agent did not touch, but no artifact declines one either.
The closest signal is `docs/plans/0031-turn-end-flush-with-change-detection.md` Non-Goal 3 (no explicit flush tool for agents), which is about the queue, not about a user-invoked format command.

**Linting versus formatting is unbounded.**
`chains` runs any command the user declares, and `docs/configuration.md` `formatterOutput` explicitly anticipates "compilers / type-checkers" as chain steps.
Whether running non-fixing checks (a type-checker, a lint gate) is in scope, or whether the package is strictly for *mutating* formatters, is never stated.

**Platform and environment boundaries are unstated.**
The only platform reference is case-insensitive path comparison on `darwin` and `win32` (`docs/plans/0004-shell-driven-mutation-coverage.md`).
Whether Windows is supported, and whether the extension is expected to work outside a Git repository beyond the `formatScope` cwd fallback, is not recorded.

**Relationship to sibling packages is unstated.**
No artifact says what `pi-autoformat` delegates to, or refuses to duplicate from, `pi-permission-system`, `pi-subagents`, `pi-github-tools`, or any other `@gotgenes/` package — even though `pi-autoformat` shells out to arbitrary user-configured commands, which is squarely the territory `pi-permission-system` governs per the root `README.md` package table.

**Config-location semantics have an open bug, not a boundary.**
Issue #762 (`pi-autoformat: global config path ignores PI_CODING_AGENT_DIR`) is open, which confirms config-path resolution is in scope but leaves its intended surface undocumented.
