import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { findReleasePR } from "#src/lib/release";
import { createProgressCallback } from "#src/progress";
import { err, ok } from "#src/tool-result";

export function registerReleasePrFind(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "release_pr_find",
    label: "Release PR Find",
    description:
      "Find the release-please PR after a push to main. " +
      "Polls until an open release-please PR appears or the timeout expires (default: 120 s). " +
      "Returns PR number, title, head branch, mergeable status, and URL.",
    promptSnippet: "Find the release-please PR after pushing to main.",
    parameters: Type.Object({
      timeout: Type.Optional(
        Type.Number({
          description:
            "How long to wait for the PR to appear, in seconds (default: 120).",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const content = await findReleasePR({
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
