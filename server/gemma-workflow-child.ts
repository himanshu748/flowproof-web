import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  generateGoogleGemmaProposal,
  type GoogleGemmaProposalResult,
} from "./providers/gemma-google.js";
import {
  PUBLIC_GEMMA_INPUT_LIMIT,
  PUBLIC_GEMMA_STEPS,
  PUBLIC_GEMMA_WORKFLOW_ID,
  PublicGemmaInputSchema,
  PublicGemmaProposalSchema,
  validateIndexedGemmaProposal,
  type PublicGemmaWorkflowResult,
} from "./public-gemma-orchestration.js";

/** The optional callback is trusted code for offline tests, never stdin/env data. */
export async function executeGemmaWorkflow(
  requirements: string[],
  generate: (
    requirements: string[],
  ) => Promise<GoogleGemmaProposalResult> = generateGoogleGemmaProposal,
): Promise<PublicGemmaWorkflowResult> {
  const input = PublicGemmaInputSchema.parse({ requirements });
  // Opt out before either SDK module is imported; no registry, store or exporter.
  process.env.MASTRA_TELEMETRY_DISABLED = "1";
  const [{ createWorkflow, createStep }, { createTool }] = await Promise.all([
    import("@mastra/core/workflows"),
    import("@mastra/core/tools"),
  ]);
  const steps: string[] = [];
  const tool = createTool({
    id: PUBLIC_GEMMA_STEPS[0],
    description:
      "Generate a bounded unapproved proposal using the fixed Google Gemma model.",
    inputSchema: PublicGemmaInputSchema,
    outputSchema: PublicGemmaProposalSchema,
    execute: async ({ requirements }) => {
      const output = await generate(requirements);
      steps.push(PUBLIC_GEMMA_STEPS[0]);
      return output;
    },
  });
  const validate = createStep({
    id: PUBLIC_GEMMA_STEPS[1],
    retries: 0,
    inputSchema: PublicGemmaProposalSchema,
    outputSchema: PublicGemmaProposalSchema,
    execute: async ({ inputData }) => {
      const output = validateIndexedGemmaProposal(
        inputData,
        input.requirements.length,
      );
      steps.push(PUBLIC_GEMMA_STEPS[1]);
      return output;
    },
  });
  const workflow = createWorkflow({
    id: PUBLIC_GEMMA_WORKFLOW_ID,
    retryConfig: { attempts: 0, delay: 0 },
    inputSchema: PublicGemmaInputSchema,
    outputSchema: PublicGemmaProposalSchema,
  })
    .then(createStep(tool, { retries: 0 }))
    .then(validate)
    .commit();
  const run = await workflow.createRun();
  const outcome = await run.start({ inputData: input });
  if (
    outcome.status !== "success" ||
    JSON.stringify(steps) !== JSON.stringify(PUBLIC_GEMMA_STEPS)
  )
    throw new Error("The isolated Gemma workflow did not complete both steps.");
  return {
    ...validateIndexedGemmaProposal(outcome.result, input.requirements.length),
    orchestration: {
      provider: "Mastra",
      workflowId: PUBLIC_GEMMA_WORKFLOW_ID,
      runId: run.runId,
      steps: [...PUBLIC_GEMMA_STEPS],
      // Node/libuv normalizes maxRSS to KiB, including on macOS.
      maxRssMiB: Math.ceil((process.resourceUsage().maxRSS / 1024) * 100) / 100,
    },
  };
}

async function main() {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > PUBLIC_GEMMA_INPUT_LIMIT)
      throw new Error("Workflow input is too large.");
    chunks.push(bytes);
  }
  const input = PublicGemmaInputSchema.parse(
    JSON.parse(Buffer.concat(chunks).toString("utf8")),
  );
  // Production always selects the actual provider; no fixture selector exists.
  const result = await executeGemmaWorkflow(input.requirements);
  process.stdout.write(JSON.stringify({ ok: true, result }), () =>
    process.exit(0),
  );
}

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain)
  main().catch(() => {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        error: "The isolated Gemma workflow failed.",
      }),
      () => process.exit(1),
    );
  });
