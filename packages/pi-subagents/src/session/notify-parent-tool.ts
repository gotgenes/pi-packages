/**
 * notify-parent-tool.ts — The tool a child sends its delegating agent a one-way
 * update with.
 *
 * A running child that discovers something material — a course change, a wrong
 * premise, a scope problem — says so without abandoning its run. The call
 * returns at once; the parent may reply by steering, which the child picks up
 * at its next turn boundary.
 *
 * Supplied only to a background child. A foreground parent is blocked inside
 * its own `subagent` tool call, and the nudge that carries the update is
 * withheld until that run settles — which is after the child's own result has
 * already returned.
 *
 * Lives in `session/` alongside `ask-parent-tool.ts`, for the same reason.
 */

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export const NOTIFY_PARENT_TOOL_NAME = "notify_parent";

/**
 * The longest update the channel carries.
 *
 * A nudge is the message's only carrier — unlike a result, there is no
 * `get_subagent_result` to pull the untruncated text from later — so the cut is
 * made here, where the child is told about it and can be briefer next time.
 */
export const UPDATE_MESSAGE_MAX_LENGTH = 2000;

const RESULT_TEXT =
	"Update sent to the delegating agent. Continue working; it may steer you if it wants to redirect.";

/** Announces a child's update to its parent. */
export type UpdateAnnouncer = (message: string) => void;

export class NotifyParentTool {
	constructor(private readonly announce: UpdateAnnouncer) {}

	execute(
		_toolCallId: string,
		params: { message: string },
		_signal: AbortSignal,
		_onUpdate: unknown,
		_ctx: unknown,
	) {
		const truncated = params.message.length > UPDATE_MESSAGE_MAX_LENGTH;
		this.announce(truncated ? params.message.slice(0, UPDATE_MESSAGE_MAX_LENGTH) : params.message);
		const note = truncated
			? ` Your message was truncated to ${UPDATE_MESSAGE_MAX_LENGTH} characters; keep the next one shorter.`
			: "";
		// `details` is required by the SDK's result type; this tool renders none.
		return { content: [{ type: "text" as const, text: RESULT_TEXT + note }], details: undefined };
	}

	toToolDefinition() {
		return defineTool({
			name: NOTIFY_PARENT_TOOL_NAME,
			label: "Notify Parent",
			promptSnippet: "Send the delegating agent a one-way update without pausing.",
			description:
				"Send a one-way update to the agent that delegated this task and keep working. Use it only " +
				"for a material finding that changes what the delegating agent would do — a course change, a " +
				"wrong premise, a scope problem — not for routine progress. It does not wait for a reply; the " +
				"delegating agent may steer you if it wants to redirect.",
			parameters: Type.Object({
				message: Type.String({
					description: "The finding the delegating agent should know about now rather than at the end.",
				}),
			}),
			// The tool's own work is synchronous; the SDK's execute contract is not.
			execute: (
				toolCallId: string,
				params: { message: string },
				signal: AbortSignal,
				onUpdate: unknown,
				ctx: unknown,
			) => Promise.resolve(this.execute(toolCallId, params, signal, onUpdate, ctx)),
		});
	}
}
