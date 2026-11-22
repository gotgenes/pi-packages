---
package: pi-permission-system
phase: 11
---

# Retro: pi-permission-system — Phase 11 Planning (shell-tool-aliasing-elicitation-ux)

## Stage: Improvement Planning (2026-07-13T02:29:31Z)

### Session summary

The cause hypothesis going in was cross-session path portability (the `ServingPolicy` normalizes a child's forwarded path against the parent's cwd) — the direction Phase 10 named as the leading Phase 11 candidate.
Discovery confirmed it is real but chose to defer it to Phase 12: the Phase 9 serving machinery has just shipped, `#565` is the designated post-ship observation of exactly those behaviors, and two fresh user-reported requests (`#573`, `#574`) arrived during Phase 10's ship window.
The phase shape chosen is a full 7-step phase whose spine is the sibling boundary flaw in the same first-principles domain — the access-intent boundary is closed against the real tool ecosystem (`classifyToolKind` hardcodes built-in names, so `exec_command` from `pi-codex-conversion` bypasses the entire bash enforcement stack, `#574`).

### Observations

- **Cause the phase dissolves.**
  The access-intent boundary — turning `(toolName, input)` into "what is being accessed" — cannot record that a foreign tool name carries bash semantics.
  This is a Category C OCP flaw with a Category F cross-package flavor: the same shell operation is gated differently depending on which toolset is active, and a user's `bash` deny rules silently do not apply.
  The fix records the alias in config (`shellTools`, Step 2) and consumes it at the dispatch point (Step 3), keeping one dispatch point rather than scattering `toolName === …` checks.
- **Deferral-gate outcome: did not fire.**
  `#574` is a genuine cause-level, user-reported enforcement gap, so the phase is not polish-only.
  The Phase 12 candidate (cross-session intent spine) is recorded, not silently re-deferred — an explicit `ask_user` decision confirmed deferring it with `#565` gathering real-session evidence first.
- **Repeat deferrals resolved by decision.**
  `#472` (model judge) was deferred by name in Phases 9 and 10; this phase writes its decision record (Step 7, ADR 0007, filed as `#581`) so it becomes schedulable — implementation stays future work.
  `#519` (SDK UIContext) stays open by explicit decision, not a silent sweep: Step 4's `select`-fallback constraint keeps frontend-driven flows working meanwhile.
- **Feasibility probes that shaped steps.**
  - `#573` (keybind dialog): verified `ctx.ui.custom<T>()` exists on the current SDK and renders **inline by default** (`overlay ?? false` in Pi core `interactive-mode.ts` `showExtensionCustom`).
    No SDK evolution needed — this moved `#573` from "blocked like `#519`" to a schedulable Step 4.
    The `@eko24ive/pi-ask` inline flow (pure input-command decision layer, hotkeys, back-navigation between steps) is the named UX model; the user explicitly prefers the inline style over overlay.
  - The seam is narrow: `selectAuthorizer` reads `ctx.hasUI` and hands `ctx.ui` to `LocalUserAuthorizer`, which calls the single `requestPermissionDecisionFromUi(ui, …)` entry.
    The keybind flow slots in behind that one function with a mode-guarded fallback — localizing Step 4 and preserving the `#519` constraint.
- **Fallow corroboration, not agenda.**
  Health 78 (B), dead code 0, duplication 0.4%.
  Both clone groups are intentional near-duplicates (`literalTextOf` fails closed where `resolveNodeText` is best-effort; the two bash gate preambles) — kept per the wrong-abstraction rule.
  The repeated-discriminator sweep found no new family.
  The `value-guards.ts` "split" refactoring target was rejected: a 17-LOC pure-guard leaf with high fan-in is a healthy utility, not a coupling smell.
- **Tidy-first directory move.**
  The access-intent domain has a directory but four of its modules (`input-normalizer`, `mcp-targets`, `tool-input-path`, `path-surfaces`) still sit in the flat root (60 modules).
  Step 1 (`#579`) folds them in before Step 3 rewrites two of them — final location the first time.
  `bash-advisory-check.ts` deliberately stays out (a domain module must not import from `handlers/`).
- **Doc-hygiene fix rolled in.**
  The Phase 10 summary referenced `[#571]` and `[#575]` without reference-link definitions (dangling refs).
  The Phase 11 section adds the definitions.
- **Issues filed:** `#579` (Step 1), `#580` (Step 2), `#581` (Step 7).
  Steps 3–6 reuse existing `#574`, `#573`, `#571`, `#575`.
  Release: "shell-tool-aliases" batch = Steps 2 + 3 (tail Step 3); all others independently releasable.
