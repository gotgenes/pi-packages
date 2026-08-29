import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BUILTIN_TOOL_NAMES } from "#src/config/agent-types";
import { loadCustomAgents } from "#src/config/custom-agents";

describe("loadCustomAgents", () => {
  let tmpDir: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "pi-test-"));
    originalHome = process.env.HOME;
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    if (originalHome == null) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeAgent(name: string, content: string) {
    const dir = join(tmpDir, ".pi", "agents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), content);
  }

  it("returns empty map when .pi/agents/ does not exist", () => {
    const result = loadCustomAgents(tmpDir);
    expect(result.size).toBe(0);
  });

  it("loads a basic agent with all frontmatter fields", () => {
    writeAgent("auditor", `---
description: Security Auditor
tools: read, grep, find
model: anthropic/claude-opus-4-6
thinking: high
max_turns: 30
prompt_mode: replace
inherit_context: true
run_in_background: true
---

You are a security auditor.`);

    const result = loadCustomAgents(tmpDir);
    expect(result.size).toBe(1);

    const agent = result.get("auditor")!;
    expect(agent.name).toBe("auditor");
    expect(agent.description).toBe("Security Auditor");
    expect(agent.toolNames).toEqual(["read", "grep", "find"]);
    expect(agent.model).toBe("anthropic/claude-opus-4-6");
    expect(agent.thinking).toBe("high");
    expect(agent.maxTurns).toBe(30);
    expect(agent.promptMode).toBe("replace");
    expect(agent.inheritContext).toBe(true);
    expect(agent.runInBackground).toBe(true);
    expect(agent.systemPrompt).toBe("You are a security auditor.");
  });

  it("uses sensible defaults when frontmatter is empty", () => {
    writeAgent("minimal", `---
---

Just a prompt.`);

    const result = loadCustomAgents(tmpDir);
    const agent = result.get("minimal")!;

    expect(agent.name).toBe("minimal");
    expect(agent.description).toBe("minimal"); // defaults to filename
    expect(agent.toolNames).toEqual(BUILTIN_TOOL_NAMES); // all tools
    expect(agent.model).toBeUndefined();
    expect(agent.thinking).toBeUndefined();
    expect(agent.maxTurns).toBeUndefined();
    expect(agent.promptMode).toBe("append");
    expect(agent.inheritContext).toBeUndefined();
    expect(agent.runInBackground).toBeUndefined();
    expect(agent.systemPrompt).toBe("Just a prompt.");
  });

  it("uses sensible defaults when no frontmatter at all", () => {
    writeAgent("bare", "Just a system prompt, no frontmatter.");

    const result = loadCustomAgents(tmpDir);
    const agent = result.get("bare")!;

    expect(agent.name).toBe("bare");
    expect(agent.description).toBe("bare");
    expect(agent.toolNames).toEqual(BUILTIN_TOOL_NAMES);
    expect(agent.promptMode).toBe("append");
    expect(agent.systemPrompt).toBe("Just a system prompt, no frontmatter.");
  });

  it("handles tools: none → empty array", () => {
    writeAgent("notool", `---
tools: none
---

No tools.`);

    const result = loadCustomAgents(tmpDir);
    expect(result.get("notool")!.toolNames).toEqual([]);
  });

  it("passes through unknown tool names (not filtered)", () => {
    writeAgent("custom-tools", `---
tools: read, my_custom_tool, grep
---

Custom tools.`);

    const result = loadCustomAgents(tmpDir);
    // An extension-registered tool name is a supported `tools:` entry: the child's
    // allowlist admits it when the extension registers it during bind (#725).
    expect(result.get("custom-tools")!.toolNames).toEqual(["read", "my_custom_tool", "grep"]);
  });

  describe("tools field forms", () => {
    it("accepts a YAML block sequence", () => {
      writeAgent("block-seq", `---
tools:
  - read
  - my_custom_tool
  - grep
---

Block sequence.`);

      const result = loadCustomAgents(tmpDir);
      expect(result.get("block-seq")!.toolNames).toEqual(["read", "my_custom_tool", "grep"]);
    });

    it("accepts a YAML flow sequence", () => {
      writeAgent("flow-seq", `---
tools: [read, grep]
---

Flow sequence.`);

      const result = loadCustomAgents(tmpDir);
      expect(result.get("flow-seq")!.toolNames).toEqual(["read", "grep"]);
    });

    it("treats a single-element none sequence as no tools", () => {
      writeAgent("seq-none", `---
tools: [none]
---

No tools.`);

      const result = loadCustomAgents(tmpDir);
      expect(result.get("seq-none")!.toolNames).toEqual([]);
    });

    it("treats an empty sequence as no tools", () => {
      writeAgent("seq-empty", `---
tools: []
---

No tools.`);

      const result = loadCustomAgents(tmpDir);
      expect(result.get("seq-empty")!.toolNames).toEqual([]);
    });

    it("keeps a comma inside a quoted sequence entry", () => {
      writeAgent("seq-comma", `---
tools: ["read", "weird,name"]
---

Comma entry.`);

      const result = loadCustomAgents(tmpDir);
      expect(result.get("seq-comma")!.toolNames).toEqual(["read", "weird,name"]);
    });
  });

  describe("locked field", () => {
    it("is undefined when the key is absent", () => {
      writeAgent("open", `---\nmodel: haiku\n---\n\nOpen.`);

      expect(loadCustomAgents(tmpDir).get("open")!.locked).toBeUndefined();
    });

    it("reads `true` as locking every field the file sets", () => {
      writeAgent("pinned", `---\nmodel: haiku\nlocked: true\n---\n\nPinned.`);

      expect(loadCustomAgents(tmpDir).get("pinned")!.locked).toBe(true);
    });

    it("reads `false` as no lock at all", () => {
      writeAgent("unpinned", `---\nmodel: haiku\nlocked: false\n---\n\nUnpinned.`);

      expect(loadCustomAgents(tmpDir).get("unpinned")!.locked).toBeUndefined();
    });

    it("reads a comma-separated scalar", () => {
      writeAgent("scalar", `---\nlocked: model, thinking\n---\n\nScalar.`);

      expect(loadCustomAgents(tmpDir).get("scalar")!.locked).toEqual(["model", "thinking"]);
    });

    it("reads a YAML flow sequence", () => {
      writeAgent("seq", `---\nlocked: [model, max_turns]\n---\n\nSequence.`);

      expect(loadCustomAgents(tmpDir).get("seq")!.locked).toEqual(["model", "max_turns"]);
    });

    it("reads every lockable field name", () => {
      writeAgent("all", `---\nlocked: [model, thinking, max_turns, inherit_context, run_in_background]\n---\n\nAll.`);

      expect(loadCustomAgents(tmpDir).get("all")!.locked).toEqual([
        "model",
        "thinking",
        "max_turns",
        "inherit_context",
        "run_in_background",
      ]);
    });

    it("drops an entry that is not a lockable field", () => {
      writeAgent("typo", `---\nlocked: [model, tools]\n---\n\nTypo.`);

      expect(loadCustomAgents(tmpDir).get("typo")!.locked).toEqual(["model"]);
    });

    it("is undefined when every entry is dropped", () => {
      writeAgent("alltypo", `---\nlocked: [tools]\n---\n\nAll typo.`);

      expect(loadCustomAgents(tmpDir).get("alltypo")!.locked).toBeUndefined();
    });

    it("reads `none` as no lock", () => {
      writeAgent("nolock", `---\nlocked: none\n---\n\nNo lock.`);

      expect(loadCustomAgents(tmpDir).get("nolock")!.locked).toBeUndefined();
    });
  });

  describe("thinking level", () => {
    it.each(["off", "minimal", "low", "medium", "high", "xhigh", "max"])(
      "keeps %s",
      (level) => {
        writeAgent("thinker", `---\nthinking: ${level}\n---\n\nA thinker.`);

        expect(loadCustomAgents(tmpDir).get("thinker")!.thinking).toBe(level);
      },
    );

    /**
     * Pi does not reject an unrecognized level — clampThinkingLevel misses it in
     * its ordered table and falls to the first supported level, which is always
     * "off". Passing it through would silently disable thinking for an agent whose
     * author asked for more of it, so the loader drops the field and the agent
     * inherits the parent's level instead (Refs #834).
     */
    it("drops an unrecognized level rather than letting the SDK clamp it to off", () => {
      writeAgent("anythink", `---\nthinking: turbo\n---\n\nAny thinking.`);

      expect(loadCustomAgents(tmpDir).get("anythink")!.thinking).toBeUndefined();
    });

    it("drops a level that differs only in case", () => {
      writeAgent("shouty", `---\nthinking: HIGH\n---\n\nShouting.`);

      expect(loadCustomAgents(tmpDir).get("shouty")!.thinking).toBeUndefined();
    });
  });

  it("accepts max_turns: 0 as unlimited", () => {
    writeAgent("unlimited", `---
max_turns: 0
---

Unlimited turns.`);

    const result = loadCustomAgents(tmpDir);
    expect(result.get("unlimited")!.maxTurns).toBe(0);
  });

  it("rejects negative max_turns", () => {
    writeAgent("negturns", `---
max_turns: -5
---

Negative turns.`);

    const result = loadCustomAgents(tmpDir);
    expect(result.get("negturns")!.maxTurns).toBeUndefined();
  });

  it("handles prompt_mode: append", () => {
    writeAgent("appender", `---
prompt_mode: append
---

Extra instructions.`);

    const result = loadCustomAgents(tmpDir);
    expect(result.get("appender")!.promptMode).toBe("append");
  });

  it("defaults unknown prompt_mode to append", () => {
    writeAgent("badmode", `---
prompt_mode: merge
---

Unknown mode.`);

    const result = loadCustomAgents(tmpDir);
    expect(result.get("badmode")!.promptMode).toBe("append");
  });

  it("loads multiple agents", () => {
    writeAgent("agent1", `---
description: First
---

First agent.`);
    writeAgent("agent2", `---
description: Second
---

Second agent.`);

    const result = loadCustomAgents(tmpDir);
    expect(result.size).toBe(2);
    expect(result.has("agent1")).toBe(true);
    expect(result.has("agent2")).toBe(true);
  });

  it("skips non-.md files", () => {
    const dir = join(tmpDir, ".pi", "agents");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "notes.txt"), "not an agent");
    writeFileSync(join(dir, "real.md"), `---
description: Real Agent
---

Real.`);

    const result = loadCustomAgents(tmpDir);
    expect(result.size).toBe(1);
    expect(result.has("real")).toBe(true);
  });

  it("allows agents with names matching defaults (overrides them)", () => {
    writeAgent("Explore", `---
description: Custom Explore
---

Custom explore agent.`);
    writeAgent("custom", `---
description: Custom Agent
---

Should be loaded.`);

    const result = loadCustomAgents(tmpDir);
    expect(result.has("Explore")).toBe(true);
    expect(result.get("Explore")!.description).toBe("Custom Explore");
    expect(result.has("custom")).toBe(true);
  });

  it("handles empty body with frontmatter", () => {
    writeAgent("nobody", `---
description: No body
tools: read
---
`);

    const result = loadCustomAgents(tmpDir);
    expect(result.get("nobody")!.systemPrompt).toBe("");
  });

  it("handles enabled: false frontmatter", () => {
    writeAgent("disabled", `---
enabled: false
---
`);

    const result = loadCustomAgents(tmpDir);
    const agent = result.get("disabled")!;
    expect(agent.enabled).toBe(false);
  });

  it("parses display_name frontmatter", () => {
    writeAgent("myagent", `---
description: My Agent
display_name: MyAgent
---

Agent prompt.`);

    const result = loadCustomAgents(tmpDir);
    expect(result.get("myagent")!.displayName).toBe("MyAgent");
  });

  it("honors PI_CODING_AGENT_DIR for global custom agent discovery", () => {
    const altAgentDir = mkdtempSync(join(tmpdir(), "pi-alt-agent-"));
    const originalEnv = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = altAgentDir;
    try {
      const globalAgentsDir = join(altAgentDir, "agents");
      mkdirSync(globalAgentsDir, { recursive: true });
      writeFileSync(
        join(globalAgentsDir, "via-env.md"),
        "---\ndescription: Discovered via env var\n---\n\nTest body.",
      );

      const result = loadCustomAgents(tmpDir);

      // Agent is found at $PI_CODING_AGENT_DIR/agents, not at $HOME/.pi/agent/agents
      expect(result.has("via-env")).toBe(true);
      expect(result.get("via-env")!.description).toBe("Discovered via env var");
    } finally {
      if (originalEnv == null) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = originalEnv;
      rmSync(altAgentDir, { recursive: true, force: true });
    }
  });
});
