import { Client, Connection, WorkflowIdReusePolicy } from "@temporalio/client";
import { temporalConfiguration } from "./config.js";
import { validateApprovedAudit } from "./validation.js";
import {
  AUDIT_TASK_QUEUE,
  AUDIT_WORKFLOW,
  type AuditWorkflowInput,
  type AuditWorkflowProgress,
  type AuditActivityResult,
  type TemporalDispatch,
} from "./contracts.js";
import type { approvedAuditWorkflow } from "./workflows.js";
import type { Audit, Project } from "../shared/types.js";

export async function startApprovedAudit(
  project: Project,
  audit: Audit,
): Promise<TemporalDispatch> {
  const input: AuditWorkflowInput = {
    project: structuredClone(project),
    audit: structuredClone(audit),
  };
  validateApprovedAudit(input);
  const config = temporalConfiguration();
  const connection = await Connection.connect({
    address: config.address,
    connectTimeout: "5 seconds",
  });
  try {
    const client = new Client({ connection, namespace: config.namespace });
    const handle = await connection.withDeadline(Date.now() + 5_000, () =>
      client.workflow.start<typeof approvedAuditWorkflow>(AUDIT_WORKFLOW, {
        args: [input],
        workflowId: `briefstamp-audit-${audit.id}`,
        taskQueue: AUDIT_TASK_QUEUE,
        workflowExecutionTimeout: "20 minutes",
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
      }),
    );
    return { workflowId: handle.workflowId, runId: handle.firstExecutionRunId };
  } finally {
    await connection.close();
  }
}

export async function readTemporalAudit(
  workflowId: string,
): Promise<{
  status: string;
  runId: string;
  progress?: AuditWorkflowProgress;
  result?: AuditActivityResult;
}> {
  if (!/^briefstamp-audit-[a-zA-Z0-9_-]{1,80}$/.test(workflowId))
    throw new Error("Invalid Temporal audit workflow identity.");
  const config = temporalConfiguration();
  const connection = await Connection.connect({
    address: config.address,
    connectTimeout: "5 seconds",
  });
  try {
    const client = new Client({ connection, namespace: config.namespace });
    const handle =
      client.workflow.getHandle<typeof approvedAuditWorkflow>(workflowId);
    const description = await connection.withDeadline(Date.now() + 3_000, () =>
      handle.describe(),
    );
    if (description.status.name === "COMPLETED")
      return {
        status: "completed",
        runId: description.runId,
        result: await connection.withDeadline(Date.now() + 3_000, () =>
          handle.result(),
        ),
      };
    if (description.status.name !== "RUNNING")
      return {
        status: description.status.name.toLowerCase(),
        runId: description.runId,
      };
    // Queries need an available worker. API reads stay bounded while workers are down.
    return { status: "running", runId: description.runId };
  } finally {
    await connection.close();
  }
}
