import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  getGlobalConfigPath,
  getProjectConfigPath,
  loadConfig,
} from "#src/lib/config";
import { mergeReleasePR } from "#src/lib/release";
import { createProgressCallback } from "#src/progress";
import { err, ok } from "#src/tool-result";

export function registerReleasePrMerge(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "release_pr_merge",
    label: "Release PR Merge",
    description:
      "Merge a release-please PR after confirming it is clean. " +
      "Checks MERGEABLE + CLEAN status, merges, and runs git pull --ff-only. " +
      "Waits out an in-progress check or an undecided mergeability state, streaming progress, " +
      "up to the timeout, and retries transient GitHub failures. " +
      "If the merge call itself fails, re-reads the PR over REST and reports whether it " +
      "merged, did not merge (safe to retry), or could not be verified. " +
      "Returns merge confirmation with new HEAD SHA, or a structured error if not mergeable.",
    promptSnippet:
      "Merge a release-please PR after confirming it's clean, " +
      "waiting out any in-progress checks and verifying the outcome of a failed merge call.",
    parameters: Type.Object({
      pr_number: Type.Number({
        description: "The PR number to merge.",
      }),
      method: Type.Optional(
        Type.Union(
          [
            Type.Literal("rebase"),
            Type.Literal("squash"),
            Type.Literal("merge"),
          ],
          {
            description:
              'Merge strategy: "rebase", "squash", or "merge". Falls back to config, then gh default.',
          },
        ),
      ),
      timeout: Type.Optional(
        Type.Number({
          description:
            "How long to wait for an in-progress check or undecided mergeability " +
            "to resolve, in seconds (default: 300).",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const config = loadConfig({
          globalConfigPath: getGlobalConfigPath(
            join(homedir(), ".pi", "agent"),
          ),
          projectConfigPath: getProjectConfigPath(process.cwd()),
        });
        const result = await mergeReleasePR({
          prNumber: params.pr_number,
          method: params.method ?? config.defaultMergeMethod,
          timeout: params.timeout,
          onProgress: createProgressCallback(onUpdate),
          signal,
        });
        return result.isError ? err(result.content) : ok(result.content);
      } catch (e) {
        return err(e instanceof Error ? e.message : String(e));
      }
    },
  });
}
