import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadAndMergeConfigs } from "#src/config-loader";
import { normalizePermissionSystemConfig } from "#src/extension-config";
import {
  DEFAULT_RENDER_BUDGET,
  resolveRenderBudget,
} from "#src/presentation/dialog-renderer";

/**
 * Full-pipeline seam tests: write a temp config.json → loadAndMergeConfigs →
 * normalizePermissionSystemConfig → assert values survive end to end.
 *
 * These tests guard the seam between the two normalizers — the class of bug
 * fixed in #332, where a field declared on PermissionSystemExtensionConfig was
 * silently dropped by the UnifiedPermissionConfig intermediate.
 */
describe("config pipeline seam", () => {
  let tempDir: string;
  let agentDir: string;
  let cwd: string;
  let extensionRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "config-pipeline-test-"));
    agentDir = join(tempDir, "agent");
    cwd = join(tempDir, "project");
    extensionRoot = join(tempDir, "ext");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function writeGlobal(content: Record<string, unknown>): void {
    const dir = join(agentDir, "extensions", "pi-permission-system");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "config.json"), JSON.stringify(content));
  }

  it("a runtime knob survives the full pipeline", () => {
    writeGlobal({ debugLog: true });

    const mergeResult = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    const config = normalizePermissionSystemConfig(mergeResult.merged);

    expect(config.debugLog).toBe(true);
  });

  // The deprecated caps traverse the pipeline backwards from every other field:
  // they must reach the merge intermediate (so the deprecation detector sees an
  // operator's setting) and stop there, never reaching a runtime consumer.
  it("a deprecated preview cap reaches the merge intermediate but not the runtime config", () => {
    writeGlobal({ toolInputPreviewMaxLength: 1000 });

    const mergeResult = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    const config = normalizePermissionSystemConfig(mergeResult.merged);

    expect(mergeResult.merged.toolInputPreviewMaxLength).toBe(1000);
    expect(config).not.toHaveProperty("toolInputPreviewMaxLength");
  });

  it("dialog budget fields survive the full pipeline and resolve to a render budget", () => {
    writeGlobal({ promptMaxRows: 12, promptFieldMaxWidth: 80 });

    const mergeResult = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    const config = normalizePermissionSystemConfig(mergeResult.merged);

    expect(config.promptMaxRows).toBe(12);
    expect(config.promptFieldMaxWidth).toBe(80);
    expect(resolveRenderBudget(config)).toEqual({
      maxRows: 12,
      fieldMaxWidth: 80,
    });
  });

  it("falls back to the default render budget when the config names neither field", () => {
    const mergeResult = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    const config = normalizePermissionSystemConfig(mergeResult.merged);

    expect(resolveRenderBudget(config)).toEqual(DEFAULT_RENDER_BUDGET);
  });

  it("a deprecated text-summary cap likewise stops at the merge intermediate", () => {
    writeGlobal({ toolTextSummaryMaxLength: 250 });

    const mergeResult = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    const config = normalizePermissionSystemConfig(mergeResult.merged);

    expect(mergeResult.merged.toolTextSummaryMaxLength).toBe(250);
    expect(config).not.toHaveProperty("toolTextSummaryMaxLength");
  });

  it("project config still overrides a global deprecated cap in the merge", () => {
    writeGlobal({ toolInputPreviewMaxLength: 200 });
    const projectDir = join(cwd, ".pi", "extensions", "pi-permission-system");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      join(projectDir, "config.json"),
      JSON.stringify({ toolInputPreviewMaxLength: 500 }),
    );

    const mergeResult = loadAndMergeConfigs(agentDir, cwd, extensionRoot);

    expect(mergeResult.merged.toolInputPreviewMaxLength).toBe(500);
  });

  it("defaults apply when config file is absent", () => {
    // No config files written — agentDir and cwd directories don't exist.
    const mergeResult = loadAndMergeConfigs(agentDir, cwd, extensionRoot);
    const config = normalizePermissionSystemConfig(mergeResult.merged);

    expect(config.debugLog).toBe(false);
    expect(config.permissionReviewLog).toBe(true);
    expect(config.yoloMode).toBe(false);
  });
});
