/**
 * The tool-surface region of a system prompt: which tools this session may
 * call, and the guidance those tools contribute.
 *
 * Pi writes that region near the top of its preamble, a few hundred characters
 * in. `@gotgenes/pi-subagents` copies everything ahead of the skills catalogue
 * into a child's prompt verbatim, so the child's leading bytes match its
 * parent's for prefix-reusing inference engines — which means editing the
 * region in place ends that shared prefix for every child whose allowed set
 * differs from its parent's (#890).
 *
 * So the region is *relocated* rather than narrowed: the sections Pi wrote are
 * removed wherever they sit, and this node's own are rendered at the end of
 * the prompt, past everything a child inherits. Each session then states its
 * own tool surface and no session edits another's bytes.
 *
 * Rendering follows `buildSystemPrompt`'s own rules — a tool is listed only
 * when it has a snippet, and the guideline bullets are the allowed tools' own
 * `promptGuidelines` around Pi's built-in ones — so the block reads as the one
 * Pi would have written for this session's real surface.
 */

/** What a session's tool surface renders from. */
export interface ToolSurfaceInputs {
  /** Tools this session may call, in the order they should be listed. */
  readonly allowedTools: readonly string[];
  /** Pi's one-line tool descriptions, keyed by tool name. */
  readonly toolSnippets: Readonly<Record<string, string>>;
  /** Guideline bullets each tool contributes, keyed by tool name. */
  readonly guidelinesByTool: ReadonlyMap<string, readonly string[]>;
}

type LineSection = {
  start: number;
  end: number;
};

const AVAILABLE_TOOLS_SECTION_HEADER = "Available tools:";
const GUIDELINES_SECTION_HEADER = "Guidelines:";

/**
 * Pi's filler sentence between the tool list and the guidelines.
 *
 * It refers to "the tools above", so it belongs with the list rather than with
 * the text the list is being moved out of.
 */
const CUSTOM_TOOLS_FILLER_PREFIX = "In addition to the tools above";

/** Pi's two unconditional guideline bullets, in the order it writes them. */
const UNIVERSAL_GUIDELINES: readonly string[] = [
  "Be concise in your responses",
  "Show file paths clearly when working with files",
];

/**
 * Relocate the tool surface: drop the sections Pi wrote, append this session's.
 *
 * The result always carries a tool-surface block, so a child whose inherited
 * identity has none — its parent's node having already relocated it — still
 * describes its own tools.
 */
export function renderToolSurface(
  systemPrompt: string | readonly string[],
  inputs: ToolSurfaceInputs,
): string {
  const lines = removeToolSurfaceSections(
    normalizePrompt(systemPrompt).split("\n"),
  );
  const body = collapseExtraBlankLines(lines.join("\n"));
  const block = renderToolSurfaceBlock(inputs);

  return body.length > 0 ? `${body}\n\n${block}` : block;
}

/**
 * Remove the `Available tools:` and `Guidelines:` sections, and the filler
 * sentence between them.
 *
 * Each section is located by its own header, so the two are removed whether
 * they sit adjacent in Pi's preamble or alone in a prompt something downstream
 * rewrote — including a prompt this function already produced, which is what
 * makes it safe to apply to its own output.
 */
function removeToolSurfaceSections(lines: readonly string[]): string[] {
  let remaining = [...lines];
  for (const header of [
    AVAILABLE_TOOLS_SECTION_HEADER,
    GUIDELINES_SECTION_HEADER,
  ]) {
    const section = findSection(remaining, header);
    if (section) {
      remaining = [
        ...remaining.slice(0, section.start),
        ...remaining.slice(section.end),
      ];
    }
  }

  return remaining.filter(
    (line) => !line.trimStart().startsWith(CUSTOM_TOOLS_FILLER_PREFIX),
  );
}

/** This session's tool surface, as Pi would have rendered it. */
function renderToolSurfaceBlock(inputs: ToolSurfaceInputs): string {
  const sections: string[] = [];

  const toolList = renderAvailableTools(inputs);
  if (toolList) {
    sections.push(toolList);
  }
  sections.push(renderGuidelines(inputs));

  return sections.join("\n\n");
}

/**
 * The `Available tools:` section for the allowed set, or `null` when none of
 * those tools has a snippet.
 *
 * Pi lists a tool only when the caller supplied a one-line snippet for it, so
 * a tool without one is left unlisted here too rather than rendered bare.
 */
function renderAvailableTools(inputs: ToolSurfaceInputs): string | null {
  const bullets = inputs.allowedTools
    .map((toolName) => ({ toolName, snippet: inputs.toolSnippets[toolName] }))
    .filter((tool) => Boolean(tool.snippet))
    .map((tool) => `- ${tool.toolName}: ${tool.snippet}`);

  return bullets.length > 0
    ? [AVAILABLE_TOOLS_SECTION_HEADER, ...bullets].join("\n")
    : null;
}

/**
 * The `Guidelines:` section for the allowed set.
 *
 * Mirrors `buildSystemPrompt`'s assembly: its conditional file-exploration
 * bullet first, then each allowed tool's own contributions, then its two
 * unconditional bullets — de-duplicated in first-seen order, as Pi does.
 */
function renderGuidelines(inputs: ToolSurfaceInputs): string {
  const bullets: string[] = [];
  const seen = new Set<string>();
  const addGuideline = (guideline: string): void => {
    const normalized = guideline.trim();
    if (normalized.length === 0 || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    bullets.push(normalized);
  };

  const fileOperations = fileExplorationGuideline(new Set(inputs.allowedTools));
  if (fileOperations) {
    addGuideline(fileOperations);
  }

  for (const toolName of inputs.allowedTools) {
    for (const guideline of inputs.guidelinesByTool.get(toolName) ?? []) {
      addGuideline(guideline);
    }
  }

  for (const guideline of UNIVERSAL_GUIDELINES) {
    addGuideline(guideline);
  }

  return [
    GUIDELINES_SECTION_HEADER,
    ...bullets.map((bullet) => `- ${bullet}`),
  ].join("\n");
}

/**
 * Pi's shell-only file-exploration bullet, or `null` when it does not apply.
 *
 * Pi writes it only when a shell is available and none of the dedicated
 * exploration tools is, so a session holding `grep`/`find`/`ls` is not told to
 * reach for the shell instead.
 */
function fileExplorationGuideline(
  allowedTools: ReadonlySet<string>,
): string | null {
  const hasBash = allowedTools.has("bash");
  const hasPowerShell = allowedTools.has("powershell");
  const hasExplorationTool =
    allowedTools.has("grep") ||
    allowedTools.has("find") ||
    allowedTools.has("ls");

  if ((!hasBash && !hasPowerShell) || hasExplorationTool) {
    return null;
  }
  if (hasBash && hasPowerShell) {
    return "Use bash or PowerShell for file operations like listing, searching, and finding files";
  }
  if (hasPowerShell) {
    return "Use PowerShell for file operations like listing, searching, and finding files";
  }
  return "Use bash for file operations like ls, rg, find";
}

/** Normalize Pi/OMP prompt payloads to the string expected by this renderer. */
export function normalizePrompt(prompt: string | readonly string[]): string {
  if (typeof prompt === "string") {
    return prompt.replace(/\r\n/g, "\n");
  }

  if (Array.isArray(prompt)) {
    return prompt
      .filter((part): part is string => typeof part === "string")
      .join("\n")
      .replace(/\r\n/g, "\n");
  }

  return "";
}

function collapseExtraBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trimEnd();
}

function isTopLevelSectionHeader(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length > 0 && trimmed.endsWith(":") && !trimmed.startsWith("-")
  );
}

function isSectionBodyLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true; // blank line
  if (trimmed.startsWith("- ")) return true; // bullet
  if (line !== line.trimStart()) return true; // indented
  return false;
}

function findSection(
  lines: readonly string[],
  header: string,
): LineSection | null {
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    return null;
  }

  // If a subsequent recognised section header exists, use it as the boundary.
  // This preserves the original behaviour for the common case where sections
  // are adjacent (e.g. "Available tools:" followed by "Guidelines:") and
  // ensures any prose continuation between the two headers is also removed.
  for (let index = start + 1; index < lines.length; index += 1) {
    if (isTopLevelSectionHeader(lines[index])) {
      return { start, end: index };
    }
  }

  // No subsequent section header — stop at the first non-body line so that
  // content after the section (e.g. custom user notes) is not silently deleted.
  let end = start + 1;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (!isSectionBodyLine(lines[index])) {
      end = index;
      break;
    }
    end = index + 1;
  }

  return { start, end };
}
