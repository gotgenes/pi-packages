---
issue: 787
issue_title: "pi-permission-system: re-emit permissions:ready at the first before_agent_start (ADR 0012 decision 3, the ready latch)"
---

# Retro: #787 — The ready latch

## Stage: Planning (2026-08-21T17:49:34Z)

### Session summary

Planned [ADR 0012] decision 3 — the ready latch — as `packages/pi-permission-system/docs/plans/0787-ready-latch.md`.
The plan lands the latch inside `PermissionServiceLifecycle` (a `ReadyAnnouncer` role beside `ServiceLifecycle`, a once-per-activation flag, one private `emitReady` shared by both emissions) and triggers it from `before_agent_start` through a new `SessionTurnPrep` collaborator extracted from `AgentPrepHandler` in a preparatory `refactor:` commit.
Four TDD steps: the Tidy First extraction, the uncalled announcer, the wiring plus the composition-root emission-count test, then the doc-contract update.

### Observations

- **Three wiring shapes were put to the operator**, and the seam-into-`AgentPrepHandler` option won.
  A second `pi.on("before_agent_start", …)` is legal — verified in the installed `@earendil-works/pi-coding-agent@0.79.1` that `pi.on` appends to a per-event list and the runner iterates all of them — but `test/helpers/make-fake-pi.ts` keys handlers in a `Map<string, RecordedHandler>`, so a second registration would silently overwrite the first in every composition-root test.
- **The operator's worry about `AgentPrepHandler`'s growing responsibilities changed the plan's shape.**
  Rather than a fifth constructor dependency, the plan opens with a Tidy First extraction (`SessionTurnPrep`: warm trigger, `session.activate`, trust-gated `refreshConfig`, then the announcement), leaving the handler at four dependencies and one job.
  The operator explicitly chose in-scope over a separate preceding issue.
- **Breaking-change question, answered no.** The payload type is unchanged, an unguarded consumer's duplicate registration surfaces as bus-caught stderr noise, and — decisively — the same hazard already exists today, since `activate` emits on every `session_start` including `/reload`, which `docs/cross-extension-api.md` documents.
  The latch makes an existing failure class common, not a new one, matching [ADR 0012] decision 7's minor-with-callout classification.
- **Release stays `mid-batch — defer`.**
  [#699]'s plan and retro already fixed [#789] as the batch tail, so `/ship-issue` lands this on `main` and leaves the release-please PR carrying [#699]'s unreleased `feat:` commits open.
- **Two semantics decided rather than asked:** the payload is recomputed from the passed `ctx` on both emissions (one code path, no captured replay), and the latch re-arms on every `activate` so a reload generation gets its own post-`session_start` emission.
- **Test-drift hazard flagged for implementation:** `makeSetup` in `before-agent-start.test.ts` must build a **real** `SessionTurnPrep` over the same real session.
  A `{ prepare: vi.fn() }` double would skip `session.activate`, and the surviving prompt-sanitization assertions depend on an activated session's path normalizer.
- No follow-up issues filed: the only candidate (renaming `AgentPrepHandler`) is recorded as an Open Question, and `pi-permission-system` has no open improvement phase, so the `roadmap-fit` skill exits at its first step.

## Stage: Implementation — TDD (2026-08-21T18:06:50Z)

### Session summary

Landed the ready latch in four commits, exactly the plan's TDD order: extract `SessionTurnPrep` from `AgentPrepHandler` (`refactor:`), add the once-per-session `ReadyAnnouncer` to `PermissionServiceLifecycle` (`refactor:`, no caller yet), wire the trigger and pin the emission count at the composition root (`feat:`), then update the channel-contract docs (`docs:`).
The pi-permission-system suite went from 3215 to 3227 tests (+12: 7 new in `session-turn-prep.test.ts` after the 4 moved lifecycle tests, 5 in `service-lifecycle.test.ts`, 2 in `composition-root.test.ts`, 1 delegation test replacing the 4 moved ones in `before-agent-start.test.ts`).
All deterministic gates green at each commit; the pre-completion reviewer returned **PASS**.

### Observations

- **The Tidy First assessor found no additional preparatory work** and verified the plan's own claims instead — `PermissionSession` matches `TurnPrepSession` exactly, both constructor call-site counts were as measured, and the `ReadyAnnouncer`-beside-`ServiceLifecycle` dual-role shape already had a precedent in `SessionLifecycleHandler`'s dependency on the narrow `ServiceLifecycle`.
  It also confirmed `make-fake-pi.ts` needed no change for the new composition-root test: `before_agent_start` was already registered and in `EXPECTED_HANDLERS`, just never fired by any existing test.
- **The plan's named test-drift hazard was real and the mitigation held.**
  `makeSetup` in `before-agent-start.test.ts` builds a real `SessionTurnPrep` over the same real session, so the surviving prompt-sanitization assertions still run against an activated session.
  When step 3 added the announcer parameter, that fixture failed loudly (`Cannot read properties of undefined`) — a stub double would have silently skipped `session.activate` instead.
- **Deviation:** `src/handlers/index.ts` (the handlers barrel) was not in the plan's Module-Level Changes table but had to export `SessionTurnPrep` for `index.ts` to import it from the barrel per the `code-design` barrel rule.
  One line, no behavior; the reviewer confirmed it as the only gap.
- **Latch semantics pinned at two levels.**
  The unit tests own the guard (`announces only once per session`, `announces again after a further activate re-arms the latch`, `announces even when no activate preceded it`, `recomputes the facts from the ctx it is handed`); the composition-root tests own the observable count (2 emissions for one generation across two turns, 4 across a reload).
- **The docs step widened slightly beyond "correctness edits":** the Ready Event example in `docs/cross-extension-api.md` now shows the guarded registration plus its `session_shutdown` disposal, since the contract's whole obligation on a consumer is that guard.
  The wholesale rewrite stays with [#789].
- **Release unchanged:** `mid-batch — defer`.
  The release-please PR [#790] is still open and must stay so until [#789] lands, or the keyed channel ships without the latch.
- **Wrong-path friction:** one `Edit` was rejected by the permission gate for a hand-built absolute path missing the `packages/` segment — the repo-relative form is the reliable one, as `AGENTS.md` says.

## Stage: Final Retrospective (2026-08-21T18:25:02Z)

### Session summary

One session carried this issue from plan to ship: the `permissions:ready` latch (ADR 0012 decision 3) landed in four commits — a preparatory `SessionTurnPrep` extraction, an uncalled `ReadyAnnouncer`, the wiring plus emission-count tests, and the channel-contract docs.
The pi-permission-system suite went 3215 → 3227 tests, CI passed on `d39fe1f9`, and the issue closed with the release deliberately deferred behind [#789].
The defining moment was not in implementation but in the planning gate, where an operator note redirected the design from "add a fifth dependency" to "extract first, then add none."

### Observations

#### What went well

- **The `tidy-first-assessor` earned its dispatch by verifying rather than proposing.**
  It returned "no preparatory tidying warranted" — nominally a null result — but its report confirmed three plan assumptions I had asserted: that `PermissionSession` satisfies `TurnPrepSession` structurally (no adapter), that both constructor call-site counts were as measured (no lift-and-shift staging), and that `make-fake-pi.ts` needed no change because `before_agent_start` was already registered and in `EXPECTED_HANDLERS`, merely never fired.
  A null report that de-risks the plan is not a wasted dispatch.
- **A plan-time risk register actually fired.**
  The plan named one specific hazard — that `makeSetup` in `before-agent-start.test.ts` must build a **real** `SessionTurnPrep`, since the surviving prompt-sanitization assertions depend on an activated session.
  When step 3 added the announcer parameter, that fixture failed loudly (`Cannot read properties of undefined (reading 'announceReady')`) instead of silently skipping `session.activate`.
  Plan-time hazard lists usually rot before implementation; this one paid within two commits.
- **The package under development caught the agent developing it.**
  A hand-built absolute path missing the `packages/` segment tripped the `external_directory` gate, and the denial carried a corrective reason naming the exact fix ("This path is missing the `pi-packages/packages/` prefix.
  The correct location is: …").
  That is the [#635] corrective-reason feature working on its own author.
- **Verification was incremental, not terminal.**
  Every cycle ran a file-scoped `vitest` at Red and at Green, `pnpm run check` after each interface change, and the full package suite before each commit — no end-of-session surprise.

#### What caused friction (agent side)

- `premature-convergence` — the planning gate offered three wiring options (seam into `AgentPrepHandler`, a second `pi.on`, a composition-root lambda) that all shared one unexamined premise: that the latch trigger lands on the existing handler.
  The operator's note ("I'm starting to worry `AgentPrepHandler` might be getting too many responsibilities") produced the fourth option I had not offered — extract the per-turn preparation first, so the handler gains no dependency at all.
  I had the evidence in hand (I wrote "5 ctor deps" into option A's own description) and read it as an accepted cost rather than a design question, and the `design-review` skill was loaded but never run as a checklist against that decision.
  Impact: one extra `ask_user` round; without it the plan would have committed a five-dependency, three-responsibility handler.
  The correction produced the session's cleanest commit (`694898b9`), so the cost was one round-trip and the gain was structural.
- `missing-context` — the breaking-vs-non-breaking classification never reached the gate.
  ADR 0012 decision 7 had settled it (minor, with a release-note callout), so I treated it as closed and planned to state it only in the plan's Goals; the operator had to ask "Is idempotency requirement a breaking change?"
  as a gate note.
  The `/plan-issue` template lists breaking-vs-non-breaking as a gate-worthy ambiguity, but a *settled* classification and an *unasked* one look identical from the operator's side.
  Impact: one extra question in the second gate; no rework, and answering it surfaced the strongest supporting evidence (the hazard already existed on `/reload`), which then went into the plan and the commit body.
- `instruction-violation` (self-identified) — ran `rg -rn "before_agent_start" …`, where `-r` is `--replace`; every match came back rewritten to the literal `n` (`pi.on("n", …)`) with line numbers dropped.
  `AGENTS.md` § Shell and search documents this verbatim (Refs [#725]).
  Impact: one degraded readout I worked around by reading the files directly, plus a later `grep -rn` re-run; no rework.
- `instruction-violation` (self-identified) — passed a hand-built absolute path to `Edit` instead of the repo-relative form `AGENTS.md` requires (Refs [#726]), tripping the `external_directory` gate.
  Impact: one rejected tool call, corrected on the next.
- `other` — an `Edit` batch carried an unsupported `hint` key inside one `edits[]` entry; extra keys are silently ignored while the tool still reports success.
  Impact: none here (5 intended edits, 5 blocks reported, count verified), but it is exactly the silent-ignore class `AGENTS.md` warns about.

Both `instruction-violation` entries were violations of rules that already exist verbatim in `AGENTS.md`, and both were caught within one tool call — by mangled output and by the permission gate respectively.
That is a salience blip with working guardrails, not a documentation gap, so no rule change is proposed for either.

#### What caused friction (user side)

- Nothing that cost time.
  The two gate notes were the highest-leverage interventions of the session: the first reframed a wiring question as a design question, and the second forced the release-classification evidence into the open.
  Both arrived as questions attached to a chosen option rather than as post-hoc corrections, which is why neither required rework.
- The second note delegated the scope call back explicitly ("Or if it needs to be its own issue because the scope is so large, we can do that issue, first"), which is the right shape — it let the assessment happen where the file-level evidence was (4 files, one commit) instead of guessing at gate time.

### Diagnostic details

- **Model-performance correlation** — both subagent dispatches ran on `anthropic/claude-sonnet-5` per their agent frontmatter (`.pi/agents/tidy-first-assessor.md`, `.pi/agents/pre-completion-reviewer.md`): appropriate for read-only, judgment-heavy review.
  Inline transcript labels confirm the TDD and ship turns ran on `anthropic/claude-sonnet-5` and this retrospective on `anthropic/claude-opus-5`.
  Three `model_change` entries are recorded for the session, consistent with planning on `anthropic/claude-opus-5`, but per the [#737] caveat that is not attributed from an inline label and is left unconfirmed.
  No mismatch found: the judgment-heavy planning gate and the mechanical TDD execution ran on the models suited to each.
- **Escalation-delay tracking** — no `rabbit-hole` friction occurred; the longest run on a single error was one tool call (the constructor-arity break in step 3, fixed on the next call).
  Nothing to flag.
- **Unused-tool detection** — `colgrep` was loaded but never used; every search targeted a known exact symbol (`AgentPrepHandler`, `permissions:ready`, `new PermissionServiceLifecycle`), which its own decision table assigns to `grep`.
  No `Explore` dispatch was needed because ADR 0012 supplied the diagnosis the plan was built on.
  No gap.
- **Feedback-loop gap analysis** — no gap: file-scoped `vitest` at each Red and Green, `pnpm run check` after each of the three interface-changing steps, full package suite before commits 1 and 3, and root `pnpm run lint` plus `pnpm fallow dead-code` before the docs commit and again before the push.

### Corrected test-count breakdown

The TDD stage note's per-file split was slightly off; the accurate delta for 3215 → 3227 is:

| File                                       | Delta                                                     |
| ------------------------------------------ | --------------------------------------------------------- |
| `test/handlers/session-turn-prep.test.ts`  | +7 (4 moved in, 3 new)                                    |
| `test/handlers/before-agent-start.test.ts` | −3 (4 moved out, 1 delegation test added)                 |
| `test/service-lifecycle.test.ts`           | +6 (5 `announceReady` cases, 1 interface-shape assertion) |
| `test/composition-root.test.ts`            | +2 (emission count, latch re-arm)                         |

### Tidy-first effectiveness audit

The operator challenged this session's proposal to reframe a null assessor report, asking how effective `tidy-first` has been overall and how often a real finding was discarded as out of scope.
Mined from the retro corpus (95 files mention the assessor):

- **Catches with commits.**
  `d955190a` — the assessor found `program.test.ts` and `path-normalizer.test.ts` fully replacing `node:fs` with a lone `realpathSync` stub, which would have thrown across dozens of unrelated tests and turned a planned Red into noise.
  `2e9f6db2` — it caught duplication from the *upcoming* diff that the plan missed despite running the `design-review` checklist; landing the extraction first turned that cycle into a one-line change.
  Elsewhere it found two inline `PromptPreferences` construction sites that a grep obligation added one session earlier still missed, and pre-verified a fixture blast radius as near-zero, cancelling a speculative edit pass across five test files.
- **Declines.**
  14 retro files record "nothing warranted," and each judges the decline correct (a 3-line helper with one caller; an inherently atomic interface split; a pure `git mv` over an enumerated import graph).
- **One documented failure.**
  A `runGate` fixture wrapper was recommended, was genuinely in scope, and was still wrong — it would have become a zero-value pass-through once the parameter it absorbed was deleted.
  That produced a corrective rule in `.pi/agents/tidy-first-assessor.md`, so the mechanism has already been tuned once on evidence.
- **Discards.**
  Every readable rejection in the corpus was genuinely out of footprint (stepdown reordering, splitting a large test file, a non-target file, an AST walk), and adjacent work was commonly filed as its own issue rather than dropped.
  No retro reports a lost finding — but this is a sample, not an audit, and the reason it cannot be audited is the defect itself.

The defect: the skill said to "note it for `/plan-improvements`," and `/plan-improvements` had no step that read anything of the kind.
A rejected-but-valuable finding lived only in a subagent report inside a transcript no later session opens.
The fix below gives it a written destination and a reader.

### Changes made

1. `AGENTS.md` (§ Clarification gates) — added the rule that when every gate option adds to the same existing object, the premise must be named and the removing option offered, with this session's `AgentPrepHandler` case as the example.
2. `.pi/prompts/plan-issue.md` (§ Decide) — a breaking/non-breaking classification for a documented-contract change must appear in the gate's substance message even when an ADR settled it, since a settled call and an unasked one look identical to the operator.
3. `.pi/skills/tidy-first/SKILL.md` (§ Step 3) — replaced the dead-letter "note it for `/plan-improvements`" with a written destination (`#### Deferred tidyings` in the issue's retro stage note), and added that a null report should be read for what it verified.
4. `.pi/prompts/plan-improvements.md` (§ Step 2) — added the matching reader: the phase sweep greps that heading across the package's retros and triages each finding.

Changes 3 and 4 are one loop and only work together; the writer and reader reference the same literal heading.

[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#725]: https://github.com/gotgenes/pi-packages/issues/725
[#726]: https://github.com/gotgenes/pi-packages/issues/726
[#737]: https://github.com/gotgenes/pi-packages/issues/737
[#789]: https://github.com/gotgenes/pi-packages/issues/789
[#790]: https://github.com/gotgenes/pi-packages/pull/790
