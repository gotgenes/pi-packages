import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTranscriptHeader } from "#src/session/transcript-header";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "transcript-header-"));
});

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
});

/** Write `content` to a transcript file in the test directory and return its path. */
function transcript(content: string): string {
	const path = join(dir, "child.jsonl");
	writeFileSync(path, content);
	return path;
}

describe("readTranscriptHeader", () => {
	describe("a transcript Pi wrote", () => {
		it("reads the session's id, spawning parent, and working directory", () => {
			const sessionManager = SessionManager.create("/work/project", dir);
			sessionManager.newSession({ parentSession: "parent-id" });
			sessionManager.appendMessage({ role: "user", content: "hi", timestamp: 1 });
			sessionManager.appendMessage({
				role: "assistant",
				content: [{ type: "text", text: "hello" }],
				api: "anthropic-messages",
				provider: "anthropic",
				model: "test-model",
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "stop",
				timestamp: 2,
			});

			expect(readTranscriptHeader(sessionManager.getSessionFile()!)).toEqual({
				id: sessionManager.getSessionId(),
				cwd: "/work/project",
				parentSession: "parent-id",
			});
		});
	});

	describe("a header line", () => {
		it("reads the cwd it names, ignoring the entries after it", () => {
			const path = transcript(
				`${JSON.stringify({ type: "session", id: "s", cwd: "/work/a", parentSession: "parent-id" })}\n${JSON.stringify({ type: "message" })}\n`,
			);

			expect(readTranscriptHeader(path)).toEqual({ id: "s", cwd: "/work/a", parentSession: "parent-id" });
		});

		it("reads a header with no trailing newline", () => {
			expect(readTranscriptHeader(transcript(JSON.stringify({ type: "session", id: "s", cwd: "/work/b", parentSession: "parent-id" })))).toEqual({ id: "s", cwd: "/work/b", parentSession: "parent-id" });
		});
	});

	describe("no usable header", () => {
		it("answers undefined for a missing file", () => {
			expect(readTranscriptHeader(join(dir, "absent.jsonl"))).toBeUndefined();
		});

		it("answers undefined for an empty file", () => {
			expect(readTranscriptHeader(transcript(""))).toBeUndefined();
		});

		it("answers undefined when the first line is not JSON", () => {
			expect(readTranscriptHeader(transcript("not json\n"))).toBeUndefined();
		});

		it("answers undefined when the first line is not a session header", () => {
			expect(readTranscriptHeader(transcript(`${JSON.stringify({ type: "message", cwd: "/work/c", parentSession: "parent-id" })}\n`))).toBeUndefined();
		});

		it("answers undefined for a header with no spawning parent", () => {
			expect(readTranscriptHeader(transcript(JSON.stringify({ type: "session", id: "s", cwd: "/work/a" })))).toBeUndefined();
		});

		it("answers undefined for a header that names no cwd", () => {
			expect(readTranscriptHeader(transcript(`${JSON.stringify({ type: "session", id: "s", parentSession: "parent-id", cwd: "" })}\n`))).toBeUndefined();
		});

		it("answers undefined for a header that names no session id", () => {
			expect(readTranscriptHeader(transcript(`${JSON.stringify({ type: "session", cwd: "/work/a", parentSession: "parent-id" })}\n`))).toBeUndefined();
		});
	});
});
