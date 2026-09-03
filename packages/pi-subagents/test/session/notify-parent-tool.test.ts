import { describe, expect, it, vi } from "vitest";
import { NotifyParentTool, UPDATE_MESSAGE_MAX_LENGTH } from "#src/session/notify-parent-tool";
import { STUB_CTX } from "#test/helpers/stub-ctx";

function execute(announce: (message: string) => void, message: string) {
	const tool = new NotifyParentTool(announce);
	return tool.execute("tc-1", { message }, new AbortController().signal, undefined, STUB_CTX);
}

function textOf(result: { content: { type: "text"; text: string }[] }): string {
	return result.content[0].text;
}

describe("NotifyParentTool", () => {
	describe("the definition the child session receives", () => {
		it("is named notify_parent", () => {
			expect(new NotifyParentTool(vi.fn()).toToolDefinition().name).toBe("notify_parent");
		});

		it("carries a prompt snippet naming the non-blocking contract", () => {
			expect(new NotifyParentTool(vi.fn()).toToolDefinition().promptSnippet).toBe(
				"Send the delegating agent a one-way update without pausing.",
			);
		});
	});

	describe("sending an update", () => {
		it("hands the message to the announcer verbatim", () => {
			const announce = vi.fn<(message: string) => void>();

			execute(announce, "The bug is in the retry wrapper, not the client.");

			expect(announce).toHaveBeenCalledWith("The bug is in the retry wrapper, not the client.");
		});

		it("tells the child to keep working and that a reply may steer it", () => {
			expect(textOf(execute(vi.fn(), "Course change."))).toBe(
				"Update sent to the delegating agent. Continue working; it may steer you if it wants to redirect.",
			);
		});
	});

	describe("an over-long message", () => {
		// A nudge is the message's only carrier: unlike a result, there is no
		// get_subagent_result to pull the untruncated text from later.
		const long = "x".repeat(UPDATE_MESSAGE_MAX_LENGTH + 500);

		it("announces only what fits", () => {
			const announce = vi.fn<(message: string) => void>();

			execute(announce, long);

			expect(announce).toHaveBeenCalledWith("x".repeat(UPDATE_MESSAGE_MAX_LENGTH));
		});

		it("tells the child its message was cut, so the next one can be shorter", () => {
			expect(textOf(execute(vi.fn(), long))).toContain(
				`truncated to ${UPDATE_MESSAGE_MAX_LENGTH} characters`,
			);
		});

		it("leaves a message at the limit whole", () => {
			const announce = vi.fn<(message: string) => void>();
			const exact = "x".repeat(UPDATE_MESSAGE_MAX_LENGTH);

			const result = execute(announce, exact);

			expect(announce).toHaveBeenCalledWith(exact);
			expect(textOf(result)).not.toContain("truncated");
		});
	});
});
