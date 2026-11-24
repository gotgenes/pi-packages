/**
 * builtin-tool-renderers.ts — Pi's built-in tool renderers for a transcript
 * whose source cannot supply them.
 *
 * Pi's interactive mode never hands `ToolExecutionComponent` a bare registry
 * lookup: it merges in the built-in renderers, so a built-in tool draws natively
 * even when no session registers it. A released agent's transcript has no
 * registry at all, and without renderers Pi prints a call's arguments as JSON
 * and its whole output whatever its expansion state.
 *
 * Pi keeps that merge (`withBuiltInRenderers`) internal and exports only the
 * per-tool definition factories, so this module mirrors the merge over them.
 */

import { createReadToolDefinition, type ToolExecutionComponent } from "@earendil-works/pi-coding-agent";

/** What `ToolExecutionComponent` accepts to draw a tool's call and result. */
type ToolRenderers = NonNullable<ConstructorParameters<typeof ToolExecutionComponent>[4]>;

/** Pi's built-in tools, by the name a transcript's tool call carries. */
const BUILT_IN_TOOLS: ReadonlyMap<string, (cwd: string) => ToolRenderers> = new Map([["read", createReadToolDefinition]]);

/**
 * A tool's renderers, falling back to Pi's built-in ones the way Pi's own
 * interactive mode does: a missing definition takes the built-in, and a
 * definition without `renderCall` or `renderResult` borrows it.
 */
export function withBuiltInRenderers(
  toolName: string,
  definition: ToolRenderers | undefined,
  cwd: string,
): ToolRenderers | undefined {
  const builtIn = BUILT_IN_TOOLS.get(toolName)?.(cwd);
  if (!definition) return builtIn;
  if (!builtIn) return definition;
  return {
    ...definition,
    renderCall: definition.renderCall ?? builtIn.renderCall,
    renderResult: definition.renderResult ?? builtIn.renderResult,
  };
}
