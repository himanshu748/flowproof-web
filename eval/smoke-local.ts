import fs from "node:fs";
import { generateChecks } from "../server/generator";
import { summarizeAudit } from "../server/gemma";
if (
  process.env.FLOWPROOF_AI_ENABLED !== "true" ||
  process.env.FLOWPROOF_GEMMA_ENABLED !== "true"
)
  throw new Error(
    "Explicitly enable local AI generation and Gemma suggestions to run this smoke test.",
  );
fs.mkdirSync("work", { recursive: true });
const before = Date.now();
const generated = await generateChecks(
  'The homepage must show "Independent by design."',
);
fs.writeFileSync(
  "work/gemma-generation-receipt.json",
  JSON.stringify(
    {
      recordedAt: new Date().toISOString(),
      source:
        "Single synthetic requirement adapter smoke test; not an accuracy benchmark",
      durationMs: Date.now() - before,
      ...generated,
    },
    null,
    2,
  ),
);
if (generated.generator.provider !== "Ollama (local)")
  throw new Error(
    "Local model generation fell back; no AI integration success is claimed.",
  );
console.log(
  JSON.stringify({
    event: "generation",
    provider: generated.generator.provider,
    model: generated.generator.model,
    kinds: generated.checks.map((check) => check.kind),
    durationMs: Date.now() - before,
  }),
);
const audit = JSON.parse(
  fs.readFileSync("work/sample-audit/broken.json", "utf8"),
);
const summaryBefore = Date.now();
const summary = await summarizeAudit(audit);
if (!summary)
  throw new Error(
    "Local explanation was unavailable; no AI explanation success is claimed.",
  );
if (summary)
  fs.writeFileSync(
    "work/gemma-summary-receipt.json",
    JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        provider: "Ollama (local)",
        model: "gemma3:4b",
        auditId: audit.id,
        source: "work/sample-audit/broken.json",
        summary,
        durationMs: Date.now() - summaryBefore,
      },
      null,
      2,
    ),
  );
console.log(
  JSON.stringify({
    event: "summary",
    summary: summary ?? null,
    durationMs: Date.now() - summaryBefore,
  }),
);
