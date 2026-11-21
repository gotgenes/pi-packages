import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  invocations,
  skillFiles,
  templateHeading,
  volumeRows,
} from "../../scripts/agent-docs/invocation-volume.mjs";

const PROMPTS_DIR = path.join(
  import.meta.dirname,
  "..",
  "..",
  ".pi",
  "prompts",
);

const SKILLS_DIR = path.join(import.meta.dirname, "..", "..", ".pi", "skills");

const WINDOW = { since: "2026-09-01", until: "2026-09-29" };
const INSIDE = "2026-09-15T12:00:00.000Z";

/** A user message as Pi writes it: an expanded template is its text. */
function user(text, timestamp = INSIDE) {
  return JSON.stringify({
    type: "message",
    timestamp,
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

/** An assistant message carrying one tool call. */
function toolCall(name, args, timestamp = INSIDE) {
  return JSON.stringify({
    type: "message",
    timestamp,
    message: {
      role: "assistant",
      content: [
        { type: "text", text: "Dispatching." },
        { type: "toolCall", name, arguments: args },
      ],
    },
  });
}

/** A `read` call as Pi records it: offset and limit are usually null. */
function read(target, extra = {}, timestamp = INSIDE) {
  return toolCall(
    "read",
    { path: target, offset: null, limit: null, ...extra },
    timestamp,
  );
}

function collect(lines, window = WINDOW) {
  return [...invocations(lines, window)];
}

describe("invocations", () => {
  describe("templates", () => {
    it("yields the first line of each user message as a template key", () => {
      expect(
        collect([
          user("# Plan a GitHub issue\n\nIssue number: `935`"),
          user("# Ship the implementation\n\nArgument: `935`"),
        ]),
      ).toEqual([
        { kind: "template", key: "# Plan a GitHub issue" },
        { kind: "template", key: "# Ship the implementation" },
      ]);
    });

    it("keys a message that quotes a heading later on by its own first line", () => {
      expect(
        collect([user("Why did step 3 do that?\n\n# Plan a GitHub issue")]),
      ).toEqual([{ kind: "template", key: "Why did step 3 do that?" }]);
    });

    it("reads a user message whose content is a plain string", () => {
      const line = JSON.stringify({
        type: "message",
        timestamp: INSIDE,
        message: { role: "user", content: "# Triage the backlog\n\nbody" },
      });
      expect(collect([line])).toEqual([
        { kind: "template", key: "# Triage the backlog" },
      ]);
    });
  });

  describe("agents", () => {
    it("yields the subagent_type of each subagent dispatch", () => {
      expect(
        collect([
          toolCall("subagent", {
            subagent_type: "pre-completion-reviewer",
            prompt: "Review issue #935.",
          }),
        ]),
      ).toEqual([{ kind: "agent", key: "pre-completion-reviewer" }]);
    });

    it("skips a resumed dispatch, which re-sends no system prompt", () => {
      expect(
        collect([
          toolCall("subagent", {
            subagent_type: "tidy-first-assessor",
            prompt: "Answer.",
            resume: "86055480-b0a7-442",
          }),
        ]),
      ).toEqual([]);
    });

    it("ignores a different tool that happens to carry a subagent_type", () => {
      // The "subagent" value gets the line past the cheap text pre-filter, so
      // the tool-name check is what has to exclude it.
      expect(
        collect([
          toolCall("steer_subagent", {
            subagent_type: "tidy-first-assessor",
            message: "subagent",
          }),
        ]),
      ).toEqual([]);
    });
  });

  describe("skills", () => {
    it("keys a relative, root-absolute, or worktree-absolute read by the path under .pi/skills/", () => {
      expect(
        collect([
          read(".pi/skills/testing/SKILL.md"),
          read(
            "/Users/chris/development/pi/pi-packages/.pi/skills/testing/SKILL.md",
          ),
          read(
            "/Users/chris/development/pi/pi-packages-worktrees/issue-935/.pi/skills/testing/SKILL.md",
          ),
        ]),
      ).toEqual([
        { kind: "skill", key: "testing/SKILL.md" },
        { kind: "skill", key: "testing/SKILL.md" },
        { kind: "skill", key: "testing/SKILL.md" },
      ]);
    });

    it("keys a reference file inside a skill directory by its relative path", () => {
      expect(collect([read(".pi/skills/testing/tdd-planning.md")])).toEqual([
        { kind: "skill", key: "testing/tdd-planning.md" },
      ]);
    });

    it("counts a read starting at the top: offset null, absent, or 1", () => {
      expect(
        collect([
          read(".pi/skills/testing/SKILL.md", { offset: null }),
          toolCall("read", { path: ".pi/skills/fallow/SKILL.md" }),
          read(".pi/skills/mermaid/SKILL.md", { offset: 1, limit: 200 }),
        ]),
      ).toEqual([
        { kind: "skill", key: "testing/SKILL.md" },
        { kind: "skill", key: "fallow/SKILL.md" },
        { kind: "skill", key: "mermaid/SKILL.md" },
      ]);
    });

    it("skips a continuation or mid-file read, which is not a new load", () => {
      expect(
        collect([
          read(".pi/skills/package-pi-permission-system/SKILL.md", {
            offset: 277,
          }),
          read(".pi/skills/testing/SKILL.md", { offset: 2, limit: 12 }),
        ]),
      ).toEqual([]);
    });

    it("ignores an edit of a skill file", () => {
      expect(
        collect([
          toolCall("edit", {
            path: ".pi/skills/testing/SKILL.md",
            edits: [{ oldText: "a", newText: "b" }],
          }),
        ]),
      ).toEqual([]);
    });

    it("ignores skills outside the repo's .pi/skills/ directory", () => {
      expect(
        collect([
          read("/Users/chris/.pi/agent/skills/github-voice/SKILL.md"),
          read(
            ".pi/npm/node_modules/@eko24ive/pi-ask/skills/ask-user/SKILL.md",
          ),
          read("packages/pi-colgrep/skills/colgrep/SKILL.md"),
          read("/tmp/x.pi/skills/testing/SKILL.md"),
        ]),
      ).toEqual([]);
    });

    it("ignores a non-markdown file under .pi/skills/", () => {
      expect(collect([read(".pi/skills/testing/check.sh")])).toEqual([]);
    });
  });

  describe("window", () => {
    it("skips entries before since", () => {
      expect(
        collect([user("# Plan a GitHub issue", "2026-08-31T23:59:59.000Z")]),
      ).toEqual([]);
    });

    it("includes an entry at the start of the since day", () => {
      expect(
        collect([user("# Plan a GitHub issue", "2026-09-01T00:00:00.000Z")]),
      ).toEqual([{ kind: "template", key: "# Plan a GitHub issue" }]);
    });

    it("applies the bounds to skill reads", () => {
      expect(
        collect([
          read(".pi/skills/testing/SKILL.md", {}, "2026-08-31T23:59:59.000Z"),
          read(".pi/skills/fallow/SKILL.md", {}, "2026-09-01T00:00:00.000Z"),
          read(".pi/skills/mermaid/SKILL.md", {}, "2026-09-29T00:00:00.000Z"),
        ]),
      ).toEqual([{ kind: "skill", key: "fallow/SKILL.md" }]);
    });

    it("skips entries on or after until", () => {
      expect(
        collect([
          user("# Plan a GitHub issue", "2026-09-29T00:00:00.000Z"),
          toolCall(
            "subagent",
            { subagent_type: "pre-completion-reviewer" },
            "2026-10-02T08:00:00.000Z",
          ),
        ]),
      ).toEqual([]);
    });
  });

  describe("other entries", () => {
    it("skips non-message entries, unparseable lines, and assistant text", () => {
      expect(
        collect([
          JSON.stringify({ type: "session_info", name: "#935 TDD — x" }),
          "{not json",
          "",
          JSON.stringify({
            type: "message",
            timestamp: INSIDE,
            message: {
              role: "assistant",
              content: [{ type: "text", text: "# Plan a GitHub issue" }],
            },
          }),
        ]),
      ).toEqual([]);
    });
  });
});

describe("templateHeading", () => {
  it("returns the body's first H1, not one later in a fenced example", () => {
    const md =
      "---\ndescription: x\n---\n\n# Review session\n\n````markdown\n# Retro: #N\n````\n";
    expect(templateHeading(md)).toBe("# Review session");
  });

  it("skips a frontmatter line that looks like a heading", () => {
    expect(templateHeading("---\n# not a heading\n---\n\n# Real\n")).toBe(
      "# Real",
    );
  });

  it("returns an empty string when the body has no H1", () => {
    expect(templateHeading("---\ndescription: x\n---\n\n## Only H2\n")).toBe(
      "",
    );
  });

  it("yields a non-empty heading, unique across the set, for every real template", () => {
    const headings = readdirSync(PROMPTS_DIR)
      .filter((name) => name.endsWith(".md"))
      .map((name) =>
        templateHeading(readFileSync(path.join(PROMPTS_DIR, name), "utf8")),
      );
    expect(headings.length).toBeGreaterThan(0);
    expect(headings.filter((heading) => heading === "")).toEqual([]);
    expect(new Set(headings).size).toBe(headings.length);
    expect(
      templateHeading(readFileSync(path.join(PROMPTS_DIR, "retro.md"), "utf8")),
    ).toBe("# Review session and persist retro notes");
  });
});

describe("skillFiles", () => {
  let skillsDir;

  beforeEach(() => {
    skillsDir = mkdtempSync(path.join(tmpdir(), "skills-"));
    mkdirSync(path.join(skillsDir, "testing"));
    mkdirSync(path.join(skillsDir, "fallow", "refs"), { recursive: true });
    writeFileSync(
      path.join(skillsDir, "testing", "SKILL.md"),
      "---\nname: testing\n---\n\n# Testing\n",
    );
    writeFileSync(
      path.join(skillsDir, "testing", "tdd-planning.md"),
      "one two three\n",
    );
    writeFileSync(path.join(skillsDir, "testing", "check.sh"), "echo hi\n");
    writeFileSync(path.join(skillsDir, "fallow", "SKILL.md"), "# Fallow\n");
    writeFileSync(path.join(skillsDir, "fallow", "refs", "flags.md"), "a b\n");
  });

  afterEach(() => {
    rmSync(skillsDir, { recursive: true, force: true });
  });

  it("lists every markdown file recursively, keyed by its path under the directory, counting frontmatter words", () => {
    expect(skillFiles(skillsDir)).toEqual([
      {
        kind: "skill",
        file: "fallow/SKILL.md",
        key: "fallow/SKILL.md",
        words: 2,
      },
      {
        kind: "skill",
        file: "fallow/refs/flags.md",
        key: "fallow/refs/flags.md",
        words: 2,
      },
      {
        kind: "skill",
        file: "testing/SKILL.md",
        key: "testing/SKILL.md",
        words: 6,
      },
      {
        kind: "skill",
        file: "testing/tdd-planning.md",
        key: "testing/tdd-planning.md",
        words: 3,
      },
    ]);
  });

  it("lists a SKILL.md for every real skill directory", () => {
    const names = readdirSync(SKILLS_DIR);
    const listed = skillFiles(SKILLS_DIR).map((row) => row.key);
    expect(names.length).toBeGreaterThan(0);
    expect(
      names.filter((name) => !listed.includes(`${name}/SKILL.md`)),
    ).toEqual([]);
  });
});

describe("volumeRows", () => {
  const files = [
    { kind: "template", file: "plan-issue.md", key: "# Plan", words: 100 },
    { kind: "template", file: "ship.md", key: "# Ship", words: 50 },
    { kind: "agent", file: "reviewer.md", key: "reviewer", words: 30 },
  ];

  it("multiplies body words by invocations and sorts by volume, largest first", () => {
    const events = [
      { kind: "template", key: "# Ship" },
      { kind: "template", key: "# Ship" },
      { kind: "template", key: "# Ship" },
      { kind: "template", key: "# Plan" },
      { kind: "agent", key: "reviewer" },
    ];
    expect(volumeRows(files, events)).toEqual([
      {
        kind: "template",
        file: "ship.md",
        words: 50,
        invocations: 3,
        volume: 150,
      },
      {
        kind: "template",
        file: "plan-issue.md",
        words: 100,
        invocations: 1,
        volume: 100,
      },
      {
        kind: "agent",
        file: "reviewer.md",
        words: 30,
        invocations: 1,
        volume: 30,
      },
    ]);
  });

  it("ranks skill files by volume alongside templates and agents", () => {
    const withSkills = [
      ...files,
      {
        kind: "skill",
        file: "testing/SKILL.md",
        key: "testing/SKILL.md",
        words: 40,
      },
      {
        kind: "skill",
        file: "fallow/SKILL.md",
        key: "fallow/SKILL.md",
        words: 500,
      },
    ];
    const events = [
      { kind: "skill", key: "testing/SKILL.md" },
      { kind: "skill", key: "testing/SKILL.md" },
      { kind: "template", key: "# Plan" },
      { kind: "agent", key: "testing/SKILL.md" },
    ];
    expect(volumeRows(withSkills, events)).toEqual([
      {
        kind: "template",
        file: "plan-issue.md",
        words: 100,
        invocations: 1,
        volume: 100,
      },
      {
        kind: "skill",
        file: "testing/SKILL.md",
        words: 40,
        invocations: 2,
        volume: 80,
      },
      {
        kind: "template",
        file: "ship.md",
        words: 50,
        invocations: 0,
        volume: 0,
      },
      {
        kind: "agent",
        file: "reviewer.md",
        words: 30,
        invocations: 0,
        volume: 0,
      },
      {
        kind: "skill",
        file: "fallow/SKILL.md",
        words: 500,
        invocations: 0,
        volume: 0,
      },
    ]);
  });

  it("drops events matching no file and reports never-invoked files at zero", () => {
    const events = [
      { kind: "template", key: "Why did step 3 do that?" },
      { kind: "agent", key: "Explore" },
      { kind: "agent", key: "# Plan" },
    ];
    expect(volumeRows(files, events)).toEqual([
      {
        kind: "template",
        file: "plan-issue.md",
        words: 100,
        invocations: 0,
        volume: 0,
      },
      {
        kind: "template",
        file: "ship.md",
        words: 50,
        invocations: 0,
        volume: 0,
      },
      {
        kind: "agent",
        file: "reviewer.md",
        words: 30,
        invocations: 0,
        volume: 0,
      },
    ]);
  });
});
