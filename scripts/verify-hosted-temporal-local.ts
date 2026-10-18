import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import {
  executeHostedTemporalEvidenceAgent,
  stopHostedTemporalRuntime,
} from "../server/hosted-temporal.js";
import { EVIDENCE_AGENT_TASK } from "../server/evidence-agent.js";
const { values } = parseArgs({
  options: {
    cli: { type: "string" },
    output: { type: "string" },
    "full-app": { type: "boolean" },
    chromium: { type: "boolean" },
  },
});
assert(
  values.cli && values.output,
  "Pass --cli official-executable --output new-directory",
);
await mkdir(values.output, { recursive: false });
process.env.FLOWPROOF_DATA_DIR = path.resolve(values.output);
process.env.FLOWPROOF_TEMPORAL_CLI = path.resolve(values.cli);
process.env.FLOWPROOF_TEMPORAL_HOSTED_ENABLED = "true";
if (values["full-app"]) {
  process.env.FLOWPROOF_PUBLIC = "true";
  process.env.FLOWPROOF_DEMO = "true";
  process.env.PORT = "14310";
  const appEntry = new URL("../dist-server/index.js", import.meta.url).href;
  await import(appEntry);
}
const fixtureRoot = "docs/evidence/judge-agent/2026-10-16T13-07-24Z/attempt-2";
const audit = JSON.parse(
  await readFile(`${fixtureRoot}/source-audit.json`, "utf8"),
);
const fixture = JSON.parse(
  await readFile(`${fixtureRoot}/agent-run.json`, "utf8"),
);
const counts = { model: 0, tiger: 0, search: 0 };
let maximumCombinedRssKiB = 0,
  maximumCombinedPssKiB = 0;
const pssStagePeaks: Record<string, number> = {};
let maximumProcessRssKiB = 0,
  maximumChildrenRssKiB = 0;
let stage = "temporal";
const stagePeaks: Record<string, number> = {};
const sampleMemory = () => {
  // Parent plus its immediate CLI child. SDK worker thread memory is in parent.
  const rows = execFileSync("ps", ["-eo", "pid,ppid,rss"], { encoding: "utf8" })
    .trim()
    .split("\n")
    .slice(1)
    .map((r) => r.trim().split(/\s+/).map(Number));
  const tree = new Set([process.pid]);
  for (let depth = 0; depth < 10; depth++)
    for (const [pid, ppid] of rows) if (tree.has(ppid)) tree.add(pid);
  const rss = rows
    .filter(([pid]) => tree.has(pid))
    .reduce((n, r) => n + r[2], 0);
  let pss = 0;
  for (const pid of tree) {
    try {
      const text = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
      pss += Number(/^Pss:\s+(\d+)/m.exec(text)?.[1] ?? 0);
    } catch {}
  }
  maximumCombinedPssKiB = Math.max(maximumCombinedPssKiB, pss);
  pssStagePeaks[stage] = Math.max(pssStagePeaks[stage] ?? 0, pss);
  maximumCombinedRssKiB = Math.max(rss, maximumCombinedRssKiB);
  maximumProcessRssKiB = Math.max(
    maximumProcessRssKiB,
    rows.find(([pid]) => pid === process.pid)?.[2] ?? 0,
  );
  maximumChildrenRssKiB = Math.max(
    maximumChildrenRssKiB,
    rows
      .filter(([pid]) => pid !== process.pid && tree.has(pid))
      .reduce((n, r) => n + r[2], 0),
  );
  stagePeaks[stage] = Math.max(stagePeaks[stage] ?? 0, rss);
};
const interval = setInterval(sampleMemory, 200);
const receipt: any = {
  scope:
    "LOCAL real Temporal CLI/SDK lifecycle; retained provider fixtures only, zero network model/search calls and zero grant reservations. Not hosted evidence.",
  status: "running",
};
try {
  const result = await executeHostedTemporalEvidenceAgent(
    { audit, task: EVIDENCE_AGENT_TASK },
    {
      maxModelRequests: 2,
      searchTimeoutMs: 60_000,
      generate: async (request) => {
        counts.model++;
        return structuredClone(
          fixture.modelTurns.find((t: any) => t.phase === request.phase).result,
        );
      },
      failureHistory: async () => {
        counts.tiger++;
        return structuredClone(
          fixture.toolReceipts.find((t: any) => t.tool === "failure_history")
            .result,
        );
      },
      searchVisibility: async () => {
        counts.search++;
        return structuredClone(
          fixture.toolReceipts.find((t: any) => t.tool === "search_visibility")
            .result,
        );
      },
    },
    { reservationId: randomUUID(), controlledRecovery: true },
  );
  assert.equal(result.status, "completed");
  assert.deepEqual(counts, { model: 2, tiger: 1, search: 1 });
  assert.equal(result.transport, "injected_offline");
  assert.equal(result.orchestration?.workerRestarted, true);
  assert.equal(result.orchestration?.completedActivityEventsPreserved, true);
  const activities = result.orchestration?.activities as Record<string, any>;
  assert.equal(activities.selectEvidenceTools.attempts, 2);
  assert.equal(activities.retrieveTigerEvidence.attempts, 1);
  assert.equal(activities.searchEvidenceVisibility.attempts, 1);
  assert.equal(activities.summarizeEvidence.attempts, 1);
  receipt.status = "verified";
  receipt.result = result;
  stage = "after-temporal";
  sampleMemory();
  if (values.chromium) {
    stage = "chromium";
    const { runAudit } = await import("../server/runner.js");
    const project = {
      ...audit.source,
      id: audit.projectId,
      name: audit.projectName,
      checks: audit.checks,
      authorized: true,
      createdAt: audit.createdAt,
      updatedAt: audit.createdAt,
      generator: { provider: "local", detail: "Local test only" },
    };
    const fresh = {
      ...audit,
      id: randomUUID(),
      status: "running",
      results: [],
      completedAt: undefined,
    };
    const results = await runAudit(project as any, fresh, () => {}, {
      evidenceRoot: path.join(values.output!, "browser"),
    });
    receipt.chromium = {
      status: results.some(
        (r) => r.status === "passed" || r.status === "failed",
      )
        ? "observed"
        : "blocked",
      checks: results.length,
      outcomes: results.map((r) => ({ kind: r.kind, status: r.status })),
      scope: "LOCAL synthetic sample browser after Temporal shutdown",
    };
    assert.equal(
      receipt.chromium.status,
      "observed",
      "Chromium did not produce an actual observed pass/fail",
    );
  }
} catch (error) {
  receipt.status = "failed";
  receipt.failure =
    error instanceof Error
      ? { name: error.name, message: error.message }
      : String(error);
  throw error;
} finally {
  clearInterval(interval);
  sampleMemory();
  receipt.counts = counts;
  receipt.maximumCombinedRssKiB = maximumCombinedRssKiB;
  receipt.maximumCombinedPssKiB = maximumCombinedPssKiB;
  receipt.memoryBreakdown = {
    maximumProcessRssKiB,
    maximumChildrenRssKiB,
    stagePeaks,
    pssStagePeaks,
  };
  receipt.memoryLimitations =
    "Local parent plus recursive child process tree RSS sampling, not a Render cgroup or full web/browser memory measurement. Shared pages may be counted twice.";
  await stopHostedTemporalRuntime();
  await writeFile(
    path.join(values.output, "verification.json"),
    JSON.stringify(receipt, null, 2),
  );
  console.log(
    JSON.stringify({
      status: receipt.status,
      counts,
      maximumCombinedRssKiB,
      maximumCombinedPssKiB,
      memoryBreakdown: receipt.memoryBreakdown,
      chromium: receipt.chromium,
    }),
  );
  if (values["full-app"]) process.exit(receipt.status === "verified" ? 0 : 1);
}
