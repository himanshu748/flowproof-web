import { Client, Connection } from "@temporalio/client";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat, statfs, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { SAMPLE_BRIEF, SAMPLE_URL, sampleChecks } from "../server/sample.js";
import { snapshotSource } from "../shared/compare-audits.js";
import {
  AUDIT_TASK_QUEUE,
  AUDIT_WORKFLOW,
  PROGRESS_QUERY,
  RECOVERY_SIGNAL,
  type AuditActivityResult,
  type AuditWorkflowProgress,
} from "../temporal/contracts.js";
import type { approvedAuditWorkflow } from "../temporal/workflows.js";
import type { Audit, Project } from "../shared/types.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: { cli: { type: "string" }, output: { type: "string" } },
});
if (!values.cli || !values.output)
  throw new Error(
    "Use --cli <official Temporal CLI binary> --output <new proof directory>. This command uses only a local development server.",
  );
const output = path.resolve(values.output);
await mkdir(output, { recursive: false });
const filename = path.join(output, "temporal-verification.json");
const receipt: Record<string, unknown> = {
  schemaVersion: 1,
  integration: "Temporal",
  status: "running",
  startedAt: new Date().toISOString(),
  source:
    "Real Temporal TypeScript SDK with a local CLI development server and persisted SQLite history",
  scope: "Approved synthetic fixture only; no Temporal Cloud or paid resources",
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: root,
    encoding: "utf8",
  }).trim(),
  limitations: [
    "Local development-server recovery is not a production availability guarantee.",
    "The deliberately injected failure occurs before the browser starts. The proof demonstrates completed activity reuse after worker and server restart, not recovery from every possible mid-browser crash.",
  ],
};
const save = () => writeFile(filename, JSON.stringify(receipt, null, 2) + "\n");
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
};
let server: ChildProcess | undefined,
  worker: ChildProcess | undefined,
  connection: Connection | undefined;
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null || child.signalCode) return;
  const exited = new Promise<void>((resolve) =>
    child.once("exit", () => resolve()),
  );
  child.kill("SIGTERM");
  await Promise.race([exited, delay(15_000)]);
  if (child.exitCode === null && !child.signalCode) {
    child.kill("SIGKILL");
    await Promise.race([exited, delay(3_000)]);
  }
  assert(
    child.exitCode !== null || child.signalCode,
    "A proof child process did not stop.",
  );
}
function child(
  command: string,
  args: string[],
  label: string,
  env = process.env,
) {
  const stream = createWriteStream(path.join(output, `${label}.log`), {
    flags: "wx",
    mode: 0o600,
  });
  const processChild = spawn(command, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  processChild.stdout?.pipe(stream, { end: false });
  processChild.stderr?.pipe(stream, { end: false });
  processChild.once("exit", () => stream.end());
  processChild.once("error", (error) => {
    stream.end(`${error.name}: ${error.message}\n`);
    receipt.processErrors = [
      ...((receipt.processErrors as unknown[]) || []),
      { process: label, error: error.message },
    ];
  });
  return processChild;
}
async function waitFor<T>(
  operation: () => Promise<T>,
  accept: (value: T) => boolean,
  milliseconds = 45_000,
): Promise<T> {
  const deadline = Date.now() + milliseconds;
  let error: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await operation();
      if (accept(value)) return value;
    } catch (cause) {
      error = cause;
    }
    await delay(400);
  }
  throw new Error(
    `Local Temporal readiness deadline exceeded${error instanceof Error ? ` (${error.name})` : ""}.`,
  );
}
async function connect(address: string) {
  return waitFor(
    () => Connection.connect({ address, connectTimeout: "1 second" }),
    () => true,
  );
}
async function freePort() {
  const socket = createServer();
  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.listen(0, "127.0.0.1", resolve);
  });
  const port = (socket.address() as { port: number }).port;
  await new Promise<void>((resolve) => socket.close(() => resolve()));
  return port;
}
function serialize(value: unknown) {
  return JSON.parse(
    JSON.stringify(value, (_key, entry) =>
      typeof entry === "bigint" ? entry.toString() : entry,
    ),
  );
}
async function filesMatch(result: AuditActivityResult) {
  const report = await readFile(
    path.join(output, "receipts", result.audit.id, "report.html"),
  );
  assert(
    hash(report) === result.reportSha256,
    "Report bytes changed across recovery.",
  );
  assert(
    report.includes("data:image/png;base64,"),
    "The report has no embedded screenshot evidence.",
  );
  for (const screenshot of result.screenshots)
    assert(
      hash(
        await readFile(
          path.join(output, "evidence", result.audit.id, screenshot.filename),
        ),
      ) === screenshot.sha256,
      "Screenshot bytes changed across recovery.",
    );
}
try {
  const space = await statfs(output);
  assert(
    space.bavail * space.bsize >= 128 * 1024 * 1024,
    "Less than 128 MiB available for the local SQLite server; execution not attempted.",
  );
  receipt.cliVersion = execFileSync(path.resolve(values.cli), ["--version"], {
    encoding: "utf8",
  }).trim();
  receipt.cliBinarySha256 = hash(await readFile(path.resolve(values.cli)));
  const sourceFiles = [
    "temporal/contracts.ts",
    "temporal/config.ts",
    "temporal/validation.ts",
    "temporal/workflows.ts",
    "temporal/activities.ts",
    "temporal/client.ts",
    "scripts/temporal-worker.ts",
    "scripts/verify-temporal.ts",
    "server/runner.ts",
    "server/schema.ts",
    "server/sample.ts",
    "server/report.ts",
  ];
  receipt.sourceFiles = await Promise.all(
    sourceFiles.map(async (file) => ({
      file,
      sha256: hash(await readFile(path.join(root, file))),
    })),
  );
  const port = await freePort(),
    address = `127.0.0.1:${port}`;
  const db = path.join(output, "temporal.sqlite");
  const cli = path.resolve(values.cli);
  const serverArgs = [
    "server",
    "start-dev",
    "--ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--headless",
    "--db-filename",
    db,
    "--log-level",
    "error",
  ];
  server = child(cli, serverArgs, "server-before");
  connection = await connect(address);
  const client = new Client({ connection, namespace: "default" });
  const createdAt = new Date().toISOString(),
    auditId = randomUUID();
  const project: Project = {
    id: "temporal-synthetic-proof",
    name: "Temporal recovery sample",
    target: "sample",
    url: SAMPLE_URL,
    sampleVariant: "healthy",
    authorized: true,
    brief: SAMPLE_BRIEF,
    checks: sampleChecks(true),
    createdAt,
    updatedAt: createdAt,
    generator: {
      provider: "Explicitly approved synthetic verification fixture",
      model: null,
    },
  };
  const audit: Audit = {
    id: auditId,
    projectId: project.id,
    projectName: project.name,
    status: "queued",
    createdAt,
    checks: structuredClone(project.checks),
    source: snapshotSource(project),
    results: [],
  };
  const workflowId = `briefstamp-audit-${auditId}`;
  const attemptLog = path.join(output, "activity-attempts.jsonl");
  const env = {
    ...process.env,
    FLOWPROOF_TEMPORAL_ENABLED: "true",
    FLOWPROOF_TEMPORAL_ADDRESS: address,
    FLOWPROOF_PUBLIC: "false",
    FLOWPROOF_DEMO: "false",
    EVIDENCE_ROOT: path.join(output, "evidence"),
    FLOWPROOF_TEMPORAL_RECEIPT_ROOT: path.join(output, "receipts"),
    FLOWPROOF_TEMPORAL_ATTEMPT_LOG: attemptLog,
    FLOWPROOF_TEMPORAL_PROOF_WORKFLOW_ID: workflowId,
  };
  worker = child(
    process.execPath,
    ["--import", "tsx", "scripts/temporal-worker.ts"],
    "worker-before",
    env,
  );
  const handle = await client.workflow.start<typeof approvedAuditWorkflow>(
    AUDIT_WORKFLOW,
    {
      workflowId,
      taskQueue: AUDIT_TASK_QUEUE,
      args: [{ project, audit, waitForRecoverySignal: true }],
      workflowExecutionTimeout: "15 minutes",
    },
  );
  receipt.workflowId = workflowId;
  receipt.runId = handle.firstExecutionRunId;
  await writeFile(
    path.join(output, "approved-input.json"),
    JSON.stringify({ project, audit }, null, 2) + "\n",
  );
  receipt.approval = {
    actor: "Verification harness",
    scope: "Built-in synthetic sample only",
    inputSha256: hash(await readFile(path.join(output, "approved-input.json"))),
  };
  await save();
  console.log(
    "Temporal proof: waiting for the real retry and browser activity.",
  );
  await waitFor(
    () =>
      connection!.withDeadline(Date.now() + 5_000, () =>
        handle.query<AuditWorkflowProgress>(PROGRESS_QUERY),
      ),
    (state) => state.phase === "waiting-for-recovery",
    180_000,
  );
  const before = await handle.describe();
  const beforeHistory = serialize(await handle.fetchHistory());
  await writeFile(
    path.join(output, "history-before-restart.json"),
    JSON.stringify(beforeHistory, null, 2) + "\n",
  );
  const completed = JSON.parse(
    await readFile(
      path.join(output, "receipts", auditId, "completed.json"),
      "utf8",
    ),
  ) as AuditActivityResult;
  assert(
    completed.audit.results.filter((row) => row.status === "passed").length ===
      5 &&
      completed.audit.results.filter((row) => row.status === "unverified")
        .length === 1,
    "The synthetic browser audit did not produce its expected real observations.",
  );
  await filesMatch(completed);
  const attemptsBefore = await readFile(attemptLog, "utf8");
  const attempts = attemptsBefore
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert(
    attempts
      .filter((row) => row.event === "activity-start")
      .map((row) => row.attempt)
      .join(",") === "1,2",
    "Temporal did not perform the bounded retry.",
  );
  assert(
    attempts.filter((row) => row.event === "browser-start").length === 1,
    "Browser activity executed an unexpected number of times.",
  );
  const activityStarts = beforeHistory.events.filter(
    (event: Record<string, unknown>) =>
      event.activityTaskStartedEventAttributes,
  );
  assert(
    activityStarts.some(
      (event: { activityTaskStartedEventAttributes: { attempt: number } }) =>
        event.activityTaskStartedEventAttributes.attempt === 2,
    ),
    "Server history does not attest the second activity attempt.",
  );
  const firstPids = { worker: worker.pid, server: server.pid };
  await stop(worker);
  worker = undefined;
  await connection.close();
  connection = undefined;
  await stop(server);
  server = undefined;
  receipt.beforeRestart = {
    runId: before.runId,
    status: before.status.name,
    processes: firstPids,
    activityAttempts: 2,
    browserExecutions: 1,
    databaseBytes: (await stat(db)).size,
    databaseSha256: hash(await readFile(db)),
  };
  await save();
  console.log(
    "Temporal proof: worker and server stopped; restarting from the same SQLite file.",
  );
  server = child(cli, serverArgs, "server-after");
  connection = await connect(address);
  const recoveredClient = new Client({ connection, namespace: "default" });
  worker = child(
    process.execPath,
    ["--import", "tsx", "scripts/temporal-worker.ts"],
    "worker-after",
    env,
  );
  const recovered = recoveredClient.workflow.getHandle<
    typeof approvedAuditWorkflow
  >(workflowId, handle.firstExecutionRunId);
  await waitFor(
    () =>
      connection!.withDeadline(Date.now() + 5_000, () =>
        recovered.query<AuditWorkflowProgress>(PROGRESS_QUERY),
      ),
    (state) => state.phase === "waiting-for-recovery",
    90_000,
  );
  const after = await recovered.describe();
  assert(
    after.runId === before.runId &&
      firstPids.worker !== worker.pid &&
      firstPids.server !== server.pid,
    "Recovery did not preserve the run with new worker/server processes.",
  );
  await recovered.signal(RECOVERY_SIGNAL);
  const result = await connection.withDeadline(Date.now() + 45_000, () =>
    recovered.result(),
  );
  await filesMatch(result);
  assert(
    (await readFile(attemptLog, "utf8")) === attemptsBefore,
    "Completed browser activity ran again after restart.",
  );
  const finalHistory = serialize(await recovered.fetchHistory());
  const completedEvents = finalHistory.events.filter(
    (event: Record<string, unknown>) =>
      event.activityTaskCompletedEventAttributes,
  );
  assert(
    completedEvents.length === 1,
    "History does not contain exactly one completed browser activity.",
  );
  assert(
    finalHistory.events.some(
      (event: Record<string, unknown>) =>
        event.workflowExecutionSignaledEventAttributes,
    ),
    "Recovery signal is missing from history.",
  );
  await writeFile(
    path.join(output, "history-completed.json"),
    JSON.stringify(finalHistory, null, 2) + "\n",
  );
  await writeFile(
    path.join(output, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  receipt.afterRestart = {
    runId: (await recovered.describe()).runId,
    status: (await recovered.describe()).status.name,
    processes: { worker: worker.pid, server: server.pid },
    activityAttempts: 2,
    browserExecutions: 1,
    completedActivityEvents: completedEvents.length,
    attemptLogUnchanged: true,
  };
  receipt.artifacts = {
    input: "approved-input.json",
    attempts: "activity-attempts.jsonl",
    beforeHistory: "history-before-restart.json",
    completedHistory: "history-completed.json",
    result: "result.json",
    report: `receipts/${auditId}/report.html`,
    reportSha256: result.reportSha256,
    screenshots: result.screenshots.map((image) => ({
      path: `evidence/${auditId}/${image.filename}`,
      sha256: image.sha256,
    })),
  };
  receipt.status = "verified";
  receipt.completedAt = new Date().toISOString();
  await save();
  console.log(
    "Temporal proof verified: one real retry, new server/worker PIDs, same workflow/run, one browser execution.",
  );
} catch (error) {
  receipt.status = "blocked";
  receipt.error =
    error instanceof Error ? error.message : "Local recovery proof failed.";
  receipt.completedAt = new Date().toISOString();
  await save();
  process.exitCode = 1;
  console.error(receipt.error);
} finally {
  await stop(worker).catch(() => {});
  await connection?.close().catch(() => {});
  await stop(server).catch(() => {});
}
