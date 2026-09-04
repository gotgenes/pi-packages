---
issue: 840
issue_title: "pi-permission-system: an unparsed bash subtree is matched as an ordinary unit instead of failing closed (ADR 0013 §10)"
---

# Retro: #840 — An unparsed bash subtree fails closed

## Stage: Planning (2026-09-04T14:41:36Z)

### Session summary

Planned ADR 0013 §10's last combinator clause — flooring a command unit produced from an unresolved bash parse.
Measuring the real corpus before designing overturned both the issue's diagnosis and the roadmap Step 14 Target it was written into, so the plan's mechanism is not the one the roadmap predicted.
Committed the plan at `packages/pi-permission-system/docs/plans/0840-unparsed-bash-subtree-fails-closed.md`, filed follow-up [#875] for the enumeration residual, and recorded its Phase 14 disposition.

### Observations

- **The issue's own headline example does not do what the issue says.**
  The body claims the enumerator "emits the unparsed subtree's text as one ordinary unit".
  Measured with the real parser, `git commit -F - <<'MSG' 2>&1 | tail -4` emits `[{ text: "git commit -F" }]` — the `ERROR` sits under `heredoc_redirect → file_redirect`, an `EXECUTION_HOST_TYPES` member that is descended for substitutions and never read for text.
  The tail command is in no unit at all.
- **Measured corpus** (local review log): 5636 deduplicated `bash` commands, 367 truncated by the 1000-character cap, 5269 intact.
  Two have `rootNode.hasError`; **zero** emit an `ERROR` node's text as a command unit.
  So the roadmap's Target — "a marker on `BashCommand` set on the `ERROR` branch Step 4 introduces" — fires zero times on real input, and the population it does reach is input `bash -n` rejects.
  Step 14's `Outcome:` line ("1 command in 4276") counted `ERROR`-node presence, not units a floor on that branch would reach.
  This is the `Outcome:`-line hazard `AGENTS.md` records for [#810], hit again on a different step.
- **The sharper failure mode is a dropped unit, not a permissively matched one.**
  `git add -A . && git commit -F - <<'MSG' 2>&1 | rm -rf /tmp/x` is valid bash (`bash -n` accepts it) and enumerates without `rm -rf /tmp/x`, so an explicit `bash: {"rm -rf *": "deny"}` is never consulted.
  The floor cannot restore that; filed as [#875].
- **Design gate.**
  First gate offered trigger conditions A/B/C; the operator asked what would be *observably* different between B and C rather than picking.
  Answering it — the prompt value, and the session-approval pattern, both read from `check.command` — produced a hybrid (D) that neither option had: the enumerator marker's cheap wiring with the program-level option's whole-command blame.
  Under B the recorded session grant would have been `git commit -F`, an exact-match pattern on a *fragment* that silently covers any later `git commit -F - <<'X' 2>&1 | <anything>`.
- **I told the operator something false and corrected it.**
  The second gate's substance claimed a floored unit re-prompts every invocation even after a session grant, because `resolveBashCommandCheck` clamps on state with no `source` check.
  That is true of the clamp but not of the system: `GateRunner.runGateCheck` tests `check.source === "session"` **before** state and returns allow, and `resolveWrapperUnit` spreads `...base`, so `source` survives the floor.
  The exemption the operator chose is therefore already the behavior and costs no code — it just was not pinned by a test, which the plan now adds.
  The lesson is the ordinary one: I reasoned from one function to a system claim instead of following the value to its consumer.
- **Bump settled as `fix:`** (non-breaking) on the operator's call, against the package's own calibration: [#821] shipped `fix:` at 2 of 3995, [#839] shipped `fix!:` at 3 of 5191.
  This one is 2 of 5269, and both measured commands already appear as `session_approved`.
- **Roadmap disposition:** [#875] deferred to a later phase — its three candidate fixes (an upstream grammar fix with no lever, a heredoc pre-pass, an ADR §10 amendment to hard-deny) are none of them capability-axis questions.

#### Deferred tidyings

- `src/access-intent/bash/command-enumeration.ts` — `makeUnit` hand-chains a ternary per optional field (`scoped` → `flagged` → `named` → return); the assessor proposed rewriting it as a single conditional-spread build.
  Declined as optional: the existing pattern scales one field at a time and this change adds exactly one.

### Diagnostic details

- **Escalation-delay tracking** — the corpus measurement was the third spike, after two smaller AST dumps.
  Running it first would have saved both; the signal that it was needed (the issue's example not matching the code) was visible in the very first dump.
- **Feedback-loop gap analysis** — the `GateRunner` session-fast-path error above was caught only because the plan's Risks section forced me to name what pins the exemption.
  Nothing earlier in the workflow would have caught it, and it had already shipped to the operator inside an `ask_user` gate.
- **Model-performance correlation** — the `tidy-first-assessor` subagent returned two corrections worth more than its tidying: `collectHostedCommands`' fresh scope literal, and `program.test.ts` as an uncounted call site (its `#742` block asserts exact `BashCommand[]` literals via `.toEqual`).
  Both are in the plan; the second was not in the target file list I handed it.

[#810]: https://github.com/gotgenes/pi-packages/issues/810
[#821]: https://github.com/gotgenes/pi-packages/issues/821
[#839]: https://github.com/gotgenes/pi-packages/issues/839
[#875]: https://github.com/gotgenes/pi-packages/issues/875
