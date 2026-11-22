---
issue_title: "Phase 8 improvement roadmap"
---

# Retro: Phase 8 improvement roadmap

## Stage: Final Retrospective (2026-07-04T02:16:53Z)

### Session summary

Ran the `plan-improvements` workflow for `pi-permission-system` and produced the Phase 8 roadmap ("Tidy first for the authority spine") in `docs/architecture/architecture.md`.
Treated the architecture doc's declared "authority model" target as a hypothesis; the user's `ask_user` steer ("I want to tackle the Authority spine but, Tidy First, what's the change that makes the authority spine easy?") reshaped the phase from building the spine into the preparatory refactoring that makes the spine diff small.
Restructured the doc (moved Phase 7 to `history/phase-7-accesspath-universal-representation.md`, condensed its summary), committed as `6f46df5f`, filed Steps 1–8 as issues [#525]–[#532], linked the roadmap back, and committed as `c71d0c27`.
The Phase 7 archival was done inline — which, surfaced during the retro, turned out to be `/finish-phase`'s job that was skipped (see friction below).

### Observations

#### What went well

- The prompt's "treat a declared direction as a hypothesis, confirm with `ask_user`" instruction combined with the user's tidy-first note pivoted the entire phase cleanly.
  The agent read the "Target: the authority model" section, deferred deep-tracing until after the focus gate, and let the user's "what makes the spine change easy?" question become the organizing principle — producing a preparatory phase (yolo into the ruleset, `PermissionForwarder` split by direction, `SubagentDetection` collaborator) rather than a premature spine build.
  No rework followed either `ask_user` gate.
- The mandated "verify each created issue's title matches its body" step (File the issues, step 2) caught the `\u2192` literal-escape bug in [#526]'s title before it stuck — a case of a verification step earning its place in the workflow.
- Verification was incremental: `rumdl` + `mmdc` ran after the first doc restructure (both diagrams checked) and again after the issue-linking edit, not only at session end.

#### What caused friction (agent side)

- `scope-drift` (user-caught, in the retro) — the session ran `/plan-improvements` while Phase 7's full roadmap was still inline in `architecture.md`, and archived it inline (wrote `history/phase-7-*.md`, condensed the summary, fixed orphaned link defs) as part of planning.
  That archival is `/finish-phase`'s job: a dedicated prompt with a **hard gate** verifying every previous-phase step issue is closed, plus a code-vs-doc reconciliation pass.
  Doing it inline bypassed that gate.
  Impact: no damage this session (Phase 7's issues were all closed and reconciliation was minimal), but the completeness gate that exists to catch an un-closed prior step was skipped.
  The correct sequence is `/finish-phase` → `/plan-improvements`; the planning prompt should detect the un-archived phase and pause rather than absorb the work.
- `other` (shell-escape slip) — [#526] was created with a literal `\u2192` in its title because the `gh issue create --title "...ask\u2192allow..."` argument was double-quoted and zsh does not interpolate `\uXXXX` in double quotes.
  Caught by the mandated title-verification step and fixed with one `gh issue edit`.
  A generic zsh quirk, not a workflow gap; the better content rule is to avoid non-ASCII in issue titles at all.
  Impact: one extra round-trip call; no lasting damage.
- `other` (zsh syntax hiccup) — two exploratory `grep`/`wc` commands batched in one turn both errored; the corrected re-run succeeded on the next turn.
  Impact: added friction, no rework to any deliverable.

#### What caused friction (user side)

- None material.
  The user's `ask_user` steer was well-timed strategic input delivered at the first decision boundary — the model of the focus gate working as intended, not a late correction.

#### Higher-level evaluation: template, process, fallow

- **`plan-improvements` template** — its crown-jewel instruction ("treat the doc's declared direction as a hypothesis, confirm with `ask_user` before deep-tracing") is why the phase came out right: it deferred the spine build and let the user's tidy-first steer reshape Phase 8 into preparatory work, with no rework after either gate.
  The template is long and prescriptive — accreted scar tissue from prior retros — but the determinism paid off (grep-able `Release:` tags and `Release batches` for downstream `/plan-issue` / `/ship-issue`, well-formed first-pass output).
  Its one real gap was the missing `/finish-phase` hand-off gate (above).
- **Process** — the cross-stage artifact hand-off is well-designed (release metadata is machine-consumable across stages; the retro-as-bridge worked — this file's naming and structure were bootstrapped from `0334-phase-4-roadmap.md`).
  Mild seam: the `retro` template is issue-centric, but a phase-planning session has no single issue or plan file — placement was inferred from precedent.
- **fallow — helps at the margins, does not drive** — three of eight steps (fixture extraction, forwarding harness, `value-guards` split) came from fallow's dupes / refactoring-target output, and "no dead code / no new hotspots" is useful confirmation.
  But the heart of the phase (yolo relocation, forwarder split, `SubagentDetection`, the `authority/` seed) came from tracing code against the architecture doc. fallow's health score has held at 76 (B) across Phases 6 → 7 → 8 — structurally insensitive to the architectural refactoring these phases deliver, as the `improvement-discovery` skill already documents.
  It is a useful input and guardrail, not a driver; the risk to watch is a future run reading a flat 76 as "structurally done."
  No fallow change warranted.

### Diagnostic details

- **Model-performance correlation** — the judgment-heavy work (fallow synthesis, entry-point tracing, tidy-first roadmap design, doc restructure) ran on `claude-fable-5` (messages 2–38); issue drafting/filing/linking ran on `claude-sonnet-5` (messages 40–57); this retro on `claude-opus-4-8`.
  A `claude-deepseek-v4-flash` `model_change` carried no assistant turn under it — a transient selection that never ran, not a dispatch.
  No mismatch: the roadmap the reasoning-heavy phase produced was accepted without rework.
- **Feedback-loop gap analysis** — no gap.
  Docs-only session; `rumdl` and `mmdc` ran incrementally after each write and both passed.
- **Escalation-delay and unused-tool lenses** — nothing notable.
  The single bash error resolved in one retry (no >5 sequence), and targeted `grep`/`read` on specific symbols (`isSubagentExecutionContext`, `requestApproval`, `deriveResolution`) was the correct tool per the `colgrep` decision table — no unused-tool gap.

### Changes made

1. Added a hard gate to `.pi/prompts/plan-improvements.md` Step 2: if the previous phase (N−1) is still inline in `architecture.md` rather than archived to `history/`, stop and direct the user to run `/finish-phase $1` first, then resume — the archival is `/finish-phase`'s job (with its step-completion gate), not `/plan-improvements`'s.
2. Created this retro file, `packages/pi-permission-system/docs/retro/0525-phase-8-roadmap.md`.

[#525]: https://github.com/gotgenes/pi-packages/issues/525
[#526]: https://github.com/gotgenes/pi-packages/issues/526
[#532]: https://github.com/gotgenes/pi-packages/issues/532
