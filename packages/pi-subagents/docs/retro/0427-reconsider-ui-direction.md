---
issue: 427
issue_title: "pi-subagents: reconsider the UI direction from first principles (ADR)"
---

# Retro: #427 — pi-subagents: reconsider the UI direction from first principles (ADR)

## Stage: Planning (2026-06-18T00:00:00Z)

### Session summary

Planned the Phase 18 Step 8 decision-only ADR for the pi-subagents UI direction.
Two `ask_user` rounds with the operator (their own issue) settled a per-component decision and surfaced a key SDK finding — Pi's `switchSession(sessionPath)` — that reshapes the conversation-viewer direction.
The plan writes `docs/decisions/0004-reconsider-ui-direction.md` plus an architecture-doc update; no `src/`/`test/` changes (implementation deferred to a separately-planned Phase 19).

### Observations

- **Decision-only ADR → `/build-plan`, not `/tdd-plan`.**
  The operator chose to record decisions and defer all code to Phase 19, so the plan has a docs-only Build Order, no test cycles.
- **Per-component decisions recorded:** (A) foreground widget shrinks to background-agents-only; (B) conversation viewer replaced by native session navigation (remove the bespoke `ConversationViewer`); (C) `/agents` menu dissolved — **remove** both agent-management surfaces outright (creation wizard and agent-types config editor; managing definitions belongs in an editor/IDE or a Pi agent, not the menu), re-home running-agent visibility onto the widget + session navigation, extract settings to a focused `/subagents:settings` command; (D) distribution = keep surviving UI in-core (substitutable, _not_ extracted to `@gotgenes/pi-subagents-ui`).
- **Key SDK finding — `switchSession`.**
  `@earendil-works/pi-coding-agent@0.79.1` exposes `ExtensionActions.switchSession(sessionPath, { withSession })`.
  It is a _full active-session takeover_ (fires `session_before_switch`/`session_shutdown`, invalidates the current context), and the switched-to session is interactive (`ReplacedSessionContext.sendUserMessage`).
  A read-only alternative exists: `loadEntriesFromFile`/`parseSessionEntries` render a transcript without switching.
  These tensions are recorded as Phase 19 spike gates rather than pretend-resolved — the ADR commits to the _direction_ (native session machinery over a bespoke renderer), not the _mechanism_.
- **Operator-raised open questions (now Phase 19 entry criteria):** root-continuity during a session switch, view-only vs interactive, parallel-agent navigation gesture, settings command namespace, and confirming the creation-wizard's value is covered by "generate via a Pi agent" before deleting it.
- **Release:** ship independently — Phase 18 carries no `Release:` batch tag; this issue completes the phase.
- **Numbering:** plan `0427`, ADR `0004` (next free in `docs/decisions/`).

## Stage: Implementation — Build (2026-06-18T20:05:00Z)

### Session summary

Executed the decision-only ADR plan in two docs steps: wrote `docs/decisions/0004-reconsider-ui-direction.md` (per-component decisions A–D plus Phase 19 entry criteria) and updated `docs/architecture/architecture.md` (Step 8 + phase row marked `✅` complete, `S8` Mermaid node `✅`, ADR-0004 Landed line gateway-ing Phase 19).
No `src/`/`test/`/`.ts` files were touched, so the type-check and suite were correctly skipped; `pnpm run lint` is green.

### Observations

- **Decision-only ADR held to scope:** four docs files total (ADR, arch doc, plan, retro); zero runtime change, matching the plan's Non-Goals.
- **Pre-completion reviewer: PASS.**
  One non-blocking WARN — architecture design-principle #5 still read "UI extraction is deferred … first candidate for extraction," which ADR-0004's Decision D now contradicts.
- **Reviewer warning addressed in-session:** rewrote principle #5 to "UI is an in-core, substitutable consumer" pointing at ADR-0004 (commit `1c445ed4`), rather than deferring it to Phase 19 — it lived in the same doc and directly conflicted with the just-landed ADR.
- **Lint gotcha:** the relative ADR link from `docs/architecture/` needs `../decisions/…` (the Step 8 Landed line already had it); an initial `decisions/…` tripped `MD057` and was fixed by amend.
  Also note `pnpm … lint | tail -N` masks the pipeline exit status — check `PIPESTATUS`/run lint unpiped to gate `&&` chains.
- **Commit count:** 4 build/doc commits for this stage (`17b0546a`, `7b1d9316`, `1c445ed4` for the ADR + arch doc; planning commits `12e7814a`/`e4895548`/`f1e65a14` predate this stage).

## Stage: Final Retrospective (2026-06-18T21:00:00Z)

### Session summary

Shipped issue #427 — a decision-only ADR (`docs/decisions/0004-reconsider-ui-direction.md`) completing Phase 18 of the `pi-subagents` roadmap — across planning, build, and ship stages in one session.
The whole arc held to docs-only scope: four docs files, zero runtime change, all `docs:` commits, so release-please correctly batched (no version cut).
CI passed; #427 closed with a per-component decision summary; siblings #425/#426/#434 were already closed.

### Observations

#### What went well

- **Verified the SDK surface before recording it (novel).**
  Rather than build the ADR on an assumed `switchSession` API, I read `@earendil-works/pi-coding-agent@0.79.1` `.d.ts` files directly in `node_modules` and confirmed the real contract — full active-session takeover, interactive `ReplacedSessionContext`, plus the `loadEntriesFromFile` read-only alternative.
  This generalizes the AGENTS.md "verify the remediation exists in the real surface" rule (written for breaking-change migration notes) to an ADR's SDK claims, and it directly shaped Decision B's "direction not mechanism" framing.
- **Decision-only scope discipline.**
  Held to four docs files matching the plan's Non-Goals; no `src/`/`test/` drift despite the ADR describing future code.
- **Pre-completion reviewer earned its keep on a docs-only change.**
  It caught a stale design-principle (#5) that directly contradicted the just-landed ADR — a real inconsistency, not a code defect — showing the reviewer adds value beyond test/lint gates.
- **`ask_user` used well for a decision-heavy issue.**
  Two structured rounds (per-component fates, then the `switchSession`-informed follow-up) let the operator drive the ADR's content; the second round was correctly gated on the first's SDK finding.

#### What caused friction (agent side)

- `other` (shell footgun) — gated a commit on a lint check piped through `tail`: `pnpm … lint 2>&1 | tail -3 && git add … && git commit`.
  A pipeline's exit status is the last command (`tail`), so the lint failure was masked and a broken-link commit (`89ad57a3`, `MD057`) landed before I noticed.
  Impact: one extra fix + `git commit --amend`; self-caught on the next unpiped lint run.
  No bad push (the amend preceded `/ship-issue`).
- `other` (doc-link slip) — wrote a relative ADR link as `decisions/0004-…` from `docs/architecture/`, when the same session's earlier Step 8 Landed line already used the correct `../decisions/…`.
  Impact: the `MD057` failure above; had the correct pattern in hand and didn't reuse it.
- `other` (malformed tool call) — one `Edit` call included a stray `newText_unused` property and was rejected; retried cleanly.
  Impact: one wasted call, self-caught.

#### What caused friction (user side)

- None blocking.
  The operator firmed the `/agents` decision (remove create+edit surfaces) one turn after the plan was first committed, costing a small follow-up commit (`f1e65a14`).
  Opportunity, not criticism: the `ask_user` `/agents` option labeled "shrink — keep config management" may have under-signaled that outright removal was on the table; a crisper "remove agent-management surfaces" option could have surfaced the firm decision in the first round.

### Diagnostic details

- **Model-performance correlation** — one subagent dispatch (`pre-completion-reviewer`) for judgment-heavy review; appropriate (per AGENTS.md its `model:` frontmatter must be a `provider/id` alias to actually run).
  The main session's `model_change` log shows frequent toggling (`glm-5.2`, `opus-4-8`, `sonnet-4-6`, `deepseek-v4-flash`) but turns can't be cleanly attributed and nothing looks mismatched — not actionable.
- **Feedback-loop gap analysis** — `pnpm run lint` ran incrementally after each build step (good), not just at the end; baseline `check`+`lint` ran before any change.
  The one gap was process, not timing: the `tail`-masked lint let a failure slip a commit (above).
- **Escalation-delay / unused-tool** — no rabbit-holes; longest same-error streak was 1–2 calls (the `MD057` fix).
  Direct `node_modules` `.d.ts` inspection substituted well for `web_search`/`code_search` on the SDK contract — no missing-context gap.

### Changes made

1. `AGENTS.md` § Commits — added a two-line rule: don't gate a commit (or any `&&` step) on a check piped through `tail`/`head`, since the pipeline's exit status is the filter's and a failed `pnpm run lint`/`check` is masked; run the check unpiped or test `${PIPESTATUS[0]}`.
2. `packages/pi-subagents/docs/retro/0427-reconsider-ui-direction.md` — appended this Final Retrospective stage entry.
