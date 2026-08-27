import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findRun } from "#src/lib/ci";
import { createProgressCallback } from "#src/progress";
import { err, ok } from "#src/tool-result";

export function registerCiFind(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ci_find",
    label: "CI Find",
    description:
      "Wait for a GitHub Actions run matching a specific commit SHA to appear, then return its run ID and job list. " +
      "Uses exponential backoff (5 s base, 30 s cap) until the run appears or the timeout expires (default: 120 s). " +
      "Returns run_id, url, status, sha, title, and jobs on success. " +
      "Returns a structured timeout message (not an error) if the run does not appear within the timeout.",
    promptSnippet:
      "Wait for a CI run matching a pushed SHA. Returns run ID and jobs.",
    parameters: Type.Object({
      workflow: Type.String({
        description:
          'Workflow filename without extension (e.g., "ci" for ci.yml).',
      }),
      expected_sha: Type.String({
        description:
          "The full 40-char SHA of the commit whose run you are waiting for.",
      }),
      timeout: Type.Optional(
        Type.Number({
          description:
            "How long to wait for the run to appear, in seconds (default: 120).",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const content = await findRun({
          workflow: params.workflow,
          expectedSha: params.expected_sha,
          timeout: params.timeout,
          signal,
          onProgress: createProgressCallback(onUpdate),
        });
        return ok(content);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  });
}
