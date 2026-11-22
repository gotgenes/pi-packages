---
issue: 413
issue_title: "Explicitly allow some external directories relative to the home directory"
---

# Retro: #413 — Explicitly allow some external directories relative to the home directory

## Stage: Planning (2026-06-16T15:06:55Z)

### Session summary

Investigated a third-party request (filed by `michaelmior`) to allow outside-CWD directories like `~/.cargo/registry` without prompting.
Found the capability already exists via the `external_directory` surface pattern map; the user's `path`-surface attempt failed because of most-restrictive-wins composition and a missing trailing `*`.
After confirming direction with the operator, wrote a docs-only plan to make the `external_directory` allow-list discoverable across `configuration.md`, `README.md`, `config.example.json`, and the schema.

### Observations

- This is fundamentally a discoverability bug, not a missing feature.
  `"external_directory": { "*": "ask", "~/.cargo/registry/*": "allow" }` already does what the user wants.
- Rejected the tempting "make a `path` allow suppress the `external_directory` gate" approach.
  The four layers compose with most-restrictive-wins, so a `path` allow loosening an `external_directory: ask` boundary would be a security regression, not a fix.
  The operator's instinct (keep `external_directory` as a separate, intentional layer modeled on OpenCode) confirmed this.
- Operator correction on wildcard semantics: do **not** use `**` in examples.
  A single `*` compiles to a greedy `.*` (with the `s` flag in `wildcard-matcher.ts`) and already crosses subdirectory boundaries, so `~/.cargo/registry/*` matches every file beneath the directory.
- Scope trimmed by operator: `configuration.md` + `README.md` + `config.example.json`/schema; `troubleshooting.md` deselected.
- Next stage is `/build-plan` (docs-only), not `/tdd-plan`.
- Alignment constraint applies: `configuration.md`, `README.md`, `config.example.json`, and `schemas/permissions.schema.json` must agree on the `external_directory` pattern-map form.

## Stage: Implementation — Build (2026-06-16T15:30:00Z)

### Session summary

Executed all three docs-only build steps from the plan, one commit each: `configuration.md` (cache-dir recipe, "which surface?" clarification, single-`*` note, most-restrictive-wins reaffirmation), `README.md` (clear `external_directory` surface description + pattern-map example), and `config/config.example.json` + `schemas/permissions.schema.json` (inline `~/.cargo/registry/*` allow example, aligned across both).
No `src/` or `test/` files were touched, so the test/typecheck suites were not required; the package lint passes and both JSON files parse.

### Observations

- The schema `markdownDescription` is a single physical JSON line with literal `\n` escape sequences, not real newlines.
  An `Edit` `oldText` built with actual newlines failed to match; matching the literal `\n\n` (and escaping the embedded JSON quotes as `\\\"`) was required.
- Operator mid-build question confirmed `jsonc` is the correct doc fence language: the docs use ` ```jsonc ` 21 times and ` ```json ` zero times, and the loader runs `JSON.parse(stripJsonComments(raw))` (`config-loader.ts:388`), so `//` comments are supported (trailing commas are not).
  The config file itself stays `.json` and comment-free.
- No deviations from the plan.
  The optional `piInfrastructureReadPaths` cross-reference (Open Question) was included as a single sentence in `configuration.md` only, as the plan leaned.
- Pre-completion reviewer: PASS — ready for `/ship-issue`.
  No WARN findings.

## Stage: Final Retrospective (2026-06-16T16:00:00Z)

### Session summary

Shipped a docs-only fix for a third-party discoverability issue: the `external_directory` allow-list (e.g. `~/.cargo/registry/*`) already does what the user wanted, so the work documented it across `configuration.md`, `README.md`, `config.example.json`, and the schema rather than changing behavior.
The session ran clean end to end (plan → build → ship → release `pi-permission-system` `v13.1.2`), with the only notable inflection at planning: an initial mis-framing of the design that the operator's redirect and a most-restrictive-wins re-analysis corrected before any code was written.

### Observations

#### What went well

- The `ask_user` gate on a third-party issue earned its keep.
  It surfaced the design direction before implementation and prevented building the tempting-but-wrong "make a `path` allow suppress `external_directory`" change, which most-restrictive-wins makes a silent access-widening regression.
- Incremental verification throughout build: `lint` ran after each of the three doc steps, and both JSON files were `JSON.parse`-checked after the schema/example edit — no end-only verification gap.
- Operator mid-build spot-check ("`jsonc` or `json`?") was answered by verifying the convention (21 ` ```jsonc ` vs 0 ` ```json `) and the loader (`JSON.parse(stripJsonComments(raw))`), not by assertion — and the answer held.

#### What caused friction (agent side)

- `missing-context` — the first planning `ask_user` presented "make a `path` allow authoritative (suppress `external_directory`)" as a near-recommended fix, framed as correcting an "asymmetry," without first tracing the documented most-restrictive-wins composition where `ask` > `allow`.
  The operator redirected to discuss the interaction; a re-analysis then showed the option was a security regression.
  Self-corrected after the operator's nudge.
  Impact: one extra discussion round at planning; no rework (caught before any code), and the outcome improved.
- `other` (tool-usage) — two consecutive `Edit` calls on `configuration.md`/`schemas/permissions.schema.json` were rejected: first for a stray `newText_unused`/`newText2_unused` key in the `edits` object, then because the `oldText` for the schema `markdownDescription` used real newlines while the file stores literal `\n` escapes inside a single-line JSON string.
  Impact: ~2 retries, no rework.

#### What caused friction (user side)

- None blocking.
  The operator's two interventions (planning redirect, `jsonc` spot-check) were timely and strategic, and both improved the result.
  The only forward-looking opportunity: the most-restrictive-wins composition invariant lives in `docs/configuration.md` but not in the package skill, so it was not front-of-mind when I drafted the first `ask_user` — see the proposed skill addition.

### Diagnostic details

- **Model-performance correlation** — one subagent dispatch (`pre-completion-reviewer`) ran on `anthropic/claude-sonnet-4-6` for judgment-heavy doc/consistency review; appropriate, no mismatch.
- **Escalation-delay tracking** — no `rabbit-hole`; the longest stuck sequence was the two rejected `Edit` calls, resolved on the third attempt (under the 5-call threshold).
- **Unused-tool detection** — none; `grep`/`Read` covered the planning context, and no `missing-context` point would have been closed by an unused agent or tool (the gap was an undocumented invariant, not unsearched code).
- **Feedback-loop gap analysis** — `lint` ran after every build step and JSON parsing after the schema edit; no deferred-verification gap.
  `check`/`test` were correctly skipped (no `src/`/`test/` changes).

### Changes made

1. `.pi/skills/package-pi-permission-system/SKILL.md` — added a most-restrictive-wins cross-surface composition invariant after the `last-match-wins` bullet (Implementation Priorities), stating that a more-permissive rule on one surface cannot loosen a more-restrictive rule on another and that outside-CWD directories belong on `external_directory`, not `path`.
2. Proposal 2 (JSON-escape `Edit` note in `AGENTS.md`) was considered and declined by the operator — not landed.
