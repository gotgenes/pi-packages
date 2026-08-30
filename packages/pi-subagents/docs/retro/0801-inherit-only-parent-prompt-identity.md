---
issue: 801
issue_title: "duplicate available_skills section in subagent's prompt"
---

# Retro: #801 — duplicate available_skills section in subagent's prompt

## Stage: Planning (2026-08-30T19:00:47Z)

### Session summary

Diagnosed the reported duplicate `<available_skills>` catalogue as a boundary flaw in prompt inheritance: `buildAgentPrompt` embeds the parent's fully assembled system prompt verbatim, including the layers Pi resolves per session, and the child's own session rebuilds them.
Settled on truncating the inherited prompt at the first per-session layer — so a child inherits only Pi's identity region — rather than excising the catalogue and footer while keeping the parent's extension-appended tail.
Wrote `docs/plans/0801-inherit-only-parent-prompt-identity.md` (four TDD steps: one Tidy-First fixture preparation, one `fix:`, two `docs:`) and filed [#846] against `@gotgenes/pi-nocd`.

### Observations

- **The report understated itself.**
  The title names `available_skills`, but the pasted prompt duplicates the `Current working directory:` footer at the same two positions.
  Reading the paste rather than the title is what turned this from a one-appendage patch into the principled rule.
- **A third-party issue, and the gate earned its keep.**
  `SeniorPlayer` is not the gh CLI user, so the direction gate was mandatory.
  It bounced twice — first for an unexplained caching argument, then for undefined terms (`prefill`) — and both bounces produced corrections rather than restatements.
- **Two of my own claims were wrong and the operator's questions caught them.**
  I listed `excludedExtensionPackages` ([#696]) as a case where a child's skill set differs from its parent's; it is not — `package-exclusions.ts` sets only `extensions: []` and its docstring says skills, prompts, and themes are untouched.
  I also asserted extensions re-append in children without verifying it, then traced the chain properly (`bindExtensions` at `create-subagent-session.ts:245`, `session.prompt()` at `subagent-session.ts:123,147`, unconditional `emitBeforeAgentStart` at `agent-session.js:914`).
  The verified claim is about the mechanism; the third-party appender population stays unenumerable, and that is the plan's accepted residual.
- **The caching provenance mattered and was recoverable.**
  The operator remembered a user harmed by a prompt-caching regression but not the issue.
  It is [#180] (with follow-up [#400]), reporter `@jeffutter`, running a local model on a weak iGPU: 8,333 shared tokens ≈ 40 s of prefill.
  Quantifying against his own measured rate is what made the choice decidable — the duplicated catalogue never cost him prefill time (it sat inside his cached prefix), it cost context length, and truncation costs him nothing at all where excision would have cost ~0.3 s per spawn.
- **[#640]'s carve-out fell out on its own.**
  Its equal-cwd exception existed solely to preserve the byte-identical prefix.
  The catalogue sits ahead of the footer, so once the catalogue is cut the footer is already past the divergence point and the argument is void.
  That is a case of a prior decision's rationale expiring silently — the ADR exists so the next session does not re-derive it from a plan.
- **`@gotgenes/pi-anthropic-auth` was checked and is unaffected.**
  Both of its span anchors (`PI_DEFAULT_PROMPT_PREFIX`, `PI_DEFAULT_PROMPT_TERMINATOR`) are lines of Pi's built-in preamble, inside the region truncation preserves.
  Its own constant docstring states the assumption the change satisfies.
- **`pi-permission-system` is a pure beneficiary.**
  `skill-prompt-sanitizer.ts` parses every catalogue in a prompt and currently double-counts the duplicated entries into `visibleEntries`.
  No change owed to it, but worth knowing the multi-section support was not built for this and stays useful.
- **Scope decisions.**
  The operator chose truncation over excision on an accuracy-first rationale, chose three documentation artifacts (a `configuration.md` section, a README extension-author warning, and ADR 0006), and chose to file the `pi-nocd` drift as [#846] rather than widen the plan across two independently released packages.
  `roadmap-fit` exited at Step 1 for [#846] — `pi-nocd` has no architecture doc and therefore no open phase.

#### Deferred tidyings

- `packages/pi-subagents/test/session/prompts.test.ts` — the roughly fifteen other tests each hand-build an `AgentConfig` object literal (`"appender"`, `"clone"`, `"standalone"`, `"ordered"`, `"no-parent"`); the assessor rejected deduplicating them as scope creep since this change touches none of them.

## Stage: Implementation — TDD (2026-08-30T19:41:00Z)

### Session summary

Executed all four planned TDD steps, plus two follow-up commits answering the pre-completion reviewer's warnings.
`buildAgentPrompt` now cuts the inherited prompt at the first layer Pi resolves per session, so a child inherits only the identity region; the catalogue, the cwd footer, and the blocks extensions append from `before_agent_start` all stop at the boundary.
The pi-subagents suite went 1337 → 1349 tests (+12), with the whole delta in `test/session/prompts.test.ts`.

### Observations

- **The Tidy-First step paid for itself immediately.**
  The composable `parentPrompt({ identity, skills, footerCwd, extensionTail })` builder made every new case a one-line fixture change, and rendering its skills layer through Pi's own `formatSkillsForPrompt` is what let two later cases be written at all.
- **Two of the plan's own new tests were weak probes, and the plan's mutation discipline did not catch them.**
  `"drops the footer that follows the catalogue"` and `"keeps the identity ahead of the catalogue byte for byte"` both passed during Red.
  I classified them as invariant pins and moved on; the reviewer correctly called the first one out.
  The tell was available at Red and I ignored it: their fixtures used a parent/child cwd mismatch, which the *pre-fix* footer strip already handled, so the assertion never isolated the catalogue cut.
  Both are now built on matching directories, where [#640]'s exception would have kept the line, and both fail against the pre-fix implementation.
- **The four planned killing mutations each killed exactly their predicted class**, and the two footer/catalogue classes partitioned cleanly (7 reds each, disjoint).
  That was genuinely reassuring and also the source of false confidence: mutations I chose cannot find a hazard I did not imagine, which is exactly what the reviewer's independent input enumeration was for.
- **The reviewer found a real anchor defect, and re-deriving it found a second one it missed.**
  Anchoring the catalogue on the *last* `</available_skills>` leaks the real catalogue when a second well-formed section follows the footer.
  Working through the fix surfaced the mirror case the reviewer did not report: a catalogue quoted inside a project-context file wins the same search when the parent resolved no skills, truncating the identity at the quote — an **over-cut**, where the reviewer only found the under-cut.
  Both are now covered, and both fail against the shipped-and-reviewed implementation.
- **The fix replaced a heuristic with a structural fact.**
  Picking the first or the last catalogue is a guess about document order, wrong in one direction either way.
  `buildSystemPrompt` writes the cwd footer immediately after the catalogue, in both branches and unconditionally, so Pi's own catalogue is the one whose closing tag is the line before the footer.
  The operator chose this over documenting the hazard or deferring it.
- **A fixture can be wrong in a way that looks like a code defect.**
  The first version of the quoted-catalogue test put the quote immediately before the footer — structurally identical to where Pi writes its own, so no algorithm could distinguish them.
  The red was the fixture's fault, not the code's; the realistic shape puts `</project_context>` between the quote and the footer.
- **Deviation from the plan.**
  The plan said both equal-cwd carve-out tests would be "replaced by cases asserting the opposite"; that held.
  The plan did not anticipate the anchor hardening (commits `38747606` and `ff6bb04c`), which came out of the review round.
  No plan file went untouched and no extra files were touched.
- **Changelog hygiene.**
  The hardening commit's original subject named the seam ("anchor the inherited catalogue cut on Pi's own section").
  Reworded to the symptom before pushing, via `git reset` + re-commit rather than an interactive rebase, verified with `git diff backup-801 HEAD` empty.
- Pre-completion reviewer: **WARN** on the first round (two findings, both addressed), **PASS** on the delta re-review.
  The re-review independently confirmed that no `buildSystemPrompt` path writes the catalogue without the footer, checked the `lines[footerAt - 1]` boundary at `footerAt === 0`, and confirmed ADR 0006 does not overclaim the no-footer fallback residual.

## Stage: Sync (worktree) (2026-08-30T20:18:31Z)

### Session summary

Pre-push checks pass clean (`pnpm run lint`, `pnpm fallow dead-code`, both from the worktree root).
The plan's marker is `**Release:** ship independently` — no defer decision needed at land time.
The follow-up filed during planning, [#846] (`pi-nocd`'s stale inherited-prompt docs), is untouched by this branch and stays open for its own session.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-801--/2026-08-30T14-42-05-248Z_01a0531e-d740-7312-87c9-1f07818f45d1.jsonl` — read with `read_session_file({ path: "..." })` for message-level verification at land/retro time.

### Observations

Nothing deferred beyond [#846].
The TDD stage note above already records the pre-completion reviewer's two rounds (WARN → PASS) and the post-review anchor hardening; the root's `/retro 801` can read both directly.

## Stage: Final Retrospective (2026-08-30T20:38:05Z)

### Session summary

Shipped #801 across four sessions — planning and TDD in the peer worktree, sync at the peer, land and release at the root.
Eleven commits fast-forwarded onto `main`, CI green, `@gotgenes/pi-subagents@21.0.1` released, worktree and branch torn down.
A subagent's prompt now carries exactly one skills catalogue and one working-directory claim, both describing the child's own session.

### Observations

#### What went well

- **A mis-pasted slash command cost nothing, because the guard fired before anything irreversible.**
  `/ship-worktree 844` was pasted into the peer session alongside `/sync-worktree 801`.
  The template's step 0 (`git branch --show-current`, before any git or GitHub action) caught it on the first tool call; the session reported the mismatch, declined that half, and ran the command that actually matched the branch.
  This is the first observed instance of that ordering paying off, and it paid off against a wrong *issue number*, not just a wrong directory — the failure mode it would otherwise have produced is a wrong `issue_close` or a wrong ff-merge.
- **The reviewer round found a real defect, and re-deriving the fix found its mirror.**
  The `pre-completion-reviewer` reported that anchoring on the last `</available_skills>` under-cuts when a second well-formed catalogue follows the footer.
  Working the fix surfaced the over-cut the reviewer did not report — a catalogue quoted in a project-context file wins the same search when the parent resolved no skills.
  Re-deriving a reported finding rather than patching it exactly as described is what turned one bug into two.
- **The fix replaced a heuristic with a structural fact.**
  First-or-last catalogue is a guess about document order, wrong in one direction either way; `buildSystemPrompt` writes the cwd footer immediately after the catalogue unconditionally, which makes the anchor positional instead.
- **Verification ran incrementally throughout.**
  `pnpm run check` after every step that touched a shared surface, the package suite after each Green, killing mutations before each commit, and the full four-gate sweep at the end.
  No gate was deferred to the end and no commit was made with a mutation in the tree.

#### What caused friction (agent side)

- `other` — **two of the plan's own new tests stayed green during Red and shipped as weak probes.**
  `"drops the footer that follows the catalogue"` and `"keeps the identity ahead of the catalogue byte for byte"` used a parent/child cwd mismatch that the *pre-fix* footer strip already handled, so neither isolated the catalogue cut it claimed to pin.
  They were classified as invariant pins and passed over; the reviewer caught one, and re-deriving it caught the other.
  Impact: two follow-up commits (`d184f41b`, and the fixture half of `49f3e46b`) after the review round, plus a second reviewer dispatch.
  The signal was available at Red — 10 of 12 went red — and the two that did not were exactly the two that pinned nothing.
  `/tdd-plan`'s "Verify the pins" step lists three cases where mutation verification is mandatory because Red's own evidence does not cover the test, and has been refined twice already ([#830]'s green-file restore, [#844]'s count-the-reds check) — but a test that stays green during Red is not one of the three.
- `missing-context` — **two unverified claims about this repo's own code entered a clarification gate's substance.**
  `excludedExtensionPackages` was cited as a case where a child's skill set differs from its parent's (it is not — `package-exclusions.ts` sets only `extensions: []`), and extensions were asserted to re-append in children before the chain was traced.
  Impact: two extra gate rounds (four `ask_user` calls for one decision boundary, against the `ask-user` skill's budget of one).
  Both corrections improved the decision rather than merely restating it, so the rounds were productive — but they were spent establishing facts that a grep before the gate would have settled.
- `instruction-violation` (self-unidentified) — **the Pi SDK trace ran inline at roughly eighteen greps.**
  Planning made ~13 calls into `node_modules/.pnpm/@earendil-works+pi-coding-agent@0.84.4/` and ~5 into the `../pi` checkout to establish how `buildSystemPrompt` layers a prompt.
  `AGENTS.md` § Workflow prescribes an `Explore` subagent with `model: "sonnet-5"` for exactly this multi-hop trace, and prices a hunt at 5–10 greps.
  Impact: planning-session context consumed; no rework, and the design that came out of it was correct.
  There is a real tension here worth naming rather than filing as a simple lapse — see Diagnostic details.

#### What caused friction (user side)

- The `/ship-worktree 844` paste was acknowledged as a copy-paste slip, and it cost one turn.
  Framed as opportunity rather than criticism: the interesting fact is that a wrong issue number reached a session at all, and the only thing standing between it and a wrong `issue_close` was one guard.
  Nothing here suggests a process change — the guard is the process change, and it worked.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5` (judgment-heavy design and test-discrimination work; appropriate).
  The sync stage ran on `anthropic/claude-sonnet-5` and is the stage that caught the mis-pasted `/ship-worktree 844` — the guard held on the cheaper model, which is evidence the branch check is not reasoning-sensitive.
  Land and retrospective ran on `anthropic/claude-opus-5`.
  Two subagents were dispatched, both fresh-context and both on judgment-heavy work: `tidy-first-assessor` at planning (returned one Recommended tidy plus a design correction) and `pre-completion-reviewer` twice at TDD (WARN → PASS).
  No mismatch found in either direction.
- **Escalation-delay tracking** — no sequence exceeded five consecutive tool calls on the same error.
  The longest was three (turns 179–182 of the peer session), debugging a fixture that placed a quoted catalogue exactly where Pi writes its own; the agent correctly diagnosed the fixture rather than the code and moved on.
- **Unused-tool detection** — the SDK trace above is the one case where a dispatch was available and not used.
  The countervailing argument is genuine: what the trace had to establish was a *universal* claim (`buildSystemPrompt` writes the footer after the catalogue in **both** branches, unconditionally), and `AGENTS.md` separately warns that a subagent's universal claim is the one that must be re-verified.
  A delegated summary here would have had to be re-derived inline before the design could rest on it.
- **Feedback-loop gap analysis** — no gap.
  Baseline (`check`, root `lint`, `test`, `fallow dead-code`) was established before step 1; `pnpm run check` ran inside steps 1, 2, and the two review-round commits; the package suite ran after every Green; the killing mutation for each step ran before its commit.
  The changelog preview at end-of-cycle caught a `fix:` subject naming the seam rather than the symptom, and it was reworded before anything was pushed.

### Changes made

1. `.pi/prompts/tdd-plan.md` — added a fourth case to "Verify the pins", making mutation verification mandatory when a new test stayed green during Red.
   The existing three cases cover signature-change reds, tests authored after Green, and multi-class steps; a test that never went red at all was the gap this issue fell through.
2. `AGENTS.md` § Workflow — corrected the Pi SDK checkout path from `../pi` to `~/development/pi/pi`.
   The relative form resolves only from the root checkout; from a worktree (`~/development/pi/pi-packages-worktrees/issue-<N>`) it points at a nonexistent `pi-packages-worktrees/pi` and would need `../../pi`.
   The planning session had already worked around this by probing `~/development/pi/pi` directly, so the doc was describing a path no recent session actually used.
3. `AGENTS.md` § Workflow — added the inline carve-out to the `Explore`-dispatch rule: keep an SDK trace inline when its output is a universal claim the design will rest on.
   This reconciles the dispatch rule with the existing warning that a subagent's universal claim is the one that must be re-verified.
4. `packages/pi-subagents/docs/retro/0801-inherit-only-parent-prompt-identity.md` — this Final Retrospective entry.

[#180]: https://github.com/gotgenes/pi-packages/issues/180
[#400]: https://github.com/gotgenes/pi-packages/issues/400
[#640]: https://github.com/gotgenes/pi-packages/issues/640
[#696]: https://github.com/gotgenes/pi-packages/issues/696
[#830]: https://github.com/gotgenes/pi-packages/issues/830
[#844]: https://github.com/gotgenes/pi-packages/issues/844
[#846]: https://github.com/gotgenes/pi-packages/issues/846
