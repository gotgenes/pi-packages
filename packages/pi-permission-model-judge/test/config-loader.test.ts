import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  getGlobalConfigPath,
  getProjectConfigPath,
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
    const result = loadModelJudgeConfig({ cwd, agentDir });
    expect(result).toEqual({ config: undefined, issues: [] });
  });

  it("loads a valid global config and applies defaults", () => {
    writeGlobal(VALID);
    const result = loadModelJudgeConfig({ cwd, agentDir });
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
    const result = loadModelJudgeConfig({ cwd, agentDir });
    expect(result.issues).toEqual([]);
    expect(result.config).toEqual({
      provider: "anthropic",
      model: "claude-sonnet",
      instructions: "Flag doubled path segments.",
      typoPatterns: ["project-pattern"],
      timeoutMs: 3000,
    });
  });

  it("does not read an untrusted project layer, even when it is malformed", () => {
    writeGlobal(VALID);
    writeProjectRaw("{ invalid json");
    const result = loadModelJudgeConfig({
      cwd,
      agentDir,
      includeProjectScope: false,
    });
    expect(result.issues).toEqual([]);
    expect(result.config?.instructions).toBe(VALID.instructions);
  });

  it("ignores every project field when project scope is excluded", () => {
    writeGlobal(VALID);
    writeProject({
      provider: "untrusted-provider",
      model: "untrusted-model",
      instructions: "untrusted instructions",
      typoPatterns: ["untrusted"],
      timeoutMs: 1,
    });
    expect(
      loadModelJudgeConfig({ cwd, agentDir, includeProjectScope: false })
        .config,
    ).toEqual({ ...VALID, typoPatterns: [], timeoutMs: 5000 });
  });

  it("does not activate a project-only config until project scope is included", () => {
    writeProject(VALID);
    expect(
      loadModelJudgeConfig({ cwd, agentDir, includeProjectScope: false }),
    ).toEqual({ config: undefined, issues: [] });
    expect(
      loadModelJudgeConfig({ cwd, agentDir, includeProjectScope: true }).config
        ?.instructions,
    ).toBe(VALID.instructions);
  });

  it("skips a malformed layer with an issue and loads the valid layer", () => {
    writeGlobal(VALID);
    writeProjectRaw("{ not valid json ");
    const result = loadModelJudgeConfig({ cwd, agentDir });
    expect(result.config?.model).toBe("claude-haiku");
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.sourcePath).toBe(getProjectConfigPath(cwd));
  });

  it("returns no config with issues when a present config is invalid", () => {
    writeGlobal({ provider: "anthropic", model: "claude-haiku" });
    const result = loadModelJudgeConfig({ cwd, agentDir });
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
    const result = loadModelJudgeConfig({ cwd, agentDir });
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
    const result = loadModelJudgeConfig({ cwd, agentDir });
    expect(result.config).toBeUndefined();
    expect(result.issues.length).toBeGreaterThan(0);
  });
});
