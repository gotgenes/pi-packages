---
issue: 106
issue_title: "document opencode compatibility"
---

# Retro: #106 — document opencode compatibility

## Final Retrospective (2026-05-07T04:00:00Z)

### Session summary

Wrote `docs/opencode-compatibility.md` comparing shared concepts and divergences with OpenCode's permission system.
The initial draft contained three factual errors about our own codebase's capabilities, each requiring user correction and a follow-up commit.
Released as part of v5.6.1.

### Observations

#### What went well

- The iterative review style (one concern per user message) kept commits atomic and easy to verify.
- Reference material (OpenCode source, Pi mono) was available locally, enabling source-level verification of OpenCode's behavior.

#### What caused friction (agent side)

- `missing-context` — Claimed "No arity table; matches against full command string" without checking `src/bash-arity.ts` or closed issues.
  The user had to ask "I thought we did the bash arity thing."
  Impact: 1 extra commit, 1 user correction.
- `missing-context` — Wrote "Deprecated and removed" for `doom_loop` without recalling that Pi never supported it (dead code).
  The user corrected the framing.
  Impact: 2 extra commits (one to fix wording, one to merge into OpenCode-only surfaces row).
- `missing-context` — Said OpenCode's tree-sitter path extraction was "superior" and implied we used heuristics, when `src/external-directory.ts` already has a full tree-sitter implementation (#74, v4.2.0).
  The user had to point this out.
  Impact: 1 extra commit to correct.

All three errors share the same root cause: writing claims about "what this extension lacks" without verifying against `src/`, `docs/retro/`, or closed issues.
The plan's Background section was written from the web search and OpenCode source — not cross-checked against our own shipped state.

#### What caused friction (user side)

- The user had to provide three corrections that could have been self-discovered.
  Each was a simple "did you check our code?" moment.
  No strategic judgment was needed — this was mechanical oversight the agent should handle autonomously.

### Changes made

1. Added MD028 (adjacent blockquotes) guidance to `AGENTS.md` § Markdown.
2. Added "verify claims against own codebase" rule to `AGENTS.md` § Notes for Agents.
