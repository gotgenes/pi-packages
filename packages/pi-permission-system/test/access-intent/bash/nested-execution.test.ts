import { describe, expect, it } from "vitest";
import {
  forEachExecutionIn,
  forEachNestedExecution,
  NESTED_EXECUTION_CONTEXTS,
} from "#src/access-intent/bash/nested-execution";
import { getParser, type TSNode } from "#src/access-intent/bash/parser";
import type { BashCommandContext } from "#src/types";

/** A visited execution context, as the assertions read it. */
interface VisitedContext {
  text: string;
  context: BashCommandContext;
}

/** Parse a bash snippet and collect every nested execution context found. */
async function visitContexts(command: string): Promise<VisitedContext[]> {
  const parser = await getParser();
  const tree = parser.parse(command);
  if (!tree) throw new Error("parser.parse returned null");
  const found: VisitedContext[] = [];
  try {
    forEachNestedExecution(tree.rootNode, (node: TSNode, context) => {
      found.push({ text: node.text, context });
    });
  } finally {
    tree.delete();
  }
  return found;
}

/**
 * Parse a bash snippet, find the first node of `nodeType`, and collect every
 * execution `forEachExecutionIn` reports for it — the node itself included.
 */
async function visitExecutionsIn(
  command: string,
  nodeType: string,
): Promise<VisitedContext[]> {
  const parser = await getParser();
  const tree = parser.parse(command);
  if (!tree) throw new Error("parser.parse returned null");
  const found: VisitedContext[] = [];
  try {
    const node = findNode(tree.rootNode, nodeType);
    if (!node) throw new Error(`no ${nodeType} node found in: ${command}`);
    forEachExecutionIn(node, (contextNode: TSNode, context) => {
      found.push({ text: contextNode.text, context });
    });
  } finally {
    tree.delete();
  }
  return found;
}

/** Depth-first search for the first node of the given type. */
function findNode(node: TSNode, type: string): TSNode | null {
  if (node.type === type) return node;
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i);
    if (!child) continue;
    const found = findNode(child, type);
    if (found) return found;
  }
  return null;
}

describe("NESTED_EXECUTION_CONTEXTS", () => {
  it("maps the substitution node types to their execution context", () => {
    expect([...NESTED_EXECUTION_CONTEXTS]).toEqual([
      ["command_substitution", "command_substitution"],
      ["process_substitution", "process_substitution"],
    ]);
  });

  it("omits subshell, which the command enumerator emits whole", () => {
    expect(NESTED_EXECUTION_CONTEXTS.has("subshell")).toBe(false);
  });
});

describe("forEachNestedExecution", () => {
  it("finds a substitution in argument position", async () => {
    expect(await visitContexts("echo $(rm x)")).toEqual([
      { text: "$(rm x)", context: "command_substitution" },
    ]);
  });

  it("finds a backtick substitution", async () => {
    expect(await visitContexts("echo `rm x`")).toEqual([
      { text: "`rm x`", context: "command_substitution" },
    ]);
  });

  it("finds a process substitution", async () => {
    expect(await visitContexts("diff <(cat /etc/shadow)")).toEqual([
      { text: "<(cat /etc/shadow)", context: "process_substitution" },
    ]);
  });

  it("finds a substitution hosted in a redirect destination", async () => {
    expect(await visitContexts("echo hi > $(rm x)")).toEqual([
      { text: "$(rm x)", context: "command_substitution" },
    ]);
  });

  it("finds a substitution hosted in an interpolating heredoc body", async () => {
    expect(await visitContexts("cat <<EOF\n$(rm e)\nEOF")).toEqual([
      { text: "$(rm e)", context: "command_substitution" },
    ]);
  });

  it("finds nothing in a quoted heredoc body, which does not interpolate", async () => {
    expect(await visitContexts("cat <<'EOF'\n$(rm e)\nEOF")).toEqual([]);
  });

  it("does not descend past a context it finds", async () => {
    // The outer substitution is visited; the inner one is left to the visitor.
    expect(await visitContexts("echo $(echo $(rm x))")).toEqual([
      { text: "$(echo $(rm x))", context: "command_substitution" },
    ]);
  });

  it("finds each substitution of a chain in source order", async () => {
    expect(await visitContexts("echo $(rm a) && echo `rm b`")).toEqual([
      { text: "$(rm a)", context: "command_substitution" },
      { text: "`rm b`", context: "command_substitution" },
    ]);
  });

  it("finds nothing in a command with no nested execution", async () => {
    expect(await visitContexts("npm install pkg > out.txt")).toEqual([]);
  });
});

describe("forEachExecutionIn", () => {
  it("visits a context node handed in directly", async () => {
    expect(
      await visitExecutionsIn("echo $(rm x)", "command_substitution"),
    ).toEqual([{ text: "$(rm x)", context: "command_substitution" }]);
  });

  it("visits a process substitution handed in directly", async () => {
    expect(
      await visitExecutionsIn("diff <(rm x)", "process_substitution"),
    ).toEqual([{ text: "<(rm x)", context: "process_substitution" }]);
  });

  it("searches within a node that merely contains a context", async () => {
    expect(await visitExecutionsIn("echo $(rm x)", "command")).toEqual([
      { text: "$(rm x)", context: "command_substitution" },
    ]);
  });

  it("does not descend past a context it was handed", async () => {
    expect(
      await visitExecutionsIn("echo $(echo $(rm x))", "command_substitution"),
    ).toEqual([{ text: "$(echo $(rm x))", context: "command_substitution" }]);
  });

  it("does not descend past a context it finds by searching", async () => {
    expect(await visitExecutionsIn("echo $(echo $(rm x))", "command")).toEqual([
      { text: "$(echo $(rm x))", context: "command_substitution" },
    ]);
  });

  it("finds nothing in a node hosting no execution", async () => {
    expect(await visitExecutionsIn("npm install pkg", "command")).toEqual([]);
  });
});
