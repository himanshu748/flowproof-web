import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { embed } from "../server/embeddings.js";
import type { Audit } from "../shared/types.js";

// Run only against a real local synthetic audit, using the already-installed
// loopback MiniLM model. No provider key, hosted embedding call or model download.
const auditFile = process.argv[2];
assert(
  auditFile,
  "Pass the real broken-audit.json produced by verify-public-runtime.mjs",
);
const bytes = await readFile(auditFile);
const audit: Audit = JSON.parse(bytes.toString("utf8"));
assert.equal(audit.status, "completed");
assert.equal(audit.source?.target, "sample");
assert.equal(audit.source.sampleVariant, "broken");
const failures = audit.results.filter((row) => row.status === "failed");
assert(failures.length > 0);
const tags = await fetch("http://127.0.0.1:11434/api/tags", {
  signal: AbortSignal.timeout(5000),
}).then((r) => r.json());
const model = tags.models.find(
  (row: { name: string }) => row.name === "all-minilm:22m",
);
assert.match(model?.digest || "", /^[a-f0-9]{64}$/);
process.env.FLOWPROOF_EMBEDDINGS = "true";
process.env.FLOWPROOF_EMBEDDING_MODEL = "all-minilm:22m";
process.env.OLLAMA_URL = "http://127.0.0.1:11434";
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
async function vector(text: string) {
  const value = await embed(text);
  assert(
    value && value.length === 384,
    "Local MiniLM inference did not return 384 finite coordinates",
  );
  return value;
}
const documents = [];
for (const row of failures) {
  const text = `${row.requirement}\n${row.evidence.observed}`;
  documents.push({ textSha256: hash(text), text, vector: await vector(text) });
}
const queries = [];
for (const [id, text] of [
  ["mobile_paraphrase", "sideways panning on smartphones"],
  ["images", "pictures without accessible descriptions"],
  ["contact", "customer contact navigation link"],
] as const)
  queries.push({ id, text, vector: await vector(text) });
const catalogue = {
  version: 1,
  model: "all-minilm:22m",
  dimensions: 384,
  documents,
  queries,
  provenance: {
    modelDigest: model.digest,
    generatedAt: new Date().toISOString(),
    source: `Real local Chromium broken synthetic audit; source JSON SHA-256 ${hash(bytes)}. Precomputed fixed-query demonstration; exact text hashes only; no hosted embedding inference.`,
  },
};
await writeFile(
  "shared/agent-retrieval-vectors.json",
  `${JSON.stringify(catalogue, null, 2)}\n`,
);
console.log(
  JSON.stringify({
    documents: documents.length,
    queries: queries.length,
    model: model.name,
    modelDigest: model.digest,
    catalogSha256: hash(JSON.stringify(catalogue)),
    sourceAuditSha256: hash(bytes),
  }),
);
