---
issue: 958
issue_title: "pi-subagents: the relocated-child project-context cut (#918) never fires on pi ≥0.86 section prompts — relocated children inherit the parent's absolute-path context block"
pr: 959
---

# Retro: #958 — the relocated-child project-context cut never fires on pi ≥0.86 section prompts

## Stage: PR Review (2026-09-20T20:59:00Z)

### Session summary

PR [#959] from @georgeharker teaches `session/prompts.ts`'s session-resolved-tail anchors to recognize pi ≥0.86's section-shaped system prompt, so [#918]'s relocated-child `<project_context>` cut fires again.
The defect was confirmed against real 0.86.1 prompt bytes on current `main`, not against the PR's narrative: a relocated child inherits the parent's `<project_context>` block naming the parent's files by absolute path, and every 0.86 child — relocated or not — inherits a dangling, unclosed `<skills>` open tag.
The operator chose **adopt mostly as-is**: merge the PR, then land follow-up commits on top for the two naming and comment nits.

### Evaluation

#### The defect is real, live, and reachable

I generated a parent prompt from the actual 0.86.1 dist rather than a hand fixture — a scratch `pnpm install @earendil-works/pi-coding-agent@0.86.1`, calling `buildSystemPrompt` directly — and confirmed all three deltas the PR claims. pi 0.86 renders the cwd as a `<cwd>` section (no `Current working directory:` footer), wraps the catalogue in a `<skills>` section, and drops the blank line below `<project_context>`'s opening tag so the lead-in sits at `openAt+1`.
Cross-checked against pi's own source at `../pi`: `buildSystemPromptSections` wraps each section as `<name>\n…\n</name>` and `getSystemMessageText` joins them with `"\n\n"`.

Fed through current `main`'s `buildAgentPrompt` with a relocated child, the child prompt came back carrying the parent's full `<project_context>` block naming `/parent/AGENTS.md`, plus an unclosed `<skills>` tag — the latter on *every* 0.86 child, because the cut lands on the heading inside the wrapper rather than on the wrapper.

Reachability is not hypothetical: `pi --version` reports 0.86.1, and `.pi/settings.json` loads `pi-subagents-worktrees`, the `WorkspaceProvider` that creates relocated children.
The peer range is `>=0.81.0`, unbounded above.
Not already fixed — `main`'s `prompts.ts` has no `<cwd>` handling at all.

#### Checks, run in a scratch worktree rather than trusted

`pnpm run check` passes for all 9 packages; `pnpm run lint` is clean across Biome (713 files), ESLint (1220 files), and `rumdl`; the `pi-subagents` suite is 1803/1803 across 79 files.
The 4 `test/config/custom-agents.test.ts` failures the contributor reported did not occur here, confirming his read that they are an ambient `PI_CODING_AGENT_DIR` leak rather than a code defect.

Killing mutation verified independently: replaying `main`'s `prompts.ts` under the PR's test file fails exactly 5 of the 7 new tests, matching the contributor's claim.
The PR branch also handles the **real** 0.86.1 prompt bytes for both the relocated and same-cwd cases, not merely its own fixtures.

#### Approach

Sound and idiomatic, which is why it clears the usual third-party bar.
Dispatch is on *which cwd layer is present*, never a version check, and it lives at one point (`tailStart`) — OCP's decide-once.
`cwdSectionStart` applies the same whole-line content discipline the 0.85 footer anchor uses, and `skillsSectionWrapperStart` validates the wrapper by pi's own heading before cutting at the opening tag.
No speculative generality, no over-wide threading, no new parameters on a shared interface; the four new constants match the existing `SKILLS_CATALOGUE_CLOSE` / `PROJECT_CONTEXT_OPEN` convention.

Two nits, both for follow-up commits rather than a request-changes round:

1. `tailStart(lines, parentCwd)` is declared directly below `sessionResolvedTailStart(lines, parentCwd, cutProjectContext)` — two names that do not distinguish two functions.
   Rename (`cutAnchor`, `layerAnchor`) or fold it back in.
2. `projectContextStart` now accepts the lead-in at `openAt+1` **or** `openAt+2`.
   Correct, but the `+2` arm becomes dead the moment the peer floor moves past 0.85; it needs a note so it is removed rather than inherited.

The hand-built 0.86 fixtures are the right call, not a shortcut: `buildSystemPromptSections` is absent from 0.86.1's public exports (checked `dist/index.d.ts`), so no test can route through pi's real section renderer.
The skills layer still goes through the exported `formatSkillsForPrompt`.

Not breaking — the ≤0.85 path is byte-identical and behavior changes only on 0.86, where it is broken today.
`fix:` is the correct type.

#### Two adjacent defects, both filed out

Same root cause, different code paths, both verified live and both deliberately kept out of [#959]'s diff:

- [#961] — `session/project-context.ts`'s `renderProjectContext` still emits the ≤0.85 block shape (a blank line below the opening tag and above the closing tag, neither of which 0.86 writes), while its doc comment claims byte-identity with pi's block.
  Its consumers are exactly the relocated and `portable` children this issue is about.
  `pi-subagents` has no open improvement phase, so `roadmap-fit` recorded nothing.
- [#962] — `@gotgenes/pi-permission-system`'s `exposure/tool-surface-prompt.ts` anchors on `Current working directory: `, `Available tools:`, and `Guidelines:`, none of which 0.86 writes (it writes `<cwd>`, `<tools>`, `<rules>`).
  The relocation is therefore a no-op and a session sees pi's unfiltered tool list above the narrowed block — the live witness being this session's own system prompt.
  Dispositioned **out of scope** for pi-permission-system Phase 15 on [#890]'s precedent for the same `exposure/` module, recorded in that roadmap's sweep list.

`packages/pi-nocd/src/working-directory-prompt.ts` mentions the footer only in a doc comment; its code is heading-anchored and unaffected.

### Decision and attribution

**Direction: adopt mostly as-is.**
Merge [#959] as the implementation of [#958], then land follow-up commits on top for the two nits above (the `tailStart` naming collision and the dead-arm note on `projectContextStart`).
This departs from the usual adopt-with-simplified-design default because the diff already is the simplified design: it is minimal, convention-fitting, independently verified against real 0.86.1 bytes, and carries a test suite with a confirmed killing mutation.

**Landing plan.**
The PR has `maintainerCanModify: true` and is a single commit on `georgeharker:pi-subagents-086-section-anchors`, so the follow-ups are pushed **to that branch** rather than to `main` after the fact.
The PR then rebase-merges (`gh pr merge --rebase`), which keeps `main` linear, preserves per-commit authorship, and never puts the nits on `main` at all.
A fork PR's workflow runs sit at `action_required`, so each push needs a maintainer approval before CI reports.
The first real push is also what confirms the write actually lands: `maintainerCanModify` is the evidence, and a `git push --dry-run` that reports `Everything up-to-date` is not.
A PR comment should say what we pushed and why, so the branch edit is not a surprise.

Execution is handed to a fresh session rather than done here; this session's scope ends at the recorded decision.

**Non-goals**, each tracked elsewhere: the `renderProjectContext` block-shape drift ([#961]), the pi-permission-system tool-surface anchors ([#962]), and the `pi-nocd` doc-comment staleness (not filed; doc-only).
The companion `pi-claude-bridge` change the PR describes is external and moves on its own schedule.

**Attribution.**
Every follow-up commit on top of the merge carries, after a blank line at the end of the body:

```text
Co-authored-by: George Harker <george@george-graphics.co.uk>
```

The close comment on [#959] thanks @georgeharker by name and links the merged and follow-up SHAs.
Never `Closes #959` in a commit message — reference it as `Refs #959` / `(#959)` so the curated close comment is not pre-empted.

## Stage: Ship (2026-09-20T22:10:28Z)

### Session summary

The landing plan recorded at the end of the PR Review stage said execution would be handed to a fresh session; the operator chose to run it in the same one instead, so the plan itself is the only part of that entry that did not hold.
The two follow-ups were pushed to the contributor's branch, CI went green, [#959] rebase-merged, [#958] closed with credit, and `pi-subagents` v21.7.4 published.

### What landed

| SHA on `main` | Author        | Commit                                                                              |
| ------------- | ------------- | ----------------------------------------------------------------------------------- |
| `b5802825`    | George Harker | `fix(pi-subagents): recognize pi ≥0.86's section-shaped prompt in the tail anchors` |
| `1f283284`    | Chris Lasher  | `refactor(pi-subagents): name the cwd-anchored tail helper apart from its caller`   |
| `bdc32f57`    | Chris Lasher  | `docs(pi-subagents): record when the 0.85 project-context offset goes dead`         |

The rename resolved a collision the review had only half-seen: `tailStart` shadowed not just its caller's meaning but the local `tailStart` in `inheritedIdentity` a few functions above.
`cwdAnchoredTailStart` names the discriminator the function's own doc comment leads with.

Both follow-ups carry `Co-authored-by: George Harker <george@george-graphics.co.uk>` as the final paragraph, verified with `git interpret-trailers --parse`; the rebase merge kept [#959]'s own commit authored by him.

### Observations

- **`maintainerCanModify: true` is the evidence; `git push --dry-run` is not.**
  The dry run reported `Everything up-to-date` — it resolved the connection without proving the write would be accepted.
  Only the real push settled it.
- **The fork PR's CI run took roughly four minutes to be created**, during which `statusCheckRollup` was `[]` and `actions/runs?head_sha=…` returned `total_count: 0`.
  `ci_find` timed out at 125 s on a run that did eventually appear and pass.
  An empty rollup on a fork PR means *not yet created* as often as it means *awaiting approval* — neither is a failure, and the distinction is not visible from the rollup alone.
  No approval was needed here, the fork having been approved on the previous head.
- **`main` had advanced to `bdad88a4` mid-session** while three local doc commits sat unpushed.
  `git rev-parse --short main origin/main` failed with `Needed a single revision` at one point and resolved individually at another, which looked like divergence and was not: `git status -sb` read `ahead 3` and `git merge-base --is-ancestor` confirmed a clean fast-forward.
  The compound `rev-parse` was the unreliable witness, not the repository.
- **A worktree shares the repository's config**, so the `gh-fork` remote added inside `/tmp/pr-959` appeared in the root checkout's `git remote -v` after an earlier `git remote remove` in the root had apparently succeeded.
  Remove it from wherever it ends up, not from where it was added.
- **The release needed no decision beyond the dispatch.**
  `./scripts/release/next-version.sh pi-subagents` printed `pi-subagents-v21.7.4` from the `fix:` alone; the `refactor:` and `docs:` follow-ups are skipped types and would not have cut one.
  npm's `latest` lagged the successful `publish` job by about a minute — the tag and changelog land first, so a version check immediately after a green run reads stale.

[#890]: https://github.com/gotgenes/pi-packages/issues/890

## Stage: Final Retrospective (2026-09-20T22:15:52Z)

### Session summary

One session ran the whole lifecycle for [#958]: PR review, decision gate, follow-up commits pushed to the contributor's fork branch, rebase merge, issue close, and the v21.7.4 release.
The `/pr-review` Verify gate confirmed a third-party report rather than refuting it, which is the less common outcome, and the evidence it produced also surfaced a second defect in the same file and two adjacent ones in sibling packages ([#961], [#962]).
The direction landed on `adopt-as-is`, the rarer of `/pr-review`'s branches, with two non-behavioral nits pushed onto the contributor's own branch rather than onto `main` afterward.

### Observations

#### What went well

- **Generating prompt bytes from the published dist beat every hand fixture.**
  The repo pins `@earendil-works/pi-coding-agent@0.84.4`, so nothing in the tree can produce a 0.86 prompt.
  A scratch `pnpm install` of `0.86.1` into `/tmp/pi086-probe` and a five-line `gen.mjs` calling `buildSystemPrompt` produced the real bytes, which then fed a throwaway vitest against current `main`.
  That is the `reproduction` skill's organic-data-over-fixtures principle applied to an SDK version the repo does not pin, and it is the reason the review could say "verified against real 0.86.1 bytes" rather than "verified against my reading of the renderer".
- **Re-running the contributor's killing-mutation claim caught nothing, which is the point.**
  `git show main:packages/pi-subagents/src/session/prompts.ts > …`, run the suite, `git checkout` to restore: 5 of 7 new tests failed, exactly as the PR body said.
  A claim that survives independent reproduction is worth more in the close comment than one repeated from the PR.
- **The Verify gate found more than it was pointed at.**
  The dangling unclosed `<skills>` tag on *every* 0.86 child, relocated or not, is not in the issue or the PR body; it fell out of printing the actual child prompt instead of asserting against it.
  The same run of evidence produced [#961] and [#962].
- **Verification ran incrementally, not at the end.**
  The full gate (`check`, `lint`, package suite) ran after the first nit edit and again after the second, before each commit, rather than once before the push.

#### What caused friction (agent side)

- `missing-context` — wrote an import the package's own `exports` map forbids, two calls after reading that map.
  `jq -r '… (.exports|tostring)'` had already printed `{".": …, "./rpc-entry": …, "./client": …, "./experimental/plugin": …}`, and `gen.mjs` still imported `@earendil-works/pi-coding-agent/dist/core/system-prompt.js`.
  Impact: one failed `node` run plus a `perl -pi` fix, 2 extra tool calls.
  The fact was in context and unused, which is the failure mode worth naming rather than the missing lookup.
- `rabbit-hole` — chased an apparent `main` / `origin/main` divergence that did not exist.
  `git fetch origin main` updated the remote ref mid-sequence, so `git log -1 origin/main` and `git log main..origin/main` were read against different states and looked contradictory; a later `git rev-parse --short main origin/main` failed with `Needed a single revision` while each ref resolved individually.
  Impact: 4 consecutive tool calls, no rework.
  `git status -sb` answered it in one line (`ahead 3`) and should have been the first call, not the fifth.
- `other` — `ci_find`'s default 120 s timeout expired on a fork PR whose run had not been created yet.
  The run appeared at roughly 4 minutes and passed.
  Impact: one 125 s timeout plus a hand-rolled 6 × 20 s polling loop, 3 extra tool calls.
  During that window `statusCheckRollup` was `[]` and `actions/runs?head_sha=…` returned `total_count: 0`, which is indistinguishable from "awaiting approval" without knowing the latency.
- `other` — two portability misses, one call each: `cat -A` (GNU-only; BSD `cat` rejects it) and `gh pr diff <n> -- <path>` (accepts at most one argument).
  Impact: 2 tool calls, no rework.
- `other` — the `gh-fork` remote added inside the `/tmp/pr-959` worktree appeared in the root checkout, after an earlier `git remote remove gh-fork` in the root had succeeded.
  A worktree shares the repository config.
  Impact: one extra cleanup step.

#### What caused friction (user side)

- **The redirecting question outperformed a correction.**
  "Can we directly modify the PR to add our commits?" surfaced `maintainerCanModify: true`, a capability the session had not checked and that `.pi/prompts/pr-review.md` does not mention.
  It changed the landing shape from "merge, then fix on `main`" to "fix on the contributor's branch, then rebase-merge", which is strictly better and cost one question.
- **The note attached to an `ask_user` answer pre-empted a round.**
  "Make follow up commits on top to fix what we don't like" answered the next gate before it was asked.
- Opportunity, minor: the execution gate offered "here" versus "hand off", was answered "hand off", and then reversed with "Let's do it in this session" one turn later.
  The recorded landing plan had to be corrected by a Ship stage entry.
  A single "land it now" instruction at the direction gate would have skipped both.

### Diagnostic details

- **Model-performance correlation** — every turn ran on `anthropic/claude-opus-5`; no subagent was dispatched.
  Appropriate for a session that was almost entirely judgment (defect verification, design evaluation, three decision gates).
  The one candidate for delegation, the `../pi` trace for `buildSystemPrompt`, was 2 greps and 1 read of a known file, which the `code-design` skill explicitly keeps inline.
  No mismatch found.
- **Escalation-delay tracking** — two sequences: 4 consecutive calls on the phantom git divergence, and ~5 on the absent CI run.
  Neither had a subagent answer; the first wanted a different first command, the second wanted a longer timeout.
- **Unused-tool detection** — `colgrep` was never called.
  The exploration was exact-symbol throughout (`buildSystemPrompt`, `Current working directory:`, `available_skills`), which is grep's half of the decision table, so this is a correct omission rather than a gap.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check`, `pnpm run lint`, and the package suite ran after each of the two source edits and before each commit, and CI was watched to completion on the PR head, on `main`, and on the release run.

### Changes made

1. `.pi/prompts/pr-review.md` — replaced the fork-CI paragraph.
   It asserted that fork runs sit at `action_required` until approved, which did not hold: an already-approved fork runs later pushes automatically.
   The new text names both causes of an empty `statusCheckRollup` (awaiting approval, or not yet created), gives the `actions/runs?head_sha=` query that tells them apart, and directs `ci_find` to `timeout: 300` on a fork PR.
2. `.pi/prompts/pr-review.md` — added the maintainer-edit push as direction 2's third ending, gated on `gh pr view --json maintainerCanModify` reporting `true`, with the note that a `git push --dry-run` reporting `Everything up-to-date` is not evidence of write access.
3. `packages/pi-subagents/docs/retro/0958-section-shaped-prompt-anchors.md` — this Final Retrospective stage entry.

Considered and not landed: an `AGENTS.md` addition for either prompt change (both fail admission question 2 — they fire at a `/pr-review` step), a `worktrees` note that a worktree shares repository config, a `shell-traps` note that `cat -A` is GNU-only, and promoting the generate-bytes-from-the-published-dist pattern into `reproduction`, which its organic-data rule already covers.

[#918]: https://github.com/gotgenes/pi-packages/issues/918
[#959]: https://github.com/gotgenes/pi-packages/pull/959
[#961]: https://github.com/gotgenes/pi-packages/issues/961
[#962]: https://github.com/gotgenes/pi-packages/issues/962
