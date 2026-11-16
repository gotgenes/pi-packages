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
  /** The parent's working directory — the cwd its prompt's `<cwd>` section names. */
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

/** Opening tag of the section Pi wraps the catalogue in. */
const SKILLS_SECTION_OPEN = "<skills>";

/** Closing tag of that section. */
const SKILLS_SECTION_CLOSE = "</skills>";

/** Opening tag of the section Pi renders the working directory into. */
const CWD_SECTION_OPEN = "<cwd>";

/** Closing tag of that section. */
const CWD_SECTION_CLOSE = "</cwd>";

/** Opening tag of the section Pi lists the session's tools in. */
const TOOLS_SECTION_OPEN = "<tools>";

/** Closing tag of that section. */
const TOOLS_SECTION_CLOSE = "</tools>";

/** Opening tag of the section Pi writes the session's guidelines in. */
const RULES_SECTION_OPEN = "<rules>";

/** Closing tag of that section. */
const RULES_SECTION_CLOSE = "</rules>";

/**
 * Opening tags of the sections Pi renders below `<rules>`, in its
 * order: `<docs>`, the `--append-system-prompt` addendum, project context,
 * the skills catalogue, and the cwd.
 */
const SECTIONS_BELOW_RULES: ReadonlySet<string> = new Set([
  "<docs>",
  "<addendum>",
  "<project_context>",
  "<skills>",
  "<cwd>",
]);

/** Opening tag of the block Pi renders the session's context files into. */
const PROJECT_CONTEXT_OPEN = "<project_context>";

/** Closing tag of that block. */
const PROJECT_CONTEXT_CLOSE = "</project_context>";

/** The sentence Pi writes directly below the opening tag. */
const PROJECT_CONTEXT_LEAD_IN = "Project-specific instructions and guidelines:";

/**
 * Reduce an inherited prompt to the identity a child may adopt as its own.
 *
 * Pi's `buildSystemPrompt` ends every prompt with sections it resolves per
 * session — the `<available_skills>` catalogue inside a `<skills>` section,
 * then a `<cwd>` section — and extensions add further sections after those
 * from `before_agent_start`, rebuilt on every turn. The child's own session
 * rebuilds all of it against the child's directory, tool set, and extensions,
 * so an inherited copy is a second, stale claim of each: a catalogue naming
 * skills the child may not have (#801), and a working directory that walks a
 * workspace-isolated child back into the parent's (#640).
 *
 * Everything from the first such layer onward is therefore dropped. What
 * precedes it is returned byte for byte, so it stays a shared prefix with the
 * parent's prompt for hosts that reuse one over the system text (#180, #400).
 *
 * One exception sits inside that region: Pi renders the session's tool
 * surface as `<tools>` and `<rules>` sections just below the preamble.
 * They are as session-resolved as the catalogue, so they are excised rather
 * than inherited (ADR 0011); the shared prefix then ends at the preamble for a
 * parent that renders them, and is unchanged for one that does not.
 *
 * A prompt carrying no such layer is returned unchanged.
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
  const tail = sessionResolvedTailStart(lines, parentCwd, cutProjectContext);
  if (tail.at === -1) return prompt;
  const head = lines.slice(0, tail.at);
  const kept = tail.shape === "section" ? withoutToolSurface(head) : head;
  return kept.join("\n").trimEnd();
}

/**
 * The head with Pi's `<tools>` and `<rules>` sections excised, or the
 * head unchanged when Pi wrote neither there.
 *
 * Both sections are rendered from the parent session's own tool set, and Pi
 * writes neither for a child, whose prompt is a `customPrompt` — so an
 * inherited copy is the parent's tool surface presented as the child's.
 *
 * Located positionally, like every other anchor here: Pi writes the pair
 * adjacent, `<rules>` one blank line below `</tools>`, and above every later
 * section it renders. A pair quoted in an addendum or a context file sits below
 * that bound, and a lone `<tools>` block is not Pi's. The blank line below
 * `</rules>` goes with the pair, so the head reads exactly as Pi renders it
 * without them.
 */
function withoutToolSurface(head: readonly string[]): readonly string[] {
  const bound = laterSectionStart(head);
  const toolsAt = head.indexOf(TOOLS_SECTION_OPEN);
  if (toolsAt === -1 || toolsAt >= bound) return head;
  const toolsCloseAt = head.indexOf(TOOLS_SECTION_CLOSE, toolsAt);
  if (toolsCloseAt === -1 || toolsCloseAt >= bound) return head;
  const rulesAt = toolsCloseAt + 2;
  if (head[toolsCloseAt + 1] !== "" || head[rulesAt] !== RULES_SECTION_OPEN) {
    return head;
  }
  const rulesCloseAt = head.indexOf(RULES_SECTION_CLOSE, rulesAt);
  if (rulesCloseAt === -1 || rulesCloseAt >= bound) return head;
  const spanEnd = head[rulesCloseAt + 1] === "" ? rulesCloseAt + 2 : rulesCloseAt + 1;
  return [...head.slice(0, toolsAt), ...head.slice(spanEnd)];
}

/**
 * Line index of the first section Pi renders below `<rules>`, or the line
 * count when the head carries none of them.
 */
function laterSectionStart(head: readonly string[]): number {
  const at = head.findIndex((line) => SECTIONS_BELOW_RULES.has(line));
  return at === -1 ? head.length : at;
}

/**
 * What anchored the session-resolved tail: Pi's `<cwd>` section, or nothing
 * (a prompt an extension replaced).
 */
type PromptShape = "section" | "unanchored";

/** Where the session-resolved tail begins, and the prompt shape that placed it. */
interface AnchoredTail {
  /** Line index at which the tail begins, or -1 when none is present. */
  readonly at: number;
  readonly shape: PromptShape;
}

/**
 * Where Pi's per-session layers begin, and the prompt shape that anchored them.
 *
 * `cutProjectContext` moves the cut one layer earlier, to a `<project_context>`
 * block directly above the anchored tail.
 */
function sessionResolvedTailStart(
  lines: readonly string[],
  parentCwd: string,
  cutProjectContext: boolean,
): AnchoredTail {
  const tail = cwdAnchoredTailStart(lines, parentCwd);
  if (!cutProjectContext || tail.at === -1) return tail;
  const projectContextAt = projectContextStart(lines, tail.at);
  return projectContextAt === -1 ? tail : { ...tail, at: projectContextAt };
}

/**
 * Where Pi's per-session layers begin — a line index, or -1 when none is
 * present — and whether the parent's `<cwd>` section anchored them.
 *
 * Pi renders the catalogue's `<skills>` section immediately above the `<cwd>`
 * section, so the cwd section anchors the cut, and the name records that
 * anchor to read apart from the `sessionResolvedTailStart` above it, which
 * extends the cut past it.
 *
 * A prompt with no `<cwd>` section naming the parent's directory is not the one
 * Pi rendered: a `before_agent_start` handler returned its own text, which Pi
 * uses as the session's forced prompt. The catalogue is then located without
 * an anchor.
 */
function cwdAnchoredTailStart(
  lines: readonly string[],
  parentCwd: string,
): AnchoredTail {
  const cwdAt = cwdSectionStart(lines, parentCwd);
  if (cwdAt !== -1) {
    return { at: skillsSectionWrapperStart(lines, cwdAt), shape: "section" };
  }
  return { at: unanchoredCatalogueStart(lines), shape: "unanchored" };
}

/**
 * Line index of Pi's `<cwd>` section opening tag, or -1 when it wrote none.
 *
 * Located by content, not document order: the section is accepted only when
 * the line inside it is exactly the parent's cwd and the closing tag follows,
 * so a `<cwd>` quoted elsewhere — or one naming a directory that merely
 * shares a prefix with the parent's — is not mistaken for it. The comparison
 * mirrors the separator normalization `buildSystemPrompt` applies.
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
 * sentence directly below it, which keeps a context file quoting the opening —
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
    if (lines[openAt + 1] === PROJECT_CONTEXT_LEAD_IN) return openAt;
  }
  return -1;
}

/**
 * Line index where the catalogue begins in a prompt no `<cwd>` section
 * anchors — Pi's `<skills>` wrapper when the heading opens one, otherwise the
 * heading — or -1 when it carries no catalogue.
 *
 * With no anchor to locate Pi's own catalogue by position, the last closing
 * tag is the best remaining guess. The heading is located by searching back
 * from it, so prose quoting Pi's heading ahead of the catalogue is not
 * mistaken for it. Cutting at the wrapper leaves no stray `<skills>` line in
 * the identity, and leaves the section above it adjacent to the cut for the
 * project-context anchor.
 */
function unanchoredCatalogueStart(lines: readonly string[]): number {
  const catalogueEnd = lines.lastIndexOf(SKILLS_CATALOGUE_CLOSE);
  if (catalogueEnd === -1) return -1;
  const headingAt = lines.lastIndexOf(SKILLS_SECTION_HEADING, catalogueEnd);
  if (headingAt === -1) return -1;
  return lines[headingAt - 1] === SKILLS_SECTION_OPEN ? headingAt - 1 : headingAt;
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
