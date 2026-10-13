import fs from "node:fs/promises";
import assert from "node:assert/strict";
import type { Audit, Project } from "../shared/types";
const base = "http://127.0.0.1:4310/api";
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(base + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok)
    throw new Error(`${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}
const start = Date.now();
const project = await api<Project>("/projects", "POST", {
  name: "Gemma proposal demonstration",
  target: "sample",
  sampleVariant: "healthy",
  authorized: true,
  brief: 'The homepage must show "Independent by design."',
});
assert.equal(
  project.generator.provider,
  "Ollama (local)",
  "Fallback output does not establish AI generation",
);
assert(
  project.checks.every((c) => !c.approved),
  "AI must not grant itself execution approval",
);
const generationMs = Date.now() - start;
await api(`/projects/${project.id}/checks`, "PUT", {
  checks: project.checks.map((c) => ({ ...c, approved: true })),
});
let audit = await api<Audit>(`/projects/${project.id}/audits`, "POST", {});
for (let i = 0; i < 130 && audit.status === "running"; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  audit = await api<Audit>(`/audits/${audit.id}`);
}
assert.equal(audit.status, "completed");
assert.equal(audit.results[0]?.status, "passed");
const report = await fetch(`${base}/audits/${audit.id}/report`);
assert.equal(report.status, 200);
await fs.writeFile("outputs/flowproof-ai-report.html", await report.text());
const receipt = {
  recordedAt: new Date().toISOString(),
  scope:
    "Real local API generation, approval gate and Chromium execution on one synthetic requirement. Not a benchmark.",
  provider: project.generator,
  modelGenerationMs: generationMs,
  projectId: project.id,
  auditId: audit.id,
  originallyApproved: project.checks[0].approved,
  result: audit.results[0].status,
  observed: audit.results[0].evidence.observed,
};
await fs.writeFile(
  "outputs/ai-workflow-verification.json",
  JSON.stringify(receipt, null, 2),
);
console.log(JSON.stringify(receipt, null, 2));
