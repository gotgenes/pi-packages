# Evidence brief: pi-session-tools

## Purpose signal

The package exists to give a multi-session workflow two things: a way to label a session, and a way to read a session's transcript.
`packages/pi-session-tools/package.json` describes it as "Pi extension providing session metadata tools (naming, context) for multi-session workflows", and the root `README.md` package table (line 16) calls it "Session naming and context bridge for multi-session workflows".
The `src/index.ts` header docblock enumerates the whole surface: `set_session_name`, `get_session_name`, `read_session`, `read_parent_session`, `read_session_file`, `list_session_files`.

The origin commit is naming-only — `commit 2c666049` "feat: add pi-session-tools extension for programmatic session naming" — and reading was added later as "session introspection" (`commit cfb47e0c` `read_session`, `commit d5ac58ec` `read_parent_session`).

Both halves serve the repo's own staged workflow.
`AGENTS.md` § Session naming convention tabulates the stage-encoded name each prompt template sets, and every template calls the tool (`.pi/prompts/plan-issue.md:40`, `tdd-plan.md:35`, `build-plan.md:38`, `ship-issue.md:9`, `ship-worktree.md:13`, `land-worktree.md:13`, `retro.md:34`, `pr-review.md:24`, `plan-improvements.md:43`, `finish-phase.md:43`, `triage-backlog.md:35`).
The reading half has one named consumer: the retro diagnostic lenses.
`packages/pi-session-tools/docs/plans/0251-transcript-formatted-output.md` states it outright — "The primary consumer (retro diagnostic lenses) needs only the conversation flow" — and `.pi/prompts/retro.md:98-99` is that consumer.

The reading half also serves the cross-session context bridge described in `AGENTS.md` § Multi-session issue lifecycle: `packages/pi-session-tools/docs/plans/0549-read-arbitrary-session-file.md` frames `read_session_file` as closing the gap where a root `/retro` cannot reach a peer worktree session's transcript.

## In-scope signal

Refining the rendered transcript for its reader is in scope.
`0251` replaced raw `JSON.stringify` output with a numbered transcript that folds tool results into their calls (`commit f9a7dee2`, `ddcc6455`, `49ffac97`, `1c09452d`).
`0411` added a pure summary layer and a collapsed TUI row that expands on `Ctrl-O` (`commit 4dbae159`, `4fbec4ec`, `9292ec1e`).
`0546` tightened what counts as a model change so the transcript stops rendering switches that never ran a turn (`commit 7b4f1bed`, `1afe1753`).

Reaching a session the existing tools cannot reach is in scope.
`read_parent_session` (`commit d5ac58ec`) added the parent-via-subagent case; `read_session_file` and `list_session_files` (`commit a3dba26f`, `077d8601`) added the sibling case, driven by the concrete parallel-worktree need recorded in `packages/pi-session-tools/docs/retro/0546-effective-model-change-reporting.md` § Diagnostic details (retro-discussion follow-up).

Internal consolidation with unchanged output is in scope: `commit 0f731894` "refactor(pi-session-tools): extract shared transcript result builder" pulled the filter/limit/summarize/format block behind one helper before a third tool used it.

Test-infrastructure repair is in scope: `commit 8bda626f` and `8fa087e8` (Refs #554) moved a heavy import out of the per-test timed region.

Shipping runtime code and user docs only is in scope: `commit 8d8991f1` and `4d203d44` narrowed the published tarball to a `files` allowlist.

## Candidate non-goals

- **A raw-entry or JSON passthrough output mode** — the tools render a transcript and deliberately do not offer the unrendered entries back.
  "Adding a raw mode or backward-compatible JSON output option — the session file is always available on disk for tools that need raw entries" (`packages/pi-session-tools/docs/plans/0251-transcript-formatted-output.md` § Non-Goals; the same plan's Risks section calls the break intentional).
- **Path allowlisting or sandboxing for `read_session_file`** — access policy is explicitly not this package's concern.
  "No path allowlist / sandbox.
  Per the operator's decision, `read_session_file` accepts any readable path... the agent already has `Read`/`Bash` on any file, so a `~/.pi/agent/sessions/` allowlist would add friction without a real security boundary" (`packages/pi-session-tools/docs/plans/0549-read-arbitrary-session-file.md` § Non-Goals, confirmed as an operator decision in `packages/pi-session-tools/docs/retro/0549-read-arbitrary-session-file.md` § Planning).
- **Per-model or cross-turn aggregate reporting** — the package renders per-turn attribution and flat counts, not analytics roll-ups.
  "No `summarizeModels` roll-up and no `Models:` header block...
  Building it would be a solution without a consumer; the operator confirmed dropping it" (`packages/pi-session-tools/docs/plans/0546-effective-model-change-reporting.md` § Non-Goals).
  The retro records the reasoning path: the proposed aggregate was traced to its only reader and found unused (`packages/pi-session-tools/docs/retro/0546-effective-model-change-reporting.md` § Planning).
- **Owning or improving Pi's session storage format and directory encoding** — the package matches whatever Pi writes.
  "The scheme is lossy (a literal `-` in a path is indistinguishable from a `/`), but this plan must **match** Pi's existing encoding, not improve it" (`packages/pi-session-tools/docs/plans/0549-read-arbitrary-session-file.md` § Background).
  The same plan derives the sessions root from the running session's own file rather than hard-coding a location, so a relocated Pi config dir is tracked rather than assumed (§ Design Overview, § Risks and Mitigations).
  The entry-shape knowledge is likewise transcribed from Pi's model, not defined here (`0251` § Background, "Pi session entry model").
- **Growing an existing tool's parameter list to carry a new capability** — a new capability arrives as a new tool.
  `0549` § Open Questions records the resolution "a separate `read_session_file` tool (not a `read_session` param)", and `0411` and `0546` each list "No new tool parameters" under § Non-Goals.
- **Guessing the caller's target directory** — `list_session_files` takes a required `cwd` with no default.
  "No `cwd` default on `list_session_files`... defaulting to `process.cwd()` would silently return the current session's own directory" (`0549` § Non-Goals; also stated in the README's `list_session_files` section).
- **Masking a test-timing problem with a timeout override** — "Do **not** add a `testTimeout` override to `vitest.config.ts` or any file" (`packages/pi-session-tools/docs/plans/0554-session-tools-test-static-import.md` § Non-Goals).
  This is a package-internal engineering boundary rather than a user-facing one, but it is recorded and cited.

## Adjacent routing signal

Unrendered session bytes -> Pi's builtin `Read` / `Bash` on the on-disk `.jsonl`.
`0251` § Non-Goals justifies refusing a raw mode precisely because the file is on disk for anything that needs it, and `0549` § Problem Statement describes the interim state where the retro used raw `Read`/`Bash` before `read_session_file` existed.

File-access policy -> outside this package.
`0549` § Non-Goals delegates it to the agent's existing `Read`/`Bash` surface rather than re-implementing a boundary here.
The root `README.md` table (line 10) names `@gotgenes/pi-permission-system` as the repo's permission-enforcement package, but no artifact in this package's history routes a request there by name — the receiving owner is inferred from the package table, not from a recorded redirect.

Session-file naming, directory layout, and entry schema -> Pi itself (`0549` § Background, "must **match** Pi's existing encoding, not improve it").

Interpretation of a transcript (model-performance correlation, escalation-delay, feedback-loop lenses) -> `.pi/prompts/retro.md`.
`0546` § Problem Statement identifies that prompt as "the concrete consumer" and confines this package's job to emitting a trustworthy signal; the plan's final `docs:` step edits the prompt rather than moving the lens into the package.

Worktree creation and teardown -> the worktree launcher scripts and `@gotgenes/pi-subagents-worktrees` (root `README.md` line 18).
`0549` § Problem Statement treats teardown as someone else's lifecycle and only relies on the fact that the transcript outlives it.

Subagent session browsing UI -> `@gotgenes/pi-subagents`.
The closed unmerged PR #690, "fix(pi-subagents): make the /subagents:sessions preview responsive on large transcripts", shows a session-preview surface owned there.
This is a title-level signal from the PR list only; no artifact in this package records a redirect to it.

Declined or redirected external requests: none found.
`gh pr list --state closed` filtered to unmerged, non-`gotgenes`-authored PRs returns 24 PRs, none mentioning `session-tools` (grep exits 1).
`gh issue list --state closed --search 'session-tools'` filtered to `NOT_PLANNED` returns exactly one issue, #258 "Agent owns session lifecycle — run + resume via factory", which carries the `pkg:pi-subagents` label and is about `pi-subagents` internals — it matched on the word "session", not on this package.
Every recorded boundary in this package comes from the operator's own plan documents, not from turning away an outside contribution.

## Gaps

There is no charter-shaped artifact for this package to date.
`0546` § Observations and `0549` § Module-Level Changes both record that the package has no `docs/architecture/` roadmap and no `package-pi-session-tools` skill, and the root `README.md` (line 217) lists it among the packages whose README is meant to cover everything.
Every boundary above is a per-issue § Non-Goals line, written to scope one change, not to scope the package.

Read-only-ness is an observed property, not a recorded boundary.
Five of the six tools only read; `set_session_name` mutates exactly one piece of session metadata (the display name).
No artifact states a rule against writing, editing, replaying, pruning, or compacting session entries — the closest is `0251`'s refusal of a raw output mode, which is about output shape, not about mutation.
The operator must supply this boundary.
What would confirm it: a declined request to edit, redact, replay, or delete session entries, or a plan Non-Goal naming session mutation.

Session storage-format ownership is confirmed as a boundary (see above), but its converse is not: nothing records what happens when Pi changes the format.
Whether this package tracks a breaking Pi session-format change, pins a supported range, or degrades is unstated; the only hint is the `>=0.75.0` peer-dependency floor in `package.json`.

Naming policy is unbounded.
The tool takes an arbitrary string; the stage-encoded convention lives in `AGENTS.md` § Session naming convention, the README's stage table, and the prompt templates.
Whether the package would ever validate or enforce a naming scheme is unstated.
What would confirm it: a declined request to add name validation, or a Non-Goal saying naming policy belongs to the caller.

Also unstated, with no artifact either way: cross-session search or indexing, exporting a transcript to another format (Markdown, HTML, JSON for external tooling), session retention or pruning, reading sessions belonging to another user or machine, and any per-tool output-size or truncation policy beyond the existing `types`/`limit` filters.
