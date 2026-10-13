import fs from "node:fs/promises";
import assert from "node:assert/strict";
import type { Audit, Bootstrap, Project } from "../shared/types";

const base = process.env.FLOWPROOF_VERIFY_URL || "http://127.0.0.1:4310";
const request = async <T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> => {
  const r = await fetch(base + "/api" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok)
    throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  return r.json() as Promise<T>;
};
await fs.mkdir("outputs", { recursive: true });
const bootstrap = await request<Bootstrap>("/bootstrap");
const project = bootstrap.projects.find((p) => p.target === "sample");
assert(project, "The seeded sample must exist");
await request(`/projects/${project.id}/generate`, "POST", {
  brief: project.brief.replace(
    "descriptive alternative text",
    "nonempty alternative text",
  ),
});
const evidence: {
  variant: string;
  auditId: string;
  results: Record<string, number>;
  report: string;
}[] = [];
for (const variant of ["healthy", "broken"] as const) {
  const p: Project = await request<Project>(
    `/projects/${project.id}/variant`,
    "POST",
    { sampleVariant: variant },
  );
  const blocked: Response = await fetch(`${base}/api/projects/${p.id}/audits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(
    blocked.status,
    409,
    "Unapproved executable checks must not run",
  );
  await request(`/projects/${p.id}/checks`, "PUT", {
    checks: p.checks.map((c) => ({ ...c, approved: c.kind !== "manual" })),
  });
  let a = await request<Audit>(`/projects/${p.id}/audits`, "POST", {});
  const deadline = Date.now() + 130000;
  while (["running", "queued"].includes(a.status) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 700));
    a = await request<Audit>(`/audits/${a.id}`);
  }
  assert.equal(a.status, "completed", a.error);
  assert.equal(a.results.length, 6);
  const counts = Object.fromEntries(
    ["passed", "failed", "blocked", "unverified"].map((s) => [
      s,
      a.results.filter((r) => r.status === s).length,
    ]),
  );
  assert.deepEqual(
    counts,
    variant === "healthy"
      ? { passed: 5, failed: 0, blocked: 0, unverified: 1 }
      : { passed: 2, failed: 3, blocked: 0, unverified: 1 },
  );
  for (const r of a.results.filter((r) => r.status !== "unverified")) {
    assert(r.evidence.screenshot);
    const image = await fetch(base + r.evidence.screenshot);
    assert.equal(image.status, 200);
    assert((await image.arrayBuffer()).byteLength > 1000);
  }
  const report = await fetch(`${base}/api/audits/${a.id}/report`);
  assert.equal(report.status, 200);
  const html = await report.text();
  assert(html.includes("data:image/png;base64,"));
  const reportPath = `outputs/flowproof-${variant}-report.html`;
  await fs.writeFile(reportPath, html);
  evidence.push({
    variant,
    auditId: a.id,
    results: counts,
    report: reportPath,
  });
}
let retrieval: { results: unknown[]; mode: string } = { results: [], mode: "" };
for (let i = 0; i < 20; i++) {
  retrieval = await request("/failures?q=mobile%20layout%20width");
  if (retrieval.results.length) break;
  await new Promise((r) => setTimeout(r, 500));
}
assert(retrieval.results.length > 0, "Saved failures must be retrievable");
const unsafe = await fetch(base + "/api/projects", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "Unsafe test",
    target: "website",
    url: "https://127.0.0.1/",
    authorized: true,
    brief: 'The homepage must show "Hello".',
  }),
});
assert.equal(unsafe.status, 400);
const cross = await fetch(`${base}/api/projects/${project.id}/variant`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Origin: "https://untrusted.invalid",
  },
  body: JSON.stringify({ sampleVariant: "healthy" }),
});
assert.equal(cross.status, 403);
await request(`/projects/${project.id}/variant`, "POST", {
  sampleVariant: "healthy",
});
const summary = {
  executedAt: new Date().toISOString(),
  scope: "Live local API, real Chromium, synthetic healthy/broken site",
  storage: bootstrap.storage,
  audits: evidence,
  retrieval: { mode: retrieval.mode, resultCount: retrieval.results.length },
  approvalGate: "verified",
  privateNetworkGate: "verified",
  crossOriginWriteGate: "verified",
  remoteCI: "not evaluated",
  tigerCloud: "not evaluated",
};
await fs.writeFile(
  "outputs/verification.json",
  JSON.stringify(summary, null, 2),
);
console.log(JSON.stringify(summary, null, 2));
