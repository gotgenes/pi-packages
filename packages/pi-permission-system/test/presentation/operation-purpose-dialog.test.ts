import { describe, expect, test } from "vitest";
import {
  completeViewBudget,
  renderPromptDialog,
} from "#src/presentation/dialog-renderer";
import { asPromptPayload } from "#src/presentation/prompt-payload";
import { makePromptPayload } from "#test/helpers/prompt-details-fixtures";

describe("operation purpose in approval dialogs", () => {
  test("renders the purpose while preserving the request facts", () => {
    const payload = makePromptPayload({
      annotations: [
        {
          source: "operation-purpose",
          text: "Inspect the build configuration.",
        },
      ],
    });
    const lines = renderPromptDialog(payload, completeViewBudget(200)).lines;
    expect(lines.at(-1)?.trim()).toBe(
      "purpose : Inspect the build configuration.",
    );
    expect(asPromptPayload(structuredClone(payload))).toStrictEqual(payload);
  });

  test("keeps unrelated annotations out of the operation-purpose line", () => {
    const baseline = makePromptPayload();
    const payload = {
      ...baseline,
      annotations: [{ source: "another-annotator", text: "Unrelated." }],
    };
    expect(renderPromptDialog(payload, completeViewBudget(200))).toStrictEqual(
      renderPromptDialog(baseline, completeViewBudget(200)),
    );
  });
});
