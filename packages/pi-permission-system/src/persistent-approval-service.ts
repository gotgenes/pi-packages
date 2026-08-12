import { dirname } from "node:path";
import {
  getGlobalConfigDir,
  getGlobalConfigPath,
  getProjectLocalConfigPath,
} from "./config-paths";
import type {
  PersistentPermissionWriteRequest,
  PersistentPermissionWriteResult,
} from "./persistent-permission-writer";
import type { ReviewLogger } from "./session-logger";

export type PersistentApprovalScope = "project" | "global";

export interface PersistentApprovalTarget {
  scope: PersistentApprovalScope;
  path: string;
  expectedDir: string;
  /** Trusted containment root used to reject symlinked directory escapes. */
  expectedRoot?: string;
  /** Project scope to retain while reloading, if currently trusted. */
  reloadCwd?: string;
}

interface PersistentApprovalTargetResolverDeps {
  agentDir: string;
  cwd: string;
  isProjectTrusted(): boolean;
}

export class PersistentApprovalTargetResolver {
  constructor(private readonly deps: PersistentApprovalTargetResolverDeps) {}

  resolve(scope: PersistentApprovalScope): PersistentApprovalTarget {
    if (scope === "global") {
      return {
        scope,
        path: getGlobalConfigPath(this.deps.agentDir),
        expectedDir: getGlobalConfigDir(this.deps.agentDir),
        expectedRoot: this.deps.agentDir,
        ...(this.deps.isProjectTrusted() ? { reloadCwd: this.deps.cwd } : {}),
      };
    }

    if (!this.deps.isProjectTrusted()) {
      throw new Error("Project approvals require a trusted project.");
    }
    const path = getProjectLocalConfigPath(this.deps.cwd);
    return {
      scope,
      path,
      expectedDir: dirname(path),
      expectedRoot: this.deps.cwd,
      reloadCwd: this.deps.cwd,
    };
  }
}

interface PermissionRuleWriter {
  write(
    request: PersistentPermissionWriteRequest,
  ): PersistentPermissionWriteResult;
}

interface PersistentApprovalServiceDeps {
  targetResolver: PersistentApprovalTargetResolver;
  writer: PermissionRuleWriter;
  reload(cwd: string | undefined): void;
  logger: ReviewLogger;
}

export interface PersistApprovalRequest {
  requestId: string;
  target: PersistentApprovalTarget;
  surface: string;
  patterns: readonly string[];
}

export interface PersistApprovalResult {
  path: string;
}

export interface PersistentApprovalApi {
  prepare(scope: PersistentApprovalScope): PersistentApprovalTarget;
  persist(request: PersistApprovalRequest): PersistApprovalResult;
}

export class PersistentApprovalService implements PersistentApprovalApi {
  constructor(private readonly deps: PersistentApprovalServiceDeps) {}

  prepare(scope: PersistentApprovalScope): PersistentApprovalTarget {
    return this.deps.targetResolver.resolve(scope);
  }

  // fallow-ignore-next-line unused-class-member -- invoked through PersistentApprovalApi
  persist(request: PersistApprovalRequest): PersistApprovalResult {
    const details = {
      requestId: request.requestId,
      scope: request.target.scope,
      surface: request.surface,
      patterns: [...request.patterns],
      destination: request.target.path,
    };
    this.deps.logger.review("permission_rule.persistence_requested", details);

    try {
      const target = this.revalidateTarget(request);
      const written = this.deps.writer.write({
        path: target.path,
        expectedDir: target.expectedDir,
        expectedRoot: target.expectedRoot,
        surface: request.surface,
        patterns: request.patterns,
      });
      try {
        this.deps.reload(target.reloadCwd);
      } catch (error) {
        written.restore();
        throw error;
      }

      this.deps.logger.review("permission_rule.persistence_succeeded", details);
      return { path: written.path };
    } catch (error) {
      this.deps.logger.review("permission_rule.persistence_failed", {
        ...details,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private revalidateTarget(
    request: PersistApprovalRequest,
  ): PersistentApprovalTarget {
    const current = this.deps.targetResolver.resolve(request.target.scope);
    if (
      current.path !== request.target.path ||
      current.expectedDir !== request.target.expectedDir ||
      current.expectedRoot !== request.target.expectedRoot
    ) {
      throw new Error(
        "Permission approval destination changed before persistence.",
      );
    }
    return current;
  }
}
