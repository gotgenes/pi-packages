---
description: Sweep open issues and PRs repo-wide, verify their real state, and produce a prioritized working list
model: anthropic/claude-opus-5
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

## Step 1: Read the prior triage and decision artifacts

Start here, before touching the tracker.
Ranking without the prior record re-derives settled decisions, silently re-defers the same items, and re-litigates directions already agreed with a contributor.

Read, in this order:

1. **The most recent prior triage** — `ls -1 docs/triage/*.md | tail -3`, then read the newest.
   Carry forward five things specifically: its **Deferred** list, its **Keystones**, its **Blocked on others** entries, its **Scope alignment** verdicts, and the ranks it assigned.
   You are accountable for what it deferred; see the repeat-deferral rule below.
   A recorded scope verdict is settled and carries forward untouched unless the package's charter or the item itself changed since that triage's date — see Step 6.
2. **PR-review triage notes** — `docs/retro/` and `packages/*/docs/retro/`, whose `## Stage: PR Review` entries record the direction already chosen for a PR (adopt as-is, adopt with simplified design, decline, or await reporter).
   A direction recorded there is **settled**: rank the follow-through, do not re-open the decision.
3. **Active improvement roadmaps** — the `## Improvement roadmap` section of each `packages/*/docs/architecture/architecture.md`.
   An issue already sequenced in a phase belongs to that phase and stays out of this list, unless it is a keystone (see the promotion rule above).
4. **Existing plans** — `docs/plans/` and `packages/*/docs/plans/`.
   An issue with a committed plan is already planned; note its `**Release:**` marker and rank the execution, not the planning.
5. **What closed since the last triage** — issues and PRs closed after the prior triage's date, including PRs closed **unmerged**, which usually means the capability was adopted and reimplemented rather than rejected.

This material feeds the "Since the last triage" section of the output and constrains the ranking that follows.

### Repeat deferrals

An item deferred across two or more consecutive triages gets an explicit decision this run — schedule it, defer it with a recorded rationale, or recommend closing it as not-planned.
Never silently re-defer.
Surface these as an `ask_user` decision rather than deciding yourself; they are preference-sensitive judgments the user should own.
Bundle them into a single call rather than one round-trip per item.

## Step 2: Gather the raw state

Collect issues and PRs together; a backlog that ignores open PRs understates the real queue and hides the contributor-facing cost.

```bash
gh issue list --state open --limit 200 --json number,title,author,labels,createdAt,comments
gh pr list --state open --limit 200 --json number,title,author,createdAt,updatedAt,isDraft
```

Filter by the `pkg:$1` label (issues) and changed paths (PRs) when `$1` is set.

For every open PR, resolve its **real** state one at a time — a list query returns `UNKNOWN` for `mergeable` because GitHub computes it lazily:

```bash
gh pr view <N> --json number,author,mergeable,mergeStateStatus,additions,deletions,changedFiles,statusCheckRollup
```

Also record, for each item: the author, whether they are a third party (compare to `gh api user --jq .login`), the age since creation, and the age since the **last maintainer response**.

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
2. Are the secret-bearing and OIDC jobs gated off pull requests?
   `release-please` (holds `RELEASE_PLEASE_TOKEN`, `contents: write`) and `publish` (holds `id-token: write` for npm Trusted Publishing) must be unreachable — verify their `if:` conditions rather than assuming.
3. Are there `pull_request_target`, `workflow_run`, or `issue_comment` triggers?
   Those run in a privileged context; their absence is what makes fork approval routine.
4. Is untrusted text (`github.event.*.body`, `github.head_ref`) interpolated into any `run:` block?

Record the audit result in the output document.
Approve only after it passes:

```bash
gh api -X POST repos/gotgenes/pi-packages/actions/runs/<id>/approve
```

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
A charter may also record an explicitly **open** decision — `pi-permission-system`'s names the policy-source question (#639) and lists the widenings parked on it.
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
Closing an out-of-scope item, labeling it, and replying to its author all remain recommendations — see [Mutations you may perform](#mutations-you-may-perform).

## Step 7: Score each item

Score on four axes; keep them separate rather than collapsing them into one number too early.

1. **Severity** — security > data loss / corruption > crash > silent wrong result > visible bug > friction > enhancement.
   A *silent* wrong result outranks a *noisy* failure: the user cannot tell it is wrong.
2. **Likelihood** — how often the failure path is actually reached in normal use.
   A latent hardening fix with no current exploit path ranks below a bug that fires on every turn.
3. **Blast radius** — who is affected: all users, one platform, integrators, or only this repo's own workflow.
   Include the repo's own throughput here; a flake that taxes every implementation session is real cost.
4. **Response cost** — how long an outside contributor has been waiting, and how much of their effort is already sunk.

Hold **merit** and **urgency of response** apart, and label which one is driving a rank.
A PR whose design you intend to decline can still be the most urgent thing to *answer*.
Say "this is ranked high to respond, not to merge" in the rationale when that is the case, so the list is not misread as an endorsement.

## Step 8: Keystone detection

Before ordering, look for convergence: several open items that are all really asking one unanswered question.

Signals: multiple issues requesting variations of the same capability; several PRs implementing overlapping designs; issue bodies citing each other or citing a deferral in the source; a third party implementing a slice of an issue you already own.

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

Everything else is a recommendation, including merging, closing, re-running CI, and declining a PR.
That covers a Step 6 scope decline: it is recorded in the document as a recommended disposition, never applied as a label, a comment, or a close.
Never merge or close from this template.

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
2. **Scope alignment** — the Step 6 verdicts, so the next run inherits them instead of re-deriving them.
   One row per item classified this run, each with its package, verdict, and the non-goal or reason it rests on:

   | Item | Package      | Verdict      | Basis                                                              |
   | ---- | ------------ | ------------ | ------------------------------------------------------------------ |
   | #740 | pi-subagents | out of scope | Non-goal: *A global run-mode default* — run mode is per-invocation |

   Follow it with the recommended disposition for each `out of scope` item (close as not-planned citing the non-goal, or redirect), and a **Carried forward** subsection recording the verdicts inherited from the prior run and the outcome of any re-check.
3. **The prioritized table** — the deliverable, carrying only `aligned`, `adjacent`, and `no charter` items:

   | Rank | Item | Kind         | Severity | Why now                              |
   | ---- | ---- | ------------ | -------- | ------------------------------------ |
   | 1    | #639 | issue (ours) | keystone | Decides #671, #684, #680, #603, #604 |

   Use `#N` bare (they auto-link on GitHub), mark third-party items, and keep `Why now` to one sentence.
   For an `adjacent` item, name the owning package or extension point there.
4. **Keystones** — each keystone with its dependants listed by number.
5. **Findings that changed a rank** — the verification results from Steps 4 and 5: stale greens, defects already fixed, flakes masking real failures, green-but-misaligned PRs.
6. **CI and security audit** — the Step 3 audit outcome, and which runs were approved.
7. **Blocked on others** — items waiting on a contributor (rebase, version confirmation, change requests) with how long they have waited.
8. **Deferred** — what you consciously did not rank, and why, so the next run does not silently re-derive it.
   An `out of scope` item is not deferred — it belongs to the Scope alignment section, with a disposition rather than a rationale for waiting.

Then present a short summary in the session and commit:

```bash
git add docs/triage/<YYYY-MM-DD>-backlog.md
git commit -m "docs(triage): prioritize backlog for <YYYY-MM-DD>"
```

Do not push; leave that to the user.

## Finally

Recommend the single next action and the command to run for it — usually `/plan-issue #N` for the top-ranked issue, or `/pr-review #N` for the top-ranked PR.
Stop there.
