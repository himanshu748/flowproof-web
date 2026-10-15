import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { HOSTED_WEBSITE_BRIEF } from "../shared/hosted-target.js";
import {
  generateGoogleGemmaProposal,
  GoogleGemmaError,
  serializeGoogleGemmaFailure,
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

/** Callbacks are trusted test code, never selected by stdin or environment. */
export async function executeGemmaWorkflow(
  requirements: string[],
  generate: (
    requirements: string[],
  ) => Promise<GoogleGemmaProposalResult> = generateGoogleGemmaProposal,
  options: {
    captureEnvelope?: (envelope: unknown) => Promise<void> | void;
  } = {},
): Promise<PublicGemmaWorkflowResult> {
  const input = PublicGemmaInputSchema.parse({ requirements });
  // Disabled mode never resolves the Sentry SDK, even inside this child.
  const confirmedAt = Date.parse(
    process.env.FLOWPROOF_SENTRY_FREE_CONFIRMED_AT ?? "",
  );
  const age = Date.now() - confirmedAt;
  const hostedTelemetry =
    process.env.FLOWPROOF_SENTRY_ENABLED === "true" &&
    process.env.FLOWPROOF_SENTRY_FREE_CONFIRMED === "true" &&
    Boolean(process.env.SENTRY_DSN) &&
    Number.isFinite(age) &&
    age >= 0 &&
    age <= 24 * 60 * 60 * 1000;
  const observability =
    options.captureEnvelope || hostedTelemetry
      ? await import("./observability.js")
      : undefined;
  const telemetryStatus = observability?.initObservability({
    captureEnvelope: options.captureEnvelope,
    maxEnvelopes: 3,
  });
  const traced = <T>(
    name:
      | "briefstamp.proposal"
      | "briefstamp.proposal.generate"
      | "briefstamp.proposal.validate",
    task: () => Promise<T>,
  ): Promise<T> =>
    observability
      ? observability.traceOperation(
          name,
          {
            target:
              input.requirements.join("\n") === HOSTED_WEBSITE_BRIEF
                ? "website"
                : "sample",
            checkCount: input.requirements.length,
          },
          task,
        )
      : task();

  // Opt out before either SDK module is imported; no registry, store or exporter.
  process.env.MASTRA_TELEMETRY_DISABLED = "1";
  let traceId: string | undefined;
  let flushed = false;
  let result: PublicGemmaWorkflowResult;
  let providerFailure: ReturnType<typeof serializeGoogleGemmaFailure> = null;
  try {
    result = await traced("briefstamp.proposal", async () => {
      traceId = observability?.currentTraceContext()?.traceId;
      const [{ createWorkflow, createStep }, { createTool }] =
        await Promise.all([
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
        execute: async ({ requirements }) =>
          traced("briefstamp.proposal.generate", async () => {
            let output: GoogleGemmaProposalResult;
            try {
              output = await generate(requirements);
            } catch (error) {
              providerFailure = serializeGoogleGemmaFailure(error);
              // SDK errors must not acquire raw provider diagnostics.
              if (providerFailure)
                throw new Error("Gemma provider request failed.");
              throw error;
            }
            steps.push(PUBLIC_GEMMA_STEPS[0]);
            return output;
          }),
      });
      const validate = createStep({
        id: PUBLIC_GEMMA_STEPS[1],
        retries: 0,
        inputSchema: PublicGemmaProposalSchema,
        outputSchema: PublicGemmaProposalSchema,
        execute: async ({ inputData }) =>
          traced("briefstamp.proposal.validate", async () => {
            const output = validateIndexedGemmaProposal(
              inputData,
              input.requirements.length,
            );
            steps.push(PUBLIC_GEMMA_STEPS[1]);
            return output;
          }),
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
      let outcome: Awaited<ReturnType<typeof run.start>>;
      try {
        outcome = await run.start({ inputData: input });
      } catch (error) {
        if (providerFailure)
          throw new GoogleGemmaError(
            providerFailure.code,
            "Gemma provider request failed.",
            providerFailure.attempts,
          );
        throw error;
      }
      if (
        outcome.status !== "success" ||
        JSON.stringify(steps) !== JSON.stringify(PUBLIC_GEMMA_STEPS)
      ) {
        if (providerFailure)
          throw new GoogleGemmaError(
            providerFailure.code,
            "Gemma provider request failed.",
            providerFailure.attempts,
          );
        throw new Error(
          "The isolated Gemma workflow did not complete both steps.",
        );
      }
      return {
        ...validateIndexedGemmaProposal(
          outcome.result,
          input.requirements.length,
        ),
        orchestration: {
          provider: "Mastra",
          workflowId: PUBLIC_GEMMA_WORKFLOW_ID,
          runId: run.runId,
          steps: [...PUBLIC_GEMMA_STEPS],
          // Node/libuv normalizes maxRSS to KiB, including on macOS.
          maxRssMiB:
            Math.ceil((process.resourceUsage().maxRSS / 1024) * 100) / 100,
        },
      };
    });
  } finally {
    // The root span has ended before flushing, including on failed generation.
    if (observability) flushed = await observability.flushObservability();
  }
  if (traceId && telemetryStatus && telemetryStatus.mode !== "disabled") {
    result.orchestration.telemetry = {
      provider: "Sentry",
      mode: telemetryStatus.mode,
      traceId,
      flushed,
      ingestionVerified: false,
    };
    result.orchestration.maxRssMiB =
      Math.ceil((process.resourceUsage().maxRSS / 1024) * 100) / 100;
  }
  return result;
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
  main().catch((error) => {
    const failure = serializeGoogleGemmaFailure(error);
    process.stdout.write(
      JSON.stringify(
        failure
          ? { ok: false, failure }
          : {
              ok: false,
              error: "The isolated Gemma workflow failed.",
            },
      ),
      () => process.exit(1),
    );
  });
