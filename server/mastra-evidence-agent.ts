import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { Audit } from "../shared/types.js";
import {
  EvidenceAgentError,
  validatedAudit,
  validateCitations,
  normalizeFailureHistory,
  normalizeSearchVisibility,
  evidenceModelTraceAttributes,
  type EvidenceAgentDependencies,
  type EvidenceAgentReceipt,
} from "./evidence-agent.js";
import {
  EVIDENCE_AGENT_TASK,
  EvidenceAgentPhaseRequestSchema,
  EvidenceAgentFindingsSchema,
  EvidenceToolSelectionSchema,
  EvidenceToolObservationSchema,
  GemmaEvidenceProviderError,
  generateGemmaEvidenceTurn,
} from "./providers/gemma-evidence-agent.js";
import { GOOGLE_GEMMA_MODEL } from "./providers/gemma-google.js";
import {
  BackboardGemmaEvidenceError,
  type BackboardGemmaEvidenceTurn,
} from "./providers/backboard-gemma-evidence.js";
import type { EvidenceAgentPhaseRequest } from "./providers/gemma-evidence-agent.js";
import type { MastraModelTurn } from "./mastra-evidence-runtime.js";
const requestSchema = z
  .object({
    type: z.literal("request"),
    id: z.number().int().min(1).max(4),
    operation: z.enum(["model", "tool"]),
    payload: z.unknown(),
  })
  .strict();
const childPath = fileURLToPath(
  new URL("../dist-agent-worker/mastra-evidence-child.js", import.meta.url),
);
/** No credentials, proxies, loaders or TLS overrides enter the isolated SDK process. */
export function mastraChildEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    MASTRA_TELEMETRY_DISABLED: "1",
    NO_COLOR: "1",
  };
  for (const key of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TZ",
    "SYSTEMROOT",
    "WINDIR",
  ])
    if (env[key] !== undefined) result[key] = env[key];
  return result;
}
export type MastraEvidenceReceipt = EvidenceAgentReceipt & {
  orchestration?: Record<string, unknown>;
  backboardModelTurns?: Array<{
    phase: "select_tools" | "summarize";
    result?: BackboardGemmaEvidenceTurn;
    failedAttempts?: BackboardGemmaEvidenceError["attempts"];
  }>;
};
/** The caller must durably reserve this run before invoking either engine. No automatic native fallback or retry. */
export async function executeMastraEvidenceAgent(
  input: { audit: Audit; task: string },
  deps: EvidenceAgentDependencies & {
    backboardGenerate?: (
      request: EvidenceAgentPhaseRequest,
      signal: AbortSignal,
    ) => Promise<BackboardGemmaEvidenceTurn>;
    reserveExternal?: (
      operation:
        | "select_tools"
        | "summarize"
        | "failure_history"
        | "search_visibility",
    ) => Promise<void>;
  },
): Promise<MastraEvidenceReceipt> {
  const now = deps.now ?? Date.now;
  const source = JSON.stringify(input.audit);
  const receipt: MastraEvidenceReceipt = {
    version: 1,
    status: "running",
    transport: deps.backboardGenerate
      ? "backboard_openrouter_gemma"
      : deps.generate
        ? "injected_offline"
        : "native_google_gemma",
    model: GOOGLE_GEMMA_MODEL,
    startedAt: new Date(now()).toISOString(),
    task: EVIDENCE_AGENT_TASK,
    sourceAuditId: input.audit.id,
    modelTurns: [],
    toolCalls: [],
    observations: [],
    sourceAuditUnchanged: true,
    limits: {
      maximumModelCalls: 2,
      maximumLogicalModelTurns: 2,
      maximumToolCalls: 2,
      modelRetries: 0,
      toolRetries: 0,
      refundPerformed: false,
      maximumDurationMs: 90_000,
      maximumSearchDurationMs: deps.searchTimeoutMs ?? 60_000,
    },
    scope:
      "A real isolated Mastra Agent owns the tool loop. Gemma native text JSON is bridged to AI SDK tool calls; this is not provider-native function calling. Actual observations cannot change browser acceptance.",
  };
  if (deps.backboardGenerate) {
    receipt.backboardModelTurns = [];
    receipt.scope =
      "A real isolated Mastra Agent owns the tool loop over Backboard/OpenRouter Gemma. Actual Backboard model turns and tokens are in backboardModelTurns, not native-Google modelTurns. Memory is off. This is a validated text-JSON bridge, not provider-native function calling. Browser acceptance is unchanged.";
  }
  const controller = new AbortController();
  const within = async <T>(
    fn: (signal: AbortSignal) => Promise<T>,
    ms: number,
  ): Promise<T> => {
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(ms),
    ]);
    signal.throwIfAborted();
    let abort = () => {};
    const stopped = new Promise<never>((_, reject) => {
      abort = () => reject(new Error("tool_timeout"));
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([fn(signal), stopped]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
  try {
    if (
      input.task !== EVIDENCE_AGENT_TASK ||
      (deps.backboardGenerate && deps.generate) ||
      (deps.maxModelRequests !== undefined && deps.maxModelRequests !== 2)
    )
      throw new Error("invalid_mastra_scope");
    const audit = validatedAudit(input.audit);
    receipt.auditObservation = audit;
    const calls = new Set<string>();
    const model = async (payload: unknown) => {
      const req = EvidenceAgentPhaseRequestSchema.parse(payload);
      const expectedPhase =
        (receipt.backboardModelTurns ?? receipt.modelTurns).length === 0
          ? "select_tools"
          : "summarize";
      if (
        (receipt.backboardModelTurns ?? receipt.modelTurns).length >= 2 ||
        req.phase !== expectedPhase ||
        !isDeepStrictEqual(req.audit, audit)
      )
        throw new Error("model_call_limit");
      if (
        req.phase === "summarize" &&
        (!isDeepStrictEqual(req.selection, receipt.selection) ||
          !isDeepStrictEqual(req.observations, receipt.observations))
      )
        throw new Error("altered_observations");
      const record: EvidenceAgentReceipt["modelTurns"][number] = {
        phase: req.phase,
      };
      const backboardRecord: NonNullable<
        MastraEvidenceReceipt["backboardModelTurns"]
      >[number] = { phase: req.phase };
      if (deps.backboardGenerate)
        receipt.backboardModelTurns!.push(backboardRecord);
      else receipt.modelTurns.push(record);
      try {
        await deps.reserveExternal?.(req.phase);
        const provider = deps.backboardGenerate ? "Backboard" : "Google";
        const attributes = evidenceModelTraceAttributes(provider, []);
        const invoke = async () => {
          try {
            const result = await within<MastraModelTurn>(
              async (signal) => {
                deps.beforeModel?.();
                return deps.backboardGenerate
                  ? deps.backboardGenerate(req, signal)
                  : deps.generate
                    ? deps.generate(req)
                    : generateGemmaEvidenceTurn(req, {
                        env: deps.env,
                        now: deps.now,
                        signal,
                        beforeRequest: deps.beforeModel,
                        maxAttempts: 1,
                      });
              },
              deps.backboardGenerate ? 30_000 : 20_000,
            );
            Object.assign(
              attributes,
              evidenceModelTraceAttributes(provider, result.attempts),
            );
            return result;
          } catch (error) {
            if (
              error instanceof GemmaEvidenceProviderError ||
              error instanceof BackboardGemmaEvidenceError
            )
              Object.assign(
                attributes,
                evidenceModelTraceAttributes(provider, error.attempts),
              );
            throw error;
          }
        };
        const result = deps.trace
          ? await deps.trace.span(
              `briefstamp.agent.model.${req.phase}`,
              invoke,
              attributes,
            )
          : await invoke();
        if (
          result.model !==
            (deps.backboardGenerate
              ? "google/gemma-4-26b-a4b-it"
              : GOOGLE_GEMMA_MODEL) ||
          result.attempts.length > 1 ||
          (!deps.generate &&
            (result.attempts.length !== 1 || result.attempts[0].status !== 200))
        )
          throw new Error("invalid_model_transport_receipt");
        if ("transport" in result)
          backboardRecord.result = structuredClone(result);
        else record.result = structuredClone(result);
        if (req.phase === "select_tools")
          receipt.selection = EvidenceToolSelectionSchema.parse(result.output);
        else {
          const output = EvidenceAgentFindingsSchema.parse(result.output);
          validateCitations(output, audit, receipt.observations);
          receipt.modelOutput = output;
        }
        return result;
      } catch (error) {
        if (error instanceof GemmaEvidenceProviderError) {
          record.failedAttempts = structuredClone(error.attempts);
          if (error.diagnostic)
            record.failureDiagnostic = structuredClone(error.diagnostic);
        }
        if (error instanceof BackboardGemmaEvidenceError)
          backboardRecord.failedAttempts = structuredClone(error.attempts);
        throw error;
      }
    };
    const tool = async (payload: unknown) => {
      const parsed = z
        .object({ entry: z.unknown(), id: z.enum(["tool-1", "tool-2"]) })
        .strict()
        .parse(payload);
      const selected = receipt.selection?.tools.findIndex((t) =>
        isDeepStrictEqual(t, parsed.entry),
      );
      if (
        selected === undefined ||
        selected < 0 ||
        parsed.id !== `tool-${selected + 1}` ||
        calls.has(parsed.id) ||
        (receipt.backboardModelTurns ?? receipt.modelTurns).length !== 1
      )
        throw new Error("tool_call_limit");
      calls.add(parsed.id);
      const entry = receipt.selection!.tools[selected];
      await deps.reserveExternal?.(entry.name);
      const start = now();
      let observation;
      try {
        const invoke = async () => {
          deps.beforeModel?.();
          return entry.name === "failure_history"
            ? normalizeFailureHistory(
                await within(
                  (signal) =>
                    deps.failureHistory(entry.arguments.queryId, signal),
                  10_000,
                ),
                input.audit.projectId,
                entry.arguments.queryId,
                parsed.id,
              )
            : normalizeSearchVisibility(
                await within(
                  (signal) => deps.searchVisibility(signal),
                  deps.searchTimeoutMs ?? 60_000,
                ),
                parsed.id,
              );
        };
        observation = deps.trace
          ? await deps.trace.span(
              `briefstamp.agent.tool.${entry.name}`,
              invoke,
              { tool: entry.name },
            )
          : await invoke();
      } catch (error) {
        observation = EvidenceToolObservationSchema.parse({
          id: parsed.id,
          type: entry.name,
          status: "unavailable",
          failureCode:
            error instanceof Error && error.message === "tool_timeout"
              ? "tool_timeout"
              : "tool_unavailable",
        });
      }
      receipt.toolCalls.push({
        observationId: parsed.id,
        name: entry.name,
        arguments: structuredClone(entry.arguments),
        status: observation.status,
        durationMs: Math.max(0, now() - start),
      });
      receipt.observations.push(observation);
      receipt.observations.sort((a, b) => a.id.localeCompare(b.id));
      receipt.toolCalls.sort((a, b) =>
        a.observationId.localeCompare(b.observationId),
      );
      return observation;
    };
    const runtime: any = await new Promise((resolve, reject) => {
      const child = fork(childPath, [], {
        execArgv: ["--max-old-space-size=192"],
        env: mastraChildEnvironment(),
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        serialization: "json",
      });
      let done: any;
      let failure: Error | undefined;
      let bytes = 0;
      let messages = 0;
      let pipeBytes = 0;
      let killTimer: ReturnType<typeof setTimeout> | undefined;
      const seen = new Set<number>();
      const stop = (code: string) => {
        failure ??= new Error(code);
        controller.abort();
        child.kill("SIGTERM");
        killTimer ??= setTimeout(() => child.kill("SIGKILL"), 1000);
        killTimer.unref();
      };
      const timer = setTimeout(() => stop("mastra_agent_deadline"), 90_000);
      timer.unref();
      for (const pipe of [child.stdout, child.stderr])
        pipe?.on("data", (b: Buffer) => {
          pipeBytes += b.length;
          if (pipeBytes > 16_384) stop("mastra_diagnostic_budget");
        });
      child.on("error", () => stop("mastra_worker_unavailable"));
      child.on("message", (message: any) => {
        if (failure) return;
        bytes += Buffer.byteLength(JSON.stringify(message));
        messages++;
        if (bytes > 256 * 1024 || messages > 6)
          return stop("mastra_message_budget");
        if (message?.type === "done") {
          if (
            done ||
            Buffer.byteLength(JSON.stringify(message.result)) > 64 * 1024
          )
            return stop("invalid_mastra_result");
          done = message.result;
          return;
        }
        if (message?.type === "failed") return stop("mastra_agent_failed");
        const req = requestSchema.safeParse(message);
        if (!req.success || seen.has(req.data.id))
          return stop("invalid_mastra_request");
        seen.add(req.data.id);
        (req.data.operation === "model"
          ? model(req.data.payload)
          : tool(req.data.payload)
        )
          .then((result) => {
            if (child.connected && !failure)
              child.send({
                type: "response",
                id: req.data.id,
                ok: true,
                result,
              });
          })
          .catch(() => {
            if (child.connected)
              child.send({ type: "response", id: req.data.id, ok: false });
            stop("mastra_parent_call_failed");
          });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (killTimer) clearTimeout(killTimer);
        if (failure || code !== 0 || !done)
          reject(failure ?? new Error("mastra_agent_failed"));
        else resolve(done);
      });
      child.send({
        type: "start",
        input: {
          audit,
          task: EVIDENCE_AGENT_TASK,
          ...(deps.backboardGenerate
            ? { modelTransport: "backboard_openrouter_gemma" }
            : {}),
        },
      });
    });
    if (
      !isDeepStrictEqual(runtime.selection, receipt.selection) ||
      !isDeepStrictEqual(runtime.observations, receipt.observations) ||
      !runtime.sdk ||
      runtime.sdk.provider !== "Mastra Agent"
    )
      throw new Error("invalid_mastra_result");
    const output = EvidenceAgentFindingsSchema.parse(runtime.modelOutput);
    validateCitations(output, audit, receipt.observations);
    if (
      receipt.selection?.tools.length &&
      !isDeepStrictEqual(output, receipt.modelOutput)
    )
      throw new Error("altered_model_output");
    receipt.modelOutput = output;
    receipt.toolSelectionAbstained = receipt.selection?.tools.length === 0;
    receipt.orchestration = runtime.sdk;
    if (JSON.stringify(input.audit) !== source)
      throw new Error("source_audit_changed");
    receipt.factualSummary = [
      "Mastra Agent coordinated the recorded tool observations; model findings are separate from unchanged browser acceptance results.",
    ];
    receipt.status = receipt.observations.some(
      (x) => x.status === "unavailable",
    )
      ? "completed_with_unavailable_tools"
      : "completed";
    return receipt;
  } catch (error) {
    receipt.status = "failed";
    receipt.sourceAuditUnchanged = JSON.stringify(input.audit) === source;
    receipt.failureCode =
      error instanceof GemmaEvidenceProviderError ||
      error instanceof BackboardGemmaEvidenceError
        ? error.code
        : error instanceof z.ZodError
          ? "invalid_model_or_input_schema"
          : "mastra_agent_failed";
    throw new EvidenceAgentError(receipt.failureCode, receipt);
  } finally {
    controller.abort();
    receipt.completedAt = new Date(now()).toISOString();
  }
}
