import { describe, expect, it } from "vitest";

import {
  type ApprovalGrant,
  provenDirectionOf,
  widenGrant,
} from "#src/approval-grant";

describe("widenGrant", () => {
  it("folds a directional surface to its bare family, keeping the pattern", () => {
    expect(
      widenGrant({ surface: "external_directory_write", pattern: "/tmp/*" }),
    ).toEqual({ surface: "external_directory", pattern: "/tmp/*" });
  });

  it("folds the other direction the same way", () => {
    expect(widenGrant({ surface: "path_read", pattern: "/tmp/*" })).toEqual({
      surface: "path",
      pattern: "/tmp/*",
    });
  });

  it("leaves a grant that already names a family alone", () => {
    const grant: ApprovalGrant = {
      surface: "external_directory",
      pattern: "/tmp/*",
    };
    expect(widenGrant(grant)).toBe(grant);
  });

  it("leaves a non-directional surface alone", () => {
    const grant: ApprovalGrant = { surface: "bash", pattern: "git *" };
    expect(widenGrant(grant)).toBe(grant);
  });
});

describe("provenDirectionOf", () => {
  it("names the direction a single directional grant proves", () => {
    expect(
      provenDirectionOf([
        { surface: "external_directory_write", pattern: "/tmp/*" },
      ]),
    ).toBe("write");
  });

  it("names the shared direction when every grant agrees", () => {
    expect(
      provenDirectionOf([
        { surface: "external_directory_read", pattern: "/tmp/a/*" },
        { surface: "external_directory_read", pattern: "/tmp/b/*" },
        { surface: "external_directory_read", pattern: "/tmp/c/*" },
      ]),
    ).toBe("read");
  });

  it("answers null when the grants disagree", () => {
    expect(
      provenDirectionOf([
        { surface: "external_directory_read", pattern: "/tmp/a/*" },
        { surface: "external_directory_write", pattern: "/tmp/b/*" },
      ]),
    ).toBeNull();
  });

  it("answers null when a later grant is non-directional", () => {
    expect(
      provenDirectionOf([
        { surface: "external_directory_read", pattern: "/tmp/a/*" },
        { surface: "external_directory", pattern: "/tmp/b/*" },
      ]),
    ).toBeNull();
  });

  it("answers null when the only grant is non-directional", () => {
    expect(
      provenDirectionOf([{ surface: "bash", pattern: "git *" }]),
    ).toBeNull();
  });

  it("answers null for no grants at all", () => {
    expect(provenDirectionOf([])).toBeNull();
  });
});
