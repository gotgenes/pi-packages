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
