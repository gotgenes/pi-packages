import path from "node:path";

import globals from "globals";
import tseslint from "typescript-eslint";

// ---------------------------------------------------------------------------
// Custom rule: no parent-relative imports in packages
//
// Flags any `from "../..."` import in packages/*/src/ or packages/*/test/ and
// offers an auto-fix that rewrites to the package's #src/ or #test/ alias.
// Same-directory `./` imports are intentionally allowed.
// ---------------------------------------------------------------------------

/** @type {import("eslint").Rule.RuleModule} */
const noParentRelativeImports = {
  meta: {
    type: "suggestion",
    fixable: "code",
    messages: {
      noParent:
        'Use the #src/ or #test/ alias instead of a relative parent import ("{{value}}").',
    },
  },
  create(context) {
    return {
      ImportDeclaration(node) {
        const value = node.source.value;
        if (typeof value !== "string" || !value.startsWith("../")) return;

        const filePath = context.filename;
        const configDir = import.meta.dirname;
        const resolved = path.resolve(path.dirname(filePath), value);
        const rel = path.relative(configDir, resolved);
        // rel is e.g. "packages/pi-colgrep/src/lib/args"
        const match = /^packages\/[^/]+\/(src|test)\/(.+)$/.exec(rel);

        context.report({
          node: node.source,
          messageId: "noParent",
          data: { value },
          fix: match
            ? (fixer) =>
                fixer.replaceText(node.source, `"#${match[1]}/${match[2]}"`)
            : undefined,
        });
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Custom rule: no own-directory alias imports
//
// The mirror image of the rule above. The convention is `./` for a
// same-directory target and the #src/ or #test/ alias for a cross-directory
// one; this flags an alias specifier that resolves to the importer's own
// directory and auto-fixes it to `./`. Without it only half the convention is
// enforced, and the two spellings drift within a single directory.
//
// Currently scoped to pi-permission-system; the repo-wide rollout is #877.
// ---------------------------------------------------------------------------

/** @type {import("eslint").Rule.RuleModule} */
const noOwnDirectoryAliasImports = {
  meta: {
    type: "suggestion",
    fixable: "code",
    messages: {
      ownDirectory:
        'Use a same-directory "./" import for a module in this file\'s own directory ("{{value}}").',
    },
  },
  create(context) {
    const rel = path.relative(import.meta.dirname, context.filename);
    const match = /^packages\/[^/]+\/(src|test)\/(.+)$/.exec(rel);
    if (!match) return {};

    const ownDir = path.dirname(match[2]);
    const prefix = ownDir === "." ? `#${match[1]}/` : `#${match[1]}/${ownDir}/`;

    /** @param {{ source?: { value?: unknown } | null }} node */
    function check(node) {
      const source = node.source;
      if (!source) return;
      const value = source.value;
      if (typeof value !== "string" || !value.startsWith(prefix)) return;

      const target = value.slice(prefix.length);
      // A remaining separator means a deeper directory, not this one.
      if (target === "" || target.includes("/")) return;

      context.report({
        node: source,
        messageId: "ownDirectory",
        data: { value },
        fix: (fixer) => fixer.replaceText(source, `"./${target}"`),
      });
    }

    return {
      ImportDeclaration: check,
      ExportNamedDeclaration: check,
      ExportAllDeclaration: check,
    };
  },
};

/** Shared so both config blocks below reference one plugin object. */
const localRulesPlugin = {
  rules: {
    "no-parent-relative-imports": noParentRelativeImports,
    "no-own-directory-alias-imports": noOwnDirectoryAliasImports,
  },
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Files that receive full type-aware linting. */
const PACKAGE_TS_FILES = ["packages/*/src/**/*.ts", "packages/*/test/**/*.ts"];

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/coverage/**",
      ".pi/**",
      ".fallow/**",
    ],
  },

  // Always report unused disable directives as errors so they don't
  // silently pile up when violations are fixed.
  { linterOptions: { reportUnusedDisableDirectives: "error" } },

  // Type-aware rules only — no overlap with Biome's non-type-aware lint.
  // Scoped to package TS files so the projectService parser is only invoked
  // where a tsconfig covers the file.
  {
    files: PACKAGE_TS_FILES,
    extends: [
      tseslint.configs.recommendedTypeCheckedOnly,
      tseslint.configs.stylisticTypeCheckedOnly,
    ],
    plugins: { "local-rules": localRulesPlugin },
    rules: {
      // --- Import path enforcement ---
      "local-rules/no-parent-relative-imports": "error",

      // --- Cherry-picked strictTypeChecked rules ---
      // High-value: catches real bugs
      "@typescript-eslint/no-deprecated": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "@typescript-eslint/no-misused-spread": "error",
      "@typescript-eslint/no-mixed-enums": "error",
      "@typescript-eslint/use-unknown-in-catch-callback-variable": "error",
      "no-return-await": "off",
      "@typescript-eslint/return-await": [
        "error",
        "error-handling-correctness-only",
      ],
      "@typescript-eslint/no-unnecessary-type-conversion": "error",
      // Medium-value: enforces good patterns
      "@typescript-eslint/no-confusing-void-expression": [
        "error",
        { ignoreArrowShorthand: true },
      ],
      "@typescript-eslint/no-invalid-void-type": [
        "error",
        { allowInGenericTypeArguments: true },
      ],
      "@typescript-eslint/no-non-null-asserted-nullish-coalescing": "error",
      "@typescript-eslint/prefer-literal-enum-member": "error",
      "@typescript-eslint/related-getter-setter-pairs": "error",
      "@typescript-eslint/no-dynamic-delete": "error",
      "@typescript-eslint/no-extraneous-class": "error",
      // Low-value but zero-cost
      "@typescript-eslint/no-unnecessary-boolean-literal-compare": "error",
      "@typescript-eslint/no-unnecessary-template-expression": "error",
      "@typescript-eslint/no-unnecessary-type-arguments": "error",
      "@typescript-eslint/no-meaningless-void-operator": "error",
      "no-useless-constructor": "off",
      "@typescript-eslint/no-useless-constructor": "error",
      "@typescript-eslint/no-useless-default-assignment": "error",
      "@typescript-eslint/prefer-reduce-type-parameter": "error",
      "@typescript-eslint/prefer-return-this-type": "error",
      "@typescript-eslint/unified-signatures": "error",
    },
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },

  // ---------------------------------------------------------------------------
  // Test file overrides:
  // - Relax unsafe-any rules to match Biome's relaxation for test mocks
  // - unbound-method: vi.fn() stubs are designed to be passed by reference
  // - require-await: mock implementations are async to satisfy async interfaces
  //   but return synchronously; disabling avoids noise on valid test patterns
  // ---------------------------------------------------------------------------
  {
    files: ["packages/*/test/**/*.ts"],
    rules: {
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/unbound-method": "off",
      "@typescript-eslint/require-await": "off",
    },
  },

  // ---------------------------------------------------------------------------
  // pi-permission-system: enforce the same-directory import convention (#837).
  // Scoped to this package because pi-subagents still carries 80 own-directory
  // alias imports; promoting this into the block above is #877.
  // ---------------------------------------------------------------------------
  {
    files: [
      "packages/pi-permission-system/src/**/*.ts",
      "packages/pi-permission-system/test/**/*.ts",
    ],
    plugins: { "local-rules": localRulesPlugin },
    rules: { "local-rules/no-own-directory-alias-imports": "error" },
  },

  // ---------------------------------------------------------------------------
  // pi-permission-system: forbid interior `process.platform` reads (#510).
  // The host platform is read once at the composition root (`index.ts`) and
  // injected into interior modules (PathNormalizer, rule evaluation, subagent
  // context). Reading `process.platform` anywhere else re-introduces the hidden
  // global-state dependency the PathNormalizer seam removed.
  // ---------------------------------------------------------------------------
  {
    files: ["packages/pi-permission-system/src/**/*.ts"],
    ignores: ["packages/pi-permission-system/src/index.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            'MemberExpression[object.name="process"][property.name="platform"]',
          message:
            "Read process.platform only at the composition root (index.ts); inject the platform (PathNormalizer / rule platform / subagent-context) into interior modules.",
        },
      ],
    },
  },

  // ---------------------------------------------------------------------------
  // pi-permission-system: keep permission-manager string-based (ADR-0002).
  // The manager consumes ResolvedAccessIntent (path-values) and must not import
  // AccessPath — the resolver is the sole matchValues() unwrap site. Collapsing
  // that boundary requires an explicit, reviewed exception, not an unremarked
  // import. See docs/decisions/0002-path-values-string-boundary.md.
  // ---------------------------------------------------------------------------
  {
    files: ["packages/pi-permission-system/src/policy/permission-manager.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/access-intent/access-path",
                "#src/access-intent/access-path",
              ],
              message:
                "permission-manager stays string-based: it consumes ResolvedAccessIntent (path-values) and must not import AccessPath. See docs/decisions/0002-path-values-string-boundary.md.",
            },
          ],
        },
      ],
    },
  },
);
