import { z } from "zod";
import type { Audit, CheckResult, Project } from "../shared/types.js";
import { generateChecks, generateLocalChecks } from "./generator.js";
import { summarizeAudit } from "./gemma.js";
import { CheckSchema, validateChecks } from "./schema.js";
import { runAudit } from "./runner.js";
import { redact } from "./safety.js";
import {
  traceOperation,
  type Operation,
  type SafeTelemetryAttributes,
} from "./observability.js";

const GeneratorSchema = z.object({
  provider: z.string(),
  model: z.string().nullable(),
  reason: z.string().optional(),
});
const ChecksSchema = z.array(CheckSchema).min(1).max(24);
const ProposalSchema = z.object({
  checks: ChecksSchema,
  generator: GeneratorSchema,
});
const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  url: z.string(),
  target: z.enum(["sample", "website"]),
  sampleVariant: z.enum(["healthy", "broken"]),
  authorized: z.boolean(),
  brief: z.string().max(12000),
  checks: ChecksSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
  generator: GeneratorSchema,
});
const ResultSchema = z.object({
  checkId: z.string(),
  requirement: z.string(),
  kind: CheckSchema.innerType().shape.kind,
  status: z.enum(["passed", "failed", "blocked", "unverified"]),
  expected: z.string(),
  durationMs: z.number().min(0),
  evidence: z.object({
    screenshot: z.string().optional(),
    dom: z.string().optional(),
    observed: z.string(),
    url: z.string(),
    viewport: z.object({ width: z.number(), height: z.number() }),
  }),
});
const SourceSchema = ProjectSchema.pick({
  brief: true,
  generator: true,
  target: true,
  url: true,
  sampleVariant: true,
});
const AuditSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  status: z.enum(["queued", "running", "completed", "error"]),
  createdAt: z.string(),
  completedAt: z.string().optional(),
  results: z.array(ResultSchema).max(24),
  checks: ChecksSchema,
  source: SourceSchema.optional(),
  error: z.string().optional(),
  summary: z.string().optional(),
});
const AuditInputSchema = z.object({
  project: ProjectSchema,
  audit: AuditSchema,
});
const ExecutedSchema = AuditInputSchema.extend({
  results: z.array(ResultSchema).max(24),
});
const AuditOutputSchema = z.object({
  results: z.array(ResultSchema).max(24),
  summary: z.string(),
});

export interface OrchestrationStepEvent {
  step: Operation;
  status: "started" | "completed" | "failed";
  elapsedMs?: number;
}
export interface OrchestrationReceipt {
  provider: "Mastra";
  workflowId: "briefstamp-proposal" | "briefstamp-audit";
  runId: string;
  steps: OrchestrationStepEvent[];
  persisted: false;
}
type StepListener = (event: OrchestrationStepEvent) => void;
async function loadMastra() {
  // The provider's supported analytics opt-out must be set before SDK imports.
  // No Mastra CLI, Studio, EE capability or remote exporter is used here.
  process.env.MASTRA_TELEMETRY_DISABLED = "1";
  return Promise.all([
    import("@mastra/core/mastra"),
    import("@mastra/core/workflows"),
    import("@mastra/core/tools"),
  ]);
}
function measuredStep(
  events: OrchestrationStepEvent[],
  listener?: StepListener,
) {
  return async <T>(
    step: Operation,
    data: SafeTelemetryAttributes,
    task: () => Promise<T>,
  ): Promise<T> => {
    const emit = (event: OrchestrationStepEvent) => {
      events.push(event);
      listener?.({ ...event });
    };
    emit({ step, status: "started" });
    const started = performance.now();
    try {
      const value = await traceOperation(step, data, task);
      emit({
        step,
        status: "completed",
        elapsedMs: Math.round(performance.now() - started),
      });
      return value;
    } catch (error) {
      emit({
        step,
        status: "failed",
        elapsedMs: Math.round(performance.now() - started),
      });
      throw error;
    }
  };
}

/** Real Mastra tool/workflow execution. The workflow never approves a proposal. */
export async function generateChecksWithOrchestration(
  brief: string,
  options: {
    allowModel?: boolean;
    onStep?: StepListener;
  } = {},
): Promise<{
  checks: Project["checks"];
  generator: Project["generator"];
  orchestration: OrchestrationReceipt;
}> {
  const [{ Mastra }, { createStep, createWorkflow }, { createTool }] =
    await loadMastra();
  const events: OrchestrationStepEvent[] = [];
  const step = measuredStep(events, options.onStep);
  const inputSchema = z.object({ brief: z.string().trim().min(1).max(12000) });
  const proposeTool = createTool({
    id: "requirement-proposal",
    description:
      "Propose finite, unapproved website assertions; never execute code or approve checks.",
    inputSchema,
    outputSchema: ProposalSchema,
    execute: async ({ brief }) =>
      step("briefstamp.proposal.generate", {}, async () => {
        if (options.allowModel) return generateChecks(brief);
        return {
          checks: generateLocalChecks(brief),
          generator: {
            provider: "Deterministic parser",
            model: null,
            reason:
              "Local rules create draft checks at no API cost. Model calls are disabled for this workflow.",
          },
        };
      }),
  });
  const validate = createStep({
    id: "validate-unapproved-proposal",
    inputSchema: ProposalSchema,
    outputSchema: ProposalSchema,
    execute: async ({ inputData }) =>
      step(
        "briefstamp.proposal.validate",
        { checkCount: inputData.checks.length },
        async () => ({
          generator: inputData.generator,
          checks: validateChecks(inputData.checks).map((check) => ({
            ...check,
            approved: false,
          })),
        }),
      ),
  });
  const workflow = createWorkflow({
    id: "briefstamp-proposal",
    inputSchema,
    outputSchema: ProposalSchema,
  })
    .then(createStep(proposeTool))
    .then(validate)
    .commit();
  // In-memory engine only. No cloud exporter, logger, memory or store is attached.
  const mastra = new Mastra({
    logger: false,
    workflows: { proposal: workflow },
  });
  return traceOperation("briefstamp.proposal", {}, async () => {
    const run = await mastra.getWorkflow("proposal").createRun();
    const outcome = await run.start({ inputData: { brief } });
    if (outcome.status !== "success")
      throw new Error(
        "The proposal workflow could not produce a validated draft.",
      );
    return {
      ...outcome.result,
      orchestration: {
        provider: "Mastra",
        workflowId: "briefstamp-proposal",
        runId: run.runId,
        steps: events,
        persisted: false,
      },
    };
  });
}

export function observedSummary(results: CheckResult[]): string {
  const count = (status: CheckResult["status"]) =>
    results.filter((result) => result.status === status).length;
  return `Observed results: ${count("passed")} passed, ${count("failed")} failed, ${count("blocked")} blocked, ${count("unverified")} unverified. Only executed assertions are verified; manual requirements still need human review.`;
}

/** Rejects an unapproved/mismatched immutable snapshot before browser execution. */
export function assertApprovedAudit(project: Project, audit: Audit): void {
  const checks = validateChecks(audit.checks);
  const current = validateChecks(project.checks);
  if (audit.projectId !== project.id)
    throw new Error("The audit does not belong to this project.");
  if (project.target === "website" && !project.authorized)
    throw new Error("Website authorization is required before execution.");
  if (
    checks.some(
      (check) =>
        (check.kind !== "manual" && !check.approved) ||
        !current.some((item) => JSON.stringify(item) === JSON.stringify(check)),
    )
  )
    throw new Error(
      "Every executable check must match the current approved plan before execution.",
    );
}

/** Coordinates approved execution and evidence summaries; never changes approvals. */
export async function runAuditWithOrchestration(
  project: Project,
  audit: Audit,
  onResult: (result: CheckResult) => Promise<void> | void,
  options: {
    evidenceRoot?: string;
    syntheticPages?: Readonly<Record<string, string>>;
    allowModelSummary?: boolean;
    onStep?: StepListener;
    /** Trusted test/host dependency injection. Never populated from an HTTP request. */
    execute?: typeof runAudit;
  } = {},
): Promise<{
  results: CheckResult[];
  summary: string;
  orchestration: OrchestrationReceipt;
}> {
  // Validate once outside the engine so callers retain useful approval errors and
  // private validation values never reach a framework error logger.
  assertApprovedAudit(project, audit);
  const [{ Mastra }, { createStep, createWorkflow }, { createTool }] =
    await loadMastra();
  const events: OrchestrationStepEvent[] = [];
  const step = measuredStep(events, options.onStep);
  const approve = createStep({
    id: "require-approval",
    inputSchema: AuditInputSchema,
    outputSchema: AuditInputSchema,
    execute: async ({ inputData }) =>
      step(
        "briefstamp.audit.approval",
        {
          checkCount: inputData.audit.checks.length,
          target: inputData.project.target,
        },
        async () => {
          assertApprovedAudit(inputData.project, inputData.audit);
          return inputData;
        },
      ),
  });
  const browserTool = createTool({
    id: "execute-approved-browser-checks",
    description:
      "Execute only an approved immutable finite plan with the safe read-only Playwright runner.",
    inputSchema: AuditInputSchema,
    outputSchema: ExecutedSchema,
    execute: async (inputData) =>
      step(
        "briefstamp.audit.browser",
        {
          checkCount: inputData.audit.checks.length,
          target: inputData.project.target,
        },
        async () => {
          const results = await (options.execute ?? runAudit)(
            inputData.project,
            inputData.audit,
            onResult,
            {
              evidenceRoot: options.evidenceRoot,
              syntheticPages: options.syntheticPages,
            },
          );
          return { ...inputData, results };
        },
      ),
  });
  const summarize = createStep({
    id: "summarize-observed-evidence",
    inputSchema: ExecutedSchema,
    outputSchema: AuditOutputSchema,
    execute: async ({ inputData }) =>
      step(
        "briefstamp.audit.summary",
        { checkCount: inputData.results.length },
        async () => {
          const { results } = inputData;
          if (
            results.length !== inputData.audit.checks.length ||
            inputData.audit.checks.some(
              (check) =>
                results.filter(
                  (result) =>
                    result.checkId === check.id &&
                    result.kind === check.kind &&
                    result.expected === redact(check.expected) &&
                    (check.kind !== "manual" || result.status === "unverified"),
                ).length !== 1,
            )
          )
            throw new Error(
              "The runner returned incomplete or mismatched assertion evidence.",
            );
          let summary = observedSummary(results);
          if (options.allowModelSummary) {
            const completed: Audit = {
              ...structuredClone(inputData.audit),
              results: structuredClone(results),
              status: "completed",
            };
            const commentary = await summarizeAudit(completed);
            if (commentary) summary = commentary;
          }
          return { results, summary };
        },
      ),
  });
  const workflow = createWorkflow({
    id: "briefstamp-audit",
    inputSchema: AuditInputSchema,
    outputSchema: AuditOutputSchema,
  })
    .then(approve)
    .then(createStep(browserTool))
    .then(summarize)
    .commit();
  const mastra = new Mastra({ logger: false, workflows: { audit: workflow } });
  return traceOperation(
    "briefstamp.audit",
    { checkCount: audit.checks.length, target: project.target },
    async () => {
      const run = await mastra.getWorkflow("audit").createRun();
      const outcome = await run.start({
        inputData: {
          project: structuredClone(project),
          audit: structuredClone(audit),
        },
      });
      if (outcome.status !== "success")
        throw new Error(
          "The audit workflow did not complete. Unexecuted checks are not passed.",
        );
      return {
        ...outcome.result,
        orchestration: {
          provider: "Mastra",
          workflowId: "briefstamp-audit",
          runId: run.runId,
          steps: events,
          persisted: false,
        },
      };
    },
  );
}
