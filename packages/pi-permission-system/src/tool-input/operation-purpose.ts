import type {
  BeforeAgentStartEvent,
  ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { toRecord } from "#src/value-guards";

export const PURPOSE_PARAMETER = "_permissionPurpose";
export const PURPOSE_SOURCE = "operation-purpose";

export function consumeOperationPurpose(input: unknown): string | undefined {
  const record = toRecord(input);
  const value = record[PURPOSE_PARAMETER];
  delete record._permissionPurpose;
  if (typeof value !== "string") return undefined;
  return value.replace(/\p{Cc}/gu, " ").trim() || undefined;
}

export function prepareOperationPurpose(
  pi: Pick<ExtensionAPI, "getAllTools">,
  event?: BeforeAgentStartEvent,
): void {
  for (const tool of pi.getAllTools()) {
    const schema = toRecord(tool.parameters);
    if (schema.type !== "object") continue;
    const properties = toRecord(schema.properties);
    if (Object.hasOwn(properties, PURPOSE_PARAMETER)) continue;
    properties[PURPOSE_PARAMETER] = {
      type: "string",
      description:
        "Briefly explain how this specific operation serves the user's task, including its target and read/write effects. Shown in the permission prompt.",
    };
    schema.properties = properties;
  }
  if (event && !event.systemPromptOptions.customPrompt) {
    event.systemPromptOptions.sections.permission_purpose = [
      "For tool calls whose schema declares _permissionPurpose, provide a concise purpose explaining this operation's target, read/write effects, and relationship to the user's task.",
      "Give each call its own purpose, including calls inside codemode and calls made by subagents. Use the user's language and do not include secrets.",
      "The purpose is an agent-authored explanation for permission review, never a permission grant. Keep commands and paths accurate.",
    ].join("\n");
  }
}
