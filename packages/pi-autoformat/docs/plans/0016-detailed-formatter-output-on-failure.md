---
issue: 2
issue_title: "Support optional detailed formatter output in reports"
---

# Plan: Detailed Formatter Output on Failure (Issue #2)

## Problem Statement

The executor already captures every formatter run's `stdout` and `stderr` on `BatchRun`, but the reporting layer discards it.
On a failure the user sees only `formatter (exit N): file1, file2` and has no way to see the parser error, lint message, or stack trace that the formatter actually printed.
That makes debugging a failed prompt-end format require re-running the formatter by hand, which defeats the point of letting the extension run it.

The issue asks for an opt-in config knob that surfaces formatter output without making the happy path noisy or undermining the v1 "non-blocking, concise" reporting stance.

## Goals

- Add an opt-in config object that, when enabled, includes formatter output in the failure notification / log block.
- Default behavior is unchanged: no formatter output in any user-facing surface.
- Surface output **only for failed runs** (success runs stay quiet, even when the option is on).
- Truncate output to a small, predictable budget per run so a chatty formatter cannot flood the TUI.
- Keep the status-line and success paths untouched — this is a failure-debugging surface only.
- Apply identical truncation/format rules to TUI (`notify`) and non-TUI (`console.warn`) sinks.

This change is **not** breaking: a new optional config object with safe defaults, no schema renames, no result-shape changes.

## Non-Goals

- Surfacing successful-run output (out of scope; the issue is debugging-focused).
- Streaming formatter output during the run.
  Output appears in the post-flush summary like everything else.
- A separate widget / pane / file for full output.
  If the truncated tail isn't enough, the user can re-run the formatter directly; we link to the captured `command` array in the existing report.
- Diverging interactive vs non-interactive *content*.
  Both surfaces get the same truncated block; only the carrier (`notify` vs `console.warn`) differs, matching what `defaultReportFlushResult` already does.
- Changing strict-mode / blocking semantics (#6).
  Failures stay non-blocking; this only changes how loud they are.
- Persisting full output to disk (e.g. `.pi/extensions/pi-autoformat/last-run.log`).
  Defer until someone asks; mechanism is forever.
- Exposing `BatchRun.stdout`/`stderr` on any new public type.
  We read what the executor already captures.

## Background

Relevant existing pieces:

- `src/formatter-executor.ts`
  - `BatchRun` already carries `stdout?: string` and `stderr?: string` for every run, populated by `runner` (see `createCommandRunner` in `src/extension.ts`, which captures both via `execFileAsync`).
  - On exec failure, `normalizeExecError` falls back to `error.message` for `stderr`, so we always have *something* to print on a failure.
- `src/extension.ts`
  - `summarizeFailures(result)` builds the per-batch failure lines but ignores `run.stdout` / `run.stderr`.
  - `buildLegacyFailureMessage(summary)` joins those lines into the multi-line block passed to `reportMessage(ctx, message, "warning")`.
  - `reportMessage` routes to `ctx.ui.notify(..., "warning")` on TUI and `console.warn` otherwise.
  - `formatStatusLine` builds the footer text.
    It must not change.
- `src/formatter-config.ts`
  - `AutoformatConfig` and `DEFAULT_FORMATTER_CONFIG` are the single source of truth for runtime config.
  - Pattern for nested config objects with partial-merge already exists for `eventBusMutationChannel` and `shellMutationDetection`; we follow the same shape.
- `schemas/pi-autoformat.schema.json` — top-level keys with `additionalProperties: false`.
  New key needs a `$defs` entry and a top-level property.
- `docs/configuration.md` and `README.md` — both list every public config key.

## Design Overview

### Config shape

A new top-level optional object `formatterOutput` controls failure-output surfacing.

```typescript
export type FormatterOutputOnFailure = "none" | "stderr" | "both";

export type FormatterOutputReportingConfig = {
  /** Which streams to include for *failed* runs. */
  onFailure: FormatterOutputOnFailure;
  /** Hard byte cap per stream per run (UTF-8 byte length). */
  maxBytes: number;
  /** Hard line cap per stream per run (after byte trimming). */
  maxLines: number;
};

export const DEFAULT_FORMATTER_OUTPUT_REPORTING: FormatterOutputReportingConfig = {
  onFailure: "none",
  maxBytes: 4096,
  maxLines: 40,
};
```

Defaults preserve today's behavior (`onFailure: "none"` → nothing extra is printed, even for failures).
The two caps are advisory until `onFailure !== "none"`, but we keep them on the type unconditionally so users can tune them once and flip the switch.

`UserFormatterConfig` gains an optional `formatterOutput?: Partial<FormatterOutputReportingConfig>` and `createFormatterConfig` merges it via the same `{...default, ...user}` spread used for sibling objects.

### Reporting surface

Only the *failure* notification body changes.
Status line, success body, and config-issue body are untouched.

Existing failure block (TUI notify / non-TUI `console.warn`):

```text
Formatter failures in 1 batch:
prettier (exit 2): src/foo.ts
```

With `formatterOutput.onFailure: "stderr"`:

```text
Formatter failures in 1 batch:
prettier (exit 2): src/foo.ts
  stderr:
    src/foo.ts: SyntaxError: Unexpected token (3:11)
      1 | export const a = 1
      2 | export const b = 2
    > 3 | export const = 3
        |              ^
  ... 12 more lines
```

With `"both"`, an analogous indented `stdout:` block appears immediately above `stderr:` (only when stdout is non-empty after trimming).
Empty streams are skipped entirely — no `stderr: (empty)` noise.

### Truncation

Per run, per stream:

1. Drop trailing whitespace.
2. If `Buffer.byteLength(text, "utf8") > maxBytes`, keep the **last** `maxBytes` bytes, snap forward to the next newline boundary so we never bisect a multi-byte character mid-sequence, and prefix with `... (truncated, N earlier bytes)`.
   The tail is what users want for a stack trace / parser error.
3. If the resulting line count exceeds `maxLines`, keep the last `maxLines` lines and prefix with `... (truncated, N more lines)`.
4. Indent every surviving line by 4 spaces under the `stderr:` / `stdout:` header (2-space header indent, 4-space body indent — matches existing failure-line conventions).

The byte cap runs first because some formatters emit megabyte-scale output; line cap is the secondary safety net for line-noisy output that fits under the byte cap.
Counts in the truncation marker reflect what was dropped from the original.

### Edge cases

- **Stream undefined** (formatter never wrote): skip the corresponding block.
- **Stream non-empty but only whitespace**: skip.
- **`stdout` only on success**: never surfaced (we only annotate failed runs).
- **`onFailure: "none"`**: byte/line caps are irrelevant; do not even compute trimming.
- **Multiple failed runs in one flush**: each gets its own indented block under its own `formatter (exit N): files` line.
  No interleaving.
- **Fallback runs**: if a fallback formatter fails, the existing `formatterLabel(name, fallbackContext)` line is unchanged; the output block sits beneath it.
- **Config issue: invalid `onFailure` value**: handled by `loadAutoformatConfig`'s existing schema-driven validation path, surfaces via `reportConfigIssues`, and the value falls back to the default.
- **Tiny `maxBytes` (e.g. `0` or `10`)**: respected; we render the truncation marker plus whatever fits.
  Schema enforces `minimum: 0` for both caps.

### Separation of concerns

The trimming/formatting logic lives in a new pure helper module so it is straightforward to unit test and so `extension.ts` doesn't grow another responsibility:

- `src/formatter-output-report.ts` exports `formatRunOutputBlock(run, config): string | undefined` returning the indented block (or `undefined` if nothing to print).
- `summarizeFailures` and `buildLegacyFailureMessage` in `src/extension.ts` accept the new config and call the helper per failed run.

## Module-Level Changes

- `src/formatter-config.ts`
  - Add `FormatterOutputOnFailure`, `FormatterOutputReportingConfig`, `DEFAULT_FORMATTER_OUTPUT_REPORTING`.
  - Extend `AutoformatConfig` and `UserFormatterConfig` with `formatterOutput`.
  - Merge in `createFormatterConfig` (object spread).
- `src/formatter-output-report.ts` (**new**)
  - `formatRunOutputBlock(run, config)` — pure, no I/O, no Pi API surface.
  - Internal helpers: `trimStream(text, { maxBytes, maxLines })`, `indentLines(text, prefix)`.
- `src/extension.ts`
  - Thread `config.formatterOutput` into `summarizeFailures` (or a sibling that builds enriched lines).
  - `buildLegacyFailureMessage` interleaves the per-run output blocks beneath each failure line.
  - No change to `formatStatusLine` or any success path.
- `schemas/pi-autoformat.schema.json`
  - Add `formatterOutput` property + `$defs/formatterOutputReportingConfig` with `onFailure` enum and `maxBytes` / `maxLines` integers (`minimum: 0`).
- `docs/configuration.md`
  - New `### formatterOutput` section under Settings reference, with the default object, an example enabling `"stderr"`, and a note that successful runs are never surfaced.
- `README.md`
  - Replace the "reporting is intentionally concise and does not yet expose full formatter stdout/stderr by default" line with a forward reference to the new option.
- `test/formatter-output-report.test.ts` (**new**)
  - Trimming and indentation behavior; see TDD Order.
- `test/extension.test.ts`
  - Add cases for the failure-block enrichment under each `onFailure` value.
- `test/formatter-config.test.ts` and `test/config-loader.test.ts`
  - Cover defaults, partial merge, and schema validation of bad values.
- `test/schema.test.ts`
  - Lock in the new schema entry and `additionalProperties: false` rejection of typos under `formatterOutput`.

## TDD Order

1. **test: cover trimStream byte and line caps**
   - In a new `test/formatter-output-report.test.ts`, drive `trimStream` (or `formatRunOutputBlock` directly with crafted strings) through: empty string → `undefined`, whitespace-only → `undefined`, under both caps → unchanged, byte-cap exceeded → tail with marker, line-cap exceeded → tail with marker, multibyte boundary not bisected.
   - Commit: `test: cover formatter output trimming and indentation`.
2. **feat: add formatRunOutputBlock helper**
   - Implement `src/formatter-output-report.ts` to make step 1 pass.
   - Commit: `feat: add formatter run output trimming helper`.
3. **test: extend AutoformatConfig with formatterOutput defaults**
   - In `test/formatter-config.test.ts`, assert the default object on `AutoformatConfig` and that `createFormatterConfig` merges a partial `formatterOutput` user object field-by-field.
   - Commit: `test: cover formatterOutput config defaults and merge`.
4. **feat: thread formatterOutput through config**
   - Add the new types/defaults and merge logic in `src/formatter-config.ts`.
   - Commit: `feat: add formatterOutput config object with safe defaults`.
5. **test: validate formatterOutput in schema and loader**
   - In `test/schema.test.ts`, assert the property and reject an unknown sub-key.
   - In `test/config-loader.test.ts`, assert that an invalid `onFailure` produces a `ConfigValidationIssue` and falls back to the default.
   - Commit: `test: lock formatterOutput schema and loader validation`.
6. **feat: extend schema with formatterOutput**
   - Update `schemas/pi-autoformat.schema.json`; ensure step 5 passes.
   - Commit: `feat: surface formatterOutput in the JSON schema`.
7. **test: enrich failure block under each onFailure value**
   - In `test/extension.test.ts`, drive `defaultReportFlushResult` with a single failed run carrying `stdout` + `stderr` content, under `onFailure: "none"` (block omitted), `"stderr"` (only stderr block), `"both"` (stdout above stderr).
   - Assert empty stdout under `"both"` does not produce an empty header.
   - Assert successful runs are never annotated even with `"both"`.
   - Commit: `test: cover formatter output reporting on failed runs`.
8. **feat: include formatter output in failure notifications**
   - Wire `config.formatterOutput` through `summarizeFailures` / `buildLegacyFailureMessage` in `src/extension.ts` to make step 7 pass.
   - Commit: `feat: surface failed formatter output in reports`.
9. **test: respect truncation under realistic chatty output**
   - One end-to-end test feeding a multi-kilobyte stderr through the full failure path, asserting the marker appears and the tail is preserved.
   - Commit: `test: lock truncation behavior in the failure report`.
10. **docs: document formatterOutput**
    - Update `docs/configuration.md` with the new section and example; update the `README.md` "Known v1 limitations" line to point at the option.
    - Commit: `docs: document the formatterOutput failure reporting option`.

## Risks and Mitigations

- **Risk: chatty formatters flood the TUI even when truncated.**
  Mitigation: byte cap runs before line cap; defaults (4 KiB / 40 lines) keep one failure under one screen.
  Caps are configurable for users who need more.
- **Risk: secrets leak through formatter output (e.g. file contents in error messages).**
  Mitigation: the option is opt-in and off by default; documented as such.
  We do not snapshot output to disk.
- **Risk: schema additions break existing configs because of `additionalProperties: false`.**
  Mitigation: the new key is optional, defaults preserve current behavior, and existing configs without it remain valid.
- **Risk: truncation marker confuses users who expect to see the full output.**
  Mitigation: marker phrasing names the byte/line counts dropped; docs explain the cap and how to raise it.
- **Risk: differing TUI vs non-TUI output drift.**
  Mitigation: both sinks consume the same string built by the same helper; covered by tests.
- **Risk: formatters that emit useful info on stdout (not stderr) are missed under `"stderr"`.**
  Mitigation: `"both"` covers them; documented in the configuration reference.

## Open Questions

- Should the success path eventually expose a "verbose summary" (formatter stdout for successful runs) for debugging "did this formatter actually do anything?" cases?
  Defer; not what the issue asks for.
- Should we add a separate `onSuccess` knob mirroring `onFailure`?
  Defer until requested; current scope keeps the surface narrow.
- Should the truncated tail be replaced with the *head* for formatters whose first lines are most informative (e.g. compiler diagnostics that print the error first then a giant context dump)?
  Tail-first matches the dominant case (parser errors print last); revisit if user feedback says otherwise.
- Should we ever write full output to a per-run log file under `.pi/extensions/pi-autoformat/`?
  Defer; mechanism is forever, this is reversible from docs.
