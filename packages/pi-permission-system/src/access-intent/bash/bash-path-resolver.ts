import type { AccessPath } from "#src/access-intent/access-path";
import {
  mergeTokenEffects,
  type TokenEffect,
  UNPROVEN_EFFECT,
} from "#src/access-intent/effect";
import { normalizePathPolicyLiteral } from "#src/access-intent/path-normalization";
import type { PathNormalizer } from "#src/path-normalizer";
import { isSafeSystemPath } from "#src/safe-system-paths";
import { ARG_NODE_TYPES, SKIP_SUBTREE_TYPES } from "./node-text";
import type { TSNode } from "./parser";
import {
  classifyBareTokenCandidate,
  classifyTokenAsPathCandidate,
  classifyTokenAsRuleCandidate,
} from "./token-classification";
import {
  collectCommandTokens,
  collectPathCandidateTokens,
  collectRedirectTokens,
  extractCommandName,
  type PathToken,
} from "./token-collection";

// ── Internal types ───────────────────────────────────────────────────────────

/**
 * The working directory in force where a path candidate appears.
 *
 * A `known` base carries an `offset` to be joined with `cwd` at resolution
 * time: a relative-or-absolute path string built by folding the literal targets
 * of current-shell `cd` commands (`""` = `cwd`); an absolute offset (from
 * `cd /abs`) ignores `cwd` at resolution time.
 * An `unknown` base marks a non-literal `cd` target (`cd "$DIR"`, `cd $(…)`,
 * `cd -`, bare `cd`, `cd ~…`) that made the effective directory unresolvable.
 */
type EffectiveBase =
  | { readonly kind: "known"; readonly offset: string }
  | { readonly kind: "unknown" };

/**
 * A path-candidate token paired with the effective working directory projected
 * onto the point in the command stream where it appears, and the effect its
 * position proved.
 */
interface PathCandidate {
  readonly token: string;
  readonly base: EffectiveBase;
  readonly effect: TokenEffect;
}

/** A promoted bare token and its resolved path, before an effect is attached. */
interface ProbedToken {
  readonly token: string;
  readonly path: AccessPath;
}

// ── Public output types ──────────────────────────────────────────────────────

export interface BashPathRuleCandidate {
  /** Raw path-like token shown in prompts, logs, and session approvals. */
  readonly token: string;
  /** The path's lexical and canonical forms for permission policy matching. */
  readonly path: AccessPath;
  /** The attributed effect that routes the token to a directional surface. */
  readonly effect: TokenEffect;
}

/** A path resolving outside the working directory, with its attributed effect. */
export interface BashExternalPath {
  readonly path: AccessPath;
  readonly effect: TokenEffect;
}

/**
 * The filesystem paths a bash program references, resolved against the working
 * directory and platform — the two typed slices {@link BashProgram} exposes.
 */
export interface ResolvedBashPaths {
  /** Deduplicated accesses resolving outside the working directory (#418). */
  readonly externalAccesses: readonly BashExternalPath[];
  /** Every path-rule token paired with its cd-aware policy values (#393). */
  readonly ruleCandidates: readonly BashPathRuleCandidate[];
}

// ── Walk-time constants ──────────────────────────────────────────────────────

/** The working directory in force at the start of a program (`cwd`). */
const CWD_BASE: EffectiveBase = { kind: "known", offset: "" };

/** The effective directory after a non-literal or unresolvable `cd`. */
const UNKNOWN_BASE: EffectiveBase = { kind: "unknown" };

/**
 * Resolves the filesystem paths a parsed bash program references.
 *
 * Holds a {@link PathNormalizer} (platform + cwd baked in) as its primary
 * collaborator and answers all platform/cwd-dependent questions through it —
 * `cd`-base folding (`isAbsolute`/`joinBase`), per-candidate resolution
 * (`forPath`/`forLiteral`/`resolveBase`), and the outside-cwd boundary
 * decision — so no walk step re-reads the platform or threads the cwd.
 *
 * A bare token that fails both shape gates is admitted when the normalizer's
 * existence probe says it names a real filesystem entry (ADR 0009, #645). The
 * resolver consults no ruleset: candidacy is a filesystem question, and the
 * policy decision belongs to the gates downstream.
 *
 * Tell-don't-ask: callers hand it a parsed tree and receive the resolved
 * {@link ResolvedBashPaths} slices in one {@link resolve} call; the AST walk,
 * the `cd`-folding state, and the intermediate path candidates stay private.
 * One instance per parse ({@link BashProgram.parse} constructs it with the
 * session normalizer).
 */
export class BashPathResolver {
  constructor(
    private readonly normalizer: PathNormalizer,
    private readonly workdir?: string,
  ) {}

  /**
   * Resolve a parsed bash program's path references into its external-path and
   * rule-candidate slices, walking the AST exactly once.
   *
   * When a `workdir` is set (an aliased shell tool's working directory, #574),
   * it seeds the initial effective base — as if the program were prefixed with
   * `cd <workdir>` — so relative tokens resolve against it, and the `workdir`
   * itself is added to the external paths when it resolves outside the cwd.
   * Containment is always measured against the session cwd baked into the
   * normalizer, so a `workdir` outside the cwd does not widen the sandbox.
   */
  resolve(rootNode: TSNode): ResolvedBashPaths {
    const initialBase =
      this.workdir === undefined
        ? CWD_BASE
        : this.deriveBaseFromCdTarget(CWD_BASE, this.workdir);
    const candidates = this.collectPathCandidates(rootNode, initialBase);
    return {
      externalAccesses: this.withWorkdirExternal(
        this.projectExternalPaths(candidates),
      ),
      ruleCandidates: this.projectRuleCandidates(candidates),
    };
  }

  /**
   * Prepend the `workdir`'s own {@link AccessPath} to the external paths when it
   * resolves outside the cwd. A real `cd /etc` flags `/etc` via its argument
   * token; the seeded base carries no such token, so it is added explicitly and
   * deduplicated against the command's own external tokens (#574).
   *
   * It carries {@link UNPROVEN_EFFECT}: no command word was observed for it and
   * no redirect proved it. When the command's own tokens already named it, the
   * token's attribution stands — an implicit base is not evidence against a
   * proof.
   */
  private withWorkdirExternal(
    tokenExternals: readonly BashExternalPath[],
  ): BashExternalPath[] {
    if (this.workdir === undefined) return [...tokenExternals];
    const wdPath = this.normalizer.forBashToken(this.workdir);
    const canonical = wdPath.boundaryValue();
    const isExternal = canonical
      ? this.normalizer.isBoundaryOutsideWorkingDirectory(canonical)
      : true;
    if (!isExternal) return [...tokenExternals];
    const key = canonical || wdPath.value();
    const alreadyPresent = tokenExternals.some(
      ({ path }) => (path.boundaryValue() || path.value()) === key,
    );
    return alreadyPresent
      ? [...tokenExternals]
      : [{ path: wdPath, effect: UNPROVEN_EFFECT }, ...tokenExternals];
  }

  // ── AST walk — collect PathCandidates ──────────────────────────────────

  /**
   * Walk the AST once, collecting every path-candidate token tagged with the
   * effective working directory projected onto its position.
   *
   * The effective directory is stateful: it starts at `cwd` and each
   * current-shell `cd <literal>` (joined by `&&`, `||`, `;`, or a newline)
   * folds into it for subsequent commands.
   * A `cd` inside a pipeline or a backgrounded command runs in a subshell and
   * does not update the running directory; subshell and brace-group interiors
   * inherit the enclosing base without folding their own `cd`s (a conservative
   * first tier).
   */
  private collectPathCandidates(
    rootNode: TSNode,
    initialBase: EffectiveBase,
  ): PathCandidate[] {
    const out: PathCandidate[] = [];
    this.walkForCandidates(rootNode, initialBase, out);
    return out;
  }

  /**
   * Collect a single node's candidates tagged with `base`, returning the
   * effective base in force *after* the node (the input base unless the node is
   * a current-shell `cd <literal>` that folds the running directory).
   */
  private walkForCandidates(
    node: TSNode,
    base: EffectiveBase,
    out: PathCandidate[],
  ): EffectiveBase {
    switch (node.type) {
      case "program":
      case "list":
      case "redirected_statement":
        return this.walkCurrentShellSequence(node, base, out);
      case "command":
        tagTokens(collectCommandTokens(node), base, out);
        return this.foldCd(node, base);
      case "pipeline":
        // tree-sitter-bash mis-groups a redirect-bearing `&&`/`;` list as the
        // first stage of a pipeline (`cd a && pnpm x 2>&1 | tail` parses as
        // `(cd a && pnpm x 2>&1) | tail`), burying a current-shell `cd` inside
        // a node the `default` case treats as non-folding. Recover bash operator
        // precedence (`|` binds tighter than `&&`/`||`/`;`): fold the first
        // stage's leading current-shell commands while keeping its terminal
        // command and every downstream stage as non-folding subshells (#454).
        return this.walkPipeline(node, base, out);
      case "subshell":
        // A subshell runs in a child shell: its interior `cd`s fold within the
        // subshell but reset on exit, so the folded base is discarded.
        this.walkCurrentShellSequence(node, base, out);
        return base;
      case "compound_statement":
        // A `{ … }` brace group runs in the current shell, so its `cd`s persist
        // to following commands — thread and return the folded base.
        return this.walkCurrentShellSequence(node, base, out);
      default:
        // Pipelines, control-flow bodies, redirect targets, and command/process
        // substitution interiors: collect every candidate in the subtree tagged
        // with the enclosing base and do not fold their internal `cd`s. (Folding
        // inside substitutions is deferred — conservative, never under-flags.)
        tagTokens(collectPathCandidateTokens(node), base, out);
        return base;
    }
  }

  /**
   * Fold a current-shell sequence (`program` / `list` / `redirected_statement`):
   * thread the effective base left-to-right through the children so a `cd`
   * updates the base for following siblings.
   * A statement immediately followed by the background operator (`&`) runs in a
   * subshell, so its folded base is discarded.
   */
  private walkCurrentShellSequence(
    seqNode: TSNode,
    base: EffectiveBase,
    out: PathCandidate[],
  ): EffectiveBase {
    let current = base;
    for (let i = 0; i < seqNode.childCount; i++) {
      const child = seqNode.child(i);
      if (!child?.isNamed) continue;
      if (SKIP_SUBTREE_TYPES.has(child.type)) continue;
      const after = this.walkForCandidates(child, current, out);
      current = isBackgrounded(seqNode, i) ? current : after;
    }
    return current;
  }

  /**
   * Walk a `pipeline` node, returning the effective base in force after it.
   *
   * Each stage of a true pipeline (`A | B | C`) runs in a subshell, so a `cd`
   * inside any stage must not leak — the base normally passes through unchanged.
   * The exception is the first stage: tree-sitter-bash wraps a redirect-bearing
   * current-shell `&&`/`;` list (`cd a && pnpm x 2>&1 | tail`) as that stage,
   * and bash precedence makes the list's leading commands current-shell, so they
   * fold and the folded base persists past the pipeline to following siblings.
   *
   * The terminal command of the first stage is the real pipe stage (a subshell)
   * and must not fold; every stage after a `|` is a downstream subshell stage
   * and collects tokens against the folded base without folding (#454).
   */
  private walkPipeline(
    node: TSNode,
    base: EffectiveBase,
    out: PathCandidate[],
  ): EffectiveBase {
    let current = base;
    let first = true;
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (!child?.isNamed) continue;
      if (SKIP_SUBTREE_TYPES.has(child.type)) continue;
      if (first) {
        current = this.foldPipelineFirstStage(child, current, out);
        first = false;
        continue;
      }
      // Downstream stage (after a `|`): subshell — collect against the folded
      // base, do not fold.
      tagTokens(collectPathCandidateTokens(child), current, out);
    }
    return current;
  }

  /**
   * Collect the first pipe stage's candidates, folding its leading current-shell
   * `cd` commands when tree-sitter wrapped a `list` or `redirected_statement`
   * around them.
   * The terminal command of that container is the real pipe stage (a subshell)
   * and is collected without folding.
   * A bare `command` first stage (a true pipeline first stage such as
   * `cd nested | cat ../b`) is a subshell: it collects against the input base
   * and does not fold.
   */
  private foldPipelineFirstStage(
    node: TSNode,
    base: EffectiveBase,
    out: PathCandidate[],
  ): EffectiveBase {
    if (node.type === "list")
      return this.foldListExceptTerminal(node, base, out);
    if (node.type === "redirected_statement") {
      let current = base;
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child?.isNamed) continue;
        if (child.type === "file_redirect") {
          // Redirect destinations are part of the piped stage; collect them
          // against the folded base without folding.
          tagTokens(collectRedirectTokens(child), current, out);
          continue;
        }
        // The inner statement is the `list`/`command` being redirected; fold its
        // leading current-shell commands via the terminal-excluding walk.
        current = this.foldPipelineFirstStage(child, current, out);
      }
      return current;
    }
    // Bare `command` or any other shape: a true subshell first stage.
    tagTokens(collectPathCandidateTokens(node), base, out);
    return base;
  }

  /**
   * Fold every named, non-skip child of a `list` except the last, threading the
   * effective base left-to-right through the leading current-shell commands; the
   * terminal child is the real pipe stage and is collected without folding.
   */
  private foldListExceptTerminal(
    node: TSNode,
    base: EffectiveBase,
    out: PathCandidate[],
  ): EffectiveBase {
    const namedChildren: TSNode[] = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child?.isNamed && !SKIP_SUBTREE_TYPES.has(child.type)) {
        namedChildren.push(child);
      }
    }
    let current = base;
    for (let i = 0; i < namedChildren.length; i++) {
      const child = namedChildren[i];
      if (i < namedChildren.length - 1) {
        current = this.walkForCandidates(child, current, out);
      } else {
        // Terminal child = the real pipe stage; collect without folding.
        tagTokens(collectPathCandidateTokens(child), current, out);
      }
    }
    return current;
  }

  /**
   * Compute the effective base after a command runs.
   * Returns `base` unchanged unless the command is `cd`:
   *
   * - `cd /abs` (absolute literal) → a fresh known base, recovering from an
   *   earlier unknown base. On win32 a drive-mount target (`cd /c/x`) folds to
   *   its translated Windows base, while a non-mount POSIX absolute
   *   (`cd /tmp`) is not deterministically resolvable and yields unknown (#533).
   * - `cd rel` (relative literal) → fold into a known base, or stay unknown if
   *   the base was already unknown.
   * - `cd "$DIR"` / `cd $(…)` / `cd -` / bare `cd` / `cd ~…` (non-literal) →
   *   unknown.
   *
   * The target's platform/MSYS interpretation is delegated to the
   * {@link PathNormalizer}; this method owns only the base-folding state.
   */
  private foldCd(commandNode: TSNode, base: EffectiveBase): EffectiveBase {
    if (extractCommandName(commandNode) !== "cd") return base;
    const target = cdLiteralTarget(commandNode);
    if (target === null) return UNKNOWN_BASE;
    return this.deriveBaseFromCdTarget(base, target);
  }

  /**
   * Fold a literal `cd`/working-directory target string into the effective
   * base, delegating the platform/MSYS interpretation to the
   * {@link PathNormalizer}. Owns only the base-folding state:
   *
   * - `absolute` → a fresh known base (recovers from an earlier unknown base).
   * - `unknown` → the base becomes conservatively unknown.
   * - `relative` → join into a known base, or stay unknown if already unknown.
   *
   * Shared by {@link foldCd} (inline `cd` commands) and the initial-base seed
   * (an aliased shell tool's `workdir`, an implicit leading `cd <workdir>`).
   */
  private deriveBaseFromCdTarget(
    base: EffectiveBase,
    target: string,
  ): EffectiveBase {
    const interpreted = this.normalizer.interpretBashCdTarget(target);
    switch (interpreted.kind) {
      case "absolute":
        return { kind: "known", offset: interpreted.value };
      case "unknown":
        return UNKNOWN_BASE;
      case "relative":
        if (base.kind === "unknown") return UNKNOWN_BASE;
        return {
          kind: "known",
          offset: this.normalizer.joinBase(base.offset, target),
        };
    }
  }

  // ── Projection ─────────────────────────────────────────────────────────

  /**
   * Project the collected candidates into deduplicated external paths.
   *
   * Filters candidates through the strict path classifier
   * (`classifyTokenAsPathCandidate`), resolves each against its effective working
   * directory base, and returns only paths that resolve outside the baked cwd in
   * their lexical (as-typed, normalized but not symlink-resolved) form.
   *
   * The outside-cwd decision and the dedup identity use the canonical
   * (symlink-resolved) form so `external_directory` config patterns match the
   * path as the user typed it (#418).
   */
  private projectExternalPaths(
    candidates: readonly PathCandidate[],
  ): BashExternalPath[] {
    const seen = new Map<string, number>();
    const externalPaths: BashExternalPath[] = [];

    for (const { token, base, effect } of candidates) {
      const candidate = classifyTokenAsPathCandidate(token);
      if (!candidate) {
        // A bare token the strict shape gate rejects can still escape the tree
        // through a symlink, so probe it and apply the ordinary boundary
        // decision to whatever it resolves to (#645).
        const probed = this.probeBareToken(token, base);
        if (probed) {
          this.collectIfExternal(probed.path, effect, seen, externalPaths);
        }
        continue;
      }

      // Unknown effective directory: a relative candidate could resolve
      // anywhere, so flag it conservatively (resolved against the baked cwd
      // only for a display path). Absolute / `~` candidates are base-independent
      // below.
      if (base.kind === "unknown" && this.isRelativeCandidate(candidate)) {
        const accessPath = this.normalizer.forPath(candidate);
        const canonical = accessPath.boundaryValue();
        if (canonical && !isSafeSystemPath(canonical)) {
          recordExternal(accessPath, effect, canonical, seen, externalPaths);
        }
        continue;
      }

      const resolveBase =
        base.kind === "known"
          ? this.normalizer.resolveBase(base.offset)
          : undefined;
      this.collectIfExternal(
        this.normalizer.forBashToken(candidate, { resolveBase }),
        effect,
        seen,
        externalPaths,
      );
    }

    return externalPaths;
  }

  /**
   * Record `accessPath` when it resolves outside the working directory and has
   * not already been collected.
   *
   * The boundary decision and dedup identity use the canonical
   * (symlink-resolved) form the {@link AccessPath} already derived, while the
   * stored value keeps the lexical form so config patterns match the path as
   * the user typed it (#418). A win32 device path preserves `/dev/null` as its
   * boundary value, so `isBoundaryOutsideWorkingDirectory` reaches the
   * safe-path exclusion (#533).
   *
   * A literal-only bash token (a win32 non-mount POSIX absolute like `/tmp`)
   * has no canonical form; it is foreign to the win32 cwd, so it is always
   * external. Its lexical value is the dedup identity so two distinct
   * literal-only paths do not collapse (#533).
   */
  private collectIfExternal(
    accessPath: AccessPath,
    effect: TokenEffect,
    seen: Map<string, number>,
    out: BashExternalPath[],
  ): void {
    const lexical = accessPath.value();
    if (!lexical) return;
    const canonical = accessPath.boundaryValue();
    const isExternal = canonical
      ? this.normalizer.isBoundaryOutsideWorkingDirectory(canonical)
      : true;
    if (!isExternal) return;
    recordExternal(accessPath, effect, canonical || lexical, seen, out);
  }

  /**
   * Project the collected candidates into rule candidates with their cd-aware
   * policy lookup values.
   *
   * Filters candidates through the broad path classifier
   * (`classifyTokenAsRuleCandidate`), falling back to {@link probeBareToken}
   * for a bare token the broad classifier rejects for shape — admitted only
   * when it names an existing filesystem entry (#645).
   * On win32 the broad classifier is told to treat a backslash as a path
   * separator, so a backslash-relative token (`dir\file`) is recognized as a
   * rule candidate the same as its forward-slash equivalent (#520); on POSIX
   * `\` is a legal filename character, so the token stays bare there.
   * Pairs each qualifying token with its set of policy values (absolute +
   * project-relative + raw).
   * A token after a non-literal `cd` keeps only its literal value so no
   * spurious absolute rule can match (#393).
   */
  private projectRuleCandidates(
    candidates: readonly PathCandidate[],
  ): BashPathRuleCandidate[] {
    const seen = new Map<string, number>();
    const result: BashPathRuleCandidate[] = [];

    for (const { token, base, effect } of candidates) {
      const shaped = classifyTokenAsRuleCandidate(
        token,
        this.normalizer.flavor,
      );
      const probed =
        shaped === null
          ? this.probeBareToken(token, base)
          : { token: shaped, path: this.buildRuleCandidatePath(shaped, base) };
      if (!probed) continue;

      const matchValues = probed.path.matchValues();
      if (matchValues.length === 0) continue;

      const key = matchValues.join("\0");
      const index = seen.get(key);
      if (index !== undefined) {
        // The same resolved path, reached again with its own attribution: fold
        // rather than split, so `cat ~/a > ~/a` stays one entry in the prompt's
        // evidence and two disagreeing proofs land on the bare family.
        const existing = result[index];
        result[index] = {
          ...existing,
          effect: mergeTokenEffects(existing.effect, effect),
        };
        continue;
      }
      seen.set(key, result.length);
      result.push({ ...probed, effect });
    }

    return result;
  }

  /**
   * Promote a bare token the shape gates rejected, when it names an existing
   * filesystem entry — the existence probe (ADR 0009, #645).
   *
   * Most bash argument tokens are not paths (`status`, `build`, `main`), so a
   * bare token is admitted only when the filesystem confirms it names something
   * real. Candidacy therefore comes from the filesystem and never from the
   * ruleset, which keeps the classifiers pure and lets a symlink be matched by
   * rules naming its *target* — the case raw-token matching could not see.
   *
   * Returns `null` when the token's shape rules out a path, when the effective
   * base is unknown (no concrete directory to resolve against, so the token
   * stays unpromoted per #393 conservatism), or when nothing exists at the
   * resolved location.
   *
   * Shared by both projections so a promoted token is identical whether it is
   * being matched against `path` rules or tested against the cwd boundary.
   */
  private probeBareToken(
    token: string,
    base: EffectiveBase,
  ): ProbedToken | null {
    const bare = classifyBareTokenCandidate(token);
    if (bare === null) return null;
    if (base.kind !== "known") return null;

    const path = this.normalizer.forBashToken(bare, {
      resolveBase: this.normalizer.resolveBase(base.offset),
    });
    const lexical = path.value();
    if (!lexical || !this.normalizer.entryExists(lexical)) return null;
    return { token: bare, path };
  }

  private buildRuleCandidatePath(
    candidate: string,
    base: EffectiveBase,
  ): AccessPath {
    // An unknown base + relative candidate stays literal-only: a resolved
    // absolute or canonical alias would resolve against the wrong directory and
    // could spuriously match a rule (#393).
    if (base.kind === "unknown" && this.isRelativeCandidate(candidate)) {
      return this.normalizer.forLiteral(normalizePathPolicyLiteral(candidate));
    }

    const resolveBase =
      base.kind === "known"
        ? this.normalizer.resolveBase(base.offset)
        : undefined;
    return this.normalizer.forBashToken(candidate, { resolveBase });
  }

  /**
   * True when a path candidate is relative (resolved against the effective
   * directory) rather than absolute or home-relative (`~…`), which are
   * base-independent.
   *
   * Delegates the absoluteness decision to the platform-aware `PathNormalizer`
   * rather than a POSIX-only `startsWith("/")` check, so Windows drive-letter
   * paths (`C:/…`, `C:\…`) are correctly treated as absolute on win32 and as
   * relative on POSIX (where they denote an in-CWD path).
   */
  private isRelativeCandidate(candidate: string): boolean {
    return !this.normalizer.isAbsolute(candidate) && !candidate.startsWith("~");
  }
}

// ── Pure AST/string helpers ──────────────────────────────────────────────────

/**
 * True when the statement at `index` is immediately followed by the background
 * operator (`&`) — distinct from the `&&` / `||` / `;` current-shell
 * separators.
 */
function isBackgrounded(seqNode: TSNode, index: number): boolean {
  const next = seqNode.child(index + 1);
  if (!next || next.isNamed) return false;
  return next.type === "&";
}

function tagTokens(
  tokens: readonly PathToken[],
  base: EffectiveBase,
  out: PathCandidate[],
): void {
  for (const { token, effect } of tokens) out.push({ token, base, effect });
}

/**
 * Record an external access under `dedupKey`, merging into the entry already
 * there rather than adding a second one.
 *
 * Keeping the effect out of the dedup key is deliberate: `cat ~/a > ~/a` is one
 * path, and splitting it would show `~/a` twice in the ask prompt. Two
 * disagreeing proofs fold to unproven, which routes to the bare family —
 * precisely "consult both" — so the fold loses nothing the gates would have
 * used.
 */
function recordExternal(
  accessPath: AccessPath,
  effect: TokenEffect,
  dedupKey: string,
  seen: Map<string, number>,
  out: BashExternalPath[],
): void {
  const index = seen.get(dedupKey);
  if (index === undefined) {
    seen.set(dedupKey, out.length);
    out.push({ path: accessPath, effect });
    return;
  }
  const existing = out[index];
  out[index] = {
    path: existing.path,
    effect: mergeTokenEffects(existing.effect, effect),
  };
}

/**
 * Resolve the literal target of a `cd` command, or `null` when the first
 * argument is not a static literal (contains an expansion or command
 * substitution) or cannot be resolved against the working directory (`cd -`,
 * `cd ~…`, bare `cd`).
 */
function cdLiteralTarget(commandNode: TSNode): string | null {
  for (let i = 0; i < commandNode.childCount; i++) {
    const child = commandNode.child(i);
    if (!child) continue;
    if (child.type === "command_name" || child.type === "variable_assignment")
      continue;
    if (!child.isNamed) continue;
    // Skip the `--` end-of-flags marker; the next argument is the target.
    if (child.type === "word" && child.text === "--") continue;
    if (!ARG_NODE_TYPES.has(child.type)) return null;
    return literalTextOf(child);
  }
  return null;
}

/**
 * The literal string value of an argument node, or `null` when it contains a
 * variable expansion / command substitution or is a non-resolvable `cd`
 * destination (`-`, `~…`).
 */
function literalTextOf(node: TSNode): string | null {
  switch (node.type) {
    case "word": {
      const text = node.text;
      if (text === "-" || text.startsWith("~")) return null;
      return text;
    }
    case "raw_string": {
      const text = node.text;
      return text.length >= 2 && text.startsWith("'") && text.endsWith("'")
        ? text.slice(1, -1)
        : text;
    }
    case "concatenation": {
      let result = "";
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        const part = literalTextOf(child);
        if (part === null) return null;
        result += part;
      }
      return result;
    }
    case "string": {
      let result = "";
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i);
        if (!child) continue;
        if (child.type === '"') continue;
        if (child.type !== "string_content") return null;
        result += child.text;
      }
      return result;
    }
    default:
      return null;
  }
}
