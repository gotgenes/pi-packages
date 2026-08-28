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
