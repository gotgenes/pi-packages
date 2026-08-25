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

[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#712]: https://github.com/gotgenes/pi-packages/issues/712
[#807]: https://github.com/gotgenes/pi-packages/issues/807
[#808]: https://github.com/gotgenes/pi-packages/issues/808
