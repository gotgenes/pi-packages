---
issue: 1135
issue_title: "pi-subagents: restore managed children after parent reload or restart"
---

# Resume a settled child after `/reload` or a restart

## Problem Statement

After `/reload`, or after restarting Pi and reopening the same parent session, a `subagent` call with `resume` set to an earlier child's ID reports "Agent not found".
The child's transcript is still on disk and `/subagents:sessions` still lists it, but the new `SubagentManager` holds no record for it, and `startResume` refuses any ID it holds no record for.

## Goals

- From the reopened parent, `resume` continues the settled child under its original ID, with its prior conversation, through the normal subagent interface: foreground delivery, background delivery with its completion notice, the concurrency limit, the lifecycle events, and a fresh `subagents:record` entry.
- The same holds for the `SubagentsService.resume` front door, which goes through the same manager method.
- A restored child runs only as it was: its own transcript, its agent type's current definition (never another type's), the model route its transcript selected, the turn ceiling it last ran under, and its cumulative tool, token, and compaction counts.
  Anything that cannot be shown to hold refuses the resume or fails its run before the model receives a request.
- No default changes, and an ID the parent session never recorded is still `unknown-agent`.
  The one public type that grows is `ResumeRefusalReason`, by `agent-type-unavailable`.
  A consumer that switches over it exhaustively must handle the new member, so the change is released as breaking, following the precedent [#1013] set for `resume-queued`.

## Non-Goals

- Resuming a source parent's children from a fork.
  A fork can resume only children it spawned itself.
- Keeping an in-flight run alive across shutdown ([#1111]).
- Restoring a child that ran in a provider workspace: the earlier manager's teardown disposed every workspace it held.
- Restoring a child recorded before its run entries carried the transcript's identity (see Limitations).
- Rebuilding records eagerly at `session_start`, or answering `get_subagent_result` for a child before it is resumed.
- Changing the retention sweep: a session the sweep released in the current manager is still refused as `session-released`.

## Design

The parent session's `subagents:record` entries already carry each finished run's ID, agent type, description, status, tool count, and transcript path ([#1034]).
They are the source, read when a resume names an ID the manager holds no record for, so the restore always answers for whichever parent session is current.

1. **Each run records what identifies and continues its transcript.**
   An entry takes its outcome from the run that ended and the rest from the agent as it is when the entry is written.
   Besides `toolUses`, an entry now records the cumulative `lifetimeUsage` and `compactionCount`, the child's Pi `sessionId`, the `transcriptLeafId` (the last entry its transcript held when the run ended), and `providerWorkspace` (whether a workspace provider prepared its directory).
   `readRestorableRun` returns the last valid entry under an ID with those fields, and the latest turn budget any of the child's entries recorded, so a later run that never reached its turn loop does not hide an earlier ceiling.
   An entry without them is `unprovable`.

2. **Session assembly continues a transcript.**
   `createSubagentSession` takes an optional `transcript` (`ContinuedTranscript`: file, header, leaf).
   With one, it reopens that file (`SessionManager.open` at the composition root) instead of creating a session, and throws before any SDK session exists unless the file still is the child's conversation:
   - The header is read without writing immediately before the open, and a file whose session id, parent, or cwd differs is never opened, because Pi initialises an empty file it opens and rewrites an older-format session it loads.
     The opened session manager must name them too.
   - The branch must still contain the recorded leaf entry, so a file cut back to an earlier point, including to the entries before its conversation, is refused.
   - The conversation must hold a prompt and a reply, not only the system prompt Pi records.
   - The child runs on the model its branch selects by Pi's own rule (`recorded-model.ts`, mirroring Pi's unexported `getBranchSelection`).
     The transcript is refused when that model, or the route its latest `model_change` chose, is no longer in the parent's registry, so the conversation never reaches a fallback model.
   - The agent type's definition is read afresh (`SubagentSessionDeps.currentAgentConfig`, which reloads the registry) after the last await before assembly, and assembly uses exactly that definition; a type that is gone or disabled is refused rather than resolved to `general-purpose`.
   - The thinking level is left unset so Pi restores the recorded one.

   `SubagentSession` is told the transcript is continued, so its first run here neither prefixes parent context nor emits the child-lifecycle `completed` event.

3. **A record can start from a transcript.**
   `SubagentExecution.transcript` marks a record rebuilt from a transcript.
   It has no session, yet `resumeRefusal` accepts it, and its first resume opens the session through the factory after the run has started, so a stop that lands meanwhile still ends that run.
   The run holds the record from the start of the reopening until it either reaches its turn loop or ends: `resumeRefusal` reads `still-running` meanwhile, even once the run is stopped.
   So only one reopening is ever in flight, and the record is resumable again from that run's terminal notification on.
   A transcript that fails to reopen fails that resume's run (a stopped one stays stopped) and leaves the record resumable.
   A session the factory hands back after the record was torn down is disposed on arrival.

4. **The manager restores on resume.**
   `SubagentManagerOptions.history` (`ChildHistory`) supplies the parent session's entries, a fresh-context parent snapshot, the parent session's identity, and a reader for a transcript header.
   `startResume` falls back to it for an unknown ID and registers a rebuilt record only when it is resumable:
   - An inherited record whose transcript header names a different parent is refused as `unknown-agent`, before any run starts.
   - A run with no transcript, an unreadable one, one whose header names a session other than the recorded `sessionId` (such as a sibling's transcript put at the path), and an `unprovable` entry are refused as `no-session`.
   - The agent registry is reloaded before the type is checked, so the service front door, which no `subagent` call refreshes, answers like the tool; a type that is gone or disabled is `agent-type-unavailable`.
   - A run whose `providerWorkspace` is set is refused as `workspace-disposed`.

   The rebuilt record keeps the ceiling in the latest recorded `turnBudget`, or stays unlimited when that budget named none, with its used turns reset; with no budget recorded at all it gets what a fresh spawn of its type would.
   Its state starts from the recorded `toolUses`, `lifetimeUsage`, and `compactionCount`.

## Verification

- Unit tests cover each layer: `test/lifecycle/create-subagent-session.test.ts`, `test/lifecycle/subagent.test.ts`, `test/lifecycle/subagent-manager.test.ts`, `test/session/transcript-header.test.ts`, `test/session/recorded-model.test.ts` (which sweeps every branch of up to four entries against Pi's own selection), `test/persisted-record.test.ts`, and `test/runtime.test.ts`.
- `test/lifecycle/restore-real-transcript.test.ts` runs children on Pi's real `AgentSession` with a deterministic faux model, records them in a real parent session file, and resumes them from a fresh manager.
  It covers the resumed child answering from its reopened conversation, on the model it selected, under the turn limit it ran with (also across a restart whose resume was stopped in the queue), with cumulative usage.
  It also covers refusals with no model request and no change to the file: a sibling's transcript at the path, a transcript cut back to an earlier exchange, a recorded model the parent no longer has, and a transcript removed, emptied, cut back to its pre-conversation entries, or replaced while the resume waited for a slot.
- `test/composition-root.test.ts` runs a child to completion in one extension instance, shuts it down as `/reload` does, and resumes the child from a fresh instance over the same session entries, including a service-only resume after the agent file was disabled on disk.
- Live, against Pi with this extension loaded by `-e`: a child resumed after a restart reopened on the same session file, and after `/reload` in the TUI, recalled a code word given only in its first run, appending to its original transcript; a background resume after `/reload` delivered its completion notice.
  That check predates the identity and route requirements above.

## Limitations

- A per-call `model` or `thinking` override from the original spawn is not recorded separately; a restored child runs on its transcript's model selection and thinking level, which carry those choices.
- A child none of whose runs reached its turn loop recorded no turn budget, so its restored child gets the agent's current turn limit.
- **Children recorded by a version that predates these fields are not restorable.**
  Their entries carry no `sessionId`, `transcriptLeafId`, `providerWorkspace`, or cumulative usage, so nothing shows that the file at the recorded path is still the child's conversation, or what it cost.
  Such a resume is refused as `no-session`, even for a child that ran in the parent's directory; a fork's inherited one is still `unknown-agent`.
  Its transcript stays viewable in `/subagents:sessions`.
- Concurrency assumptions for a transcript between the resume's acceptance and its first turn:
  - **The queued window is covered.**
    However long a resume waits for a concurrency slot, the transcript is checked read-only at the moment it is opened, so a removal, a truncation, or a replacement made while it waited fails the resume with its bytes unchanged and no model turn.
  - **A simultaneous external writer is not supported.**
    The read-only check and Pi's open are consecutive synchronous calls; another process that writes the file between them, or while the reopened child is running and appending to it, is outside what the restore defends against.
  - A file that does match is the child's own transcript, and Pi may still repair or migrate it as it opens it (a missing final newline, an older session format), as it would on any reopen.
  - Identity is the recorded session id, the header's parent and cwd, and the presence of the recorded leaf entry; a file forged to carry all of them is not told apart.
- The parent snapshot is taken at resume time, so the child's system prompt reflects the parent and agent definition as they are now.

[#1013]: https://github.com/gotgenes/pi-packages/issues/1013
[#1034]: https://github.com/gotgenes/pi-packages/issues/1034
[#1111]: https://github.com/gotgenes/pi-packages/issues/1111
