import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readTranscriptCwd } from "#src/session/transcript-cwd";

let dir: string;

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "transcript-cwd-"));
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

describe("readTranscriptCwd", () => {
	describe("a transcript Pi wrote", () => {
		it("reads the directory the session ran in", () => {
			const sessionManager = SessionManager.create("/work/project", dir);
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

			expect(readTranscriptCwd(sessionManager.getSessionFile()!)).toBe("/work/project");
		});
	});

	describe("a header line", () => {
		it("reads the cwd it names, ignoring the entries after it", () => {
			const path = transcript(
				`${JSON.stringify({ type: "session", id: "s", cwd: "/work/a" })}\n${JSON.stringify({ type: "message" })}\n`,
			);

			expect(readTranscriptCwd(path)).toBe("/work/a");
		});

		it("reads a header with no trailing newline", () => {
			expect(readTranscriptCwd(transcript(JSON.stringify({ type: "session", cwd: "/work/b" })))).toBe("/work/b");
		});
	});

	describe("no cwd to read", () => {
		it("answers undefined for a missing file", () => {
			expect(readTranscriptCwd(join(dir, "absent.jsonl"))).toBeUndefined();
		});

		it("answers undefined for an empty file", () => {
			expect(readTranscriptCwd(transcript(""))).toBeUndefined();
		});

		it("answers undefined when the first line is not JSON", () => {
			expect(readTranscriptCwd(transcript("not json\n"))).toBeUndefined();
		});

		it("answers undefined when the first line is not a session header", () => {
			expect(readTranscriptCwd(transcript(`${JSON.stringify({ type: "message", cwd: "/work/c" })}\n`))).toBeUndefined();
		});

		it("answers undefined for a header that names no cwd", () => {
			expect(readTranscriptCwd(transcript(`${JSON.stringify({ type: "session", cwd: "" })}\n`))).toBeUndefined();
		});
	});
});
