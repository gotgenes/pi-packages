---
issue: 493
issue_title: "fix: symlink traversal bypasses path-based permission rules"
---

# Retro: #493 — fix: symlink traversal bypasses path-based permission rules

## Stage: Final Retrospective (2026-06-28T01:06:38Z)

### Session summary

A `/plan-issue #493` session that turned into a triage-and-evaluate session: the third-party report claimed symlink traversal bypasses path-based permission rules, but investigation showed the `path` / `external_directory` / bash surfaces already match the symlink-resolved (canonical) form via the `AccessPath` dual-match design (#418, #486), confirmed by 41 passing tests and a live end-to-end demo against the running extension.
No plan was committed; instead #493 was closed as already-addressed with an evidence-backed comment, and the one genuinely actionable residual — a misleading external-directory prompt that names the typed path while asserting it is "outside working directory" — was filed as #507.

### Observations

#### What went well

1. The third-party `ask_user` direction gate worked exactly as intended: because the issue author (`gr3enarr0w`) was not the operator, the session treated the proposal as a hypothesis to evaluate rather than a spec, and the codebase evidence (the Phase 7 roadmap, closed #486/#418, and the package skill's own "symlink-resolved aliases" language) short-circuited a redundant plan before any commit.
2. **Novel win** — the live reproduction against the running extension was a notably effective verification: creating an actual `./demo-symlink-passwd -> /etc/passwd` symlink (lexical path inside CWD, canonical path outside) and attempting a `read` produced a real deny from the live gate, which is stronger evidence than unit tests alone and directly surfaced the actionable message bug (#507).
   Using the live extension as the test harness is a pattern worth reaching for on bypass claims.
3. Filing #507 with the `github-voice` skill and the captured live-repro evidence kept the misleading-message concern cleanly separated from the (already-solved) bypass claim, rather than conflating them under #493.

#### What caused friction (agent side)

1. `missing-context` — on a claimed security bypass, the agent first leaned on docs and the architecture roadmap and offered the operator a close-vs-plan disposition decision before running the strongest available evidence (the live repro).
   The operator had to push twice ("So for sure, we've tested this case?" then "Let's just try it here") to escalate from docs-claims → unit tests → live reproduction.
   Impact: two extra `ask_user` round-trips before the actionable bug (#507) surfaced; no rework, but the strongest evidence and the real finding both came late and operator-prompted.

#### What caused friction (user side)

1. The operator's "Let's just try it here.
   Create the link.
   Then try to access it." was the highest-value intervention of the session — it converted an abstract "is this already handled?" into a concrete repro that both proved the protection and surfaced #507.
   Framed as opportunity: the agent should reach for live reproduction proactively on bypass/vulnerability claims, so this strategic nudge is not needed next time.

### Diagnostic details

1. **Feedback-loop gap analysis** — the decisive verification (the live symlink repro) ran only after the operator requested it, not on the agent's initiative; the agent's self-driven verification stopped at the unit-test suite.
   For a "X can be bypassed" claim, the live repro is the primary feedback loop and should run early, before asking for a disposition.
2. **Model-performance correlation** — no subagents were dispatched; all work ran in the main session.
   Exploration was efficient via `grep` plus the architecture doc, so no Explore/Plan dispatch was warranted (unused-tool and escalation-delay lenses found nothing notable).

### Changes made

1. Added Debugging bullet 5 to `.pi/skills/package-pi-permission-system/SKILL.md` — reproduce a claimed path/permission bypass against the running extension before concluding it is already handled (a live deny beats unit tests and can surface adjacent bugs, e.g. #493 → #507).
