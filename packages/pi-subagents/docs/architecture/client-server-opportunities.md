# Client-server architecture: opportunities for pi-subagents

This note is forward-looking.
Pi's client-server split is **not on the near-term roadmap** — it is a long-term vision recorded in Mario Zechner's [pi session sync unification][session-sync] plan.
This document captures what that architecture would let pi-subagents do, so the opportunity is on record alongside the existing [Architecture direction](./architecture.md#architecture-direction) section.

It assumes the session-sync plan's shape:

- `AgentSession` owns all authoritative intra-session state and emits all sync events.
- `AgentSessionServer` owns multiple `AgentSession` runtimes, session lifecycle, client subscriptions, snapshots, and deltas.
- `AgentSessionClient` is the only thing a renderer (interactive mode, web mode) talks to.
- The sync model is **snapshot plus delta**: a client joins a session, receives one canonical snapshot, then a stream of deltas.
- Commands go up; state deltas come down.
- A client can `watch` (read-only) or `join` (interactive) a session, and can hold synchronized caches for many sessions at once.
- Session lifecycle (`new`, `resume`, `fork`, `import`, `join`, `leave`, `watch`, `unwatch`) is normal server API, not hidden local runtime replacement.

## The key realization

A subagent **is** a child `AgentSession`. pi-subagents already creates one via `createSubagentSession`, drives its turn loop through `SubagentSession`, and disposes it.

Today that child session is an in-process object visible only through machinery pi-subagents had to invent because Pi has no session-sync client:

- `record-observer` re-derives live activity from raw session events.
- the 80 ms `SubagentManager.listAgents()` widget poll.
- the [#277] Law-of-Demeter accessors (`Subagent.getConversation()`, `.messages`, `.subscribeToUpdates()`, `.getContextPercent()`) that re-expose session internals.
- the bespoke `ConversationViewer`, and [ADR-0004]'s replacement, native session navigation.
- [ADR-0004]'s dual-source-by-liveness split (tracked agent → in-memory record; evicted → file snapshot).

Every one of those is pi-subagents reinventing an `AgentSessionClient`.
The session-sync plan supplies the real one.
If subagent child sessions are registered as first-class sessions in the `AgentSessionServer`, all three target capabilities reduce to the same primitive the operator's own session already uses: `watch`/`join` a session id, receive a snapshot, then a delta stream.

## Capability 1 — viewing live subagent sessions

`watchSession(subagentSessionId)` gives the operator's client a canonical `SessionSnapshot` (current streaming message, pending tool executions with partial results, queue contents, context usage, active tools) followed by the live delta stream (`message_update`, `tool_execution_start/update/end`, `turn_start/end`).

What changes versus today:

1. **Late-join correctness.**
   The snapshot carries in-flight state, so an operator attaching to an already-running subagent immediately sees its current streaming message and pending tools — not just future events.
   Today the conversation viewer only catches future deltas plus whatever happens to be in the in-memory record.
2. **The widget and viewer become thin renderers** of synchronized session state.
   The poll, `record-observer`, and the [#277] accessors disappear — they were all substitutes for `subscribeSession`.
3. **A unified, reconnect-safe live session list.**
   The global event scope (`session_created`, `session_status_changed` idle/busy) means the operator sees every subagent the instant it spawns, with a live status badge per agent — replacing both `listAgents()` polling and the hand-rolled `subagents:*` broadcast tier.
4. **Multi-session client state** lets one operator client hold synchronized caches for N subagents at once.
   This is the clean foundation for the parallel-agent navigation gesture that [ADR-0004]'s spike (entry-criterion #3) struggled to design — tabbed or split views of multiple live subagents fall out of the model with no redesign.

## Capability 2 — viewing suspended subagent sessions

Today "suspended" is a dead end: once a background subagent completes and `disposeSession()` fires, the live `AgentSession` is gone, and the only artifact is the persisted JSONL read one-shot via `parseSessionEntries`.
That is a static file dump with no liveness and no path back to interaction.

Under the server model, the live/suspended distinction collapses at the client.
Session lifecycle is normal server API (`resume_session`, `join_session`, `import_session`), so a suspended subagent is just a session the server can rehydrate from `SessionManager` on demand:

1. The operator calls `joinSession(id)` (or the server lazily reloads the `AgentSession` from JSONL when a client joins a dormant session), gets a snapshot, and renders it through the same components as a live session.
   [ADR-0004]'s two-code-path split (in-memory record vs file snapshot) stops being the client's problem — whether the session is resident or rehydrated is the server's private concern.
2. A genuinely paused subagent (one parked by the `ConcurrencyLimiter` awaiting capacity, or deliberately held) becomes representable: the server holds the runtime idle, the operator can `watch` its frozen state, and then sees it transition to `busy` via `session_status_changed` when capacity frees up.
3. Subagents can outlive the operator's TUI.
   Because the server is a separate process, if the operator's interactive client restarts it reconnects and re-lists or re-joins subagent sessions that survived — impossible in today's single-process model.

## Capability 3 — operators interacting via an editor and submitting messages

Today the only inbound channel to a running subagent is `steer_subagent` — a single buffer-or-deliver message through `Subagent.steer`.
No editor, no takeover, no real conversation.

The plan's `join` versus `watch` split is the right primitive:

1. **`watch` is read-only** (Capability 1).
   **`join` is interactive participation**: the operator's client sends session commands scoped to the subagent's session id — `prompt`, `abort`, `set model`, `set thinking level`, `set active tools`, `navigate tree`, `compact`, `run bash`.
2. **Editor flow.**
   The operator opens the subagent session in their client, types in the editor (editor text, focus, and overlays are explicitly client-local UI state, never synchronized), and submits a `prompt` command targeting the subagent's session id.
   The command goes up; the server applies it to the subagent's `AgentSession` (which already owns prompt submission, queued steering, and follow-up messages); canonical deltas flow back down to all subscribers.
   This is precisely "commands go up, state deltas come down," applied to a subagent session instead of the operator's own.
3. **`steer` generalizes into the full command surface.**
   pi-subagents' bespoke buffer-or-deliver logic (`Subagent.steer` rejecting when not running) is subsumed by `AgentSession`'s queued-steering machinery, and the custom buffering becomes redundant.
4. **Multiple clients on one session.**
   The plan supports this explicitly, with deltas broadcast to all subscribers including the initiator, so an operator can jump into a subagent the parent agent spawned, inject guidance, and the parent's view stays consistent.
5. **Fork and rewind, not just append.**
   `navigate tree` plus `fork_session` let an operator rewind a subagent or fork it at an entry — full session editing, far beyond appending a steer message.

## What pi-subagents itself becomes

This validates and sharpens the direction the architecture doc is already heading. pi-subagents' stated core job — spawn a child session derived from the parent, run the turn loop, track and stream and collect the result, gate concurrency, support resume, and publish its lifecycle — is almost exactly the `AgentSessionServer`'s job for child sessions.

- **The observation tier dissolves.**
  This confirms [Phase 18]'s own finding that "the activity/metrics push tier is provisional" — under the server it genuinely does not need to exist in pi-subagents.
- **The recursion principle gets its real substrate.**
  The architecture doc's "a subagent is a recursive Pi" framing maps directly onto the plan's session model: a subagent session is just another session in the server, with the same snapshot, delta, and command surface.
- **pi-subagents keeps only its semantic layer** — agent type, description, result text, token totals, concurrency admission, and the recursion guard — the things a generic session server does not know.
  The liveness and activity channel rides on session sync instead of a hand-rolled broadcast.

### Bespoke machinery the server would retire

| Today (pi-subagents reinvents it)                                        | Under the server architecture                              |
| ------------------------------------------------------------------------ | ---------------------------------------------------------- |
| `record-observer` re-deriving live activity                              | `subscribeSession` delta stream                            |
| 80 ms `listAgents()` widget poll                                         | `session_created` / `session_status_changed` global events |
| [#277] accessors (`messages`, `subscribeToUpdates`, `getContextPercent`) | `SessionSnapshot` + deltas                                 |
| `ConversationViewer` / native session navigation                         | client renders the snapshot through Pi's own components    |
| dual-source-by-liveness split                                            | server rehydrates; client sees one session shape           |
| `steer_subagent` buffer-or-deliver                                       | `join` + `prompt` / queued-steering commands               |
| `subagents:*` activity broadcasts                                        | session sync (semantic events stay; liveness moves)        |

## Prerequisites and open questions

Being honest about the constraints the plan itself raises:

1. **Registry-local provider state is a hard prerequisite** (the plan states this explicitly).
   Subagents run in-process under a multi-session server — exactly the scenario where process-global provider registration would corrupt one session's model view from another's extension load. pi-subagents is well-positioned (it already snapshots model and registry into `ParentSnapshot`), but the underlying Pi change must land first.
2. **The recursion guard stays pi-subagents' invariant.**
   A subagent session created through the server must still have pi-subagents' three tools stripped, and an operator-joined subagent must not be able to spawn observers of itself in a loop.
3. **Workspace context must travel in the snapshot.**
   Subagents can run in a different cwd or git worktree (`pi-subagents-worktrees`).
   The plan's `SessionSnapshot.cwd` field already accounts for this, so an operator's client renders and interacts in the correct workspace.
4. **Operator-submitted versus parent-submitted command permissions.**
   Commands an operator joins and submits flow through the subagent's `AgentSession`, so pi-permission-system's in-child gating still applies — but whether an operator's `run bash` or `prompt` should carry a different permission posture than the parent agent's is a genuine open design question, not something to assume.

## Net assessment

This architecture turns all three capabilities from bespoke, fragile features pi-subagents must build and maintain into thin clients of one uniform session-sync surface — and in doing so lets pi-subagents shed most of the observation infrastructure it only built because that surface did not exist yet.

[session-sync]: https://jot.mariozechner.at/s/zgzbq9n4f4mfck
[ADR-0004]: ../decisions/0004-reconsider-ui-direction.md
[Phase 18]: ./history/phase-18-reconsider-ui.md
[#277]: https://github.com/gotgenes/pi-packages/issues/277
