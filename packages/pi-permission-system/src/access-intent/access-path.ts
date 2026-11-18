import { canonicalizePath } from "#src/path/canonicalize-path";
import type { NativeToolTarget } from "#src/path/native-tool-target";
import type { PathFlavor } from "#src/path/path-flavor";

import {
  canonicalNormalizePathForComparison,
  cwdRelativePolicyValues,
  getPathPolicyValues,
  normalizePathForComparison,
} from "./path-normalization";

/**
 * A path's two representations held behind type-distinct accessors.
 *
 * A single `string` carrying both meanings was the root cause of [#418]:
 * both external-directory gates matched config patterns against the
 * symlink-resolved (canonical) path instead of the typed (lexical) path,
 * defeating a configured `/tmp/*` allow.
 *
 * `AccessPath` makes the misuse a compile error:
 * - {@link matchValues} returns `string[]` — the lexical alias union ∪ canonical,
 *   for `external_directory` pattern matching.
 * - {@link boundaryValue} returns `string` — the canonical form, for
 *   outside-CWD containment and infra-read checks.
 * - {@link value} returns `string` — the lexical absolute form, for display,
 *   approval patterns, decision values, and logs.
 * - {@link resolvedAlias} returns `string | undefined` — the canonical form
 *   only when it names a location distinct from the lexical form, for
 *   disclosing a symlink target in a prompt or denial message.
 *
 * Construct via {@link forPath} (resolved, with optional cd-folded base),
 * {@link forNativeTarget} (the file a built-in Pi tool opens), or
 * {@link forLiteral} (literal-only, for an unknown base); the constructor is
 * private.
 */
export class AccessPath {
  private constructor(
    private readonly lexical: string,
    private readonly matchAliases: readonly string[],
    private readonly canonical: string,
    private readonly rewritten = false,
  ) {}

  /**
   * Pattern-match values for the `external_directory` surface: the lexical
   * alias union plus the canonical alias, so a config pattern on either the
   * typed form (`/tmp/*`) or the symlink-resolved form (`/private/tmp/*`)
   * matches (#418). On POSIX the canonical alias is also the spelling the
   * filesystem stores, so a pattern on `Upper.txt` matches a typed `upper.txt`
   * that APFS opens as that file.
   *
   * Collapses to the lexical aliases when the canonical equals one of them
   * (e.g. when the path is not a symlink).
   */
  matchValues(): string[] {
    return this.canonical
      ? [...new Set([...this.matchAliases, this.canonical])]
      : [...this.matchAliases];
  }

  /**
   * Canonical (symlink-resolved, on-disk-spelled on POSIX, win32-lowercased)
   * form, for the outside-CWD
   * boundary decision and Pi infrastructure-read containment checks.
   *
   * Returns `""` when the path could not be resolved (empty input).
   */
  boundaryValue(): string {
    return this.canonical;
  }

  /**
   * Lexical (as-typed, normalized but not symlink-resolved) form, for display,
   * approval patterns, decision values, and log messages.
   *
   * Returns `""` for empty input.
   */
  value(): string {
    return this.lexical;
  }

  /**
   * The location the access reaches when it differs from what was typed — for
   * disclosing it in a prompt or denial message: the canonical
   * (symlink-resolved) form when it is distinct from the lexical form, else the
   * lexical form itself when a built-in tool's resolver rewrote the typed
   * spelling ({@link forNativeTarget}). `undefined` otherwise.
   */
  resolvedAlias(): string | undefined {
    if (this.canonical && this.canonical !== this.lexical) {
      return this.canonical;
    }
    return this.rewritten ? this.lexical : undefined;
  }

  /**
   * Build an `AccessPath` for a tool-input or bash-token path, resolved against
   * `resolveBase` (the cd-folded effective directory; defaults to `cwd`).
   *
   * Serves every path surface: the tool path gate, the tool external-directory
   * gate, and the bash path/external-directory gates (which pass a cd-resolved
   * `resolveBase`).
   *
   * - `matchValues()` returns the lexical alias union from `getPathPolicyValues`
   *   plus the canonical alias from `canonicalNormalizePathForComparison`
   *   (#418), so a config pattern on either the typed or symlink-resolved form
   *   matches.
   * - `boundaryValue()` returns
   *   `canonicalNormalizePathForComparison(pathValue, resolveBase)`, which is
   *   win32-lowercased (#382) — do not substitute a raw `canonicalizePath`
   *   output here.
   * - `value()` returns `normalizePathForComparison(pathValue, resolveBase)`,
   *   the absolute lexical form.
   */
  static forPath(
    pathValue: string,
    options: { cwd: string; resolveBase?: string; flavor: PathFlavor },
  ): AccessPath {
    const { cwd, resolveBase = cwd, flavor } = options;
    return new AccessPath(
      normalizePathForComparison(pathValue, resolveBase, flavor),
      getPathPolicyValues(pathValue, { cwd, resolveBase }, flavor),
      canonicalNormalizePathForComparison(pathValue, resolveBase, flavor),
    );
  }

  /**
   * Build an `AccessPath` for the file a built-in Pi file tool opens, from its
   * already-resolved {@link NativeToolTarget}.
   *
   * The target is taken as the tool will open it: no literal cleanup (trim,
   * quote strip, `$HOME`), since Pi's resolver applies none. `matchValues()`
   * is the target, its cwd-relative alias, and the tool's relative spelling,
   * plus the canonical form — the same array {@link forPath} builds for a
   * relative or already-normalized spelling the tool does not rewrite. An
   * absolute spelling with `..` or doubled separators keeps no as-typed alias:
   * `/tmp/../etc/passwd` matches as `/etc/passwd`, the file opened, so a rule
   * on `/tmp/*` no longer covers it.
   */
  static forNativeTarget(
    native: NativeToolTarget,
    options: { cwd: string; flavor: PathFlavor },
  ): AccessPath {
    const { cwd, flavor } = options;
    const lexical = flavor.comparable(native.target, cwd);
    const aliases = [
      lexical,
      ...cwdRelativePolicyValues(lexical, cwd, flavor),
      ...(native.relativeSpelling ? [native.relativeSpelling] : []),
    ];
    return new AccessPath(
      lexical,
      [...new Set(aliases)],
      flavor.fold(canonicalizePath(lexical, flavor)),
      native.rewritten,
    );
  }

  /**
   * Build a literal-only `AccessPath` for a path whose effective base is
   * unknown (a relative bash token after a non-literal `cd`).
   *
   * Carries no canonical alias and no absolute resolution — `matchValues()` is
   * `[literal]` (or `[]` when empty) and `boundaryValue()` is `""` — so no
   * spurious absolute or symlink-resolved rule can match (#393).
   */
  static forLiteral(literal: string): AccessPath {
    if (!literal) return new AccessPath("", [], "");
    return new AccessPath(literal, [literal], "");
  }

  /**
   * Build an `AccessPath` for a Git Bash/MSYS device path (`/dev/null`,
   * `/dev/std{in,out,err}`) seen in a bash command on a win32 host.
   *
   * The token names an MSYS runtime device, not a filesystem path, so it is
   * preserved verbatim across all three representations — `value()`,
   * `boundaryValue()`, and `matchValues()` are the device path itself, never
   * `win32.resolve`-mangled into `c:\dev\null`. The identical lexical and
   * canonical forms let the boundary check reach `isSafeSystemPath` (so the
   * device never triggers `external_directory`) while a config rule still
   * matches the path as typed.
   */
  static forDevice(devicePath: string): AccessPath {
    return new AccessPath(devicePath, [devicePath], devicePath);
  }
}
