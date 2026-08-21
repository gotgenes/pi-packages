---
issue: 789
issue_title: "pi-permission-system: consolidate the subagent adapter convention and loading-asymmetry docs (ADR 0012 decisions 5–6)"
---

# Retro: #789 — Consolidate the subagent adapter convention and loading-asymmetry docs

## Stage: Planning (2026-08-21T19:15:22Z)

### Session summary

Planned the consolidation of [ADR 0012] decisions 5 and 6 into the shipped docs as a cross-package plan at `docs/plans/0789-subagent-adapter-convention-docs.md`.
Investigation found that the issue's fourth scope bullet (rewriting `cross-extension-api.md` for the keyed channel) already landed with `8ed137c6` (#699) and `bc31193a` (#787), leaving only its subagent subsection in scope, and that decision 5's stated out-of-process obligation does not work — so the plan folds in a one-cycle `fix:` before any doc states it.
Three follow-up issues were filed for the exclusion hazards surfaced along the way: [#791], [#792], [#793].

### Observations

- **The ADR's contract was not honored by the code.**
  `PI_SUBAGENT_PARENT_SESSION` is in `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES` but not `SUBAGENT_ENV_HINT_KEYS`, so a spawner following decision 5 literally is undetected, takes the no-UI/not-subagent arm of `selectAuthorizer`, and is blocked by `DenyingAuthorizer` without forwarding.
  The existing round-trip tests encode the gap in their own arrangement — `test/composition-root.test.ts:428` stubs `PI_SUBAGENT_CHILD` *and* the parent-session var, with a comment explaining why both are needed.
  That comment is the strongest evidence in the plan and it was written by a prior session that did not notice what it implied.
- **The chosen fix composes rather than duplicates.**
  Adding the literal string to a second array was the obvious one-liner; composing `SUBAGENT_ENV_HINT_KEYS` from the third-party inventory plus the parent-session candidates encodes the reason ("a process that names a parent session is a child") and prevents the next candidate from reintroducing the gap.
- **The operator reopened decision 6's framing at the gate**, asking for something more seamless for the end user than a documented hazard.
  That produced the sharpening that matters: excluding a package also removes its tools from children, so a single package providing both a tool and its extractor leaves no gap — the hazard requires a *split* between a tool provider and an extractor provider.
  A general warning became a condition an operator can check.
- **Two more severe misconfigurations surfaced while enumerating scenarios**, neither previously tracked: an `excludedExtensionPackages` entry that matches no configured package source is silently inert ([#791]), and excluding `@gotgenes/pi-permission-system` itself leaves in-process children with no `tool_call` gate at all ([#792]).
  Both are reachable with one line of JSON and nothing reports either.
- **Alternatives rejected:** a separate `docs/subagent-adapter-convention.md` (ADR 0012 names `subagent-integration.md` as the canonical home); rewriting [ADR-0002]'s body lines 43/95 (an accepted record is not a status board — an appended amendment follows its own #696 precedent); repointing the two source module headers and pi-subagents' README/comparison doc (excluded at the gate).
- **Release framing:** neither package has an open improvement phase, so `roadmap-fit` exits at step 1 for all three filed issues and the plan ships independently.
  Both packages' `docs/decisions` and `docs/architecture` are `exclude-paths` entries, so only `subagent-integration.md`, `cross-extension-api.md`, the README row, and pi-subagents' `configuration.md` drive releases.

[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
[#791]: https://github.com/gotgenes/pi-packages/issues/791
[#792]: https://github.com/gotgenes/pi-packages/issues/792
[#793]: https://github.com/gotgenes/pi-packages/issues/793
[#794]: https://github.com/gotgenes/pi-packages/issues/794

## Stage: Implementation — TDD (2026-08-21T19:52:57Z)

### Session summary

Executed all five plan steps in five commits: the `fix:` making the adapter convention's out-of-process obligation actually sufficient, the spec-first restructure of `docs/subagent-integration.md`, the repointing of the three restating sites, the pi-subagents loading-asymmetry condition and ADR 0002 amendment, and the two package skills.
Test count went 3227 → 3230 in pi-permission-system; `check`, root `lint`, full `test`, and `fallow dead-code` are green.
Mid-session the operator surfaced a live runtime error that redirected the release plan and produced a new issue ([#794]).

### Observations

- **The Red step produced the strongest evidence in the change.**
  The new composition-root test failed with "Timed out waiting for the forwarded permission request" — the child never wrote one, because it was never detected.
  That is a cleaner proof of the ADR-vs-code gap than the reasoning in the plan, and it confirms the diagnosis rather than merely the signature.
- **The two existing out-of-process tests encoded the gap in their own arrangement.**
  Both stub `PI_SUBAGENT_CHILD` beside the parent-session id, commented "the hint makes the child detect itself, and the parent id names a session."
  A prior session wrote that comment without noticing it described a contract violation.
  They were deliberately left as-is: they cover the third-party spawners that set a marker but no parent session, which is a different population from a convention-conformant one.
- **A live error mid-session changed the release classification.**
  The operator's terminal showed `An authorizer is already registered for 'model-judge'` on a subagent start, thrown from the [#787] latch's re-emit.
  Diagnosis: `pi-permission-model-judge` still registers through the deprecated zero-arg accessor, which in an in-process child resolves the **parent's** service; the throw prevents its own `dispose` guard from ever latching, so every subsequent emission retries.
  This is [#699]'s original defect, still live pending [#788]; the latch raised it from two throws per child start to three.
- **Decision: the pending release becomes a major.**
  ADR 0012 decision 7 classified the latch as minor because `/reload` already re-emitted ready.
  The operator overrode that: the latch moved an unguarded consumer's failure from rare and user-initiated to every session, which is this repo's definition of breaking.
  The `BREAKING CHANGE:` footer rides [#794], since the [#699]/[#787] commits are already on `main` and cannot be retyped.
- **[#794] was filed on a fact discovered while answering the operator's naming question:** `getPermissionsServiceForSession` has never been published — 26.3.1 exports only the zero-arg accessor — so reclaiming `getPermissionsService(sessionId)` costs nothing externally.
  Decided shape: required `sessionId` argument (a `string | null` must not be able to reach the root slot), the whole `*ForSession` family renamed, and the root readers renamed to `*RootPermissionsService` to keep their deprecation window under an honest name.
- **Sequencing for the release:** #789 (done) → [#794] → [#788] → merge the release-please PR.
  [#794] must land before that PR merges, or the suffixed names escape into a published tarball.
- **Design choice on the fix:** composing `SUBAGENT_ENV_HINT_KEYS` from the per-extension markers plus `SUBAGENT_PARENT_SESSION_ENV_CANDIDATES`, rather than adding the literal string to a second array.
  The composition encodes the reason — a process that names a parent session is a child — so the next candidate added cannot reintroduce the gap.
- **Scope bullet 4 of the issue was already satisfied** by [#699]'s `8ed137c6` and [#787]'s `bc31193a`; only `cross-extension-api.md`'s subagent subsection needed repointing.
  Worth noting for future issues written against a multi-issue ADR: the decision map's items can land out of order.
- Pre-completion reviewer: **WARN**.

#### Reviewer warnings

- `packages/pi-subagents/README.md`'s "Permission System Integration" section still restates the channel name and pre-bind ordering independently, and README always ships regardless of the `files` allowlist.
  This is a deliberate exclusion — the clarification gate scoped repointing to three sites and explicitly left the pi-subagents README and `comparison-with-upstream.md` out — not a defect against the plan.
  It remains a residual gap for a future pass.

#### Deferred tidyings

- `test/composition-root.test.ts` — the "out-of-process forwarding liveness" block's three tests now share an arrange/act/assert shape around `writeGlobalConfig` / `fireChildRead` / `approveForwardedRequest` with no wrapping helper.
  The tidy-first assessor rejected extracting one as scope creep and as a premature discriminator-parameter abstraction, since the three differ only in which env stubs are set and which outcome is asserted.
  Recorded for `/plan-improvements` rather than acted on.

## Stage: Final Retrospective (2026-08-21T20:07:08Z)

### Session summary

Planning, TDD, and ship all ran in one continuous session: five commits landing the detection `fix:` and the four-surface doc consolidation, plus four filed follow-ups ([#791]–[#794]) and a mid-session semver reversal.
The issue closed with CI green; the release is deliberately held — PR #790 stays open until [#794] and [#788] land, so the cut becomes a major rather than `26.4.0`.
The dominant story is that a docs-consolidation issue turned into a contract-correctness issue twice: once when planning found the ADR's stated obligation did not work, and once when a live error in the operator's terminal reopened a settled semver classification.

### Observations

#### What went well

- **TDD earned its keep on what was nominally a docs issue.**
  The composition-root Red test failed with "Timed out waiting for the forwarded permission request" — the child never wrote one because it was never detected.
  That is a stronger proof of the ADR-vs-code gap than the plan's reasoning, and the archaeology was equally good: the two *existing* out-of-process tests stub `PI_SUBAGENT_CHILD` beside the parent-session id with a comment explaining why both are needed, which is a prior session documenting a contract violation without recognizing it.
- **The package under maintenance debugged its own maintainer.**
  A malformed absolute path (missing the `pi-packages/packages/` prefix) tripped the `external_directory` gate, and the denial reason named the correct path outright.
  The gate turned a mistake into a one-line correction instead of a hunt.
- **A cheap check reframed an expensive-looking question.**
  Comparing `.pi/npm/node_modules/@gotgenes/pi-permission-system/src/service.ts` (the published 26.3.1 copy) against the working tree established that `getPermissionsServiceForSession` has never shipped.
  "Should we do a painful rename?"
  became "what should we name a surface we are publishing for the first time?"
  — and produced [#794].
- **The ship stage overrode its own template correctly, on the cheaper model.**
  `/ship-issue` step 6 says merge the release-please PR; the TDD stage's retro said do not.
  The ship turn read the retro, verified the hold was still live (judge still on the zero-arg accessor, PR #790 still proposing `26.4.0`), skipped step 6, and said why — rather than following the mechanical instruction.
- **A live error was absorbed without derailing the cycle.**
  The operator's stack trace arrived mid-Red; the session stopped, diagnosed it as [#699]'s defect family amplified by [#787]'s latch, filed [#794], took a semver decision, and returned to the exact Red step.

#### What caused friction (agent side)

- `missing-context` — the loading-asymmetry clarification gate offered mechanism options (A/B/C/D) before establishing the facts the operator needed to choose among them: which package owns `excludedExtensionPackages`, and what happens today in each concrete configuration.
  The operator bounced it with exactly that request ("Which tool provides exclusion of packages… Provide me with some concrete scenarios or examples, both current behavior and desired future behavior").
  Impact: one extra gate round-trip, four tool calls of re-grounding, no rework — and the re-grounding produced the sharpened split-provider condition that shipped, so the bounce improved the outcome.
- `instruction-violation` (self-identified) — passed a hand-built absolute path to `read` instead of a repo-relative one, tripping the `external_directory` gate.
  `AGENTS.md` § Shell and search states this rule verbatim (Refs #726).
  Impact: one wasted tool call, no rework.
- `instruction-violation` (self-identified) — at ship, the close-comment range was built from a long path-filtered `git log` that pulled in #699/#786/#787 commits, then re-derived with `--grep`, then one false positive (`569d2a27`, which mentions #789 in #786's decision-map prose) had to be checked.
  The prompt says to anchor on the parent of the issue's first commit, and that parent had already been resolved one call earlier.
  Impact: three extra tool calls, no rework.
- `other` — an authoring typo ("a *another* package's tool") reached the file and was caught by re-reading, not by `rumdl`, which does not check grammar.
  Impact: one extra edit and re-lint before the commit.
- `other` — invoked `issue_close` as a shell command inside a `bash` call (`command not found`), then re-issued it as a tool call.
  Impact: one wasted call; the heredoc had already written the comment body, so nothing was lost.

#### What caused friction (user side)

- The operator's terminal had been showing the `model-judge` duplicate-registration stack trace before it was raised — it surfaced when a subagent dispatch made it visible again.
  Sharing it at the first sighting would have moved the semver decision ahead of the TDD cycle rather than interrupting it.
  Framed as opportunity: the interruption was handled cleanly, and the error arriving *during* implementation is what made its diagnosis concrete.
- The `#788`-is-closed recollection was checked with one read-only API call and corrected in a sentence.
  Worth noting as the cheap path working: the question cost less than acting on the wrong assumption would have.

#### Deferred follow-up

- **The release hold survived only as retro prose.**
  `/ship-issue` reads a deterministic `**Release:**` marker from the plan, but "do not merge PR #790 until [#794] and [#788] land" lived only in a retro observation, and the ship stage honored it because it happened to read the retro.
  A cross-issue hold has no machine-readable home today.
  Too large for a retro commit — it changes a contract `/plan-issue` writes and `/ship-issue` reads.
  Worth filing if a second hold ever recurs.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5`; the ship stage ran on `anthropic/claude-sonnet-5`; the retro on `claude-opus-5`.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on their frontmatter default `anthropic/claude-sonnet-5`.
  No mismatch: the judgment-heavy work (the ADR-gap diagnosis, three clarification gates, the semver argument) sat on opus, and the ship stage's one judgment call — overriding step 6 — was handled correctly on sonnet.
  The `pre-completion-reviewer` on sonnet produced a substantive WARN with verified cross-references, which is appropriate for the cost.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; no sequence of consecutive tool calls on a single error exceeded two.
- **Feedback-loop gap analysis** — verification ran incrementally rather than only at the end: full baseline before the first change, per-file `vitest` at each Red and Green, `pnpm run check` immediately after the `src/` change, `pnpm run lint` after each doc step, and the full gate before review.
  No gap found.
- **Unused-tool detection** — `colgrep` was never dispatched, correctly: every search this session was for an exact symbol or literal string (`SUBAGENT_ENV_HINT_KEYS`, `subagents:child`, `disallowed_tools`), which the `colgrep` skill's decision table assigns to `grep`.

### Changes made

1. `AGENTS.md` § Clarification gates — repaired a malformed `##` heading left by [#787]'s retro, which had structurally orphaned `### Background agent guardrails` and every sibling down to `### Code Style` out of the `## Workflow` section.
   The defect was **not** a typo: `rumdl fmt` applies MD018 ("no space after hash") to a line-initial `#787`, repairing it into a valid `## 787` heading.
   The first fix attempt reproduced it exactly — the line was rewritten as a plain sentence starting `#787's…` and the formatter promoted it again on save.
   The working form starts the line with `Refs #787:`, which is what the `markdown-conventions` skill's line-initial-issue-number rule already prescribes.
2. `AGENTS.md` § Clarification gates — added the rule that a gate offering mechanisms must first name which component owns the lever and what happens today in each concrete configuration.
3. `AGENTS.md` § Commits — added the published-surface check that must precede pricing a rename as breaking.
   The first draft proposed reading `.pi/npm/node_modules/@gotgenes/<pkg>/`; the operator rejected the mechanism as untrustworthy, since that copy is only as fresh as the last `pi update --extensions`.
   That failure mode is the dangerous direction — a stale copy shows a shipped export as absent and licenses a rename that breaks real consumers.
   The landed rule pairs `pnpm view @gotgenes/<pkg> version` (the registry, which cannot go stale) with `git show <pkg>-v<version>:<path>` (the file exactly as published), and fails loudly on a missing tag.
   Verified against this session's own question: at `pi-permission-system-v26.3.1` the file carries only `publishPermissionsService` / `getPermissionsService` / `unpublishPermissionsService`, confirming the `*ForSession` family is unpublished and [#794]'s rename is free.

Not landed: aligning `/ship-issue`'s cross-package range anchor with the `pre-completion` skill's `<plan-commit>^..HEAD` phrasing (offered, not selected).

[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#788]: https://github.com/gotgenes/pi-packages/issues/788
