import { beforeEach, describe, expect, it, vi } from "vitest";
import { SubagentsSettingsHandler } from "#src/ui/subagents-settings";
import { makeMenuUI } from "#test/helpers/ui-stubs";

function makeSettings() {
  return {
    maxConcurrent: 4,
    defaultMaxTurns: undefined as number | undefined,
    graceTurns: 5,
    applyMaxConcurrent: vi.fn((): { message: string; level: "info" | "warning" } => ({
      message: "Max concurrency set to 8",
      level: "info",
    })),
    applyDefaultMaxTurns: vi.fn((): { message: string; level: "info" | "warning" } => ({
      message: "Default max turns set to unlimited",
      level: "info",
    })),
    applyGraceTurns: vi.fn((): { message: string; level: "info" | "warning" } => ({
      message: "Grace turns set to 3",
      level: "info",
    })),
    consumedSessionRetentionMinutes: 10,
    unconsumedSessionRetentionMinutes: 720,
    applyConsumedSessionRetentionMinutes: vi.fn((): { message: string; level: "info" | "warning" } => ({
      message: "Consumed-session retention set to 30 min",
      level: "info",
    })),
    applyUnconsumedSessionRetentionMinutes: vi.fn((): { message: string; level: "info" | "warning" } => ({
      message: "Unconsumed-session retention set to 1440 min",
      level: "info",
    })),
    abortAllOnInterrupt: true,
    toggleAbortAllOnInterrupt: vi.fn((): { message: string; level: "info" | "warning" } => ({
      message: "Abort all subagents on ESC: off",
      level: "info",
    })),
    midRunUpdates: true,
    toggleMidRunUpdates: vi.fn((): { message: string; level: "info" | "warning" } => ({
      message: "Mid-run updates from background subagents: off",
      level: "info",
    })),
  };
}

function makeHandler(settings = makeSettings()) {
  const handler = new SubagentsSettingsHandler(settings);
  return { handler, settings };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("SubagentsSettingsHandler", () => {
  it("is constructable", () => {
    const { handler } = makeHandler();
    expect(handler).toBeInstanceOf(SubagentsSettingsHandler);
  });

  it("shows the seven settings options with current values", async () => {
    const { handler } = makeHandler();
    const ui = makeMenuUI([undefined]); // cancel immediately
    await handler.handle({ ui });
    const options = ui.select.mock.calls[0][1] as string[];
    expect(options).toEqual([
      "Max concurrency (current: 4)",
      "Default max turns (current: unlimited)",
      "Grace turns (current: 5)",
      "Consumed-session retention (current: 10 min)",
      "Unconsumed-session retention (current: 720 min)",
      "Abort all subagents on ESC (current: on)",
      "Mid-run updates from background subagents (current: on)",
    ]);
  });

  it("toggles mid-run updates from the settings list", async () => {
    const settings = makeSettings();
    const { handler } = makeHandler(settings);
    const ui = makeMenuUI(["Mid-run updates from background subagents (current: on)"]);

    await handler.handle({ ui });

    expect(settings.toggleMidRunUpdates).toHaveBeenCalledOnce();
    expect(ui.notify).toHaveBeenCalledWith(
      "Mid-run updates from background subagents: off",
      "info",
    );
  });

  it("renders the abort-on-ESC option as off when the policy is disabled", async () => {
    const settings = makeSettings();
    settings.abortAllOnInterrupt = false;
    const { handler } = makeHandler(settings);
    const ui = makeMenuUI([undefined]);
    await handler.handle({ ui });
    const options = ui.select.mock.calls[0][1] as string[];
    expect(options[5]).toBe("Abort all subagents on ESC (current: off)");
  });

  it("applies no change when the settings list is cancelled", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI([undefined]);
    await handler.handle({ ui });
    expect(settings.applyMaxConcurrent).not.toHaveBeenCalled();
    expect(settings.applyDefaultMaxTurns).not.toHaveBeenCalled();
    expect(settings.applyGraceTurns).not.toHaveBeenCalled();
    expect(ui.input).not.toHaveBeenCalled();
  });
});

describe("SubagentsSettingsHandler — max concurrency", () => {
  it("delegates a valid value to applyMaxConcurrent and notifies the returned toast", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Max concurrency (current: 4)"]);
    ui.input = vi.fn().mockResolvedValue("8");
    await handler.handle({ ui });
    expect(settings.applyMaxConcurrent).toHaveBeenCalledWith(8);
    expect(ui.notify).toHaveBeenCalledWith("Max concurrency set to 8", "info");
  });

  it("rejects a value below 1 with a warning and does not apply", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Max concurrency (current: 4)"]);
    ui.input = vi.fn().mockResolvedValue("0");
    await handler.handle({ ui });
    expect(settings.applyMaxConcurrent).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith("Must be a positive integer.", "warning");
  });

  it("does not apply when the input is cancelled", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Max concurrency (current: 4)"]);
    ui.input = vi.fn().mockResolvedValue(undefined);
    await handler.handle({ ui });
    expect(settings.applyMaxConcurrent).not.toHaveBeenCalled();
  });

  it("rejects non-numeric input with a warning and does not apply", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Max concurrency (current: 4)"]);
    ui.input = vi.fn().mockResolvedValue("abc");
    await handler.handle({ ui });
    expect(settings.applyMaxConcurrent).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith("Must be a positive integer.", "warning");
  });
});

describe("SubagentsSettingsHandler — default max turns", () => {
  it("delegates 0 (unlimited) to applyDefaultMaxTurns", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Default max turns (current: unlimited)"]);
    ui.input = vi.fn().mockResolvedValue("0");
    await handler.handle({ ui });
    expect(settings.applyDefaultMaxTurns).toHaveBeenCalledWith(0);
    expect(ui.notify).toHaveBeenCalledWith("Default max turns set to unlimited", "info");
  });

  it("delegates a positive value to applyDefaultMaxTurns", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Default max turns (current: unlimited)"]);
    ui.input = vi.fn().mockResolvedValue("20");
    await handler.handle({ ui });
    expect(settings.applyDefaultMaxTurns).toHaveBeenCalledWith(20);
  });

  it("rejects a negative value with a warning and does not apply", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Default max turns (current: unlimited)"]);
    ui.input = vi.fn().mockResolvedValue("-1");
    await handler.handle({ ui });
    expect(settings.applyDefaultMaxTurns).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith(
      "Must be 0 (unlimited) or a positive integer.",
      "warning",
    );
  });
});

describe("SubagentsSettingsHandler — grace turns", () => {
  it("delegates a valid value to applyGraceTurns and notifies the returned toast", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Grace turns (current: 5)"]);
    ui.input = vi.fn().mockResolvedValue("3");
    await handler.handle({ ui });
    expect(settings.applyGraceTurns).toHaveBeenCalledWith(3);
    expect(ui.notify).toHaveBeenCalledWith("Grace turns set to 3", "info");
  });

  it("rejects a value below 1 with a warning and does not apply", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Grace turns (current: 5)"]);
    ui.input = vi.fn().mockResolvedValue("0");
    await handler.handle({ ui });
    expect(settings.applyGraceTurns).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith("Must be a positive integer.", "warning");
  });
});

describe("SubagentsSettingsHandler — retention windows", () => {
  it("delegates a valid consumed window to applyConsumedSessionRetentionMinutes", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Consumed-session retention (current: 10 min)"]);
    ui.input = vi.fn().mockResolvedValue("30");
    await handler.handle({ ui });
    expect(settings.applyConsumedSessionRetentionMinutes).toHaveBeenCalledWith(30);
    expect(ui.notify).toHaveBeenCalledWith("Consumed-session retention set to 30 min", "info");
  });

  it("delegates a valid unconsumed window to applyUnconsumedSessionRetentionMinutes", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Unconsumed-session retention (current: 720 min)"]);
    ui.input = vi.fn().mockResolvedValue("1440");
    await handler.handle({ ui });
    expect(settings.applyUnconsumedSessionRetentionMinutes).toHaveBeenCalledWith(1440);
    expect(ui.notify).toHaveBeenCalledWith("Unconsumed-session retention set to 1440 min", "info");
  });

  it("rejects a consumed window below 1 with a warning and does not apply", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Consumed-session retention (current: 10 min)"]);
    ui.input = vi.fn().mockResolvedValue("0");
    await handler.handle({ ui });
    expect(settings.applyConsumedSessionRetentionMinutes).not.toHaveBeenCalled();
    expect(ui.notify).toHaveBeenCalledWith("Must be a positive integer.", "warning");
  });
});

describe("SubagentsSettingsHandler — abort all subagents on ESC", () => {
  it("flips the policy directly and notifies the returned toast", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Abort all subagents on ESC (current: on)"]);
    await handler.handle({ ui });
    expect(settings.toggleAbortAllOnInterrupt).toHaveBeenCalledOnce();
    expect(ui.notify).toHaveBeenCalledWith("Abort all subagents on ESC: off", "info");
  });

  it("never prompts for input — the toggle is a direct flip", async () => {
    const { handler } = makeHandler();
    const ui = makeMenuUI(["Abort all subagents on ESC (current: on)"]);
    await handler.handle({ ui });
    expect(ui.input).not.toHaveBeenCalled();
  });

  it("does not flip the policy when the settings list is cancelled", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI([undefined]);
    await handler.handle({ ui });
    expect(settings.toggleAbortAllOnInterrupt).not.toHaveBeenCalled();
  });

  it("does not flip the policy when a numeric setting is chosen", async () => {
    const { handler, settings } = makeHandler();
    const ui = makeMenuUI(["Grace turns (current: 5)"]);
    ui.input = vi.fn().mockResolvedValue("3");
    await handler.handle({ ui });
    expect(settings.toggleAbortAllOnInterrupt).not.toHaveBeenCalled();
  });
});
