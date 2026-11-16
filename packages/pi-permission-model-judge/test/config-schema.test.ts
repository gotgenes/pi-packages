import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  buildModelJudgeJsonSchema,
  modelJudgeConfigSchema,
} from "#src/config-schema";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("buildModelJudgeJsonSchema", () => {
  it("matches the committed schemas/model-judge.schema.json", () => {
    const committed = JSON.parse(
      readFileSync(
        join(packageRoot, "schemas", "model-judge.schema.json"),
        "utf-8",
      ),
    ) as Record<string, unknown>;
    expect(committed).toEqual(buildModelJudgeJsonSchema());
  });
});

describe("array size bounds", () => {
  const VALID = {
    provider: "anthropic",
    model: "claude-haiku",
    instructions: "Flag doubled path segments.",
  };
  const repeat = (n: number, fill: string): string[] =>
    Array.from({ length: n }, () => fill);

  it("accepts 1000 typoPatterns", () => {
    const result = modelJudgeConfigSchema.safeParse({
      ...VALID,
      typoPatterns: repeat(1000, "x"),
    });
    expect(result.success).toBe(true);
  });

  it("rejects 1001 invalid typoPatterns with one size issue and no element issue", () => {
    const result = modelJudgeConfigSchema.safeParse({
      ...VALID,
      typoPatterns: repeat(1001, ""),
    });
    expect(
      result.error?.issues.map(({ code, path }) => ({ code, path })),
    ).toEqual([{ code: "too_big", path: ["typoPatterns"] }]);
  });
});

describe("config/config.example.json", () => {
  it("validates against the schema", () => {
    const example = JSON.parse(
      readFileSync(join(packageRoot, "config", "config.example.json"), "utf-8"),
    ) as Record<string, unknown>;
    const { $schema: _schema, ...rest } = example;
    const result = modelJudgeConfigSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });
});
