import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { setTimeout as pause } from "node:timers/promises";
import { Client, Connection, WorkflowIdReusePolicy } from "@temporalio/client";
import {
  NativeConnection,
  Worker,
  bundleWorkflowCode,
  type WorkflowBundleWithSourceMap,
} from "@temporalio/worker";
import {
  EvidenceAgentError,
  EVIDENCE_AGENT_TASK,
  validatedAudit,
  type EvidenceAgentDependencies,
  type EvidenceAgentReceipt,
} from "./evidence-agent.js";
import { GOOGLE_GEMMA_MODEL } from "./providers/gemma-google.js";

async function observedCgroupMemory() {
  const readBytes = async (name: string) => {
    try {
      const raw = (await readFile(`/sys/fs/cgroup/${name}`, "utf8")).trim();
      const value = /^\d+$/.test(raw) ? Number(raw) : NaN;
      return Number.isSafeInteger(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  };
  const [currentBytes, peakBytes, limitBytes] = await Promise.all([
    readBytes("memory.current"),
    readBytes("memory.peak"),
    readBytes("memory.max"),
  ]);
  return {
    observedAt: new Date().toISOString(),
    currentBytes,
    peakBytes,
    limitBytes,
    scope:
      "Current Linux cgroup; peak is its lifetime high-water mark, not a per-workflow measurement. Null means unavailable/unlimited, never zero.",
  };
}
import {
  createHostedEvidenceActivities,
  hostedHash,
} from "../temporal/hosted-activities.js";
import { summarizeAgentHistory } from "../temporal/agent-history.js";
import {
  HOSTED_TEMPORAL_CONTINUE,
  HOSTED_TEMPORAL_PROGRESS,
  type HostedTemporalInput,
  type HostedTemporalProgress,
  type HostedTemporalResult,
} from "../temporal/hosted-contracts.js";
import type { Audit } from "../shared/types.js";

const address = "127.0.0.1:7233";
const root = () =>
  path.resolve(process.env.FLOWPROOF_DATA_DIR || "data", "temporal-hosted");
let server: ChildProcess | undefined,
  connection: Connection | undefined,
  native: NativeConnection | undefined;
let workflowBundle: WorkflowBundleWithSourceMap | undefined;
let starting: Promise<void> | undefined;
const epoch = randomUUID();
const live = new Map<
  string,
  {
    auditId: string;
    reservationId: string;
    progress?: HostedTemporalProgress;
    runId: string;
    status: string;
    activities?: ReturnType<typeof summarizeAgentHistory>["activities"];
  }
>();
export const hostedTemporalEnabled = () =>
  process.env.FLOWPROOF_TEMPORAL_HOSTED_ENABLED === "true";
export function hostedTemporalConfiguration() {
  return {
    enabled: hostedTemporalEnabled(),
    service: "official-cli-development-server",
    address: "loopback-only",
    storage:
      "Render free ephemeral SQLite; lost on host restart, redeploy or spin-down",
    sdkVersion: "1.24.0",
    cliVersion: "1.9.1",
    epoch,
  };
}
/** Optional startup; failure never turns a healthy browser demo into a crash. */
export async function startHostedTemporalRuntime(): Promise<void> {
  if (!hostedTemporalEnabled()) return;
  if (starting) return starting;
  starting = (async () => {
    await mkdir(root(), { recursive: true, mode: 0o700 });
    const markerPath = path.join(root(), "storage-epoch.json");
    let previous: unknown = null;
    try {
      previous = JSON.parse(await readFile(markerPath, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(
      markerPath,
      JSON.stringify({
        epoch,
        startedAt: new Date().toISOString(),
        previousMarkerPresent: previous !== null,
      }),
      { mode: 0o600 },
    );
    server = spawn(
      process.env.FLOWPROOF_TEMPORAL_CLI || "/usr/local/bin/temporal",
      [
        "server",
        "start-dev",
        "--ip",
        "127.0.0.1",
        "--port",
        "7233",
        "--headless",
        "--db-filename",
        path.join(root(), "history.sqlite"),
      ],
      {
        stdio: ["ignore", "ignore", "ignore"],
        env: { ...process.env, GOMEMLIMIT: "64MiB", GOGC: "20" },
      },
    );
    let spawnError: Error | undefined;
    server.once("error", (error) => {
      spawnError = error;
    });
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (spawnError || server.exitCode !== null)
        throw new Error(
          "The loopback Temporal development server did not start.",
        );
      try {
        connection = await Connection.connect({
          address,
          connectTimeout: "1 second",
        });
        native = await NativeConnection.connect({ address });
        return;
      } catch {
        await pause(300);
      }
    }
    throw new Error("The loopback Temporal server readiness deadline expired.");
  })().catch(async (error) => {
    await stopHostedTemporalRuntime();
    throw error;
  });
  return starting;
}
export async function stopHostedTemporalRuntime() {
  await connection?.close().catch(() => {});
  connection = undefined;
  await native?.close().catch(() => {});
  native = undefined;
  const ownServer = server;
  server = undefined;
  if (ownServer && ownServer.exitCode === null && !ownServer.signalCode) {
    const exited = new Promise<void>((resolve) =>
      ownServer.once("exit", () => resolve()),
    );
    ownServer.kill("SIGTERM");
    await Promise.race([exited, pause(3_000)]);
    if (ownServer.exitCode === null && !ownServer.signalCode) {
      ownServer.kill("SIGKILL");
      await Promise.race([exited, pause(1_000)]);
    }
  }
  starting = undefined;
}
export function hostedTemporalProgress(workflowId: string) {
  if (!/^briefstamp-hosted-agent-[a-f0-9-]{36}$/.test(workflowId)) return null;
  const value = live.get(workflowId);
  return value ? { workflowId, ...value } : null;
}
/** Caller has already committed an existing Tiger grant reservation. No new
 * allowance or credential is created here. Controls come from trusted operator
 * configuration, never a model or a public request body. */
export async function executeHostedTemporalEvidenceAgent(
  input: { audit: Audit; task: string },
  deps: EvidenceAgentDependencies,
  control: {
    reservationId: string;
    controlledRecovery?: boolean;
    transport?: EvidenceAgentReceipt["transport"];
  },
): Promise<EvidenceAgentReceipt> {
  if (
    !hostedTemporalEnabled() ||
    !/^[a-f0-9-]{36}$/.test(control.reservationId) ||
    deps.maxModelRequests !== 2 ||
    input.task !== EVIDENCE_AGENT_TASK
  )
    throw new Error(
      "Hosted Temporal requires an existing two-call judge reservation.",
    );
  const deadline = Date.now() + 90_000;
  const runSignal = AbortSignal.timeout(90_000);
  const auditObservation = validatedAudit(input.audit),
    sourceHash = hostedHash(input.audit);
  const startedAt = new Date().toISOString(),
    workflowId = `briefstamp-hosted-agent-${control.reservationId}`;
  if (live.has(workflowId))
    throw new Error("This hosted reservation was already dispatched.");
  await startHostedTemporalRuntime();
  if (!connection || !native)
    throw new Error("Hosted Temporal is unavailable.");
  if (!workflowBundle) {
    const bundlePath = path.resolve("dist-temporal-worker/workflow-bundle.js");
    try {
      workflowBundle = {
        code: await readFile(bundlePath, "utf8"),
        sourceMap: "",
      };
    } catch (error) {
      if (
        process.env.NODE_ENV === "production" ||
        (error as NodeJS.ErrnoException).code !== "ENOENT"
      )
        throw new Error(
          "The prebuilt Temporal workflow bundle is unavailable.",
        );
      workflowBundle = await bundleWorkflowCode({
        workflowsPath: fileURLToPath(
          new URL("../temporal/hosted-workflows.ts", import.meta.url),
        ),
      });
    }
  }
  const folder = path.join(root(), control.reservationId);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const receipt: EvidenceAgentReceipt = {
    version: 1,
    status: "running",
    transport:
      control.transport ??
      (deps.generate ? "injected_offline" : "native_google_gemma"),
    model: GOOGLE_GEMMA_MODEL,
    startedAt,
    task: EVIDENCE_AGENT_TASK,
    sourceAuditId: input.audit.id,
    auditObservation,
    modelTurns: [],
    toolCalls: [],
    observations: [],
    sourceAuditUnchanged: true,
    limits: {
      maximumModelCalls: 2,
      maximumLogicalModelTurns: 2,
      maximumToolCalls: 2,
      modelRetries: 0,
      toolRetries: 0,
      refundPerformed: false,
      maximumDurationMs: 90_000,
      maximumSearchDurationMs: deps.searchTimeoutMs ?? 10_000,
    },
    scope:
      (control.transport ??
        (deps.generate ? "injected_offline" : "native_google_gemma")) ===
      "injected_offline"
        ? "Local retained-provider fixture callbacks in the official loopback Temporal development server. Zero fresh provider calls; no hosted execution or grant validation is established."
        : "Live provider activities in the official loopback Temporal development server; worker recovery only. The existing Tiger reservation bounds two model requests and one search. Render free ephemeral disk is not durable infrastructure.",
  };
  const workflowInput: HostedTemporalInput = {
    reservationId: control.reservationId,
    auditId: input.audit.id,
    controlledRecovery: control.controlledRecovery === true,
  };
  const activities = createHostedEvidenceActivities({
    input: workflowInput,
    audit: input.audit,
    deps,
    receipt,
    journalRoot: folder,
    sourceAuditSha256: sourceHash,
    runSignal,
  });
  const taskQueue = workflowId;
  const makeWorker = () =>
    Worker.create({
      connection: native,
      workflowBundle,
      taskQueue,
      activities,
      maxConcurrentActivityTaskExecutions: 1,
      maxConcurrentActivityTaskPolls: 1,
      maxConcurrentWorkflowTaskExecutions: 1,
      maxCachedWorkflows: 0,
      shutdownGraceTime: "5 seconds",
      workflowThreadPoolSize: 1,
    });
  let worker = await makeWorker(),
    workerRun = worker.run();
  // Observe immediately so a worker failure does not become an unhandled rejection.
  let workerFailure: unknown;
  void workerRun.catch((error) => {
    workerFailure = error;
  });
  const client = new Client({ connection, namespace: "default" });
  let recovered = false,
    beforeHistory: unknown,
    afterHistory: unknown;
  try {
    const handle = await client.workflow.start("hostedEvidenceAgentWorkflow", {
      workflowId,
      taskQueue,
      args: [workflowInput],
      workflowExecutionTimeout: "90 seconds",
      workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
    });
    const state = {
      auditId: input.audit.id,
      reservationId: control.reservationId,
      runId: handle.firstExecutionRunId,
      status: "running",
    };
    live.set(workflowId, state);
    const resultPromise = handle.result() as Promise<HostedTemporalResult>;
    let settled = false;
    void resultPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    while (!settled && Date.now() < deadline) {
      if (workerFailure)
        throw new Error("The hosted evidence worker stopped unexpectedly.");
      try {
        const progress = await connection.withDeadline(Date.now() + 1_500, () =>
          handle.query<HostedTemporalProgress>(HOSTED_TEMPORAL_PROGRESS),
        );
        const observedHistory = summarizeAgentHistory({
          events: (await handle.fetchHistory()).events ?? [],
        });
        Object.assign(state, {
          progress,
          activities: observedHistory.activities,
          status: observedHistory.status,
        });
        if (
          control.controlledRecovery &&
          progress.phase === "waiting-after-tiger" &&
          !recovered
        ) {
          beforeHistory = await handle.fetchHistory();
          await writeFile(
            path.join(folder, "before-worker-restart.history.json"),
            JSON.stringify(beforeHistory, null, 2),
          );
          worker.shutdown();
          await workerRun;
          worker = await makeWorker();
          workerRun = worker.run();
          void workerRun.catch((error) => {
            workerFailure = error;
          });
          await handle.signal(HOSTED_TEMPORAL_CONTINUE);
          recovered = true;
        }
      } catch (error) {
        if (control.controlledRecovery && beforeHistory && !recovered)
          throw error;
      }
      await pause(250);
    }
    if (!settled)
      throw new Error("The hosted workflow exceeded its bounded deadline.");
    const result = await resultPromise;
    receipt.selection = result.selection.selection;
    receipt.modelTurns = [
      { phase: "select_tools", result: result.selection.turn },
      ...(result.summary
        ? [{ phase: "summarize" as const, result: result.summary.turn }]
        : []),
    ];
    receipt.observations = result.observations;
    receipt.modelOutput = result.summary?.findings;
    receipt.toolSelectionAbstained =
      result.selection.selection.tools.length === 0;
    receipt.factualSummary = [
      `The existing synthetic Chromium audit has ${auditObservation.results.filter((r) => r.status === "passed").length} passed, ${auditObservation.results.filter((r) => r.status === "failed").length} failed, ${auditObservation.results.filter((r) => r.status === "blocked").length} blocked and ${auditObservation.results.filter((r) => r.status === "unverified").length} unverified checks.`,
      ...result.observations.map((o) =>
        o.status === "unavailable"
          ? `${o.id}: tool unavailable.`
          : o.type === "failure_history"
            ? `${o.id}: ${o.rows.length} saved failed or blocked checks; historical evidence.`
            : `${o.id}: ${o.resultCount} matching search results; no ranking or acceptance claim.`,
      ),
    ];
    receipt.status = "completed";
    state.status = "completed";
    afterHistory = await handle.fetchHistory();
    await writeFile(
      path.join(folder, "completed.history.json"),
      JSON.stringify(afterHistory, null, 2),
    );
    const history = summarizeAgentHistory(
      afterHistory as Parameters<typeof summarizeAgentHistory>[0],
    );
    Object.assign(state, {
      activities: history.activities,
      status: history.status,
    });
    const before = beforeHistory
      ? summarizeAgentHistory(
          beforeHistory as Parameters<typeof summarizeAgentHistory>[0],
        )
      : null;
    const preserved = before
      ? Object.entries(before.activities).every(
          ([name, value]) =>
            value.completedEventIds.every((id) =>
              history.activities[name]?.completedEventIds.includes(id),
            ) && history.activities[name].scheduled === value.scheduled,
        )
      : null;
    const db = await stat(path.join(root(), "history.sqlite"));
    receipt.orchestration = {
      provider: "Temporal",
      workflowId,
      runId: state.runId,
      status: history.status,
      activities: history.activities,
      controlledPreDispatchRetry: control.controlledRecovery === true,
      workerRestarted: recovered,
      completedActivityEventsPreserved: preserved,
      webProcessUnchanged: true,
      serverProcessUnchanged: true,
      storageEpoch: epoch,
      sqliteBytes: db.size,
      memory: await observedCgroupMemory(),
      hostDiskRecoveryTested: false,
      callbackRecoveryLimit:
        "Request callbacks remain in the web process. This proof restarts an SDK Worker only; it does not recover callbacks or ephemeral SQLite after host loss.",
    };
    return receipt;
  } catch {
    receipt.status = "failed";
    receipt.failureCode = "hosted_temporal_workflow_failed";
    try {
      const failedHistory = await connection.withDeadline(
        Date.now() + 2_000,
        () => client.workflow.getHandle(workflowId).fetchHistory(),
      );
      await writeFile(
        path.join(folder, "failed.history.json"),
        JSON.stringify(failedHistory, null, 2),
      );
      const actual = summarizeAgentHistory({
        events: failedHistory.events ?? [],
      });
      receipt.orchestration = {
        provider: "Temporal",
        workflowId,
        runId: live.get(workflowId)?.runId,
        status: actual.status,
        activities: actual.activities,
        memory: await observedCgroupMemory(),
        workerRestarted: recovered,
        hostDiskRecoveryTested: false,
      };
    } catch {
      /* An unavailable history remains unavailable, never an invented failure event. */
    }
    const state = live.get(workflowId);
    if (state) state.status = "failed";
    throw new EvidenceAgentError(receipt.failureCode, receipt);
  } finally {
    receipt.completedAt = new Date().toISOString();
    receipt.sourceAuditUnchanged = hostedHash(input.audit) === sourceHash;
    if (worker.getState() === "RUNNING") worker.shutdown();
    await workerRun.catch(() => {});
    await writeFile(
      path.join(folder, "receipt.json"),
      JSON.stringify(receipt, null, 2),
    );
    // Free the development server before another public Chromium audit starts.
    // SQLite remains on this host's ephemeral disk for the next lazy start.
    await stopHostedTemporalRuntime();
    // Bounded metadata only. The caller also persists its normal Tiger result.
    if (live.size > 100) live.delete(live.keys().next().value!);
  }
}
