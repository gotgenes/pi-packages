---
issue: 598
issue_title: "pi-permission-system: Authorizer chain infrastructure (allow/deny/defer verdicts)"
---

# Authorizer chain infrastructure (allow/deny/defer verdicts)

## Release Recommendation

**Release:** mid-batch — defer (batch "authorizer-chain"); confirm at ship time

This is Step 4 of the Phase 12 roadmap (Track B — the Authorizer chain) and the head of the two-step release batch "authorizer-chain" whose tail is Step 5 ([#599]).
The roadmap's `Release batches` subsection lists Steps 4 and 5 shipping together with Step 5 as the tail, so Step 4 lands on `main` and its release-please PR stays open until Step 5 ships.
The work is refactor-only (`refactor:`/`test:` commits are `hidden: true` and do not cut a release), with one `docs:` step-completion commit that will appear in the pending release PR but must not be merged until the batch tail.

## Problem Statement

The Phase 9 spine selects exactly one terminal `Authorizer` per session activation (`LocalUserAuthorizer`, `ParentAuthorizer`, or `DenyingAuthorizer`), each of which must decide.
That shape is closed against a link that reviews an `ask` and passes it on — the structural reason a case-by-case model judge ([#472]) has had no home since the spine was built.
ADR 0007 (`docs/decisions/0007-model-judge-authorizer-chain-adr.md`, accepted) settles the design: model the live-authority layer as a Chain of Responsibility whose links return `allow | deny | defer`, ending at a terminal that cannot defer.

This issue is the infrastructure step: introduce the verdict type and the chain composition, refactor `selectAuthorizer` into the terminal-selection step of the chain, and register **zero** links — so behavior is identical to today, pinned by the existing authorizer-selection tests.
The chain seam exists for Step 5 ([#599]) to expose via `registerAuthorizer`.

## Goals

- Introduce `AuthorizerVerdict` (`allow | deny | defer`), with `deny` carrying an optional teaching `reason`, in `src/authority/authorizer.ts`.
- Reshape the interface vocabulary to match ADR 0007: `Authorizer` becomes the **non-terminal** chain link (returns `AuthorizerVerdict`); a new `TerminalAuthorizer` is the terminal (always decides, returns `PermissionPromptDecision`).
- Add `composeAuthorizerChain(links, terminal)` in a new `src/authority/authorizer-chain.ts`: registered non-terminal links first, then the context-selected terminal; the terminal-cannot-defer invariant is enforced at the **type level**.
- Route `AuthorizerSelection.activate` through `composeAuthorizerChain([], terminal)` so the chain seam is live with an empty link list.
- Preserve behavior exactly: with zero registered links the composed chain is the selected terminal, pinned by the existing `authorizer.test.ts` and `authorizer-selection.test.ts`.

This change is **not breaking**: no observable behavior, output shape, config, or default changes on upgrade.

## Non-Goals

- The `registerAuthorizer` service method, the `authorizerChain` config field, and the bounded-delegation enforcement checkpoint — those are Step 5 ([#599]).
- The `PermissionQuery` injection into a link's `authorize` — ADR 0007 §3 ties it to the registration seam; a Step-4 link signature takes only `PromptPermissionDetails` (no link exists yet to consume a query).
  Deferred to Step 5.
- The first-party dogfood link (`@gotgenes/pi-permission-model-judge`) — Step 6 ([#600]).
- Collapsing the terminal's return to ADR 0007's illustrative minimal `TerminalVerdict` (`{ kind: "allow" } | { kind: "deny"; reason? }`).
  The terminal keeps returning the rich `PermissionPromptDecision` (session-scope states, `confirmationUnavailable`, `denialReason`), which is what preserves behavior; the ADR sketch is explicitly illustrative ("the essentials follow").
- Moving `selectAuthorizer` out of `authorizer.ts` into `authorizer-selection.ts`.
  It stays in `authorizer.ts`; only its return type changes. (The issue's phrasing "`authorizer-selection.ts` — `selectAuthorizer` becomes the terminal-selection step" refers to the selection concern, not a file relocation.)

## Background

Relevant modules (all under `src/authority/`):

- `authorizer.ts` — currently declares the `Authorizer` interface (`authorize(details): Promise<PermissionPromptDecision>`), `AuthorizerSelectionDeps`, and `selectAuthorizer(ctx, deps): Authorizer` (the once-per-activation `hasUI` / `isSubagent` / deny dispatch).
- `local-user-authorizer.ts`, `denying-authorizer.ts`, `approval-escalator.ts` (`ParentAuthorizer`) — the three concrete terminals, each `implements Authorizer`, each returning `PermissionPromptDecision`.
- `authorizer-selection.ts` — `AuthorizerSelection` (the `AskEscalator` implementation): `activate(ctx)` runs `selectAuthorizer` and stores the result in `selected`; `escalate(details)` delegates to `prompter.prompt(this.selected, details)`.
- `permission-prompter.ts` — `PermissionPrompterApi.prompt(authorizer: Authorizer, details)` brackets the review-log entries around `authorizer.authorize(details)` and returns its `PermissionPromptDecision`.
- `permission-dialog.ts` — `PermissionPromptDecision` type plus `createDeniedPermissionDecision(reason?)` (maps a reason to `denied_with_reason` / `denied`), reused by the chain's verdict→decision mapping.

AGENTS.md constraints that apply:

- Architecture-doc module-tree entries describe **current behavior**; cite an issue only for an active constraint.
  The reshape updates the `authorizer.ts` tree entry's signature and adds an `authorizer-chain.ts` entry.
- The package skill's rule: mark the completed roadmap step `✅` (heading + Mermaid node) in the implementation doc-update commit, not a deferred ship commit.
- `refactor:`/`test:` commits are `hidden: true`; an unhidden `docs:` commit is release-visible but, mid-batch, its release-please PR is not merged until the batch tail.

## Design Overview

### Verdict type and the two interfaces

`src/authority/authorizer.ts` gains the verdict union and splits the interface into non-terminal and terminal per ADR 0007 §2:

```typescript
/** A non-terminal chain link's ruling: decide (allow/deny) or pass on (defer). */
export type AuthorizerVerdict =
  | { kind: "allow" }
  | { kind: "deny"; reason?: string }
  | { kind: "defer" };

/** A non-terminal chain link: reviews an ask and may decide or defer. */
export interface Authorizer {
  authorize(details: PromptPermissionDetails): Promise<AuthorizerVerdict>;
}

/** The terminal link: structurally cannot defer — always returns a full decision. */
export interface TerminalAuthorizer {
  authorize(details: PromptPermissionDetails): Promise<PermissionPromptDecision>;
}
```

The terminal-cannot-defer invariant is **type-level**: a `TerminalAuthorizer` returns `PermissionPromptDecision` (which always carries `approved: boolean` — it cannot express "defer"), while a deferring link returns `AuthorizerVerdict`.
`composeAuthorizerChain`'s signature (below) accepts links as `Authorizer[]` and the terminal as `TerminalAuthorizer`, so a deferring link cannot occupy the terminal slot — the compiler rejects it.

The three concrete terminals (`LocalUserAuthorizer`, `DenyingAuthorizer`, `ParentAuthorizer`) change `implements Authorizer` → `implements TerminalAuthorizer`; their bodies are unchanged (they already return `PermissionPromptDecision`).
`selectAuthorizer`'s return type changes `Authorizer` → `TerminalAuthorizer`.
`PermissionPrompterApi.prompt` and `AuthorizerSelection.selected` retype to `TerminalAuthorizer`.

### The chain composition

`src/authority/authorizer-chain.ts` (new) folds the links ahead of the terminal:

```typescript
export function composeAuthorizerChain(
  links: readonly Authorizer[],
  terminal: TerminalAuthorizer,
): TerminalAuthorizer {
  if (links.length === 0) {
    return terminal; // identity: zero links ⇒ behavior is the terminal's
  }
  return {
    async authorize(details) {
      for (const link of links) {
        const verdict = await link.authorize(details);
        if (verdict.kind === "allow") {
          return { approved: true, state: "approved" };
        }
        if (verdict.kind === "deny") {
          return createDeniedPermissionDecision(verdict.reason);
        }
        // defer → try the next link
      }
      return terminal.authorize(details);
    },
  };
}
```

The composite is a `TerminalAuthorizer` — it always decides, because the terminal always decides.
The verdict→decision mapping is the seam Step 5 exercises with real links:

- `allow` → `{ approved: true, state: "approved" }` — a link grant is **non-persistent** (state `approved`, never `approved_for_session`), matching ADR 0007's off-by-default, non-persistence envelope.
- `deny` → `createDeniedPermissionDecision(reason)` → `denied_with_reason` when a reason is present, else `denied` — carrying the teaching signal use case 1 needs.
- `defer` → the next link, then the terminal.

The `links.length === 0` short-circuit returning the terminal **identity** is a behavioral invariant, not an optimization: `authorizer-selection.test.ts` asserts `prompter.prompt` is called with `expect.any(LocalUserAuthorizer)`, which only holds if the composed value **is** the selected terminal instance when links are empty.

The extracted module's upstream interaction is minimal and Tell-Don't-Ask-clean: it imports the `Authorizer` / `TerminalAuthorizer` / `AuthorizerVerdict` types and `createDeniedPermissionDecision` from `permission-dialog.ts`; it is a pure function over its two parameters, mutates nothing, and reaches through nothing.

### Consumer call site

`AuthorizerSelection.activate` routes the selected terminal through the (empty) chain:

```typescript
activate(ctx: ExtensionContext): void {
  const terminal = selectAuthorizer(ctx, this.deps);
  this.selected = composeAuthorizerChain([], terminal);
}
```

With the literal `[]`, `composeAuthorizerChain` returns `terminal`, so `escalate` still hands the real `LocalUserAuthorizer` / `ParentAuthorizer` / `DenyingAuthorizer` to `prompter.prompt` — identical behavior.
Step 5 replaces `[]` with the registered links resolved from `authorizerChain` config.

### Design-review checklist

Ran the `design-review` checklist against the reshaped interface and the new wiring:

- **Dependency width** — `composeAuthorizerChain(links, terminal)`: two parameters, both used.
  No wide bag.
- **Law of Demeter** — no reach-through; the function talks only to its two parameters.
- **Output arguments** — none; returns a value, mutates nothing.
- **Parameter relay** — `details` flows link→terminal; each endpoint genuinely consumes it.
- **Repeated discriminators** — the `verdict.kind` switch is a **single** dispatch point (the composition function), not scattered `===` across modules.
  OCP-compliant.
- **Test mock depth** — the prompter test's `makeAuthorizer` becomes a one-method `TerminalAuthorizer` stub; no `as unknown as`, no nesting.

No structural smells; the change is fit for a single PR.

## Module-Level Changes

Source (`src/authority/`):

- `authorizer.ts` — add `AuthorizerVerdict`; repurpose `Authorizer` as the non-terminal link (`authorize(details): Promise<AuthorizerVerdict>`); add `TerminalAuthorizer` (`authorize(details): Promise<PermissionPromptDecision>`); change `selectAuthorizer`'s return type to `TerminalAuthorizer`.
  `AuthorizerSelectionDeps` unchanged.
  Import `PermissionPromptDecision` for the terminal signature (already imported).
- `authorizer-chain.ts` — **new**: `composeAuthorizerChain(links, terminal)`; imports `Authorizer` / `TerminalAuthorizer` / `AuthorizerVerdict` from `./authorizer`, `createDeniedPermissionDecision` + `PermissionPromptDecision` from `./permission-dialog`.
- `local-user-authorizer.ts`, `denying-authorizer.ts`, `approval-escalator.ts` — `implements Authorizer` → `implements TerminalAuthorizer` (bodies unchanged).
- `permission-prompter.ts` — `PermissionPrompterApi.prompt(authorizer: TerminalAuthorizer, …)` and the `PermissionPrompter.prompt` parameter; doc comment reference `{@link Authorizer}` → `{@link TerminalAuthorizer}`.
- `authorizer-selection.ts` — retype `private selected: TerminalAuthorizer | null`; `activate` calls `composeAuthorizerChain([], selectAuthorizer(ctx, this.deps))`; import `composeAuthorizerChain`.

Tests (`test/authority/`):

- `authorizer-chain.test.ts` — **new** (see TDD Order).
- `permission-prompter.test.ts` — `makeAuthorizer(decision): TerminalAuthorizer`; the `import type { Authorizer }` becomes `TerminalAuthorizer`; `vi.fn<Authorizer["authorize"]>` → `vi.fn<TerminalAuthorizer["authorize"]>`.
- `denying-authorizer.test.ts` — `import type { Authorizer }` → `TerminalAuthorizer`; the `const authorizer: Authorizer = new DenyingAuthorizer()` annotation → `TerminalAuthorizer`.
- `authorizer.test.ts` — unchanged (asserts `instanceof` on `selectAuthorizer`'s result; the concrete classes are unchanged).
  Stays green as the behavior pin.
- `authorizer-selection.test.ts` — unchanged (asserts `prompter.prompt` called with `expect.any(LocalUserAuthorizer)`; the empty-chain identity preserves it).
  Stays green as the behavior pin.

Docs:

- `docs/architecture/architecture.md`:
  - Module tree — rewrite the `authorizer.ts` entry (line ~760) to `AuthorizerVerdict` + non-terminal `Authorizer` (`authorize(details): Promise<AuthorizerVerdict>`) + `TerminalAuthorizer` (`authorize(details): Promise<PermissionPromptDecision>`) + `AuthorizerSelectionDeps` + `selectAuthorizer(ctx, deps): TerminalAuthorizer`; add a new `authorizer-chain.ts` entry (`composeAuthorizerChain` — non-terminal links then the terminal; terminal-cannot-defer is type-level; empty-links identity).
    Refine the `local-user-authorizer.ts` / `denying-authorizer.ts` / `approval-escalator.ts` and `authorizer-selection.ts` / `permission-prompter.ts` entries where they call the concrete classes "Authorizer" to "`TerminalAuthorizer`" (current-behavior accuracy).
  - Step 4 completion — add `✅` to the `#### Step 4:` heading and the `S4` Mermaid node, and a `Landed:` note under Step 4's Outcome.
  - Do **not** edit the fixed `Baseline (2026-07-15)` column or the Step-5 `authorizerChain` schema-sites metric row (that metric is Step 5's).
- `docs/configuration.md`, `README.md` — no change (no config field or command added in Step 4).
- `.pi/skills/package-pi-permission-system/SKILL.md` — no change; its only reference is `ParentAuthorizer.authorize` (`src/authority/approval-escalator.ts`), whose signature (returns `PermissionPromptDecision` as a `TerminalAuthorizer`) is unchanged.

No `package.json` `exports`, event channel, or `Symbol.for()` surface changes (the reshaped types are package-internal), so no wider `docs/` grep is warranted; the greps above (`docs/architecture/`, `docs/configuration.md`, `README.md`, package skill) found every reference.

## Test Impact Analysis

1. **New tests the extraction enables** — `composeAuthorizerChain` is a pure function, unit-testable in isolation for the first time: empty-links identity; `allow`→`{approved:true,state:"approved"}`; `deny` with reason→`denied_with_reason` + `denialReason`; `deny` without reason→`denied`; `defer`→next link; a mid-list decide short-circuits (first non-defer wins, later links not called); all-defer→terminal.
   Previously this dispatch did not exist.
2. **Redundant existing tests** — none.
   No prior test covered chain composition (it did not exist); `authorizer.test.ts` and `authorizer-selection.test.ts` still exercise selection and escalation and are not superseded.
3. **Tests that must stay as-is** — `authorizer.test.ts` (terminal selection by context) and `authorizer-selection.test.ts` (escalate/reject contract + `expect.any(LocalUserAuthorizer)` identity) are the behavior pins that prove the reshape is a no-op with zero links.
   They must pass unchanged; changing them would defeat the "behavior identical" guarantee.

## Invariants at risk

The change touches the Phase 9 spine (`selectAuthorizer` / `AuthorizerSelection`), whose documented outcome is "exactly one terminal `Authorizer` selected per activation; `escalate` delegates to the prompter with the selected authorizer" and "#556 dissolved `canConfirm()`".

| Invariant                                                                                       | Pinned by                                                          |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| One terminal selected per activation by `hasUI` / `isSubagent` / deny dispatch                  | `authorizer.test.ts` (`instanceof` per context)                    |
| `escalate` hands the **selected terminal instance** to `prompter.prompt` (empty-chain identity) | `authorizer-selection.test.ts` (`expect.any(LocalUserAuthorizer)`) |
| `escalate` rejects before activate / after deactivate; returns the prompter decision            | `authorizer-selection.test.ts`                                     |
| No separate confirmability predicate (#556)                                                     | unchanged — `DenyingAuthorizer` still answers by denying           |

All invariants live in existing tests; no new pinning test is needed for them.
The reshape must keep the empty-links identity so the second row holds.

## TDD Order

1. **Reshape the interfaces and add `composeAuthorizerChain`.**
   Red — add `test/authority/authorizer-chain.test.ts` covering the seven cases in Test Impact Analysis §1 (empty-links identity via `toBe(terminal)`; each verdict mapping; first-non-defer-wins with a `not.toHaveBeenCalled` on the trailing link; all-defer→terminal).
   Green — in `authorizer.ts` add `AuthorizerVerdict`, repurpose `Authorizer` as the non-terminal link, add `TerminalAuthorizer`, retype `selectAuthorizer`; add `authorizer-chain.ts`; migrate the three concrete terminals and `permission-prompter.ts` to `TerminalAuthorizer`; retype `AuthorizerSelection.selected`; migrate `permission-prompter.test.ts` and `denying-authorizer.test.ts`.
   This is one commit: repurposing the exported `Authorizer` type breaks every implementer and consumer at compile time, so the reshape, all consumer updates, and the two consumer-test updates land together.
   Commit: `refactor(pi-permission-system): reshape live-authority layer as an Authorizer chain (#598)`
2. **Route activation through the empty chain.**
   Green — `AuthorizerSelection.activate` calls `composeAuthorizerChain([], selectAuthorizer(ctx, this.deps))`; import `composeAuthorizerChain`.
   No new test: `authorizer-selection.test.ts` pins the behavior (empty-chain identity preserves `expect.any(LocalUserAuthorizer)`); run it to confirm green.
   Commit: `refactor(pi-permission-system): route activation through composeAuthorizerChain (#598)`
3. **Mark Step 4 complete and refresh the module tree.**
   Update `docs/architecture/architecture.md`: `✅` on the Step 4 heading and the `S4` Mermaid node, a `Landed:` note, the rewritten `authorizer.ts` tree entry, and the new `authorizer-chain.ts` tree entry (plus the terminal-class prose touch-ups).
   Commit: `docs(pi-permission-system): mark Phase 12 Step 4 complete (#598)`

## Risks and Mitigations

- **A silent behavior change from the reshape.**
  Mitigation: the empty-links identity (`composeAuthorizerChain([], t) === t`) keeps `escalate` handing the real terminal instance to the prompter; `authorizer.test.ts` and `authorizer-selection.test.ts` pass unchanged as the pins.
  Any drift breaks the `expect.any(LocalUserAuthorizer)` assertion.
- **A dropped `import type` in the atomic reshape edit (AGENTS.md: `tsc` passes on an unused type import).**
  Mitigation: after Step 1, re-read `authorizer.ts` / `permission-prompter.ts` / `authorizer-selection.ts` and run `pnpm --filter @gotgenes/pi-permission-system run check` + `run lint` (lint flags unused imports), not just `tsc`.
- **Vocabulary drift from ADR 0007.**
  Mitigation: the operator confirmed the ADR-faithful rename (`Authorizer` = non-terminal link, `TerminalAuthorizer` = terminal); Steps 5/6 inherit the ADR vocabulary directly.
- **Fallow dead-code on the dormant seam.**
  `composeAuthorizerChain` is consumed by `AuthorizerSelection.activate` (Step 2) and covered by its own tests, so it is not dead; `AuthorizerVerdict` and the non-terminal `Authorizer` are referenced by `composeAuthorizerChain`'s signature and tests.
  Run `pnpm fallow dead-code` before pushing.

## Open Questions

- **Link `authorize` signature gains `PermissionQuery` in Step 5.**
  ADR 0007 §3 injects a narrow `PermissionQuery` into each link at `authorize` time.
  Step 4's `Authorizer.authorize(details)` omits it (no link consumes it yet); Step 5 widens the signature when it wires registration and query injection.
  Deferred to [#599] by design, not an oversight.
- **`allow`/`deny` verdict → decision mapping richness.**
  Step 4 maps `allow`→`state:"approved"` (non-persistent) and `deny`→`createDeniedPermissionDecision`.
  Whether a future allow-capable slice needs a session-scoped or audited (`origin:"authorizer:model"`) decision shape is Step 5/6 envelope work per ADR 0007 §6; not in scope here.

[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#599]: https://github.com/gotgenes/pi-packages/issues/599
[#600]: https://github.com/gotgenes/pi-packages/issues/600
