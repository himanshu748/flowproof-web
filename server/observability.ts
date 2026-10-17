import * as Sentry from "@sentry/node";
import {
  RuntimeTraceMeasurementSchema,
  runtimeSdkAttributes,
  type RuntimeTraceMeasurement,
  type SafeRuntimeAttributes,
} from "./runtime-trace.js";

export const operations = [
  "briefstamp.proposal",
  "briefstamp.proposal.generate",
  "briefstamp.proposal.validate",
  "briefstamp.audit",
  "briefstamp.audit.approval",
  "briefstamp.audit.browser",
  "briefstamp.audit.summary",
  "briefstamp.report",
  "briefstamp.storage",
  "briefstamp.agent",
  "briefstamp.agent.model.select_tools",
  "briefstamp.agent.model.summarize",
  "briefstamp.agent.tool.failure_history",
  "briefstamp.agent.tool.search_visibility",
] as const;
export type Operation = (typeof operations)[number];
export interface SafeTelemetryAttributes extends SafeRuntimeAttributes {}

type JsonRecord = Record<string, unknown>;
type SafeEnvelope = [JsonRecord, [JsonRecord, JsonRecord][]];
export interface ObservabilityStatus {
  mode: "disabled" | "local_capture" | "hosted_configured";
  hostedVerified: false;
  maxEnvelopes: number;
}
let current: ObservabilityStatus = {
  mode: "disabled",
  hostedVerified: false,
  maxEnvelopes: 0,
};
const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const operation = (value: unknown): Operation =>
  operations.includes(value as Operation)
    ? (value as Operation)
    : "briefstamp.audit";
const id = (value: unknown, length: number) =>
  typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(value)
    ? value
    : undefined;
const number = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

function attributes(input: SafeTelemetryAttributes | JsonRecord): JsonRecord {
  return runtimeSdkAttributes(input);
}

function trace(input: unknown): JsonRecord | undefined {
  if (!isRecord(input)) return undefined;
  const traceId = id(input.trace_id, 32);
  const spanId = id(input.span_id, 16);
  if (!traceId || !spanId) return undefined;
  return {
    trace_id: traceId,
    span_id: spanId,
    ...(id(input.parent_span_id, 16)
      ? { parent_span_id: input.parent_span_id }
      : {}),
    op: operation(input.op),
    status: input.status === "ok" ? "ok" : "unknown_error",
    data: attributes(isRecord(input.data) ? input.data : {}),
  };
}

/** An allowlist, not a best-effort regex: client text never enters an envelope. */
export function sanitizeTelemetryEvent(
  input: unknown,
  transaction = false,
): JsonRecord {
  const value = isRecord(input) ? input : {};
  const contexts = isRecord(value.contexts) ? value.contexts : {};
  const safeTrace = trace(contexts.trace);
  const tags = isRecord(value.tags) ? value.tags : {};
  const name = operation(transaction ? value.transaction : tags.operation);
  const event: JsonRecord = {
    ...(id(value.event_id, 32) ? { event_id: value.event_id } : {}),
    timestamp: number(value.timestamp) ?? Date.now() / 1000,
    platform: "node",
    environment: "briefstamp",
    tags: { operation: name },
    ...(safeTrace ? { contexts: { trace: safeTrace } } : {}),
  };
  if (transaction) {
    event.type = "transaction";
    event.transaction = name;
    event.start_timestamp = number(value.start_timestamp) ?? event.timestamp;
    event.spans = (Array.isArray(value.spans) ? value.spans : [])
      .slice(0, 100)
      .flatMap((item) => {
        if (!isRecord(item)) return [];
        const safe = trace(item);
        if (!safe) return [];
        return [
          {
            ...safe,
            description: operation(item.description),
            start_timestamp: number(item.start_timestamp),
            timestamp: number(item.timestamp),
            data: attributes(isRecord(item.data) ? item.data : {}),
          },
        ];
      });
  } else {
    event.level = "error";
    event.message = "Briefstamp operation failed; private details omitted.";
    event.exception = {
      values: [
        {
          type: "BriefstampOperationError",
          value: "Operation failed; private details omitted.",
        },
      ],
    };
    event.fingerprint = ["briefstamp-operation", name];
  }
  return event;
}

/** Final transport boundary also removes attachments, logs, profiles and metadata. */
export function sanitizeTelemetryEnvelope(envelope: unknown): SafeEnvelope {
  if (!Array.isArray(envelope) || !Array.isArray(envelope[1])) return [{}, []];
  const header = isRecord(envelope[0]) ? envelope[0] : {};
  const safeHeader: JsonRecord = { sent_at: new Date().toISOString() };
  if (id(header.event_id, 32)) safeHeader.event_id = header.event_id;
  const items: SafeEnvelope[1] = [];
  for (const item of envelope[1]) {
    if (!Array.isArray(item) || !isRecord(item[0])) continue;
    const type = item[0].type;
    if (type !== "event" && type !== "transaction") continue;
    items.push([
      { type },
      sanitizeTelemetryEvent(item[1], type === "transaction"),
    ]);
  }
  return [safeHeader, items];
}

export function observabilityStatus(): ObservabilityStatus {
  return { ...current };
}

/** Only the active SDK trace identifier may cross the worker boundary. */
export function currentTraceContext(): { traceId: string } | undefined {
  if (current.mode === "disabled") return undefined;
  const traceId = id(Sentry.getActiveSpan()?.spanContext().traceId, 32);
  return traceId && !/^0+$/.test(traceId) ? { traceId } : undefined;
}

/** Local capture is actual SDK transport evidence, never hosted ingestion proof. */
export function initObservability(
  options: {
    captureEnvelope?: (envelope: SafeEnvelope) => Promise<void> | void;
    maxEnvelopes?: number;
  } = {},
): ObservabilityStatus {
  if (current.mode !== "disabled") return observabilityStatus();
  const local = Boolean(options.captureEnvelope);
  const confirmedAt = Date.parse(
    process.env.FLOWPROOF_SENTRY_FREE_CONFIRMED_AT ?? "",
  );
  const confirmationAge = Date.now() - confirmedAt;
  const hosted =
    process.env.FLOWPROOF_SENTRY_ENABLED === "true" &&
    process.env.FLOWPROOF_SENTRY_FREE_CONFIRMED === "true" &&
    Number.isFinite(confirmationAge) &&
    confirmationAge >= 0 &&
    confirmationAge <= 24 * 60 * 60 * 1000;
  if (!local && !hosted) return observabilityStatus();
  const dsn = local
    ? "https://public@briefstamp.invalid/1"
    : process.env.SENTRY_DSN;
  if (!dsn) throw new Error("Sentry is enabled but its DSN is not configured.");
  if (!local) {
    const url = new URL(dsn);
    if (
      url.protocol !== "https:" ||
      !/(?:^|\.)ingest(?:\.[a-z]+)?\.sentry\.io$/.test(url.hostname) ||
      !url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Use an HTTPS Sentry ingestion DSN after confirming the free allowance.",
      );
  }
  const requestedCap = options.maxEnvelopes ?? 50;
  const maxEnvelopes = Number.isFinite(requestedCap)
    ? Math.min(100, Math.max(1, Math.floor(requestedCap)))
    : 50;
  let delivered = 0;
  Sentry.init({
    dsn,
    enabled: true,
    defaultIntegrations: false,
    integrations: [],
    includeServerName: false,
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      frameContextLines: 0,
    },
    enableOpenTelemetrySetup: true,
    // Sentry 11 streams spans by default. Static transactions make the complete
    // trace pass through our event and final-envelope privacy allowlists.
    traceLifecycle: "static",
    tracesSampleRate: 1,
    maxBreadcrumbs: 0,
    sendClientReports: false,
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
    environment: "briefstamp",
    tracePropagationTargets: [],
    beforeBreadcrumb: () => null,
    beforeSend: (event) =>
      sanitizeTelemetryEvent(event) as unknown as typeof event,
    beforeSendTransaction: (event) =>
      sanitizeTelemetryEvent(event, true) as unknown as typeof event,
    transport: (transportOptions) => {
      // No pooled socket means the SDK cannot retry a reused-socket reset.
      const destination = local
        ? null
        : Sentry.makeNodeTransport({ ...transportOptions, keepAlive: false });
      return {
        send: async (envelope) => {
          const sanitized = sanitizeTelemetryEnvelope(envelope);
          if (
            !sanitized[1].length ||
            delivered >= maxEnvelopes ||
            (!local && Date.now() - confirmedAt > 24 * 60 * 60 * 1000)
          )
            return { statusCode: 200 };
          delivered++;
          if (options.captureEnvelope) {
            await options.captureEnvelope(sanitized);
            return { statusCode: 200 };
          }
          return await destination!.send(sanitized as typeof envelope);
        },
        flush: async (timeout) =>
          destination ? destination.flush(timeout) : true,
      };
    },
  });
  current = {
    mode: local ? "local_capture" : "hosted_configured",
    hostedVerified: false,
    maxEnvelopes,
  };
  return observabilityStatus();
}

export function captureOperationalError(name: Operation): void {
  if (current.mode === "disabled") return;
  Sentry.withScope((scope) => {
    scope.setTag("operation", operation(name));
    Sentry.captureException(
      new Error("Briefstamp operation failed; private details omitted."),
    );
  });
}

export async function traceOperation<T>(
  name: Operation,
  data: SafeTelemetryAttributes,
  task: () => Promise<T>,
): Promise<T> {
  if (current.mode === "disabled") return task();
  return Sentry.startSpan(
    {
      name: operation(name),
      op: operation(name),
      attributes: attributes(data) as Record<string, string | number>,
    },
    async (span) => {
      try {
        const result = await task();
        span.setStatus({ code: 1 });
        return result;
      } catch (error) {
        span.setStatus({ code: 2 });
        captureOperationalError(name);
        throw error;
      }
    },
  );
}

export async function flushObservability(): Promise<boolean> {
  return current.mode === "disabled" ? true : Sentry.flush(2000);
}
export async function closeObservability(): Promise<void> {
  if (current.mode !== "disabled") await Sentry.close(2000);
  current = { mode: "disabled", hostedVerified: false, maxEnvelopes: 0 };
}

/** Reconstruct SDK spans from measured times only after the real work has ended. */
export async function exportObservedRuntimeTrace(
  value: RuntimeTraceMeasurement,
): Promise<{ traceId: string; flushed: boolean }> {
  const measurement = RuntimeTraceMeasurementSchema.parse(value);
  if (current.mode === "disabled" || !measurement.complete)
    throw new Error("Runtime trace export unavailable.");
  const root = Sentry.startInactiveSpan({
    name: measurement.operation,
    op: measurement.operation,
    parentSpan: null,
    forceTransaction: true,
    startTime: new Date(measurement.startedAtMs),
    attributes: runtimeSdkAttributes(measurement.attributes),
  });
  const traceId = id(root.spanContext().traceId, 32);
  if (!traceId || /^0+$/.test(traceId))
    throw new Error("SDK did not create a trace.");
  const spans = new Map<number, ReturnType<typeof Sentry.startInactiveSpan>>([
    [0, root],
  ]);
  for (const observed of measurement.spans) {
    spans.set(
      observed.index,
      Sentry.startInactiveSpan({
        name: observed.operation,
        op: observed.operation,
        parentSpan: spans.get(observed.parentIndex)!,
        startTime: new Date(observed.startedAtMs),
        attributes: runtimeSdkAttributes(observed.attributes),
      }),
    );
  }
  for (const observed of [...measurement.spans].reverse()) {
    const span = spans.get(observed.index)!;
    span.setStatus({ code: observed.status === "ok" ? 1 : 2 });
    span.end(new Date(observed.endedAtMs));
  }
  root.setStatus({ code: measurement.status === "ok" ? 1 : 2 });
  root.end(new Date(measurement.endedAtMs));
  return { traceId, flushed: await flushObservability() };
}
