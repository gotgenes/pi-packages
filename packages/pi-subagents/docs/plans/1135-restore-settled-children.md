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
- No default changes, and an ID the parent session never recorded is still `unknown-agent`.
  The one public type that grows is `ResumeRefusalReason`, by `agent-type-unavailable`; a consumer that switches over it exhaustively must handle the new member.

## Non-Goals

- Resuming a source parent's children from a fork.
  A fork can resume only children it spawned itself.
- Keeping an in-flight run alive across shutdown (#1111).
- Restoring a child that ran in a provider workspace: the earlier manager's teardown disposed every workspace it held.
- Rebuilding records eagerly at `session_start`, or answering `get_subagent_result` for a child before it is resumed.
- Changing the retention sweep: a session the sweep released in the current manager is still refused as `session-released`.

## Design

The parent session's `subagents:record` entries already carry each finished run's ID, agent type, description, status, tool count, and transcript path (#1034).
They are the source, read when a resume names an ID the manager holds no record for, so the restore always answers for whichever parent session is current.

1. **Session assembly continues a transcript.**
   `createSubagentSession` takes an optional `transcript`.
   With one, it reopens that file (`SessionManager.open` at the composition root) instead of creating a session, and refuses it before any SDK session exists unless it still carries the session id, parent, and cwd recorded when the resume was accepted, and holds a conversation: Pi opens a missing path as a new, empty session.
   It assembles the child in the directory the transcript records, against the model the transcript's branch selects by Pi's own rule (`recorded-model.ts`, mirroring Pi's unexported `getBranchSelection`) when the parent's registry still knows it, and leaves the thinking level unset so Pi restores the recorded one.
   `SubagentSession` is told the transcript is continued, so its first run here neither prefixes parent context nor emits the child-lifecycle `completed` event.
2. **A record can start from a transcript.**
   `SubagentExecution.transcript` marks a record rebuilt from a transcript.
   It has no session, yet `resumeRefusal` accepts it, and its first resume opens the session through the factory after the run has started, so a stop that lands meanwhile still ends that run.
   A transcript that fails to reopen fails that resume's run and leaves the record resumable.
   One reopening is in flight per record: a resume started while a stopped resume's reopening is pending waits for it and continues the session it produces, and a session the factory hands back after the record was torn down is disposed on arrival.
3. **The manager restores on resume.**
   `SubagentManagerOptions.history` (`ChildHistory`) supplies the parent session's entries, a fresh-context parent snapshot, the parent session's identity, and a reader for a transcript header's cwd and spawning parent ID.
   `startResume` falls back to it for an unknown ID, takes the last run recorded under that ID, and registers a rebuilt record only when it is resumable.
   A run with no transcript, or one whose header cannot be read, is refused as `no-session`.
   An inherited record whose transcript names a different parent is refused as `unknown-agent`, before any run starts.
   A run whose agent type is no longer defined, or is disabled, is refused as `agent-type-unavailable` rather than resolved to `general-purpose`, and the check is repeated as the transcript reopens.
   Each run records `providerWorkspace`, whether a workspace provider prepared its directory; one that did is refused as `workspace-disposed`.
   An entry written before that field existed is restored only when its transcript names the parent's directory and no provider is registered.
   The rebuilt record keeps the turn ceiling its last run recorded in `turnBudget.maxTurns`, or stays unlimited when that budget named none; a run that recorded no budget (it never reached its turn loop) gets what a fresh spawn of its type would.

## Verification

- Unit tests cover each layer: `test/lifecycle/create-subagent-session.test.ts`, `test/lifecycle/subagent.test.ts`, `test/lifecycle/subagent-manager.test.ts`, `test/session/transcript-header.test.ts`, `test/session/recorded-model.test.ts` (which sweeps every branch of up to four entries against Pi's own selection), `test/persisted-record.test.ts`, and `test/runtime.test.ts`.
- `test/lifecycle/restore-real-transcript.test.ts` runs a child on Pi's real `AgentSession` with a deterministic faux model, records it in a real parent session file, and resumes it from a fresh manager: the resumed child answers from the conversation its reopened transcript carries, on the model it selected, under the turn limit it ran with, and a transcript removed or replaced before it reopens fails the resume without a request.
- `test/composition-root.test.ts` runs a child to completion in one extension instance, shuts it down as `/reload` does, and resumes the child from a fresh instance over the same session entries.
- Live, against Pi with this extension loaded by `-e`: a child resumed after a restart reopened on the same session file, and after `/reload` in the TUI, recalled a code word given only in its first run, appending to its original transcript; a background resume after `/reload` delivered its completion notice.

## Limitations

- A per-call `model` or `thinking` override from the original spawn is not recorded separately; a restored child runs on its transcript's model selection and thinking level, which carry those choices.
- A run that never reached its turn loop recorded no turn budget, so its restored child gets the agent's current turn limit.
- The identity check narrows, but cannot close, the window between reading a transcript and Pi opening it: another process can still change the file in between.
- The parent snapshot is taken at resume time, so the child's system prompt reflects the parent and agent definition as they are now.
