import { getNonEmptyString, toRecord } from "#src/value-guards";
import { countTextLines, formatCount } from "./tool-input-preview";

export function getPromptPath(input: Record<string, unknown>): string | null {
  return getNonEmptyString(input.path) ?? getNonEmptyString(input.file_path);
}

export function formatEditInputForPrompt(
  input: Record<string, unknown>,
): string {
  const path = getPromptPath(input);
  const rawEdits = Array.isArray(input.edits)
    ? input.edits
    : typeof input.oldText === "string" && typeof input.newText === "string"
      ? [{ oldText: input.oldText, newText: input.newText }]
      : [];

  const edits = rawEdits
    .map((edit) => toRecord(edit))
    .filter(
      (edit) =>
        typeof edit.oldText === "string" && typeof edit.newText === "string",
    );

  const pathPart = path ? `for '${path}'` : "";
  if (edits.length === 0) {
    return pathPart ? `${pathPart} with edit input` : "with edit input";
  }

  const firstEdit = edits[0];
  const oldText = String(firstEdit.oldText);
  const newText = String(firstEdit.newText);
  const firstEditSummary = `edit #1 replaces ${formatCount(countTextLines(oldText), "line", "lines")} with ${formatCount(countTextLines(newText), "line", "lines")}`;
  const extraEdits =
    edits.length > 1
      ? `, plus ${formatCount(edits.length - 1, "additional edit", "additional edits")}`
      : "";
  const summary = `(${formatCount(edits.length, "replacement", "replacements")}: ${firstEditSummary}${extraEdits})`;
  return pathPart ? `${pathPart} ${summary}` : summary;
}

export function formatWriteInputForPrompt(
  input: Record<string, unknown>,
): string {
  const path = getPromptPath(input);
  const content = typeof input.content === "string" ? input.content : "";
  const summary = `(${formatCount(countTextLines(content), "line", "lines")}, ${formatCount(content.length, "character", "characters")})`;
  return path ? `for '${path}' ${summary}` : summary;
}

export function formatReadInputForPrompt(
  input: Record<string, unknown>,
): string {
  const path = getPromptPath(input);
  const parts = path ? [`path '${path}'`] : [];
  if (typeof input.offset === "number") {
    parts.push(`offset ${input.offset}`);
  }
  if (typeof input.limit === "number") {
    parts.push(`limit ${input.limit}`);
  }
  return parts.length > 0 ? `for ${parts.join(", ")}` : "";
}
