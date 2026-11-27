---
description: Sweep open issues and PRs repo-wide, verify their real state, and produce a prioritized working list
---

# Triage the backlog

Optional package filter: `$1` (a package name such as `pi-permission-system`; empty means the whole repo).

Your job is to produce a **prioritized working list of GitHub issues and PRs** — what to pick up next, in order, with the reasoning attached.
Do not implement anything.
Do not review a PR in depth here; that is `/pr-review`'s job.
This template decides *what deserves attention next*, not *how to do it*.

## Relationship to `/plan-improvements`

`/plan-improvements <package>` is package-scoped and architecture-driven: it forms a cause hypothesis, proposes a numbered phase roadmap, and files the issues for it.
This template is repo-wide and demand-driven: it ranks what already exists in the tracker, issues **and** pull requests, against severity, security, and contributor cost.

The two lists are normally distinct, and a roadmap issue ordinarily works through its phase sequence rather than this list.
There is one deliberate exception, and it matters more than it sounds:

> When a roadmap or architecture issue **unblocks or decides** one or more backlog items, promote it into this list at a priority reflecting everything it unblocks, not its own size.

A design-decision issue that five open requests are all waiting on outranks any one of them.
Name the dependants explicitly when you promote it (see Keystone detection).

## Sync with remote (do this first)

1. Run `git pull --ff-only`.
2. If it fails for **any** reason — uncommitted changes, divergent history, merge conflict, network error, detached HEAD — stop immediately and report the failure.
   Do not stash, rebase, force, or otherwise resolve.
3. Only proceed on a clean fast-forward (or `Already up to date.`).

Call `set_session_name` with `Backlog triage — <YYYY-MM-DD>` (append `(<pkg>)` when `$1` is set).

## Load skills

- `github-voice` — required before drafting any contributor-facing text.
- `markdown-conventions` — for the output document.
- `package-<PKG>` — for each package with items in scope; load the one for `$1` when filtered.
- `reading-artifacts` — before citing a plan, ADR, PR status, or third-party report in a verdict.
- `clarification-gates` — before the `ask_user` gate.
- `git-workflow` and `shell-traps` — before the commit, any `gh` mutation, and any pipeline or loop.

## Step 1: Read the prior triage and decision artifacts

Start here, before touching the tracker.
Ranking without the prior record re-derives settled decisions, silently re-defers the same items, and re-litigates directions already agreed with a contributor.

Read, in this order:

1. **The most recent prior triage** — `ls -1 docs/triage/*.md | tail -3`, then read the newest.
   Carry forward five things specifically: its **Deferred** list, its **Keystones**, its **Waiting on us** and **Waiting on others** entries (one **Blocked on others** section in older documents), its **Scope alignment** verdicts, and the ranks it assigned.
   You are accountable for what it deferred; see the repeat-deferral rule below.
   A recorded scope verdict is settled and carries forward untouched unless the package's charter or the item itself changed since that triage's date — see Step 6.
2. **PR-review triage notes** — `docs/retro/` and `packages/*/docs/retro/`, whose `## Stage: PR Review` entries record the direction already chosen for a PR (adopt as-is, adopt with simplified design, decline, or await reporter).
   A direction recorded there is **settled**: rank the follow-through, do not re-open the decision.
3. **Active improvement roadmaps** — the `## Improvement roadmap` section of each `packages/*/docs/architecture/architecture.md`.
   An issue already sequenced in a phase belongs to that phase and stays out of this list, unless it is a keystone (see the promotion rule above).
4. **Existing plans** — `docs/plans/` and `packages/*/docs/plans/`.
   An issue with a committed plan is already planned; note its `**Release:**` marker and rank the execution, not the planning.
5. **What closed since the last triage** — issues and PRs closed after the prior triage's date, including PRs closed **unmerged**, which usually means the capability was adopted and reimplemented rather than rejected.
   Check who closed each one: `gh api repos/gotgenes/pi-packages/issues/<N>/events --jq '[.[] | select(.event=="closed") | .actor.login] | last'`.
   A PR its own author closed with no maintainer comment was withdrawn, and the issue it fixed is unowned again.

This material feeds the "Since the last triage" section of the output and constrains the ranking that follows.

### Repeat deferrals

An item deferred across two or more consecutive triages gets an explicit decision this run — schedule it, defer it with a recorded rationale, or recommend closing it as not-planned.
Never silently re-defer.
Surface these as an `ask_user` decision rather than deciding yourself; they are preference-sensitive judgments the user should own.
Bundle them into a single call rather than one round-trip per item.

While a package has no open phase, an item an archived phase deferred "to a later phase" belongs to that package's next `/plan-improvements` sweep: record the handoff once and stop carrying it in Deferred.
Find repeat deferrals by intersecting the issue numbers in the last two triages' Deferred sections.

## Step 2: Gather the raw state

Collect issues and PRs together; a backlog that ignores open PRs understates the real queue and hides the contributor-facing cost.

```bash
gh issue list --state open --limit 200 --json number,title,author,labels,createdAt,comments,reactionGroups
gh pr list --state open --limit 200 --json number,title,author,createdAt,updatedAt,isDraft,comments,reviews,reactionGroups
```

Filter by the `pkg:$1` label (issues) and changed paths (PRs) when `$1` is set.

Then list every open number the prior triage never names: `for n in <open numbers>; do grep -q "#$n\b" <prior triage> || echo "$n"; done`.
Each is new since its date or was dropped by it; classify and rank a dropped item this run, and name it in "Since the last triage".

For every open PR, resolve its **real** state:

```bash
gh pr view <N> --json number,author,headRefOid,mergeable,mergeStateStatus,additions,deletions,changedFiles,statusCheckRollup
```

The first call only *triggers* GitHub's merge computation — `mergeable` returns `UNKNOWN` from a single-PR query too, not just from a list query.
Query every PR once, then re-query the ones still `UNKNOWN` a few seconds later.

A scope verdict is a verdict about a diff, not about a number: inherit a PR's prior verdict only when its head SHA is unchanged, and re-derive it when the head moved.

Also record, for each item: the author, whether they are a third party (compare to `gh api user --jq .login`), the age since creation, and the age since the **last maintainer response**.
Compute every age with `date`, never by hand: `echo $(( ( $(date -u +%s) - $(date -u -d <createdAt> +%s) ) / 86400 ))`.
The issue list's `comments` field carries each comment's author and timestamp, so the last maintainer response is one expression: `jq '.[] | {number, last: ([.comments[] | select(.author.login == "<login>") | .createdAt] | max)}'`.
The PR list's `comments` and `reviews` fields carry the same for a PR.

### Demand signals

Record three more facts per item; apart from the author's own words, they are the only evidence of who wants it.

1. **Reactions**: the positive ones in `reactionGroups` (`THUMBS_UP`, `HEART`, `HOORAY`, `ROCKET`).
2. **Additional commenters**: distinct people other than the author, the maintainer, and bots who commented or reviewed.
   Filter bots (`copilot-pull-request-reviewer`, any `[bot]` login) before a count reaches a table or an `ask_user` briefing.
3. **Author standing**: `credited` (a merged PR or a `Co-authored-by` trailer on `main`), `returning` (items here at least seven days apart), or `new` (a first visit).
   Count trailers, not merged PRs alone: this repo reimplements adopted work, so most adopted contributors have nothing merged.
   The history comes from `gh issue list --state all --limit 2000 --json author,createdAt` and its `gh pr list` twin; the credits come from `git log --format='%(trailers:key=Co-authored-by,valueonly)'`.

A reaction, or a comment from an additional commenter, dated after the prior triage is fresh demand on an old item; say so where it moves a rank.
The `reactionGroups` field carries counts only; `gh api repos/gotgenes/pi-packages/issues/<N>/reactions` lists who reacted and when.

## Step 3: Establish real CI state (do not infer it)

An empty `statusCheckRollup` means **not run**, never **passed**.
Fork PRs from first-time contributors sit at `completed/action_required` until a maintainer approves the workflow, so a PR can look healthy while nothing has ever executed.

Find the pending runs — note the state is `conclusion == "action_required"` with `status == "completed"`, not `status == "action_required"`:

```bash
gh run list --limit 30 --event pull_request --json headBranch,status,conclusion,databaseId
```

Before approving any fork workflow run, audit the escalation surface.
Approving a run executes contributor code in CI, so confirm the privileged jobs are unreachable from a fork:

1. Does the PR touch `.github/`, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, `mise.toml`, `.npmrc`, `patches/`, or `scripts/`?
   Any hit means read the diff before going further — those are the CI and install-script surfaces.
2. Are the privileged and OIDC jobs unreachable from a pull request?
   They all live in `release.yml`, whose only trigger is `workflow_dispatch` — `prepare` and `github-release` hold `contents: write`, and `publish` holds `id-token: write` for npm Trusted Publishing.
   The release pipeline holds no PAT: every job uses the default `GITHUB_TOKEN`, so the escalation surface is the workflow's own permissions rather than a long-lived secret.
   Verify that trigger rather than assuming it, since a `pull_request` trigger added there would expose all three.
3. Are there `pull_request_target`, `workflow_run`, or `issue_comment` triggers?
   Those run in a privileged context; their absence is what makes fork approval routine.
4. Is untrusted text (`github.event.*.body`, `github.head_ref`) interpolated into any `run:` block?

Record the audit result in the output document.
Approve only after it passes:

```bash
gh api -X POST repos/gotgenes/pi-packages/actions/runs/<id>/approve
```

Approval does not gate every fork run: some contributors' pushes execute CI on arrival, and the repository's fork-approval setting is not readable through the API.
The audit gates the runs you approve — it is not evidence that all contributor code waited for one.

## Step 4: Interpret failures before ranking them

A red check is evidence about *something*, but not always about the PR.

- **Read the actual failing step**, never just the conclusion.
  A failure in an unrelated package (a different workspace package's test) is infrastructure, not the contribution.
- **A failure can mask a second, real one.**
  A flaky first failure that is re-run may fail *differently* the second time; that second failure is usually the real gate.
  Recommend a single re-run when a failure looks environmental (disk errors, timeouts, unrelated packages) and **ask the user before running it** — then read the new failure rather than assuming the re-run cleared it.
- **Cross-package flake is a first-class backlog item.**
  When an unrelated package's flake fails a contributor's PR, that flake is no longer only an internal tax — it produces false red on outside contributions and forces re-runs to distinguish signal from noise.
  Raise the priority of the issue tracking it, and say so in the rationale.
- **Green CI is not safety.**
  CI has no opinion about whether a design widens a security boundary, introduces an ungated configuration channel, or contradicts an ADR.
  Never let a passing check raise a security-relevant PR's rank.
  It is no evidence of scope either — see Step 6.

## Step 5: Verify claims that drive priority

Rank on what is true now, not on what an issue or PR body asserts.
Two checks pay for themselves repeatedly:

1. **Does the reported defect still exist on `main`?**
   Search for the guard: `git log --oneline -S "<symbol>" -- <path>`, then `git tag --contains <sha>` for the first release containing it.
   A defect already fixed in an earlier release is a version-support question, not backlog work — rank it accordingly and ask the reporter for their version.
2. **Is a PR's green check stale?**
   Compare the run's date against the base files' recent history (`git log -3 -- <path>`).
   A check that ran before the files it touches changed proves nothing about merging today.
   Do not merge on a stale green — verify against current `main` first.

The full verification protocol lives in `/pr-review`; do only as much here as the ranking requires, and defer the rest.

## Step 6: Check scope alignment before scoring

Severity, likelihood, blast radius, and response cost all measure how much an item matters *if we do it*.
None asks the prior question: do we want it at all?
Answer that first, or a well-argued request for a capability a package deliberately does not offer ranks high and stays high, run after run.

Read `## Scope and non-goals` in `packages/<pkg>/README.md` — only for the packages with items in scope, not all nine.
That section is the charter: purpose, in-scope changes, non-goals with their rationale, and where an adjacent request belongs.
A charter may also record an explicitly **open** decision and list the widenings parked on it.
An item that lands on an open decision is `aligned` and parked, never `out of scope`; say which decision it waits on.

Classify every item before it is scored:

| Verdict        | Meaning                                                           | Effect                                                              |
| -------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------- |
| `aligned`      | Inside the package's purpose and in-scope list                    | Scored and ranked normally                                          |
| `adjacent`     | A real need, wrong package or wrong layer                         | Scored and ranked; name the package or extension point that owns it |
| `out of scope` | Excluded by a specific non-goal                                   | No severity rank; a recommended disposition instead                 |
| `no charter`   | No package owns it — repo tooling, a prompt template, CI, install | Scored and ranked normally; no scope call                           |

Five rules keep the gate honest:

1. **Cite the non-goal; never paraphrase a boundary into existence.**
   An `out of scope` verdict quotes the bullet it rests on.
   A decision record the charter cites counts as the charter where it names the item or its mechanism; quote the record and say the verdict rests on it.
   If no bullet covers the item, the verdict is `aligned`, `adjacent`, or a question for the user — never `out of scope`.
   Do not invent a charter to justify a decline.
2. **An item labeled for several packages is out of scope only if every named charter excludes it.**
   One charter that admits it makes it `aligned` there.
3. **`no charter` is not a decline.**
   It records that the question does not apply — the item is scored on the four axes exactly as before.
4. **Weight the gate harder for a PR than for an issue.**
   An issue proposes; a PR arrives with sunk contributor effort, a working implementation, and often a green check.
   That pressure is real, and it is not evidence of alignment — green CI has no opinion about scope, for the same reason it has none about security.
   An out-of-scope PR still needs a timely answer, so give its disposition a response urgency even though it gets no severity rank.
5. **When alignment is genuinely unclear, ask rather than decide.**
   Bundle the question into the same `ask_user` call as the Step 1 repeat deferrals; do not open a second round-trip.

A verdict recorded in a prior triage's **Scope alignment** section is settled — inherit it rather than re-deriving it.
Re-check only when one of the two sides it rests on changed since that triage's date:

```bash
git log --since=<prior triage date> --oneline -- packages/<pkg>/README.md
gh issue view <N> --json updatedAt,title,body
```

A charter edit reopens the verdicts citing that package; a materially changed item reopens its own.
Record each re-check as `unchanged` or as the new verdict with what changed.

The verdict is a document entry, not a mutation.
Closing an out-of-scope item, labeling it, and replying to its author all remain recommendations until the operator approves them — see [Mutations you may perform](#mutations-you-may-perform).

## Step 7: Score each item

Score on four axes; keep them separate rather than collapsing them into one number too early.

1. **Severity** — security > data loss / corruption > crash > silent wrong result > visible bug > friction > enhancement.
   A *silent* wrong result outranks a *noisy* failure: the user cannot tell it is wrong.
2. **Likelihood** — how often the failure path is actually reached in normal use.
   A latent hardening fix with no current exploit path ranks below a bug that fires on every turn.
3. **Blast radius** — who is affected: all users, one platform, integrators, or only this repo's own workflow.
   Include the repo's own throughput here; a flake that taxes every implementation session is real cost.
4. **Response cost** — how long an outside contributor has been waiting, and how much of their effort is already sunk.

**Demand is a tiebreaker inside a severity band, not a fifth axis.**
It orders two items of like severity and never lifts an enhancement over a bug or a security fix.
It also audits a rationale: "no external demand" is a measured claim, so check an item's reactions and additional commenters before recommending or executing a close that rests on it.
An author with several open items and no reply on any, or one who withdrew a PR unanswered, raises the response cost of everything of theirs still open.

Hold **merit** and **urgency of response** apart, and label which one is driving a rank.
A PR whose design you intend to decline can still be the most urgent thing to *answer*.
Say "this is ranked high to respond, not to merge" in the rationale when that is the case, so the list is not misread as an endorsement.

## Step 8: Keystone detection

Before ordering, look for convergence: several open items that are all really asking one unanswered question.

Signals: multiple issues requesting variations of the same capability; several PRs implementing overlapping designs; issue bodies citing each other or citing a deferral in the source; a third party implementing a slice of an issue you already own; distinct users reacting to one old thread or adding use cases to it.

When you find one, name the **keystone** — the decision that answers the cluster — and promote it above its dependants even if it is an architecture or ADR issue that would otherwise live in a `/plan-improvements` phase.
List its dependants explicitly by number.
Deciding a keystone converts N separate judgment calls into N answers by reference, and prevents answering them inconsistently one at a time.

Also flag the inverse: a third-party PR implementing a blunter version of a design you have already specified.
The existing issue is the answer to that PR; note the pairing rather than reviewing the PR on its own terms.

## Step 9: Interleave

Produce one list, not separate ours/theirs lists.
Group by theme where our issues and third-party work converge, then order across themes.
Working two items in the same area back to back reuses a loaded mental model; splitting them across weeks pays the context cost twice.

Standing priority: **bugs and security first**, then contributor-facing debt, then enhancements.

## Mutations you may perform

Only these, and only with the stated confirmation:

- **Apply missing labels** (`bug`, `enhancement`, `pkg:<name>`) — do this directly when the correct label is objectively determined by the issue template or body.
  Report what you changed.
- **Approve fork CI runs** — only after the Step 3 audit passes.
  Report the audit result.
- **Post contributor comments** (holding replies, change requests, version requests) — draft with the `github-voice` skill and confirm through `ask_user` before posting.
  A holding reply should say plainly that the item is parked and why, name the issue it is parked on, and avoid committing to a design shape the maintainer has not decided.
  Each run drafts replies for the five longest-waiting or highest-ranked **Waiting on us** items and confirms them in the same `ask_user` call as the closes.
  Record a declined draft with the operator's reason, or as declined without one.
- **Close approved items** — an item whose close the operator approved, in this run's `ask_user` or as recorded by a prior triage, once its reply is posted.
  Confirm the close list in the same `ask_user` call as the other decisions, and record each close in the document.
- **File an issue the triage found** — a gap no open issue tracks, such as a missing disclosure channel or an admitted seam nobody built.
  Draft it with `github-voice`, confirm it in the same `ask_user` call, load `roadmap-fit` at the filing point, and record it in the document.

Everything else is a recommendation, including merging, re-running CI, and any close the operator has not approved.
That covers a Step 6 scope decline: it is recorded in the document as a recommended disposition until the operator approves the close.
Never merge from this template.

## Output

Write `docs/triage/<YYYY-MM-DD>-backlog.md` (create `docs/triage/` if needed).
Get the date from `date -u +"%Y-%m-%d"` — never write one from memory.

Frontmatter:

```yaml
---
date: "2026-07-28"
scope: "repo" # or the package name when $1 is set
open_issues: 26
open_prs: 9
---
```

The document contains:

1. **Since the last triage** — from the Step 1 artifacts: what closed, what landed, what changed rank, and the disposition of every item the prior run deferred.
   Skip on the first run.

2. **Demand signals**: what the Step 2 demand data showed, kept to what moved a rank, reversed a recorded rationale, or exposed a cluster of unanswered authors.
   Define the `Demand` column's notation here.

3. **Scope alignment** — the Step 6 verdicts, so the next run inherits them instead of re-deriving them.
   One row per item classified this run, each with its package, verdict, and the non-goal or reason it rests on:

   | Item | Package      | Verdict      | Basis                                                              |
   | ---- | ------------ | ------------ | ------------------------------------------------------------------ |
   | #740 | pi-subagents | out of scope | Non-goal: *A global run-mode default* — run mode is per-invocation |

   Follow it with the recommended disposition for each `out of scope` item (close as not-planned citing the non-goal, or redirect), and a **Carried forward** subsection recording the verdicts inherited from the prior run, the head SHA each PR verdict was taken against, and the outcome of any re-check.

4. **The prioritized table** — the deliverable, carrying only `aligned`, `adjacent`, and `no charter` items:

   | Rank | Item  | Package(s)           | Kind                 | Severity  | Demand                               | Why now                                         |
   | ---- | ----- | -------------------- | -------------------- | --------- | ------------------------------------ | ----------------------------------------------- |
   | 1    | #639  | pi-permission-system | issue (3p, credited) | keystone  | 8 reactions, 4 additional commenters | Decides #671, #684, #680, #603, #604            |
   | 2    | #1020 | pi-permission-system | issue (ours)         | dead deny |                                      | Every `~`-prefixed `bash` rule is dead on win32 |

   Use `#N` bare (they auto-link on GitHub) and keep `Why now` to one sentence.
   `Kind` marks each item `ours` or `3p` (third party), and a `3p` row names the standing of its strongest third-party author: `credited` (a merged PR or a `Co-authored-by` credit on `main`), `returning` (items here at least seven days apart), or `new` (a first visit), as in `issue (3p, new)` or `issues (ours, 3p, returning)`.
   `Demand` spells out what was measured in words: `3 reactions, 2 additional commenters`, where an additional commenter is a distinct person other than the author, the maintainer, and bots who commented or reviewed.
   Write `1 reaction` and `1 additional commenter` in the singular, omit a zero part, and leave the cell empty when both are zero.
   A row grouping several items sums the reactions and counts each commenter once; a keystone row includes its dependants.
   The `Package(s)` column lets the reader pick items that can run in parallel: work on different packages parallelizes, work on the same package does not.
   Name every package an item touches (the issue's `pkg:` labels, or the PR's changed `packages/<pkg>/` paths), comma-separated, without the `@gotgenes/` scope; write `repo` for a `scope:repo` item.
   A row grouping several items lists the union of their packages.
   For an `adjacent` item, name the owning package or extension point there.

5. **Next item per package** — the prioritized table regrouped into parallel lanes, one row per package with at least one ranked item:

   | Package              | Next          | Then        | Command               |
   | -------------------- | ------------- | ----------- | --------------------- |
   | pi-permission-system | #1001 (1)     | #997 (2)    | `/plan-issue #1001`   |
   | pi-subagents         | #1008 (8)     | #987 (9)    | `/plan-issue #1008`   |

   `Next` is the lane's highest-ranked actionable item, with its global rank in parentheses; `Then` is the one after it.
   Skip items waiting on someone else (see Waiting on others) and items whose disposition is only a reply or a close — a lane is work a session can start.
   An item spanning several packages occupies every lane it names: list it in each and say so (`#722 (21, also pi-subagents)`), because running it blocks all of them.
   Order the rows by their `Next` item's global rank, and use `repo` as the lane for `scope:repo` items.

6. **Keystones** — each keystone with its dependants listed by number.

7. **Findings that changed a rank** — the verification results from Steps 4 and 5: stale greens, defects already fixed, flakes masking real failures, green-but-misaligned PRs.

8. **CI and security audit** — the Step 3 audit outcome, and which runs were approved.

9. **Waiting on us**: every item that owes a maintainer action, split into never answered and follow-up owed, each with its days waiting.
   Produce the never-answered list with one expression over the Step 2 data, not by hand.

10. **Waiting on others** — items waiting on a contributor (rebase, version confirmation, change requests) with how long they have waited.

11. **Deferred** — what you consciously did not rank, and why, so the next run does not silently re-derive it.
   An `out of scope` item is not deferred — it belongs to the Scope alignment section, with a disposition rather than a rationale for waiting.

Before committing, recompute every count the prose states (pending closes, days waiting, items in a list) with a command over the list it counts.
A number in an `ask_user` briefing is held to the same rule.
Confirm every open number appears in the document, a range counting for the numbers inside it: `for n in <open numbers>; do grep -qE "#$n\b" <document> || echo "$n"; done`.

Then present a short summary in the session and commit:

```bash
git add docs/triage/<YYYY-MM-DD>-backlog.md
git commit -m "docs(triage): prioritize backlog for <YYYY-MM-DD>"
```

Do not push; leave that to the user.

## Finally

Recommend the single next action and the command to run for it — usually `/plan-issue #N` for the top-ranked issue, or `/pr-review #N` for the top-ranked PR.
Then name the `Next` item of each other lane as what a parallel session could start, pointing at the Next item per package table rather than repeating it.
Stop there.
