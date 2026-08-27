import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { listRuns } from "#src/lib/ci";
import { err, ok } from "#src/tool-result";

export function registerCiList(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "ci_list",
    label: "CI List",
    description:
      "Return recent GitHub Actions runs for a workflow, for diagnostics and browsing. " +
      "Returns status, name, sha, runId, and url for each run.",
    promptSnippet: "List recent CI runs for a workflow.",
    parameters: Type.Object({
      workflow: Type.String({
        description:
          'Workflow filename without extension (e.g., "ci" for ci.yml).',
      }),
      limit: Type.Optional(
        Type.Number({
          description: "Number of recent runs to return (default: 5).",
        }),
      ),
    }),
    async execute(_toolCallId, params) {
      try {
        const content = await listRuns({
          workflow: params.workflow,
          limit: params.limit,
        });
        return ok(content);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  });
}
