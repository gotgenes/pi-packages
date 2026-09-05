import { expect, test } from "vitest";
import { DEFAULT_EXTENSION_CONFIG } from "#src/config/extension-config";
import { getPermissionSystemStatus } from "#src/config/status";

test("Permission-system status is only exposed when yolo mode is enabled", () => {
  expect(getPermissionSystemStatus(DEFAULT_EXTENSION_CONFIG)).toBe(undefined);
  expect(
    getPermissionSystemStatus({ ...DEFAULT_EXTENSION_CONFIG, yoloMode: true }),
  ).toBe("yolo");
});
