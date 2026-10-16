import assert from "node:assert/strict";
import { Client, Connection } from "@temporalio/client";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, statfs, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { summarizeAgentHistory } from "../temporal/agent-history.js";
import { createEvidenceActivityLedger } from "../temporal/agent-ledger.js";
import { EVIDENCE_AGENT_TASK } from "../server/evidence-agent.js";
import type { TemporalAgentResult } from "../temporal/agent-contracts.js";
import type {
  evidenceAgentWorkflow,
  TemporalAgentProgress,
} from "../temporal/agent-workflows.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { values } = parseArgs({
  options: { cli: { type: "string" }, output: { type: "string" } },
});
assert(
  values.cli && values.output,
  "Use --cli <official binary> --output <new directory>.",
);
const output = path.resolve(values.output);
await mkdir(output, { recursive: false });
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const save = (name: string, value: unknown) =>
  writeFile(
    path.join(output, name),
    JSON.stringify(
      value,
      (_key, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
const sourceCommit = execFileSync("git", ["rev-parse", "HEAD"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const receipt: any = {
  status: "running",
  startedAt: new Date().toISOString(),
  sourceCommit,
  scope:
    "Real Temporal development server and worker processes; retained native model/tool fixture replay, no fresh inference",
  modelCalls: 0,
  searchCalls: 0,
  publicJudgeGrantConsumed: false,
  fixtureSource:
    "docs/evidence/judge-agent/2026-10-16T13-07-24Z/attempt-2/agent-run.json",
  limitations: [
    "CI/local only; no hosted persistent worker.",
    "Provider responses are retained fixtures, not new model or search results.",
    "Unknown external-call completion fails closed; providers without native idempotency are not claimed exactly-once.",
  ],
};
let server: ChildProcess | undefined,
  worker: ChildProcess | undefined,
  connection: Connection | undefined;
const childEnv: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  TMPDIR: process.env.TMPDIR,
  LANG: "C.UTF-8",
  NODE_OPTIONS: "--max-old-space-size=768",
  MASTRA_TELEMETRY_DISABLED: "1",
};
function launch(command: string, args: string[], name: string) {
  const stream = createWriteStream(path.join(output, name + ".log"), {
    flags: "wx",
    mode: 0o600,
  });
  const p = spawn(command, args, {
    cwd: root,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  p.stdout?.pipe(stream, { end: false });
  p.stderr?.pipe(stream, { end: false });
  p.once("exit", () => stream.end());
  p.once("error", (error) => stream.end(error.name));
  return p;
}
async function stop(
  p: ChildProcess | undefined,
  signal: NodeJS.Signals = "SIGTERM",
) {
  if (!p || p.exitCode !== null || p.signalCode) return;
  const exited = new Promise<void>((resolve) =>
    p.once("exit", () => resolve()),
  );
  p.kill(signal);
  await Promise.race([exited, delay(7000)]);
  if (p.exitCode === null && !p.signalCode) {
    p.kill("SIGKILL");
    await Promise.race([exited, delay(2000)]);
  }
  assert(p.exitCode !== null || p.signalCode, "Proof process did not stop");
}
async function waitFor<T>(
  read: () => Promise<T>,
  accept: (v: T) => boolean,
  ms = 60000,
) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const value = await read();
      if (accept(value)) return value;
    } catch {}
    await delay(250);
  }
  throw Error("Temporal proof readiness deadline exceeded");
}
async function freePort() {
  const s = createServer();
  await new Promise<void>((resolve, reject) => {
    s.once("error", reject);
    s.listen(0, "127.0.0.1", resolve);
  });
  const port = (s.address() as { port: number }).port;
  await new Promise<void>((resolve) => s.close(() => resolve()));
  return port;
}
function historyStats(history: any) {
  return summarizeAgentHistory(JSON.parse(JSON.stringify(history)));
}
try {
  const space = await statfs(output);
  assert(
    space.bavail * space.bsize >= 128 * 1024 * 1024,
    "Insufficient free space for proof server",
  );
  receipt.cliVersion = execFileSync(path.resolve(values.cli), ["--version"], {
    encoding: "utf8",
  }).trim();
  receipt.cliBinarySha256 = hash(await readFile(path.resolve(values.cli)));
  const source = await readFile(
    path.join(
      root,
      "docs/evidence/judge-agent/2026-10-16T13-07-24Z/attempt-2/source-audit.json",
    ),
  );
  const audit = JSON.parse(source.toString());
  receipt.sourceAuditSha256 = hash(source);
  receipt.fixtureReceiptSha256 = hash(
    await readFile(path.join(root, receipt.fixtureSource)),
  );
  const instance = randomUUID();
  const ids = {
    recovery: `briefstamp-agent-recovery-${instance}`,
    permanent: `briefstamp-agent-permanent-${instance}`,
    validation: `briefstamp-agent-validation-${instance}`,
    exhausted: `briefstamp-agent-exhausted-${instance}`,
  };
  const faults = {
    [ids.recovery]: "transient-recovery",
    [ids.permanent]: "permanent-400",
    [ids.validation]: "summary-invalid-citation",
    [ids.exhausted]: "exhausted-500",
  };
  await save("faults.json", faults);
  const address = `127.0.0.1:${await freePort()}`;
  const queue = `briefstamp-evidence-proof-${instance}`;
  server = launch(
    path.resolve(values.cli),
    [
      "server",
      "start-dev",
      "--ip",
      "127.0.0.1",
      "--port",
      address.split(":")[1],
      "--headless",
      "--db-filename",
      path.join(output, "temporal.sqlite"),
      "--log-level",
      "error",
    ],
    "server",
  );
  connection = await waitFor(
    () => Connection.connect({ address, connectTimeout: "1 second" }),
    () => true,
  );
  const client = new Client({ connection, namespace: "default" });
  const workerArgs = [
    "--import",
    "tsx",
    "scripts/temporal-agent-worker.ts",
    "--address",
    address,
    "--journal",
    path.join(output, "journal"),
    "--faults",
    path.join(output, "faults.json"),
    "--queue",
    queue,
  ];
  worker = launch(process.execPath, workerArgs, "worker-before");
  const handle = await client.workflow.start<typeof evidenceAgentWorkflow>(
    "evidenceAgentWorkflow",
    {
      workflowId: ids.recovery,
      taskQueue: queue,
      args: [
        {
          audit: structuredClone(audit),
          task: EVIDENCE_AGENT_TASK,
          pauseAfterTiger: true,
        },
      ],
      workflowExecutionTimeout: "3 minutes",
    },
  );
  await waitFor(
    () => handle.query<TemporalAgentProgress>("evidenceAgentProgress"),
    (v) => v.phase === "waiting-after-tiger",
  );
  const before = await handle.fetchHistory();
  await save("recovery-before-worker-kill.json", before);
  const beforeStats = historyStats(before);
  assert.equal(beforeStats.activities.selectEvidenceTools.attempts, 2);
  assert.equal(beforeStats.activities.retrieveTigerEvidence.completed, 1);
  assert(!beforeStats.activities.searchEvidenceVisibility);
  const oldPid = worker.pid;
  await stop(worker, "SIGKILL");
  assert.equal(worker.signalCode, "SIGKILL");
  worker = launch(process.execPath, workerArgs, "worker-after");
  assert.notEqual(worker.pid, oldPid);
  await handle.signal("continueAfterTiger");
  const result: TemporalAgentResult = await handle.result();
  assert.equal(result.summary.sourceAuditUnchanged, true);
  assert.deepEqual(audit, JSON.parse(source.toString()));
  const after = await handle.fetchHistory();
  await save("recovery-completed-history.json", after);
  await save("recovery-result.json", result);
  const afterStats = historyStats(after);
  assert.equal(afterStats.status, "completed");
  for (const name of [
    "reserveEvidenceAllowance",
    "selectEvidenceTools",
    "retrieveTigerEvidence",
  ]) {
    assert.deepEqual(
      afterStats.activities[name].completedEventIds,
      beforeStats.activities[name].completedEventIds,
    );
    assert.equal(afterStats.activities[name].scheduled, 1);
  }
  assert.equal(afterStats.activities.selectEvidenceTools.attempts, 2);
  assert.equal(afterStats.activities.retrieveTigerEvidence.attempts, 1);
  assert.equal(afterStats.activities.searchEvidenceVisibility.attempts, 2);
  assert.equal(afterStats.activities.summarizeEvidence.attempts, 1);
  const ledger = createEvidenceActivityLedger({
    root: path.join(output, "journal"),
  });
  const recoveredLedger = await ledger.inspect(handle.firstExecutionRunId);
  assert.deepEqual(recoveredLedger.counters, {
    select: 2,
    tiger: 1,
    search: 2,
    summary: 1,
  });
  await save("recovery-ledger.json", recoveredLedger);
  receipt.recovery = {
    workflowId: ids.recovery,
    runId: handle.firstExecutionRunId,
    workerKilledWith: "SIGKILL",
    workerPidChanged: true,
    before: beforeStats,
    after: afterStats,
    completedActivitiesReexecuted: 0,
    sourceAuditUnchanged: true,
    modelFindingsFromRetainedReceipt: true,
    logicalReservations: 1,
    dedicatedFixtureAttempts: recoveredLedger.counters,
  };
  receipt.failures = {};
  for (const [name, id] of Object.entries(ids).filter(
    ([name]) => name !== "recovery",
  )) {
    const failed = await client.workflow.start<typeof evidenceAgentWorkflow>(
      "evidenceAgentWorkflow",
      {
        workflowId: id,
        taskQueue: queue,
        args: [{ audit: structuredClone(audit), task: EVIDENCE_AGENT_TASK }],
        workflowExecutionTimeout: "3 minutes",
      },
    );
    let rejected = false;
    try {
      await failed.result();
    } catch {
      rejected = true;
    }
    assert(rejected, "Permanent failure returned an invented success");
    const history = await failed.fetchHistory();
    await save(`${name}-failed-history.json`, history);
    const stats = historyStats(history);
    assert.equal(stats.status, "failed");
    assert.equal(
      stats.activities.selectEvidenceTools.attempts,
      name === "exhausted" ? 3 : 1,
    );
    if (name === "permanent" || name === "exhausted")
      assert(!stats.activities.summarizeEvidence);
    if (name === "validation")
      assert.equal(stats.activities.summarizeEvidence.failed, 1);
    receipt.failures[name] = {
      workflowId: id,
      runId: failed.firstExecutionRunId,
      stats,
      answerReturned: false,
    };
    await save(
      `${name}-ledger.json`,
      await ledger.inspect(failed.firstExecutionRunId),
    );
  }
  receipt.status = "verified";
  receipt.completedAt = new Date().toISOString();
} catch (error) {
  receipt.status = "failed";
  receipt.failure =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : "unknown";
  throw error;
} finally {
  await stop(worker);
  await connection?.close();
  await stop(server);
  await save("receipt.json", receipt);
}
console.log(
  JSON.stringify({
    status: receipt.status,
    output,
    recovery: receipt.recovery?.dedicatedFixtureAttempts,
    permanentStates: Object.fromEntries(
      Object.entries(receipt.failures ?? {}).map(
        ([name, value]: [string, any]) => [name, value.stats.status],
      ),
    ),
    publicJudgeGrantConsumed: false,
  }),
);
