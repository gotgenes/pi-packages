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
      "Validates the reason (completed or not_planned) and wraps gh issue close. " +
      "Refuses to close when a 7-40 character hex token in the comment does not resolve to a commit in the local checkout; correct the SHA rather than setting skip_sha_validation.",
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
      skip_sha_validation: Type.Optional(
        Type.Boolean({
          description:
            "Skip local resolution of lowercase word-bounded 7-40 character hex tokens in the comment. " +
            "Omit or false (the default) to refuse the close when any token does not resolve to a commit. " +
            "Set true only for a foreign commit or a non-commit hash you intend to publish unresolved. " +
            "Correct a typo instead of setting this.",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal) {
      try {
        const content = await closeIssue({
          issueNumber: params.issue_number,
          comment: params.comment,
          reason: params.reason,
          skipShaValidation: params.skip_sha_validation,
          signal,
        });
        return ok(content);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  });
}
