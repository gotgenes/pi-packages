import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { applyEdits, type ModificationOptions, modify } from "jsonc-parser";
import {
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
} from "#src/logging/log-file-permissions";
import {
  parseUnifiedConfigText,
  type UnifiedConfigLoadResult,
} from "./config-loader";

const EDIT_OPTIONS: ModificationOptions = {
  getInsertionIndex: () => 0,
  formattingOptions: { insertSpaces: true, tabSize: 2, eol: "\n" },
};

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
 * The edit is made in the file's text, so comments, formatting, and key
 * order survive; a key not yet present is inserted at the top of the object,
 * where it cannot disturb a neighbor's layout or trailing comment.
 *
 * A file that exists but fails to read, parse, or validate is refused rather
 * than overwritten, and so is an edit whose result would not validate or
 * would not read back as exactly the original plus `values`. An absent file
 * is created.
 */
export function writeConfigValues(
  path: string,
  values: Readonly<Record<string, unknown>>,
): ConfigWriteResult {
  let existing: UnifiedConfigLoadResult = { config: {}, issues: [] };
  let existingText: string | undefined;
  if (existsSync(path)) {
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

  const candidate =
    existingText === undefined
      ? `${setTopLevelValues("", values)}\n`
      : setTopLevelValues(existingText, values);
  const result = parseUnifiedConfigText(candidate, path);
  if (result.issues.length > 0) {
    return { kind: "refused", issues: result.issues };
  }
  if (!isDeepStrictEqual(result.config, { ...existing.config, ...values })) {
    return {
      kind: "refused",
      issues: [
        `Editing '${path}' in place would change content the save does not set (a duplicated key?).`,
      ],
    };
  }

  return replaceFile(path, candidate);
}

/**
 * Set each of `values` at the top level of the JSONC `text`. Keys are applied
 * last to first, each inserted at index 0, so new keys read in the order given.
 */
function setTopLevelValues(
  text: string,
  values: Readonly<Record<string, unknown>>,
): string {
  return Object.entries(values)
    .toReversed()
    .reduce(
      (edited, [key, value]) =>
        applyEdits(edited, modify(edited, [key], value, EDIT_OPTIONS)),
      text,
    );
}

/**
 * Replace `path` atomically with an owner-only file: write a uniquely named
 * temporary file created exclusively, flush it to disk, then rename it over
 * the target, so a reader sees the old file or the new one and never a part.
 */
function replaceFile(path: string, content: string): ConfigWriteResult {
  const tmpPath = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    mkdirSync(dirname(path), {
      recursive: true,
      mode: OWNER_ONLY_DIRECTORY_MODE,
    });
    fd = openSync(tmpPath, "wx", OWNER_ONLY_FILE_MODE);
    writeFileSync(fd, content, "utf-8");
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, path);
    return { kind: "written" };
  } catch (error) {
    try {
      if (fd !== undefined) closeSync(fd);
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
