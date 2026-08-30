---
status: accepted
date: 2026-08-14
---

# 0011 — The prompt-presentation contract: a complete payload and a bounded render

## Status

Accepted.
This decision states what a permission ask prompt must show, what a renderer may elide, and what bounds its size, so a proposal to change the prompt is judged against a written contract rather than re-argued per pull request.
It composes with `docs/decisions/0007-model-judge-authorizer-chain-adr.md` (who decides) and `docs/decisions/0010-permission-log-secret-exposure.md` (what the logs persist); it decides presentation only, never policy.

## Context

Six open items change how a permission prompt presents itself, and they pull in opposite directions.

| Item   | Wants                                                                     |
| ------ | ------------------------------------------------------------------------- |
| [#710] | the prompt bounded in **height**                                          |
| [#656] | the assembled message hard-truncated to 200 characters (bounded in width) |
| [#716] | the message **expanded** into aligned `key : value` lines + pretty JSON   |
| [#713] | the inner command of unstrippable wrappers **added** to the prompt        |
| [#648] | edit diffs **added** before approval                                      |
| [#654] | contextual natural-language explanations **added**                        |

Three ask the prompt to show more and two ask it to show less.
The two pull requests edit the same function in opposite directions, so whichever merged first would have silently set the premise the other was reviewed against.

The stakes are not cosmetic.
This package's rule is that the prompt's tool input is never redacted, because the user must see the real input to decide.
Eliding for size therefore trades directly against the decision quality the gate exists to protect.

### What the code did before this decision

Five sites assembled prompt text independently — `formatAskPrompt` (bash / MCP / generic-tool branches), the two skill prompts, the two external-directory prompts, the per-tool input previews, and the parent-side forwarded prefix — each producing a flat `string`.
That string became `PromptPermissionDetails.message` and travelled unchanged to every consumer: the inline TUI dialog, the `select`/`input` fallback, the review log, and the `permissions:ui_prompt` broadcast.

Three properties of that arrangement are the direct causes of the six items above:

- **The bash branch had no cap at all.**
  It interpolated the raw command and the full command verbatim, as did the bash external-directory prompt.
  The two configurable caps, `toolInputPreviewMaxLength` (200) and `toolTextSummaryMaxLength` (80), bounded only the non-bash JSON and search-summary previews — which is why they did not bound the prompt, and why [#656] concluded the assembled message was unbounded.
- **Nothing bounded height.**
  `fitToWidth` wraps each line explicitly "so no content is lost", and the resulting row count is unbounded by construction.
- **A forwarded ask was assembled twice, under two configs.**
  The child assembled its message under *its* limits, wrote it into the request file, and the parent prefixed three lines and rendered it.
  The parent's own limits never applied to the child's text, so consistency across local and forwarded asks was not merely unstated — it was structurally unattainable while the payload was a pre-rendered sentence.

### What the host already does

Verified against the sibling Pi checkout at `../pi` (`9d2ec7ffa`, 2026-08-13); every API cited is present in the pinned `@earendil-works/pi-coding-agent`.

- The pending tool call's transcript component is created on `message_update`, **before** `beforeToolCall` invokes `emitToolCall`.
  So for a local ask, the host has already rendered the pending call above our dialog.
- What it renders differs per tool: `bash` shows `$ <full command>` unbounded and ignores the expansion flag; `write` caps its content preview at 10 lines unless expanded; `read` shows a compact classification unless expanded; `edit` computes and renders a **full diff** before the result exists.
- `ToolRenderContext.expanded` reaches the *call* renderer, not only the result renderer, so Pi's tool-expansion action genuinely expands a pending `write` or `read` — and does nothing for `bash` or `edit`, whose renderers ignore it.
- A forwarded ask has **no** host block at all: the parent's dialog is raised by this package's forwarded-request poll, not by a parent `tool_call`, and each session owns its own message list.
  For a forwarded ask the prompt is the sole carrier of evidence, and tool expansion has nothing to expand.

The last point is why [#710] reported the worst case on a subagent ask specifically.

### Prior art

- **Codex** merged a change titled "tui: fix approval dialog for large commands" that emits a proposed-command history cell on an approval request, simplifies the dialog to the reason alone, and truncates decision-history snippets to a single line and 80 graphemes.
  Its answer is to separate the evidence surface from the decision surface.
- A Codex user reported the approval dialog showing only the text before `&&`, approving a command whose second half was never displayed.
  That is a decidability failure caused by *structural* elision, and it is [#713] in another product.
- **Claude Code** carries both complaints at once: one report asks for multi-line bash arguments to be rendered in full in the approval dialog, and another reports that a subagent's large inline bash payload rendered in full froze the terminal.
  Same product, opposite demands — the empirical proof that content rules alone cannot satisfy both, and that a bounded default needs a reachable full view.
  A third report treats ~100-character truncation with no way to expand as a defect, because the user must approve destructive calls without seeing them.
- Claude Code's explanation affordance is on-demand (generated only on an explicit keypress), labelled with a risk level, toggleable, and disableable by setting — the shape [#654] asks for, already shipped elsewhere as an opt-in rather than a default.

## Decision

### 1. What an ask prompt is for

An ask prompt routes human attention to a consequential action and supplies enough evidence to decide it.
Elision that removes decision-relevant evidence is a **correctness bug**, not a cosmetic one, and is triaged as such.

### 2. The payload is complete; elision is a rendering concern

A gate emits a **complete** structured payload describing the request.
It never pre-renders a sentence, never truncates, and never decides what a human will see.

Every consumer is a **renderer** over that payload, deciding under its own budget what to show, in what order, and in what format.

> The payload is complete by contract.
> Elision is a property of a render, never of the payload.

This is the rule that resolves the six items: three of them are renderer decisions, and the two pull requests were both editing the wrong layer.
It also dissolves the double-assembly problem, because a forwarded child now ships facts and the serving node renders them under its own budget.

An illustrative shape — the implementing issue owns the exact types:

```typescript
interface PromptPayload {
  /** Never elided by any renderer. */
  request: {
    requester: {
      agentName: string | null;
      forwarded: boolean;
      sessionId: string | null;
    };
    surface: string;
    toolName: string | null;
    invokedToolName: string | null;
    value: string;
    matchedPattern: string | undefined;
    executedUnit: string | null;
  };
  /** Complete; each renderer elides to fit its own budget. */
  evidence: ReadonlyArray<{ label: string; text: string }>;
  /** Supplied by registered annotators; always marked as model-generated. */
  annotations: ReadonlyArray<{ source: string; text: string }>;
}
```

### 3. The invariant core

The payload's `request` group carries the facts that are always visible, in every render, and that no budget may elide.
It is named for what it holds — the permission request's own facts, matching the package's `PermissionRequest` / `ForwardedPermissionRequest` / `permission_request.*` vocabulary — rather than for its contract, which this section states instead:

1. The requesting agent, whether the ask was forwarded from a subagent, and — for a forwarded ask — the requesting session id.
2. The tool name — and the invoked tool name as a distinct fact when a shell alias re-exposes bash, since "gated as `bash`, invoked as `exec_command`" is two facts.
3. The gate surface and the matched rule, including a sentinel such as `<indirection-bash-wrapper>`.
4. The decision-relevant value: the command, path, MCP target, or skill name.
5. For bash, the executable unit that will actually run, **including inside an unstrippable wrapper**.
6. An explicit marker on any part of the prompt that is model-generated.

Point 5 promotes [#713] from an enhancement to a conformance requirement.
The Codex `&&` report is the evidence: a prompt that names a wrapper without naming what it runs has not shown the user the action they are approving.

### 4. Elision rules

A renderer may elide anything outside the invariant core.
An elision is marked — an ellipsis or an equivalent indicator — and states nothing more.

Character and line counts were considered and rejected: they are a number the user cannot act on, and they consume budget that the evidence itself should hold.
What matters is not how much was hidden but that the user can reach it, which is the next rule.

An operator must be able to reach the **complete** information while the decision is pending.
This is a capability requirement, not a mechanism: an in-dialog expansion, an overlay with a maximum height, a scrollable region, or a separate detail view all satisfy it.
The implementing issue chooses the mechanism on ergonomics, subject only to that capability holding for local, forwarded, and skill asks alike.

### 5. Size bounds

A render is bounded by a **height budget in rows**, plus a **per-field width cap**.

Rows are the unit because the reported failure is a viewport takeover.
The width cap exists because a single pathological field — a here-string on one logical line — would otherwise consume the entire row budget through wrapping.
A component is never told the terminal height, so the row budget is a default the operator may configure, not a value read from the host.

`toolInputPreviewMaxLength` and `toolTextSummaryMaxLength` are **subsumed** by the renderer budgets.
They are soft-deprecated: the fields stay optional in the schema and their values are ignored, and a config that sets either receives a deprecation notice through the existing config-issue channel.
They are not removed, because strict validation rejects an unknown field fail-closed and an upgrade must not empty an operator's policy.

### 6. The four renderers

One payload, four renderers, each with its own budget and its own configuration.

| Renderer                          | Budget                           | Notes                                                |
| --------------------------------- | -------------------------------- | ---------------------------------------------------- |
| Inline TUI dialog                 | row budget + per-field width cap | the bound that answers [#710]                        |
| `select`/`input` fallback         | same budget                      | no assumption of an expansion affordance             |
| Review log                        | its own configured limits        | key-name redaction unchanged; exposure does not grow |
| `permissions:ui_prompt` broadcast | `request` only                   | no `evidence`, no `annotations`                      |

Requester identity is part of the `request` facts, not evidence, so narrowing the broadcast does not touch it.
The forwarded provenance the broadcast carries today — `requesterAgentName` and `requesterSessionId` — is retained in full: [#292] added it precisely so a forwarded ask's broadcast stays non-degraded, [#610] builds on it to correlate a decision back to the serving session, and `permission-events.ts` guarantees its fields are not removed without a semver-major bump.
What narrows is evidence, never correlation.

The broadcast is the narrowest renderer, and deliberately narrower than what it emits today.
Any loaded extension can observe the bus without the operator having named it, whereas every route to evidence — a registered tool-input formatter, an `Authorizer` link the operator lists in `authorizerChain` — requires that consent.
So the bus receives the request facts and the verdict, and nothing a renderer would have had to elide.
For a bash ask this discloses no less than today, because the command is the request's `value`; for a `write`, an `edit`, or an MCP call it discloses the path and the verdict rather than the body, where today an incidental preview of up to 200 characters rides `message`.

The review log renders the payload under its existing limits rather than persisting it whole.
This is deliberate: `docs/decisions/0010-permission-log-secret-exposure.md` bounds what the logs accumulate, and a complete payload written verbatim on every ask would defeat that bound.
A renderer's budget is where log growth is decided, and it is configurable there.

### 7. The agent-facing renderer

Denial text is a fifth render of the same facts, and the denial path already works this way — it takes a structured `DenialContext` and renders at the edge.
The rule for it is different in one respect:

> The agent renderer **identifies** the call; it does not **reproduce** it.

The agent authored the tool call, so echoing its input back tells it nothing it did not already have.
The new information is the verdict: which surface gated the call, which pattern matched, whether a differently-shaped retry could succeed, and what the human said.
Because the renderer never echoes the input, it needs no separate size bound — the rule bounds it structurally.

This closes a real defect: every denial path previously interpolated the raw command verbatim, so the same oversized payload that took over the viewport in [#710] was echoed into the agent's context in full whenever the user denied it.
The human's constraint is rows; the agent's is tokens; the same unbounded payload violated both.

On what reaches the agent:

- **Forbidden**: annotations.
  A model-generated advisory returned to the agent becomes an instruction, and the agent's model would be reading another model's opinion of its own request as if it were policy.
- **Permitted, and affirmed**: the human's typed denial reason.
  It already flows, by design — that is what the "No, provide reason" option is for — and it must not be reclassified as leakage later.
- **Not a question**: evidence a renderer elided from the human's view.
  The agent already has it, so no filter is warranted and none should be built.

### 8. Extension seams

Two capabilities belong downstream, with this package owning only the seam.

**Annotations** ([#654]).
A named, opt-in, config-ordered annotator registry, mirroring `registerAuthorizer` and `registerToolInputFormatter`, fails safe when a configured name is unregistered.
Four properties make it admissible: this package owns the payload slot, its attribution, and its model-generated marking, so the marker is a property of the slot rather than a discipline a downstream package must remember; the slot is structurally separate from `AuthorizerVerdict`, so an annotator cannot allow, deny, defer, or suppress; it is timeout-bounded with an unchanged-prompt fallback; and it runs at the serving node, where the human is, per `docs/decisions/0007-model-judge-authorizer-chain-adr.md` §7.

**Evidence formatters** ([#648]).
The existing tool-input formatter registry produces **evidence entries** rather than strings, so a downstream package can supply richer evidence — a diff renderer among them — without this package growing a display for every operator's ideal.
The payload carries the edit's facts; the renderer decides how to present them and may suppress what the host already displays.

### 9. Representation and skew

The structured payload replaces `message` on both cross-boundary contracts — the on-disk forwarded request and the `permissions:ui_prompt` broadcast — in the same change, rather than carrying both fields indefinitely.

The blast radius was measured, not assumed.
`pi-permission-model-judge` reads `accessIntent.surface`, `surface`, `path`, and `value`, and never `message`, so it is unaffected.
The exposed surfaces are an unknown third-party extension reading `message` off the broadcast, and an out-of-process version-skewed child whose request carries only `message`.

A forwarded request that carries no payload is rendered from whatever fields it does carry, and a prompt is **never** presented empty.
Fail-closed applies to presentation as it does to policy: if the facts cannot be established, the ask still reaches the human with what is known, rather than resolving without one.

### 10. What a forwarded refusal may tell the requesting agent

§7 governs a refusal decided in the session being told.
A forwarded ask is decided in another one, so its refusal render has facts §7 never contemplated: the deciding node's own matched rule, its own error text, and its identity.
This section decides which of those may cross back to the requesting agent ([#844]).

The question is narrower than it first appears.
The deciding node's `decidedBy` already crosses the hop — it is written onto the response file and relayed by `ParentAuthorizer`, and the requesting session persists it in its own review log.
So nothing here decides whether these facts may leave the serving node; they already have.
What it decides is whether they may reach the requesting **agent's context**, which is the narrower disclosure §7 already answers affirmatively for a local policy deny.

Permitted, because each is operator configuration or this package's own text, and each is what makes the refusal actionable rather than merely accurate:

- The pattern of the rule that denied, named in place of the requesting session's own ask rule.
  Naming the ask rule instead is not a smaller disclosure, it is a wrong one — the agent is told a rule denied it and given the identifier of a different rule.
- The deny-with-reason text the deciding rule carried, which §7 already affirms for a local denial and which the serving node therefore carries onto the response.
- The error text of an escalation that threw, on the same footing as the local fail-closed boundary's own message.
- That the decision was made in the session serving the request — derived from the forwarding frame, not asserted, so a refusal decided locally does not claim otherwise.

Withheld:

- The responder session id.
  It answers *where*, and the render answers *what* ([#772]); an id also identifies a session the requester cannot act on.
- The deciding rule's `origin` scope.
  No renderer discloses a rule's origin today, and this arm is not the place to start — it would newly reveal which of the operator's config scopes the serving node runs under.

Unchanged: the `permissions:decision` broadcast stays the narrowest renderer under §6.
None of the above reaches it; it carries request facts and the verdict, and no decider at all.

## Consequences

- The prompt's content stops being decided at five assembly sites and starts being decided in one renderer per consumer.
  A change to what the user sees becomes a renderer change, reviewable against this contract.
- Consistency across local, forwarded, and skill asks becomes achievable for the first time, because the serving node renders the child's facts under its own budget instead of relaying the child's prose.
- Replacing `message` is a breaking change on two contracts and carries a `feat!:` commit and a migration note naming the payload fields that supersede it.
- The review log's growth becomes an explicit, configured decision rather than a side effect of prompt wording.
- Denial text shrinks substantially, and the agent gets a clearer statement of why a call was refused.
- A contributor can check a proposal in three questions: does it keep the invariant core visible, does it change the payload or the render, and does its render fit the budget.

## Alternatives considered

- **A width cap on the assembled string** ([#656]'s shape).
  Rejected: it is blind to structure, so it can cut the decision-relevant value while preserving boilerplate, and it bounds the wrong dimension for a viewport complaint.
  Claude Code's ~100-character mobile truncation is the same remedy, and it is filed there as a defect.
- **Expanding the assembled string into aligned lines with pretty-printed JSON** ([#716]'s shape).
  Rejected as a formatter change while adopted as a *rendering* direction: aligned, one-fact-per-line output is a good render, but implementing it in the assembler would have made the review log persist unbounded unredacted tool input as a side effect of a readability change.
- **Character and line counts on every elision** ([#710]'s specific request).
  Rejected: the counts are unactionable, and reachability of the full text is what the request was really protecting.
- **The prompt as a pure decision surface, with the host transcript carrying the evidence** (Codex's answer).
  Rejected: it depends on host rendering this package does not control and which does not exist for forwarded asks, RPC mode, or a log excerpt.
  The payload must stand alone.
- **Persisting the complete payload to the review log.**
  Rejected: it would make the log a full-text destination at the cost of the growth bound `docs/decisions/0010-permission-log-secret-exposure.md` was written to hold.
- **Broadcasting the complete payload, or the payload minus annotations.**
  Rejected: both widen what an unconsented observer sees, and the second converts today's capped incidental exposure into a complete one.
  An operator-configurable switch to widen the bus was also rejected as a mechanism with no requested use.
- **Retaining the two preview caps alongside the new budgets.**
  Rejected: two layers that both sound like they bound the prompt is exactly the confusion this decision removes.

## Staging

The payload and the renderer seam are built first, and [#710] is fixed by construction rather than patched.

The seam's own decomposition is deferred.
Whether the payload, the dialog renderer, the log and broadcast renderers, and the agent-facing renderer land as one issue or several is a planning decision, and the concrete issues are filed by the next `/plan-improvements` pass when the phase is scoped — the same assignment ADR 0007 made for [#472].
That pass also sequences this work against the other open keystones rather than assuming it runs next.
The table below names what each existing item becomes under the contract, not the order in which the seam is built.

| Item   | Becomes                                                                                                               |
| ------ | --------------------------------------------------------------------------------------------------------------------- |
| [#710] | fixed by construction when the seam lands: a bounded dialog render over a complete payload                            |
| [#713] | a conformance requirement of the payload's invariant core, not a separate enhancement                                 |
| [#716] | its rendering intent adopted in the dialog renderer, re-implemented under this contract, with authorship credited     |
| [#656] | superseded: bounds live in the renderer, and its crash premise was fixed before the pull request was opened           |
| [#648] | the payload carries the edit's facts; the renderer decides, and the formatter seam admits a richer downstream display |
| [#654] | a downstream package plus the annotator seam described in §8                                                          |

[#292]: https://github.com/gotgenes/pi-packages/issues/292
[#472]: https://github.com/gotgenes/pi-packages/issues/472
[#610]: https://github.com/gotgenes/pi-packages/issues/610
[#648]: https://github.com/gotgenes/pi-packages/issues/648
[#654]: https://github.com/gotgenes/pi-packages/issues/654
[#656]: https://github.com/gotgenes/pi-packages/pull/656
[#710]: https://github.com/gotgenes/pi-packages/issues/710
[#713]: https://github.com/gotgenes/pi-packages/issues/713
[#716]: https://github.com/gotgenes/pi-packages/pull/716
[#772]: https://github.com/gotgenes/pi-packages/issues/772
[#844]: https://github.com/gotgenes/pi-packages/issues/844
