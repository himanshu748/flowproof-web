import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  EVIDENCE_AGENT_TASK,
  EvidenceAgentFindingsSchema,
  EvidenceToolObservationSchema,
  EvidenceToolSelectionSchema,
  normalizeFailureHistory,
  normalizeSearchVisibility,
  validatedAudit,
  validateCitations,
  type EvidenceAgentPhaseRequest,
  type EvidenceAgentQueryId,
  type EvidenceAgentTurn,
  type EvidenceToolObservation,
  type FailureHistoryRow,
  type SearchVisibilityResult,
} from "../server/evidence-agent.js";
import { GOOGLE_GEMMA_MODEL } from "../server/providers/gemma-google.js";
import { GemmaEvidenceProviderError } from "../server/providers/gemma-evidence-agent.js";
import {
  createEvidenceActivityLedger,
  EvidenceActivityAttemptError,
  EvidenceLedgerError,
} from "./agent-ledger.js";
import type {
  TemporalAgentActivities,
  TemporalAgentInput,
  TemporalAgentProvenance,
  TemporalAgentSelection,
} from "./agent-contracts.js";

export interface TemporalAgentActivityContext {
  workflowId: string;
  runId: string;
  activityId: string;
  attempt: number;
  heartbeat?: (details: unknown) => void;
}
export type TemporalAgentFault =
  | "transient-recovery"
  | "permanent-400"
  | "summary-invalid-citation"
  | "exhausted-500";
export interface EvidenceAgentActivityOptions {
  journalRoot: string;
  provenance: TemporalAgentProvenance;
  generate: (
    request: EvidenceAgentPhaseRequest,
    signal: AbortSignal,
  ) => Promise<EvidenceAgentTurn>;
  failureHistory: (
    queryId: EvidenceAgentQueryId,
    signal: AbortSignal,
  ) => Promise<FailureHistoryRow[]>;
  searchVisibility: (signal: AbortSignal) => Promise<SearchVisibilityResult>;
  context?: () => TemporalAgentActivityContext;
  faults?: Record<string, TemporalAgentFault>;
  now?: () => number;
}
/** Known completed HTTP response, never an ambiguous transport timeout. */
export class TemporalEvidenceHttpError extends Error {
  constructor(
    readonly status: number,
    readonly injectedBeforeDispatch = false,
  ) {
    super("A bounded evidence activity received a known HTTP failure.");
  }
}
class ValidationFailure extends Error {}
class AmbiguousFailure extends Error {}
class PreDispatchTimeout extends Error {}
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const inputHash = (value: unknown) =>
  createHash("sha256")
    .update(
      JSON.stringify(value, (_key, item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
          ? Object.fromEntries(
              Object.keys(item)
                .sort()
                .map((key) => [key, item[key]]),
            )
          : item,
      ),
    )
    .digest("hex");
const provenanceSchema = z
  .object({
    kind: z.literal("retained-native-receipt-fixture"),
    receiptSha256: z.string().regex(/^[a-f0-9]{64}$/),
    source: z.string().min(1).max(500),
  })
  .strict();
function actualContext(): TemporalAgentActivityContext {
  const current = Context.current();
  const execution = current.info.workflowExecution;
  if (!execution)
    throw ApplicationFailure.nonRetryable(
      "A workflow execution is required for the dedicated allowance.",
      "EvidenceSafetyError",
    );
  return {
    workflowId: execution.workflowId,
    runId: execution.runId,
    activityId: current.info.activityId,
    attempt: current.info.attempt,
    heartbeat: (details) => current.heartbeat(details),
  };
}
function validateInput(input: TemporalAgentInput) {
  if (
    input.task !== EVIDENCE_AGENT_TASK ||
    (input.pauseAfterTiger !== undefined &&
      typeof input.pauseAfterTiger !== "boolean") ||
    Buffer.byteLength(JSON.stringify(input)) > 262144
  )
    throw new ValidationFailure("Invalid fixed activity input");
  return validatedAudit(input.audit);
}
function validateTurn(
  turn: EvidenceAgentTurn,
  phase: EvidenceAgentPhaseRequest["phase"],
) {
  if (
    turn.model !== GOOGLE_GEMMA_MODEL ||
    turn.attempts.length !== 1 ||
    turn.attempts[0].phase !== phase ||
    turn.attempts[0].status !== 200 ||
    turn.attempts[0].index !== 1
  )
    throw new ValidationFailure(
      "A single retained native model response is required",
    );
  return structuredClone(turn);
}

/** Dedicated fixture execution only. No provider client, public grant or SDK retry is initialized here. */
export function createEvidenceAgentActivities(
  options: EvidenceAgentActivityOptions,
): TemporalAgentActivities {
  const provenance = provenanceSchema.parse(options.provenance);
  const ledger = createEvidenceActivityLedger({
    root: options.journalRoot,
    now: options.now,
  });
  const context = () => {
    const value = options.context?.() ?? actualContext();
    if (
      !value.workflowId ||
      !value.runId ||
      !value.activityId ||
      !Number.isInteger(value.attempt) ||
      value.attempt < 1 ||
      value.attempt > 3
    )
      throw ApplicationFailure.nonRetryable(
        "Invalid evidence activity context.",
        "EvidenceSafetyError",
      );
    return value;
  };
  const translate = (error: unknown): never => {
    if (error instanceof ApplicationFailure) throw error;
    if (error instanceof EvidenceActivityAttemptError) {
      throw ApplicationFailure.create({
        message: error.retryable
          ? "A bounded evidence attempt may be retried."
          : "The evidence activity failed without retry permission.",
        type: error.retryable
          ? error.code === "injected_pre_dispatch_timeout"
            ? "EvidencePreDispatchTimeout"
            : "EvidenceTransientProviderError"
          : error.code.includes("ambiguous")
            ? "EvidenceAmbiguousCompletion"
            : error.code.includes("http_4")
              ? "EvidencePermanentProviderError"
              : "EvidenceValidationError",
        nonRetryable: !error.retryable,
        details: [{ code: error.code, scope: "dedicated-temporal-fixture" }],
      });
    }
    if (error instanceof EvidenceLedgerError)
      throw ApplicationFailure.nonRetryable(
        "The evidence journal cannot authorize a repeated operation.",
        "EvidenceLedgerError",
        { code: error.code },
      );
    throw ApplicationFailure.nonRetryable(
      "The fixed evidence input or result did not validate.",
      "EvidenceValidationError",
    );
  };
  const classify = (error: unknown): never => {
    if (error instanceof EvidenceActivityAttemptError) throw error;
    if (error instanceof PreDispatchTimeout)
      throw new EvidenceActivityAttemptError("injected_pre_dispatch_timeout", {
        retryable: true,
      });
    if (error instanceof TemporalEvidenceHttpError) {
      const valid =
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status <= 599;
      throw new EvidenceActivityAttemptError(
        valid
          ? `${error.injectedBeforeDispatch ? "injected_" : ""}http_${error.status}`
          : "invalid_http_status",
        { retryable: valid && error.status >= 500 },
      );
    }
    if (error instanceof GemmaEvidenceProviderError) {
      const status =
        error.attempts.length === 1 ? error.attempts[0].status : null;
      if (status !== null && status >= 400 && status <= 599)
        throw new EvidenceActivityAttemptError(`http_${status}`, {
          retryable: status >= 500,
        });
      throw new EvidenceActivityAttemptError(
        error.attempts.length > 1
          ? "unapproved_internal_retries"
          : "ambiguous_provider_completion",
        { retryable: false },
      );
    }
    throw new EvidenceActivityAttemptError(
      error instanceof AmbiguousFailure
        ? "ambiguous_provider_completion"
        : "invalid_evidence_result",
      { retryable: false },
    );
  };
  const bounded = async <T>(
    operation: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const stopped = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
          controller.abort();
          reject(new AmbiguousFailure());
        }, 20_000);
      });
      const value = await Promise.race([operation(controller.signal), stopped]);
      controller.signal.throwIfAborted();
      return value;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  };
  const operate = async <T>(
    phase: "select" | "tiger" | "search" | "summary",
    input: TemporalAgentInput,
    operationInput: unknown,
    work: (attempt: number, ctx: TemporalAgentActivityContext) => Promise<T>,
  ): Promise<T> => {
    try {
      validateInput(input);
      const ctx = context();
      const sourceAuditSha256 = hash(input.audit);
      return await ledger.execute(
        {
          runId: ctx.runId,
          workflowId: ctx.workflowId,
          activityId: ctx.activityId,
          phase,
          inputSha256: inputHash(operationInput),
          sourceAuditSha256,
          provenance,
        },
        async (attempt) => {
          try {
            ctx.heartbeat?.({
              phase,
              attempt,
              scope: "dedicated-temporal-fixture",
            });
            const result = await work(attempt, ctx);
            if (hash(input.audit) !== sourceAuditSha256)
              throw new ValidationFailure("Source audit changed");
            return result;
          } catch (error) {
            return classify(error);
          }
        },
      );
    } catch (error) {
      return translate(error);
    }
  };
  const selected = async (
    runId: string,
    name: "failure_history" | "search_visibility",
    observationId: string,
  ) => {
    const prior = await ledger.readCompleted<TemporalAgentSelection>(
      runId,
      "select",
    );
    if (!prior)
      throw new ValidationFailure("Model selection is not durably completed");
    const selection = EvidenceToolSelectionSchema.parse(prior.selection);
    const index = selection.tools.findIndex((tool) => tool.name === name);
    if (index < 0 || observationId !== `tool-${index + 1}`)
      throw new ValidationFailure("Tool does not match model selection");
    return selection.tools[index];
  };
  return {
    async reserveEvidenceAllowance(input) {
      try {
        validateInput(input);
        const ctx = context();
        return await ledger.reserve({
          runId: ctx.runId,
          workflowId: ctx.workflowId,
          inputSha256: inputHash(input),
          sourceAuditSha256: hash(input.audit),
          provenance,
        });
      } catch (error) {
        return translate(error);
      }
    },
    async selectEvidenceTools(input) {
      return operate("select", input, input, async (attempt, ctx) => {
        const fault = options.faults?.[ctx.workflowId];
        if (fault === "permanent-400")
          throw new TemporalEvidenceHttpError(400, true);
        if (
          fault === "exhausted-500" ||
          (fault === "transient-recovery" && attempt === 1)
        )
          throw new TemporalEvidenceHttpError(500, true);
        const turn = validateTurn(
          await bounded((signal) =>
            options.generate(
              {
                phase: "select_tools",
                task: EVIDENCE_AGENT_TASK,
                audit: validatedAudit(input.audit),
              },
              signal,
            ),
          ),
          "select_tools",
        );
        return {
          selection: EvidenceToolSelectionSchema.parse(turn.output),
          turn,
          provenance,
          sourceAuditSha256: hash(input.audit),
        };
      });
    },
    async retrieveTigerEvidence(value) {
      return operate("tiger", value.input, value, async (_attempt, ctx) => {
        const tool = await selected(
          ctx.runId,
          "failure_history",
          value.observationId,
        );
        if (
          tool.name !== "failure_history" ||
          tool.arguments.queryId !== value.queryId
        )
          throw new ValidationFailure("History query differs from selection");
        const rows = await bounded((signal) =>
          options.failureHistory(value.queryId, signal),
        );
        return normalizeFailureHistory(
          rows,
          value.input.audit.projectId,
          value.queryId,
          value.observationId,
        );
      });
    },
    async searchEvidenceVisibility(value) {
      return operate("search", value.input, value, async (attempt, ctx) => {
        await selected(ctx.runId, "search_visibility", value.observationId);
        if (
          options.faults?.[ctx.workflowId] === "transient-recovery" &&
          attempt === 1
        )
          throw new PreDispatchTimeout();
        return normalizeSearchVisibility(
          await bounded((signal) => options.searchVisibility(signal)),
          value.observationId,
        );
      });
    },
    async summarizeEvidence(value) {
      return operate("summary", value.input, value, async (_attempt, ctx) => {
        const prior = await ledger.readCompleted<TemporalAgentSelection>(
          ctx.runId,
          "select",
        );
        const selection = EvidenceToolSelectionSchema.parse(value.selection);
        if (!prior || !isDeepStrictEqual(prior.selection, selection))
          throw new ValidationFailure("Summary selection changed");
        const observed: EvidenceToolObservation[] = [];
        for (const tool of selection.tools) {
          const observation =
            await ledger.readCompleted<EvidenceToolObservation>(
              ctx.runId,
              tool.name === "failure_history" ? "tiger" : "search",
            );
          if (!observation)
            throw new ValidationFailure(
              "Tool observation is not durably completed",
            );
          observed.push(EvidenceToolObservationSchema.parse(observation));
        }
        if (!isDeepStrictEqual(observed, value.observations))
          throw new ValidationFailure("Summary observations changed");
        const audit = validatedAudit(value.input.audit);
        const turn = validateTurn(
          await bounded((signal) =>
            options.generate(
              {
                phase: "summarize",
                task: EVIDENCE_AGENT_TASK,
                audit,
                selection,
                observations: observed,
              },
              signal,
            ),
          ),
          "summarize",
        );
        const findings = EvidenceAgentFindingsSchema.parse(turn.output);
        if (options.faults?.[ctx.workflowId] === "summary-invalid-citation") {
          const invalid = {
            findings: [
              {
                type: "search_snapshot" as const,
                observationId: "tool-2" as const,
                resultCount: 999,
              },
            ],
            abstention: "none" as const,
          };
          validateCitations(invalid, audit, observed);
          throw new ValidationFailure(
            "Injected invalid citation was not rejected",
          );
        }
        validateCitations(findings, audit, observed);
        return {
          findings,
          turn,
          sourceAuditUnchanged: true as const,
          sourceAuditSha256: hash(value.input.audit),
          provenance,
        };
      });
    },
  };
}
