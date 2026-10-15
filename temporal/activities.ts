import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import {
  appendFile,
  mkdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { ZodError } from "zod";
import { runAudit } from "../server/runner.js";
import { renderReport } from "../server/report.js";
import { SAMPLE_URL } from "../server/sample.js";
import { SafetyError } from "../server/safety.js";
import { validateApprovedAudit } from "./validation.js";
import type { AuditActivityResult, AuditWorkflowInput } from "./contracts.js";

type ActivityContext = {
  info: {
    attempt: number;
    workflowExecution: { workflowId: string; runId: string };
  };
  heartbeat(details?: unknown): void;
};
export interface AuditActivityOptions {
  evidenceRoot: string;
  receiptRoot: string;
  attemptLog?: string;
  /** A trusted local proof process supplies this exact workflow ID, never an API request. */
  transientFailureWorkflowId?: string;
  context?: () => ActivityContext;
  execute?: typeof runAudit;
}
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
export function createAuditActivities(options: AuditActivityOptions) {
  return {
    async executeApprovedAudit(
      input: AuditWorkflowInput,
    ): Promise<AuditActivityResult> {
      const context = options.context?.() ?? Context.current();
      if (!context.info.workflowExecution)
        throw ApplicationFailure.nonRetryable(
          "An audit activity requires a workflow execution.",
          "AuditSafetyError",
        );
      const { workflowId, runId } = context.info.workflowExecution;
      const log = async (event: string) => {
        if (!options.attemptLog) return;
        await mkdir(path.dirname(options.attemptLog), { recursive: true });
        await appendFile(
          options.attemptLog,
          JSON.stringify({
            event,
            at: new Date().toISOString(),
            pid: process.pid,
            workflowId,
            runId,
            auditId: input.audit.id,
            attempt: context.info.attempt,
          }) + "\n",
          { mode: 0o600 },
        );
      };
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      try {
        const planSha256 = validateApprovedAudit(input);
        await log("activity-start");
        const folder = path.join(options.receiptRoot, input.audit.id);
        const completed = path.join(folder, "completed.json");
        try {
          const cached = JSON.parse(
            await readFile(completed, "utf8"),
          ) as AuditActivityResult;
          if (cached.planSha256 !== planSha256)
            throw new SafetyError(
              "The persisted audit belongs to a different approved snapshot.",
            );
          if (
            cached.audit.status !== "completed" ||
            cached.audit.id !== input.audit.id ||
            JSON.stringify(cached.audit.checks) !==
              JSON.stringify(input.audit.checks)
          )
            throw new Error(
              "The cached audit is incomplete or has a different identity.",
            );
          if (
            hash(await readFile(path.join(folder, "report.html"))) !==
            cached.reportSha256
          )
            throw new Error("The cached report bytes have changed.");
          for (const screenshot of cached.screenshots) {
            if (!/^[a-zA-Z0-9_-]+\.png$/.test(screenshot.filename))
              throw new SafetyError("Invalid persisted screenshot path.");
            if (
              hash(
                await readFile(
                  path.join(
                    options.evidenceRoot,
                    input.audit.id,
                    screenshot.filename,
                  ),
                ),
              ) !== screenshot.sha256
            )
              throw new Error("Cached screenshot evidence changed.");
          }
          await log("completed-result-reused");
          return cached;
        } catch (error) {
          // Only a missing completion receipt permits a new browser execution.
          if (
            (error as NodeJS.ErrnoException).code !== "ENOENT" ||
            (error as NodeJS.ErrnoException).path !== completed
          )
            throw error;
        }
        if (
          workflowId === options.transientFailureWorkflowId &&
          context.info.attempt === 1
        ) {
          if (
            input.project.target !== "sample" ||
            input.project.url !== SAMPLE_URL
          )
            throw new SafetyError(
              "Failure injection is restricted to the synthetic recovery demonstration.",
            );
          await log("injected-transient-failure-before-browser");
          throw ApplicationFailure.create({
            message: "Controlled transient failure before browser execution.",
            type: "TransientAuditFailure",
            nonRetryable: false,
          });
        }
        context.heartbeat({ auditId: input.audit.id, phase: "browser" });
        heartbeat = setInterval(
          () =>
            context.heartbeat({ auditId: input.audit.id, phase: "browser" }),
          5_000,
        );
        await log("browser-start");
        const audit = structuredClone(input.audit);
        audit.status = "running";
        audit.results = await (options.execute ?? runAudit)(
          input.project,
          audit,
          (result) => {
            context.heartbeat({
              auditId: audit.id,
              checkId: result.checkId,
              status: result.status,
            });
          },
          { evidenceRoot: options.evidenceRoot },
        );
        audit.status = "completed";
        audit.completedAt = new Date().toISOString();
        const readImage = async (imagePath: string) => {
          const prefix = `/evidence/${audit.id}/`;
          if (
            !imagePath.startsWith(prefix) ||
            !/^[a-zA-Z0-9_-]+\.png$/.test(imagePath.slice(prefix.length))
          )
            return null;
          return readFile(
            path.join(
              options.evidenceRoot,
              audit.id,
              imagePath.slice(prefix.length),
            ),
          ).catch(() => null);
        };
        const report = await renderReport(audit, readImage);
        const screenshots: AuditActivityResult["screenshots"] = [];
        for (const result of audit.results) {
          if (!result.evidence.screenshot) continue;
          const bytes = await readImage(result.evidence.screenshot);
          if (!bytes) throw new Error("Recorded screenshot is unavailable.");
          screenshots.push({
            filename: path.basename(result.evidence.screenshot),
            sha256: hash(bytes),
          });
        }
        const result = {
          audit,
          planSha256,
          reportSha256: hash(report),
          screenshots,
        };
        await mkdir(folder, { recursive: true });
        await writeFile(path.join(folder, "report.html"), report, {
          mode: 0o600,
        });
        await writeFile(
          `${completed}.tmp`,
          JSON.stringify(result, null, 2) + "\n",
          { mode: 0o600 },
        );
        await rename(`${completed}.tmp`, completed);
        await log("activity-completed");
        return result;
      } catch (error) {
        if (error instanceof SafetyError || error instanceof ZodError)
          throw ApplicationFailure.nonRetryable(
            error.message,
            error instanceof SafetyError
              ? "AuditSafetyError"
              : "InvalidAuditPlan",
          );
        throw error;
      } finally {
        if (heartbeat) clearInterval(heartbeat);
      }
    },
  };
}
