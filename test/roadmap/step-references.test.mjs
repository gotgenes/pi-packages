import { describe, expect, it } from "vitest";

import {
  collectStepMentions,
  parseStepReferenceRun,
} from "../../scripts/roadmap/step-references.mjs";

describe("parseStepReferenceRun", () => {
  describe("ordinal-shape bullets", () => {
    it("reads a single reference followed by a relative clause", () => {
      expect(
        parseStepReferenceRun(
          "after Step 6, which decides where the widget's host-event wiring lives.",
        ),
      ).toEqual([{ kind: "ordinal", n: 6 }]);
    });

    it("reads every member of a plural run", () => {
      expect(
        parseStepReferenceRun(
          "after Steps 8, 10, and 11, which together create both refusal paths.",
        ),
      ).toEqual([
        { kind: "ordinal", n: 8 },
        { kind: "ordinal", n: 10 },
        { kind: "ordinal", n: 11 },
      ]);
    });

    it("stops where the prose resumes, so a differently-forced reference is excluded", () => {
      expect(
        parseStepReferenceRun("after Step 8 and informed by Step 10."),
      ).toEqual([{ kind: "ordinal", n: 8 }]);
    });

    it("stops at a parenthetical, so a differently-forced reference after it is excluded", () => {
      expect(
        parseStepReferenceRun(
          "after Step 8 (the completed-child loop must exist and be exercised before its blocking counterpart is designed) and informed by Step 10.",
        ),
      ).toEqual([{ kind: "ordinal", n: 8 }]);
    });

    it("stops at an em-dash clause", () => {
      expect(
        parseStepReferenceRun(
          "after Step 14, whose claim-based routing is what lets a non-blocking front door exist at all — a service resume that carries no result must not be treated as a blocking carrier.",
        ),
      ).toEqual([{ kind: "ordinal", n: 14 }]);
    });
  });

  describe("issue-shape bullets", () => {
    it("reads a bracketed reference as an issue number", () => {
      expect(
        parseStepReferenceRun("after [#857], which creates the condition."),
      ).toEqual([{ kind: "issue", n: 857 }]);
    });

    it("reads every member of a bracketed run", () => {
      expect(
        parseStepReferenceRun(
          "after [#465], [#857], and [#871], which together create both refusal paths.",
        ),
      ).toEqual([
        { kind: "issue", n: 465 },
        { kind: "issue", n: 857 },
        { kind: "issue", n: 871 },
      ]);
    });
  });

  describe("a value declaring no dependency", () => {
    it("yields nothing when prose names other steps", () => {
      expect(
        parseStepReferenceRun("none — independent of Steps 15 and 16."),
      ).toEqual([]);
    });

    it("yields nothing when the prose references the step's own issue", () => {
      expect(
        parseStepReferenceRun(
          "none, but it is the one step here whose resolution binds another package; [#890] records the four candidate resolutions.",
        ),
      ).toEqual([]);
    });
  });
});

describe("collectStepMentions", () => {
  it("finds every member of a plural run listed as bare integers", () => {
    expect(
      collectStepMentions(
        "- **Track A — Front-door contract:** Steps 1 → 2, 3, 4 (the spine; Step 1 unblocks the rest).",
      ),
    ).toEqual(new Set([1, 2, 3, 4]));
  });

  it("finds members across several runs in one bullet", () => {
    expect(
      collectStepMentions(
        "- **Track D — Result delivery:** Steps 7 → 8 → 11 → 14, with Step 10 → 12 joining as a resume-path fix.",
      ),
    ).toEqual(new Set([7, 8, 10, 11, 12, 14]));
  });

  it("finds bracketed issue references", () => {
    expect(
      collectStepMentions(
        '- **Batch "front-door-majors":** [#301], [#302], [#303] (ship together; tail = [#303]).',
      ),
    ).toEqual(new Set([301, 302, 303]));
  });

  it("does not mistake an unrelated number for a step reference", () => {
    expect(
      collectStepMentions("Phase 22 opened on 2026-08-29 with 19 candidates."),
    ).toEqual(new Set());
  });
});
