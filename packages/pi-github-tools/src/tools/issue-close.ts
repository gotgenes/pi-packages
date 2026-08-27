import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { closeIssue } from "#src/lib/issue";
import { err, ok } from "#src/tool-result";

export function registerIssueClose(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "issue_close",
    label: "Issue Close",
    description:
      "Close a GitHub issue with an optional comment. " +
      "Validates the reason (completed or not_planned) and wraps gh issue close.",
    promptSnippet: "Close a GitHub issue with an optional comment.",
    parameters: Type.Object({
      issue_number: Type.Number({
        description: "The issue number to close.",
      }),
      comment: Type.Optional(
        Type.String({
          description: "Optional comment to add when closing the issue.",
        }),
      ),
      reason: Type.Optional(
        Type.String({
          description: 'Close reason: "completed" (default) or "not_planned".',
        }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      try {
        const content = await closeIssue({
          issueNumber: params.issue_number,
          comment: params.comment,
          reason: params.reason,
          signal,
        });
        return ok(content);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  });
}
