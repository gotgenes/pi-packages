---
issue: 301
issue_title: "Only first command in bash command chain is evaluated"
---

# Retro: #301 — Only first command in bash command chain is evaluated

## Stage: Planning (2026-06-01T20:26:00Z)

### Session summary

Planned the fix for the bash command-chain permission bypass: a chained command like `cd /path && npm install pkg` matches the whole string against `cd *` (allow) and never evaluates `npm *` (deny) against the second command.
Explored the permission path and confirmed the bash `path` and `external_directory` surfaces already decompose chains via tree-sitter; only the bash command-pattern surface matches the raw string.
A plan was written and committed (`docs/plans/0301-evaluate-bash-command-chains.md`), then the session pivoted to a refactor-first approach.

### Observations

- Key constraint: `PermissionManager.checkPermission()` is synchronous (public `PermissionsService` + RPC contracts) and the issue's reproduction test calls it directly, but robust chain decomposition needs async tree-sitter.
  The chosen mechanism (after architecture review) reuses the existing tree-sitter parse in the gate layer and checks each simple-command via the unchanged synchronous `checkPermission`, combining most-restrictively — `checkPermission` stays single-command and synchronous.
- The synchronous service API / RPC remain whole-string (advisory); the runtime gate — the real security boundary — is fully fixed.
  An async decompose-and-check service method is a possible follow-up.
- Scope decision: top-level chain operators only (`&&`, `||`, `;`, `|`, `&`, newlines).
  Nested command substitution and subshells are matched as their enclosing command's text — a documented known limitation, never weaker than today.
- Behavior change to call out in docs: config patterns that span a chain (e.g. `"cd * && npm *"`) no longer match as a unit once each command is evaluated independently.
- Pivot: in response to "what architectural changes would make this easier?", the owner chose Beck-style refactor-first.
  Issue #304 was filed to consolidate bash command analysis behind a `BashProgram` value object and a `pickMostRestrictive` helper.
  **#301 is now blocked on #304.**
  After #304 ships, #301 collapses to: add `BashProgram.topLevelCommands()`, add a bash command gate that evaluates each top-level command and selects with `pickMostRestrictive`, wire it into the tool-gate producer, and update `docs/configuration.md`.
- The committed `0301-…` plan still describes the heavier standalone-extractor approach (the owner chose to leave it as-is for now).
  It should be rewritten to the trivial dependent version once #304 lands.

### Diagnostic details

- **Escalation-delay tracking** — Reversed the initial mechanism recommendation (synchronous hand-rolled splitter) after the owner's architecture-review prompt revealed it would create a second bash decomposition that can diverge from the tree-sitter one; switched to the tree-sitter-gate approach before writing the plan, not after.

## Stage: Implementation — TDD (2026-06-01T21:16:29Z)

### Session summary

Executed the refreshed #301 plan on top of the locally-landed #304 refactor (`BashProgram` + `pickMostRestrictive`), neither yet shipped.
Four commits: added `BashProgram.topLevelCommands()` (chain decomposition in the single parse), `resolveBashCommandCheck` (`bash-command.ts`, most-restrictive over sub-commands), wired the async bash branch into the tool-gate producer, and documented the per-command semantics.
Full suite green (1704 tests); `check`, `lint`, and `fallow` clean; pre-completion reviewer returned PASS.

### Observations

- The fix stayed as small as the plan promised: `checkPermission` is untouched and synchronous; all async decomposition lives in the gate layer via `resolveBashCommandCheck`, and the existing `describeToolGate` `preCheck` seam carried the most-restrictive result with no interface changes.
- The integration test deliberately uses `echo start && npm install …` (no path-like tokens) so the bash path / external-directory gates produce nothing and the bash command-pattern gate is the sole blocker — isolating the behavior under test.
- `collectTopLevelCommandTexts` descends only `program`/`list`/`pipeline`/`redirected_statement`; subshells and command substitution emit whole (the documented top-level scope).
- The `?? checkPermission(whole)` fallback in `resolveBashCommandCheck` guarantees the empty-units case is never weaker than before.
- AST shapes for redirection, `&` background, and bare subshell were verified with a throwaway parse script before writing assertions (e.g. `npm install > out.txt` → `["npm install"]`, redirect target dropped).
- No fallow suppression needed for the new exports — fallow treats the test files as consumers, so `resolveBashCommandCheck` and `topLevelCommands()` were clean once their tests existed.

### Diagnostic details

- **Feedback-loop gap analysis** — `pnpm run check` was run immediately after Step 1 (constructor signature change) and Step 3 (producer closure change), per the plan's notes; both passed first try.

## Stage: Final Retrospective (2026-06-01T21:49:00Z)

### Session summary

Shipped #301 end-to-end: pushed the stacked #304 + #301 work to `main`, verified CI, closed #301, and merged the release-please PR to cut `pi-permission-system-v9.0.1`.
Verified the fix live against the reloaded extension (`echo leading-allowed && rm -rf /tmp/…` was correctly denied with the offending sub-command and `rm -rf *` pattern named).
The span across stages was a clean Beck-style arc: a planning-time architecture pivot split the work into a behavior-preserving refactor (#304) and a trivial dependent fix (#301), and the fix landed in four small commits exactly as predicted.

### Observations

#### What went well

- The refactor-first split paid off as designed: #301 reused the `describeToolGate` `preCheck` seam from #304 with zero interface changes, and `checkPermission` stayed synchronous.
  The cross-session prediction in the Planning stage ("#301 collapses to: add `topLevelCommands()` + a bash command gate + wiring + docs") matched the actual four commits.
- Live post-ship verification, not just tests: running the real chained command against the reloaded extension confirmed the production denial message and matched pattern.
  This is a stronger signal than green tests alone and caught nothing only because the implementation was already correct.
- Incremental verification was exemplary across both implementation stages — `pnpm run check` after each interface-changing step, full suite + `lint` + `fallow` per step, and a fresh-context pre-completion reviewer that returned PASS with zero WARNs on #301.

#### What caused friction (agent side)

- `premature-convergence` — the initial mechanism recommendation was a synchronous hand-rolled bash splitter.
  The agent flagged the "second decomposition that can diverge from tree-sitter" risk in its own `ask_user` option text but still recommended that option; only the user's "is something more fundamentally off?" question forced re-ranking toward reusing the tree-sitter parse.
  Impact: no rework (caught in planning before any code), but the agent under-weighted an architectural concern it had already identified.
- `instruction-violation` (tooling-caught) — the #301 TDD stage notes were appended with a quoted shell heredoc (`cat <<'EOF'`), so `\u2014` was written literally instead of em-dashes and a two-sentence line slipped in, tripping `rumdl` MD013.
  Impact: one fix cycle (a four-part `Edit`).
  Root cause: authoring markdown prose via a heredoc instead of the `Write`/`Edit` tools, which respect the one-sentence-per-line and literal-Unicode conventions.
- `instruction-violation` / process gap (user-caught) — stacking #304's commits under #301 and running `/ship-issue 301` once left #304 open.
  Release-please omitted the `refactor:` commits from the v9.0.1 changelog, so there was no reminder that a second issue had shipped.
  Impact: #304 sat open with released code until the user caught it in this retro; resolved by closing #304 manually (shipped in `pi-permission-system-v9.0.1`).
- `other` (tool usage) — two `Edit` calls were rejected for including a stray `oldText_was_unique_hint` property.
  Impact: two wasted calls, immediate retries, no rework.

#### What caused friction (user side)

- The single highest-leverage moment was the user's architecture-review question, posed as a redirecting question rather than a correction — it prevented a divergent-second-parser design and reframed the whole effort.
  Opportunity (agent side): internalize asking "what change would make this change easy?" during planning rather than waiting for the prompt.
- The decision to skip `/ship-issue 304` and stack it under #301 was efficient, but neither party surfaced at decision time that the stacked issue would still need closing.

### Diagnostic details

- **Model-performance correlation** — the only subagent dispatched was the `pre-completion-reviewer` on `anthropic/claude-sonnet-4-6` (218s, 33 tool uses) for the judgment-heavy review; appropriate match, no over- or under-powered assignment.
- **Escalation-delay tracking** — no `rabbit-hole`; the longest repeated-error streak was two (`Edit` schema rejection), resolved immediately.
- **Feedback-loop gap analysis** — verification ran incrementally after each step, not only at the end; no gaps.

### Changes made

1. Closed issue #304 as completed (shipped in `pi-permission-system-v9.0.1`, stacked under #301) — the loose end this retro surfaced.
2. `.pi/prompts/ship-issue.md` — added a sub-step to the "Close the issue" step to detect and close other issues whose work shipped in the same push (stacked enablers / `refactor:` commits release-please omits).
3. `.pi/skills/markdown-conventions/SKILL.md` — added a rule to author/append markdown with `Write`/`Edit` rather than shell heredocs.
