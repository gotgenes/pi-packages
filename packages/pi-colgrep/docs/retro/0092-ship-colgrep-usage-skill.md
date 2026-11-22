---
issue: 92
issue_title: "Ship colgrep usage skill"
---

# Retro: #92 — Ship colgrep usage skill

## Final Retrospective (2026-05-22T23:10:00Z)

### Session summary

Shipped `skills/colgrep/SKILL.md` adapted from the upstream ColGrep SKILL.md (Apache-2.0), with third-party attribution, `package.json` registration, and npm `files` inclusion.
Also fixed a `promptGuidelines` self-identification gap where the "increase limit" bullet didn't name `colgrep`, and filed #152 for missing `promptSnippet` on pi-subagents tools after a cross-package audit.
Released as `pi-colgrep-v1.3.0`.

### Observations

#### What went well

- The user's question about earendil-works/pi#4879 (`promptGuidelines` attribution) surfaced a real gap: the third guideline bullet ("Increase limit") was ambiguous in the flattened `Guidelines:` block.
  This led to a concrete fix (fa164a1) and a cross-package audit that identified the pi-subagents `promptSnippet` gap (#152).

#### What caused friction (agent side)

- `missing-context` — Placed an HTML comment (`<!-- attribution -->`) before the YAML frontmatter `---` in `skills/colgrep/SKILL.md`.
  The autoformatter did not recognize the YAML frontmatter and reformatted it as markdown headings.
  First attempt collapsed `name` and `description` onto one line; second attempt turned `description:` into `## description:`.
  Moving the HTML comment after the closing `---` fixed it.
  Impact: 2 extra write-read-fix cycles before the file was stable.

#### What caused friction (user side)

- The user linked to earendil-works/pi#4879 mid-session, which reframed the `promptGuidelines` conversation from "is our text clear?" to "does each bullet self-identify its tool in the flattened system prompt?"
  This was the right moment to raise it — after the skill shipped but before the issue closed.
  No friction; this was a valuable intervention.

### Changes made

1. `.pi/skills/code-design/SKILL.md` — added `promptGuidelines` self-identification rule under "Pi SDK boundaries" with link to earendil-works/pi#4879.
