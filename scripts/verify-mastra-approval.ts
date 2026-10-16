import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { Audit, Check, Project } from "../shared/types.js";

const args = process.argv.slice(2);
if (!args.includes("--run-local")) {
  console.log(
    "Not run. --run-local replays a retained Gemma proposal through real Mastra suspend/resume and local synthetic Chromium; no provider calls or judge slots.",
  );
} else {
  const outputIndex = args.indexOf("--output");
  const output = path.resolve(
    outputIndex >= 0
      ? args[outputIndex + 1]
      : "work/mastra-approval/" +
          new Date().toISOString().replace(/[:.]/g, "-"),
  );
  if (!output.startsWith(path.resolve("work") + path.sep))
    throw Error("Evidence must use a new directory under work/");
  await mkdir(path.dirname(output), { recursive: true });
  await mkdir(output, { recursive: false });
  const save = (name: string, value: unknown) =>
    writeFile(
      path.join(output, name),
      JSON.stringify(
        value,
        (_k, value) =>
          value instanceof Error
            ? { name: value.name, message: value.message }
            : value,
        2,
      ) + "\n",
      { flag: "wx" },
    );
  process.env.MASTRA_TELEMETRY_DISABLED = "1";
  process.env.FLOWPROOF_SENTRY_ENABLED = "false";
  const fixtureFile =
    "docs/evidence/hosted-open-model/2026-10-15T10-55-27Z/generated-project.json";
  const fixtureBytes = await readFile(fixtureFile);
  const sha = (value: string | Buffer) =>
    createHash("sha256").update(value).digest("hex");
  const original = JSON.parse(fixtureBytes.toString("utf8")) as Project;
  assert.equal(original.target, "sample");
  assert.equal(original.sampleVariant, "healthy");
  assert.equal(original.url, "https://sample.flowproof.test/");
  assert(original.checks.every((c) => !c.approved));
  const receipt: any = {
    startedAt: new Date().toISOString(),
    status: "running",
    sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    scope:
      "Real local/CI Mastra suspension and resumption; retained actual Gemma proposal replay, fresh synthetic Chromium only",
    fixture: {
      file: fixtureFile,
      sha256: sha(fixtureBytes),
      freshModelInference: false,
    },
    approvalActor:
      "Owner-instructed automated verifier; not human or customer acceptance",
    remoteProviderCalls: 0,
    publicJudgeReservationsConsumed: 0,
    durableMastraStorage: false,
    hostedApprovalFlow: false,
  };
  let proposalCalls = 0;
  let browserCalls = 0;
  try {
    const { createApprovalWorkflow } = await import(
      "../server/approval-workflow.js"
    );
    const { runAudit } = await import("../server/runner.js");
    const runtime = await createApprovalWorkflow({
      propose: async ({ brief }: { brief: string }) => {
        assert.equal(++proposalCalls, 1);
        assert.equal(brief, original.brief);
        return structuredClone(original.checks);
      },
      execute: async (approvedChecks: Check[]) => {
        assert.equal(++browserCalls, 1);
        assert.deepEqual(
          approvedChecks,
          original.checks.map((c) => ({ ...c, approved: true })),
        );
        const now = new Date().toISOString();
        const project: Project = {
          ...structuredClone(original),
          id: randomUUID(),
          checks: approvedChecks,
          createdAt: now,
          updatedAt: now,
          generator: {
            provider: "Retained Google Gemma proposal (replay)",
            model: original.generator.model,
            reason:
              "No fresh inference; proposal source hash is in this receipt",
          },
        };
        const audit: Audit = {
          id: randomUUID(),
          projectId: project.id,
          projectName: "Mastra approval proof",
          createdAt: now,
          status: "running",
          checks: structuredClone(approvedChecks),
          results: [],
        };
        await save("browser-handoff.json", { project, audit });
        const results = await runAudit(project, audit, () => {}, {
          evidenceRoot: path.join(output, "evidence"),
        });
        audit.results = results;
        audit.status = "completed";
        audit.completedAt = new Date().toISOString();
        await save("browser-audit.json", audit);
        return results;
      },
    });
    const run = await runtime.workflow.createRun();
    receipt.runId = run.runId;
    receipt.workflowId = runtime.workflow.id;
    const suspended = await run.start({ inputData: { brief: original.brief } });
    await save("suspended-state.json", suspended);
    assert.equal(suspended.status, "suspended");
    assert.equal(proposalCalls, 1);
    assert.equal(browserCalls, 0);
    const payload = (suspended.steps as any)[runtime.approvalStepId]
      .suspendPayload;
    assert(payload && /^[a-f0-9]{64}$/.test(payload.planDigest));
    const resumePayload = {
      planDigest: payload.planDigest,
      approvedCheckIds: original.checks.map((c) => c.id),
    };
    await save("resume-payload.json", {
      step: runtime.approvalStepId,
      resumeData: resumePayload,
      approvalActor: receipt.approvalActor,
      approvedAt: new Date().toISOString(),
    });
    receipt.suspended = {
      status: suspended.status,
      browserCalls,
      proposalCalls,
      planDigest: payload.planDigest,
    };
    const resumed = await run.resume({
      step: runtime.approvalStepId,
      resumeData: resumePayload,
    });
    await save("resumed-state.json", resumed);
    assert.equal(resumed.status, "success");
    assert.equal(browserCalls, 1);
    assert.equal(proposalCalls, 1);
    const audit = JSON.parse(
      await readFile(path.join(output, "browser-audit.json"), "utf8"),
    ) as Audit;
    assert.equal(audit.results.length, original.checks.length);
    assert(
      audit.results.every(
        (r) => r.kind !== "manual" || r.status === "unverified",
      ),
    );
    assert.equal(sha(await readFile(fixtureFile)), receipt.fixture.sha256);
    receipt.results = Object.fromEntries(
      ["passed", "failed", "blocked", "unverified"].map((s) => [
        s,
        audit.results.filter((r) => r.status === s).length,
      ]),
    );
    assert.deepEqual(
      receipt.results,
      { passed: 5, failed: 0, blocked: 0, unverified: 1 },
      "The healthy retained plan must execute in Chromium, not return blocked placeholders",
    );
    receipt.screenshots = [];
    for (const result of audit.results.filter((r) => r.kind !== "manual")) {
      const screenshot = result.evidence.screenshot;
      assert(
        typeof screenshot === "string" && screenshot.startsWith("/evidence/"),
      );
      const file = path.resolve(output, screenshot.slice(1));
      assert(file.startsWith(path.resolve(output, "evidence") + path.sep));
      const bytes = await readFile(file);
      assert(
        bytes
          .subarray(0, 8)
          .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
        "Actual screenshot PNG required",
      );
      receipt.screenshots.push({
        checkId: result.checkId,
        file: path.relative(output, file),
        bytes: bytes.length,
        sha256: sha(bytes),
      });
    }
    receipt.resumed = {
      status: resumed.status,
      browserCalls,
      proposalCalls,
      sameRunId: run.runId === receipt.runId,
      approvedCheckIds: resumePayload.approvedCheckIds,
    };
    receipt.status = "verified";
    receipt.completedAt = new Date().toISOString();
  } catch (e) {
    receipt.status = "failed";
    receipt.failure =
      e instanceof Error
        ? { name: e.name, message: e.message }
        : { name: "unknown" };
    throw e;
  } finally {
    receipt.proposalReplayCalls = proposalCalls;
    receipt.browserCalls = browserCalls;
    await save("receipt.json", receipt);
    const files: Array<{ name: string; bytes: number; sha256: string }> = [];
    const walk = async (directory: string): Promise<void> => {
      for (const item of await readdir(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory()) await walk(file);
        else {
          const b = await readFile(file);
          files.push({
            name: path.relative(output, file),
            bytes: b.length,
            sha256: sha(b),
          });
        }
      }
    };
    await walk(output);
    await save("manifest.json", {
      sourceCommit: receipt.sourceCommit,
      files,
      actionsRunUrl: process.env.GITHUB_ACTIONS
        ? `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
    });
    console.log(
      JSON.stringify({
        output,
        status: receipt.status,
        results: receipt.results,
        browserCalls,
        proposalCalls,
      }),
    );
  }
}
