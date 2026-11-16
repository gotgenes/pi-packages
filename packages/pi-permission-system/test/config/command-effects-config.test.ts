import { describe, expect, it } from "vitest";
import {
  detectShadowedCommandEffects,
  detectWrapperCommandEffects,
  foldDeclaredCommandEffects,
  NO_DECLARED_COMMAND_EFFECTS,
} from "#src/config/command-effects-config";

describe("foldDeclaredCommandEffects", () => {
  it("stamps a layer's entries with its scope", () => {
    expect(
      foldDeclaredCommandEffects(
        NO_DECLARED_COMMAND_EFFECTS,
        { git: { subcommands: { log: "read" } } },
        "global",
      ),
    ).toEqual({
      git: { scope: "global", entry: { subcommands: { log: "read" } } },
    });
  });

  it("replaces a colliding command whole with the later layer's entry and scope", () => {
    const global = foldDeclaredCommandEffects(
      NO_DECLARED_COMMAND_EFFECTS,
      { git: { subcommands: { log: "read", diff: "read" } } },
      "global",
    );

    expect(
      foldDeclaredCommandEffects(
        global,
        { git: { subcommands: { status: "read" } } },
        "project",
      ),
    ).toEqual({
      git: { scope: "project", entry: { subcommands: { status: "read" } } },
    });
  });

  it("keeps a command only an earlier layer declares", () => {
    const global = foldDeclaredCommandEffects(
      NO_DECLARED_COMMAND_EFFECTS,
      { officecli: { effects: [] }, git: { effects: "read" } },
      "global",
    );

    expect(
      foldDeclaredCommandEffects(
        global,
        { git: { effects: "write" } },
        "project",
      ),
    ).toEqual({
      officecli: { scope: "global", entry: { effects: [] } },
      git: { scope: "project", entry: { effects: "write" } },
    });
  });

  it("returns the declarations so far when the layer declares nothing", () => {
    const global = foldDeclaredCommandEffects(
      NO_DECLARED_COMMAND_EFFECTS,
      { git: { effects: "read" } },
      "global",
    );

    expect(foldDeclaredCommandEffects(global, undefined, "project")).toBe(
      global,
    );
  });
});

describe("detectShadowedCommandEffects", () => {
  const CORE = new Set(["cat", "sed", "sort"]);

  it("stays silent when no declaration names a core word", () => {
    const declared = foldDeclaredCommandEffects(
      NO_DECLARED_COMMAND_EFFECTS,
      { git: { subcommands: { log: "read" } } },
      "global",
    );

    expect(detectShadowedCommandEffects(declared, CORE)).toBeUndefined();
  });

  it("names one shadowed declaration", () => {
    const declared = foldDeclaredCommandEffects(
      NO_DECLARED_COMMAND_EFFECTS,
      { sed: { effects: "read", unlessOption: ["-i"] } },
      "global",
    );

    expect(detectShadowedCommandEffects(declared, CORE)).toBe(
      "commandEffects declares 'sed', a pure-reader core command. The core decides its effects, so the declaration is ignored; remove it.",
    );
  });

  it("names every shadowed declaration in one message, sorted", () => {
    const declared = foldDeclaredCommandEffects(
      NO_DECLARED_COMMAND_EFFECTS,
      {
        sort: { effects: "read" },
        git: { effects: "read" },
        sed: { effects: "read" },
      },
      "project",
    );

    expect(detectShadowedCommandEffects(declared, CORE)).toBe(
      "commandEffects declares 'sed' and 'sort', pure-reader core commands. The core decides their effects, so the declarations are ignored; remove them.",
    );
  });
});

describe("detectWrapperCommandEffects", () => {
  const WRAPPERS = new Set(["xargs", "sudo", "env"]);

  it("stays silent when no declaration names a wrapper", () => {
    const declared = foldDeclaredCommandEffects(
      NO_DECLARED_COMMAND_EFFECTS,
      { git: { effects: "read" } },
      "global",
    );

    expect(detectWrapperCommandEffects(declared, WRAPPERS)).toBeUndefined();
  });

  it("names one wrapper declaration", () => {
    const declared = foldDeclaredCommandEffects(
      NO_DECLARED_COMMAND_EFFECTS,
      { xargs: { effects: "read" }, git: { effects: "read" } },
      "global",
    );

    expect(detectWrapperCommandEffects(declared, WRAPPERS)).toBe(
      "commandEffects declares 'xargs', a wrapper. A declaration describes a command's own arguments, never the command a wrapper runs, so it is ignored; remove it.",
    );
  });

  it("names every wrapper declaration in one message, sorted", () => {
    const declared = foldDeclaredCommandEffects(
      NO_DECLARED_COMMAND_EFFECTS,
      { sudo: { effects: [] }, env: { effects: "read" } },
      "project",
    );

    expect(detectWrapperCommandEffects(declared, WRAPPERS)).toBe(
      "commandEffects declares 'env' and 'sudo', wrappers. A declaration describes a command's own arguments, never the command a wrapper runs, so they are ignored; remove them.",
    );
  });
});
