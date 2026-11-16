---
issue: 1019
issue_title: "pi-permission-system: forwarded bash asks drop the command's spellings on the serving node"
---

# A forwarded bash unit carries its spellings to the serving node

## Release Recommendation

**Release:** ship independently

The package has no open improvement phase (`docs/architecture/architecture.md` has no `## Improvement roadmap — Phase` heading), and this issue is in no roadmap step or release batch; the Phase 15 history records it as "out of scope for the roadmap".

## Problem Statement

A subagent's bash gate resolves each command unit as typed **and** in its spellings: the home-expanded form ([#981]) and the form with every path argument made absolute against the child's working directory ([#910]).
When the child forwards an ask, each asking unit rides the wire as `{ command, floor? }` ([#1030]), and the serving node resolves it with `spellings: []`.
So a serving-node rule or session grant that matches a unit only through a spelling misses it:

- The parent granted `~/bin/tool` for the session; the child asks about `~/bin/tool`; the parent prompts again.
- The parent's config denies `~/bin/tool*` under a `*` allow; the child's `${HOME}/bin/tool --now` is auto-approved by `*`.
- The parent's config denies `rm /tmp/builds/*` under a `*` allow; a child in `/tmp` running `rm builds/x` is auto-approved by `*`.

The issue framed the fix as stamping the deciding unit's spellings onto `PermissionCheckResult`.
Since [#1030] the wire carries a per-unit object, so the spellings belong on each `AskingBashUnit`, and the design question is only how the gate keeps a unit's spellings paired with the `command` the wire names.

## Goals

- Each forwarded asking unit carries the spellings of the command it names, as child-fixed facts (ADR 0008): only the child's parse knows whether the program rebinds `HOME`, and only the child knows its working directory.
- The serving node resolves each unit with those spellings, exactly as the child's gate resolved it.
- A unit whose `command` is not the unit's own text (the unparsed floor names the whole command line) carries no spellings, decided explicitly at the site that replaces the text.
- A present-but-malformed `spellings` drops the whole access intent, so the ask escalates (operator decision); it never reads as "no spellings".
- The child's own decisions, prompts, decision values, and session-approval suggestions are unchanged.
- **Not breaking** (operator decision): `fix(pi-permission-system):`.
  The spelling contract is already documented and shipped for the local gate (`docs/configuration.md` § Home Directory Expansion in Patterns and § `bash` Surface, [#981] as `fix`, [#910] as `fix!`); this brings the serving node to it.
  It changes decisions in both directions only where a parent rule or grant matches a spelling: a parent `deny` now catches the forwarded unit, and a parent absolute `allow` placed after a broader rule now answers a forwarded relative command that used to prompt.

## Non-Goals

- **A floor-exempt wrapper's inner command** ([#1128], filed by this planning session).
  `resolveWrapperUnit` decides an exempt unit by its inner command resolved with no spellings, so locally `time rm builds/x` misses `rm /tmp/builds/*: deny` (measured, see Background).
  That is a local-gate gap, not a forwarding one; this plan forwards the wrapper unit's own spellings (the spellings of `cmd.text`, which is the `command` the serving node resolves), as the gate resolves the wrapper unit's own rule today.
- **The whole-command resolves.**
  The trivially-empty path and the empty-parse path forward no `askingUnits`, so the serving node keeps judging the single `matchValues` value as typed; the child resolves those with no spellings too.
- **The top-level `matchValues` summary and the chain-level `floor`.**
  An older serving node reads them; a newer one ignores both when `askingUnits` is present ([#1030]).
- **`PermissionCheckResult`.**
  The pairing lives in a module-private type inside `bash-command.ts` (operator decision, option C); the public result type gains nothing.
- **Logging the spelling a serving rule matched.**
  `ForwardedRequestServer`'s `decidedBy` names the serving rule's pattern, not the spelling it matched (`matchedSpelling`); the child's review log already records the child's own.
- **Session grants that cross spellings.**
  A grant still records the command as typed, so a grant for `rm builds/x` does not cover a later `rm /tmp/builds/x` on either node ([#910]'s Non-Goal).
  The serving node gains the child's spellings as match values only; the grant patterns it records are unchanged.

## Background

- `resolveBashCommandCheck` (`src/handlers/gates/bash-command.ts`) maps each `BashCommand` to a `PermissionCheckResult` through `resolveCommandUnit`, picks the winner with `pickMostRestrictive`, and then applies `withChainFloor` and `withAskingUnits`.
  `withAskingUnits` builds each asking unit from the result alone, as `{ command: result.command ?? "", floor? }`; the unit's `cmd.spellings` are no longer in reach.
- `resolveCommandUnit` resolves `cmd.text` with `cmd.spellings ?? []` through `resolveOnBashSurface`, so the result's `command` is the typed text (`normalizeBashCommand` keeps `resultExtras.command` as typed).
  Then three sites can rewrite the result:

  | site                               | `command` afterwards        | do `cmd.spellings` describe it?                              |
  | ---------------------------------- | --------------------------- | ------------------------------------------------------------ |
  | plain unit                         | `cmd.text`                  | yes                                                          |
  | `floorToAsk` via the wrapper floor | `cmd.text`                  | yes                                                          |
  | `resolveWrapperUnit` exemption     | `base.command` = `cmd.text` | yes (the verdict came from the inner command; see Non-Goals) |
  | `floorUnparsedUnit`                | the whole command line      | no: no unit owns it                                          |

- `AskingBashUnit` (`src/types.ts`) is `{ command: string; floor?: string }`; `ForwardedAccessFacts.askingUnits` (`src/authority/permission-forwarding.ts`) types the wire with it.
- `describeToolGate`'s `askingUnitsFact` (`src/handlers/gates/tool.ts`) copies the array shallowly, and `toAccessFacts` (`src/authority/forwarded-request-server.ts`) passes `intent.askingUnits` by reference, so a new field on the unit objects reaches the wire and the escalated ask without either file changing.
- `asForwardedAccessIntent` (`src/authority/forwarding-io.ts`) is the allowlist reader: `isWellFormedAskingUnits` checks each unit's `command` and `floor` inline, and `copyAskingUnits` rebuilds each unit field by field, so today a `spellings` key is silently dropped on read.
  That is also why an older serving node, reading a newer child's request, keeps today's behavior.
- `ResolverServingPolicy.resolveUnit` (`src/policy/serving-policy.ts`) resolves `{ kind: "bash-command", surface: "bash", command: unit.command, spellings: [], agentName }`, then `honorChildFloor`.
- No new import edge: `serving-policy.ts` and `forwarding-io.ts` already import `AskingBashUnit` from `#src/types`, and `bash-command.ts` gains only a module-private interface.
- An open third-party PR ([#1097]) exports `resolveCommandUnit`; this plan changes its return type, so the two collide only at merge.

### Reproduction

Two disposable spikes (deleted before the plan commit) ran under `packages/pi-permission-system/test/` on `main` at `66ccfe1c`.
They used the real `warmBashParser` and `BashProgram.parseSync(...).commands()` (cwd `/tmp`) and the real `resolveBashCommandCheck` over an in-memory `PermissionManager` + `PermissionResolver` for the child (`bash: { "*": "ask" }`).
For the parent they used the real `ResolverServingPolicy` over a second in-memory manager and a real `SessionRules`.
The "with spellings" column resolved each unit through the serving node's own `PermissionResolver` with the child's `cmd.spellings`, before the floor; the path is deterministic (no cache, no model), so n = 1 per row.

| command                  | parent policy                         | parent today  | parent with spellings         |
| ------------------------ | ------------------------------------- | ------------- | ----------------------------- |
| `~/bin/tool`             | `*: ask` + session grant `~/bin/tool` | ask `*`       | allow, `source: "session"`    |
| `$HOME/bin/tool`         | `*: ask` + session grant `~/bin/tool` | ask `*`       | allow, `source: "session"`    |
| `~/bin/tool`             | `*: allow`, `~/bin/tool*: deny`       | **allow `*`** | deny `~/bin/tool*`            |
| `${HOME}/bin/tool --now` | `*: allow`, `~/bin/tool*: deny`       | **allow `*`** | deny `~/bin/tool*`            |
| `rm builds/x`            | `*: allow`, `rm /tmp/builds/*: deny`  | **allow `*`** | deny `rm /tmp/builds/*`       |
| `ls && ~/bin/tool`       | `*: allow`, `~/bin/tool*: deny`       | **allow `*`** | `ls` allow, `~/bin/tool` deny |

The second spike ran the child gate alone under `{ "*": "allow", "rm /tmp/builds/*": "deny" }`: `time rm builds/x` resolved **allow `*`** with `floorExemption: "execution-modifier"`, while the unit carried the spelling `time rm /tmp/builds/x`; that is [#1128].

Blast radius on the live review log (`~/.pi/agent/extensions/pi-permission-system/logs/pi-permission-system-permission-review.jsonl`, 2026-05-03 → 2026-11-16): 280 requests reached a serving node's decision (`forwarded_permission.prompted` / `auto_approved` / `auto_denied`), and 202 of them join by `requestId` to the child's `permission_request.waiting` entry for a `bash` command.
Re-parsing those 202 commands with the real parser (estimated: against the repo root as cwd, not each child's real cwd) gave 739 units, 163 of them spelled, in 90 commands; 0 units open with a home prefix.
So on this operator's log the carrier is the absolute argument spelling ([#910]), not `~`; the fix changes a decision only where the parent's config has a rule naming a spelling, which it does not today, so the measured prompt volume is unchanged.

## Design Overview

### The pairing (option C)

`bash-command.ts` gains a module-private pair, so a unit's verdict and the spellings of the command it names travel together:

```typescript
/**
 * One unit's verdict, and the spellings of the command that verdict names
 * (`check.command`). A site that changes `check.command` decides the spellings
 * in the same expression.
 */
interface ResolvedUnit {
  check: PermissionCheckResult;
  spellings: readonly string[];
}
```

Each site states what it names:

```typescript
function resolveCommandUnit(cmd, command, agentName, resolver): ResolvedUnit {
  const base = resolveOnBashSurface(cmd.text, cmd.spellings ?? [], agentName, resolver);
  const floored = cmd.wrapperKind && base.state === "allow" && !isSessionGrant(base)
    ? resolveWrapperUnit(cmd, cmd.wrapperKind, base, agentName, resolver)
    : base;
  // The unit's own text, plain or wrapper: its spellings still apply.
  const unit = floorUnparsedUnit(cmd, command, { check: floored, spellings: cmd.spellings ?? [] });
  return { ...unit, check: tagWithUnitFacts(cmd, unit.check) };
}

function floorUnparsedUnit(cmd, command, resolved: ResolvedUnit): ResolvedUnit {
  if (!cmd.parseUnresolved || resolved.check.state !== "allow" || isSessionGrant(resolved.check)) {
    return resolved;
  }
  // Names the whole command line, which no unit owns, so it has no spellings.
  return { check: { ...floorToAsk(resolved.check, UNPARSED_SUBTREE_SENTINEL), command }, spellings: [] };
}
```

`floorUnparsedUnit` takes and returns the pair (the assessor's advice): the invariant "the whole line has no spellings" lives in the one function that replaces `command`, never inferred by comparing objects.
`resolveWrapperUnit` keeps returning a `PermissionCheckResult`; both of its outcomes keep `command` as `cmd.text`.

The combiner unwraps:

```typescript
const units = commands.map((cmd) => resolveCommandUnit(cmd, command, agentName, resolver));
const checks = units.map((unit) => unit.check);
const winner = pickMostRestrictive(checks) ?? resolveOnBashSurface(command, [], agentName, resolver);
return withAskingUnits(withChainFloor(winner, checks), units);
```

`withAskingUnits` builds each asking unit from the pair:

```typescript
.filter((unit) => unit.check.state === "ask")
.map(({ check, spellings }) => ({
  command: check.command ?? "",
  ...(spellings.length === 0 ? {} : { spellings: [...spellings] }),
  ...(check.floor === undefined ? {} : { floor: check.floor }),
}));
```

`spellings` is omitted when empty, so a spelling-less unit keeps its exact current shape, and every existing `toStrictEqual` on `askingUnits` stays green.

Rejected: (A) re-pairing `commands[i]` with `results[i]` by `result.command === cmd.text` (safe but implicit, and it leans on index alignment); (B) a `spellings` field on the public `PermissionCheckResult` that every text-replacing site must remember to strip (the forgetting direction attaches spellings to the wrong text, which can loosen a decision).

### The unit type and the wire

`AskingBashUnit` gains one optional field:

```typescript
export interface AskingBashUnit {
  command: string;
  /**
   * The other spellings of `command` the child's shell runs identically, as the
   * child's program analysis produced them (home-expanded, path arguments made
   * absolute against the child's cwd). Child-fixed: the serving node matches
   * them as given and never recomputes them. Absent when there are none.
   */
  spellings?: readonly string[];
  floor?: string;
}
```

`asForwardedAccessIntent` keeps a well-formed `spellings` and rejects the whole intent when it is present and malformed: not an array, an empty array (the child omits the key when there are none), or an entry that is not a string.
Rejecting falls to the version-skew escalation (no intent → `ask`), as a malformed `floor` or `askingUnits` does.
`copyAskingUnits` copies `spellings` field by field (a fresh array), so no unread key rides through.
`askingUnitsFact` and `toAccessFacts` are unchanged and carry the field: a link judging the escalated ask on the serving node sees the same unit facts a link on the child sees.

### The judgment

```typescript
private resolveUnit(unit: AskingBashUnit, agentName: string): PermissionCheckResult {
  const check = this.resolver.resolve({
    kind: "bash-command",
    surface: "bash",
    command: unit.command,
    spellings: unit.spellings ?? [],
    agentName,
  });
  return honorChildFloor(check, unit.floor, this.isYoloEnabled());
}
```

`honorChildFloor` runs after the spelling-aware resolve, so a floored unit whose serving `allow` came through a spelling still clamps to `ask`, exactly as `floorToAsk` clamps on the child.

### Outcomes by serving resolution

| case                                                                     | outcome                      | pinned in      |
| ------------------------------------------------------------------------ | ---------------------------- | -------------- |
| a serving `deny` matches only a unit's spelling                          | auto-deny                    | Step 4         |
| a serving session grant matches only a spelling                          | that unit approves           | Step 4         |
| a serving absolute `allow` after a broader `ask` matches only a spelling | that unit approves           | Step 4         |
| a spelling-matched `allow` on a floored unit                             | `ask`, floor's sentinel      | Step 4         |
| spellings are matched as the child fixed them, not recomputed            | deny on a non-local absolute | Step 4         |
| a unit without `spellings` (older child, or none)                        | judged as typed (today)      | Step 4 control |
| `spellings` present and malformed                                        | intent dropped → escalate    | Step 4         |
| unparsed floor names the whole line                                      | no `spellings` on the unit   | Step 3         |

### Version skew

- Older child → this serving node: units carry no `spellings`, so `resolveUnit` uses `[]`, as today.
- This child → a serving node at [#1030]'s release: its `copyAskingUnits` rebuilds `{ command, floor }` and drops `spellings`, as it does today.
- Both nodes in one process load the same package, so the window is an out-of-process child across an upgrade.

### Disclosure

`spellings` holds the same command text as `command`, with the home directory and the child's cwd written out.
The forwarding request files are mode-restricted and unredacted by design (they already hold `command`), and the review log does not record `accessIntent` (measured: 0 `"accessIntent"` keys in the 17.7 MB review log above), so no new log surface carries it.

## Module-Level Changes

- `src/handlers/gates/bash-command.ts`
  - Step 2: extract `tagWithUnitFacts(cmd, check)` (the `commandContext` / `executedUnit` tail of `resolveCommandUnit`).
  - Step 3: module-private `ResolvedUnit`; `resolveCommandUnit` and `floorUnparsedUnit` return it; `resolveBashCommandCheck` unwraps for `pickMostRestrictive` / `withChainFloor`; `withAskingUnits` takes `readonly ResolvedUnit[]` and stamps `spellings`; its doc and `floorUnparsedUnit`'s doc name the pairing.
- `src/types.ts` — `AskingBashUnit.spellings?` with its doc (Step 3).
- `src/authority/forwarding-io.ts`
  - Step 1: extract `isWellFormedAskingUnit(unit: unknown): unit is AskingBashUnit`; `isWellFormedAskingUnits` becomes non-empty-array plus `.every(isWellFormedAskingUnit)`; `copyAskingUnits` takes `readonly AskingBashUnit[]`.
  - Step 4: the per-unit predicate checks `spellings`; `copyAskingUnits` copies it.
- `src/policy/serving-policy.ts` — `resolveUnit` passes `unit.spellings ?? []`; the class doc names the spellings (Step 4).
- `src/authority/permission-forwarding.ts` — `ForwardedAccessFacts.askingUnits` doc: "each with its own floor and spellings" (Step 4).
- `src/authority/forwarded-request-server.ts` — `ServingPolicy` doc names the spellings (Step 4); `toAccessFacts` predicted **unchanged** (it passes `askingUnits` by reference).
- `src/handlers/gates/tool.ts` — predicted **unchanged**: `askingUnitsFact` copies the array shallowly, so unit objects keep `spellings`.
- `test/helpers/forwarding-fixtures.ts` — predicted **unchanged**: `makeForwardedAccessIntent` passes `askingUnits` through.
- Tests: `test/authority/forwarding-io.test.ts` (Steps 1 and 4), `test/handlers/gates/bash-command.test.ts` (Step 3), `test/handlers/gates/tool.test.ts` (Step 3), `test/composition-root.test.ts` (Step 3), `test/policy/serving-policy.test.ts` (Step 4), `test/authority/forwarded-request-server.test.ts` (Step 4).
- Docs (Step 5):
  - `docs/architecture/architecture.md`: the `serving-policy.ts` entry (each unit resolves "with its child-fixed spellings"), the `bash-command.ts` entry (`resolveCommandUnit` pairs each verdict with the spellings of the command it names; `floorUnparsedUnit` names the whole command with none; `withAskingUnits` lists `{ command, spellings?, floor? }`), the `permission-forwarding.ts` entry (`askingUnits` each with its own floor and spellings), and the `forwarding-io.ts` entry (a malformed unit list, spellings included, drops the intent).
  - `docs/configuration.md`, after the forwarded-chain sentence (line ~621): the parent's rules and grants match each forwarded command in the same spellings the subagent's own rules do (the home-expanded form and absolute path arguments, resolved in the subagent's directory).
  - `docs/subagent-integration.md` § Permission Forwarding: the chained-command sentence gains that the parent matches each command in the spellings the child computed.
  - `.pi/skills/package-pi-permission-system/SKILL.md` — predicted **unchanged**: its spellings bullet describes the producers, which this plan does not touch.

## Test Impact Analysis

1. New tests the change enables: the child's per-unit spellings on `askingUnits` (one per row of the Background table), the wire round-trip and malformed rows for `spellings`, and the serving node's spelling-aware outcomes.
2. Redundant tests: none; the existing spelling-less `askingUnits` assertions stay as the "omitted when empty" control.
3. Tests that stay as-is because they exercise the layer: every existing `resolveBashCommandCheck` test (the unwrap must not change a decision), `serving-policy.test.ts`'s floor and per-unit describes ([#1029], [#1030]), and the [#1033] session-grant tests.

## Invariants at risk

| invariant (source)                                                                                                | constituency                                     | pinned by                                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| The child's decision, `command`, `matchedPattern`, `floor` are unchanged by the pairing ([#981], [#910], [#1029]) | the local prompt, review log, session suggestion | the whole `bash-command.test.ts` suite, run in Steps 2 and 3                                                                                         |
| A forwarded floor is honored per unit, and a session grant or yolo still answers it ([#1029])                     | parent operators who allow `*`                   | `serving-policy.test.ts` "honors the floor the child raised" and "judges every unit" describes; Step 4 adds the spelling-matched-allow-on-floor case |
| Every asking unit is judged, most restrictive wins ([#1030])                                                      | parent operators with targeted denies            | `serving-policy.test.ts` "judges every unit the child left asking"; Step 4's chain row                                                               |
| A session-granted unit is never forwarded ([#1033])                                                               | users who grant per command                      | `bash-command.test.ts` "leaves out a unit the session already granted"                                                                               |
| A malformed fact escalates rather than reading as absent (ADR 0008 §4)                                            | everyone                                         | `forwarding-io.test.ts` malformed rows; Step 4 adds `spellings` rows                                                                                 |
| Spelling-less units keep their exact wire shape                                                                   | older serving nodes, links                       | existing `toStrictEqual` assertions in `bash-command.test.ts`, `tool.test.ts`, `composition-root.test.ts`, `forwarded-request-server.test.ts`        |

## TDD Order

1. **`refactor(pi-permission-system): check a forwarded asking unit with one typed predicate`**
   - Prepares the Step 4 friction: the unit shape is written inline in `isWellFormedAskingUnits` (with inline casts) and again in `copyAskingUnits`'s parameter.
   - Extract `isWellFormedAskingUnit(unit: unknown): unit is AskingBashUnit`; `isWellFormedAskingUnits` becomes `Array.isArray(value) && value.length > 0 && value.every(isWellFormedAskingUnit)`; type `copyAskingUnits` with `readonly AskingBashUnit[]`.
   - Behavior-preserving; pinned by `forwarding-io.test.ts` § `askingUnits` (round-trip and the five malformed rows).
     Run that file, then `pnpm --filter @gotgenes/pi-permission-system run check`.
2. **`refactor(pi-permission-system): tag a bash unit's facts in one helper`**
   - Prepares Step 3: extract the `commandContext` / `executedUnit` tail of `resolveCommandUnit` into `tagWithUnitFacts(cmd, check)`, placed below its caller, so the Step 3 diff in `resolveCommandUnit` is only the pairing.
   - Behavior-preserving; pinned by the full `bash-command.test.ts` (the nested-context and `executedUnit` cases).
3. **`refactor(pi-permission-system): list each asking bash unit with the spellings of the command it names`**
   - Typed `refactor:`: the wire gains the field, but no serving node reads it until Step 4, so nothing a user sees changes.
   - Red, `bash-command.test.ts` § "the units a chain leaves asking" (real parse, real manager):
     - a plain unit: `decide({ "*": "ask" }, "~/bin/x")` lists `[{ command: "~/bin/x", spellings: [home + "/bin/x"] }]`;
     - a chain lists spellings only on the spelled unit: `ls && ~/bin/x`;
     - a floored wrapper keeps its own text's spellings and its floor: `decide({ "*": "allow" }, "sudo ~/bin/x")` → `{ command: "sudo ~/bin/x", spellings: ["sudo " + home + "/bin/x"], floor: "<indirection-bash-wrapper>" }`;
     - an exempt wrapper keeps the wrapper text's spellings: `decide({ "*": "allow", "rm *": "ask" }, "time rm builds/x")` → `{ command: "time rm builds/x", spellings: ["time rm " + cwd + "/builds/x"] }`, where `cwd` is `process.cwd()`, the file-level `normalizer`'s base (`builds/x` is spelled by its shape whether or not it exists, measured in the spike);
     - the unparsed floor carries none: `resolveBashCommandCheck("~/bin/x (", [{ text: "~/bin/x", spellings: ["/h/bin/x"], parseUnresolved: true }], undefined, resolverOver({ "*": "allow" }))` → `[{ command: "~/bin/x (", floor: "<unparsed-bash-subtree>" }]` with no `spellings` key (`toStrictEqual`).
   - Red, `composition-root.test.ts`: a sibling of "forwards every unit a child's bash chain left asking" fires `~/bin/tool` under `bash: { "*": "ask" }` and asserts `request.accessIntent?.askingUnits` `toStrictEqual([{ command: "~/bin/tool", spellings: [homedir() + "/bin/tool"] }])`.
   - Pin (passes at red), `tool.test.ts` "carries a bash chain's asking units on promptDetails": add `spellings` to one unit of the check and the expectation.
   - Green: `ResolvedUnit`, the `resolveCommandUnit` / `floorUnparsedUnit` / `resolveBashCommandCheck` / `withAskingUnits` changes, and `AskingBashUnit.spellings`, as in Design Overview.
   - Killing mutations:
     - Delete the `spellings` spread in `withAskingUnits`: kills the plain, chain, wrapper, exempt, and composition-root tests.
     - In `floorUnparsedUnit`'s floor branch, return `spellings: resolved.spellings` instead of `[]`: kills the unparsed test.
     - In `resolveCommandUnit`, seed the pair with `spellings: []` whenever `cmd.wrapperKind` is set: kills the wrapper and exempt tests only.
     - In `askingUnitsFact` (`tool.ts`), rebuild units as `{ command, floor }`: kills the `tool.test.ts` pin.
   - Verify: the full `bash-command.test.ts`, `tool.test.ts`, and `composition-root.test.ts`, then `pnpm --filter @gotgenes/pi-permission-system run check`.
4. **`fix(pi-permission-system): a subagent's forwarded bash command is matched in its spellings on the parent`**
   - Red, `forwarding-io.test.ts` § `askingUnits`:
     - the round-trip includes a unit with `spellings` (`toStrictEqual`);
     - `it.each` malformed rows: `spellings` not an array (`"x"`), an empty array, and a non-string entry (`[42]`), each dropping the access intent.
   - Red, `serving-policy.test.ts`, a new describe "ResolverServingPolicy matches each unit in the spellings the child fixed":
     - a serving deny reaches a unit only through its spelling: `{ "*": "allow", "/child-home/bin/*": "deny" }` with `{ command: "~/bin/tool", spellings: ["/child-home/bin/tool"] }` → deny `/child-home/bin/*` (a non-local absolute, so it also pins that spellings are used as given, never recomputed);
     - an argument spelling: `{ "*": "allow", "rm /tmp/builds/*": "deny" }` with `{ command: "rm builds/x", spellings: ["rm /tmp/builds/x"] }` → deny;
     - a session grant written with `~`: `sessionGranting("~/bin/tool")` under `{ "*": "ask" }` with `{ command: "~/bin/tool", spellings: [homedir() + "/bin/tool"] }` → allow, `source: "session"`;
     - a spelling-matched allow on a floored unit still asks: `{ "*": "ask", "sudo /child-home/bin/*": "allow" }` with `{ command: "sudo ~/bin/x", spellings: ["sudo /child-home/bin/x"], floor: WRAPPER }` → ask, `matchedPattern` WRAPPER;
     - the chain row: `ls` plus a spelled `~/bin/tool` unit under the deny → deny;
     - control: the first case without `spellings` → allow `*` (today's answer for an older child).
   - Pin (passes at red), `forwarded-request-server.test.ts` "carries a bash chain's asking units onto the escalated ask details": add `spellings` to one unit and the expectation.
   - Green: the `spellings` clause in `isWellFormedAskingUnit`, the copy in `copyAskingUnits`, `unit.spellings ?? []` in `resolveUnit`, and the doc comments in `serving-policy.ts`, `permission-forwarding.ts`, and `forwarded-request-server.ts`.
   - Killing mutations:
     - Make `resolveUnit` pass `spellings: []` again: kills every serving-policy row except the control (the floored-allow row resolves `ask` from `*` instead, so its `matchedPattern` assertion reads `*` rather than the floor's sentinel).
     - Drop the `honorChildFloor` call in `resolveUnit`: kills the floored-allow row (the spelling's `allow` stands) along with the existing floor tests.
     - Drop `spellings` from `copyAskingUnits`: kills the round-trip.
     - Delete the `spellings` clause from `isWellFormedAskingUnit`: kills the three malformed rows.
     - Make `toAccessFacts` rebuild `askingUnits` as `{ command, floor }`: kills the server pin.
   - Verify: the four touched test files, then the full package suite (`pnpm --filter @gotgenes/pi-permission-system exec vitest run`) and `check`.
5. **`docs(pi-permission-system): document that forwarded bash commands are matched in their spellings`**
   - The `docs/architecture/architecture.md`, `docs/configuration.md`, and `docs/subagent-integration.md` edits listed in Module-Level Changes.
   - Verify: `pnpm exec rumdl check` on the three files, and re-read each edited sentence for an em-dash split.

## Risks and Mitigations

- **Spellings attached to text they do not describe** would let a parent `allow` on a spelling approve a different command.
  Mitigation: the pair is decided at the site that sets `command`; Step 3's unparsed test and its `floorUnparsedUnit` mutation pin the one text-replacing site.
- **The exempt wrapper's verdict came from its inner command, yet the unit forwards the wrapper text's spellings.**
  The serving node already resolves the wrapper text, not the inner command ([#1030]); this plan keeps that, and the spellings describe exactly that text.
  The inner-command gap is [#1128].
- **A parent absolute `allow` now loosens a forwarded relative command.**
  This is the local contract [#910] shipped as breaking; the operator classified this change as `fix:` because it brings the serving node to that contract.
  The configuration doc sentence in Step 5 states it.
- **Merge collision with PR [#1097]**, which exports `resolveCommandUnit`.
  Whichever lands second adapts to the other's signature; noted for `/ship`.
- **A home directory differing between the test host and CI.**
  Tests that depend on `homedir()` compute the expectation from it; the serving-policy deny rows use a synthetic absolute (`/child-home/...`), so they need no home at all.

## Open Questions

None.

[#910]: https://github.com/gotgenes/pi-packages/issues/910
[#981]: https://github.com/gotgenes/pi-packages/issues/981
[#1029]: https://github.com/gotgenes/pi-packages/issues/1029
[#1030]: https://github.com/gotgenes/pi-packages/issues/1030
[#1033]: https://github.com/gotgenes/pi-packages/issues/1033
[#1097]: https://github.com/gotgenes/pi-packages/pull/1097
[#1128]: https://github.com/gotgenes/pi-packages/issues/1128
