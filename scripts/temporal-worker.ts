import { NativeConnection, Worker } from "@temporalio/worker";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createAuditActivities } from "../temporal/activities.js";
import { temporalConfiguration } from "../temporal/config.js";
import { AUDIT_TASK_QUEUE } from "../temporal/contracts.js";

const config = temporalConfiguration();
const dataRoot = path.resolve(process.env.FLOWPROOF_DATA_DIR || "data");
const connection = await NativeConnection.connect({ address: config.address });
try {
  const worker = await Worker.create({
    connection,
    namespace: config.namespace,
    taskQueue: AUDIT_TASK_QUEUE,
    workflowsPath: fileURLToPath(
      new URL("../temporal/workflows.ts", import.meta.url),
    ),
    activities: createAuditActivities({
      evidenceRoot: path.resolve(
        process.env.EVIDENCE_ROOT || path.join(dataRoot, "evidence"),
      ),
      receiptRoot: path.resolve(
        process.env.FLOWPROOF_TEMPORAL_RECEIPT_ROOT ||
          path.join(dataRoot, "temporal"),
      ),
      attemptLog: process.env.FLOWPROOF_TEMPORAL_ATTEMPT_LOG,
      transientFailureWorkflowId:
        process.env.FLOWPROOF_TEMPORAL_PROOF_WORKFLOW_ID,
    }),
    maxConcurrentActivityTaskExecutions: 1,
    maxConcurrentActivityTaskPolls: 1,
    maxConcurrentWorkflowTaskExecutions: 2,
    maxCachedWorkflows: 10,
    shutdownGraceTime: "10 seconds",
  });
  const shutdown = () => worker.shutdown();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  console.log(
    JSON.stringify({
      event: "worker-ready",
      pid: process.pid,
      taskQueue: AUDIT_TASK_QUEUE,
      address: config.address,
    }),
  );
  await worker.run();
} finally {
  await connection.close();
}
