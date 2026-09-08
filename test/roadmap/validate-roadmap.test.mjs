import { describe, expect, it } from "vitest";

import { validateRoadmap } from "../../scripts/roadmap/validate-roadmap.mjs";

/**
 * Build a roadmap model directly, rather than parsing markdown, so a check's
 * fixture states only the fields that check reads.
 *
 * @param {Partial<import("../../scripts/roadmap/parse-roadmap.mjs").Roadmap>} overrides
 */
function makeRoadmap(overrides = {}) {
  const steps = overrides.steps ?? [];
  const named = steps
    .map((step) =>
      step.ordinal === null ? `[#${step.issue}]` : `Step ${step.ordinal}`,
    )
    .join(", ");
  return {
    phaseTitle: "Improvement roadmap — Phase 1: Example",
    steps,
    edges: [],
    nodeIssues: steps.map((step) => step.issue),
    tracksText: `- **Track A — Example:** ${named}.`,
    batchesText: `- Independently releasable: ${named}.`,
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

  describe("release tags", () => {
    it("reports a step with no Release line", () => {
      const roadmap = makeRoadmap({
        steps: [makeStep({ issue: 1, releaseTags: [] })],
        nodeIssues: [1],
      });
      expect(messages(roadmap)).toEqual([
        "error: #1 has 0 `Release:` lines, expected exactly 1",
      ]);
    });

    it("reports a step with more than one Release line", () => {
      const roadmap = makeRoadmap({
        steps: [
          makeStep({ issue: 1, releaseTags: ["independent", "independent"] }),
        ],
        nodeIssues: [1],
      });
      expect(messages(roadmap)).toEqual([
        "error: #1 has 2 `Release:` lines, expected exactly 1",
      ]);
    });

    it("reports a Release value that is neither independent nor a batch", () => {
      const roadmap = makeRoadmap({
        steps: [
          makeStep({ issue: 1, releaseTags: ["batch front-door-majors"] }),
        ],
        nodeIssues: [1],
      });
      expect(messages(roadmap)).toEqual([
        'error: #1 has an unrecognized `Release:` value "batch front-door-majors"',
      ]);
    });
  });

  describe("release batches", () => {
    const batched = (issue) =>
      makeStep({ issue, releaseTags: ['batch "front-door"'] });

    it("accepts a batch whose bullet exists and whose tail declares it", () => {
      const roadmap = makeRoadmap({
        steps: [batched(829), batched(828)],
        nodeIssues: [829, 828],
        batchesText:
          '- **Batch "front-door":** [#828], [#829] (tail = [#829]).',
      });
      expect(messages(roadmap)).toEqual([]);
    });

    it("reports a batch a step names that has no bullet", () => {
      const roadmap = makeRoadmap({
        steps: [batched(829)],
        nodeIssues: [829],
        batchesText: '- **Batch "other":** [#829] (tail = [#829]).',
      });
      expect(messages(roadmap)).toContain(
        'error: #829 names batch "front-door", which has no bullet in `Release batches`',
      );
    });

    it("reports a batch named only in a bullet's prose, never as a bullet of its own", () => {
      const roadmap = makeRoadmap({
        steps: [batched(829)],
        nodeIssues: [829],
        batchesText:
          '- Independently releasable: [#829].\n  It left the "front-door" batch once its widening proved semver-minor.',
      });
      expect(messages(roadmap)).toContain(
        'error: #829 names batch "front-door", which has no bullet in `Release batches`',
      );
    });

    it("reports a batch tail that does not declare the batch it tails", () => {
      const roadmap = makeRoadmap({
        steps: [batched(829), makeStep({ issue: 724 })],
        nodeIssues: [829, 724],
        batchesText: '- **Batch "front-door":** [#829] (tail = [#724]).',
      });
      expect(messages(roadmap)).toContain(
        'error: batch "front-door" names #724 as its tail, but #724 does not declare that batch',
      );
    });
  });

  describe("step and diagram correspondence", () => {
    it("reports a step with no node in the diagram", () => {
      const roadmap = makeRoadmap({
        steps: [makeStep({ issue: 885 })],
        nodeIssues: [],
      });
      expect(messages(roadmap)).toEqual([
        "error: #885 has no node in the dependency diagram",
      ]);
    });

    it("reports a node that is not a step", () => {
      const roadmap = makeRoadmap({
        steps: [makeStep({ issue: 885 })],
        nodeIssues: [885, 999],
      });
      expect(messages(roadmap)).toEqual([
        "error: diagram node #999 is not a step in this phase",
      ]);
    });

    it("does not confuse equal counts for equal membership", () => {
      const roadmap = makeRoadmap({
        steps: [makeStep({ issue: 885 })],
        nodeIssues: [999],
      });
      expect(messages(roadmap)).toEqual([
        "error: #885 has no node in the dependency diagram",
        "error: diagram node #999 is not a step in this phase",
      ]);
    });
  });

  describe("dependency acyclicity", () => {
    /** A step whose bullet declares exactly the edges the fixture draws into it. */
    const dependent = (issue, dependsOn) =>
      makeStep({ issue, hardDependency: { present: true, dependsOn } });

    it("accepts a diamond, where two paths reconverge without cycling", () => {
      const roadmap = makeRoadmap({
        steps: [
          makeStep({ issue: 1 }),
          dependent(2, [1]),
          dependent(3, [1]),
          dependent(4, [2, 3]),
        ],
        edges: [
          { from: 1, to: 2, kind: "hard" },
          { from: 1, to: 3, kind: "hard" },
          { from: 2, to: 4, kind: "hard" },
          { from: 3, to: 4, kind: "hard" },
        ],
      });
      expect(messages(roadmap)).toEqual([]);
    });

    it("reports a cycle in the hard-dependency graph", () => {
      const roadmap = makeRoadmap({
        steps: [dependent(1, [3]), dependent(2, [1]), dependent(3, [2])],
        edges: [
          { from: 1, to: 2, kind: "hard" },
          { from: 2, to: 3, kind: "hard" },
          { from: 3, to: 1, kind: "hard" },
        ],
      });
      expect(messages(roadmap)).toEqual([
        "error: hard dependencies cycle: #1 → #2 → #3 → #1",
      ]);
    });

    it("ignores soft edges, which state a preference rather than a constraint", () => {
      const roadmap = makeRoadmap({
        steps: [makeStep({ issue: 1 }), dependent(2, [1])],
        edges: [
          { from: 1, to: 2, kind: "hard" },
          { from: 2, to: 1, kind: "soft" },
        ],
      });
      expect(messages(roadmap)).toEqual([]);
    });
  });

  describe("dependency claims against the diagram", () => {
    it("accepts a claim matching the diagram's solid edges", () => {
      const roadmap = makeRoadmap({
        steps: [
          makeStep({ issue: 724 }),
          makeStep({
            issue: 828,
            hardDependency: { present: true, dependsOn: [724] },
          }),
        ],
        nodeIssues: [724, 828],
        edges: [{ from: 724, to: 828, kind: "hard" }],
      });
      expect(messages(roadmap)).toEqual([]);
    });

    it("reports an edge the step's bullet omits", () => {
      const roadmap = makeRoadmap({
        steps: [
          makeStep({ issue: 724 }),
          makeStep({ issue: 465 }),
          makeStep({
            issue: 878,
            hardDependency: { present: true, dependsOn: [465] },
          }),
        ],
        nodeIssues: [724, 465, 878],
        edges: [
          { from: 465, to: 878, kind: "hard" },
          { from: 724, to: 878, kind: "hard" },
        ],
      });
      expect(messages(roadmap)).toEqual([
        "warning: #878 has a solid edge from #724 that its **Hard dependency:** bullet omits",
      ]);
    });

    it("reports a claim the diagram does not draw", () => {
      const roadmap = makeRoadmap({
        steps: [
          makeStep({ issue: 465 }),
          makeStep({
            issue: 878,
            hardDependency: { present: true, dependsOn: [465] },
          }),
        ],
        nodeIssues: [465, 878],
        edges: [],
      });
      expect(messages(roadmap)).toEqual([
        "warning: #878 declares a hard dependency on #465 with no solid edge in the diagram",
      ]);
    });

    it("reports an edge into a step that declares no dependency bullet", () => {
      const roadmap = makeRoadmap({
        steps: [makeStep({ issue: 724 }), makeStep({ issue: 829 })],
        nodeIssues: [724, 829],
        edges: [{ from: 724, to: 829, kind: "hard" }],
      });
      expect(messages(roadmap)).toEqual([
        "warning: #829 has a solid edge from #724 but declares no **Hard dependency:** bullet",
      ]);
    });

    it("holds a bullet declaring none to the same standard as one naming steps", () => {
      const roadmap = makeRoadmap({
        steps: [
          makeStep({ issue: 724 }),
          makeStep({
            issue: 889,
            hardDependency: { present: true, dependsOn: [] },
          }),
        ],
        nodeIssues: [724, 889],
        edges: [{ from: 724, to: 889, kind: "hard" }],
      });
      expect(messages(roadmap)).toEqual([
        "warning: #889 has a solid edge from #724 that its **Hard dependency:** bullet omits",
      ]);
    });
  });

  describe("mentions in the prose sections", () => {
    it("accepts a step named in both sections", () => {
      const roadmap = makeRoadmap({
        steps: [makeStep({ issue: 878 })],
        nodeIssues: [878],
        tracksText: "- **Track A — Result delivery:** [#857] → [#878].",
        batchesText: "- Independently releasable: [#857], [#878].",
      });
      expect(messages(roadmap)).toEqual([]);
    });

    it("reports a step named in neither", () => {
      const roadmap = makeRoadmap({
        steps: [makeStep({ issue: 885 })],
        nodeIssues: [885],
        tracksText: "- **Track A — Result delivery:** [#857].",
        batchesText: "- Independently releasable: [#857].",
      });
      expect(messages(roadmap)).toEqual([
        "warning: #885 is named in no parallel track",
        "warning: #885 is named in no release batch or independently-releasable list",
      ]);
    });

    it("finds an ordinal-shaped step by its ordinal, not its issue", () => {
      const roadmap = makeRoadmap({
        steps: [makeStep({ issue: 878, ordinal: 15 })],
        nodeIssues: [878],
        tracksText: "- **Track D — Result delivery:** Steps 7 → 8, 15.",
        batchesText: "- Independently releasable: Steps 7, 8, 15.",
      });
      expect(messages(roadmap)).toEqual([]);
    });

    it("does not accept an ordinal-shaped step because its issue number appears", () => {
      const roadmap = makeRoadmap({
        steps: [makeStep({ issue: 878, ordinal: 15 })],
        nodeIssues: [878],
        tracksText: "- **Track D:** Steps 7 → 878.",
        batchesText: "- Independently releasable: Steps 7, 878.",
      });
      expect(messages(roadmap)).toEqual([
        "warning: #878 is named in no parallel track",
        "warning: #878 is named in no release batch or independently-releasable list",
      ]);
    });
  });
});

/**
 * @param {import("../../scripts/roadmap/parse-roadmap.mjs").Roadmap} roadmap
 * @returns {string[]}
 */
function messages(roadmap) {
  return validateRoadmap(roadmap).map((finding) => {
    const subject = finding.stepIssue === null ? "" : `#${finding.stepIssue} `;
    return `${finding.severity}: ${subject}${finding.message}`;
  });
}
