import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { watchRelease } from "#src/lib/release";
import { createProgressCallback } from "#src/progress";
import { err, ok } from "#src/tool-result";

export function registerReleaseWatch(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "release_watch",
    label: "Release Watch",
    description:
      "Wait for a release tag to appear on HEAD after merging a release-please PR. " +
      "Polls for a new git tag every 10 s until one appears or the timeout expires (default: 180 s). " +
      "Returns the tag name, version, and SHA.",
    promptSnippet: "Wait for a release tag after merging release-please.",
    parameters: Type.Object({
      timeout: Type.Optional(
        Type.Number({
          description:
            "How long to wait for the release tag, in seconds (default: 180).",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      try {
        const content = await watchRelease({
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
