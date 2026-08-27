import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  Theme,
} from "@earendil-works/pi-coding-agent";
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  truncateHead,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import type { SearchParams } from "#src/lib/args";
import type { AvailabilityState } from "#src/lib/availability";
import type { Exec } from "#src/lib/exec";
import { runSearch } from "#src/lib/search";
import { err, ok } from "#src/tool-result";

export interface ColGrepToolDetails {
  hitCount: number;
  truncated: boolean;
  fullOutputPath?: string;
}

export interface ColGrepExecuteDeps {
  exec: Exec;
  availability: AvailabilityState;
  /** Override default truncation line limit. Used in tests. */
  maxLines?: number;
  /** Override default truncation byte limit. Used in tests. */
  maxBytes?: number;
}

/**
 * Core execute logic, extracted for testability.
 * Called by the tool's `execute()` callback with `ctx.cwd` as cwd.
 */
export async function executeColGrepSearch(
  params: SearchParams,
  deps: ColGrepExecuteDeps,
  cwd: string,
  signal: AbortSignal | undefined,
) {
  if (!deps.availability.available) {
    return err(
      "colgrep is not installed or not available.\n" +
        "Install it from: https://github.com/lightonai/next-plaid#installation",
    );
  }

  if (!params.query && !params.regex) {
    return err("At least one of query or regex is required.");
  }

  const searchResult = await runSearch(deps.exec, params, cwd, signal);
  if (searchResult.error) {
    return err(searchResult.error);
  }

  const output = searchResult.output ?? "No matches found";
  const maxLines = deps.maxLines ?? DEFAULT_MAX_LINES;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const truncation = truncateHead(output, { maxLines, maxBytes });

  if (truncation.truncated) {
    const tempPath = join(tmpdir(), `colgrep-${Date.now()}.txt`);
    await writeFile(tempPath, output);
    const hitCount = countHits(output);
    return ok(`${truncation.content}\n[Truncated. Full output: ${tempPath}]`, {
      hitCount,
      truncated: true,
      fullOutputPath: tempPath,
    } satisfies ColGrepToolDetails);
  }

  const hitCount = countHits(output);
  return ok(output, {
    hitCount,
    truncated: false,
  } satisfies ColGrepToolDetails);
}

export interface RegisterColGrepDeps {
  exec: Exec;
  availability: AvailabilityState;
}

export function registerColGrep(
  pi: ExtensionAPI,
  deps: RegisterColGrepDeps,
): void {
  pi.registerTool({
    name: "colgrep",
    label: "ColGrep",
    description:
      "Search for code by meaning using semantic / hybrid search (ColBERT embeddings + tree-sitter). " +
      "Complements the built-in grep: use colgrep for intent-based exploration, grep for exact pattern matching. " +
      "At least one of query or regex is required.",
    promptSnippet:
      "Semantic and hybrid code search — find code by intent, not just text.",
    promptGuidelines: [
      "Prefer colgrep for intent-based searches and exploration (e.g. 'error handling for database connections').",
      "Use grep for exact pattern or symbol matching; use colgrep when keywords may not match exactly.",
      "colgrep: increase limit (default 15) when exploring a large codebase — try limit=30 for broader coverage.",
    ],
    parameters: Type.Object({
      query: Type.Optional(
        Type.String({
          description: "Semantic search query (natural language intent)",
        }),
      ),
      regex: Type.Optional(
        Type.String({
          description:
            "Regex pre-filter applied before semantic ranking (-e flag)",
        }),
      ),
      path: Type.Optional(
        Type.String({
          description: "Directory or file to search (defaults to cwd)",
        }),
      ),
      glob: Type.Optional(
        Type.String({ description: "Include glob pattern (--include flag)" }),
      ),
      limit: Type.Optional(
        Type.Number({ description: "Max results (-k flag, default: 15)" }),
      ),
      context: Type.Optional(
        Type.Number({ description: "Context lines (-n flag)" }),
      ),
    }),
    renderCall(args, theme, context) {
      const text =
        (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      text.setText(formatCall(args, theme));
      return text;
    },
    renderResult(result, options, theme, context) {
      const text =
        (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
      text.setText(formatResult(result, options, theme));
      return text;
    },
    async execute(
      _toolCallId,
      params,
      signal,
      _onUpdate,
      ctx: ExtensionContext,
    ) {
      return executeColGrepSearch(params, deps, ctx.cwd, signal);
    },
  });
}

// ---- rendering helpers ----

function formatCall(args: Record<string, unknown>, theme: Theme): string {
  const query = typeof args.query === "string" ? args.query : undefined;
  const regex = typeof args.regex === "string" ? args.regex : undefined;
  const path = typeof args.path === "string" ? args.path : ".";
  const limit = typeof args.limit === "number" ? args.limit : 15;

  const parts: string[] = [theme.fg("toolTitle", theme.bold("colgrep"))];
  if (query) parts.push(theme.fg("accent", `"${query}"`));
  if (regex) parts.push(theme.fg("accent", `-e /${regex}/`));
  parts.push(theme.fg("toolOutput", `in ${path} (k=${limit})`));
  return parts.join(" ");
}

interface AnyToolResult {
  content: Array<{ type: string; text?: string }>;
  details?: ColGrepToolDetails;
}

function formatResult(
  result: unknown,
  options: { expanded: boolean },
  theme: Theme,
): string {
  const r = result as AnyToolResult;
  const details = r.details;
  const hitCount = details?.hitCount ?? 0;
  const outputText =
    r.content[0]?.type === "text" ? (r.content[0].text ?? "") : "";

  if (!options.expanded) {
    const icon = theme.fg("success", "✓");
    const count =
      hitCount === 0
        ? theme.fg("muted", "no matches")
        : theme.fg("muted", `${hitCount} hit${hitCount === 1 ? "" : "s"}`);
    return `${icon} ${count}`;
  }

  const lines = outputText
    .split("\n")
    .map((l: string) => theme.fg("toolOutput", `  ${l}`));
  return lines.join("\n");
}

// ---- private helpers ----

function countHits(output: string): number {
  if (output === "No matches found") return 0;
  return output.split("\n").length;
}
