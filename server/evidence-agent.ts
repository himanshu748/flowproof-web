import { z } from "zod";
import type { Audit, CheckKind, ResultStatus } from "../shared/types.js";
import { SAMPLE_URL } from "./sample.js";
import { validateChecks } from "./schema.js";
import {
  EVIDENCE_AGENT_TASK,
  EvidenceAgentFindingsSchema,
  EvidenceAuditObservationSchema,
  EvidenceHistoryFactSchema,
  EvidenceToolObservationSchema,
  EvidenceToolSelectionSchema,
  GemmaEvidenceProviderError,
  generateGemmaEvidenceTurn,
  type EvidenceAgentFindings,
  type EvidenceAgentPhaseRequest,
  type EvidenceAgentQueryId,
  type EvidenceAgentTurn,
  type EvidenceToolObservation,
} from "./providers/gemma-evidence-agent.js";
import { GOOGLE_GEMMA_MODEL } from "./providers/gemma-google.js";

export {
  EVIDENCE_AGENT_TASK,
  EvidenceAgentFindingsSchema,
  EvidenceAuditObservationSchema,
  EvidenceHistoryFactSchema,
  EvidenceToolSelectionSchema,
  EvidenceToolObservationSchema,
};
export type {
  EvidenceAgentFindings,
  EvidenceAgentPhaseRequest,
  EvidenceAgentQueryId,
  EvidenceAgentTurn,
  EvidenceToolObservation,
};
export const EVIDENCE_AGENT_SAMPLE_BRIEF =
  'The homepage heading must say "Design that moves business forward."\nA contact link must say "Start a project".\nEvery content image must have nonempty alternative text.\nThe homepage must fit a 390px mobile screen without horizontal scrolling.\nThe homepage must show "Independent by design."\nThe site should feel welcoming and trustworthy.';
export type FailureHistoryRow = z.infer<typeof EvidenceHistoryFactSchema> & {
  projectId: string;
};
export interface SearchVisibilityResult {
  provider: string;
  domain: string;
  query: string;
  observedAt: string;
  status: "observed";
  results: Array<{ title: string; url: string; position: number | null }>;
  limitation: string;
}
export const SearchVisibilitySchema = z
  .object({
    provider: z.literal("SerpApi"),
    domain: z.literal("flowproof-demo.onrender.com"),
    query: z.literal("site:flowproof-demo.onrender.com"),
    observedAt: z.string().datetime({ offset: true }),
    status: z.literal("observed"),
    results: z
      .array(
        z
          .object({
            title: z.string().max(180),
            url: z
              .string()
              .url()
              .max(2048)
              .refine((value) => {
                const url = new URL(value);
                return (
                  url.protocol === "https:" &&
                  url.hostname === "flowproof-demo.onrender.com" &&
                  !url.port &&
                  !url.username &&
                  !url.password &&
                  !url.search &&
                  !url.hash
                );
              }),
            position: z.number().int().positive().nullable(),
          })
          .strict(),
      )
      .max(5),
    limitation: z.string().min(1).max(1000),
  })
  .strict();
// Tiger returns additional verified catalogue metadata. Project identity is checked
// here, and only finite citation facts/scores are projected into the model context.
const HistoryRowsSchema = z
  .array(
    z.object({
      ...EvidenceHistoryFactSchema.shape,
      projectId: z.string().uuid(),
    }),
  )
  .max(20);
export interface EvidenceAgentDependencies {
  /** Trusted durable grant only; two logical turns remain fixed. */
  maxModelRequests?: 2 | 6;
  /** Trusted search-only transport budget; never read from a model or HTTP body. */
  searchTimeoutMs?: 10_000 | 30_000;
  /** Trusted caller liveness/ownership check immediately before every model call. */
  beforeModel?: () => void;
  generate?: (request: EvidenceAgentPhaseRequest) => Promise<EvidenceAgentTurn>;
  failureHistory: (
    queryId: EvidenceAgentQueryId,
    signal: AbortSignal,
  ) => Promise<FailureHistoryRow[]>;
  searchVisibility: (signal: AbortSignal) => Promise<SearchVisibilityResult>;
  env?: NodeJS.ProcessEnv;
  now?: () => number;
}
export interface EvidenceAgentReceipt {
  version: 1;
  status:
    | "running"
    | "completed"
    | "completed_with_unavailable_tools"
    | "failed";
  transport: "native_google_gemma" | "injected_offline";
  model: typeof GOOGLE_GEMMA_MODEL;
  startedAt: string;
  completedAt?: string;
  task: typeof EVIDENCE_AGENT_TASK;
  sourceAuditId: string;
  modelTurns: Array<{
    phase: EvidenceAgentPhaseRequest["phase"];
    result?: EvidenceAgentTurn;
    failedAttempts?: GemmaEvidenceProviderError["attempts"];
    failureDiagnostic?: GemmaEvidenceProviderError["diagnostic"];
  }>;
  selection?: z.infer<typeof EvidenceToolSelectionSchema>;
  toolSelectionAbstained?: boolean;
  toolCalls: Array<{
    observationId: string;
    name: "failure_history" | "search_visibility";
    arguments: { queryId: EvidenceAgentQueryId } | Record<string, never>;
    status: "observed" | "unavailable";
    durationMs: number;
  }>;
  auditObservation?: z.infer<typeof EvidenceAuditObservationSchema>;
  observations: EvidenceToolObservation[];
  modelOutput?: EvidenceAgentFindings;
  factualSummary?: string[];
  sourceAuditUnchanged: boolean;
  failureCode?: string;
  limits: {
    maximumModelCalls: 2 | 6;
    maximumLogicalModelTurns?: 2;
    maximumToolCalls: 2;
    modelRetries: 0 | 4;
    toolRetries: 0;
    refundPerformed: false;
    maximumDurationMs: 50_000 | 90_000;
    maximumSearchDurationMs?: 10_000 | 30_000;
  };
  scope: string;
}
export class EvidenceAgentError extends Error {
  constructor(
    readonly code: string,
    readonly receipt: EvidenceAgentReceipt,
  ) {
    super(
      "The bounded evidence agent did not complete. Inspect its sanitized attempts; no reservation was refunded.",
    );
    this.name = "EvidenceAgentError";
  }
}
function refusal(code: string): never {
  throw new Error(code);
}
function validatedAudit(audit: Audit) {
  if (
    !z.string().uuid().safeParse(audit.id).success ||
    !z.string().uuid().safeParse(audit.projectId).success ||
    audit.status !== "completed" ||
    !z.string().datetime({ offset: true }).safeParse(audit.completedAt)
      .success ||
    audit.source?.target !== "sample" ||
    audit.source.url !== SAMPLE_URL ||
    audit.source.sampleVariant !== "broken" ||
    audit.source.brief !== EVIDENCE_AGENT_SAMPLE_BRIEF
  )
    refusal("invalid_fixed_sample_scope");
  const checks = validateChecks(audit.checks);
  const kinds: CheckKind[] = [
    "heading",
    "link",
    "image_alt",
    "no_horizontal_overflow",
    "text_visible",
    "manual",
  ];
  const requirements = EVIDENCE_AGENT_SAMPLE_BRIEF.split("\n");
  if (
    checks.length !== 6 ||
    checks.some(
      (check, index) =>
        check.requirement !== requirements[index] ||
        check.kind !== kinds[index] ||
        check.path !== "/" ||
        check.selector !== undefined ||
        check.viewport !== (index === 3 ? "mobile" : "desktop") ||
        !z.string().uuid().safeParse(check.id).success ||
        (check.kind !== "manual" && !check.approved),
    ) ||
    checks[0].expected !== "Design that moves business forward." ||
    checks[1].expected !== "Start a project" ||
    checks[4].expected !== "Independent by design."
  )
    refusal("altered_fixed_sample_plan");
  if (
    audit.results.length !== 6 ||
    new Set(audit.results.map((result) => result.checkId)).size !== 6
  )
    refusal("incomplete_audit_results");
  for (const result of audit.results) {
    const check = checks.find((item) => item.id === result.checkId);
    if (
      !check ||
      result.kind !== check.kind ||
      result.requirement !== check.requirement ||
      result.expected !== check.expected ||
      !["passed", "failed", "blocked", "unverified"].includes(result.status) ||
      result.evidence.url !== SAMPLE_URL ||
      !Number.isFinite(result.durationMs) ||
      result.durationMs < 0 ||
      (result.kind === "manual" && result.status !== "unverified")
    )
      refusal("mismatched_observed_audit_result");
  }
  if (
    !audit.results.some(
      (result) =>
        result.kind === "no_horizontal_overflow" && result.status === "failed",
    )
  )
    refusal("recorded_mobile_failure_required");
  return EvidenceAuditObservationSchema.parse({
    id: "audit",
    type: "audit_results",
    auditId: audit.id,
    results: audit.results.map(({ checkId, kind, status }) => ({
      checkId,
      kind,
      status,
    })),
  });
}
function validateCitations(
  output: EvidenceAgentFindings,
  audit: z.infer<typeof EvidenceAuditObservationSchema>,
  observations: EvidenceToolObservation[],
) {
  const keys = new Set<string>();
  for (const finding of output.findings) {
    const key = JSON.stringify(finding);
    if (keys.has(key)) refusal("duplicate_model_finding");
    keys.add(key);
    if (finding.type === "audit_result") {
      if (
        finding.observationId !== "audit" ||
        finding.auditId !== audit.auditId ||
        !audit.results.some(
          (result) =>
            result.checkId === finding.checkId &&
            result.status === finding.status,
        )
      )
        refusal("invented_audit_citation");
      continue;
    }
    const observation = observations.find(
      (item) => item.id === finding.observationId,
    );
    if (!observation) refusal("unknown_observation_citation");
    if (finding.type === "historical_failure") {
      if (
        observation.type !== "failure_history" ||
        observation.status !== "observed" ||
        !observation.rows.some(
          (row) =>
            row.auditId === finding.auditId &&
            row.checkId === finding.checkId &&
            row.status === finding.status,
        )
      )
        refusal("invented_history_fact");
    } else if (finding.type === "search_snapshot") {
      if (
        observation.type !== "search_visibility" ||
        observation.status !== "observed" ||
        finding.resultCount !== observation.resultCount
      )
        refusal("invented_search_fact");
    } else if (
      observation.status !== "unavailable" ||
      observation.type !== finding.tool
    )
      refusal("invented_tool_availability");
  }
  if (!output.findings.length && output.abstention === "none")
    refusal("missing_abstention");
  if (
    output.abstention === "tools_unavailable" &&
    !observations.some((item) => item.status === "unavailable")
  )
    refusal("invented_tool_unavailability");
}

/** Caller must reserve its durable tranche and authenticate before invoking this loop. */
export async function executeEvidenceAgent(
  input: { audit: Audit; task: string },
  deps: EvidenceAgentDependencies,
): Promise<EvidenceAgentReceipt> {
  const now = deps.now ?? Date.now;
  const maximumModelCalls = deps.maxModelRequests ?? 2;
  const maximumSearchDurationMs = deps.searchTimeoutMs ?? 10_000;
  const expandedBudget = maximumModelCalls === 6;
  const maximumDurationMs =
    expandedBudget || maximumSearchDurationMs === 30_000 ? 90_000 : 50_000;
  const receipt: EvidenceAgentReceipt = {
    version: 1,
    status: "running",
    transport: deps.generate ? "injected_offline" : "native_google_gemma",
    model: GOOGLE_GEMMA_MODEL,
    startedAt: new Date(now()).toISOString(),
    task: EVIDENCE_AGENT_TASK,
    sourceAuditId: input.audit.id,
    modelTurns: [],
    toolCalls: [],
    observations: [],
    sourceAuditUnchanged: true,
    limits: {
      maximumModelCalls,
      maximumLogicalModelTurns: 2,
      maximumToolCalls: 2,
      modelRetries: expandedBudget ? 4 : 0,
      toolRetries: 0,
      refundPerformed: false,
      maximumDurationMs,
      maximumSearchDurationMs,
    },
    scope:
      "Model-selected finite read-only tools over a fixed synthetic audit and the owned homepage. Typed model findings are separate from server-rendered facts. Historical/search observations are not new browser checks or acceptance evidence.",
  };
  let sourceSnapshot = "";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maximumDurationMs);
  const bounded = async <T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
  ): Promise<T> => {
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(timeoutMs),
    ]);
    if (signal.aborted) refusal("agent_deadline");
    let abort = () => {};
    const stopped = new Promise<never>((_resolve, reject) => {
      abort = () => reject(new Error("tool_timeout"));
      signal.addEventListener("abort", abort, { once: true });
    });
    try {
      return await Promise.race([operation(signal), stopped]);
    } finally {
      signal.removeEventListener("abort", abort);
    }
  };
  const turn = async (request: EvidenceAgentPhaseRequest) => {
    if (
      receipt.modelTurns.length >= 2 ||
      receipt.modelTurns.some((item) => item.phase === request.phase)
    )
      refusal("model_call_limit");
    const record: EvidenceAgentReceipt["modelTurns"][number] = {
      phase: request.phase,
    };
    receipt.modelTurns.push(record);
    try {
      const result = await bounded(
        (signal) => {
          deps.beforeModel?.();
          return deps.generate
            ? deps.generate(request)
            : generateGemmaEvidenceTurn(request, {
                env: deps.env,
                now: deps.now,
                signal,
                beforeRequest: deps.beforeModel,
                maxAttempts: expandedBudget ? 3 : 1,
              });
        },
        expandedBudget ? 32_000 : 20_000,
      );
      const phaseAttempts = expandedBudget ? 3 : 1;
      if (
        result.model !== GOOGLE_GEMMA_MODEL ||
        result.attempts.length > phaseAttempts ||
        (!deps.generate &&
          (result.attempts.length < 1 ||
            result.attempts.some(
              (attempt, index) =>
                attempt.phase !== request.phase ||
                attempt.index !== index + 1 ||
                (index === result.attempts.length - 1
                  ? attempt.status !== 200
                  : ![500, 502, 503, 504].includes(attempt.status ?? 0)),
            )))
      )
        refusal("invalid_model_transport_receipt");
      record.result = structuredClone(result);
      return result.output;
    } catch (error) {
      if (error instanceof GemmaEvidenceProviderError) {
        record.failedAttempts = structuredClone(error.attempts);
        if (error.diagnostic)
          record.failureDiagnostic = structuredClone(error.diagnostic);
      }
      throw error;
    }
  };
  try {
    if (maximumModelCalls !== 2 && maximumModelCalls !== 6)
      refusal("invalid_model_request_budget");
    if (
      maximumSearchDurationMs !== 10_000 &&
      maximumSearchDurationMs !== 30_000
    )
      refusal("invalid_search_timeout_budget");
    if (input.task !== EVIDENCE_AGENT_TASK) refusal("invalid_fixed_task");
    sourceSnapshot = JSON.stringify(input.audit);
    const audit = validatedAudit(input.audit);
    receipt.auditObservation = audit;
    const selection = EvidenceToolSelectionSchema.parse(
      await turn({ phase: "select_tools", task: EVIDENCE_AGENT_TASK, audit }),
    );
    receipt.selection = structuredClone(selection);
    receipt.toolSelectionAbstained = selection.tools.length === 0;
    for (const [index, tool] of selection.tools.entries()) {
      if (
        receipt.toolCalls.length >= 2 ||
        receipt.toolCalls.some((call) => call.name === tool.name)
      )
        refusal("tool_call_limit");
      const id = `tool-${index + 1}` as "tool-1" | "tool-2";
      const started = now();
      let observation: EvidenceToolObservation;
      try {
        if (tool.name === "failure_history") {
          const result = await bounded(
            (signal) => deps.failureHistory(tool.arguments.queryId, signal),
            10_000,
          );
          const rows = HistoryRowsSchema.parse(result);
          if (
            rows.some(
              (row) =>
                row.projectId !== input.audit.projectId ||
                row.queryId !== tool.arguments.queryId,
            ) ||
            new Set(rows.map((row) => `${row.auditId}:${row.checkId}`)).size !==
              rows.length
          )
            refusal("invalid_tool_observation");
          observation = EvidenceToolObservationSchema.parse({
            id,
            type: "failure_history",
            status: "observed",
            queryId: tool.arguments.queryId,
            rows: rows
              .slice(0, 5)
              .map(({ projectId: _projectId, ...row }) => row),
          });
        } else {
          const result = SearchVisibilitySchema.parse(
            await bounded(
              (signal) => deps.searchVisibility(signal),
              maximumSearchDurationMs,
            ),
          );
          observation = EvidenceToolObservationSchema.parse({
            id,
            type: "search_visibility",
            status: "observed",
            domain: result.domain,
            query: result.query,
            observedAt: result.observedAt,
            resultCount: result.results.length,
          });
        }
      } catch (error) {
        observation = {
          id,
          type: tool.name,
          status: "unavailable",
          failureCode:
            error instanceof Error && error.message === "tool_timeout"
              ? "tool_timeout"
              : error instanceof z.ZodError ||
                  (error instanceof Error &&
                    error.message === "invalid_tool_observation")
                ? "invalid_tool_observation"
                : "tool_unavailable",
        };
      }
      receipt.toolCalls.push({
        observationId: id,
        name: tool.name,
        arguments: structuredClone(tool.arguments),
        status: observation.status,
        durationMs: Math.max(0, now() - started),
      });
      receipt.observations.push(observation);
    }
    const output = EvidenceAgentFindingsSchema.parse(
      await turn({
        phase: "summarize",
        task: EVIDENCE_AGENT_TASK,
        audit,
        selection,
        observations: receipt.observations,
      }),
    );
    validateCitations(output, audit, receipt.observations);
    receipt.modelOutput = structuredClone(output);
    const count = (status: ResultStatus) =>
      audit.results.filter((result) => result.status === status).length;
    receipt.factualSummary = [
      `The recorded synthetic audit has ${count("passed")} passed, ${count("failed")} failed, ${count("blocked")} blocked and ${count("unverified")} unverified checks. These are existing browser outcomes, not outcomes assigned by the model.`,
    ];
    for (const observation of receipt.observations) {
      receipt.factualSummary.push(
        observation.status === "unavailable"
          ? `${observation.id}: ${observation.type} was unavailable; no successful or empty observation is inferred.`
          : observation.type === "failure_history"
            ? `${observation.id}: failure history returned ${observation.rows.length} saved failed or blocked checks for ${observation.queryId}. Historical retrieval is not a new browser observation.`
            : `${observation.id}: the bounded search snapshot returned ${observation.resultCount} matching results. This does not establish de-indexing, search ranking or a passing audit.`,
      );
    }
    if (!selection.tools.length)
      receipt.factualSummary.push(
        "The model abstained from requesting tools. No external tool context was obtained.",
      );
    if (JSON.stringify(input.audit) !== sourceSnapshot)
      refusal("source_audit_changed");
    receipt.status = receipt.observations.some(
      (item) => item.status === "unavailable",
    )
      ? "completed_with_unavailable_tools"
      : "completed";
    return receipt;
  } catch (error) {
    receipt.status = "failed";
    const allowed = [
      "invalid_fixed_sample_scope",
      "invalid_model_request_budget",
      "invalid_search_timeout_budget",
      "altered_fixed_sample_plan",
      "incomplete_audit_results",
      "mismatched_observed_audit_result",
      "recorded_mobile_failure_required",
      "invalid_fixed_task",
      "model_call_limit",
      "tool_call_limit",
      "invalid_model_transport_receipt",
      "duplicate_model_finding",
      "invented_audit_citation",
      "unknown_observation_citation",
      "invented_history_fact",
      "invented_search_fact",
      "invented_tool_availability",
      "missing_abstention",
      "invented_tool_unavailability",
      "agent_deadline",
      "tool_timeout",
      "source_audit_changed",
    ];
    receipt.failureCode =
      error instanceof GemmaEvidenceProviderError
        ? error.code
        : error instanceof z.ZodError
          ? "invalid_model_or_input_schema"
          : error instanceof Error && allowed.includes(error.message)
            ? error.message
            : "agent_failed";
    receipt.sourceAuditUnchanged =
      !sourceSnapshot || JSON.stringify(input.audit) === sourceSnapshot;
    throw new EvidenceAgentError(receipt.failureCode, receipt);
  } finally {
    receipt.completedAt = new Date(now()).toISOString();
    clearTimeout(timer);
    controller.abort();
  }
}
