// These temporary receipts are integrity-test fixtures, never published model results.
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { getEvaluation } from "../server/evaluation.js";
import {
  evaluateMeasurements,
  type DatasetRow,
} from "../scripts/model-browser-evaluate.js";
import type { Check } from "../shared/types.js";

const roots: string[] = [];
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const date = "2026-10-13T00:00:00Z";
const json = async (filename: string, value: unknown) => {
  await mkdir(path.dirname(filename), { recursive: true });
  const content = JSON.stringify(value, null, 2) + "\n";
  await writeFile(filename, content);
  return sha(content);
};
afterAll(async () => {
  await Promise.all(
    roots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function harness() {
  const project = await mkdtemp(
    path.join(os.tmpdir(), "flowproof-evaluation-test-"),
  );
  roots.push(project);
  const root = path.join(project, "eval");
  await mkdir(path.join(root, "results"), { recursive: true });
  const kinds: Check["kind"][] = [
    "heading",
    "link",
    "text_visible",
    "image_alt",
    "no_horizontal_overflow",
    "manual",
  ];
  const makeRow = (kind: Check["kind"], split: string, index: number) => ({
    id: `${split}-${index}`,
    requirement: `Synthetic ${split} requirement ${index}`,
    split,
    website_id: `site-${split}`,
    requirement_family: `${split}-${kind}`,
    expected: {
      checks: [
        {
          requirement: `Synthetic ${split} requirement ${index}`,
          kind,
          path: "/",
          expected: "A literal fixture",
          viewport: kind === "no_horizontal_overflow" ? "mobile" : "desktop",
        },
      ],
    },
    review: {
      status: "approved",
      actorType: "agent",
      reviewer: "Test fixture",
      reviewed_at: date,
      rationale: "Synthetic fixture for receipt-integrity tests only.",
    },
  });
  const rows = [
    ...kinds.map((kind, index) => makeRow(kind, "train", index)),
    makeRow("heading", "test", 0),
    makeRow("manual", "test", 1),
  ];
  const content = rows.map((row) => JSON.stringify(row)).join("\n") + "\n";
  await writeFile(path.join(root, "pilot.jsonl"), content);
  await writeFile(
    path.join(root, "candidates.jsonl"),
    rows
      .map((row) =>
        JSON.stringify({
          ...row,
          review: { status: "unreviewed", reviewer: null, reviewed_at: null },
        }),
      )
      .join("\n") + "\n",
  );
  const manifest = {
    schemaVersion: 2,
    experimentId: "integrity-test",
    benchmarkMode: "agent-reviewed-pilot",
    datasetPath: "eval/pilot.jsonl",
    datasetSha256: sha(content),
    model: "Qwen/Qwen3.5-4B",
    renderer: "qwen3.5-hf-chat-template-disable-thinking",
    promptSha256: sha("Synthetic test prompt"),
    trainIds: rows.filter((row) => row.split === "train").map((row) => row.id),
    validationIds: [],
    heldoutIds: rows.filter((row) => row.split === "test").map((row) => row.id),
    fewShotIds: rows
      .filter((row) => row.split === "train")
      .map((row) => row.id),
    sampling: { temperature: 0, maxOutputTokens: 512 },
    training: {
      epochs: 1,
      batchSize: 8,
      loraRank: 16,
      seed: 42,
      learningRate: 0.0002,
    },
    reviewProvenance: {
      humanValidated: 0,
      agentReviewed: rows.length,
      note: "Test fixtures, not measured provider evidence",
    },
    createdAt: date,
  };
  const manifestSha = await json(
    path.join(root, "pilot.manifest.json"),
    manifest,
  );
  const tokenizer = {
    model: manifest.model,
    class: "TestTokenizer",
    chatTemplateSha256: sha("template"),
    vocabularySha256: sha("vocabulary"),
    enableThinking: false,
    eosTokenId: 3,
  };
  const identity = {
    schemaVersion: 2,
    provider: "tinker",
    model: manifest.model,
    renderer: manifest.renderer,
    experimentId: manifest.experimentId,
    benchmarkMode: manifest.benchmarkMode,
    manifestPath: "eval/pilot.manifest.json",
    manifestSha256: manifestSha,
    datasetPath: manifest.datasetPath,
    datasetSha256: manifest.datasetSha256,
    promptSha256: manifest.promptSha256,
    reviewProvenance: manifest.reviewProvenance,
    recordedAt: date,
    tokenizer,
  };
  const run = {
    ...identity,
    operation: "evaluation",
    status: "completed",
    configuration: "zero-shot",
    checkpoint: null as string | null,
    trainingReceiptPath: null as string | null,
    trainingReceiptSha256: null as string | null,
    sampling: manifest.sampling,
    heldoutIds: manifest.heldoutIds,
    fewShotIds: [] as string[],
    measurements: rows
      .filter((row) => row.split === "test")
      .map((row) => ({
        id: row.id,
        rawOutput: JSON.stringify(row.expected),
        latencyMs: 20,
        inputTokens: 20,
        outputTokens: 3,
        outputTokenIds: [1, 2, 3],
        validSchema: true,
        referenceMatch: true,
      })),
  };
  const filename = path.join(root, "results/zero-shot.json");
  await json(filename, run);
  return {
    root,
    rows,
    manifest,
    identity,
    run,
    filename,
    read: () => getEvaluation({ root }),
  };
}

describe("bundled model evidence ingestion", () => {
  it("recomputes metrics from raw responses and keeps agent review separate from human validation", async () => {
    const h = await harness();
    h.run.measurements[0].rawOutput = "not valid JSON";
    await json(h.filename, h.run);
    const result = h.read();
    expect(result.dataset).toMatchObject({
      validated: 0,
      agentReviewed: 8,
      benchmarkMode: "agent-reviewed-pilot",
    });
    expect(result.configurations[0]).toMatchObject({
      structuredOutputRate: 0.5,
      interpretationAccuracy: 0.5,
      executableCorrectness: null,
      falsePassRate: null,
      abstentionRate: 1,
      tokens: 46,
    });
    expect(result.notes.join(" ")).toContain("Human-validated examples: 0");
  });

  it("rejects incomplete cohorts, altered settings and inconsistent token usage", async () => {
    const h = await harness();
    const original = structuredClone(h.run);
    for (const changed of [
      { ...original, measurements: original.measurements.slice(0, 1) },
      { ...original, sampling: { ...original.sampling, temperature: 0.5 } },
      {
        ...original,
        measurements: [
          { ...original.measurements[0], outputTokens: 7 },
          original.measurements[1],
        ],
      },
      { ...original, fewShotIds: h.manifest.fewShotIds },
    ]) {
      await json(h.filename, changed);
      expect(h.read().configurations[0].structuredOutputRate).toBeNull();
    }
  });

  it("does not combine results from different frozen manifests or tokenizers", async () => {
    const h = await harness();
    const manifest = {
      ...h.manifest,
      experimentId: "second-experiment",
      createdAt: "2026-10-13T00:01:00Z",
    };
    const digest = await json(
      path.join(h.root, "second.manifest.json"),
      manifest,
    );
    await json(path.join(h.root, "results/few-shot.json"), {
      ...h.run,
      configuration: "few-shot",
      fewShotIds: manifest.fewShotIds,
      experimentId: manifest.experimentId,
      manifestPath: "eval/second.manifest.json",
      manifestSha256: digest,
    });
    expect(
      h.read().configurations.map((row) => row.structuredOutputRate),
    ).toEqual([null, 1, null]);
    await json(path.join(h.root, "results/few-shot.json"), {
      ...h.run,
      configuration: "few-shot",
      fewShotIds: h.manifest.fewShotIds,
      recordedAt: "2026-10-13T00:01:00Z",
      tokenizer: {
        ...h.run.tokenizer,
        vocabularySha256: sha("different tokenizer"),
      },
    });
    expect(
      h.read().configurations.map((row) => row.structuredOutputRate),
    ).toEqual([null, 1, null]);
  });

  it("requires a completed matching training receipt before accepting fine-tuned results", async () => {
    const h = await harness();
    const training = {
      ...h.identity,
      operation: "training",
      status: "completed",
      samplerPath: "tinker://test-fixture/sampler",
      trainingExamples: 6,
      trainingTokens: 60,
      settings: h.manifest.training,
      completedAt: date,
      steps: [
        {
          epoch: 0,
          batch: 0,
          status: "completed",
          inputTokens: 60,
          durationMs: 10,
          metrics: { loss: 1.1 },
        },
      ],
    };
    const trainingSha = await json(
      path.join(h.root, "results/training.json"),
      training,
    );
    const fine = {
      ...h.run,
      configuration: "fine-tuned",
      checkpoint: training.samplerPath,
      trainingReceiptPath: "eval/results/training.json",
      trainingReceiptSha256: trainingSha,
    };
    const filename = path.join(h.root, "results/fine-tuned.json");
    await json(filename, fine);
    expect(h.read().configurations[2].structuredOutputRate).toBe(1);
    await json(filename, {
      ...fine,
      checkpoint: "tinker://unrelated/checkpoint",
    });
    expect(h.read().configurations[2].structuredOutputRate).toBeNull();
    await json(filename, fine);
    await json(path.join(h.root, "results/training.json"), {
      ...training,
      status: "failed",
    });
    expect(h.read().configurations[2].structuredOutputRate).toBeNull();
  });

  it("loads real paired browser evidence and rejects edited fixtures or source receipts", async () => {
    const h = await harness();
    const folder = path.join(h.root, "browser/zero-shot");
    await mkdir(folder, { recursive: true });
    const observations = await evaluateMeasurements(
      h.rows as DatasetRow[],
      h.run.measurements,
      folder,
    );
    const receipt = {
      schemaVersion: 1,
      status: "completed",
      provider: h.run.provider,
      model: h.run.model,
      configuration: h.run.configuration,
      benchmarkMode: h.run.benchmarkMode,
      experimentId: h.run.experimentId,
      manifestSha256: h.run.manifestSha256,
      datasetSha256: h.run.datasetSha256,
      sourceReceiptSha256: sha(await readFile(h.filename)),
      observations,
      metrics: { executableCorrectness: 0.2, falsePassRate: 0.8 },
    };
    const filename = path.join(folder, "browser-evaluation.json");
    await json(filename, receipt);
    expect(h.read().configurations[0]).toMatchObject({
      executableCorrectness: 1,
      falsePassRate: 0,
      browserCounts: { brokenExecuted: 1, brokenFalsePasses: 0 },
    });
    const fixture = path.join(
      folder,
      observations[0].artifacts!.broken.fixture,
    );
    const original = await readFile(fixture);
    await writeFile(fixture, "<h1>Edited fixture</h1>");
    expect(h.read().configurations[0].executableCorrectness).toBeNull();
    await writeFile(fixture, original);
    await json(filename, {
      ...receipt,
      sourceReceiptSha256: sha("unrelated receipt"),
    });
    expect(h.read().configurations[0].falsePassRate).toBeNull();
  }, 30_000);
});
