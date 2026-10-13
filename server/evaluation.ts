import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Evaluation } from "../shared/types.js";

const root = path.resolve("eval");
const metric = z.number().finite().nonnegative();
const runSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.literal("completed"),
  provider: z.literal("tinker"),
  model: z.literal("Qwen/Qwen3.5-4B"),
  configuration: z.enum(["zero-shot", "few-shot", "fine-tuned"]),
  checkpoint: z.string().startsWith("tinker://").nullable(),
  datasetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  datasetPath: z.string().max(500),
  recordedAt: z.string().datetime({ offset: true }),
  measurements: z
    .array(
      z.object({
        id: z.string(),
        rawOutput: z.string().max(100000),
        latencyMs: metric,
        inputTokens: metric.int(),
        outputTokens: metric.int(),
      }),
    )
    .min(1)
    .max(72),
});
const expectedSchema = z
  .object({
    checks: z
      .array(
        z
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
            path: z
              .string()
              .regex(/^\/[A-Za-z0-9_/-]*$/)
              .refine(
                (value) => !value.startsWith("//") && !value.includes(".."),
              ),
            expected: z.string().max(500),
            viewport: z.enum(["desktop", "mobile"]),
          })
          .strict(),
      )
      .length(1),
  })
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
    reviewer: z.string().nullable(),
    reviewed_at: z.string().nullable(),
  }),
});

function dataset(filename: string) {
  const contents = readFileSync(filename, "utf8");
  if (contents.length > 3_000_000) throw new Error("Dataset budget exceeded");
  const rows = contents
    .trim()
    .split("\n")
    .map((line) => rowSchema.parse(JSON.parse(line)));
  const seen = new Set<string>();
  const sites = new Map<string, string>();
  const families = new Map<string, string>();
  for (const row of rows) {
    if (seen.has(row.id)) throw new Error("Duplicate dataset row");
    seen.add(row.id);
    for (const [key, map] of [
      [row.website_id, sites],
      [row.requirement_family, families],
    ] as const) {
      if (map.has(key) && map.get(key) !== row.split)
        throw new Error("Dataset group leakage");
      map.set(key, row.split);
    }
  }
  return { rows, sha: createHash("sha256").update(contents).digest("hex") };
}
function isReviewed(row: z.infer<typeof rowSchema>) {
  return (
    row.review.status === "approved" &&
    !!row.review.reviewer?.trim() &&
    !!row.review.reviewed_at &&
    Number.isFinite(Date.parse(row.review.reviewed_at))
  );
}

export function getEvaluation(): Evaluation {
  let candidates = 0;
  let validated = 0;
  try {
    const data = dataset(path.join(root, "candidates.jsonl"));
    candidates = data.rows.length;
    validated = data.rows.filter(isReviewed).length;
  } catch {
    /* Missing or invalid candidate files are not evidence of validated data. */
  }
  const labels = {
    "zero-shot": "Qwen3.5-4B · zero-shot",
    "few-shot": "Qwen3.5-4B · few-shot",
    "fine-tuned": "Tinker LoRA · Qwen3.5-4B",
  };
  const configurations = Object.values(labels).map((name) => ({
    name,
    status: "Not evaluated",
    structuredOutputRate: null as number | null,
    interpretationAccuracy: null as number | null,
    executableCorrectness: null as number | null,
    falsePassRate: null as number | null,
    abstentionRate: null as number | null,
    latencyMs: null as number | null,
    tokens: null as number | null,
  }));
  const notes = [
    "Model metrics remain empty until a completed experiment supplies a reviewed dataset and per-example measurements.",
    "The local deterministic parser is a usable fallback, not an AI baseline or a fine-tuned model.",
    "Interpretation uses exact agreement on reference assertion fields. Browser correctness and false-pass rate require separate execution and are not inferred from JSON validity.",
  ];
  const folder = path.join(root, "results");
  const runs: z.infer<typeof runSchema>[] = [];
  if (existsSync(folder)) {
    for (const filename of readdirSync(folder)
      .filter((file) => file.endsWith(".json"))
      .slice(0, 100)) {
      try {
        const raw = readFileSync(path.join(folder, filename), "utf8");
        if (raw.length > 10_000_000) continue;
        const run = runSchema.parse(JSON.parse(raw));
        if (run.configuration === "fine-tuned" && !run.checkpoint) continue;
        runs.push(run);
      } catch {
        /* Incomplete/invalid runs never become dashboard metrics. */
      }
    }
  }
  runs.sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  for (const run of runs) {
    try {
      const filename = path.resolve(run.datasetPath);
      if (!filename.startsWith(`${root}${path.sep}`)) continue;
      const data = dataset(filename);
      if (data.sha !== run.datasetSha256 || !data.rows.every(isReviewed))
        continue;
      let valid = 0;
      let matches = 0;
      let abstained = 0;
      let untestable = 0;
      const seen = new Set<string>();
      for (const sample of run.measurements) {
        if (seen.has(sample.id)) throw new Error("Duplicate measurement");
        seen.add(sample.id);
        const row = data.rows.find(
          (item) => item.id === sample.id && item.split === "test",
        );
        if (!row) throw new Error("Measurement is not a heldout example");
        const expected = row.expected.checks[0];
        if (expected.kind === "manual") untestable++;
        let candidate: unknown;
        try {
          candidate = JSON.parse(sample.rawOutput);
        } catch {
          continue;
        }
        const parsed = expectedSchema.safeParse(candidate);
        if (
          !parsed.success ||
          parsed.data.checks[0].requirement !== row.requirement
        )
          continue;
        valid++;
        const actual = parsed.data.checks[0];
        if (
          actual.kind === expected.kind &&
          actual.path === expected.path &&
          actual.viewport === expected.viewport &&
          (["manual", "image_alt", "no_horizontal_overflow"].includes(
            expected.kind,
          ) ||
            actual.expected === expected.expected)
        )
          matches++;
        if (expected.kind === "manual" && actual.kind === "manual") abstained++;
      }
      const n = run.measurements.length;
      const record = configurations.find(
        (item) => item.name === labels[run.configuration],
      )!;
      Object.assign(record, {
        status: `Measured ${n} heldout examples · browser evaluation pending`,
        structuredOutputRate: valid / n,
        interpretationAccuracy: matches / n,
        abstentionRate: untestable ? abstained / untestable : null,
        latencyMs:
          run.measurements.reduce((sum, item) => sum + item.latencyMs, 0) / n,
        tokens: run.measurements.reduce(
          (sum, item) => sum + item.inputTokens + item.outputTokens,
          0,
        ),
      });
    } catch {
      /* Fail closed on damaged or mismatched evidence. */
    }
  }
  return {
    configurations,
    dataset: {
      candidates,
      validated,
      splitPolicy:
        "Disjoint synthetic websites and wording families: 216 train, 72 validation, 72 test. Human approval is required before model experiments.",
    },
    notes,
  };
}
