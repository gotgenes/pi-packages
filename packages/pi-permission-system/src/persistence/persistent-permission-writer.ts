import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { applyEdits, modify, type ParseError, parse } from "jsonc-parser";
import { unifiedConfigSchema } from "#src/config/config-schema";
import type { ApprovalGrant } from "#src/session/approval-grant";

export interface PersistentPermissionWriteRequest {
  path: string;
  expectedDir: string;
  /** Trusted containment root; defaults to expectedDir for direct callers. */
  expectedRoot?: string;
  grants: readonly ApprovalGrant[];
}

export interface PersistentPermissionWriteResult {
  path: string;
  restore(): void;
}

/** Atomically upsert human-approved allow rules into one JSONC config file. */
export class PersistentPermissionWriter {
  write(
    request: PersistentPermissionWriteRequest,
  ): PersistentPermissionWriteResult {
    const path = assertSafeDestination(
      request.path,
      request.expectedDir,
      request.expectedRoot ?? request.expectedDir,
    );
    const original = existsSync(path) ? readFileSync(path, "utf8") : null;
    const source = original ?? "{}\n";
    validateConfig(source);

    const candidate = addAllowRules(source, normalizeGrants(request.grants));
    validateConfig(candidate);
    atomicReplace(path, candidate);

    let restored = false;
    return {
      path,
      restore: () => {
        if (restored) return;
        restored = true;
        if (original === null) {
          if (existsSync(path)) unlinkSync(path);
          return;
        }
        atomicReplace(path, original);
      },
    };
  }
}

function assertSafeDestination(
  path: string,
  expectedDir: string,
  expectedRoot: string,
): string {
  const normalizedDir = resolve(expectedDir);
  const normalizedRoot = resolve(expectedRoot);
  const normalizedPath = resolve(path);
  const pathFromDir = relative(normalizedDir, normalizedPath);
  if (
    dirname(normalizedPath) !== normalizedDir ||
    pathFromDir.startsWith("..") ||
    isAbsolute(pathFromDir)
  ) {
    throw new Error(
      "Permission config destination is outside the expected directory.",
    );
  }

  mkdirSync(normalizedDir, { recursive: true, mode: 0o700 });
  const realRoot = realpathSync(normalizedRoot);
  const realParent = realpathSync(dirname(normalizedPath));
  const parentFromRoot = relative(realRoot, realParent);
  if (
    parentFromRoot.startsWith("..") ||
    isAbsolute(parentFromRoot) ||
    realParent !== realpathSync(normalizedDir)
  ) {
    throw new Error(
      "Permission config destination resolves outside the expected directory.",
    );
  }
  if (
    existsSync(normalizedPath) &&
    lstatSync(normalizedPath).isSymbolicLink()
  ) {
    throw new Error(
      "Permission config destination must not be a symbolic link.",
    );
  }
  return normalizedPath;
}

/** Trimmed, de-duplicated, and never blank; order is preserved. */
function normalizeGrants(grants: readonly ApprovalGrant[]): ApprovalGrant[] {
  const seen = new Set<string>();
  const normalized: ApprovalGrant[] = [];
  for (const grant of grants) {
    const pattern = grant.pattern.trim();
    const surface = grant.surface.trim();
    if (pattern === "" || surface === "") {
      throw new Error("At least one non-empty permission pattern is required.");
    }
    const key = `${surface}\u0000${pattern}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({ surface, pattern });
  }
  if (normalized.length === 0) {
    throw new Error("At least one non-empty permission pattern is required.");
  }
  return normalized;
}

function addAllowRules(
  source: string,
  grants: readonly ApprovalGrant[],
): string {
  let text = source;

  for (const { surface, pattern } of grants) {
    let parsed = parseConfig(text);
    const permission = asRecord(asRecord(parsed).permission);
    const existingSurface = permission[surface];

    // A string surface is shorthand for `{ "*": <action> }`; expanding it
    // keeps its meaning while making room for the new pattern.
    if (typeof existingSurface === "string") {
      text = applyModification(text, ["permission", surface], {
        "*": existingSurface,
      });
    }

    parsed = parseConfig(text);
    const surfaceRules = asRecord(
      asRecord(asRecord(parsed).permission)[surface],
    );
    // Remove then re-add so an existing identical pattern moves to the end,
    // where last-match-wins gives the approved rule its documented position.
    if (Object.hasOwn(surfaceRules, pattern)) {
      text = applyModification(
        text,
        ["permission", surface, pattern],
        undefined,
      );
    }
    text = applyModification(text, ["permission", surface, pattern], "allow");
  }

  return text;
}

function applyModification(
  source: string,
  path: (string | number)[],
  value: unknown,
): string {
  return applyEdits(
    source,
    modify(source, path, value, {
      formattingOptions: { insertSpaces: true, tabSize: 2 },
    }),
  );
}

function parseConfig(source: string): unknown {
  const errors: ParseError[] = [];
  const parsed = parse(source, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown;
  if (errors.length > 0) {
    throw new Error("Invalid permission config: malformed JSONC.");
  }
  return parsed;
}

function validateConfig(source: string): void {
  const parsed = parseConfig(source);
  const result = unifiedConfigSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid permission config: ${result.error.message}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function atomicReplace(path: string, content: string): void {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  let fd: number | null = null;
  try {
    fd = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(fd, content, "utf8");
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    renameSync(temporaryPath, path);
  } catch (error) {
    if (fd !== null) closeSync(fd);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
    throw error;
  }
}
