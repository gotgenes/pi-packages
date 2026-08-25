---
issue: 806
issue_title: "pi-permission-system: add the read/write capability axis to the path surfaces"
---

# Retro: #806 — pi-permission-system: add the read/write capability axis to the path surfaces

## Stage: Planning (2026-08-25T04:42:53Z)

### Session summary

Planned Phase 14 Step 1 — the four directional path surfaces, load-time sugar expansion, and the delegation-envelope family conversion — as `docs/plans/0806-directional-path-surfaces.md`.
Four clarification gates settled the axis semantics, the fold site, and the schema shape; the operator's opening question ("why would we let something write that couldn't read?") reframed the first gate entirely and is what produced the plan's grant guidance.
Filed [#808] for the schema asymmetry the change leaves behind, and the operator adopted it as Phase 14 Step 9 rather than deferring it.

### Observations

**The plan diverges from the issue body and the roadmap on the central structural question, deliberately.**
Both say the four path gates route an access to its directional surfaces and fold "consult both" themselves.
Tracing the readers of a `path`-surface query found three the roadmap's Target line had not: `LocalPermissionsService.checkPermission`, the `PermissionQuery` injected into every authorizer link, and — the load-bearing one — `ServingPolicy.resolve`, the recorded-authority view a serving node resolves a **forwarded child request** against.
Once sugar expansion empties the bare surfaces, a serving node that does not fold the family stops hard-denying a child request the parent's `path` config denies and escalates it to an approvable prompt instead: the [#712] defect class.
So the fold lands in `PermissionResolver.resolve`, the one entry point all of them share, and both bash gates need no diff at all.

**My first framing of that argument was wrong in my own favour, and the operator's push-back is what corrected it.**
I led with `PermissionQuery` gate parity (ADR 0007 §3).
Asked who actually consumes it, the answer was **nobody**: our own `pi-permission-model-judge` explicitly ignores the injected query (`async (details, _query, log)`), and [#620] says in its own body that the query "has no consumer yet".
I had also claimed the change keeps 3434 lines of manager tests green; the measured number is **11** query sites in that file and 100 across all of `test/`.
The recommendation survived, but on the forwarded-serving argument rather than the two I opened with.
Lesson worth carrying: when a recommendation has three supporting legs, price each one before leading with the most rhetorically convenient.

**The axis-model question was not in my gate set and should have been.**
I opened with `edit`'s direction, the fold site, and the schema shape — all downstream of an unasked question: are `path_read` / `path_write` independent bits or ordered tiers?
The operator asked it directly.
The answer (independent bits, per ADR 0013 §2/§6, Landlock, and POSIX) is what the ADR already implies, but the alternative was live enough that a tiers reading would have changed the gate routing, the fold semantics, and the docs.
Naming the trap it dissolves — a write access attributed as read+write has its explicit `*_write: allow` voided by the sugar's read `ask` under most-restrictive composition — was what made the two models comparable.

**The most useful output of that gate was not the mechanism but the grant guidance.**
The operator's follow-up — "rarely will the user want `path_write`; they will want `path`; `path_read` is basically read-only" — is the correct reading and is now doc material: the useful *grants* are `*_read: allow` and the bare sugar key, while `*_write` earns its keep as a *restriction* (`path_write: {"**": "deny"}` is a read-only-agent posture).
That framing did not exist in ADR 0013 or the roadmap.

**Two roadmap-assigned tidy-first commits lost their justification and one was dropped.**
The roadmap assigned `selectUncoveredPathCandidates` extraction in `bash-path.ts` to this step on the grounds that it "shrinks the diff this change has to make".
Under the resolver-fold design `bash-path.ts` has **zero** diff, so Tidy First's own rule (tidy the code you are about to change) excludes it; it is left for [#807], which rewrites that file for per-token effects.
The stale duplicate doc comment at `rule.ts:143` is kept as cycle 2, but flagged in the plan as roadmap-honoring rather than change-scoped, since `rule.ts` is otherwise untouched.
A third, genuinely change-scoped prep commit was added instead: relocating `pickMostRestrictive` out of `handlers/gates/` so the core-layer resolver can use it.

**Two claims were spiked rather than asserted.**
`z.object().catchall()` was run against the installed zod to confirm it emits `properties` + `additionalProperties` and that a `.refine()` both rejects a misspelled directional key and still serializes — including the small regression that the catchall form drops the record form's `propertyNames: {minLength: 1}`.
Separately, `pattern-suggest.ts` looked like an obvious touch point and is not: its `path` / `external_directory` label arms are unreachable from the path gates, verified by tracing both callers.
The plan records it as a verified non-touch-point so implementation does not rediscover it.

**Cycle 4 is deliberately atomic and large.**
Sugar expansion and the family fold are mutually dependent — expansion alone empties every surface a query names, the fold alone folds surfaces no rule occupies — and ADR 0013 §4's ordering constraint pulls the delegation-envelope conversion in with them.
The intermediate state between cycles 4 and 5 is strictly more restrictive than the final one (every path access folds both directions until tool routing lands), which is the safe direction and invisible within one release.

## Stage: Implementation — TDD (2026-08-25T05:47:20Z)

### Session summary

Executed all seven TDD cycles plus one post-review fixup, landing the four directional path surfaces, load-time sugar expansion, the resolver's surface-family fold, tool-identity direction routing, the named schema keys with two loader refinements, and the docs.
Test count went 3233 → 3337 (+104).
The pre-completion reviewer returned WARN on the first pass and PASS on the re-review after its findings were addressed.

### Observations

**The Tidy-First assessor's most valuable output was not a tidying but a scope correction.**
It found no preparatory work beyond the plan's own cycles 1–2 — and then reported that the plan's cycle 2 was anchored on the wrong function, and that its test-impact estimate was off by an order of magnitude.
Both were right.
The stale comment was not above `evaluateAnyValue` (which has exactly one, correct comment); it was `evaluateFirst`'s own doc comment stranded above `evaluateMostRestrictive`, with `evaluateFirst` left undocumented.
So the commit **moved** it back rather than deleting it — deleting would have stripped documentation the codebase already had.
Worth carrying: a null "no tidying warranted" verdict is not a null result, and reading what the assessor verified on the way past is where its value was.

**The plan's "11 direct query sites" undercounted because its measuring grep could not see a default parameter.**
The baseline was `grep -rhoE 'surface: "(path|external_directory)"' test`, which matches object literals only.
`permission-manager-unified.test.ts`'s `checkPath` / `checkPathValues` helpers carry `surface = "path"` as a **default parameter**, so dozens of call sites that pass no surface at all were invisible to it.
Measured reality: 36 failing tests in that file, 7 in `session-rules.test.ts`, 2 in the unlisted `test/path/approval-pattern.test.ts`, and 31 across four handler files.
The general lesson matches the existing testing-skill rule about grepping the bare callee rather than a literal-argument pattern — a default parameter is the same blind spot one level further in.

**The migration split cleanly into two kinds, and conflating them would have been the mistake.**
A test that queries `PermissionManager` **directly** sits below the resolver's fold, so it must name a directional surface; those were renamed (`checkPath`'s default became `path_read`), and since a bare `path:` config expands onto both members every assertion is unchanged.
A test that declares *policy* through a fixture double should keep saying "external directory is denied" without caring about the axis; those were fixed at the **fixture**, by teaching `makeSurfaceCheck`, `makeExtDirDedupCheck`, and `findExtDirDecision` that a family key answers for its members — which models sugar expansion rather than restating it in 31 tests.
Getting this split right is what kept the diff at 119 insertions in the largest file instead of a rewrite.

**The riskiest bulk edit was safe for a reason worth stating.**
`AGENTS.md` warns that a scripted test rename cannot tell a mock producer from an assertion.
Here it could not go wrong, because producer and assertion had to *agree* on the surface name and moved within the same hunk — and because the file has zero `toMatchObject`/`objectContaining` sites, so nothing could absorb a wrong rename and stay green.
I verified that property before running the script rather than after.
The config keys stayed bare (`path: {`, unquoted) while the renames targeted quoted string literals, so the two populations were syntactically distinguishable.

**The plan's cycle-4 atomicity claim held under pressure, and cycle 5's ordering mattered.**
Expansion and the fold genuinely cannot land apart — the first empties every surface a query names, the second folds surfaces no rule occupies.
The delegation-envelope conversion rode with them per ADR 0013 §4, and cycle 5 (the first commit where a gate emits a directional surface) came strictly after, so a directional key never reached an authorizer link ahead of the family conversion.

**Two production defects surfaced only because the schema conversion changed a type's shape.**
`z.object().catchall()` makes the four named properties optional, so `FlatPermissionConfig[string]` gained `| undefined` — which `expandDirectionalSugar` had to absorb (`NonNullable` on the local alias, plus an explicit skip for a key present with an undefined value).
Neither was caught by tests; both were caught by `pnpm run check` immediately after the cycle, which is exactly why the template runs it before committing a shared-type change.

**The example config had no validation guard at all, which the new refinement made dangerous.**
Nothing in `test/` or `scripts/` parsed `config/config.example.json`.
That was survivable while the schema was a permissive record; with a refinement that rejects a misspelled directional key, a stale example would have shipped a config the loader refuses.
Added a test that validates it against `unifiedConfigSchema`.

**The pre-completion reviewer found a citation that could not be true, and fixing it was cheap.**
The plan pinned invariant 2 (#712, a deny is never masked into an approvable ask) on "the forwarded-deny test in `test/authority/forwarded-request-server.test.ts`" — but every test in that file stubs `policy: { resolve: vi.fn(...) }`, so none of them exercises the real `ServingPolicy` → `PermissionResolver` composition, and the file has zero diff.
The invariant is the plan's own load-bearing argument for putting the fold at the resolver, so an unpinned version of it was the worst gap to leave.
Added a `describe` block that rebuilds the real wiring (`buildResolvedIntentFromMatchValues` + a `PermissionResolver` over a filesystem-backed manager) and pins the deny, the one-direction deny, the already-directional passthrough, and the #58 no-pattern case.

**Authoring that test caught an unrealistic fixture through a red that was too green.**
My first version used `matchValues: ["~/.ssh/id_rsa"]` against a `~/.ssh/*` config and got `allow`, not `deny`.
The cause is pre-existing and correct: a raw tilde-spelled *value* does not match a tilde pattern, because a real child sends `AccessPath.matchValues()`, which carries the expanded absolute form.
The fixture, not the code, was wrong.
The re-review then narrowed it further — an out-of-cwd absolute path has no cwd-relative alias, so `matchValues()` yields exactly one entry, and the second element I had written was inert.

**Two doc claims were overstated in three places each, and one metric row had to be rewritten rather than satisfied.**
"Both bash path gates needed no diff at all" is true of their *routing* and of `bash-external-directory.ts`, but `bash-path.ts` does change — `PathAskFacts.surface` became required, so it must name the bare family on the ask payload.
Separately, the roadmap's `Directional surfaces in PATH_SURFACES` metric grepped for the four literal names, and the delivered design derives them from a family set plus a suffix list so each is spelled exactly once — making the row structurally unmeasurable, not merely unmet.
The roadmap anticipated this exact case ("must either use the roadmap's name or update the metric row in the same commit"), so the row and its recompute command were rewritten to measure the vocabulary that generates the names, with a note explaining why a literal count reads zero.

**Deliberate non-actions, both endorsed on re-review.**
Invariant 5's win32 case landed in `test/path/approval-pattern.test.ts` rather than the plan-named `test/rule.test.ts`; it routes through the same `pathMatchOptions`/`PATH_SURFACES` path, so a second case would be redundant.
And the plan file keeps its two inaccurate test citations (lines 291, 299) — a plan is a point-in-time artifact, and the accurate durable claims now live in the architecture doc's `Landed:` note and the package skill.

**Pre-completion reviewer: WARN, then PASS.**
First pass raised four findings — the missing #712 pin, the "no diff at all" overstatement, an orphaned line-break artifact in `delegation-envelope.ts`'s docblock, and the invariant-5 file placement.
The first three were fixed in `b8090e3f`; the fourth was declined with reasons.
Re-review returned PASS with one non-blocking fixture-realism nit, which was folded into the same commit.

#### Deferred tidyings

- `test/permission-manager-unified.test.ts` (3,434 lines) — the assessor declined a file split as unrelated to making this change easy; real craftsmanship debt for `/plan-improvements`.
- `src/permission-manager.ts` + `src/authority/delegation-envelope.ts` — `SPECIAL_PERMISSION_KEYS` and `DELEGATION_EXCLUDED_SURFACES` are both `{"path", "external_directory"}` today; the assessor declined consolidating them because the plan deliberately keeps the two concerns separable ([#620], [#684] must stay independently landable).

[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#684]: https://github.com/gotgenes/pi-packages/pull/684
[#712]: https://github.com/gotgenes/pi-packages/issues/712
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#808]: https://github.com/gotgenes/pi-packages/issues/808
