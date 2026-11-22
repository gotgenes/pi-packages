---
issue: 647
issue_title: "pi-permission-system: permission review logs may persist secrets with inherited file modes"
---

# Retro: #647 — pi-permission-system: permission review logs may persist secrets with inherited file modes

## Stage: Planning (2026-07-25T19:52:14Z)

### Session summary

Planned the response to a third-party security report from `marcoscale98` claiming the permission review log persists secrets with umask-inherited file modes.
The direction gate ran twice: an initial `ask_user` settled the file-mode half and the mode scope, and the operator deferred the redaction half to free-form discussion, which converged on key-name masking plus ADR 0010.
Produced `packages/pi-permission-system/docs/plans/0647-owner-only-log-modes-key-name-redaction.md` with six TDD cycles.

### Observations

- **Measuring the live corpus changed the design.**
  The operator's own review log (6.7 MB, 8380 lines, mode 0644) was probed for the shapes a value-based redactor would target.
  `sk-` had 403 hits, of which 356 were the tail of `task-approval` and 275 of `task-user`; `xox` matched inside a tool-use id.
  True positives: zero.
  That evidence, not an argument from principle, is what retired the provider-prefix list — and it belongs in the ADR so the next reporter is triaged against data.
- **A structural fact invalidated the obvious design.**
  The first instinct was a single redaction choke point at `writeLine` in `logging.ts`.
  Reading `permission-prompter.ts:135` showed `toolInputPreview` arrives there already flattened to a string by `serializeToolInputPreview`, so that choke point would have missed the reporter's literal repro (`authorization: "Bearer TEST_VALUE"` as a tool-input field).
  The plan therefore redacts at two points, and the reason is written down rather than left to be rediscovered.
- **Ecosystem precedent settled a question the operator flagged as outside their experience.**
  Pino's `redact`, Winston's formats, and Serilog's destructuring policies are all declarative key-path masking; secret *detection* is a separate product category (gitleaks, trufflehog).
  Naming that precedent turned "I have no experience engineering this" into a bounded, fifteen-line decision.
- **A downstream `registerLogRedactor` seam was considered and declined.**
  It would have mirrored the three existing registries exactly, so novelty was low — but it would ship with zero consumers, which the package skill's maintenance-trap rule explicitly targets, and the operator confirmed they would not consume it.
- **Grammar-anchored bash redaction was costed, not filed.**
  Masking the value side of a `variable_assignment` in the existing tree-sitter parse would extend coverage to `FOO_TOKEN=abc deploy` with near-zero false positives, reusing #481/#645 machinery.
  Recorded in the ADR as the option a future report reopens; deliberately not filed as an issue, to avoid a speculative backlog entry.
- **Two grep findings would have bitten implementation.**
  `test/tool-input-preview.test.ts` and `test/tool-preview-formatter.test.ts` mock `safeJsonStringify` by **relative** specifier (`../src/logging.js`), not the `#src/` alias — an alias-only grep misses both, and a missed retarget fails at run time rather than under `tsc`.
  Separately, `safeJsonStringify`'s cycle / `Error` / `bigint` handling has no test at all, so the step-1 move needs characterization tests written first.
- **Scope held.**
  `config-store.ts`'s config write was offered in the mode-scope gate and not selected; forwarding request/response files were.
  Those files get modes but not redaction, since the parent reads them to render the ask-prompt — the same reason the prompt path itself stays unredacted.
- Classified non-breaking (`fix:`): the review log is a diagnostic artifact with no documented consumer contract, and the docs never guaranteed verbatim payloads.

## Stage: Implementation — TDD (2026-07-25T20:25:08Z)

### Session summary

Executed all six planned TDD cycles plus one Tidy-First preparatory commit, landing owner-only file modes for both JSONL logs and the permission-forwarding artifacts, key-name redaction at two application points, and ADR 0010.
Eight commits total; test count went from 2603 to 2665 (+62) across 127 → 130 files.
Pre-completion reviewer returned PASS on every section.

### Observations

- **The reds were real measurements, not ceremony.**
  Step 4's red reported `expected 420 to be 384` and `expected 493 to be 448` — that is `0o644` and `0o755`, reproducing the reporter's exact claim about umask-inherited modes before a line of the fix existed.
  Step 3's red reproduced the literal repro from the issue body.
- **The two-application-point design was load-bearing, and the plan was right to insist on it.**
  Redaction at `writeLine` alone would have left the reporter's own repro unfixed, because `getToolInputPreviewForLog` flattens tool input to a string before the writer ever sees its keys.
  The reviewer independently confirmed both points are covered and that no log write path bypasses `writeLine`.
- **The `vi.mock` partial-module trap fired exactly where the testing skill warns.**
  `test/tool-preview-formatter.test.ts` replaced `#src/json-safe-stringify` with a literal factory exporting only `safeJsonStringify`, which would have blanked out the `createJsonSafeReplacer` that `log-redaction.ts` builds on.
  Fixed with an `importActual` spread.
  Three existing `formatGenericToolInputForLog` tests also had to move to real serialization, since the log path no longer routes through the mocked prompt-path serializer — a net improvement, as they now assert real behavior.
- **Characterization tests before the move paid off immediately.**
  `safeJsonStringify`'s cycle / `Error` / `bigint` handling had zero coverage because both consumers mocked it away.
  Writing the eight tests first surfaced an undocumented quirk worth pinning: a repeated *non-cyclic* reference is also marked `[Circular]`, because `seen` entries are never released.
- **Deviation: `test/extension-config.test.ts` was touched but not named in the plan.**
  The logs-directory mode assertions had to live there, because `ensurePermissionSystemLogsDirectory` is in `src/extension-config.ts` and `test/logging.test.ts` supplies its own `ensureLogsDirectory` callback, so it cannot exercise the real one.
  The plan's Module-Level Changes should have caught this.
- **Deviation: an extra `docs:` commit for a distribution gap the plan missed.**
  `configuration.md` and `troubleshooting.md` ship in the npm tarball; `docs/decisions/` does not, so the ADR links would have been dead for anyone reading the installed package.
  Resolved by following the absolute-GitHub-URL precedent already set in `docs/subagent-integration.md` rather than adding `docs/decisions` to the `files` allowlist, which would ship ten internal design records to serve one user-facing reference.
  Verified with `pnpm pack` + `tar tzf`.
- **The permission gate caught an agent mistake mid-session.**
  An `Edit` call dropped the `pi-packages/packages/` prefix from a path; the `external_directory` gate blocked it and named the correct location.
  A live demonstration of the thing being hardened.
- **Tidy-First assessor was well-scoped.**
  One recommendation (extract a shared temp-dir fixture in `test/logging.test.ts`, which was about to gain two new scenarios), and its rejected list correctly declined three in-scope-but-unobstructive modules.
  It also recognized that the plan's own step-1 sequencing already *was* the tidy-first move for the riskiest friction rather than re-proposing it.
- Pre-completion reviewer: **PASS**, no warnings.
  It verified `isSensitiveLogKey` against every real key name the package logs and found no false positive — including confirming that the bash parser's internal `token` field is never logged directly.

## Stage: Final Retrospective (2026-07-26T00:58:10Z)

### Session summary

Single session carrying #647 from a third-party security report through planning, six TDD cycles, and release as `pi-permission-system-v23.0.2`.
Nine implementation commits landed owner-only file modes, key-name log redaction at two application points, and ADR 0010; the pre-completion reviewer returned PASS and both CI runs were green.
The decisive moment was not in the code but in the design gate, where the operator declined a four-option menu and asked a question that produced a better answer than any option on it.

### Observations

#### What went well

- **Measurement replaced argument at the design gate.**
  Rather than reasoning about whether a secret-shape redactor would work, the planning stage probed the operator's live 6.7 MB review log: 403 `sk-` hits of which 356 were the tail of `task-approval`, `xox` inside a tool-use id, and zero true positives.
  That single command retired an entire design direction and became the ADR's evidence table.
  The same instinct carried into the reds — `expected 420 to be 384` is `0o644` versus `0o600`, so the failing test *was* the bug report.
- **A structural reading of the code invalidated the obvious design before it was built.**
  Reading `permission-prompter.ts:135` showed `toolInputPreview` arrives at the writer already flattened to a string, so the natural single-choke-point design would have shipped without fixing the reporter's own repro.
  Catching this at plan time rather than at review time is what made the two-application-point design deliberate instead of a patch.
- **`pnpm pack` caught a distribution bug that every other gate missed.**
  `check`, `lint`, `test`, `fallow`, and the pre-completion reviewer were all green with two dead documentation links in the shipped tarball.
  Only unpacking the artifact surfaced it.
- **The permission gate under test blocked a real agent mistake.**
  An `Edit` dropped the `pi-packages/packages/` prefix and the `external_directory` gate refused it, naming the correct path.
  A live demonstration of the subject matter, mid-implementation.

#### What caused friction (agent side)

- `missing-context` — the first redaction `ask_user` offered four options (no redaction, grammar-anchored bash redaction, grammar-plus-shape-list, metadata-only logging), all constructed from first principles.
  None of them was key-name masking — the boring, fifteen-line, zero-maintenance technique that pino's `redact`, Winston's formats, and Serilog's destructuring policies all implement, and the one that actually shipped.
  The ecosystem precedent was never checked before the option set was built.
  Impact: one extra `ask_user` round-trip, and the correct answer arrived only because the operator asked "is there a low-hanging technical implementation that is very common?"
  No rework — but the design gate was one question away from converging on a worse option.
- `instruction-violation` (self-identified, at retro) — `/plan-issue` directs loading the `colgrep` skill before code exploration and the `design-review` skill before finalizing any design that extracts or changes shared interfaces.
  Neither was loaded; the plan extracted `safeJsonStringify` into a new module, which is squarely a `design-review` trigger.
  Impact: no rework.
  Exploration was mostly exact-symbol tracing where `grep` was the right tool, and the `tidy-first-assessor` plus the pre-completion reviewer independently covered the structural ground `design-review` would have.
  The gates were skipped without consequence, which is precisely why it is worth noting.
- `other` — an `Edit` call constructed the path `/Users/chris/development/pi/pi-permission-system/test/extension-config.test.ts`, dropping the `pi-packages/packages/` segment.
  Impact: one rejected tool call, corrected immediately; zero rework.
  The `external_directory` gate caught it, so the blast radius was a single retry rather than a file written outside the repo.
- `other` — the plan's Module-Level Changes did not name `test/extension-config.test.ts`, which had to absorb the logs-directory mode assertions because `test/logging.test.ts` stubs `ensureLogsDirectory` and cannot exercise the real one.
  Impact: a noted deviation, no rework.
  The plan reasoned about which `src/` module changed but not about which test file could actually reach it.

#### What caused friction (user side)

- Nothing that cost time — and one intervention worth naming as a model.
  When the redaction `ask_user` presented four options, the reply was "I don't know yet, let's discuss more free-form for now," followed by a question about what a downstream package could do and whether a common low-hanging implementation existed.
  That refusal to pick from a bad menu is what surfaced key-name masking.
  The generalizable lesson is agent-side, not user-side: an option set is itself a design artifact and can be wrong in ways none of its options reveal.

### Diagnostic details

- **Model-performance correlation** — planning and TDD ran on `anthropic/claude-opus-5`, ship on `anthropic/claude-sonnet-5`, retro on `anthropic/claude-opus-5`; that split matches task weight (judgment-heavy design and implementation on the stronger model, deterministic push/CI/merge choreography on the cheaper one).
  Two subagents: `tidy-first-assessor` and `pre-completion-reviewer`, both judgment tasks, both appropriately modelled.
  The session's model-change log also records switches to `opencode-go/deepseek-v4-flash`, `anthropic/claude-fable-5`, and `anthropic/claude-haiku-4-5`, which fall in the session's earliest segment — outside the readable transcript window, so which turns they ran could not be confirmed.
  Worth checking if planning quality ever regresses: the initial issue triage is judgment-heavy and is exactly where a flash-tier model would hurt.
- **Escalation-delay tracking** — no `rabbit-hole` friction points, so no escalation delay to measure.
  The longest same-topic sequence was five calls polling the release PR's `statusCheckRollup`; that was correct blocking behavior on a genuinely in-progress check, not a stall.
- **Unused-tool detection** — `colgrep` was available and never invoked.
  Most exploration was exact-symbol tracing (`safeJsonStringify`, `appendFileSync`, `writeJsonFileAtomic`) where `grep` is the correct choice per the `colgrep` skill's own decision table.
  The exception is the question that drove the whole design — "where does tool input get serialized on the way to the log?" — which is intent-shaped and was answered by manually reading four files.
- **Feedback-loop gap analysis** — no gap.
  `pnpm run check` plus the full package suite ran after every one of the five code-bearing TDD steps, not just at the end; each cycle confirmed a red before implementing; `pnpm run lint` ran at baseline, after the extraction, after the docs commit, and again pre-push.
  The one gate that ran only once was `pnpm pack`, and it was the one that found a bug — an argument for running it whenever a shipped doc gains a link.

### Changes made

1. `.pi/prompts/plan-issue.md` — appended a sentence to "Gather context" step 6: when a change introduces a mechanism a mature ecosystem already standardizes, check what established libraries do before building the `ask_user` option set.
   Step 6 already covered internal convention discovery (sibling packages, SDK terms); this is its external analog.
2. `AGENTS.md` — added a sentence to the docs-in-distribution convention: a link from a shipped doc into a non-shipped path resolves to nothing in the tarball, so use an absolute GitHub URL or add the target to `files`.
3. `packages/pi-permission-system/docs/retro/0647-owner-only-log-modes-key-name-redaction.md` — this Final Retrospective stage entry.

Considered and deliberately not landed: a prompt nudge to actually load the six skills `/plan-issue` lists (compliance failure, not a clarity failure), another "when a step changes X, grep Y" rule for the missed test file (that section already carries ~20), and a rule about running `pnpm pack` routinely (AGENTS.md already directs it; the real gap was link direction, which change 2 covers).
