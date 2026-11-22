---
issue: 68
issue_title: "False positive external-directory prompt when bash command contains //"
---

# Retro: #68 — False positive external-directory prompt when bash command contains //

## Final Retrospective (2026-05-04T17:30:00Z)

### Session summary

Planned, implemented, and shipped a one-line fix in `classifyTokenAsPathCandidate` (`src/external-directory.ts`) to skip tokens composed entirely of forward slashes (`/`, `//`, `///`).
Added 5 regression tests, released as v4.0.1.
The user also prompted a research detour into `shell-quote` and `tree-sitter-bash` as potential replacements for the regex-based tokenizer, which informed a deferred follow-up.

### Observations

#### What went well

- **Research detour produced lasting value.**
  The user's question "are we confident there's not a parser package?" led to a concrete comparison of `shell-quote` (23KB, zero deps) and `tree-sitter-bash` (what OpenCode uses).
  This is documented in the plan's Open Questions and ready to file as a follow-up issue.
  The detour cost ~10 minutes but eliminated a class of future "should we have checked?" doubt.
- **Dog-fooding surfaced the root cause in real time.**
  The `gh issue close` command's `--comment` argument contained `//` and `\"`, triggering the very bug class we just patched — but through the `stripQuotedStrings` escaped-quote vector, not the bare-slash vector.
  This validated the plan's "Broader issue" framing and made the follow-up issue concrete rather than theoretical.

#### What caused friction (agent side)

- `premature-convergence` — The initial plan committed to the one-line regex fix without investigating parser alternatives.
  The user had to explicitly ask "are we confident there's not a parser?" to trigger the research.
  Impact: required a plan amendment and an extra commit, though the final plan was better for it.
  Self-identified after user prompt.
- `rabbit-hole` — The `tree-sitter-bash` exploration tried to run test scripts via `cat > file << 'SCRIPT'` heredocs, which themselves triggered permission prompts (the extension scanning the heredoc content for paths).
  Three failed `bash` invocations before the user cut it short.
  Impact: ~3 minutes wasted on WASM API exploration that the user didn't need to see.
- `scope-drift` — The first `gh issue close` comment was 8 lines of markdown with backtick-escaped path tokens (`` \`//\` ``, `` \`///\` ``).
  This verbose comment triggered `stripQuotedStrings` breakage and an external-directory false positive.
  The second attempt with 5 concise lines succeeded immediately.
  Impact: one denied command + user frustration.

#### What caused friction (user side)

- The user could have mentioned the parser-alternative question during the `/plan-issue` step rather than after the plan was committed.
  This would have avoided the plan amendment commit.
  Minor impact — the amendment was small.

### Follow-ups

- File a follow-up issue to replace the regex tokenizer (`stripQuotedStrings` + `split(/[|;&><\s]+/)`) with `shell-quote` or `tree-sitter-bash`.
  The `stripQuotedStrings` escaped-quote bug is the root cause of an ongoing class of false-positive external-directory prompts.
  Research notes are in this retro and the plan's Open Questions section.

### Changes made

1. Created `docs/retro/0068-skip-bare-slash-tokens.md` (this file).
