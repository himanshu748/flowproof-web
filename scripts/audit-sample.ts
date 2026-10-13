import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runAudit } from "../server/runner.js";
import { SAMPLE_URL, SAMPLE_BRIEF, sampleChecks } from "../server/sample.js";
import type { Audit, Project } from "../shared/types.js";

const output = path.resolve(process.env.AUDIT_OUTPUT ?? "work/sample-audit");
await mkdir(output, { recursive: true });
const reports: Audit[] = [];
for (const variant of ["healthy", "broken"] as const) {
  const createdAt = new Date().toISOString();
  const checks = sampleChecks(true);
  const project: Project = {
    id: "forma-ci",
    name: "Forma Studio",
    url: SAMPLE_URL,
    target: "sample",
    sampleVariant: variant,
    authorized: true,
    brief: SAMPLE_BRIEF,
    checks,
    createdAt,
    updatedAt: createdAt,
    generator: { provider: "approved synthetic fixture", model: null },
  };
  const audit: Audit = {
    id: `sample-${variant}`,
    projectId: project.id,
    projectName: project.name,
    status: "running",
    createdAt,
    checks: structuredClone(checks),
    results: [],
  };
  const results = await runAudit(project, audit, () => {}, {
    evidenceRoot: path.join(output, "evidence"),
  });
  audit.results = results;
  audit.status = "completed";
  audit.completedAt = new Date().toISOString();
  reports.push(audit);
  await writeFile(
    path.join(output, `${variant}.json`),
    JSON.stringify(audit, null, 2),
  );
  const expected =
    variant === "healthy"
      ? ["passed", "passed", "passed", "passed", "passed", "unverified"]
      : ["failed", "passed", "failed", "failed", "failed", "unverified"];
  const actual = results.map((result) => result.status);
  console.log(`${variant}: ${actual.join(", ")}`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(
      `${variant} did not produce the expected observed results. Evidence: ${output}`,
    );
    process.exitCode = 1;
  }
}
await writeFile(
  path.join(output, "summary.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      source: "real local Playwright Chromium execution against synthetic HTML",
      modelEvaluated: false,
      audits: reports,
    },
    null,
    2,
  ),
);
console.log(`Audit evidence saved to ${output}`);
