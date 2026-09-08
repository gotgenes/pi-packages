import { describe, expect, it } from "vitest";

import { parseRoadmap } from "../../scripts/roadmap/parse-roadmap.mjs";

/**
 * A roadmap in the ordinal heading shape both live phases still use, with the
 * two `####` sweep headings that sit inside the section above `### Steps`.
 */
const ORDINAL_ROADMAP = `## Improvement roadmap — Phase 22: Front-door contract parity

### Findings (planned 2026-08-29)

#### Open-issue sweep dispositions

- [#830] — adopted as Step 2.

#### Deferred tidyings swept

Nothing outstanding.

The shape a step takes this phase:

\`\`\`markdown
#### ✅ Step 9: An example quoted in the findings ([#999])

- **Impact 1 / Risk 1 / Priority 5.**
\`\`\`

### Steps

#### ✅ Step 1: Land first-class SDK spawns ([#724])

**Cause:** the manager forks on provider.

- **Smell:** Category C.
- **Impact 4 / Risk 2 / Priority 16.**

Release: independent

#### A heading that names no issue at all

**Cause:** it is malformed, and the parser cannot key it.

- **Impact 1 / Risk 1 / Priority 5.**

Release: independent

#### Step 2: Decide the allowlist policy ([#830], with [#834])

**Cause:** the record is produced, never implemented.

- **Hard dependency:** after Step 1, which creates the choke point.
- **Impact 3 / Risk 2 / Priority 12.**

Release: batch "front-door-majors"

### Step dependency diagram

\`\`\`mermaid
flowchart TD
    S1["✅ Step 1 (#724)<br/>Choke-point parity"] --> S2["Step 2 (#830)<br/>Allowlist policy"]
    S1 -.soft.-> S2
\`\`\`

### Parallel tracks

- **Track A — Front-door contract:** Steps 1 → 2.

### Release batches

- **Batch "front-door-majors":** Steps 2 (ship together; tail = Step 2).
- Independently releasable: Step 1.

## Refactoring history

Nothing here.
`;

/** The same phase in the issue-identity heading shape the format spec now specifies. */
const ISSUE_ROADMAP = `## Improvement roadmap — Phase 23: Resume delivery

### Steps

#### ✅ [#857] Re-prepare or refuse a workspace-backed resume

**Cause:** \`completeRun()\` disposes the workspace.

- **Impact 2 / Risk 2 / Priority 8.**

Release: independent

#### [#878] Stop advertising a resume that will be refused (with [#892])

**Cause:** the affordance is rendered from \`pendingQuestion\` alone.

- **Hard dependency:** after [#857], which creates the condition.
- **Impact 2 / Risk 2 / Priority 8.**

Release: independent

### Step dependency diagram

\`\`\`mermaid
flowchart TD
    S857["✅ #857<br/>Workspace-backed resume"] --> S878["#878<br/>Resume affordance honesty"]
    S857 -.-> S878
    S857 -.informs.-> S878
\`\`\`

### Parallel tracks

- **Track A — Result delivery:** [#857] → [#878].

### Release batches

- Independently releasable: [#857], [#878].

## Refactoring history
`;

describe("parseRoadmap", () => {
  it("returns null for a document with no improvement roadmap section", () => {
    expect(parseRoadmap("# Architecture\n\nNo roadmap here.\n")).toBeNull();
  });

  describe("the ordinal heading shape", () => {
    const roadmap = parseRoadmap(ORDINAL_ROADMAP);

    it("reads the phase title", () => {
      expect(roadmap.phaseTitle).toBe(
        "Improvement roadmap — Phase 22: Front-door contract parity",
      );
    });

    it("takes steps from the Steps subsection, not from a heading quoted above it", () => {
      expect(roadmap.steps.map((step) => step.issue)).toEqual([724, 830]);
    });

    it("records each step's ordinal alongside its issue", () => {
      expect(roadmap.steps.map((step) => step.ordinal)).toEqual([1, 2]);
    });

    it("drops a heading it cannot key, leaving its diagram node to surface the loss", () => {
      // The parser has no identity to file such a step under. `validateRoadmap`
      // reports the orphaned node, so the step is not lost silently.
      expect(roadmap.steps.map((step) => step.title)).not.toContain(
        "A heading that names no issue at all",
      );
    });

    it("reads the scores", () => {
      expect(roadmap.steps[0].scores).toEqual({
        impact: 4,
        risk: 2,
        priority: 16,
      });
    });

    it("collects every Release line in a step block", () => {
      expect(roadmap.steps.map((step) => step.releaseTags)).toEqual([
        ["independent"],
        ['batch "front-door-majors"'],
      ]);
    });

    it("resolves an ordinal dependency claim to the issue it names", () => {
      expect(roadmap.steps[1].hardDependency).toEqual({
        present: true,
        dependsOn: [724],
      });
    });

    it("records the absence of a dependency bullet distinctly from an empty claim", () => {
      expect(roadmap.steps[0].hardDependency).toBeNull();
    });

    it("reads diagram edges by issue, taking the issue from the node label", () => {
      expect(roadmap.edges).toEqual([
        { from: 724, to: 830, kind: "hard" },
        { from: 724, to: 830, kind: "soft" },
      ]);
    });

    it("reads the diagram's nodes by issue", () => {
      expect(roadmap.nodeIssues).toEqual([724, 830]);
    });

    it("carries the tracks and batches sections as raw text", () => {
      expect(roadmap.tracksText).toContain("Track A — Front-door contract");
      expect(roadmap.tracksText).not.toContain("Batch");
      expect(roadmap.batchesText).toContain('Batch "front-door-majors"');
      expect(roadmap.batchesText).not.toContain("Refactoring history");
    });
  });

  describe("the issue-identity heading shape", () => {
    const roadmap = parseRoadmap(ISSUE_ROADMAP);

    it("reads the issue from the heading and leaves the ordinal unset", () => {
      expect(roadmap.steps.map((step) => step.issue)).toEqual([857, 878]);
      expect(roadmap.steps.map((step) => step.ordinal)).toEqual([null, null]);
    });

    it("keys a folded-in step on its primary issue", () => {
      expect(roadmap.steps[1].title).toBe(
        "Stop advertising a resume that will be refused (with [#892])",
      );
      expect(roadmap.steps[1].issue).toBe(878);
    });

    it("reads a bracketed dependency claim without resolving an ordinal", () => {
      expect(roadmap.steps[1].hardDependency).toEqual({
        present: true,
        dependsOn: [857],
      });
    });

    it("classifies every dashed-edge spelling as soft", () => {
      expect(roadmap.edges).toEqual([
        { from: 857, to: 878, kind: "hard" },
        { from: 857, to: 878, kind: "soft" },
        { from: 857, to: 878, kind: "soft" },
      ]);
    });
  });
});
