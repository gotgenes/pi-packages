import { describe, expect, it } from "vitest";

import { DEFAULT_EXTENSION_CONFIG } from "#src/extension-config";
import {
  applyPermissionSystemRuntimeOverrides,
  readPermissionSystemRuntimeOverrides,
} from "#src/runtime-config-overrides";

describe("readPermissionSystemRuntimeOverrides", () => {
  it("enables yolo only for the exact string 1", () => {
    expect(
      readPermissionSystemRuntimeOverrides({
        PI_PERMISSION_SYSTEM_YOLO: "1",
      }),
    ).toEqual({ yoloMode: true });
  });

  it.each([
    undefined,
    "",
    "0",
    "true",
    "yes",
  ])("does not enable yolo for %s", (value) => {
    expect(
      readPermissionSystemRuntimeOverrides({
        PI_PERMISSION_SYSTEM_YOLO: value,
      }),
    ).toEqual({});
  });
});

describe("applyPermissionSystemRuntimeOverrides", () => {
  it("returns an effective yolo-on config without mutating the input", () => {
    const config = { ...DEFAULT_EXTENSION_CONFIG, yoloMode: false };
    const result = applyPermissionSystemRuntimeOverrides(config, {
      yoloMode: true,
    });
    expect(result).toEqual({ ...config, yoloMode: true });
    expect(config.yoloMode).toBe(false);
  });

  it("returns the file-backed values when no override is present", () => {
    const config = { ...DEFAULT_EXTENSION_CONFIG, debugLog: true };
    expect(applyPermissionSystemRuntimeOverrides(config, {})).toEqual(config);
  });
});
