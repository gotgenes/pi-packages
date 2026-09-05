/**
 * Registry for custom tool-input preview formatters.
 *
 * Allows extensions to register a formatter for a specific tool name so
 * permission prompts can show a human-readable summary instead of raw JSON.
 * One formatter per tool name; duplicate registration throws.
 */

/** A custom preview formatter for one tool's input. Returns `undefined` to decline. */
export type ToolInputFormatter = (
  input: Record<string, unknown>,
) => string | undefined;

/**
 * Read-only lookup used by `ToolPreviewFormatter` (ISP — exposes only the
 * read side, not the registration surface).
 */
export interface ToolInputFormatterLookup {
  get(toolName: string): ToolInputFormatter | undefined;
}

/**
 * Registration side of the formatter registry (ISP — exposes only the
 * write surface, mirroring the read-only {@link ToolInputFormatterLookup}).
 */
export interface ToolInputFormatterRegistrar {
  register(toolName: string, formatter: ToolInputFormatter): () => void;
}

/**
 * Persistent registry mapping tool names to custom preview formatters.
 *
 * Owned by the extension factory (`index.ts`) so it survives across the
 * per-tool-call `ToolPreviewFormatter` construction cycle.
 * Exposed to sibling extensions via `PermissionsService.registerToolInputFormatter`.
 */
export class ToolInputFormatterRegistry
  implements ToolInputFormatterLookup, ToolInputFormatterRegistrar
{
  private readonly formatters = new Map<string, ToolInputFormatter>();

  /**
   * Register a formatter for `toolName`.
   *
   * Throws if a formatter is already registered for that name — keeps
   * resolution deterministic (a pi-permission-system package priority).
   * Returns a disposer that removes the formatter; the disposer is
   * identity-guarded so a stale call cannot evict a later registration.
   */
  register(toolName: string, formatter: ToolInputFormatter): () => void {
    if (this.formatters.has(toolName)) {
      throw new Error(
        `A tool input formatter is already registered for '${toolName}'.`,
      );
    }
    this.formatters.set(toolName, formatter);
    return () => {
      if (this.formatters.get(toolName) === formatter) {
        this.formatters.delete(toolName);
      }
    };
  }

  get(toolName: string): ToolInputFormatter | undefined {
    return this.formatters.get(toolName);
  }
}
