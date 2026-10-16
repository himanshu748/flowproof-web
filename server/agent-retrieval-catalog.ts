import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { z } from "zod";

export const AGENT_RETRIEVAL_MODEL = "all-minilm:22m" as const;
export const AGENT_RETRIEVAL_DIMENSIONS = 384;
export const AgentRetrievalQuerySchema = z.enum([
  "mobile_paraphrase",
  "images",
  "contact",
]);
export type AgentRetrievalQueryId = z.infer<typeof AgentRetrievalQuerySchema>;
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const retrievalTextSha256 = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");

const vectorSchema = z
  .array(z.number().finite().min(-1).max(1))
  .length(AGENT_RETRIEVAL_DIMENSIONS)
  .refine(
    (vector) =>
      Math.abs(vector.reduce((sum, value) => sum + value * value, 0) - 1) <
      0.00001,
    "An actual normalized 384-dimensional embedding is required.",
  );
const catalogSchema = z
  .object({
    version: z.literal(1),
    model: z.literal(AGENT_RETRIEVAL_MODEL),
    dimensions: z.literal(AGENT_RETRIEVAL_DIMENSIONS),
    documents: z
      .array(
        z
          .object({
            textSha256: sha256,
            text: z.string().min(1).max(9001),
            vector: vectorSchema,
          })
          .strict()
          .refine(
            (entry) => retrievalTextSha256(entry.text) === entry.textSha256,
          ),
      )
      .min(1)
      .max(128),
    queries: z
      .array(
        z
          .object({
            id: AgentRetrievalQuerySchema,
            text: z.string().trim().min(1).max(200),
            vector: vectorSchema,
          })
          .strict(),
      )
      .length(3),
    provenance: z
      .object({
        modelDigest: sha256,
        generatedAt: z.string().datetime({ offset: true }),
        source: z.string().min(1).max(500),
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.documents.map((entry) => entry.textSha256)).size ===
        value.documents.length &&
      new Set(value.queries.map((entry) => entry.id)).size === 3,
    "Catalog entries must have unique fingerprints and all fixed queries.",
  );
export type AgentRetrievalCatalog = z.infer<typeof catalogSchema> & {
  catalogSha256: string;
};

/** No interpolation, network endpoint, invented vector or lexical substitution. */
export function parseAgentRetrievalCatalog(
  value: unknown,
): AgentRetrievalCatalog {
  const parsed = catalogSchema.parse(value);
  return {
    ...parsed,
    catalogSha256: retrievalTextSha256(JSON.stringify(parsed)),
  };
}

let catalog: Promise<AgentRetrievalCatalog> | undefined;
export function loadAgentRetrievalCatalog(): Promise<AgentRetrievalCatalog> {
  catalog ??= (async () => {
    const raw = await readFile(
      new URL("../shared/agent-retrieval-vectors.json", import.meta.url),
      "utf8",
    );
    if (Buffer.byteLength(raw) > 2 * 1024 * 1024)
      throw new Error("The fixed retrieval catalog exceeds its byte budget.");
    return parseAgentRetrievalCatalog(JSON.parse(raw));
  })().catch(() => {
    catalog = undefined;
    throw new Error("The fixed MiniLM retrieval catalog is unavailable.");
  });
  return catalog;
}
