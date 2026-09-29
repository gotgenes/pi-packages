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
      "Validates the reason (completed or not_planned) and wraps a single gh issue close, which is not retried. " +
      "By default, refuses to close when the comment contains a lowercase word-bounded hex token of 7-40 characters that `git rev-parse --verify <token>^{commit}` cannot resolve in the inherited working directory. " +
      "The check is lexical: punctuation, backticks, and URL delimiters are boundaries, and a token in a code span or URL is still resolved. " +
      "Correct a mistaken SHA; do not set skip_sha_validation to bypass a typo. " +
      "skip_sha_validation publishes the original comment with no Git check and is only for a foreign commit or a non-commit hash you intend to leave unresolved. " +
      "Git runs locally and does not fetch, so a missing object in a shallow checkout is refused. " +
      "A resolved SHA proves neither ancestry on the default branch nor that the token is the change the comment cites.",
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
