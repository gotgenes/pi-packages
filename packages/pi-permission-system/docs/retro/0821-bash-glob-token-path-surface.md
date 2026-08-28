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
