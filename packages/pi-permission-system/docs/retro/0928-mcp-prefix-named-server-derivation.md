---
issue: 928
issue_title: "MCP permission targets: prefix-named tools derive no server; proxy-shaped MCP clients are invisible to the mcp surface"
pr: 929
---

# MCP permission targets: prefix-named tools derive no server

## Stage: PR Review (2026-09-18T16:28:19Z)

### Session summary

PR #929 from @georgeharker makes prefix-named MCP tools (`github_search_code`, the shape the `mcp()` proxy and mcp-combiner both produce) derive a bare-server permission candidate, so an exact-server rule such as `mcp: {"github": "deny"}` can fire without an explicit `server` argument.
The defect is real and reproduces on current `main`; the PR's own gate is green.
The operator chose **adopt the capability with our own simplified design** — and the review surfaced a deeper cause than the PR addresses: `evaluateFirst`'s candidate short-circuit silently overrides the package's last-match-wins rule policy on the `mcp` surface, so the work is planned as two sequenced steps under one `feat!` bump.

### Verify gate

**Reproduced on current `main`.**
A scratch Vitest file against `createMcpPermissionTargets` (`src/access-intent/mcp-targets.ts`), since deleted:

- `createMcpPermissionTargets({ tool: "github_search_code" }, ["github", "todoist"])` → `["github_search_code", "mcp_call"]`.
  No bare `github` candidate, so `mcp: {"github": "deny"}` never fires.
  `addDerivedMcpServerTargets` requires `endsWith("_" + server)` and then explicitly `continue`s on `startsWith(server + "_")`, so a prefix-named tool falls through both guards.
- `createMcpPermissionTargets({ tool: "github_search_code", server: "github" }, [])` → `["github_github_search_code", "github:github_search_code", "github", "github_search_code", "mcp_call"]`.
  The first two candidates match nothing and push the useful ones down an ordered list.

**Not already fixed.**
`git log -S` over `src/` finds no prior guard; the only commit touching this region is `d4318c92` (a directory move, #579).
The `startsWith` skip has been there since the module was extracted.

**Real boundary confirmed.**
`normalizeInput` (`src/access-intent/input-normalizer.ts:175`) is the only caller, reached from `PermissionManager.check` (`src/policy/permission-manager.ts:339`) with `loader.getConfiguredMcpServerNames()`.
The PR touches exactly that path.

**Reachability for us.**
This repo runs no MCP adapter: `~/.pi/agent/mcp.json` is absent, so `getConfiguredMcpServerNames()` returns `[]` and the derivation is a no-op; no `mcp` tool is registered, so `classifyToolKind` never routes to the surface.
We are immune; MCP users of the published package are not.
Worth noting for the plan: the server list is read only from `~/.pi/agent/mcp.json`, which is `pi-mcp-adapter`'s file rather than a Pi core file, so the derivation helps only users of that adapter's config location.

**Checks run in a scratch worktree** (`git worktree add /tmp/pr-929 pr-929`, since torn down):

- `pnpm run check` — clean across all nine packages.
- `pnpm run lint` — Biome 690 files, ESLint 1170 files, `rumdl` — no issues.
- `pnpm --filter @gotgenes/pi-permission-system run test` — 164 files, 4352/4352 passing.

### Evaluation

**Valuable, and worth keeping:** the capability itself, the longest-match-only rule, the prefix-suppresses-suffix disambiguation, the removal of redundant re-prefixed candidates, and the six new test cases, which are well-named and pin the right behaviors.

**What I would change.**

1. **The longest-match invariant is not owned by the module that depends on it.**
   The new code comments that "the configured list is ordered longest-first" and relies on it for correctness, but that ordering is established three modules away, by the sort comparator in `getConfiguredMcpServerNamesFromPaths` (`src/config/policy-loader.ts`).
   The exported signature — `configuredServerNames: readonly string[] = []` — advertises no such contract, and `PolicyLoaderOptions.mcpServerNames` (the test-only override path) does **not** sort.
   Measured on the PR branch: `createMcpPermissionTargets({ tool: "foo_bar_baz" }, ["foo", "foo_bar"])` → `["foo", "foo_bar_baz", "mcp_call"]` — the wrong server, silently.
   `addDerivedMcpServerTargets` should select the longest matching prefix itself; the invariant then lives where it is depended upon.

2. **Candidate order is precedence, and the PR inverts the module's own convention.**
   `evaluateFirst` (`src/policy/rule.ts:231`) returns at the first candidate matching any config-layer rule.
   On current `main` a qualified name or an explicit `server` produces `["github_search_code", "github:search_code", "github", "search_code", "mcp_call"]` — server-qualified forms first, bare server third.
   A prefix-named tool *is* that candidate[0] form, so the PR's `expect(targets[0]).toBe("github")` makes the bare server outrank a server-qualified name for the first time in the module, contradicting both the module docstring ("ordered from most-specific to least-specific") and the PR's own new docs table, which advertises `"myServer_*"` for tool-level policy — a shape unreachable whenever a bare-server rule also exists.
   `PermissionCheckResult.target` is the matched candidate (`permission-manager.ts:380`), so the ask prompt and review log read `target: github` instead of naming the tool actually being called.

3. **Two independent changes in one commit.**
   The re-prefix removal in `pushMcpToolPermissionTargets` touches the explicit-`server` path and is not required by the prefix-derivation fix.
   It is a clear improvement and should land as its own step.

4. **Structure.**
   Two `for` loops over the same list, the first returning out of the enclosing function, with the second being the old body.
   A named `findLongestConfiguredPrefix` helper plus a guard clause reads better and localizes finding (1).

5. **Docs.**
   `short-circutes` → `short-circuits`.
   The derivation is heuristic and the added docs should say so: a configured server `git` attaches to `git_lab_issues` from a different server (measured: `["git", "git_lab_issues", "mcp_call"]`), which is a fail-open when the rule is `allow`.

### The deeper cause

The review found that `evaluateFirst`'s candidate short-circuit silently overrides the package's stated last-match-wins policy on the `mcp` surface.
Two orderings are in play: rule order (last-match-wins, the policy) and candidate order (first candidate with any match, `evaluateFirst`).
The second pre-empts the first — it selects a candidate, then applies last-match-wins within that one candidate.

Measured through `evaluateFirst` and `evaluateAnyValue`, candidates `["github", "github_search_code", "mcp_call", "mcp"]` (server-first) versus `["github_search_code", "github", "mcp_call", "mcp"]` (tool-first):

| Config                                      | `evaluateFirst` server-first | `evaluateFirst` tool-first | `evaluateAnyValue`, either order |
| ------------------------------------------- | ---------------------------- | -------------------------- | -------------------------------- |
| `{github: deny}`                            | deny `github`                | deny `github`              | deny `github`                    |
| `{github: deny, github_search_code: allow}` | deny `github`                | allow `github_search_code` | allow `github_search_code`       |
| `{*: ask, github: deny}`                    | deny `github`                | ask `*`                    | deny `github`                    |
| `{*: deny, github: allow}`                  | allow `github`               | deny `*`                   | allow `github`                   |
| `{github: deny, *: ask}` — catch-all last   | ask `*`                      | ask `*`                    | ask `*`                          |

The last row is the control: `evaluateAnyValue` privileges rule **position**, not specificity, so a catch-all written last still wins.
That is last-match-wins, which makes routing `mcp` through it a faithful application of the existing policy rather than a new one.
Under `evaluateAnyValue` candidate order no longer affects any decision — it survives only as the tie-break for the reported `target` string, at which point tool-name-first wins trivially because it names the tool being called.

**Archaeology.**
`evaluateFirst` was introduced in `55029597` (2026-05-04) as a step of #81, whose plan (`docs/plans/0081-unify-checkpermission-surface-branching.md`) declares "Pure refactor: no change to permission decisions" and lists changing decision output as a Non-Goal.
It is a verbatim lift of the pre-#81 MCP branch's loop (`git show 55029597^:src/permission-manager.ts`, lines 575–578).
It was never a designed matching policy and has no ADR.
`evaluateAnyValue` arrived five weeks later (`2b7d2409`, #393) to fix the same masking, discovered first on path aliases.

**Blast radius is the `mcp` surface alone.**
`buildCheckResult` formally routes every non-`PATH_SURFACES` surface through `evaluateFirst`, but `normalizeInput` gives `skill`, `bash`, `path`, and `extension` a single-element `values` array, where the loop runs once and `evaluateFirst` degenerates to plain `evaluate`.
MCP is the only surface carrying a multi-candidate list.

### Decision and attribution

**Direction: adopt the capability, plan a simplified design.**
PR #929 is reference, not the merge target.
Plan via `/plan-issue #928`; the direction is settled here and should not be re-litigated.

**Scope, as two sequenced steps under one `feat!` bump:**

1. *(Preparatory, tidy-first.)* Route the `mcp` surface through `evaluateAnyValue` in `buildCheckResult` (`src/policy/permission-manager.ts:372`), so rule position decides and a user-written `mcp` catch-all no longer masks a later, more specific rule.
   Pin the session-rule interaction: #81 step 1 appends session rules to `fullRules`, so under `evaluateAnyValue` a session grant always wins where under `evaluateFirst` it could lose to a config rule matching an earlier candidate.
2. Add prefix derivation to `addDerivedMcpServerTargets`, with the longest-match selection owned by that function rather than by the caller's sort order, and candidates ordered tool-name-first for prompt and review-log fidelity.
   Land the explicit-`server` re-prefix removal as its own step.
   Carry the docs, with the heuristic's fail-open limit stated and the typo fixed.

**Release classification: `feat!` (breaking).**
A default changes on upgrade with no user config edit, and one direction is permissive: an existing `mcp: {"github": "allow"}` starts auto-allowing prefix-named tools that previously fell through to the catch-all.
The `evaluateAnyValue` routing compounds this for every MCP call whose config writes a broader rule after a narrower one.
Given the package's least-privilege priority, both warrant a major and a migration note.

**Non-goals for this issue:**

- PR 2 of the series (`registerMcpProxy`, routing arbitrary proxy tool names to the `mcp` surface) — gap 2 of #928, its own issue.
- Removing the literal `mcp` special case from `classifyToolKind`.
- Changing `evaluateFirst` for any surface other than `mcp`.

**Attribution.**
Every implementation and docs commit for this work carries, at the end of the body after a blank line:

```text
Co-authored-by: George Harker <george@georgeharker.com>
```

The PR close comment at ship stage thanks `@georgeharker` by name, links the implementing SHAs, and explains that we took the capability with a simplified derivation plus the underlying `evaluateFirst` fix his report exposed.
Reference the PR as `Refs #929`, never `Closes #929`.

## Stage: Planning (2026-09-18T17:13:46Z)

### Session summary

Wrote `docs/plans/0928-mcp-prefix-named-server-derivation.md` as five TDD steps under one breaking release.
The PR-review stage had already settled the direction, so this session's work was measuring the change rather than deciding it: a spike in a throwaway worktree ran a 12-config × 11-input matrix through the real `PermissionManager` before and after both changes, which shifted the plan's center of gravity from the derivation fix to the matcher underneath it.
The operator widened step 1 from the recorded "route `mcp` through `evaluateAnyValue`" to deleting `evaluateFirst` outright, and asked that #687 be told now rather than at ship.

### Observations

- **The spike changed the framing.**
  37 of 132 matrix rows move, and **0 of 4413 existing tests** move with them — `main` and the patched tree are both 165 files / 4413 passing.
  Nothing in the suite pins the `mcp` matcher, so the plan treats the green suite as evidence of a coverage gap rather than of safety, and every step names a killing mutation.
- **The package's own documented example is broken on `main`.**
  The `docs/configuration.md:510` config silently drops `mcp_list: "allow"` and `dangerousServer: "deny"`, the latter even with an explicit `server` argument that already derives the right candidate.
  That row needs no prefix derivation at all, which is what established the matcher as the primary defect and the derivation as a second, independent gap.
  `README.md:134` has claimed last-match-wins for the `mcp` surface all along.
- **Deleting `evaluateFirst` rather than widening its discriminator.**
  `normalizeInput`'s `switch` is exhaustive over `ToolKind` and gives every non-`mcp` arm a single-element `values`, where the two evaluators provably agree; the `path-values` branch already routes to `evaluateAnyValue`.
  Measured green with an unconditional `evaluateAnyValue`.
  Rejected the narrower `PATH_SURFACES.has(surface) || surface === "mcp"` because it leaves a second evaluator alive with only degenerate callers — an ad-hoc disjunction where removing the decision is available.
- **The path-alias tests are the regression net.**
  Forcing path surfaces onto `evaluateFirst` turns five red across `permission-manager-unified.test.ts` and `external-directory-symlink-acceptance.test.ts`, measured.
  They already prove `evaluateAnyValue` is correct for a multi-candidate surface, which is most of the argument for the deletion.
- **#687 was not referenced by #928 and is materially affected.**
  Its problem 1 is this exact masking, in its own words, and it proposes an operation-scoped `mcp` config schema partly to route around it.
  Commented on #687 with the measurement and asked its reporter whether the schema is still wanted for problem 2 (discoverability of the synthetic `mcp_*` names) alone.
- **Ordering demoted from a security decision to a display decision.**
  Under one evaluator, candidate order no longer affects any outcome — it selects only the reported `target`.
  So tool-name-first was chosen on prompt and review-log fidelity, not on precedence, and it happens to reproduce the candidate table `main` already produces for qualified and explicit-`server` names.
- **Alternative rejected:** `evaluateMostRestrictive` for the `mcp` surface, so a `deny` on any candidate wins regardless of position.
  That is a different policy from last-match-wins and would contradict `README.md:134`; recorded as an Open Question rather than planned.
- **Two attribution changes are preserved-but-visible**, and both are pinned rather than accepted silently: the baseline auto-allow keeps its action but loses `mcp_describe` as its `matchedPattern` once derivation supplies a server candidate, and a session grant matching a late candidate now wins where it previously lost to a config rule on an earlier one.
- **Scope split:** gap 2 of #928 (routing registered proxy tool names to the `mcp` surface, PR #930's `registerMcpProxy`) filed as [#946] so #928 closes on gap 1 alone.
  Roadmap-fit recorded it out of scope for Phase 15 — it edits `classifyToolKind` and adds a cross-extension registry, sharing no mechanism with that phase's bash token-role loss.

#### Deferred tidyings

The Tidy-First assessor recommended no preparatory commits and its three rejections are recorded here rather than lost:

- `src/policy/permission-manager.ts` — `buildCheckResult` carries 7 positional parameters including both `normalizedToolName` and `toolName`, a genuine ISP-flavored bag; declined because this change edits one line inside the body and touches no parameter.
- `src/access-intent/mcp-targets.ts` — both helpers mutate a `McpTargetList` passed as a parameter rather than returning candidates; declined as the file's existing consistent idiom, which the change fits without friction.
- `test/policy/rule.test.ts` — each `describe` block builds its own local `Rule` fixtures; declined as not worth a commit for the handful of cases this plan adds.

The assessor also corrected the design summary: `addDerivedMcpServerTargets` has **no** early exit today, so a suffix match against several configured servers adds three candidates for each of them.
The current defect is unbounded fan-out, not merely a fragile dependence on the caller's longest-first sort.
That correction is folded into the plan's Design Overview.

## Stage: Implementation — TDD (2026-09-18T18:05:11Z)

### Session summary

All five TDD steps landed as planned, in order, each green before commit: `58019772` (single-candidate pin), `c5736964` (`fix!` last-match-wins), `1994b322` (`feat!` prefix derivation), `72b3b0b6` (`fix` re-prefix removal), `49484a63` (docs).
Test count went 4413 → 4435 (+22) with 165 files unchanged.
The pre-completion reviewer returned **PASS**, including an independent re-derivation of the four invariants the guard removal rests on.

### Observations

- **Every predicted killing mutation behaved exactly as the plan said**, which is the whole evidence base here given that the pre-change suite pinned none of this.
  Step 2's mutation (restoring the ternary so `mcp` routes to `evaluateFirst`) turned 12 red: the 7 new mcp cases plus the 5 path-alias tests the plan named as the regression net, with the 3 control cases and the baseline pin correctly surviving.
  Step 3's three mutations each killed exactly one equivalence class and no more.
  Step 4's killed its own case while its sibling stayed green.
- **The mutation for step 2 needed a real second evaluator**, not a one-line literal swap, so it was applied as a temporary `MUTANT_evaluateFirst` export plus its call site and reverted from a saved copy.
  Worth noting for a future guard-removal step: `git checkout --` would have discarded the step's own uncommitted green edit.

#### Deviations from the plan

- **The baseline-attribution pin asserted the wrong field.**
  The plan said to assert `matchedPattern`, but `buildCheckResult` sets it only for a `config` or `session` layer rule — a `baseline` rule reports `undefined`, and the attribution lives in `target`.
  Caught by the test failing during step 2's red for the wrong reason.
- **That pin then split into two cases in step 3**, as the Invariants section predicted it would move.
  Once derivation supplies a `github` candidate, `mcp: {"github": "allow"}` attributes a describe to the `github` rule rather than the `mcp_describe` baseline.
  Rather than just editing the expectation, a second case was added pinning the baseline's own constituency — a describe of a tool belonging to an *unconfigured* server, which no config rule can name — so the auto-allow still has a test that fails if it is ever dropped.
- **Step 4 needed an ordering change the plan did not name.**
  Removing the re-prefixed candidates was not enough to make `targets[0]` the tool name: the explicit-`server` branch adds the bare server before the caller adds the tool name.
  The prefixed case now adds the tool name itself in that branch, matching what prefix derivation produces for the same name without an explicit server.
  Folded into the same commit.
- **An existing test encoded the old behavior in its fixture.**
  `derives server targets from configured server names when tool name ends with _<server>` used `{ tool: "exa_search" }` with `["exa"]` and a comment explaining that this does *not* derive a server.
  That name is a prefix hit after this change, so the case was rewritten onto a genuine suffix name (`search_code_exa`) with full assertions on all four derived candidates — it had only ever asserted `toContain("exa_search")`, which would have stayed green either way.
- **Added an executable pin for the published docs table.**
  The plan asked for the documented example's calls to be re-run as a test; the four-row derivation table in `docs/configuration.md` got the same treatment, asserted with `toEqual` on the full candidate array so a derivation change that does not update the doc fails.
- **`architecture.md`'s Mermaid diagram was a plan miss.**
  The plan named only line 481, but the MCP pre-processing section carried a flowchart modelling the per-candidate loop with an `Explicit match?` decision node.
  Rewritten to the single `evaluateAnyValue` call; the reviewer rendered all four charts in the file with `mmdc` and found no parse errors.

#### Reviewer verdict

**PASS**, no warnings.
The re-derivation mandate was worth issuing: the reviewer closed the single-candidate claim algebraically rather than by coverage (both evaluators reduce to plain `evaluate()` on a one-element array for *any* rule layer, so the layer enumeration is unnecessary), and traced every producer of a `path-values` intent to confirm none can reach `buildCheckResult` with a surface outside `PATH_SURFACES`.
It also found one unflagged edge in `findLongestPrefixServer` — a tool name of exactly `<server>_` derives that server — and judged it not fail-open, since the bare tool-name candidate is still present and correct.

## Stage: Final Retrospective (2026-09-18T18:59:19Z)

### Session summary

One process carried all four stages — PR review of a third-party contribution, planning, TDD implementation, and ship — landing `pi-permission-system` v33.0.0 with two breaking commits.
The work grew from "adopt a contributor's prefix-derivation fix" into "the `mcp` surface never honored the last-match-wins contract its own README publishes", and the second defect turned out to be the larger one.
The ship stage also uncovered an expired PAT in the release pipeline that turned out to be unnecessary, removed in `2358066a`.

### Observations

#### What went well

- **The spike reframed the issue, and it was cheap.**
  A throwaway worktree running a 12-config × 11-input matrix through the real `PermissionManager` moved the primary defect from the derivation gap to the matcher underneath it, and produced the single most useful number in the whole issue: **37 of 132 matrix rows change, 0 of 4413 existing tests move**.
  That one pairing is what justified treating the green suite as a coverage gap rather than as safety, and it made every later "name the killing mutation" step non-negotiable rather than ceremonial.
- **Reading a sibling issue nobody cited changed the design's framing.**
  Issue #687 was not referenced by #928, by PR #929, or by the triage entry, but its stated problem 1 is the same masking defect in the reporter's own words — and it proposes a whole new config schema partly to route around it.
  Finding it before planning meant the plan could dissolve that motivation rather than ship a fix that silently obsoleted an open proposal.
- **The `MUTANT_evaluateFirst` technique.**
  Step 2's killing mutation was "restore the deleted evaluator", which no literal swap can express.
  Reintroducing it as a temporarily-exported function plus its call site, then restoring from a `cp` copy, worked cleanly and produced exactly the predicted 12 reds.
  Worth reaching for whenever the mutation is *undo this deletion* rather than *flip this comparison*.
- **The pre-completion reviewer earned its dispatch on judgment, not checklists.**
  Given an explicit re-derivation mandate for a guard removal, it closed the single-candidate claim **algebraically** (both evaluators reduce to plain `evaluate()` on a one-element array for any rule layer) rather than by enumerating coverage, and independently traced every producer of a `path-values` intent.
  It also surfaced an edge neither the plan nor the implementation had named — a tool named exactly `<server>_` derives that server — and judged it not fail-open.

#### What caused friction (agent side)

1. `instruction-violation` (self-identified, but only after publishing) — **called `issue_close` on #928 with an unverified draft containing a mistyped SHA** (`57369648…`, missing the leading `c`) and the literal text "wait, let me redo this comment".
   The `/ship` prompt's rule is explicit and carries six refs already (#704, #777, #788, #814, #861, #890): re-resolve every hex token *in the finished draft*, because verifying after the call can no longer prevent publishing.
   Impact: the bad comment went out to every issue subscriber; recovery took a GraphQL `deleteIssueComment` mutation plus a re-verified re-post.
   The notification cannot be recalled.
   This is the session's most serious failure, and notably the rule it violated is already maximally prominent — more prose will not fix it.

2. `instruction-violation` (user-caught, twice) — **crammed gate context into `ask_user` option descriptions and `preview` panes instead of a preceding message.**
   The `clarification-gates` skill's first section says exactly this, and I had not loaded it: `/pr-review` is the one gate-bearing prompt whose Load-skills list omits it, where `plan-issue`, `plan-improvements`, `retro`, and `audit-agent-docs` all name it.
   Impact: **four `ask_user` calls to settle one decision.**
   The operator's bounce was verbatim "Whoah, all this context needs to be placed *before* invoking the `ask_user` tool."

3. `wrong-abstraction` — **offered a mechanism menu before naming what the existing policy already required.**
   The third gate presented `evaluateFirst` vs `evaluateAnyValue` as a design choice among options, when `evaluateAnyValue` is simply last-match-wins applied to a multi-candidate lookup — the policy the repo already has.
   The operator had to supply that framing: "we have a guiding policy of last entry wins … if we stick with the policy, what would be necessary so rows 3 and 4 behave correctly?" `clarification-gates` anticipates this failure in one sentence (name which component owns the lever and what happens today in each concrete configuration, before offering mechanisms).
   Impact: one extra round trip — but it produced the archaeology and blast-radius analysis that became the plan's spine, so the cost was partly recovered.

4. `instruction-violation` (self-identified) — **wrote `#933` into the plan for a follow-up issue before filing it**; the API returned `#946`.
   `git-workflow` states the rule directly: file first, then write back the number the API returned.
   Impact: one corrective `Edit`; caught immediately, no published artifact carried the wrong number.

5. `missing-context` — **three plan misses, all in the same class: the plan grepped for the removed *symbol* and missed places describing the *mechanism*.**
   - `architecture.md`'s Mermaid flowchart modelled the per-candidate loop with an `Explicit match?` decision node and never names `evaluateFirst`, so the symbol grep could not see it; the plan listed only line 481.
   - The baseline-attribution pin asserted `matchedPattern` where a `baseline`-layer rule reports only `target` — `buildCheckResult`'s condition had been read during planning but not carried into the assertion.
   - Step 4 needed a tool-name-first ordering change in the explicit-`server` branch that the plan never named.

   Impact: all three were absorbed into the commits they belonged to; no follow-up commits, but each cost a red-for-the-wrong-reason cycle.

6. `rabbit-hole` (mild) — **escalated a cached `pnpm view` read to "published silently no-opped" in a user-facing report before reading the publish job's own log**, which had plainly printed `✅ Published package @gotgenes/pi-permission-system@33.0.0`.
   Impact: seven tool calls spent on "did it publish", and a moment of false alarm in the ship report.
   The producer's log is authoritative and was available first.

7. `premature-convergence` — **diagnosed the expired PAT correctly and stopped at "rotate it"**, accepting the existing pipeline design as given rather than asking whether a PAT was still needed after release-please was retired.
   Impact: none, because the operator asked the question — but the whole investigation that followed (no branch protection, no rulesets, `github-release` already using `GITHUB_TOKEN`) was available to me at the point I recommended rotation.

8. `scope-drift` (user-caught, after the ship report) — **left PR [#930] dangling.**
   The ship stage treated gap 2 as fully discharged by filing [#946] and never told the contributor anything, so a 990-line PR was left open and silently broken by the work that had just landed.
   The `/ship` prompt's supersession rule did not cleanly cover it: [#930] was not superseded (gap 2 genuinely did not ship) but deferred, and the prompt's only PR outcome is "close each PR the plan-and-retro read named".
   The same oversight closed #928 without answering the contributor's reply sitting on it ("I've tidied up those extra files").
   Impact: no rework, but a contributor was left without a signal on a stacked PR whose base this issue had just rewritten; recovered only because the operator asked "There was a related PR right?".

#### What caused friction (user side)

- **The single highest-leverage intervention in the session was a question, not a correction**: "do we still need PAT, since we got rid of release-please GitHub Action?"
  That reframed a credential-rotation chore into a permanent removal of a failure mode.
  Worth noting as a pattern that worked — the same shape ("is this constraint still real?") applied to the `evaluateFirst` gate produced the other big reframe of the session.
- Both gate bounces were corrective rather than strategic, and both were caused by a missing skill load on my side.
  Fixing `/pr-review`'s skill list should convert that class of intervention back into strategic ones.

### Diagnostic details

- **Model-performance correlation** — the main session ran `anthropic/claude-opus-5` throughout; both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) are pinned to `anthropic/claude-sonnet-5` in their `.pi/agents/*.md` frontmatter.
  The `model_change` entries in the session log (`opus-5 → sonnet-5 → opus-5`) are the subagent dispatches surfacing as phantom switches — exactly the artifact Refs #737 warns about; an unfiltered read shows every main-session turn as opus-5.
  No mismatch: sonnet-5 handled a genuinely judgment-heavy re-derivation mandate (an algebraic equivalence proof plus an exhaustive call-site trace) without prompting, which is evidence the tier is adequate for the reviewer role rather than a reason to escalate it.
- **Escalation-delay tracking** — the npm-verification sequence ran seven consecutive tool calls (`pnpm view` × 2, job log, `curl` × 3 with two `sleep`s) on one question.
  Below the bar for a subagent dispatch — most of the tail was legitimate waiting on registry propagation — but the *first* call should have been the job log rather than the cached client.
- **Unused-tool detection** — nothing missed.
  `colgrep` was used for convention discovery, `Explore` was not needed (the report supplied a named file trace, which the prompt says to verify inline), and both judgment subagents were dispatched at their designated points.
- **Feedback-loop gap analysis** — verification ran incrementally and correctly: a green baseline before step 1 (`check`, root `lint`, `test`, `fallow`), a scoped `vitest run <file>` per red/green, `pnpm run check` immediately after the shared-type edit in step 2, a full-suite run after every step that touched shared code, and the four end-of-cycle gates before the reviewer dispatch.
  No gap.

### Changes made

1. `.pi/prompts/pr-review.md` — added `clarification-gates` to the Load-skills list.
   It was the only gate-bearing prompt omitting it, and both `ask_user` bounces this session are stated in that skill's first two sections.
2. `.pi/prompts/plan-issue.md` — extended the mechanism-grep bullet in Module-Level Changes with the diagram case: a Mermaid node models a control flow without naming the symbol, so a symbol grep cannot see it.
3. `.pi/skills/package-pi-permission-system/SKILL.md` — extended the existing last-match-wins bullet with the one-evaluator invariant this issue established, and a do-not-reintroduce clause for a per-surface evaluator.
4. Closed PR [#930] (`registerMcpProxy`, gap 2) unmerged, pointing at [#946], after the operator asked whether a related PR was still open.
   Two reasons given to the contributor: the base moved under it (it now conflicts across `mcp-targets.ts`, `permission-manager.ts`, `input-normalizer.ts`, and three test files, since the derivation landed in a different shape), and its registration API is a public cross-extension surface whose design is not settled — so a 990-line rebase would be work toward a moving target.
   The comment also acknowledged the contributor's housekeeping reply on #928, which the ship stage closed the issue without answering.
5. Filed [#948] (`pi-github-tools`) — have `issue_close` refuse a comment citing an unresolvable commit SHA.
   A deliberate exception to "mechanism is forever; docs are reversible", approved by the operator at this retro's gate: the prose rule has six incident refs (#704, #777, #788, #814, #861, #890) and failed a seventh time in this session's ship stage.
   `roadmap-fit` exited at step 1 — `pi-github-tools` has no architecture doc and therefore no open phase.

Considered and not landed: more prose on SHA verification anywhere (fails the admission test's first question, and would be the seventh ref on an already-maximally-prominent rule); an `AGENTS.md` note on `pnpm view` caching (a model can infer that a registry client caches — the real error was report ordering, too situational for the always-loaded file); a `releasing` skill note that the pipeline holds no PAT (`release.yml`'s own comment and `.pi/prompts/triage-backlog.md`'s audit already say it, and a third copy would drift).

[#930]: https://github.com/gotgenes/pi-packages/pull/930
[#946]: https://github.com/gotgenes/pi-packages/issues/946
[#948]: https://github.com/gotgenes/pi-packages/issues/948
