import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { runAudit } from "../server/runner.js";
import { SAMPLE_URL, SAMPLE_BRIEF, sampleChecks } from "../server/sample.js";
import type { Audit, Project } from "../shared/types.js";
import { compareAudits, snapshotSource } from "../shared/compare-audits.js";
import { renderReport } from "../server/report.js";

const output = path.resolve(process.env.AUDIT_OUTPUT ?? "work/sample-audit");
await mkdir(output, { recursive: true });
const reports: Audit[] = [];
for (const label of ["healthy", "broken", "recovered"] as const) {
  const variant = label === "broken" ? "broken" : "healthy";
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
    id: randomUUID(),
    projectId: project.id,
    projectName: project.name,
    status: "running",
    createdAt,
    checks: structuredClone(checks),
    source: snapshotSource(project),
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
    path.join(output, `${label}.json`),
    JSON.stringify(audit, null, 2),
  );
  await writeFile(
    path.join(output, `${label}.html`),
    await renderReport(audit, (value) =>
      readFile(
        path.join(output, value.replace(/^\/evidence\//, "evidence/")),
      ).catch(() => null),
    ),
  );
  const expected =
    variant === "healthy"
      ? ["passed", "passed", "passed", "passed", "passed", "unverified"]
      : ["failed", "passed", "failed", "failed", "failed", "unverified"];
  const actual = results.map((result) => result.status);
  console.log(`${label}: ${actual.join(", ")}`);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(
      `${variant} did not produce the expected observed results. Evidence: ${output}`,
    );
    process.exitCode = 1;
  }
}
const regression = compareAudits(reports[1], reports[0]);
const recovery = compareAudits(reports[2], reports[1]);
if (
  !regression.comparable ||
  regression.counts.regressed !== 4 ||
  !recovery.comparable ||
  recovery.counts.recovered !== 4 ||
  recovery.counts.unknown !== 1
) {
  console.error(
    "The observed comparison did not establish four regressions and four recoveries with manual review still unknown.",
  );
  process.exitCode = 1;
}
await writeFile(
  path.join(output, "comparison.json"),
  JSON.stringify({ regression, recovery }, null, 2),
);
const markdown = [
  "## Briefstamp acceptance evidence",
  "",
  "Real Chromium execution against a controlled synthetic website. The same approved fixture plan is used for every run. No model is called in CI.",
  "",
  "| Website condition | Passed | Failed | Blocked | Unverified |",
  "| --- | ---: | ---: | ---: | ---: |",
  ...reports.map(
    (audit, index) =>
      `| ${["Healthy", "Intentionally broken", "Repaired (healthy fixture restored)"][index]} | ${["passed", "failed", "blocked", "unverified"].map((status) => audit.results.filter((row) => row.status === status).length).join(" | ")} |`,
  ),
  "",
  `Observed changes: **${regression.counts.regressed} regressions**, then **${recovery.counts.recovered} recoveries**. The subjective requirement remains unverified throughout.`,
  "",
  "Download the flowproof-evidence artifact for standalone HTML delivery reports with embedded screenshots, per-run JSON, and comparison.json. A fixture restored by this test harness is not an autonomous code repair or client acceptance.",
  "",
].join("\n");
await writeFile(path.join(output, "summary.md"), markdown);
if (process.env.GITHUB_STEP_SUMMARY)
  await appendFile(process.env.GITHUB_STEP_SUMMARY, markdown);
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
