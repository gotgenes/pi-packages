# AGENTS.md

## Monorepo structure

This is a pnpm workspace monorepo.
Each package under `packages/` is a Pi extension published to npm under `@gotgenes/`.
Always launch Pi from the repo root — the root `.pi/settings.json` and `.pi/prompts/` are only discovered from CWD.
The working directory is always the repo root, so for a package-scoped script run `pnpm --filter @gotgenes/<pkg> run <script>` (or `pnpm -C packages/<pkg> run <script>`) from the root instead of `cd packages/<pkg> && pnpm run <script>`.
Before working on a specific package, load its `package-<name>` skill for architecture, priorities, and testing context.
Load skills inline — never dispatch a subagent to load skills.

Repo-level work — build, CI, tooling, cross-package docs — is labeled `scope:repo` rather than with every package's label.
That scope is always asserted (the forms' repo-wide option, or `gh issue create --label scope:repo`), never inferred from the absence of a package.

## Principles

Every rule in the skills below is an instance of one of these.
When a situation has no rule, apply the principle.

1. **Verify against the real surface, not the document about it.**
   `--help`, the compiled `.js`, `pnpm view <pkg> versions` — before a fact lands in a gate, a dependency floor, a migration note, or a security boundary.
2. **State what you checked, not what you conclude.**
   A reviewer cannot verify a coverage claim handed to it as a premise, and a subagent's universal claim ("nothing else calls this") is the one to verify.
3. **Provenance belongs in git.**
   Docs describe current behavior; a `(Refs #N)` survives only when the issue encodes an active constraint a reader may need to trace.
4. **A number a command can produce is never authored.**
   Timestamps, counts, SHAs, versions, issue numbers — run the command, then write what it printed.
5. **Mechanism is forever; docs are reversible.**
   Prefer a config pattern or a documented recommendation over a new runtime mechanism.
6. **Keep scope tight.**
   Prefer small, reversible changes; preserve intentional behavior unless there is a clear reason to change it; ask before removing functionality or changing defaults.

## Environment

Facts about this environment that no model could infer.

### Shell

Two prose tripwires are now `pi-permission-system` deny rules in `.pi/extensions/pi-permission-system/config.json` (`rg -r`, `git commit -F` from a heredoc); the reason string says what to do instead.

### Tooling

This project uses **pnpm** exclusively — never `npm` or `npx`.
A `commit-msg` hook (`committed`, via `prek`) rejects a malformed Conventional Commits header; pre-commit hooks reject stray invisible characters, decode literal Unicode escapes in markdown prose, and run Biome, ESLint, and `rumdl fmt`.
Use `colgrep` for intent-based codebase exploration and convention discovery; use `grep` for exact symbol matching.
Pi's own source is checked out beside this repo (`../pi` from the root, `../../pi` from a worktree) and tracks Pi's `main`, ahead of the pinned dependency.

### Tool-injected messages

The `pi-autoformat` extension emits a `[pi-autoformat] Formatted N file(s)` message after `Edit`/`Write`.
It is informational — not a turn boundary.
Continue the current step (e.g. Red→Green→Verify→Commit) until it is complete.
It also reflows what you just wrote (line wrapping, quote style), so an `oldText` — or a shell/regex pattern — built from the layout you emitted can fail to match; re-read a region you just edited before matching against it again.

### Stale prompt-template expansion

A slash command's expanded body is a snapshot from when the Pi process loaded it — so after this session edits a `.pi/prompts/*.md` template, a later same-process invocation of that command can run the **pre-edit** copy.
When the pasted prompt body contradicts the on-disk file (e.g. you just changed `/ship` and its steps read stale), treat the **on-disk file as authoritative** and follow it, not the injected text.

### Stale skill bodies

A skill read earlier in the session is a snapshot; after a `git pull` that changed `.pi/skills/`, re-read it before following it, even where a prompt says to skip skills already loaded.

### Stale in-process extension code

Pi loads each package's extension once at session start, so a session that edits — or fast-forward-merges — `packages/<pkg>/src/` keeps running the **pre-merge** tool for the rest of its life.
When the change targets a tool the workflow itself calls (`ci_find`, `ci_watch`, `issue_close`), restart Pi before the step that uses it — otherwise `/ship` exercises the old behavior and the new code looks broken.
The same applies when a change **removes** a tool `/ship` calls: the running session still has it registered.
A session that renames or deletes a prompt template is subject to the same staleness: it keeps the commands it registered at startup, so the first run of a renamed command needs a fresh session.

The same staleness makes the session's own system prompt a reliable witness for the **published** behavior: a defect in prompt assembly (a tool's `Available tools:` line, a guideline bullet, an injected block) is readable in context at zero tool cost.
Read it before hunting the SDK — but never to verify your own fix, which the running session cannot see.

### Releases

Releases are **dispatched, never automatic**.
`/ship` dispatches one by naming packages; `./scripts/release/next-version.sh <pkg>` prints what would be cut, or nothing, without releasing anything.
A package's `docs/plans`, `docs/retro`, `docs/architecture`, `docs/decisions`, `docs/assets`, and `CHANGELOG.md` are outside its release scope, as is every file outside `packages/`.

### Worktrees

A peer session runs in its own worktree at `~/development/pi/pi-packages-worktrees/issue-<N>` on branch `issue-<N>-<slug>`, launched with `pi --approve`.
`main` stays linear: the peer rebases with `/sync-worktree`, and the root fast-forward-merges with `/ship`.

## Working an issue

Larger issues span multiple sessions, each handling one stage.
The standard flow is:

1. `/plan-issue #N` — read the issue, explore the codebase, produce a numbered plan, commit it.
   For a code-touching change, a fresh-context `tidy-first-assessor` runs after the design is settled and before the plan is written; its accepted preparatory refactorings become `refactor:`/`test:` steps in the plan's TDD Order (Kent Beck's Tidy First).
2. `/tdd-plan` or `/build-plan` — execute the plan (TDD for code changes, build for docs/config).
   The preparatory steps are ordinary plan steps here; a fresh-context `pre-completion-reviewer` runs the quality gate at the **end**.
3. Pre-completion review — dispatched automatically at the end of step 2; a fresh-context `pre-completion-reviewer` subagent runs deterministic checks and a judgment checklist before recommending `/ship`.
4. `/ship #N` — land the work, verify CI, close the issue, dispatch the release.
5. `/retro` — review the session(s) for workflow improvements, persist retro notes.

A change that lands outside `/tdd-plan` or `/build-plan` fires no automatic `pre-completion-reviewer` dispatch.
Dispatch one by hand before committing a rewrite of an artifact a prior review rejected.

Each prompt template writes a stage entry to `docs/retro/NNNN-<slug>.md` (or `packages/<PKG>/docs/retro/`) before finishing.
These entries accumulate across sessions and serve as the cross-session context bridge — when a later stage starts, it reads the retro file to pick up decisions, observations, and warnings from prior sessions.
Each template also names the session `#N <Stage> — <title>` via `set_session_name`.

An issue spun off mid-lifecycle — by a step's implementation, a plan's follow-up, or a retrospective — is evaluated for roadmap fit when it is filed, not at phase close, so load the `roadmap-fit` skill at the filing point.
It exits immediately when the package has no open improvement phase; otherwise it records the operator's disposition (fold into a step / new step / defer / out of scope) in the roadmap's `#### Open-issue sweep dispositions` list, and filing-without-scope-creeping remains the correct local move.
`/finish-phase` reconciles the phase window's issues against that list before archiving, so a miss surfaces at phase close instead of vanishing from the history.

Use `/retro-note` to capture quick observations mid-session without interrupting the workflow.
Use `scripts/issue-context.sh <N>` to gather all available context for an issue (plan, retro, commits, branches) when bootstrapping a new session.

## Admission test

This file is loaded into every session; a skill's body is loaded only when read.
Before adding a passage here, answer three questions in order:

1. Could a current model act correctly without it?
   If yes, it belongs nowhere.
2. Is it needed before any workflow step has run, or is it an environment fact no model could infer?
   If neither, it belongs in the body of the topic skill whose trigger it fires at.
   Every rule has a loader now; a missing destination is a reason to create one, not to keep the rule here.
3. Does the rule stand without its incident?
   If yes, keep the rule and drop the story; a `(Refs #N)` stays only when the issue encodes a constraint a reader may need to trace.

A rule whose incident has not recurred in any retro since 2026-07-20 is a delete candidate — guidance, not a verdict, since the rule may be why it has not recurred.
`/audit-agent-docs` applies this test on demand to this file, the skills, the prompt templates, and the subagent definitions.

## Index

Before you do the thing in the left column, load the skill in the right one.

| Before you…                                                                                          | Load                     |
| ---------------------------------------------------------------------------------------------------- | ------------------------ |
| touch code, tests, or docs in `packages/<pkg>/`                                                      | `package-<pkg>`          |
| write, refactor, or review TypeScript, or design around a Pi SDK internal                            | `code-design`            |
| add a parameter to a shared interface or rewire layers                                               | `design-review`          |
| write or debug a test, or sequence TDD steps                                                         | `testing`                |
| write or edit markdown, an architecture doc, or a plan/retro                                         | `markdown-conventions`   |
| author or review a Mermaid diagram                                                                   | `mermaid`                |
| explore unfamiliar code                                                                              | `colgrep`                |
| `git commit`, `--amend`, `rebase`, `reset`, or a `gh` command that mutates state                     | `git-workflow`           |
| compose a bash call with a pipeline, loop, heredoc, in-place edit, or `gh … --body`                  | `shell-traps`            |
| run a multi-entry `Edit`, a scripted substitution, or a block insertion                              | `edit-tool`              |
| call `ask_user`                                                                                      | `clarification-gates`    |
| cite a plan, ADR, roadmap step, triage verdict, PR status, or third-party report                     | `reading-artifacts`      |
| build a reproduction, spike, or probe whose result becomes design input                              | `reproduction`           |
| dispatch a subagent, edit `.pi/agents/*.md`, or read a subagent's report                             | `delegation`             |
| dispatch a release, publish a package for the first time, add a package, or edit a `files` allowlist | `releasing`              |
| `/worktree`, `/sync-worktree`, or a worktree-lane `/ship`                                            | `worktrees`              |
| run or read `fallow`                                                                                 | `fallow`                 |
| plan an improvement round or edit a roadmap                                                          | `improvement-discovery`  |
| decide when an extension flushes, notifies, or intercepts                                            | `pi-extension-lifecycle` |
| assess a new Pi release or diagnose a Pi version regression                                          | `upstream-watch`         |
| finish `/tdd-plan` or `/build-plan`                                                                  | `pre-completion`         |
| file a GitHub issue                                                                                  | `roadmap-fit`            |
| settle a design in `/plan-issue`, before writing the plan                                            | `tidy-first`             |
