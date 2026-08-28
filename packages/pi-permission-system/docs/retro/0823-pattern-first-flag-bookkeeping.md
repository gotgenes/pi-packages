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

#### What worked

Scoping each re-dispatch to the delta and naming the rounds already reviewed.
Rounds 3, 4, and 5 each returned a *new* instance rather than relitigating, and the round-5 dispatch cost roughly half of round 1's.
The adversarial mandate also kept earning its place: rounds 3 and 4 found defects in rows I had personally verified against a man page hours earlier.
