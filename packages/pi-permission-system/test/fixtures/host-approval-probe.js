import { appendFileSync } from "node:fs";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  Type,
} from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";

export default function permissionProbe(pi) {
  const trace = process.env.PI_PERMISSION_TEST_TRACE;
  if (!trace) throw new Error("Missing PI_PERMISSION_TEST_TRACE");

  const record = (event, data = {}) => {
    appendFileSync(trace, `${JSON.stringify({ event, ...data })}\n`);
  };
  const faux = fauxProvider();
  pi.registerProvider(faux.provider);
  pi.on("session_start", async (_event, ctx) => {
    // Select after binding the registered provider, including after /new.
    if (!(await pi.setModel(faux.getModel()))) {
      throw new Error("Offline probe model could not be selected");
    }
    record("ready", {
      sessionId: ctx.sessionManager.getSessionId(),
      mode: ctx.mode,
    });
  });
  pi.on("before_agent_start", () => {
    faux.setResponses([
      fauxAssistantMessage(fauxToolCall("permission_probe", {}), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("probe turn complete"),
    ]);
  });
  pi.on("agent_end", () => record("turn_end"));
  for (const channel of ["permissions:ui_prompt", "permissions:decision"]) {
    pi.events.on(channel, (data) => record(channel, data));
  }
  pi.registerTool(
    defineTool({
      name: "permission_probe",
      label: "Permission probe",
      description: "Record execution of the approval test tool",
      parameters: Type.Object({}),
      execute(_id, _params, _signal, _onUpdate, ctx) {
        record("executed", { sessionId: ctx.sessionManager.getSessionId() });
        return Promise.resolve({
          content: [{ type: "text", text: "probe executed" }],
          details: {},
        });
      },
    }),
  );
}
