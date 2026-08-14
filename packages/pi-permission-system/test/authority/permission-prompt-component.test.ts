import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type {
  PermissionPromptDecision,
  RequestPermissionOptions,
} from "#src/authority/permission-dialog";
import {
  highlightOccurrences,
  type PermissionPromptView,
  presentInlinePermissionPrompt,
  requestPermissionDecision,
} from "#src/authority/permission-prompt-component";

// ── Fake TUI view harness ────────────────────────────────────────────────────

function plainTheme() {
  return {
    fg(_color: string, text: string) {
      return text;
    },
    bg(_color: string, text: string) {
      return text;
    },
  };
}

function markedTheme() {
  return {
    fg(color: string, text: string) {
      return color === "warning" ? `<warning>${text}</warning>` : text;
    },
    bg(_color: string, text: string) {
      return text;
    },
  };
}

interface CapturedComponent {
  render(width: number): string[];
  handleInput(data: string): void;
}

type PromptFactory = (
  tui: { requestRender: () => void },
  theme: ReturnType<typeof plainTheme>,
  keybindings: { matches(data: string, action: string): boolean },
  done: (decision: PermissionPromptDecision) => void,
) => CapturedComponent;

/** Pi's default binding for the `app.tools.expand` action. */
const CTRL_O = "\u000f";

function makeFakeView(
  doublePressToConfirm: boolean,
  expandKey = CTRL_O,
  theme = plainTheme(),
) {
  const captured: {
    component?: CapturedComponent;
    options?: unknown;
  } = {};
  let toolsExpanded = false;
  const getToolsExpanded = vi.fn(() => toolsExpanded);
  const setToolsExpanded = vi.fn((expanded: boolean) => {
    toolsExpanded = expanded;
  });
  const custom = (
    factory: PromptFactory,
    options: unknown,
  ): Promise<PermissionPromptDecision> => {
    captured.options = options;
    return new Promise<PermissionPromptDecision>((resolve) => {
      captured.component = factory(
        { requestRender: vi.fn() },
        theme,
        {
          matches: (data, action) =>
            action === "app.tools.expand" && data === expandKey,
        },
        resolve,
      );
    });
  };
  const view = {
    mode: "tui",
    doublePressToConfirm,
    ui: {
      select: vi.fn(),
      input: vi.fn(),
      custom,
      getToolsExpanded,
      setToolsExpanded,
    },
  } as unknown as PermissionPromptView;
  return { view, captured, getToolsExpanded, setToolsExpanded };
}

const ARROW_DOWN = "\u001b[B";
const ENTER = "\r";
const ESCAPE = "\u001b";

async function runPrompt(
  doublePressToConfirm: boolean,
  keys: string[],
  options?: RequestPermissionOptions,
): Promise<PermissionPromptDecision> {
  const { view, captured } = makeFakeView(doublePressToConfirm);
  const promise = presentInlinePermissionPrompt(
    view,
    "Permission Required",
    "Allow read of secret.txt?",
    options,
  );
  for (const key of keys) {
    captured.component?.handleInput(key);
  }
  return promise;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("highlightOccurrences", () => {
  const paint = (text: string): string => `<warning>${text}</warning>`;

  it("highlights every exact occurrence of a shell-metacharacter target", () => {
    const target = 'echo "$HOME"; [ -f /tmp/x ]';
    const message = `Run ${target}\nThen ${target}`;

    expect(highlightOccurrences(message, target, paint)).toBe(
      `Run <warning>${target}</warning>\nThen <warning>${target}</warning>`,
    );
  });

  it("leaves the message unchanged when the target is absent or blank", () => {
    const message = "Run git status";

    expect(highlightOccurrences(message, "git push", paint)).toBe(message);
    expect(highlightOccurrences(message, "", paint)).toBe(message);
    expect(highlightOccurrences(message, " \t\n", paint)).toBe(message);
  });

  it("highlights one occurrence without overlapping later matches", () => {
    expect(highlightOccurrences("Run ls", "ls", paint)).toBe(
      "Run <warning>ls</warning>",
    );
    expect(highlightOccurrences("aaa aaa", "aaa", paint)).toBe(
      "<warning>aaa</warning> <warning>aaa</warning>",
    );
    expect(highlightOccurrences("lsls ls", "ls", paint)).toBe(
      "lsls <warning>ls</warning>",
    );
  });

  it("only highlights whole-token matches", () => {
    expect(highlightOccurrences("tools lsof ls", "ls", paint)).toBe(
      "tools lsof <warning>ls</warning>",
    );
    expect(highlightOccurrences("Run 'ls'", "ls", paint)).toBe(
      "Run '<warning>ls</warning>'",
    );
    expect(highlightOccurrences("/usr/bin/lsblk", "ls", paint)).toBe(
      "/usr/bin/lsblk",
    );
    expect(highlightOccurrences("Path: /outside/a.ts.", "/outside/a.ts", paint)).toBe(
      "Path: <warning>/outside/a.ts</warning>.",
    );
    expect(highlightOccurrences("Path: /outside/a.ts.bak", "/outside/a.ts", paint)).toBe(
      "Path: /outside/a.ts.bak",
    );
  });

  it("paints multiline targets one line at a time", () => {
    const target = "printf first\nprintf second";

    expect(highlightOccurrences(`Run:\n${target}`, target, paint)).toBe(
      "Run:\n<warning>printf first</warning>\n<warning>printf second</warning>",
    );
  });
});

describe("presentInlinePermissionPrompt", () => {
  it("renders inline (not as an overlay) with the message and hotkey labels", () => {
    const { view, captured } = makeFakeView(true);
    void presentInlinePermissionPrompt(
      view,
      "Permission Required",
      "Allow read of secret.txt?",
    );
    expect(captured.options).toEqual({ overlay: false });
    const text = captured.component?.render(80).join("\n") ?? "";
    expect(text).toContain("Allow read of secret.txt?");
    expect(text).toContain("Yes");
    expect(text).toContain("No, provide reason");
    expect(text).toContain("y");
    expect(text).toContain("r");
  });

  it("clips every rendered line to the terminal width", () => {
    const { view, captured } = makeFakeView(true);
    const longMessage = `Run ${"ls -t ~/.pi/agent/sessions/".repeat(20)}`;
    void presentInlinePermissionPrompt(
      view,
      "Permission Required",
      longMessage,
    );
    const width = 40;
    const lines = captured.component?.render(width) ?? [];
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(visibleWidth(line)).toBeLessThanOrEqual(width);
    }
  });

  it("highlights the target in decision and reason views", () => {
    const { view, captured } = makeFakeView(false, CTRL_O, markedTheme());
    const target = "rm -rf /tmp";
    const message = `Command:\n${target}\nFlagged: ${target}`;
    void presentInlinePermissionPrompt(view, "Permission Required", message, {
      highlightText: target,
    });

    const decision = captured.component?.render(120).join("\n") ?? "";
    captured.component?.handleInput("r");
    const reason = captured.component?.render(120).join("\n") ?? "";
    const highlighted = `<warning>${target}</warning>`;

    expect(decision.split(highlighted)).toHaveLength(3);
    expect(reason.split(highlighted)).toHaveLength(3);
  });

  describe("double-press to confirm (enabled)", () => {
    it("resolves approved on y, y", async () => {
      expect(await runPrompt(true, ["y", "y"])).toEqual({
        approved: true,
        state: "approved",
      });
    });

    it("does not resolve on a single armed press", async () => {
      const { view, captured } = makeFakeView(true);
      const promise = presentInlinePermissionPrompt(
        view,
        "Permission Required",
        "Allow?",
      );
      let settled = false;
      void promise.then(() => {
        settled = true;
      });
      captured.component?.handleInput("y");
      await Promise.resolve();
      expect(settled).toBe(false);
      const text = captured.component?.render(80).join("\n") ?? "";
      expect(text).toContain("Press y again to approve.");
    });

    it("resolves denied on n, n", async () => {
      expect(await runPrompt(true, ["n", "n"])).toEqual({
        approved: false,
        state: "denied",
      });
    });
  });

  describe("double-press to confirm (disabled)", () => {
    it("resolves approved on a single y", async () => {
      expect(await runPrompt(false, ["y"])).toEqual({
        approved: true,
        state: "approved",
      });
    });
  });

  describe("navigation and escape", () => {
    it("resolves the highlighted option on enter", async () => {
      // y -> s -> n, then enter
      expect(await runPrompt(true, [ARROW_DOWN, ARROW_DOWN, ENTER])).toEqual({
        approved: false,
        state: "denied",
      });
    });

    it("denies on escape at the decision step", async () => {
      expect(await runPrompt(true, [ESCAPE])).toEqual({
        approved: false,
        state: "denied",
      });
    });
  });

  describe("deny with reason", () => {
    it("collects a typed reason and resolves denied_with_reason", async () => {
      const decision = await runPrompt(false, ["r", "n", "o", "p", "e", ENTER]);
      expect(decision).toEqual({
        approved: false,
        state: "denied_with_reason",
        denialReason: "nope",
      });
    });

    it("rejects an empty reason and shows an error, then accepts a real one", async () => {
      const { view, captured } = makeFakeView(false);
      const promise = presentInlinePermissionPrompt(view, "T", "M");
      captured.component?.handleInput("r"); // opens reason step
      captured.component?.handleInput(ENTER); // empty submit -> rejected
      const text = captured.component?.render(80).join("\n") ?? "";
      expect(text).toContain("A reason is required.");
      captured.component?.handleInput("x");
      captured.component?.handleInput(ENTER);
      expect(await promise).toEqual({
        approved: false,
        state: "denied_with_reason",
        denialReason: "x",
      });
    });

    it("supports backspace while editing the reason", async () => {
      const decision = await runPrompt(false, [
        "r",
        "a",
        "b",
        "\u007f", // backspace removes "b"
        ENTER,
      ]);
      expect(decision).toEqual({
        approved: false,
        state: "denied_with_reason",
        denialReason: "a",
      });
    });

    it("navigates back to the decision step on escape from the reason step", async () => {
      // r opens reason, esc returns to decision, then n deny
      expect(await runPrompt(false, ["r", ESCAPE, "n"])).toEqual({
        approved: false,
        state: "denied",
      });
    });
  });

  describe("requestPermissionDecision dispatch", () => {
    it("renders the inline dialog in TUI mode", async () => {
      const { view, captured } = makeFakeView(true);
      const promise = requestPermissionDecision(view, "Title", "Message");
      expect(captured.component).toBeDefined();
      captured.component?.handleInput("y");
      captured.component?.handleInput("y");
      expect(await promise).toEqual({ approved: true, state: "approved" });
    });

    it("falls back to the select flow outside TUI mode", async () => {
      const custom = vi.fn();
      const select = vi.fn().mockResolvedValue("Yes");
      const view = {
        mode: "rpc",
        doublePressToConfirm: true,
        ui: { select, input: vi.fn(), custom },
      } as unknown as PermissionPromptView;

      const decision = await requestPermissionDecision(view, "Title", "Msg", {
        highlightText: "Msg",
      });

      expect(custom).not.toHaveBeenCalled();
      expect(select).toHaveBeenCalledWith("Title\nMsg", expect.any(Array));
      expect(decision).toEqual({ approved: true, state: "approved" });
    });
  });

  describe("approve-for-session scope (forwarded asks)", () => {
    const options: RequestPermissionOptions = {
      sessionScope: {
        subagentLabel: "This subagent only",
        servingSessionLabel: "The whole session",
      },
    };

    it("commits the subagent scope by default", async () => {
      expect(await runPrompt(false, ["s", ENTER], options)).toEqual({
        approved: true,
        state: "approved_for_session",
      });
    });

    it("commits the serving-session scope when the second option is chosen", async () => {
      expect(await runPrompt(false, ["s", ARROW_DOWN, ENTER], options)).toEqual(
        { approved: true, state: "approved_for_serving_session" },
      );
    });
  });

  describe("tool expansion", () => {
    const scopeOptions: RequestPermissionOptions = {
      sessionScope: {
        subagentLabel: "This subagent only",
        servingSessionLabel: "The whole session",
      },
    };

    it("toggles tool expansion without settling the decision", async () => {
      const { view, captured, getToolsExpanded, setToolsExpanded } =
        makeFakeView(true);
      const promise = presentInlinePermissionPrompt(view, "Title", "Message");
      let settled = false;
      void promise.then(() => {
        settled = true;
      });

      captured.component?.handleInput(CTRL_O);
      await Promise.resolve();
      expect(setToolsExpanded).toHaveBeenNthCalledWith(1, true);
      expect(settled).toBe(false);

      captured.component?.handleInput(CTRL_O);
      await Promise.resolve();
      expect(setToolsExpanded).toHaveBeenNthCalledWith(2, false);
      expect(settled).toBe(false);
      expect(getToolsExpanded).toHaveBeenCalledTimes(2);

      captured.component?.handleInput("y");
      captured.component?.handleInput("y");
      expect(await promise).toEqual({ approved: true, state: "approved" });
    });

    it("toggles during the scope step without committing the grant", async () => {
      const { view, captured, setToolsExpanded } = makeFakeView(false);
      const promise = presentInlinePermissionPrompt(
        view,
        "Title",
        "Message",
        scopeOptions,
      );

      captured.component?.handleInput("s"); // decision -> scope
      captured.component?.handleInput(CTRL_O);
      expect(setToolsExpanded).toHaveBeenNthCalledWith(1, true);

      captured.component?.handleInput(ENTER);
      expect(await promise).toEqual({
        approved: true,
        state: "approved_for_session",
      });
    });

    it("does not intercept the expand key while a denial reason is typed", async () => {
      // Bound to a printable key on purpose: the default Ctrl+O is dropped by
      // the reason editor's isPrintable guard anyway, so it cannot discriminate.
      const { view, captured, setToolsExpanded } = makeFakeView(false, "e");
      const promise = presentInlinePermissionPrompt(view, "Title", "Message");

      captured.component?.handleInput("r"); // decision -> reason
      captured.component?.handleInput("e"); // typed literally, not an app action
      captured.component?.handleInput(ENTER);

      expect(await promise).toEqual({
        approved: false,
        state: "denied_with_reason",
        denialReason: "e",
      });
      expect(setToolsExpanded).not.toHaveBeenCalled();
    });
  });
});
