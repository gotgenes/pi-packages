/**
 * transcript-header.ts — A child transcript's spawning parent and working directory.
 *
 * Pi writes a session file's header as its first line, and the header names
 * the spawning parent and the directory the session ran in. Only that line is read, so a long
 * transcript costs no more than a short one.
 */

import { closeSync, openSync, readSync } from "node:fs";

/** How much of the file is read for the header line; a header is far smaller. */
const HEADER_READ_BYTES = 64 * 1024;

export interface ChildTranscriptHeader {
	cwd: string;
	parentSession: string;
}

/**
 * Read the identity and cwd a child transcript records, or undefined when the file
 * is missing or unreadable, or its first line is not a session header naming both.
 */
export function readTranscriptHeader(transcript: string): ChildTranscriptHeader | undefined {
	let fd: number;
	try {
		fd = openSync(transcript, "r");
	} catch {
		return undefined;
	}
	try {
		const buffer = Buffer.alloc(HEADER_READ_BYTES);
		const length = readSync(fd, buffer, 0, buffer.length, 0);
		const text = buffer.toString("utf8", 0, length);
		const newline = text.indexOf("\n");
		return parseHeader(JSON.parse(newline === -1 ? text : text.slice(0, newline)));
	} catch {
		return undefined;
	} finally {
		closeSync(fd);
	}
}

function parseHeader(header: unknown): ChildTranscriptHeader | undefined {
	if (typeof header !== "object" || header === null) return undefined;
	const { type, cwd, parentSession } = header as Record<string, unknown>;
	return type === "session" && typeof cwd === "string" && cwd !== "" && typeof parentSession === "string" && parentSession !== ""
		? { cwd, parentSession }
		: undefined;
}
