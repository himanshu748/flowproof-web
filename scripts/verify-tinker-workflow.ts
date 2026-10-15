import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { compareAudits, snapshotSource } from "../shared/compare-audits.js";
import type { Audit, Check, Project } from "../shared/types.js";

const { values } = parseArgs({
  options: {
    "run-provider": { type: "boolean", default: false },
    "training-receipt": { type: "string" },
    restore: { type: "boolean", default: false },
  },
});
if (!values["run-provider"]) {
  console.log(
    JSON.stringify(
      {
        status: "not_run",
        providerCalls: 0,
        browserExecutions: 0,
        instructions:
          "Opt in with --run-provider --training-receipt <fresh completed training receipt> [--restore] only after confirming a sufficient free allowance and disabled paid overage. No resources are created or funded by this command.",
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

const startedAt = new Date().toISOString();
const runId = startedAt.replace(/[:.]/g, "-");
const output = path.resolve("work/tinker-workflow", runId);
const publication = path.resolve("docs/evidence/tinker-workflow", runId);
const evidenceRoot = path.join(output, "evidence");
await mkdir(output, { recursive: true, mode: 0o700 });
const hash = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const json = (name: string, value: unknown) =>
  writeFile(path.join(output, name), JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
class SmokeFailure extends Error {}
function requireThat(value: unknown, message: string): asserts value {
  if (!value) throw new SmokeFailure(message);
}
async function filesOf(directory: string, prefix = ""): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      files.push(
        ...(await filesOf(path.join(directory, entry.name), relative)),
      );
    else files.push(relative);
  }
  return files.sort();
}
const semantics = (checks: Check[]) =>
  checks.map(({ id: _id, approved: _approved, ...check }) => check);
const receipt: Record<string, unknown> = {
  schemaVersion: 1,
  runId,
  startedAt,
  status: "running",
  phase: "preflight",
  scope:
    "One synthetic application smoke through the real Tinker adapter, Mastra workflows and Chromium; not a new model-quality evaluation",
  maxProviderCalls: 1,
  humanApproval: false,
  humanValidation: false,
  frozenBenchmarkModified: false,
  funding:
    "The native persistent guard must reserve a fresh credential-bound confirmed-free allowance before the single request; this smoke does not itself measure provider billing.",
  approval: {
    actor: "Explicitly opted-in synthetic verification harness",
    humanApproval: false,
    scope:
      "Only this generated heading assertion against the built-in Forma sample",
    semanticEdits: false,
  },
  limitations: [
    "One preselected supported brief and one generation attempt; failures are retained without retrying or selecting a better response.",
    "Harness approval is not human review or customer acceptance.",
    "The original baseline/fine-tuning benchmark remains unchanged; this fresh checkpoint is an application smoke only.",
    "This proves local application modules with a remote provider request, not live Tinker inference on the public Render demo.",
  ],
};
const nativeFetch = globalThis.fetch;
let providerCalls = 0;
const calls: Record<string, unknown>[] = [];
const outcomes: Record<string, unknown>[] = [];
const providerUrl =
  "https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1/completions";
let checkpoint = "";
let expectedBrief = "";

// Isolate the verification before importing application modules with store imports.
delete process.env.DATABASE_URL;
process.env.FLOWPROOF_DATA_DIR = path.join(output, "unused-store");
process.env.EVIDENCE_ROOT = evidenceRoot;
process.env.MASTRA_TELEMETRY_DISABLED = "1";
process.env.FLOWPROOF_AI_ENABLED = "false";
process.env.FLOWPROOF_GEMMA_ENABLED = "false";
process.env.FLOWPROOF_SENTRY_ENABLED = "false";
process.env.FLOWPROOF_EMBEDDINGS = "false";

try {
  await json("receipt.json", receipt);
  requireThat(
    values["training-receipt"],
    "A fresh completed training receipt is required.",
  );
  requireThat(
    process.env.BRIEFSTAMP_TINKER_ENABLED === "true",
    "The Tinker adapter is not explicitly enabled.",
  );
  requireThat(
    process.env.TINKER_API_KEY,
    "A server-side Tinker key is required.",
  );
  requireThat(
    process.env.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE,
    "A private confirmed-free allowance file is required.",
  );
  const trainingBytes = await readFile(values["training-receipt"]);
  const training = JSON.parse(trainingBytes.toString("utf8"));
  checkpoint = process.env.TINKER_MODEL_PATH ?? "";
  requireThat(
    training.schemaVersion === 2 &&
      training.operation === "training" &&
      training.status === "completed",
    "The checkpoint must have a completed v2 training receipt.",
  );
  requireThat(
    training.samplerPath === checkpoint &&
      /^tinker:\/\/[A-Za-z0-9:_-]{1,150}\/sampler_weights\/[A-Za-z0-9_.-]{1,100}$/.test(
        checkpoint,
      ),
    "The configured sampler must match the recorded training checkpoint.",
  );
  requireThat(
    Number.isInteger(training.checkpointTtlSeconds) &&
      training.checkpointTtlSeconds > 0 &&
      training.checkpointTtlSeconds <= 86400,
    "Checkpoint TTL evidence is missing or exceeds the one-day cap.",
  );
  const savedAt = Date.parse(training.samplerSavedAt ?? training.recordedAt);
  const explicitExpiry = training.checkpointExpiresAt
    ? Date.parse(training.checkpointExpiresAt)
    : Infinity;
  const expiresAt = Math.min(
    savedAt + training.checkpointTtlSeconds * 1000,
    explicitExpiry,
  );
  requireThat(
    Number.isFinite(savedAt) &&
      Number.isFinite(expiresAt) &&
      savedAt <= Date.now() &&
      expiresAt > Date.now(),
    "The sampler checkpoint is expired or has invalid timestamp evidence.",
  );
  receipt.checkpoint = {
    model: training.model,
    samplerPath: checkpoint,
    checkpointTtlSeconds: training.checkpointTtlSeconds,
    samplerSavedAt: new Date(savedAt).toISOString(),
    expiresAt: new Date(expiresAt).toISOString(),
    trainingReceiptSha256: hash(trainingBytes),
  };
  const sourceFiles = [
    "scripts/verify-tinker-workflow.ts",
    "server/providers/tinker.ts",
    "server/providers/free-resource-policy.ts",
    "server/generator.ts",
    "server/orchestration.ts",
    "server/observability.ts",
    "server/runner.ts",
    "server/report.ts",
    "server/sample.ts",
    "server/schema.ts",
    "server/safety.ts",
    "shared/types.ts",
    "shared/compare-audits.ts",
    "shared/redact.ts",
    "package-lock.json",
  ];
  receipt.source = {
    baseGitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    note: "Per-file hashes identify the executed working-tree source; the base commit may predate uncommitted changes.",
    files: await Promise.all(
      sourceFiles.map(async (file) => ({
        file,
        sha256: hash(await readFile(file)),
      })),
    ),
  };
  const { boundedBytes } = await import(
    "../server/providers/free-resource-policy.js"
  );
  // Observe the application's actual request without substituting a response.
  // Reject any second request, alternate endpoint, or unrelated fetch before I/O.
  globalThis.fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    requireThat(
      url === providerUrl && init?.method === "POST",
      "Only the fixed Tinker generation endpoint is permitted.",
    );
    requireThat(
      providerCalls === 0,
      "A second provider request is forbidden; no retry is allowed.",
    );
    const request = JSON.parse(String(init.body));
    requireThat(
      request.model === checkpoint &&
        request.stream === false &&
        request.max_tokens <= 2048 &&
        typeof request.prompt === "string" &&
        expectedBrief.length > 0 &&
        request.prompt.includes(
          JSON.stringify({ requirements: [expectedBrief] }),
        ) &&
        !Object.hasOwn(request, "messages") &&
        !Object.hasOwn(request, "reasoning_effort") &&
        !Object.hasOwn(request, "separate_reasoning") &&
        JSON.stringify(request.stop) === JSON.stringify(["<|im_end|>"]),
      "The provider request exceeds the configured sampler or response budget.",
    );
    receipt.requestContract = {
      endpoint: "completions",
      renderer:
        "Operator-rendered Qwen3.5 Hugging Face no-thinking chat template",
      promptSha256: hash(request.prompt),
      originalRequirementBound: true,
      serverChatRendererUsed: false,
    };
    await json("generation-request.json", request); // Deliberately excludes headers.
    providerCalls++;
    const call: Record<string, unknown> = {
      purpose: "generate-checks",
      startedAt: new Date().toISOString(),
      endpoint: providerUrl,
      requestModel: checkpoint,
      promptTokens: null,
      completionTokens: null,
      usageSource: "Provider response usage; null means not reported.",
    };
    calls.push(call);
    const before = performance.now();
    try {
      const response = await nativeFetch(input, init);
      call.httpStatus = response.status;
      if (!response.ok) {
        // Classify a bounded error in memory; never retain its text or identifiers.
        const errorBytes = await boundedBytes(response.clone(), 64 * 1024);
        const errorText = errorBytes.toString("utf8");
        call.errorClassification = {
          reasoningEffortUnsupported:
            /reasoning[_ ]effort/i.test(errorText) &&
            /unsupported|not supported|does not support/i.test(errorText),
          rendererMismatch:
            /renderer|chat[_ ]template/i.test(errorText) &&
            /unsupported|not supported|mismatch|error|invalid/i.test(errorText),
          missingModel:
            /model|checkpoint|sampler/i.test(errorText) &&
            /not found|does not exist|missing|expired/i.test(errorText),
        };
        call.errorResponseSha256 = hash(errorBytes);
      }
      if (response.ok) {
        const bytes = await boundedBytes(response.clone(), 64 * 1024);
        call.responseSha256 = hash(bytes);
        let envelope: Record<string, any>;
        try {
          envelope = JSON.parse(bytes.toString("utf8"));
        } catch {
          call.responseParseable = false;
          return response;
        }
        const usage = envelope.usage;
        call.promptTokens =
          Number.isInteger(usage?.prompt_tokens) && usage.prompt_tokens >= 0
            ? usage.prompt_tokens
            : null;
        call.completionTokens =
          Number.isInteger(usage?.completion_tokens) &&
          usage.completion_tokens >= 0
            ? usage.completion_tokens
            : null;
        const safeResponse = {
          provider: "Tinker",
          requestModel: checkpoint,
          choices: Array.isArray(envelope.choices)
            ? envelope.choices.map((choice: any) => ({
                finishReason: choice.finish_reason,
                text: choice.text,
              }))
            : [],
          usage: {
            promptTokens: call.promptTokens,
            completionTokens: call.completionTokens,
          },
          rawResponseSha256: call.responseSha256,
          omitted:
            "Response IDs, account/organization fields, system fingerprints and HTTP headers are not retained.",
        };
        requireThat(
          !JSON.stringify(safeResponse).includes(process.env.TINKER_API_KEY!),
          "The provider response contained credential material; no response content retained.",
        );
        await json("generation-response.json", safeResponse);
      }
      return response;
    } finally {
      call.elapsedMs = Math.round(performance.now() - before);
    }
  };
  const [
    { generateChecksWithOrchestration, runAuditWithOrchestration },
    { runAudit },
    { renderReport },
    { SAMPLE_URL, sampleChecks },
  ] = await Promise.all([
    import("../server/orchestration.js"),
    import("../server/runner.js"),
    import("../server/report.js"),
    import("../server/sample.js"),
  ]);
  const heading = sampleChecks().find(
    (check) => check.id === "sample-heading",
  )!.expected;
  const brief = `The homepage must show the heading "${heading}"`;
  expectedBrief = brief;
  await writeFile(path.join(output, "brief.txt"), brief + "\n");
  receipt.phase = "generation";
  await json("receipt.json", receipt);
  const proposal = await generateChecksWithOrchestration(brief, {
    allowModel: true,
  });
  await json("proposal-before-approval.json", proposal);
  receipt.generator = proposal.generator;
  receipt.proposalOrchestration = proposal.orchestration;
  requireThat(
    proposal.generator.provider === "Tinker (operator checkpoint)" &&
      proposal.generator.model === checkpoint,
    "The application did not return a real Tinker proposal; fallback is not provider evidence.",
  );
  requireThat(
    providerCalls === 1,
    "Exactly one actual provider request is required.",
  );
  requireThat(
    proposal.checks.length === 1,
    "The model must return exactly one assertion for this one-requirement brief.",
  );
  const proposed = proposal.checks[0];
  const rawResponse = JSON.parse(
    await readFile(path.join(output, "generation-response.json"), "utf8"),
  );
  const rawPlan = JSON.parse(rawResponse.choices[0].text);
  requireThat(
    rawPlan.checks?.length === 1,
    "The raw response must contain the same single assertion.",
  );
  const rawCheck = rawPlan.checks[0];
  requireThat(
    rawCheck.requirement === brief ||
      (rawCheck.requirement === brief + "." && /["'”’]$/u.test(brief)),
    "Only one additional sentence period outside the final quotation mark may be bound back to the original source.",
  );
  requireThat(
    (["kind", "path", "expected", "viewport"] as const).every(
      (field) => rawCheck[field] === proposed[field],
    ),
    "Production source binding must not change any executable assertion field.",
  );
  receipt.sourceCopyNormalizedCount = rawCheck.requirement === brief ? 0 : 1;
  receipt.sourceBinding = {
    rawRequirement: rawCheck.requirement,
    originalRequirement: brief,
    rule: "Exact source text, or one added final period outside the closing quotation mark; restore the original source verbatim.",
    assertionFieldsUnchanged: true,
    qualityRepair: false,
    frozenBenchmarkModified: false,
  };
  await json("source-binding.json", receipt.sourceBinding);
  requireThat(
    !proposed.approved &&
      proposed.kind === "heading" &&
      proposed.requirement === brief &&
      proposed.expected === heading &&
      proposed.path === "/" &&
      proposed.viewport === "desktop" &&
      !proposed.selector,
    "The model did not preserve the supported heading requirement as an unapproved safe assertion.",
  );
  const now = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    name: "Forma Studio · Tinker application smoke",
    target: "sample",
    sampleVariant: "healthy",
    url: SAMPLE_URL,
    authorized: true,
    brief,
    checks: structuredClone(proposal.checks),
    createdAt: now,
    updatedAt: now,
    generator: proposal.generator,
  };
  const newAudit = (): Audit => ({
    id: randomUUID(),
    projectId: project.id,
    projectName: project.name,
    status: "running",
    createdAt: new Date().toISOString(),
    checks: structuredClone(project.checks),
    source: snapshotSource(project),
    results: [],
  });
  receipt.phase = "approval-guard";
  let rejected = false,
    unapprovedRunnerCalls = 0;
  try {
    await runAuditWithOrchestration(project, newAudit(), () => {}, {
      evidenceRoot,
      allowModelSummary: false,
      execute: async (...args) => {
        unapprovedRunnerCalls++;
        return runAudit(...args);
      },
    });
  } catch (error) {
    rejected = error instanceof Error && /approved plan/.test(error.message);
  }
  requireThat(
    rejected && unapprovedRunnerCalls === 0,
    "Unapproved execution was not rejected before the browser runner.",
  );
  receipt.unapprovedExecution = {
    rejected: true,
    runnerCalls: unapprovedRunnerCalls,
  };
  project.checks = project.checks.map((check) => ({
    ...check,
    approved: true,
  }));
  requireThat(
    JSON.stringify(semantics(project.checks)) ===
      JSON.stringify(semantics(proposal.checks)),
    "Approval must not edit the model's assertion semantics.",
  );
  receipt.assertionSemanticsSha256 = hash(
    JSON.stringify(semantics(project.checks)),
  );
  await json("harness-approved-plan.json", {
    approval: receipt.approval,
    project,
  });
  const audits: Audit[] = [];
  const stages = values.restore
    ? (["healthy", "broken", "restored"] as const)
    : (["healthy", "broken"] as const);
  for (const stage of stages) {
    receipt.phase = `browser-${stage}`;
    await json("receipt.json", receipt);
    project.sampleVariant = stage === "broken" ? "broken" : "healthy";
    const audit = newAudit();
    const executed = await runAuditWithOrchestration(project, audit, () => {}, {
      evidenceRoot,
      allowModelSummary: false,
    });
    audit.results = executed.results;
    audit.summary = `${executed.summary}\nSynthetic test-harness approval only; no human review, client acceptance or quality-benchmark claim.`;
    audit.status = "completed";
    audit.completedAt = new Date().toISOString();
    await json(`${stage}-audit.json`, audit);
    const image = async (url: string) => {
      const prefix = `/evidence/${audit.id}/`;
      requireThat(
        url.startsWith(prefix) &&
          /^[a-zA-Z0-9_-]+\.png$/.test(url.slice(prefix.length)),
        "An evidence path escaped the synthetic audit.",
      );
      return readFile(
        path.join(evidenceRoot, audit.id, url.slice(prefix.length)),
      );
    };
    const report = await renderReport(audit, image);
    await writeFile(path.join(output, `${stage}-report.html`), report);
    const screenshots = await Promise.all(
      audit.results
        .filter((row) => row.evidence.screenshot)
        .map(async (row) => ({
          path: row.evidence.screenshot!.slice(1),
          sha256: hash(await image(row.evidence.screenshot!)),
        })),
    );
    outcomes.push({
      stage,
      auditId: audit.id,
      statuses: audit.results.map((row) => row.status),
      orchestration: executed.orchestration,
      report: `${stage}-report.html`,
      reportSha256: hash(report),
      screenshots,
    });
    audits.push(audit);
    requireThat(
      audit.results.length === 1 &&
        audit.results[0].status === (stage === "broken" ? "failed" : "passed"),
      "The real browser result did not match the expected synthetic heading state.",
    );
    requireThat(
      screenshots.length === 1 && report.includes("data:image/png;base64,"),
      "The audit lacks its real screenshot or embedded report evidence.",
    );
    requireThat(
      providerCalls === 1,
      "Browser reporting must not make additional model requests.",
    );
    console.log(`${stage}: ${audit.results[0].status}`);
  }
  const regression = compareAudits(audits[1], audits[0]);
  const recovery = audits[2] ? compareAudits(audits[2], audits[1]) : null;
  requireThat(
    regression.comparable &&
      regression.counts.regressed === 1 &&
      (!recovery || (recovery.comparable && recovery.counts.recovered === 1)),
    "The unchanged model assertion did not establish the expected regression/recovery.",
  );
  await json("comparisons.json", { regression, recovery });
  receipt.status = "verified";
  receipt.phase = "completed";
} catch (error) {
  receipt.status = "failed_or_blocked";
  receipt.error = {
    type: error instanceof Error ? error.name : "Error",
    message:
      error instanceof SmokeFailure
        ? error.message
        : "The smoke could not complete. Raw errors, credentials and account details are not retained.",
  };
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  receipt.providerCalls = providerCalls;
  receipt.modelSummaryCalls = 0;
  receipt.calls = calls;
  receipt.outcomes = outcomes;
  receipt.completedAt = new Date().toISOString();
  await json("receipt.json", receipt);
  const files = await filesOf(output);
  const manifest = {
    algorithm: "sha256",
    publicationScope:
      "Synthetic application artifacts only; no allowance file, environment file, key, account metadata or training data.",
    files: await Promise.all(
      files.map(async (file) => {
        const bytes = await readFile(path.join(output, file));
        return { file, bytes: bytes.length, sha256: hash(bytes) };
      }),
    ),
  };
  await json("manifest.json", manifest);
  if (receipt.status === "verified") {
    for (const file of [...files, "manifest.json"]) {
      const bytes = await readFile(path.join(output, file));
      if (/\.(json|txt|html)$/.test(file))
        requireThat(
          !bytes.toString("utf8").includes(process.env.TINKER_API_KEY!) &&
            !bytes.toString("utf8").includes(process.cwd()),
          "Private credential or local filesystem material cannot be published.",
        );
    }
    await mkdir(publication, { recursive: true });
    for (const file of [...files, "manifest.json"]) {
      const destination = path.join(publication, file);
      await mkdir(path.dirname(destination), { recursive: true });
      await copyFile(path.join(output, file), destination);
    }
  }
  console.log(
    JSON.stringify({
      status: receipt.status,
      providerCalls,
      receipt: path.relative(process.cwd(), path.join(output, "receipt.json")),
      published:
        receipt.status === "verified"
          ? path.relative(process.cwd(), publication)
          : null,
    }),
  );
}
