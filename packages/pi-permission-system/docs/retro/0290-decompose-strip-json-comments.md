---
issue: 290
issue_title: "Reduce stripJsonComments complexity in config-loader.ts"
---

# Retro: #290 — Reduce stripJsonComments complexity in config-loader.ts

## Stage: Planning (2026-05-31T15:14:25Z)

### Session summary

Produced a numbered implementation plan to lower `stripJsonComments` cognitive complexity (31 → < 15) by replacing the five-flag single-loop scanner with a stateless dispatcher delegating to three private consume helpers (`consumeLineComment`, `consumeBlockComment`, `consumeString`), each returning a `ScanSegment` value.
The plan is behavior-preserving, adds direct unit tests for the already-exported `stripJsonComments`, and is structured as three TDD commits (`test:` pin contract → `refactor:` dispatcher → `docs:` architecture update).

### Observations

- Chose the issue's consume-helper option over the mode-discriminant step-function option: a `step(state, char)` function would mutate a shared state bag (output-argument smell) and re-encode the same five flags, so it relocates rather than removes the interleaving.
  Each consume helper returns a value and owns one JSONC sub-grammar — genuine decomposition per the `code-design` heuristics.
  Did not invoke `ask_user` — the choice is resolvable by project design principles and the change is small and reversible.
- `stripJsonComments` is `export`ed and consumed by both `config-loader.ts` (`loadUnifiedConfig`) and `policy-loader.ts`, but had no dedicated unit test — Step 1 pins its full contract directly before the refactor, so the new tests pass against today's implementation and act as the behavior-preservation net.
- No exports change and no symbol is renamed, so no `index.ts` barrel, package skill, or other doc needs updating — only `docs/architecture/architecture.md` (Phase 2 Step 5, findings row 5, worst-CRAP-risk line, metrics).
- `design-review` skill judged not applicable: the change is one self-contained pure function with no shared-interface or layer-wiring impact.
- Block-comment scan is planned to switch from a character loop to `indexOf("*/")` (behavior-identical, including the unterminated-to-EOF branch) — flagged as a risk with a dedicated test.
- markdownlint is not installed locally (`markdownlint-cli2` not found; no `.markdownlint*` config); relied on the `markdown-conventions` skill.
  `rumdl fmt` ran in the pre-commit hook and passed.

## Stage: Implementation — TDD (2026-05-31T15:23:14Z)

### Session summary

Completed all 3 TDD steps: pinned 14 direct unit tests for `stripJsonComments` (Step 1), replaced the five-flag scanner with the stateless dispatcher + three consume helpers (Step 2), and updated `docs/architecture/architecture.md` to mark Phase 2 Step 5 complete (Step 3).
Test count: 1614 → 1628 (+14).
A `style:` cleanup commit was added after the pre-completion review to fix helper ordering.

### Observations

- Step 1 required two assertion corrections: (1) the space before `//` is emitted verbatim, so the expected output was `'{ \n"k": 1}'` not `'{\n"k": 1}'`; (2) the combined JSONC round-trip test had a stray `,` after a stripped block comment rendering the output invalid JSON — restructured the document so comments are inline on value lines.
  Both caught before the step 1 commit; the pre-existing implementation was never at fault.
- ESLint auto-fixed bracket notation to dot notation (`parsed["debugLog"]` → `parsed.debugLog`) during the pre-commit hook; accepted the change.
- The `refactor:` commit placed the three consume helpers *before* `stripJsonComments`, inverting the stepdown rule (plan said "placed directly below `stripJsonComments`").
  The pre-completion reviewer flagged this as WARN; fixed in a `style:` commit (`4ff870a1`) after the review.
- `fallow health --targets` confirmed `config-loader.ts` / `stripJsonComments` no longer appears as a refactoring target after the refactor; architecture doc updated accordingly (targets 4 → 3).
- Pre-completion reviewer: **WARN** (one finding — stepdown order, resolved before final commit).
  All deterministic checks PASS.

## Stage: Final Retrospective (2026-05-31T15:39:45Z)

### Session summary

Shipped issue #290 across three stages (plan → TDD → ship) with no logic rework: a behavior-preserving decomposition of `stripJsonComments` into a stateless dispatcher plus three pure consume helpers, with 14 new unit tests pinning the contract (1614 → 1628).
CI passed first try; no release-please PR (all commits were `test:`/`refactor:`/`style:`/`docs:`).
The single follow-up was a `style:` commit (`4ff870a1`) fixing helper ordering, prompted by the pre-completion reviewer's one WARN.

### Observations

#### What went well

1. The plan's design reasoning held up end-to-end.
   The consume-helper approach (chosen over the mode-discriminant alternative) was behavior-preserving as predicted, and `fallow health --targets` confirmed `config-loader.ts` dropped off the refactoring-target list (4 → 3) exactly as the plan's Open Question anticipated.
2. Verification ran incrementally, not end-loaded.
   Green baseline (`check`/`lint`/`test`) before any TDD cycle, each cycle ran the affected file red-then-green, and the full suite plus `check`/`lint`/`fallow dead-code` ran after the last step.
3. The two Step 1 test-assertion bugs were caught during the red phase, before the commit — the space-before-`//` preservation and the stray-comma invalid-JSON case were both fixed without touching committed code or the production implementation.

#### What caused friction (agent side)

1. `instruction-violation` (reviewer-caught) — the `refactor:` commit (`483be378`) placed the three consume helpers *above* `stripJsonComments`, inverting the stepdown rule.
   The plan explicitly prescribed "placed directly below `stripJsonComments` per the stepdown rule," so the implementation had a written instruction and did not follow it.
   Impact: one follow-up `style:` commit (`4ff870a1`), no logic rework, no user intervention.
   This is the **second consecutive issue** with the identical friction: #289 fixed the same private-helper-before-export ordering in `style:` commit `55d2774a`, also reviewer-caught.
   Both sessions wrote the extracted helper above its caller (a "define before use" instinct that JS/TS hoisting makes unnecessary) and relied on the pre-completion reviewer to catch the stepdown inversion.

#### What caused friction (user side)

1. None.
   The design choice was resolvable from `code-design` principles, so no `ask_user` was warranted; the user's only involvement was launching each stage.

### Diagnostic details

- Model-performance correlation — the only subagent dispatch was the `pre-completion-reviewer` (pinned to `anthropic/claude-sonnet-4-6`, a valid registry alias); a judgment-heavy review on an appropriate model, no mismatch.
- Feedback-loop gap analysis — verification was incremental throughout; no end-loaded-verification flag.
- Escalation-delay and unused-tool lenses found nothing notable: the two Step 1 assertion bugs were each fixed in one edit, no sequence exceeded five tool calls on the same error, and no rabbit-holes or missing-context gaps arose that a subagent or `colgrep` would have prevented.

### Changes made

1. Appended this Final Retrospective stage entry to `packages/pi-permission-system/docs/retro/0290-decompose-strip-json-comments.md`.
2. Added a one-line note to the Stepdown rule in `.pi/skills/code-design/SKILL.md`: extracted helpers go *below* their caller, not above (hoisting makes "define before use" unnecessary).
   This closes the recurring stepdown-order friction caught by the pre-completion reviewer in both #289 (`55d2774a`) and #290 (`4ff870a1`).
