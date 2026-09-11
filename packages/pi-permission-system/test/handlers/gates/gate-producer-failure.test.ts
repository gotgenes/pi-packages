import { describe, expect, it, vi } from "vitest";

import { ToolCallGatePipeline } from "#src/handlers/gates/tool-call-gate-pipeline";

import {
  makeGateInputs,
  makeGateRunner,
  makeSurfaceDenyingResolver,
  makeTcc,
} from "#test/helpers/gate-fixtures";

/**
 * The 5th gate producer throws.
 *
 * Lives in its own file because the mock is module-scoped and would replace
 * the real bash path gate for every other pipeline test.
 */
vi.mock("#src/handlers/gates/bash-path", () => ({
  describeBashPathGate: () => {
    throw new Error("gate producer exploded");
  },
}));

describe("ToolCallGatePipeline — a gate producer throws", () => {
  it("propagates the throw to the fail-closed boundary even when an earlier gate denies", async () => {
    // Before deny pre-emption the pipeline produced gates lazily and stopped
    // at the first block, so a throw in a *later* producer was unreachable on
    // this call. The eager pass reaches it, and it must still surface to
    // `createFailClosedToolCall` — which blocks — rather than be swallowed
    // into an allow (#452, #899).
    // `path_read` is producer 2's surface for a read tool, ahead of the
    // throwing producer 5: under the old lazy loop its block returned before
    // producer 5 was ever built.
    const resolver = makeSurfaceDenyingResolver("path_read");
    const { runner } = makeGateRunner();
    const pipeline = new ToolCallGatePipeline(resolver, makeGateInputs());

    await expect(
      pipeline.evaluate(
        makeTcc({ toolName: "read", input: { path: "notes.txt" } }),
        runner,
      ),
    ).rejects.toThrow("gate producer exploded");
  });
});
