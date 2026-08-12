/**
 * The bounded-delegation enforcement checkpoint (ADR 0007 §5).
 *
 * The chain owner caps every registered link's verdict so a buggy or over-eager
 * external judge can never exceed the operator's policy: a link's `allow` on an
 * excluded surface is downgraded to `defer`, letting the `ask` fall through to
 * the terminal (a prompt) instead. The checkpoint only ever *tightens* a
 * verdict — it never turns a `defer`/`deny` into an `allow`.
 *
 * The excluded set is the whole `path` surface plus `external_directory`. A
 * finer secret-shaped-`path` exclusion (letting a link allow a non-secret path)
 * is deferred to the allow-capable slice that needs it (#620); until then the
 * conservative whole-surface exclusion ships. The checkpoint is dormant while
 * the only registered links are deny-first (they never `allow`).
 *
 * Operators may opt in to relaxing the `external_directory` exclusion via
 * `allowAuthorizerOnExternalDirectory` (default `false`). When enabled, a link
 * may grant `allow` on `external_directory` (enabling an LLM auto-review of
 * outside-CWD access), but `path` stays excluded so secret-shaped paths remain
 * protected. The default keeps the conservative whole-surface exclusion.
 */

import type { Authorizer } from "./authorizer";
import type { PromptPermissionDetails } from "./permission-prompter";

/** Surfaces on which a link may never grant an `allow` (ADR 0007 §5). */
export const DELEGATION_EXCLUDED_SURFACES: ReadonlySet<string> = new Set([
  "external_directory",
  "path",
]);

/** The conservative default excluded set (both surfaces). */
export const DELEGATION_EXCLUDED_SURFACES_WITH_EXTERNAL: ReadonlySet<string> =
  DELEGATION_EXCLUDED_SURFACES;

/** The relaxed excluded set when `external_directory` is delegated (path only). */
export const DELEGATION_EXCLUDED_SURFACES_EXTERNAL_OPT_IN: ReadonlySet<string> =
  new Set(["path"]);

/**
 * Wrap a link's `authorize` so an `allow` on an excluded surface is capped to
 * `defer`. All other verdicts, and `allow`s on non-excluded surfaces, pass
 * through unchanged. `details`, the injected `query`, and the review-log `log`
 * are forwarded as-is.
 *
 * @param allowAuthorizerOnExternalDirectory When true, `external_directory` is
 *   removed from the excluded set so a link may grant `allow` on it; `path`
 *   stays excluded regardless. Defaults to false (conservative).
 */
export function encloseInDelegationEnvelope(
  authorize: Authorizer["authorize"],
  allowAuthorizerOnExternalDirectory = false,
): Authorizer["authorize"] {
  const excluded = allowAuthorizerOnExternalDirectory
    ? DELEGATION_EXCLUDED_SURFACES_EXTERNAL_OPT_IN
    : DELEGATION_EXCLUDED_SURFACES_WITH_EXTERNAL;
  return async (details, query, log) => {
    const verdict = await authorize(details, query, log);
    if (verdict.kind === "allow" && isExcludedSurface(details, excluded)) {
      return { kind: "defer" };
    }
    return verdict;
  };
}

/**
 * Whether the ask's surface is excluded from link grants. Reads the
 * gate-authoritative `accessIntent.surface`, falling back to the display
 * `surface`. Fail-safe: an ask whose surface cannot be determined is treated as
 * excluded (more prompting, never less — ADR 0007 invariant 2).
 */
function isExcludedSurface(
  details: PromptPermissionDetails,
  excluded: ReadonlySet<string>,
): boolean {
  const surface = details.accessIntent?.surface ?? details.surface ?? undefined;
  return surface === undefined || excluded.has(surface);
}
