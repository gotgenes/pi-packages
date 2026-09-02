---
issue: 815
issue_title: "pi-permission-system: bash tool hidden entirely when surface catch-all is deny, even with more permissive nested patterns"
---

# Retro: #815 — bash tool hidden entirely when surface catch-all is deny

## Stage: Planning (2026-09-02T06:45:43Z)

### Session summary

Reproduced the third-party report with a throwaway spike against an in-memory `PermissionManager`, confirmed it is not bash-specific (every per-tool path map with a `deny` catch-all is hidden too), and found that `docs/configuration.md`'s own `Restricted Bash Surface` recipe is broken by it.
The operator's gate settled all three open choices: fix it, add a separate `isToolFullyDenied` predicate published cross-extension (leaving `getToolPermission` semantics untouched), and compute reachability with an ordering-aware pattern probe.
Plan committed at `packages/pi-permission-system/docs/plans/0815-reachable-non-deny-tool-exposure.md` — six steps, two of them Tidy-First preparations.

### Observations

- The spike measured three cases that drove the design.
  `bash: {"*":"deny","git *":"ask"}` hides Bash while the gate would answer `ask` for `git status`; `bash: {"git *":"ask","*":"deny"}` is correctly fully denied because last-match-wins shadows the exception; `read: {"*":"deny","~/notes/*":"allow"}` hides `read`.
  The second case is what rules out the cheap "does any non-deny rule exist on this surface" scan, and it is the reason the plan probes through `evaluate` rather than scanning rule actions.
- A non-obvious defect found only by spiking: `compileWildcardPattern` runs `expandHomePath` on the **pattern** side only, so probing with the raw pattern text makes a `~/notes/*` rule fail to match itself and the probe wrongly reports fully-denied.
  The candidate must be home-expanded to mirror the compile step.
  Verified the self-match invariant across eleven pattern shapes.
- `permission["*"]` composes as a `layer: "default"` rule that `getComposedConfigRules()` filters out, so an early spike using the display accessor gave a wrong answer.
  The probe must read `resolvePermissions().composedRules`, the same list `getToolPermission` uses.
- Placement was decided on the `code-design` "shared predicate, different burden of proof" heuristic: `getToolPermission` is a classifier ("what does the catch-all say?"), exposure is a guard ("is every invocation denied?"), and reusing the first as the second is the whole defect.
  Rejected alternative: redefining `getToolPermission` as "least restrictive reachable state" — it fixes every consumer at once but also changes the answer for configs that work today (`bash: {"*":"ask","git *":"allow"}` would report `allow`), which is a cross-extension behavior change on a published method.
- Deliberately kept off `PermissionQuery` (the narrow view handed to `Authorizer` chain links) per ISP — tool pre-filtering is a `PermissionsService` use, and no link needs it.
- `linkWorkspacePackages: false` means `packages/pi-permission-model-judge` resolves the **published** `@gotgenes/pi-permission-system@27.0.0`, so its `makeService` fake is not broken by the new interface member and this stays a single-package plan.
- The Tidy-First assessor found two exact-duplicate mock literals that the change's two new required interface members would otherwise force into two and three places; both became steps 1 and 2.
  It also verified every file/line pointer in the design summary against the real files with no contradictions.

#### Deferred tidyings

- `packages/pi-permission-system/src/rule.ts:143` — a stale duplicate doc comment on `evaluateMostRestrictive` describing a different function (also flagged by the Phase 14 craftsmanship scout); in a file this change touches, but not at its insertion point, so the assessor declined it as scope creep.
- `packages/pi-permission-system/test/helpers/authorizer-fixtures.ts` and `test/authority/{authorizer-chain,delegation-envelope,forwarded-request-server}.test.ts` — the narrow `PermissionQuery` mock (`{ checkPermission, getToolPermission }`) is hand-rolled in four places; untouched by this change because `PermissionQuery` deliberately does not gain the new member.
