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
 * removed, and this node's own are rendered at the end of the prompt, past
 * everything a child inherits. Each session then states its own tool surface
 * and no session edits another's bytes.
 *
 * Removal is bounded to the text this package or Pi wrote. The prompt is split
 * at Pi's `Current working directory:` footer, which it writes last and
 * unconditionally: everything after it was appended by an extension, and
 * everything before it is Pi's own preamble only when Pi did not build the
 * prompt from a `customPrompt`. Under a custom prompt Pi writes no tool
 * surface at all, so a section matched above the footer is a user's or another
 * extension's — removing it destroyed their text (#919, #932).
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
  /**
   * Whether Pi wrote the prompt's preamble itself.
   *
   * False when Pi assembled the prompt from `customPrompt` — a user's
   * SYSTEM.md, or a subagent child's assembled prompt — in which case Pi wrote
   * no tool-surface sections and every line above its footer belongs to
   * somebody else.
   */
  readonly piAuthoredPreamble: boolean;
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

/** What Pi writes under `Available tools:` when no selected tool has a snippet. */
const EMPTY_LIST_PLACEHOLDER = "(none)";

/**
 * The first line of the footer Pi writes last, in both of its branches.
 *
 * It is the boundary between what Pi assembled and what extensions appended
 * after it — the same anchor `@gotgenes/pi-subagents` uses to find Pi's
 * session-resolved tail.
 */
const PROMPT_FOOTER_PREFIX = "Current working directory: ";

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
  const lines = normalizePrompt(systemPrompt).split("\n");
  const tailStart = extensionTailStart(lines);
  const body = [
    settleRegion(lines.slice(0, tailStart), inputs.piAuthoredPreamble),
    settleRegion(lines.slice(tailStart), true),
  ]
    .filter((region) => region.length > 0)
    .join("\n")
    .trimEnd();
  const block = renderToolSurfaceBlock(inputs);

  return body.length > 0 ? `${body}\n\n${block}` : block;
}

/**
 * Where the text extensions appended begins: the line after Pi's footer, or
 * the end of the prompt when nothing downstream left one.
 *
 * The last footer is Pi's own — it appends one after everything it assembled,
 * so a line of the same shape in a custom prompt is always above it.
 *
 * Accepted edge: a prompt carrying no footer at all is treated as all head, so
 * a block appended to *that* prompt cannot be found and replaced, and a custom
 * preamble would collect a second one. Pi writes the footer last and in both
 * branches, so reaching this needs a downstream rewrite of Pi's whole output —
 * which has already broken `@gotgenes/pi-subagents`' identity anchor, since it
 * reads the same line.
 */
function extensionTailStart(lines: readonly string[]): number {
  const footerAt = lines.findLastIndex((line) =>
    line.startsWith(PROMPT_FOOTER_PREFIX),
  );
  return footerAt === -1 ? lines.length : footerAt + 1;
}

/**
 * One region's surviving text: its sections removed, when they are ours to
 * remove.
 *
 * Blank runs are collapsed only where a removal opened one, so a region this
 * pass took nothing out of is returned exactly as it arrived rather than
 * reflowed by a pass that had nothing to do with it.
 */
function settleRegion(
  lines: readonly string[],
  removalAllowed: boolean,
): string {
  if (!removalAllowed) {
    return lines.join("\n");
  }
  const kept = removeToolSurfaceSections(lines);
  const text = kept.join("\n");
  return kept.length === lines.length ? text : collapseExtraBlankLines(text);
}

/**
 * Remove the `Available tools:` and `Guidelines:` sections, and the filler
 * sentence between them, from one region.
 *
 * Each section is located by its own header, so the two are removed whether
 * they sit adjacent in Pi's preamble or alone in the tail — including a block
 * this function already produced, which is what makes it safe to apply to its
 * own output, and what keeps it order-independent with a second writer.
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

/**
 * Whether the line belongs to the body of the section above it.
 *
 * Pi writes a section as its header, then bullets — or the `(none)` placeholder
 * when the list is empty — and separates it from what follows with a blank
 * line. Anything else is already outside the section, however it is punctuated:
 * a section that ran on to "the next line ending in a colon" swallowed the
 * prose in between, which is somebody else's text whenever the match was not
 * Pi's own (#919, #932).
 */
function isSectionBodyLine(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0) return true; // blank line
  if (trimmed.startsWith("- ")) return true; // bullet
  if (trimmed === EMPTY_LIST_PLACEHOLDER) return true; // Pi's empty list
  if (line !== line.trimStart()) return true; // indented
  return false;
}

/** The header line plus its own body, or `null` when the header is absent. */
function findSection(
  lines: readonly string[],
  header: string,
): LineSection | null {
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    return null;
  }

  let end = start + 1;
  while (end < lines.length && isSectionBodyLine(lines[end])) {
    end += 1;
  }

  return { start, end };
}
