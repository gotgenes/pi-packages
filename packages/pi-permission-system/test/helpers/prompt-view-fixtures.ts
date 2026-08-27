/**
 * Shared fixtures for the prompt-presentation surfaces a test constructs.
 *
 * `PromptPreferences` is read live at prompt time and threaded through
 * `LocalUserAuthorizer` into the dialog, so several files build one. Building
 * it here means a new preference is added in one place and the compiler finds
 * every consumer, rather than each inline literal silently keeping the old
 * shape.
 */

import type { PromptPreferences } from "#src/authority/permission-prompt-component";
import { DEFAULT_RENDER_BUDGET } from "#src/presentation/dialog-renderer";

/** The live prompt preferences, override-driven. */
export function makePromptPreferences(
  overrides: Partial<PromptPreferences> = {},
): PromptPreferences {
  return {
    doublePressToConfirm: true,
    budget: DEFAULT_RENDER_BUDGET,
    ...overrides,
  };
}
