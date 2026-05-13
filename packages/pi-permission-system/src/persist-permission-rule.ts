import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";

import { loadUnifiedConfig } from "./config-loader";
import { getGlobalConfigPath, getProjectConfigPath } from "./config-paths";
import type { PermissionState } from "./types";

export type PersistedPermissionScope = "global" | "project";

export interface PersistPermissionRuleParams {
  agentDir: string;
  cwd?: string | null;
  scope: PersistedPermissionScope;
  surface: string;
  pattern: string;
  action: PermissionState;
}

export interface PersistPermissionRuleResult {
  path: string;
}

export function persistPermissionRule(
  params: PersistPermissionRuleParams,
): PersistPermissionRuleResult {
  const path = resolveConfigPath(params.agentDir, params.cwd, params.scope);
  const loaded = loadUnifiedConfig(path);

  if (loaded.issues.length > 0) {
    throw new Error(loaded.issues.join("; "));
  }

  const next = {
    ...loaded.config,
    permission: {
      ...(loaded.config.permission ?? {}),
      [params.surface]: upsertSurfacePermission(
        loaded.config.permission?.[params.surface],
        params.pattern,
        params.action,
      ),
    },
  };

  const tmpPath = `${path}.tmp`;
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(tmpPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    renameSync(tmpPath, path);
  } catch (error) {
    try {
      if (existsSync(tmpPath)) {
        unlinkSync(tmpPath);
      }
    } catch {
      // Ignore cleanup failures.
    }
    throw error;
  }

  return { path };
}

function resolveConfigPath(
  agentDir: string,
  cwd: string | null | undefined,
  scope: PersistedPermissionScope,
): string {
  if (scope === "global") {
    return getGlobalConfigPath(agentDir);
  }

  if (!cwd) {
    throw new Error(
      "Project config cannot be updated without a working directory.",
    );
  }

  return getProjectConfigPath(cwd);
}

function upsertSurfacePermission(
  existing: PermissionState | Record<string, PermissionState> | undefined,
  pattern: string,
  action: PermissionState,
): PermissionState | Record<string, PermissionState> {
  if (typeof existing === "string") {
    if (pattern === "*") {
      return action;
    }
    return {
      "*": existing,
      [pattern]: action,
    };
  }

  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    return {
      ...existing,
      [pattern]: action,
    };
  }

  if (pattern === "*") {
    return action;
  }

  return { [pattern]: action };
}
