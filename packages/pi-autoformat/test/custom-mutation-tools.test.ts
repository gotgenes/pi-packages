import { describe, expect, it } from "vitest";

import {
  type CustomMutationToolSpec,
  createCustomToolHandler,
  createCustomToolHandlers,
  extractPathsFromInput,
  parseTouchedPayload,
} from "#src/custom-mutation-tools";

// A real patch written by a GPT model through an `apply_patch` tool:
// update, add, delete, and update-with-move in one call.
const MODEL_WRITTEN_PATCH = [
  "*** Begin Patch",
  "*** Update File: src/greet.ts",
  "@@",
  " export function greet(name: string): string {",
  '-  return "Hello, " + name;',
  // biome-ignore lint/suspicious/noTemplateCurlyInString: patch text quoting TypeScript source
  "+  return `Hello, ${name}`;",
  " }",
  "*** Add File: src/farewell.ts",
  "+export function farewell(name: string): string {",
  // biome-ignore lint/suspicious/noTemplateCurlyInString: patch text quoting TypeScript source
  "+  return `Goodbye, ${name}`;",
  "+}",
  "*** Delete File: src/legacy.ts",
  "*** Update File: src/util.ts",
  "*** Move to: src/lib/util.ts",
  "@@",
  " export function add(a: number, b: number): number {",
  "   return a + b;",
  " }",
  "+",
  "+export function subtract(a: number, b: number): number {",
  "+  return a - b;",
  "+}",
  "*** End Patch",
].join("\n");

const MODEL_WRITTEN_PATCH_PATHS = [
  "src/greet.ts",
  "src/farewell.ts",
  "src/lib/util.ts",
];

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

  describe("patchField", () => {
    const spec = { patchField: "input" };

    it("returns added, updated, and moved-to paths, skipping deleted files", () => {
      expect(
        extractPathsFromInput({ input: MODEL_WRITTEN_PATCH }, spec),
      ).toEqual(MODEL_WRITTEN_PATCH_PATHS);
    });

    it("handles CRLF line endings", () => {
      const patch = MODEL_WRITTEN_PATCH.replaceAll("\n", "\r\n");
      expect(extractPathsFromInput({ input: patch }, spec)).toEqual(
        MODEL_WRITTEN_PATCH_PATHS,
      );
    });

    it("returns nothing for a patch that only deletes files", () => {
      const patch = "*** Begin Patch\n*** Delete File: gone.ts\n*** End Patch";
      expect(extractPathsFromInput({ input: patch }, spec)).toEqual([]);
    });

    it("ignores a context line that quotes a header", () => {
      const patch = [
        "*** Begin Patch",
        "*** Update File: a.ts",
        "@@",
        " *** Add File: fake.ts",
        "-old",
        "+new",
        "*** End Patch",
      ].join("\n");
      expect(extractPathsFromInput({ input: patch }, spec)).toEqual(["a.ts"]);
    });

    it("ignores an added line that quotes a header", () => {
      const patch = [
        "*** Begin Patch",
        "*** Add File: doc.md",
        "+*** Update File: fake.ts",
        "*** End Patch",
      ].join("\n");
      expect(extractPathsFromInput({ input: patch }, spec)).toEqual(["doc.md"]);
    });

    it("trims trailing whitespace from a header path", () => {
      const patch =
        "*** Begin Patch\n*** Update File: a.ts  \n@@\n-old\n+new\n*** End Patch";
      expect(extractPathsFromInput({ input: patch }, spec)).toEqual(["a.ts"]);
    });

    it("reads headers inside a heredoc-wrapped patch", () => {
      const patch = [
        "apply_patch <<'EOF'",
        "*** Begin Patch",
        "*** Update File: b.ts",
        "@@",
        "-old",
        "+new",
        "*** End Patch",
        "EOF",
      ].join("\n");
      expect(extractPathsFromInput({ input: patch }, spec)).toEqual(["b.ts"]);
    });

    it("returns nothing when the patch field is absent or not a string", () => {
      expect(extractPathsFromInput({}, spec)).toEqual([]);
      expect(extractPathsFromInput({ input: 42 }, spec)).toEqual([]);
    });

    it("appends patch paths after pathField paths", () => {
      expect(
        extractPathsFromInput(
          { path: "first.ts", input: MODEL_WRITTEN_PATCH },
          { pathField: "path", patchField: "input" },
        ),
      ).toEqual(["first.ts", ...MODEL_WRITTEN_PATCH_PATHS]);
    });
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

  it("returns the files a patch changes when the spec uses patchField", () => {
    const handler = createCustomToolHandler({
      toolName: "apply_patch",
      patchField: "input",
    });

    expect(handler("apply_patch", { input: MODEL_WRITTEN_PATCH }, "")).toEqual(
      MODEL_WRITTEN_PATCH_PATHS,
    );
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
