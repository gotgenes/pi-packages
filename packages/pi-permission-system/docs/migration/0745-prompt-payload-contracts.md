# Migration guide: the prompt payload replaces the assembled message

Starting with the release that closes #745, a permission ask crosses two boundaries as **structured facts** rather than as a pre-rendered sentence: the forwarded-permission-request file a subagent writes for its parent, and the `permissions:ui_prompt` broadcast.
A third change deprecates the two tool-preview cap config fields.

This is a **breaking change** on three surfaces.
Each is independent — you may be affected by one and not the others.

| Surface                                                  | Break                              | Who is affected                                                   |
| -------------------------------------------------------- | ---------------------------------- | ----------------------------------------------------------------- |
| `ForwardedPermissionRequest` (on-disk wire)              | `message` removed; `payload` added | Anyone running **out-of-process** subagents across mixed versions |
| `PermissionUiPromptEvent` (`permissions:ui_prompt`)      | `message` removed; `request` added | Any extension reading `event.message`                             |
| `toolInputPreviewMaxLength` / `toolTextSummaryMaxLength` | Accepted but ignored               | Anyone who set either in `config.json`                            |

## Upgrade the parent session first

The forwarded-request wire is the only surface with an ordering constraint, and it only exists for an **out-of-process** subagent (one whose parent session is resolved through `PI_SUBAGENT_PARENT_SESSION` or a sibling env var).
An in-process child shares its parent's loaded extension, so the two can never skew.

A serving node on this version accepts an older child's `message`-only request: the field is no longer required, and the ask is rendered from the `surface`, `value`, and requester provenance the request does carry.
The reverse does not hold.
An **older** parent still demands `message` and rejects a newer child's request outright, deleting the file; the child then waits out its forwarding timeout (ten minutes by default) and reports the block as `confirmationUnavailable` rather than as a user denial.

So: upgrade the session that serves prompts before the sessions that forward to it.
Carrying both fields indefinitely was declined deliberately — it would keep the child's un-budgeted prose alive on the wire, which is the defect this change exists to remove.

## What changed on the wire

The child used to assemble a sentence under **its** configuration and write it into the request file; the serving node carried that string forward as a single evidence entry, so the parent's own render budget never applied to it.
A forwarded ask therefore could not be made consistent with a local one.

Now the child writes its complete `PromptPayload`, and the serving node renders the child's own facts under the **parent's** budget.
A forwarded bash ask reads `command : …` exactly as a local one does, because the serving node holds the child's real payload kind.

The request files are still mode-restricted and still not redacted — the parent reads them to render the ask.
The payload's evidence is the same disclosure class the `message` string already was, so this is not a widening.

## What changed on the broadcast

`permissions:ui_prompt` drops `message` and gains `request`, the ask's invariant core, verbatim from the prompt payload.

```typescript
// Before
notify(event.surface, event.value, event.message);

// After
notify(event.surface, event.value, event.request.matchedPattern);
```

`request.value` is the decision-relevant value (the command, path, MCP target, or skill name) and `request.matchedPattern` is the rule that fired, including a sentinel such as `<indirection-bash-wrapper>`.
See the [`PromptRequestFacts` table](../cross-extension-api.md#promptrequestfacts) for every field.

`surface`, `value`, `agentName`, `source`, `requestId`, and `forwarding` are unchanged — what narrows here is evidence, never correlation.
A forwarded ask's broadcast still carries its full `forwarding.requesterAgentName` / `forwarding.requesterSessionId` provenance.

For a `write`, an `edit`, or an MCP call this is a **net narrowing** of what the bus discloses: an incidental tool-input preview of up to 200 characters used to ride `message`, and now nothing from the payload's evidence reaches the bus at all.
That is deliberate — the bus is the narrowest renderer, observable by any loaded extension without the operator having named it, whereas every other route to an ask's evidence requires that consent.

## The deprecated tool-preview caps

`toolInputPreviewMaxLength` and `toolTextSummaryMaxLength` are still accepted by the config schema but **no longer take effect**.
Setting either logs a deprecation notice through the ordinary config-issue channel at session start.

They bounded one preview *inside* a prompt, never the prompt itself — which is why they never bounded it.
Use `promptMaxRows` (default `24`) and `promptFieldMaxWidth` (default `400`) instead: those bound what a permission prompt renders, and `Ctrl+O` still expands the prompt to the complete request.

Remove both fields from your `config.json`.
They remain valid so that an existing config is not rejected fail-closed — which would empty that scope's whole policy — but they will be removed in a later major.
