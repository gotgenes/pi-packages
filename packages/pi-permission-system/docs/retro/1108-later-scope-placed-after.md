---
issue: 1108
issue_title: 'pi-permission-system: agent frontmatter "*": deny does not override a global allow'
---

# Retro: #1108 — pi-permission-system: agent frontmatter "*": deny does not override a global allow

## Stage: Planning (2026-11-26T04:19:27Z)

### Session summary

Reproduced the third-party report through `FilePolicyLoader` over real config and agent files.
Prototyped the per-scope fold in place: the full suite went 6562 passed / 1 failed, and the failing test encodes the bug.
Planned the fix as a new pure `composeScopes` (`src/policy/scope-composition.ts`) that replaces `mergeScopesWithOrigins` and its origin map, in five steps: a test reorder, two `fix!:` steps, one `fix:` step, and docs.
Filed #1147 (a pattern map under the universal `"*"` is accepted and ignored); the operator folded it into #1127, and that disposition is committed separately.

### Observations

- Operator decisions at the gate:
  - direction: per-scope rule bands (the roadmap Outcome), not a reorder inside `mergeFlatPermissions`;
  - the universal `"*"` stays the fallback ("least surprising as a user"), not a rule that overrides earlier scopes;
  - "Align it now" for `config-loader.ts`'s `mergeFlatPermissions`, which feeds only `detectPermissiveBashFallback`.
- The operator asked what "first/last scope" meant and which checks reach `permission["*"]` before answering.
  The first gate assumed those terms were understood; lead with the slot table next time.
- The operator also assumed the `config-loader.ts` merge was legacy configuration.
  It merges the current `config.json` files too (only its `permission` half is down to one reader), so the question was re-asked with that context.
- The design drops an earlier rule whose `(surface, pattern)` a later scope redefines: it moves rather than duplicates.
  Without the drop, `synthesizeBaseline` would see a shadowed `mcp` allow and `/permission-system show` would list each redefined pair twice.
- The Tidy-First assessor confirmed `writtenRules` must be its own fold, not `rules` minus the relocated copies, and supplied the counter-example now in TDD step 3.
- I narrowed the gate's "redefined keys move" for `mergeFlatPermissions` to the presence change only: its one reader checks key presence, never order.
- Breaking changes found beyond the issue:
  - object-after-string: `ls` goes `ask` → `allow` when global has `bash: "allow"` and project has `bash: {"rm *": "deny"}`;
  - per-scope relocation of top-level `mcp__` keys.
  Both are named for the `BREAKING CHANGE:` footers and the README `Upgrading` entry.
- The `Co-authored-by:` trailer for @smb374 (GitHub id 13521730, from `gh api users/smb374`) is resolved in TDD step 2.

#### Deferred tidyings

- `src/policy/normalize.ts` `normalizeFlatConfig`: it stamps `origin: "builtin"`, and its one `src` caller overwrites it.
  An `origin` parameter fits once `composeScopes` is its caller, but it would touch about 20 `normalize.test.ts` call sites.
- `src/policy/permission-merge.ts`: after this change its only consumer is in `config/`; consider moving it with #1028.
