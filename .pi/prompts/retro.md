---
description: Review this session for workflow improvements and persist retro notes to the package's docs/retro/
---

# Review session and persist retro notes

The user wants a retrospective on this session.
Issue number (if provided): `$1`

## Sync with remote (do this first)

Before reading anything, make sure the working tree is up to date with the remote:

1. Determine the branch: `git branch --show-current`.
2. **Worktree branch** (an `issue-*` branch with no upstream — `git rev-parse --abbrev-ref --symbolic-full-name @{u}` fails): run `git fetch origin` and proceed.
   Do **not** pull or rebase here; the worktree ship flow (`/sync-worktree`) owns rebasing onto `origin/main`.
3. **Trunk** (`main`): run `git pull --ff-only`.
   If it fails for **any** reason — uncommitted changes, divergent history, merge conflict, network error, detached HEAD — stop immediately and report the failure to the user.
   Do not attempt to stash, rebase, force, or otherwise resolve.
   Only proceed once the pull reports a clean fast-forward (or `Already up to date.`).

## Load skills

Before investigating or proposing changes, load skills relevant to the retro.
Skip any already in this session's context — the trunk flow runs planning, implementation, ship, and retro in one process — but re-load after a compaction, which drops the body while leaving the memory of having read it.

- Load the `ask-user` skill for the structured clarification flow.
- Load the `package-<PKG>` skill (e.g., `package-pi-permission-system`) for package-specific architecture, priorities, and testing context.
- Load the `markdown-conventions` skill for writing the retro file.
- Load the `code-design` skill if proposing code-related adjustments to prompts or `AGENTS.md`.
- Load the `clarification-gates` skill before the `ask_user` gate on proposed changes, and the `git-workflow` skill before the retro commit.

## Session naming

After identifying the issue number and title, call `set_session_name` with name `#N Retrospective — <issue title>` to identify this session in the session selector.

## Step 1 — Identify the retro file

1. If `$1` is set, treat it as the issue number `N`.
2. Otherwise, infer `N` from recent commit subjects (`git log --oneline -25`; look for `(#N)` at the end of `feat:`, `fix:`, or `docs:` commits).
   If multiple issues appear, list them and ask the user which to retro on with `ask-user`.
3. **Determine the target package(s).**
   Find the plan for issue `N` at `packages/*/docs/plans/NNNN-<slug>.md` or `docs/plans/NNNN-<slug>.md`.
   If the plan is under `packages/<PKG>/docs/plans/`, the retro goes in `packages/<PKG>/docs/retro/`.
   If the plan is under `docs/plans/` (cross-package), the retro goes in `docs/retro/`.
   If no plan exists, run `gh issue view N` and extract the `pkg:*` label(s).
   Multiple `pkg:*` labels → cross-package → use `docs/retro/`.
   If no label exists or it seems incongruent, ask the user which package.
4. Resolve the slug from the plan filename; if no plan exists, derive a short slug from the issue title via `gh issue view N --json title -q .title`.
5. The retro file is `packages/<PKG>/docs/retro/NNNN-<slug>.md` (single-package) or `docs/retro/NNNN-<slug>.md` (cross-package).
   Create the directory if missing.

## Step 2 — Synthesize observations

Review what happened across this session — the user prompts, your tool calls, corrections, rework, and commits.

If the retro file already contains stage entries from prior sessions (sections headed `## Stage: <name> (<timestamp>)`), read them as primary context.
Your synthesis should span all stages — not just this session.
Look for patterns that recur across stages, friction that compounds, and whether earlier observations led to adjustments.
When the issue spanned multiple sessions, read the prior stages' transcripts, not only their breadcrumbs: `list_session_files({ cwd })` lists this repo's sessions newest-first (the filename embeds the session id), and `read_session_file({ path })` renders one — repeated friction shows only in the transcript.

For a worktree issue, the implementation happened in a **separate peer session** whose transcript `read_session` cannot reach (it reads only the current session; the peer is a sibling, not a parent).
The `## Stage: Sync (worktree)` breadcrumb — spelled `## Stage: Ship (worktree)` in retros written before the commands were renamed — records a **Peer session transcript** path (a `.jsonl` under `~/.pi/agent/sessions/`, which survives the worktree teardown) — read it with `read_session_file({ path: "<path>" })` when a diagnostic lens (e.g. model-performance correlation) needs message-level detail the breadcrumbs do not carry; it renders the peer transcript through the same pipeline as `read_session`.
If only the peer worktree's cwd is known (no recorded path), use `list_session_files({ cwd: "<worktree path>" })` to find its newest session file first.

Be specific: cite file paths, commit subjects, and concrete tool sequences.
Label each friction point by what would have prevented it, with one label:

- `fact`: the agent lacked a fact about this environment or codebase that no model could infer
- `preference`: the operator wanted one of several defensible options, and nothing written said which
- `slip`: a mechanical error in emitting a tool call, an edit, or a command
- `rule-ignored`: a rule that covered the moment was in this session's context and was not followed
- `rule-unloaded`: a rule that covered the moment sits in a skill the session never read
- `judgment`: a defensible call that turned out worse, which no written rule would have changed
- `other`: describe

Before choosing among `fact`, `rule-ignored`, and `rule-unloaded`, search `AGENTS.md`, `.pi/skills`, and the invoked template for a rule covering the moment.

For each friction point describe the **concrete impact**: time wasted, rework caused, follow-up commits needed, or "added friction but no rework."

Note whether each friction point was **self-identified** (you caught it mid-session) or **operator-caught** (the operator pointed it out).

### What the operator steered

List every message where the operator redirected or corrected the agent, or chose against its recommendation at a gate, and quote the steering words verbatim.
Tag each one by what it was: `steer:rule` when it pointed at a written rule, `steer:fact` when it supplied a fact, and `steer:choice` when it picked among defensible options.
For a `steer:choice`, record whether the operator's own words made it general ("always", "I prefer") or left its reach unstated.
Do not ask about its reach in the moment; the operator often cannot say from one case.
Then list the earlier ones with `rg -n 'steer:choice' docs/retro packages/*/docs/retro` and name any that states the same choice.

### Novel wins only

Record wins only if they are novel or surprising — a new pattern working for the first time, a tool proving its value, a notably clean execution.
Skip routine successes.

### Diagnostic lenses

After categorizing friction points, run these four structured analyses.
Include findings in the retro file under a `### Diagnostic details` subsection when any lens produces actionable observations.
Skip a lens entirely when it finds nothing notable.

1. **Model-performance correlation** — for each subagent dispatch (if any), note which model ran and what task it performed.
   Flag quality mismatches: a reasoning-weak model on judgment-heavy work (architecture decisions, code review), or a high-cost model on purely mechanical work (formatting, simple grep).
   If the `read_session`, `read_parent_session`, or `read_session_file` tools are available, attribute each turn from the inline `[provider/model]` label the transcript renders on it, in a **type-unfiltered** call.
   A `types: ["model_change"]`-filtered call bypasses phantom-switch suppression and renders switches that never ran a turn.
   `offset` and `elide_user_text` are not type filters and are the intended way to run this lens on a long multi-stage session: page backward with `{ limit: N }` then `{ offset: N, limit: N }` rather than re-requesting a larger window, and set `elide_user_text: true` to drop prompt bodies the lens never reads while keeping every label.
   A rewound session renders only its live path, so the turns the lens counts are the ones that survived; an `[abandoned branch] N entries omitted` line marks each stretch that did not, and `branches: "all"` renders it when the abandoned attempt is itself the subject.
   `[session] → <name>` lines mark the stage boundaries to attribute each run of turns to.
   `pi-session-tools` is this repo's own tooling for exactly this — use `read_session`/`read_session_file`, not `jq` over `$PI_SESSION_FILE`, and never `PI_MODEL`/`PI_PROVIDER`, which report only the session's *current* model and invent an attribution when extrapolated across stages.
   A subagent's turns live in its own transcript, which `list_subagent_sessions({ path })` finds for a given session file and `read_session_file({ path })` renders — attribute a subagent's model from that transcript rather than from its agent definition, which records the model it was configured with and not the one that ran.
2. **Escalation-delay tracking** — for each stretch where the agent pursued one error or approach, count how many consecutive tool calls it spent before resolving or changing strategy.
   Flag sequences longer than 5 consecutive tool calls on the same error as "should have dispatched an Explore or Plan subagent" or "should have asked the user."
3. **Unused-tool detection** — for each such stretch, and each `fact` friction point, check whether a subagent type or tool was available that could have helped but was never dispatched.
   Examples: an Explore agent for codebase understanding, `colgrep` for semantic search, `web_search` for library docs.
4. **Feedback-loop gap analysis** — check which verification tools the agent ran (`pnpm run check`, `pnpm run test`, `pnpm run lint`) and when in the session they were invoked.
   Flag cases where verification ran only at the end rather than incrementally after each change.

## Step 3 — Write the retro file

Append (or create) `packages/<PKG>/docs/retro/NNNN-<slug>.md` with this structure.
When creating a new file, include YAML frontmatter (see the `markdown-conventions` skill § Documentation frontmatter):

```markdown
---
issue: N
issue_title: "<exact title from `gh issue view N`>"
---

# Retro: #N — <issue title>

## Stage: Final Retrospective (<ISO 8601 timestamp>)

### Session summary

2–3 sentences on what was accomplished.

### Observations

#### What went well

- ...

#### What caused friction

- `<label>` — <description>.
  Impact: <concrete impact>.

#### What the operator steered

- `steer:<rule|fact|choice>`: "<verbatim words>", after <what the agent had proposed>.
```

If the file already exists with prior stage entries, **append** the new entry — do not overwrite existing content.
Anchor the `Edit` on the file's last line or use `Write` with the full content — the repeated `### Observations` / `### Session summary` headers make header-anchored edits ambiguous.
The retro file accumulates entries across sessions.

Wrap all code identifiers, filenames, route paths, CLI names, and any text containing underscores in backticks.

## Step 4 — Present highlights and proposals (before asking)

A retro records every finding and proposes a change for only some of them.
A retro that proposes nothing is complete.

| Label           | What it may propose                                                    | When                                                                                                |
| --------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `fact`          | the fact, in the skill whose trigger it fires at                       | once it is verified against the real surface                                                        |
| `preference`    | the choice in one line, with a short reason                            | when the operator's words made it general, or when an earlier retro records the same `steer:choice` |
| `slip`          | a mechanism: a deny rule, a lint check, a tool fix                     | when an earlier retro records the same slip                                                         |
| `rule-ignored`  | a mechanism that enforces the rule, or the rule's deletion             | at once; never a louder or longer rule                                                              |
| `rule-unloaded` | a trigger fix in the skill's `description` or the template's load list | at once                                                                                             |
| `judgment`      | a rule                                                                 | only when an earlier retro records the same call                                                    |

Cite the earlier retro by path wherever the table asks for one.

Surface the synthesis as regular message text **before** invoking `ask-user`.
The message must include:

1. **Cross-session highlights** — 2–4 short paragraphs synthesizing dominant friction patterns and any wins worth promoting.
   Not a copy of the retro file — the bridge between observations and proposals.
2. **Per-proposal context** — for each proposed change: the finding's label, the evidence that meets its bar, the concrete pain (with tool-call counts or specific examples), why the proposed location is the right home, and the proposed content as a fenced block.
3. **What you considered but did not propose** — name candidate changes you rejected and why.

Candidate change locations:

- `AGENTS.md` — project-wide priorities, code style, conventions.
- `.pi/prompts/*.md` — slash-command prompt bodies.
- New skill or new prompt — only if the rule is reusable across many sessions.

## Step 5 — Ask before editing

Use the `ask-user` skill once to confirm which proposals to implement; skip it when there are none.
A `steer:choice` that an earlier retro also records is its own question in that gate: is it general, or particular to these cases?
The question itself stays a single sentence; the context belongs in the message above.

## Step 6 — Implement approved changes (with scope discipline)

The retro session is scoped to **observations and small consensus-driven adjustments**, not substantive rework.
A retro commit (`docs(retro): ...`) should land the retro file plus small (~1–3 file) prompt or `AGENTS.md` adjustments the user explicitly confirmed.

If a proposed change is larger — touches more than ~3 files, restructures content significantly, or rewrites a prompt's scope — record it in the retro file as a follow-up but **do not** implement it inline.
Suggest the user open a GitHub issue and run `/plan-issue` on it.

When an issue is actually filed during the retro, load the `roadmap-fit` skill and follow it for each one — an issue spun off while its package has an open improvement phase gets a recorded disposition now, not at phase close.
The skill exits at its first step when no phase is open.

## Step 7 — Verbosity check before landing changes

Retro-driven additions to `AGENTS.md` and prompt bodies should land as **rule + tight example**, not **rule + rationale + worked example**.
The retro file is the right home for rationale and worked examples.

First, put each proposed addition to `AGENTS.md`, a skill, a prompt template, or an agent definition through the `## Admission test` in `AGENTS.md`.
A passage that fails its first question is not landed anywhere; one that fails its second is landed in the named skill's body instead.
For a template, the second question fails when a skill the template loads already owns the rule — land it there, or nowhere if it is already said.
For an agent definition, it fails when the child already gets the rule from `AGENTS.md`, its dispatch prompt, or a skill its body tells it to load.

Then, for what passes, ask:

1. **Rationale placement** — is the *why* in the retro file, or has it leaked into `AGENTS.md`/prompt?
   If the latter, move it back and leave a one-clause justification, with a `Refs #N` pointer only when the issue encodes an active constraint a reader may need to trace.
2. **Example tightness** — can the example fit in one or two lines?
3. **Hedging audit** — phrases like "should generally," "typically," "usually" often signal the rule isn't crisp enough.
   Name the exceptions or drop the hedge.
4. **Sentence length** — sentences over ~30 words usually carry rationale that should be split out.

## Step 8 — Record changes made

After implementing, edit the retro file directly to append a `### Changes made` subsection under the Final Retrospective stage entry — a numbered list of changes with file paths.
Do not split this into multiple sections; one coherent list per retro.

## Step 9 — Commit and push

1. `git add` the retro file (`packages/<PKG>/docs/retro/` or `docs/retro/`), `AGENTS.md`, `.pi/prompts/`, and any other touched files.
2. Commit as `docs(retro): add retro notes for issue #N`.
   Split any `packages/<PKG>/src/` or `test/` change into its own `test:`/`refactor:` commit first — `docs:` is an unhidden changelog type, so bundling code under it cuts a pointless patch release.
3. `git push`.

If the user suggests further refinements after the commit, implement them, append to the same `### Changes made` section, and commit again.
Every change made during the retro must be recorded before the session ends.

## Step 10 — Recommend the next issue

After the retro is committed, surface the next issue to work on so the operator can start it directly.
Derive it from the shipped issue's roadmap: read the plan's dependency diagram or the package's `docs/architecture/architecture.md` for the step this issue unblocks (e.g. "unblocks #M", the next incomplete step in the roadmap's section order).
If a successor exists in the current phase, recommend `/plan-issue #M` (name the step).
If this issue completed the phase's **last** step, recommend `/finish-phase <PKG>` instead — it archives the phase to `history/` and reconciles the architecture doc; the phase-close is a manual command, never a filed issue — then `/plan-improvements <PKG>` for the next round.

When the roadmap has no successor, read the newest backlog triage (`ls -1 docs/triage/*.md | tail -1`) and recommend its highest-ranked item that is still open, naming its rank and severity.
Re-check state with `gh` — the ranking is a snapshot, and this ship may have closed items above it.
An item the triage listed under **Deferred** is not a candidate; recommending one contradicts a recorded decision.
If neither the roadmap nor the triage queues anything, say so explicitly.

## Rules

- Be conservative — only propose changes clearly justified by evidence in this session.
- Be specific — provide exact proposed text, not vague suggestions.
- Look for removals alongside additions.
- Don't duplicate — check whether a rule already exists in `AGENTS.md`, a skill, or a prompt before adding, and apply the `AGENTS.md` admission test to decide which of those it belongs in.
- Do not edit `CHANGELOG.md` — the release workflow owns it.
