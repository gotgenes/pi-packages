import { randomUUID } from "node:crypto";

/**
 * Mint the identifier for one permission request, at the moment the request is
 * created rather than at the moment it prompts.
 *
 * Distinct from the host's `toolCallId`, which keeps flowing alongside it as
 * the join back to the Pi transcript: a single tool call runs several gates and
 * therefore raises several permission requests, so the SDK's id cannot identify
 * one of them.
 *
 * The `perm-` prefix keeps the id self-identifying in a review log that also
 * carries SDK tool-call ids.
 */
export function createPermissionRequestId(): string {
  return `perm-${randomUUID()}`;
}

/**
 * Letters, digits, `-`, and `_`, at most 128 of them: one path segment that
 * can never be `.` or `..`, short enough that `<id>.json` plus an atomic
 * write's temp suffix stays far below a filesystem's name limit.
 */
const FILENAME_SAFE_REQUEST_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * Whether `id` can name a forwarding request or response file as-is.
 *
 * Every id {@link createPermissionRequestId} mints passes. An id that arrives
 * on the forwarding wire is checked against this before it names anything.
 */
export function isFilenameSafeRequestId(id: string): boolean {
  return FILENAME_SAFE_REQUEST_ID.test(id);
}
