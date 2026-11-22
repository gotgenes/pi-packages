---
issue: 435
issue_title: "fix(pi-permission-system): strip shell comment lines from bash commands before matching"
---

# Retro: #435 — strip shell comment lines from bash commands before matching

## Stage: PR Review (2026-06-19T17:06:21Z)

### Session summary

Third-party PR #435 from `@rnavarro` (Robert Navarro) fixes a real gap: when an agent prepends a `# description` comment line before a bash command, both the surface match value and the session-approval suggestion tokenize the comment instead of the command, so an explicitly-approved pattern (e.g. `nvm ls`) fails to match and the suggestion is built from `# list…` tokens.
The PR adds `stripBashCommentLines()` to `bash-arity.ts` and applies it in `normalizeInput` (`input-normalizer.ts`) and `suggestBashPattern` (`pattern-suggest.ts`).
The operator reviewed the diff and chose to **adopt mostly as-is** — merge-rebase the branch unchanged, with any future tweaks landing as commits on top — classified as a non-breaking `fix:`.

### Evaluation

The underlying problem is real and reproducible.
`normalizeInput` (`input-normalizer.ts:94`) returns the raw multi-line command as the bash match value, and `suggestBashPattern` (`pattern-suggest.ts:26`) splits the trimmed command on whitespace — a leading `# …` line shifts the leading tokens onto the comment in both paths.

The approach is sound and right-sized; there is little to simplify:

- `stripBashCommentLines` lands in `bash-arity.ts`, the module already responsible for bash command structure (`ARITY`/`prefix`), exported-for-testability in the same style as its siblings — good convention fit.
- The `/^\s*#/` line filter is conservative: it strips only lines whose first non-whitespace character is `#`, so `echo "#foo"` and inline trailing comments (`nvm ls  # note`) are left intact.
  It cannot over-strip into a permission bypass — gating now operates on the *real* command rather than a comment-confused value, which is security-positive.
- Both applications are necessary, not redundant.
  `normalizeInput` strips for the match value while preserving the original in `resultExtras.command`; `suggestBashPattern` must strip independently because `deriveSuggestionValue` (`handlers/gates/tool.ts:21`) feeds it `check.command` — the preserved original.
  The fallback `stripBashCommentLines(command) || command` keeps an all-comment command evaluating against its literal text.
- No new parameters threaded, no schema/config/docs surface touched, no speculative types — nothing over-built to collapse.

Breaking call: non-breaking `fix:`.
It makes a previously-prompted (comment-defeated) command auto-allow *only* when it matches a pattern the user explicitly approved, aligning behavior with intent rather than loosening policy.
`# nvm ls\nrm -rf /` still strips to `rm -rf /` and still will not match an `nvm ls` pattern, so no bypass is introduced.

Verification on the branch: `tsc` clean, `lint` exit 0 (3 pre-existing biome infos in an unrelated path test), 2033 tests pass, `fallow dead-code` clean.

### Decision and attribution

Direction: **adopt mostly as-is** — rebase-merge PR #435 unchanged; follow-up changes (if any) as commits on top.

Contributor: Robert Navarro `<crshman@gmail.com>` (`@rnavarro`).
Because the branch is merged as-is, his commits carry his authorship directly.
Any follow-up commit we author on top must end its body with a blank line followed by:

```text
Co-authored-by: Robert Navarro <crshman@gmail.com>
```

The PR merge auto-closes #435; a close/thank-you comment credits `@rnavarro` by name and links the merge SHA.

## Stage: Final Retrospective (2026-06-19T18:16:36Z)

### Session summary

This session reviewed third-party PR #435, merged it as-is per the operator's call, then cut and published the `pi-permission-system` 14.0.1 release.
The review and verification were clean, but the release-please PR (#436) was merged with the wrong method — `gh pr merge --merge` instead of the project's established `--rebase` — landing it as merge bubble `57561321`, the first non-linear release since the rebase convention was adopted.

### Observations

#### What went well

- The evaluation traced `deriveSuggestionValue` (`handlers/gates/tool.ts:21`) to confirm the second `stripBashCommentLines` call in `suggestBashPattern` was *necessary* (it receives the preserved original `check.command`), not redundant.
  This prevented a wrong "collapse this duplication" recommendation and correctly judged the PR as right-sized.
- Verification ran incrementally and at the right boundaries: `tsc` / `lint` / `test` / `fallow dead-code` on the branch *before* merging, then CI on the merge SHA, the release tag via `release_watch`, and finally the published npm version — no end-loaded verification gap.

#### What caused friction (agent side)

- `missing-context` — chose the release-please merge method by sampling two old `chore: release main` commits (`821403f9`, `3bca3468`) that happened to predate the rebase switch, instead of checking the authoritative sources: `defaultMergeMethod: rebase` (`.pi/extensions/pi-github-tools/config.json`), the most-recent releases (`2de8bf49`, `279f0410` — both linear `parents=1`), or the ship-prompt guidance (`ship-no-issue.md:48`, `ship-issue.md:111`).
  The rebase convention was set deliberately in `cacc724f` ("chore: default release-please PR merges to rebase"); every release since is `parents=1`.
  Impact: release #436 landed as merge bubble `57561321` (`parents=2`) — the first non-linear release since `cacc724f`, contradicting the documented convention.
  Already pushed, tagged, and published, so not cleanly reversible; no functional harm (14.0.1 published correctly), but a permanent history-shape inconsistency.
- `other` — `npm view` (to confirm the published version) was blocked by the repo's pnpm-only guard.
  Impact: one wasted tool call; recovered immediately by reading the registry via `curl`.
  No change warranted — the `never npm or npx` rule already exists and the guard enforced it correctly.

#### What caused friction (user side)

- The PR-review closing summary echoed the operator's own gate phrasing ("any future tweaks land as commits on top") without stating that adopt-as-is meant *done, nothing queued*.
  The operator had to ask "what future tweaks?" and "am I on to /ship-issue?" to disambiguate.
  Opportunity, not criticism: an adopt-as-is summary should state explicitly that no follow-up work is queued.

### Root cause — release-method miss

The authoritative merge-method guidance lives only inside the ship prompts (`ship-no-issue.md`, `ship-issue.md`), which were not loaded because this release was cut from an extended PR-review session, not a `/ship-issue` run.
With no in-context rule, the agent inferred the method from a small, unrepresentative history sample.
The `release_pr_merge` tool would have used rebase (per config) but refused on `merge_state: UNSTABLE` (release branches never get status checks), and the agent's fallback chose `--merge` rather than the prompts' prescribed `--rebase`.

### Changes made

1. `AGENTS.md` — added a release-please rebase-merge invariant after the "Release batching" paragraph in the Multi-session lifecycle section: prefer `release_pr_merge`, fall back to `gh pr merge --rebase` (never `--merge`) on the `UNSTABLE`-no-checks refusal, and do not infer the method from pre-`cacc724f` history.
  Closes the gap for releases cut outside `/ship-issue`.
