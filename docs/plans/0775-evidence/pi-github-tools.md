# Evidence brief: pi-github-tools

## Purpose signal

The package exists to replace prose-driven `gh` polling in the ship workflow with deterministic, bounded, progress-streaming tools.
`packages/pi-github-tools/README.md` states it in one line: "Replaces ad-hoc `gh` CLI polling with structured tools that have exponential backoff, progress streaming, and structured success/timeout returns."

The founding issue names the motivation precisely.
Issue #17 ("Create Pi extension with GitHub CI/release tools for deterministic `/ship-issue`") records two problems with the prose approach: "The agent must repeatedly `sleep` and re-invoke `gh`, consuming turns and context on mechanical polling" and "The behavior is non-deterministic — the LLM interprets 'up to ~3 times' loosely, sometimes gives up early, and has no structured progress reporting."

The shipped surface is exactly the ship-flow shape #17 proposed: `ci_find`, `ci_watch`, `ci_list`, `release_pr_find`, `release_pr_merge`, `release_watch`, `issue_close` (`packages/pi-github-tools/src/extension.ts`).
The README's "Usage example" section presents them as one ordered flow — push, find the run, watch it, merge, find the release PR, merge it, watch for the tag, close the issue.
`AGENTS.md` § Multi-session issue lifecycle and the `.pi/prompts/` templates consume them in that order (`.pi/prompts/ship-issue.md` steps 3, 6, 7; `.pi/prompts/land-worktree.md`; `.pi/prompts/ship-no-issue.md`).

The purpose is behavioral determinism, not GitHub coverage.
Every accepted change since inception has deepened one tool's reliability rather than widened the surface: no new tool has been added since the initial import (`git log --format='%s' -- packages/pi-github-tools`, 65 commits, `commit 05d71328` is the subtree import).

## In-scope signal

**Making a tool wait where a human would wait.**
`commit 2b91c1c2` ("wait out in-progress checks in release_pr_merge") turned a single-shot merge-state read into a bounded poll loop.
`packages/pi-github-tools/docs/plans/0673-release-pr-merge-wait-for-checks.md` frames it as patience the package already sells elsewhere: "The polling idiom already exists twice in the package — `watchRelease` … and `watchRun` … This change makes `mergeReleasePR` the third instance of that shape rather than introducing new machinery."

**Making a failure legible rather than raw.**
`commit 42435206` added `classifyMergeState`, whose whole output is a named reason (`no checks reported (statusCheckRollup is empty)`, `check failed: <names>`, `merge state is <value>`).
`packages/pi-github-tools/docs/plans/0673-release-pr-merge-wait-for-checks.md` calls that `reason:` line "the prompts' new discriminator — it is what lets `/ship-issue` decide between the `gh pr merge` fallback and stopping."

**Surviving transient GitHub failures on reads.**
`commit 06c06ad4` and `commit 658f8905` added `withRetry`/`ghJsonRetrying` across every read-only `gh` call, with the curve taken from `@octokit/plugin-retry` rather than invented (`packages/pi-github-tools/docs/plans/0764-transient-retry-and-merge-verification.md` § Ecosystem grounding).

**Refusing to leave an outcome ambiguous.**
`commit e36b67ea` ("verify merge state before reporting a merge failure") re-reads the PR over REST when the merge call fails, and reports merged / not merged / could-not-verify distinctly.
`AGENTS.md` § Multi-session issue lifecycle encodes the resulting contract: "A `failed to merge` result carries the answer: `merged: false` is safe to retry, `merged: unknown` is not."

**Telling the truth about who caused an error.**
`commit 90c11b1c` ("report gh failures as errors instead of user cancellation") removed the blanket `catch {}` that blamed the user for a GitHub 503.

**Threading cancellation end to end.**
`packages/pi-github-tools/docs/plans/0005-abort-signal-threading.md` accepted an internal breaking API change to `gh()`/`git()`/`ghJson()` purely so Escape would cancel a poll loop.

**Absorbing a manual runbook once the tool can own it.**
`commit 54e549ba` deleted the `gh pr checks --watch` wait instructions from three prompt templates and `AGENTS.md` after `release_pr_merge` took over the wait.

## Candidate non-goals

- **A GitHub API client (octokit, raw REST/GraphQL over HTTP)** — the `gh` CLI is the sole external binary dependency, stated as a constraint in both plans: "The `gh` CLI is the sole external binary dependency" (`packages/pi-github-tools/docs/plans/0673-release-pr-merge-wait-for-checks.md` § Constraints from `AGENTS.md`) and "The `gh` CLI is the sole external binary dependency; verification uses `gh api`, adding no dependency" (`packages/pi-github-tools/docs/plans/0764-transient-retry-and-merge-verification.md` § Constraints).
  The REST-verification feature of #764 is the test case that proves the boundary is deliberate: it needed a REST read while GraphQL was 503-ing, and it reached for `gh api` rather than an HTTP client.
  The package has no runtime dependencies at all (`packages/pi-github-tools/package.json`), only a `@earendil-works/pi-coding-agent` peer.

- **Pi SDK types inside `src/lib/`** — "Portable business logic in `src/lib/` — no Pi SDK imports" (`packages/pi-github-tools/README.md` § Architecture); repeated as an implementation priority in `.pi/skills/package-pi-github-tools/SKILL.md` and as a named constraint in both plans.
  `packages/pi-github-tools/docs/plans/0005-abort-signal-threading.md` tests the rule explicitly, arguing `AbortSignal` is admissible because it is "a standard `AbortSignal` (Web API / Node 15+) … no Pi SDK types enter `src/lib/`."

- **Auto-retrying mutations (`gh pr merge`, `gh issue close`)** — `packages/pi-github-tools/docs/plans/0764-transient-retry-and-merge-verification.md` § Non-Goals: "The operator chose report-only for the verified-not-merged case.
  GitHub's REST best-practices guidance is to auto-retry idempotent operations only; a retried `gh issue close --comment` would also post a duplicate comment."
  Enforced structurally: `.pi/skills/package-pi-github-tools/SKILL.md` records that "Retry is opt-in at the call site … `gh()` stays single-shot so a mutation cannot acquire retry by accident."

- **Retrying `git` network operations** — same § Non-Goals: "`git fetch --tags` in `watchRelease` and `git pull --ff-only` in `performMerge` can also fail transiently, but the transient classifier is written against `gh`'s stderr vocabulary.
  Those calls only stop misreporting as aborts; they gain no retry."
  Reaffirmed in that plan's § Open Questions as "Deferred, not filed."

- **Retrying rate limits or any 4xx, and honoring `retry-after`** — same § Non-Goals: "`gh` does not surface response headers through stdout/stderr, so there is nothing to read.
  Primary/secondary rate-limit errors (403/429) are deliberately **not** classified as transient — retrying them makes throttling worse."
  Documented in `packages/pi-github-tools/README.md` § Transient-failure retry: "Not retried: any 4xx, including rate limiting — retrying those is useless or harmful."

- **A user-configurable transient-error pattern list** — `packages/pi-github-tools/docs/plans/0764-transient-retry-and-merge-verification.md` § Open Questions: "Not now — a user-tunable regex list invites exactly the over-broad matching the first risk row guards against."

- **Auto-merging a PR the tool refuses today (empty `statusCheckRollup`)** — `packages/pi-github-tools/docs/plans/0673-release-pr-merge-wait-for-checks.md` § Non-Goals: "The issue proposed treating an empty `statusCheckRollup` as the `GITHUB_TOKEN` case and merging straight through.
  The operator chose to keep the refusal and make it explicit instead, so the tool never merges a PR it refuses today."
  The consequence is codified in `AGENTS.md`: on `reason: no checks reported`, "fall back to `gh pr merge <N> --rebase`" by hand.

- **Delegating waiting to `gh pr checks --watch`** — same § Non-Goals and § Design Overview: "`runCommand` buffers stdout until exit, so nothing would stream to `onProgress` … `gh pr checks` has no timeout flag, and its exit codes conflate the two cases this issue exists to separate."
  Verified against `gh pr checks --help`, gh 2.96.0.

- **Project-management surface (boards, milestones, status columns, DoD preflight, dev-server control)** — issue #17 reviewed the prior-art toolkit it was porting from and drew the line: "The repone tools also include issue, board, milestone, retro, dev server, and DoD-preflight tools.
  Most of those are repo-specific (hardcoded project board IDs, status columns, production URLs).
  The CI tools and the `gh`/`ghJson` helpers are the portable parts." `issue_close` was specified as "Wraps `gh issue close` with comment; deterministic, no board integration needed."

- **Hardcoding this repository's identity or workflow names** — issue #17 § Open questions rejects the prior art's hardcoded `ORG`/`REPO`: "The Pi tools should auto-detect from `gh repo view --json owner,name` or parse the git remote," and the workflow "parameter should accept a workflow name."
  Both landed: `detectRepo()` in `packages/pi-github-tools/src/lib/github.ts`, and `workflow` is a required parameter on all three CI tools (`packages/pi-github-tools/README.md`).
  `packages/pi-github-tools/docs/plans/0764-transient-retry-and-merge-verification.md` extends the same principle to the verification path: `gh api 'repos/{owner}/{repo}/pulls/N'` "expands the `{owner}` and `{repo}` placeholders from the local repo, so verification needs no `detectRepo()` call and adds no argument to the tool."

- **`promptGuidelines` blocks that spend system-prompt budget on post-result guidance** — `packages/pi-github-tools/docs/retro/0764-transient-retry-and-merge-verification.md` records the block being added to `release_pr_merge` and then removed: "it would spend system-prompt budget in every session of every consumer for guidance the ship prompts already carry."
  The rule was generalized into `.pi/skills/code-design/SKILL.md` in that retro's § Changes made.

- **Unifying status derivation across `ci.ts`, `ci-helpers.ts`, and `merge-state.ts` opportunistically** — declared out of scope twice, with the ordering fixed: "Keep them separate: [#564] should absorb the new module when it lands, not the reverse" (`packages/pi-github-tools/docs/plans/0673-release-pr-merge-wait-for-checks.md` § Non-Goals); "this change adds no new status vocabulary" (`packages/pi-github-tools/docs/plans/0764-transient-retry-and-merge-verification.md` § Non-Goals).
  This is a routing decision to issue #564, not a permanent refusal.

Two candidates are recorded as boundaries but have since been **superseded**, and should not be restated as current non-goals:

- `packages/pi-github-tools/docs/plans/0005-abort-signal-threading.md` § Non-Goals lists "Adding retry/timeout logic to one-shot tools (`release_pr_merge`, `issue_close`)."
  `commit 2b91c1c2` (#673) gave `release_pr_merge` a `timeout` and a poll loop; `commit 06c06ad4` (#764) gave its reads retry.
  `issue_close` remains one-shot.
- The same file's "Adding cancellation to `listRuns` (no poll loop …)" holds for the poll loop, but signal forwarding to `runCommand` was in scope even then.

## Adjacent routing signal

| Capability                                                               | Routed to                                                         | Citation                                                                                                                                             |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Merging a release PR with no CI checks at all                            | The operator, by hand: `gh pr merge <N> --rebase`                 | `AGENTS.md` § Multi-session issue lifecycle; `packages/pi-github-tools/docs/plans/0673-release-pr-merge-wait-for-checks.md` § Non-Goals              |
| Unified run/job status derivation                                        | Issue #564, which absorbs `merge-state.ts` later                  | `packages/pi-github-tools/docs/plans/0673-release-pr-merge-wait-for-checks.md` § Non-Goals                                                           |
| Session naming and the cross-session context bridge during the ship flow | `@gotgenes/pi-session-tools`                                      | `AGENTS.md` § Session naming convention ("Each prompt template calls `set_session_name` (from `pi-session-tools`)"); root `README.md` Packages table |
| Boards, milestones, DoD preflight, dev-server control                    | Out of the repo entirely — declined at inception as repo-specific | Issue #17 § Prior art                                                                                                                                |
| Which packages a release PR bumps, and whether to release now            | The prompt templates' `**Release:**` marker, not the tool         | `AGENTS.md` § Multi-session issue lifecycle; `.pi/prompts/land-worktree.md` step 2                                                                   |
| Merge-method policy                                                      | Extension config (`defaultMergeMethod`), set per project          | `packages/pi-github-tools/README.md` § Configuration; `AGENTS.md` (`.pi/extensions/pi-github-tools/config.json`, set in `cacc724f`)                  |

No request from an external contributor has ever been redirected or declined for this package.
Both searches came back empty:

```console
$ gh pr list --state closed --limit 300 --json number,title,body,mergedAt,author \
    --jq '.[]|select(.mergedAt==null)|select(.author.login!="gotgenes")|"#\(.number) \(.title)"' | grep -i github-tools
(no output)
$ gh issue list --state closed --limit 300 --search 'github-tools' --json number,title,stateReason \
    --jq '.[]|select(.stateReason=="NOT_PLANNED")|"#\(.number) \(.title)"'
(no output)
```

Every closed-unmerged PR from a non-`gotgenes` author targets `pi-permission-system` or `pi-subagents`.
No `pi-github-tools` issue has ever been closed as `NOT_PLANNED`.
Every boundary above was drawn by the maintainer in a plan, not in response to an outside request.

## Gaps

**The "general-purpose vs. this-repo" question is only half-answered.**
The evidence firmly refutes "scoped to this repo": repo and workflow identity are parameters, not constants (issue #17 § Open questions; `detectRepo()`), and #17 § Open questions asks openly whether the package should be standalone because "It's general enough to be useful for any Pi project with GitHub Actions + release-please."
But the release tools are shaped around **release-please specifically** — `findReleasePR` queries `gh pr list --label "autorelease: pending"` (`packages/pi-github-tools/src/lib/release.ts`), a release-please label, and no artifact states whether supporting another release automation (changesets, semantic-release) is in or out.
The operator must supply that boundary.

**No statement about non-GitHub-Actions CI or non-GitHub forges.**
`ci_find`/`ci_watch`/`ci_list` are GitHub Actions-shaped, but this is absence, not a recorded boundary.
A sentence in the README, or a declined request, would confirm it.

**No statement about growing the tool surface.**
Seven tools have been registered since inception with no addition and no recorded refusal of one.
Nothing says whether `pr_create`, `pr_review`, `issue_create`, `label_*`, or `workflow_dispatch` are out of scope, or merely unbuilt.
This is the largest gap: the strongest signal is silence in `git log`, which is absence.

**No architecture or decision records.**
Unlike `pi-subagents` and `pi-permission-system`, this package has no `docs/architecture/` or `docs/decisions/` tree — both plans note it explicitly ("`pi-github-tools` has no `docs/architecture/` roadmap, so this issue belongs to no release batch").
Boundaries therefore live only in per-issue plan § Non-Goals sections, which are scoped to their issue and not published (`packages/pi-github-tools/package.json` ships no `docs` entry).
A charter section in the README would be this package's first durable statement of scope.

**No statement on the config surface's intended size.**
`defaultMergeMethod` is the only option, and #764 declined one specific addition (the pattern list), but nothing says whether configuration is meant to stay minimal in general.

**No statement on platform support.**
`engines.node` is `>=22` and `gh` is required (`packages/pi-github-tools/package.json`, `packages/pi-github-tools/README.md` § Prerequisites), but nothing addresses Windows or a `gh`-less environment.
