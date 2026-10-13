import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { z } from "zod";
import { runAudit } from "../server/runner.js";
import { SAMPLE_URL } from "../server/sample.js";
import { CheckSchema } from "../server/schema.js";
import type { Audit, Check, CheckResult, Project } from "../shared/types.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const modelCheckSchema = z
  .object({
    requirement: z.string(),
    kind: z.enum([
      "text_visible",
      "heading",
      "link",
      "image_alt",
      "no_horizontal_overflow",
      "manual",
    ]),
    path: z.string(),
    expected: z.string(),
    viewport: z.enum(["desktop", "mobile"]),
  })
  .strict()
  .superRefine((check, context) => {
    const result = CheckSchema.safeParse({
      ...check,
      id: "synthetic-check",
      approved: true,
    });
    if (!result.success)
      for (const issue of result.error.issues) context.addIssue(issue);
  });
const modelPlanSchema = z
  .object({ checks: z.array(modelCheckSchema).length(1) })
  .strict();
type ModelCheck = z.infer<typeof modelCheckSchema>;
export interface DatasetRow {
  id: string;
  split: string;
  requirement: string;
  expected: { checks: ModelCheck[] };
}
export interface Measurement {
  id: string;
  rawOutput: string;
}
export interface BrowserObservation {
  id: string;
  referenceKind: Check["kind"];
  referenceAutomatable: boolean;
  rawOutputSha256: string;
  validSchema: boolean;
  modelKind?: Check["kind"];
  classification:
    | "malformed"
    | "appropriate_abstention"
    | "inappropriate_abstention"
    | "unexpected_automation"
    | "executed_pair"
    | "blocked_pair"
    | "unverified_pair";
  error?: string;
  healthy?: CheckResult;
  broken?: CheckResult;
  artifacts?: Record<
    "healthy" | "broken",
    { audit: string; fixture: string; fixtureSha256: string }
  >;
}

export function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function html(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ]!,
  );
}

/** Fixtures depend exclusively on the frozen reference, never on model output. */
export function fixturePages(
  reference: ModelCheck,
  variant: "healthy" | "broken",
): Readonly<Record<string, string>> {
  if (reference.kind === "manual")
    throw new Error(
      "Manual requirements have no known healthy/broken browser oracle.",
    );
  const broken = variant === "broken";
  const literal = html(reference.expected);
  let content = "";
  switch (reference.kind) {
    case "heading":
      // Downgrading a heading requirement to visible text must false-pass here.
      content = broken ? `<p>${literal}</p>` : `<h1>${literal}</h1>`;
      break;
    case "link": {
      const destination = /^(?:\/|https?:|mailto:|tel:|#)/i.test(
        reference.expected,
      );
      content = destination
        ? `<a href="${broken ? "/missing-destination" : literal}">Contact the studio</a>`
        : broken
          ? `<p>${literal}</p>`
          : `<a href="/contact">${literal}</a>`;
      break;
    }
    case "text_visible":
      content = `<p${broken ? ' style="display:none"' : ""}>${literal}</p>`;
      break;
    case "image_alt":
      content = `<img src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='100'%3E%3Crect width='160' height='100' fill='%234677a6'/%3E%3C/svg%3E" width="160" height="100"${broken ? "" : ' alt="A blue rectangle used as the content illustration"'}>`;
      break;
    case "no_horizontal_overflow":
      // A model choosing desktop for a mobile requirement will miss this mutation.
      content = `<div style="${broken ? `min-width:${reference.viewport === "mobile" ? 620 : 1565}px;` : ""}height:100px;background:#dbe6ee">Content panel</div>`;
      break;
  }
  const document = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Synthetic acceptance fixture</title><style>html,body{margin:0;padding:0}body{font:18px system-ui;background:#fff;color:#17212b}main{padding:24px;box-sizing:border-box}h1,p,a{overflow-wrap:anywhere}img{background:#4677a6}</style></head><body><main>${content}</main></body></html>`;
  return { [reference.path]: document };
}

export function parseApprovedSyntheticCheck(
  raw: string,
  requirement: string,
  id: string,
): Check {
  const parsed = modelPlanSchema.parse(JSON.parse(raw));
  const check = parsed.checks[0];
  if (check.requirement !== requirement)
    throw new Error("The original requirement was changed.");
  // Match the deliberately narrower Python experiment contract as well as the runner.
  if (!/^\/[A-Za-z0-9_/-]*$/.test(check.path) || check.path.includes(".."))
    throw new Error("The model path violates the experiment contract.");
  if (check.expected.length > 500)
    throw new Error("The expected value exceeds the experiment contract.");
  return CheckSchema.parse({ ...check, id, approved: true });
}

export function summarizeBrowserObservations(
  observations: BrowserObservation[],
) {
  const automatable = observations.filter((item) => item.referenceAutomatable);
  const manual = observations.filter((item) => !item.referenceAutomatable);
  const executable = automatable.filter((item) => item.healthy && item.broken);
  const completed = executable.filter(
    (item) => item.classification === "executed_pair",
  );
  const brokenExecuted = executable.filter((item) =>
    ["passed", "failed"].includes(item.broken!.status),
  );
  const correct = completed.filter(
    (item) =>
      item.healthy!.status === "passed" && item.broken!.status === "failed",
  ).length;
  const falsePasses = brokenExecuted.filter(
    (item) => item.broken!.status === "passed",
  ).length;
  const abstentions = manual.filter(
    (item) => item.classification === "appropriate_abstention",
  ).length;
  const rate = (numerator: number, denominator: number) =>
    denominator ? numerator / denominator : null;
  return {
    measuredOutputs: observations.length,
    referenceAutomatable: automatable.length,
    referenceManual: manual.length,
    malformed: observations.filter(
      (item) => item.classification === "malformed",
    ).length,
    modelAbstentions: observations.filter((item) => item.modelKind === "manual")
      .length,
    appropriateAbstentions: abstentions,
    inappropriateAbstentions: observations.filter(
      (item) => item.classification === "inappropriate_abstention",
    ).length,
    unexpectedAutomation: observations.filter(
      (item) => item.classification === "unexpected_automation",
    ).length,
    attemptedPairs: executable.length,
    completedPairs: completed.length,
    blockedPairs: observations.filter(
      (item) => item.classification === "blocked_pair",
    ).length,
    unverifiedPairs: observations.filter(
      (item) => item.classification === "unverified_pair",
    ).length,
    pairedCorrect: correct,
    brokenExecuted: brokenExecuted.length,
    brokenFalsePasses: falsePasses,
    executableCorrectness: rate(correct, automatable.length),
    completedPairCorrectness: rate(correct, completed.length),
    falsePassRate: rate(falsePasses, brokenExecuted.length),
    appropriateAbstentionRate: rate(abstentions, manual.length),
    denominators: {
      executableCorrectness:
        "All reference-automatable heldout requirements, including malformed outputs, abstentions and blocked executions.",
      completedPairCorrectness:
        "Pairs where both the healthy and broken assertions returned passed or failed.",
      falsePassRate:
        "Broken assertions that returned passed or failed; blocked, unverified, malformed and abstained outputs are separately counted and excluded.",
      appropriateAbstentionRate:
        "All reference-manual heldout requirements, including malformed outputs.",
    },
  };
}

export async function evaluateMeasurements(
  rows: DatasetRow[],
  measurements: Measurement[],
  outputRoot: string,
  onObservation?: (observation: BrowserObservation) => Promise<void>,
) {
  const observations: BrowserObservation[] = [];
  const ids = new Set<string>();
  for (const [index, measurement] of measurements.entries()) {
    if (ids.has(measurement.id))
      throw new Error(`Duplicate measurement ${measurement.id}`);
    ids.add(measurement.id);
    const row = rows.find(
      (candidate) =>
        candidate.id === measurement.id && candidate.split === "test",
    );
    if (!row)
      throw new Error(
        `Measurement ${measurement.id} is absent from the heldout dataset.`,
      );
    const reference = modelPlanSchema.parse(row.expected).checks[0];
    if (reference.requirement !== row.requirement)
      throw new Error(`Invalid reference requirement for ${row.id}`);
    const observation: BrowserObservation = {
      id: row.id,
      referenceKind: reference.kind,
      referenceAutomatable: reference.kind !== "manual",
      rawOutputSha256: sha256(measurement.rawOutput),
      validSchema: false,
      classification: "malformed",
    };
    let check: Check | undefined;
    try {
      check = parseApprovedSyntheticCheck(
        measurement.rawOutput,
        row.requirement,
        `model-${index + 1}`,
      );
      observation.validSchema = true;
      observation.modelKind = check.kind;
    } catch (error) {
      observation.error =
        error instanceof Error ? error.message : "Invalid model output";
    }
    if (check?.kind === "manual") {
      observation.classification =
        reference.kind === "manual"
          ? "appropriate_abstention"
          : "inappropriate_abstention";
    } else if (check && reference.kind === "manual") {
      observation.classification = "unexpected_automation";
    } else if (check) {
      const artifacts = {} as NonNullable<BrowserObservation["artifacts"]>;
      for (const variant of ["healthy", "broken"] as const) {
        const createdAt = new Date().toISOString();
        const auditId = `model-${String(index + 1).padStart(3, "0")}-${variant}`;
        const project: Project = {
          id: `evaluation-${index + 1}`,
          name: "Offline model evaluation",
          url: SAMPLE_URL,
          target: "sample",
          sampleVariant: variant,
          authorized: true,
          brief: row.requirement,
          checks: [check],
          createdAt,
          updatedAt: createdAt,
          generator: {
            provider:
              "Saved model response evaluated on isolated synthetic HTML",
            model: null,
          },
        };
        const audit: Audit = {
          id: auditId,
          projectId: project.id,
          projectName: project.name,
          status: "running",
          createdAt,
          checks: structuredClone(project.checks),
          results: [],
        };
        const pages = fixturePages(reference, variant);
        const fixture = pages[reference.path];
        const fixtureFile = `fixtures/${auditId}.html`;
        await mkdir(path.join(outputRoot, "fixtures"), { recursive: true });
        await writeFile(path.join(outputRoot, fixtureFile), fixture);
        audit.results = await runAudit(project, audit, () => {}, {
          evidenceRoot: path.join(outputRoot, "evidence"),
          syntheticPages: pages,
        });
        audit.status = "completed";
        audit.completedAt = new Date().toISOString();
        const auditFile = `${auditId}.json`;
        await writeFile(
          path.join(outputRoot, auditFile),
          JSON.stringify(audit, null, 2) + "\n",
        );
        observation[variant] = audit.results[0];
        artifacts[variant] = {
          audit: auditFile,
          fixture: fixtureFile,
          fixtureSha256: sha256(fixture),
        };
      }
      observation.artifacts = artifacts;
      const statuses = [
        observation.healthy!.status,
        observation.broken!.status,
      ];
      observation.classification = statuses.includes("blocked")
        ? "blocked_pair"
        : statuses.includes("unverified")
          ? "unverified_pair"
          : "executed_pair";
    }
    observations.push(observation);
    await onObservation?.(observation);
  }
  return observations;
}

async function main() {
  const args = process.argv.slice(2);
  const allowed = new Set([
    "--receipt",
    "--dataset",
    "--output",
    "--approve-synthetic-checks",
  ]);
  for (let index = 0; index < args.length; index++) {
    if (!allowed.has(args[index]))
      throw new Error(`Unknown option: ${args[index]}`);
    if (args[index] !== "--approve-synthetic-checks") {
      if (!args[index + 1] || args[index + 1].startsWith("--"))
        throw new Error(`Missing value for ${args[index]}`);
      index++;
    }
  }
  const value = (flag: string) =>
    args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined;
  if (
    !value("--receipt") ||
    !value("--output") ||
    !args.includes("--approve-synthetic-checks")
  ) {
    throw new Error(
      "Usage: tsx scripts/model-browser-evaluate.ts --receipt eval/results/zero-shot.json --dataset eval/pilot.jsonl --output work/browser-zero-shot --approve-synthetic-checks",
    );
  }
  const receiptPath = path.resolve(value("--receipt")!);
  const receiptBytes = await readFile(receiptPath);
  const receipt = JSON.parse(receiptBytes.toString());
  if (
    receipt.provider !== "tinker" ||
    receipt.status !== "completed" ||
    !Array.isArray(receipt.measurements) ||
    receipt.measurements.length < 1 ||
    receipt.measurements.length > 72
  )
    throw new Error(
      "A completed Tinker receipt with 1-72 actual measurements is required.",
    );
  if (
    !receipt.measurements.every(
      (item: Measurement) =>
        typeof item.id === "string" && typeof item.rawOutput === "string",
    )
  )
    throw new Error("Every measurement needs its original ID and raw output.");
  const datasetPath = path.resolve(
    value("--dataset") ?? path.join(ROOT, receipt.datasetPath),
  );
  const datasetBytes = await readFile(datasetPath);
  if (sha256(datasetBytes) !== receipt.datasetSha256)
    throw new Error("Dataset digest differs from the model experiment.");
  const rows = datasetBytes
    .toString()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line)) as DatasetRow[];
  const output = path.resolve(value("--output")!);
  // A new directory prevents overwriting an earlier result or screenshot.
  await mkdir(output, { recursive: false });
  const observations: BrowserObservation[] = [];
  const browserReceipt = {
    schemaVersion: 1,
    status: "running",
    recordedAt: new Date().toISOString(),
    source:
      "Real local Playwright Chromium execution on paired synthetic reference fixtures",
    provider: receipt.provider,
    model: receipt.model,
    configuration: receipt.configuration,
    benchmarkMode: receipt.benchmarkMode ?? "human-reviewed",
    reviewProvenance: receipt.reviewProvenance ?? null,
    experimentId: receipt.experimentId ?? null,
    manifestSha256: receipt.manifestSha256 ?? null,
    sourceReceipt: path.relative(ROOT, receiptPath),
    sourceReceiptSha256: sha256(receiptBytes),
    datasetSha256: receipt.datasetSha256,
    approval: {
      actorType: "agent",
      scope: "Validated finite checks on isolated synthetic fixtures only",
      mechanism: "--approve-synthetic-checks",
    },
    limitations: [
      "Synthetic mutation sensitivity is not evidence of correctness on real client websites.",
      "Fixtures are generated from reference labels; no fixture is adapted to make model output pass.",
      "Manual requirements have no healthy/broken browser oracle and are evaluated only for abstention.",
      "Image-alt assertions measure attribute presence, not description quality.",
      "Passing and failing outputs, malformed responses, abstentions and execution blocks retain separate counts.",
    ],
    observations,
    metrics: summarizeBrowserObservations(observations),
  };
  const save = async () =>
    writeFile(
      path.join(output, "browser-evaluation.json"),
      JSON.stringify(browserReceipt, null, 2) + "\n",
    );
  await save();
  await evaluateMeasurements(
    rows,
    receipt.measurements,
    output,
    async (observation) => {
      observations.push(observation);
      browserReceipt.metrics = summarizeBrowserObservations(observations);
      await save();
      console.log(
        `${observation.id}: ${observation.classification}${observation.healthy ? ` (healthy=${observation.healthy.status}, broken=${observation.broken!.status})` : ""}`,
      );
    },
  );
  browserReceipt.status = "completed";
  await save();
  console.log(
    `Browser evidence saved to ${path.join(output, "browser-evaluation.json")}`,
  );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
