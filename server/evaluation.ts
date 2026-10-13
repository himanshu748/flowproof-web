import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
} from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Evaluation, CheckResult } from "../shared/types.js";
import {
  fixturePages,
  parseApprovedSyntheticCheck,
  summarizeBrowserObservations,
  type BrowserObservation,
  type DatasetRow,
} from "../scripts/model-browser-evaluate.js";
import { SAMPLE_URL } from "./sample.js";

const metric = z.number().finite().nonnegative();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const modes = z.enum(["human-reviewed", "agent-reviewed-pilot"]);
const configuration = z.enum(["zero-shot", "few-shot", "fine-tuned"]);
const samplingSchema = z.object({
  temperature: z.literal(0),
  maxOutputTokens: metric.int().min(128).max(2048),
});
const provenanceSchema = z.object({
  humanValidated: metric.int(),
  agentReviewed: metric.int(),
  note: z.string(),
});
const tokenizerSchema = z.object({
  model: z.literal("Qwen/Qwen3.5-4B"),
  class: z.string(),
  chatTemplateSha256: digest,
  vocabularySha256: digest,
  enableThinking: z.literal(false),
  eosTokenId: metric.int(),
});
const identity = {
  schemaVersion: z.literal(2),
  provider: z.literal("tinker"),
  model: z.literal("Qwen/Qwen3.5-4B"),
  renderer: z.literal("qwen3.5-hf-chat-template-disable-thinking"),
  experimentId: z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/),
  benchmarkMode: modes,
  manifestPath: z.string().max(500),
  manifestSha256: digest,
  datasetPath: z.string().max(500),
  datasetSha256: digest,
  promptSha256: digest,
  reviewProvenance: provenanceSchema,
  recordedAt: z.string().datetime({ offset: true }),
};
const runSchema = z.object({
  ...identity,
  operation: z.literal("evaluation"),
  status: z.literal("completed"),
  configuration,
  checkpoint: z.string().startsWith("tinker://").nullable(),
  sampling: samplingSchema,
  tokenizer: tokenizerSchema,
  heldoutIds: z.array(z.string()).min(1).max(72),
  fewShotIds: z.array(z.string()).max(6),
  trainingReceiptPath: z.string().max(500).nullable().optional(),
  trainingReceiptSha256: digest.nullable().optional(),
  measurements: z
    .array(
      z.object({
        id: z.string(),
        rawOutput: z.string().max(100000),
        latencyMs: metric,
        inputTokens: metric.int(),
        outputTokens: metric.int(),
        outputTokenIds: z.array(metric.int()).max(2048),
      }),
    )
    .min(1)
    .max(72),
});
const trainingSchema = z.object({
  ...identity,
  operation: z.literal("training"),
  status: z.literal("completed"),
  samplerPath: z.string().startsWith("tinker://"),
  trainingExamples: metric.int().positive(),
  trainingTokens: metric.int().positive(),
  tokenizer: tokenizerSchema,
  settings: z.object({
    epochs: metric.int().min(1).max(3),
    batchSize: metric.int().min(1).max(16),
    loraRank: z.literal(16),
    seed: z.literal(42),
    learningRate: z.literal(0.0002),
  }),
  completedAt: z.string().datetime({ offset: true }),
  steps: z
    .array(
      z.object({
        epoch: metric.int(),
        batch: metric.int(),
        status: z.literal("completed"),
        inputTokens: metric.int().positive(),
        durationMs: metric,
        metrics: z.record(z.unknown()),
      }),
    )
    .min(1),
});
const modelCheck = z
  .object({
    requirement: z.string().min(1).max(3000),
    kind: z.enum([
      "text_visible",
      "heading",
      "link",
      "image_alt",
      "no_horizontal_overflow",
      "manual",
    ]),
    path: z
      .string()
      .max(300)
      .regex(/^\/[A-Za-z0-9_/-]*$/)
      .refine((value) => !value.startsWith("//") && !value.includes("..")),
    expected: z.string().max(500),
    viewport: z.enum(["desktop", "mobile"]),
  })
  .strict();
const expectedSchema = z
  .object({ checks: z.array(modelCheck).length(1) })
  .strict();
const rowSchema = z.object({
  id: z.string(),
  requirement: z.string(),
  split: z.enum(["train", "validation", "test"]),
  website_id: z.string(),
  requirement_family: z.string(),
  expected: expectedSchema,
  review: z.object({
    status: z.string(),
    actorType: z.enum(["human", "agent"]).optional(),
    reviewer: z.string().nullable(),
    reviewed_at: z.string().nullable(),
    rationale: z.string().optional(),
  }),
});
const manifestSchema = z.object({
  schemaVersion: z.literal(2),
  experimentId: identity.experimentId,
  benchmarkMode: modes,
  datasetPath: identity.datasetPath,
  datasetSha256: digest,
  model: identity.model,
  renderer: identity.renderer,
  promptSha256: digest,
  trainIds: z.array(z.string()).min(1),
  validationIds: z.array(z.string()),
  heldoutIds: z.array(z.string()).min(1).max(72),
  fewShotIds: z.array(z.string()).length(6),
  sampling: samplingSchema,
  training: z.object({
    epochs: metric.int().min(1).max(3),
    batchSize: metric.int().min(1).max(16),
    loraRank: z.literal(16),
    seed: z.literal(42),
    learningRate: z.literal(0.0002),
  }),
  reviewProvenance: provenanceSchema,
  createdAt: z.string().datetime({ offset: true }),
});
type Row = z.infer<typeof rowSchema>;
type Run = z.infer<typeof runSchema>;
type Manifest = z.infer<typeof manifestSchema>;
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
function ensure(condition: unknown, reason: string): asserts condition {
  if (!condition) throw new Error(reason);
}
function read(filename: string, max = 3_000_000) {
  const bytes = readFileSync(filename);
  ensure(bytes.length <= max, "Evidence file budget exceeded");
  return bytes;
}
function json(filename: string) {
  const bytes = read(filename);
  return { value: JSON.parse(bytes.toString()), sha: hash(bytes) };
}
function under(root: string, filename: string) {
  const resolved = realpathSync(filename);
  ensure(
    resolved.startsWith(`${realpathSync(root)}${path.sep}`),
    "Evidence path escapes its root",
  );
  return resolved;
}
function evalPath(root: string, filename: string) {
  return under(root, path.resolve(path.dirname(root), filename));
}
function isReviewed(row: Row, actor?: "human" | "agent") {
  return (
    row.review.status === "approved" &&
    (!actor || row.review.actorType === actor) &&
    !!row.review.reviewer?.trim() &&
    !!row.review.reviewed_at &&
    Number.isFinite(Date.parse(row.review.reviewed_at)) &&
    (row.review.actorType !== "agent" || !!row.review.rationale?.trim())
  );
}
function dataset(filename: string) {
  const bytes = read(filename);
  const rows = bytes
    .toString()
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => rowSchema.parse(JSON.parse(line)));
  const seen = new Set<string>(),
    sites = new Map<string, string>(),
    families = new Map<string, string>();
  for (const row of rows) {
    ensure(!seen.has(row.id), "Duplicate dataset row");
    seen.add(row.id);
    ensure(
      row.expected.checks[0].requirement === row.requirement,
      "Changed reference requirement",
    );
    parseApprovedSyntheticCheck(
      JSON.stringify(row.expected),
      row.requirement,
      "reference",
    );
    for (const [key, map] of [
      [row.website_id, sites],
      [row.requirement_family, families],
    ] as const) {
      ensure(
        !map.has(key) || map.get(key) === row.split,
        "Dataset group leakage",
      );
      map.set(key, row.split);
    }
  }
  return { rows, sha: hash(bytes) };
}
function validateManifest(root: string, run: Run) {
  const file = json(evalPath(root, run.manifestPath));
  ensure(file.sha === run.manifestSha256, "Manifest hash differs");
  const manifest = manifestSchema.parse(file.value);
  for (const field of [
    "experimentId",
    "benchmarkMode",
    "datasetPath",
    "datasetSha256",
    "model",
    "renderer",
    "promptSha256",
    "reviewProvenance",
  ] as const)
    ensure(same(run[field], manifest[field]), `Manifest ${field} differs`);
  ensure(
    same(run.sampling, manifest.sampling),
    "Sampling differs from the frozen manifest",
  );
  const data = dataset(evalPath(root, manifest.datasetPath));
  ensure(data.sha === manifest.datasetSha256, "Dataset hash differs");
  const actor =
    manifest.benchmarkMode === "agent-reviewed-pilot" ? "agent" : "human";
  ensure(
    data.rows.every((row) => isReviewed(row, actor)),
    "Review provenance is missing or mislabeled",
  );
  ensure(
    manifest.reviewProvenance.humanValidated ===
      data.rows.filter((row) => isReviewed(row, "human")).length &&
      manifest.reviewProvenance.agentReviewed ===
        data.rows.filter((row) => isReviewed(row, "agent")).length,
    "Review counts differ",
  );
  for (const [split, field] of [
    ["train", "trainIds"],
    ["validation", "validationIds"],
    ["test", "heldoutIds"],
  ] as const)
    ensure(
      same(
        data.rows.filter((row) => row.split === split).map((row) => row.id),
        manifest[field],
      ),
      "Frozen cohort changed",
    );
  ensure(
    same(
      run.measurements.map((sample) => sample.id),
      manifest.heldoutIds,
    ),
    "Evaluation does not cover the exact frozen heldout cohort",
  );
  ensure(
    same(run.heldoutIds, manifest.heldoutIds) &&
      same(
        run.fewShotIds,
        run.configuration === "few-shot" ? manifest.fewShotIds : [],
      ),
    "Evaluation prompt examples differ",
  );
  const shots = manifest.fewShotIds.map((id) =>
    data.rows.find((row) => row.id === id && row.split === "train"),
  );
  ensure(
    shots.every(Boolean) &&
      new Set(shots.map((row) => row!.expected.checks[0].kind)).size === 6,
    "Few-shot examples are invalid",
  );
  ensure(
    run.measurements.every(
      (sample) =>
        sample.outputTokens <= manifest.sampling.maxOutputTokens &&
        sample.outputTokens === sample.outputTokenIds.length &&
        sample.inputTokens > 0,
    ),
    "Token observations violate the frozen limits",
  );
  if (run.configuration === "fine-tuned") {
    ensure(
      run.checkpoint && run.trainingReceiptPath && run.trainingReceiptSha256,
      "Fine-tuned result has no training provenance",
    );
    const trainingFile = json(evalPath(root, run.trainingReceiptPath));
    ensure(
      trainingFile.sha === run.trainingReceiptSha256,
      "Training receipt hash differs",
    );
    const training = trainingSchema.parse(trainingFile.value);
    for (const field of [
      "experimentId",
      "benchmarkMode",
      "manifestSha256",
      "datasetSha256",
      "model",
      "renderer",
      "promptSha256",
      "reviewProvenance",
    ] as const)
      ensure(same(training[field], run[field]), "Training experiment differs");
    ensure(
      training.samplerPath === run.checkpoint &&
        training.trainingExamples === manifest.trainIds.length &&
        same(training.settings, manifest.training) &&
        same(training.tokenizer, run.tokenizer),
      "Checkpoint, tokenizer or training cohort differs",
    );
    ensure(
      training.trainingTokens ===
        training.steps.reduce((sum, step) => sum + step.inputTokens, 0) &&
        Date.parse(training.completedAt) <= Date.parse(run.recordedAt),
      "Training token counts or completion timing differ",
    );
    ensure(
      training.steps.length ===
        Math.ceil(manifest.trainIds.length / manifest.training.batchSize) *
          manifest.training.epochs,
      "Training steps are incomplete",
    );
    for (const [index, step] of training.steps.entries())
      ensure(
        step.epoch ===
          Math.floor(
            index /
              Math.ceil(manifest.trainIds.length / manifest.training.batchSize),
          ) &&
          step.batch ===
            index %
              Math.ceil(manifest.trainIds.length / manifest.training.batchSize),
        "Training step order differs",
      );
  } else
    ensure(
      run.checkpoint === null &&
        !run.trainingReceiptPath &&
        !run.trainingReceiptSha256,
      "Base model evaluation claims a checkpoint",
    );
  return { manifest, rows: data.rows };
}
function evidenceFiles(
  root: string,
  directory = path.join(root, "results"),
  depth = 0,
  files: string[] = [],
): string[] {
  if (!existsSync(directory) || depth > 4 || files.length >= 500) return files;
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    if (files.length >= 500) break;
    if (entry.isDirectory() && !["evidence", "fixtures"].includes(entry.name))
      evidenceFiles(root, path.join(directory, entry.name), depth + 1, files);
    else if (entry.isFile() && entry.name.endsWith(".json"))
      files.push(path.join(directory, entry.name));
  }
  return files;
}
function isPng(filename: string) {
  const fd = openSync(filename, "r");
  try {
    const header = Buffer.alloc(8);
    return (
      readSync(fd, header, 0, 8, 0) === 8 &&
      header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    );
  } finally {
    closeSync(fd);
  }
}
const observationResultSchema = z.object({
  checkId: z.string(),
  requirement: z.string(),
  kind: modelCheck.shape.kind,
  status: z.enum(["passed", "failed", "blocked", "unverified"]),
  expected: z.string(),
  durationMs: metric,
  evidence: z.object({
    observed: z.string().min(1),
    dom: z.string().optional(),
    screenshot: z.string().optional(),
    url: z.string(),
    viewport: z.object({
      width: metric.int().positive(),
      height: metric.int().positive(),
    }),
  }),
});
function browserMetrics(
  filename: string,
  raw: unknown,
  run: Run,
  runSha: string,
  rows: Row[],
) {
  const receipt = z
    .object({
      schemaVersion: z.literal(1),
      status: z.literal("completed"),
      provider: identity.provider,
      model: identity.model,
      configuration,
      benchmarkMode: modes,
      experimentId: z.string(),
      manifestSha256: digest,
      sourceReceiptSha256: digest,
      datasetSha256: digest,
      observations: z.array(z.unknown()).max(72),
    })
    .parse(raw);
  for (const field of [
    "configuration",
    "benchmarkMode",
    "experimentId",
    "manifestSha256",
    "datasetSha256",
  ] as const)
    ensure(receipt[field] === run[field], "Browser experiment differs");
  ensure(
    receipt.sourceReceiptSha256 === runSha &&
      receipt.observations.length === run.measurements.length,
    "Browser source receipt differs",
  );
  const observations: BrowserObservation[] = [];
  const folder = path.dirname(filename);
  for (const [index, unknownObservation] of receipt.observations.entries()) {
    const sample = run.measurements[index],
      row = rows.find((item) => item.id === sample.id)!;
    const reference = row.expected.checks[0];
    const stored = z
      .object({
        id: z.string(),
        referenceKind: modelCheck.shape.kind,
        referenceAutomatable: z.boolean(),
        rawOutputSha256: digest,
        validSchema: z.boolean(),
        modelKind: modelCheck.shape.kind.optional(),
        classification: z.string(),
        healthy: observationResultSchema.optional(),
        broken: observationResultSchema.optional(),
        artifacts: z
          .record(
            z.object({
              audit: z.string(),
              fixture: z.string(),
              fixtureSha256: digest,
            }),
          )
          .optional(),
      })
      .parse(unknownObservation);
    ensure(
      stored.id === sample.id &&
        stored.rawOutputSha256 === hash(sample.rawOutput) &&
        stored.referenceKind === reference.kind &&
        stored.referenceAutomatable === (reference.kind !== "manual"),
      "Browser row identity differs",
    );
    let check: ReturnType<typeof parseApprovedSyntheticCheck> | undefined;
    try {
      check = parseApprovedSyntheticCheck(
        sample.rawOutput,
        row.requirement,
        `model-${index + 1}`,
      );
    } catch {
      /* Malformed outputs remain malformed. */
    }
    let classification: BrowserObservation["classification"];
    if (!check) classification = "malformed";
    else if (check.kind === "manual")
      classification =
        reference.kind === "manual"
          ? "appropriate_abstention"
          : "inappropriate_abstention";
    else if (reference.kind === "manual")
      classification = "unexpected_automation";
    else {
      ensure(
        stored.healthy && stored.broken && stored.artifacts,
        "Browser pair is incomplete",
      );
      for (const variant of ["healthy", "broken"] as const) {
        const result = stored[variant] as CheckResult,
          artifact = stored.artifacts[variant];
        const id = `model-${String(index + 1).padStart(3, "0")}-${variant}`;
        ensure(
          artifact &&
            artifact.audit === `${id}.json` &&
            artifact.fixture === `fixtures/${id}.html`,
          "Browser artifact path differs",
        );
        const fixture = fixturePages(reference, variant)[reference.path];
        ensure(
          artifact.fixtureSha256 === hash(fixture) &&
            read(
              under(folder, path.join(folder, artifact.fixture)),
            ).toString() === fixture,
          "Browser fixture differs from the reference oracle",
        );
        const audit = json(
          under(folder, path.join(folder, artifact.audit)),
        ).value;
        ensure(
          audit.id === id &&
            audit.status === "completed" &&
            same(audit.checks, [check]) &&
            same(audit.results, [result]),
          "Audit evidence differs from the model assertion",
        );
        ensure(
          result.checkId === check.id &&
            result.kind === check.kind &&
            result.requirement === check.requirement &&
            result.expected === check.expected &&
            result.evidence.url === new URL(check.path, SAMPLE_URL).href,
          "Browser assertion identity differs",
        );
        ensure(
          same(
            result.evidence.viewport,
            check.viewport === "mobile"
              ? { width: 390, height: 844 }
              : { width: 1365, height: 900 },
          ),
          "Browser viewport differs",
        );
        if (["passed", "failed"].includes(result.status))
          ensure(
            result.evidence.screenshot,
            "Executed assertion has no screenshot",
          );
        if (result.evidence.screenshot) {
          ensure(
            result.evidence.screenshot === `/evidence/${id}/01-${check.id}.png`,
            "Screenshot identity differs",
          );
          ensure(
            isPng(
              under(
                folder,
                path.join(folder, result.evidence.screenshot.slice(1)),
              ),
            ),
            "Screenshot is missing or invalid",
          );
        }
      }
      const statuses = [stored.healthy.status, stored.broken.status];
      classification = statuses.includes("blocked")
        ? "blocked_pair"
        : statuses.includes("unverified")
          ? "unverified_pair"
          : "executed_pair";
    }
    if (!check || check.kind === "manual" || reference.kind === "manual")
      ensure(
        !stored.healthy && !stored.broken && !stored.artifacts,
        "Unexecuted requirement claims browser evidence",
      );
    ensure(
      stored.validSchema === Boolean(check) &&
        stored.modelKind === check?.kind &&
        stored.classification === classification,
      "Browser classification differs",
    );
    observations.push({
      ...stored,
      classification,
      artifacts: stored.artifacts as BrowserObservation["artifacts"],
    });
  }
  return summarizeBrowserObservations(observations);
}

/** Read bundled experiment evidence only. Never creates a model or database client. */
export function getEvaluation(options: { root?: string } = {}): Evaluation {
  const root = options.root ?? path.resolve("eval");
  let candidates = 0,
    validated = 0,
    agentReviewed = 0,
    pilotExamples = 0;
  try {
    const data = dataset(path.join(root, "candidates.jsonl"));
    candidates = data.rows.length;
    validated = data.rows.filter((row) => isReviewed(row, "human")).length;
  } catch {
    /* Missing data is not validation. */
  }
  try {
    const data = dataset(path.join(root, "pilot.jsonl"));
    pilotExamples = data.rows.length;
    agentReviewed = data.rows.filter((row) => isReviewed(row, "agent")).length;
  } catch {
    /* A candidate file is not a reviewed pilot. */
  }
  const labels = {
    "zero-shot": "Qwen3.5-4B · zero-shot",
    "few-shot": "Qwen3.5-4B · few-shot",
    "fine-tuned": "Tinker LoRA · Qwen3.5-4B",
  };
  const configurations: Evaluation["configurations"] = Object.values(
    labels,
  ).map((name) => ({
    name,
    status: "Not evaluated",
    structuredOutputRate: null,
    interpretationAccuracy: null,
    executableCorrectness: null,
    falsePassRate: null,
    abstentionRate: null,
    latencyMs: null,
    tokens: null,
  }));
  const notes = [
    "Only completed, matching receipts from one frozen experiment can appear together. Missing or mismatched evidence stays unevaluated.",
    "Reference agreement measures exact assertion fields. It is not human-scored interpretation accuracy.",
    "Browser results measure sensitivity to paired synthetic mutations, not correctness on client websites. Blocked checks are never treated as passes.",
  ];
  const runs: {
    run: Run;
    sha: string;
    filename: string;
    manifest: Manifest;
    rows: Row[];
  }[] = [];
  const browserReceipts: { filename: string; value: unknown }[] = [];
  for (const filename of [
    ...evidenceFiles(root),
    ...evidenceFiles(root, path.join(root, "browser")),
  ]) {
    try {
      const file = json(filename);
      if (path.basename(filename) === "browser-evaluation.json") {
        browserReceipts.push({ filename, value: file.value });
        continue;
      }
      if (file.value.operation !== "evaluation") continue;
      const run = runSchema.parse(file.value);
      runs.push({
        run,
        sha: file.sha,
        filename,
        ...validateManifest(root, run),
      });
    } catch {
      /* Invalid or incomplete receipts do not produce metrics. */
    }
  }
  // Never fill rows with unrelated datasets, prompts, checkpoints or holdout slices.
  runs.sort(
    (a, b) =>
      Date.parse(b.manifest.createdAt) - Date.parse(a.manifest.createdAt) ||
      Date.parse(b.run.recordedAt) - Date.parse(a.run.recordedAt),
  );
  const selected = runs[0];
  if (selected) {
    for (const config of Object.keys(labels) as (keyof typeof labels)[]) {
      const candidate = runs.find(
        (item) =>
          item.run.manifestSha256 === selected.run.manifestSha256 &&
          same(item.run.tokenizer, selected.run.tokenizer) &&
          item.run.configuration === config,
      );
      if (!candidate) continue;
      const { run, rows } = candidate;
      let valid = 0,
        matches = 0,
        abstained = 0,
        untestable = 0;
      for (const sample of run.measurements) {
        const row = rows.find((item) => item.id === sample.id)!;
        const expected = row.expected.checks[0];
        if (expected.kind === "manual") untestable++;
        try {
          const parsed = parseApprovedSyntheticCheck(
            sample.rawOutput,
            row.requirement,
            "measured",
          );
          valid++;
          const actual = JSON.parse(sample.rawOutput).checks[0];
          if (
            parsed.kind === expected.kind &&
            parsed.path === expected.path &&
            parsed.viewport === expected.viewport &&
            (["manual", "image_alt", "no_horizontal_overflow"].includes(
              expected.kind,
            ) ||
              actual.expected === expected.expected)
          )
            matches++;
          if (expected.kind === "manual" && parsed.kind === "manual")
            abstained++;
        } catch {
          /* Invalid model output counts against the full denominator. */
        }
      }
      let browser: ReturnType<typeof summarizeBrowserObservations> | undefined;
      for (const receipt of browserReceipts) {
        try {
          browser = browserMetrics(
            receipt.filename,
            receipt.value,
            run,
            candidate.sha,
            rows,
          );
          break;
        } catch {
          /* Browser metrics need complete matching evidence. */
        }
      }
      const record = configurations.find(
        (item) => item.name === labels[config],
      )!;
      const n = run.measurements.length;
      Object.assign(record, {
        status: `${n} heldout requirements · ${browser ? `${browser.completedPairs}/${browser.referenceAutomatable} browser pairs completed` : "browser evaluation pending"}`,
        structuredOutputRate: valid / n,
        interpretationAccuracy: matches / n,
        executableCorrectness: browser?.executableCorrectness ?? null,
        falsePassRate: browser?.falsePassRate ?? null,
        abstentionRate: untestable ? abstained / untestable : null,
        latencyMs:
          run.measurements.reduce((sum, item) => sum + item.latencyMs, 0) / n,
        tokens: run.measurements.reduce(
          (sum, item) => sum + item.inputTokens + item.outputTokens,
          0,
        ),
        browserCounts: browser
          ? {
              malformed: browser.malformed,
              blockedPairs: browser.blockedPairs,
              unverifiedPairs: browser.unverifiedPairs,
              inappropriateAbstentions: browser.inappropriateAbstentions,
              brokenExecuted: browser.brokenExecuted,
              brokenFalsePasses: browser.brokenFalsePasses,
            }
          : undefined,
      });
    }
    notes.unshift(
      selected.manifest.benchmarkMode === "agent-reviewed-pilot"
        ? "Agent-reviewed synthetic pilot. Human-validated examples: 0. These measurements do not establish accuracy on real client briefs."
        : "This experiment uses a human-reviewed reference dataset.",
    );
    notes.push(
      `Frozen experiment: ${selected.manifest.experimentId}. Training ${selected.manifest.trainIds.length}, validation ${selected.manifest.validationIds.length}, test ${selected.manifest.heldoutIds.length}.`,
    );
  }
  const manifest = selected?.manifest;
  return {
    configurations,
    dataset: {
      candidates,
      validated,
      agentReviewed,
      pilotExamples,
      benchmarkMode:
        manifest?.benchmarkMode ??
        (agentReviewed ? "agent-reviewed-pilot" : null),
      splitPolicy: manifest
        ? `One frozen cohort: ${manifest.trainIds.length} train, ${manifest.validationIds.length} validation, ${manifest.heldoutIds.length} test. Website and wording-family groups do not cross splits.`
        : "Candidate and pilot datasets are synthetic. No comparison is shown without matching completed experiment receipts.",
    },
    notes,
  };
}
