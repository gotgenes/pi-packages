import type { AttributedEffect } from "#src/access-intent/effect";

/**
 * File tools that only read — never write — the filesystem.
 * Only these tools are eligible for the Pi infrastructure auto-allow.
 */
export const READ_ONLY_PATH_BEARING_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "find",
  "grep",
  "ls",
]);

export const PATH_BEARING_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "find",
  "grep",
  "ls",
]);

/**
 * The surface families that carry the read/write capability axis (ADR 0013 §3).
 *
 * A bare family name means "both directions": it is what an access whose
 * direction is proven to be both, or cannot be proven at all, consults — the
 * fail-closed base case of ADR 0013 §10.
 */
const DIRECTIONAL_FAMILIES: ReadonlySet<string> = new Set([
  "path",
  "external_directory",
]);

/**
 * The capability suffixes, in ADR 0013 §4's normative order: a family's
 * sugar-expanded and folded members are always read-then-write.
 */
const CAPABILITY_SUFFIXES = ["_read", "_write"] as const;

/**
 * Surfaces whose patterns are matched against filesystem paths and therefore
 * fold case (and separators) on Windows: the path-bearing tools, the
 * cross-cutting `path` gate, the `external_directory` boundary gate, and each
 * gate's two directional members.
 */
export const PATH_SURFACES: ReadonlySet<string> = new Set([
  ...PATH_BEARING_TOOLS,
  ...DIRECTIONAL_FAMILIES,
  ...directionalSurfaceNames(),
]);

/**
 * The family a surface belongs to — itself, when it carries no capability
 * suffix over a directional family.
 *
 * A surface that merely ends in `_read` without naming a directional family
 * (an extension tool called `my_tool_read`) is its own family, so the relation
 * never captures a name the axis does not own.
 */
export function surfaceFamilyOf(surface: string): string {
  for (const suffix of CAPABILITY_SUFFIXES) {
    if (!surface.endsWith(suffix)) continue;
    const family = surface.slice(0, -suffix.length);
    if (DIRECTIONAL_FAMILIES.has(family)) return family;
  }
  return surface;
}

/**
 * A family name's directional members, or `null` when `surface` is not a
 * family name (a directional member itself, or any non-path surface).
 *
 * The non-empty tuple is what lets the resolver's family fold be total: it
 * hands the members straight to `mostRestrictiveOf` with no empty branch.
 */
export function surfaceFamilyMembers(
  surface: string,
): readonly [string, ...string[]] | null {
  if (!DIRECTIONAL_FAMILIES.has(surface)) return null;
  const [read, write] = CAPABILITY_SUFFIXES;
  return [`${surface}${read}`, `${surface}${write}`];
}

/**
 * The narrowest surface in `family` that an attributed effect names.
 *
 * An unproven attribution names the bare family, whose two members the
 * resolver folds most-restrictive — the fail-closed base case of ADR 0013 §10,
 * which is also where a proven-both access lands.
 */
export function capabilitySurfaceForEffect(
  family: string,
  effect: AttributedEffect,
): string {
  const [read, write] = CAPABILITY_SUFFIXES;
  switch (effect) {
    case "read":
      return `${family}${read}`;
    case "write":
      return `${family}${write}`;
    case "unproven":
      return family;
  }
}

/**
 * The narrowest surface in `family` that `toolName`'s identity proves.
 *
 * A tool's name is one of the three proof sources ADR 0013 §7 names, so it
 * routes through the same effect-keyed selector every other source does:
 * `edit` and an unproven bash token reach the bare family by the one path.
 */
export function capabilitySurfaceForTool(
  family: string,
  toolName: string,
): string {
  return capabilitySurfaceForEffect(family, effectProvenByTool(toolName));
}

/**
 * The effect a tool's identity proves: the read-only file tools prove a read,
 * `write` proves a write, and everything else — `edit` (which does both), an
 * MCP tool, an extension tool — proves nothing.
 */
function effectProvenByTool(toolName: string): AttributedEffect {
  if (READ_ONLY_PATH_BEARING_TOOLS.has(toolName)) return "read";
  if (toolName === "write") return "write";
  return "unproven";
}

function directionalSurfaceNames(): string[] {
  return [...DIRECTIONAL_FAMILIES].flatMap((family) =>
    CAPABILITY_SUFFIXES.map((suffix) => `${family}${suffix}`),
  );
}
