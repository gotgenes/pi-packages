/**
 * Registry for custom tool access-intent extractors.
 *
 * Lets sibling extensions declare the filesystem path a tool will access when
 * the tool's input shape is not the default `input.path` convention, so the
 * cross-cutting `path` and `external_directory` gates can see it.
 * One extractor per tool name; duplicate registration throws.
 */

/** Returns the filesystem path this tool will access, or `undefined` to decline. */
export type ToolAccessExtractor = (
  input: Record<string, unknown>,
) => string | undefined;

/**
 * Which node's registration answered a lookup.
 *
 * `"inherited"` means the answer came from an ancestor node in this process
 * rather than from this node's own registry (ADR 0012 decision 1, the
 * fact-shaping clause). A gate records it so a child's dependence on another
 * node's registration is never invisible.
 */
export type RegistrationOrigin = "local" | "inherited";

/** An extractor together with the node whose registry supplied it. */
export interface ResolvedToolAccessExtractor {
  extractor: ToolAccessExtractor;
  origin: RegistrationOrigin;
}

/**
 * Read-only lookup used by the gate pipeline (ISP — exposes only the read
 * side, not the registration surface).
 *
 * It answers with the origin rather than a bare function because the gates
 * report where a path came from; an implementation that can only answer from
 * its own registry reports `"local"`.
 */
export interface ToolAccessExtractorLookup {
  resolve(toolName: string): ResolvedToolAccessExtractor | undefined;
}

/**
 * Registration side of the extractor registry (ISP — exposes only the write
 * surface, mirroring the read-only {@link ToolAccessExtractorLookup}).
 */
export interface ToolAccessExtractorRegistrar {
  register(toolName: string, extractor: ToolAccessExtractor): () => void;
}

/**
 * Persistent registry mapping tool names to custom access-intent extractors.
 *
 * Owned by the extension factory (`index.ts`) so it survives across the
 * per-tool-call gate evaluation cycle.
 * Exposed to sibling extensions via `PermissionsService.registerToolAccessExtractor`.
 */
export class ToolAccessExtractorRegistry
  implements ToolAccessExtractorLookup, ToolAccessExtractorRegistrar
{
  private readonly extractors = new Map<string, ToolAccessExtractor>();

  /**
   * Register an extractor for `toolName`.
   *
   * Throws if an extractor is already registered for that name — keeps
   * resolution deterministic (a pi-permission-system package priority).
   * Returns a disposer that removes the extractor; the disposer is
   * identity-guarded so a stale call cannot evict a later registration.
   */
  register(toolName: string, extractor: ToolAccessExtractor): () => void {
    if (this.extractors.has(toolName)) {
      throw new Error(
        `A tool access extractor is already registered for '${toolName}'.`,
      );
    }
    this.extractors.set(toolName, extractor);
    return () => {
      if (this.extractors.get(toolName) === extractor) {
        this.extractors.delete(toolName);
      }
    };
  }

  resolve(toolName: string): ResolvedToolAccessExtractor | undefined {
    const extractor = this.extractors.get(toolName);
    return extractor ? { extractor, origin: "local" } : undefined;
  }
}
