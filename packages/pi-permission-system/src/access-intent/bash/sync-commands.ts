import { type BashCommand, collectCommands } from "./command-enumeration";
import { getWarmBashParser } from "./parser";

/**
 * Synchronously enumerate the command-pattern units of a bash command using the
 * warmed tree-sitter parser.
 *
 * Returns `null` when the parser has not been warmed yet (the pre-warm window),
 * so the caller can fall back to whole-string matching rather than block. Once
 * warm it mirrors the enumeration the gate performs (`BashProgram.commands()`):
 * chains split, nested substitutions/subshells descend, opaque wrappers flagged
 * (#306). Only the command-pattern surface is produced — no path slices, so no
 * `PathNormalizer` is needed.
 *
 * An unparseable command yields an empty array (the caller's decompose path
 * fails it closed via `resolveBashCommandCheck`, #452).
 */
export function parseBashCommandsSync(command: string): BashCommand[] | null {
  const parser = getWarmBashParser();
  if (!parser) return null;
  const tree = parser.parse(command);
  if (!tree) return [];
  try {
    return collectCommands(tree.rootNode);
  } finally {
    tree.delete();
  }
}
