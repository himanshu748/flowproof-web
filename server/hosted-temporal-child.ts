import {
  executeHostedTemporalEvidenceAgent,
  hostedTemporalProgress,
  stopHostedTemporalRuntime,
} from "./hosted-temporal-runtime.js";
import type { EvidenceAgentDependencies } from "./evidence-agent.js";
const pending = new Map<
  string,
  { resolve: (value: any) => void; reject: (error: Error) => void }
>();
let sequence = 0,
  started = false;
function invoke(operation: string, input: unknown): Promise<any> {
  const id = String(++sequence);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    process.send?.({ type: "provider", id, operation, input });
  });
}
process.on("message", async (message: any) => {
  if (message?.type === "provider-result") {
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.value);
    else request.reject(new Error("The reserved provider callback failed."));
    return;
  }
  if (message?.type !== "run" || started) return;
  started = true;
  const workflowId = `briefstamp-hosted-agent-${message.control.reservationId}`;
  const progress = setInterval(() => {
    const value = hostedTemporalProgress(workflowId);
    if (value) process.send?.({ type: "progress", value });
  }, 300);
  const deps: EvidenceAgentDependencies = {
    maxModelRequests: 2,
    searchTimeoutMs: message.searchTimeoutMs,
    generate: (request) => invoke("generate", request),
    failureHistory: (queryId) => invoke("failureHistory", queryId),
    searchVisibility: () => invoke("searchVisibility", null),
  };
  try {
    const receipt = await executeHostedTemporalEvidenceAgent(
      message.input,
      deps,
      message.control,
    );
    process.send?.({ type: "result", ok: true, receipt });
  } catch (error) {
    process.send?.({
      type: "result",
      ok: false,
      receipt: (error as any)?.receipt,
    });
  } finally {
    clearInterval(progress);
    await stopHostedTemporalRuntime();
    process.disconnect?.();
  }
});
process.on("disconnect", () => {
  void stopHostedTemporalRuntime().finally(() => process.exit());
});

process.once("SIGTERM", () => {
  void stopHostedTemporalRuntime().finally(() => process.exit());
});
