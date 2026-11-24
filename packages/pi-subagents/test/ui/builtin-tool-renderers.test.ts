import { Text } from "@earendil-works/pi-tui";
import { describe, expect, it } from "vitest";
import { withBuiltInRenderers } from "#src/ui/builtin-tool-renderers";

const CWD = "/test/cwd";

describe("withBuiltInRenderers", () => {
  describe("without a definition", () => {
    // Each row of the built-in table, checked against the definition Pi's own
    // factory builds: a swapped or misspelled row resolves the wrong tool.
    it.each(["read", "bash", "edit", "write", "grep", "find", "ls", "powershell"])(
      "takes Pi's built-in renderers for %s",
      (toolName) => {
        expect(withBuiltInRenderers(toolName, undefined, CWD)).toHaveProperty("name", toolName);
      },
    );

    it("has nothing for a tool Pi does not build in", () => {
      expect(withBuiltInRenderers("colgrep", undefined, CWD)).toBeUndefined();
    });
  });

  describe("with a definition", () => {
    it("keeps the renderers of a definition that draws both the call and the result", () => {
      const renderCall = () => new Text("call");
      const renderResult = () => new Text("result");

      const resolved = withBuiltInRenderers("read", { renderCall, renderResult }, CWD);

      expect(resolved?.renderCall).toBe(renderCall);
      expect(resolved?.renderResult).toBe(renderResult);
    });

    it("borrows the built-in renderer a definition lacks, keeping the rest of it", () => {
      const renderResult = () => new Text("extension result");
      const definition = { name: "read", description: "extension read", renderResult };

      const resolved = withBuiltInRenderers("read", definition, CWD);

      expect(resolved?.renderResult).toBe(renderResult);
      expect(resolved?.renderCall).toEqual(expect.any(Function));
      expect(resolved).toHaveProperty("description", "extension read");
    });

    it("keeps a definition for a tool Pi does not build in", () => {
      const definition = { renderResult: () => new Text("result") };

      expect(withBuiltInRenderers("colgrep", definition, CWD)).toBe(definition);
    });
  });
});
