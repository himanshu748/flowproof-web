import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import { setTimeout as pause } from "node:timers/promises";
import path from "node:path";
import express from "express";
import { chromium } from "playwright";
import { createDemoRouter } from "../server/demo.js";
import { createHostedApprovalRun } from "../server/hosted-approval.js";
import { runAudit } from "../server/runner.js";
import { monitorProcessTree } from "./process-tree-memory.js";
import type { Audit, Bootstrap, Project } from "../shared/types.js";
if (!process.argv.includes("--run-local")) {
  console.log(
    "Not run. --run-local exercises the real complete demo router over loopback HTTP, real native Mastra checkpoint recovery and Chromium. Only Gemma/free-pricing are retained offline fixtures; no provider calls or hosted claim.",
  );
} else {
  const directory = path.resolve(
    "work/mastra-approval-http/" +
      new Date().toISOString().replace(/[:.]/g, "-"),
  );
  await mkdir(directory, { recursive: true });
  const save = (name: string, value: unknown) =>
    writeFile(
      path.join(directory, name),
      JSON.stringify(value, null, 2) + "\n",
      { flag: "wx" },
    );
  const fixtureFile =
    "docs/evidence/hosted-open-model/2026-10-15T10-55-27Z/generated-project.json";
  const bytes = await readFile(fixtureFile),
    fixture: Project = JSON.parse(bytes.toString());
  const memory = monitorProcessTree();
  const receipt: any = {
    startedAt: new Date().toISOString(),
    status: "running",
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    workingTreeDirty: !!execFileSync("git", ["status", "--porcelain"], {
      encoding: "utf8",
    }).trim(),
    scope:
      "Local full demo router over HTTP, actual Mastra snapshots and Chromium; fixture Gemma response and free-pricing check. Not hosted, no fresh inference, no Temporal process.",
    remoteProviderCalls: 0,
    fixture: {
      file: fixtureFile,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    approvalActor:
      "Owner-authorized controlled local HTTP test; not human acceptance",
    runtime: {
      node: process.version,
      heapArguments: process.execArgv,
      chromium: execFileSync(chromium.executablePath(), ["--version"], {
        encoding: "utf8",
      }).trim(),
    },
    calls: [],
  };
  let proposalCalls = 0,
    browserCalls = 0;
  const demo = createDemoRouter({
    evidenceRoot: path.join(directory, "evidence"),
    secureCookie: false,
    approvalEnabled: true,
    gemmaAvailable: () => true,
    tigerAvailable: () => false,
    verifyGemmaFree: async () => ({ fixture: true }),
    generateGemma: async (requirements) => {
      proposalCalls++;
      assert.equal(requirements.join("\n"), fixture.brief);
      return {
        model: "gemma-4-26b-a4b-it",
        usage: null,
        latencyMs: 0,
        checks: fixture.checks.map((check, requirementIndex) => ({
          requirementIndex,
          kind: check.kind,
          path: check.path,
          expected: check.expected,
          viewport: check.viewport,
        })),
      };
    },
    createApprovalRun: (options) =>
      createHostedApprovalRun({
        ...options,
        onCheckpoint: async (phase, snapshot) => {
          await save(`native-${phase}-snapshot.json`, snapshot);
          memory.setPhase(
            phase === "approval" ? "approval-wait" : "browser-dispatch",
          );
        },
      }),
    execute: async (...args) => {
      browserCalls++;
      memory.setPhase("chromium");
      try {
        return await runAudit(...args);
      } finally {
        memory.setPhase("sdk-completion");
      }
    },
  });
  const app = express();
  app.use(express.json());
  app.use(demo.router);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  let cookie = "";
  const request = async <T = any>(
    route: string,
    options: { body?: unknown; method?: string; expected?: number } = {},
  ) => {
    const response = await fetch(origin + route, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      redirect: "error",
      signal: AbortSignal.timeout(90_000),
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(options.body !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      body:
        options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
    const set = response.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const value = await response.json();
    receipt.calls.push({ route, status: response.status });
    assert.equal(
      response.status,
      options.expected ?? 200,
      JSON.stringify(value),
    );
    return value as T;
  };
  try {
    const boot = await request<Bootstrap>("/api/bootstrap");
    const sample = boot.projects.find((p) => p.target === "sample");
    assert(sample);
    memory.setPhase("proposal-sdk");
    const proposed = await request<Project>(
      `/api/projects/${sample.id}/generate-gemma`,
      { body: { modelConsent: true } },
    );
    assert.equal(proposed.approvalWorkflow?.status, "suspended");
    assert.equal(browserCalls, 0);
    assert.equal(proposalCalls, 1);
    await save("project-before-approval.json", proposed);
    memory.setPhase("review");
    await pause(150);
    await memory.measure();
    const approved = await request<Project>(
      `/api/projects/${sample.id}/checks`,
      {
        method: "PUT",
        body: {
          checks: proposed.checks.map((c) => ({
            ...c,
            approved: c.kind !== "manual",
          })),
        },
      },
    );
    await save("controlled-test-approval.json", {
      actor: receipt.approvalActor,
      approvedAt: new Date().toISOString(),
      checks: approved.checks,
    });
    memory.setPhase("approval-resume-sdk");
    let audit = await request<Audit>(`/api/projects/${sample.id}/audits`, {
      body: {},
      expected: 202,
    });
    for (let i = 0; i < 90 && audit.status === "running"; i++) {
      await pause(200);
      audit = await request<Audit>(`/api/audits/${audit.id}`);
    }
    await save("completed-audit.json", audit);
    assert.equal(audit.status, "completed");
    assert.equal(audit.approvalWorkflow?.status, "success");
    assert.equal(audit.approvalWorkflow.runId, proposed.approvalWorkflow.runId);
    assert.deepEqual(
      audit.approvalWorkflow.lifecycle?.map((s) => [
        s.phase,
        s.status,
        s.workerExited,
      ]),
      [
        ["approval", "suspended", true],
        ["browser", "suspended", true],
        ["complete", "success", true],
      ],
    );
    receipt.browserCounts = Object.fromEntries(
      ["passed", "failed", "blocked", "unverified"].map((status) => [
        status,
        audit.results.filter((r) => r.status === status).length,
      ]),
    );
    assert.deepEqual(receipt.browserCounts, {
      passed: 5,
      failed: 0,
      blocked: 0,
      unverified: 1,
    });
    assert.equal(browserCalls, 1);
    assert.equal(proposalCalls, 1);
    receipt.status = "verified";
  } catch (error) {
    receipt.status = "failed";
    receipt.failure =
      error instanceof Error
        ? { name: error.name, message: error.message }
        : { name: "UnknownError" };
    throw error;
  } finally {
    await demo.dispose();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await memory.measure();
    memory.stop();
    receipt.completedAt = new Date().toISOString();
    receipt.memory = memory.receipt;
    receipt.proposalCalls = proposalCalls;
    receipt.browserCalls = browserCalls;
    await save("receipt.json", receipt);
    const files: any[] = [];
    const collect = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) await collect(file);
        else {
          const bytes = await readFile(file);
          files.push({
            path: path.relative(directory, file),
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          });
        }
      }
    };
    await collect(directory);
    await save("manifest.json", { files });
    console.log(
      JSON.stringify({
        directory,
        status: receipt.status,
        counts: receipt.browserCounts,
        memory: receipt.memory,
      }),
    );
  }
}
