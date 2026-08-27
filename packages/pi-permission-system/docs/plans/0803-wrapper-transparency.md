---
issue: 803
issue_title: "pi-permission-system: exempt argument-independent read-only inner commands from the wrapper floor"
---

# Wrapper transparency — argument-independence defeats the floor's reason

## Release Recommendation

**Release:** ship now — batch "capability-axis" tail (this issue completes the batch)

Phase 14's `Release batches` subsection names Steps 1, 2, 3 as batch `capability-axis`, with Step 3 ([#803]) as the tail and the release vehicle.
Step 1 ([#806]) landed the directional config keys as `feat:` and Step 2 ([#807]) landed effect attribution as a hidden `refactor:`; neither relieves anything a user can observe until a directional grant exists to write.
This step's relief is immediate and unconditional, so its `fix:` cuts the release that carries all three.

## Problem Statement

The indirection floor ([#490]) converts a wrapper unit's `allow` into a synthetic `ask` because a wrapper hides the command that should be gated.
That was the right fail-closed default, but it is applied as though it guarded unknowability of *direction* when what it actually guards is unknowability of *scope*.

A pure reader is read-only for **any** arguments — no argument makes `grep` write a file — so the direction of `xargs grep -l foo` is provable even though its argument feed is not.
Scope remains the projection's and the path surfaces' job, exactly as for an unwrapped command.

The cost is measured and large: wrapper-floored prompts are 27.8% of all prompts across 2026-07 and 2026-08 in the local review log, and 46.7% of those have a provable pure-reader inner command.

## Goals

- A wrapper unit whose executed inner command is a **proven** pure reader (ADR 0013 §7's core, retraction guards applied) stops being floored, and resolves by the inner command's own bash rules instead.
- Everything else keeps the floor byte-for-byte: interpreters, `bash -c`/`eval` opaque payloads, mutators, and any wrapper whose inner command cannot be established.
- An explicit `deny`/`ask` on the wrapper unit is never weakened, because the exemption only ever replaces a verdict the floor would have raised from `allow`.
- The exemption is auditable: a review-log entry states that the floor was lifted and why.
- Not breaking.
  Every rule keeps its meaning; the change only removes prompts a user did not write a rule to get, and a `bash` policy of `{"*": "ask"}` (the shipped example) sees no behavior change at all.
  It ships as `fix:`, following [#490]'s own precedent for tightening/loosening the same floor without a config edit.

## Non-Goals

- **User `commandEffects` declarations do not lift the floor.**
  v1 exempts on the built-in core alone.
  A user's argument-independence claim about a wrapped command is not package-audited, and a wrong claim behind a wrapper fails open.
  ADR 0013 §11 requires evidence, not symmetry, before widening.
- **Configurable per-wrapper floor exemption** ([#680]) is not built here.
  This step answers the deterministic slice of that request without a new config key; the escape-hatch shape stays open.
- **Model-judged inspection of an opaque payload** ([#706], [#620]) is untouched.
  [#706] asks for exactly what this step delivers for the provable slice; the residual (`xargs pnpm …`, `find -exec sh -c …`) is [#620]'s.
- **A principal axis** — modelling *who a command runs as* — is out of scope and deliberately not half-built.
  `sudo`/`doas` are treated as ordinary indirection wrappers (see Design Overview); a user who wants them gated writes one rule.
- **Redirect-destination projection changes** ([#609]) are Phase 15's staging slice 4.
  This step only *reads* the syntax proof Step 2 already ships.
- `docs/plans/0807-bash-effect-attribution.md`'s Non-Goals are scoped to that change, not to this one — the read-mechanism boundary it names is ADR 0013 §7, which this step cites directly rather than through that plan.

## Background

### How the floor works today

`collectCommands` (`src/access-intent/bash/command-enumeration.ts`) emits one `BashCommand` per command unit.
`classifyWrapperWords` (`src/access-intent/bash/wrapper-analysis.ts`) tags a unit with a `WrapperKind` — `"opaque-payload"` for `bash -c`/`eval`, `"indirection"` for `sudo`/`env`/`xargs`/`time`/`find -exec`/… — and `executedUnitOf` names, display-only, the command the wrapper runs.

`resolveBashCommandCheck` (`src/handlers/gates/bash-command.ts`) resolves each unit's own text on the `bash` surface, then floors an `allow` to `ask` with the sentinel from `WRAPPER_SENTINEL`, and picks the most restrictive unit result.
The floor is synthesized *after* the resolver returns, so `resolveYoloGrant` is the single place yolo reconciles it ([#712]).

### What Step 2 already established

`proveCommandEffect(headWord, argWords)` (`src/access-intent/bash/command-effects.ts`) answers whether a head word proves a read: it requires a **bare basename** (`./grep` proves nothing) and applies the retraction guards for `find`, `fd`, and `sort`.
`redirectDestinationEffect(operator, destinationIsDescriptor)` answers what a redirect operator proves for its destination.
Both are pure and word-based, and `PURE_READER_CORE` is published between `<!-- BEGIN PURE_READER_CORE -->` markers in `docs/configuration.md` under a parity test.

### Three facts the issue's wording does not cover

1. **`executedUnitOf` unwraps *through* an opaque payload.**
   For `xargs -I{} sh -c 'grep -l "…" {}'` the loop classifies `xargs` as indirection, unwraps to `sh -c '…'`, classifies that as an opaque payload, and returns the **unquoted payload text** — head word `grep`.
   A predicate built literally on "the `executedUnitOf` head is a core word" would exempt it, and the payload is an unparsed shell program that could be `grep foo; rm -rf /`.
   The issue's own acceptance sketch says `find -exec sh -c '…' \;` must keep prompting.
   Measured: 4 asks in the local log take this shape.
2. **Core membership is not the test; the effect proof is.**
   `xargs sort -o /etc/passwd` and `xargs find . -delete` both have core head words and both write.
   The predicate must call `proveCommandEffect` and require `effect === "read"`, so the retraction guards apply behind a wrapper too.
3. **The redirect fact is not on the `command` node.**
   tree-sitter-bash attaches `file_redirect` to the parent `redirected_statement`, and the local `TSNode` interface (`src/access-intent/bash/parser.ts`) exposes no `.parent`.
   Verified by parsing `xargs grep foo > out.txt`, `cat a | xargs grep b > out`, `find . -exec grep x {} + > out`, `xargs grep foo 2>&1`, and `xargs grep foo < in.txt`.
   So the enumerator has to carry a write-redirect flag down as it descends.

### Measured warrant

Local review log (`~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`), `permission_request.waiting` entries, test-fixture entries (`/var/folders/`) excluded, undeduplicated, scored with the **real** `classifyWrapperWords` / `proveCommandEffect` / tree-sitter modules:

| Month   | prompts | wrapper-floored | exempt under this predicate                 |
| ------- | ------- | --------------- | ------------------------------------------- |
| 2026-07 | 164     | 44 (26.8%)      | 24                                          |
| 2026-08 | 160     | 46 (28.8%)      | 18                                          |
| Jul+Aug | 324     | 90 (27.8%)      | 42 (13.0% of all prompts; 46.7% of floored) |

Measured, not estimated.
This reproduces ADR 0013 §11's ~13% claim independently.

Relieved shapes: `xargs grep -l …`, `xargs grep -ln …`, `xargs wc -l`, `xargs cat`, `xargs ls -t`, `xargs dirname`, `xargs -I{} basename {}`, `xargs echo …`, `find … -exec wc -l {} +`, `find … -exec cat {} +`.
Still floored, by inner head word: `pnpm` (10), `git` (3), `node` (3), `pi` (3), `yarn` (2), a Chrome launch (2), `gh` (1), `sed` (1).

Cost of each conservative clause, measured against the same log:

| Clause                                                 | Asks it forfeits                                |
| ------------------------------------------------------ | ----------------------------------------------- |
| Refuse to unwrap through an opaque payload             | 4 (all `xargs -I{} sh -c '…'` — correctly kept) |
| Disqualify a unit carrying a write-proving redirect    | 0                                               |
| Exclude `sudo`/`doas` (rejected — see Design Overview) | 0                                               |

The wrapper-floored ask is raised by the **last** gate in `ToolCallGatePipeline`'s producer list, so an ask carrying the `<indirection-bash-wrapper>` sentinel is one the path and external-directory gates already let through — removing the floor removes the ask outright rather than moving it.

### Constraints from AGENTS.md and the package skill

- `PermissionCheckResult.executedUnit` is display-only today ("it never becomes a gateable unit, so the wrapper floor is untouched").
  This step changes that sentence, so the package skill, `command-enumeration.ts`'s doc comment, and the architecture module tree all carry prose that must be reworded — there is no removed symbol for a grep to catch.
- `PromptRequestFacts` (`src/presentation/prompt-payload.ts`) is a **published** contract with a tolerant `asPromptPayload`-style reader and five payload builders.
  The audit fact deliberately does **not** go there; see Design Overview.
- Do not name an unreleased version in docs.
- Conventional-commit typing follows observability: a module nothing imports yet is `refactor:`, and the commit that wires it up carries the `fix:`.

## Design Overview

### The predicate

`isTransparentWrapper` joins `classifyWrapperWords` and `executedUnitOf` in `wrapper-analysis.ts`, over the same word vocabulary, so the shape that floors a unit, the shape that names its inner command, and the shape that exempts it cannot drift.

```typescript
/**
 * True when a wrapper unit's floor has no reason left: the command it runs is
 * a proven pure reader, so its direction is known however unknown its argument
 * feed is (ADR 0013 §11).
 */
export function isTransparentWrapper(
  words: readonly CommandWord[],
  statement: { readonly writesViaRedirect: boolean },
): boolean;
```

It is true when **all** of the following hold:

1. `classifyWrapperWords(words)` returns `"indirection"`.
   An opaque payload is never transparent.
2. Unwrapping the indirection layers reaches a resolvable inner unit **without passing through an opaque layer**.
   The unwrap refuses at an opaque layer rather than returning its payload.
3. `proveCommandEffect(innerHead, innerArgs).effect === "read"`.
   This carries the bare-basename rule and the `find`/`fd`/`sort` retraction guards behind the wrapper for free.
4. `statement.writesViaRedirect` is false.

`executedUnitOf` and `isTransparentWrapper` share one private unwrap loop, parameterised by what to do at an opaque layer: `executedUnitOf` returns the payload text (display, unchanged), `isTransparentWrapper` refuses.
This is the single point where finding 1 above is answered, so a future reader cannot reintroduce it by consuming `executedUnitOf`'s string.

### Where the redirect fact comes from

`src/access-intent/bash/redirect-analysis.ts` (new) owns reading a `file_redirect` node: its operator, and whether its destination is a descriptor rather than a file.

```typescript
/** The effect this redirect proves for one destination child, or null. */
export function redirectEffectForDestination(
  redirect: TSNode,
  destination: TSNode,
): TokenEffect | null;

/** True when this redirect proves a write to a real file. */
export function redirectProvesFileWrite(redirect: TSNode): boolean;
```

Both sit over one private operator reader and one private descriptor-node set.
`token-collection.ts`'s `collectRedirectTokens` is rewired onto `redirectEffectForDestination`, retiring its private `redirectOperatorOf` and `DESCRIPTOR_NODE_TYPES`, so there is exactly one answer to "what does this `file_redirect` prove" rather than two that must agree.

`collectCommandsInto` gains a `writesViaRedirect` relay beside its existing `context` relay:

- descending a `redirected_statement`, it pre-scans that node's `file_redirect` children and ORs `redirectProvesFileWrite` into the flag for the whole subtree;
- a nested execution (`collectHostedCommands`) starts fresh at `false`, because the redirect belongs to the enclosing statement and not to the substitution — the same rule Step 2 applies to token attribution ("a nested execution keeps its own command's attribution").

Over-attribution inside a pipeline (`cat a | xargs grep b > out` marks both units) is the fail-closed direction and is accepted; the flag can only ever *withhold* an exemption.

### What the enumerator records

```typescript
export interface BashCommand {
  readonly text: string;
  readonly context?: BashCommandContext;
  readonly wrapperKind?: WrapperKind;
  readonly executedUnit?: string;
  /**
   * Why this wrapper unit's floor does not apply (#803): the command it runs
   * is a proven pure reader. Absent when the floor applies.
   */
  readonly floorExemption?: "core-reader";
}
```

A named reason rather than a boolean, so a v2 source (a user declaration, a chain verdict) is additive and the review log reads as a sentence.
`floorExemption` is only ever set together with `wrapperKind` and `executedUnit`; the design relies on `executedUnit` being present, which the predicate guarantees — an unresolvable inner command fails clause 2.

### The verdict

`resolveBashCommandCheck` keeps its shape; the floor branch becomes a two-way decision.

```typescript
// Today
const floored =
  cmd.wrapperKind && base.state === "allow" ? withSentinel(base, cmd) : base;

// After
const floored =
  cmd.wrapperKind && base.state === "allow"
    ? resolveWrapperUnit(cmd, base, agentName, resolver)
    : base;
```

`resolveWrapperUnit` fires only where the floor fires — a wrapper unit whose own text resolved to `allow` — so an explicit `deny` or `ask` on the wrapper is structurally untouchable, which is what makes `bash: {"sudo *": "ask"}` a complete answer for a user who wants it.

When `cmd.floorExemption` is absent it returns today's sentinel result unchanged.
When present it resolves the inner unit's text on the `bash` surface and returns the inner verdict, carrying:

- `state`, `matchedPattern`, `origin`, `source` from the **inner** resolve — the rule that actually decided;
- `command` from the **wrapper unit's** text — what actually runs, so the prompt, the decision value, and the session-approval suggestion all name the real command rather than a fragment of it;
- `executedUnit` as today, so the dialog's `runs` fact still names the inner command;
- `floorExemption: "core-reader"`.

This is a deliberate composite and is documented as one: it is a single unit's resolution where the rule that fired belongs to the inner command and the value gated is the unit, unlike `mostRestrictiveOf`, which returns a losing member's own result whole.

Consequences worth stating:

| Config                                   | `xargs grep -l foo` today | after                   |
| ---------------------------------------- | ------------------------- | ----------------------- |
| `bash: {"*": "ask"}` (shipped example)   | ask                       | ask (floor never fired) |
| `bash: {"*": "allow"}`                   | ask (floor)               | allow                   |
| `bash: {"*": "allow", "grep *": "deny"}` | ask (floor)               | deny                    |
| `bash: {"*": "allow", "xargs *": "ask"}` | ask (explicit)            | ask (explicit)          |
| `bash: {"*": "ask", "grep *": "allow"}`  | ask                       | ask (floor never fired) |

The third row is a tightening the floor-lift-only alternative would have lost: a user who denied `grep` would otherwise have got a silently-allowed `xargs grep`.

### `sudo` and `doas` are ordinary wrappers

`sudo` is not special anywhere in the package today, and `config/config.example.json` carries no `sudo` rule.
The path surfaces gate `sudo cat X` exactly as they gate `cat X` — the token `X` is projected identically — so what `sudo` adds is only that the operating system would have refused an unprivileged read.
This package has never modelled OS permissions as a layer, and half-modelling one here (a two-name set inside a mechanism otherwise defined purely by the inner command's proven effect) would encode a judgement it makes nowhere else.

Measured: zero floored asks in the local log have a `sudo`/`doas` wrapper with a core-reader inner command, so a carve-out would buy nothing observed.

The divergence needs a permissive `bash` policy, and — outside the working directory — a permissive read grant as well:

| `bash` rules               | `external_directory_read` | today           | after                           |
| -------------------------- | ------------------------- | --------------- | ------------------------------- |
| `*: ask` (shipped example) | `*: ask`                  | ask (bash rule) | ask (bash rule)                 |
| `*: allow`                 | `*: ask`                  | ask (floor)     | ask (`external_directory_read`) |
| `*: allow`                 | `*: allow`                | ask (floor)     | allow                           |
| `*: allow` + `sudo *: ask` | `*: allow`                | ask             | ask (explicit rule)             |

`docs/configuration.md` ships the last row as a named recipe beside the transparency section.

### The audit fact

`PermissionCheckResult` gains `floorExemption?: "core-reader"`, and `describeToolGate` (`src/handlers/gates/tool.ts`) spreads it into the gate descriptor's `logContext` when present — the same route Step 2 used for `effect`/`effectSource` on the bash path gates, and the same shape (`{ ...(x ? { x } : {}) }`) the runner already merges for every resolution of the gate.

It deliberately does **not** go on `PromptRequestFacts`.
That interface is a published cross-extension contract (`docs/cross-extension-api.md`, `docs/migration/0745-prompt-payload-contracts.md`) with a tolerant guard and five builders, and the fact is not a prompt fact: an exempted unit's usual outcome is that no prompt happens at all.
`executedUnit` already carries the inner command onto the payload for the case where the inner verdict is `ask`.

A review-log line for an exempted allow then reads:

```json
{
  "surface": "bash",
  "command": "xargs grep -l foo",
  "matchedPattern": "*",
  "executedUnit": "grep -l foo",
  "floorExemption": "core-reader"
}
```

### Call-site sketch

```typescript
// command-enumeration.ts — makeCommandUnit
const kind = classifyWrapperWords(words);
const exempt =
  kind === "indirection" && isTransparentWrapper(words, { writesViaRedirect });
return makeUnit(text, context, kind, executedUnitOf(text, words) ?? undefined, exempt);
```

```typescript
// bash-command.ts — resolveWrapperUnit
if (cmd.floorExemption === undefined || cmd.executedUnit === undefined) {
  return { ...base, state: "ask", matchedPattern: WRAPPER_SENTINEL[kind] };
}
const inner = resolver.resolve({
  kind: "tool",
  surface: "bash",
  input: { command: cmd.executedUnit },
  agentName,
});
return { ...inner, command: base.command, floorExemption: cmd.floorExemption };
```

Both are Tell-Don't-Ask over data records the caller owns, with no reach-through past one field.

### Design-review notes

- **Dependency width.** `BashCommand` goes 4 → 5 optional-heavy fields; `resolveBashCommandCheck` reads all five, so the interface stays narrower than its consumer. `PermissionCheckResult` goes 10 → 11, following `executedUnit`'s precedent for a bash-only fact carried on a general result.
- **Parameter relay.**
  `writesViaRedirect` relays one layer through `collectCommandsInto` → `makeCommandUnit`, the same shape `context` already has.
  If a third statement-scoped fact appears later, the two should bundle into a `UnitScope` record; two does not yet earn it.
- **Repeated discriminators.**
  The `redirect-analysis.ts` extraction exists precisely to avoid a second redirect-operator table; without it the enumerator and the token collector would each own one, and they must agree.
- **ISP.** `isTransparentWrapper` takes `readonly CommandWord[]` — the same narrow type `classifyWrapperWords` takes — plus one statement-scoped fact that is genuinely not derivable from the words.

## Module-Level Changes

### New

- `src/access-intent/bash/redirect-analysis.ts` — `redirectEffectForDestination`, `redirectProvesFileWrite`, over one private operator reader and one private descriptor-node set.
- `scripts/measure-wrapper-transparency.mjs` — the instrument behind every number this plan and the roadmap's `Landed:` note cite, following `scripts/measure-core-coverage.mjs`'s precedent (ADR 0013's rule that a durable number ships with the instrument that produced it).
  It transcribes the roster rather than importing it, for the same stated reason.
- `test/access-intent/bash/redirect-analysis.test.ts`.

### Changed

- `src/access-intent/bash/wrapper-analysis.ts` — add `isTransparentWrapper`; extract the shared unwrap loop out of `executedUnitOf` with an opaque-layer policy parameter; import `proveCommandEffect` from `command-effects.ts` (no cycle: `command-effects.ts` imports only `#src/access-intent/effect`).
- `src/access-intent/bash/token-collection.ts` — `collectRedirectTokens` consumes `redirectEffectForDestination`; delete the private `redirectOperatorOf` and `DESCRIPTOR_NODE_TYPES` (sole call sites, so they go in the same commit).
- `src/access-intent/bash/command-enumeration.ts` — relay `writesViaRedirect`; set `BashCommand.floorExemption`; reword the `executedUnit` doc comment, which currently asserts "the wrapper floor still applies".
- `src/handlers/gates/bash-command.ts` — `resolveWrapperUnit`; reword the module doc comment describing the floor.
- `src/handlers/gates/tool.ts` — stamp `floorExemption` into `logContext`.
- `src/types.ts` — `PermissionCheckResult.floorExemption?: "core-reader"`, and reword `executedUnit`'s "Display-only … never widens or narrows a decision" comment, which this step falsifies.

### Documentation

- `docs/configuration.md`
  - `#### Fail-closed behavior` — the indirection-wrapper bullet gains the transparency exception; the "no rule can auto-allow a wrapper" sentence is narrowed to the non-exempt case.
  - A new `#### Wrapper transparency` subsection under `### Directional Path Surfaces`, after `#### The pure-reader command core` (which it links), stating the rule, the four clauses, the `sudo`/`doas` recipe, and the `floorExemption` review-log field.
  - `### Read-Only Bash Command Allowlist` items 2 and 4 — item 2's `find -exec rm` claim still holds (`rm` is not core) but must say why; item 4's "`sudo grep …`, `env X=1 cat …` … are floored to `ask`" is no longer the reason those prompt under that recipe — under `bash: {"*": "ask"}` the wrapper text matches only `*` and the floor never fires.
    Reword to the real reason.
- `README.md` line 22 — the fail-closed bullet's wrapper clause gains the exception.
- `docs/cross-extension-api.md` and `docs/migration/0746-review-log-fields.md` — **not delivered, deliberately.**
  Both tables document `PromptRequestFacts`, which this change leaves untouched: `floorExemption` rides the gate's `logContext`, the same routing [#807] gave `effect`/`effectSource`, and those are recorded in `docs/architecture/architecture.md` and the package skill rather than in either table.
  `docs/migration/0745-prompt-payload-contracts.md` needs no edit for the same reason.
  The user-facing home for the field is `docs/configuration.md`'s Wrapper transparency section.
- `docs/architecture/architecture.md`
  - module tree: `wrapper-analysis.ts` (gains `isTransparentWrapper` and the opaque-refusal constraint), `command-enumeration.ts` (the `floorExemption` field), `program.ts` (its "flagging wrapper units with a `wrapperKind` so their decision floors to `ask`" clause), plus a new `redirect-analysis.ts` entry;
  - line 649's yolo note names both wrapper floors as post-resolution synthetics — still true, but the exempt path is not synthesised, so the sentence needs one clause;
  - Step 3 heading `✅` + the `S3` Mermaid node + a `Landed:` note carrying the measured figures;
  - health metrics: the `Wrapper-transparency predicate (wrapper-analysis.ts)` row moves 0 → 1 under its own recompute command (`grep -c 'isTransparentWrapper' …`), which the delivered name satisfies as written.
- `.pi/skills/package-pi-permission-system/SKILL.md` — the wrapper-floor paragraph (line ~306) and the `executedUnitOf` "display-only … the wrapper floor is untouched" sentence (line ~308).

Grep sweeps run at planning time, so the list above is closed:

- `indirection-bash-wrapper` / `opaque-bash-wrapper` across `docs/`, `README.md`, `.pi/skills/`, and `test/` — 11 test files, 6 doc files, README, skill.
- `wrapperKind` / `classifyWrapperWords` / `executedUnit` across `src/`, `test/`, `docs/`, `.pi/skills/`.
- `isTransparentWrapper` — only the roadmap's Target line and health-metric recompute command.
- No file listed above is claimed as unchanged in Non-Goals.

## Test Impact Analysis

### New unit tests the change enables

- `test/access-intent/bash/wrapper-analysis.test.ts` — `isTransparentWrapper` is pure and word-based, so every clause is testable without a parse: core inner (`xargs grep foo`), retracted inner (`xargs sort -o /tmp/x`, `xargs find . -delete`), non-core inner (`xargs pnpm test`, `time pnpm test`), path-qualified inner (`xargs ./grep foo`), opaque inner (`xargs -I{} sh -c 'grep foo {}'`, `find . -exec sh -c '…' \;`), unresolvable inner (`xargs --unknown-opt`), nested indirection (`sudo timeout 5 xargs grep foo`), exec-conditional (`find . -exec wc -l {} +`), and the redirect flag both ways.
- `test/access-intent/bash/redirect-analysis.test.ts` — the operator table and the descriptor/file split (`> out` writes, `2>&1` proves nothing, `>&2` vs `>& out`, `< in` reads, an unknown operator proves nothing) tested directly instead of only through token collection.
- `test/handlers/gates/bash-command-metamorphic.test.ts` — that file already carries "does not weaken" properties over `cd` prefixes and nested execution hosts, and gains the matching one for this change: wrapping a command in a transparent indirection wrapper never produces a weaker decision than the command's own.
  That is the property the composite result in `resolveWrapperUnit` has to satisfy, and it is stronger than the four table rows in Design Overview.

### Existing tests that stay as-is

- `test/handlers/gates/bash-command.test.ts`'s `indirection wrapper floor` block keeps every case: its fixtures are hand-built `BashCommand` literals with no `floorExemption`, so they continue to exercise the floor exactly as today, and the explicit-`deny`/explicit-`ask` cases are the never-weakened guarantee.
- `test/access-intent/bash/program.test.ts`'s wrapper blocks pin the real node adapter end to end; they gain `floorExemption` expectations rather than being replaced.
- The sentinel assertions in `dialog-renderer.test.ts`, `review-log-renderer.test.ts`, `agent-renderer.test.ts`, `tool-ask-payload.test.ts`, `runner.test.ts`, `helpers.test.ts`, `composition-root.test.ts`, `shell-tool-alias.test.ts`, and `bash-advisory-check.test.ts` all describe the non-exempt path and must stay green untouched.

### Tests that become redundant

None.
The change adds a branch rather than replacing one, and the floor's own tests are what prove the branch is not taken.

### Fixture sweep

`BashCommand` gains an **optional** field, so no existing literal breaks.
`PermissionCheckResult` likewise.
Confirmed by grepping `wrapperKind:` across `test/` — every occurrence is an inline literal in `bash-command.test.ts` or `program.test.ts`, and none uses `toMatchObject`/`objectContaining` in a way that would absorb a wrong insertion silently.

## Invariants at risk

| Invariant                                                                                                    | Source                      | Pinned by                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------ | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| A directional key reaching an authorizer is capped by family membership                                      | Step 1 `Outcome:`/`Landed:` | `test/authority/delegation-envelope.test.ts`                                                                                      |
| A forwarded child request resolves against real recorded authority, not an emptied bare surface              | Step 1 `Landed:`            | `ServingPolicy resolves a forwarded request against real recorded authority` in `test/authority/forwarded-request-server.test.ts` |
| Each bash gate stamps `effect`/`effectSource` on its `logContext`                                            | Step 2 `Outcome:`           | `test/handlers/gates/bash-path.test.ts`, `test/handlers/gates/bash-external-directory.test.ts`                                    |
| `find`/`fd`/`sort` retraction yields `unproven`/`retracted`, never a write                                   | Step 2 `Landed:`            | `test/access-intent/bash/command-effects.test.ts`                                                                                 |
| The published `PURE_READER_CORE` roster matches the code                                                     | Step 2                      | the parity test in `test/access-intent/bash/command-effects.test.ts`                                                              |
| Every synthetic `ask` — both floors and the unparseable sentinel — is reconciled by `resolveYoloGrant` alone | [#712]                      | `test/handlers/gates/helpers.test.ts`                                                                                             |
| An explicit `deny` covering an unparseable command is not masked into an approvable prompt                   | [#452], [#712]              | `test/handlers/gates/bash-command.test.ts`                                                                                        |
| An aliased shell tool is gated at parity with native bash, wrapper flooring included                         | [#574]                      | `test/handlers/shell-tool-alias.test.ts`                                                                                          |
| A `cd` prefix or a nested execution host never weakens a unit's decision                                     | [#306], [#741]              | `test/handlers/gates/bash-command-metamorphic.test.ts`                                                                            |
| The advisory bash check never answers weaker than the gate                                                   | [#309]                      | `test/bash-advisory-check.test.ts`                                                                                                |

Two are worth calling out.

The **advisory parity** invariant is preserved for free: `resolveBashAdvisoryCheck` delegates to the same `resolveBashCommandCheck`, so the exemption reaches it in the same commit.
The plan does not add a separate advisory branch, and a test asserting an exempt wrapper answers identically on both paths is cycle 4's job.

The **`effect`/`effectSource`** invariant is the one this step could regress with a green suite, because it touches the same `file_redirect` reading.
`redirectEffectForDestination` is extracted from `collectRedirectTokens` verbatim — same operator lookup, same descriptor set, same `null` for a descriptor destination — and lands as a behavior-preserving `refactor:` commit ahead of any consumer, so the existing token-collection tests are the measurement rather than an argument.

Quantitative baseline, to be re-measured at implementation:

| Metric                                                                      | Baseline (measured 2026-08-27 window) | Predicted after           |
| --------------------------------------------------------------------------- | ------------------------------------- | ------------------------- |
| Wrapper-floored asks, Jul+Aug                                               | 90 of 324 prompts (27.8%)             | 48 of 324 (14.8%)         |
| Asks removed                                                                | —                                     | 42 (13.0% of all prompts) |
| `grep -c 'isTransparentWrapper' src/access-intent/bash/wrapper-analysis.ts` | 0                                     | ≥ 1                       |

## TDD Order

1. **Extract the redirect vocabulary.**
   Red: `test/access-intent/bash/redirect-analysis.test.ts` covering the operator table, the descriptor/file split, and the unknown-operator case.
   Green: `src/access-intent/bash/redirect-analysis.ts`; rewire `collectRedirectTokens` and delete its two private members.
   Existing `token-collection.test.ts` must stay green untouched — that is the behavior-preservation measurement.
   Commit: `refactor(pi-permission-system): extract file_redirect analysis from token collection`.

2. **The transparency predicate.**
   Red: the `isTransparentWrapper` cases listed under Test Impact Analysis, in `wrapper-analysis.test.ts`, including the opaque-refusal case asserted against `executedUnitOf`'s *unchanged* behavior on the same input (the two must disagree, and the test says so).
   Green: the shared unwrap with an opaque-layer policy, plus the predicate.
   Nothing imports it yet.
   Commit: `refactor(pi-permission-system): add the wrapper-transparency predicate`.

3. **Enumerate the exemption.**
   Red: `program.test.ts` cases asserting `floorExemption: "core-reader"` on `xargs grep foo` and `find . -exec wc -l {} +`, its absence on `xargs pnpm test`, `xargs -I{} sh -c '…'`, and `xargs grep foo > out.txt`, and its absence for a command nested in a redirect destination of a writing statement.
   Green: the `writesViaRedirect` relay and the `BashCommand.floorExemption` field.
   The gate still ignores the field, so no decision changes.
   Commit: `refactor(pi-permission-system): record wrapper floor exemptions on the command unit`.

4. **Lift the floor.**
   Red: `bash-command.test.ts` — an exempt unit under a `*: allow` resolves `allow` with the inner rule's `matchedPattern` and the wrapper's `command`; an exempt unit whose inner text matches a `deny` resolves `deny`; an explicit `ask` on the wrapper is unchanged; a non-exempt wrapper still carries `<indirection-bash-wrapper>`; and the advisory path answers identically (`bash-advisory-check.test.ts`).
   Green: `resolveWrapperUnit`.
   Commit: `fix(pi-permission-system): stop flooring wrappers that run a proven pure reader (#803)`.

5. **The audit fact.**
   Red: `test/handlers/gates/tool.test.ts` (or the runner test that reads a descriptor's `logContext`) asserting `floorExemption: "core-reader"` reaches the review-log context for an exempt bash allow, and is absent otherwise.
   Green: `PermissionCheckResult.floorExemption` threaded through `resolveWrapperUnit` and stamped in `describeToolGate`.
   Commit: `feat(pi-permission-system): record the wrapper floor exemption in the review log`.

6. **The instrument.**
   `scripts/measure-wrapper-transparency.mjs`, re-run to refresh the figures this plan cites.
   Commit: `docs(pi-permission-system): commit the wrapper-transparency measurement instrument`.

7. **Documentation.**
   Every item under Module-Level Changes → Documentation, including the roadmap's `✅`, Mermaid node, `Landed:` note, and health-metric row, in one commit.
   Commit: `docs(pi-permission-system): document wrapper transparency and mark Phase 14 Step 3 complete`.

Cycles 1–3 are each behavior-preserving and independently revertible; cycle 4 is the single commit a user can observe, which is why the release recommendation reads off it.

## Risks and Mitigations

| Risk                                                                                       | Mitigation                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A predicate built on `executedUnitOf`'s string silently exempts an opaque payload          | The shared unwrap refuses at an opaque layer; cycle 2 asserts the two functions disagree on `xargs -I{} sh -c 'grep …'`                                                                             |
| A core head word whose arguments write (`xargs sort -o`, `xargs find -delete`) is exempted | The predicate calls `proveCommandEffect`, not `PURE_READER_CORE.has`; cycle 2 pins both                                                                                                             |
| A write escapes because the unit's redirect is invisible to the enumerator                 | `writesViaRedirect` relay, over-attributing within a pipeline; measured cost 0 asks                                                                                                                 |
| `env LD_PRELOAD=… grep foo` executes injected code behind a "pure reader"                  | Pre-existing and unchanged: the enumerator already strips a bare `LD_PRELOAD=… grep foo` assignment prefix, so this hole does not originate here. Recorded in Open Questions rather than half-fixed |
| A permissive-bash user is silently widened for `sudo`                                      | Requires a permissive `bash` policy and (outside cwd) a permissive read grant; one config line closes it, and `docs/configuration.md` ships that line as a recipe                                   |
| The `redirect-analysis.ts` extraction changes token attribution                            | Verbatim extraction landing before any consumer, with the existing `token-collection.test.ts` unchanged as the measurement                                                                          |
| A composite result confuses the session-approval suggestion                                | `command` stays the wrapper unit's text, so `deriveSuggestionValue` and the dialog both name what runs; cycle 4 asserts it                                                                          |
| The roadmap's health-metric grep breaks on a rename                                        | The delivered name is `isTransparentWrapper` in `wrapper-analysis.ts`, exactly as the recompute command spells it                                                                                   |

## Open Questions

- **Does the package want a principal axis** — modelling *who* a command runs as, beside the capability axis?
  Deferred deliberately (see Non-Goals).
  No issue filed: nothing in the measured population motivates one yet, and ADR 0013's staging has no seat for it.
- **Widening the exemption to user `commandEffects` declarations** is ADR 0013 §11's stated "requires evidence, not symmetry" — it stays closed until the review log shows a population it would relieve.
- **`env`'s environment-assignment surface** (`LD_PRELOAD`, `GREP_OPTIONS`) is unguarded for wrapped and unwrapped commands alike.
  Not filed as an issue: it is the same enumerator behavior [#481] chose deliberately (stripping an assignment prefix so `AWS_PROFILE=prod aws …` cannot defeat an `aws *` rule), and reopening it belongs to whoever revisits that trade-off, not to this step.

[#306]: https://github.com/gotgenes/pi-packages/issues/306
[#309]: https://github.com/gotgenes/pi-packages/issues/309
[#452]: https://github.com/gotgenes/pi-packages/issues/452
[#481]: https://github.com/gotgenes/pi-packages/issues/481
[#490]: https://github.com/gotgenes/pi-packages/issues/490
[#574]: https://github.com/gotgenes/pi-packages/issues/574
[#609]: https://github.com/gotgenes/pi-packages/issues/609
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#680]: https://github.com/gotgenes/pi-packages/issues/680
[#741]: https://github.com/gotgenes/pi-packages/issues/741
[#706]: https://github.com/gotgenes/pi-packages/issues/706
[#712]: https://github.com/gotgenes/pi-packages/issues/712
[#806]: https://github.com/gotgenes/pi-packages/issues/806
[#807]: https://github.com/gotgenes/pi-packages/issues/807
