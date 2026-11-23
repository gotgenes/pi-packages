import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import {
  parseUnifiedConfigText,
  type UnifiedConfigLoadResult,
} from "./config-loader";

/** What became of a request to set values in a config file. */
export type ConfigWriteResult =
  | { kind: "written" }
  /** The file, or the edit, has problems; nothing was written. */
  | { kind: "refused"; issues: readonly string[] }
  /** The write itself failed; the file is as it was. */
  | { kind: "failed"; message: string };

/**
 * Set top-level `values` in the config file at `path`, leaving every other
 * key as it is (ADR 0016 §4).
 *
 * A file that exists but fails to read, parse, or validate is refused rather
 * than overwritten, and so is an edit whose result would not validate. An
 * absent file is created.
 */
export function writeConfigValues(
  path: string,
  values: Readonly<Record<string, unknown>>,
): ConfigWriteResult {
  let existing: UnifiedConfigLoadResult = { config: {}, issues: [] };
  if (existsSync(path)) {
    let existingText: string;
    try {
      existingText = readFileSync(path, "utf-8");
    } catch (error) {
      return {
        kind: "refused",
        issues: [`Failed to read config at '${path}': ${messageOf(error)}`],
      };
    }
    existing = parseUnifiedConfigText(existingText, path);
  }
  if (existing.issues.length > 0) {
    return { kind: "refused", issues: existing.issues };
  }

  const candidate = `${JSON.stringify({ ...existing.config, ...values }, null, 2)}\n`;
  const result = parseUnifiedConfigText(candidate, path);
  if (result.issues.length > 0) {
    return { kind: "refused", issues: result.issues };
  }

  return replaceFile(path, candidate);
}

function replaceFile(path: string, content: string): ConfigWriteResult {
  const tmpPath = `${path}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmpPath, content, "utf-8");
    renameSync(tmpPath, path);
    return { kind: "written" };
  } catch (error) {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup failures.
    }
    return { kind: "failed", message: messageOf(error) };
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
