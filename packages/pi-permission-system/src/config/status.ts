import type {
  ExtensionCommandContext,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";

import { EXTENSION_ID } from "./extension-config";

export const PERMISSION_SYSTEM_STATUS_KEY = EXTENSION_ID;
export const PERMISSION_SYSTEM_YOLO_STATUS_VALUE = "yolo";

type PermissionStatusContext =
  | Pick<ExtensionContext, "hasUI" | "ui">
  | Pick<ExtensionCommandContext, "ui">;

/**
 * The status-bar value for an effective yolo state, or `undefined` to clear it.
 *
 * The status bar reports what is *in effect* here, not what the config file
 * says: a session may run under the `/yolo` override, and an indicator that
 * disagreed with the gates would be a false signal in a permission surface.
 */
export function yoloStatusValue(yoloActive: boolean): string | undefined {
  return yoloActive ? PERMISSION_SYSTEM_YOLO_STATUS_VALUE : undefined;
}

/** Write the status bar from the effective yolo state. */
export function syncYoloStatus(
  ctx: PermissionStatusContext,
  yoloActive: boolean,
): void {
  ctx.ui.setStatus(PERMISSION_SYSTEM_STATUS_KEY, yoloStatusValue(yoloActive));
}
