import type { PermissionSystemExtensionConfig } from "./extension-config";

export const PI_PERMISSION_SYSTEM_YOLO_ENV = "PI_PERMISSION_SYSTEM_YOLO";

export interface PermissionSystemRuntimeOverrides {
  yoloMode?: true;
}

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function readPermissionSystemRuntimeOverrides(
  environment: RuntimeEnvironment,
): PermissionSystemRuntimeOverrides {
  return environment[PI_PERMISSION_SYSTEM_YOLO_ENV] === "1"
    ? { yoloMode: true }
    : {};
}

export function applyPermissionSystemRuntimeOverrides(
  config: PermissionSystemExtensionConfig,
  overrides: PermissionSystemRuntimeOverrides,
): PermissionSystemExtensionConfig {
  return overrides.yoloMode === true
    ? { ...config, yoloMode: true }
    : config;
}
