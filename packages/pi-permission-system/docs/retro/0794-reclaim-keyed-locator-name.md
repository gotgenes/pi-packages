---
issue: 794
issue_title: "pi-permission-system: reclaim getPermissionsService for the keyed locator before it publishes"
---

# Retro: #794 — Reclaim `getPermissionsService` for the keyed locator

## Stage: Planning (2026-08-21T20:43:05Z)

### Session summary

Planned the rename of the six cross-extension service accessors as `packages/pi-permission-system/docs/plans/0794-reclaim-keyed-locator-name.md`.
Three TDD cycles: the rename itself (`src/` + all three test files + `scripts/verify-public-types.sh` in one commit, since removing exports breaks importers at the type level), a new once-guarded warning when `getPermissionsService` is called without a session id, then the docs plus an in-place amendment to [ADR 0012] decision 7.
The implementation commit carries two `BREAKING CHANGE:` footers — the rename and [#787]'s ready cadence — because the [#699] and [#787] commits are already on `main` and cannot be retyped.

### Observations

- **The issue's stated sequencing was not executable, and the gate settled it.**
  Issue [#794] says `#789 → this → #788 → merge the release`, but [#788]'s own scope says it is blocked on the permission-system *releasing*: `linkWorkspacePackages: false` plus a devDependency pinned at `20.10.0` means the judge compiles against the registry copy and cannot see an unreleased rename.
  The operator chose `ship independently`, so the order is this issue → [#790] merges as `27.0.0` → [#788].
- **A silent-failure hazard the issue did not price became a third gate question.**
  The published `pi-permission-model-judge@1.1.4` declares `peerDependencies: ">=20.10.0"` and guards with `if (!service) return;`, so an install whose judge copy resolves to `27.0.0` loses the `model-judge` chain link with nothing on stderr.
  The operator chose the once-guarded `process.emitWarning` over both a bare `undefined` and a throw.
  Design detail decided rather than asked: a distinct `PI_PERMISSION_SYSTEM_WARN0001` / `type: "Warning"` rather than reusing `DEP0001`, since `--no-deprecation` must not silence "your chain link vanished".
- **ADR 0012 decision 7 is amended in place**, following `0007-model-judge-authorizer-chain-adr.md`'s "Amended 2026-08-14 with §7 …" precedent: `status: accepted` stays, the latch row moves minor → major, a new row covers the rename, and a paragraph records why the "bus-caught stderr noise" estimate was wrong.
  The Context narrative is left alone — it describes 26.x accurately.
- **Scope held to a rename.**
  Two reductions were considered and rejected in the plan rather than asked: dropping the root publish/unpublish pair from the public surface (rejected — `pi-permission-model-judge`'s own test suite publishes a fake service into the slot, which is a legitimate public-publisher use case), and migrating the tests' convenience root-slot reads onto the keyed locator (deferred as a separate tidy; converting them needs each test's session id threaded).
- **`pi-permission-model-judge` is not a touch point**, verified rather than assumed: both its source and its tests resolve the registry copy, and at runtime its `20.10.0` reader reads the root slot this change keeps writing.
  So the repo's own dogfooded judge keeps working through the rename.
- **No follow-up issues filed.**
  The one concrete follow-up — narrowing the judge's peer range to `>=27.0.0` — is a one-line addition to [#788]'s existing scope, so it went as a comment there instead.
  `pi-permission-system` has no open improvement phase, so the `roadmap-fit` skill exits at its first step.
- **Verification hook worth keeping for implementation:** the consumer probe in `scripts/verify-public-types.sh` currently only *references* `getPermissionsService`; the plan changes it to call `getPermissionsService("session-id")` so the packed-tarball type-check pins the keyed signature externally.

## Stage: Implementation — TDD (2026-08-21T21:02:24Z)

### Session summary

Landed the rename in three cycles plus one preparatory tidy: the mock-naming `test:` commit the Tidy-First assessor recommended, the atomic `feat!:` rename across `src/`, all three test files and the packaging probe, the additive missing-session-id warning, and the docs commit (six docs, the [ADR 0012] amendment, and the new `docs/migration/0794-keyed-service-locator.md`).
The pi-permission-system suite went from 3230 to 3233 tests (+3, all in the new `keyed accessor called without a session id` describe).
Every deterministic gate stayed green at each commit, `verify:public-types` passes against the packed tarball, and the pre-completion reviewer returned **PASS**.

### Observations

- **The Tidy-First assessor found exactly one preparatory commit, and it was a real trap.**
  `test/service-lifecycle.test.ts`'s root-slot mocks were named `mockPublishPermissionsService` / `mockUnpublishPermissionsService` — the base names this change reassigns to the *keyed* trio — so a mechanical rename would have left every variable meaning the opposite of what it mocks.
  Renaming them by slot role first (`mockPublishRootService` / `mockPublishKeyedService`) reduced that file's feature-commit diff to the four `vi.mock` factory keys.
  The assessor also verified the plan's structural claims on the way past: 28 call sites in `composition-root.test.ts` split 17 root / 11 keyed with no ambiguous line, both file-level `no-deprecated` disables already present, and every mocked key exercised by an assertion.
- **The scripted rename needed a two-pass order**, root first (`getPermissionsService` → `getRootPermissionsService`) and keyed second (`*ForSession` → base names), or the second pass would have collided with the first.
  `\b` boundaries kept `unpublishPermissionsService` from matching inside `publishPermissionsService` and kept `getPermissionsService` from matching inside `getPermissionsServiceForSession`.
  A `zsh` gotcha cost one call: an unquoted `$FILES` variable does not word-split, so the file list had to be spelled out inline.
- **Two of the three new tests passed at Red, by design** — "returns `undefined` rather than another node's service" and "does not warn when a session id is passed" are invariant pins on behavior the map lookup already had; only the warning assertion was genuinely red.
- **The `no-unnecessary-condition` disable was speculative and got stripped.**
  A pre-emptive `eslint-disable-next-line` on `typeof sessionId !== "string"` (typed `string`) drew `Unused eslint-disable directive` — the rule does not flag a `typeof` guard on a typed parameter.
  The skill's rule held: add the directive only after the linter reports the problem.
- **Prose fixes the script could not make.**
  "The zero-arg `getRootPermissionsService()`" is a contradiction the substitution happily produced in four docs; each needed a hand edit, as did the guide's `getPermissionsService()` → `getPermissionsService(sessionId)` in the degradation note and the deprecation test's `stringContaining` probe, which was widened to `"getPermissionsService(sessionId)"` so it cannot pass on an unrelated substring.
- **The ADR amendment is a correction, not a rewrite.**
  `status: accepted` stands, the Context narrative is untouched as a dated record of the 26.x world, decision 7's table uses `~~minor~~ **major**` strikethrough, and a `#### Amendment` subsection records *why* the estimate failed — the predicted stderr noise is a throw that fires before the consumer's `dispose` handle is assigned, so its idempotence guard never latches.
- **Deviation from the plan:** one extra commit (the Tidy-First `test:` prep) and one extra improvement inside cycle 1 (the `verify-public-types.sh` probe now imports `PermissionsService` to type the keyed call's result).
  Every file in the plan's Module-Level Changes table was touched; nothing was added beyond it.
- Pre-completion reviewer: **PASS**, no warnings.
  It independently re-ran the judge package's `check` and `test` to confirm `pi-permission-model-judge` still compiles against its registry-pinned `20.10.0` copy, and swept the repo for stale `*ForSession` mentions (only the two deliberate historical ones plus the dated plans/retros remain).

#### Deferred tidyings

- `test/service.test.ts` — the same three-line root-slot `afterEach` cleanup block is repeated across three `describe` blocks (round-trip, formatter delegation, extractor delegation); the assessor rejected deduplicating it as unrelated to this change.

## Stage: Final Retrospective (2026-08-21T21:23:16Z)

### Session summary

Planned, implemented, and shipped the reclaimed keyed locator in a single continuous session: one `ask_user` gate, four commits, and a release cutting `pi-permission-system` 27.0.0 (with `pi-subagents` 19.3.5 riding the same batch).
The operator intervened exactly once — the three-question planning gate — and every subsequent stage ran without a correction.
The issue closed with both breaking changes documented, and [#788] is now unblocked.

### Observations

#### What went well

- **The planning gate overturned the issue's own sequencing, and the issue was the operator's.**
  [#794] states the order `#789 → this → #788 → merge the release`, which is not executable: [#788] cannot compile against an unreleased rename, because `linkWorkspacePackages: false` plus a devDependency pinned at `20.10.0` means the judge consumes the registry copy.
  The prompt's "treat the Proposed change as a hypothesis" rule is written for third-party issues, and it paid off on a first-party one — a filed `## Sequencing` section is a claim to verify, not a spec.
- **The Tidy-First assessor caught a semantic inversion, not a structural smell.**
  `test/service-lifecycle.test.ts`'s root-slot mocks were named `mockPublishPermissionsService` / `mockUnpublishPermissionsService` — exactly the base names this change reassigns to the *keyed* trio.
  A mechanical rename would have left four variables meaning the opposite of what they mock, with a green suite and no gate to catch it.
  This is a different class of find from the extractions the assessor usually proposes, and it is the kind only a fresh read of the target files surfaces.
- **The dogfooded `model-judge` link auto-corrected a mistyped path.**
  A hand-built absolute path (`/Users/chris/development/pi/pi-permission-system/test/service.test.ts`, missing the `packages/` segment) was denied with the reason "Doubled package segment detected.
  The correct path is: …", naming the exact correct path; the next call used it and succeeded.
  The review log confirms the decider: `decidedBy: { kind: "authorizer", name: "model-judge", verdict: "deny" }`.
  This is [#726]'s provenance record and the Phase 12 chain working end to end on a live session, one day before the change that reclaims the accessor the judge itself registers through.
- **A live in-the-wild instance of [#772].**
  The same denial surfaced to the agent as " **The user** denied this `external_directory` call … Reason: …" while the log recorded an `authorizer` decider.
  No human saw or answered that prompt.
  [#772] is exactly this mislabeling, and this session produced a reproduction with matched log evidence.
- **The packaging probe became a signature check.**
  `scripts/verify-public-types.sh` previously only *referenced* `getPermissionsService` (`void getPermissionsService;`), which would have passed unchanged against a wrong arity.
  It now calls `getPermissionsService("session-id")` and types the result, so the packed-tarball gate catches an arity regression an external consumer would hit.
- **Verification ran incrementally, and the baseline was established on all four gates first.**
  File-scoped `vitest` after each edit, `pnpm run check` + `lint` mid-cycle, the full suite plus `verify:public-types` before the `feat!` commit.
  Nothing broke that had to be attributed to a pre-existing condition.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — read a hand-built absolute path with a doubled package segment instead of the repo-relative form `AGENTS.md` § Shell and search requires (Refs [#726]).
  Impact: one denied tool call, no rework — the `model-judge` denial named the correct path.
  Notable as a **recurring** friction: [#787]'s retro recorded the identical slip one issue earlier, so the rule's existence is not the gap.
- `other` (shell semantics) — built a `FILES="a b c"` variable and passed it unquoted to `perl`; `zsh` does not word-split an unquoted parameter, so the whole list arrived as one filename.
  Impact: one failed call, re-run with the list spelled inline.
  `AGENTS.md` collects three other `zsh`-vs-`bash` divergences but not this one.
- `instruction-violation` (self-identified) — added an `eslint-disable-next-line @typescript-eslint/no-unnecessary-condition` preemptively on the `typeof sessionId !== "string"` guard, which the `code-design` skill forbids ("add the directive only after the linter reports the rule").
  Impact: one extra edit; `pnpm run lint` reported `Unused eslint-disable directive` immediately, so the loop closed in one cycle.
- `instruction-violation` (identified at retro, not in-session) — one `edits[]` entry in the [ADR 0012] amendment carried `oldText2`/`newText2` keys, which `AGENTS.md` explicitly names as silently ignored (Refs [#605]).
  Impact: **none** — the keys were empty and the real replacement sat in `oldText`/`newText`, and the reported block count (3) matched the intended edits (3).
  Recorded because the failure mode is latent: real content in `oldText2` would have been dropped under a success report.
- `other` (anticipated, absorbed) — the scripted docs rename produced the contradiction "the zero-arg `getRootPermissionsService()`" in four files, plus a stale arity in the guide's degradation note and an over-broad `stringContaining` probe in the deprecation test.
  Impact: five hand edits after the script; caught by reading every diff, flagged by no gate.
- `other` (during the retro itself) — posted the [#772] evidence comment with `gh issue comment --body '…'`, hand-escaping backticks as `` \` `` inside **single** quotes, where a backslash is literal.
  Every backtick shipped as `` \` ``.
  Impact: one malformed comment, repaired with `--edit-last --body-file`.
  The planning stage's [#788] comment used the same hand-escaping and survived only because it was double-quoted.
  This is the sibling of the backslash trap `AGENTS.md` already records for `Edit` replacements, and it became proposal P4.
- `other` (formatter interaction) — three `Edit` attempts were needed to land the new `zsh` line, because the `rumdl fmt` pass kept joining it onto the preceding line.
  Impact: two wasted edits, then a rewrite to "In zsh an unquoted parameter is not word-split …".

  Root-caused rather than worked around blindly, at the operator's prompt.
  The reflow is `rumdl`'s, not `pi-autoformat`'s own: `.rumdl.toml` sets `MD013` `reflow = true` with `reflow-mode = "sentence-per-line"`.
  The trigger is a **lowercase letter at line start**, which `rumdl` does not recognize as a sentence boundary — it reports `found 2 sentences across 3 lines` and merges the author's deliberate break.
  Measured against four fixtures on `rumdl@0.2.58` (the latest published), each a two-line paragraph differing only in how the second line starts:

  | Second line starts with                             | Result                        |
  | --------------------------------------------------- | ----------------------------- |
  | `zsh …` (lowercase word)                            | joined into the previous line |
  | `Zsh …` (capital)                                   | stays split                   |
  | `` `zsh` … `` (inline code)                         | stays split                   |
  | `npm …` (lowercase, prior line ends in a code span) | joined into the previous line |

  Not fixed by upgrading: the repo pins `0.2.10` and `0.2.58` behaves identically, so the drift is unrelated.
  **Workaround** — start such a sentence with a capital, or wrap the leading identifier in backticks; both survive the reflow.
  The operator declined both an upstream bug report and a version-bump issue, so this note is the record.
  Worth knowing that the existing `AGENTS.md` note about a line ending in `:` being joined is a *different* mechanism from this one; if the workaround ever needs to be enforced rather than remembered, `AGENTS.md` § Tool-injected messages is its home.

  A methodology note: the first reproduction attempt was a false green — it ran `pnpm exec rumdl` from `/tmp`, where `pnpm` exits with `ERR_PNPM_RECURSIVE_EXEC_NO_PACKAGE` and the fixture came back unmodified, which reads as "not reproducible" rather than "never ran".
  The `testing` skill's rule about probes that pass for the wrong reason applies to shell repros too.

#### What caused friction (user side)

- Nothing to correct — the operator answered the gate decisively (all three recommended options) and did not intervene again across implementation, ship, and release.
  The one forward-looking opportunity: [#794]'s `## Sequencing` section was written before [#788]'s registry-pinned-dependency constraint was salient, and re-checking a filed sequencing claim at filing time would have moved that discovery earlier than the planning gate.

### Diagnostic details

- **Model-performance correlation** — planning, TDD, and this retrospective ran on `anthropic/claude-opus-5`; the ship stage ran on `anthropic/claude-sonnet-5`.
  The split tracks the work: gate design, the [ADR 0012] amendment, and the migration-guide prose are judgment-heavy; push → `ci_watch` → tag verify → close is mechanical.
  One step on the cheaper model was genuinely judgment-bearing — reading release PR [#790]'s full body and deciding that the `pi-subagents` 19.3.5 bump was expected (a [#789] doc-only carry) rather than a missing `exclude-paths` entry.
  It reached the right answer; worth noting only because that is the one place in the ship stage where a wrong call would ship a surprise.
  Both subagents (`tidy-first-assessor`, `pre-completion-reviewer`) ran on their frontmatter default `anthropic/claude-sonnet-5`, appropriate for a bounded read-and-report over seven named files.
- **Escalation-delay, unused-tool, and feedback-loop lenses** — nothing to flag.
  No `rabbit-hole` occurred; the longest same-error streak was one call.
  `colgrep` went unused, correctly: every search here was an exact-symbol grep, which its own decision table assigns to `grep`.
  The one three-call streak (the `zsh`-line reflow above) landed in the retro stage, not implementation, and each attempt tested a different hypothesis rather than repeating one.

### Changes made

1. `AGENTS.md` § Shell and search — added the zsh no-word-splitting rule ("In zsh an unquoted parameter is not word-split … spell a multi-file list inline").
2. `AGENTS.md` § Shell and search — added the `gh issue comment` / `gh pr comment` `--body-file` rule for bodies containing backticks or fences.
3. `AGENTS.md` § Edit tool batches — appended the scripted-rename prose-staleness rule to the scripted-substitution cluster (grep the words describing the old shape, not just the old symbol).
4. Posted a comment on [#772] with this session's live `model-judge` mislabeling and the matching review-log entry.
5. `packages/pi-permission-system/docs/retro/0794-reclaim-keyed-locator-name.md` — this Final Retrospective stage entry, including the `rumdl` sentence-per-line characterization above.

Declined by the operator, recorded so the decision is not re-litigated: an upstream `rumdl` bug report for the lowercase-initial sentence merge, and a repo issue to evaluate the `0.2.10` → `0.2.58` bump.

[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[#605]: https://github.com/gotgenes/pi-packages/issues/605
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#726]: https://github.com/gotgenes/pi-packages/issues/726
[#772]: https://github.com/gotgenes/pi-packages/issues/772
[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#790]: https://github.com/gotgenes/pi-packages/pull/790
[#794]: https://github.com/gotgenes/pi-packages/issues/794
