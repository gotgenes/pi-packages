import { describe, expect, it } from "vitest";

import {
  type CustomMutationToolSpec,
  createCustomToolHandler,
  createCustomToolHandlers,
  extractPathsFromInput,
  parseTouchedPayload,
} from "#src/custom-mutation-tools";

describe("extractPathsFromInput", () => {
  it("returns the value at a top-level string field", () => {
    expect(
      extractPathsFromInput({ path: "src/index.ts" }, { pathField: "path" }),
    ).toEqual(["src/index.ts"]);
  });

  it("resolves nested dotted paths", () => {
    expect(
      extractPathsFromInput(
        { args: { target: "docs/readme.md" } },
        { pathField: "args.target" },
      ),
    ).toEqual(["docs/readme.md"]);
  });

  it("returns an empty array when the field is missing", () => {
    expect(
      extractPathsFromInput({ other: "x" }, { pathField: "path" }),
    ).toEqual([]);
  });

  it("returns an empty array when an intermediate path segment is missing", () => {
    expect(extractPathsFromInput({}, { pathField: "args.target" })).toEqual([]);
  });

  it("does not coerce non-string scalar values", () => {
    expect(extractPathsFromInput({ path: 42 }, { pathField: "path" })).toEqual(
      [],
    );
    expect(
      extractPathsFromInput({ path: null }, { pathField: "path" }),
    ).toEqual([]);
    expect(
      extractPathsFromInput({ path: true }, { pathField: "path" }),
    ).toEqual([]);
  });

  it("flattens string-array values for pathField (single dotted path)", () => {
    // pathField and pathFields differ only in arity, not in value handling.
    // A tool whose field is sometimes a string and sometimes a string[] should
    // not require switching keys.
    expect(
      extractPathsFromInput({ path: ["a.ts", "b.ts"] }, { pathField: "path" }),
    ).toEqual(["a.ts", "b.ts"]);
  });

  it("returns an empty array when input is not an object", () => {
    expect(extractPathsFromInput(null, { pathField: "path" })).toEqual([]);
    expect(extractPathsFromInput("foo", { pathField: "path" })).toEqual([]);
    expect(extractPathsFromInput(undefined, { pathField: "path" })).toEqual([]);
  });

  it("flattens string-array values for pathFields entries", () => {
    expect(
      extractPathsFromInput(
        { targets: ["a.ts", "b.ts"] },
        { pathFields: ["targets"] },
      ),
    ).toEqual(["a.ts", "b.ts"]);
  });

  it("supports a mix of string and string-array fields in pathFields", () => {
    expect(
      extractPathsFromInput(
        { primary: "a.ts", extras: ["b.ts", "c.ts"] },
        { pathFields: ["primary", "extras"] },
      ),
    ).toEqual(["a.ts", "b.ts", "c.ts"]);
  });

  it("drops non-string entries from string-array values", () => {
    expect(
      extractPathsFromInput(
        { targets: ["a.ts", 1, null, "b.ts"] },
        { pathFields: ["targets"] },
      ),
    ).toEqual(["a.ts", "b.ts"]);
  });

  it("ignores missing fields inside pathFields without failing", () => {
    expect(
      extractPathsFromInput(
        { primary: "a.ts" },
        { pathFields: ["primary", "missing"] },
      ),
    ).toEqual(["a.ts"]);
  });

  it("extracts add, delete, and move destinations from a multi-file patch", () => {
    const patch = [
      "*** Begin Patch",
      "*** Add File: path/add.py",
      "+abc",
      "+def",
      "*** Delete File: path/delete.py",
      "*** Update File: path/update.py",
      "*** Move to: path/update2.py",
      "@@ def f():",
      "-    pass",
      "+    return 123",
      "*** End Patch",
    ].join("\n");

    expect(
      extractPathsFromInput({ args: { patch } }, { patchField: "args.patch" }),
    ).toEqual(["path/add.py", "path/delete.py", "path/update2.py"]);
  });

  it("uses the update filename when no move is declared", () => {
    const patch =
      "*** Begin Patch\r\n*** Update File: src/a.ts\r\n@@\r\n-old\r\n+new\r\n*** End Patch\r\n";
    expect(extractPathsFromInput({ patch }, { patchField: "patch" })).toEqual([
      "src/a.ts",
    ]);
  });

  it("does not treat added content as a file header", () => {
    const patch =
      "*** Begin Patch\n*** Add File: doc.txt\n+*** Delete File: other.txt\n*** End Patch";
    expect(extractPathsFromInput({ patch }, { patchField: "patch" })).toEqual([
      "doc.txt",
    ]);
  });

  it("accepts an environment ID before file operations", () => {
    const patch =
      "*** Begin Patch\n*** Environment ID: task-1\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** End Patch";
    expect(extractPathsFromInput({ patch }, { patchField: "patch" })).toEqual([
      "src/a.ts",
    ]);
  });

  it("ignores absent, non-string, and malformed patch values", () => {
    expect(extractPathsFromInput({}, { patchField: "patch" })).toEqual([]);
    expect(
      extractPathsFromInput({ patch: 42 }, { patchField: "patch" }),
    ).toEqual([]);
    expect(
      extractPathsFromInput(
        { patch: "*** Add File: a.ts\n+x\n*** End Patch" },
        { patchField: "patch" },
      ),
    ).toEqual([]);
    expect(
      extractPathsFromInput(
        { patch: "*** Begin Patch\n*** Move to: b.ts\n*** End Patch" },
        { patchField: "patch" },
      ),
    ).toEqual([]);
  });
});

describe("createCustomToolHandler", () => {
  it("returns paths when the toolName matches", () => {
    const spec: CustomMutationToolSpec = {
      toolName: "mcp_files_write",
      pathField: "path",
    };
    const handler = createCustomToolHandler(spec);

    expect(handler("mcp_files_write", { path: "src/index.ts" }, "")).toEqual([
      "src/index.ts",
    ]);
  });

  it("returns an empty array when the toolName does not match", () => {
    const handler = createCustomToolHandler({
      toolName: "mcp_files_write",
      pathField: "path",
    });

    expect(handler("write", { path: "src/index.ts" }, "")).toEqual([]);
    expect(handler("bash", { command: "ls" }, "")).toEqual([]);
  });

  it("returns an empty array when the payload lacks the configured field", () => {
    const handler = createCustomToolHandler({
      toolName: "mcp_files_write",
      pathField: "path",
    });

    expect(handler("mcp_files_write", { other: "x" }, "")).toEqual([]);
  });
});

describe("createCustomToolHandlers", () => {
  it("creates one handler per spec, preserving order", () => {
    const handlers = createCustomToolHandlers([
      { toolName: "tool_a", pathField: "path" },
      { toolName: "tool_b", pathFields: ["destination"] },
    ]);

    expect(handlers).toHaveLength(2);
    expect(handlers[0]("tool_a", { path: "a.ts" }, "")).toEqual(["a.ts"]);
    expect(handlers[1]("tool_b", { destination: "b.ts" }, "")).toEqual([
      "b.ts",
    ]);
  });

  it("returns an empty array for an empty spec list", () => {
    expect(createCustomToolHandlers([])).toEqual([]);
  });
});

describe("parseTouchedPayload", () => {
  it("accepts { path: string }", () => {
    expect(parseTouchedPayload({ path: "src/a.ts" })).toEqual(["src/a.ts"]);
  });

  it("accepts { paths: string[] }", () => {
    expect(parseTouchedPayload({ paths: ["a.ts", "b.ts"] })).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });

  it("drops non-string entries from paths", () => {
    expect(parseTouchedPayload({ paths: ["a.ts", 1, null, "b.ts"] })).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });

  it("ignores empty-string paths", () => {
    expect(parseTouchedPayload({ path: "" })).toEqual([]);
    expect(parseTouchedPayload({ paths: ["", "a.ts"] })).toEqual(["a.ts"]);
  });

  it("returns an empty array for unknown payload shapes", () => {
    expect(parseTouchedPayload({})).toEqual([]);
    expect(parseTouchedPayload({ filename: "x" })).toEqual([]);
    expect(parseTouchedPayload({ path: 42 })).toEqual([]);
    expect(parseTouchedPayload({ paths: "not-an-array" })).toEqual([]);
  });

  it("returns an empty array for non-object payloads", () => {
    expect(parseTouchedPayload(null)).toEqual([]);
    expect(parseTouchedPayload(undefined)).toEqual([]);
    expect(parseTouchedPayload("a.ts")).toEqual([]);
    expect(parseTouchedPayload(["a.ts"])).toEqual([]);
  });
});
