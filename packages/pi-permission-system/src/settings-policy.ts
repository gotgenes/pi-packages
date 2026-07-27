import { existsSync, readFileSync } from "node:fs";
import { z } from "zod";

import {
  type FlatPermissionConfig,
  permissionSchema,
} from "#src/config-schema";

const settingsPolicySchema = z.strictObject({
  permission: permissionSchema.optional(),
  agents: z.record(z.string().min(1), permissionSchema).optional(),
});

export interface SettingsPolicyLoadResult {
  permission?: FlatPermissionConfig;
  agents?: Record<string, FlatPermissionConfig>;
  issues: string[];
}

/** Load the optional `piPermissionSystem` policy section from a Pi settings file. */
export function loadSettingsPolicy(path: string): SettingsPolicyLoadResult {
  if (!existsSync(path)) return { issues: [] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    return {
      issues: [
        `Failed to parse Pi settings at '${path}': ${error instanceof Error ? error.message : String(error)}`,
      ],
    };
  }

  if (!parsed || typeof parsed !== "object") return { issues: [] };
  const section = (parsed as Record<string, unknown>).piPermissionSystem;
  if (section === undefined) return { issues: [] };

  const result = settingsPolicySchema.safeParse(section);
  if (!result.success) {
    return {
      issues: result.error.issues.map((issue) => {
        const suffix = issue.path.length > 0 ? `.${issue.path.join(".")}` : "";
        return `Invalid Pi settings field 'piPermissionSystem${suffix}': ${issue.message}`;
      }),
    };
  }

  return {
    ...(result.data.permission ? { permission: result.data.permission } : {}),
    ...(result.data.agents ? { agents: result.data.agents } : {}),
    issues: [],
  };
}
