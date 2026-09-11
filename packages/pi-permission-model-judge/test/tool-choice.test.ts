import { describe, expect, it } from "vitest";

import { resolveToolChoice } from "#src/tool-choice";

/**
 * One case per `KnownApi` in `@earendil-works/pi-ai`, each row read from that
 * API module's own `toolChoice` declaration rather than from the generic
 * `ToolChoice` type. A row is an external fact, so every row is asserted — none
 * is sampled from its neighbors.
 */
describe("resolveToolChoice", () => {
  describe("the APIs that spell the forced choice 'any'", () => {
    it.each([
      "anthropic-messages",
      "bedrock-converse-stream",
      "google-generative-ai",
      "google-vertex",
      "mistral-conversations",
    ])("sends %s 'any'", (api) => {
      expect(resolveToolChoice(api)).toBe("any");
    });
  });

  describe("the APIs that spell the forced choice 'required'", () => {
    it.each([
      "openai-completions",
      "openai-responses",
      "azure-openai-responses",
      "openai-codex-responses",
      "pi-messages",
    ])("sends %s 'required'", (api) => {
      expect(resolveToolChoice(api)).toBe("required");
    });
  });

  describe("an API the map does not name", () => {
    it("defaults a custom api string to 'required'", () => {
      // `Api` is `KnownApi | (string & {})`, and a custom-registered provider is
      // near-always OpenAI-compatible.
      expect(resolveToolChoice("some-custom-api")).toBe("required");
    });

    it("defaults an absent api to 'required'", () => {
      expect(resolveToolChoice(undefined)).toBe("required");
    });
  });
});
