# Subagent Integration

## The subagent adapter convention

This is the one supported API between a subagent implementation and this package, and this section is its canonical specification ([ADR 0012] decision 5).

An implementation's entire obligation is the **announcement**.
Everything that follows from it is this package's job, on both ends.

### In-process implementations

An implementation that creates child sessions inside its own process (via `createAgentSession()`) emits two one-way broadcasts on `pi.events`:

| Channel                           | Payload                           | When                                                                      |
| --------------------------------- | --------------------------------- | ------------------------------------------------------------------------- |
| `subagents:child:session-created` | `{ sessionId, parentSessionId? }` | After the child session is created, immediately before `bindExtensions()` |
| `subagents:child:disposed`        | `{ sessionId }`                   | In the run's `finally`, on success and on error alike                     |

The pre-bind ordering of `session-created` is **contract, not an implementation detail**.
Emit it synchronously, on the same call stack, before `bindExtensions()`: this package's subscriber registers the child synchronously, and the registration must land before binding proceeds so the child's own instance can detect itself the moment it loads.
An implementation that awaits between creating the session and emitting, or that emits after binding, breaks detection for every child it spawns.

Both are fire-and-forget broadcasts.
Nothing is returned, nothing is awaited, and no reply travels back over the bus.

### Out-of-process implementations

An implementation that spawns a child as its own `pi` process sets one environment variable at spawn:

```bash
PI_SUBAGENT_PARENT_SESSION=<parent-session-id>
```

That is the whole obligation.
The variable identifies the session the child forwards its asks to, and naming a parent session is itself sufficient to mark the process as a child — a separate "I am a subagent" marker is neither required nor expected.

Earlier per-extension variables are grandfathered for compatibility: the markers `PI_IS_SUBAGENT`, `PI_SUBAGENT_CHILD`, `PI_SUBAGENT_NAME` and their siblings still register as child hints, and `PI_AGENT_ROUTER_PARENT_SESSION_ID` is still honored as a parent-session source, checked ahead of the convention name.
New implementations use `PI_SUBAGENT_PARENT_SESSION` only.

### What an implementation does not owe

None of the following is an implementation's responsibility, on either process shape:

- Detecting that a session is a child.
- Selecting the authority that answers an ask, or deciding whether a node adjudicates locally or relays.
- Forwarding an ask, fixing its facts, or transporting the answer back.
- Publishing or reading the serving heartbeat, or fast-failing a request whose target is not draining its inbox.
- Resolving per-agent `permission:` frontmatter, or choosing a session-approval grant scope.

An implementation never imports this package, never resolves its service, and never manages permissions.
The dependency arrow points one way: this package subscribes to the announcement, and the implementation does not know this package exists ([ADR-0002]).

## Loading asymmetry

Subagent implementations may load arbitrary extension sets into children — `@gotgenes/pi-subagents` offers `excludedExtensionPackages`, and others differ — so this package assumes no symmetry between a parent's extensions and its children's ([ADR 0012] decision 6).

Three statements hold:

1. **A permission extension riding into a child is harmless by construction.**
   Access extractors and preview formatters land in the child's own registries, where the child's own gates read them, which is where they are needed.
   A chain link registered on a relaying node is accepted, returns a working disposer, and is recorded as `authorizer_link_vacant` rather than refused.
   Nothing throws and nothing warns per child start.
2. **Excluding an extension from children is an optimization, never a correctness requirement.**
   Excluding a link-only extension saves load time; the adjudicating node's own instance still judges every descendant ask.
3. **Excluding a provider of access extractors can weaken a child's own gates.**
   This is the one real hazard, and it is narrower than it sounds: excluding a package also keeps that package's tools out of children, so a package that supplies both a tool and that tool's extractor takes both away and leaves no gap.
   A gap needs the tool and its extractor to come from *different* packages, with only the extractor's package excluded.

The full condition, with a worked example, is documented where the setting lives: [Excluding package extensions from children](https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/configuration.md#excluding-package-extensions-from-children).

## What this package does on both ends

The announcement is all an implementation provides; this section is what it buys.

On the announcing side, this package subscribes to the child lifecycle (`src/authority/subagent-lifecycle-events.ts`) and registers every in-process child session in the `SubagentSessionRegistry` on `subagents:child:session-created`, unregistering it on `subagents:child:disposed`.
Because the event bus dispatches synchronously, that registration completes before `bindExtensions()` proceeds.

The `SubagentSessionRegistry` is backed by a process-global singleton (`globalThis` + `Symbol.for()`), accessed via `getSubagentSessionRegistry()` in `src/authority/subagent-registry.ts`.
This is necessary because each session's `ResourceLoader` creates its own `pi.events` bus: the parent emits `subagents:child:session-created` on the parent's bus, and only the parent's permission-system instance receives it.
The child's jiti instance runs on a separate bus and never receives the event — but because both instances call `getSubagentSessionRegistry()`, they share the same store, so the parent's registration is visible to the child.

What the announcement enables:

1. **Deterministic child detection** — `isSubagentExecutionContext()` hits the process-global registry on the first check for an in-process child, and reads the environment for one spawned as its own process, with a session-directory heuristic behind both.
2. **Per-agent policy enforcement** - the permission system's `before_agent_start` handler resolves the agent name from the `<active_agent>` system-prompt tag and applies per-agent `permission:` frontmatter overrides.
3. **`ask`-state forwarding** - when a child triggers an `ask` permission, the request forwards to the parent session's UI through the existing polling mechanism.
   The parent approves or denies, and the child resumes.
   When the parent approves "for this session," it chooses a scope: **this subagent only** (the least-privilege default) records the grant on the requesting child, while **the whole session** records it on the serving parent so the parent and all its subagents resolve it without re-prompting.

No configuration is required - the integration is automatic when both extensions are installed.
When `@gotgenes/pi-permission-system` is not installed, an implementation emits its lifecycle events with no subscriber - a harmless no-op.

## Permission Forwarding

When a delegated or routed subagent runs without direct UI access, `ask` permissions can still be enforced by forwarding the confirmation request through Pi session directories.
The main interactive session polls for forwarded requests, shows the confirmation prompt, writes the response, and the subagent resumes once that decision is available.
A parent `allow`/`deny` rule governs a child's escalation directly (the serving node resolves it as recorded authority before prompting), and a "whole session" grant recorded on the parent auto-approves later forwards of the same pattern.

This keeps `ask` policies usable even when the original permission check happens inside a non-UI execution context.

For in-process child sessions, detection and forwarding use the event-driven registration described above.

### When nobody answers

A forwarded request is only useful if some session is draining the inbox it was written into.
The polling session publishes the session id it polls, and a child checks that its target is published before committing to a long wait.

The announcement goes out on two channels, because a child cannot always reach the same one.
A child running inside its parent's process reads a process-global registry.
A child running as a separate `pi` process (the `PI_SUBAGENT_PARENT_SESSION` path) shares no memory with its parent, so it reads a heartbeat record the serving session refreshes under `<agent dir>/sessions/permission-forwarding/serving/`, holding the served session id, the serving process id, and the time it was last refreshed.

For an out-of-process target, four things count as "not draining":

| What the child finds                              | What it means                                                                |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| No record                                         | The parent exited, never served, or runs a version that does not publish one |
| A record naming a process that is gone            | The parent was killed rather than shut down                                  |
| A record nobody has refreshed for several seconds | The parent's process survives but has stopped polling                        |
| A record for a different session id               | The child is forwarding somewhere nobody is listening                        |

If the target is not draining its inbox, the child gives up after a two-second grace window rather than waiting out `forwardingTimeoutMs`, and the tool is blocked with:

```text
[pi-permission-system] Running bash command 'pwd' requires approval, but no
interactive UI is available. Reason: Session 'abc123' is not serving forwarded
permission requests.
```

The grace window exists so a request that arrives while the parent is switching sessions is not abandoned in the gap.
A target that *is* draining its inbox is waited on for the full `forwardingTimeoutMs`, however long the human takes to decide.
That includes a parent whose human is still deliberating at an earlier forwarded prompt: it keeps refreshing its heartbeat throughout, so a second child does not read it as gone.

Every other way the forwarding path can give up — an unresolvable parent session, forwarding directories that cannot be created, a request that cannot be written, an unreadable response, and the timeout itself — is reported the same way: as approval being unavailable, with a reason naming the specific failure.
None of them is reported as a user denial, because no user was ever asked.

The two sides of the exchange are correlatable in the review log: the serving session writes `forwarded_permission.serving_started` with the id it polls, and the child writes `forwarded_permission.request_created` with the `targetSessionId` it forwarded to.
When a forwarded request goes unanswered, comparing those two entries distinguishes a parent that was not polling from one polling a different session.

When a forwarded request *is* answered, the child's own terminal entry names both which session answered and what within it decided.
The serving node records its decider on the response — a rule of its own (with the surface, pattern, and origin that matched), the link that ruled, or the human who answered its dialog — and the child records it nested under a `forwarded` frame:

```json
{
  "kind": "forwarded",
  "responderSessionId": "019ff969-c34c-70be-9034-fae19c852932",
  "decision": { "kind": "user", "via": "dialog" }
}
```

That is the difference between a human approving a subagent's request and the parent's policy approving it on their behalf — two outcomes that were previously indistinguishable in the log.
An older parent that sends no decider yields `"decision": null`: the hop is still recorded, and the answer is still honored.

### Upgrading

Upgrade the parent before relying on the out-of-process signal — in practice, restart the interactive session after upgrading the package.

A parent session still running a version that predates the heartbeat publishes none, and a child on a version that expects one reads that absence as "not draining" and gives up in about two seconds.
That only happens in the window where an upgrade lands while a parent session is already running, and it resolves as soon as that session restarts.
Nothing needs to be edited, and in-process children are unaffected: parent and child there are the same running copy by construction.

---

## Conformance of known implementations

Conformance is a property of the announcement alone — whether an implementation emits the in-process events, or sets the out-of-process variable — not of the frontmatter vocabulary it offers for tool visibility.

| Extension                                                                           | Shape      | Adopts the convention             | Visibility key                     |
| ----------------------------------------------------------------------------------- | ---------- | --------------------------------- | ---------------------------------- |
| [@gotgenes/pi-subagents](https://github.com/gotgenes/pi-subagents)                  | in-process | ✓ Emits both lifecycle events     | `tools:` (allowlist)               |
| [tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents)                 | in-process | ✗ Publishes no lifecycle event    | `disallowed_tools:` (CSV denylist) |
| [nicobailon/pi-subagents](https://github.com/nicobailon/pi-subagents)               | subprocess | ✗ Sets no parent-session variable | `tools:` (CSV allowlist)           |
| [HazAT/pi-interactive-subagents](https://github.com/HazAT/pi-interactive-subagents) | subprocess | ✗ Sets no parent-session variable | `deny-tools:` (CSV denylist)       |

The two subprocess implementations set their own child-marker variables, so their children are detected, but neither names the parent session.
Without it there is nowhere to forward to, and an `ask` in one of those children is reported as approval being unavailable.
Adopting the convention is a one-line change at their spawn site.

The upstream `tintinweb/pi-subagents` (which `@gotgenes/pi-subagents` forks) publishes no `subagents:child:session-created` event, so its in-process children have neither deterministic detection nor `ask`-state forwarding.

See [guides/permission-frontmatter-for-subagent-extensions.md](guides/permission-frontmatter-for-subagent-extensions.md) for the companion convention on `permission:` frontmatter, which implementations document rather than implement.

---

## Coexistence with Other Subagent Extensions

Subagent extensions implement their own tool restriction mechanisms.
These compose correctly with the permission system because the two operate at different layers: **visibility** (subagent extension) and **policy** (permission system).

### The Two-Layer Model

```text
┌─────────────────────────────────────────────────────┐
│  Layer 1 - Visibility  (subagent extension)          │
│  Controls which tools are registered / active        │
│  before the agent session starts.                    │
├─────────────────────────────────────────────────────┤
│  Layer 2 - Policy  (pi-permission-system)            │
│  Controls allow / ask / deny decisions on every      │
│  tool call, bash command, MCP operation, etc.        │
└─────────────────────────────────────────────────────┘
```

### Interaction Rules

1. **Hidden tool → permission system never sees it.**
   If a subagent extension removes a tool from the active set, the permission system receives no registration or call event for that tool.
   The permission policy for that tool is irrelevant - it is already gone.

2. **Denied tool → hidden regardless of the subagent extension's allowlist.**
   If the permission system denies a tool (via `deny` policy or tool filtering), it is removed from the active set before the agent starts.
   A `tools:` allowlist in a subagent extension cannot restore a tool that the permission system has already hidden.

3. **The two denylist mechanisms are additive, not conflicting.**
   A tool blocked by either layer stays blocked.
   Neither layer can silently re-enable what the other has blocked.

### `permission:` Frontmatter is Exclusive to This Extension

The `permission:` key in an agent's YAML frontmatter is read exclusively by `pi-permission-system`.
It has no interaction with the `tools:`, `disallowed_tools:`, or `deny-tools:` keys consumed by subagent extensions.
You can freely use both in the same agent file:

```yaml
---
# Subagent extension: allow only bash and read in the child session
tools: bash,read
# pi-permission-system: still enforce ask on bash within those allowed tools
permission:
  bash: ask
---
```

In this example the subagent extension restricts visibility to `bash` and `read`, and the permission system then gates every `bash` call with an `ask` prompt - both rules apply independently.

[ADR 0012]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0012-cross-node-extension-contract.md
[ADR-0002]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-subagents/docs/decisions/0002-extensions-on-a-minimal-core.md
