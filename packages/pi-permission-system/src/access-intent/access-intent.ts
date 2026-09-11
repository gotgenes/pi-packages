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

/**
 * What a gate emits — a raw tool input, an `AccessPath`, or the spellings of
 * one invocation on a text-matching surface.
 */
export type AccessIntent =
  | ToolAccessIntent
  | AccessPathAccessIntent
  | AliasValuesAccessIntent;

/**
 * What the manager consumes — the `access-path` variant has already been
 * unwrapped to `path-values` by the resolver via `path.matchValues()`.
 *
 * The manager stays string-based and never imports `AccessPath`: this is the
 * deliberate boundary formalized in ADR-0002
 * (`docs/decisions/0002-path-values-string-boundary.md`), guarded by a
 * `no-restricted-imports` lint rule on `permission-manager.ts`.
 */
export type ResolvedAccessIntent =
  | ToolAccessIntent
  | PathValuesAccessIntent
  | AliasValuesAccessIntent;

/**
 * Several spellings of one invocation, for a surface that matches text.
 *
 * The `bash` surface matches a command string, and the same command can name
 * the same file in its absolute spelling. The gate supplies the unit's texts
 * here — the text as typed first — so the manager evaluates them as *aliases*:
 * last-match-wins across the union, rather than stopping at the first text that
 * matches a rule. That is the treatment `AccessPath.matchValues()` already
 * gives the lexical and canonical forms of a path (#418).
 *
 * `resultExtras` is the emitter's, because it knows the surface's own fields
 * (`command` for bash) and the manager must not learn them: it is copied onto
 * the result exactly as `NormalizedInput.resultExtras` is.
 */
export interface AliasValuesAccessIntent {
  kind: "alias-values";
  /** The surface whose rules the texts are matched against. */
  surface: string;
  /** The invocation's spellings, the one as typed first. */
  values: readonly string[];
  resultExtras: Record<string, unknown>;
  agentName?: string;
}
