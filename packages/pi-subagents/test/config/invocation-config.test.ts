import { describe, expect, it } from "vitest";
import { resolveAgentInvocationConfig } from "#src/config/invocation-config";
import type { AgentConfig } from "#src/types";

function makeConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    name: "Explore",
    description: "Explore",
    toolNames: ["read"],
    systemPrompt: "Test agent",
    promptMode: "replace",
    inheritContext: false,
    runInBackground: false,
    ...overrides,
  };
}

/** An agent file declaring a value for every lockable field. */
function makeOpinionatedConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return makeConfig({
    model: "provider/config-model",
    thinking: "high",
    maxTurns: 42,
    inheritContext: false,
    runInBackground: false,
    ...overrides,
  });
}

/** A tool call overriding every lockable field. */
const overridingParams = {
  model: "provider/param-model",
  thinking: "minimal",
  max_turns: 1,
  inherit_context: true,
  run_in_background: true,
} as const;

describe("resolveAgentInvocationConfig", () => {
  describe("with no lock declared", () => {
    it("prefers the caller's parameters over the agent's frontmatter", () => {
      const resolved = resolveAgentInvocationConfig(makeOpinionatedConfig(), overridingParams);

      expect(resolved.modelInput).toBe("provider/param-model");
      expect(resolved.thinking).toBe("minimal");
      expect(resolved.maxTurns).toBe(1);
      expect(resolved.inheritContext).toBe(true);
      expect(resolved.runInBackground).toBe(true);
    });

    it("falls back to the agent's frontmatter for parameters the caller omits", () => {
      const resolved = resolveAgentInvocationConfig(makeOpinionatedConfig(), {});

      expect(resolved.modelInput).toBe("provider/config-model");
      expect(resolved.thinking).toBe("high");
      expect(resolved.maxTurns).toBe(42);
      expect(resolved.inheritContext).toBe(false);
      expect(resolved.runInBackground).toBe(false);
    });

    it("lets the caller fill booleans the agent leaves undefined", () => {
      const resolved = resolveAgentInvocationConfig(
        makeConfig({ inheritContext: undefined, runInBackground: undefined }),
        { inherit_context: true, run_in_background: true },
      );

      expect(resolved.inheritContext).toBe(true);
      expect(resolved.runInBackground).toBe(true);
    });

    it("defaults booleans to false when neither side sets them", () => {
      const resolved = resolveAgentInvocationConfig(
        makeConfig({ inheritContext: undefined, runInBackground: undefined }),
        {},
      );

      expect(resolved.inheritContext).toBe(false);
      expect(resolved.runInBackground).toBe(false);
    });
  });

  /**
   * A `??`-based merge treats a caller's `0` or `false` as "nothing passed" and
   * silently keeps the agent's value. `resolveField` tests presence with `!== undefined`
   * for that reason, and these pin it — `max_turns: 0` means unlimited, so the two
   * readings differ in effect, not just in provenance.
   */
  describe("with a falsy value on either side", () => {
    it("lets the caller turn an agent's turn limit off", () => {
      const resolved = resolveAgentInvocationConfig(makeOpinionatedConfig(), { max_turns: 0 });

      expect(resolved.maxTurns).toBe(0);
    });

    it("keeps an agent's turn limit of zero when the caller passes none", () => {
      const resolved = resolveAgentInvocationConfig(makeConfig({ maxTurns: 0 }), {});

      expect(resolved.maxTurns).toBe(0);
    });

    it("lets the caller switch off booleans the agent turned on", () => {
      const resolved = resolveAgentInvocationConfig(
        makeConfig({ inheritContext: true, runInBackground: true }),
        { inherit_context: false, run_in_background: false },
      );

      expect(resolved.inheritContext).toBe(false);
      expect(resolved.runInBackground).toBe(false);
    });

    it("lets the caller clear an agent's model with an empty string", () => {
      const resolved = resolveAgentInvocationConfig(makeOpinionatedConfig(), { model: "" });

      expect(resolved.modelInput).toBe("");
      expect(resolved.modelFromParams).toBe(true);
    });

    it("reports a discarded falsy override rather than reading it as absent", () => {
      const resolved = resolveAgentInvocationConfig(
        makeConfig({ locked: true, maxTurns: 42, runInBackground: true }),
        { max_turns: 0, run_in_background: false },
      );

      expect(resolved.maxTurns).toBe(42);
      expect(resolved.runInBackground).toBe(true);
      expect(resolved.discarded).toEqual(["max_turns", "run_in_background"]);
    });
  });

  describe("with `locked: true`", () => {
    it("holds every field the agent file sets", () => {
      const resolved = resolveAgentInvocationConfig(
        makeOpinionatedConfig({ locked: true }),
        overridingParams,
      );

      expect(resolved.modelInput).toBe("provider/config-model");
      expect(resolved.thinking).toBe("high");
      expect(resolved.maxTurns).toBe(42);
      expect(resolved.inheritContext).toBe(false);
      expect(resolved.runInBackground).toBe(false);
    });

    it("leaves a field the agent file does not set open to the caller", () => {
      const resolved = resolveAgentInvocationConfig(
        makeConfig({ locked: true, model: undefined, thinking: undefined }),
        overridingParams,
      );

      expect(resolved.modelInput).toBe("provider/param-model");
      expect(resolved.thinking).toBe("minimal");
    });
  });

  describe("with a field list", () => {
    it("holds only the fields it names", () => {
      const resolved = resolveAgentInvocationConfig(
        makeOpinionatedConfig({ locked: ["model", "max_turns"] }),
        overridingParams,
      );

      expect(resolved.modelInput).toBe("provider/config-model");
      expect(resolved.maxTurns).toBe(42);
      expect(resolved.thinking).toBe("minimal");
      expect(resolved.inheritContext).toBe(true);
      expect(resolved.runInBackground).toBe(true);
    });

    it("denies the caller a field the agent file never sets", () => {
      const resolved = resolveAgentInvocationConfig(
        makeConfig({ locked: ["model", "thinking"], model: undefined, thinking: undefined }),
        overridingParams,
      );

      expect(resolved.modelInput).toBeUndefined();
      expect(resolved.thinking).toBeUndefined();
    });

    it("defaults a locked boolean the agent file never sets to false", () => {
      const resolved = resolveAgentInvocationConfig(
        makeConfig({
          locked: ["inherit_context", "run_in_background"],
          inheritContext: undefined,
          runInBackground: undefined,
        }),
        overridingParams,
      );

      expect(resolved.inheritContext).toBe(false);
      expect(resolved.runInBackground).toBe(false);
    });
  });

  describe("discarded", () => {
    it("is empty when no lock is declared", () => {
      const resolved = resolveAgentInvocationConfig(makeOpinionatedConfig(), overridingParams);

      expect(resolved.discarded).toEqual([]);
    });

    it("is empty when the caller passed nothing to discard", () => {
      const resolved = resolveAgentInvocationConfig(makeOpinionatedConfig({ locked: true }), {});

      expect(resolved.discarded).toEqual([]);
    });

    it("lists every locked field the caller tried to override", () => {
      const resolved = resolveAgentInvocationConfig(
        makeOpinionatedConfig({ locked: true }),
        overridingParams,
      );

      expect(resolved.discarded).toEqual([
        "model",
        "thinking",
        "max_turns",
        "inherit_context",
        "run_in_background",
      ]);
    });

    it("lists only the fields the lock names", () => {
      const resolved = resolveAgentInvocationConfig(
        makeOpinionatedConfig({ locked: ["model", "max_turns"] }),
        overridingParams,
      );

      expect(resolved.discarded).toEqual(["model", "max_turns"]);
    });

    it("lists a bare lock the caller tried to fill", () => {
      const resolved = resolveAgentInvocationConfig(
        makeConfig({ locked: ["model"], model: undefined }),
        overridingParams,
      );

      expect(resolved.discarded).toEqual(["model"]);
    });

    it("omits a field whose caller value matched the agent's own", () => {
      const resolved = resolveAgentInvocationConfig(
        makeOpinionatedConfig({ locked: true }),
        { ...overridingParams, model: "provider/config-model" },
      );

      expect(resolved.discarded).not.toContain("model");
      expect(resolved.discarded).toContain("thinking");
    });
  });

  /**
   * `modelFromParams` decides whether an unresolvable model string surfaces as an
   * error or falls back to the parent model silently. The caller is present to read
   * an error; an agent file's author is not, so it tracks which side won.
   */
  describe("modelFromParams", () => {
    it("is true when the caller's model won", () => {
      const resolved = resolveAgentInvocationConfig(makeOpinionatedConfig(), overridingParams);

      expect(resolved.modelFromParams).toBe(true);
    });

    it("is false when the caller passed no model", () => {
      const resolved = resolveAgentInvocationConfig(makeOpinionatedConfig(), {});

      expect(resolved.modelFromParams).toBe(false);
    });

    it("is false when a lock discarded the caller's model", () => {
      const resolved = resolveAgentInvocationConfig(
        makeOpinionatedConfig({ locked: ["model"] }),
        overridingParams,
      );

      expect(resolved.modelFromParams).toBe(false);
    });

    it("is false when neither side named a model", () => {
      const resolved = resolveAgentInvocationConfig(makeConfig(), {});

      expect(resolved.modelFromParams).toBe(false);
    });
  });
});
