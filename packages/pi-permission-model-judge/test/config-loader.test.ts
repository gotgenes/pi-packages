import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getGlobalConfigPath,
  getProjectConfigPath,
  type LoadConfigResult,
  loadModelJudgeConfig,
} from "#src/config-loader";

const VALID = {
  provider: "anthropic",
  model: "claude-haiku",
  instructions: "Flag doubled path segments.",
};

describe("loadModelJudgeConfig", () => {
  let root: string;
  let agentDir: string;
  let cwd: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "model-judge-config-"));
    agentDir = join(root, "agent");
    cwd = join(root, "project");
    mkdirSync(agentDir, { recursive: true });
    mkdirSync(cwd, { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function load(projectTrusted = true): LoadConfigResult {
    return loadModelJudgeConfig({ cwd, agentDir, projectTrusted });
  }

  function writeGlobal(value: unknown): void {
    const path = getGlobalConfigPath(agentDir);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  }

  function writeProject(value: unknown): void {
    const path = getProjectConfigPath(cwd);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  }

  function writeProjectRaw(text: string): void {
    const path = getProjectConfigPath(cwd);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, text);
  }

  it("returns no config and no issues when neither file exists", () => {
    const result = load();
    expect(result).toEqual({ config: undefined, issues: [] });
  });

  it("loads a valid global config and applies defaults", () => {
    writeGlobal(VALID);
    const result = load();
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual({
      provider: "anthropic",
      model: "claude-haiku",
      instructions: "Flag doubled path segments.",
      typoPatterns: [],
      timeoutMs: 5000,
    });
  });

  it("lets project config override global scalars and replace arrays", () => {
    writeGlobal({
      ...VALID,
      model: "claude-haiku",
      typoPatterns: ["global-pattern"],
      timeoutMs: 3000,
    });
    writeProject({
      ...VALID,
      model: "claude-sonnet",
      typoPatterns: ["project-pattern"],
    });
    const result = load();
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual({
      provider: "anthropic",
      model: "claude-sonnet",
      instructions: "Flag doubled path segments.",
      typoPatterns: ["project-pattern"],
      timeoutMs: 3000,
    });
  });

  it("skips a malformed layer with an issue and loads the valid layer", () => {
    writeGlobal(VALID);
    writeProjectRaw("{ not valid json ");
    const result = load();
    expect(result.config?.model).toBe("claude-haiku");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.sourcePath).toBe(getProjectConfigPath(cwd));
  });

  it("returns no config with issues when a present config is invalid", () => {
    writeGlobal({ provider: "anthropic", model: "claude-haiku" });
    const result = load();
    expect(result.config).toBeUndefined();
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.issues.some((i) => i.path.includes("instructions"))).toBe(
      true,
    );
  });

  it("rejects a project file whose typoPatterns exceed 1,000 entries, with one issue", () => {
    writeProject({
      ...VALID,
      typoPatterns: Array.from({ length: 1001 }, () => ""),
    });
    const result = load();
    expect(result).toEqual({
      config: undefined,
      issues: [
        {
          path: "typoPatterns",
          message: "Too big: expected array to have <=1000 items",
        },
      ],
    });
  });

  it("rejects an empty typoPatterns entry", () => {
    writeGlobal({ ...VALID, typoPatterns: [""] });
    const result = load();
    expect(result.config).toBeUndefined();
    expect(result.issues.length).toBeGreaterThan(0);
  });

  describe("an untrusted project", () => {
    it("ignores the project layer and loads the global config alone", () => {
      writeGlobal({
        ...VALID,
        model: "claude-haiku",
        typoPatterns: ["global-pattern"],
        timeoutMs: 3000,
      });
      writeProject({
        ...VALID,
        model: "claude-sonnet",
        typoPatterns: ["project-pattern"],
        timeoutMs: 9000,
      });
      const result = load(false);
      expect(result.issues).toEqual([]);
      expect(result.config).toEqual({
        provider: "anthropic",
        model: "claude-haiku",
        instructions: "Flag doubled path segments.",
        typoPatterns: ["global-pattern"],
        timeoutMs: 3000,
      });
    });

    it("never parses the project file, so a malformed one records no issue", () => {
      writeGlobal(VALID);
      writeProjectRaw("{ not valid json ");
      const result = load(false);
      expect(result.issues).toEqual([]);
      expect(result.config?.model).toBe("claude-haiku");
    });

    it("yields no config when only the project file exists", () => {
      writeProject(VALID);
      const result = load(false);
      expect(result.config).toBeUndefined();
      expect(result.issues).toEqual([]);
    });
  });

  describe("the skipped project config path", () => {
    it("names the project file when untrusted beside a valid global config", () => {
      writeGlobal(VALID);
      writeProject(VALID);
      expect(load(false).untrustedProjectConfigPath).toBe(
        getProjectConfigPath(cwd),
      );
    });

    it("names the project file when untrusted and it is the only file", () => {
      writeProject(VALID);
      expect(load(false).untrustedProjectConfigPath).toBe(
        getProjectConfigPath(cwd),
      );
    });

    it("names the project file when untrusted beside an invalid global config", () => {
      writeGlobal({ provider: "anthropic" });
      writeProjectRaw("{ not valid json ");
      expect(load(false).untrustedProjectConfigPath).toBe(
        getProjectConfigPath(cwd),
      );
    });

    it("is absent when untrusted and there is no project file", () => {
      writeGlobal(VALID);
      expect(load(false).untrustedProjectConfigPath).toBeUndefined();
    });

    it("is absent when the project is trusted", () => {
      writeGlobal(VALID);
      writeProject(VALID);
      expect(load(true).untrustedProjectConfigPath).toBeUndefined();
    });
  });
});
