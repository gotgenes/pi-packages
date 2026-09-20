/**
 * prompts.ts — System prompt builder for agents.
 */

import type { EnvInfo } from "#src/session/env";
import type { ProjectContextLoader } from "#src/session/project-context";
import type { AgentPromptConfig, PromptInheritance } from "#src/types";

/** The parent session's contribution to a child prompt, plus the cwd that text claims. */
export interface InheritedPrompt {
  /** The parent agent's effective system prompt. */
  systemPrompt: string;
  /** The parent's working directory — the cwd its prompt footer names. */
  cwd: string;
  /**
   * Which of the parent's contributions the child adopts as its identity.
   * Absent means `"full"`, the strategy every provider gets unless its
   * operator has said otherwise.
   */
  strategy?: PromptInheritance;
  /**
   * The parent's operator-authored parts, for a `"portable"` child. May be
   * absent even then — the parent may have assembled no prompt yet, or have no
   * such parts.
   */
  portablePrompt?: string;
}

/**
 * Build the system prompt for an agent from its config.
 *
 * Both modes place the shared/stable parent prompt (or `genericBase` when no
 * parent is available) first, so the inherited identity is a leading prefix the
 * child shares with its parent across all subagent invocations. What that is
 * worth is host-dependent — see ADR 0008.
 *
 * - "replace" mode: parent/genericBase + active_agent tag + env header +
 *   config.systemPrompt.  No `<agent_instructions>` wrapper — the custom
 *   prompt has full control and the final say.
 * - "append" mode: parent/genericBase + active_agent tag + env header +
 *   config.systemPrompt (wrapped in `<agent_instructions>` when non-empty).
 * - "append" with empty systemPrompt: pure parent clone.
 *
 * The two modes now differ only in the `<agent_instructions>` wrapper. The
 * `<sub_agent_context>` bridge append mode used to carry was removed in #890:
 * its tool bullets duplicated the `promptGuidelines` Pi's own tools contribute
 * to every child's prompt, and it asserted them unconditionally — telling a
 * read-only child to use `edit` and `write` when it has neither.
 *
 * Both modes include an `<active_agent name="${config.name}"/>` tag so
 * downstream extensions (e.g. `@gotgenes/pi-permission-system`) can resolve
 * per-agent policy inside the child session by parsing the system prompt.
 * The tag follows the cacheable parent prefix in both modes.
 *
 * Only the parent prompt's identity is inherited — see `inheritedIdentity`.
 *
 * @param inherited  The parent agent's effective system prompt and the cwd it names.
 * @param loadProjectContext  Resolves a directory's project instructions, for a
 *   child whose adopted identity carries none describing its own.
 */
export function buildAgentPrompt(
  config: AgentPromptConfig,
  cwd: string,
  env: EnvInfo,
  inherited?: InheritedPrompt,
  loadProjectContext?: ProjectContextLoader,
): string {
  const header = buildPromptHeader(config.name, cwd, env);

  const identity = inherited ? adoptedIdentity(inherited, cwd) : genericBase;
  const projectContext = ownProjectContext(inherited, cwd, loadProjectContext);

  if (config.promptMode === "append") {
    const customSection = config.systemPrompt.trim()
      ? `\n\n<agent_instructions>\n${config.systemPrompt}\n</agent_instructions>`
      : "";

    // Place the inherited identity first so it forms a shared leading prefix
    // with the parent session, which prefix-reusing inference engines reuse
    // instead of reprocessing. The <active_agent> tag and env block vary per
    // call and are placed after that prefix.
    return identity + projectContext + "\n\n" + header + customSection;
  }

  // "replace" mode — identity prefix first, then the active_agent tag, env
  // block, and the config's full system prompt. Unlike append mode, no
  // <agent_instructions> wrapper is injected — the custom prompt retains full
  // control.
  return identity + projectContext + "\n\n" + header + "\n\n" + config.systemPrompt;
}

/**
 * The project-context section a child contributes for itself, or "" when the
 * identity it adopted already describes its directory.
 *
 * Two children need one. A child a `WorkspaceProvider` relocated had its
 * inherited block cut with the rest of the session-resolved tail, because that
 * block named the parent's files by absolute path (#918); and a `portable`
 * child adopts operator-authored text that carries no project context at all
 * (ADR 0009). Rendering it here rather than letting Pi append it keeps the
 * agent's own body last, which is what `prompt_mode: replace` promises.
 *
 * A directory that resolves no context file contributes nothing — project
 * instructions describe a project this child is not working in.
 */
function ownProjectContext(
  inherited: InheritedPrompt | undefined,
  cwd: string,
  loadProjectContext: ProjectContextLoader | undefined,
): string {
  if (!inherited || !loadProjectContext) return "";
  const adoptedDescribesOwnDirectory =
    inherited.strategy !== "portable" && cwd === inherited.cwd;
  if (adoptedDescribesOwnDirectory) return "";
  const block = loadProjectContext(cwd);
  return block ? `\n\n${block}` : "";
}

/**
 * The parent contribution the child adopts, per the strategy its provider set.
 *
 * `full` takes the assembled prompt's identity region, which stays a leading
 * prefix shared with the parent (ADR 0008). `portable` takes the parent's
 * operator-authored parts instead, for a provider that re-homes the prompt into
 * a harness supplying its own base (ADR 0009).
 *
 * An absent or whitespace-only portable capture falls back to the generic base,
 * never to the full prompt: opting into portable must never silently re-embed
 * the harness base it exists to avoid.
 */
function adoptedIdentity(inherited: InheritedPrompt, cwd: string): string {
  if (inherited.strategy !== "portable") {
    return inheritedIdentity(
      inherited.systemPrompt,
      inherited.cwd,
      cwd !== inherited.cwd,
    );
  }
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- || intentional: a whitespace-only capture must fall back too, which ?? would not do
  return inherited.portablePrompt?.trim() || genericBase;
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

  return `${activeAgentTag}${envBlock}`;
}

/** First line of the section Pi writes above the `<available_skills>` catalogue. */
const SKILLS_SECTION_HEADING =
  "The following skills provide specialized instructions for specific tasks.";

/** Closing tag of that catalogue. */
const SKILLS_CATALOGUE_CLOSE = "</available_skills>";

/** Opening tag of the section Pi ≥0.86 wraps the catalogue in. */
const SKILLS_SECTION_OPEN = "<skills>";

/** Closing tag of that section. */
const SKILLS_SECTION_CLOSE = "</skills>";

/** Opening tag of the section Pi ≥0.86 renders the working directory into. */
const CWD_SECTION_OPEN = "<cwd>";

/** Closing tag of that section. */
const CWD_SECTION_CLOSE = "</cwd>";

/** Opening tag of the block Pi renders the session's context files into. */
const PROJECT_CONTEXT_OPEN = "<project_context>";

/** Closing tag of that block. */
const PROJECT_CONTEXT_CLOSE = "</project_context>";

/**
 * The sentence Pi writes below the opening tag — two lines below it through
 * 0.85, whose block opens with a blank line, and directly below it from
 * 0.86's section renderer.
 *
 * Both offsets are accepted because the peer range (`>=0.81.0`) admits both
 * renderers. The 0.85 arm in `projectContextStart` is dead once that floor
 * moves past 0.85; drop it with the fixtures that exercise it rather than
 * carrying it forward.
 */
const PROJECT_CONTEXT_LEAD_IN = "Project-specific instructions and guidelines:";

/**
 * Reduce an inherited prompt to the identity a child may adopt as its own.
 *
 * Pi's `buildSystemPrompt` ends every prompt with layers it resolves per
 * session — the `<available_skills>` catalogue, then a
 * `Current working directory:` footer, or from 0.86 the same catalogue inside
 * a `<skills>` section followed by a `<cwd>` section — and extensions append
 * further blocks after those from `before_agent_start`, rebuilt from the base
 * prompt on every turn. The child's own session rebuilds all of it against
 * the child's directory, tool set, and extensions, so an inherited copy is a
 * second, stale claim of each: a catalogue naming skills the child may not
 * have (#801), and a footer that walks a workspace-isolated child back into
 * the parent's directory (#640).
 *
 * Everything from the first such layer onward is therefore dropped. What
 * precedes it is returned byte for byte, so it stays a shared prefix with the
 * parent's prompt for hosts that reuse one over the system text (#180, #400).
 * That is why no extension may edit the region in place: `Available tools:`
 * sits a few hundred characters into it, and narrowing it there ended the
 * shared prefix for every child with a narrowed tool set (#890).
 *
 * A prompt carrying neither layer is not one `buildSystemPrompt` assembled, and
 * is returned unchanged.
 *
 * `cutProjectContext` extends the cut one layer earlier, to the
 * `<project_context>` block, for a child whose workspace is not its parent's
 * (#918). That block names each context file by absolute path, so an inherited
 * copy tells a relocated child its files live in the parent's checkout.
 */
function inheritedIdentity(
  prompt: string,
  parentCwd: string,
  cutProjectContext: boolean,
): string {
  const lines = prompt.split("\n");
  const tailStart = sessionResolvedTailStart(lines, parentCwd, cutProjectContext);
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
  cutProjectContext: boolean,
): number {
  const tailAt = cwdAnchoredTailStart(lines, parentCwd);
  if (!cutProjectContext || tailAt === -1) return tailAt;
  const projectContextAt = projectContextStart(lines, tailAt);
  return projectContextAt === -1 ? tailAt : projectContextAt;
}

/**
 * Line index at which Pi's per-session layers begin, across both of its
 * prompt renderers, or -1 when none is present.
 *
 * Through 0.85 the layers end in a `Current working directory:` footer line,
 * and the catalogue is anchored to it positionally. From 0.86 the prompt is
 * assembled from tagged sections — the cwd as a `<cwd>` section, the catalogue
 * inside a `<skills>` section — so the footer never matches and the cwd
 * section takes the anchor's place. The two shapes are told apart by which
 * cwd layer is present, never by version sniffing — which is what the name
 * records, so this reads apart from the `sessionResolvedTailStart` above it
 * that extends the cut past this anchor.
 */
function cwdAnchoredTailStart(
  lines: readonly string[],
  parentCwd: string,
): number {
  const footerAt = lines.lastIndexOf(
    `Current working directory: ${toPromptPath(parentCwd)}`,
  );
  if (footerAt !== -1) {
    const catalogueAt = skillsSectionStart(lines, footerAt);
    return catalogueAt === -1 ? footerAt : catalogueAt;
  }
  const cwdAt = cwdSectionStart(lines, parentCwd);
  if (cwdAt !== -1) return skillsSectionWrapperStart(lines, cwdAt);
  // Neither cwd layer: something downstream rewrote a 0.85-shaped prompt, and
  // the last closing tag is the best remaining guess.
  return skillsSectionStart(lines, -1);
}

/**
 * Line index of Pi ≥0.86's `<cwd>` section opening tag, or -1 when it wrote
 * none.
 *
 * Located by content, not document order: the section is accepted only when
 * the line inside it is exactly the parent's cwd and the closing tag follows,
 * so a `<cwd>` quoted elsewhere — or one naming a directory that merely
 * shares a prefix with the parent's — is not mistaken for it, the same
 * whole-line discipline the 0.85 footer anchor applies.
 */
function cwdSectionStart(lines: readonly string[], parentCwd: string): number {
  for (
    let openAt = lines.lastIndexOf(CWD_SECTION_OPEN);
    openAt !== -1;
    openAt = lines.lastIndexOf(CWD_SECTION_OPEN, openAt - 1)
  ) {
    if (
      lines[openAt + 1] === toPromptPath(parentCwd) &&
      lines[openAt + 2] === CWD_SECTION_CLOSE
    ) {
      return openAt;
    }
  }
  return -1;
}

/**
 * Line index of the `<skills>` section's opening tag, or the cwd section's own
 * opening when the parent resolved no skills.
 *
 * The catalogue section sits immediately below the cwd section in
 * `buildSystemPrompt`'s order, separated only by the section join, so the
 * closing tag on the other side of that join is Pi's own. Its opening is then
 * accepted only when the heading is its first content line, keeping a custom
 * section that merely ends where Pi's does from being taken for it. Cutting at
 * the opening tag — not at the heading inside it — drops the wrapper with the
 * layers it carries, and leaves the previous section's closing tag adjacent
 * to the tail for the project-context anchor.
 */
function skillsSectionWrapperStart(
  lines: readonly string[],
  cwdAt: number,
): number {
  let closeAt = cwdAt - 1;
  while (closeAt >= 0 && lines[closeAt] === "") closeAt--;
  if (closeAt < 0 || lines[closeAt] !== SKILLS_SECTION_CLOSE) return cwdAt;
  const openAt = lines.lastIndexOf(SKILLS_SECTION_OPEN, closeAt);
  if (openAt === -1 || lines[openAt + 1] !== SKILLS_SECTION_HEADING) return cwdAt;
  return openAt;
}

/**
 * Line index of the project-context block's opening tag, or -1 when the parent
 * session resolved no context files.
 *
 * Located by the same positional discipline as the catalogue: Pi writes the
 * block immediately before whichever session-resolved layer follows, so its
 * closing tag is the last non-blank line above the already-anchored tail. The
 * opening is then the nearest one above that tag carrying Pi's lead-in
 * sentence one or two lines below it — renderer-dependent, see
 * `PROJECT_CONTEXT_LEAD_IN` — which keeps a context file quoting the opening —
 * later in the document than the real one — from being taken for it.
 */
function projectContextStart(lines: readonly string[], tailAt: number): number {
  let closeAt = tailAt - 1;
  while (closeAt >= 0 && lines[closeAt] === "") closeAt--;
  if (closeAt < 0 || lines[closeAt] !== PROJECT_CONTEXT_CLOSE) return -1;
  for (
    let openAt = lines.lastIndexOf(PROJECT_CONTEXT_OPEN, closeAt);
    openAt !== -1;
    openAt = lines.lastIndexOf(PROJECT_CONTEXT_OPEN, openAt - 1)
  ) {
    if (
      lines[openAt + 2] === PROJECT_CONTEXT_LEAD_IN ||
      lines[openAt + 1] === PROJECT_CONTEXT_LEAD_IN
    ) {
      return openAt;
    }
  }
  return -1;
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

/**
 * The identity a child adopts when no parent contribution is usable, in both
 * prompt modes.
 *
 * Every agent type reaches this constant, so it can assert nothing about the
 * child's tools, domain, or task — a role sentence here described one built-in
 * agent type to all of them, and its capability list told a read-only child it
 * could write files (#904, the claim [ADR 0008] removed one constant above).
 * What it omits is supplied more accurately downstream: the `<active_agent>`
 * tag names the agent, the agent's own prompt states its role, and the tool
 * array — plus `@gotgenes/pi-permission-system`'s per-session block, when
 * installed — states its tools.
 */
const genericBase = `# Instructions
Do what has been asked; nothing more, nothing less.`;
