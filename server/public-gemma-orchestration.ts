import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { isSafePath } from "./schema.js";
import { GOOGLE_GEMMA_MODEL } from "./providers/gemma-google.js";

export const PUBLIC_GEMMA_WORKFLOW_ID = "briefstamp-public-gemma";
export const PUBLIC_GEMMA_STEPS = [
  "generate-google-gemma",
  "validate-indexed-proposal",
] as const;
export const PUBLIC_GEMMA_INPUT_LIMIT = 24 * 1024;
const OUTPUT_LIMIT = 64 * 1024;
const STDERR_LIMIT = 8 * 1024;
const WORKER_PATH = fileURLToPath(
  new URL("../dist-worker/gemma-workflow-child.js", import.meta.url),
);

export const PublicGemmaInputSchema = z
  .object({
    requirements: z.array(z.string().trim().min(1).max(2000)).min(1).max(6),
  })
  .strict()
  .refine(
    ({ requirements }) =>
      requirements.reduce((sum, text) => sum + text.length, 0) <= 6000,
  );
const checkSchema = z
  .object({
    requirementIndex: z.number().int().min(0).max(5),
    kind: z.enum([
      "heading",
      "text_visible",
      "link",
      "image_alt",
      "no_horizontal_overflow",
      "manual",
    ]),
    path: z.string().max(300).refine(isSafePath),
    expected: z.string().max(1000),
    viewport: z.enum(["desktop", "mobile"]),
  })
  .strict()
  .refine(
    (check) =>
      !["heading", "text_visible", "link"].includes(check.kind) ||
      check.expected.trim().length > 0,
  );
export const PublicGemmaProposalSchema = z
  .object({
    checks: z.array(checkSchema).min(1).max(6),
    model: z.literal(GOOGLE_GEMMA_MODEL),
    usage: z
      .object({
        promptTokens: z.number().int().nonnegative().max(32_000),
        completionTokens: z.number().int().nonnegative().max(1800),
        totalTokens: z.number().int().nonnegative().max(33_800),
      })
      .strict()
      .refine(
        (usage) =>
          usage.totalTokens >= usage.promptTokens + usage.completionTokens,
      )
      .nullable(),
    latencyMs: z.number().finite().nonnegative().max(45_000),
    transportNormalization: z
      .object({
        emptyThoughtPartIgnored: z.boolean(),
        wholeJsonFenceRemoved: z.boolean(),
      })
      .strict()
      .optional(),
  })
  .strict();
const workflowResultSchema = PublicGemmaProposalSchema.extend({
  orchestration: z
    .object({
      provider: z.literal("Mastra"),
      workflowId: z.literal(PUBLIC_GEMMA_WORKFLOW_ID),
      runId: z.string().uuid(),
      steps: z.tuple([
        z.literal(PUBLIC_GEMMA_STEPS[0]),
        z.literal(PUBLIC_GEMMA_STEPS[1]),
      ]),
      maxRssMiB: z.number().finite().positive().max(2048),
      telemetry: z
        .object({
          provider: z.literal("Sentry"),
          mode: z.enum(["hosted_configured", "local_capture"]),
          traceId: z
            .string()
            .regex(/^[a-f0-9]{32}$/)
            .refine((value) => !/^0+$/.test(value)),
          flushed: z.boolean(),
          ingestionVerified: z.literal(false),
        })
        .strict()
        .optional(),
    })
    .strict(),
}).strict();
export type PublicGemmaWorkflowResult = z.infer<typeof workflowResultSchema>;

export function validateIndexedGemmaProposal(
  value: unknown,
  requirementCount: number,
) {
  const parsed = PublicGemmaProposalSchema.parse(value);
  if (
    parsed.checks.length !== requirementCount ||
    parsed.checks.some((check, index) => check.requirementIndex !== index)
  )
    throw new Error("The workflow proposal does not match its input indices.");
  return parsed;
}

/** No inherited loader, proxy, TLS override or unrelated credentials. */
export function publicGemmaChildEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const name of [
    "PATH",
    "HOME",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TZ",
    "SYSTEMROOT",
    "WINDIR",
    "BRIEFSTAMP_PUBLIC_GEMMA_ENABLED",
    "BRIEFSTAMP_GEMMA_CONFIRMED_FREE",
    "BRIEFSTAMP_GEMMA_FREE_UNTIL",
    "GOOGLE_GEMMA_API_KEY",
    "SENTRY_DSN",
    "FLOWPROOF_SENTRY_ENABLED",
    "FLOWPROOF_SENTRY_FREE_CONFIRMED",
    "FLOWPROOF_SENTRY_FREE_CONFIRMED_AT",
  ])
    if (env[name] !== undefined) result[name] = env[name];
  result.NODE_ENV = "production";
  result.MASTRA_TELEMETRY_DISABLED = "1";
  return result;
}

/** Only resolves after the isolated workflow process and all its pipes close. */
export async function runPublicGemmaWorkflow(
  requirements: string[],
): Promise<PublicGemmaWorkflowResult> {
  const input = PublicGemmaInputSchema.parse({ requirements });
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized) > PUBLIC_GEMMA_INPUT_LIMIT)
    throw new Error("The public workflow input exceeds its byte limit.");
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["--max-old-space-size=192", WORKER_PATH],
      {
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        env: publicGemmaChildEnvironment(),
      },
    );
    const chunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let failure: string | undefined;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = (message: string) => {
      failure ??= message;
      if (killTimer) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 1000);
      killTimer.unref();
    };
    const deadline = setTimeout(
      () => stop("The isolated Gemma workflow exceeded its time limit."),
      45_000,
    );
    deadline.unref();
    child.on("error", () =>
      stop("The isolated Gemma workflow could not start."),
    );
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > OUTPUT_LIMIT)
        stop("The isolated Gemma workflow exceeded its output limit.");
      else if (!failure) chunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      // Drain but never retain or echo SDK/provider diagnostics.
      stderrBytes += chunk.length;
      if (stderrBytes > STDERR_LIMIT)
        stop("The isolated Gemma workflow exceeded its diagnostic limit.");
    });
    child.stdin.on("error", () =>
      stop("The isolated Gemma workflow could not receive its input."),
    );
    child.once("close", (code, signal) => {
      clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      if (failure || code !== 0 || signal) {
        reject(new Error(failure ?? "The isolated Gemma workflow failed."));
        return;
      }
      try {
        const envelope = z
          .object({ ok: z.literal(true), result: workflowResultSchema })
          .strict()
          .parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        validateIndexedGemmaProposal(
          (({ orchestration: _receipt, ...proposal }) => proposal)(
            envelope.result,
          ),
          input.requirements.length,
        );
        resolve(envelope.result);
      } catch {
        reject(
          new Error("The isolated Gemma workflow returned an invalid result."),
        );
      }
    });
    child.stdin.end(serialized);
  });
}
