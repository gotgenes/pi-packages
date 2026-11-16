import type { DeclaredCommandEffects } from "#src/config/command-effects-config";
import type { PathNormalizer } from "#src/path/path-normalizer";
import {
  type BashExternalPath,
  BashPathResolver,
  type BashPathRuleCandidate,
} from "./bash-path-resolver";
import {
  type BashCommand,
  collectCommands,
  collectSalvagedCommands,
} from "./command-enumeration";
import { WordReader } from "./node-text";
import { parseUnresolvedWithin } from "./parse-health";
import { type BashReparser, getParser, getWarmBashParser } from "./parser";
import { ShellVariables } from "./shell-variable-expansion";
import { withSalvagedRoots } from "./unresolved-salvage";

export type { BashCommand, BashExternalPath, BashPathRuleCandidate };

/** What a caller may tell {@link BashProgram.parse} beyond the command text. */
export interface BashParseOptions {
  /**
   * An aliased shell tool's working directory (#574), which seeds the initial
   * effective base as if the command were prefixed with `cd <workdir>`.
   */
  readonly workdir?: string;
  /**
   * The user's `commandEffects` declarations, consulted for a command the
   * pure-reader core proves nothing about. Absent means none.
   */
  readonly commandEffects?: DeclaredCommandEffects;
}

/**
 * A bash command parsed once into a born-ready representation.
 *
 * Parsing is the expensive step (tree-sitter WASM); `BashProgram` performs it
 * a single time and eagerly resolves all three typed slices so the bash
 * permission gates do not each re-parse or re-walk the command, and so the
 * slices are guaranteed to agree.
 *
 * Construct via the async `parse()` factory; the constructor is private.
 */
export class BashProgram {
  private constructor(
    private readonly sourceCommand: string,
    private readonly commandUnits: readonly BashCommand[],
    private readonly resolvedExternalAccesses: readonly BashExternalPath[],
    private readonly resolvedRuleCandidates: readonly BashPathRuleCandidate[],
    private readonly spelledVerbatim: boolean,
  ) {}

  /**
   * Parse a bash command into a born-ready `BashProgram`.
   *
   * Uses tree-sitter-bash to build the full AST, enumerates command units and
   * walks path-candidate tokens once, then eagerly resolves all three slices
   * through the injected {@link PathNormalizer} (platform + cwd baked in).
   * Heredoc bodies, comments, and other non-argument content are skipped. An
   * unparseable command yields an empty program.
   *
   * A bare token (e.g. `id_rsa`, `outside-link`) enters both slices when it
   * names an existing filesystem entry — the existence probe the resolver owns
   * (ADR 0009, #645). No policy is consulted, so every caller gets identical
   * slices for a given command and working directory.
   *
   * `options.workdir`, when supplied (an aliased shell tool's working directory,
   * #574), seeds the initial effective base — as if the command were prefixed
   * with `cd <workdir>` — so relative tokens resolve against it, and the workdir
   * itself is flagged as external when it resolves outside the cwd.
   */
  static async parse(
    command: string,
    normalizer: PathNormalizer,
    options?: BashParseOptions,
  ): Promise<BashProgram> {
    return BashProgram.build(await getParser(), command, normalizer, options);
  }

  /**
   * Parse a bash command synchronously over the warmed parser, or answer `null`
   * in the pre-warm window so the caller can fall back rather than block.
   *
   * Builds exactly the program {@link parse} builds; the service's advisory
   * query uses it so its answer resolves the same slices the gate does (#309).
   */
  static parseSync(
    command: string,
    normalizer: PathNormalizer,
    options?: BashParseOptions,
  ): BashProgram | null {
    const parser = getWarmBashParser();
    if (!parser) return null;
    return BashProgram.build(parser, command, normalizer, options);
  }

  /** Parse `command` with `parser` and resolve every slice synchronously. */
  private static build(
    parser: BashReparser,
    command: string,
    normalizer: PathNormalizer,
    options?: BashParseOptions,
  ): BashProgram {
    const tree = parser.parse(command);
    if (!tree) return new BashProgram(command, [], [], [], false);

    try {
      return withSalvagedRoots(tree.rootNode, parser, (salvaged) => {
        const words = new WordReader(
          ShellVariables.scan([tree.rootNode, ...salvaged]),
        );
        const { externalAccesses, ruleCandidates, argumentSpellings } =
          new BashPathResolver(
            normalizer,
            words,
            options?.workdir,
            options?.commandEffects,
          ).resolve(tree.rootNode, salvaged, command);
        return new BashProgram(
          command,
          [
            ...collectCommands(tree.rootNode, words, argumentSpellings),
            ...salvaged.flatMap((root) => collectSalvagedCommands(root, words)),
          ],
          externalAccesses,
          ruleCandidates,
          !parseUnresolvedWithin(tree.rootNode) &&
            !LINE_CONTINUATION.test(command),
        );
      });
    } finally {
      tree.delete();
    }
  }

  /**
   * The source command string this program was parsed from.
   *
   * The bash gates read this for prompts, logs, and decision display instead of
   * receiving the command as a separate parameter — the program is the parsed
   * command, so it owns its source text (#574). Native `bash` and an aliased
   * shell tool alike reach the gates through this single collaborator.
   */
  commandText(): string {
    return this.sourceCommand;
  }

  /**
   * The top-level command-pattern units of the chain, in source order.
   *
   * Splits on the shell chain operators (`&&`, `||`, `;`, `|`, `&`, newlines);
   * quotes, command substitution, and subshells are respected by the parser and
   * are NOT split — a subshell or other compound statement is emitted whole.
   * Each unit has any leading `variable_assignment` prefix stripped, and a
   * wrapper unit (`bash -c`/`eval`, or an indirection wrapper such as `sudo`) is
   * tagged with a `wrapperKind` so its decision is floored to `ask`.
   * May be empty (e.g. an empty command or a comment-only line); callers fall
   * back to the whole command so the surface is never evaluated weaker than
   * before.
   */
  commands(): BashCommand[] {
    return [...this.commandUnits];
  }

  /**
   * Deduplicated accesses that resolve outside `cwd`: each an
   * {@link AccessPath} value object holding both the lexical (as-typed) and
   * canonical (symlink-resolved) forms behind distinct accessors, paired with
   * the effect the command stream proved for it.
   *
   * Resolved eagerly at parse time through the `PathNormalizer` supplied to
   * `parse()` (platform + cwd baked in).
   * Use `.matchValues()` for `external_directory` pattern matching and
   * `.boundaryValue()` for containment checks; `.value()` for display and logs.
   * Two attributions of the same resolved path fold rather than split, so the
   * entry count is a function of the paths alone (#807).
   */
  externalAccesses(): BashExternalPath[] {
    return [...this.resolvedExternalAccesses];
  }

  /**
   * Path-rule candidates paired with their policy lookup values and the
   * effect the command stream proved for each (#807).
   *
   * Resolved eagerly at parse time through the `PathNormalizer` supplied to
   * `parse()` (platform + cwd baked in).
   * Each token is resolved against the effective working directory in force at
   * the token's position (folding literal current-shell `cd` commands), while
   * raw and project-relative aliases are retained for backward-compatible
   * relative rules. A token after a non-literal `cd` keeps only its literal
   * value so no spurious absolute rule can match (#393).
   */
  pathRuleCandidates(): BashPathRuleCandidate[] {
    return [...this.resolvedRuleCandidates];
  }

  /**
   * Whether every token the slices hold is spelled as bash will read it: the
   * grammar read the whole command without error recovery, and no
   * backslash-newline continuation joins two lines into one word.
   *
   * Where either fails, a token can stand truncated (`/@(etc|var)` read as
   * `/@`, `/e\<newline>tc` as `/e`) and the slices name paths the command does
   * not reach. They stay usable for asking, which only ever surfaces more; a
   * fact that would *relieve* an ask, such as the nothing-on-disk delegation
   * license, must not be read from them.
   */
  readsVerbatim(): boolean {
    return this.spelledVerbatim;
  }
}

/**
 * A backslash-newline, which bash removes before splitting words. Quoting is
 * not modelled: the fact this feeds only ever withholds.
 */
const LINE_CONTINUATION = /\\\r?\n/;
