import { fork, type ChildProcess } from "node:child_process";
import path from "node:path";
import { stat } from "node:fs/promises";
import {
  EvidenceAgentError,
  type EvidenceAgentDependencies,
  type EvidenceAgentReceipt,
} from "./evidence-agent.js";
import { generateGemmaEvidenceTurn } from "./providers/gemma-evidence-agent.js";
export const hostedTemporalEnabled = () =>
  process.env.FLOWPROOF_TEMPORAL_HOSTED_ENABLED === "true";
const progress = new Map<string, any>();
let active: ChildProcess | undefined;
export const hostedTemporalProgress = (workflowId: string) =>
  progress.get(workflowId) ?? null;
export function hostedTemporalConfiguration() {
  return {
    enabled: hostedTemporalEnabled(),
    service: "official-cli-development-server",
    address: "loopback-only",
    storage:
      "Render free ephemeral SQLite; lost on host restart, redeploy or spin-down",
    sdkVersion: "1.24.0",
    cliVersion: "1.9.1",
  };
}
export async function startHostedTemporalRuntime() {
  /* Lazy, one isolated child per reserved run. */
}
export async function stopHostedTemporalRuntime() {
  active?.kill("SIGTERM");
  active = undefined;
}
/** Heavy SDK and CLI exit together after each run. Credentials and session
 * closures stay in the web process; IPC carries finite synthetic observations. */
export async function executeHostedTemporalEvidenceAgent(
  input: Parameters<
    typeof import("./hosted-temporal-runtime.js").executeHostedTemporalEvidenceAgent
  >[0],
  deps: EvidenceAgentDependencies,
  control: { reservationId: string; controlledRecovery?: boolean },
): Promise<EvidenceAgentReceipt> {
  if (
    !hostedTemporalEnabled() ||
    active ||
    deps.maxModelRequests !== 2 ||
    !/^[a-f0-9-]{36}$/.test(control.reservationId)
  )
    throw new Error(
      "Hosted Temporal is unavailable or its existing reservation is invalid.",
    );
  const filename = path.resolve(
    "dist-temporal-runtime/hosted-temporal-child.js",
  );
  await stat(filename);
  const run = new AbortController();
  const workflowId = `briefstamp-hosted-agent-${control.reservationId}`;
  const providerCalls = { generate: 0, failureHistory: 0, searchVisibility: 0 };
  const child = fork(filename, [], {
    execArgv: ["--max-old-space-size=64"],
    serialization: "json",
    stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      NODE_ENV: "production",
      FLOWPROOF_DATA_DIR: process.env.FLOWPROOF_DATA_DIR || "data",
      FLOWPROOF_TEMPORAL_HOSTED_ENABLED: "true",
      FLOWPROOF_TEMPORAL_CLI:
        process.env.FLOWPROOF_TEMPORAL_CLI || "/usr/local/bin/temporal",
    },
  });
  active = child;
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => finish(undefined), 90_000);
    function finish(receipt: EvidenceAgentReceipt | undefined, ok = false) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      run.abort();
      const complete = () => {
        if (active === child) active = undefined;
        if (ok && receipt) resolve(receipt);
        else if (receipt)
          reject(
            new EvidenceAgentError(
              receipt.failureCode || "hosted_temporal_workflow_failed",
              receipt,
            ),
          );
        else
          reject(
            new Error(
              "The isolated Temporal evidence run did not finish within its fixed allowance.",
            ),
          );
      };
      if (child.exitCode !== null || child.signalCode) complete();
      else {
        child.once("exit", complete);
        // Child cleans up its own CLI before disconnect; a timed-out child gets
        // a bounded graceful stop. Never signal other app/browser processes.
        if (!ok) child.kill("SIGTERM");
        const kill = setTimeout(() => child.kill("SIGKILL"), 5_000);
        kill.unref();
        child.once("exit", () => clearTimeout(kill));
      }
    }
    child.on("error", () => finish(undefined));
    child.on("exit", () => {
      if (!finished) finish(undefined);
    });
    child.on("message", async (message: any) => {
      if (!message || Buffer.byteLength(JSON.stringify(message)) > 512 * 1024)
        return finish(undefined);
      if (message.type === "progress") {
        progress.set(workflowId, message.value);
        return;
      }
      if (message.type === "result") {
        if (message.receipt?.orchestration)
          progress.set(workflowId, {
            ...message.receipt.orchestration,
            auditId: input.audit.id,
          });
        finish(message.receipt, message.ok === true);
        return;
      }
      if (message.type !== "provider" || finished) return;
      try {
        deps.beforeModel?.();
        run.signal.throwIfAborted();
        const signal = AbortSignal.any([
          run.signal,
          AbortSignal.timeout(
            message.operation === "searchVisibility"
              ? (deps.searchTimeoutMs ?? 10_000)
              : 20_000,
          ),
        ]);
        let value: unknown;
        if (message.operation === "generate" && providerCalls.generate++ < 2) {
          value = deps.generate
            ? await deps.generate(message.input)
            : await generateGemmaEvidenceTurn(message.input, {
                env: deps.env,
                now: deps.now,
                signal,
                maxAttempts: 1,
                beforeRequest: deps.beforeModel,
              });
        } else if (
          message.operation === "failureHistory" &&
          providerCalls.failureHistory++ < 1
        )
          value = await deps.failureHistory(message.input, signal);
        else if (
          message.operation === "searchVisibility" &&
          providerCalls.searchVisibility++ < 1
        )
          value = await deps.searchVisibility(signal);
        else throw new Error("Unreserved provider dispatch");
        run.signal.throwIfAborted();
        if (child.connected)
          child.send({
            type: "provider-result",
            id: message.id,
            ok: true,
            value,
          });
      } catch {
        if (child.connected)
          child.send({ type: "provider-result", id: message.id, ok: false });
      }
    });
    child.send({
      type: "run",
      input,
      searchTimeoutMs: deps.searchTimeoutMs ?? 10_000,
      control: {
        ...control,
        transport: deps.generate ? "injected_offline" : "native_google_gemma",
      },
    });
  });
}
