---
issue: 73
issue_title: "node -e command triggers permission prompt despite \"*\": \"allow\" global fallback"
---

# Retro: #73 — node -e command triggers permission prompt despite `"*": "allow"` global fallback

## Final Retrospective (2026-05-04T18:21:00Z)

### Session summary

Fixed a bug where `compileWildcardPattern()` in `src/wildcard-matcher.ts` built regexes without the `s` (dotAll) flag, causing `.*` to fail on newline characters.
Multiline bash commands (e.g., `node -e "\n...\n"`) fell through every rule — including the universal `*`/`*` catch-all — and hit the hard-coded `"ask"` default.
The fix was a single-character addition (`"s"` flag), shipped as v4.1.1 with four new tests.

### Observations

#### What went well

- Root-cause verification before planning: a quick `node -e` command confirmed the `.` vs `\n` hypothesis in seconds, keeping the plan tightly scoped.
- The issue was exceptionally well-written — clear reproducer, config excerpt, two specific hypotheses, and evidence against hypothesis B.
  This eliminated investigation time entirely.
- Clean three-step TDD cycle with zero rework or deviations from the plan.
- Full plan→implement→ship completed in three user prompts.

#### What caused friction (agent side)

No friction points identified.

#### What caused friction (user side)

No friction points identified.

### Changes made

1. Created `docs/retro/0073-wildcard-dotall-multiline.md` (this file).
