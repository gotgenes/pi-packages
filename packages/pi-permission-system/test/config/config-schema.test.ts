import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";
import type { z } from "zod";
import type {
  DenyWithReason as SchemaDenyWithReason,
  FlatPermissionConfig as SchemaFlatPermissionConfig,
  PatternValue as SchemaPatternValue,
  PermissionState as SchemaPermissionState,
} from "#src/config/config-schema";
import {
  buildPermissionsJsonSchema,
  commandEffectsSchema,
  PERMISSIONS_SCHEMA_URL,
  unifiedConfigSchema,
} from "#src/config/config-schema";
import type {
  DenyWithReason,
  FlatPermissionConfig,
  PatternValue,
  PermissionState,
} from "#src/types";

describe("unifiedConfigSchema", () => {
  describe("valid configs", () => {
    it("accepts a full config with runtime knobs and flat permission", () => {
      const result = unifiedConfigSchema.safeParse({
        debugLog: true,
        permissionReviewLog: false,
        yoloMode: true,
        toolInputPreviewMaxLength: 1000,
        toolTextSummaryMaxLength: 120,
        piInfrastructureReadPaths: ["/extra/path"],
        permissionDialogKeys: { approve: "1", deny: "4" },
        permission: {
          "*": "ask",
          read: "allow",
          bash: {
            "*": "ask",
            "git status": "allow",
            "npm *": { action: "deny", reason: "Use pnpm instead" },
          },
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts an empty config", () => {
      expect(unifiedConfigSchema.safeParse({}).success).toBe(true);
    });

    it("accepts a $schema field", () => {
      expect(
        unifiedConfigSchema.safeParse({ $schema: "https://example.com/s.json" })
          .success,
      ).toBe(true);
    });
  });

  describe("invalid configs are rejected", () => {
    it("rejects an unknown top-level key", () => {
      const result = unifiedConfigSchema.safeParse({ unknownField: "x" });
      expect(result.success).toBe(false);
    });

    it("rejects a non-boolean debugLog", () => {
      const result = unifiedConfigSchema.safeParse({ debugLog: "yes" });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.path).toEqual(["debugLog"]);
      }
    });

    it("rejects a non-integer toolInputPreviewMaxLength", () => {
      expect(
        unifiedConfigSchema.safeParse({ toolInputPreviewMaxLength: 1.5 })
          .success,
      ).toBe(false);
    });

    it("rejects a zero toolInputPreviewMaxLength", () => {
      expect(
        unifiedConfigSchema.safeParse({ toolInputPreviewMaxLength: 0 }).success,
      ).toBe(false);
    });

    it("rejects a non-string entry in piInfrastructureReadPaths", () => {
      expect(
        unifiedConfigSchema.safeParse({ piInfrastructureReadPaths: ["a", 1] })
          .success,
      ).toBe(false);
    });

    it("rejects a string permission value", () => {
      expect(
        unifiedConfigSchema.safeParse({ permission: "allow" }).success,
      ).toBe(false);
    });

    it("rejects an invalid PermissionState inside a permission map", () => {
      const result = unifiedConfigSchema.safeParse({
        permission: { write: "invalid" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects a deny-with-reason with a non-string reason", () => {
      const result = unifiedConfigSchema.safeParse({
        permission: { bash: { "npm *": { action: "deny", reason: 42 } } },
      });
      expect(result.success).toBe(false);
    });

    it("rejects an empty surface key", () => {
      expect(
        unifiedConfigSchema.safeParse({ permission: { "": "allow" } }).success,
      ).toBe(false);
    });
  });

  describe("directional surface keys", () => {
    it.each([
      "path_read",
      "path_write",
      "external_directory_read",
      "external_directory_write",
    ])("accepts %s", (surface) => {
      expect(
        unifiedConfigSchema.safeParse({
          permission: { [surface]: { "~/dev/*": "allow" } },
        }).success,
      ).toBe(true);
    });

    it.each([
      "path_wrote",
      "path_reed",
      "path_delete",
      "external_directory_reed",
      "external_directory_",
    ])(
      "rejects the misspelled directional key %s, which would sit inert",
      (surface) => {
        const result = unifiedConfigSchema.safeParse({
          permission: { [surface]: { "*": "deny" } },
        });
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues[0]?.message).toContain(surface);
        }
      },
    );

    it("accepts exactly the directional surfaces the schema documents", () => {
      const permission = (
        buildPermissionsJsonSchema().properties as Record<
          string,
          Record<string, unknown>
        >
      ).permission;
      const documented = Object.keys(
        permission.properties as Record<string, unknown>,
      ).filter((key) => /^(path|external_directory)_/.test(key));

      expect(documented.toSorted()).toEqual([
        "external_directory_read",
        "external_directory_write",
        "path_read",
        "path_write",
      ]);
      for (const key of documented) {
        expect(
          unifiedConfigSchema.safeParse({ permission: { [key]: "allow" } })
            .success,
        ).toBe(true);
      }
    });

    it("enumerates exactly those spellings when rejecting a misspelling", () => {
      const result = unifiedConfigSchema.safeParse({
        permission: { path_wrote: { "*": "deny" } },
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe(
          'Unknown directional surface key "path_wrote". The legal spellings are path_read, path_write, external_directory_read, external_directory_write.',
        );
      }
    });

    it("still accepts an arbitrary tool-name surface, and keeps its rules", () => {
      const permission = { my_extension_tool: { "*": "ask" }, ffgrep: "allow" };
      const result = unifiedConfigSchema.safeParse({ permission });

      expect(result.success).toBe(true);
      // Asserting the parsed data, not just `success`: without the catchall
      // zod silently *strips* an unmatched key rather than rejecting it, so a
      // success-only assertion passes while every tool-name rule is dropped.
      expect(result.data?.permission).toEqual(permission);
    });

    it("leaves a tool named like a family member of another family alone", () => {
      expect(
        unifiedConfigSchema.safeParse({
          permission: { my_tool_read: "allow" },
        }).success,
      ).toBe(true);
    });
  });

  describe("the fallback and bare-family surface keys", () => {
    it.each(["*", "path", "external_directory", "bash", "mcp", "skill"])(
      "accepts %s as a string shorthand",
      (surface) => {
        expect(
          unifiedConfigSchema.safeParse({ permission: { [surface]: "allow" } })
            .success,
        ).toBe(true);
      },
    );

    it.each(["*", "path", "external_directory", "bash", "mcp", "skill"])(
      "accepts %s as a pattern map",
      (surface) => {
        expect(
          unifiedConfigSchema.safeParse({
            permission: { [surface]: { "*": "ask", "~/dev/*": "allow" } },
          }).success,
        ).toBe(true);
      },
    );

    it.each(["*", "path", "external_directory", "bash", "mcp", "skill"])(
      "rejects an invalid action on %s",
      (surface) => {
        expect(
          unifiedConfigSchema.safeParse({
            permission: { [surface]: "maybe" },
          }).success,
        ).toBe(false);
      },
    );
  });

  describe("shellTools field", () => {
    it("accepts a shellTools map with a full alias", () => {
      const result = unifiedConfigSchema.safeParse({
        shellTools: {
          exec_command: { commandArgument: "cmd", workdirArgument: "workdir" },
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts an alias with only commandArgument", () => {
      const result = unifiedConfigSchema.safeParse({
        shellTools: { exec_command: { commandArgument: "cmd" } },
      });
      expect(result.success).toBe(true);
    });

    it("rejects an alias missing commandArgument", () => {
      const result = unifiedConfigSchema.safeParse({
        shellTools: { exec_command: { workdirArgument: "workdir" } },
      });
      expect(result.success).toBe(false);
    });

    it("rejects an unknown field inside an alias", () => {
      const result = unifiedConfigSchema.safeParse({
        shellTools: { exec_command: { commandArgument: "cmd", extra: "x" } },
      });
      expect(result.success).toBe(false);
    });

    it("rejects a non-string commandArgument", () => {
      const result = unifiedConfigSchema.safeParse({
        shellTools: { exec_command: { commandArgument: 42 } },
      });
      expect(result.success).toBe(false);
    });

    it("rejects an empty-string commandArgument", () => {
      const result = unifiedConfigSchema.safeParse({
        shellTools: { exec_command: { commandArgument: "" } },
      });
      expect(result.success).toBe(false);
    });
  });

  // The schema checks shape; whether a well-formed string is a *usable*
  // binding is `resolveDialogKeys`' question, answered tolerantly. A
  // misspelled decision name has no such recovery — it would simply sit
  // inert — so it fails the scope closed like any other malformed field.
  describe("permissionDialogKeys field", () => {
    it("accepts a full map of decisions", () => {
      const result = unifiedConfigSchema.safeParse({
        permissionDialogKeys: {
          approve: "1",
          approveSession: "2",
          approveSessionBoth: "3",
          deny: "4",
          denyWithReason: "5",
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts a map naming only some decisions", () => {
      const result = unifiedConfigSchema.safeParse({
        permissionDialogKeys: { deny: "4" },
      });
      expect(result.success).toBe(true);
    });

    it("rejects an unknown decision name", () => {
      const result = unifiedConfigSchema.safeParse({
        permissionDialogKeys: { approveAll: "1" },
      });
      expect(result.success).toBe(false);
    });

    it("rejects a non-string binding", () => {
      const result = unifiedConfigSchema.safeParse({
        permissionDialogKeys: { approve: 1 },
      });
      expect(result.success).toBe(false);
    });

    it("accepts a binding the resolver will refuse, leaving that to the resolver", () => {
      const result = unifiedConfigSchema.safeParse({
        permissionDialogKeys: { deny: "j" },
      });
      expect(result.success).toBe(true);
    });
  });

  describe("promptNotifications field", () => {
    it("accepts every channel", () => {
      const result = unifiedConfigSchema.safeParse({
        promptNotifications: ["bell", "osc9", "osc777"],
      });
      expect(result.success).toBe(true);
    });

    it("accepts an empty list, which turns notifications off", () => {
      const result = unifiedConfigSchema.safeParse({ promptNotifications: [] });
      expect(result.success).toBe(true);
    });

    it("rejects an unknown channel, naming the entry", () => {
      const result = unifiedConfigSchema.safeParse({
        promptNotifications: ["bell", "beep"],
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path)).toEqual([
        ["promptNotifications", 1],
      ]);
    });
  });
});

describe("commandEffectsSchema", () => {
  describe("accepted shapes", () => {
    it.each([
      [
        "ADR 0013 \u00a77's example",
        {
          sed: { effects: "read", unlessOption: ["-i", "--in-place"] },
          curl: { effects: [], unlessOption: ["-o", "-O", "--output"] },
          git: {
            subcommands: {
              diff: "read",
              log: "read",
              remote: { subcommands: { show: "read" } },
            },
          },
        },
      ],
      ["an empty effects array", { officecli: { effects: [] } }],
      ["both effects", { tool: { effects: ["read", "write"] } }],
      ["a write declaration", { tool: { effects: "write" } }],
      [
        "an array shorthand subcommand",
        { git: { subcommands: { log: ["read"] } } },
      ],
      [
        "a single-dash long stem",
        { tool: { effects: "read", unlessOption: ["-exec"] } },
      ],
      ["an entry with only subcommands", { git: { subcommands: {} } }],
    ])("accepts %s", (_label, value) => {
      expect(commandEffectsSchema.safeParse(value).success).toBe(true);
    });
  });

  describe("rejected shapes", () => {
    it.each([
      ["a path-qualified command key", { "/usr/bin/git": { effects: "read" } }],
      ["a relative command key", { "./git": { effects: "read" } }],
      ["a backslash command key", { "bin\\git": { effects: "read" } }],
      ["a command key with whitespace", { "git log": { effects: "read" } }],
      ["an empty command key", { "": { effects: "read" } }],
      ["a dash-led subcommand key", { git: { subcommands: { "-C": "read" } } }],
      ["an empty subcommand key", { git: { subcommands: { "": "read" } } }],
      [
        "an option stem without a dash",
        { sed: { effects: "read", unlessOption: ["i"] } },
      ],
      ["a bare dash stem", { sed: { effects: "read", unlessOption: ["-"] } }],
      [
        "a bare double-dash stem",
        { sed: { effects: "read", unlessOption: ["--"] } },
      ],
      [
        "an option stem with a value",
        { sed: { effects: "read", unlessOption: ["--output=x"] } },
      ],
      ["an unknown effect", { git: { subcommands: { log: "reed" } } }],
      ["an unknown field", { git: { effect: "read" } }],
      [
        "an unknown nested field",
        { git: { subcommands: { log: { effect: "read" } } } },
      ],
    ])("rejects %s", (_label, value) => {
      expect(commandEffectsSchema.safeParse(value).success).toBe(false);
    });
  });
});

describe("array size bounds", () => {
  const CAP = 1000;

  /**
   * A failed union reports one top-level `invalid_union` whose arms carry the
   * real issues, so a count of top-level issues cannot tell a pre-walk size
   * rejection from a per-element one. Flatten to the leaves instead, rebasing
   * each arm's union-relative path onto the union's own.
   */
  function leafIssues(
    issues: readonly z.core.$ZodIssue[],
    prefix: PropertyKey[] = [],
  ): { code: string; path: PropertyKey[] }[] {
    return issues.flatMap((issue) => {
      const path = [...prefix, ...issue.path];
      return issue.code === "invalid_union"
        ? issue.errors.flatMap((arm) => leafIssues(arm, path))
        : [{ code: issue.code, path }];
    });
  }

  const repeat = <T>(n: number, fill: T): T[] =>
    Array.from({ length: n }, () => fill);

  interface BoundCase {
    schema: z.ZodType;
    build: (entries: string[]) => unknown;
    validFill: string;
    invalidFill: string;
    path: (string | number)[];
  }

  const cases: [string, BoundCase][] = [
    [
      "piInfrastructureReadPaths",
      {
        schema: unifiedConfigSchema,
        build: (entries) => ({ piInfrastructureReadPaths: entries }),
        validFill: "/p",
        invalidFill: "",
        path: ["piInfrastructureReadPaths"],
      },
    ],
    [
      "authorizerChain",
      {
        schema: unifiedConfigSchema,
        build: (entries) => ({ authorizerChain: entries }),
        validFill: "x",
        invalidFill: "",
        path: ["authorizerChain"],
      },
    ],
    [
      "promptNotifications",
      {
        schema: unifiedConfigSchema,
        build: (entries) => ({ promptNotifications: entries }),
        validFill: "bell",
        invalidFill: "beep",
        path: ["promptNotifications"],
      },
    ],
    [
      "a commandEffects entry's effects",
      {
        schema: commandEffectsSchema,
        build: (entries) => ({ t: { effects: entries } }),
        validFill: "read",
        invalidFill: "x",
        path: ["t", "effects"],
      },
    ],
    [
      "a commandEffects entry's unlessOption",
      {
        schema: commandEffectsSchema,
        build: (entries) => ({ t: { effects: "read", unlessOption: entries } }),
        validFill: "--output",
        invalidFill: "x",
        path: ["t", "unlessOption"],
      },
    ],
    [
      "a subcommand's shorthand effects list",
      {
        schema: commandEffectsSchema,
        build: (entries) => ({ t: { subcommands: { s: entries } } }),
        validFill: "read",
        invalidFill: "x",
        path: ["t", "subcommands", "s"],
      },
    ],
    [
      "a subcommand entry's effects",
      {
        schema: commandEffectsSchema,
        build: (entries) => ({
          t: { subcommands: { s: { effects: entries } } },
        }),
        validFill: "read",
        invalidFill: "x",
        path: ["t", "subcommands", "s", "effects"],
      },
    ],
  ];

  describe.each(cases)(
    "%s",
    (_label, { schema, build, validFill, invalidFill, path }) => {
      it(`accepts ${CAP} valid entries`, () => {
        expect(schema.safeParse(build(repeat(CAP, validFill))).success).toBe(
          true,
        );
      });

      it(`rejects ${CAP + 1} invalid entries with one size issue and no element issue`, () => {
        const result = schema.safeParse(build(repeat(CAP + 1, invalidFill)));
        expect(result.success).toBe(false);
        const leaves = leafIssues(result.error?.issues ?? []);
        expect(
          leaves
            .filter((issue) => issue.code === "too_big")
            .map((issue) => issue.path),
        ).toEqual([path]);
        expect(
          leaves.filter((issue) => typeof issue.path.at(-1) === "number"),
        ).toEqual([]);
      });
    },
  );
});

describe("inferred types match the hand-written domain types", () => {
  it("PermissionState is equivalent", () => {
    expectTypeOf<SchemaPermissionState>().toEqualTypeOf<PermissionState>();
  });

  it("DenyWithReason is equivalent", () => {
    expectTypeOf<SchemaDenyWithReason>().toEqualTypeOf<DenyWithReason>();
  });

  it("PatternValue is equivalent", () => {
    expectTypeOf<SchemaPatternValue>().toEqualTypeOf<PatternValue>();
  });

  it("FlatPermissionConfig is equivalent", () => {
    expectTypeOf<SchemaFlatPermissionConfig>().toEqualTypeOf<FlatPermissionConfig>();
  });
});

describe("buildPermissionsJsonSchema", () => {
  const schema = buildPermissionsJsonSchema();

  it("targets Draft 2020-12", () => {
    expect(schema.$schema).toBe("https://json-schema.org/draft/2020-12/schema");
  });

  it("sets the root $id to the monorepo raw URL", () => {
    expect(schema.$id).toBe(PERMISSIONS_SCHEMA_URL);
    expect(schema.$id).toContain("gotgenes/pi-packages");
  });

  it("forbids additional top-level properties", () => {
    expect(schema.additionalProperties).toBe(false);
  });

  it("extracts the shared sub-schemas into $defs", () => {
    const defs = schema.$defs as Record<string, unknown>;
    expect(Object.keys(defs).sort()).toEqual([
      "commandEffectsEntry",
      "denyWithReason",
      "permissionMap",
      "permissionState",
    ]);
  });

  it("refers a nested subcommand entry back to the shared entry definition", () => {
    const defs = schema.$defs as Record<string, Record<string, unknown>>;
    const properties = defs.commandEffectsEntry.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(properties.subcommands.additionalProperties).toEqual({
      anyOf: [
        { $ref: "#/$defs/commandEffectsEntry" },
        expect.objectContaining({ anyOf: expect.any(Array) }),
      ],
    });
  });

  it("preserves markdownDescription for editor hovers", () => {
    expect(typeof schema.markdownDescription).toBe("string");
    const properties = schema.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(typeof properties.yoloMode.markdownDescription).toBe("string");
  });

  it("preserves the permission examples", () => {
    const properties = schema.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(Array.isArray(properties.permission.examples)).toBe(true);
  });

  it("names every well-known surface as a documented property", () => {
    const permission = (
      schema.properties as Record<string, Record<string, unknown>>
    ).permission;
    const properties = permission.properties as Record<
      string,
      Record<string, unknown>
    >;
    expect(Object.keys(properties).sort()).toEqual([
      "*",
      "bash",
      "external_directory",
      "external_directory_read",
      "external_directory_write",
      "mcp",
      "path",
      "path_read",
      "path_write",
      "skill",
    ]);
    for (const key of Object.keys(properties)) {
      expect(properties[key].description).toEqual(expect.any(String));
      expect(properties[key].markdownDescription).toEqual(expect.any(String));
    }
  });

  it("keeps each surface's documentation inside the per-property budget", () => {
    const permission = (
      schema.properties as Record<string, Record<string, unknown>>
    ).permission;
    const properties = permission.properties as Record<
      string,
      Record<string, unknown>
    >;
    const oversized = Object.entries(properties)
      .map(([key, value]) => [
        key,
        (value.markdownDescription as string).length,
      ])
      .filter(([, length]) => (length as number) > 800);

    expect(oversized).toEqual([]);
  });

  it("keeps the permission object's own description a summary", () => {
    const permission = (
      schema.properties as Record<string, Record<string, unknown>>
    ).permission;

    expect((permission.markdownDescription as string).length).toBeLessThan(
      1200,
    );
  });

  it("keeps arbitrary tool-name surfaces validating alongside them", () => {
    const permission = (
      schema.properties as Record<string, Record<string, unknown>>
    ).permission;
    expect(permission.additionalProperties).toEqual({
      anyOf: [
        { $ref: "#/$defs/permissionState" },
        { $ref: "#/$defs/permissionMap" },
      ],
    });
  });
});

describe("config/config.example.json", () => {
  it("validates against unifiedConfigSchema", () => {
    const example = JSON.parse(
      readFileSync(
        join(import.meta.dirname, "..", "..", "config", "config.example.json"),
        "utf-8",
      ),
    ) as unknown;
    const result = unifiedConfigSchema.safeParse(example);
    expect(result.success ? [] : result.error.issues).toEqual([]);
  });
});

describe("committed schemas/permissions.schema.json is in sync", () => {
  it("equals the generated schema (run `pnpm run gen:schema` if this fails)", () => {
    const committedPath = join(
      import.meta.dirname,
      "..",
      "..",
      "schemas",
      "permissions.schema.json",
    );
    const committed = JSON.parse(
      readFileSync(committedPath, "utf-8"),
    ) as unknown;
    expect(committed).toEqual(buildPermissionsJsonSchema());
  });
});
