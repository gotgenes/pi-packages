---
issue: 699
issue_title: "pi-permission-system: Sibling authorizer extensions cannot detect registered child sessions → spurious \"already registered\" on every subagent start"
---

# Retro: #699 — Session-keyed service publication and the vacant link cell

## Stage: Planning (2026-08-21T03:44:04Z)

### Session summary

Planned the implementation of ADR 0012 decisions 2 and 4 (plus decision 7's accessor deprecation) as `docs/plans/0699-session-keyed-service-publication.md`.
The issue is third-party ([`kuoruan`](https://github.com/kuoruan)) but was re-scoped by the operator's own close-out comment after [#786] settled the contract, so the ADR — not the issue body's Option A/B/C — was the spec; the reporter's exported-detector and typed-error proposals are recorded as superseded in Non-Goals.
Four open design parameters the ADR deliberately left as implementation details were settled at one `ask_user` gate, and the plan is eight TDD cycles ending in a docs commit.

### Observations

- Gate outcomes (all four took the recommended option): a distinct `getPermissionsServiceForSession(sessionId)` name rather than an overload of `getPermissionsService` (so the whole zero-arg function carries `@deprecated` and `string | undefined` cannot slip onto the deprecated path); `PermissionsReadyEvent.sessionId: string | null` (matching `ForwardedPromptContext.requesterSessionId` and this package's existing defensive `getSessionId()` read); the review event named `authorizer_link_vacant`; and minimal doc-correctness edits here with the `cross-extension-api.md` rewrite left to [#789].
- Release is deliberately deferred: ADR 0012 decision 7 stages the keyed channel, the latch ([#787]), and the docs as **one minor**, so the plan's `Release:` marker is `mid-batch — defer`.
  This package has no open improvement phase, so no roadmap tag governs it — the batch is the ADR's staging.
- Two planning-time discoveries the ADR did not name, both now touch points: `scripts/verify-public-types.sh` greps `dist/public.d.ts` for an explicit symbol list (CI-gated), and `makeCtx` in `test/helpers/handler-fixtures.ts` has `getSessionDir` but **no** `getSessionId` — every lifecycle test would otherwise resolve `sessionId: null` and quietly skip the keyed publish.
- Structural choice worth flagging for implementation: decision 4 is a decorator (`ObservedAuthorizerRegistrar`) over the existing `AuthorizerRegistrar` seam rather than a change to `AuthorizerRegistry` or `LocalPermissionsService`, so throw-on-duplicate stays untouched and the vacancy record is written only after a successful registration.
- `PermissionServiceLifecycle` reaches five collaborators with the new `AdjudicationRole` seam — at the design-review width limit.
  The checklist was run; the two boolean seams answer different questions (may this node own the root slot / does this node's chain run), so no bundling abstraction was introduced.
  A sixth should trigger a re-review.
- The `AdjudicationRole` answer must come from `AuthorizerSelection`, never re-derived from `detection.isSubagent(ctx)` — `selectAuthorizer` tests `hasUI` first, so a subagent with its own UI adjudicates locally.
- No new issues filed: every follow-up the plan names already exists ([#787], [#788], [#789]), and PR [#702] is a close-at-ship target rather than a work item.
  `roadmap-fit` therefore had nothing to evaluate.

[#702]: https://github.com/gotgenes/pi-packages/pull/702
[#786]: https://github.com/gotgenes/pi-packages/issues/786
[#787]: https://github.com/gotgenes/pi-packages/issues/787
[#788]: https://github.com/gotgenes/pi-packages/issues/788
[#789]: https://github.com/gotgenes/pi-packages/issues/789

## Stage: Implementation — TDD (2026-08-21T04:17:33Z)

### Session summary

All eight planned TDD cycles landed in plan order, plus one follow-up commit closing the reviewer's two non-blocking notes: every node now publishes its `PermissionsService` under its own session id, `permissions:ready` carries `sessionId` and `adjudicatesLocally`, a link registered on a relaying node is accepted and recorded as `authorizer_link_vacant`, and the zero-arg `getPermissionsService()` emits a once-guarded `DeprecationWarning`.
The pi-permission-system suite went 3173 → 3216 tests (146 files); `check`, root `lint`, full `test`, and `fallow dead-code` are green, and `verify:public-types` packs the three new exports.
Pre-completion reviewer: PASS (re-confirmed after the follow-up commit).

### Observations

- The Tidy-First assessor found **no** preparatory work warranted, and its reasoning held up: `SelectedAuthority.adjudicatesLocally` already existed, the composition-root ctx builders already threaded a real session id, and `index.ts` already constructed `authorizerSelection` before `permissionsService`, so the decorator wiring was a same-order insertion.
- Two deviations from the plan, both discovered only by `tsc`/`eslint`, never by a failing test:
  - `index.ts` needed an explicit `const permissionsService: PermissionsService = …` annotation.
    The new decorator closes the loop (`authorizerSelection` → `getPermissionQuery` thunk → `permissionsService` → `ObservedAuthorizerRegistrar(authorizerSelection)`), which `tsc` reports as `TS7022`/`TS7023` implicit-any.
    The reviewer independently reproduced the failure without the annotation, so it is load-bearing, not decoration.
  - Marking `getPermissionsService` `@deprecated` turned `@typescript-eslint/no-deprecated` into 37 lint errors across this package's own two accessor test files.
    Resolved with file-level disables plus a reason — those cases exist to pin the legacy path the deprecation window deliberately preserves.
    Worth anticipating in any future plan that deprecates a symbol this repo's own tests exercise.
- `test/authority/subagent-context.test.ts` needed no edit after `readSessionId` was extracted — the existing cases still cover the delegated read through `isRegisteredSubagentChild`.
- The quiet-defect proof (a child-registered `ToolAccessExtractor` gating that child's own tool call) was written after its mechanism was green, so it was checked for vacuity by spiking the registration out: the tool call then goes unblocked, confirming the probe discriminates.
- Reviewer's two non-blocking notes were both taken rather than deferred: the composition-root ready-ordering guard now also asserts the payload's own `sessionId` resolves inside the handler (the plan's Invariants table named that test, and the mechanism had only been pinned at unit level), and the `PermissionsService` doc comment now names the keyed locator instead of only the deprecated accessor.
- Doc scope held to the planning gate's decision: correctness edits at the four prescription sites (`configuration.md`, `README.md`, the frontmatter guide, `cross-extension-api.md`'s Quick Start / How It Works / channel table / Ready Event) plus the architecture doc and the package skill.
  The wholesale `cross-extension-api.md` rewrite stays with [#789], and the ready latch stays with [#787].
- Release remains **mid-batch — defer**: this must ship as one minor with [#787], so `/ship-issue` should leave the release-please PR unmerged.
  PR [#702] is a close-as-superseded target at ship time.
