import { describe, expect, it } from "vitest";

import { validateRoadmap } from "../../scripts/roadmap/validate-roadmap.mjs";

/**
 * Build a roadmap model directly, rather than parsing markdown, so a check's
 * fixture states only the fields that check reads.
 *
 * @param {Partial<import("../../scripts/roadmap/parse-roadmap.mjs").Roadmap>} overrides
 */
function makeRoadmap(overrides = {}) {
  return {
    phaseTitle: "Improvement roadmap — Phase 1: Example",
    steps: [],
    edges: [],
    nodeIssues: [],
    tracksText: "",
    batchesText: "",
    ...overrides,
  };
}

/**
 * @param {Partial<import("../../scripts/roadmap/parse-roadmap.mjs").RoadmapStep>} overrides
 */
function makeStep(overrides = {}) {
  return {
    issue: 1,
    ordinal: null,
    title: "Example",
    scores: { impact: 2, risk: 2, priority: 8 },
    releaseTags: ["independent"],
    hardDependency: null,
    ...overrides,
  };
}

describe("validateRoadmap", () => {
  describe("published priority arithmetic", () => {
    it("accepts a priority equal to impact times six-minus-risk", () => {
      const roadmap = makeRoadmap({
        steps: [
          makeStep({ issue: 857, scores: { impact: 2, risk: 2, priority: 8 } }),
        ],
        nodeIssues: [857],
      });
      expect(validateRoadmap(roadmap)).toEqual([]);
    });

    it("reports a priority that does not follow from its own impact and risk", () => {
      const roadmap = makeRoadmap({
        steps: [
          makeStep({ issue: 857, scores: { impact: 2, risk: 2, priority: 9 } }),
        ],
        nodeIssues: [857],
      });
      expect(validateRoadmap(roadmap)).toEqual([
        {
          severity: "error",
          stepIssue: 857,
          message: "published Priority 9, but Impact 2 × (6 − Risk 2) is 8",
        },
      ]);
    });

    it("distinguishes a wrong priority from a wrong impact by naming both inputs", () => {
      const roadmap = makeRoadmap({
        steps: [
          makeStep({ issue: 858, scores: { impact: 3, risk: 4, priority: 7 } }),
        ],
        nodeIssues: [858],
      });
      expect(validateRoadmap(roadmap)[0].message).toBe(
        "published Priority 7, but Impact 3 × (6 − Risk 4) is 6",
      );
    });

    it("reports a step carrying no scores line at all", () => {
      const roadmap = makeRoadmap({
        steps: [makeStep({ issue: 900, scores: null })],
        nodeIssues: [900],
      });
      expect(validateRoadmap(roadmap)).toEqual([
        {
          severity: "error",
          stepIssue: 900,
          message: "no **Impact / Risk / Priority** line",
        },
      ]);
    });
  });
});
