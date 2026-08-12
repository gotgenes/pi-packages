import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import {
  PersistentApprovalService,
  PersistentApprovalTargetResolver,
} from "#src/persistent-approval-service";
import { PersistentPermissionWriter } from "#src/persistent-permission-writer";

describe("PersistentApprovalService", () => {
  let root: string;
  let agentDir: string;
  let cwd: string;
  let trusted: boolean;
  let review: Mock<(event: string, details?: Record<string, unknown>) => void>;
  let reload: Mock<(cwd: string | undefined) => void>;
  let resolver: PersistentApprovalTargetResolver;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "persistent-approval-service-"));
    agentDir = join(root, "agent");
    cwd = join(root, "project");
    mkdirSync(cwd);
    trusted = true;
    review =
      vi.fn<(event: string, details?: Record<string, unknown>) => void>();
    reload = vi.fn<(cwd: string | undefined) => void>();
    resolver = new PersistentApprovalTargetResolver({
      agentDir,
      cwd,
      isProjectTrusted: () => trusted,
    });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function makeService(): PersistentApprovalService {
    return new PersistentApprovalService({
      targetResolver: resolver,
      writer: new PersistentPermissionWriter(),
      reload,
      logger: { review },
    });
  }

  it("persists project rules, reloads trusted project policy, and logs success", () => {
    const service = makeService();
    const target = service.prepare("project");

    const result = service.persist({
      requestId: "request-1",
      target,
      surface: "bash",
      patterns: ["git status"],
    });

    expect(result.path).toBe(
      join(cwd, ".pi/extensions/pi-permission-system/config.local.json"),
    );
    expect(reload).toHaveBeenCalledWith(cwd);
    expect(JSON.parse(readFileSync(result.path, "utf8"))).toEqual({
      permission: { bash: { "git status": "allow" } },
    });
    expect(review).toHaveBeenCalledWith(
      "permission_rule.persistence_succeeded",
      expect.objectContaining({ requestId: "request-1", scope: "project" }),
    );
  });

  it("withholds project targets and writes when trust is lost", () => {
    trusted = false;
    expect(() => makeService().prepare("project")).toThrow("trusted project");

    trusted = true;
    const service = makeService();
    const target = service.prepare("project");
    trusted = false;

    expect(() =>
      service.persist({
        requestId: "request-2",
        target,
        surface: "bash",
        patterns: ["git status"],
      }),
    ).toThrow("trusted project");
    expect(reload).not.toHaveBeenCalled();
  });

  it("reloads global policy without activating the current project", () => {
    trusted = false;
    const service = makeService();
    const target = service.prepare("global");

    service.persist({
      requestId: "request-5",
      target,
      surface: "bash",
      patterns: ["git status"],
    });

    expect(reload).toHaveBeenCalledWith(undefined);
  });

  it("restores the original file and logs failure when reload fails", () => {
    const service = makeService();
    const target = service.prepare("project");
    mkdirSync(target.expectedDir, { recursive: true });
    const original = `{"permission":{"bash":"ask"}}\n`;
    writeFileSync(target.path, original);
    reload.mockImplementation(() => {
      throw new Error("reload failed");
    });

    expect(() =>
      service.persist({
        requestId: "request-6",
        target,
        surface: "bash",
        patterns: ["git status"],
      }),
    ).toThrow("reload failed");
    expect(readFileSync(target.path, "utf8")).toBe(original);
    expect(review).toHaveBeenCalledWith(
      "permission_rule.persistence_failed",
      expect.objectContaining({ requestId: "request-6" }),
    );
  });
});
