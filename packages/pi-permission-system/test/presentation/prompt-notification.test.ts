import { describe, expect, it } from "vitest";
import {
  describePromptNotice,
  type NotificationSession,
  type PromptNotice,
  renderPromptNotification,
} from "#src/presentation/prompt-notification";
import type {
  PromptPayloadKind,
  PromptRequestFacts,
} from "#src/presentation/prompt-payload";

const BEL = "\x07";
const ESC = "\x1b";

const NOTICE: PromptNotice = { title: "pi", body: "Permission Required" };

/** The em-dash separating `pi` from the session label, spelled as its code point. */
const DASH = "\u2014";

function makeRequest(
  overrides: Partial<PromptRequestFacts> = {},
): PromptRequestFacts {
  return {
    requester: { agentName: null, forwarded: false, sessionId: null },
    surface: "bash",
    toolName: "bash",
    invokedToolName: null,
    value: "git status",
    matchedPattern: null,
    commandContext: null,
    matchedSpelling: null,
    executedUnit: null,
    decidingPath: null,
    ...overrides,
  };
}

const NAMED: NotificationSession = { name: "refactor-auth", cwd: "/w/repo" };

describe("renderPromptNotification", () => {
  describe("each channel", () => {
    it("writes a bare BEL for bell", () => {
      expect(renderPromptNotification(["bell"], NOTICE)).toBe(BEL);
    });

    it("writes the title ahead of the body into OSC 9's single field", () => {
      expect(
        renderPromptNotification(["osc9"], {
          title: "the title",
          body: "the body",
        }),
      ).toBe(`${ESC}]9;the title: the body${BEL}`);
    });

    it("writes the notice's title and body into OSC 777's two fields", () => {
      expect(
        renderPromptNotification(["osc777"], {
          title: "the title",
          body: "the body",
        }),
      ).toBe(`${ESC}]777;notify;the title;the body${BEL}`);
    });
  });

  describe("channel lists", () => {
    it("concatenates the channels in configured order", () => {
      expect(renderPromptNotification(["osc777", "bell"], NOTICE)).toBe(
        `${ESC}]777;notify;pi;Permission Required${BEL}${BEL}`,
      );
    });

    it("renders nothing for an empty list", () => {
      expect(renderPromptNotification([], NOTICE)).toBe("");
    });
  });

  describe("field sanitizing", () => {
    // A control character in a field could terminate the sequence early or
    // start a new one, so none survives into any OSC field.
    const hostile = `a${BEL}b${ESC}c\x7fd;e`;

    it("drops control characters and keeps semicolons in osc9", () => {
      expect(
        renderPromptNotification(["osc9"], { title: hostile, body: hostile }),
      ).toBe(`${ESC}]9;abcd;e: abcd;e${BEL}`);
    });

    it("drops control characters and turns semicolons into colons in the osc777 body", () => {
      // A semicolon separates the OSC 777 fields, so one in the body would
      // split it.
      expect(
        renderPromptNotification(["osc777"], { title: "pi", body: hostile }),
      ).toBe(`${ESC}]777;notify;pi;abcd:e${BEL}`);
    });

    it("drops control characters and turns semicolons into colons in the osc777 title", () => {
      expect(
        renderPromptNotification(["osc777"], { title: hostile, body: "body" }),
      ).toBe(`${ESC}]777;notify;abcd:e;body${BEL}`);
    });
  });
});

describe("describePromptNotice", () => {
  describe("title", () => {
    it("names the session", () => {
      expect(
        describePromptNotice("Permission Required", makeRequest(), NAMED).title,
      ).toBe(`pi ${DASH} refactor-auth`);
    });

    it("falls back to the working directory's name for an unnamed session", () => {
      expect(
        describePromptNotice("Permission Required", makeRequest(), {
          name: undefined,
          cwd: "/w/pi-packages",
        }).title,
      ).toBe(`pi ${DASH} pi-packages`);
    });

    it("treats an empty session name as unnamed", () => {
      expect(
        describePromptNotice("Permission Required", makeRequest(), {
          name: "",
          cwd: "/w/pi-packages",
        }).title,
      ).toBe(`pi ${DASH} pi-packages`);
    });

    it("is bare pi when neither a name nor a directory name exists", () => {
      expect(
        describePromptNotice("Permission Required", makeRequest(), {
          name: undefined,
          cwd: "/",
        }).title,
      ).toBe("pi");
    });
  });

  describe("body", () => {
    it("names the tool after the dialog title", () => {
      expect(
        describePromptNotice("Permission Required", makeRequest(), NAMED).body,
      ).toBe("Permission Required: bash");
    });

    it("names the tool rather than the surface that gated it", () => {
      expect(
        describePromptNotice(
          "Permission Required",
          makeRequest({ toolName: "read", surface: "path_read" }),
          NAMED,
        ).body,
      ).toBe("Permission Required: read");
    });

    it("names the surface when the ask is not tool-shaped", () => {
      expect(
        describePromptNotice(
          "Permission Required",
          makeRequest({ toolName: null, surface: "skill" }),
          NAMED,
        ).body,
      ).toBe("Permission Required: skill");
    });

    it("names a local requesting agent", () => {
      expect(
        describePromptNotice(
          "Permission Required",
          makeRequest({
            requester: {
              agentName: "planner",
              forwarded: false,
              sessionId: null,
            },
          }),
          NAMED,
        ).body,
      ).toBe("Permission Required: bash (planner)");
    });

    it("names the subagent a forwarded ask came from", () => {
      expect(
        describePromptNotice(
          "Permission Required (Subagent)",
          makeRequest({
            toolName: "read",
            surface: "read",
            requester: {
              agentName: "scout",
              forwarded: true,
              sessionId: "child-1",
            },
          }),
          NAMED,
        ).body,
      ).toBe("Permission Required (Subagent): read (scout)");
    });

    it("names the agent alone when the ask carries no tool or surface", () => {
      expect(
        describePromptNotice(
          "Permission Required (Subagent)",
          makeRequest({
            toolName: null,
            surface: "",
            requester: { agentName: "scout", forwarded: true, sessionId: null },
          }),
          NAMED,
        ).body,
      ).toBe("Permission Required (Subagent): scout");
    });

    it("is the dialog title alone when nothing names the ask", () => {
      expect(
        describePromptNotice(
          "Permission Required (Subagent)",
          makeRequest({
            toolName: null,
            surface: "",
            requester: { agentName: "", forwarded: true, sessionId: null },
          }),
          NAMED,
        ).body,
      ).toBe("Permission Required (Subagent)");
    });
  });

  describe("what never reaches a notification", () => {
    // One request per ask kind, as its gate shapes it; every one carries the
    // decision-relevant value, the matched rule, and the executed unit, none of
    // which a notification history may hold.
    const cases: Record<
      PromptPayloadKind,
      Pick<PromptRequestFacts, "toolName" | "surface"> & { body: string }
    > = {
      bash: { toolName: "bash", surface: "bash", body: "bash" },
      mcp: { toolName: "mcp", surface: "mcp", body: "mcp" },
      tool: { toolName: "write", surface: "write", body: "write" },
      path: { toolName: "read", surface: "path_read", body: "read" },
      external_directory: {
        toolName: "read",
        surface: "external_directory_read",
        body: "read",
      },
      bash_external_directory: {
        toolName: "bash",
        surface: "external_directory_write",
        body: "bash",
      },
      skill: { toolName: null, surface: "skill", body: "skill" },
      skill_read: { toolName: "read", surface: "skill", body: "read" },
      forwarded: { toolName: null, surface: "bash", body: "bash" },
    };

    for (const [kind, { toolName, surface, body }] of Object.entries(cases)) {
      it(`holds no request value for a ${kind} ask`, () => {
        const notice = describePromptNotice(
          "Permission Required",
          makeRequest({
            toolName,
            surface,
            value: "SECRET-VALUE",
            matchedPattern: "SECRET-RULE",
            executedUnit: "SECRET-UNIT",
          }),
          NAMED,
        );

        expect(notice.body).toBe(`Permission Required: ${body}`);
        expect(
          renderPromptNotification(["bell", "osc9", "osc777"], notice),
        ).not.toContain("SECRET");
      });
    }
  });
});
