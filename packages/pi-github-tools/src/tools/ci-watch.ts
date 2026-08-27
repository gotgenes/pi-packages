import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { watchRun } from "#src/lib/ci";
import { createProgressCallback } from "#src/progress";
import { err, ok } from "#src/tool-result";

export function registerCiWatch(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ci_watch",
    label: "CI Watch",
    description:
      "Poll a GitHub Actions run by run ID until it completes or times out. " +
      "Emits a compact job-level progress line on each poll cycle (e.g., [2/5] deploy — in_progress (120s)). " +
      "Returns the full progress log and final status on completion.",
    promptSnippet:
      "Poll a CI run until it completes. Streams job-level progress.",
    parameters: Type.Object({
      workflow: Type.String({
        description:
          'Workflow filename without extension (e.g., "ci" for ci.yml).',
      }),
      run_id: Type.Number({
        description:
          "The run ID to poll. Obtain this from ci_find before calling ci_watch.",
      }),
      timeout: Type.Optional(
        Type.Number({
          description:
            "How long to wait for the run to complete, in seconds (default: 300).",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const content = await watchRun({
          workflow: params.workflow,
          runId: params.run_id,
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
