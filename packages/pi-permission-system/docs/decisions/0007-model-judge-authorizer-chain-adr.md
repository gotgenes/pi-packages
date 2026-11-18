---
status: accepted
date: 2026-07-15
amended: 2026-11-18
---

# 0007 — Model-assisted permission judge as an Authorizer chain

## Status

Accepted.
This decision settles the design of a case-by-case model judge ([#472]); it does not implement it.
[#472] stays open, tracking the implementation, and carries this ADR.
It supersedes the reverted ADR 0007 attempted under [#581].
Amended 2026-08-14 with §7 (one chain per node), which settles where a subagent's ask is adjudicated ([#727]).
Amended 2026-10-17 with §8 (the nothing-on-disk license), which lets a link `allow` one narrow class of bash `external_directory` ask that §5 excluded ([#882]).
Amended 2026-11-16 by `docs/decisions/0016-policy-channels.md` §5, which answers the per-link question §8 left to [#620] and [#799]: the operator may lift §5's cap per link and per surface family (`authorizerTrust`), so the cap is an operator default rather than a boundary, and a judge's `allow` is a first-class outcome.
The same record adds an auto-approve terminal beside §2's three, reached after the links, and keeps one class of ask capped regardless: an agent's edit to the policy files (ADR 0016 §9).
Amended 2026-11-18 with §9 (a partial allow), which lets a link decide some asking units of a bash chain and leave the rest to the chain ([#1101]).

## Context

`yoloMode` is the only non-static path in a permission decision today: a single boolean that rewrites every `ask` rule to `allow` at composition time (`origin: "yolo"`), suppressing prompts while preserving hard denies.
It is all-or-nothing — it cannot approve one clearly safe `ask` and still prompt on the rest.

[#472] asks for a case-by-case judge: a light model (e.g. Claude Haiku) that participates in a decision, deciding per ask.
It was deferred by name in Phases 9 and 10.
[#581] then attempted a decision record but treated it as transcription of the architecture doc's settled `ModelTriageAuthorizer` prose — an ask-only, allow-or-escalate decorator — and that ADR was found premature and reverted.
An ADR's value is the deliberation behind it; the prose itself was the wrong input.

Two concrete use cases, surfaced during the [#581] retro, show the real design is broader than — and in one respect contradicts — the reverted prose:

1. **Reject errant "typo" paths automatically.**
   Models frequently invoke tools against a malformed path (e.g. `…/pi-permission-system/packages/pi-permission-system/src/x.ts`, where the first segment should be `pi-packages`).
   These land as `external_directory` asks that a human hand-denies one by one.
   A light model should review such asks, *defer* the ones that do not match a configured typo pattern, and *deny* the ones that do — returning a teaching reason (wrong path; correct location) so the invoking model self-corrects.
2. **Adjudicate opaque bash commands.**
   Commands the deterministic parser cannot decompose (`bash -c "…"`, `eval`, unparseable constructs) floor to `ask` via sentinels.
   A model should decompose the opaque command, query the deterministic engine per sub-command, and *allow* if clearly fine, *deny* if it hits a denied path, or *defer* if it cannot decide confidently.

The enabling premise is that nothing constrains an `Authorizer` to be deterministic.
`LocalUserAuthorizer` is already a non-deterministic oracle — the human — and the determinism principle governs *recorded* authority (`evaluate()`), never the live-authority layer (ADR `docs/decisions/0005-serving-authorizer-provenance.md`).
A model can hold the `Authorizer` role on the same terms.

## Decision

Model the live-authority layer as a **Chain of Responsibility**, and place the model judge in it as a non-terminal link.

### 1. Verdict range is `allow | deny | defer`

Each link either decides (`allow` / `deny`) or defers to the next link.
This is a superset of the reverted ADR's ask-only allow-or-escalate framing: use case 1 is deny-first, and an `Authorizer` already denies (the human does; `DenyingAuthorizer` always does), so a model in that role can deny an ask too.
A `deny` carries an optional `reason` — the teaching signal use case 1 needs.

```typescript
type AuthorizerVerdict =
  | { kind: "allow" }
  | { kind: "deny"; reason?: string }
  | { kind: "defer" };
```

### 2. The terminal link cannot defer

The chain ends at a terminal that must decide; until it does, the system pauses.
Today that terminal is the human (`LocalUserAuthorizer`), the headless `DenyingAuthorizer`, or `ParentAuthorizer` (terminal *for its node* — it forwards up and returns the parent node's `allow | deny`, the multi-hop recursion).

The invariant is enforced **at the type level**, not by a runtime assertion: a terminal returns only `allow | deny`, so a link that could defer cannot occupy the terminal slot.

```typescript
/** A non-terminal chain link: may decide or defer. */
interface Authorizer {
  authorize(details: PromptPermissionDetails, query: PermissionQuery, log: AuthorizerLog): Promise<AuthorizerVerdict>;
}

/** The terminal link: structurally cannot defer. */
interface TerminalAuthorizer {
  authorize(details: PromptPermissionDetails, query: PermissionQuery): Promise<TerminalVerdict>;
}
// TerminalVerdict = { kind: "allow" } | { kind: "deny"; reason?: string }
```

`selectAuthorizer` (which returns a single `Authorizer` today) generalizes to `composeAuthorizerChain`: registered non-terminal links, then the context-selected terminal last.
The terminal selection is unchanged.

### 3. The query capability is injected, not imported

A link never reaches for the cross-extension `PermissionsService` via `Symbol.for()` (a Law-of-Demeter reach-through to a global).
The chain injects a narrow, session-scoped `PermissionQuery` into each link at `authorize` time — a projection limited to what a link needs (ISP), backed by the same resolver the gates use so it answers at gate parity.

```typescript
/** Narrow, injected projection of PermissionsService. */
interface PermissionQuery {
  checkPermission(surface: string, value?: string, agentName?: string): PermissionCheckResult;
  getToolPermission(toolName: string, agentName?: string): PermissionState;
}
```

The tool-augmented adjudication (use case 2) exposes these primitives to the model *as tools*: the model decomposes an opaque command and calls `checkPermission("bash", subCommand)` / `checkPermission("external_directory", token)` per piece; the deterministic engine answers every sub-question.
The model's non-determinism is confined to *how it decomposes*, never *what the rules decide* — determinism-of-decision survives at the leaf.

#### The review-log seam is injected the same way

A link is handed a second narrow capability at `authorize` time: an `AuthorizerLog`, for recording its decision trail.
The motivation is observability — without it a link's verdict (especially a `defer`) is unobservable, so a misbehaving link deferring every ask is indistinguishable from a link never running (the `pi-permission-model-judge` auth-failure that motivated this addition).
The seam follows the same injection discipline as `PermissionQuery`: a link never reaches for the session logger via `Symbol.for()`; the chain owner passes the session's own logger straight through, so a link's entries land in the same `pi-permission-system-permission-review.jsonl` as the gate decisions, keyed by `requestId`.

```typescript
/** Narrow, injected review-log seam. */
interface AuthorizerLog {
  review(event: string, details?: Record<string, unknown>): void; // durable, default-on audit entry
  debug(event: string, details?: Record<string, unknown>): void; // verbose detail, gated by `debugLog`
}
```

The seam only *records*; it grants no authority and cannot alter a verdict, so it is inert with respect to the bounded-delegation invariant below.

### 4. Named-capability registration, opt-in activation

Registration mirrors `registerToolAccessExtractor`: a downstream extension offers a **named** capability on the published service.

```typescript
registerAuthorizer(name: string, authorize: Authorizer["authorize"]): () => void;
```

The downstream extension registers in a `permissions:ready` handler, so registration is robust to load order and survives `/reload`; it must land before the session's first ask.
Composition then reads the operator's configured chain and binds names to registered capabilities.

Three invariants govern the seam:

1. **Config order wins, never registration order.**
   Chain order is security-relevant (an allow-capable link ahead of a deny-capable one changes outcomes), so it is deterministic operator policy — never a function of nondeterministic extension load order.
2. **Skipping any non-terminal link is always fail-safe.**
   A missing or unregistered configured name removes only allow/deny *shortcuts*; the ask still reaches the terminal.
   Absence of a judge means *more* prompting, never less — so a missing name is skipped with a warning.
3. **Registration alone grants no authority.**
   A registered link decides nothing until the operator names it in the `authorizerChain` config — the opt-in activation model.
   Installing a judge extension does not silently hand it decision authority.

### 5. Config split: policy here, mechanism downstream

Two independent extension config files, joined only by the link name — no merged schema.
This package declares and *enforces* the safety policy; the downstream extension declares and *uses* the model mechanism.

```jsonc
// pi-permission-system config.json — operator-owned policy (read + enforced HERE)
{
  "authorizerChain": ["model-judge"],
  "modelDelegation": {
    "allowedSurfaces": ["bash"],
    "excludedSurfaces": ["external_directory"] // + secret-shaped path always excluded
  }
}
```

```jsonc
// pi-permission-model-judge config.json — downstream-owned mechanism (read THERE)
{ "provider": "anthropic", "model": "claude-haiku-…", "instructions": "…", "timeoutMs": 5000 }
```

The bounded-delegation policy is enforced at an **enforcement checkpoint** the chain owner (this package) applies to every verdict: a link's `allow` on an excluded surface is downgraded to `defer`.
So the safety envelope lives where it is enforced, and a buggy or over-eager external judge can never exceed the operator's policy.
This package holds no model-prompt config it does not read (the "declared-but-unread config is a maintenance trap" priority).

### 6. Two slices, a capability gradient

Both use cases are the *same* judge link; they differ only by which verdicts are enabled and how much envelope guards them.

| Aspect       | Slice 1 — deny-first reviewer (use case 1)                     | Slice 2 — allow-capable adjudicator (use case 2)                                                                  |
| ------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Verdicts     | `deny`, `defer`                                                | `+ allow`                                                                                                         |
| Risk         | strictly more restrictive — always safe                        | loosens privilege — needs full envelope                                                                           |
| Envelope     | fail-closed only (unreachable/uncertain → defer)               | + hard exclusions, audit `origin:"authorizer:model"`, non-persistence, off by default, bounded-delegation ruleset |
| Failure mode | a wrong deny — recoverable (agent self-corrects on the reason) | decomposition infidelity — mis-split obfuscation (`bash -c "safe; evil"`) allowed on the safe piece alone         |

The "a tool-augmented model can never grant more than the engine grants for the pieces it identifies" safety property holds *only if decomposition is faithful*.
Obfuscation is the residual risk, and it is exactly why slice 2 is gated behind the whole envelope while slice 1 needs almost none.
The gradient is the argument for shipping deny-first.

### 7. One chain per node

An ask is adjudicated by exactly one node's chain: the node whose terminal decides it.

A node with UI (`LocalUserAuthorizer`) and a headless node with no reachable authority (`DenyingAuthorizer`) both decide locally, so both run their chain.
Since [#909] a node with UI is the first of those only while it names no parent session that is draining its inbox; when it does name one, it relays and the clause below governs it instead.
The rule is unchanged — what narrowed is which nodes are terminal-local.
A subagent node whose terminal is `ParentAuthorizer` does not decide — it relays the ask to a serving node, which resolves it against its own recorded authority and escalates it through its own chain over the same child-fixed facts ([#635]).
So a relaying node resolves no links, and its terminal's forwarding *is* how the ask reaches a chain.

This is a consequence of §2's terminal-for-its-node framing, made explicit because the observable behavior contradicted it: a child's chain resolution found no links (a child cannot host one — [#699]) and reported each configured name as a fail-safe skip, which reads as the configured judge never running.
It runs; it runs one hop up.

The rule is not merely descriptive of the current implementation.
Running links on a relaying node as well would adjudicate one ask twice — the same link, over the same facts, once in the child and again on the serving node — with a second model call and a second latency, and would let a link decide an ask the serving node's policy owns.

Two review-log records make the placement observable, since a deferring link decides nothing and otherwise leaves no evidence it was consulted:

- `authorizer_chain_resolved` — an adjudicating node's resolved link names, recorded before any of them runs.
- `authorizer_chain_delegated` — a relaying node's configured names, recorded as deliberately not run.

This leaves `authorizer_chain_unregistered_link` meaning what it says: a name the adjudicating node could not resolve, which is a real misconfiguration.

The rule also settles the shape of [#699]'s fix: a sibling extension should skip registering a link in a registered child rather than registering one that would never be consulted.

### 8. A link may allow a bash `external_directory` ask whose paths name nothing on disk

§5 excludes the whole `external_directory` family from a link's `allow`.
ADR 0009's layering principle routes the projection's surplus to judgment instead: the deterministic layer surfaces every token that could be a path, because over-suppression is unrecoverable, and the judge absorbs the false positives.
On `external_directory` the two records contradicted each other, because that is the surface where the false positives land and the one surface a judge could only defer back to the human.

The population is the **shape-indistinguishable** token: one an absolute-path shape rule must accept and no deterministic rule can separate from a real path.
[#797]'s spreadsheet cell reference (`officecli set data.xlsx /Sheet1/B1`) is the clean example.
[#880]'s `commandEffects: { officecli: { effects: [] } }` withdraws a *declared* tool's operands on the ask-producing side; this section is the ask-consuming lever for the tool nobody declared.

**The bound.**
The checkpoint honors a link's `allow` on an `external_directory`-family ask when the ask carries the **nothing-on-disk license**.
The bash external-directory gate grants it only when the command reads verbatim (the grammar parsed it without error recovery, and it holds no backslash-newline continuation), and then iff, for **every** path it left uncovered:

1. the token is a whole word spelled verbatim as the absolute path it names — the grammar can split one bash word into two arguments without an error (the `/e` of ``cat /e`echo tc`/passwd``), so the token must be bounded in the source by one of bash's own word boundaries (a space, a tab, a newline, or an operator other than a parenthesis, none of them escaped by a backslash) or the source edge, never by a carriage return, form feed, or vertical tab, which tree-sitter-bash splits on and bash does not; a relative token depends on a working directory the projection only models (after a non-literal `cd` it is a display guess, and a literal `cd` that fails leaves the shell where it was), a `.` or `..` segment is collapsed lexically while the kernel resolves it through any symlinked ancestor, a glob, brace, parameter or command substitution, or escape is rewritten by the shell at run time, and a POSIX-absolute token on a win32 host stays literal (Git Bash keeps it so, per ADR 0003), so none of these licenses;
2. the path is not the root, and walking its canonical form toward the root, the first entry `lstat` finds is the filesystem root itself — the root exists, so `rm -rf /` names something; only "no such entry" continues the walk, so an ancestor that is a file, or one the process cannot read, refuses the license;
3. its attributed effect is not a proven `write` — a redirect destination or a declared writer is a file by syntax or by the user's word, not a token whose shape is in doubt.

A command that does not read verbatim is refused outright because the projection's tokens are not the words bash runs: error recovery leaves an extglob operand (`shopt -s extglob`, then `rm -rf /@(etc|var)`) truncated as `/@`, and a backslash-newline splits `/e\<newline>tc/passwd` into a flagged `/e`, though bash reaches `/etc` in both.
The rule is a positive spelling, not a list of exclusions, because six review rounds found the exclusions one at a time.

A nonexistent path cannot be read, so the `_read` half of such an ask is vacuous.
The `_write` half is where the conditions bite: a path whose top-level component does not exist can only come into being by creating a new entry directly under the root.

**What the bound does not cover.**
A tool ask (`write`, `edit`, an extension tool's extracted path) never carries the license: a tool's path argument is a path by the tool's identity, not by its shape, so the shape-indistinguishable class does not arise there.
The `path` family stays excluded whatever facts the ask carries, because a `path` ask fires on a rule the operator wrote.
An ask whose surface cannot be determined stays capped.

**The accepted residual** is a command that, privileged to write at the filesystem root, creates a new top-level entry there.
On macOS the sealed system volume refuses that even under `sudo`; on Linux it needs root.
A `sudo` unit raises its own bash-surface floor ask, which this record never excluded from delegation, so the residual is no wider than what a link could already approve on that surface.
The probe runs at the gate, before the command does; a unit earlier in the same command that creates the top-level directory flags that directory too, and it is itself unrooted, so the race widens the residual by nothing.

**The fact and the wire.**
The license is a child-fixed fact (`docs/decisions/0008-cross-session-access-intent.md`): the asking node's gate computes it once, it rides `ForwardedAccessFacts` as `delegationLicense: "nothing-on-disk"`, and a serving node projects it onto the ask's details without probing its own filesystem.
It has that one home.
The envelope already reads the gate-authoritative access facts, and the license is a security input rather than a presentation fact, so it is not copied onto the prompt payload as well.
A version-skewed node on either side reads its absence, which is the restrictive reading: an older child sends none, and an older serving node's allowlist drops it.

**The audit line.**
Every `allow` the checkpoint honors because of the license writes `authorizer_allow_licensed` to the review log, naming the request, the link, and the license, beside the `permission_request.approved` entry whose `decidedBy` names the same link.
The record is written where the decision to honor the verdict is taken, so the fact that licensed it is never inferred.

**The evidence.**
Measured 2026-10-17 against the maintainer's permission review log with disposable scripts.
Of 617 bash `external_directory` asks whose entries recorded their paths (2026-05-03 to 2026-08-14), 13 had every flagged path unrooted.
The later entries record no paths, so their commands were re-projected through `BashProgram.parse` with an assumed working directory: of 429 asks with external paths, 18 qualified.
Every one of the 31 is a non-path token — `gh api` routes, Pi slash commands, `git log -L` ranges, commit-message prose, and regex fragments.
The 18 recent asks' licensing paths were 18 `unproven` and one core read, which is why the bound does not ask for a proven read.
Another 14 asks mixed an unrooted token with a real external path, and those keep prompting, because the license is granted only when every path qualifies.
The verbatim-spelling, root, and verbatim-read conditions were added after pre-completion review found that a glob (`cat /e?c/passwd`), the root itself (`rm -rf /`), a truncated extglob (`/@(etc|var)`), a backslash-newline, a relative path after a failing `cd`, a `..` segment, and a word split by the grammar (at a mid-word backtick or process substitution, a carriage return, or a backslash-escaped tab) had licensed.
Re-run through the shipped gate over the same recent asks (a disposable vitest harness that fed every `permission_request.waiting` bash entry on an `external_directory` surface through `BashProgram.parse` and `describeBashExternalDirectoryGate`, with the repo root as the assumed working directory), 8 of 430 carry the license (1 of the 430 had a parse error): seven tokens that name no host path (`git log -L` ranges, commit-message and `echo` prose, a container mount path) and one real edit target, `sudo -n --ed /nonexistent-dir-xyz/f`, which keeps its own bash-surface floor ask.

**An operand the gate never flagged.**
The license judges only the paths the gate flagged.
A whole-argument operand the projection never flags does not withhold it: a computed operand that resolves inside the tree (`X=/etc; cat $X/passwd /Sheet1/B1`), a `~user/` form, a bare ANSI-C `$'/etc/passwd'`, a path glued to an option (`-f/etc/passwd`, `dd if=/etc/passwd`), `$PWD/x` after a `cd`, and a `~/x` after `HOME` is rebound.
The gate also reads a command trimmed of its leading and trailing whitespace, so a trailing carriage return bash keeps on the last word never reaches the projection; the word it extends stays under the same absent top-level directory unless it is a single segment, which is the accepted residual of a new entry under the root.
That is the projection's existing reach, which the human prompt shows the same way, and it is accepted rather than refused per command: refusing every command that holds a computed word would withhold the license from the shapes it exists for.

**What this does not decide.**
It does not lift the cap for a whole surface family, globally ([#684]'s flag) or per link ([#983]'s `authorizerTrust` map).
A switch of that shape hands a model the outside-the-tree boundary wholesale, which is the reason §5 excluded the family; whether an operator may opt a named link into it is a question about who may widen policy, and it stays with [#620] and [#799].

**Compatibility.**
The guarantee that the chain owner caps every link `allow` on the `external_directory` family no longer holds unconditionally, so a configured link's `allow` on a licensed ask is honored on upgrade without a user edit.
It ships as a breaking change with a migration note (`docs/migration/0882-nothing-on-disk-delegation-license.md`).
No first-party link returns `allow` on the family: `pi-permission-model-judge` is deny-first by charter.
The license is visible to any link on `details.accessIntent`, so adopting it is each link's own decision.

### 9. A link may allow part of a bash chain

An ask over a bash chain covers every unit still asking, and §1's verdicts rule on the whole ask.
A link that accepts one unit (a plain assignment) and not another (`git commit`) could only defer, so the human was shown the accepted unit as the prompt's value and offered a session grant for it.

**The verdict.**
A fourth member, `{ kind: "allow_units"; units: readonly string[] }`, names asking units by their command text (`details.accessIntent.askingUnits[].command`).
Text rather than position: it is what a link reads, and identical text is an identical command, so naming `echo a` settles both units of `echo a; echo a`.
A name the ask does not list is ignored, so a link can never settle a unit the ask never asked about, and a list that is not an array of strings names nothing.

It is a distinct kind rather than `allow` with a `units` field because of version skew: a chain that predates it reads an unknown kind as `defer`, which is §4's fail-safe reading, where it would read `allow` plus `units` as an allow of the whole call.
There is no partial `deny`; the call runs as one, so a link that rejects one unit denies the call with §1's `deny`.

**Narrowing.**
The chain removes the named units and continues with the ask the gate would have raised had they never asked: the first unit left is the value, with its own matched rule, and the `also asks` lines, the session patterns, the session label, and the access facts (`askingUnits`, `matchValues`, `floor`) cover only the units left.
The new value's wrapper, substitution context, and matched spelling are known only for the gate's winner, so a narrowed ask whose value changed shows its command and rule without them.
The next link, and in the end the terminal, sees the narrowed ask.
Only an ask on the `bash` surface is narrowed, and a narrowed ask offers a session grant only if the original offered one: narrowing only ever shrinks what the human is asked to grant.
Naming every unit left allows the call, attributed to the link that settled the last unit and non-persistent like any link grant; naming none of them defers.
Each narrowing writes `authorizer_units_allowed` (`requestId`, `link`, `allowedUnits`, `remainingUnits`), with both lists masked as command-bearing fields, because the decision for the call names only whoever decided the rest.
The gate-level records of the ask (the `permission_request.*` entries and the decision event) keep naming the gate's winner.

**The envelope.**
§5's checkpoint caps `allow_units` exactly as `allow`.
An excluded-surface ask never carries asking units, so a partial allow there would defer anyway.

**The grant.**
The gate's session suggestion covers every asking unit, and it is what the runner, a serving node's whole-session scope, and a forwarded child each record.
So a session answer to a narrowed ask carries the narrowed grants (`narrowedGrants`) back to whichever records it, on the forwarding response for a child's own scope.
Absence means "the gate's suggestion", which is the wider grant, so a narrowed answer that covers no pattern carries an empty list, and a malformed list on the wire reads as empty.
A terminal answer that already names narrowed grants keeps them: they are the narrower list, from a serving node that narrowed the ask further along its path.

**The accepted residual** is version skew in one direction: a child that predates the field drops it from a newer serving node's response, and a child-scope session grant on a narrowed forwarded ask then records the child's whole suggestion, including the patterns of units the link accepted.
It needs a newer serving node, an older child, a narrowing link, and the child scope together, and the extra patterns name units the operator's own link accepts.

**What this does not decide.**
A serving node's own rules can also leave part of a forwarded chain decided; narrowing by recorded authority rather than a link's judgment is [#1131].

### Relationship to `evaluate()` and rule-driven promotion

The judge sits on the ask-*consuming* side of `evaluate()`, distinct from the ask-*producing* side (rule-driven promotion, [#509]).
Rule-driven promotion produces the fail-safe false-positive ask (`git grep id_rsa` prompts); the judge dismisses it on the consuming side without hard-coding per-command file-argument tables.
The two compose cleanly: a promoted token emits the same structured descriptor a prefixed path does, so a link needs no promotion-specific knowledge.

## Consequences

- [#472] carries a linked, settled ADR and becomes schedulable in a future phase on its own merits.
- The `Authorizer` role generalizes from a single per-session selection into a composed chain; `selectAuthorizer` becomes the terminal-selection step of `composeAuthorizerChain`, and the interface gains a `defer` verdict and an injected `PermissionQuery`.
- The chain is the **one** live-authority extensibility seam.
  A model judge is a non-terminal link; a future terminal-replacement backend (a chat-bot or remote reviewer *as* the authority) is the same seam's terminal role.
  This subsumes the architecture doc's separately-sketched "pluggable escalation seam" — registering a link *is* the seam, not a mechanism beside it.
- The review log gains a fourth grant provenance (`authorizer:model`, slice 2) alongside human, policy, and yolo.
- **Dogfooding is slice 1's acceptance criterion.**
  A first-party package in this monorepo (`packages/pi-permission-model-judge`) implements the deny-first typo-path reviewer against the real seam.
  This is a design safeguard, not a demo: the [#267] history guard warns that an inbound registration surface nobody consumes goes vacant; a first-party consumer registering `"model-judge"` on day one makes `registerAuthorizer` born consumed, and its own config file exercises the config split end to end.
  The concrete issue is filed by the next `/plan-improvements` pass when the phase is scoped.
- No code, config, schema, or default changes in this documentation step.
- The 2026-10-17 amendment (§8) adds the nothing-on-disk license to `ForwardedAccessFacts`, an exception to the bounded-delegation checkpoint, and the `authorizer_allow_licensed` review record; it is the first relaxation of the checkpoint, and it ships as a breaking change.
- The 2026-11-18 amendment (§9) adds the `allow_units` verdict, the `authorizer_units_allowed` review record, each asking unit's matched rule on the wire, and `narrowedGrants` on the decision and the forwarding response; nothing changes until a link returns it, so it is not breaking.

### Rejected alternatives

- **Ask-only, allow-or-escalate verdict range** (the reverted ADR).
  Rejected: use case 1 is deny-first, and an `Authorizer` already denies, so confining a model link to allow-or-escalate cannot express the typo-path reviewer.
- **A single terminal instead of a chain.**
  Rejected: the judge fundamentally decides *some* asks and hands the rest to the real authority — it needs a successor.
  A chain with a non-deferring terminal models exactly this, and the operator's mental model was a chain, not a decorated singleton.
- **The judge imports `PermissionsService` via `Symbol.for()`.**
  Rejected: a Law-of-Demeter reach-through to a global, and it forces the external extension to import two surfaces.
  Injecting a narrow `PermissionQuery` gives one import and an ISP-clean contract.
- **Opt-out activation** (a registered link joins the chain automatically; config can only disable it).
  Rejected: it lets a loaded extension gain decision authority unless explicitly disabled, and lets load order influence security-relevant chain order.
  Opt-in (config names the chain) is least-privilege by construction.
- **A process-global `AuthorizerRegistry`, so a child resolves its parent's links** ([#727]).
  Rejected: it converts every deferring ask into two link runs, and lets a link's verdict short-circuit before the serving node ever sees the request — a privilege change dressed as a plumbing fix.
  The forwarding round trip is not the cost being avoided; the serving node resolves the request against its own ruleset regardless.
- **The model applies the ruleset itself, or emits a static intent.**
  Rejected: the former couples the model to rule semantics; the latter weakens determinism.
  Tool-augmented decomposition keeps the model decoupled from rule semantics (a rule edit is honored automatically) and confines its non-determinism to decomposition.
- **Licensing an ask whose path is merely absent** ("nothing exists at the path", considered for §8).
  Rejected: it also admits writes into an existing directory outside the tree (`mkdir -p ~/newdir`, `cat > ~/.config/autostart/x.desktop`, `git clone "$url" ~/dev/new`), which are real effects a wrong judgment would approve.
- **Licensing only a proven read of an absent path.**
  Rejected: an undeclared tool's operands are `unproven` by construction (ADR 0013 §7), so the bound would relieve almost none of the population it exists for; of the 18 recent qualifying asks measured for the amendment, 18 licensing paths were `unproven`.
- **Lifting the cap for a surface family by a switch**, globally ([#684]) or per named link ([#983]).
  Not adopted by the amendment: it hands a model the outside-the-tree boundary wholesale, for paths that exist as much as for tokens that name nothing.
  Whether an operator may opt a named link into that is left to [#620] and [#799].

### Accepted limitations

- **Open implementation parameters.**
  Model provider, prompt, confidence threshold, and timeout are deliberately left to [#472] and the downstream package — they are tuning and mechanism, not architecture.
- **[#472]'s decomposition is deferred.**
  Whether [#472] splits into staged issues (chain infrastructure; deny-first slice; allow-capable slice; the dogfood package) is [#472]'s own planning decision, sequenced by the next `/plan-improvements` pass.
- **Terminal-replacement registration is deferred.**
  Registering a backend *as* the terminal authority is the chain seam's other role, built when a real non-subagent backend needs it — not now.
- **The pre-`evaluate()` classifier stays out of scope.**
  A model that *classifies* access intent before `evaluate()` feeds *recorded* authority and weakens the "same `(toolName, input)` yields the same ruling" property more subtly than this live-authority judge; it warrants its own decision record (see the architecture doc's "Beyond the target: a non-deterministic access-intent classifier").

[#267]: https://github.com/gotgenes/pi-packages/issues/267
[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#509]: https://github.com/gotgenes/pi-packages/issues/509
[#581]: https://github.com/gotgenes/pi-packages/issues/581
[#635]: https://github.com/gotgenes/pi-packages/issues/635
[#699]: https://github.com/gotgenes/pi-packages/issues/699
[#727]: https://github.com/gotgenes/pi-packages/issues/727
[#909]: https://github.com/gotgenes/pi-packages/issues/909
[#620]: https://github.com/gotgenes/pi-packages/issues/620
[#684]: https://github.com/gotgenes/pi-packages/pull/684
[#797]: https://github.com/gotgenes/pi-packages/issues/797
[#799]: https://github.com/gotgenes/pi-packages/issues/799
[#880]: https://github.com/gotgenes/pi-packages/issues/880
[#882]: https://github.com/gotgenes/pi-packages/issues/882
[#983]: https://github.com/gotgenes/pi-packages/pull/983
[#1101]: https://github.com/gotgenes/pi-packages/issues/1101
[#1131]: https://github.com/gotgenes/pi-packages/issues/1131
