import { existsSync, lstatSync, statSync } from "node:fs";
import { AccessPath } from "#src/access-intent/access-path";
import {
  canonicalNormalizePathForComparison,
  normalizePathForComparison,
  normalizePathPolicyLiteral,
} from "#src/access-intent/path-normalization";
import { classifyToolKind } from "#src/access-intent/tool-kind";
import { deriveApprovalPatterns } from "./approval-pattern";
import { resolveNativeToolTarget } from "./native-tool-target";
import { isPathOutsideWorkingDirectory } from "./path-containment";
import type { PathFlavor } from "./path-flavor";
import {
  type InfrastructureReadScope,
  isPiInfrastructureRead,
} from "./pi-infrastructure-read";

/**
 * The interpreted effect of a literal `cd` target on the effective base, under
 * the host platform's (and, on win32, Git Bash's) semantics.
 *
 * - `absolute` — the target names a resolvable absolute base (`value`); an
 *   earlier unknown base is recovered.
 * - `relative` — the target folds into the current base.
 * - `unknown` — the target is not deterministically resolvable (a win32
 *   non-mount POSIX absolute like `cd /tmp`, or a device), so the base becomes
 *   conservatively unknown.
 */
export type BashCdTarget =
  | { readonly kind: "absolute"; readonly value: string }
  | { readonly kind: "relative" }
  | { readonly kind: "unknown" };

/**
 * Path-interpretation collaborator, constructed once at the session edge with
 * the two ambient inputs — the resolved {@link PathFlavor} and the session
 * `cwd` — baked in, and handed raw path tokens thereafter.
 *
 * The bash path pipeline and the per-tool/external-directory gates ask this
 * object the platform-dependent questions ("is this path absolute *under our
 * flavor*?", "resolve this `cd` offset *against our cwd*") and receive prepared
 * {@link AccessPath} values, instead of reading `process.platform` ambiently or
 * threading `cwd` through every call. All platform semantics live on the
 * injected `flavor`; this class holds no platform discriminator and no
 * `win32`/`posix` branch — it delegates to `flavor` and the flavor-parameterized
 * `path-containment` / `path-normalization` / `AccessPath` primitives.
 */
export class PathNormalizer {
  /** Canonical form of the baked cwd, resolved once (the symlink target is stable per session). */
  private readonly canonicalCwd: string;

  constructor(
    readonly flavor: PathFlavor,
    private readonly cwd: string,
  ) {
    this.canonicalCwd = canonicalNormalizePathForComparison(cwd, cwd, flavor);
  }

  /** Build an AccessPath for a token, resolved against `resolveBase` (default cwd). */
  forPath(pathValue: string, options?: { resolveBase?: string }): AccessPath {
    return AccessPath.forPath(pathValue, {
      cwd: this.cwd,
      resolveBase: options?.resolveBase,
      flavor: this.flavor,
    });
  }

  /**
   * Build an AccessPath for a tool call's path argument.
   *
   * A built-in file tool (`read`/`write`/`edit`/`ls`/`find`/`grep`) resolves
   * the argument through Pi's own resolver, which rewrites some spellings and,
   * for `read`, tries variant spellings that exist; the AccessPath is the file
   * the tool opens ({@link resolveNativeToolTarget}). Every other tool's path
   * is its own to interpret, so it keeps {@link forPath}.
   *
   * The variant probe is `existsSync` (`access(F_OK)`, following symlinks),
   * matching Pi's; unlike {@link entryExists}'s `lstat`, a dangling symlink
   * at the typed spelling does not count, so Pi tries the variants and so do we.
   */
  forToolPath(toolName: string, rawPath: string): AccessPath {
    if (classifyToolKind(toolName) !== "path") return this.forPath(rawPath);
    const native = resolveNativeToolTarget(rawPath, {
      cwd: this.cwd,
      flavor: this.flavor,
      readFallbacks: toolName.trim() === "read",
      exists: (absolutePath) => existsSync(absolutePath),
    });
    return AccessPath.forNativeTarget(native, {
      cwd: this.cwd,
      flavor: this.flavor,
    });
  }

  /** Build a literal-only AccessPath (unknown base after a non-literal `cd`). */
  forLiteral(literal: string): AccessPath {
    return AccessPath.forLiteral(literal);
  }

  /**
   * Build an AccessPath for a bash-command token, applying Git Bash/MSYS
   * semantics on a win32 host.
   *
   * Pi core always executes bash through Git Bash on Windows, so a POSIX-shaped
   * absolute token carries MSYS semantics, not `node:path.win32` semantics. The
   * flavor classifies the token's shape: on win32 the recognized safe device
   * paths (`/dev/null`, `/dev/std{in,out,err}`) are preserved verbatim as
   * devices instead of being resolved into `c:\dev\null`, and MSYS drive mounts
   * (`/c/…`) are translated to their Windows equivalent (`C:\…`) before
   * resolution; every other token delegates to {@link forPath}. On POSIX every
   * token is `plain`, so this is a straight delegation to {@link forPath}.
   */
  forBashToken(token: string, options?: { resolveBase?: string }): AccessPath {
    const shape = this.flavor.bashTokenShape(token);
    switch (shape.kind) {
      case "device":
        return AccessPath.forDevice(token);
      case "drive-mount":
        return this.forPath(shape.windowsPath, options);
      case "posix-absolute":
        // A non-mount POSIX absolute (`/tmp`, `/usr`) has an install-dependent
        // Windows target this package cannot know, so it is kept literal: always
        // external, matched and displayed as typed, never fabricated into
        // `c:\tmp` (#533). The win32 path matcher folds separators on both the
        // rule and the value (#653), so a natural `/tmp/*` rule matches the
        // as-typed literal directly.
        return this.forLiteral(normalizePathPolicyLiteral(token));
      case "plain":
        return this.forPath(token, options);
    }
  }

  /**
   * The session-approval globs for an accessed path, derived through the baked
   * flavor: an existing directory's own scope (itself and its contents), else
   * the enclosing directory's scope plus `*`.
   *
   * Takes the already-built {@link AccessPath} — the lexical form is what a
   * later tool call is matched on, so the patterns must be derived from the
   * same representation the decision displayed (#438). Deriving it here rather
   * than at each gate keeps the platform's separator alphabet with the object
   * that owns the flavor, instead of an ambient `node:path` read (#655).
   */
  approvalPatternsFor(accessPath: AccessPath): readonly string[] {
    return deriveApprovalPatterns(
      accessPath.value(),
      this.flavor,
      this.namesDirectory(accessPath),
    );
  }

  /**
   * Whether an accessed path names an existing directory, so its session grant
   * covers that directory rather than its parent.
   *
   * Uses `stat`, following symlinks: a link to a directory is what `ls` lists.
   * A literal-only path (no canonical form — an unknown base, or a win32
   * non-mount POSIX absolute) is never probed, since `stat` would resolve it
   * against the process cwd or a fabricated drive. Any error answers `false`,
   * which keeps the parent-directory grant callers had before this probe.
   */
  private namesDirectory(accessPath: AccessPath): boolean {
    if (!accessPath.boundaryValue()) return false;
    try {
      return statSync(accessPath.value()).isDirectory();
    } catch {
      return false;
    }
  }

  /** Platform-aware absoluteness (`win32` vs `posix` rules). */
  isAbsolute(pathValue: string): boolean {
    return this.flavor.impl.isAbsolute(pathValue);
  }

  /**
   * Interpret a literal `cd` target's effect on the effective base.
   *
   * On win32 the target carries Git Bash/MSYS semantics: a drive mount
   * (`cd /c/x`) resolves to a translated Windows base (`C:\x`), a non-mount
   * POSIX absolute (`cd /tmp`) is not deterministically resolvable and yields an
   * `unknown` base, and a native/relative target is handled as usual. On POSIX
   * every token is `plain`, so an absolute target is absolute and everything
   * else is relative.
   */
  interpretBashCdTarget(target: string): BashCdTarget {
    const shape = this.flavor.bashTokenShape(target);
    switch (shape.kind) {
      case "drive-mount":
        return { kind: "absolute", value: shape.windowsPath };
      case "device":
      case "posix-absolute":
        return { kind: "unknown" };
      case "plain":
        return this.flavor.impl.isAbsolute(target)
          ? { kind: "absolute", value: target }
          : { kind: "relative" };
    }
  }

  /** Resolve a `cd`-folded offset against the baked cwd (platform-aware). */
  resolveBase(offset: string): string {
    return this.flavor.impl.resolve(this.cwd, offset);
  }

  /** Join a `cd` offset with a relative target (platform-aware), for cd-folding. */
  joinBase(offset: string, target: string): string {
    return this.flavor.impl.join(offset, target);
  }

  /** Containment of `pathValue` within `directory` (platform-aware). */
  isWithinDirectory(pathValue: string, directory: string): boolean {
    return this.flavor.isWithin(pathValue, directory);
  }

  /**
   * Outside-cwd test for an already-canonical boundary value (from
   * {@link AccessPath.boundaryValue}), against the baked cwd.
   *
   * It does not re-derive the canonical form — the caller passes a value the
   * {@link AccessPath} already canonicalized, so a device's preserved
   * `/dev/null` reaches the pure check's `isSafeSystemPath` exclusion intact.
   */
  isBoundaryOutsideWorkingDirectory(canonicalPath: string): boolean {
    return isPathOutsideWorkingDirectory(
      canonicalPath,
      this.canonicalCwd,
      this.flavor,
    );
  }

  /**
   * Lexical (not symlink-resolved) comparison value, resolved against the baked
   * cwd. Mirrors the as-typed absolute form used for skill-prompt matching;
   * touches no filesystem, unlike {@link forPath}'s canonical alias.
   */
  comparableValue(pathValue: string): string {
    return normalizePathForComparison(pathValue, this.cwd, this.flavor);
  }

  /**
   * Pi infrastructure-read containment for a read-only tool, decided against
   * the canonical (symlink-resolved) path and the baked cwd/flavor. Takes the
   * already-built {@link AccessPath} so the caller does not re-resolve it.
   */
  isInfrastructureRead(
    toolName: string,
    accessPath: AccessPath,
    scope: InfrastructureReadScope,
  ): boolean {
    return isPiInfrastructureRead(
      toolName,
      accessPath.boundaryValue(),
      scope.dirs,
      this.cwd,
      this.flavor,
      scope.excludedDirs,
    );
  }

  /**
   * True when `absolutePath` names an existing filesystem entry.
   *
   * The existence probe that resolves an *unknown* bash token: a bare word is a
   * path candidate iff it names something real (ADR 0009, #645). Uses `lstat`,
   * not `stat`, so a symlink counts as an entry even when its target is
   * dangling — the link is the operand the command names, and dropping it would
   * reopen the bypass this probe closes.
   *
   * Any error (ENOENT, ENOTDIR, EACCES, ELOOP) answers `false`: an entry the
   * gate cannot confirm is not promoted, leaving the token exactly as
   * unrestricted as it is today.
   *
   * Lives here beside {@link forPath}'s canonicalization so the package keeps a
   * single filesystem edge for path interpretation.
   */
  entryExists(absolutePath: string): boolean {
    if (!absolutePath) return false;
    try {
      lstatSync(absolutePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * True when nothing exists along an accessed path below the filesystem root:
   * the first entry `lstat` finds, walking its canonical form toward the root,
   * is the root itself. The nothing-on-disk delegation license is built from
   * this answer (ADR 0007 §8).
   *
   * A literal-only path has no canonical form to probe, and the root itself
   * exists, so both answer `false`.
   * Only "no such entry" continues the walk; any other error answers `false`,
   * so an entry the probe cannot see past never counts as absent.
   */
  namesNothingBelowRoot(accessPath: AccessPath): boolean {
    const canonical = accessPath.boundaryValue();
    if (!canonical) return false;
    const impl = this.flavor.impl;
    // The root itself exists, so a path that is the root names something.
    if (impl.dirname(canonical) === canonical) return false;
    for (
      let current = canonical, parent = impl.dirname(current);
      parent !== current;
      current = parent, parent = impl.dirname(current)
    ) {
      if (!isAbsentEntry(current)) return false;
    }
    return true;
  }
}

/** True only when `lstat` reports that no entry exists at `absolutePath`. */
function isAbsentEntry(absolutePath: string): boolean {
  try {
    lstatSync(absolutePath);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT";
  }
}
