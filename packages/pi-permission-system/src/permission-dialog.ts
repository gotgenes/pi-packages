export type PermissionDecisionState =
  | "approved"
  | "approved_for_session"
  | "approved_with_custom_pattern"
  | "denied"
  | "denied_with_reason";

export type CustomPatternApprovalTarget = "session" | "project" | "global";

export interface CustomPatternApproval {
  pattern: string;
  target: CustomPatternApprovalTarget;
}

export type PermissionPromptDecision = {
  approved: boolean;
  state: PermissionDecisionState;
  denialReason?: string;
  customPatternApproval?: CustomPatternApproval;
  /**
   * True when the decision was made automatically by yolo mode rather than
   * by an interactive user prompt. Used by handlers to emit "auto_approved"
   * rather than "user_approved" in the permissions:decision broadcast.
   */
  autoApproved?: true;
};

export interface PermissionDecisionUi {
  select(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, placeholder?: string): Promise<string | undefined>;
}

const APPROVE_OPTION = "Yes";
const APPROVE_FOR_SESSION_OPTION = "Yes, for this session";
const CUSTOM_SESSION_PATTERN_OPTION =
  "Yes, enter a custom pattern for this session";
const CUSTOM_PERSISTED_PATTERN_OPTION = "Yes, save a custom pattern to config";
const CUSTOM_PATTERN_MANUAL_OPTION = "Enter a custom pattern manually";
const BACK_OPTION = "← Back";
const PROJECT_CONFIG_OPTION = "Project config";
const GLOBAL_CONFIG_OPTION = "Global config";
const DENY_OPTION = "No";
const DENY_WITH_REASON_OPTION = "No, provide reason";

export function normalizePermissionDenialReason(
  value: unknown,
): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function createDeniedPermissionDecision(
  denialReason?: string,
): PermissionPromptDecision {
  const normalizedReason = normalizePermissionDenialReason(denialReason);
  return normalizedReason
    ? {
        approved: false,
        state: "denied_with_reason",
        denialReason: normalizedReason,
      }
    : {
        approved: false,
        state: "denied",
      };
}

export function isPermissionDecisionState(
  value: unknown,
): value is PermissionDecisionState {
  return (
    value === "approved" ||
    value === "approved_for_session" ||
    value === "approved_with_custom_pattern" ||
    value === "denied" ||
    value === "denied_with_reason"
  );
}

export interface RequestPermissionOptions {
  /** Override the "for this session" option label (e.g. to show the suggested pattern). */
  sessionLabel?: string;
  /** Candidate patterns shown when the user chooses a custom pattern flow. */
  customPatternOptions?: string[];
}

export async function requestPermissionDecisionFromUi(
  ui: PermissionDecisionUi,
  title: string,
  message: string,
  options?: RequestPermissionOptions,
): Promise<PermissionPromptDecision> {
  const sessionOption = options?.sessionLabel ?? APPROVE_FOR_SESSION_OPTION;
  const decisionOptions = [
    APPROVE_OPTION,
    sessionOption,
    CUSTOM_SESSION_PATTERN_OPTION,
    CUSTOM_PERSISTED_PATTERN_OPTION,
    DENY_OPTION,
    DENY_WITH_REASON_OPTION,
  ] as const;

  while (true) {
    const selected = await ui.select(`${title}\n${message}`, [
      ...decisionOptions,
    ]);

    if (selected === APPROVE_OPTION) {
      return {
        approved: true,
        state: "approved",
      };
    }

    if (selected === sessionOption) {
      return {
        approved: true,
        state: "approved_for_session",
      };
    }

    if (selected === CUSTOM_SESSION_PATTERN_OPTION) {
      const result = await requestCustomPattern(
        ui,
        title,
        "Choose or edit a custom permission pattern for this session.",
        options?.customPatternOptions ?? [],
      );

      if (result.action === "back") {
        continue;
      }

      return {
        approved: true,
        state: "approved_with_custom_pattern",
        customPatternApproval: {
          pattern: result.pattern,
          target: "session",
        },
      };
    }

    if (selected === CUSTOM_PERSISTED_PATTERN_OPTION) {
      const result = await requestCustomPattern(
        ui,
        title,
        "Choose or edit a custom permission pattern to save.",
        options?.customPatternOptions ?? [],
      );

      if (result.action === "back") {
        continue;
      }

      const target = await ui.select(`${title}\nSave this pattern to:`, [
        PROJECT_CONFIG_OPTION,
        GLOBAL_CONFIG_OPTION,
        BACK_OPTION,
      ]);

      if (target === BACK_OPTION || target === undefined) {
        continue;
      }

      if (target !== PROJECT_CONFIG_OPTION && target !== GLOBAL_CONFIG_OPTION) {
        return createDeniedPermissionDecision();
      }

      return {
        approved: true,
        state: "approved_with_custom_pattern",
        customPatternApproval: {
          pattern: result.pattern,
          target: target === PROJECT_CONFIG_OPTION ? "project" : "global",
        },
      };
    }

    if (selected === DENY_WITH_REASON_OPTION) {
      const denialReason = normalizePermissionDenialReason(
        await ui.input(
          `${title}\nShare why this request was denied (optional).`,
          "Reason shown back to the agent",
        ),
      );

      return createDeniedPermissionDecision(denialReason);
    }

    return createDeniedPermissionDecision();
  }
}

type CustomPatternResult =
  | { action: "selected"; pattern: string }
  | { action: "back" };

async function requestCustomPattern(
  ui: PermissionDecisionUi,
  title: string,
  prompt: string,
  patternOptions: readonly string[],
): Promise<CustomPatternResult> {
  const candidates = dedupePatternOptions(patternOptions);

  while (true) {
    const selected =
      candidates.length > 0
        ? await ui.select(`${title}\n${prompt}`, [
            ...candidates.map((pattern) => `Use pattern: ${pattern}`),
            CUSTOM_PATTERN_MANUAL_OPTION,
            BACK_OPTION,
          ])
        : CUSTOM_PATTERN_MANUAL_OPTION;

    if (!selected || selected === BACK_OPTION) {
      return { action: "back" };
    }

    const selectedPattern = selected.startsWith("Use pattern: ")
      ? selected.slice("Use pattern: ".length)
      : undefined;

    if (
      selectedPattern === undefined &&
      selected !== CUSTOM_PATTERN_MANUAL_OPTION
    ) {
      return { action: "back" };
    }

    const entered = await ui.input(
      selectedPattern
        ? `${title}\nEdit pattern or press Enter to use:\n${selectedPattern}`
        : `${title}\nEnter a custom permission pattern.`,
      selectedPattern ?? "Pattern (supports * and ? wildcards)",
    );

    if (entered === undefined) {
      if (candidates.length === 0) {
        return { action: "back" };
      }
      continue;
    }

    const normalized = normalizePermissionDenialReason(entered);
    if (normalized) {
      return { action: "selected", pattern: normalized };
    }

    if (selectedPattern) {
      return { action: "selected", pattern: selectedPattern };
    }
  }
}

function dedupePatternOptions(patternOptions: readonly string[]): string[] {
  return patternOptions
    .map((pattern) => pattern.trim())
    .filter(
      (pattern, index, array) =>
        pattern.length > 0 && array.indexOf(pattern) === index,
    );
}
