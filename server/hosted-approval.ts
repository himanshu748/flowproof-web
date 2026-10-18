import { fork, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { WorkflowRunState } from "@mastra/core/workflows";
import {
  APPROVAL_WORKFLOW_ID,
  ApprovalWorkflowInputSchema,
  ApprovalResumeSchema,
  ApprovalSuspensionSchema,
  ApprovalOutputSchema,
  BrowserDispatchSchema,
  type ApprovalWorkflowOptions,
} from "./approval-workflow.js";
import { validateChecks } from "./schema.js";
export const HOSTED_APPROVAL_TTL_MS = 5 * 60_000;
const LifecycleSchema = z
  .object({
    phase: z.enum(["approval", "browser", "complete"]),
    status: z.enum(["suspended", "success", "failed"]),
    runId: z.string().uuid(),
    snapshotSha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    workerMaxRssMiB: z.number().positive(),
    workerExited: z.literal(true),
  })
  .strict();
export const HostedApprovalReceiptSchema = z
  .object({
    provider: z.literal("Mastra"),
    package: z.literal("@mastra/core"),
    version: z.literal("1.77.0"),
    workflowId: z.literal(APPROVAL_WORKFLOW_ID),
    runId: z.string().uuid(),
    status: z.enum(["suspended", "success", "failed"]),
    scope: z.literal("process-local"),
    durable: z.literal(false),
    maxRssMiB: z.number().finite().positive().max(2048),
    steps: z
      .array(
        z
          .object({ id: z.string().max(80), status: z.string().max(40) })
          .strict(),
      )
      .max(4),
    suspension: ApprovalSuspensionSchema.optional(),
    dispatch: BrowserDispatchSchema.optional(),
    result: ApprovalOutputSchema.optional(),
    lifecycle: z.array(LifecycleSchema).max(3).optional(),
  })
  .strict();
export type HostedApprovalReceipt = z.infer<typeof HostedApprovalReceiptSchema>;
export interface HostedApprovalOptions extends ApprovalWorkflowOptions {
  onCheckpoint?: (
    phase: "approval" | "browser",
    snapshot: WorkflowRunState,
  ) => Promise<void> | void;
  brief: string;
  expiresAt?: number;
}
export class HostedApprovalError extends Error {
  constructor(readonly code: string) {
    super("The bounded approval workflow could not complete.");
    this.name = "HostedApprovalError";
  }
}
let leased = false;
export function hostedApprovalBusy(): boolean {
  return leased;
}
/**
 * Real native snapshot round trips through documented Mastra storage methods:
 * https://mastra.ai/docs/workflows/snapshots . The parent retains snapshots only
 * in memory. Every SDK child exits before review or Chromium; no persistent
 * credential, remote store, or cross-server durability is configured.
 */
export function createHostedApprovalRun(options: HostedApprovalOptions) {
  const input = ApprovalWorkflowInputSchema.parse({ brief: options.brief });
  const expiry = Math.min(
    options.expiresAt ?? Infinity,
    Date.now() + HOSTED_APPROVAL_TTL_MS,
  );
  if (expiry <= Date.now()) throw new HostedApprovalError("approval_expired");
  if (leased) throw new HostedApprovalError("approval_worker_busy");
  leased = true;
  let disposed = false,
    started = false,
    claimed = false,
    busy = false;
  let child: ChildProcess | undefined;
  let closed: Promise<void> | undefined;
  let failure: HostedApprovalError | undefined;
  let snapshot: WorkflowRunState | undefined;
  let receipt: HostedApprovalReceipt | undefined;
  let proposalCalls = 0,
    browserCalls = 0;
  const lifecycle: z.infer<typeof LifecycleSchema>[] = [];
  const guard = () => {
    if (failure || disposed || expiry <= Date.now())
      throw failure ?? new HostedApprovalError("approval_unavailable");
  };
  const dispose = async (code = "approval_disposed") => {
    disposed = true;
    failure ??= new HostedApprovalError(code);
    clearTimeout(lifetime);
    if (child) {
      child.kill("SIGTERM");
      const kill = setTimeout(() => child?.kill("SIGKILL"), 1000);
      kill.unref();
      await closed;
      clearTimeout(kill);
    }
    snapshot = undefined;
    leased = false;
  };
  const lifetime = setTimeout(() => {
    void dispose("approval_expired");
  }, expiry - Date.now());
  lifetime.unref();
  const runChild = async (
    command: object,
    phase: "approval" | "browser" | "complete",
  ) => {
    guard();
    if (Buffer.byteLength(JSON.stringify(command)) > 512 * 1024)
      throw new HostedApprovalError("approval_input_budget");
    if (busy || child) throw new HostedApprovalError("approval_operation_busy");
    busy = true;
    let result:
      | { receipt: HostedApprovalReceipt; snapshot?: WorkflowRunState }
      | undefined;
    let error: HostedApprovalError | undefined;
    let bytes = 0,
      messages = 0,
      diagnostics = 0;
    const activeChild = (child = fork(
      fileURLToPath(
        new URL(
          "../dist-approval-worker/hosted-approval-child.js",
          import.meta.url,
        ),
      ),
      [],
      {
        execArgv: ["--max-old-space-size=128"],
        env: { NODE_ENV: "production", MASTRA_TELEMETRY_DISABLED: "1" },
        stdio: ["ignore", "pipe", "pipe", "ipc"],
        serialization: "json",
      },
    ));
    let closeResolve!: () => void;
    closed = new Promise<void>((resolve) => {
      closeResolve = resolve;
    });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (code: string) => {
      error ??= new HostedApprovalError(code);
      activeChild.kill("SIGTERM");
      killTimer ??= setTimeout(() => activeChild.kill("SIGKILL"), 1000);
      killTimer.unref();
    };
    const deadline = setTimeout(
      () => stop("approval_operation_deadline"),
      90_000,
    );
    deadline.unref();
    for (const pipe of [activeChild.stdout, activeChild.stderr])
      pipe?.on("data", (chunk: Buffer) => {
        diagnostics += chunk.length;
        if (diagnostics > 16 * 1024) stop("approval_diagnostic_budget");
      });
    activeChild.on("error", () => stop("approval_worker_unavailable"));
    activeChild.on("message", async (value: any) => {
      if (error || disposed) return;
      bytes += Buffer.byteLength(JSON.stringify(value));
      if (++messages > 2 || bytes > 512 * 1024)
        return stop("approval_message_budget");
      try {
        if (value?.type === "receipt") {
          if (result) throw new Error("duplicate receipt");
          const parsed = HostedApprovalReceiptSchema.parse(value.receipt);
          if (receipt && parsed.runId !== receipt.runId)
            throw new Error("changed run");
          result = {
            receipt: parsed,
            ...(value.snapshot
              ? { snapshot: value.snapshot as WorkflowRunState }
              : {}),
          };
          return;
        }
        const request = z
          .object({
            type: z.literal("request"),
            id: z.literal(1),
            operation: z.literal("propose"),
            payload: ApprovalWorkflowInputSchema,
          })
          .strict()
          .parse(value);
        if (
          phase !== "approval" ||
          proposalCalls++ !== 0 ||
          !isDeepStrictEqual(request.payload, input)
        )
          throw new Error("invalid proposal request");
        const proposal = validateChecks(
          await options.propose(Object.freeze(structuredClone(input))),
        );
        if (proposal.some((c) => c.approved))
          throw new Error("preapproved proposal");
        guard();
        if (activeChild.connected && !error)
          activeChild.send({
            type: "response",
            id: 1,
            ok: true,
            result: proposal,
          });
      } catch {
        stop("approval_port_or_receipt_failed");
      }
    });
    activeChild.on("close", (code) => {
      if (code !== 0)
        error ??= new HostedApprovalError("approval_worker_failed");
      closeResolve();
    });
    activeChild.send(command, (sendError) => {
      if (sendError) stop("approval_ipc_unavailable");
    });
    await closed;
    child = undefined;
    busy = false;
    clearTimeout(deadline);
    if (killTimer) clearTimeout(killTimer);
    guard();
    if (error || !result)
      throw error ?? new HostedApprovalError("approval_worker_failed");
    const next = result as {
      receipt: HostedApprovalReceipt;
      snapshot?: WorkflowRunState;
    };
    if (next.receipt.status === "suspended") {
      if (
        !next.snapshot ||
        next.snapshot.runId !== next.receipt.runId ||
        next.snapshot.status !== "suspended"
      )
        throw new HostedApprovalError("approval_invalid_snapshot");
      if (phase === "complete")
        throw new HostedApprovalError("approval_unexpected_checkpoint");
      await options.onCheckpoint?.(phase, structuredClone(next.snapshot));
    }
    lifecycle.push({
      phase,
      status: next.receipt.status,
      runId: next.receipt.runId,
      snapshotSha256: next.snapshot
        ? createHash("sha256")
            .update(JSON.stringify(next.snapshot))
            .digest("hex")
        : null,
      workerMaxRssMiB: next.receipt.maxRssMiB,
      workerExited: true,
    });
    return next;
  };
  return {
    async start() {
      if (started) throw new HostedApprovalError("approval_already_started");
      started = true;
      try {
        const outcome = await runChild({ type: "start", input }, "approval");
        if (
          outcome.receipt.status !== "suspended" ||
          !outcome.receipt.suspension ||
          proposalCalls !== 1
        )
          throw new HostedApprovalError("approval_not_suspended");
        snapshot = outcome.snapshot;
        receipt = { ...outcome.receipt, lifecycle: structuredClone(lifecycle) };
        return structuredClone(receipt);
      } catch (error) {
        await dispose("approval_start_failed");
        throw error;
      }
    },
    async resume(value: unknown) {
      guard();
      const approval = ApprovalResumeSchema.parse(value);
      if (
        claimed ||
        !receipt?.suspension ||
        receipt.status !== "suspended" ||
        !snapshot
      )
        throw new HostedApprovalError("approval_not_suspended");
      if (
        approval.planDigest !== receipt.suspension.planDigest ||
        approval.approvedCheckIds.some(
          (id) => !receipt!.suspension!.checkIds.includes(id),
        )
      )
        throw new HostedApprovalError("approval_plan_changed");
      claimed = true;
      try {
        const approvedChecks = receipt.suspension.checks
          .filter((c) => approval.approvedCheckIds.includes(c.id))
          .map((c) => ({ ...c, approved: true }));
        const context = {
          brief: input.brief,
          planDigest: approval.planDigest,
          runId: receipt.runId,
        };
        const dispatch = await runChild(
          { type: "resume", input: approval, snapshot },
          "browser",
        );
        if (
          dispatch.receipt.status !== "suspended" ||
          !dispatch.receipt.dispatch ||
          !isDeepStrictEqual(
            dispatch.receipt.dispatch.checks,
            approvedChecks,
          ) ||
          !isDeepStrictEqual(dispatch.receipt.dispatch.context, context)
        )
          throw new HostedApprovalError("approval_dispatch_changed");
        snapshot = dispatch.snapshot;
        // runChild resolves only on process close: there is no SDK heap alive
        // while the real safe runner executes. Ambiguous handoffs are one-shot.
        if (child || browserCalls++ !== 0)
          throw new HostedApprovalError("approval_repeated_browser");
        let results;
        try {
          results = await options.execute(
            structuredClone(approvedChecks),
            Object.freeze(context),
          );
        } catch {
          throw new HostedApprovalError("approval_port_or_receipt_failed");
        }
        guard();
        const completed = await runChild(
          {
            type: "complete",
            input: { planDigest: approval.planDigest, results },
            snapshot,
          },
          "complete",
        );
        if (
          completed.receipt.status !== "success" ||
          !completed.receipt.result ||
          completed.receipt.result.planDigest !== approval.planDigest ||
          !isDeepStrictEqual(
            completed.receipt.result.approvedCheckIds,
            approvedChecks.map((c) => c.id),
          )
        )
          throw new HostedApprovalError("approval_completion_failed");
        receipt = {
          ...completed.receipt,
          lifecycle: structuredClone(lifecycle),
        };
        return structuredClone(receipt);
      } finally {
        await dispose();
      }
    },
    get receipt() {
      return receipt ? structuredClone(receipt) : undefined;
    },
    get expiresAt() {
      return expiry;
    },
    dispose,
  };
}
export type HostedApprovalRun = ReturnType<typeof createHostedApprovalRun>;
