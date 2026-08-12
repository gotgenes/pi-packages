import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import type { InteractivePermissionChoice } from "#src/authority/interactive-permission-choice";
import type { RequestPermissionOptions } from "#src/authority/permission-dialog";
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
  done: (decision: InteractivePermissionChoice) => void,
) => CapturedComponent;

/** Pi's default binding for the `app.tools.expand` action. */
const CTRL_O = "\u000f";

function makeFakeView(doublePressToConfirm: boolean, expandKey = CTRL_O) {
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
  ): Promise<InteractivePermissionChoice> => {
    captured.options = options;
    return new Promise<InteractivePermissionChoice>((resolve) => {
      captured.component = factory(
        { requestRender: vi.fn() },
        plainTheme(),
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
    showPersistenceSummary: true,
    setShowPersistenceSummary: vi.fn(() => true),
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
const CTRL_U = "\u0015";

async function runPrompt(
  doublePressToConfirm: boolean,
  keys: string[],
  options?: RequestPermissionOptions,
): Promise<InteractivePermissionChoice> {
  const { view, captured } = makeFakeView(doublePressToConfirm);
  const promise = presentInlinePermissionPrompt(
    view,
    "Permission Required",
    "Allow read of secret.txt?",
    options,
  );
  for (const key of keys) {
    captured.component?.handleInput(key);
    captured.component?.render(100);
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

    it("keeps the inline keybind flow for durable choices in TUI mode", async () => {
      const { view, captured } = makeFakeView(false);
      const promise = requestPermissionDecision(view, "Title", "Msg", {
        persistent: {
          proposal: { surface: "bash", patterns: ["git status"] },
          globalTarget: {
            scope: "global",
            path: "/agent/config.json",
            expectedDir: "/agent",
          },
        },
      });

      expect(captured.component).toBeDefined();
      const text = captured.component?.render(100).join("\n") ?? "";
      expect(text).toContain("(e) Edit proposed pattern(s)");
      expect(text).toContain("(g) Persist globally");
      captured.component?.handleInput("y");
      expect(await promise).toEqual({ approved: true, state: "approved" });
      expect(view.ui.select).not.toHaveBeenCalled();
    });

    it("falls back to the select flow outside TUI mode", async () => {
      const custom = vi.fn();
      const select = vi.fn().mockResolvedValue("Yes");
      const view = {
        mode: "rpc",
        doublePressToConfirm: true,
        showPersistenceSummary: true,
        ui: { select, input: vi.fn(), custom },
      } as unknown as PermissionPromptView;

      const decision = await requestPermissionDecision(view, "Title", "Msg");

      expect(custom).not.toHaveBeenCalled();
      expect(select).toHaveBeenCalledTimes(1);
      expect(decision).toEqual({ approved: true, state: "approved" });
    });
  });

  describe("durable approval shortcuts and navigation", () => {
    const projectTarget = {
      scope: "project" as const,
      path: "/project/.pi/extensions/pi-permission-system/config.local.json",
      expectedDir: "/project/.pi/extensions/pi-permission-system",
    };
    const globalTarget = {
      scope: "global" as const,
      path: "/agent/config.json",
      expectedDir: "/agent",
    };
    const options: RequestPermissionOptions = {
      persistent: {
        proposal: { surface: "bash", patterns: ["git status"] },
        projectTarget,
        globalTarget,
      },
    };

    it("persists project approval with p and a visible summary", async () => {
      const { view, captured } = makeFakeView(true);
      const promise = presentInlinePermissionPrompt(
        view,
        "Title",
        "Msg",
        options,
      );

      captured.component?.handleInput("p");
      const summary = captured.component?.render(100).join("\n") ?? "";
      expect(summary).toContain("Scope: project-local");
      expect(summary).toContain("git status");
      expect(summary).toContain(projectTarget.path);
      captured.component?.handleInput(ENTER);

      expect(await promise).toEqual({
        kind: "persist",
        scope: "project",
        proposal: options.persistent?.proposal,
        target: projectTarget,
        summaryShown: true,
      });
    });

    it("persists global approval without a typed acknowledgment", async () => {
      expect(await runPrompt(false, ["g", ENTER], options)).toEqual({
        kind: "persist",
        scope: "global",
        proposal: options.persistent?.proposal,
        target: globalTarget,
        summaryShown: true,
      });
    });

    it("does not accept summary confirmation before the summary renders", async () => {
      const { view, captured } = makeFakeView(false);
      const promise = presentInlinePermissionPrompt(
        view,
        "Title",
        "Msg",
        options,
      );
      let settled = false;
      void promise.then(() => {
        settled = true;
      });

      captured.component?.handleInput("p");
      captured.component?.handleInput(ENTER);
      await Promise.resolve();
      expect(settled).toBe(false);

      expect(captured.component?.render(100).join("\n")).toContain(
        "Scope: project-local",
      );
      captured.component?.handleInput(ENTER);
      await expect(promise).resolves.toMatchObject({
        kind: "persist",
        summaryShown: true,
      });
    });

    it("toggles the sticky summary preference before saving", async () => {
      const { view, captured } = makeFakeView(false);
      const promise = presentInlinePermissionPrompt(
        view,
        "Title",
        "Msg",
        options,
      );

      expect(captured.component?.render(100)).toContain(
        "  (t) [x] Show summary before saving",
      );
      captured.component?.handleInput("t");
      expect(view.setShowPersistenceSummary).toHaveBeenCalledWith(false);
      expect(captured.component?.render(100)).toContain(
        "  (t) [ ] Show summary before saving",
      );
      captured.component?.handleInput("g");

      expect(await promise).toEqual({
        kind: "persist",
        scope: "global",
        proposal: options.persistent?.proposal,
        target: globalTarget,
        summaryShown: false,
      });
    });

    it("edits the proposal with e before approving it for the session", async () => {
      expect(
        await runPrompt(
          false,
          [
            "e",
            CTRL_U,
            "g",
            "i",
            "t",
            " ",
            "d",
            "i",
            "f",
            "f",
            " ",
            "*",
            ENTER,
            "s",
          ],
          options,
        ),
      ).toEqual({
        approved: true,
        state: "approved_for_session",
        sessionApproval: { surface: "bash", patterns: ["git diff *"] },
      });
    });

    it("navigates through persistent choices with down and enter", async () => {
      // y -> s -> e -> p, select persistence, then save from the summary.
      expect(
        await runPrompt(
          true,
          [ARROW_DOWN, ARROW_DOWN, ARROW_DOWN, ENTER, ENTER],
          options,
        ),
      ).toEqual({
        kind: "persist",
        scope: "project",
        proposal: options.persistent?.proposal,
        target: projectTarget,
        summaryShown: true,
      });
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
