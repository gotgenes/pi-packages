# Review-log fields and width bound (breaking)

Two changes to the permission review log (`logs/pi-permission-system-permission-review.jsonl`) take effect on upgrade without a config edit.
Both come from [ADR 0011] §6, which makes the log a renderer over the prompt payload with its own configured limits, rather than a place the assembled prompt sentence happened to land.

Nothing about **redaction** changes.
Key-name masking applies exactly as before, and the boundary is unchanged: a value bound to a sensitive key name is masked; a secret embedded in a bash command string is not.
See [ADR 0010].

## The `message` field is removed

Every `permission_request.*` entry previously carried `message`, the same assembled sentence the prompt showed.
It is gone.
What the log accumulated was a side effect of how a prompt happened to be worded, and the sentence duplicated facts the entry already carried in structured form.

In its place each entry carries the ask's own request facts:

| Field                | Present when                                  | Meaning                                                                                         |
| -------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `surface`            | always                                        | The gate surface the rule fired on (`bash`, `path`, `external_directory`, `skill`, a tool name) |
| `matchedPattern`     | a rule matched                                | The rule that fired, including a sentinel such as `<indirection-bash-wrapper>`                  |
| `executedUnit`       | a wrapper hides an inner command              | The unit that will actually run, e.g. `grep foo` inside `xargs grep foo`                        |
| `commandContext`     | the unit came from a substitution or subshell | `command_substitution`, `process_substitution`, or `subshell`                                   |
| `invokedToolName`    | a shell alias re-exposed bash                 | The tool name the agent actually called, e.g. `exec_command`                                    |
| `forwarded`          | the ask arrived from a subagent               | `true`                                                                                          |
| `requesterSessionId` | the ask arrived from a subagent               | The requesting session's id                                                                     |

A field the ask does not carry is omitted rather than written as `null`.

The existing structured columns are unchanged: `requestId`, `source`, `agentName`, `toolCallId`, `toolName`, `skillName`, `path`, `command`, `target`, `toolInputPreview`, `resolution`, and `denialReason`.

If you parse the log, read those fields instead of `message`.
Two of the new ones close gaps a `message` reader never had: a `permission_request.blocked` entry recorded that policy denied the call but never which rule, and `executedUnit` had not reached the log at all.

## Every review-log value is bounded

Each string the review log writes is now narrowed to `reviewLogFieldMaxWidth` characters and marked with a trailing ellipsis.
The default is `1000` — the width that already bounded `toolInputPreview`, applied to every field so the log has one limit rather than one limit and an unbounded remainder.

The practical effect is on `command`: a bash command longer than the width is stored shortened, where it was previously written whole.
On a real 9,484-entry log, 188 of 4,325 command entries (4.3%) exceed the default.

To keep longer values, raise the setting:

```jsonc
{
  "reviewLogFieldMaxWidth": 8000
}
```

There is no "unbounded" value by design — the point of the bound is that log growth is a decision rather than an accident.
The **debug** log is unaffected: it is opt-in and exists to be read in full.

This bound is a length cap, not redaction.
It narrows by length alone and never inspects a value to decide what to hide, and the two compose independently: a sensitive-keyed value is masked whole however long it was.

## Removed exports

`ToolPreviewFormatterOptions.toolInputLogPreviewMaxLength` and `TOOL_INPUT_LOG_PREVIEW_MAX_LENGTH` are removed, superseded by `reviewLogFieldMaxWidth`.
`ToolPreviewFormatter` no longer truncates what it produces for the log; the writer bounds it instead.

## Agent-facing denial text

Not a contract, but visible: the text returned to the agent when a call is refused no longer echoes the bash command or the tool input.
It names the surface, the tool, the rule that fired, the flagged path or MCP target or skill, and the operator's or human's reason.
[ADR 0011] §7 states the rule — the agent renderer identifies the call; it does not reproduce it — and the agent already holds its own arguments, which the harness keeps beside the refusal.

[ADR 0010]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0010-permission-log-secret-exposure.md
[ADR 0011]: https://github.com/gotgenes/pi-packages/blob/main/packages/pi-permission-system/docs/decisions/0011-prompt-presentation-contract.md
