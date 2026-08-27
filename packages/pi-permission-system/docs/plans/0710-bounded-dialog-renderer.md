---
issue: 710
issue_title: "pi-permission-system: Forwarded subagent permission prompts render unbounded tool input inline and push the parent transcript out of view"
---

# Bounded local renderers — the dialog and the fallback render the payload under a budget

## Release Recommendation

**Release:** ship now — batch "presentation-payload" tail (this issue completes the batch)

Phase 13 of `docs/architecture/architecture.md` places this issue at Step 2, and the roadmap's `Release batches` subsection reads: **Batch "presentation-payload": Steps 1, 2 (ship together; tail = Step 2; release vehicle = Step 2's `fix:` for [#710] — Step 1 is a hidden `refactor:`)**.
Step 1 ([#744]) has landed as an all-hidden commit range and cut no release, so this issue's `fix:` is the vehicle that publishes both.
Steps 3 ([#745]) and 4 ([#746]) belong to the later "presentation-contract" batch and are not held by this one.

## Problem Statement

A subagent asked the parent session for permission to run a PowerShell command whose argument was a here-string holding a generated Markdown report.
The parent rendered `Permission Required (Subagent)` followed by the entire command body inline, wrapped across the whole visible transcript, so the prompt occupied nearly the full viewport and pushed the prior session output out of view.

The reporter is precise about what is and is not claimed: the forwarding itself works, and no transcript data is confirmed lost.
The defect is that an unbounded raw payload is rendered as ordinary inline approval text.

Measured this session against `main`, using the real `wrapTextWithAnsi` the dialog uses: a 200-line here-string (10 236 characters) renders **202 rows** as a local ask and **205 rows** as a forwarded one, identically at widths 80, 120, and 160 — the here-string carries its own newlines, so a wider terminal buys nothing.
A single-logical-line command of the same length would occupy about 86 rows at width 120.

The reporter asks for a compact summary by default with the full input behind an explicit expand action.
[ADR 0011] already decided the shape of that answer, and this issue implements it for the two local renderers.

## Goals

- Add `src/presentation/dialog-renderer.ts`: one renderer over `PromptPayload`, shared by the inline TUI dialog and the `select`/`input` fallback.
- Render the invariant core ([ADR 0011] §3) as aligned one-fact-per-line output, adopting PR [#716]'s readability intent as a *render* rather than an assembler change.
- Bound the render: a configurable row budget over the evidence block, plus a configurable per-field width cap that applies to core fields too.
- Mark every elision with a bare ellipsis and no counts ([ADR 0011] §4 explicitly rejects character/line counts as unactionable).
- Make the complete view reachable while the decision is pending: `Ctrl+O` (`app.tools.expand`) toggles the dialog between the bounded and the complete render, and still forwards to the host's tool expansion as it does today.
- Render `executedUnit` in the core, which closes [#713] — the wrapper's inner command becomes visible in every render.
- Paint the flagged element in the theme's warning colour, adopting PR [#738]'s intent with authorship credited.
- Add `promptMaxRows` (default 24) and `promptFieldMaxWidth` (default 400) through the established config path.
- Stop the local prompt path reading `details.message`; `renderLegacyMessage` survives for the wire, the broadcast, and the review log until [#745] and [#746] retire them.

This change is **not breaking**.
It changes what a human sees in a dialog; it changes no config default that alters a permission decision, no wire contract, and no agent-facing text.
The two new config fields are optional and additive.
Commits are `feat:` for the renderer and the config, and `fix:` for the wiring that resolves the reported defect.

## Non-Goals

- The forwarded wire and the `permissions:ui_prompt` broadcast — [#745] (Step 3) replaces `message` there; a forwarded ask still arrives carrying the child's pre-rendered sentence, which this renderer treats as one evidence entry.
- The review log and the agent-facing denial renderer — [#746] (Step 4).
- Soft-deprecating `toolInputPreviewMaxLength` / `toolTextSummaryMaxLength` — [ADR 0011] §5 subsumes them, and the roadmap assigns that config-issue notice to Step 3.
  They keep bounding the non-bash tool-input preview evidence until then.
- Rendering `annotations`.
  The slot exists and nothing populates it; the annotator registry is [ADR 0011] §8's seam, deferred with [#654].
- An expansion affordance in the `select`/`input` fallback.
  [ADR 0011] §6 records that renderer as assuming none, and a `select` has no keystroke channel; the fallback gets the same bounded render, and its complete-view story stays with [#745]'s broader work.
- Gating a wrapper's extracted inner command.
  [#713]'s second option stays declined; the wrapper floor is unchanged and `executedUnit` remains display-only.
- Changing `renderLegacyMessage` or any payload builder.
  The payload is complete by contract; this issue only adds renders over it.

## Background

### What Step 1 already built

[#744] dissolved six prompt-assembly sites into `src/presentation/` payload builders.
Every gate now emits a `PromptPayload`, `PromptPermissionDetails.payload` is required, and the flat `message` every consumer still reads is produced by the single transitional `renderLegacyMessage(payload)`.
Nothing renders `executedUnit` or `invokedToolName` yet — Step 1 populated both and deliberately left them unshown.

### The consumers this issue touches

| Site                      | File                                           | Today                                                                                 |
| ------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------- |
| Inline TUI dialog         | `src/authority/permission-prompt-component.ts` | pushes `this.message` as one line, then `fitToWidth` wraps it "so no content is lost" |
| `select`/`input` fallback | `src/authority/permission-dialog.ts`           | `ui.select(\`${title}\n${message}\`, …)`                                              |
| Dispatcher                | `requestPermissionDecision` (component module) | takes `message: string`, routes on `view.mode`                                        |
| Caller                    | `src/authority/local-user-authorizer.ts`       | passes `details.message`                                                              |

`fitToWidth` is where the unbounded height comes from: it wraps every line and returns however many rows that produces.

### The forwarded shape, and why [#710] reported the worst case there

`buildForwardedAskPayload` carries the child's pre-rendered sentence as a single `requested` evidence entry, and projects the child's display `surface` / `value` into the request facts.
So for the reported ask, the whole here-string appears twice in the payload: once as `request.value` (core) and once inside the `requested` evidence (elidable).

[ADR 0011] also verified against the sibling Pi checkout that a forwarded ask has **no** host tool-call block in the parent transcript, so Pi's own tool expansion has nothing to expand there and the prompt is the sole carrier of evidence.
That is why the reporter hit this on a subagent ask.

### The §3-versus-§5 reading this plan settles

[ADR 0011] §3 says the `request` core is "always visible … and that no budget may elide". §5 justifies the per-field width cap by "a single pathological field — a here-string on one logical line".
For this very report the here-string *is* `request.value`, a core field, so the two sections only cohere under one reading, confirmed with the operator at planning:

> "Never elided" means never **omitted**.
> Every core fact keeps its own labelled line in every render; a long field's *text* may be shortened, marked, and reached in full through the complete view.

Under the alternative reading the reported ask still costs 86–202 rows and [#710] is not fixed, so this reading is load-bearing and belongs in the architecture doc.

### Standing constraints

- Never redact the prompt's tool input ([ADR 0010], package priority).
  A width cap is a *quantity* bound applied uniformly; it never reads a value to decide what to hide, and the complete view remains reachable.
  The skill's verbatim boundary sentence stays true and unedited.
- `app.tools.expand` must keep reaching the host while the dialog holds focus ([#642]); a regression here would silently undo that fix.
- The `permissions:ui_prompt` broadcast must stay non-degraded for a forwarded ask ([#292]); `buildUiPrompt` reads `details`, not the rendered lines, so it is untouched — pinned by test, not by argument.
- New config fields must travel `config-schema.ts` → `pnpm run gen:schema` → `extension-config.ts` → `mergeUnifiedConfigs()`, or they are silently dropped before runtime (the #332 / #347 class).
- `PromptPermissionDetails` and `PromptPayload` are public types verified by `scripts/verify-public-types.sh`; neither changes here, and `dialog-renderer.ts` is internal.

## Design Overview

### The renderer

```typescript
export interface DialogBudget {
  /** Maximum rendered rows; bounds the evidence block. */
  readonly maxRows: number;
  /** Maximum characters of any single field's text, core included. */
  readonly fieldMaxWidth: number;
  /** Terminal width the lines are wrapped to before rows are counted. */
  readonly width: number;
}

export interface DialogView {
  /** Already wrapped to `budget.width`; each entry is one visual row. */
  readonly lines: readonly string[];
  /** True when any field was shortened or any evidence entry dropped. */
  readonly elided: boolean;
}

export type PaintRole = "flagged" | "label";
export type Paint = (role: PaintRole, text: string) => string;

export function renderPromptDialog(
  payload: PromptPayload,
  budget: DialogBudget,
  paint: Paint,
): DialogView;
```

The complete view is the same function under an unbounded budget (`Number.POSITIVE_INFINITY` for both caps), so there is one render path and no second layout to keep in step.

`paint` is a seam rather than a theme dependency: the component passes `theme.fg`-backed painting, the fallback passes the identity function, and the renderer's tests assert plain text.
This is also what keeps the fallback's `select` title free of ANSI, matching PR [#738]'s own rule that only the TUI paints.

### Layout

Aligned `label : value`, one fact per line, labels padded to the widest rendered label.
Core lines first, in a fixed order; evidence after, in payload order.

```text
subagent : scout · session abc12345
tool     : bash
surface  : bash
rule     : <indirection-bash-wrapper>
command  : @'
           - a finding line about some module in the codebase…
runs     : Out-File -FilePath report.md
requested: …
```

Core-line rules, by fact:

| Line                 | Source                        | Rendered when                                                                             |
| -------------------- | ----------------------------- | ----------------------------------------------------------------------------------------- |
| `agent` / `subagent` | `requester`                   | a name is present, or the ask is forwarded (a forwarded line also carries the session id) |
| `tool`               | `toolName`, `invokedToolName` | `toolName` is non-null; the invoked name appends as `bash (invoked as exec_command)`      |
| `surface`            | `surface`                     | always                                                                                    |
| `rule`               | `matchedPattern`              | non-null                                                                                  |
| value line           | `value`                       | always; labelled by `kind` — `command` / `path` / `target` / `skill`                      |
| `runs`               | `executedUnit`                | non-null — this is [#713]'s fact                                                          |
| `context`            | `commandContext`              | non-null                                                                                  |

An absent fact renders no line: a null `agentName` on a local ask is not a fact about the requester, and printing "current agent" would spend a row asserting the default.
Evidence entries render under their payload label (`full command`, `input`, `working directory`, `external path`, `resolves to`, `read path`, `requested`), with `detail` appended to the same line as `text → detail`, so an elision can never separate a path from what it resolves to.

### Bounding rule

Two caps, applied in this order:

1. **Field cap.**
   Every field's text — core and evidence alike — is clipped to `fieldMaxWidth` characters and marked with a trailing `…`.
   A field's embedded newlines are preserved up to the cap, so a here-string's first lines still show.
2. **Row bound.**
   Core lines are emitted first and are exempt.
   Evidence lines are emitted while rows remain (counted after wrapping to `budget.width`), reserving one row for a lone `…` line when anything was dropped.

Precedence is stated rather than implied: when the capped core alone exceeds `maxRows` (only reachable on a very narrow terminal), the core still renders in full and the evidence block is empty. §3 outranks §5; the field cap is what actually bounds the core, and the row budget is what bounds the evidence.

With the defaults, the reported ask renders as at most three short core lines plus two capped fields — roughly 11 rows at width 100 — against today's measured 205.

### Highlighting

The flagged element is derived from the payload rather than carried as a new `PromptPermissionDetails` field (PR [#738] added `highlightText`; the payload makes it redundant):

| Payload kind                                                                            | Flagged element                              |
| --------------------------------------------------------------------------------------- | -------------------------------------------- |
| `bash`, `mcp`, `tool`, `path`, `external_directory`, `skill`, `skill_read`, `forwarded` | `request.value`                              |
| `bash_external_directory`                                                               | each `external path` evidence entry's `text` |

The value line paints whole, and every **whole-token** occurrence of the flagged text inside an evidence line paints too — so `/etc/hosts` paints where it stands alone and stays plain inside `/etc/hostsbackup`, and `ls` stays plain inside `lsof`.
`/`, `.`, and `-` count as token characters, as in PR [#738].

### The complete view

`Ctrl+O` already reaches the dialog: `handleToolsExpandAction` intercepts `app.tools.expand` and forwards it to `ui.setToolsExpanded`.
It gains one responsibility — toggling the component's own `expanded` flag and requesting a render — while keeping the host forward, so "expand" means one thing in both places.
The muted hint line gains `ctrl+o full request` only when the current view elided something (and `ctrl+o collapse` while expanded), so the affordance is advertised exactly when it does something.

### Consumer call sites

```typescript
// permission-prompt-component.ts — the dispatcher now takes the payload
export function requestPermissionDecision(
  view: PermissionPromptView, // { mode, ui, doublePressToConfirm, budget }
  title: string,
  payload: PromptPayload,
  options?: RequestPermissionOptions,
): Promise<PermissionPromptDecision> {
  if (view.mode === "tui") {
    return presentInlinePermissionPrompt(view, title, payload, options);
  }
  const view_ = renderPromptDialog(payload, fallbackBudget(view.budget), plainPaint);
  return requestPermissionDecisionFromUi(view.ui, title, view_.lines.join("\n"), options);
}
```

`permission-dialog.ts` keeps its `message: string` parameter: the fallback is a one-shot render with no re-render trigger, so pushing the payload further would buy nothing.
The fallback substitutes a nominal width (80) for the terminal width it is never told, and the `select` implementation wraps as it does today.

`LocalUserAuthorizer` changes one argument (`details.message` → `details.payload`) and keeps emitting the broadcast from `details` first, so [#292] is untouched.
`PromptPreferences` — read live at prompt time so a config edit applies to the next ask — gains the two budget numbers alongside `doublePressToConfirm`, and `index.ts` reads them from `configStore.current()`.

### Known incompleteness, recorded not fixed

The `input` evidence entry is produced by `ToolPreviewFormatter`, which truncates at `toolInputPreviewMaxLength` **before** the payload is built.
So for a non-bash tool ask the "complete view" is complete with respect to the payload, not to the raw tool input.
That is the pre-existing gap [ADR 0011] §5 closes by subsuming those caps in Step 3 ([#745]); this issue neither widens nor narrows it.

## Module-Level Changes

Added:

- `packages/pi-permission-system/src/presentation/dialog-renderer.ts` — `DialogBudget`, `DialogView`, `Paint`, `renderPromptDialog`, the unbounded budget constant, and the whole-token highlight helper.
- `packages/pi-permission-system/test/presentation/dialog-renderer.test.ts` — the renderer's unit suite.

Changed:

- `src/authority/permission-prompt-component.ts` — `requestPermissionDecision` / `presentInlinePermissionPrompt` / `PermissionPromptComponent` take a `PromptPayload`; `PermissionPromptView` and `PromptPreferences` carry the budget; the component holds an `expanded` flag, renders through `renderPromptDialog`, and `handleToolsExpandAction` toggles it as well as forwarding to the host; the hint line gains the conditional affordance.
- `src/authority/local-user-authorizer.ts` — passes `details.payload`.
- `src/authority/authorizer.ts` — `AuthorizerSelectionDeps` re-exports the widened `PromptPreferences`; type-only.
- `src/index.ts` — `getPromptPreferences` reads `promptMaxRows` / `promptFieldMaxWidth` from the config store.
- `src/config-schema.ts` — the two optional integer fields with `.meta({ description, markdownDescription })`.
- `schemas/permissions.schema.json` — regenerated by `pnpm run gen:schema` (never hand-edited; a parity test fails on drift).
- `src/extension-config.ts` — fields on `PermissionSystemExtensionConfig` plus their `normalizePermissionSystemConfig` carry-through.
  Not added to `DEFAULT_EXTENSION_CONFIG` as explicit `undefined` (breaks `deepEqual` tests); the renderer applies the defaults.
- `src/config-loader.ts` — both names added to `mergeUnifiedConfigs`'s "Number scalars" loop and to the scalar-knob comment above it.
- `config/config.example.json` — both fields, alongside the existing preview caps.
- `docs/configuration.md` — two rows in the config table (after `toolTextSummaryMaxLength`), and the inline-dialog section's `Ctrl+O` paragraph (line 132) reworded: the binding now expands the prompt itself as well as the host's tool preview.
- `README.md` — the `Ctrl+O` sentence (line 69) matched to the new behavior, and the dialog description noting the bounded default.
- `docs/architecture/architecture.md` — the `Prompt presentation` section's "The payload exists; the bounded renderers do not yet" paragraph rewritten for the landed dialog renderer (the review log, wire, and broadcast still read `message`); the `presentation/` module-tree block gains a `dialog-renderer.ts` entry, whose issue citation is limited to the active constraints it encodes (the §3-over-§5 precedence and the display-only `executedUnit`); Step 2 marked `✅` on its heading, its Mermaid node, and with a `Landed:` note; the open-issue sweep dispositions for [#713], PR [#738], and PR [#716] updated to record that they close with this step.
  No health-metric row changes: the phase table has no Step 2 row, and its dated `Baseline` column is a phase-open snapshot.
- `.pi/skills/package-pi-permission-system/SKILL.md` — a sentence in the log/redaction area distinguishing a bounded render from redaction (the never-redact rule is unchanged), and the config-field list gaining the two budget knobs.

Test files updated (each constructs one of the changed shapes):

- `test/authority/permission-prompt-component.test.ts` — passes payloads instead of message strings; new cases for the bounded render, the `Ctrl+O` toggle, and the retained host forward.
- `test/authority/local-user-authorizer.test.ts` — asserts the payload argument; the broadcast assertions stay as they are.
- `test/authority/permission-dialog.test.ts` — unchanged signature, re-verified.
- `test/helpers/authorizer-fixtures.ts` — the `PromptPreferences` factory gains the budget fields.
  This is the "new required field on a shared interface" case: the grep target is *constructors* of `PromptPreferences` / `PermissionPromptView`, not use sites, since there is no `<field>: undefined` literal to match.
- `test/config-loader.test.ts`, `test/extension-config.test.ts`, `test/config-schema.test.ts`, `test/config-reporter.test.ts` — the new scalars' merge, normalization, and schema parity.

Verified-unchanged (greps run at planning): `renderLegacyMessage` and every payload builder; `permission-prompter.ts`'s review-entry `message`; `permission-ui-prompt.ts`'s `buildUiPrompt`; `approval-escalator.ts`'s wire `message`; `forwarding-io.ts`'s request parsing; `config-modal.ts` (it lists on/off toggles only, and neither new field is boolean).

## Test Impact Analysis

- **Newly possible.**
  The bound itself becomes directly testable for the first time: `renderPromptDialog` is a pure function from `(payload, budget)` to lines, so a row-count assertion needs no TUI, no component, and no terminal.
  The [#710] repro — a 200-line here-string forwarded payload — becomes a single unit assertion (`view.lines.length <= budget.maxRows` plus core presence), which is exactly the "bound test for a pathological input" [ADR 0011]'s plan named as missing.
- **Becomes redundant.**
  Nothing yet.
  The ~29 relocated string assertions in `test/presentation/legacy-message.test.ts` still pin `message` for the three consumers that keep reading it, and they retire with [#745] / [#746], not here.
  The component tests that asserted a message string appears verbatim in the rendered lines are *replaced* rather than removed: the same behavior is now "the core facts appear", which is what the contract actually promises.
- **Must stay as-is.** `local-user-authorizer.test.ts`'s broadcast cases (they exercise `buildUiPrompt`, a [#292] invariant orthogonal to rendering); `permission-prompt-decision.test.ts` (the pure interaction model, untouched); `permission-dialog.test.ts` (the fallback's select/input protocol).

## Invariants at risk

| Invariant                                                                              | Owner      | Pinned by                                                                                                                                                      |
| -------------------------------------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app.tools.expand` still reaches the host while the dialog holds focus                 | [#642]     | existing `permission-prompt-component.test.ts` case asserting `setToolsExpanded` is called; extended to assert it is **still** called once the toggle is added |
| A forwarded ask's `permissions:ui_prompt` broadcast stays non-degraded                 | [#292]     | `local-user-authorizer.test.ts` broadcast cases, unchanged                                                                                                     |
| `PromptPermissionDetails.payload` is required, so every ask carries a complete payload | [#744]     | the type; gate descriptor tests asserting kind and value                                                                                                       |
| `message` stays byte-identical for the log, the wire, and the broadcast                | [#744]     | `test/presentation/legacy-message.test.ts`, untouched by this issue                                                                                            |
| The prompt's tool input is never redacted                                              | [ADR 0010] | a renderer test asserting the complete view reproduces the field verbatim — a cap that could not be undone would be redaction by another name                  |

Quantitative invariant, measured at planning and re-asserted as a test:

| Case                                                  | Baseline (measured)                             | After (predicted)                               |
| ----------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| 200-line here-string, forwarded ask, width 80/120/160 | 205 rows                                        | ≤ 24 rows of render + 4 option rows + hint      |
| 200-line here-string, local bash ask, same widths     | 202 rows                                        | same bound                                      |
| Single-line 10 236-char command, width 120            | ~86 rows (arithmetic from the same measurement) | ≤ `ceil(400 / 120)` = 4 rows for the value line |

## TDD Order

1. **The renderer's core lines.**
   Red: `test/presentation/dialog-renderer.test.ts` asserts one aligned `label : value` line per core fact across all nine payload kinds, the per-kind value label, the omission rules (no `rule` line without a matched pattern, no `runs` line without an executed unit, no `agent` line for an unnamed local ask), and the invoked-tool suffix.
   Green: `renderPromptDialog` with an unbounded budget and identity paint.
   Commit: `feat(pi-permission-system): render the prompt payload as aligned fact lines (#710)`.
2. **Evidence lines.**
   Red: evidence renders after the core in payload order, under its own label, with `detail` appended as `text → detail` on the same line.
   Commit: `feat(pi-permission-system): render prompt evidence entries under the core facts (#710)`.
3. **The per-field width cap.**
   Red: a field longer than `fieldMaxWidth` is clipped with a trailing `…` and no counts, for a core field and an evidence field alike; the unbounded budget reproduces the field verbatim.
   Commit: `feat(pi-permission-system): cap each rendered prompt field to the width budget (#710)`.
4. **The row bound.**
   Red: evidence is dropped to fit `maxRows` counted after wrapping to `width`, a single `…` line marks the drop, `DialogView.elided` reports it, and a capped core exceeding the budget still renders in full with no evidence.
   Includes the [#710] repro assertion (200-line here-string → within budget, core intact).
   Commit: `feat(pi-permission-system): bound the rendered prompt to a row budget (#710)`.
5. **Highlighting the flagged element.**
   Red: the value line paints; whole-token occurrences inside evidence paint; `ls` stays plain inside `lsof` and `/etc/hosts` inside `/etc/hostsbackup`; `bash_external_directory` paints each external path instead of the command; the identity paint leaves text unchanged.
   Commit: `feat(pi-permission-system): highlight the flagged element in the rendered prompt (#710)` with `Co-authored-by: Dustin Fox <unrelentingfox@users.noreply.github.com>`.
6. **Config plumbing.**
   Red: `test/config-loader.test.ts` and `test/extension-config.test.ts` assert `promptMaxRows` / `promptFieldMaxWidth` survive merge and normalization; `test/config-schema.test.ts` asserts schema parity after `pnpm run gen:schema`.
   Green: `config-schema.ts`, `extension-config.ts`, `config-loader.ts`, `config/config.example.json`.
   Commit: `feat(pi-permission-system): add promptMaxRows and promptFieldMaxWidth (#710)`.
7. **Wire the renderer into the dialog and the fallback.**
   One commit by necessity: the dispatcher's parameter changes from `message: string` to `payload: PromptPayload`, which breaks `local-user-authorizer.ts`, the `PromptPreferences` shape, `index.ts`, and four test files at the type level simultaneously.
   Red: a component test renders a pathological forwarded payload at width 120 and asserts the total row count is bounded, plus the fallback passes the same bounded lines to `ui.select`.
   Credit PR [#716]'s rendering intent here: `Co-authored-by: Marcel Feix <marcel.feix@exxcellent.de>`.
   Commit: `fix(pi-permission-system): bound the permission dialog to a row budget (#710)`.
8. **The complete-view toggle.**
   Red: `Ctrl+O` toggles the component between the bounded and complete renders **and** still calls `ui.setToolsExpanded`; the hint advertises the affordance only when the view elided something.
   Commit: `feat(pi-permission-system): expand the permission dialog to the complete request on Ctrl+O (#710)`.
9. **Documentation.**
   `README.md`, `docs/configuration.md`, `docs/architecture/architecture.md` (prose, module tree, Step 2 `✅` + Mermaid node + `Landed:` note + sweep dispositions), and the package skill.
   Verify with `pnpm exec rumdl check` and a Mermaid render check on the touched diagram.
   Commit: `docs(pi-permission-system): document the bounded permission dialog (#710)`.

At ship: close [#713] as completed (its fact is now rendered), and close PR [#738] and PR [#716] as superseded with credit, per the roadmap's recorded dispositions.

## Risks and Mitigations

- **Risk: the bound hides what the user needed to decide.**
  This is the correctness failure [ADR 0011] §1 names, not a cosmetic one.
  Mitigated by the core being exempt from the row bound, by the field cap applying uniformly rather than by content, and by the complete view being one keystroke away — each pinned by a test rather than by this paragraph.
- **Risk: the `Ctrl+O` overload regresses [#642].**
  Mitigated by extending the existing forward-to-host assertion in the same cycle that adds the toggle, so a regression fails a test that already exists.
- **Risk: the new config fields are silently dropped.**
  The #332 / #347 class.
  Mitigated by cycle 6 asserting merge and normalization before the renderer reads them, and by `normalizePermissionSystemConfig` reading the typed `UnifiedPermissionConfig` so a schema omission is a compile error.
- **Risk: a default that is too small annoys, too large fails to fix the report.**
  24 rows plus four option rows and a hint fits a 30-row terminal; the measured 205-row case drops to roughly 11.
  Both numbers are configurable, and the field cap (400 characters ≈ 4 rows at width 100) is what does the work for the reported case.
- **Risk: the aligned layout breaks a consumer that string-matched the old prose.**
  Only the two local renderers change; `message` is untouched, so the review log, the wire, and the broadcast see no difference.
  Pinned by leaving `legacy-message.test.ts` untouched and green.
- **Risk: the highlight derivation diverges from the rendered text.**
  PR [#738] guarded this by asserting painted output against the real formatter message.
  Deriving the flagged element from `request.value` — the same field the value line renders — removes the divergence structurally; the tests assert both together anyway.

## Open Questions

- Whether the fallback should eventually gain a complete-view affordance (a fifth `select` option that re-presents the ask in full).
  Deliberately deferred: [ADR 0011] §6 assumes none, and the RPC/frontend surface is [#519]'s standing constraint.
  No follow-up issue filed — this is a recorded rationale, not deferred work.
- Whether `promptFieldMaxWidth` should later be expressed in rows rather than characters, once the renderer owns wrapping.
  Characters match the existing preview-cap vocabulary operators already know; revisit if [#745]'s subsumption changes that vocabulary.
- Whether the `context` (`commandContext`) line reads better folded into the `rule` line, as `renderLegacyMessage`'s `matchQualifier` does today.
  A layout question to settle against real output during implementation; both keep the fact visible.

[#292]: https://github.com/gotgenes/pi-packages/issues/292
[#519]: https://github.com/gotgenes/pi-packages/issues/519
[#642]: https://github.com/gotgenes/pi-packages/issues/642
[#654]: https://github.com/gotgenes/pi-packages/issues/654
[#710]: https://github.com/gotgenes/pi-packages/issues/710
[#713]: https://github.com/gotgenes/pi-packages/issues/713
[#716]: https://github.com/gotgenes/pi-packages/pull/716
[#738]: https://github.com/gotgenes/pi-packages/pull/738
[#744]: https://github.com/gotgenes/pi-packages/issues/744
[#745]: https://github.com/gotgenes/pi-packages/issues/745
[#746]: https://github.com/gotgenes/pi-packages/issues/746
[ADR 0010]: ../decisions/0010-permission-log-secret-exposure.md
[ADR 0011]: ../decisions/0011-prompt-presentation-contract.md
