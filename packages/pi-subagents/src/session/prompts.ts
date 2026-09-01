/**
 * prompts.ts — System prompt builder for agents.
 */

import { ASK_BACK_PROTOCOL } from "#src/session/ask-back";
import type { EnvInfo } from "#src/session/env";
import type { AgentPromptConfig } from "#src/types";

/** The parent session's contribution to a child prompt, plus the cwd that text claims. */
export interface InheritedPrompt {
  /** The parent agent's effective system prompt. */
  systemPrompt: string;
  /** The parent's working directory — the cwd its prompt footer names. */
  cwd: string;
}

/**
 * Build the system prompt for an agent from its config.
 *
 * Both modes place the shared/stable parent prompt (or `genericBase` when no
 * parent is available) first so the LLM's KV cache can reuse the inherited
 * prefix across all subagent invocations.
 *
 * - "replace" mode: parent/genericBase + active_agent tag + env header +
 *   config.systemPrompt.  No `<sub_agent_context>` bridge and no
 *   `<agent_instructions>` wrapper — the custom prompt has full control and
 *   the final say.
 * - "append" mode: parent/genericBase + sub-agent context bridge +
 *   active_agent tag + env header + config.systemPrompt (wrapped in
 *   `<agent_instructions>` when non-empty).
 * - "append" with empty systemPrompt: pure parent clone.
 *
 * Both modes include an `<active_agent name="${config.name}"/>` tag so
 * downstream extensions (e.g. `@gotgenes/pi-permission-system`) can resolve
 * per-agent policy inside the child session by parsing the system prompt.
 * The tag follows the cacheable parent prefix in both modes.
 *
 * Only the parent prompt's identity is inherited — see `inheritedIdentity`.
 *
 * @param inherited  The parent agent's effective system prompt and the cwd it names.
 */
export function buildAgentPrompt(
  config: AgentPromptConfig,
  cwd: string,
  env: EnvInfo,
  inherited?: InheritedPrompt,
): string {
  const header = buildPromptHeader(config.name, cwd, env);

  const identity = inherited
    ? inheritedIdentity(inherited.systemPrompt, inherited.cwd)
    : genericBase;

  if (config.promptMode === "append") {

    const bridge = `<sub_agent_context>
You are operating as a sub-agent invoked to handle a specific task.
- Use the read tool instead of cat/head/tail
- Use the edit tool instead of sed/awk
- Use the write tool instead of echo/heredoc
- Use the find tool instead of bash find/ls for file search
- Use the grep tool instead of bash grep/rg for content search
- Make independent tool calls in parallel
- Use absolute file paths
- Do not use emojis
- Be concise but complete
</sub_agent_context>`;

    const customSection = config.systemPrompt.trim()
      ? `\n\n<agent_instructions>\n${config.systemPrompt}\n</agent_instructions>`
      : "";

    // Place shared/stable content first so the LLM's KV cache can reuse the
    // inherited prefix across all subagent invocations. The parent prompt is
    // placed verbatim (no wrapper tag) so it forms an identical byte prefix
    // with the parent session, maximising KV cache hits. The <active_agent>
    // tag and env block vary per call and are placed after the cached prefix.
    return (
      identity +
      "\n\n" +
      bridge +
      "\n\n" +
      header +
      customSection
    );
  }

  // "replace" mode — parent/genericBase prefix first for KV cache reuse, then
  // the active_agent tag, env block, and the config's full system prompt.
  // Unlike append mode, no <sub_agent_context> bridge or <agent_instructions>
  // wrapper is injected — the custom prompt retains full control.
  return identity + "\n\n" + header + "\n\n" + config.systemPrompt;
}

/**
 * The per-call header both prompt modes share: the `<active_agent>` tag and the
 * environment block. Both vary per invocation, so both sit after the cacheable
 * identity prefix — and both modes need any content added here, which is why it
 * has one home rather than being composed at each `return`.
 */
function buildPromptHeader(agentName: string, cwd: string, env: EnvInfo): string {
  const activeAgentTag = `<active_agent name="${agentName}"/>\n\n`;

  const envBlock = `# Environment
Working directory: ${cwd}
${env.isGitRepo ? `Git repository: yes\nBranch: ${env.branch}` : "Not a git repository"}
Platform: ${env.platform}`;

  // Both modes carry the ask-back protocol: a "replace" agent never sees the
  // <sub_agent_context> bridge, and Explore and Plan are exactly the agents
  // most likely to run out of information mid-task.
  return `${activeAgentTag}${ASK_BACK_PROTOCOL}\n\n${envBlock}`;
}

/** First line of the section Pi writes above the `<available_skills>` catalogue. */
const SKILLS_SECTION_HEADING =
  "The following skills provide specialized instructions for specific tasks.";

/** Closing tag of that catalogue. */
const SKILLS_CATALOGUE_CLOSE = "</available_skills>";

/**
 * Reduce an inherited prompt to the identity a child may adopt as its own.
 *
 * Pi's `buildSystemPrompt` ends every prompt with layers it resolves per
 * session — the `<available_skills>` catalogue, then a
 * `Current working directory:` footer — and extensions append further blocks
 * after those from `before_agent_start`, rebuilt from the base prompt on every
 * turn. The child's own session rebuilds all of it against the child's
 * directory, tool set, and extensions, so an inherited copy is a second, stale
 * claim of each: a catalogue naming skills the child may not have (#801), and
 * a footer that walks a workspace-isolated child back into the parent's
 * directory (#640).
 *
 * Everything from the first such layer onward is therefore dropped. What
 * precedes it is returned byte for byte, so it stays a shared prefix with the
 * parent's prompt for prefix-caching providers (#180, #400).
 *
 * A prompt carrying neither layer is not one `buildSystemPrompt` assembled, and
 * is returned unchanged.
 */
function inheritedIdentity(prompt: string, parentCwd: string): string {
  const lines = prompt.split("\n");
  const tailStart = sessionResolvedTailStart(lines, parentCwd);
  return tailStart === -1
    ? prompt
    : lines.slice(0, tailStart).join("\n").trimEnd();
}

/**
 * Line index at which Pi's per-session layers begin, or -1 when none is present.
 *
 * The catalogue precedes the footer, so cutting at the catalogue already
 * removes it; the footer is the anchor only for a parent session that resolved
 * no skills. Matching whole lines makes the footer match exact, so a footer
 * naming a directory that merely shares a prefix with the parent's is not
 * mistaken for it, and it mirrors the separator normalization
 * `buildSystemPrompt` applies.
 */
function sessionResolvedTailStart(
  lines: readonly string[],
  parentCwd: string,
): number {
  const footerAt = lines.lastIndexOf(
    `Current working directory: ${toPromptPath(parentCwd)}`,
  );
  const catalogueAt = skillsSectionStart(lines, footerAt);
  return catalogueAt === -1 ? footerAt : catalogueAt;
}

/**
 * Line index of the skills section's heading, or -1 when the section is absent.
 *
 * The heading is located by searching back from the catalogue's closing tag, so
 * prose quoting Pi's heading ahead of the section is not mistaken for it.
 */
function skillsSectionStart(
  lines: readonly string[],
  footerAt: number,
): number {
  const catalogueEnd = catalogueCloseBefore(lines, footerAt);
  return catalogueEnd === -1
    ? -1
    : lines.lastIndexOf(SKILLS_SECTION_HEADING, catalogueEnd);
}

/**
 * Line index of Pi's own catalogue closing tag, or -1 when it wrote none.
 *
 * `buildSystemPrompt` writes the cwd footer immediately after the catalogue, in
 * both of its branches and unconditionally, so the tag on the line before the
 * footer is Pi's own. Identifying it by that position rather than by document
 * order keeps a catalogue quoted elsewhere — in a project-context file, or in a
 * block an extension appended after the footer — from being taken for the
 * section, in either direction.
 *
 * Without a footer to anchor on, something downstream has rewritten Pi's
 * output; the last closing tag is the best remaining guess.
 */
function catalogueCloseBefore(
  lines: readonly string[],
  footerAt: number,
): number {
  if (footerAt === -1) {
    return lines.lastIndexOf(SKILLS_CATALOGUE_CLOSE);
  }
  return lines[footerAt - 1] === SKILLS_CATALOGUE_CLOSE ? footerAt - 1 : -1;
}

/** Render a path the way `buildSystemPrompt` writes it into a prompt. */
function toPromptPath(cwd: string): string {
  return cwd.replaceAll("\\", "/");
}

/** Fallback base prompt when parent system prompt is unavailable (both modes). */
const genericBase = `# Role
You are a general-purpose coding agent for complex, multi-step tasks.
You have full access to read, write, edit files, and execute commands.
Do what has been asked; nothing more, nothing less.`;
