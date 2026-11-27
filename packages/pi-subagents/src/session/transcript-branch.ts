/**
 * transcript-branch.ts — Whether a child transcript's raw entries hold a conversation to continue.
 *
 * A reopened transcript is continued from its raw entries, walked here rather
 * than by Pi: Pi's own walk stops silently at a missing parent and never
 * returns from a loop. The same reading tells a live child, as a shutdown
 * stops it, whether a later manager could continue its transcript.
 */

/** The fields of a raw transcript entry read to check its ancestry. */
export interface TranscriptEntryLike {
  readonly type: string;
  readonly id: string;
  /** The entry this one follows; null only for the root. */
  readonly parentId: string | null;
  readonly message?: { readonly role: string };
}

/**
 * The raw entries from the transcript's leaf back to its root, or undefined
 * unless every link holds: each parent is an entry the file holds, and the
 * chain ends at a root (`parentId: null`) without looping. Read from the raw
 * entries because Pi's own walk stops silently at a missing parent, treating
 * a tail cut off from its start as the whole conversation, and never returns
 * from a loop; Pi walks the branch only once this has held.
 */
export function rootedBranch(entries: readonly TranscriptEntryLike[], leafId: string | null): TranscriptEntryLike[] | undefined {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const branch: TranscriptEntryLike[] = [];
  let entry = leafId === null ? undefined : byId.get(leafId);
  // A chain longer than the distinct entries it can visit has looped.
  while (entry && branch.length < byId.size) {
    branch.push(entry);
    if (entry.parentId === null) return branch;
    entry = byId.get(entry.parentId);
  }
  return undefined;
}

/**
 * Whether a transcript's branch holds an exchange: a prompt the child was given
 * and a reply it made. Read from the raw entries, which a compaction keeps:
 * Pi's projection of a compacted branch replaces the earlier prompt with its
 * summary, so it may show no user message at all.
 */
export function holdsConversation(branch: readonly TranscriptEntryLike[]): boolean {
  const roles = new Set(branch.flatMap((entry) => (entry.type === "message" && entry.message ? [entry.message.role] : [])));
  return roles.has("user") && roles.has("assistant");
}
