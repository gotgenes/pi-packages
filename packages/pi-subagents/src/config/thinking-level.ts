/**
 * thinking-level.ts — The thinking-level vocabulary both spawn doors validate against.
 *
 * Pi accepts `off` alongside pi-ai's `ThinkingLevel`, but does not export the
 * combined list: `THINKING_LEVEL_OPTIONS` lives in `@earendil-works/pi-coding-agent`'s
 * internals and is absent from its public entry, so this package carries its own.
 *
 * An unrecognized level is not ignored by the SDK — `clampThinkingLevel` misses it in
 * the ordered table and falls to the first supported level, which is always `off`. A
 * typo therefore disables thinking entirely, which is why both doors reject rather
 * than pass the value through (Refs #834).
 */

import type { ThinkingLevel as SdkThinkingLevel } from "@earendil-works/pi-ai";

/**
 * Every level Pi accepts, in ascending order of effort.
 *
 * The `satisfies` clause rejects an entry the installed SDK does not declare, and the
 * parity tests in `test/config/thinking-level.test.ts` check both directions at runtime.
 * One drift escapes them: a level the SDK adds *and* gates behind a `thinkingLevelMap`
 * key, the way `xhigh` and `max` are gated, is invisible until a caller names it.
 */
export const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const satisfies readonly (SdkThinkingLevel | "off")[];

/** A thinking level as an agent file or a spawn caller may spell it. */
export type SubagentThinkingLevel = (typeof THINKING_LEVELS)[number];

/** Narrow an unvalidated value to a thinking level, or undefined when it is not one. */
export function parseThinkingLevel(value: unknown): SubagentThinkingLevel | undefined {
  return THINKING_LEVELS.find((level): boolean => level === value);
}

/** The message a door reports for a value {@link parseThinkingLevel} rejected. */
export function thinkingLevelError(value: unknown): string {
  return `Invalid thinking level ${describeRejected(value)}. Valid levels: ${THINKING_LEVELS.join(", ")}.`;
}

/**
 * Render a rejected value for an error message.
 *
 * The value arrives unvalidated from YAML frontmatter or a tool call, so it may be
 * any shape at all — anything past a primitive is named by type rather than serialized.
 */
function describeRejected(value: unknown): string {
  if (typeof value === "string") return `"${value}"`;
  if (value === null) return "null";
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return `of type ${typeof value}`;
}
