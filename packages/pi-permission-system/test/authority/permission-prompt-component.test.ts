import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type {
  PermissionPromptDecision,
  RequestPermissionOptions,
} from "#src/authority/permission-dialog";
import {
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

const CONFIGURED_TOOLS_EXPAND_KEY = "\u0010";

function makeFakeView(doublePressToConfirm: boolean) {
  const captured: {
    component?: CapturedComponent;
    options?: unknown;
  } = {};
  let toolsExpanded = false;
  const custom = (
    factory: PromptFactory,
    options: unknown,
  ): Promise<PermissionPromptDecision> => {
    captured.options = options;
    return new Promise<PermissionPromptDecision>((resolve) => {
      captured.component = factory(
        { requestRender: vi.fn() },
        plainTheme(),
        {
          matches: (data, action) =>
            action === "app.tools.expand" &&
            data === CONFIGURED_TOOLS_EXPAND_KEY,
        },
        resolve,
      );
    });
  };
  const getToolsExpanded = vi.fn(() => toolsExpanded);
  const setToolsExpanded = vi.fn((expanded: boolean) => {
    toolsExpanded = expanded;
  });
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

  describe("tool expansion", () => {
    it("toggles tools with the configured app.tools.expand key without resolving", async () => {
      const { view, captured, getToolsExpanded, setToolsExpanded } =
        makeFakeView(true);
      const promise = presentInlinePermissionPrompt(view, "Title", "Message");
      let settled = false;
      void promise.then(() => {
        settled = true;
      });

      captured.component?.handleInput(CONFIGURED_TOOLS_EXPAND_KEY);
      await Promise.resolve();

      expect(getToolsExpanded).toHaveBeenCalledTimes(1);
      expect(setToolsExpanded).toHaveBeenNthCalledWith(1, true);
      expect(settled).toBe(false);

      captured.component?.handleInput(CONFIGURED_TOOLS_EXPAND_KEY);
      await Promise.resolve();

      expect(getToolsExpanded).toHaveBeenCalledTimes(2);
      expect(setToolsExpanded).toHaveBeenNthCalledWith(2, false);
      expect(settled).toBe(false);

      captured.component?.handleInput("y");
      await Promise.resolve();
      expect(settled).toBe(false);

      captured.component?.handleInput("y");
      expect(await promise).toEqual({ approved: true, state: "approved" });
    });
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

      const decision = await requestPermissionDecision(view, "Title", "Msg");

      expect(custom).not.toHaveBeenCalled();
      expect(select).toHaveBeenCalledTimes(1);
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
});
