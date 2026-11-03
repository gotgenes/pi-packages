import { describe, expect, test } from "vitest";
import {
  consumeOperationPurpose,
  prepareOperationPurpose,
} from "#src/tool-input/operation-purpose";

describe("prepareOperationPurpose", () => {
  test("adds optional metadata without replacing tool properties or required fields", () => {
    const parameters = {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    };
    const pi = { getAllTools: () => [{ name: "read", parameters }] };
    prepareOperationPurpose(pi as never);
    const first = structuredClone(parameters);
    prepareOperationPurpose(pi as never);
    expect(parameters).toStrictEqual(first);
    expect(parameters.required).toStrictEqual(["path"]);
    expect(parameters.properties).toMatchObject({
      path: { type: "string" },
      _permissionPurpose: { type: "string" },
    });
  });

  test("prepares newly discovered tools and preserves an existing purpose schema", () => {
    const purpose = { type: "string", description: "Tool-owned purpose." };
    const tools = [
      {
        parameters: {
          type: "object",
          properties: { _permissionPurpose: purpose },
        },
      },
    ];
    const pi = { getAllTools: () => tools };
    prepareOperationPurpose(pi as never);
    expect(tools[0].parameters.properties._permissionPurpose).toBe(purpose);
    const late = { parameters: { type: "object", properties: {} } };
    prepareOperationPurpose({ getAllTools: () => [late] } as never);
    expect(late.parameters.properties).toHaveProperty("_permissionPurpose");
  });

  test("adds purpose guidance only when Pi is not using a custom prompt", () => {
    const pi = { getAllTools: () => [] };
    const options = { sections: {} };
    prepareOperationPurpose(pi, { systemPromptOptions: options } as never);
    expect(options.sections).toHaveProperty("permission_purpose");
    const custom = { customPrompt: "Custom instructions.", sections: {} };
    prepareOperationPurpose(pi, { systemPromptOptions: custom } as never);
    expect(custom.sections).toStrictEqual({});
  });
});

describe("consumeOperationPurpose", () => {
  test("removes metadata while preserving the actual tool input", () => {
    const input = {
      command: "git status --short",
      _permissionPurpose: "Inspect changes.",
    };
    expect(consumeOperationPurpose(input)).toBe("Inspect changes.");
    expect(input).toStrictEqual({ command: "git status --short" });
  });

  test("flattens control characters before a purpose reaches the dialog", () => {
    expect(
      consumeOperationPurpose({
        _permissionPurpose: "  Inspect\nchanges\u001b  ",
      }),
    ).toBe("Inspect changes");
  });

  test.each([undefined, null, 42, "", "  "])(
    "ignores absent, non-string, or empty purposes: %j",
    (value: unknown) => {
      const input = { path: "/project/file.ts", _permissionPurpose: value };
      expect(consumeOperationPurpose(input)).toBeUndefined();
      expect(input).toStrictEqual({ path: "/project/file.ts" });
    },
  );
});
