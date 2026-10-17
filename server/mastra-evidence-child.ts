import { executeMastraEvidenceRuntime } from "./mastra-evidence-runtime.js";
import {
  EvidenceAgentPhaseRequestSchema,
  EvidenceAuditObservationSchema,
  EVIDENCE_AGENT_TASK,
} from "./providers/gemma-evidence-agent.js";
import { z } from "zod";
const inputSchema = z
  .object({
    audit: EvidenceAuditObservationSchema,
    task: z.literal(EVIDENCE_AGENT_TASK),
    modelTransport: z.literal("backboard_openrouter_gemma").optional(),
  })
  .strict();
let sequence = 0;
let started = false;
const waiting = new Map<
  number,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();
const request = (operation: "model" | "tool", payload: unknown): Promise<any> =>
  new Promise((resolve, reject) => {
    const id = ++sequence;
    if (id > 4 || !process.send)
      return reject(new Error("Bounded parent port unavailable"));
    waiting.set(id, { resolve, reject });
    process.send({ type: "request", id, operation, payload });
  });
process.on("message", (message: any) => {
  if (Buffer.byteLength(JSON.stringify(message)) > 128 * 1024) process.exit(1);
  if (message?.type === "start" && !started) {
    started = true;
    const parsed = inputSchema.safeParse(message.input);
    if (!parsed.success) process.exit(1);
    executeMastraEvidenceRuntime(parsed.data, {
      model: async (input) =>
        request("model", EvidenceAgentPhaseRequestSchema.parse(input)),
      tool: async (entry, id) => request("tool", { entry, id }),
    })
      .then((result) =>
        process.send?.({ type: "done", result }, () => process.exit(0)),
      )
      .catch(() => process.send?.({ type: "failed" }, () => process.exit(1)));
  } else if (message?.type === "response" && Number.isInteger(message.id)) {
    const pending = waiting.get(message.id);
    if (!pending) process.exit(1);
    waiting.delete(message.id);
    if (message.ok === true) pending.resolve(message.result);
    else pending.reject(new Error("The bounded parent operation failed"));
  } else process.exit(1);
});
process.on("disconnect", () => process.exit(1));
