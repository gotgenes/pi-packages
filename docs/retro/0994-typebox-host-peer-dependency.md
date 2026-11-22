---
issue: 994
issue_title: "Pi throws warnings about typebox dependency"
---

# Retro: #994 — Pi throws warnings about typebox dependency

## Stage: Planning (2026-09-29T23:10:14Z)

### Session summary

Planned a fix for the startup warning a third-party reporter raised: Pi 0.99's `collectExtensionPackageWarnings` flags host-provided packages in `dependencies`.
In `pi-subagents` the flagged dependency is `@sinclair/typebox`.
The plan migrates `pi-subagents` to `typebox` imports with a `"*"` peer and a devDependency.
Per the operator's call, the plan also folds in `"*"` peers for `pi-colgrep` and `pi-github-tools`, so it is cross-package and the three packages release together.

### Observations

- The first gate got a question instead of a selection: "In pi-permission-system we migrated to zod."
  Zod there validates config only; tool `parameters` must be TypeBox (`ToolDefinition` is typed against `TSchema` from `typebox`), so the zod option was ruled out.
- The operator reported that a pre-`ask_user` context message did not reach them twice.
  The second time, the substance was re-sent as plain text and the turn ended there.
- Spike, measured and reverted: swapping the 5 imports and the manifest left `tsc` clean and all 1876 tests in 81 files passing.
  `dist/*.d.ts` has no typebox references, so the public types are unaffected.
- Pi has aliased `@sinclair/typebox` to its bundled `typebox` 1.x since 0.69.0, so the published runtime behavior does not change; the change is not breaking.
- The `Co-authored-by` trailer for the reporter (`rharish101`) is recorded in step 1 of the plan's TDD Order.
- Tidy-First assessor: no preparatory tidyings.
  It flagged ADR 0003 line 45 and `docs/comparison-with-upstream.md` line 19 as current-behavior prose to update, and both are in the plan.
- Left out of scope: changing the `>=x` ranges on the `@earendil-works/pi-*` peers to `"*"` as Pi's docs recommend, because Pi does not warn on them.

## Stage: Implementation — Build (2026-09-29T23:20:32Z)

### Session summary

All three plan steps were implemented as separate `fix:` commits: `pi-subagents` (imports, manifest, lockfile, rollup `external`, and two docs), then `pi-colgrep` and `pi-github-tools` (one `typebox: "*"` peer line each).
Step 4 is confirmed: `next-version.sh` prints `pi-subagents-v21.8.1`, `pi-colgrep-v1.5.4`, and `pi-github-tools-v5.0.1`, as the plan predicted.

### Observations

- There were no deviations from the plan.
  `pnpm install` did not change `pnpm-lock.yaml` for the sibling peers, because the existing `typebox` devDependency satisfies them.
- `verify:public-types` passed, and `dist/*.d.ts` still has no typebox references.
- Pre-completion reviewer: PASS.
  It noted that the plan's manifest scan omitted the `@mariozechner/pi-*` names from Pi's `HOST_PROVIDED_EXTENSION_PACKAGES`; it re-ran the scan with all 10 names and found no host-provided dependencies.

## Stage: Sync (worktree) (2026-09-29T23:25:02Z)

### Session summary

Pre-push checks passed: `pnpm run lint` and `pnpm fallow dead-code` are both clean.
The plan's marker is `**Release:** ship independently`; the root should dispatch `pi-subagents`, `pi-colgrep`, and `pi-github-tools` in one release run.

**Peer session transcript:** `/Users/chris/.pi/agent/sessions/--Users-chris-development-pi-pi-packages-worktrees-issue-994--/2026-09-29T22-59-24-028Z_01a0ef64-ecfb-7281-a4f9-847675f5c2f5.jsonl` — read with `read_session_file({ path: "<path>" })` for message-level verification at land/retro time.

### Observations

No follow-ups were filed and nothing was deferred.
The reporter is credited by `Co-authored-by` on the `fix(pi-subagents)` commit; name them in the close comment as well.

## Stage: Final Retrospective (2026-09-30T00:23:01Z)

### Session summary

The planning, build, and sync stages ran in the worktree peer, and ship ran at the root.
The root fast-forward-merged the branch, passed CI, closed the issue crediting @rharish101, and released `pi-subagents` 21.8.1, `pi-colgrep` 1.5.4, and `pi-github-tools` 5.0.1 in one dispatch.
The build had no deviations from the plan, and CI and the release run both passed on the first attempt.

### Observations

#### What went well

- The planning spike (swap the imports, run `check` and `test`, revert) settled "is this breaking?" with a measurement before the gate, and the build then matched it exactly.
- The `next-version.sh` predictions recorded at planning (`pi-subagents-v21.8.1`, `pi-colgrep-v1.5.4`, `pi-github-tools-v5.0.1`) held through build, sync, and release.
  The ship dispatch needed no derivation beyond confirming them.

#### What caused friction (agent side)

- `instruction-violation` (user-caught) — Three planning `ask_user` calls were made with no visible assistant text before them.
  In the peer transcript, the first gate and both re-asks after the zod answer show a bare tool call.
  The briefing was never emitted, so the operator asked "So what are my choices again?" before the substance was re-sent as plain text.
  The planning stage note recorded this as context that "did not reach" the operator, which reads as a delivery fault; the transcript shows it was never written.
  `clarification-gates` states the reasoning-only hazard only for answering an operator's question, not for the briefing before a gate.
  Impact: two wasted gate round-trips and one operator clarification turn.
- `missing-context` — In the abandoned permission-diagnosis branch, the peer suggested declaring `git log` as a reader with a `commandEffects` entry.
  That key is not implemented: #880 is open, and it notes that `docs/configuration.md` already describes the key as shipped while `config-schema.ts` has no such key.
  The peer trusted the doc over the real surface (principle 1).
  Impact: none this time, because the operator did not act on it, but the recommended remediation would have been a silent no-op config edit.
- `other` — Planning read Pi's source with `cd ../../pi && git log … -- <path>`.
  Because `git` is outside the pure-reader core, the pathspec was routed to the bare `external_directory` surface, and the operator's global `external_directory_write` `"*": "ask"` rule prompted.
  Impact: an operator-initiated diagnosis detour of about 9 tool calls, rewound from the live path.

#### What caused friction (user side)

- The zod question arrived as a reply to the first gate.
  Stating up front that pi-permission-system had moved to zod would have let the briefing rule it out before the gate, but with the briefing missing there was nothing to preempt.

### Diagnostic details

- **Model-performance correlation** — Planning and build ran on `claude-opus-5-5` and sync on `claude-sonnet-5-5`, both from the transcript's inline labels.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on `claude-sonnet-5-5`, which suited their judgment work, and both returned usable verdicts.
- **Unused-tool detection** — For the `commandEffects` suggestion, a single `grep -n commandEffects packages/pi-permission-system/src/config/config-schema.ts` would have shown the key absent.
- **Feedback-loop gap analysis** — Build ran the package `check`/`test`/`verify:public-types` after step 1 and the sibling checks after steps 2–3, before the full-repo run, so verification stayed incremental.

### Changes made

1. `.pi/skills/clarification-gates/SKILL.md` — `## Substance first` now states that the briefing must be visible assistant text emitted before the `ask_user` call.
2. Commented on #880 (issuecomment-5901882271) with the `cd ../../pi && git log … -- <path>` prompt as evidence, and with the agent's recommendation of the unimplemented key as further reason to correct `docs/configuration.md`.
