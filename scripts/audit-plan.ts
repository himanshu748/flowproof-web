import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { validateChecks } from "../server/schema";
import { runAudit } from "../server/runner";
import type { Project, Audit } from "../shared/types";
import { snapshotSource } from "../shared/compare-audits";

const inputPath = process.argv[2];
if (!inputPath)
  throw new Error("Usage: npm run audit:plan -- flowproof-plan.json");
const plan = z
  .object({
    version: z.literal(1),
    project: z.object({
      id: z.string(),
      name: z.string(),
      url: z.string(),
      target: z.enum(["sample", "website"]),
      sampleVariant: z.enum(["healthy", "broken"]),
      authorized: z.literal(true),
      checks: z.array(z.unknown()),
      brief: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      generator: z.object({
        provider: z.string(),
        model: z.string().nullable(),
      }),
    }),
  })
  .parse(JSON.parse(await fs.readFile(inputPath, "utf8")));
const project: Project = {
  ...plan.project,
  checks: validateChecks(plan.project.checks),
};
if (project.checks.some((c) => c.kind !== "manual" && !c.approved))
  throw new Error(
    "The saved plan must be approved by its owner before CI executes it.",
  );
const audit: Audit = {
  id: randomUUID(),
  projectId: project.id,
  projectName: project.name,
  status: "running",
  createdAt: new Date().toISOString(),
  checks: project.checks,
  source: snapshotSource(project),
  results: [],
};
const output = path.resolve("work/ci-audit");
await fs.mkdir(output, { recursive: true });
try {
  audit.results = await runAudit(project, audit, () => {}, {
    evidenceRoot: path.join(output, "evidence"),
  });
  audit.status = "completed";
} catch (e) {
  audit.status = "error";
  audit.error = e instanceof Error ? e.message : "Audit failed";
} finally {
  audit.completedAt = new Date().toISOString();
  await fs.writeFile(
    path.join(output, "audit.json"),
    JSON.stringify(audit, null, 2),
  );
}
console.log(
  JSON.stringify(
    {
      auditId: audit.id,
      status: audit.status,
      results: audit.results.map((r) => ({
        requirement: r.requirement,
        status: r.status,
      })),
    },
    null,
    2,
  ),
);
if (
  audit.status === "error" ||
  audit.results.some((r) => r.status === "failed" || r.status === "blocked") ||
  !audit.results.some((r) => r.status === "passed")
)
  process.exitCode = 1;
