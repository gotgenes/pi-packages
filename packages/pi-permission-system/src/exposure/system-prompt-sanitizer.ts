export interface SanitizeSystemPromptResult {
  prompt: string;
  removed: boolean;
}

type LineSection = {
  start: number;
  end: number;
};

type GuidelineRule = {
  matches: (guideline: string) => boolean;
  shouldKeep: (allowedTools: ReadonlySet<string>) => boolean;
};

const AVAILABLE_TOOLS_SECTION_HEADER = "Available tools:";
const GUIDELINES_SECTION_HEADER = "Guidelines:";

const TOOL_GUIDELINE_RULES: readonly GuidelineRule[] = [
  {
    matches: (guideline) =>
      guideline === "use bash for file operations like ls, rg, find",
    shouldKeep: (allowedTools) => allowedTools.has("bash"),
  },
  {
    matches: (guideline) =>
      guideline ===
      "prefer grep/find/ls tools over bash for file exploration (faster, respects .gitignore)",
    shouldKeep: (allowedTools) =>
      allowedTools.has("bash") &&
      (allowedTools.has("grep") ||
        allowedTools.has("find") ||
        allowedTools.has("ls")),
  },
  {
    matches: (guideline) =>
      guideline ===
        "use read to examine files before editing. you must use this tool instead of cat or sed." ||
      guideline === "use read to examine files instead of cat or sed.",
    shouldKeep: (allowedTools) => allowedTools.has("read"),
  },
  {
    matches: (guideline) =>
      guideline ===
      "use edit for precise changes (old text must match exactly)",
    shouldKeep: (allowedTools) => allowedTools.has("edit"),
  },
  {
    matches: (guideline) =>
      guideline === "use write only for new files or complete rewrites",
    shouldKeep: (allowedTools) => allowedTools.has("write"),
  },
  {
    matches: (guideline) =>
      guideline ===
      "when summarizing your actions, output plain text directly - do not use cat or bash to display what you did",
    shouldKeep: (allowedTools) =>
      allowedTools.has("edit") || allowedTools.has("write"),
  },
  {
    matches: (guideline) =>
      guideline ===
      "use task when work should be delegated to one or more specialized agents instead of handled entirely in the current session.",
    shouldKeep: (allowedTools) => allowedTools.has("task"),
  },
  {
    matches: (guideline) =>
      guideline ===
      "use mcp for mcp discovery first: search by capability, describe one exact tool name, then call it.",
    shouldKeep: (allowedTools) => allowedTools.has("mcp"),
  },
];

function normalizePrompt(prompt: string): string {
  return (prompt || "").replace(/\r\n/g, "\n");
}

function collapseExtraBlankLines(text: string): string {
  return text.replace(/\n{3,}/g, "\n\n").trimEnd();
}

function normalizeGuidelineText(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
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

/**
 * Tool name from an `Available tools:` bullet (`- read: …` -> `read`), or
 * `null` for non-tool lines (blank lines, boilerplate prose). Matches the
 * first token after the bullet marker, with or without a trailing colon.
 */
function extractToolBulletName(line: string): string | null {
  const match = /^\s*-\s+([A-Za-z0-9_-]+)/.exec(line);
  return match ? match[1] : null;
}

/**
 * Narrow the `Available tools:` section to the allowed tools: keep allowed-tool
 * bullet lines and any non-tool prose, drop denied/inactive bullet lines. When
 * no tool bullet survives, remove the section header too. This mirrors what Pi
 * itself renders for the active tool set, so the result is byte-stable across
 * turns regardless of whether the input still carries the full default listing.
 */
function narrowAvailableToolsSection(
  lines: readonly string[],
  allowedTools: ReadonlySet<string>,
): { lines: string[]; removed: boolean } {
  const section = findSection(lines, AVAILABLE_TOOLS_SECTION_HEADER);
  if (!section) {
    return { lines: [...lines], removed: false };
  }

  const before = lines.slice(0, section.start);
  const header = lines[section.start];
  const body = lines.slice(section.start + 1, section.end);
  const after = lines.slice(section.end);

  const filteredBody = body.filter((line) => {
    const toolName = extractToolBulletName(line);
    if (toolName === null) {
      return true; // keep blank lines and non-tool boilerplate
    }
    return allowedTools.has(toolName);
  });

  const removed = filteredBody.length !== body.length;
  if (!removed) {
    return { lines: [...lines], removed: false };
  }

  const hasToolBullet = filteredBody.some(
    (line) => extractToolBulletName(line) !== null,
  );
  if (!hasToolBullet) {
    return { lines: [...before, ...after], removed: true };
  }

  return {
    lines: [...before, header, ...filteredBody, ...after],
    removed: true,
  };
}

function shouldKeepGuideline(
  line: string,
  allowedTools: ReadonlySet<string>,
): boolean {
  const normalized = normalizeGuidelineText(line);

  for (const rule of TOOL_GUIDELINE_RULES) {
    if (rule.matches(normalized)) {
      return rule.shouldKeep(allowedTools);
    }
  }

  return true;
}

function sanitizeGuidelinesSection(
  lines: readonly string[],
  allowedTools: ReadonlySet<string>,
): { lines: string[]; removed: boolean } {
  const section = findSection(lines, GUIDELINES_SECTION_HEADER);
  if (!section) {
    return { lines: [...lines], removed: false };
  }

  const before = lines.slice(0, section.start + 1);
  const after = lines.slice(section.end);
  const body = lines.slice(section.start + 1, section.end);
  const filteredBody = body.filter((line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith("- ")) {
      return true;
    }

    return shouldKeepGuideline(line, allowedTools);
  });

  const removed = filteredBody.length !== body.length;
  if (!removed) {
    return { lines: [...lines], removed: false };
  }

  const hasBullet = filteredBody.some((line) => line.trim().startsWith("- "));
  if (!hasBullet) {
    return {
      lines: [...lines.slice(0, section.start), ...after],
      removed: true,
    };
  }

  return {
    lines: [...before, ...filteredBody, ...after],
    removed: true,
  };
}

export function sanitizeAvailableToolsSection(
  systemPrompt: string,
  allowedToolNames: readonly string[],
): SanitizeSystemPromptResult {
  const allowedTools = new Set(
    allowedToolNames.map((toolName) => toolName.trim()).filter(Boolean),
  );
  const normalizedLines = normalizePrompt(systemPrompt).split("\n");
  const narrowedToolsSection = narrowAvailableToolsSection(
    normalizedLines,
    allowedTools,
  );
  const sanitizedGuidelines = sanitizeGuidelinesSection(
    narrowedToolsSection.lines,
    allowedTools,
  );
  const removed = narrowedToolsSection.removed || sanitizedGuidelines.removed;

  return {
    prompt: removed
      ? collapseExtraBlankLines(sanitizedGuidelines.lines.join("\n"))
      : systemPrompt,
    removed,
  };
}
