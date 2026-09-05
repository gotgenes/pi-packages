import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  OWNER_ONLY_DIRECTORY_MODE,
  OWNER_ONLY_FILE_MODE,
  restrictExistingPathToOwner,
} from "#src/logging/log-file-permissions";

describe("restrictExistingPathToOwner", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "pi-permission-system-modes-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  test("tightens a world-readable file to owner-only", () => {
    const filePath = join(baseDir, "review.jsonl");
    writeFileSync(filePath, "{}\n", "utf-8");
    chmodSync(filePath, 0o644);

    restrictExistingPathToOwner(filePath, OWNER_ONLY_FILE_MODE);

    expect(statSync(filePath).mode & 0o777).toBe(0o600);
  });

  test("tightens a world-readable directory to owner-only", () => {
    const dirPath = join(baseDir, "logs");
    mkdirSync(dirPath);
    chmodSync(dirPath, 0o755);

    restrictExistingPathToOwner(dirPath, OWNER_ONLY_DIRECTORY_MODE);

    expect(statSync(dirPath).mode & 0o777).toBe(0o700);
  });

  test("does not throw for a path that does not exist", () => {
    expect(() => {
      restrictExistingPathToOwner(
        join(baseDir, "absent.jsonl"),
        OWNER_ONLY_FILE_MODE,
      );
    }).not.toThrow();
  });

  test("exposes the POSIX owner-only modes", () => {
    expect(OWNER_ONLY_FILE_MODE).toBe(0o600);
    expect(OWNER_ONLY_DIRECTORY_MODE).toBe(0o700);
  });
});
