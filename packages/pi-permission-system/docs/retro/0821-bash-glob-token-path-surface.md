---
issue: 821
issue_title: "pi-permission-system: bracket-glob path arguments bypass the external_directory gate"
---

# Retro: #821 — bracket-glob path arguments bypass the `external_directory` gate

## Stage: Planning (2026-08-28T00:55:26Z)

### Session summary

Planned the fix for a third-party fail-open report: `rejectNonPathToken`'s `REGEX_METACHAR_PATTERN` drops a path-shaped token containing `[...]`, `.*`, or `.+` before any shape classifier runs, so `cat /etc/[p]asswd` and `rm -rf /tmp/tmp.*` execute with no prompt.
The settled direction is to delete the heuristic outright from all three classifiers and gate a glob token by its literal text — parity with today's `*`/`?` handling — plus an ADR 0009 amendment recording the boundary.
Filed [#822] for the residual (an explicit rule pattern matches the token's spelling, not its expansion) and recorded roadmap dispositions for both issues against Phase 14.

### Observations

- **The heuristic is dead weight for its own motivating cases.**
  It entered in `9eab66cf` for `grep -v "//.*glob\|globalConfig"` noise, and plan `0091` later made collection command-aware (`PATTERN_FIRST_COMMANDS`).
  A spike re-ran that commit's own test corpus with the heuristic deleted: every case produced byte-identical output.
  The archaeology (`git log -S` to the introducing commit, then reading its plan) is what turned a judgment call into a measurement.
- **Measured, not argued.**
  A disposable spike projected 3995 deduplicated real bash commands from the local review log through `BashProgram` on `main` and on three candidate variants.
  Deleting the heuristic outright changes the external set for **2** commands (both true positives) and the rule-candidate set for **66** (1.65%); relaxing only the strict classifier changes 0 rule-candidate sets but leaves the `path` surface dropping glob tokens.
  Those numbers, not the ADR's prose, drove the operator's choice of the widest variant.
- **Alternatives considered and rejected.**
  Narrowing the pattern to unambiguously-regex forms (`\|`, `\(`, `\)`, `^/`) measured 46 rule-changed commands but leaves a smaller fail-open; relaxing only `classifyTokenAsPathCandidate` leaves the `path` surface broken.
  Bounded glob expansion was declined for this change and filed as [#822] — it sits near the sandbox seam ([#802], [#686]), which would subsume it.
- **The Tidy-First assessor's correction mattered more than its verdict.**
  It recommended no preparatory commits, but it traced each existing fixture through the acceptance gates and refuted the design summary's claim that the four assertion sites "invert": the strict-classifier block's six fixtures all stay `null` (rejected by the acceptance gate instead of the prelude), only `^/start` flips in the rule-candidate block, and the win32 and bare-token blocks flip wholesale.
  That per-token table is now the plan's authority for step 2, guarding against a scripted uniform substitution.
- **Third-party issue, `ask_user` gate honored.**
  The author is `mb1986`, not the gh CLI user, so the direction itself went to the operator along with the relaxation scope and the ADR handling.
  Substance (the measurement tables and the residual) was presented in a message first; the options only referenced it.
- **Release framing.**
  Not a roadmap step, so `ship independently`.
  Classified non-breaking `fix:` — it does change gate behavior on upgrade, but on 0.05% of real commands and only toward prompting for genuine external access.

#### Deferred tidyings

- `test/access-intent/bash/token-classification.test.ts` — three near-identical `describe("shared rejection: …")` blocks, one per classifier; the assessor declined unifying them into a parametrized table because the acceptance gates differ, so a shared table would need a per-classifier expected column.
- `test/access-intent/bash/token-classification.test.ts` — the third prelude block (line 420) is titled `"shared rejection prelude"` while its two siblings are `"shared rejection: rejectNonPathToken"`; cosmetic naming drift.

[#686]: https://github.com/gotgenes/pi-packages/issues/686
[#802]: https://github.com/gotgenes/pi-packages/issues/802
[#822]: https://github.com/gotgenes/pi-packages/issues/822
[#823]: https://github.com/gotgenes/pi-packages/issues/823

## Stage: Implementation — TDD (2026-08-28T05:48:14Z)

### Session summary

Executed the plan's three TDD steps — the pattern-first characterization pin, the prelude deletion with its per-token assertion rewrites, and the ADR 0009 amendment — then three further `test:`/`docs:` commits absorbing the pre-completion reviewer's findings.
The package suite went 3618 → 3645 passing (+27); `token-classification.ts` lost two lines of code and gained the reasoning behind their absence.
Pre-completion reviewer: FAIL → FAIL → WARN → **PASS**, across four rounds, each one finding a real defect in the *residual record* rather than in the fix.

### Observations

- **The fix itself was never in question.**
  Every review round passed the `src/` diff, the invariant pins ([#520], [#583], [#645]), the docs, and the commits.
  What each round attacked was the plan's Goal sentence — that pattern-first collection subsumes the deleted heuristic's noise-suppression role — and it was right to: the claim is true for a pattern-first command's positional and space-separated short-flag pattern arguments, and false for three other spellings.
- **Three rounds of escalating severity in unmodified code.**
  Round 1 found `collectEmbeddedOptionValues` splitting `--opt=value` with no flag-role awareness (`grep --regexp=/etc/passwd` → a false positive).
  Round 2 re-derived it and found the same root cause drops the command's *real operand* (`grep --regexp=harmless /etc/passwd` → nothing surfaced) — a fail-open, the same class as [#821] itself.
  Round 3 found two more spellings: a glued short flag (`-epattern`) and, worst, the everyday `-A 3` numeric argument, which tree-sitter types `number` — absent from `ARG_NODE_TYPES`, so the pending skip lands on the pattern instead.
  Round 4 generalized it once more: any node type outside that set, including `-A $N` and `-A $(echo 3)`.
  All measured byte-identical before and after the fix, so none is a regression from this change.
- **"Never a bypass" was the sentence that cost three rounds.**
  I wrote it into ADR 0009 and into [#823] from a single measured symptom, and each subsequent round refuted it further.
  A residual record is a claim about *everything the mechanism does*, so it earns the same skepticism as a subagent's universal claim — which is precisely the discipline the reviewer applied and I did not.
- **The corpus made the case, twice.**
  Planning priced the deletion at 2 external-changed and 66 rule-changed commands out of 3995; the review rounds re-used the same log to show the numeric-flag spelling appears in 21 of 4037 real commands, which is what moved [#823] from "latent, 0 occurrences" to "everyday spelling".
- **Mutation-checking pins paid off immediately.**
  The step-1 characterization pin was green on arrival, so I verified it by renaming `awk`/`rg` in `PATTERN_FIRST_COMMANDS` with the heuristic deleted — it went red, proving it pins the collector rather than the deleted prelude.
  A first draft of the same pin (`rg "^src/.*\.ts$" -l`) was vacuous, since that token is not path-shaped in the first place; the mutation is what exposed it.
- **Deviations from the plan.**
  Three commits beyond the plan's TDD Order, all `test:`/`docs:` and all recording the pattern-first residual rather than changing behavior.
  The plan document was deliberately left as written; its Goal overclaim is corrected in ADR 0009's residual bullet and here.
- **Follow-ups filed.**
  [#822] (gate a glob token by its expansions) at planning time; [#823] (pattern-first flag bookkeeping) during review, retitled twice as its scope grew, with a Phase 14 disposition revised from "deferred" to "fixed independently, next" once the bypass half was measured.
  Operator decision: ship [#821] now, [#823] is the next planned issue.

[#520]: https://github.com/gotgenes/pi-packages/issues/520
[#583]: https://github.com/gotgenes/pi-packages/issues/583
[#645]: https://github.com/gotgenes/pi-packages/issues/645
[#821]: https://github.com/gotgenes/pi-packages/issues/821
