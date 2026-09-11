/**
 * Which spelling of "the model must call one of the supplied tools" each
 * provider API accepts.
 *
 * Two vendor vocabularies express one intent: Anthropic, Google, Bedrock, and
 * Mistral say `"any"`; the OpenAI-family APIs say `"required"`. `pi-ai` does not
 * translate between them and declines to (earendil-works/pi#5154), and the
 * generic `ToolChoice` type it exports (`"auto" | "none"`) governs
 * `streamSimple`, not `complete` — each API module declares its own accepted
 * values, and those declarations are the contract read here.
 *
 * Sending the wrong spelling does not fail loudly. `openai-completions` forwards
 * it verbatim, the endpoint discards it, the request degrades to `"auto"`, and
 * the model answers in prose — which is how a forced verdict tool call came to
 * be silently unforced on every OpenAI-compatible provider (#905).
 */

/** The two spellings of "the model must call one of the supplied tools". */
export type ForcedToolChoice = "any" | "required";

/**
 * The spelling for an API this map does not name.
 *
 * `pi-ai`'s `Api` is `KnownApi | (string & {})`, so a custom-registered provider
 * can carry anything; such a provider is near-always OpenAI-compatible. A
 * provider that rejects `"required"` fails the call, which the reviewer records
 * as a `call-failed` defer — never as an approval.
 */
const DEFAULT_FORCED_TOOL_CHOICE: ForcedToolChoice = "required";

/**
 * Keyed on `Model.api`. Deliberately `Record<string, …>` rather than
 * `Record<KnownApi, …>`: a `KnownApi` key set would turn every `pi-ai` release
 * that adds an API into a build break instead of a graceful default, and the
 * supported floor's `KnownApi` does not yet contain `pi-messages`.
 */
const FORCED_TOOL_CHOICE_BY_API: Record<string, ForcedToolChoice | undefined> =
  {
    "anthropic-messages": "any",
    "bedrock-converse-stream": "any",
    "google-generative-ai": "any",
    "google-vertex": "any",
    "mistral-conversations": "any",
    "openai-completions": "required",
    "openai-responses": "required",
    "azure-openai-responses": "required",
    "openai-codex-responses": "required",
    "pi-messages": "required",
  };

/** The forcing value to send a model on `api`. */
export function resolveToolChoice(api: string | undefined): ForcedToolChoice {
  if (api === undefined) {
    return DEFAULT_FORCED_TOOL_CHOICE;
  }
  return FORCED_TOOL_CHOICE_BY_API[api] ?? DEFAULT_FORCED_TOOL_CHOICE;
}
