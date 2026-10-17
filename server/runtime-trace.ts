import { AsyncLocalStorage } from "node:async_hooks";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { hostedSentryAvailable } from "./sentry-configuration.js";

// This module is intentionally SDK-free while Chromium or a provider is active.
export const runtimeOperations = [
  "briefstamp.audit",
  "briefstamp.audit.browser",
  "briefstamp.agent",
  "briefstamp.agent.model.select_tools",
  "briefstamp.agent.model.summarize",
  "briefstamp.agent.tool.failure_history",
  "briefstamp.agent.tool.search_visibility",
] as const;
export type RuntimeOperation = (typeof runtimeOperations)[number];
export type RuntimeRootOperation = "briefstamp.audit" | "briefstamp.agent";
export interface SafeRuntimeAttributes {
  checkCount?: number;
  passed?: number;
  failed?: number;
  blocked?: number;
  unverified?: number;
  target?: "sample" | "website";
  provider?: "Google" | "Backboard";
  tool?: "failure_history" | "search_visibility";
  model?: "gemma-4-26b-a4b-it" | "google/gemma-4-26b-a4b-it";
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  modelLatencyMs?: number;
  outcome?: "completed" | "failed" | "blocked" | "unverified";
}
const count = z.number().int().min(0).max(24);
export const SafeRuntimeAttributesSchema = z
  .object({
    checkCount: count.optional(),
    passed: count.optional(),
    failed: count.optional(),
    blocked: count.optional(),
    unverified: count.optional(),
    target: z.enum(["sample", "website"]).optional(),
    provider: z.enum(["Google", "Backboard"]).optional(),
    tool: z.enum(["failure_history", "search_visibility"]).optional(),
    model: z
      .enum(["gemma-4-26b-a4b-it", "google/gemma-4-26b-a4b-it"])
      .optional(),
    inputTokens: z.number().int().min(0).max(262_144).optional(),
    outputTokens: z.number().int().min(0).max(262_144).optional(),
    totalTokens: z.number().int().min(0).max(524_288).optional(),
    modelLatencyMs: z.number().finite().min(0).max(120_000).optional(),
    outcome: z
      .enum(["completed", "failed", "blocked", "unverified"])
      .optional(),
  })
  .strict();
/** Unknown fields, null usage, arbitrary model names and private text are omitted. */
export function sanitizeRuntimeAttributes(
  input: unknown,
): z.infer<typeof SafeRuntimeAttributesSchema> {
  const output: Record<string, unknown> = {};
  try {
    if (typeof input !== "object" || input === null || Array.isArray(input))
      return output;
  } catch {
    return output;
  }
  for (const [key, schema] of Object.entries(
    SafeRuntimeAttributesSchema.shape,
  )) {
    try {
      const source = input as Record<string, unknown>;
      const value = source[key] ?? source[`briefstamp.${key}`];
      if (value === null || value === undefined) continue;
      const parsed = schema.safeParse(value);
      if (parsed.success) output[key] = parsed.data;
    } catch {
      /* A telemetry getter cannot affect the observed operation. */
    }
  }
  return output;
}
export function runtimeSdkAttributes(
  input: unknown,
): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(sanitizeRuntimeAttributes(input)).map(([key, value]) => [
      `briefstamp.${key}`,
      value,
    ]),
  ) as Record<string, string | number>;
}
const time = z.number().finite().min(0).max(8_640_000_000_000_000);
const spanSchema = z
  .object({
    index: z.number().int().min(1).max(16),
    parentIndex: z.number().int().min(0).max(15),
    operation: z.enum(runtimeOperations),
    startedAtMs: time,
    endedAtMs: time,
    status: z.enum(["ok", "error"]),
    attributes: SafeRuntimeAttributesSchema,
  })
  .strict();
export const RuntimeTraceMeasurementSchema = z
  .object({
    version: z.literal(1),
    operation: z.enum(["briefstamp.audit", "briefstamp.agent"]),
    startedAtMs: time,
    endedAtMs: time,
    status: z.enum(["ok", "error"]),
    attributes: SafeRuntimeAttributesSchema,
    spans: z.array(spanSchema).max(16),
    complete: z.boolean(),
  })
  .strict()
  .superRefine((trace, context) => {
    if (
      trace.endedAtMs < trace.startedAtMs ||
      trace.endedAtMs - trace.startedAtMs > 300_000
    )
      context.addIssue({
        code: "custom",
        message: "Invalid observed trace interval.",
      });
    const seen = new Map<number, { startedAtMs: number; endedAtMs: number }>([
      [0, trace],
    ]);
    for (const span of trace.spans) {
      const parent = seen.get(span.parentIndex);
      if (
        !parent ||
        seen.has(span.index) ||
        span.parentIndex >= span.index ||
        span.startedAtMs < parent.startedAtMs ||
        span.endedAtMs > parent.endedAtMs ||
        span.endedAtMs < span.startedAtMs ||
        !span.operation.startsWith(`${trace.operation}.`)
      )
        context.addIssue({
          code: "custom",
          message: "Invalid observed span relationship.",
        });
      seen.set(span.index, span);
    }
  });
export type RuntimeTraceMeasurement = z.infer<
  typeof RuntimeTraceMeasurementSchema
>;
export interface RuntimeTraceRecorder {
  span<T>(
    operation: RuntimeOperation,
    task: () => Promise<T>,
    attributes?: SafeRuntimeAttributes | ((result: T) => SafeRuntimeAttributes),
  ): Promise<T>;
  finish(attributes?: SafeRuntimeAttributes): RuntimeTraceMeasurement;
}
/** Measures the real task exactly once; telemetry never replaces its result/error. */
export function createRuntimeTrace(
  operation: RuntimeRootOperation,
  attributes: SafeRuntimeAttributes = {},
  now: () => number = Date.now,
): RuntimeTraceRecorder {
  const clock = () => {
    try {
      const value = now();
      if (Number.isFinite(value) && value >= 0) return value;
    } catch {}
    return Date.now();
  };
  const startedAtMs = clock();
  const context = new AsyncLocalStorage<number>();
  const spans: RuntimeTraceMeasurement["spans"] = [];
  let sequence = 0,
    active = 0,
    failed = false,
    ended = false,
    truncated = false;
  let measurement: RuntimeTraceMeasurement | undefined;
  return {
    async span<T>(
      name: RuntimeOperation,
      task: () => Promise<T>,
      attrs?: SafeRuntimeAttributes | ((result: T) => SafeRuntimeAttributes),
    ): Promise<T> {
      if (ended) return task();
      if (
        sequence >= 16 ||
        !runtimeOperations.includes(name) ||
        !name.startsWith(`${operation}.`)
      ) {
        truncated = true;
        return task();
      }
      const index = ++sequence,
        parentIndex = context.getStore() ?? 0,
        start = clock();
      active++;
      let status: "ok" | "error" = "ok";
      let safe =
        typeof attrs === "function" ? {} : sanitizeRuntimeAttributes(attrs);
      try {
        const result = await context.run(index, task);
        try {
          safe = sanitizeRuntimeAttributes(
            typeof attrs === "function" ? attrs(result) : attrs,
          );
        } catch {}
        return result;
      } catch (error) {
        status = "error";
        failed = true;
        if (typeof attrs !== "function")
          safe = sanitizeRuntimeAttributes(attrs);
        throw error;
      } finally {
        const end = clock();
        active--;
        spans.push({
          index,
          parentIndex,
          operation: name,
          startedAtMs: start,
          endedAtMs: end,
          status,
          attributes: safe,
        });
      }
    },
    finish(extra = {}) {
      if (!measurement) {
        ended = true;
        const finalAttributes = {
          ...sanitizeRuntimeAttributes(attributes),
          ...sanitizeRuntimeAttributes(extra),
        };
        measurement = {
          version: 1,
          operation,
          startedAtMs,
          endedAtMs: clock(),
          status:
            failed || finalAttributes.outcome === "failed" ? "error" : "ok",
          attributes: finalAttributes,
          spans: structuredClone(spans.sort((a, b) => a.index - b.index)),
          complete: active === 0 && !truncated && sequence === spans.length,
        };
      }
      return structuredClone(measurement);
    },
  };
}

export function runtimeTraceHash(measurement: RuntimeTraceMeasurement): string {
  const parsed = RuntimeTraceMeasurementSchema.parse(measurement);
  return createHash("sha256").update(JSON.stringify(parsed)).digest("hex");
}
export interface RuntimeTraceReservation {
  operation: "runtime_trace";
  measurementSha256: string;
  units: 1;
  maxEnvelopes: 2;
}
export const RuntimeTraceReceiptSchema = z
  .object({
    provider: z.literal("Sentry"),
    mode: z.enum(["hosted_configured", "local_capture"]),
    traceId: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .refine((value) => !/^0+$/.test(value)),
    flushed: z.boolean(),
    ingestionVerified: z.literal(false),
    measurementSha256: z.string().regex(/^[a-f0-9]{64}$/),
    maxEnvelopes: z.literal(2),
    maxRssMiB: z.number().finite().positive().max(2048),
  })
  .strict();
export type RuntimeTraceReceipt = z.infer<typeof RuntimeTraceReceiptSchema>;
const prefixedAttributes = z
  .object(
    Object.fromEntries(
      Object.entries(SafeRuntimeAttributesSchema.shape).map(([key, schema]) => [
        `briefstamp.${key}`,
        schema,
      ]),
    ),
  )
  .strict();
const sdkTrace = z
  .object({
    trace_id: z.string().regex(/^[a-f0-9]{32}$/),
    span_id: z.string().regex(/^[a-f0-9]{16}$/),
    parent_span_id: z
      .string()
      .regex(/^[a-f0-9]{16}$/)
      .optional(),
    op: z.enum(runtimeOperations),
    status: z.enum(["ok", "unknown_error"]),
    data: prefixedAttributes,
  })
  .strict();
const capturedTransaction = z
  .object({
    event_id: z
      .string()
      .regex(/^[a-f0-9]{32}$/)
      .optional(),
    timestamp: z.number().finite().nonnegative(),
    start_timestamp: z.number().finite().nonnegative(),
    platform: z.literal("node"),
    environment: z.literal("briefstamp"),
    tags: z.object({ operation: z.enum(runtimeOperations) }).strict(),
    contexts: z.object({ trace: sdkTrace }).strict(),
    type: z.literal("transaction"),
    transaction: z.enum(runtimeOperations),
    spans: z
      .array(
        sdkTrace
          .extend({
            description: z.enum(runtimeOperations),
            start_timestamp: z.number().finite().nonnegative(),
            timestamp: z.number().finite().nonnegative(),
          })
          .strict(),
      )
      .max(16),
  })
  .strict();
const captureEnvelopeSchema = z.tuple([
  z
    .object({
      sent_at: z.string().datetime(),
      event_id: z
        .string()
        .regex(/^[a-f0-9]{32}$/)
        .optional(),
    })
    .strict(),
  z
    .array(
      z.tuple([
        z.object({ type: z.literal("transaction") }).strict(),
        capturedTransaction,
      ]),
    )
    .max(1),
]);
export const RuntimeTraceWorkerInputSchema = z
  .object({
    version: z.literal(1),
    measurement: RuntimeTraceMeasurementSchema,
    measurementSha256: z.string().regex(/^[a-f0-9]{64}$/),
    mode: z.enum(["hosted_configured", "local_capture"]),
    reservation: z
      .object({ units: z.literal(1), maxEnvelopes: z.literal(2) })
      .strict(),
  })
  .strict()
  .refine(
    (input) =>
      input.measurement.complete &&
      runtimeTraceHash(input.measurement) === input.measurementSha256,
  );
export const RuntimeTraceWorkerOutputSchema = z
  .object({
    ok: z.literal(true),
    receipt: RuntimeTraceReceiptSchema,
    envelopes: z.array(captureEnvelopeSchema).max(2).optional(),
  })
  .strict();
export function runtimeTraceChildEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "TMPDIR",
    "TMP",
    "TEMP",
    "LANG",
    "LC_ALL",
    "TZ",
    "SYSTEMROOT",
    "WINDIR",
    "SENTRY_DSN",
    "FLOWPROOF_SENTRY_ENABLED",
    "FLOWPROOF_SENTRY_FREE_CONFIRMED",
    "FLOWPROOF_SENTRY_FREE_CONFIRMED_AT",
  ])
    if (env[key] !== undefined) result[key] = env[key];
  result.NODE_ENV = "production";
  result.MASTRA_TELEMETRY_DISABLED = "1";
  return result;
}
const WORKER = fileURLToPath(
  new URL("../dist-trace-worker/runtime-trace-child.js", import.meta.url),
);
const exportsAttempted = new Set<string>();
/** Reserved once before spawning. A failure consumes its attempt; no retry/refund. */
export async function exportRuntimeTrace(
  measurement: RuntimeTraceMeasurement,
  options: {
    reserve: (reservation: Readonly<RuntimeTraceReservation>) => Promise<void>;
    env?: NodeJS.ProcessEnv;
    captureEnvelope?: (envelope: unknown) => void | Promise<void>;
  },
): Promise<RuntimeTraceReceipt> {
  const parsed = RuntimeTraceMeasurementSchema.parse(measurement);
  const env = options?.env ?? process.env;
  const local = typeof options?.captureEnvelope === "function";
  if (
    !parsed.complete ||
    typeof options?.reserve !== "function" ||
    (!local && !hostedSentryAvailable(env))
  )
    throw new Error("Runtime telemetry export is unavailable.");
  const measurementSha256 = runtimeTraceHash(parsed);
  if (exportsAttempted.has(measurementSha256) || exportsAttempted.size >= 128)
    throw new Error(
      "Runtime telemetry export was already attempted or is unavailable.",
    );
  exportsAttempted.add(measurementSha256);
  let reservationDeadline: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      options.reserve(
        Object.freeze({
          operation: "runtime_trace",
          measurementSha256,
          units: 1,
          maxEnvelopes: 2,
        }),
      ),
      new Promise<never>((_, reject) => {
        reservationDeadline = setTimeout(
          () => reject(new Error("Runtime telemetry reservation timed out.")),
          10_000,
        );
        reservationDeadline.unref();
      }),
    ]);
  } finally {
    if (reservationDeadline) clearTimeout(reservationDeadline);
  }
  if (!local && !hostedSentryAvailable(env))
    throw new Error("Runtime telemetry funding confirmation expired.");
  const input = RuntimeTraceWorkerInputSchema.parse({
    version: 1,
    measurement: parsed,
    measurementSha256,
    mode: local ? "local_capture" : "hosted_configured",
    reservation: { units: 1, maxEnvelopes: 2 },
  });
  const serialized = JSON.stringify(input);
  if (Buffer.byteLength(serialized) > 24 * 1024)
    throw new Error("Runtime telemetry input exceeds its limit.");
  const result = await new Promise<
    z.infer<typeof RuntimeTraceWorkerOutputSchema>
  >((resolve, reject) => {
    const child = spawn(process.execPath, ["--max-old-space-size=96", WORKER], {
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: runtimeTraceChildEnvironment(env),
    });
    const chunks: Buffer[] = [];
    let outputBytes = 0,
      diagnosticBytes = 0,
      failed = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      failed = true;
      if (killTimer) return;
      child.kill("SIGTERM");
      killTimer = setTimeout(() => child.kill("SIGKILL"), 500);
      killTimer.unref();
    };
    const deadline = setTimeout(stop, 15_000);
    deadline.unref();
    child.on("error", stop);
    child.stdout.on("data", (chunk: Buffer) => {
      outputBytes += chunk.length;
      if (outputBytes > 96 * 1024) stop();
      else if (!failed) chunks.push(Buffer.from(chunk));
    });
    child.stderr.on("data", (chunk: Buffer) => {
      diagnosticBytes += chunk.length;
      if (diagnosticBytes > 8 * 1024) stop();
    });
    child.stdin.on("error", stop);
    child.once("close", (code, signal) => {
      clearTimeout(deadline);
      if (killTimer) clearTimeout(killTimer);
      try {
        if (failed || signal || code !== 0) throw new Error();
        const value = RuntimeTraceWorkerOutputSchema.parse(
          JSON.parse(Buffer.concat(chunks).toString("utf8")),
        );
        if (
          value.receipt.measurementSha256 !== measurementSha256 ||
          value.receipt.mode !== input.mode ||
          (!local && value.envelopes !== undefined)
        )
          throw new Error();
        resolve(value);
      } catch {
        reject(new Error("The isolated runtime telemetry export failed."));
      }
    });
    child.stdin.end(serialized);
  });
  if (options.captureEnvelope)
    for (const envelope of result.envelopes ?? [])
      await options.captureEnvelope(envelope);
  return result.receipt;
}
