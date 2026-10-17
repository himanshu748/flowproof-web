import { afterEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/node";
import {
  closeObservability,
  flushObservability,
  initObservability,
  sanitizeTelemetryEnvelope,
  traceOperation,
} from "../server/observability.js";

afterEach(async () => {
  await closeObservability();
  vi.unstubAllEnvs();
});

describe("optional Sentry privacy boundary", () => {
  it("stays disabled without explicit free-resource confirmation", () => {
    vi.stubEnv("FLOWPROOF_SENTRY_ENABLED", "true");
    vi.stubEnv("FLOWPROOF_SENTRY_FREE_CONFIRMED", "false");
    vi.stubEnv("SENTRY_DSN", "https://public@o1.ingest.sentry.io/1");
    expect(initObservability().mode).toBe("disabled");
  });

  it("rejects stale or future-dated free-resource confirmation", () => {
    vi.stubEnv("FLOWPROOF_SENTRY_ENABLED", "true");
    vi.stubEnv("FLOWPROOF_SENTRY_FREE_CONFIRMED", "true");
    vi.stubEnv(
      "FLOWPROOF_SENTRY_FREE_CONFIRMED_AT",
      new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    );
    expect(initObservability().mode).toBe("disabled");
    vi.stubEnv(
      "FLOWPROOF_SENTRY_FREE_CONFIRMED_AT",
      new Date(Date.now() + 60 * 1000).toISOString(),
    );
    expect(initObservability().mode).toBe("disabled");
  });

  it("allowlists envelope payloads and drops private fields and attachments", () => {
    const secret = ["private", "client", "brief", "credential"].join("-");
    const envelope = sanitizeTelemetryEnvelope([
      {
        event_id: "a".repeat(32),
        trace: { user_segment: secret },
        dsn: secret,
      },
      [
        [
          { type: "event", filename: secret },
          {
            message: secret,
            exception: { values: [{ value: secret }] },
            user: { email: secret },
            request: { headers: { Authorization: secret } },
            extra: { brief: secret },
          },
        ],
        [{ type: "attachment" }, secret],
        [{ type: "log" }, secret],
        [
          { type: "transaction" },
          {
            transaction: secret,
            start_timestamp: 1,
            timestamp: 2,
            contexts: {
              trace: {
                trace_id: "b".repeat(32),
                span_id: "c".repeat(16),
                op: "briefstamp.audit",
                status: "ok",
                private: secret,
              },
            },
            spans: [
              {
                trace_id: "b".repeat(32),
                span_id: "d".repeat(16),
                op: "briefstamp.audit.browser",
                description: secret,
                data: { "briefstamp.checkCount": 6, brief: secret },
              },
            ],
          },
        ],
      ],
    ]);
    expect(JSON.stringify(envelope)).not.toContain(secret);
    expect(envelope[1]).toHaveLength(2);
    expect(JSON.stringify(envelope)).toContain('"briefstamp.checkCount":6');
  });

  it("retains allowlisted root and child model metadata while dropping private or invalid fields", () => {
    const secret = ["private", "prompt", "or", "provider", "response"].join(
      "-",
    );
    const envelope = sanitizeTelemetryEnvelope([
      {},
      [
        [
          { type: "transaction" },
          {
            transaction: "briefstamp.agent",
            start_timestamp: 1,
            timestamp: 2,
            contexts: {
              trace: {
                trace_id: "a".repeat(32),
                span_id: "b".repeat(16),
                op: "briefstamp.agent",
                status: "ok",
                data: {
                  "briefstamp.checkCount": 6,
                  "briefstamp.outcome": "completed",
                  "briefstamp.inputTokens": 71,
                  prompt: secret,
                  url: secret,
                  sessionId: secret,
                },
              },
            },
            spans: [
              {
                trace_id: "a".repeat(32),
                span_id: "c".repeat(16),
                parent_span_id: "b".repeat(16),
                op: "briefstamp.agent.model.summarize",
                description: "briefstamp.agent.model.summarize",
                status: "ok",
                start_timestamp: 1.5,
                timestamp: 2,
                data: {
                  "briefstamp.provider": "Backboard",
                  "briefstamp.model": "google/gemma-4-26b-a4b-it",
                  "briefstamp.inputTokens": null,
                  "briefstamp.outputTokens": 13,
                  "briefstamp.totalTokens": 84,
                  "briefstamp.modelLatencyMs": 53,
                  "briefstamp.target": secret,
                  "briefstamp.failed": 25,
                  error: secret,
                  response: secret,
                },
              },
            ],
          },
        ],
      ],
    ]);
    const event = envelope[1][0][1] as any;
    expect(event.contexts.trace.data).toEqual({
      "briefstamp.checkCount": 6,
      "briefstamp.inputTokens": 71,
      "briefstamp.outcome": "completed",
    });
    expect(event.spans[0].data).toEqual({
      "briefstamp.provider": "Backboard",
      "briefstamp.model": "google/gemma-4-26b-a4b-it",
      "briefstamp.outputTokens": 13,
      "briefstamp.totalTokens": 84,
      "briefstamp.modelLatencyMs": 53,
    });
    expect(JSON.stringify(envelope)).not.toContain(secret);
    expect(JSON.stringify(envelope)).not.toMatch(
      /sessionId|prompt|response|url/,
    );
  });

  it("uses the real SDK local transport for safe spans and errors, with a hard envelope cap", async () => {
    const captured: unknown[] = [];
    const secret =
      "do-not-export-client@example.com password=not-a-real-secret";
    expect(
      initObservability({
        captureEnvelope: (envelope) => {
          captured.push(envelope);
        },
        maxEnvelopes: 3,
      }).mode,
    ).toBe("local_capture");
    await traceOperation(
      "briefstamp.audit",
      { checkCount: 2, target: "sample" },
      async () => {
        await traceOperation(
          "briefstamp.audit.browser",
          { checkCount: 2 },
          async () => "observed",
        );
      },
    );
    expect(await flushObservability()).toBe(true);
    expect(JSON.stringify(captured)).toContain("transaction");
    Sentry.withScope((scope) => {
      scope.setUser({ email: secret });
      scope.setExtra("brief", secret);
      scope.setTag("operation", "briefstamp.audit");
      Sentry.captureException(new Error(secret));
    });
    for (let index = 0; index < 4; index++)
      Sentry.captureException(new Error(secret));
    expect(await flushObservability()).toBe(true);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured.length).toBeLessThanOrEqual(3);
    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain(secret);
    expect(serialized).not.toContain("client@example.com");
    expect(serialized).toContain("transaction");
    expect(serialized).toContain("BriefstampOperationError");
  }, 15000);
});
