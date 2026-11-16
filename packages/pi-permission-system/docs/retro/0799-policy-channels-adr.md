---
issue: 799
issue_title: "pi-permission-system: decide which channels permission policy may enter through (ADR)"
---

# Retro: #799 — decide which channels permission policy may enter through (ADR)

## Stage: Planning (2026-11-01T22:00:25Z)

### Session summary

This session inventoried the shipped policy channels from source and grouped the twelve dependants into four clusters: new file sources, write-back, relaxation scope, and a precedence floor.
At the one planning gate the operator chose to decide all four clusters in one ADR (0016), to file the measured `ConfigStore.save()` erasure as an independent bug, and to unpark PR [#638] now.
The plan (`docs/plans/0799-policy-channels-adr.md`) structures `/build-plan` as six deliberation gates (A–F) over the admissibility criteria and the four clusters, followed by ADR authoring and a disposition sweep.

### Observations

- Two behaviors were measured with disposable tests through the real code, then deleted:
  - `ConfigStore.save()` rewrites the global file from `existing.config`, which is `{}` for a schema-rejected file, so one yolo toggle erased a `bash` deny; on a valid file it strips JSONC comments.
    Filed as [#1102].
  - A session rule `systemctl restart *` overrode a config deny on `systemctl restart trader` (and `/etc/*` on `path_write`), confirming comment 1's report.
    The arity table makes that pattern the routine suggestion.
- The issue body's "#638 adds an overlay layer" was a misreading: PR [#638] is a TUI `overlay` dialog option.
  It was unparked by comment; the earlier park comment had called it a configuration channel.
- Comment 1's "three resolvers" finding is now two: `evaluateFirst` was removed by #928, leaving `evaluate` and `evaluateAnyValue`.
  Its testing hazard stands, so the plan requires a `PermissionManager.check`-level pin per resolver.
- Pinned Pi 1.0.0 already exposes `pi.getSettings()` (trust-gated project settings) and `pi.registerFlag()`, which reshapes the options for [#675] and `--yolo`; Pi's settings merge semantics are unverified and deferred to build step 1.
- Nothing in `src/` protects the extension's own config files from an agent with a `write` allow; mid-session re-reads are mtime-driven (traced in code, not run).
  The plan carries this as candidate criterion K6 rather than a filed issue, since whether it is a defect depends on Gate A.
- The `Co-authored-by:` lines for every contributor whose mechanism a gate might adopt were resolved at planning and written into Build Order step 8.
- roadmap-fit: no open phase in pi-permission-system, so [#1102] exited at step 1.
- After the first plan commit, the operator added a fifth cluster, session-layer management: see every rule in effect (filterable), and remove or modify session-layer rules in any direction, in memory only.
  It became Parameter 5 / Gate F, sequenced after the floor gate because "any direction" composes with the floor answer; the build surface is filed as [#1103].
  The operator's three inputs (view all, edit only the session layer, any direction) are recorded in the plan as givens, not gate candidates.
- The operator then folded a `/permission-system:` command namespace into [#1103]: a hard rename with no alias, following pi-subagents' `23bf99e8`, shipping in the same major as the rules view.
  I had questioned the premise that the rename rides a breaking change, since [#1103] as filed is additive; the operator chose to pair it with [#1103] anyway.
  The package skill's "Preserve the `/permission-system` slash command name" rule is rewritten in that change; ADR 0016 does not decide the rename.
- roadmap-fit: [#1103] exited at step 1 as well.

[#638]: https://github.com/gotgenes/pi-packages/pull/638
[#675]: https://github.com/gotgenes/pi-packages/pull/675
[#1102]: https://github.com/gotgenes/pi-packages/issues/1102
[#1103]: https://github.com/gotgenes/pi-packages/issues/1103

## Stage: Implementation — Build (2026-11-16T02:25:48Z)

### Session summary

The build ran Gates A–G interactively and recorded ADR 0016 (`d655ddd8`), deciding the seven admissibility criteria, the channel set and precedence, write-back into `config.local.json` files, auto-approve as a terminal after the chain, a named unrestricted mode, config denies outranking the session layer, session-layer management, and self-protection of the policy files.
At the operator's request mid-build it also added a package glossary (`cd313f51`), filed ten implementation issues ([#1118]–[#1127]) and wrote them into the disposition map (`d6df2adb`), then reconciled ADR 0007, 0012, 0013, the architecture doc, and the glossary in two reviewer-driven fix rounds (`3ce02e33`, `f637e599`).
All ten plan steps completed except step 10's replies on dependant threads, deferred to `/ship` by the operator.

### Observations

- **Replies for `/ship` to post after the push** (the ADR links 404 until then):
  - [#799]: @stanleytejakusuma (config denies outrank the session layer, [#1120]; the per-resolver pin is an obligation there) and @schuettc (in-session auto-approve, [#1118]; attribution, [#1124]).
  - Declined: PR [#675] (Pi `settings.json`), PR [#1073] (ancestor configs; offer the path-provider and content-provider shapes and ask hirak99's preference, leaning path), PR [#671] (env var; point to `--auto-approve`).
  - Admitted or reshaped: PR [#692] and [#691] (`*.local.json` targets, integrity contract, re-prompt on failure: [#1122], [#1123]), [#603] (subsumed), [#604] (editable pattern, [#1123]), [#720] (`--auto-approve`, [#1118]), PR [#990] (session command, renamed, [#1118]), [#1031] (serving-node scoping, [#1118]), PR [#983] (admitted as proposed; unparked).
  - Re-scoped: [#1103] (deny suspension, issued-grants list), [#1102] (integrity contract), [#1108] (later scope's patterns go after), [#1110] (`{runtimeDir}`, `{uid}`, `{cwd}` placeholders).
  - Not commented, dispositions recorded only: [#1104], [#1105] / PR [#1106], [#1115] / PR [#1107], [#1116].
- **Gate format.**
  A bundled K1–K5 gate bounced ("go over these one at a time … provide context"); every later gate briefed one question with history, consequences, and concrete scenarios first.
  Several `ask_user` calls failed with "no visible text" when the call carried no prose in the same message; the operator's guidance was to present the case in the message, then call `ask_user`.
  Twice the operator saw the options without the question ("What was the question?"), and the fix was restating the full question.
- **Operator asides that changed the design**, each better than the plan's candidate: the glossary; yolo acting before the chain ("Have I misunderstood?") became auto-approve as a terminal; "run this agent completely unfettered" became the unrestricted mode; Route 3 (a downstream policy-source point) stayed open with binding constraints; "Do *we* offer `systemctl restart *`?"
  reopened Gate E and produced deny-aware suggestions plus deny suspension (P2) instead of two kinds of session rule.
- **Re-survey before closing.**
  The operator asked for a survey of issues filed during the build before Gate G; [#1108] showed the cross-scope merge keeps a redefined key's position, which every slot decision had assumed away.
  A long deliberation should re-survey incoming issues before its final gate.
- **Measured during the build** (disposable tests, deleted): the floor and erasure spikes re-ran unchanged; per-scope vs merged-first sugar expansion flips an action (799c); `suggestBashPattern` outputs (799d); the deny-coverage probe through `wildcardMatch` (799e); Pi's `hasTrustRequiringProjectResources` on a temp tree (`repo` true, `repo/src` false).
- **Shell slip.**
  The `d655ddd8` commit body went through `git commit -F -` from a heredoc, against `shell-traps` and the documented permission deny rule, which did not fire; the message landed intact (no backticks).
  Worth checking why the deny rule did not match.
- **Radius web search** returned 403 (terms acceptance) until the operator re-enabled it; the harness survey (Claude Code, Copilot CLI, Codex CLI permission-mode names) then informed the auto-approve rename.
- **Deviations from the plan:** the glossary; decisions beyond the five clusters ([#1108], [#1110], auto-approve, unrestricted, the extension point); dated amendments to ADR 0007 and 0012 and a forward-pointer amendment to 0013 (the plan predicted 0013 unchanged and did not foresee 0007/0012); replies deferred to `/ship`.
- **Co-authors** on `d655ddd8`: stanley, Court Schuett, Adam Spiers, ReStranger, minicx, Maksim Ryzhikov, Anders Bennedsgaard, Po-Yeh Chen, Julian Grinblat.
  Not credited (declined): gavinsomers ([#671]), chronoAP ([#675]), hirak99 ([#1073]).
- **roadmap-fit:** no open phase in pi-permission-system; exited at step 1 for all ten filed issues.
- **Pre-completion reviewer:** WARN → WARN → PASS.
  Round 1: ADR 0007/0013 back-pointers missing, new ambient inputs not reconciled with ADR 0009/0003, glossary gate order wrong (written from the architecture prose, not the pipeline), glossary scope entry contradicting measurement 4, a channel-term collision, two attribution slips.
  Round 2: amendment-entry ordering and naming.
  Round 3: PASS.

[#603]: https://github.com/gotgenes/pi-packages/issues/603
[#604]: https://github.com/gotgenes/pi-packages/issues/604
[#671]: https://github.com/gotgenes/pi-packages/pull/671
[#691]: https://github.com/gotgenes/pi-packages/issues/691
[#692]: https://github.com/gotgenes/pi-packages/pull/692
[#720]: https://github.com/gotgenes/pi-packages/issues/720
[#799]: https://github.com/gotgenes/pi-packages/issues/799
[#983]: https://github.com/gotgenes/pi-packages/pull/983
[#990]: https://github.com/gotgenes/pi-packages/pull/990
[#1031]: https://github.com/gotgenes/pi-packages/issues/1031
[#1073]: https://github.com/gotgenes/pi-packages/pull/1073
[#1104]: https://github.com/gotgenes/pi-packages/issues/1104
[#1105]: https://github.com/gotgenes/pi-packages/issues/1105
[#1106]: https://github.com/gotgenes/pi-packages/pull/1106
[#1107]: https://github.com/gotgenes/pi-packages/pull/1107
[#1108]: https://github.com/gotgenes/pi-packages/issues/1108
[#1110]: https://github.com/gotgenes/pi-packages/issues/1110
[#1115]: https://github.com/gotgenes/pi-packages/issues/1115
[#1116]: https://github.com/gotgenes/pi-packages/issues/1116
[#1118]: https://github.com/gotgenes/pi-packages/issues/1118
[#1120]: https://github.com/gotgenes/pi-packages/issues/1120
[#1122]: https://github.com/gotgenes/pi-packages/issues/1122
[#1123]: https://github.com/gotgenes/pi-packages/issues/1123
[#1124]: https://github.com/gotgenes/pi-packages/issues/1124
[#1127]: https://github.com/gotgenes/pi-packages/issues/1127

## Stage: Final Retrospective (2026-11-16T03:57:07Z)

### Session summary

One process ran the build, the ship, and this retro: seven deliberation gates settled ADR 0016, a package glossary was added mid-build, ten implementation issues ([#1118]–[#1127]) were filed, and three reviewer rounds (WARN, WARN, PASS) reconciled the earlier ADRs.
The ship pushed twelve commits, released `pi-permission-system` 42.0.1, closed #799, and posted the sixteen dependant replies deferred from the build once the ADR link resolved on `main`.

### Observations

#### What went well

- Disposable spikes through the real code answered gate questions with measured output rather than reasoning: the session-grant override, the erasure, per-scope versus merged-first sugar expansion, the `suggestBashPattern` table, the deny-coverage probe through `wildcardMatch`, and Pi's trust function on a temp tree.
  The suggestion table is what turned Gate E around.
- Operator questions phrased as questions ("Have I misunderstood?", "Do *we* offer `systemctl restart *`?", "What could we do differently?") redirected the design better than any option list did: auto-approve as a terminal, the unrestricted mode, and package P2 all came from them.
- Deferring the dependant replies to `/ship` until the ADR link resolved, then posting all sixteen with `--body-file`, kept contributors from landing on a 404.

#### What caused friction (agent side)

- `instruction-violation` (tool-caught, then user-caught) — about eight `ask_user` calls were rejected for "no visible text": the briefing sat in an earlier message (before an `Edit` that recorded the previous decision), and the call went out alone.
  Three of the fallbacks restated only the options, so the operator asked "Which table?", "What was the question?", and "I see the options but I don't see a question"; the operator's correction was to present the case and then call `ask_user`.
  Impact: roughly eight extra round trips, three of them operator confusion.
- `instruction-violation` (self-identified, after the fact) — `d655ddd8`'s message went through `git commit -F -` from a heredoc; `shell-traps` was not loaded until step 10.
  The guard meant to catch it never fires: measured with `wildcardMatch`, the deny pattern `git commit*-F` matches none of `git commit -F -`, `git commit -F - -- a.md`, or `git commit -q -F - -- a.md b.md`, because it requires the command to end in `-F`; only `git commit*-F-` matches its own form.
  Impact: none on this commit (no backticks in the body); the rule has been silently dead.
- `premature-convergence` (user-caught) — Gate A bundled K1–K7 into one form; the operator asked to go "one at a time" with history and consequences.
  Impact: one round trip; every later gate was one decision.
- `missing-context` (self-caught at the operator's prompt) — Gate E was first decided without saying that the over-broad pattern is the package's own suggestion, though the plan's Background already traced it ("traced, not run").
  Impact: Gate E reopened from Gate F; the second answer (P2) was better.
- `missing-context` (reviewer-caught) — the decisions widened past the plan's predicted Module-Level Changes, and the earlier records were not re-checked: ADR 0007, 0012, and 0013 lacked amendment entries, the glossary's gate order came from architecture prose rather than `tool-call-gate-pipeline.ts`, and the glossary's scope entry contradicted measurement 4 once [#1108] surfaced.
  Impact: two fix commits (`3ce02e33`, `f637e599`) and two extra reviewer dispatches (about 320 s).
- `missing-context` (user-prompted) — the cross-scope merge-position mechanism appeared twice (spike 799c, the rejected allow-all overlay) without being generalized; [#1108] surfaced it only because the operator asked for a re-survey of issues filed during the two-week build.
  Impact: caught before authoring; no rework.

#### What caused friction (user side)

- The "one decision per gate, with history" preference is stable for this operator in contested design space, and the plan already said "brief to parity"; stating it at the top of the build would have saved Gate A's bounce.
- The glossary request arrived mid-Gate B, when the vocabulary load was already high; a glossary pass during planning would have given every gate shared terms from the start.

### Diagnostic details

- **Model-performance correlation** — the build and this retro ran on `claude-opus-5-5`; the ship ran on `claude-sonnet-5-5`, including drafting the sixteen public replies (three of them declines on contributor PRs), which is judgment-heavy public text the operator did not see before posting.
  All three `pre-completion-reviewer` rounds ran on `claude-sonnet-5-5`; round 1 found real record-consistency defects, so the model fit the task.
- **Feedback-loop gap analysis** — `rumdl` and `pnpm run lint` ran after every write, but no consistency pass re-read the glossary and earlier ADRs after a gate changed a fact they stated; the reviewer did that work at the end.

### Changes made

1. `.pi/extensions/pi-permission-system/config.json`: the heredoc-commit deny patterns `git commit*-F` and `git commit*-F-` became `git commit*-F -*` and `git commit*-F-*`; measured with `wildcardMatch` to match `git commit -F -`, `git commit -q -F - -- a.md b.md`, and `git commit -F-`, and not `git commit -F /tmp/msg.txt` or a `-m` commit.
2. `.pi/skills/clarification-gates/SKILL.md`: the briefing goes in the same message as the `ask_user` call, and a call rejected for no visible text is re-sent with the question and its substance in full.
3. `.pi/prompts/build-plan.md`: a decision record that answers, widens, or reverses an earlier ADR adds a dated Status entry to it in the same commit; before a decision record's final gate, list the issues and pull requests filed since the plan commit.
