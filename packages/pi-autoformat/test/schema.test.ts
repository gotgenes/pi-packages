import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const schemaPath = join(process.cwd(), "schemas", "pi-autoformat.schema.json");

type FormatterOutputSchema = {
  type?: string;
  additionalProperties?: boolean;
  properties?: {
    onFailure?: { type?: string; enum?: string[] };
    maxBytes?: { type?: string; minimum?: number };
    maxLines?: { type?: string; minimum?: number };
  };
};

type SchemaShape = {
  $defs?: {
    formatterDefinition?: {
      properties?: Record<string, unknown>;
    };
    chainStep?: unknown;
    formatterOutputReportingConfig?: FormatterOutputSchema;
    customMutationToolSpec?: {
      properties?: Record<string, { type?: string; minLength?: number }>;
      oneOf?: unknown[];
    };
  };
  additionalProperties?: boolean;
  properties?: {
    chains?: {
      propertyNames?: { pattern?: string };
      additionalProperties?: {
        type?: string;
        items?: unknown;
      };
    };
    formatterOutput?: FormatterOutputSchema | { $ref?: string };
  };
};

describe("pi-autoformat.schema.json", () => {
  const schema: SchemaShape = JSON.parse(readFileSync(schemaPath, "utf8"));

  it("does not declare a notifyAgent property", () => {
    expect(schema.properties).not.toHaveProperty("notifyAgent");
  });

  it("does not declare an extensions property on formatterDefinition", () => {
    const properties = schema.$defs?.formatterDefinition?.properties ?? {};
    expect(properties).not.toHaveProperty("extensions");
  });

  it("still declares command on formatterDefinition", () => {
    const properties = schema.$defs?.formatterDefinition?.properties ?? {};
    expect(properties).toHaveProperty("command");
  });

  describe("chains key pattern", () => {
    it("accepts dotted extension keys and the literal '*' wildcard", () => {
      const pattern = schema.properties?.chains?.propertyNames?.pattern;
      expect(pattern).toBeDefined();
      const re = new RegExp(pattern!);
      expect(re.test(".md")).toBe(true);
      expect(re.test(".tsx")).toBe(true);
      expect(re.test("*")).toBe(true);
    });

    it("rejects bare names and empty strings", () => {
      const pattern = schema.properties?.chains?.propertyNames?.pattern;
      const re = new RegExp(pattern!);
      expect(re.test("md")).toBe(false);
      expect(re.test("")).toBe(false);
    });
  });

  describe("chains step shape", () => {
    it("declares chains items as a oneOf of string and fallback object", () => {
      const items = schema.properties?.chains?.additionalProperties?.items as
        | { oneOf?: unknown[] }
        | undefined;
      expect(items).toBeDefined();
      expect(Array.isArray(items?.oneOf)).toBe(true);
      expect(items?.oneOf?.length).toBe(2);
    });

    it("includes a string variant for chain steps", () => {
      const items = schema.properties?.chains?.additionalProperties?.items as
        | { oneOf?: Array<{ type?: string; minLength?: number }> }
        | undefined;
      const stringVariant = items?.oneOf?.find((v) => v.type === "string");
      expect(stringVariant).toBeDefined();
      expect(stringVariant?.minLength).toBe(1);
    });

    it("includes a fallback object variant with a non-empty string array", () => {
      const items = schema.properties?.chains?.additionalProperties?.items as
        | { oneOf?: Array<Record<string, unknown>> }
        | undefined;
      const fallbackVariant = items?.oneOf?.find((v) => v.type === "object") as
        | {
            type?: string;
            additionalProperties?: boolean;
            required?: string[];
            properties?: {
              fallback?: {
                type?: string;
                minItems?: number;
                items?: { type?: string; minLength?: number };
              };
            };
          }
        | undefined;
      expect(fallbackVariant).toBeDefined();
      expect(fallbackVariant?.additionalProperties).toBe(false);
      expect(fallbackVariant?.required).toEqual(["fallback"]);
      const fallback = fallbackVariant?.properties?.fallback;
      expect(fallback?.type).toBe("array");
      expect(fallback?.minItems).toBe(1);
      expect(fallback?.items?.type).toBe("string");
      expect(fallback?.items?.minLength).toBe(1);
    });
  });

  describe("customMutationToolSpec", () => {
    it("declares patchField as a non-empty string", () => {
      const patchField =
        schema.$defs?.customMutationToolSpec?.properties?.patchField;
      // objectContaining: the description is prose, not part of the contract.
      expect(patchField).toEqual(
        expect.objectContaining({ type: "string", minLength: 1 }),
      );
    });

    it("requires exactly one of pathField, pathFields, or patchField", () => {
      expect(schema.$defs?.customMutationToolSpec?.oneOf).toEqual([
        { required: ["pathField"] },
        { required: ["pathFields"] },
        { required: ["patchField"] },
      ]);
    });
  });

  describe("formatterOutput", () => {
    it("declares formatterOutput as a top-level property", () => {
      expect(schema.properties).toHaveProperty("formatterOutput");
    });

    it("forbids unknown sub-keys on formatterOutput", () => {
      const def = schema.$defs?.formatterOutputReportingConfig;
      expect(def?.type).toBe("object");
      expect(def?.additionalProperties).toBe(false);
    });

    it("restricts onFailure to none/stderr/both", () => {
      const onFailure =
        schema.$defs?.formatterOutputReportingConfig?.properties?.onFailure;
      expect(onFailure?.type).toBe("string");
      expect(onFailure?.enum).toEqual(["none", "stderr", "both"]);
    });

    it("requires non-negative integer caps for maxBytes and maxLines", () => {
      const props =
        schema.$defs?.formatterOutputReportingConfig?.properties ?? {};
      expect(props.maxBytes?.type).toBe("integer");
      expect(props.maxBytes?.minimum).toBe(0);
      expect(props.maxLines?.type).toBe("integer");
      expect(props.maxLines?.minimum).toBe(0);
    });
  });
});
