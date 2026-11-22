---
issue: 282
issue_title: "Extract ToolPreviewFormatter from tool-input-preview.ts"
---

# Retro: #282 — Extract ToolPreviewFormatter from tool-input-preview.ts

## Stage: Planning (2026-05-30T18:00:00Z)

### Session summary

Produced a numbered implementation plan for extracting a `ToolPreviewFormatter` class from the flat `tool-input-preview.ts` module and threading it through the gate descriptor chain.
The plan covers 6 TDD cycles: extract the class, thread through `describeToolGate`/`formatAskPrompt`, wire construction in `PermissionGateHandler`, remove the module-level `vi.mock` in `permission-prompts.test.ts`, and update architecture docs.
Referenced the Phase 1 roadmap in the architecture doc and confirmed #285 (handleToolCall decomposition) is already completed.

### Observations

- The architecture doc's roadmap was comprehensive and directly translatable to a concrete implementation plan.
  The dependency ordering (#285 before Phase 1 step 2) was verified correct by checking the current code — `permission-gate-handler.ts` already has the decomposed pipeline.
- The existing `tool.ts` gate test (`test/handlers/gates/tool.test.ts`) and `permission-prompts.test.ts` both need formatter injection but in different ways: `tool.test.ts` needs a real formatter instance for `describeToolGate`; `permission-prompts.test.ts` needs to replace its module-level mock with direct injection.
- The `permission-prompts.test.ts` mock removal is not purely mechanical — tests that assert `toHaveBeenCalledWith` on the mocked `formatToolInputForPrompt` need rework to assert on the real result string.
  The plan calls this out explicitly in step 5.
- Included `toolInputLogPreviewMaxLength` in `ToolPreviewFormatterOptions` even though the issue only lists two fields, because log-formatting methods (`formatGenericToolInputForLog`, `getToolInputPreviewForLog`, `getPermissionLogContext`) use it and they're all moving to the class.
  If #266 decides not to expose it in config, the field defaults to 1000 and remains internal.
- No ambiguity worth asking the user about — the issue proposed clear steps.

## Stage: Implementation — TDD (2026-05-30T22:30:00Z)

### Session summary

Extracted `ToolPreviewFormatter` from `tool-input-preview.ts` and threaded it through the gate descriptor chain in 4 commits (test step 1, refactor steps 2–5 combined, style fix, docs).
All 68 test files pass with 1527 tests, a net gain of 7 tests over the 1520 baseline.
The `vi.mock` in `permission-prompts.test.ts` was removed; the formatter is now injected directly.

### Observations

- **Plan deviation — steps 2–5 folded into one commit.**
  Removing the 7 config-dependent exports from `tool-input-preview.ts` immediately broke `tool.ts`, `permission-prompts.ts`, and their tests at the TypeScript level, making it impossible to commit the extraction without simultaneously updating all consumers.
  The intermediate state was uncompilable, so the extraction, threading, test updates, and `vi.mock` removal all landed in one refactor commit.
  Noted in the commit body.
- **ESLint `prefer-nullish-coalescing` in `sanitizeInlineText`.**
  The `maxLength !== undefined ? maxLength : default` ternary in `tool-preview-formatter.ts` was caught by the pre-commit hook; fixed before committing by collapsing to `maxLength ?? this.options.toolTextSummaryMaxLength`.
- **Biome `useTemplate` warnings.**
  Two string-concatenation lints in `tool-preview-formatter.test.ts` required a manual edit (unsafe auto-fix); patched with a separate `style:` commit.
- **Pre-completion reviewer WARNs (intentional):**
  - `formatAskPrompt` accepts the full `ToolPreviewFormatter` rather than a narrower `{ formatToolInputForPrompt }` interface — documented in the plan as intentional for forward compatibility.
  - `formatAskPrompt` silently returns empty preview when `formatter` is `undefined` — documented in the plan as safe default behavior.
- Pre-completion reviewer verdict: **PASS**.

## Stage: Final Retrospective (2026-05-31T02:49:40Z)

### Session summary

Shipped issue #282 cleanly: synced, ran root-level `pnpm run lint` and `pnpm fallow dead-code`, pushed, watched CI to `success`, and closed the issue with an implementation summary.
No release-please PR appeared because the change is a `refactor:` with no `feat:`/`fix:` commits — these changes will release with the next semantic commit to `pi-permission-system`.
This retrospective spans all three stages (Planning, TDD, Ship).

### Observations

#### What went well

- The ship stage was friction-free: every gate (`lint`, `fallow dead-code`, CI, issue close) passed on the first attempt.
- Incremental verification during TDD was strong — `pnpm run check` ran immediately after the export-removal edit and surfaced the three broken consumers (`tool.ts`, `permission-prompts.ts`, and their tests) at once, which is what made the steps 2–5 fold an obvious, deliberate decision rather than a surprise.
- The `pre-completion-reviewer` subagent caught the two `formatAskPrompt` design WARNs and correctly classified them as intentional-per-plan, so no churn resulted.

#### What caused friction (agent side)

1. `missing-context` — during Planning, the plan file added a `[#282]:` reference-link definition for the plan's own issue number, but the body never links to `[#282]` (a plan does not reference itself).
   This tripped markdownlint MD053 (unused reference) and was not caught until the TDD baseline ran `pnpm run lint`, forcing a fixup commit (`b4c4b52a docs: fix unused link reference in plan 0282`).
   The pre-commit hook runs `rumdl fmt` (formatting) but not `rumdl check` (linting), so the Planning commit passed its hook with the latent failure.
   This is the **second** occurrence of link-reference-definition trouble in adjacent sessions — #285 needed `1e05657e docs(retro): remove duplicate link reference definitions in retro file`.
   Impact: one fixup commit per session; user-caught risk avoided only because the next stage happened to lint.
2. `wrong-abstraction` — during TDD, a multi-edit on `tool-input-preview.ts` removed `getNonEmptyString` from the top-level import and replaced `getPromptPath`'s body with an inline `require("./common")` call instead of simply keeping the import.
   Self-identified immediately by reading the file after the edit; fixed in two follow-up edits before any commit.
   Impact: ~2 extra edits, no commit churn.
3. `missing-context` (minor) — during Planning, the agent tried to read the colgrep skill at `.pi/skills/colgrep/SKILL.md` and got `ENOENT`; the skill actually lives at `packages/pi-colgrep/skills/colgrep/SKILL.md`.
   Most package skills sit under `.pi/skills/`, so the guessed path was a reasonable but wrong default.
   Impact: one failed read, no rework.

#### What caused friction (plan side)

1. `premature-convergence` — the plan split the extraction (step 2, "pure extraction… not yet used by any consumer") from the consumer threading (step 4), but removing the seven exports from `tool-input-preview.ts` breaks every importer at the type level in the same commit, so the split was not buildable.
   The existing `plan-issue.md` rule covers "an export that has a single call site (e.g., `index.ts`)" — it does not generalize to an export with multiple consumers plus their test files.
   Impact: no rework (TDD folded steps 2–5 and noted the deviation), but the six-step structure was misleading and required a deviation note in the commit body and TDD retro.

### Diagnostic details

- **Feedback-loop gap analysis** — the Planning stage commits the plan without running `pnpm run lint:md`; the only markdown gate at commit time is the pre-commit `rumdl fmt`, which formats but does not flag MD053.
  The unused link reference therefore survived until the TDD baseline lint.
  Addressed indirectly by the markdown-conventions rule below (cheaper than adding a lint step to the Planning prompt).
- **Model-performance correlation** — the only subagent across all stages was the TDD-stage `pre-completion-reviewer` (judgment-heavy review); appropriate match, no mismatch.
- **Escalation-delay / unused-tool** — no rabbit-holes; no error sequence exceeded two tool calls; no missing subagent dispatch.

### Changes made

1. `.pi/skills/markdown-conventions/SKILL.md` — extended the reference-style links bullet with a link-reference hygiene sub-rule: every `[#N]:` definition needs a matching `[#N]` body reference (MD053), and do not define a link for the doc's own issue number.
2. `.pi/prompts/plan-issue.md` — broadened the TDD Order export-removal rule from "single call site" to any export removal, folding the extraction plus all consumer and consumer-test updates into one step regardless of call-site count.
