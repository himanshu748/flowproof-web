import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Audit, Project } from "../shared/types.js";

if (!process.argv.includes("--run-local")) {
  console.error(
    "Opt in with --run-local to execute synthetic Chromium audits and capture Sentry envelopes locally. No model or cloud calls are made.",
  );
  process.exit(2);
}
const startedAt = new Date().toISOString();
const runId = startedAt.replace(/[:.]/g, "-");
const output = path.resolve("work/orchestration-verification", runId);
const published = path.resolve("docs/evidence/orchestration", runId);
await mkdir(output, { recursive: true });
await mkdir(published, { recursive: true });
process.env.MASTRA_TELEMETRY_DISABLED = "1";
process.env.FLOWPROOF_SENTRY_ENABLED = "false";
process.env.FLOWPROOF_AI_ENABLED = "false";
process.env.FLOWPROOF_GEMMA_ENABLED = "false";
delete process.env.DATABASE_URL;
const receipt: Record<string, unknown> = {
  startedAt,
  runId,
  status: "running",
  scope:
    "Real local Mastra workflows and Sentry SDK local transport; synthetic browser targets",
  modelCalls: 0,
  remoteProviderCalls: 0,
  hostedSentryIngestionVerified: false,
  humanApproval: false,
  approvalActor: "Explicitly opted-in synthetic verification harness",
};
receipt.sources = await Promise.all(
  [
    "server/orchestration.ts",
    "server/observability.ts",
    "server/runner.ts",
    "server/schema.ts",
    "server/generator.ts",
    "scripts/verify-orchestration.ts",
    "package-lock.json",
  ].map(async (file) => {
    const bytes = await readFile(file);
    return {
      file,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  }),
);
const envelopes: unknown[] = [];
let closeTelemetry: (() => Promise<void>) | undefined;
try {
  const [
    { generateChecksWithOrchestration, runAuditWithOrchestration },
    telemetry,
    { SAMPLE_URL },
  ] = await Promise.all([
    import("../server/orchestration.js"),
    import("../server/observability.js"),
    import("../server/sample.js"),
  ]);
  closeTelemetry = telemetry.closeObservability;
  receipt.observability = telemetry.initObservability({
    captureEnvelope: (envelope) => {
      envelopes.push(envelope);
    },
    maxEnvelopes: 20,
  });
  receipt.dependencies = Object.fromEntries(
    await Promise.all(
      ["@mastra/core", "@sentry/node"].map(async (name) => {
        const meta = JSON.parse(
          await readFile(
            path.join("node_modules", name, "package.json"),
            "utf8",
          ),
        );
        return [name, meta.version];
      }),
    ),
  );
  const brief = [
    'The homepage must show the heading "Design that moves business forward."',
    'The page must show "Independent by design."',
    'A link labeled "Start a project" must be visible.',
    "The design should feel trustworthy.",
  ].join("\n");
  const proposal = await generateChecksWithOrchestration(brief, {
    allowModel: false,
  });
  assert.equal(proposal.generator.provider, "Deterministic parser");
  assert.ok(proposal.checks.every((check) => !check.approved));
  receipt.proposal = proposal;
  const now = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    name: "Mastra synthetic verification",
    target: "sample",
    sampleVariant: "healthy",
    authorized: true,
    url: SAMPLE_URL,
    brief,
    checks: structuredClone(proposal.checks),
    generator: proposal.generator,
    createdAt: now,
    updatedAt: now,
  };
  const newAudit = (): Audit => ({
    id: randomUUID(),
    projectId: project.id,
    projectName: project.name,
    createdAt: new Date().toISOString(),
    status: "running",
    checks: structuredClone(project.checks),
    results: [],
  });
  await assert.rejects(
    () => runAuditWithOrchestration(project, newAudit(), () => {}),
    /approved plan/,
  );
  receipt.unapprovedRejected = true;
  project.checks = project.checks.map((check) => ({
    ...check,
    approved: true,
  }));
  const audits: unknown[] = [];
  for (const variant of ["healthy", "broken"] as const) {
    project.sampleVariant = variant;
    const audit = newAudit();
    const executed = await runAuditWithOrchestration(project, audit, () => {}, {
      evidenceRoot: path.join(output, "evidence"),
      allowModelSummary: false,
    });
    const statuses = executed.results.map((result) => result.status);
    assert.deepEqual(
      statuses,
      variant === "healthy"
        ? ["passed", "passed", "passed", "unverified"]
        : ["failed", "passed", "passed", "unverified"],
    );
    const screenshots = await Promise.all(
      executed.results
        .flatMap((result) =>
          result.evidence.screenshot ? [result.evidence.screenshot] : [],
        )
        .map(async (url) => {
          const bytes = await readFile(path.join(output, url.slice(1)));
          return {
            evidencePath: url,
            bytes: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          };
        }),
    );
    audits.push({
      variant,
      statuses,
      summary: executed.summary,
      orchestration: executed.orchestration,
      results: executed.results,
      screenshots,
    });
    console.log(`${variant}: ${statuses.join(", ")}`);
  }
  receipt.audits = audits;
  await telemetry.traceOperation(
    "briefstamp.audit",
    { checkCount: 4, target: "sample" },
    async () => {
      telemetry.captureOperationalError("briefstamp.audit");
    },
  );
  assert.equal(await telemetry.flushObservability(), true);
  assert.ok(envelopes.length > 0);
  const serialized = JSON.stringify(envelopes);
  assert.ok(
    serialized.includes('"transaction"'),
    "At least one actual SDK trace envelope must be captured",
  );
  assert.ok(
    serialized.includes("BriefstampOperationError"),
    "At least one actual SDK error envelope must be captured",
  );
  assert.ok(!serialized.includes(brief));
  assert.ok(!serialized.includes("Design that moves business forward"));
  assert.ok(!serialized.includes(SAMPLE_URL));
  receipt.sentry = {
    envelopesCaptured: envelopes.length,
    transport: "custom local in-memory sink",
    privateBriefAndTargetAbsent: true,
    hostedIngestionVerified: false,
  };
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed";
  receipt.failure = {
    name: error instanceof Error ? error.name : "Error",
    code:
      typeof error === "object" && error && "code" in error
        ? String(error.code)
        : null,
    message:
      error instanceof Error
        ? error.message.replaceAll(process.cwd(), "[workspace]")
        : "Local verification did not complete",
  };
  process.exitCode = 1;
} finally {
  await closeTelemetry?.();
  receipt.completedAt = new Date().toISOString();
  receipt.limitations = [
    "Synthetic targets only; harness approval is not human or customer validation.",
    "Deterministic proposal generation in this orchestration proof; separate Gemma/Tinker experiments establish model evidence.",
    "No Mastra cloud storage, durable recovery or Sentry hosted ingestion is claimed.",
    "Screenshots are local run artifacts; their bytes and hashes are recorded here.",
  ];
  const files = {
    "receipt.json": JSON.stringify(receipt, null, 2) + "\n",
    "sentry-envelopes.json": JSON.stringify(envelopes, null, 2) + "\n",
  };
  for (const [name, data] of Object.entries(files)) {
    await writeFile(path.join(output, name), data);
    await writeFile(path.join(published, name), data);
  }
  const manifest = Object.entries(files).map(([file, data]) => ({
    file,
    bytes: Buffer.byteLength(data),
    sha256: createHash("sha256").update(data).digest("hex"),
  }));
  await writeFile(
    path.join(published, "manifest.json"),
    JSON.stringify({ files: manifest }, null, 2) + "\n",
  );
  console.log(
    `Verification ${receipt.status}; ${path.relative(process.cwd(), published)}`,
  );
}
