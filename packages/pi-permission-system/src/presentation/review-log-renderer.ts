import type { PromptPayload } from "#src/presentation/prompt-payload";

/**
 * The payload facts the permission review log persists (ADR 0011 §6).
 *
 * The log is a renderer over the payload like any other, and this is its
 * content decision: the request facts, and only those the log's own structured
 * columns do not already carry. `toolName`, `command`, `path`, `target`, and
 * `toolInputPreview` are written by the gates; restating them under a second
 * name would grow the log rather than sharpen it.
 *
 * Evidence and annotations are deliberately absent.
 * `docs/decisions/0010-permission-log-secret-exposure.md` bounds what the logs
 * accumulate, and evidence is exactly the unbounded part — the point of this
 * render is that the log's growth is a decision, not a side effect of how a
 * prompt happened to be worded.
 *
 * A fact the ask does not carry is omitted rather than written as `null`, so a
 * line states what was true rather than enumerating what was not.
 */
export function renderReviewLogFacts(
  payload: PromptPayload,
): Record<string, unknown> {
  const { request } = payload;
  return {
    surface: request.surface,
    ...present("matchedPattern", request.matchedPattern),
    ...present("executedUnit", request.executedUnit),
    ...present("commandContext", request.commandContext),
    ...present("invokedToolName", request.invokedToolName),
    ...forwardingFacts(payload),
  };
}

/**
 * Where the ask came from, when it came from somewhere else.
 *
 * A local ask is the default and states nothing; a forwarded one names the
 * session that raised it, so a decision can be correlated back to the child
 * that asked.
 */
function forwardingFacts(payload: PromptPayload): Record<string, unknown> {
  const { forwarded, sessionId } = payload.request.requester;
  return forwarded
    ? { forwarded: true, ...present("requesterSessionId", sessionId) }
    : {};
}

function present<T>(key: string, value: T | null): Record<string, T> {
  return value === null ? {} : { [key]: value };
}
