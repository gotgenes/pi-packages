import { describe, expect, test } from "vitest";
import { safeJsonStringify } from "#src/logging/json-safe-stringify";

describe("safeJsonStringify", () => {
  test("serializes a plain record", () => {
    expect(safeJsonStringify({ toolName: "write", allowed: true })).toBe(
      '{"toolName":"write","allowed":true}',
    );
  });

  test("returns undefined for a value JSON cannot represent", () => {
    expect(safeJsonStringify(undefined)).toBe(undefined);
    expect(safeJsonStringify(() => "noop")).toBe(undefined);
  });

  describe("Error values", () => {
    test("expands an Error into name, message, and stack", () => {
      const error = new Error("boom");
      error.stack = "Error: boom\n    at somewhere";

      expect(safeJsonStringify({ error })).toBe(
        '{"error":{"name":"Error","message":"boom","stack":"Error: boom\\n    at somewhere"}}',
      );
    });

    test("expands an Error at the root", () => {
      const error = new TypeError("bad type");
      error.stack = "trace";

      expect(safeJsonStringify(error)).toBe(
        '{"name":"TypeError","message":"bad type","stack":"trace"}',
      );
    });
  });

  describe("bigint values", () => {
    test("stringifies a bigint rather than throwing", () => {
      expect(safeJsonStringify({ size: 9007199254740993n })).toBe(
        '{"size":"9007199254740993"}',
      );
    });
  });

  describe("circular references", () => {
    test("replaces a self-reference with the [Circular] marker", () => {
      const node: Record<string, unknown> = { name: "root" };
      node.self = node;

      expect(safeJsonStringify(node)).toBe(
        '{"name":"root","self":"[Circular]"}',
      );
    });

    test("replaces a mutual reference cycle with the [Circular] marker", () => {
      const parent: Record<string, unknown> = { kind: "parent" };
      const child: Record<string, unknown> = { kind: "child", parent };
      parent.child = child;

      expect(safeJsonStringify(parent)).toBe(
        '{"kind":"parent","child":{"kind":"child","parent":"[Circular]"}}',
      );
    });

    test("also marks a repeated non-cyclic reference, since seen entries are never released", () => {
      const shared = { id: 1 };

      expect(safeJsonStringify({ first: shared, second: shared })).toBe(
        '{"first":{"id":1},"second":"[Circular]"}',
      );
    });
  });
});
