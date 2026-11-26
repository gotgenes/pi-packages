import { z } from "zod";
import { asPromptPayload } from "#src/presentation/prompt-payload";
import type { PermissionUiPromptSource } from "#src/service/permission-events";
import type { ForwardedPermissionRequest } from "./permission-forwarding";

/**
 * The forwarded-request wire, read tolerantly (ADR 0008 §4).
 *
 * A request missing a field every version writes is rejected. Every optional
 * field is dropped alone when it is malformed, so an older or newer peer's
 * request is still served from the fields it does carry — except where
 * dropping one field would read as a wider fact than the peer stated, which
 * drops the whole access intent instead (see each field below). Unknown keys
 * are stripped at every level, so a field added to the wire without being
 * added here never reaches the serving node.
 */

/** Valid `permissions:ui_prompt` source values. */
const UI_PROMPT_SOURCES = [
  "tool_call",
  "skill_input",
  "skill_read",
] as const satisfies readonly PermissionUiPromptSource[];

/** One `{ surface, pattern }` session grant, as both wire directions carry it. */
export const approvalGrantSchema = z.object({
  surface: z.string().min(1),
  pattern: z.string(),
});

/**
 * One unit of a bash chain the child left asking.
 *
 * A present `spellings` is a non-empty list: the child omits the key when it
 * has none, and an empty list must never read as "no spellings", which would
 * let a serving `deny` written against one miss.
 */
const askingUnitSchema = z.object({
  command: z.string(),
  spellings: z.array(z.string()).min(1).optional(),
  matchedPattern: z.string().optional(),
  floor: z.string().optional(),
});

/**
 * The child-fixed access intent.
 *
 * A malformed `floor` or `askingUnits` fails the whole intent rather than
 * dropping alone: "no floor" and "no units" are each wider readings than what
 * the child sent, and a dropped intent escalates instead. An unrecognized
 * `delegationLicense` drops only itself, since its absence is the restrictive
 * reading.
 */
const forwardedAccessIntentSchema = z
  .object({
    surface: z.string(),
    matchValues: z.array(z.string()),
    boundaryValue: z.string().nullable(),
    floor: z.string().optional(),
    // Empty is malformed: a child stamps the list only when it holds a unit.
    askingUnits: z.array(askingUnitSchema).min(1).optional(),
    delegationLicense: z.literal("nothing-on-disk").optional().catch(undefined),
    requesterCwd: z.string(),
    principal: z.object({ sessionId: z.string(), agentName: z.string() }),
  })
  .transform(withoutUndefinedKeys);

/**
 * A forwarded permission request file's contents.
 *
 * The child's session-approval suggestion rejects the pre-#810 shape (`surface`
 * plus `patterns`) rather than normalizing it, and an empty `grants` list,
 * which would record nothing while logging that it had.
 */
export const forwardedPermissionRequestSchema = z
  .object({
    id: z.string(),
    createdAt: z.number(),
    requesterSessionId: z.string(),
    targetSessionId: z.string(),
    requesterAgentName: z.string(),
    // An older child's `message` is deliberately not read: a skewed ask
    // renders from the fields it does carry (ADR 0011 §9).
    payload: z.unknown().transform(asPromptPayload).optional(),
    source: z.enum(UI_PROMPT_SOURCES).optional().catch(undefined),
    surface: z.string().nullable().optional().catch(undefined),
    value: z.string().nullable().optional().catch(undefined),
    sessionApproval: z
      .object({ grants: z.array(approvalGrantSchema).min(1) })
      .optional()
      .catch(undefined),
    accessIntent: forwardedAccessIntentSchema.optional().catch(undefined),
  })
  .transform(
    withoutUndefinedKeys,
  ) satisfies z.ZodType<ForwardedPermissionRequest>;

/**
 * Drop every `undefined`-valued key.
 *
 * A caught malformed field comes back as a present key holding `undefined`,
 * where an absent one comes back absent; this makes the two read the same, so
 * a consumer checking for a key's presence cannot tell them apart.
 */
function withoutUndefinedKeys<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
