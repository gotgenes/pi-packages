import type { ResolvedPolicyPaths } from "./permission-manager";

export interface ResolvedConfigLogEntry extends ResolvedPolicyPaths {
  legacyGlobalPolicyDetected: boolean;
  legacyProjectPolicyDetected: boolean;
  legacyExtensionConfigDetected: boolean;
}

export interface BuildResolvedConfigLogEntryOptions {
  policyPaths: ResolvedPolicyPaths;
  legacyGlobalPolicyDetected?: boolean;
  legacyProjectPolicyDetected?: boolean;
  legacyExtensionConfigDetected?: boolean;
}

export function buildResolvedConfigLogEntry(
  options: BuildResolvedConfigLogEntryOptions,
): ResolvedConfigLogEntry {
  return {
    ...options.policyPaths,
    legacyGlobalPolicyDetected: options.legacyGlobalPolicyDetected ?? false,
    legacyProjectPolicyDetected: options.legacyProjectPolicyDetected ?? false,
    legacyExtensionConfigDetected:
      options.legacyExtensionConfigDetected ?? false,
  };
}
