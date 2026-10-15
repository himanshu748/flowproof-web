import assert from "node:assert/strict";
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
import type { Audit, Check, CheckResult, Project } from "../shared/types.js";
import { compareAudits, snapshotSource } from "../shared/compare-audits.js";

// This is a deliberately opt-in, offline model experiment, not a CI prerequisite.
// It never downloads a model, accesses a provider, or reuses application state.
if (!process.argv.includes("--run-local-model")) {
  console.error(
    "This runs the installed gemma3:4b model locally. Opt in with --run-local-model. No model will be downloaded.",
  );
  process.exit(2);
}
const endpoint = "http://127.0.0.1:11434";
const modelName = "gemma3:4b";
const supportedBrief = process.argv.includes("--supported-brief");
const startedAt = new Date().toISOString();
const runId = startedAt.replace(/[:.]/g, "-");
const output = path.resolve("work/gemma-workflow", runId);
const publication = path.resolve("docs/evidence/gemma-workflow", runId);
const evidenceRoot = path.join(output, "evidence");
await mkdir(output, { recursive: true });

// Environment isolation happens before importing report.ts, whose default image
// reader imports the store. We supply our own reader and never initialize it.
delete process.env.DATABASE_URL;
process.env.FLOWPROOF_DATA_DIR = path.join(output, "unused-store");
process.env.EVIDENCE_ROOT = evidenceRoot;
process.env.FLOWPROOF_AI_ENABLED = "true";
process.env.FLOWPROOF_OLLAMA_URL = endpoint;
process.env.FLOWPROOF_OLLAMA_MODEL = modelName;
process.env.FLOWPROOF_GEMMA_ENABLED = "true";
process.env.FLOWPROOF_GEMMA_MODEL = modelName;

const sha256 = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const json = async (filename: string, value: unknown) =>
  writeFile(path.join(output, filename), JSON.stringify(value, null, 2) + "\n");
const filesOf = async (directory: string, prefix = ""): Promise<string[]> => {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory())
      result.push(
        ...(await filesOf(path.join(directory, entry.name), relative)),
      );
    else result.push(relative);
  }
  return result.sort();
};
const semantics = (checks: Check[]) =>
  checks.map(({ id: _id, approved: _approved, ...check }) => check);
const counts = (results: CheckResult[]) =>
  Object.fromEntries(
    ["passed", "failed", "blocked", "unverified"].map((status) => [
      status,
      results.filter((result) => result.status === status).length,
    ]),
  );

const nativeFetch = globalThis.fetch;
let chatCalls = 0;
const calls: Record<string, unknown>[] = [];
// Capture the response of the actual application API call, without changing it.
// Both generation and explanation must use the fixed loopback service. This also
// makes any accidental remote fetch fail before a network request is sent.
globalThis.fetch = async (input, init) => {
  const url = new URL(
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url,
  );
  assert.equal(
    url.origin,
    endpoint,
    "This experiment permits only local Ollama",
  );
  assert.ok(["/api/chat", "/api/tags", "/api/version"].includes(url.pathname));
  if (url.pathname !== "/api/chat") return nativeFetch(input, init);
  chatCalls++;
  assert.ok(chatCalls <= 2, "The experiment permits at most two model calls");
  const number = chatCalls;
  const purpose = number === 1 ? "generation" : "explanation";
  const request = JSON.parse(String(init?.body));
  assert.equal(request.model, modelName);
  assert.equal(request.stream, false);
  const callStartedAt = new Date().toISOString();
  const time = performance.now();
  await json(`${purpose}-request.json`, request);
  let response: Response;
  let raw: string;
  try {
    response = await nativeFetch(input, init);
    raw = await response.clone().text();
  } catch (error) {
    calls.push({
      purpose,
      startedAt: callStartedAt,
      elapsedMs: Math.round(performance.now() - time),
      status: "No complete model response",
      error:
        error instanceof Error
          ? `${error.name}: ${error.message}`
          : "Model request failed",
      promptTokens: null,
      completionTokens: null,
      tokenSource: "No complete Ollama response; usage cannot be measured",
    });
    throw error;
  }
  const elapsedMs = Math.round(performance.now() - time);
  await writeFile(
    path.join(output, `${purpose}-raw-response.json`),
    raw + "\n",
  );
  let envelope: Record<string, unknown> = {};
  try {
    envelope = JSON.parse(raw);
  } catch {
    /* Preserve an invalid raw response. */
  }
  calls.push({
    purpose,
    startedAt: callStartedAt,
    elapsedMs,
    httpStatus: response.status,
    model: envelope.model ?? null,
    done: envelope.done ?? null,
    doneReason: envelope.done_reason ?? null,
    promptTokens: envelope.prompt_eval_count ?? null,
    completionTokens: envelope.eval_count ?? null,
    tokenSource:
      "Ollama response prompt_eval_count and eval_count; null means not reported",
    totalDurationNanoseconds: envelope.total_duration ?? null,
    loadDurationNanoseconds: envelope.load_duration ?? null,
    rawResponseSha256: sha256(raw + "\n"),
  });
  return response;
};

const receipt: Record<string, unknown> = {
  version: 1,
  runId,
  startedAt,
  status: "running",
  scope:
    "Synthetic local application-module workflow, not hosted AI or a customer audit",
  network:
    "Only fixed loopback Ollama endpoint; browser uses built-in synthetic pages",
  modelCallsLimit: 2,
  approval: {
    actor: "Explicitly opted-in test harness",
    humanApproval: false,
    scope:
      "Only the generated assertions against the built-in synthetic Forma sample",
    edits:
      "Only approved flags are changed; proposed assertion semantics are preserved",
  },
  noRemoteModelCalls: true,
  noPaidResources: true,
  providerCharge: 0,
  humanValidation: false,
  interpretationBenchmark: false,
  briefScope: supportedBrief
    ? "Three explicitly supported requirements, separate from the original full brief"
    : "Full six-requirement SAMPLE_BRIEF",
};

try {
  const provenanceFiles = [
    "scripts/verify-gemma-workflow.ts",
    "server/generator.ts",
    "server/gemma.ts",
    "server/runner.ts",
    "server/sample.ts",
    "server/report.ts",
    "server/schema.ts",
    "server/safety.ts",
    "shared/types.ts",
    "shared/redact.ts",
    "shared/compare-audits.ts",
    "package-lock.json",
  ];
  receipt.source = {
    baseGitCommit: execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
    }).trim(),
    workingTreeDirty:
      execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim().length > 0,
    note: "Per-file hashes identify the executed source even while the working tree is uncommitted",
    files: await Promise.all(
      provenanceFiles.map(async (file) => ({
        file,
        sha256: sha256(await readFile(file)),
      })),
    ),
  };
  const tagsResponse = await fetch(`${endpoint}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(
    tagsResponse.ok,
    "The installed local model inventory must be reachable",
  );
  const tags = (await tagsResponse.json()) as {
    models: { name: string; digest: string; size: number; details?: unknown }[];
  };
  const installed = tags.models.find((item) => item.name === modelName);
  assert.ok(
    installed,
    "gemma3:4b is absent. Install separately; this script never downloads models.",
  );
  const versionResponse = await fetch(`${endpoint}/api/version`, {
    signal: AbortSignal.timeout(5000),
  });
  assert.ok(versionResponse.ok);
  receipt.model = {
    ...installed,
    ollamaVersion: ((await versionResponse.json()) as { version: string })
      .version,
  };

  const [
    { generateChecks },
    { summarizeAudit },
    { runAudit },
    { renderReport },
    { SAMPLE_BRIEF, SAMPLE_URL },
  ] = await Promise.all([
    import("../server/generator.js"),
    import("../server/gemma.js"),
    import("../server/runner.js"),
    import("../server/report.js"),
    import("../server/sample.js"),
  ]);
  const brief = supportedBrief
    ? [
        'The homepage must show the heading "Design that moves business forward."',
        'The page must show "Independent by design."',
        'A link labeled "Start a project" must be visible.',
      ].join("\n")
    : SAMPLE_BRIEF;
  await writeFile(path.join(output, "brief.txt"), brief + "\n");
  const generationStarted = performance.now();
  const proposal = await generateChecks(brief);
  receipt.generationElapsedMs = Math.round(
    performance.now() - generationStarted,
  );
  await json("proposal-before-approval.json", proposal);
  assert.equal(
    proposal.generator.provider,
    "Ollama (local)",
    "Fallback is not model evidence",
  );
  assert.equal(proposal.generator.model, modelName);
  assert.equal(proposal.checks.length, brief.split("\n").length);
  assert.ok(
    proposal.checks.every((check) => !check.approved),
    "The model cannot approve checks",
  );

  const now = new Date().toISOString();
  const project: Project = {
    id: randomUUID(),
    name: "Forma Studio · local Gemma workflow",
    url: SAMPLE_URL,
    target: "sample",
    sampleVariant: "healthy",
    authorized: true,
    brief,
    checks: structuredClone(proposal.checks),
    createdAt: now,
    updatedAt: now,
    generator: proposal.generator,
  };
  const auditFor = (): Audit => ({
    id: randomUUID(),
    projectId: project.id,
    projectName: project.name,
    status: "running",
    createdAt: new Date().toISOString(),
    checks: structuredClone(project.checks),
    source: snapshotSource(project),
    results: [],
  });
  const unapproved = auditFor();
  await assert.rejects(
    () => runAudit(project, unapproved, () => {}, { evidenceRoot }),
    /current approved plan/,
  );
  receipt.unapprovedExecutionRejected = true;
  project.checks = project.checks.map((check) => ({
    ...check,
    approved: true,
  }));
  assert.deepEqual(semantics(project.checks), semantics(proposal.checks));
  await json("harness-approved-plan.json", {
    approval: receipt.approval,
    project,
  });
  receipt.assertionSemanticsSha256 = sha256(
    JSON.stringify(semantics(project.checks)),
  );

  const audits: Audit[] = [];
  const outcomes: Record<string, unknown>[] = [];
  for (const stage of ["healthy", "broken", "recovered"] as const) {
    project.sampleVariant = stage === "broken" ? "broken" : "healthy";
    const audit = auditFor();
    const auditStarted = performance.now();
    audit.results = await runAudit(project, audit, () => {}, { evidenceRoot });
    audit.status = "completed";
    audit.completedAt = new Date().toISOString();
    audit.summary =
      "Synthetic experiment. A test harness approved these unchanged local Gemma proposals; no human approval or client acceptance is claimed.";
    if (stage === "broken") {
      const before = JSON.stringify(audit.results);
      const explanation = await summarizeAudit(audit);
      receipt.explanationAvailable = Boolean(explanation);
      if (explanation) audit.summary += "\n" + explanation;
      assert.equal(
        JSON.stringify(audit.results),
        before,
        "Commentary must never change evidence or statuses",
      );
      receipt.explanationPreservedResults = true;
    }
    await json(`${stage}-audit.json`, audit);
    const readImage = async (url: string) =>
      readFile(path.join(evidenceRoot, url.replace(/^\/evidence\//, "")));
    await writeFile(
      path.join(output, `${stage}-report.html`),
      await renderReport(audit, readImage),
    );
    audits.push(audit);
    outcomes.push({
      stage,
      counts: counts(audit.results),
      elapsedMs: Math.round(performance.now() - auditStarted),
      statuses: audit.results.map((result) => result.status),
    });
    console.log(
      `${stage}: ${audit.results.map((result) => result.status).join(", ")}`,
    );
  }
  receipt.outcomes = outcomes;
  const regressions = compareAudits(audits[1], audits[0]);
  const recoveries = compareAudits(audits[2], audits[1]);
  await json("comparisons.json", { regressions, recoveries });
  receipt.comparisonCounts = {
    regressions: regressions.counts,
    recoveries: recoveries.counts,
  };
  assert.ok(
    audits.every(
      (audit) => !audit.results.some((result) => result.status === "blocked"),
    ),
  );
  assert.ok(audits[0].results.some((result) => result.status === "passed"));
  assert.ok(
    !audits[0].results.some((result) => result.status === "failed"),
    "Healthy fixture has an unexpected failure; inspect the first proposal",
  );
  assert.deepEqual(
    audits[0].results.map((result) => result.status),
    audits[2].results.map((result) => result.status),
  );
  assert.ok(regressions.comparable && recoveries.comparable);
  assert.ok(
    regressions.counts.regressed > 0 && recoveries.counts.recovered > 0,
    "A model-proposed assertion must observe a real break and recovery",
  );
  for (const audit of audits) {
    assert.deepEqual(semantics(audit.checks), semantics(proposal.checks));
    assert.ok(
      audit.results
        .filter((result) => result.kind === "manual")
        .every((result) => result.status === "unverified"),
    );
    assert.ok(
      audit.results
        .filter((result) => result.kind !== "manual")
        .every((result) => result.evidence.screenshot),
    );
  }
  receipt.coverage = proposal.checks.map((check, index) => ({
    requirement: check.requirement,
    kind: check.kind,
    path: check.path,
    expected: check.expected,
    viewport: check.viewport,
    statuses: audits.map((audit) => audit.results[index].status),
  }));
  receipt.limitations = [
    "One synthetic brief and one generation attempt; no retries or selection of a better response.",
    "The application applies conservative deterministic guards after model output; raw and normalized proposals are both preserved.",
    "Manual checks remain unverified, including any deterministic requirement the application conservatively declines.",
    "Harness approval demonstrates execution mechanics, not a human review or customer acceptance.",
    "Only asserted semantics are tested; recovering the synthetic fixture does not prove every requirement or a real client website.",
    "This installed local Gemma model does not provide live model inference on the public Render demo.",
    "Measured local token counts and latency describe this run only, not a quality benchmark or a Tinker experiment.",
  ];
  receipt.status = "passed";
} catch (error) {
  receipt.status = "failed";
  receipt.error = error instanceof Error ? error.message : "Experiment failed";
  process.exitCode = 1;
} finally {
  globalThis.fetch = nativeFetch;
  receipt.completedAt = new Date().toISOString();
  receipt.modelCalls = calls;
  receipt.actualModelCalls = chatCalls;
  await json("receipt.json", receipt);
  // All inputs here are the built-in fictional website. Preserve failed attempts
  // alongside successful ones; the directory is unique and never overwritten.
  const files = await filesOf(output);
  const manifest = await Promise.all(
    files.map(async (file) => {
      const bytes = await readFile(path.join(output, file));
      return { file, bytes: bytes.length, sha256: sha256(bytes) };
    }),
  );
  await json("manifest.json", { algorithm: "sha256", files: manifest });
  await mkdir(publication, { recursive: true });
  for (const file of [...files, "manifest.json"]) {
    const destination = path.join(publication, file);
    await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(output, file), destination);
  }
  console.log(
    `Experiment ${receipt.status}; preserved evidence: ${path.relative(process.cwd(), publication)}`,
  );
}
