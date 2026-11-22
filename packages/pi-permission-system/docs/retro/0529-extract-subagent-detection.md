---
issue: 529
issue_title: "pi-permission-system: extract a SubagentDetection collaborator; seed src/authority/"
---

# Retro: #529 — pi-permission-system: extract a SubagentDetection collaborator; seed src/authority/

## Stage: Planning (2026-07-06T00:00:00Z)

### Session summary

Produced `docs/plans/0529-extract-subagent-detection.md`: a 7-step TDD plan that moves `subagent-context.ts` into `src/authority/`, adds a `SubagentDetection` class (constructed once in `index.ts`), and rewires four consumers onto two ISP seams (`SubagentDetector`, `RegisteredChildDetector`).
Release recommendation: ship independently (roadmap `Release: independent`; all-`refactor:` commits auto-batch into the next release).

### Observations

- Two design forks were surfaced via `ask_user` and resolved by the operator: **(1) Complete scope** — `SubagentDetection` also owns `isRegisteredChild(ctx)` and `service-lifecycle.ts` is rewired onto it (a fourth consumer beyond the issue's three), so all subagent-detection predicates get one owner; **(2) Delegate** — the pure functions `isSubagentExecutionContext` / `isRegisteredSubagentChild` stay exported and the class delegates, preserving the 372-LOC `subagent-context.test.ts` intact (it moves to `test/authority/` with only an import-path change).
- `PermissionForwarder` keeps its `registry` dep — it uses the registry directly for `resolvePermissionForwardingTargetSessionId` (registry-as-data), separate from detection.
  Only `subagentSessionsDir` and `platform` drop from `PermissionForwarderDeps`.
- The rewire obsoletes the last `vi.mock` module mock in `test/forwarding-manager.test.ts` (the reason that file was left off the #528 forwarding harness); it gets a one-field fake detector instead but stays off the harness per that plan's Non-Goals.
- Per-ask re-evaluation inside `PermissionForwarder` (two `isSubagent` calls per forwarded ask) is deliberately **not** collapsed — the once-per-session selection is Phase 9's Authorizer job.
- Docs inventory: `architecture.md` needs the Step 5 ✅ (heading + Mermaid `S5` + metrics row), a `Landed:` bullet documenting the scope widening, the line-424 path fix, and an `authority/` subtree in the module-layout tree; SKILL.md, README, and `docs/subagent-integration.md` were checked and need no changes (they reference the still-exported function / module leaf name only).
- No follow-up issues filed — Step 6 (#530) already exists and consumes this step's output.

## Stage: Implementation — TDD (2026-07-06T21:54:00Z)

### Session summary

Executed all 7 TDD steps as planned: mechanical `git mv` of `subagent-context` into `src/authority/`, added the `SubagentDetection` class (two ISP seams), rewired the four consumers (`PromptingGateway`, `ForwardingManager`, `PermissionForwarder`, `PermissionServiceLifecycle`) onto the collaborator, and marked Phase 8 Step 5 complete in `architecture.md`.
Test count went from 2293 → 2300 (+7 from the new `subagent-detection.test.ts`); `check`, root `lint`, and `fallow dead-code` all green.
Pre-completion reviewer returned PASS.

### Observations

- One deviation from the plan's Module-Level Changes: `test/permission-forwarder.test.ts` needed **no** edits — its only non-UI case is the deny path (`isSubagent` must be `false`), which the default `isSubagent → false` fixture in `makeForwarderDeps` satisfies; no test exercised the forwarded (`isSubagent` true) path directly (that round-trip lives in `composition-root.test.ts`).
  Only `test/helpers/forwarding-fixtures.ts` changed for the forwarder rewire.
- `pi-autoformat` reordered imports on several `src/` files after the step-1 move, so a few `Edit` `oldText` blocks had to be re-anchored against the reflowed import order (re-read before editing).
- The per-consumer rewires (steps 3–6) were cleanly independent thanks to the delegate approach: the pure functions stayed live, so each consumer flipped to the seam one commit at a time with `index.ts` coexisting old + new wiring.
- `subagentRegistry` remains in `index.ts` for `subscribeSubagentLifecycle` and `PermissionForwarderDeps.registry` (target resolution) — confirmed still used, not dead after the service-lifecycle rewire.
- Reviewer noted the unrelated in-range commit `72c15808` (pluggable escalation seam note) from a prior branch also touches `architecture.md`; it is valid and separate, not part of #529's TDD order.
- Pre-completion reviewer: PASS — ready for `/ship-issue`.

## Stage: Final Retrospective (2026-07-07T14:01:59Z)

### Session summary

Shipped issue #529 across planning, TDD, and ship stages in one trunk session: a Phase 8 Step 5 refactor extracting a `SubagentDetection` collaborator and seeding `src/authority/`, landing 7 `refactor:`/`docs:` commits with no behavior change.
All three stages ran cleanly — two design forks resolved via `ask_user` at planning time drove the plan and never got second-guessed; the 7 TDD steps went red→green→commit with incremental verification; ship pushed green (CI success), closed the issue, and correctly cut no release (all-hidden changelog types auto-batch).

### Observations

#### What went well

- **Front-loading design forks paid off.**
  Both genuine forks (scope: also own `isRegisteredChild` + rewire `service-lifecycle.ts`; delegate vs. absorb the pure functions) were surfaced via one `ask_user` call at planning time, before any plan prose was written.
  The operator's answers became the plan's Goals and drove all 6 code steps with zero implementation-time rework or second-guessing.
- **Delegate + coexist made per-consumer commits cleanly independent.**
  Because the pure functions stayed exported and `SubagentDetection` delegates to them, each of the four consumers flipped to the seam in its own commit (steps 3–6), with `index.ts` holding old + new wiring side by side between steps.
  No lift-and-shift transitional wrapper was needed, and the type checker stayed green at every commit — a clean execution of the tidy-first / incremental-migration pattern for a refactor.
- **Verification ran incrementally, not just at the end.**
  Each TDD step ran its affected test file plus `pnpm run check` before committing; the full suite + root `lint` + `fallow dead-code` ran once at the end.
  No end-of-session surprise — the feedback loop caught nothing late because it ran early.

#### What caused friction (agent side)

- `other` (tooling interaction) — `pi-autoformat` re-sorted each file's whole import block when step 1 added a new import path, so `Edit` `oldText` blocks that spanned import lines in later steps (3, 4, 6) failed to match against the stale order I carried from planning-time reads.
  Impact: 3 failed `Edit` batches, each recovered with one re-read + retry (~2 extra tool calls apiece); no rework or bad commits.
  The existing `AGENTS.md` guidance covers re-reading a region "you just edited," but here the volatile import block was re-sorted by autoformat in an *earlier* step, so the "just edited" trigger did not fire in my head.

#### What caused friction (user side)

- None.
  The operator's only involvement was answering the two planning-time `ask_user` forks (exactly the right strategic input) and running the three slash commands; no corrections or redirects were needed.
- Minor, not friction: a prior-branch commit (`72c15808`, the pluggable-escalation-seam architecture note) landed on `main` and rode along in the #529 push, requiring a one-line "is this mine?" check during the ship close-comment range scan — resolved without rework.

### Diagnostic details

- **Feedback-loop gap analysis** — no gap: `pnpm run check` + the affected test file ran after every TDD step; full suite + `lint` + `fallow` ran at the end.
  This is the intended incremental pattern, not end-loaded verification.
- **Escalation-delay tracking** — no rabbit-holes; the 3 `Edit`-match failures each resolved in a single re-read + retry (2 tool calls), well under the 5-call flag threshold.
- **Model-performance correlation** — one subagent dispatch (`pre-completion-reviewer`, 41 tool uses / ~189 s) on judgment-heavy review work, an appropriate match; it ran on its configured model with no override.
- **Unused-tool detection** — none: planning exploration used `colgrep`/`grep`/`Read` appropriately, and no friction point would have benefited from an un-dispatched subagent or tool.

### Changes made

1. Added this Final Retrospective stage entry to `packages/pi-permission-system/docs/retro/0529-extract-subagent-detection.md`.
2. Considered a one-sentence `AGENTS.md` addition (autoformat re-sorts a file's whole import block when any import changes, so a later-step `Edit` spanning imports can fail against a stale read); operator chose to **skip** it — the existing "re-read a region you just edited" guidance is close enough, and the friction cost only one re-read + retry per occurrence.
   No `AGENTS.md` change landed.
