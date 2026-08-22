---
issue: 788
issue_title: "pi-permission-model-judge: migrate registration to the ADR 0012 keyed channel"
---

# Retro: #788 — pi-permission-model-judge: migrate registration to the ADR 0012 keyed channel

## Stage: Planning (2026-08-21T22:22:16Z)

### Session summary

Planned the consumer-side migration of `@gotgenes/pi-permission-model-judge` onto the ADR 0012 keyed service locator, now that `@gotgenes/pi-permission-system` `27.0.0` is published.
The plan collapses the dual-path registration (`session_start` + `permissions:ready` behind an idempotency guard) onto one idempotent ready handler keyed by the payload's `sessionId`, narrows the peer range to `>=27.0.0`, and adds a once-per-session warning when the node's service cannot be resolved.
Plan committed at `packages/pi-permission-model-judge/docs/plans/0788-migrate-registration-to-keyed-channel.md`; three TDD cycles plus a verification step.

### Observations

- **Verified the published API against the tarball, not the workspace source.**
  `pnpm view @gotgenes/pi-permission-system@27.0.0 dist.tarball` + `tar` confirmed `getPermissionsService(sessionId)`, the two-arg `publishPermissionsService`, and the `PermissionsReadyEvent` type export all reach a consumer.
  Necessary because `linkWorkspacePackages: false` means this package consumes the registry tarball, and the workspace `src/` is ahead of what any published consumer sees.
- **Clarification gate settled two things.**
  Peer floor → clean break (`>=27.0.0`, major, `fix(pi-permission-model-judge)!:`), rejecting a root-accessor compatibility shim that would have kept `>=20.10.0` and a minor.
  Vacancy visibility → a once-per-session `console.warn`, rejecting both silence and per-emission warning.
- **The breaking classification is about the peer floor, not this package's own API.**
  Nothing in `@gotgenes/pi-permission-model-judge`'s surface changes; a user on pi-permission-system `20.10`–`26.x` loses the link on upgrade, which is this repo's definition of breaking.
- **The red is behavioral, not just a type error.**
  Vitest strips types, so after the devDependency bump the unchanged `tryRegister()` calls the zero-arg accessor against `27.0.0`, gets `undefined`, and the registration assertions fail for the right reason.
  That is what lets the bump, the test rewrite, and the source migration share one commit without the cycle degenerating into "make `tsc` happy".
- **ADR 0012 decision 7 supplies a measurable acceptance criterion** — the migrated registration must be smaller than the workaround.
  Measured baseline recorded in the plan: `src/extension.ts` is 106 lines, of which ~31 are registration machinery.
  The vacancy warning is counted separately so new capability cannot flatter the comparison.
- **The 24-hour `minimumReleaseAge` gate is live for this work.**
  pi-permission-system `27.0.0` published `2026-08-21T21:19Z`, roughly an hour before planning, so the implementation session should expect `pnpm add` to fail and reach for the version-pinned `minimumReleaseAgeExclude` entry.
- **One skill-doc line goes stale with this change.**
  `.pi/skills/package-pi-permission-system/SKILL.md:187` still calls the judge migration and the docs consolidation unimplemented; [#789] already landed, so the sentence is rewritten in the docs cycle.
- No open PR touches this package, and neither package has an open improvement phase, so the `roadmap-fit` skill had nothing to record and the release recommendation is "ship independently".

[#789]: https://github.com/gotgenes/pi-packages/issues/789

## Stage: Implementation — TDD (2026-08-21T22:48:44Z)

### Session summary

Migrated registration onto the ADR 0012 keyed channel in three planned cycles plus one Tidy-First preparatory commit and two review-driven follow-ups — six commits total.
The `permissions:ready` handler is now the whole registration, keyed by the payload's `sessionId`; `tryRegister`, the `sessionStarted` flag, both call sites, and the nine-line ordering comment are gone.
Test count 48 → 54 in this package (added: latch-ordering, node-locality, and four vacancy tests; removed: the dual-path `pps-first order` test).

### Observations

- **The plan's size criterion failed, and the failure was the most interesting result.**
  ADR 0012 decision 7 makes this package the contract's proof: the migrated registration must be smaller than the workaround.
  Measured, `src/extension.ts` went 106 → 109 for the migration alone (127 with the separately-counted vacancy warning). 30 lines of workaround died and 33 arrived; the seven that tip the balance narrow the `unknown` ready payload, which is decision 2's own cost rather than workaround residue.
  Surfaced at a clarification gate mid-cycle: the operator chose to keep the named `readySessionId` helper and record the measurement honestly over inlining the narrowing to reach 105 lines.
  Both `ask_user` options were measured, not estimated — the inline variant was written to a scratch file and counted rather than guessed at.
- **The version bump broke more than the accessor.**
  Not in the plan: `27.0.0` also made `PromptPermissionDetails.payload` required and removed `message` (pi-permission-system #746), so three test-fixture sites failed `tsc` after the bump.
  Repaired with a new shared `test/fixtures/permission-details.ts`, folded into the migration commit.
  No production code in this package reads either field — `typo-reviewer` works from `accessIntent` / `surface` / `path` / `value` — so this was fixture repair, not a behavior change.
  A plan that bumps a dependency across six majors should expect collateral type breakage beyond the API it targets.
- **The red was behavioral, exactly as the plan predicted.**
  Vitest strips types, so after the bump the unchanged `tryRegister()` called the zero-arg accessor against `27.0.0`, got `undefined`, and every registration assertion failed — with one `PI_PERMISSION_SYSTEM_WARN0001` in the output as corroboration.
  That is what let the bump, the test rewrite, and the source migration share one commit without the cycle degenerating into satisfying the type checker.
- **The Tidy-First assessor earned its dispatch.**
  Its one recommendation — extracting the five-times-duplicated publish/`session_start`/ready sequence into `bringUpSession` — turned the plan's "thread `SESSION_ID` through every call" step into a one-line helper-body edit.
  It also correctly *declined* to extract a `register()` helper in `src/extension.ts`, reasoning from ADR 0012's size mandate that new indirection there would have to be undone.
- **A misplaced `describe` seam cost a round-trip.**
  Inserting the vacancy `describe` mid-file closed the enclosing block early and silently reparented three existing tests under the new heading.
  The suite still ran, so only a structural `grep -n '^describe\|^});'` caught it.
  Anchor a new sibling `describe` on the end of the previous one, not on a convenient test boundary inside it.
- **`pnpm add` handled the release-age gate itself.**
  It added the version-pinned `minimumReleaseAgeExclude` entry to `pnpm-workspace.yaml` automatically — the plan's manual fallback recipe was never needed.

#### Deferred tidyings

None — the assessor's rejected items (splitting `test/extension.test.ts`, restructuring the `warn()` helper) were declined as unrelated to this change's friction, not deferred.

### Pre-completion review

Round 1: **WARN** — two findings, both put to the operator, both actioned.

1. The ADR 0012 decision 7 size proof did not land as written, and a reader of that record would find a stated proof with no outcome.
   Operator chose to amend ADR 0012 now (`726a6e30`), beside the existing #794 amendment — reversing the plan's Non-Goal, on the grounds that recording a refuted prediction is not the status-board use #787 ruled out.
2. Pre-existing `ReturnType<typeof vi.fn>` mock typings.
   Operator chose to fix them now (`dbc39ff6`); the package-wide sweep also let three `.mock.calls` casts be dropped.

Round 2 (re-dispatched after those two substantive commits): **PASS** — ready for `/ship-issue`.

## Stage: Final Retrospective (2026-08-22T01:09:53Z)

### Session summary

One continuous session carried #788 from plan through TDD to ship: `pi-permission-model-judge` now registers its chain link from the `permissions:ready` handler alone, keyed by the payload's `sessionId`, and released as `2.0.0` (major, breaking — peer floor `>=27.0.0`).
Seven commits landed plus the release; the package's suite went 48 → 54 tests.
The session's defining moment was not the migration but its measurement: ADR 0012 decision 7's own size proof was refuted by the result, and the refutation was recorded in the ADR rather than quietly dropped.

### Observations

#### What went well

- **The extension under migration caught a real defect in its own migration.**
  Mid-TDD an `Edit` call used `/Users/chris/development/pi/pi-permission-model-judge/test/model-review.test.ts` — the `pi-packages/packages/` prefix dropped.
  The `model-judge` link denied it with "Dropped `pi-packages/packages/` prefix.
  The correct path is …", which is precisely the typo class the package exists to catch.
  The dogfooding loop closed on itself during the change that rewrote its registration.
- **Both sides of a clarification gate were measured, not estimated.**
  When the size criterion failed, the inline-narrowing alternative was written to a scratch file and counted (`105`) rather than guessed, so the gate offered two measured numbers against a measured baseline (`106`) instead of an argument.
- **The plan predicted the shape of its own red.**
  It called the red "behavioral, not just a type error" — esbuild strips types, so the unchanged `tryRegister()` would call the zero-arg accessor against `27.0.0` and get `undefined`.
  That is exactly what happened, with a single `PI_PERMISSION_SYSTEM_WARN0001` in the output as corroboration.
- **The Tidy-First assessor reasoned from the plan's constraints, not just the code.**
  It declined to extract a `register()` helper in `src/extension.ts` on the grounds that ADR 0012's size mandate would require un-extracting it — a rejection that cited the change's own acceptance criterion.
- **A refuted prediction became a durable record.**
  ADR 0012 decision 7 named this package "the contract's proof"; the proof did not land, and `726a6e30` amended the ADR beside its existing #794 amendment rather than leaving a reader to falsify it from git history.

#### What caused friction (agent side)

- `instruction-violation` (self-identified) — the issue close comment contained a **fabricated SHA**.
  `git rev-parse` ran for three of the five hashes; drafting then introduced two more (`de745e22`, `726a6e30`) that were never resolved, and one of them was invented past its eighth character.
  Impact: a wrong hash published to a public issue, plus a permanent correction comment.
  This is the exact failure `AGENTS.md` already names — "including the second and third hash cited mid-draft, which is where the invention happens" — so the rule's presence was not the gap; its *timing* was.
  Resolving before drafting cannot cover a hash that drafting itself introduces.
- `other` (silent structural corruption) — inserting the vacancy `describe` block mid-file closed the enclosing `describe` early and reparented three existing tests under the new heading.
  Impact: two extra tool calls and a corrective `Edit`.
  Notable because **no automated gate detected it**: `pnpm run check`, `pnpm run lint`, and the full suite all stayed green, since the reparented tests still ran.
  Only a structural `grep -n '^describe\|^});'` surfaced it.
- `missing-context` (plan-time) — the plan verified the *targeted* API against the published `27.0.0` tarball but not the rest of the type surface the package consumes.
  The bump also made `PromptPermissionDetails.payload` required and removed `message` (pi-permission-system #746), breaking three fixture sites.
  Impact: an unplanned shared fixture (`test/fixtures/permission-details.ts`) and roughly six extra tool calls mid-cycle, folded into the same commit.
  A six-major bump was treated as an accessor change.
- `other` (incomplete multi-edit) — removing `sessionStarted` left a dangling `sessionStarted = true;` assignment, so every test failed with a `ReferenceError`.
  Impact: one extra edit cycle; caught immediately by the test run, which is the feedback loop working.
- `instruction-violation` (tool-caught, no rework) — an `npm view` call in a planning-stage pipeline was blocked by the repo's pnpm guard, and an `Edit` path missing the `packages/` prefix was blocked by the permission gate.
  Impact: one retry each.
  Both guards fired exactly as designed; recorded as evidence they work, not as a rule gap.

#### What caused friction (user side)

- Nothing blocking.
  Both clarification gates (the size criterion, and the post-review disposition of the ADR amendment and mock typings) were answered decisively and reversed a plan Non-Goal on sound grounds — recording a refuted prediction is not the status-board use #787 ruled out.
- One opportunity: the operator's answer to fix the mock typings "now" arrived after the pre-completion review, so it landed as a post-review commit that forced a re-dispatch.
  Surfacing pre-existing test-hygiene debt at the Tidy-First gate instead would have folded it into the preparatory commit.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5`; `/ship-issue` ran on `anthropic/claude-sonnet-5`; this retrospective on `anthropic/claude-opus-5`.
  All three subagents (`tidy-first-assessor`, `pre-completion-reviewer` ×2) ran on `anthropic/claude-sonnet-5` per their frontmatter — appropriate for read-only review and assessment, and the reviewer's WARN findings were both substantive.
  The session's one published error (the fabricated SHA) fell in the sonnet-5 ship stage, while the judgment-heavy gates ran on opus-5.
  One incident is not evidence for a model policy, but the correlation is worth watching: ship looks mechanical and is in fact the stage that writes to permanent public artifacts.
- **Escalation-delay tracking** — no `rabbit-hole` friction points; the longest run on a single error was three consecutive tool calls (the reparented `describe`).
  No subagent escalation was warranted.
- **Feedback-loop gap analysis** — verification ran incrementally and caught two of three defects at the point of introduction: `pnpm run check` immediately after the test-file rewrite (surfacing the `payload`/`message` breakage) and the package suite immediately after each `src/` edit (surfacing the dangling `sessionStarted`).
  The gap is the third: no gate in this repo detects a reparented block, so structural verification of a mid-file insertion has to be manual.
- **Unused-tool detection** — for the plan-time `missing-context`, no subagent was needed; the tarball was already fetched, and a wider `grep` over the package's imports from that dependency would have caught it.

### Changes made

1. `.pi/prompts/ship-issue.md` — added a post-draft SHA verification pass to the close-comment step: extract every hex token from the finished body and re-resolve each, because a pre-draft resolve cannot cover a hash drafting itself introduced.
2. `AGENTS.md` (§ Edit tool batches) — added the reparented-sibling-block hazard: a mid-file `describe`/function insertion can close the enclosing block early, and no gate detects it.
3. Filed #796 — schedule the process-root slot's removal.
   The operator asked whether the arc had left follow-ups behind; a sweep of the #786 / #787 / #789 / #794 plans and ADR 0012 found one whose trigger had just fired.
   ADR 0012 decision 7 deferred the removal "contingent on downstream migration", and the #794 plan named #788 as the only known downstream.
   Verified before filing: zero references to `getRootPermissionsService` outside `pi-permission-system`, no production caller inside it, and the slot still written on every non-child `session_start`.
   The `roadmap-fit` skill exited at Step 1 — `pi-permission-system` has no open improvement phase, so no disposition was recorded.

Declined: broadening `/plan-issue`'s published-API verification to the whole consumed type surface on a cross-major dependency bump.
The `PromptPermissionDetails` breakage that motivated it cost about six tool calls and was caught by `pnpm run check` at the first cycle, so the rule was not judged to earn its permanent place.

The other arc leftovers were checked and correctly left unfiled, each gated on a named demand signal: machine-readable duplicate-error codes (ADR 0012 decision 4), the `AgentPrepHandler` rename and debug-logging the latch emission (#787 plan), and #788's own two Open Questions.
ADR 0012's parked "requester-context facts-widening" extension is also unfiled; nothing is blocked on it.

### Follow-up candidate (not implemented)

An **expired deferral has no reader**.
A condition-gated Open Question in a shipped plan ("deferred until X migrates") becomes actionable the moment X lands, but `/triage-backlog` ranks the filed backlog: Step 2 gathers state from `gh issue list` / `gh pr list`, Step 1 reads plans only for their `**Release:**` marker, its read list omits `docs/decisions/`, and Step 8's keystone detection needs filed dependants to converge from — #796 had zero.
This is the same dead-letter shape #787 fixed for tidyings by pairing a written destination with a reader that greps it.
Worth an issue if a second expired deferral goes unnoticed.
