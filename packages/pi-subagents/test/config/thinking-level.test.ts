import { clampThinkingLevel, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  parseThinkingLevel,
  THINKING_LEVELS,
  thinkingLevelError,
} from "#src/config/thinking-level";
import { makeModel } from "#test/helpers/make-model";

describe("THINKING_LEVELS", () => {
  it("lists every level the installed SDK offers without a capability gate", () => {
    // No thinkingLevelMap, so the SDK reports only its ungated levels. An ungated
    // level added upstream shows up here and is absent from THINKING_LEVELS.
    const ungated = getSupportedThinkingLevels(makeModel({ reasoning: true }));

    expect(THINKING_LEVELS).toEqual(expect.arrayContaining(ungated));
  });

  it("lists no level the installed SDK does not recognize", () => {
    // Every listed level is mapped, so the SDK gates none of them away. It clamps a
    // level missing from its own table down to "off", which is the signal here.
    const everyLevel = makeModel({
      reasoning: true,
      thinkingLevelMap: Object.fromEntries(THINKING_LEVELS.map((level) => [level, "x"])),
    });

    for (const level of THINKING_LEVELS) {
      expect(clampThinkingLevel(everyLevel, level)).toBe(level);
    }
  });
});

describe("parseThinkingLevel", () => {
  it.each([...THINKING_LEVELS])("accepts %s", (level) => {
    expect(parseThinkingLevel(level)).toBe(level);
  });

  it("accepts off, which the SDK honors but pi-ai's ThinkingLevel omits", () => {
    expect(parseThinkingLevel("off")).toBe("off");
  });

  it.each([
    ["an unknown word", "bananas"],
    ["the empty string", ""],
    ["a differently-cased level", "HIGH"],
    ["a level with surrounding space", " high "],
  ])("rejects %s", (_label, value) => {
    expect(parseThinkingLevel(value)).toBeUndefined();
  });

  it.each([
    ["a number", 3],
    ["null", null],
    ["undefined", undefined],
    ["an array of levels", ["high"]],
  ])("rejects %s", (_label, value) => {
    expect(parseThinkingLevel(value)).toBeUndefined();
  });
});

describe("thinkingLevelError", () => {
  it("names the rejected value and every valid level", () => {
    expect(thinkingLevelError("bananas")).toBe(
      'Invalid thinking level "bananas". Valid levels: off, minimal, low, medium, high, xhigh, max.',
    );
  });
});
