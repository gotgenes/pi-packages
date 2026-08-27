---
issue: 775
issue_title: "Document per-package scope and non-goals in each README"
---

# Retro: #775 — Document per-package scope and non-goals in each README

## Stage: Planning (2026-08-18T20:57:49Z)

### Session summary

Planned a cross-package charter: a `## Scope and non-goals` section in all nine `packages/<pkg>/README.md` files, covering purpose, in-scope changes, non-goals with rationale, and adjacent-request routing.
Two clarification gates settled the shape (authoring protocol, placement, routing, citation policy) and then the discovery mechanism (evidence-mining subagents, brief persistence, review cadence).
Plan committed as `docs/plans/0775-package-scope-and-non-goals.md` in `01b76dd3`.

### Observations

- The issue's referenced "issues" (#684, #692, #703, #675, #613, #740) are all **pull requests**, not issues.
  That sharpens the motivation — the charter is what live third-party PRs get answered against, not just backlog items.
- Measured the external-PR pressure: 38 declined-unmerged or open external PRs, 37 of them on `pi-permission-system` (9 closed + 11 open) and `pi-subagents` (10 closed + 7 open), 1 on `pi-subagents-worktrees`, and **zero** on the other six packages.
  The "answers by reference" benefit is almost entirely about the two big packages; the other seven charters are preventive.
- Artifact density is extremely uneven — `pi-permission-system` has 1635 commits / 155 plans / 225 retros / 11 ADRs, `pi-nocd` has 12 commits and one retro.
  A uniform mining pass was therefore rejected in favor of a three-tier prompt (Tier A: ADRs + design principles + `gh` PR sweep, bounded; Tier B: read all plans/retros/log; Tier C: read everything).
- The operator redirected mid-planning from "draft from README prose" to "send subagents to explore each package" for evidence.
  That materially improved the plan: the non-goals now have to be grounded in a committed, citable brief rather than asserted.
- Discovered a distribution conflict the citation decision created: `pi-permission-system` and `pi-colgrep` do **not** ship `docs/architecture` or `docs/decisions` in their `files` allowlists, so a relative ADR link would resolve to nothing in the tarball (Refs #647).
  `pi-subagents` does ship both and already relative-links its architecture doc.
  Resolved with a per-package link-form rule rather than by extending any allowlist.
- Discovered a placement conflict: the chosen "immediately before `## Install`" rule buries the charter at line 135 of 151 in `pi-session-tools`, whose `## Install` sits near the bottom.
  Generalized the rule to "before the setup block — the first `## Prerequisites` or `## Install`" with `pi-session-tools` as the one documented exception (before `## Tools`).
- `docs` is an unhidden changelog type and `packages/<pkg>/README.md` is not in `exclude-paths`, so this lands as nine patch releases in one release-please PR.
  Treated as the mechanism (the README ships in the tarball) rather than a problem, and it argues for nine scoped `docs(<pkg>):` commits over one omnibus commit.
- Evidence briefs go to `docs/plans/0775-evidence/<pkg>.md`; root `docs/plans` is in `exclude-paths`, so those commits cut no release.
- Mining agents must be `general-purpose`, not `Explore` — `Explore` is read-only and cannot write the brief files.
- Explicitly built in a `## Gaps` section for each brief, because a package with no ADR and no external PR pressure may genuinely have no recorded non-goals.
  Accepting a manufactured one is exactly the failure mode #777 warns about.
- Nothing filed as a follow-up: the plan's deferrals all land on the existing #776 and #777, and the one speculative item (a companion ADR for a Tier A boundary) is deliberately deferred until the evidence briefs exist.

## Stage: Implementation — Build (2026-08-18T21:51:45Z)

### Session summary

Executed all seven Build Order steps: nine read-only mining subagents produced committed evidence briefs, then the nine `## Scope and non-goals` sections were drafted from those briefs and landed as per-package `docs(<pkg>):` commits across four operator review gates.
Thirteen commits total.
The cross-check pass found and fixed one real cross-package contradiction, and `pnpm pack` verification confirmed the per-package citation link-form rule was necessary and correct.

### Observations

- The evidence-mining phase was the right call and changed the output substantially.
  Total yield was 149 cited candidate non-goals across nine packages — far more than could ship — so drafting became selection rather than invention.
  `pi-permission-system` alone produced 31 candidates with 28 backed by an ADR or numbered design principle; `pi-nocd` produced 3.
- The briefs' most valuable output was **negative**, and it constrained the charter rather than feeding it.
  Three things had to be kept out: durable persistence of an approval in `pi-permission-system` (design principle 8 and the authority model anticipate it, so writing it as a non-goal would have contradicted the architecture), the whole policy-source channel question (undecided across several parked requests, tracked in #639), and Pi's client-server split in `pi-subagents` (a deferral pending an upstream capability, not a boundary).
  A drafting pass without the mining phase would plausibly have asserted at least the first as a non-goal.
- The `## Gaps`-versus-`## Candidate non-goals` split did the work it was designed for.
  Agents consistently refused to promote absence to boundary — `pi-github-tools`'s brief called the tool-surface question "the largest gap… the strongest signal is silence in `git log`, which is absence", and `pi-colgrep`'s flagged one plan Non-Goal as issue-scoped sequencing that a later commit had already violated, warning it must not be promoted to a charter line.
- Thirteen shipped boundaries came from `ask_user` gates rather than artifacts, because the evidence recorded only absence: `pi-nocd` instruction-not-enforcement; `pi-session-tools` transcript entries read-only; `pi-github-tools` surface closed to the ship/release flow, and release-please-only; `pi-autoformat` non-blocking is permanent; `pi-colgrep` wrapper with a single backend; `pi-permission-model-judge` typo paths only; `pi-subagents-worktrees` child sessions only, and ends at the branch; `pi-permission-system` no permissive defaults or presets, and no outbound event bridges; `pi-subagents` `tools:` as the sole widening mechanism, and no global run-mode default.
  Four further gate decisions resolved to omission: `pi-autoformat` lint-versus-format left unstated, `pi-permission-system` agent steering dropped for want of a durable basis, `pi-subagents` reimplement-don't-merge routed to `CONTRIBUTING.md` (#776), and `pi-permission-system` #639 named as an open decision rather than asserted as a boundary.
  Recording the list here answers the pre-completion reviewer's one caveat, which was that no artifact enumerated them.
- The cross-check step earned its place.
  `pi-session-tools` routed peer-worktree teardown to `@gotgenes/pi-subagents-worktrees`, whose charter — written two commits later — explicitly disclaims human-driven peer sessions.
  Neither package's brief could have caught it; only reading the nine finished charters together did.
  A charter set is a system, and the last step has to treat it as one.
- The distribution rule the plan derived held up under measurement.
  `pnpm pack` confirmed `pi-permission-system` ships `docs/*.md` but not `docs/architecture` or `docs/decisions`, so its ADR citations had to be absolute GitHub URLs, while `pi-subagents` ships both and keeps relative links.
  Had the plan not checked the `files` allowlists at planning time, roughly a dozen README links would have resolved to nothing in the npm tarball.
- One deviation from the plan's step sequence: the two Tier A mining agents were dispatched during step 1 rather than step 2, so they could claim concurrency slots (the runner caps at 4) as the Tier B agents finished.
  The commits stayed split as planned, using explicit pathspecs.
- Two boundaries were asserted knowingly without a durable citation, both operator calls: `pi-permission-system`'s conservative-defaults position (a closed-issue comment only) and its no-outbound-bridges rule (supported by analogy, since the architecture doc states the rule for the opposite direction).
  Both answer live requests, which is why they shipped.
- Pre-completion reviewer: PASS.
  No warnings requiring action; its single caveat about the unenumerated operator-decision list is addressed above.

## Stage: Implementation — Revision (2026-08-19T03:50:27Z)

### Session summary

The operator reviewed the shipped charters and rejected them on length: too much content for someone evaluating whether to use a package, and `## Install` pushed far down every README.
Each section was cut to roughly five one-line non-goals and relocated to the reference tail, with the full inventories moved into `architecture.md` for the two largest packages.

### Observations

- The length problem was real and measurable, and the build session shipped it without noticing.
  Sections ran 29 to 68 lines; for `pi-colgrep`, `pi-subagents-worktrees`, and `pi-nocd` the charter was a third or more of the entire README, and `pi-github-tools` went from install instructions at line 9 to line 48.
  After the revision `## Install` sits at its original line in all nine packages.
- The root cause was a framing error, not sloppy editing.
  The mining phase produced 149 cited candidate non-goals, and having paid for them it felt wasteful to drop any — so each section became a complete inventory of every defensible boundary rather than an answer to the requests that actually arrive.
  `pi-permission-system` shipped 13 non-goals where the recurring requests cluster on about five.
- The placement decision made at the planning gate was sound **given the assumption** that the section would be short.
  Once it ran 40-plus lines, "before the setup block" stopped serving the reader it was chosen for.
  A placement choice and a length budget are one decision, and the planning gate asked only the first half.
- The operator's suggestion to move full inventories into `architecture.md` resolved the tension the trim would otherwise have created.
  The mined detail stays durable and citable for `pi-permission-system` and `pi-subagents` — both docs now carry a table mapping each boundary to its ADR or design principle, plus an explicit list of what is **not** a boundary — while the READMEs stay short.
  `docs/architecture` is in `exclude-paths`, so that commit cut no release.
- Reader-audience separation is the lesson worth carrying: the person evaluating a package and the person about to file an issue want different things from a README, and the evaluator is far more common.
  Scope belongs with the reference material, not above the install instructions.
- `pi-permission-system`'s purpose sentence was reworded on operator feedback.
  "An agent takes many actions and only some of them matter" was dismissive of both the agent and the user's judgment; the shipped line is that most actions are benign and some need a human to confirm they are safe or correct.
- Verified after the revision: `pnpm run check`, `pnpm run lint`, and `pnpm pack` on both large packages all clean, with `pi-subagents` shipping the architecture doc its README links relatively and `pi-permission-system` still excluding it, which is why that link is an absolute URL.

## Stage: Implementation — Cross-check audit (2026-08-19T16:03:23Z)

### Session summary

The operator asked to walk through the contradictions the build session found, which surfaced that the terminal cross-check had been a spot check reported as coverage.
An exhaustive pass over the routing graph — all 23 routing statements, 12 of them pointing at another package in this repo — found two further contradictions, both on the one edge the spot check never examined.

### Observations

- The build session's cross-check checked the edges it had recently been thinking about and reported the result as though it were coverage: "permission-system ↔ subagents ↔ worktrees ↔ session-tools ↔ nocd routing all cross-checked".
  `pi-permission-model-judge` is absent from that list, and both new contradictions sit on its edge with `pi-permission-system`.
  The pre-completion reviewer then repeated the claim back, because the claim was supplied to it in the dispatch prompt — a reviewer cannot independently verify a coverage assertion it was handed as a premise.
- Both new contradictions predate the condensation, so they survived the original drafting, the cross-check, and the reviewer.
  Neither was introduced by trimming.
- Contradiction 2: `pi-permission-system` routed "model-assisted judging of an `ask`" to `@gotgenes/pi-permission-model-judge` without qualification, while that package's charter accepts only mistyped paths and routes every other judgment purpose to a different chain link.
  The sender is the package most likely to receive that request.
- Contradiction 3: the same edge in reverse.
  The judge routed "allow-capable adjudication" to `pi-permission-system`, which disclaims making model calls.
  Two things were collapsed into one phrase — the delegation envelope (whether a link may return `allow` at all, `pi-permission-system`'s, tracked in issue #620) and the adjudication itself (a link's).
  The fix reframes the permission system's routing around the authorizer seam and states in the non-goal that model judgment *attaches* through the seam, rather than reading as a bare refusal.
  The operator confirmed the seam is a design goal, which is what the earlier wording obscured.
- The audit also found one non-contradiction worth recording: `pi-nocd` routes "giving a child its own working directory" to `pi-subagents-worktrees` while that package routes "whether a child gets an isolated workspace at all" to `pi-subagents`.
  Both are true — mechanism and policy respectively — but a reader following the first can bounce to a second.
  Left as is.
- One capability in the graph is disclaimed by a package and claimed by none: `pi-nocd`'s "enforcing the rule".
  That is the deliberate consequence of the planning-gate choice to state the boundary without naming an owner, not a defect — but it is the graph's only dead end and worth knowing about.
- Method note for any future charter work: a charter set is a directed graph, and the check that matters is per-edge, not per-package.
  Enumerate every routing statement, resolve each target, and read that target's own non-goals.
  Nine packages produced 12 inter-package edges, which is small enough to check exhaustively in one pass — there was never a reason to sample.
- Also worth recording: the earlier claim that the cross-check step "earned its place" was hollow.
  The one contradiction it fixed (`43c36685`) was in a sentence the condensation pass deleted outright a few commits later, so that fix is now moot.
  The step earned its place on this pass instead.
- The operator then raised a separate concern the audit had not been looking for: the sibling-package links read as self-advertising.
  Comparing each charter's links against mentions already elsewhere in the same README split them cleanly — eight restated a relationship the README already had to document (a prerequisite, or where a removed feature went), and four were new.
  The four new ones were exactly the promotional-feeling ones.
  `pi-github-tools` pointing at `pi-session-tools` was the worst: two packages with no relationship, which co-occur only in this repo's prompt templates.
  That is a private workflow leaking into a published README.
- Same root cause as the length problem, a third time.
  The four-part template mandated a routing line for **every** package, and a uniform slot has to be filled, so packages with no genuine adjacency got links manufactured to fill it.
  The tell was visible all along: `pi-autoformat` and `pi-colgrep` carry zero sibling links and route only to `treefmt`, pre-commit hooks, and Pi's built-in `grep`/`find` — the two most credible sections in the set, precisely because every pointer leads away from this repo.
- The rule adopted is ecosystem-or-prerequisite: sibling links survive only between `pi-permission-system` and the model judge, and between `pi-subagents` and worktrees.
  Five packages now carry none.
- Removing them exposed a second-order effect worth remembering.
  Condensing a non-goal so it carries its own rationale absorbs the routing information, so once the sibling link was gone the remaining routing lines for `pi-nocd` and `pi-session-tools` only restated the non-goals above them.
  Both sections now end after the non-goals.
  A routing paragraph earns its place only when it names an owner the non-goals do not.
- The first replacement lines written for `pi-github-tools` and `pi-session-tools` had exactly that redundancy and were reverted within the same step — the reflex when deleting a line is to write a replacement, and sometimes the correct replacement is nothing.

## Stage: Artifact-reliability findings (2026-08-19T16:34:07Z)

### Session summary

Walking through the artifact-versus-reality contradictions produced a durable rule, now recorded in `AGENTS.md` under § Reading this repo's own artifacts, and an audit of all 15 ADRs identifying which need amendment or supersession.
Two follow-up issues were filed: [#779] for `pi-subagents` and [#780] for `pi-permission-system`.

### Observations

- Four artifacts stated a boundary the code contradicted.
  `pi-colgrep`'s plan `0092` listed `promptGuidelines` under Non-Goals and `fa164a19` changed one **the same day, under the same issue** — the brief reported "days later", and the real gap was hours.
  `pi-github-tools`' plan `0005` forbade retry/timeout on one-shot tools before #673 and #764 added both.
  `pi-permission-system`'s unmerged PR #692 looks like a decline while design principle 8 and `architecture.md:570` ("a future 'always' writes config") anticipate the capability.
  `pi-subagents` ADR-0001 is `superseded` and is still the only record of the `pi -e` limitation.
- The unifying diagnosis is that none of these artifacts is wrong — each is correct in its own frame, and the charter asked them a question they were never written to answer.
  A plan's `## Non-Goals` answers "what is out of scope for **this change**"; a charter asks "what is out of scope for **this package**".
  Same words, different question.
  Worse, one heading carries three unrelated claims — sequencing, deferral, and a real boundary — which are grammatically identical and only one of which belongs in a charter.
- Pull-request status is an **inverted** signal in this repo.
  Seven of nine closed-unmerged external PRs on `pi-permission-system`, and six on `pi-subagents`, were adopted and reimplemented with `Co-authored-by` credit — so "closed unmerged" here usually means *accepted*.
  A miner reading close status as intent would have produced a charter declining the features that actually shipped.
- The citation policy turned out to be load-bearing for correctness, not just tone.
  "Cite ADRs and architecture docs, never contributor PRs" was chosen at the planning gate so a shipped README would not name someone's declined PR.
  Because ADRs are written to be durable while plan Non-Goals are written to be scoped, that same rule is what kept all four stale artifacts out of the READMEs.
  A tone decision bought staleness protection as a side effect.
- The rule distilled into `AGENTS.md`: a plan Non-Goal is a **lead, not a citation** — use it to find the ADR or numbered design principle, and cite that.
  All four failures are caught by that one sentence.
- ADR audit: 14 of 15 are `accepted` and healthy.
  The work is three-shaped — one superseded ADR still load-bearing (`pi-subagents` 0001), one accepted ADR whose own amendment supplies the argument an open PR uses against a decision just made (`pi-subagents` 0002 on additive vs. subtractive settings keys), and three boundaries published with no decision record (run-mode default; conservative defaults; outbound bridges).
  `pi-permission-system` ADR-0007 needs nothing — the authorizer-seam reframing is consistent with it.
- The seven packages with no `docs/decisions/` tree were deliberately left alone.
  Their README charter is now the record, and introducing ADR practice there would be new process rather than a fix.

## Stage: Final Retrospective (2026-08-19T17:05:00Z)

### Session summary

Shipped a `## Scope and non-goals` charter to all nine package READMEs, grounded in nine committed evidence briefs mined by parallel read-only subagents, and released nine patch versions.
The work took two operator-driven revision rounds after the first pass shipped — one for length, one for cross-package self-promotion — and a subsequent exhaustive audit found two contradictions that the build session, its cross-check, and the pre-completion reviewer had all missed.

### Observations

#### What went well

1. The evidence-mining subagent pattern is new to this repo and carried the issue.
   Nine parallel read-only agents produced 149 cited candidate non-goals, and the mandatory citation plus the `## Gaps` section did the load-bearing work: agents consistently refused to promote absence to boundary.
   `pi-github-tools`' brief called its own tool-surface question "the largest gap… the strongest signal is silence in `git log`, which is absence", and `pi-colgrep`'s flagged a plan Non-Goal that a later commit had already violated, warning it must not be promoted.
2. The mining caught four artifact-versus-reality traps before any reached a README, including one where `pi-colgrep`'s plan `0092` declared `promptGuidelines` out of scope and `fa164a19` changed one the same day under the same issue.
3. The citation policy chosen at the planning gate for **tone** — cite ADRs, never a contributor's declined PR — turned out to be load-bearing for **correctness**, because ADRs are written to be durable while plan Non-Goals are written to be scoped.
   That insight is now generalized in `AGENTS.md` § Reading this repo's own artifacts.
4. Dispatching nine background subagents at once worked cleanly against the runner's four-concurrent cap — the surplus queued and claimed slots as earlier agents finished, so no manual batching was needed.

#### What caused friction (agent side)

1. `premature-convergence` — the uniform four-part section template was settled at the planning gate on shape and placement alone, with no size budget.
   That single under-specified decision produced three separate defects: sections running 29 to 68 lines, routing links manufactured for packages with no genuine adjacency, and a placement above `## Install` that was only defensible for a short section.
   Impact: two full operator-driven revision rounds, five commits (`99f58298`, `9ee1952c`, `f613f757`, `3f30984b`, plus the moot `43c36685`), touching all nine READMEs twice.
2. `scope-drift` (user-caught) — the first pass wrote each section as a complete inventory of every defensible boundary rather than an answer to the requests that actually arrive.
   The cause was sunk-cost reasoning about the 149 mined candidates.
   `pi-permission-system` shipped 13 non-goals where recurring requests cluster on about five, and `## Install` moved from line 27 to line 95.
   Impact: one revision commit removing 372 lines and adding 253, plus a new architecture-doc home for the displaced inventories.
3. `other` — overclaiming verification scope (user-surfaced, in that the exhaustive pass only ran because the operator asked to walk through the findings).
   The build session's cross-check examined the edges it had recently been thinking about and reported "permission-system ↔ subagents ↔ worktrees ↔ session-tools ↔ nocd routing all cross-checked", a list that silently omits `pi-permission-model-judge`.
   Both contradictions live on that omitted edge.
   The claim was then handed to the `pre-completion-reviewer` in its dispatch prompt, so the reviewer repeated it back as verified — a reviewer cannot independently check a coverage assertion supplied to it as a premise.
   Impact: two contradictions shipped in the first pass and survived three separate checks; fixed in `3f30984b`.
4. `other` — a reflexive replacement edit.
   When the promotional links were removed from `pi-github-tools` and `pi-session-tools`, the first replacement lines simply restated the non-goal directly above them, trading advertising for redundancy.
   Self-caught and reverted within the same step.
   Impact: no rework beyond one extra edit round.
5. `other` — the `pre-completion-reviewer`'s PASS went stale.
   It reviewed the state at `725ff3ca`, after which five substantive commits landed (condensation, architecture-doc inventories, routing fixes, link cleanup, the `AGENTS.md` rule).
   The final shipped state was never seen by a fresh-context reviewer.
   Flagged to the operator before shipping, who accepted it knowingly.
   Impact: none realized, but the gap was structural rather than noticed by the protocol.

#### What caused friction (user side)

1. Nothing obstructive.
   Both revision rounds were caught by the operator only because the agent shipped defects, and the earliest cheap place to prevent them — a size budget in the planning gate — was the agent's to offer and was not offered.
2. One opportunity worth naming: the planning gate's placement question presented five options with no indication of what the section would cost in lines.
   Had a worked example accompanied that question, "before the setup block" would likely have been rejected on the spot.
   The operator answered exactly the question asked; the question was the wrong shape.
3. The mid-planning redirect from "draft from README prose" to "send subagents to explore each package" was the single highest-leverage intervention in the issue, and it came from the operator.

### Diagnostic details

- **Model-performance correlation** — the nine mining subagents ran as `general-purpose` with **no** `model:` override, inheriting the session default (`anthropic/claude-opus-5`).
  The task was judgment-heavy — separating a recorded boundary from mere absence — and output quality was high, but the model was never deliberately chosen.
  `AGENTS.md` warns that `Explore`'s haiku default is too weak for multi-hop reasoning; using `general-purpose` sidestepped that warning without replacing it with an explicit choice.
  The `pre-completion-reviewer` ran on `anthropic/claude-sonnet-5` per its frontmatter, which is appropriate for a checklist pass.
- **Escalation-delay tracking** — no sequence exceeded five consecutive tool calls on the same error.
  The session had no rabbit holes; its failures were premature convergence and over-production, not thrashing.
- **Unused-tool detection** — the terminal cross-check was performed inline with ad-hoc greps and sampled rather than enumerated.
  A dedicated subagent, or a scripted enumeration of every routing statement against every target's non-goals, would have caught contradictions 2 and 3 during the build session.
  Twelve inter-package edges is small enough to check exhaustively; there was never a reason to sample.
- **Feedback-loop gap analysis** — verification was incremental and appropriate: `pnpm run lint` ran after each package's edits, `pnpm run check` and `pnpm -r run test` at baseline and completion, and `pnpm pack` plus `tar tzf` verified the distribution rule at the point the citation link-form decision was made.
  The one gap is the stale reviewer PASS noted above, which is a protocol gap rather than a tooling one.

### Changes made

1. `AGENTS.md` § Clarification gates — added the size-budget rule: a decision settling a structure that repeats across many files must settle its size budget in the same gate, with a worked example of the largest instance.
2. `AGENTS.md` § Background agent guardrails — added the mirror of the existing universal-claim rule: a reviewer cannot verify a coverage assertion supplied to it as a premise, and a change creating N cross-referencing artifacts needs its edges enumerated rather than sampled.
3. `.pi/skills/pre-completion/SKILL.md` § Overall: PASS — added that a PASS is scoped to the commit it reviewed, and that substantive commits landing afterward require a re-dispatch before `/ship-issue`.

Considered and rejected: a charter-writing skill (one issue is not a pattern; [#777] will exercise it first), a rule forcing an explicit `model:` on judgment-heavy `general-purpose` dispatches (no evidence of harm, only of an unexamined default), and abandoning the uniform-template convention (the fix is a size budget, not variable structure).
The artifact-reading rule needed no retro change — it landed mid-session in `5c7c4779`.

[#777]: https://github.com/gotgenes/pi-packages/issues/777
[#779]: https://github.com/gotgenes/pi-packages/issues/779
[#780]: https://github.com/gotgenes/pi-packages/issues/780
