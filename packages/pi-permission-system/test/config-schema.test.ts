import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, expectTypeOf, it } from "vitest";
import type {
  DenyWithReason as SchemaDenyWithReason,
  FlatPermissionConfig as SchemaFlatPermissionConfig,
  PatternValue as SchemaPatternValue,
  PermissionState as SchemaPermissionState,
} from "#src/config-schema";
import {
  buildPermissionsJsonSchema,
  PERMISSIONS_SCHEMA_URL,
  unifiedConfigSchema,
} from "#src/config-schema";
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
      "denyWithReason",
      "permissionMap",
      "permissionState",
    ]);
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
        join(import.meta.dirname, "..", "config", "config.example.json"),
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
      "schemas",
      "permissions.schema.json",
    );
    const committed = JSON.parse(
      readFileSync(committedPath, "utf-8"),
    ) as unknown;
    expect(committed).toEqual(buildPermissionsJsonSchema());
  });
});
