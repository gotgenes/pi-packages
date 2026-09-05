import { afterEach, describe, expect, test, vi } from "vitest";

import {
  checkRequestedToolRegistration,
  getToolNameFromValue,
} from "#src/exposure/tool-registry";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getToolNameFromValue", () => {
  test("returns string value directly", () => {
    expect(getToolNameFromValue("read")).toBe("read");
  });

  test("returns null for empty string", () => {
    expect(getToolNameFromValue("")).toBeNull();
  });

  test("returns null for whitespace-only string", () => {
    expect(getToolNameFromValue("   ")).toBeNull();
  });

  test("returns null for null", () => {
    expect(getToolNameFromValue(null)).toBeNull();
  });

  test("returns null for undefined", () => {
    expect(getToolNameFromValue(undefined)).toBeNull();
  });

  test("extracts toolName from object", () => {
    expect(getToolNameFromValue({ toolName: "write" })).toBe("write");
  });

  test("extracts name from object", () => {
    expect(getToolNameFromValue({ name: "edit" })).toBe("edit");
  });

  test("extracts tool from object", () => {
    expect(getToolNameFromValue({ tool: "bash" })).toBe("bash");
  });

  test("prefers toolName over name over tool", () => {
    expect(
      getToolNameFromValue({
        toolName: "first",
        name: "second",
        tool: "third",
      }),
    ).toBe("first");
  });

  test("falls back to name when toolName is empty", () => {
    expect(getToolNameFromValue({ toolName: "", name: "edit" })).toBe("edit");
  });

  test("returns null for object with no recognised keys", () => {
    expect(getToolNameFromValue({ unknown: "read" })).toBeNull();
  });

  test("returns null for number input", () => {
    expect(getToolNameFromValue(42)).toBeNull();
  });
});

describe("checkRequestedToolRegistration", () => {
  test("returns missing-tool-name for null requested name", () => {
    const result = checkRequestedToolRegistration(null, []);
    expect(result.status).toBe("missing-tool-name");
  });

  test("returns missing-tool-name for whitespace-only requested name", () => {
    const result = checkRequestedToolRegistration("   ", []);
    expect(result.status).toBe("missing-tool-name");
  });

  test("returns registered when tool name matches a string entry", () => {
    const result = checkRequestedToolRegistration("read", ["read", "write"]);
    expect(result.status).toBe("registered");
    if (result.status === "registered") {
      expect(result.requestedToolName).toBe("read");
      expect(result.normalizedToolName).toBe("read");
    }
  });

  test("returns registered when tool name matches an object entry by name", () => {
    const result = checkRequestedToolRegistration("edit", [{ name: "edit" }]);
    expect(result.status).toBe("registered");
  });

  test("returns registered when tool name matches an object entry by toolName", () => {
    const result = checkRequestedToolRegistration("bash", [
      { toolName: "bash" },
    ]);
    expect(result.status).toBe("registered");
  });

  test("returns unregistered when tool is not in the list", () => {
    const result = checkRequestedToolRegistration("ghost", ["read", "write"]);
    expect(result.status).toBe("unregistered");
    if (result.status === "unregistered") {
      expect(result.requestedToolName).toBe("ghost");
      expect(result.availableToolNames).toContain("read");
      expect(result.availableToolNames).toContain("write");
    }
  });

  test("available tool names are sorted alphabetically", () => {
    const result = checkRequestedToolRegistration("ghost", [
      "write",
      "read",
      "edit",
    ]);
    if (result.status === "unregistered") {
      expect(result.availableToolNames).toEqual(["edit", "read", "write"]);
    }
  });

  test("resolves alias: requested alias maps to registered canonical name", () => {
    const aliases = { Execute: "bash" };
    const result = checkRequestedToolRegistration("Execute", ["bash"], aliases);
    expect(result.status).toBe("registered");
    if (result.status === "registered") {
      expect(result.normalizedToolName).toBe("bash");
    }
  });

  test("resolves alias: registered canonical is found via reverse alias lookup", () => {
    // "bash" is registered; alias maps "Execute" → "bash"
    // requesting "bash" directly should still resolve via the alias table
    const aliases = { Execute: "bash" };
    const result = checkRequestedToolRegistration("bash", ["bash"], aliases);
    expect(result.status).toBe("registered");
  });

  test("returns unregistered with empty availableToolNames for empty tool list", () => {
    const result = checkRequestedToolRegistration("read", []);
    expect(result.status).toBe("unregistered");
    if (result.status === "unregistered") {
      expect(result.availableToolNames).toEqual([]);
    }
  });

  test("skips tool list entries that yield no name", () => {
    const result = checkRequestedToolRegistration("read", [
      null,
      {},
      { unrelated: "x" },
      "read",
    ]);
    expect(result.status).toBe("registered");
  });
});

// ---------------------------------------------------------------------------
// Moved from permission-system.test.ts catch-all (#342)
// ---------------------------------------------------------------------------

test("Tool registry resolves event tool names from string and object payloads", () => {
  expect(getToolNameFromValue("  read  ")).toBe("read");
  expect(getToolNameFromValue({ toolName: "write" })).toBe("write");
  expect(getToolNameFromValue({ name: "find" })).toBe("find");
  expect(getToolNameFromValue({ tool: "grep" })).toBe("grep");
  expect(getToolNameFromValue({})).toBe(null);
});

test("Tool registry blocks unregistered tools and handles aliases", () => {
  const registeredTools = [
    { toolName: "mcp" },
    { toolName: "read" },
    { toolName: "bash" },
  ];

  const unknownCheck = checkRequestedToolRegistration(
    "third_party_tool",
    registeredTools,
  );
  expect(unknownCheck.status).toBe("unregistered");
  if (unknownCheck.status === "unregistered") {
    expect(unknownCheck.availableToolNames).toEqual(["bash", "mcp", "read"]);
  }

  const aliasCheck = checkRequestedToolRegistration(
    "legacy_read",
    registeredTools,
    { legacy_read: "read" },
  );
  expect(aliasCheck.status).toBe("registered");

  const missingNameCheck = checkRequestedToolRegistration(
    "   ",
    registeredTools,
  );
  expect(missingNameCheck.status).toBe("missing-tool-name");
});
