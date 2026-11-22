---
issue: 49
issue_title: "feat: remove group-join, output-file, and ad-hoc RPC"
---

# Retro: #49 — remove group-join, output-file, and ad-hoc RPC

## Final Retrospective (2026-05-17T15:15:00Z)

### Session summary

Planned and implemented the removal of group-join and ad-hoc RPC from `pi-subagents`, releasing v3.0.0.
The original scope included `output-file.ts` removal, but the user intervened to retain it for post-hoc debugging value.
A new issue (#61) was filed to port the output-file format to Pi's official JSONL session schema.

### Observations

#### What went well

- User intervention produced a materially better outcome — retaining debugging transcripts and identifying a format conformance gap that became #61.
- TDD execution was clean: 6 steps, zero rework, all tests green on first pass after each step.
- The `feat!:` → release-please → v3.0.0 pipeline worked smoothly end-to-end.

#### What caused friction (agent side)

- `missing-context` — Included `output-file.ts` removal in the initial plan without questioning its debugging value, despite AGENTS.md's rule "Ask before removing functionality or changing defaults."
  The issue body explicitly listed it for removal so I followed the spec literally.
  Impact: required plan revision (amend commit), scope-narrowing comment on issue, and filing #61 — roughly 10 minutes of rework, but produced a better design.

- `missing-context` — When asked whether output-file adheres to Pi's session format, searched the web (`web_search` for "Claude Code session JSONL format") instead of checking the local `~/development/pi/pi` monorepo.
  The user had to explicitly say "~/development/pi/pi has the code for Pi's JSONL format."
  Impact: one extra round-trip and less authoritative initial answer (Claude Code's format vs Pi's `SessionManager`).
  Self-identified after user redirect.

- `instruction-violation` (self-identified) — Shell-escaped the `gh issue comment` body incorrectly; backtick-wrapped `src/output-file.ts` was interpreted by bash.
  Caught immediately via `gh issue view` and fixed with `--edit-last`.
  Impact: trivial — one extra command.

#### What caused friction (user side)

- The issue body listed output-file for removal without noting its debugging value.
  The user's "How confident are we in getting rid of the logging system?" intervention was the correction.
  If the issue had marked output-file removal as "tentative pending debugging value assessment," the plan would have surfaced it as a design decision from the start.
  Minor — the discussion was quick and productive.

### Changes made

1. Created `packages/pi-subagents/docs/retro/0049-remove-group-join-output-file-rpc.md` (this file).
