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
- Non-breaking: no public type changes shape, no default changes, and an ID the parent session never recorded is still `unknown-agent`.

## Non-Goals

- Keeping an in-flight run alive across shutdown (#1111).
- Restoring a child that ran in a provider workspace: the earlier manager's teardown disposed every workspace it held.
- Rebuilding records eagerly at `session_start`, or answering `get_subagent_result` for a child before it is resumed.
- Changing the retention sweep: a session the sweep released in the current manager is still refused as `session-released`.

## Design

The parent session's `subagents:record` entries already carry each finished run's ID, agent type, description, status, tool count, and transcript path (#1034).
They are the source, read when a resume names an ID the manager holds no record for, so the restore always answers for whichever parent session is current.

1. **Session assembly continues a transcript.**
   `createSubagentSession` takes an optional `transcript`.
   With one, it reopens that file (`SessionManager.open` at the composition root) instead of creating a session, assembles the child against the model the transcript last recorded when the parent's registry still knows it, and leaves the thinking level unset so Pi restores the recorded one.
   `SubagentSession` is told the transcript is continued, so its first run here neither prefixes parent context nor emits the child-lifecycle `completed` event.
2. **A record can start from a transcript.**
   `SubagentExecution.transcript` marks a record rebuilt from a transcript.
   It has no session, yet `resumeRefusal` accepts it, and its first resume opens the session through the factory after the run has started, so a stop that lands meanwhile still ends that run.
   A transcript that fails to reopen fails that resume's run and leaves the record resumable.
3. **The manager restores on resume.**
   `SubagentManagerOptions.history` (`ChildHistory`) supplies the parent session's entries, a fresh-context parent snapshot, the parent session's identity, and a reader for a transcript header's cwd.
   `startResume` falls back to it for an unknown ID, takes the last run recorded under that ID, and registers a rebuilt record only when it is resumable.
   A run with no transcript, or one whose header cannot be read, is refused as `no-session`.
   A transcript whose header names a directory other than the parent's ran in a provider workspace, so it is refused as `workspace-disposed`.

## Verification

- Unit tests cover each layer: `test/lifecycle/create-subagent-session.test.ts`, `test/lifecycle/subagent.test.ts`, `test/lifecycle/subagent-manager.test.ts`, `test/session/transcript-cwd.test.ts`, and `test/runtime.test.ts`.
- `test/composition-root.test.ts` runs a child to completion in one extension instance, shuts it down as `/reload` does, and resumes the child from a fresh instance over the same session entries.
- Live, against Pi with this extension loaded by `-e`: a child resumed after a restart reopened on the same session file, and after `/reload` in the TUI, recalled a code word given only in its first run, appending to its original transcript; a background resume after `/reload` delivered its completion notice.

## Limitations

- A per-call `max_turns`, `model`, or `thinking` override from the original spawn is not recorded, so a restored child runs under the agent's own turn limit, its transcript's model, and its transcript's thinking level.
- A forked parent session carries its source's entries, so resuming a child from both would append both conversations to one transcript.
- The parent snapshot is taken at resume time, so the child's system prompt reflects the parent and agent definition as they are now.
