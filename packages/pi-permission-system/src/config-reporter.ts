import type { ResolvedPolicyPaths } from "./permission-manager";

export interface ResolvedConfigLogEntry {
  globalConfigPath: string;
  globalConfigExists: boolean;
  globalSettingsPath?: string | null;
  globalSettingsExists?: boolean;
  projectConfigPath: string | null;
  projectConfigExists: boolean;
  projectSettingsPath?: string | null;
  projectSettingsExists?: boolean;
  agentsDir: string;
  agentsDirExists: boolean;
  projectAgentsDir: string | null;
  projectAgentsDirExists: boolean;
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
