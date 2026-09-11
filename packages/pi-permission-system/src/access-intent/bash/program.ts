import type { PathNormalizer } from "#src/path/path-normalizer";
import {
  type BashExternalPath,
  BashPathResolver,
  type BashPathRewrite,
  type BashPathRuleCandidate,
} from "./bash-path-resolver";
import { type BashCommand, collectCommandUnits } from "./command-enumeration";
import { getParser, type SourceSpan } from "./parser";

export type { BashCommand, BashExternalPath, BashPathRuleCandidate };

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
    private readonly unitSpans: readonly SourceSpan[],
    private readonly resolvedExternalAccesses: readonly BashExternalPath[],
    private readonly resolvedRuleCandidates: readonly BashPathRuleCandidate[],
    private readonly resolvedPathRewrites: readonly BashPathRewrite[],
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
    options?: { workdir?: string },
  ): Promise<BashProgram> {
    const parser = await getParser();
    const tree = parser.parse(command);
    if (!tree) return new BashProgram(command, [], [], [], [], []);

    try {
      const { externalAccesses, ruleCandidates, pathRewrites } =
        new BashPathResolver(normalizer, options?.workdir).resolve(
          tree.rootNode,
        );
      const { commands, spans } = collectCommandUnits(tree.rootNode);
      return new BashProgram(
        command,
        commands,
        spans,
        externalAccesses,
        ruleCandidates,
        pathRewrites,
      );
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
   * The alias texts for each command unit, at the same index as {@link commands}.
   *
   * Each is the unit's text with its resolved path arguments replaced by an
   * absolute form, so a `bash` rule written in that spelling matches a command
   * the operator wrote relatively. The gate tries them after the text as typed,
   * last-match-wins across the union — the treatment
   * `AccessPath.matchValues()` already gives the path surfaces.
   *
   * At most two per unit: the absolute lexical forms, then the canonical form of
   * each argument a symlink resolves elsewhere. A unit whose arguments are every
   * one already spelled absolutely yields none, because the resolver records a
   * rewrite only when a form differs from the token as written, and any text
   * equal to the unit's own is dropped here.
   */
  commandAliasTexts(): string[][] {
    const source = this.sourceCommand;
    return this.unitSpans.map((unit) => {
      const inside = this.resolvedPathRewrites.filter(
        (rewrite) =>
          rewrite.span.start >= unit.start && rewrite.span.end <= unit.end,
      );
      if (inside.length === 0) return [];
      const widths = Math.max(1, ...inside.map((r) => r.replacements.length));
      const typed = source.slice(unit.start, unit.end);
      const seen = new Set<string>([typed]);
      const aliases: string[] = [];
      for (let index = 0; index < widths; index++) {
        const text = rewriteUnitText(source, unit, inside, index);
        if (seen.has(text)) continue;
        seen.add(text);
        aliases.push(text);
      }
      return aliases;
    });
  }
}

/**
 * `unit`'s source text with each rewrite's `index`-th replacement applied.
 *
 * Replacements run right to left, so the offsets of the ones not yet applied
 * stay valid. A rewrite offering fewer forms than `index` reuses its last one,
 * which is what keeps the alias count the longest list rather than a cross
 * product over the command's arguments.
 */
function rewriteUnitText(
  source: string,
  unit: SourceSpan,
  rewrites: readonly BashPathRewrite[],
  index: number,
): string {
  let text = source.slice(unit.start, unit.end);
  const ordered = [...rewrites].sort((a, b) => b.span.start - a.span.start);
  for (const rewrite of ordered) {
    const replacement =
      rewrite.replacements[Math.min(index, rewrite.replacements.length - 1)];
    const start = rewrite.span.start - unit.start;
    const end = rewrite.span.end - unit.start;
    text = `${text.slice(0, start)}${replacement}${text.slice(end)}`;
  }
  return text;
}
