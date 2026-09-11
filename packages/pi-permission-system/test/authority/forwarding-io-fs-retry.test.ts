import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ensureDirectoryExists,
  writeJsonFileAtomic,
} from "#src/authority/forwarding-io";
import type { DebugReviewLogger } from "#src/logging/session-logger";

// ── node:fs seam ───────────────────────────────────────────────────────────

// Only `renameSync` is faked: every other export stays real, so the temp write,
// the mode bits, and the cleanup are exercised against a real filesystem.
const { renameSync, mkdirSync } = vi.hoisted(() => ({
  renameSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  renameSync,
  mkdirSync,
}));

const { renameSync: realRenameSync, mkdirSync: realMkdirSync } =
  await vi.importActual<typeof import("node:fs")>("node:fs");

// ── helpers ────────────────────────────────────────────────────────────────

/** An `fs`-shaped error: a plain `Error` carrying an errno `code`. */
function errnoError(code: string): Error {
  return Object.assign(new Error(`${code}: operation not permitted, rename`), {
    code,
  });
}

/** Fail the next `failures` renames with `code`, then let the real one run. */
function failRenames(failures: number, code: string): void {
  let calls = 0;
  renameSync.mockImplementation((from: string, to: string) => {
    calls += 1;
    if (calls <= failures) {
      throw errnoError(code);
    }
    realRenameSync(from, to);
  });
}

/** Fail the next `failures` mkdirs with `code`, then let the real one run. */
function failMkdirs(failures: number, code: string): void {
  let calls = 0;
  mkdirSync.mockImplementation(
    (path: string, options: Parameters<typeof realMkdirSync>[1]) => {
      calls += 1;
      if (calls <= failures) {
        throw errnoError(code);
      }
      return realMkdirSync(path, options);
    },
  );
}

function makeLogger(): DebugReviewLogger {
  return { review: vi.fn(), debug: vi.fn() };
}

// ── writeJsonFileAtomic under a transient file lock ────────────────────────

describe("writeJsonFileAtomic under a transient file lock", () => {
  let root: string;
  let logger: DebugReviewLogger;
  let filePath: string;

  beforeEach(() => {
    renameSync.mockReset();
    renameSync.mockImplementation(realRenameSync);
    root = mkdtempSync(join(tmpdir(), "io-retry-"));
    logger = makeLogger();
    filePath = join(root, "req.json");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("leaves an unrelated errno alone", () => {
    failRenames(1, "ENOSPC");

    expect(() => {
      writeJsonFileAtomic(logger, filePath, { id: "req-1" });
    }).toThrow("ENOSPC: operation not permitted, rename");

    expect(renameSync).toHaveBeenCalledOnce();
  });

  it("lands the file when the rename fails EPERM twice", () => {
    failRenames(2, "EPERM");

    writeJsonFileAtomic(logger, filePath, { id: "req-1" });

    expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual({
      id: "req-1",
    });
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    expect(readdirSync(root)).toEqual(["req.json"]);
  });

  it("records the recovery on the debug stream alone", () => {
    failRenames(2, "EPERM");

    writeJsonFileAtomic(logger, filePath, { id: "req-1" });

    expect(logger.debug).toHaveBeenCalledExactlyOnceWith(
      "permission_forwarding.fs_retried",
      { operation: "rename", path: filePath, attempts: 3, code: "EPERM" },
    );
    expect(logger.review).not.toHaveBeenCalled();
  });

  it("records nothing when the rename succeeds outright", () => {
    writeJsonFileAtomic(logger, filePath, { id: "req-1" });

    expect(logger.debug).not.toHaveBeenCalled();
    expect(logger.review).not.toHaveBeenCalled();
  });

  it("rethrows a lock that outlasts the budget, leaving no temp file and no partial destination", () => {
    failRenames(Number.POSITIVE_INFINITY, "EPERM");

    expect(() => {
      writeJsonFileAtomic(logger, filePath, { id: "req-1" });
    }).toThrow("EPERM: operation not permitted, rename");

    expect(existsSync(filePath)).toBe(false);
    expect(readdirSync(root)).toEqual([]);
  });
});

// ── ensureDirectoryExists under a transient file lock ──────────────────────

describe("ensureDirectoryExists under a transient file lock", () => {
  let root: string;
  let logger: DebugReviewLogger;
  let dirPath: string;

  beforeEach(() => {
    mkdirSync.mockReset();
    mkdirSync.mockImplementation(realMkdirSync);
    root = mkdtempSync(join(tmpdir(), "io-retry-dir-"));
    logger = makeLogger();
    dirPath = join(root, "sessions", "parent", "requests");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("creates the directory when mkdir fails EPERM once", () => {
    failMkdirs(1, "EPERM");

    expect(ensureDirectoryExists(logger, dirPath, "requests")).toBe(true);

    expect(statSync(dirPath).mode & 0o777).toBe(0o700);
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith(
      "permission_forwarding.fs_retried",
      { operation: "mkdir", path: dirPath, attempts: 2, code: "EPERM" },
    );
  });

  it("reports failure without throwing when the lock outlasts the budget", () => {
    failMkdirs(Number.POSITIVE_INFINITY, "EPERM");

    expect(ensureDirectoryExists(logger, dirPath, "requests")).toBe(false);

    expect(existsSync(dirPath)).toBe(false);
    expect(logger.review).toHaveBeenCalledExactlyOnceWith(
      "permission_forwarding.error",
      {
        message: `Failed to create requests directory '${dirPath}'`,
        error: "EPERM: operation not permitted, rename",
      },
    );
  });
});
