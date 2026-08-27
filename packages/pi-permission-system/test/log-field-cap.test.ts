import { describe, expect, test } from "vitest";
import {
  capLogFieldWidths,
  DEFAULT_REVIEW_LOG_FIELD_MAX_WIDTH,
  resolveReviewLogFieldWidth,
} from "#src/log-field-cap";

describe("resolveReviewLogFieldWidth", () => {
  test("falls back to the built-in default", () => {
    expect(resolveReviewLogFieldWidth({})).toBe(
      DEFAULT_REVIEW_LOG_FIELD_MAX_WIDTH,
    );
  });

  test("honors the operator's configured width", () => {
    expect(resolveReviewLogFieldWidth({ reviewLogFieldMaxWidth: 40 })).toBe(40);
  });

  test("defaults to the width that bounded the tool-input preview before it", () => {
    expect(DEFAULT_REVIEW_LOG_FIELD_MAX_WIDTH).toBe(1000);
  });
});

describe("capLogFieldWidths", () => {
  test("leaves a string within the width untouched", () => {
    expect(capLogFieldWidths({ command: "ls -la" }, 20)).toEqual({
      command: "ls -la",
    });
  });

  test("shortens an oversized string and marks it with an ellipsis", () => {
    expect(capLogFieldWidths({ command: "a".repeat(30) }, 10)).toEqual({
      command: `${"a".repeat(10)}\u2026`,
    });
  });

  test("applies the same width to every string, whatever the key", () => {
    expect(
      capLogFieldWidths(
        { command: "b".repeat(12), path: "c".repeat(12), event: "short" },
        5,
      ),
    ).toEqual({
      command: `${"b".repeat(5)}\u2026`,
      path: `${"c".repeat(5)}\u2026`,
      event: "short",
    });
  });

  test("bounds by length alone, never by what a value looks like", () => {
    const secretShaped = `sk-${"x".repeat(40)}`;
    const ordinary = "y".repeat(43);
    const capped = capLogFieldWidths(
      { a: secretShaped, b: ordinary },
      10,
    ) as Record<string, string>;
    expect(capped.a.length).toBe(capped.b.length);
  });

  test("passes non-string values through unchanged", () => {
    const details = {
      count: 42,
      enabled: true,
      missing: null,
      nothing: undefined,
    };
    expect(capLogFieldWidths(details, 2)).toEqual(details);
  });

  test("recurses into nested objects", () => {
    expect(
      capLogFieldWidths({ log: { details: { command: "d".repeat(9) } } }, 4),
    ).toEqual({ log: { details: { command: `${"d".repeat(4)}\u2026` } } });
  });

  test("recurses into arrays", () => {
    expect(capLogFieldWidths({ paths: ["e".repeat(7), "ok"] }, 3)).toEqual({
      paths: [`${"e".repeat(3)}\u2026`, "ok"],
    });
  });

  test("leaves the record untouched when nothing exceeds the width", () => {
    const details = { command: "ls", nested: { path: "." } };
    expect(capLogFieldWidths(details, 100)).toEqual(details);
  });
});
