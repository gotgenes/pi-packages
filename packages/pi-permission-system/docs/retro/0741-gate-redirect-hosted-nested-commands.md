---
issue: 741
issue_title: "pi-permission-system: commands inside redirect targets and heredoc bodies bypass the bash rules (residual #306 gap)"
---

# Retro: #741 — Commands inside redirect targets and heredoc bodies bypass the bash rules

## Stage: Planning (2026-08-15T03:19:18Z)

### Session summary

The session opened as `/plan-issue #306`, but [#306] was already closed as implemented and carried a later comment from `nikaro` reporting that `echo "hello world" > $(rm *.txt)` still bypasses the gate.
I reproduced the claim end-to-end against a real `PermissionManager`, found it correct and broader than reported, filed it as [#741], replied to `nikaro` on [#306], and then planned [#741].
Planning also uncovered a matching hole on the `path` / `external_directory` surfaces, which widened the issue's scope; the plan covers both surfaces plus a shared `nested-execution.ts` extraction, and defers control-flow bodies to [#742].

### Observations

- **The live repro was worth running.**
  The package skill's debugging rule ("reproduce the literal repro before concluding it is already handled") paid off in both directions: it confirmed `nikaro`'s case *and* surfaced four more (`>>`, `2>`, `&>`, `< <(…)`, unquoted heredoc) that the report did not mention.
  A pure code reading of `COMMAND_ENUM_SKIP` would have found the redirect case but probably not the heredoc one.
- **Root cause is a conflated set, not a missing branch.**
  `COMMAND_ENUM_SKIP` answers two questions at once — "is this a command?"
  and "can this host a command?"
  — and a redirect answers them differently.
  Framing the fix as splitting that set (rather than adding a special case for `file_redirect`) is what made the heredoc case fall out for free.
- **tree-sitter already solves the quoted-heredoc problem.**
  I expected to need a `heredoc_start` quote check; probing showed `<<'EOF'` and `<<"EOF"` simply produce no `command_substitution` node.
  Writing the issue before probing meant the filed text said "needs verifying" — the probe then simplified the design, and the issue was updated.
- **The review-log scan settled two decisions without an `ask_user`.**
  2950 unique bash commands: 0 with a redirect-hosted substitution (so the change is pure hardening), but 1341 (45%) carrying a redirect — which killed the tempting idea of folding the redirect into the enclosing unit's matched text, since that would break exact-match rules across half of real traffic.
  That went into Non-Goals with the number attached.
- **ADR 0009 triage mattered for framing.**
  The ADR lists "a command substitution (`$(cmd)`)" as an accepted residual, which could easily be misread as sanctioning this gap.
  It does not: the residual is the *computed filename*, not the inner command's own literal operands, which the projection already guarantees in argument position.
  Same shape as the `$HOME` half of [#694] — a guarantee met inconsistently across positions.
  The plan therefore includes an ADR clarification so the distinction is written down.
- **Versioning precedent was split and needed the operator.**
  [#301] shipped `fix:`, [#306] shipped `feat:`, but [#645] — the analogous *path*-projection widening — shipped `fix!:`.
  Because this plan does both kinds of widening, I surfaced the choice rather than guessing; the decision was non-breaking, justified by the 0-of-2950 measurement (no user needs to edit config, unlike [#645]'s 118 real hits).
- **Shared-module extraction was deliberately deferred until it had two consumers.**
  `nested-execution.ts` is justified only because the path surface needs the same context vocabulary once it must skip a host's text while descending its executions.
  Step 1 moves only what `command-enumeration.ts` already uses, so no export is dead at any commit and `fallow dead-code` stays clean.
- **Scope grew twice, both times on measured evidence.**
  Command surface only → both surfaces (path gap measured), and redirect targets only → plus heredoc bodies (quoted-delimiter handling proved free).
  Both were put to the operator as `ask_user` decisions with the measurements presented first.

## Stage: Implementation — TDD (2026-08-15T03:42:58Z)

### Session summary

Executed all seven planned TDD steps in order, landing seven commits: one preparatory `refactor:`, four `fix:` cycles (two per surface), one `test:` parity commit, and one `docs:` commit.
The bypass is closed on both the bash command surface and the `path`/`external_directory` surface, for redirect targets and interpolating heredoc bodies alike.
Test count went from 2784 to 2836 (+52) across 132 → 133 files; `check`, root `lint`, full `test`, and `fallow dead-code` are all green.

### Observations

- **The Tidy-First assessor found no work beyond the plan's own step 1**, confirming the plan had already identified the one real preparatory move (extracting the shared traversal before the path surface needed it).
  It also usefully reported that `program.test.ts` already uses the `it.each` table convention the new cases needed, which shaped how the tests were written.
- **One design detail the plan missed, caught by a failing test.**
  `forEachNestedExecution` searches *strictly within* a subtree, so a substitution that **is** the redirect destination (`> $(cmd)`) was not found — only one concatenated into it (`> ${DIR}/$(cmd)`) was.
  Step 4's first green attempt fixed 1 of 5 cases, which surfaced it immediately.
  Resolved locally in `collectHostedExecutionTokens` with a `NESTED_EXECUTION_CONTEXTS.has(node.type)` check rather than making the shared traversal root-inclusive — changing the shared semantics to fix one caller would have been the wrong lever.
- **Step 2 needed a correction mid-flight.**
  The first edit shrank `COMMAND_ENUM_SKIP` to its final two-element form, which would have left `heredoc_redirect` falling through to the catch-all "emit whole" branch for one commit — emitting a heredoc as a command unit.
  Caught before running tests by reasoning about the intermediate state; the skip set is now reduced in two steps, matching the two host-type additions.
  A reminder that a mid-plan commit must be correct on its own, not just at the end.
- **Quoted-heredoc handling really was free**, as planning predicted: no `heredoc_start` inspection shipped, and the negative tests pass purely because tree-sitter emits no `command_substitution` node for `<<'EOF'`.
- **The riskiest step behaved.**
  Step 4 extended `collectRedirectTokens`, which `bash-path-resolver.ts` calls directly at the [#454] pipeline first-stage fold.
  The full suite passed unchanged, confirming the plan's decision to flag it as a required regression check rather than a refactor target.
- **Pre-completion reviewer: WARN** (no FAILs).
  All deterministic checks, commits, docs, design, invariants, Mermaid, and dead-code passed.
  Two findings, both addressed:
  1. Missing implementation-stage retro entry — this entry.
  2. Substantive: the "nested-command bypass family" has more members than [#742] named.
     `declaration_command` (`local x=$(rm y)`, `export X=$(rm x)`), `test_command` (`[[ $(rm x) ]]`), `unset_command`, and bare `variable_assignment` all emit one whole unit with no nested descent.
     I verified this independently before acting: all are **pre-existing** (from [#306]'s original deferral), untouched by this change, and the *path* surface already projects most of them via generic recursion — only the command surface misses them.
     [#742] was widened (title and body) with the measured table rather than filing a duplicate.
- **Verifying the reviewer's finding was worth the probe.**
  The report's framing ("the deferral is not the only remaining gap") could have read as a regression in this change; the measurement showed it was a pre-existing scope question, which changed the response from "fix now" to "widen the follow-up."

## Stage: Final Retrospective (2026-08-15T04:04:23Z)

### Session summary

One continuous session took a stale `/plan-issue #306` invocation, discovered the issue was already closed with a live third-party bug report in its comments, verified the report, filed and planned [#741], implemented it across seven TDD commits, and shipped `pi-permission-system-v25.2.2`.
The bypass is closed on both the bash command surface and the `path`/`external_directory` surface; test count rose 2784 → 2836 (+52).
Two follow-ups came out of it: [#742] (widened during review) and a `/plan-issue` prompt gap that cost a user intervention.

### Observations

#### What went well

- **The `pre-completion-reviewer` earned its dispatch for the first time in a way that changed downstream scope.**
  It independently probed node types outside the change's scope and found that `declaration_command` (`local x=$(rm y)`, `export X=$(rm x)`), `test_command` (`[[ $(rm x) ]]`), and `unset_command` also host unenumerated substitutions.
  Neither planning nor implementation looked there.
  The finding did not block the ship — it correctly identified the gaps as pre-existing — but it caused [#742] to be retitled and rewritten with a measured table, which is a materially better follow-up than the control-flow-only issue originally filed.
- **Measurement replaced speculation at three decision points.**
  The review-log scan (2950 deduplicated bash commands) established that 0 real commands host a substitution in a redirect target, that 45% carry a redirect, and — via the second number — killed the tempting idea of folding the redirect into the enclosing unit's matched text.
  The same 0-of-2950 figure then settled the breaking-vs-non-breaking question against [#645]'s `fix!:` precedent.
  Every one of those could have been argued from first principles and gotten a different answer.
- **Checking the reviewer's own claim before acting on it changed the response.**
  The report's framing ("the deferral is not the only remaining gap") read like a regression in this change.
  A short probe showed the gaps were pre-existing and that the *path* surface already covers most of them via generic recursion — which turned "fix now" into "widen the follow-up."
  This is the `AGENTS.md` rule about verifying a subagent's universal claims paying off in the opposite direction from usual: the claim was true, but its *significance* was overstated.

#### What caused friction (agent side)

- `missing-context` (user-caught) — the opening `gh issue view 306 --json number,title,author,body,labels` fetched neither `state` nor `comments`, so I did not see that [#306] was closed or that it carried `nikaro`'s live bug report.
  The user had to supply it: "The latest comment says this is still an issue."
  Impact: one user intervention; no rework, since the correction landed before planning began.
  Root cause is in the prompt, not judgment — `/plan-issue`'s Gather-context step names the exact `--json` field list, and comments are not in it.
- `missing-context` (self-identified) — ran disposable Vitest spikes to inspect parser output before loading the `testing` skill, which documents that Vitest's default reporter hides `console.log` and that spike findings should be written to a file.
  Impact: ~4 wasted tool calls (a `grep`-filtered run producing no output, a plain run producing no output, a no-op `sed`, then the rewrite to `writeFileSync`).
  The `/plan-issue` skill-loading step gates the `testing` skill on "if the plan involves test changes or TDD steps" — but the *investigation* that precedes a plan routinely runs throwaway tests.
- `other` — near-miss on a broken intermediate commit at TDD step 2.
  The first edit shrank `COMMAND_ENUM_SKIP` straight to its final two-element form, which would have left `heredoc_redirect` falling through to the catch-all "emit whole" branch until step 3 added it as a host — emitting a heredoc as a command unit for one commit.
  Caught by reasoning about the intermediate state, not by a check.
  Impact: no rework, but the only guard was attention.
- `other` — an `Edit` call used `/Users/chris/development/pi/pi-permission-system/src/…`, dropping the `pi-packages/packages/` prefix.
  The permission system's `external_directory` gate caught it and named the correct path in the denial reason.
  Impact: one retry.
  Worth recording that the package under change blocked a real mistake in its own repo during its own implementation.

#### What caused friction (user side)

- Nothing substantive.
  Both interventions were well-formed: the first supplied decisive context the tooling had hidden, and the second ("If we confirm this is true, create a new issue for it") was correctly conditional — it authorized the outcome without pre-judging the verification.
  The one opportunity is upstream of the session: invoking `/plan-issue #306` on a closed issue is a signal the operator already knew something the prompt could not see, and saying so in the opening turn would have saved the round trip.

### Diagnostic details

- **Model-performance correlation** — planning, TDD, and ship ran on `anthropic/claude-sonnet-5`; this retrospective on `anthropic/claude-opus-5`.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran `anthropic/claude-sonnet-5` per their frontmatter.
  No mismatch: the reviewer's task was judgment-heavy (security completeness, ADR accuracy) and it produced the session's most valuable finding, so sonnet-5 was adequate there.
- **Escalation-delay tracking** — no sequence exceeded 5 consecutive tool calls on one error.
  The longest was the Vitest `console.log` fumble at ~4 calls, resolved by switching output mechanism rather than by persisting.
  TDD step 4's first green attempt fixed 1 of 5 cases and the cause was diagnosed on the next call.
- **Unused-tool detection** — `colgrep` was never dispatched, correctly: every search targeted exact symbols (`COMMAND_ENUM_SKIP`, `collectRedirectTokens`, `SKIP_SUBTREE_TYPES`), which is grep's case per the `colgrep` skill's decision table.
  An `Explore` subagent was likewise not dispatched for root cause, correctly — `/plan-issue` reserves that for a bug that does *not* reproduce locally, and this one reproduced on the first probe.
- **Feedback-loop gap analysis** — no gap.
  Verification ran incrementally throughout: scoped `vitest run <file>` at every Red and Green, `pnpm run check` before each commit touching shared types, the full package suite at steps 3–6, and root `lint` plus `fallow dead-code` at baseline, mid-run, and end.
  The baseline was captured as a number (2784 tests) before the first change, which is what made the +52 delta assertable at the end.

### Changes made

1. `.pi/prompts/plan-issue.md` — Gather-context step 1 now fetches `state` and `comments` (`gh issue view $1 --json number,title,author,body,labels,state,comments`), with a sentence directing a closed-or-superseded issue to be planned as a new residual issue.
   This is the fix for the session's one user-caught gap.
2. `.pi/prompts/plan-issue.md` — the `testing` skill load condition now also fires when investigation will run a disposable spike test, not only when the plan contains test changes.
3. `.pi/prompts/plan-issue.md` — added the note that `comments` must be a `--json` field because a separate `--comments` flag is silently ignored alongside `--json`.
   Caught by running the proposed command before landing it: `--json … --comments` exits 0 and returns no comments at all, so the prompt would have shipped a command that looked correct and quietly reproduced the original bug.
   A second instance of the `AGENTS.md` rule about verifying a remediation against the real surface.

[#454]: https://github.com/gotgenes/pi-packages/issues/454
[#301]: https://github.com/gotgenes/pi-packages/issues/301
[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#694]: https://github.com/gotgenes/pi-packages/issues/694
[#742]: https://github.com/gotgenes/pi-packages/issues/742
