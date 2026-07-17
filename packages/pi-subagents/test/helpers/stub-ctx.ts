/**
 * Stub ExtensionContext for tool.execute() calls in tests.
 *
 * The tool implementations receive ctx from the Pi framework but access
 * injected deps instead — ctx is never inspected. This typed stub avoids
 * 'as any' while documenting the intent.
 */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { ParentSnapshot } from "#src/lifecycle/parent-snapshot";

export const STUB_CTX = {} as unknown as ExtensionContext;

export const STUB_SNAPSHOT: ParentSnapshot = {
  cwd: "/test",
  systemPrompt: "test prompt",
  model: undefined,
  modelRegistry: { find: () => undefined },
  activeTools: [],
};
