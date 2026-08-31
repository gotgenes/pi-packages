import { describe, expect, it, vi } from "vitest";
import {
  ChildNodeAudit,
  childNodeAbsentMessage,
} from "#src/authority/child-node-audit";
import { makeLogger } from "#test/helpers/session-fixtures";

/** Build an audit whose lookup answers `present` for every session id. */
function makeAudit(present: boolean): {
  audit: ChildNodeAudit;
  logger: ReturnType<typeof makeLogger>;
} {
  const logger = makeLogger();
  const audit = new ChildNodeAudit(() => present, logger);
  return { audit, logger };
}

describe("ChildNodeAudit", () => {
  describe("a child whose node published a service", () => {
    it("records nothing and warns nobody", () => {
      const { audit, logger } = makeAudit(true);

      audit.auditBoundChild({
        sessionId: "child-1",
        parentSessionId: "parent-1",
      });

      expect(logger.review).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("asks the lookup for the child's own session id", () => {
      const hasNode = vi.fn<(sessionId: string) => boolean>(() => true);
      new ChildNodeAudit(hasNode, makeLogger()).auditBoundChild({
        sessionId: "child-1",
        parentSessionId: "parent-1",
      });

      expect(hasNode).toHaveBeenCalledWith("child-1");
    });
  });

  describe("a child with no permission node", () => {
    it("records the absence with both session ids", () => {
      const { audit, logger } = makeAudit(false);

      audit.auditBoundChild({
        sessionId: "child-1",
        parentSessionId: "parent-1",
      });

      expect(logger.review).toHaveBeenCalledOnce();
      expect(logger.review).toHaveBeenCalledWith("child_node_absent", {
        childSessionId: "child-1",
        parentSessionId: "parent-1",
      });
    });

    it("records a null parentSessionId when the event carries none", () => {
      const { audit, logger } = makeAudit(false);

      audit.auditBoundChild({ sessionId: "child-1" });

      expect(logger.review).toHaveBeenCalledWith("child_node_absent", {
        childSessionId: "child-1",
        parentSessionId: null,
      });
    });

    it("warns with the message naming the child and the likely cause", () => {
      const { audit, logger } = makeAudit(false);

      audit.auditBoundChild({ sessionId: "child-1" });

      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(
        childNodeAbsentMessage("child-1"),
      );
    });
  });

  describe("cadence across several affected children", () => {
    it("records every affected child", () => {
      const { audit, logger } = makeAudit(false);

      audit.auditBoundChild({ sessionId: "child-1" });
      audit.auditBoundChild({ sessionId: "child-2" });
      audit.auditBoundChild({ sessionId: "child-3" });

      expect(logger.review).toHaveBeenCalledTimes(3);
    });

    it("warns once, naming the first affected child", () => {
      const { audit, logger } = makeAudit(false);

      audit.auditBoundChild({ sessionId: "child-1" });
      audit.auditBoundChild({ sessionId: "child-2" });
      audit.auditBoundChild({ sessionId: "child-3" });

      expect(logger.warn).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledWith(
        childNodeAbsentMessage("child-1"),
      );
    });
  });
});

describe("childNodeAbsentMessage", () => {
  it("names the child session, the exclusion setting, and the review event", () => {
    const message = childNodeAbsentMessage("child-1");

    expect(message).toContain("child-1");
    expect(message).toContain("excludedExtensionPackages");
    expect(message).toContain("child_node_absent");
  });
});
