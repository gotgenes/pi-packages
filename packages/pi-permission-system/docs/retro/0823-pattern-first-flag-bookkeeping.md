---
issue: 823
issue_title: "pi-permission-system: a pattern-first command's flag bookkeeping drops the real file operand"
---

# Retro: #823 — a pattern-first command's flag bookkeeping drops the real file operand

## Stage: Planning (2026-08-28T06:40:01Z)

### Session summary

Planned the fix for the fail-open [#821]'s pre-completion review found: `collectPatternCommandTokens` recognizes only the short spellings in `PATTERN_FIRST_COMMANDS` and discharges a pending flag-argument consumption only on an `ARG_NODE_TYPES` node, so eight real spellings make the walker eat the command's own file operand as though it were the inline pattern.
The settled direction replaces the two flag `Set`s with one spelling-to-role map carrying short **and** long forms, adds `--name=value` and glued `-Xvalue` matching, widens the discharge to any node type, and gives the pattern-first walker ownership of its own `--opt=value` split so a pattern flag's value stops surfacing as a path.
A spike over 4057 deduplicated real bash commands measured the whole change at 1 changed external set (+1 token, −0) and 3 changed rule-candidate sets, then was reverted; the plan is `packages/pi-permission-system/docs/plans/0823-pattern-first-flag-bookkeeping.md`.

### Observations

- **The spike found a ninth bypass the issue does not list.**
  `sed -i` is in the table unconditionally, which is right for BSD (`sed -i '' 's/…/' f`) and wrong for GNU (`-i[SUFFIX]` is glued-only), so on GNU the script is eaten as the suffix and the **write** target is eaten as the pattern.
  The package has pinned it as a green `describe("known limitations")` characterization test since long before this issue, with a comment inviting the flip.
  Writing the spike as a real implementation and running the full suite against it is what surfaced it — a paper design would not have.
- **The direction-of-failure analysis inverted the intuition about the table.**
  Under-listing an argument-consuming flag turns out to be safe: an unrecognized spaced flag merely shifts *which* positional is eaten, and the last operand survives (`rg --pre CMD pattern /etc/passwd` surfaces the file both before and after).
  Over-listing is what drops an operand.
  That asymmetry — not "be thorough" — is the rule the ADR amendment records, and it is what made the bounded amendment defensible and the full option audit unattractive.
- **Three variants of the `sed -i` question were measured before the gate, not argued.**
  Keeping it as-is: 1 external / 3 rule sets changed, GNU bypass retained.
  Dropping it from the table: 4 / 19, all the extra ones noise from BSD `sed -i ''` scripts whose script text becomes a rule candidate.
  A conditional `suffix` role (consume the next argument only when it is empty): byte-identical to the first on the corpus **and** fixes GNU.
  The operator took the third; without the numbers the second would have looked like the obviously-safe choice.
- **Every option spelling was verified against a real surface before it entered the plan.**
  `man grep`, `rg --help`, `sd --help` on this host; man7's `gawk(1)` and `sed(1)` for the two GNU tools not installed.
  Two facts changed the design: `sd -f` is `--flags` (regex flags), not a script file — today's `text === "-f"` test wrongly disables `sd`'s positional skipping — and GNU's `--in-place` takes its suffix only with `=`, so the long form is deliberately **absent** from the table.
  This is the [#807] lesson applied in the right order for once, before the text shipped rather than during the retrospective.
- **The Tidy-First assessor's three recommendations were all accepted and all structural.**
  Reorder the pending-consumption check ahead of the `ARG_NODE_TYPES` gate as a behavior-preserving move first (so the fix becomes "drop that gate"), extract `dischargePendingConsumption` returning `{ consumed, token? }` (so the `suffix` role's "no, I did not consume this" answer has somewhere to live instead of the fall-through the spike improvised), and deduplicate the verbatim-triplicated grep/awk table entries in the current shape before reshaping them.
  It also corrected two counts in the design summary and confirmed the single call site of `collectEmbeddedOptionValues`.
- **Release framing.**
  Not a roadmap step, so `ship independently`.
  Classified non-breaking `fix:` — it does change gate behavior on upgrade, but on 1 of 4057 real commands and only toward surfacing genuine access, the same call as [#821] at 2 of 3995.
- No follow-up issues were filed: the remaining residuals (GNU long-option abbreviation, a cluster whose argument-taking flag is not first, glob-filter option values, an unlisted consuming flag) all over-surface rather than drop, and belong in the ADR 0009 residual list rather than in issues.

#### Deferred tidyings

- `src/access-intent/bash/token-collection.ts` — `collectGenericCommandTokens`, `commandArgumentWords`, and `collectEmbeddedOptionValues` each carry a near-identical "skip `command_name`/`variable_assignment`, filter `ARG_NODE_TYPES`" loop preamble; the assessor declined it because this change touches none of those functions.

[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#821]: https://github.com/gotgenes/pi-packages/issues/821

## Stage: User Note (2026-08-28T23:56:19Z)

### Observation

> I cant recall a session where we went back and forth with pre-completion this much.
> What could we have done differently?
> Could we have divided the work in another way?
> Could we have prepared more to make this easy (nemawashi, "Make the change easy, then make the easy change")?

### Analysis

Five review rounds (FAIL, WARN, WARN, WARN, WARN), and every finding after the first was the **same defect class**: a table row asserting an argument arity that does not hold for every binary the command *name* can reach.
`--context` (grep's getopt says optional-argument, rg's clap says required), then awk's GNU long forms shared with one-true-awk, then the bare name `awk` being GNU awk on Fedora/RHEL.
One class, discovered one binary at a time.

#### The mechanism half was never wrong; the data half was wrong six times

The change had two independent halves, and fusing them is what made each defect expensive:

- **Mechanism** — the discharge on any node type, the positional counting, the role vocabulary, the walker restructure, moving the `=`-value split inside the pattern-first walker.
  **Zero** defects across five rounds.
  This is the half the plan prepared well and the Tidy-First assessor tidied well; its three preparatory refactors all paid off exactly as predicted.
- **Data** — which spelling sits in which table with which role.
  **Every** defect lived here.

Because they shipped as one change, each data defect forced a re-review of the whole thing.
Split, the mechanism could have been reviewed once and shipped after round 1, with the table landing family-by-family behind a cheap targeted check.

#### The verification method was wrong in kind, not in thoroughness

The plan's `External facts, verified` table has six rows keyed by **source document** (`man grep`, `rg --help`, `sd --help`, man7 `gawk(1)`, man7 `sed(1)`, BSD `sed` usage).
It answered "does this flag exist and take an argument" and was diligent about it.
The question that actually governs the security boundary is "does **every binary this name reaches on a supported host** take a *separate* argument for it" — and no amount of care with the first question produces the second.

A table keyed by `(command name × spelling)` with a column for *which implementations this name resolves to* would have exposed all three defects on sight: `awk` has three implementations, `grep` and `rg` share `--context` while parsing it differently, `sed` splits BSD/GNU.
The table's **shape** was the missing analysis, not its contents.

#### The nemawashi that would have made this easy

An executable arity oracle, built before the fix: for each `(command, spelling)` row, run the real binary with a probe that reveals arity — `<cmd> <flag> SENTINEL nonexistent-file`, then observe whether `SENTINEL` was consumed — and assert the table's role matches.
Roughly thirty lines.
It would have caught `--context` and the awk long forms **at planning time, before the first line of the fix**, and it would have made every later table edit self-checking.
That is the literal "make the change easy, then make the easy change": build the instrument that makes the data verifiable, then write the data.

Its limit is worth recording too, because it is exactly how the last defect escaped: an oracle can only run binaries **present on the host**, and the gawk-as-`awk` case required reasoning about an implementation that is absent here.
So the oracle covers present implementations and the ADR rule has to cover absent ones — and that rule needed rewriting three times before it said the right thing, ending at "where no single answer holds, decline the question" (the `unknown-arity` role).

#### Two self-inflicted rounds

- Round 2 existed because I defended a measurement instead of re-deriving it.
  The "projection is byte-identical with and without the `--context` entry" claim was true when measured and false three commits later, because `dce4d3f0` changed how an unclaimed node spends a positional.
  A measurement is scoped to the commit it was taken at; re-running it costs seconds and defending it cost a round.
- The corpus figure in the plan (`1` external set changed) is actually **2**.
  I re-derived it three times and got `1` every time, because I diffed against a baseline JSON captured at planning time while the filesystem underneath drifted.
  The reviewer got the right answer by swapping `token-collection.ts` at each commit and re-running against the *current* filesystem.
  A corpus baseline whose projection depends on filesystem state cannot be cached across a session — it must be re-captured, not reused.

  **Correction, added at the Final Retrospective:** this bullet is wrong, and it is wrong in exactly the way it warns against.
  It was written accepting the reviewer's round-5 claim without re-deriving it.
  Three minutes later I did re-derive, with the reviewer's own instrument (both source versions against the current filesystem), and got **1** — the third changed command gains a *rule candidate*, not an external access, and its external set is byte-identical.
  The methodological half of the bullet stands (do not cache a filesystem-dependent baseline); the number does not.

#### What worked

Scoping each re-dispatch to the delta and naming the rounds already reviewed.
Rounds 3, 4, and 5 each returned a *new* instance rather than relitigating, and the round-5 dispatch cost roughly half of round 1's.
The adversarial mandate also kept earning its place: rounds 3 and 4 found defects in rows I had personally verified against a man page hours earlier.

## Stage: Implementation — TDD (2026-08-28T23:59:22Z)

### Session summary

Executed the plan's six TDD steps — three Tidy-First preparatory refactors, two `fix:` commits, one `docs:` — then six further commits absorbing five rounds of pre-completion review.
Thirteen commits total, six of them `fix:`.
The package suite went 3645 → 3699 passing (+54); measured over 4057 deduplicated real bash commands, the whole change alters **1** command's external-access set (gaining a token) and **3** rule-candidate sets, losing **0** tokens anywhere.
Pre-completion reviewer: FAIL → WARN → WARN → WARN → WARN, with both round-5 findings resolved after it reported.

### Observations

- **The plan's mechanism held; its data did not.**
  Every one of the six review findings was a table row asserting an argument arity that does not hold for some binary the command name reaches.
  The walker changes the plan designed — role vocabulary, discharge on any node type, moving the `=`-value split inside the pattern-first walker — drew zero findings across five rounds.
  The User Note above analyses why, and what would have prevented it.
- **Four defects beyond the issue's own list**, three of them fail-opens the issue never reported:
  1. GNU `sed -i 's/…/' f` dropped a **write** target (found by the planning spike; the package had pinned it as a green `known limitations` test inviting the flip).
  2. A computed or numeric **pattern positional** (`grep 42 /etc/passwd`, `grep $PATTERN /etc/passwd`, `rg 3 /etc/passwd`) projected **nothing at all** — pre-existing, verified byte-identical on `b0ac7485`, and found by re-deriving the reviewer's `--context` finding rather than by the corpus.
  3. `--context`, which this issue added, dropped an operand on grep (getopt declares it optional-argument; rg's clap does not) — a row I introduced.
  4. awk's GNU long forms, also added here, dropped an operand on whichever implementation the shared row guessed wrong.
- **The `unknown-arity` role is the durable answer to the last one.**
  The bare name `awk` is GNU awk on Fedora/RHEL and one-true-awk or mawk elsewhere, so *either* arity drops a real operand on the other family and the projection cannot see which binary it will reach.
  Claiming neither — taking neither the argument nor the pattern slot — over-surfaces on both, which is ADR 0009's recoverable direction applied to the arity question itself.
  The ADR rule was rewritten three times before it reached "where no single answer holds, the table declines the question rather than guessing."
- **Two review findings were refuted on measurement, not argued away.**
  Round 1's blocking `--context` claim ("a newly recognized flag now eats an operand it did not before") measured identical with and without the entry at that commit, and its proposed fix — deleting the row — measured strictly worse.
  Round 5's claim that the external-changed count is 2 rather than 1 conflated a rule-candidate gain with an external one; re-derived with the reviewer's own instrument, the third changed command's external set is byte-identical.
  Both were reported back with the measurement rather than accepted.
- **The one round I caused**: my "byte-identical" `--context` evidence was captured before `dce4d3f0` and went stale when that commit changed how an unclaimed node spends a positional, so the operator's decision rested on a false premise and had to be revisited.
  Re-deriving a measurement after any behavior change costs seconds; defending one costs a round.
- **Deviations from the plan.**
  Seven commits beyond the plan's six-step TDD Order, all resolving review findings.
  Three are behavior changes the plan did not scope (the computed-pattern positional, the `--context` split, the awk arity role), each gated with the operator before landing.
  The plan document is left as written; its residual list is superseded by ADR 0009's, which is the record that ships.
- **Reviewer warnings at hand-off:** none outstanding.
  Round 5's two findings were the `architecture.md` dangling clause (fixed in `2202a560`) and the corpus-figure correction (refuted above); the three earlier rounds' findings all landed as commits.

## Stage: Final Retrospective (2026-08-29T00:21:30Z)

### Session summary

Planned, implemented, and shipped [#823] across one continuous session: seventeen commits closing six operand-dropping defects in the bash path projection's pattern-first walker, released as `pi-permission-system` 27.1.2.
Five pre-completion review rounds ran before hand-off (FAIL, WARN, WARN, WARN, WARN), every one of them finding a real defect, and four of the six defects fixed were never in the issue's own report.
Measured over 4057 deduplicated real bash commands the whole change alters 1 command's external-access set, gaining a token, and loses none.

### Observations

#### What went well

- **The mechanism/data asymmetry is the durable finding, and it is measurable.**
  Across five adversarial review rounds the walker redesign — role vocabulary, discharge on any node type, positional counting, moving the `=`-value split inside the pattern-first walker — drew **zero** findings.
  The lookup table of external facts drew **six**.
  Same plan, same session, same author; a 0-vs-6 split between two halves of one change is strong evidence they are different kinds of work and want different instruments.
- **Refusing two reviewer findings on measurement was correct both times.**
  Round 1's blocking claim and round 5's corpus correction were each refuted by re-running the projection rather than by argument, and in round 1 the reviewer's proposed fix measured strictly *worse* than the code it objected to.
  An adversarial reviewer earns deference on findings, not on impact claims — those are re-derivable and should be re-derived.
- **Every operator gate was answered with measured rows, not reasoning.**
  Four `ask_user` gates fired (the `sed -i` variants, the finding-3 disposition, the `--context` split, the awk arity role) and each carried a table of before/after projections against the real tools.
  The operator chose the fail-safe option every time, and on the `--context` gate reversed an earlier decision once the evidence behind it was shown to have gone stale.
- **Mutation-checking a green-on-arrival pin caught a vacuous test.**
  `grep -f $(echo x) /etc/passwd` passed during the step-4 Red, so I broke the recursion it covers and confirmed it went red — and separately discovered `grep -A $(echo 3) …` asserted a token (`3`) the package never emits, replacing it with `$(cat /etc/shadow)`, which does.

#### What caused friction (agent side)

- `missing-context` — the plan verified its flag table against **documentation** (`man grep`, `rg --help`, `sd --help`, man7 `gawk(1)`/`sed(1)`) and recorded the result in an `External facts, verified` table keyed by *source document*.
  Documentation answers "does this flag exist and take an argument"; the security boundary asked "does every binary this *name* reaches take a *separate* argument".
  No amount of diligence with the first question produces the second, and `AGENTS.md` § Reading this repo's own artifacts already told me to verify against `man`/`--help` — which I did, and which was not enough.
  Impact: three of the six defects (`--context`, awk's long forms, the `awk`-as-gawk case), three review rounds, four extra commits (`bba83175`, `52488f02`, `6c8e4a0b`, `2202a560`), and two operator gates that would not have been needed.
- `other` — defending a measurement instead of re-deriving it.
  My "the `--context` entry is output-neutral" evidence was captured before `dce4d3f0`, which changed how an unclaimed node spends a positional; the claim silently went false and the operator's decision rested on it until round 2 surfaced the mismatch.
  Impact: one full review round, one reversed operator decision, one commit (`bba83175`).
- `other` — the same failure recurred **inside the retro file itself**: the User Note stage accepted round 5's "the count is 2" correction as fact, and the TDD stage written three minutes later refuted it by re-derivation, leaving the file self-contradictory until this entry corrected it.
  Impact: no rework, but a wrong number sat in a durable artifact.
- `instruction-violation` (self-identified) — an `Edit` call used a hand-built absolute path with a doubled package segment (`/Users/chris/development/pi/pi-permission-system/src/…`), tripping the `external_directory` gate instead of failing fast.
  `AGENTS.md` § Shell and search states the repo-relative rule and [#726] records this exact failure; it is also the second consecutive session in this package to hit it.
  Impact: one rejected call, no rework.
- `other` — a `git checkout` to restore a mutation-test file silently reverted the step-4 green change with it, which I caught only by re-reading the file.
  A mutation probe edits the same file the change lives in, so restoring by `git checkout` discards both.
  Impact: one re-applied edit, no lost work.
- `other` — an `Edit` call carried a stray `oldText2` key, which the tool silently ignores while reporting success.
  `AGENTS.md` warns about exactly this; the reported block count was checked against intent, so nothing was dropped.
  Impact: none.
- `other` — during this retrospective, `list_session_files` was called to locate prior-stage transcripts and returned all **524** session files for the repo, flooding the context for no benefit; the model attribution I needed came from a 12-entry `read_session` and two `head` calls on the agent frontmatter.
  Impact: wasted context, no rework.

#### What caused friction (user side)

- Nothing obstructive; the operator's four gate answers were all fail-safe and all held up under later scrutiny, including the one that reversed an earlier decision on corrected evidence.
- Opportunity: the mid-session question ("could we have divided the work in another way?") produced the sharpest analysis of the session and arrived *after* the fifth review round.
  The same question asked after round 2 — when the second same-class defect appeared — would have reframed the remaining work while three defects were still unfound.
  A recurring defect *class*, rather than a count of rounds, is the signal worth interrupting on.

### Diagnostic details

- **Model-performance correlation** — planning, TDD, and this retrospective ran on `anthropic/claude-opus-5`; the ship sequence ran on `anthropic/claude-sonnet-5` (attributed from the inline transcript labels).
  Both subagent types are pinned to `anthropic/claude-sonnet-5` by their frontmatter (`.pi/agents/pre-completion-reviewer.md`, `.pi/agents/tidy-first-assessor.md`).
  No mismatch: judgment-heavy planning on the stronger model, the deterministic ship sequence on the cheaper one.
  Worth recording for the second consecutive issue that a `sonnet-5` reviewer with fresh context and an adversarial mandate out-found an `opus-5` implementer on the implementer's own change — five rounds running here, three in [#821].
  The advantage is context and mandate, not capability.
- **Escalation-delay tracking** — no `rabbit-hole` friction to measure.
  The longest single-target sequence was the five-round review loop, and each round terminated with a new verified finding rather than a repeat, so no sequence exceeded five consecutive calls on the same error.
- **Unused-tool detection** — one gap, and it is the session's central one: no tool was dispatched to verify the flag table, because none was written.
  `bash` was available throughout and is what finally answered every arity question; the missing instrument was a probe script, not a subagent.
  No `Explore`/`colgrep` gap — the target file was named in the issue.
- **Feedback-loop gap analysis** — no gap.
  All four gates ran to establish the baseline before the first cycle, file-scoped `vitest` ran on every Red and Green, and the full four-gate set ran after every commit and before the push.
  The corpus projection was re-measured after each behavior commit — with the one staleness failure noted above, which was a re-use of a cached baseline rather than a skipped run.

### Changes made

1. `AGENTS.md` § Reading this repo's own artifacts — sharpened the external-facts rule: documentation answers whether a flag exists, not what a given binary does with it, so run the tool when the answer gates a security boundary; and a shared table row asserts its fact of every implementation the *name* reaches.
2. `AGENTS.md` § Background agent guardrails — added that a measurement is scoped to the commit it was taken at: re-run it after any behavior change rather than defending it, and never re-use a cached baseline whose result depends on filesystem state.
3. `.pi/prompts/plan-issue.md` § TDD Order — added mechanism/data step sequencing: sequence a mechanism half and a data half as separate steps, and when the data is a table of external facts, write the check that verifies one row before writing the rows.
4. `.pi/skills/package-pi-permission-system/SKILL.md` — corrected the arity rule, which my own later commits in this issue had superseded: "every supported platform" → "every implementation the command name reaches", now naming the `--context` per-tool split and the `unknown-arity` role.
5. This retro file — the Final Retrospective entry, plus a correction to the User Note stage's corpus-figure bullet, which had accepted a reviewer claim that later re-derivation refuted.
6. `packages/pi-permission-system/docs/decisions/0009-bash-path-projection-completeness-contract.md` — a `#### Where the bound sits` subsection in the 2026-08-29 amendment, naming the three in-scope edits to `PATTERN_FIRST_COMMANDS`, pricing a row at the arity assertion it makes rather than at its line, and recording the arity oracle as considered-and-declined with the condition that would revive it; the Rejected-alternatives bullet now points at it instead of restating the "verified against that tool's own option list" claim this issue disproved.

#### Attribution of these changes to the mid-session `/retro-note`

The operator asked which changes their mid-session question produced.
Change 3 is substantially theirs: the mechanism/data decomposition exists because they asked whether the work could have been divided differently, and its "write the check before the rows" clause is the nemawashi half of the same question.
Without it this retrospective would have counted six defects and concluded "verify harder" — a count rather than a structure.
Change 1 is partly theirs: the finding was reachable from the round-3 and round-4 defects alone, but the reframing from *thoroughness* to *kind* (the plan's table was keyed by source document when the question was keyed by name→implementation) came from that exchange.
Changes 2 and 4 are not: the staleness rule came from the round-2 failure at the time it happened, and the skill fix from grepping for text this issue's own commits had superseded.
Worth recording that the note landed after the fifth round, so it could explain the session but not change it — the same observation as the user-side opportunity above.

#### Post-retro: the operator challenged the maintenance cost, and the numbers moved

After the retro was committed the operator pushed back that the issue had grown "beyond a bugfix" into expensive functionality.
Measuring it rather than defending it produced a sharper picture than either of us held:

|                      | before          | after      |
| -------------------- | --------------- | ---------- |
| code lines           | 312             | 371 (+19%) |
| comment lines        | 166             | 289 (+74%) |
| written flag entries | 48              | **47**     |
| roles                | 2 implicit sets | 5 explicit |

The table did **not** grow: deduplicating the triplicated `grep`/`egrep`/`fgrep` and `awk`/`nawk` aliases removed thirty duplicated entries and the twenty-five long forms added fewer back.
Nearly two-thirds of the file's growth is doc comments explaining platform hazards.
So the cost is neither rows nor code volume — it is that the table now asserts arities of **real binaries on real hosts**, a different kind of fact from "`grep`'s first operand is a pattern", and nothing re-checks them.

Two things are worth recording about how that exchange went.
First, the decomposition that answers the operator's instinct: the two highest-value fixes (the `-A 3` discharge, the computed-pattern positional) needed **no table at all** — about eighteen lines of walker logic — while two of the six defects were *created by* the table growth, in spellings with zero occurrences in the 4057-command corpus.
Value and maintenance cost ran in opposite directions across the change, and the retro had not said so.
Second, I quoted "17 → 47 flag table entries" in the first reply and it was wrong: 17 counted distinct short spellings before, 47 counted written rows after.
Mixing units while arguing about the cost of an issue whose entire lesson was "check the unit of the fact you are asserting" is the sharpest instance of that failure in the whole session, and it was caught only because the next command re-measured both sides in one unit.

Operator decision: build nothing, and amend ADR 0009 to state where the bound sits.
The arity oracle is recorded there as considered-and-declined, with the condition that would revive it.

One process note: inserting `#### Where the bound sits` reparented four residual bullets, because the anchor text sat inside a **list item** rather than at a section end.
`markdown-conventions` warns about exactly this, and the heading census (`grep -nE '^#{2,4} '`) that caught it should have run before the edit rather than after.
