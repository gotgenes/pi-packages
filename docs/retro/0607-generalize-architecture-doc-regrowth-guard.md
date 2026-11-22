---
issue: 607
issue_title: "Generalize the architecture-doc module-tree regrowth guard into a shared convention"
---

# Retro: #607 — Generalize the architecture-doc module-tree regrowth guard into a shared convention

## Stage: Planning (2025-07-16T00:00:00Z)

### Session summary

Produced a build-oriented plan (`docs/plans/0607-generalize-architecture-doc-regrowth-guard.md`) for the operator-authored docs/tooling-only follow-up that lifts [#601]'s per-package module-tree regrowth guard into one repo-wide home.
The change is three coordinated edits in repo-root tooling — add a canonical `### Architecture-doc conventions` subsection to `AGENTS.md`, remove the redundant copy from `package-pi-permission-system/SKILL.md`, and repoint `/finish-phase` Step 4's provenance-strip directive at the shared convention — landing as a single `docs:` commit that cuts no release.

### Observations

- The issue's proposed change was ambiguous on "and/or mirror it into each `package-<PKG>` skill."
  Surfaced this via `ask_user`; operator chose the DRY branch: `AGENTS.md` canonical, remove per-package copies with **no** pointer, repoint `/finish-phase` at the shared convention.
- `AGENTS.md` was chosen over the `improvement-discovery` skill as canonical home because it is always loaded from the repo-root CWD — present during the per-change doc-update commits where regrowth actually happens, whereas the skill loads only during `/plan-improvements`.
- Confirmed only two live reference sites need editing (`.pi/skills/package-pi-permission-system/SKILL.md` lines 24–25 and `.pi/prompts/finish-phase.md` Step 4 directive 2); every other hit is in point-in-time plan/retro archives (`0601-*`, `0605-*`), deliberately left untouched.
- `.pi/skills/package-pi-subagents/SKILL.md` never carried the guard and gets no mirror — the plan flags this as intentional so the build step does not "helpfully" add one.
- Sibling context: [#601]/[#605] are the bulk paydowns, [#606] added the `/finish-phase` hygiene step (its Step 4 directive-2 sentence is the reference this plan repoints); all three are closed.
  This issue is the last of that quartet.
- Next stage is `/build-plan` (docs/tooling, no test cycles).

## Stage: Implementation — Build (2025-07-16T00:00:00Z)

### Session summary

Executed the single-commit build plan as one `docs:` commit (`794f9a7e`): added the canonical `### Architecture-doc conventions` subsection to `AGENTS.md`, removed the redundant two-line regrowth guard from `.pi/skills/package-pi-permission-system/SKILL.md`, and repointed `/finish-phase` Step 4 directive 2 at the shared `AGENTS.md` convention.
No `src/`/`test/`/`.ts` files were touched, so only `rumdl`/lint ran (clean on all three files); no test or typecheck was needed.

### Observations

- No deviations from the plan — the three coordinated edits landed exactly as designed, in one logical commit per the Build Order.
- Verified no dangling reference to the removed guard survives: `grep -rn "regrowth guard\|package-$1 skill\|module-tree entries describe" .pi/ AGENTS.md` returns only the new canonical `AGENTS.md` statement.
- `.pi/skills/package-pi-subagents/SKILL.md` was deliberately left untouched (no mirror), matching the operator's confirmed single-source direction.
- Pre-completion reviewer: PASS — all deterministic checks green (`check`/`lint`/`test`/`fallow dead-code`), all three Goals code-verified, conventional-commit compliant, no stale references, direction matches operator's `ask_user` choices.
  No warnings.

## Stage: Final Retrospective (2026-07-17T01:17:41Z)

### Session summary

Shipped the shared architecture-doc regrowth guard across the full planning → build → ship arc as a single `docs:` implementation commit (`794f9a7e`), closing the last of the [#601]/[#605]/[#606]/[#607] quartet.
The planning-stage `ask_user` decision (canonical home = `AGENTS.md`, remove per-package copies with no pointer, repoint `/finish-phase`) carried through build and ship with zero rework — the pre-completion reviewer verified every Goal and the rejected "mirror" branch against the plan's Non-Goals.
No release was cut: every unreleased commit is a non-releasing `docs:` type, so the work auto-batches.

### Observations

#### What went well

- **Plan-as-contract paid off end to end.**
  The one design ambiguity ("and/or mirror it into each `package-<PKG>` skill") was resolved once via `ask_user` in planning, encoded as an explicit Non-Goal, and then independently re-verified by the pre-completion reviewer at build.
  The rejected branch (`pi-subagents` mirror) never accidentally got "helpfully" added — a recurring risk the plan pre-empted.
- **Reference-site grep bounded the change precisely.**
  `grep -rn "regrowth guard\|package-$1 skill\|module-tree entries describe"` established up front that exactly two live sites needed editing and every other hit was a point-in-time archive — the edit set matched the plan with no surprises.

#### What caused friction (agent side)

- `other` — During ship, re-verified a valid 40-char HEAD SHA (`3648a3db…`) three times (`git rev-parse HEAD`, then `| cat`, then `| wc -c; git log -1 --format=%H`) after mis-perceiving it as malformed.
  The SHA was correct on the first call.
  Impact: 2 extra tool calls, no rework.
  Low-impact behavioral tic, not a process gap.

#### What caused friction (user side)

- None.
  A single `ask_user` answer in planning supplied all the direction the three stages needed; no mid-session corrections were required.

[#601]: https://github.com/gotgenes/pi-packages/issues/601
[#605]: https://github.com/gotgenes/pi-packages/issues/605
[#606]: https://github.com/gotgenes/pi-packages/issues/606
