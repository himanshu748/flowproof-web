import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { WorkflowRunState } from "@mastra/core/workflows";
import type { Check, CheckResult } from "../shared/types.js";
import { redact } from "../shared/redact.js";
import { CheckSchema, validateChecks } from "./schema.js";

export const APPROVAL_WORKFLOW_ID = "briefstamp-explicit-approval" as const;
export const APPROVAL_STEP_ID = "await-developer-approval" as const;
export const ApprovalWorkflowInputSchema = z
  .object({ brief: z.string().trim().min(1).max(12000) })
  .strict();
export type ApprovalWorkflowInput = z.infer<typeof ApprovalWorkflowInputSchema>;
const checkIdSchema = CheckSchema.innerType().shape.id;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const ApprovalResumeSchema = z
  .object({
    planDigest: digestSchema,
    approvedCheckIds: z
      .array(checkIdSchema)
      .min(1)
      .max(24)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Approval IDs must be unique.",
      ),
  })
  .strict();
const checksSchema = z.array(CheckSchema).min(1).max(24);
const planSchema = z
  .object({
    brief: z.string().min(1).max(12000),
    checks: checksSchema,
    checkIds: z.array(checkIdSchema).min(1).max(24),
    planDigest: digestSchema,
  })
  .strict();
const approvedSchema = z
  .object({
    brief: z.string().min(1).max(12000),
    approvedChecks: checksSchema,
    approvedCheckIds: z.array(checkIdSchema).min(1).max(24),
    planDigest: digestSchema,
  })
  .strict();
const suspendSchema = z
  .object({
    reason: z.literal(
      "Explicit developer approval is required before browser execution.",
    ),
    scope: z.literal("process-local"),
    checks: checksSchema,
    checkIds: z.array(checkIdSchema).min(1).max(24),
    planDigest: digestSchema,
  })
  .strict();
const resultSchema = z
  .object({
    checkId: checkIdSchema,
    requirement: z.string().max(6000),
    kind: CheckSchema.innerType().shape.kind,
    status: z.enum(["passed", "failed", "blocked", "unverified"]),
    expected: z.string().max(6000),
    durationMs: z.number().finite().nonnegative(),
    evidence: z
      .object({
        screenshot: z.string().max(2048).optional(),
        dom: z.string().max(120000).optional(),
        observed: z.string().max(12000),
        url: z.string().max(2048),
        viewport: z
          .object({
            width: z.number().int().positive().max(10000),
            height: z.number().int().positive().max(10000),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();
const outputSchema = z
  .object({
    results: z.array(resultSchema).min(1).max(24),
    approvedCheckIds: z.array(checkIdSchema).min(1).max(24),
    planDigest: digestSchema,
  })
  .strict();
export const BrowserDispatchSchema = z
  .object({
    reason: z.literal("Awaiting the actual external Chromium result."),
    scope: z.literal("process-local"),
    checks: checksSchema,
    context: z
      .object({
        brief: z.string().min(1).max(12000),
        planDigest: digestSchema,
        runId: z.string().uuid(),
      })
      .strict(),
  })
  .strict();
export const BrowserResumeSchema = z
  .object({
    planDigest: digestSchema,
    results: z.array(resultSchema).min(1).max(24),
  })
  .strict();
export interface ApprovalWorkflowOptions {
  /** Trusted host mode: second SDK suspension releases the heap before Chromium. */
  externalBrowser?: boolean;
  /** Trusted server injection; this callback must return unapproved proposals. */
  propose: (input: Readonly<ApprovalWorkflowInput>) => Promise<unknown>;
  /** Trusted safe browser adapter. No provider or runner is initialized by this module. */
  execute: (
    approvedChecks: Check[],
    context: Readonly<{ brief: string; planDigest: string; runId: string }>,
  ) => Promise<CheckResult[]>;
}
interface RunGate {
  brief: string;
  plan?: z.infer<typeof planSchema>;
  suspended: boolean;
  approved?: z.infer<typeof approvedSchema>;
  browserStarted: boolean;
}
const digest = (runId: string, brief: string, checks: Check[]) =>
  createHash("sha256")
    .update(JSON.stringify({ runId, brief, checks }))
    .digest("hex");
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}
function refused(): never {
  throw new Error("The immutable approval boundary refused this operation.");
}

/** Real SDK suspension with process-local one-shot guards; this is not a durable hosted approval service. */
export async function createApprovalWorkflow(options: ApprovalWorkflowOptions) {
  // Analytics are opted out before dynamic imports. This module is not imported
  // by the frontend and does not configure external storage.
  process.env.MASTRA_TELEMETRY_DISABLED = "1";
  const [{ Mastra }, { createWorkflow, createStep }] = await Promise.all([
    import("@mastra/core/mastra"),
    import("@mastra/core/workflows"),
  ]);
  const gates = new Map<string, RunGate>();
  const rawProposalSchema = z
    .object({ brief: z.string(), proposal: z.unknown() })
    .strict();
  const propose = createStep({
    id: "propose-checks",
    retries: 0,
    inputSchema: ApprovalWorkflowInputSchema,
    outputSchema: rawProposalSchema,
    execute: async ({ inputData, runId }) => {
      if (gates.has(runId)) return refused();
      gates.set(runId, {
        brief: inputData.brief,
        suspended: false,
        browserStarted: false,
      });
      try {
        const proposal = structuredClone(
          await options.propose(Object.freeze({ brief: inputData.brief })),
        );
        return { brief: inputData.brief, proposal };
      } catch {
        return refused();
      }
    },
  });
  const validate = createStep({
    id: "validate-proposal",
    retries: 0,
    inputSchema: rawProposalSchema,
    outputSchema: planSchema,
    execute: async ({ inputData, runId }) => {
      const gate = gates.get(runId);
      if (!gate || gate.plan || inputData.brief !== gate.brief)
        return refused();
      let checks: Check[];
      try {
        checks = validateChecks(inputData.proposal);
      } catch {
        return refused();
      }
      if (checks.some((check) => check.approved)) return refused();
      const plan = {
        brief: gate.brief,
        checks,
        checkIds: checks.map((check) => check.id),
        planDigest: digest(runId, gate.brief, checks),
      };
      gate.plan = freeze(structuredClone(plan));
      return structuredClone(plan);
    },
  });
  const approval = createStep({
    id: APPROVAL_STEP_ID,
    retries: 0,
    inputSchema: planSchema,
    outputSchema: approvedSchema,
    resumeSchema: ApprovalResumeSchema,
    suspendSchema,
    execute: async ({ inputData, resumeData, runId, suspend }) => {
      const gate = gates.get(runId);
      if (
        !gate?.plan ||
        !isDeepStrictEqual(gate.plan, inputData) ||
        gate.plan.planDigest !== digest(runId, gate.brief, gate.plan.checks) ||
        gate.approved ||
        gate.browserStarted
      )
        return refused();
      if (resumeData === undefined) {
        if (gate.suspended) return refused();
        gate.suspended = true;
        return suspend({
          reason:
            "Explicit developer approval is required before browser execution.",
          scope: "process-local",
          checks: structuredClone(gate.plan.checks),
          checkIds: [...gate.plan.checkIds],
          planDigest: gate.plan.planDigest,
        });
      }
      const parsed = ApprovalResumeSchema.safeParse(resumeData);
      if (
        !gate.suspended ||
        !parsed.success ||
        parsed.data.planDigest !== gate.plan.planDigest ||
        parsed.data.approvedCheckIds.some(
          (id) => !gate.plan!.checkIds.includes(id),
        )
      )
        return refused();
      const chosen = new Set(parsed.data.approvedCheckIds);
      const approvedChecks = gate.plan.checks
        .filter((check) => chosen.has(check.id))
        .map((check) => ({ ...check, approved: true }));
      const approved = {
        brief: gate.brief,
        approvedChecks,
        approvedCheckIds: approvedChecks.map((check) => check.id),
        planDigest: gate.plan.planDigest,
      };
      // Claim approval synchronously before returning control to the SDK.
      gate.approved = freeze(structuredClone(approved));
      return structuredClone(approved);
    },
  });
  const browser = createStep({
    id: "browser-handoff",
    retries: 0,
    inputSchema: approvedSchema,
    outputSchema,
    resumeSchema: BrowserResumeSchema,
    suspendSchema: BrowserDispatchSchema,
    execute: async ({ inputData, runId, resumeData, suspend }) => {
      const gate = gates.get(runId);
      if (!gate?.approved || !isDeepStrictEqual(gate.approved, inputData))
        return refused();
      const context = {
        brief: gate.brief,
        planDigest: gate.approved.planDigest,
        runId,
      };
      let results: CheckResult[];
      if (options.externalBrowser) {
        if (resumeData === undefined) {
          if (gate.browserStarted) return refused();
          gate.browserStarted = true;
          return suspend({
            reason: "Awaiting the actual external Chromium result.",
            scope: "process-local",
            checks: structuredClone(gate.approved.approvedChecks),
            context,
          });
        }
        const parsed = BrowserResumeSchema.safeParse(resumeData);
        if (
          !gate.browserStarted ||
          !parsed.success ||
          parsed.data.planDigest !== gate.approved.planDigest
        )
          return refused();
        results = parsed.data.results;
      } else {
        if (gate.browserStarted || resumeData !== undefined) return refused();
        // Ambiguous execution remains consumed, including errors and bad output.
        gate.browserStarted = true;
        try {
          results = z
            .array(resultSchema)
            .min(1)
            .max(24)
            .parse(
              await options.execute(
                structuredClone(gate.approved.approvedChecks),
                Object.freeze(context),
              ),
            );
        } catch {
          return refused();
        }
      }
      if (
        results.length !== gate.approved.approvedChecks.length ||
        gate.approved.approvedChecks.some(
          (check) =>
            results.filter(
              (result) =>
                result.checkId === check.id &&
                result.kind === check.kind &&
                result.requirement === redact(check.requirement) &&
                result.expected === redact(check.expected) &&
                (check.kind !== "manual" || result.status === "unverified"),
            ).length !== 1,
        )
      )
        return refused();
      return {
        results,
        approvedCheckIds: [...gate.approved.approvedCheckIds],
        planDigest: gate.approved.planDigest,
      };
    },
  });
  const workflow = createWorkflow({
    id: APPROVAL_WORKFLOW_ID,
    inputSchema: ApprovalWorkflowInputSchema,
    outputSchema,
    retryConfig: { attempts: 0, delay: 0 },
    options: {
      autoRestartActiveRuns: false,
      allowUnclaimedResumes: true,
      validateInputs: true,
    },
  })
    .then(propose)
    .then(validate)
    .then(approval)
    .then(browser)
    .commit();
  // The Mastra registration supplies the SDK in-memory snapshot store needed
  // for real resume. This store is intentionally lost with the worker process.
  const mastra = new Mastra({
    logger: false,
    workflows: { approval: workflow },
  });
  return {
    workflow: mastra.getWorkflow("approval"),
    approvalStepId: APPROVAL_STEP_ID,
    scope: "process-local" as const,
    async exportSnapshot(runId: string): Promise<WorkflowRunState> {
      const store = await mastra.getStorage()?.getStore("workflows");
      const snapshot = await store?.loadWorkflowSnapshot({
        workflowName: APPROVAL_WORKFLOW_ID,
        runId,
      });
      if (!snapshot || snapshot.status !== "suspended" || !gates.has(runId))
        return refused();
      return JSON.parse(JSON.stringify(snapshot)) as WorkflowRunState;
    },
    /** Trusted server checkpoint only. Never expose this import as an HTTP API. */
    async restoreSnapshot(snapshot: WorkflowRunState) {
      if (
        !options.externalBrowser ||
        snapshot.status !== "suspended" ||
        gates.has(snapshot.runId)
      )
        return refused();
      const validatedStep = snapshot.context["validate-proposal"];
      if (validatedStep?.status !== "success") return refused();
      const plan = planSchema.parse(validatedStep.output);
      const brief = ApprovalWorkflowInputSchema.parse(
        snapshot.context.input,
      ).brief;
      const checks = validateChecks(plan.checks);
      if (
        brief !== plan.brief ||
        checks.some((c) => c.approved) ||
        plan.planDigest !== digest(snapshot.runId, brief, checks) ||
        !isDeepStrictEqual(
          plan.checkIds,
          checks.map((c) => c.id),
        )
      )
        return refused();
      let approved: z.infer<typeof approvedSchema> | undefined;
      let browserStarted = false;
      if (snapshot.context[APPROVAL_STEP_ID]?.status === "success") {
        approved = approvedSchema.parse(
          snapshot.context[APPROVAL_STEP_ID]?.output,
        );
        const expected = checks
          .filter((c) => approved!.approvedCheckIds.includes(c.id))
          .map((c) => ({ ...c, approved: true }));
        if (
          approved.brief !== brief ||
          approved.planDigest !== plan.planDigest ||
          !isDeepStrictEqual(approved.approvedChecks, expected) ||
          !isDeepStrictEqual(
            approved.approvedCheckIds,
            expected.map((c) => c.id),
          ) ||
          snapshot.context["browser-handoff"]?.status !== "suspended"
        )
          return refused();
        const dispatch = BrowserDispatchSchema.parse(
          snapshot.context["browser-handoff"].suspendPayload,
        );
        if (
          !isDeepStrictEqual(dispatch.checks, expected) ||
          !isDeepStrictEqual(dispatch.context, {
            brief,
            planDigest: plan.planDigest,
            runId: snapshot.runId,
          })
        )
          return refused();
        browserStarted = true;
      } else if (snapshot.context[APPROVAL_STEP_ID]?.status !== "suspended")
        return refused();
      gates.set(snapshot.runId, {
        brief,
        plan: freeze(structuredClone(plan)),
        suspended: true,
        ...(approved ? { approved: freeze(structuredClone(approved)) } : {}),
        browserStarted,
      });
      const store = await mastra.getStorage()?.getStore("workflows");
      if (!store) return refused();
      await store.persistWorkflowSnapshot({
        workflowName: APPROVAL_WORKFLOW_ID,
        runId: snapshot.runId,
        snapshot: structuredClone(snapshot),
      });
    },
  };
}

export {
  suspendSchema as ApprovalSuspensionSchema,
  outputSchema as ApprovalOutputSchema,
};
