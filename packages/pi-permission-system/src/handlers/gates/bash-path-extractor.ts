import { BashProgram } from "#src/access-intent/bash/program";
import type { PathNormalizer } from "#src/path-normalizer";

/**
 * Extract paths from a bash command that resolve outside CWD.
 *
 * Thin facade over {@link BashProgram.externalAccesses}; parses the command
 * through the injected {@link PathNormalizer} (platform + cwd baked in) and
 * returns the cd-aware external paths in their lexical (as-typed) string form.
 * See `BashProgram` for the parsing and resolution semantics.
 *
 * Returns `string[]` (not `AccessPath[]`) so the large projection-correctness
 * test suite in `bash-external-directory.test.ts` can assert path values
 * without migrating to the `AccessPath` accessors.
 */
export async function extractExternalPathsFromBashCommand(
  command: string,
  normalizer: PathNormalizer,
): Promise<string[]> {
  return (await BashProgram.parse(command, normalizer))
    .externalAccesses()
    .map(({ path }) => path.value());
}
