---
issue: 1048
issue_title: "pi-subagents: move record-observer into lifecycle/ and the notification renderer into ui/"
---

# Retro: #1048 — pi-subagents: move record-observer into lifecycle/ and the notification renderer into ui/

## Stage: Planning (2026-10-09T06:20:27Z)

### Session summary

Planned the two zone-order moves (`record-observer.ts` to `lifecycle/`, `renderer.ts` to `ui/notification-renderer.ts`) as two `refactor:` commits, a `docs:` commit, and the roadmap completion mark.
Spiked the whole move in the worktree before writing the plan, measured it, and reset it.

### Observations

- The issue's acceptance claim was wrong as written.
  With only the two `allow` narrowings it names, `fallow dead-code` reports 1 boundary violation, because the moved renderer's `import type` of the `*Details` contracts (in `observation/notification.ts`) becomes a new `ui → observation` edge.
  The operator chose `"allowTypeOnly": ["pi-subagents/observation"]` on the `ui` zone over a full `allow` or relocating the types to `src/types.ts`.
- Three ratchet probes stand in for killing mutations, all measured against the spike, each reporting 1 violation: (A) a `lifecycle → observation` import, (B) the inline `import { type … }` form, and (C) an `observation → ui` import.
  Probe B shows that fallow reads the inline `type` modifier as a value import, so the renderer must keep its top-level `import type`.
- Tidy-First assessor: nothing recommended.
  The optional trim of `record-observer.ts`'s provenance header sentence is folded into step 1.
  The rename to a broader filename was declined, since the roadmap already names `notification-renderer.ts`.
- The assessor reported that `fallow guard` fails in this worktree ("autoDiscover path did not resolve"), but it ran fine inline.
  That failure is specific to the subagent's environment and is not a finding.

#### Deferred tidyings

- `src/observation/renderer.ts`: the three `create*Renderer` factories share line-assembly shape (assessor judged the divergence structural; rejected as scope creep).
- `src/observation/renderer.ts`: pure helpers (`buildStatsParts`, `buildPreviewLines`, `resolveStatusPresentation`) live beside the factories; a split is a separate concern.

## Stage: Implementation — Build (2026-10-09T15:53:56Z)

### Session summary

All four plan steps landed: two `refactor:` moves (each narrowing its own `.fallowrc.json` zone, the second adding the `ui` zone's `allowTypeOnly: ["pi-subagents/observation"]`), a `docs:` commit stating the zone order in `architecture.md` and the package skill, and the roadmap ✅ marks with a `Landed:` note.
The pi-subagents suite stayed at 86 files and 2100 tests, as predicted.

### Observations

- No deviations from the plan.
- Probes A, B, and C each reported exactly 1 boundary violation against the committed config, matching the planning spike.
- Biome's `organizeImports` reorders a rewritten `#src/` import path (both `subagent.ts` and `index.ts` moved position), so each move step needed `biome check --write` before lint passed; expect this on any path-rewriting move.
- `pi-autoformat` collapsed the `observation` zone's two-item `allow` array onto one line in `.fallowrc.json`; harmless.
- The roadmap step's own Cause/Target prose (`architecture.md` lines 982 and 986) keeps the old `observation/renderer.ts` path deliberately, as a description of the step.
- Pre-completion reviewer: PASS.

## Stage: Sync (worktree) (2026-10-09T16:00:26Z)

### Session summary

`pnpm run lint` and `pnpm fallow dead-code` both pass on the branch, ahead of the rebase onto local `main`.
The plan's `**Release:**` marker is `ship independently`; the commits are `refactor:` and `docs:` only, so `/ship` cuts no release for them, and no follow-up issues were filed.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-1048--/2026-10-09T06-14-12-436Z_01a11f4c-3cd3-7338-95a9-53ad2447120d.jsonl`; read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

- The planning-stage Tidy-First assessor said `fallow guard` failed inside its subagent; it ran fine in this session, so the failure was specific to the subagent.

## Stage: Final Retrospective (2026-10-09T16:09:40Z)

### Session summary

The root session fast-forward-merged the branch (6 commits after the plan), passed lint and `fallow dead-code` on the merged tree, and got a green CI run (`37956340722`).
It closed #1048 with no release, since `next-version.sh` printed nothing for the `refactor:`/`docs:` range, and removed the worktree.
Planning, build, sync, and ship together needed no operator correction; the only gate was planning's `allowTypeOnly` choice.

### Observations

#### What went well

- Spiking before planning caught an incorrect acceptance criterion before the plan was written.
  The issue predicted zero violations from the two `allow` narrowings; the spike measured 1, from the moved renderer's new `ui → observation` type edge.
  That turned a would-be build-time surprise into a planning-time `ask_user` gate, which the operator answered once.
- Planning ran the ratchet probes (A, B, C) against the spike, and build re-ran them against the committed config, with the same result each time.
  For a config-only boundary change, a probe that must report exactly 1 violation stands in for a killing mutation, and running it at both stages showed the plan's claim held in the shipped tree.
- Probe B independently re-derived a rule the `fallow` skill already states: `allowTypeOnly` reads the `import type` syntax, not the symbol's kind.
  The skill rule is confirmed, not new.

#### What caused friction (agent side)

- `missing-context` — The Tidy-First assessor prefixed its commands with `cd packages/pi-subagents &&` and ran `fallow guard` on package-relative paths.
  The zones' `autoDiscover` paths are root-relative, so fallow reported `autoDiscover path 'packages/pi-subagents/src' did not resolve` and `invalid boundary configuration`.
  The planning and sync stage notes both called this "specific to the subagent's environment" rather than a wrong working directory.
  Reproduced at retro time: `pnpm -C packages/pi-subagents exec fallow guard src/ui/notification-renderer.ts` exits 2 with the same error, and the root-relative form succeeds.
  Impact: no rework, since the assessor fell back to reading imports and the main session ran `guard` itself, but the misdiagnosis was recorded twice as a non-finding.
- `other` (glyph corruption) — Three non-ASCII glyphs came out wrong across two stages: the build stage heading's em-dash and a ✅, and a sync-note em-dash that arrived as the word "install".
  All three were self-caught by re-reading the region before committing, as the `markdown-conventions` skill prescribes.
  Impact: about 2 extra tool calls per stage; nothing reached a commit.
- `other` — Biome's `organizeImports` re-sorted each rewritten `#src/` import, so each move step's first `pnpm run lint` failed and needed `biome check --write`.
  Impact: one extra lint cycle per move step.
  The lint output names the fix, so it needs no rule.
- `other` (ship) — The ship's final report hedged on whether #1048 closed its roadmap phase ("probably was not"), even though the session had already grepped `architecture.md` and seen #1049 through #1051 still open.
  Impact: none, but the report hedged on a fact it had already checked.

#### What caused friction (user side)

- None observed; the operator's single intervention (the `allowTypeOnly` choice) was strategic judgment, not oversight.

### Diagnostic details

- **Model-performance correlation** — Planning and build ran on `anthropic/claude-opus-5-5`; sync ran on `anthropic/claude-sonnet-5-5`; the Tidy-First assessor and pre-completion reviewer each ran on `anthropic/claude-sonnet-5-5` (from their own transcripts); ship and retro ran on `anthropic/claude-opus-5-5`.
  No mismatch: the sync stage is mechanical, and the reviewer re-derived its own structural greps rather than accepting the plan's probe table.
- **Feedback-loop gap analysis** — Build ran baseline `check`/`lint`/vitest before step 1, targeted vitest plus `check` plus `fallow dead-code` after each move, and the full suite at the end; no end-only verification.

### Changes made

1. `.pi/agents/tidy-first-assessor.md`: the fallow block now says to run from the repo root on root-relative paths, never after `cd packages/<pkg>`, and names the error a package-directory run produces.
2. `.pi/skills/fallow/SKILL.md`: maps the `invalid boundary configuration` / `autoDiscover path` error to a package-directory working directory rather than a broken config.
