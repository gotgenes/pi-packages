import { basename } from "node:path";
import { proveCommandEffect } from "#src/access-intent/bash/command-effects";
import {
  EXECUTION_HOST_TYPES,
  forEachNestedExecution,
  NESTED_EXECUTION_CONTEXTS,
} from "#src/access-intent/bash/nested-execution";
import {
  ARG_NODE_TYPES,
  resolveNodeText,
  SKIP_SUBTREE_TYPES,
} from "#src/access-intent/bash/node-text";
import type { TSNode } from "#src/access-intent/bash/parser";
import { redirectEffectForDestination } from "#src/access-intent/bash/redirect-analysis";
import type { TokenEffect } from "#src/access-intent/effect";

/**
 * A collected path-candidate token paired with the effect its position proved.
 *
 * The pairing is made where the token is *produced*, never by mapping a whole
 * result: a nested execution's tokens carry their own command's attribution
 * and must not be overwritten by the enclosing one.
 */
export interface PathToken {
  readonly token: string;
  readonly effect: TokenEffect;
}

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * Recursively visit the AST and collect resolved text of nodes that
 * represent command arguments or redirect destinations.
 *
 * Reads no text from `heredoc_body`, `heredoc_end`, or `comment` subtrees, but
 * still descends an execution host for the commands it hosts — an interpolating
 * heredoc body runs its substitution even though its prose is never an operand
 * (#741). That is why the {@link EXECUTION_HOST_TYPES} branch sits above the
 * {@link SKIP_SUBTREE_TYPES} check: `heredoc_body` is in both sets, and the
 * host reading is the one that must win.
 *
 * For commands in `PATTERN_FIRST_COMMANDS`, uses position-based
 * argument skipping to avoid collecting inline patterns/scripts
 * as path candidates. For all other commands, collects all
 * arguments generically.
 */
export function collectPathCandidateTokens(node: TSNode): PathToken[] {
  if (node.type === "command") return collectCommandTokens(node);
  if (node.type === "file_redirect") return collectRedirectTokens(node);
  if (EXECUTION_HOST_TYPES.has(node.type)) {
    return collectHostedExecutionTokens(node);
  }
  if (SKIP_SUBTREE_TYPES.has(node.type)) return [];

  const tokens: PathToken[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (child) tokens.push(...collectPathCandidateTokens(child));
  }
  return tokens;
}

/**
 * Select the collection strategy for a `command` node: pattern-first
 * commands use `collectPatternCommandTokens`; all others use
 * `collectGenericCommandTokens`.
 *
 * Every token the command owns carries the effect its head word proves — the
 * pure-reader core, read through the *raw* head word so a path-qualified
 * spelling proves nothing. A nested execution collected along the way keeps
 * its own command's attribution instead.
 */
export function collectCommandTokens(node: TSNode): PathToken[] {
  const effect = proveCommandEffect(
    extractCommandWord(node) ?? "",
    commandArgumentWords(node),
  );
  const commandName = extractCommandName(node);
  const config = commandName
    ? PATTERN_FIRST_COMMANDS.get(commandName)
    : undefined;
  const tokens = config
    ? collectPatternCommandTokens(node, config, effect)
    : collectGenericCommandTokens(node, effect);
  return [...tokens, ...collectEmbeddedOptionValues(node, effect)];
}

/**
 * Collect redirect-destination tokens from a `file_redirect` node.
 *
 * The destination itself is an argument value (`> out.txt`), but it can also
 * host a command that really runs (`> $(cat /etc/shadow)`, `< <(cmd)`), whose
 * own operands are path candidates too — so each child is both read for its
 * text and searched for nested executions (#741).
 *
 * Both passes are needed: a substitution can be the destination outright, or be
 * concatenated into it (`> ${DIR}/$(cmd)`), and a `concatenation` is itself an
 * argument node.
 *
 * The operator proves the destination's effect outright, and that proof is
 * absolute: it overrides whatever the redirected command's own head word
 * proved, because `> out.txt` writes `out.txt` however read-only the command
 * in front of it is. A destination the operator names as a file descriptor
 * (`2>&1`) contributes no token at all.
 *
 * Reading the redirect node itself belongs to `redirect-analysis.ts`, which
 * the command enumerator consults for the same fact (#803).
 */
export function collectRedirectTokens(node: TSNode): PathToken[] {
  const tokens: PathToken[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (ARG_NODE_TYPES.has(child.type)) {
      const effect = redirectEffectForDestination(node, child);
      if (effect) tokens.push({ token: resolveNodeText(child), effect });
    }
    tokens.push(...collectHostedExecutionTokens(child));
  }
  return tokens;
}

/**
 * Collect the path-candidate tokens of every command nested inside `node`'s
 * execution contexts, reading none of the host subtree's own text.
 *
 * This is what lets a heredoc body contribute its substitution's operands while
 * its prose stays out of the path surface entirely.
 *
 * `node` may be a context outright (`> $(cmd)`) or merely contain one
 * (`> ${DIR}/$(cmd)`); `forEachNestedExecution` searches strictly within a
 * subtree, so the first case is checked here.
 */
function collectHostedExecutionTokens(node: TSNode): PathToken[] {
  if (NESTED_EXECUTION_CONTEXTS.has(node.type)) {
    return collectPathCandidateTokens(node);
  }
  const tokens: PathToken[] = [];
  forEachNestedExecution(node, (contextNode) => {
    tokens.push(...collectPathCandidateTokens(contextNode));
  });
  return tokens;
}

/**
 * Extract the command name from a `command` node.
 * Returns the basename (e.g. `/usr/bin/sed` → `sed`), or undefined
 * if the command name cannot be determined (e.g. variable expansion).
 *
 * The basename is what {@link PATTERN_FIRST_COMMANDS} needs: `/usr/bin/sed`
 * parses its arguments exactly as `sed` does. It is the wrong question for a
 * capability claim, where the directory prefix is the whole point — use
 * {@link extractCommandWord} there.
 */
export function extractCommandName(node: TSNode): string | undefined {
  const word = extractCommandWord(node);
  return word === undefined ? undefined : basename(word);
}

/**
 * Extract the head word of a `command` node exactly as it was written, or
 * undefined when it cannot be determined (e.g. variable expansion).
 *
 * Unbasenamed on purpose: `./grep` and `/tmp/evil/grep` name programs the
 * pure-reader core's audit never saw, so an effect proof must be able to tell
 * them from a bare `grep` — the Codex lesson the bare-basename rule encodes.
 * Documented against {@link extractCommandName}, which answers the other
 * question.
 */
export function extractCommandWord(node: TSNode): string | undefined {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "command_name") {
      const text = resolveNodeText(child);
      return text === "" ? undefined : text;
    }
  }
  return undefined;
}

// ── Private helpers and config ─────────────────────────────────────────────

/**
 * The command's own argument words, which the retraction guards read.
 *
 * Reads the argument nodes directly rather than the collected tokens, because
 * a guard fires on an *option* (`find -delete`) and no collector emits one.
 */
function commandArgumentWords(node: TSNode): string[] {
  const words: string[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "command_name" || child.type === "variable_assignment")
      continue;
    if (!ARG_NODE_TYPES.has(child.type)) continue;
    words.push(resolveNodeText(child));
  }
  return words;
}

/**
 * A long or short option carrying its value inline: one or two leading dashes,
 * a name containing no `=` or whitespace, then `=` and a non-empty value.
 * Only the first `=` separates, so `--opt=/tmp/a=b` yields `/tmp/a=b`.
 */
const OPTION_VALUE_PATTERN = /^-{1,2}[^=\s]+=(.+)$/;

/**
 * The values embedded in this command's `--opt=value` argument tokens.
 *
 * Read straight from the argument nodes rather than from the collected token
 * list, because a pattern-first command's collector classifies a flag and never
 * emits it — so `grep --file=/tmp/patterns` would otherwise lose the path.
 *
 * This is token *preprocessing*, not classification: the extracted value is
 * handed to the ordinary shape classifiers and existence probe, so
 * `--file=/tmp/patterns` reaches the path surfaces while `--format=json`
 * yields a bare `json` that names nothing and is dropped. Keeping the split
 * here is what lets the projection see option-embedded paths without per-command
 * option tables (ADR 0009, #645).
 */
function collectEmbeddedOptionValues(
  node: TSNode,
  effect: TokenEffect,
): PathToken[] {
  const values: PathToken[] = [];
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    if (child.type === "command_name" || child.type === "variable_assignment")
      continue;
    if (!ARG_NODE_TYPES.has(child.type)) continue;

    const value = OPTION_VALUE_PATTERN.exec(resolveNodeText(child))?.[1];
    if (value !== undefined) values.push({ token: value, effect });
  }
  return values;
}

interface PatternCommandConfig {
  /** Flags that consume the next argument as a non-path value (pattern, separator, etc.) */
  readonly argConsumingFlags: ReadonlySet<string>;
  /** Flags that consume the next argument as a file path */
  readonly fileConsumingFlags: ReadonlySet<string>;
  /**
   * Number of leading positional arguments that are patterns/scripts, not paths.
   * Default: 1 (covers sed, awk, grep, rg).
   * sd uses 2 (FIND and REPLACE_WITH are both non-path positionals).
   */
  readonly patternPositionals?: number;
}

/**
 * Commands whose first N positional arguments are inline patterns/scripts,
 * not filesystem paths. The map stores per-command flag configuration so
 * the walker can correctly identify which arguments are consumed by flags
 * vs. which are positional.
 */
const PATTERN_FIRST_COMMANDS: ReadonlyMap<string, PatternCommandConfig> =
  new Map([
    [
      "sed",
      {
        argConsumingFlags: new Set(["-e", "-i"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "awk",
      {
        argConsumingFlags: new Set(["-e", "-F", "-v"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "gawk",
      {
        argConsumingFlags: new Set(["-e", "-F", "-v"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "nawk",
      {
        argConsumingFlags: new Set(["-e", "-F", "-v"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "grep",
      {
        argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "egrep",
      {
        argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "fgrep",
      {
        argConsumingFlags: new Set(["-e", "-A", "-B", "-C", "-m"]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "rg",
      {
        argConsumingFlags: new Set([
          "-e",
          "-A",
          "-B",
          "-C",
          "-m",
          "-g",
          "-t",
          "-T",
          "-j",
          "-M",
          "-r",
          "-E",
        ]),
        fileConsumingFlags: new Set(["-f"]),
      },
    ],
    [
      "sd",
      {
        argConsumingFlags: new Set(["-n", "-f"]),
        fileConsumingFlags: new Set([]),
        patternPositionals: 2,
      },
    ],
  ]);

/**
 * Describes what the walker should do when it encounters a flag word inside
 * a pattern-first command.  Using a discriminated union lets the `switch` in
 * `collectPatternCommandTokens` narrow `nextArgAction` without a non-null
 * assertion (which would trigger the Biome/ESLint assertion conflict).
 */
type PatternCommandFlagDirective =
  | { kind: "end-of-flags" }
  | { kind: "regular-flag" }
  | {
      kind: "consume-arg";
      nextArgAction: "skip" | "extract";
      setsExplicitScript: boolean;
    };

/**
 * Classify a flag word from a pattern-first command into a directive that
 * tells the walker how to handle the flag and its following argument.
 */
function classifyPatternCommandFlag(
  text: string,
  config: PatternCommandConfig,
): PatternCommandFlagDirective {
  if (text === "--") return { kind: "end-of-flags" };
  if (config.argConsumingFlags.has(text)) {
    return {
      kind: "consume-arg",
      nextArgAction: "skip",
      setsExplicitScript: text === "-e" || text === "-f",
    };
  }
  if (config.fileConsumingFlags.has(text)) {
    return {
      kind: "consume-arg",
      nextArgAction: "extract",
      setsExplicitScript: true,
    };
  }
  return { kind: "regular-flag" };
}

/**
 * Collect path-candidate tokens from a command known to have
 * pattern/script arguments in leading positional slots.
 *
 * Uses position-based skipping: the first N positional arguments
 * (where N = patternPositionals, default 1) are assumed to be
 * inline patterns/scripts and are skipped. Remaining positional
 * arguments are collected as path candidates.
 *
 * Flags listed in `argConsumingFlags` consume the next argument
 * (skipped). Flags in `fileConsumingFlags` consume the next
 * argument as a file path (collected). The flags `-e` and `-f`
 * additionally signal that an explicit script was provided via
 * flag, so no inline positional script is expected.
 */
function collectPatternCommandTokens(
  node: TSNode,
  config: PatternCommandConfig,
  effect: TokenEffect,
): PathToken[] {
  const patternPositionals = config.patternPositionals ?? 1;
  let hasExplicitScript = false;
  let positionalsSeen = 0;
  let pendingConsumption: PendingConsumption | null = null;
  let pastEndOfFlags = false;
  const tokens: PathToken[] = [];

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    // Skip command_name and variable_assignment nodes.
    if (child.type === "command_name" || child.type === "variable_assignment")
      continue;

    const isArgNode = ARG_NODE_TYPES.has(child.type);
    const text = resolveNodeText(child);

    // Handle the argument a previous flag consumed. The discharge is gated on
    // ARG_NODE_TYPES, so a `number`/expansion/substitution argument carries the
    // consumption onto the next word instead — see #823.
    if (pendingConsumption !== null && isArgNode) {
      const discharge = dischargePendingConsumption(
        pendingConsumption,
        text,
        effect,
      );
      pendingConsumption = null;
      if (discharge.token) tokens.push(discharge.token);
      if (discharge.consumed) continue;
    }

    // Only process argument-like nodes; recurse into others
    // (e.g. command_substitution) for nested commands.
    if (!isArgNode) {
      tokens.push(...collectPathCandidateTokens(child));
      continue;
    }

    // Flag detection (only before "--" end-of-flags marker).
    if (
      !pastEndOfFlags &&
      child.type === "word" &&
      text.startsWith("-") &&
      text.length > 1
    ) {
      const directive = classifyPatternCommandFlag(text, config);
      switch (directive.kind) {
        case "end-of-flags":
          pastEndOfFlags = true;
          break;
        case "consume-arg":
          pendingConsumption = directive.nextArgAction;
          if (directive.setsExplicitScript) hasExplicitScript = true;
          break;
        case "regular-flag":
          break;
      }
      continue;
    }

    // Positional argument.
    if (!hasExplicitScript && positionalsSeen < patternPositionals) {
      positionalsSeen++;
      continue; // Skip: this is an inline pattern/script.
    }

    // File argument — collect as path candidate.
    tokens.push({ token: text, effect });
  }

  return tokens;
}

/** What a pending flag consumption does with the argument that follows it. */
type PendingConsumption = "skip" | "extract";

/**
 * What a pending flag consumption made of the argument node that followed it.
 *
 * `consumed` is the flag's own verdict, not the walker's: a flag whose argument
 * is optional can decline the node, which the walker then reads as an ordinary
 * argument.
 */
interface ConsumptionDischarge {
  readonly consumed: boolean;
  /** The path candidate the consumed argument contributes, if any. */
  readonly token?: PathToken;
}

/** Apply a pending consumption to the argument text that follows its flag. */
function dischargePendingConsumption(
  consumption: PendingConsumption,
  text: string,
  effect: TokenEffect,
): ConsumptionDischarge {
  return consumption === "extract"
    ? { consumed: true, token: { token: text, effect } }
    : { consumed: true };
}

/**
 * Collect all argument tokens from a generic (non-pattern-first) command node,
 * skipping the command name and variable assignments.
 */
function collectGenericCommandTokens(
  node: TSNode,
  effect: TokenEffect,
): PathToken[] {
  const tokens: PathToken[] = [];
  let seenCommandName = false;

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;

    if (child.type === "command_name") {
      seenCommandName = true;
      continue;
    }
    // Skip variable_assignment nodes (FOO=/bar)
    if (child.type === "variable_assignment") continue;

    // If there was no explicit command_name node, the first word-like
    // child is the command name itself — skip it.
    if (!seenCommandName && ARG_NODE_TYPES.has(child.type)) {
      seenCommandName = true;
      continue;
    }

    // Argument nodes: resolve their text and collect.
    if (ARG_NODE_TYPES.has(child.type)) {
      tokens.push({ token: resolveNodeText(child), effect });
      continue;
    }

    // Recurse into other children (e.g. command_substitution nested in args)
    tokens.push(...collectPathCandidateTokens(child));
  }

  return tokens;
}
