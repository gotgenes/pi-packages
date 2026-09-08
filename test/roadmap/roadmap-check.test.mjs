import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { checkRoadmaps } from "../../scripts/roadmap-check.mjs";

let workspace;

/**
 * Write an architecture document for a package inside the temporary workspace.
 *
 * @param {string} pkg
 * @param {string} document
 */
function givenPackage(pkg, document) {
  const directory = path.join(
    workspace,
    "packages",
    pkg,
    "docs",
    "architecture",
  );
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "architecture.md"), document);
}

/**
 * @param {object} options
 * @param {number} options.priority the published Priority, which should be 8
 * @param {string} [options.tracks]
 */
function roadmapDocument({
  priority,
  tracks = "- **Track A — Example:** [#857].",
}) {
  return `# Architecture

## Improvement roadmap — Phase 1: Example

### Steps

#### [#857] Re-prepare or refuse a workspace-backed resume

**Cause:** the workspace is disposed on completion.

- **Impact 2 / Risk 2 / Priority ${priority}.**

Release: independent

### Step dependency diagram

\`\`\`mermaid
flowchart TD
    S857["#857<br/>Workspace-backed resume"]
\`\`\`

### Parallel tracks

${tracks}

### Release batches

- Independently releasable: [#857].

## Refactoring history
`;
}

beforeEach(() => {
  workspace = mkdtempSync(path.join(tmpdir(), "roadmap-check-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("checkRoadmaps", () => {
  describe("exit status", () => {
    it("succeeds when a roadmap has no findings", () => {
      givenPackage("pi-example", roadmapDocument({ priority: 8 }));
      expect(checkRoadmaps({ root: workspace, packages: [] }).code).toBe(0);
    });

    it("fails when a roadmap has an error", () => {
      givenPackage("pi-example", roadmapDocument({ priority: 9 }));
      expect(checkRoadmaps({ root: workspace, packages: [] }).code).toBe(1);
    });

    it("succeeds when a roadmap has warnings but no errors", () => {
      givenPackage(
        "pi-example",
        roadmapDocument({ priority: 8, tracks: "- No tracks." }),
      );
      const result = checkRoadmaps({ root: workspace, packages: [] });
      expect(result.code).toBe(0);
      expect(result.report).toContain("is named in no parallel track");
    });

    it("reports that the question could not be answered when a named package is absent", () => {
      const result = checkRoadmaps({
        root: workspace,
        packages: ["pi-missing"],
      });
      expect(result.code).toBe(2);
      expect(result.report).toContain("pi-missing");
    });

    it("reports that the question could not be answered when a named package has no roadmap", () => {
      givenPackage("pi-example", "# Architecture\n\nNo roadmap yet.\n");
      const result = checkRoadmaps({
        root: workspace,
        packages: ["pi-example"],
      });
      expect(result.code).toBe(2);
    });
  });

  describe("package selection", () => {
    it("skips a package with no roadmap when no package is named", () => {
      givenPackage("pi-example", roadmapDocument({ priority: 8 }));
      givenPackage("pi-quiet", "# Architecture\n\nNo roadmap yet.\n");
      const result = checkRoadmaps({ root: workspace, packages: [] });
      expect(result.code).toBe(0);
      expect(result.report).toContain("pi-example");
      expect(result.report).not.toContain("pi-quiet");
    });

    it("keeps the unanswerable status when another named package also has an error", () => {
      givenPackage("pi-example", roadmapDocument({ priority: 9 }));
      givenPackage("pi-quiet", "# Architecture\n\nNo roadmap yet.\n");
      const result = checkRoadmaps({
        root: workspace,
        packages: ["pi-quiet", "pi-example"],
      });
      expect(result.code).toBe(2);
      expect(result.report).toContain("published Priority 9");
    });

    it("checks only the packages named", () => {
      givenPackage("pi-example", roadmapDocument({ priority: 9 }));
      givenPackage("pi-other", roadmapDocument({ priority: 9 }));
      const result = checkRoadmaps({ root: workspace, packages: ["pi-other"] });
      expect(result.report).toContain("pi-other");
      expect(result.report).not.toContain("pi-example");
    });
  });

  describe("the report", () => {
    it("names the package, the phase, and each finding's severity and subject", () => {
      givenPackage("pi-example", roadmapDocument({ priority: 9 }));
      const result = checkRoadmaps({ root: workspace, packages: [] });
      expect(result.report).toContain(
        "packages/pi-example/docs/architecture/architecture.md",
      );
      expect(result.report).toContain("Improvement roadmap — Phase 1: Example");
      expect(result.report).toContain(
        "error   #857 published Priority 9, but Impact 2 × (6 − Risk 2) is 8",
      );
    });
  });
});
