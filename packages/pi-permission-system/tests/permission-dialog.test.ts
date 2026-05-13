import { describe, expect, it, vi } from "vitest";
import {
  createDeniedPermissionDecision,
  isPermissionDecisionState,
  normalizePermissionDenialReason,
  type PermissionDecisionUi,
  requestPermissionDecisionFromUi,
} from "../src/permission-dialog";

describe("isPermissionDecisionState", () => {
  it("accepts approved", () => {
    expect(isPermissionDecisionState("approved")).toBe(true);
  });

  it("accepts denied", () => {
    expect(isPermissionDecisionState("denied")).toBe(true);
  });

  it("accepts denied_with_reason", () => {
    expect(isPermissionDecisionState("denied_with_reason")).toBe(true);
  });

  it("accepts approved_for_session", () => {
    expect(isPermissionDecisionState("approved_for_session")).toBe(true);
  });

  it("accepts approved_with_custom_pattern", () => {
    expect(isPermissionDecisionState("approved_with_custom_pattern")).toBe(
      true,
    );
  });

  it("rejects unknown strings", () => {
    expect(isPermissionDecisionState("unknown")).toBe(false);
  });

  it("rejects non-strings", () => {
    expect(isPermissionDecisionState(42)).toBe(false);
    expect(isPermissionDecisionState(null)).toBe(false);
  });
});

describe("requestPermissionDecisionFromUi", () => {
  it("returns approved when user selects Yes", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("Yes"),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: true, state: "approved" });
  });

  it("returns approved_for_session when user selects session option", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("Yes, for this session"),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: true, state: "approved_for_session" });
  });

  it("returns denied when user selects No", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("No"),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: false, state: "denied" });
  });

  it("returns denied_with_reason when user provides reason", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("No, provide reason"),
      input: vi.fn().mockResolvedValue("not now"),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "not now",
    });
  });

  it("returns denied when user selects deny-with-reason but gives empty input", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue("No, provide reason"),
      input: vi.fn().mockResolvedValue(""),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: false, state: "denied" });
  });

  it("returns denied when user dismisses dialog (undefined)", async () => {
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue(undefined),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({ approved: false, state: "denied" });
  });

  it("passes six options to ui.select", async () => {
    const selectFn = vi.fn().mockResolvedValue("Yes");
    const ui: PermissionDecisionUi = {
      select: selectFn,
      input: vi.fn(),
    };
    await requestPermissionDecisionFromUi(ui, "Title", "Message");
    const options = selectFn.mock.calls[0][1] as string[];
    expect(options).toEqual([
      "Yes",
      "Yes, for this session",
      "Yes, enter a custom pattern for this session",
      "Yes, save a custom pattern to config",
      "No",
      "No, provide reason",
    ]);
  });

  it("uses custom sessionLabel when provided", async () => {
    const selectFn = vi.fn().mockResolvedValue("Yes");
    const ui: PermissionDecisionUi = {
      select: selectFn,
      input: vi.fn(),
    };
    await requestPermissionDecisionFromUi(ui, "Title", "Message", {
      sessionLabel: 'Yes, allow "git *" for this session',
    });
    const options = selectFn.mock.calls[0][1] as string[];
    expect(options[1]).toBe('Yes, allow "git *" for this session');
  });

  it("still returns approved_for_session when user selects the custom session label", async () => {
    const customLabel = 'Yes, allow "git *" for this session';
    const ui: PermissionDecisionUi = {
      select: vi.fn().mockResolvedValue(customLabel),
      input: vi.fn(),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      { sessionLabel: customLabel },
    );
    expect(result).toEqual({ approved: true, state: "approved_for_session" });
  });

  it("returns approved_with_custom_pattern for custom session pattern", async () => {
    const ui: PermissionDecisionUi = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Yes, enter a custom pattern for this session"),
      input: vi.fn().mockResolvedValue("git checkout *"),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({
      approved: true,
      state: "approved_with_custom_pattern",
      customPatternApproval: {
        pattern: "git checkout *",
        target: "session",
      },
    });
  });

  it("returns approved_with_custom_pattern for persisted custom pattern", async () => {
    const ui: PermissionDecisionUi = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Yes, save a custom pattern to config")
        .mockResolvedValueOnce("Project config"),
      input: vi.fn().mockResolvedValue("exa:search"),
    };
    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
    );
    expect(result).toEqual({
      approved: true,
      state: "approved_with_custom_pattern",
      customPatternApproval: {
        pattern: "exa:search",
        target: "project",
      },
    });
  });

  it("shows custom pattern candidates before the edit input", async () => {
    const selectFn = vi
      .fn()
      .mockResolvedValueOnce("Yes, enter a custom pattern for this session")
      .mockResolvedValueOnce("Use pattern: git checkout *");
    const inputFn = vi.fn().mockResolvedValue("git checkout main");
    const ui: PermissionDecisionUi = {
      select: selectFn,
      input: inputFn,
    };

    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      {
        customPatternOptions: ["git checkout main", "git checkout *", "git *"],
      },
    );

    expect(selectFn.mock.calls[1][1]).toEqual([
      "Use pattern: git checkout main",
      "Use pattern: git checkout *",
      "Use pattern: git *",
      "Enter a custom pattern manually",
      "← Back",
    ]);
    expect(inputFn).toHaveBeenCalledWith(
      "Title\nEdit pattern or press Enter to use:\ngit checkout *",
      "git checkout *",
    );
    expect(result).toEqual({
      approved: true,
      state: "approved_with_custom_pattern",
      customPatternApproval: {
        pattern: "git checkout main",
        target: "session",
      },
    });
  });

  it("uses the selected candidate when the edit input is empty", async () => {
    const ui: PermissionDecisionUi = {
      select: vi
        .fn()
        .mockResolvedValueOnce("Yes, enter a custom pattern for this session")
        .mockResolvedValueOnce("Use pattern: git *"),
      input: vi.fn().mockResolvedValue(""),
    };

    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      { customPatternOptions: ["git *"] },
    );

    expect(result).toEqual({
      approved: true,
      state: "approved_with_custom_pattern",
      customPatternApproval: {
        pattern: "git *",
        target: "session",
      },
    });
  });

  it("returns to the top-level choices from the custom pattern chooser", async () => {
    const selectFn = vi
      .fn()
      .mockResolvedValueOnce("Yes, enter a custom pattern for this session")
      .mockResolvedValueOnce("← Back")
      .mockResolvedValueOnce("No");
    const ui: PermissionDecisionUi = {
      select: selectFn,
      input: vi.fn(),
    };

    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      { customPatternOptions: ["git *"] },
    );

    expect(result).toEqual({ approved: false, state: "denied" });
    expect(selectFn).toHaveBeenCalledTimes(3);
  });

  it("returns to the top-level choices from config target selection", async () => {
    const selectFn = vi
      .fn()
      .mockResolvedValueOnce("Yes, save a custom pattern to config")
      .mockResolvedValueOnce("Use pattern: git *")
      .mockResolvedValueOnce("← Back")
      .mockResolvedValueOnce("Yes");
    const ui: PermissionDecisionUi = {
      select: selectFn,
      input: vi.fn().mockResolvedValue(""),
    };

    const result = await requestPermissionDecisionFromUi(
      ui,
      "Title",
      "Message",
      { customPatternOptions: ["git *"] },
    );

    expect(result).toEqual({ approved: true, state: "approved" });
    expect(selectFn).toHaveBeenCalledTimes(4);
  });

  it("falls back to default session label when no options provided", async () => {
    const selectFn = vi.fn().mockResolvedValue("Yes");
    const ui: PermissionDecisionUi = {
      select: selectFn,
      input: vi.fn(),
    };
    await requestPermissionDecisionFromUi(ui, "Title", "Message");
    const options = selectFn.mock.calls[0][1] as string[];
    expect(options[1]).toBe("Yes, for this session");
  });
});

describe("normalizePermissionDenialReason", () => {
  it("returns trimmed string for non-empty input", () => {
    expect(normalizePermissionDenialReason("  reason  ")).toBe("reason");
  });

  it("returns undefined for empty string", () => {
    expect(normalizePermissionDenialReason("")).toBeUndefined();
  });

  it("returns undefined for non-string", () => {
    expect(normalizePermissionDenialReason(42)).toBeUndefined();
  });
});

describe("createDeniedPermissionDecision", () => {
  it("returns denied_with_reason when reason provided", () => {
    expect(createDeniedPermissionDecision("nope")).toEqual({
      approved: false,
      state: "denied_with_reason",
      denialReason: "nope",
    });
  });

  it("returns denied when no reason", () => {
    expect(createDeniedPermissionDecision()).toEqual({
      approved: false,
      state: "denied",
    });
  });
});
