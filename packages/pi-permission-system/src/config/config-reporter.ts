import type { ResolvedPolicyPaths } from "./policy-loader";

export interface ResolvedConfigLogEntry {
  /** Every config scope's location, lowest precedence first. */
  scopes: ResolvedPolicyPaths;
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
    scopes: options.policyPaths,
    legacyGlobalPolicyDetected: options.legacyGlobalPolicyDetected ?? false,
    legacyProjectPolicyDetected: options.legacyProjectPolicyDetected ?? false,
    legacyExtensionConfigDetected:
      options.legacyExtensionConfigDetected ?? false,
  };
}
