import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import { NativeConnection, Worker } from "@temporalio/worker";
import { createEvidenceAgentActivities } from "../temporal/agent-activities.js";
import type {
  EvidenceAgentPhaseRequest,
  EvidenceAgentTurn,
  FailureHistoryRow,
  SearchVisibilityResult,
} from "../server/evidence-agent.js";

const { values } = parseArgs({
  options: {
    address: { type: "string" },
    journal: { type: "string" },
    faults: { type: "string" },
    queue: { type: "string" },
  },
});
assert(
  values.address &&
    /^127\.0\.0\.1:\d+$/.test(values.address) &&
    values.journal &&
    values.faults &&
    values.queue,
  "Use an explicit loopback dev server and dedicated fixture journal.",
);
const fixtureUrl = new URL(
  "../docs/evidence/judge-agent/2026-10-16T13-07-24Z/attempt-2/agent-run.json",
  import.meta.url,
);
const raw = await readFile(fixtureUrl);
const recorded = JSON.parse(raw.toString());
const faults = JSON.parse(await readFile(values.faults, "utf8"));
const activities = createEvidenceAgentActivities({
  journalRoot: values.journal,
  provenance: {
    kind: "retained-native-receipt-fixture",
    receiptSha256: createHash("sha256").update(raw).digest("hex"),
    source:
      "docs/evidence/judge-agent/2026-10-16T13-07-24Z/attempt-2/agent-run.json",
  },
  faults,
  generate: async (
    request: EvidenceAgentPhaseRequest,
  ): Promise<EvidenceAgentTurn> => {
    assert.equal(
      request.audit.auditId,
      recorded.sourceAuditId,
      "Recorded model output must match its original audit.",
    );
    const turn = recorded.modelTurns.find(
      (item: any) => item.phase === request.phase,
    )?.result;
    assert(turn);
    return structuredClone(turn);
  },
  failureHistory: async (queryId): Promise<FailureHistoryRow[]> => {
    const rows = recorded.toolReceipts.find(
      (item: any) => item.tool === "failure_history",
    )?.result;
    assert(Array.isArray(rows) && rows.every((row) => row.queryId === queryId));
    return structuredClone(rows);
  },
  searchVisibility: async (): Promise<SearchVisibilityResult> => {
    const result = recorded.toolReceipts.find(
      (item: any) => item.tool === "search_visibility",
    )?.result;
    assert(result);
    return structuredClone(result);
  },
});
const connection = await NativeConnection.connect({ address: values.address });
try {
  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: values.queue,
    workflowsPath: fileURLToPath(
      new URL("../temporal/agent-workflows.ts", import.meta.url),
    ),
    activities,
    maxConcurrentActivityTaskExecutions: 1,
    maxConcurrentActivityTaskPolls: 1,
    maxConcurrentWorkflowTaskExecutions: 2,
    maxCachedWorkflows: 5,
    shutdownGraceTime: "5 seconds",
  });
  process.once("SIGTERM", () => worker.shutdown());
  process.once("SIGINT", () => worker.shutdown());
  await worker.run();
} finally {
  await connection.close();
}
