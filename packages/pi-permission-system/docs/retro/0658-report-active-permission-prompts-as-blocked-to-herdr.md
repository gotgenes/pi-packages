---
issue: 658
issue_title: "pi-permission-system: report active permission prompts as blocked to Herdr"
pr: 693
---

# Retro: #658 — report active permission prompts as blocked to Herdr

## Stage: PR Review (2026-10-17T23:15:06Z)

### Session summary

PR #693 (@aspiers) makes `LocalUserAuthorizer.authorize()` emit Herdr's `herdr:blocked` event before the permission dialog opens and again when it closes, so Herdr shows a session waiting on a human as blocked rather than working.
The problem is real for a Herdr user with no glue extension, but emitting another tool's event from this package is a recorded non-goal.
The operator chose to decline the PR, point Herdr users at a downstream bridge built on the existing broadcasts, and track the contract hardening that makes such a bridge dependable on #936.

### Evaluation

- **The defect on current `main`.**
  `herdr:blocked` is emitted nowhere in `src/` (grep).
  A scratch composition-root probe (real `piPermissionSystemExtension` factory, `makeFakePi`, a `"*": "ask"` config, approving and denying a `demo` tool call) recorded no `herdr:blocked` event, plus one `permissions:ui_prompt` and one `permissions:decision` carrying the same `requestId`.
  Both cases passed; the scratch file was deleted.
  The forwarded case was read, not run: `forwarded-request-server.ts` `emitDecision(buildServedDecisionEvent(…))` gives the serving session its own terminal decision (#610).
- **It is a recorded non-goal.**
  `docs/architecture/architecture.md` § Scope and non-goals lists "Outbound bridges into another named extension's event contract".
  The #906 plan names this PR and #658 under Non-Goals and instead added `docs/cross-extension-api.md` § "Recipe: bridging a prompt to an external notifier" (commit `9ce9b32c`), which says "This package does not emit another tool's events itself".
- **The PR no longer fits `main`.**
  It is `CONFLICTING`, 955 commits behind its base `60c22b0a`, and has no CI run on its head (`actions/runs?head_sha=d02433f5…` → `total_count: 0`).
  `LocalUserAuthorizer` has since gained the `AskDialogAdmission` queue (`authorize` → `dialogs.run` → `present`), so the PR's `try`/`finally` would bracket the wrong region.
- **The implementation itself was sound for its time.**
  It wrapped the wait in `try`/`finally`, swallowed listener failures so enforcement could not be affected, and tested both direct and forwarded prompts plus a rejected decision.
  The objection is to where the code lives, not to how it was written.
- **The downstream path already works.**
  The broadcasts' payload types and `PERMISSIONS_*_CHANNEL` constants are exported from `src/service.ts`.
  Both events carry a required `requestId`, and the `ui_prompt` payload carries `forwarding` and `surface`, enough for a "(Subagent)" label. @mb1986's ~40-line bridge on #658 does the job; on `main` its id-less fallback is dead code.
- **The gap that remains is the contract.**
  `docs/cross-extension-api.md` § Stability Guarantee covers payload *fields* under semver.
  It does not list the behavioural promises a bridge relies on: the channel names, `ui_prompt` firing when the dialog is presented rather than when the ask is raised, and every `ui_prompt` being answered by exactly one `permissions:decision` with the same `requestId` on the same bus.
  No end-to-end test pins the pairing: pieces sit in `runner.test.ts` and `forwarded-request-server.test.ts`.
  Unverified edge: a dialog released at session shutdown (`AskDialogQueue.releaseAll` → `releasedDecision`) should still emit a decision; that was read, not run.

### Decision and attribution

- **Direction:** decline PR #693.
  No `herdr:blocked` (or any other foreign event) emission in this package; no Herdr bridge package in this monorepo.
- **Follow-up, tracked on #936:**
  1. Extend § Stability Guarantee to name the behavioural invariants above as semver-covered.
  2. Add one parameterized composition-root contract test pinning `ui_prompt` → exactly one same-`requestId` `decision` on the same bus, for allow, deny, `prompt_unanswered`, `gate_error`, a forwarded ask served by the parent, and a dialog released at session shutdown.
  3. Optionally tighten the recipe: `import type` plus string-literal channel names, and clear on `session_shutdown`.
- **Non-goals:** a typed `onPromptLifecycle` helper (new mechanism for a ~15-line pattern), and a Herdr adapter package here (its natural owner is Herdr's Pi integration or the user).
- **#658:** left open; its disposition is a separate operator call.
- **Attribution:** the PR close comment thanks @aspiers by name.
  No `Co-authored-by:` trailer applies: the #936 follow-up takes nothing from the PR's implementation.
  If a later change does borrow from it, the commit email on the PR is a local hostname (`adam@celtic.linksys.moosehall`), so use the GitHub noreply form `Adam Spiers <100738+aspiers@users.noreply.github.com>` (account id 100738 from `gh pr view`).
