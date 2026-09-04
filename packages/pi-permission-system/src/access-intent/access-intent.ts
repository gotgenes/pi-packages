import type { AccessPath } from "./access-path";

/**
 * Raw tool input the manager must normalize (path / bash / MCP / extension tools).
 *
 * The `surface` is the tool name fed to `normalizeInput` (e.g. `"read"`, `"bash"`,
 * an MCP server name).
 */
export interface ToolAccessIntent {
  kind: "tool";
  /** Tool name fed to input normalization. */
  surface: string;
  input: unknown;
  agentName?: string;
}

/**
 * Precomputed equivalent policy values for a path-shaped surface.
 *
 * Not gate-emitted: the resolver produces it internally by unwrapping an
 * `access-path` intent via `matchValues()`, keeping the low-level manager
 * string-based (it never imports `AccessPath`). See {@link ResolvedAccessIntent}.
 *
 * This string seam is a deliberate, formalized boundary — not transitional
 * scaffolding to collapse into the manager (ADR-0002,
 * `docs/decisions/0002-path-values-string-boundary.md`).
 */
export interface PathValuesAccessIntent {
  kind: "path-values";
  /** `"path"` or `"external_directory"`. */
  surface: string;
  values: readonly string[];
  agentName?: string;
}

/**
 * An `AccessPath` value object for a path-shaped surface.
 *
 * Built for every path-shaped surface: the cross-cutting `path` and
 * `external_directory` gates, the per-tool path-bearing surfaces
 * (`read`/`write`/`edit`/`grep`/`find`/`ls`, #502), and the service/RPC policy
 * queries for those surfaces (#503). Lets `AccessPath` flow into the resolver
 * as a first-class variant so the resolver — not the producer — asks it for
 * `matchValues()` (Tell-Don't-Ask).
 */
export interface AccessPathAccessIntent {
  kind: "access-path";
  surface: string;
  path: AccessPath;
  agentName?: string;
}

/** What a gate emits — a raw tool input or an `AccessPath`. */
export type AccessIntent = ToolAccessIntent | AccessPathAccessIntent;

/**
 * What the manager consumes — the `access-path` variant has already been
 * unwrapped to `path-values` by the resolver via `path.matchValues()`.
 *
 * The manager stays string-based and never imports `AccessPath`: this is the
 * deliberate boundary formalized in ADR-0002
 * (`docs/decisions/0002-path-values-string-boundary.md`), guarded by a
 * `no-restricted-imports` lint rule on `permission-manager.ts`.
 */
export type ResolvedAccessIntent = ToolAccessIntent | PathValuesAccessIntent;
