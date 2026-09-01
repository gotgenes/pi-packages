import { homedir } from "node:os";
import { describe, expect, it } from "vitest";
import { getParser, type TSNode } from "#src/access-intent/bash/parser";
import { resolvePlainVariableExpansion } from "#src/access-intent/bash/shell-variable-expansion";
import { makeTSNode } from "#test/helpers/fake-ts-node";

/** `$NAME` as tree-sitter-bash builds it: a `$` delimiter plus the name. */
function simpleExpansion(name: string): TSNode {
  return makeTSNode("simple_expansion", `$${name}`, [
    makeTSNode("$", "$"),
    makeTSNode("variable_name", name),
  ]);
}

/** `${NAME}` as tree-sitter-bash builds it: brace delimiters plus the name. */
function bracedExpansion(name: string): TSNode {
  return makeTSNode("expansion", `\${${name}}`, [
    makeTSNode("${", "${"),
    makeTSNode("variable_name", name),
    makeTSNode("}", "}"),
  ]);
}

function findNodeOfType(node: TSNode, type: string): TSNode | null {
  if (node.type === type) return node;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    const found = child ? findNodeOfType(child, type) : null;
    if (found) return found;
  }
  return null;
}

describe("resolvePlainVariableExpansion", () => {
  describe("resolvable variables", () => {
    it("resolves $HOME to the OS home directory", () => {
      expect(resolvePlainVariableExpansion(simpleExpansion("HOME"))).toBe(
        homedir(),
      );
    });

    it("resolves ${HOME} to the OS home directory", () => {
      expect(resolvePlainVariableExpansion(bracedExpansion("HOME"))).toBe(
        homedir(),
      );
    });

    it("resolves $PWD to the base-relative marker", () => {
      // The shell's working directory is the projection's effective base, so
      // the base-relative form resolves correctly after any `cd` folding
      // without threading a base into this pure function.
      expect(resolvePlainVariableExpansion(simpleExpansion("PWD"))).toBe(".");
    });

    it("resolves ${PWD} to the base-relative marker", () => {
      expect(resolvePlainVariableExpansion(bracedExpansion("PWD"))).toBe(".");
    });
  });

  describe("variables outside the resolvable set", () => {
    it.each(["HOMEDIR", "CURRENT", "PATH", "PWDX", "TMPDIR"])(
      "leaves $%s unresolved",
      (name) => {
        expect(resolvePlainVariableExpansion(simpleExpansion(name))).toBeNull();
        expect(resolvePlainVariableExpansion(bracedExpansion(name))).toBeNull();
      },
    );
  });

  describe("expansions carrying an operator", () => {
    it("leaves ${HOME:-/tmp} unresolved", () => {
      const node = makeTSNode("expansion", "${HOME:-/tmp}", [
        makeTSNode("${", "${"),
        makeTSNode("variable_name", "HOME"),
        makeTSNode(":-", ":-"),
        makeTSNode("word", "/tmp"),
        makeTSNode("}", "}"),
      ]);
      expect(resolvePlainVariableExpansion(node)).toBeNull();
    });

    it("leaves ${#HOME} unresolved", () => {
      const node = makeTSNode("expansion", "${#HOME}", [
        makeTSNode("${", "${"),
        makeTSNode("#", "#"),
        makeTSNode("variable_name", "HOME"),
        makeTSNode("}", "}"),
      ]);
      expect(resolvePlainVariableExpansion(node)).toBeNull();
    });
  });

  describe("nodes that are not a plain variable reference", () => {
    it("returns null for a node with no children", () => {
      expect(
        resolvePlainVariableExpansion(makeTSNode("simple_expansion", "$HOME")),
      ).toBeNull();
    });

    it("returns null for a node with no variable_name child", () => {
      const node = makeTSNode("expansion", "${}", [
        makeTSNode("${", "${"),
        makeTSNode("}", "}"),
      ]);
      expect(resolvePlainVariableExpansion(node)).toBeNull();
    });

    it("returns null for a variable_assignment naming a resolvable variable", () => {
      // `HOME=/tmp` binds the name; it is not a reference to its value.
      const node = makeTSNode("variable_assignment", "HOME=/tmp", [
        makeTSNode("variable_name", "HOME"),
        makeTSNode("=", "="),
        makeTSNode("word", "/tmp"),
      ]);
      expect(resolvePlainVariableExpansion(node)).toBeNull();
    });
  });

  describe("fidelity to the shapes tree-sitter-bash actually produces", () => {
    it.each([
      ["ls $HOME", "simple_expansion", homedir()],
      ["ls ${HOME}", "expansion", homedir()],
      ["ls $PWD", "simple_expansion", "."],
      ["ls ${PWD}", "expansion", "."],
      ["ls ${HOME:-/tmp}", "expansion", null],
      ["ls ${#HOME}", "expansion", null],
      ["ls $HOMEDIR", "simple_expansion", null],
    ])("resolves %s to %s", async (command, nodeType, expected) => {
      const parser = await getParser();
      const tree = parser.parse(command);
      expect(tree).not.toBeNull();
      if (!tree) return;
      try {
        const node = findNodeOfType(tree.rootNode, nodeType);
        expect(node).not.toBeNull();
        if (!node) return;
        expect(resolvePlainVariableExpansion(node)).toBe(expected);
      } finally {
        tree.delete();
      }
    });
  });
});
