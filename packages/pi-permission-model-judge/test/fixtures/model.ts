import type { Model } from "@earendil-works/pi-ai";

/**
 * The judge model a test resolves from the registry.
 *
 * The cast is deliberate: a real `Model` carries pricing, context-window, and
 * capability fields that `reviewPath` never reads — it forwards the object to
 * the `complete` seam and reads only `api`.
 *
 * `api` decides which spelling of the forced tool choice goes on the wire, so
 * override it to exercise a provider family other than Anthropic.
 */
export function makeModel(overrides: Partial<Model<any>> = {}): Model<any> {
  return {
    provider: "anthropic",
    id: "claude-haiku",
    api: "anthropic-messages",
    ...overrides,
  } as Model<any>;
}
