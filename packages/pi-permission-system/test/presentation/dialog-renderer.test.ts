import { describe, expect, it } from "vitest";
import {
  completeViewBudget,
  type DialogBudget,
  renderPromptDialog,
} from "#src/presentation/dialog-renderer";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

const WIDE = completeViewBudget(200);

/** The rendered lines for a payload built from the shared structural fixture. */
function render(
  overrides: Parameters<typeof makePromptPayload>[0],
): readonly string[] {
  return renderPromptDialog(makePromptPayload(overrides), WIDE).lines;
}

/** A payload whose request facts override the fixture's defaults. */
function requestFacts(
  overrides: Partial<ReturnType<typeof makePromptPayload>["request"]>,
) {
  return { ...makePromptPayload().request, ...overrides };
}

describe("renderPromptDialog", () => {
  describe("the invariant core", () => {
    it("renders a bash ask as one aligned fact per line", () => {
      expect(
        render({
          kind: "bash",
          request: requestFacts({
            requester: {
              agentName: "scout",
              forwarded: false,
              sessionId: null,
            },
            surface: "bash",
            toolName: "bash",
            value: "cat /etc/hosts",
            matchedPattern: "*",
          }),
        }),
      ).toEqual([
        "agent   : scout",
        "tool    : bash",
        "rule    : *",
        "command : cat /etc/hosts",
      ]);
    });

    it("names the gate surface when it differs from the tool", () => {
      expect(
        render({
          kind: "external_directory",
          request: requestFacts({
            surface: "external_directory",
            toolName: "write",
            value: "/etc/hosts",
            matchedPattern: "*",
          }),
        }),
      ).toEqual([
        "tool    : write",
        "surface : external_directory",
        "rule    : *",
        "path    : /etc/hosts",
      ]);
    });

    it("omits an agent line for an unnamed local requester, and a surface the value label already names", () => {
      expect(
        render({
          kind: "path",
          request: requestFacts({
            surface: "path",
            toolName: "read",
            value: "/tmp/x",
            matchedPattern: null,
          }),
        }),
      ).toEqual(["tool : read", "path : /tmp/x"]);
    });

    it("names a directional path surface, which the value label no longer states", () => {
      // A direction-proven tool ask decides on `path_read`, which differs from
      // both the tool name and the `path` value label — so the operator now
      // sees which surface fired (#806).
      expect(
        render({
          kind: "path",
          request: requestFacts({
            surface: "path_read",
            toolName: "read",
            value: "/tmp/x",
            matchedPattern: null,
          }),
        }),
      ).toEqual(["tool    : read", "surface : path_read", "path    : /tmp/x"]);
    });

    it("omits the value line when the tool line already carries it", () => {
      expect(
        render({
          kind: "tool",
          request: requestFacts({
            surface: "fetch",
            toolName: "fetch",
            value: "fetch",
            matchedPattern: "*",
          }),
        }),
      ).toEqual(["tool : fetch", "rule : *"]);
    });

    it("labels an MCP ask's value as the target", () => {
      expect(
        render({
          kind: "mcp",
          request: requestFacts({
            surface: "mcp__github__create_issue",
            toolName: "mcp__github__create_issue",
            value: "github:create_issue",
            matchedPattern: "mcp__github__*",
          }),
        }),
      ).toEqual([
        "tool   : mcp__github__create_issue",
        "rule   : mcp__github__*",
        "target : github:create_issue",
      ]);
    });

    it("renders a skill ask without repeating the surface", () => {
      expect(
        render({
          kind: "skill",
          request: requestFacts({
            surface: "skill",
            toolName: null,
            value: "deploy",
            matchedPattern: null,
          }),
        }),
      ).toEqual(["skill : deploy"]);
    });

    it("renders the executed unit of an unstrippable wrapper", () => {
      expect(
        render({
          kind: "bash",
          request: requestFacts({
            surface: "bash",
            toolName: "bash",
            value: "xargs grep foo",
            matchedPattern: "<indirection-bash-wrapper>",
            executedUnit: "grep foo",
          }),
        }),
      ).toEqual([
        "tool    : bash",
        "rule    : <indirection-bash-wrapper>",
        "command : xargs grep foo",
        "runs    : grep foo",
      ]);
    });

    it("names the nested context the offending unit ran in", () => {
      expect(
        render({
          kind: "bash",
          request: requestFacts({
            surface: "bash",
            toolName: "bash",
            value: "rm -rf /tmp/x",
            matchedPattern: "rm *",
            commandContext: "command_substitution",
          }),
        }),
      ).toEqual([
        "tool    : bash",
        "rule    : rm *",
        "command : rm -rf /tmp/x",
        "context : command substitution",
      ]);
    });

    it("names the invoked tool when a shell alias re-exposes bash", () => {
      expect(
        render({
          kind: "bash",
          request: requestFacts({
            surface: "bash",
            toolName: "bash",
            invokedToolName: "exec_command",
            value: "ls",
            matchedPattern: "*",
          }),
        }),
      ).toEqual([
        "tool    : bash (invoked as exec_command)",
        "rule    : *",
        "command : ls",
      ]);
    });
  });

  describe("evidence", () => {
    it("renders each entry under the core, sharing the label column", () => {
      expect(
        render({
          kind: "bash",
          request: requestFacts({
            surface: "bash",
            toolName: "bash",
            value: "rm -rf build",
            matchedPattern: "rm *",
          }),
          evidence: [
            {
              label: "full command",
              text: "npm run clean && rm -rf build",
              detail: null,
            },
          ],
        }),
      ).toEqual([
        "tool         : bash",
        "rule         : rm *",
        "command      : rm -rf build",
        "full command : npm run clean && rm -rf build",
      ]);
    });

    it("keeps an entry's detail on the entry's own line", () => {
      expect(
        render({
          kind: "bash_external_directory",
          request: requestFacts({
            surface: "external_directory",
            toolName: "bash",
            value: "cat /etc/hosts /tmp/x",
            matchedPattern: "*",
          }),
          evidence: [
            { label: "working directory", text: "/repo", detail: null },
            {
              label: "external path",
              text: "/etc/hosts",
              detail: "/private/etc/hosts",
            },
            { label: "external path", text: "/tmp/x", detail: null },
          ],
        }),
      ).toEqual([
        "tool              : bash",
        "surface           : external_directory",
        "rule              : *",
        "command           : cat /etc/hosts /tmp/x",
        "working directory : /repo",
        "external path     : /etc/hosts → /private/etc/hosts",
        "external path     : /tmp/x",
      ]);
    });

    it("renders a skill read's path", () => {
      expect(
        render({
          kind: "skill_read",
          request: requestFacts({
            surface: "skill",
            toolName: null,
            value: "deploy",
            matchedPattern: null,
          }),
          evidence: [
            {
              label: "read path",
              text: "/skills/deploy/SKILL.md",
              detail: null,
            },
          ],
        }),
      ).toEqual(["skill     : deploy", "read path : /skills/deploy/SKILL.md"]);
    });
  });

  describe("the per-field width cap", () => {
    const NARROW: DialogBudget = {
      maxRows: Number.POSITIVE_INFINITY,
      fieldMaxWidth: 12,
      width: 200,
    };

    /** A bash ask whose command is the pathological field. */
    function bashAsk(command: string, fullCommand?: string) {
      return makePromptPayload({
        kind: "bash",
        request: {
          ...makePromptPayload().request,
          toolName: "bash",
          surface: "bash",
          value: command,
          matchedPattern: "*",
        },
        evidence:
          fullCommand === undefined
            ? []
            : [{ label: "full command", text: fullCommand, detail: null }],
      });
    }

    it("clips a core field and marks it, without stating a count", () => {
      const view = renderPromptDialog(
        bashAsk("echo the quick brown fox"),
        NARROW,
      );

      expect(view.lines).toEqual([
        "tool    : bash",
        "rule    : *",
        "command : echo the qui…",
      ]);
      expect(view.elided).toBe(true);
    });

    it("clips an evidence field the same way", () => {
      const view = renderPromptDialog(
        bashAsk("echo hi", "echo hi && echo there"),
        NARROW,
      );

      expect(view.lines).toEqual([
        "tool         : bash",
        "rule         : *",
        "command      : echo hi",
        "full command : echo hi && e…",
      ]);
      expect(view.elided).toBe(true);
    });

    it("reproduces the field verbatim under the complete view", () => {
      const view = renderPromptDialog(
        bashAsk("echo the quick brown fox"),
        completeViewBudget(200),
      );

      expect(view.lines).toContain("command : echo the quick brown fox");
      expect(view.elided).toBe(false);
    });

    it("indents a multi-line field under its label", () => {
      const view = renderPromptDialog(
        bashAsk("cat <<'EOF'\nfirst line\nsecond line\nEOF"),
        completeViewBudget(200),
      );

      expect(view.lines).toEqual([
        "tool    : bash",
        "rule    : *",
        "command : cat <<'EOF'",
        "          first line",
        "          second line",
        "          EOF",
      ]);
    });
  });

  describe("the row budget", () => {
    /** A tool ask with `count` evidence entries, each one row wide. */
    function askWithEvidence(count: number) {
      return makePromptPayload({
        kind: "tool",
        request: {
          ...makePromptPayload().request,
          surface: "fetch",
          toolName: "fetch",
          value: "fetch",
          matchedPattern: "*",
        },
        evidence: Array.from({ length: count }, (_, index) => ({
          label: "input",
          text: `entry ${index}`,
          detail: null,
        })),
      });
    }

    it("drops evidence that does not fit and marks the drop", () => {
      const view = renderPromptDialog(askWithEvidence(6), {
        maxRows: 5,
        fieldMaxWidth: 200,
        width: 200,
      });

      expect(view.lines).toEqual([
        "tool  : fetch",
        "rule  : *",
        "input : entry 0",
        "input : entry 1",
        "…",
      ]);
      expect(view.elided).toBe(true);
    });

    it("marks nothing when every entry fits", () => {
      const view = renderPromptDialog(askWithEvidence(2), {
        maxRows: 5,
        fieldMaxWidth: 200,
        width: 200,
      });

      expect(view.lines).toHaveLength(4);
      expect(view.elided).toBe(false);
    });

    it("counts rows after wrapping to the width", () => {
      const payload = makePromptPayload({
        kind: "tool",
        request: {
          ...makePromptPayload().request,
          surface: "fetch",
          toolName: "fetch",
          value: "fetch",
          matchedPattern: "*",
        },
        evidence: [{ label: "input", text: "a".repeat(60), detail: null }],
      });

      // The same entry is one row at a wide width and four once wrapped, so
      // the identical budget admits it only in the first case.
      expect(
        renderPromptDialog(payload, {
          maxRows: 5,
          fieldMaxWidth: 200,
          width: 200,
        }),
      ).toEqual({
        lines: ["tool  : fetch", "rule  : *", `input : ${"a".repeat(60)}`],
        elided: false,
      });

      const wrapped = renderPromptDialog(payload, {
        maxRows: 5,
        fieldMaxWidth: 200,
        width: 20,
      });
      expect(wrapped.lines).toEqual(["tool  : fetch", "rule  : *", "…"]);
      expect(wrapped.elided).toBe(true);
    });

    it("renders the whole core when it alone exceeds the budget", () => {
      const view = renderPromptDialog(askWithEvidence(3), {
        maxRows: 1,
        fieldMaxWidth: 200,
        width: 200,
      });

      expect(view.lines).toEqual(["tool  : fetch", "rule  : *"]);
      expect(view.elided).toBe(true);
    });

    it("bounds the reported forwarded here-string ask (#710)", () => {
      const body = Array.from(
        { length: 200 },
        () => "- a finding line about some module in the codebase",
      ).join("\n");
      const command = `@'\n${body}\n'@ | Out-File -FilePath report.md`;
      const budget = { maxRows: 24, fieldMaxWidth: 400, width: 120 };

      const view = renderPromptDialog(
        makePromptPayload({
          kind: "forwarded",
          request: {
            ...makePromptPayload().request,
            requester: {
              agentName: "scout",
              forwarded: true,
              sessionId: "abc123",
            },
            surface: "bash",
            toolName: null,
            value: command,
            matchedPattern: null,
          },
          evidence: [
            {
              label: "requested",
              text: `Subagent 'scout' requested bash command '${command}'.`,
              detail: null,
            },
          ],
        }),
        budget,
      );

      expect(view.lines.length).toBeLessThanOrEqual(budget.maxRows);
      expect(view.lines[0]).toBe("subagent  : scout · session abc123");
      expect(view.lines[1]).toBe("surface   : bash");
      expect(view.lines[2]).toBe("command   : @'");
      expect(view.elided).toBe(true);
    });

    it("bounds the same forwarded here-string ask carrying the child's own payload (#745)", () => {
      // The same ask, arriving as the child built it rather than as a relayed
      // sentence: `kind: "bash"` with the child's real evidence entries. A
      // different input to the same budget, so the row bound is measured here
      // rather than inferred from the `kind: "forwarded"` pin above.
      const body = Array.from(
        { length: 200 },
        () => "- a finding line about some module in the codebase",
      ).join("\n");
      const command = `@'\n${body}\n'@ | Out-File -FilePath report.md`;
      const budget = { maxRows: 24, fieldMaxWidth: 400, width: 120 };

      const view = renderPromptDialog(
        makePromptPayload({
          kind: "bash",
          request: {
            ...makePromptPayload().request,
            requester: {
              agentName: "scout",
              forwarded: true,
              sessionId: "abc123",
            },
            surface: "bash",
            toolName: "bash",
            value: command,
            matchedPattern: "*",
          },
          evidence: [
            { label: "full command", text: command, detail: null },
            { label: "working directory", text: "/repo", detail: null },
          ],
        }),
        budget,
      );

      expect(view.lines.length).toBeLessThanOrEqual(budget.maxRows);
      expect(view.elided).toBe(true);
    });
  });

  describe("highlighting the flagged element", () => {
    /** A visible stand-in for the theme's warning colour. */
    const mark = (text: string) => `[${text}]`;

    it("paints the flagged value and its whole-token occurrences in evidence", () => {
      expect(
        renderPromptDialog(
          makePromptPayload({
            kind: "bash",
            request: {
              ...makePromptPayload().request,
              surface: "bash",
              toolName: "bash",
              value: "ls",
              matchedPattern: "*",
            },
            evidence: [
              {
                label: "full command",
                text: "lsof | ls && /usr/bin/lsblk",
                detail: null,
              },
            ],
          }),
          completeViewBudget(200),
          mark,
        ).lines,
      ).toEqual([
        "tool         : bash",
        "rule         : *",
        "command      : [ls]",
        "full command : lsof | [ls] && /usr/bin/lsblk",
      ]);
    });

    it("paints each escaping path rather than the command that referenced them", () => {
      expect(
        renderPromptDialog(
          makePromptPayload({
            kind: "bash_external_directory",
            request: {
              ...makePromptPayload().request,
              surface: "external_directory",
              toolName: "bash",
              value: "cat /etc/hosts /etc/hostsbackup",
              matchedPattern: "*",
            },
            evidence: [
              { label: "working directory", text: "/repo", detail: null },
              { label: "external path", text: "/etc/hosts", detail: null },
            ],
          }),
          completeViewBudget(200),
          mark,
        ).lines,
      ).toEqual([
        "tool              : bash",
        "surface           : external_directory",
        "rule              : *",
        "command           : cat [/etc/hosts] /etc/hostsbackup",
        "working directory : /repo",
        "external path     : [/etc/hosts]",
      ]);
    });

    it("leaves the text untouched when no paint is supplied", () => {
      expect(
        render({
          kind: "bash",
          request: requestFacts({
            surface: "bash",
            toolName: "bash",
            value: "ls",
            matchedPattern: "*",
          }),
        }),
      ).toEqual(["tool    : bash", "rule    : *", "command : ls"]);
    });
  });

  describe("a forwarded ask", () => {
    it("names the requesting subagent and its session", () => {
      expect(
        render({
          kind: "forwarded",
          request: requestFacts({
            requester: {
              agentName: "scout",
              forwarded: true,
              sessionId: "abc123",
            },
            surface: "bash",
            toolName: null,
            value: "cat /etc/hosts",
            matchedPattern: null,
          }),
        }),
      ).toEqual([
        "subagent : scout · session abc123",
        "surface  : bash",
        "command  : cat /etc/hosts",
      ]);
    });

    it("renders a version-skewed request that names neither agent nor session", () => {
      expect(
        render({
          kind: "forwarded",
          request: requestFacts({
            requester: { agentName: "", forwarded: true, sessionId: "" },
            surface: "read",
            toolName: null,
            value: "/tmp/x",
            matchedPattern: null,
          }),
        }),
      ).toEqual(["subagent : unknown", "surface  : read", "value    : /tmp/x"]);
    });
  });
});
