/**
 * project-context.ts — Pi's `<project_context>` block, rendered from context files.
 */

import { debugNote } from "#src/debug";

/** A context file (`AGENTS.md` and kin) as Pi's loader reports it. */
export interface ContextFile {
  /** Absolute path the block attributes the instructions to. */
  path: string;
  /** The file's text. */
  content: string;
}

/**
 * Render context files as the `<project_context>` section Pi writes, byte for
 * byte.
 *
 * Pi's renderer joins a lead-in sentence and each `<project_instructions>`
 * block with a blank line, inside the section wrapper's own newlines.
 *
 * `buildSystemPrompt` is not exported, so the tests pin this against a
 * hand-built copy of the pinned SDK's output rather than against Pi's renderer.
 *
 * Returns undefined when there are no files, so a caller can tell "this
 * directory carries no project instructions" from "here they are".
 */
export function renderProjectContext(
  contextFiles: readonly ContextFile[] | undefined,
): string | undefined {
  if (!contextFiles || contextFiles.length === 0) return undefined;
  const body = [
    "Project-specific instructions and guidelines:",
    ...contextFiles.map(
      ({ path, content }) =>
        `<project_instructions path="${path}">\n${content}\n</project_instructions>`,
    ),
  ].join("\n\n");
  return `<project_context>\n${body}\n</project_context>`;
}

/** The project-context block a session working in `cwd` would carry. */
export type ProjectContextLoader = (cwd: string) => string | undefined;

/** Pi's context-file discovery, as `loadProjectContextFiles` implements it. */
export type ContextFileDiscovery = (options: {
  cwd: string;
  agentDir: string;
}) => ContextFile[];

/**
 * A loader that resolves a directory's project instructions against the
 * filesystem, for a child whose adopted identity carries none of its own.
 *
 * An empty result means the directory, every ancestor of it, and the global
 * agent directory all carry no context file — a real outcome for a sandbox
 * workspace, and one with nothing in the child's prompt to show for it. The
 * debug note is the only place that absence is visible.
 */
export function createProjectContextLoader(
  discover: ContextFileDiscovery,
  agentDir: string,
): ProjectContextLoader {
  return (cwd) => {
    const block = renderProjectContext(discover({ cwd, agentDir }));
    if (!block) debugNote(`no project context under ${cwd}`);
    return block;
  };
}
