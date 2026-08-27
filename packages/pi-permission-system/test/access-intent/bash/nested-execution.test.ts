import { describe, expect, it } from "vitest";
import {
  forEachNestedExecution,
  NESTED_EXECUTION_CONTEXTS,
} from "#src/access-intent/bash/nested-execution";
import { getParser, type TSNode } from "#src/access-intent/bash/parser";
import type { BashCommandContext } from "#src/types";

/** Parse a bash snippet and collect every nested execution context found. */
async function visitContexts(
  command: string,
): Promise<{ text: string; context: BashCommandContext }[]> {
  const parser = await getParser();
  const tree = parser.parse(command);
  if (!tree) throw new Error("parser.parse returned null");
  const found: { text: string; context: BashCommandContext }[] = [];
  try {
    forEachNestedExecution(tree.rootNode, (node: TSNode, context) => {
      found.push({ text: node.text, context });
    });
  } finally {
    tree.delete();
  }
  return found;
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
