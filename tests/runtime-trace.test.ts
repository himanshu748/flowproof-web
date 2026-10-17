import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { beforeAll, describe, expect, it, vi } from "vitest";
import {
  createRuntimeTrace,
  exportRuntimeTrace,
  runtimeTraceChildEnvironment,
  RuntimeTraceMeasurementSchema,
  runtimeTraceHash,
  sanitizeRuntimeAttributes,
  type SafeRuntimeAttributes,
} from "../server/runtime-trace.js";

const exec = promisify(execFile);
const ROOT = path.resolve(import.meta.dirname, "..");
let epoch = Date.now() - 60_000;
function clock() {
  let now = (epoch += 1000);
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
async function measurement() {
  const time = clock();
  const trace = createRuntimeTrace(
    "briefstamp.audit",
    { checkCount: 1, target: "sample" },
    time.now,
  );
  await trace.span("briefstamp.audit.browser", async () => {
    time.advance(3);
    return true;
  });
  return trace.finish({ passed: 1, outcome: "completed" });
}

// Offline measurements and the real SDK's capture transport only. No Sentry,
// provider, browser, or database endpoint is contacted by these tests.
describe("SDK-free runtime measurement", () => {
  it("measures actual task intervals and concurrent parent relationships without generated trace IDs", async () => {
    const time = clock();
    const trace = createRuntimeTrace(
      "briefstamp.agent",
      { checkCount: 6 },
      time.now,
    );
    const calls: string[] = [];
    const result = await trace.span(
      "briefstamp.agent.model.select_tools",
      async () => {
        calls.push("selection");
        time.advance(10);
        await trace.span(
          "briefstamp.agent.tool.failure_history",
          async () => {
            calls.push("tool");
            time.advance(5);
            return { count: 1 };
          },
          { tool: "failure_history" },
        );
        time.advance(3);
        return { input: 14, output: 6, total: 20, latency: 18 };
      },
      (result) => ({
        provider: "Google",
        model: "gemma-4-26b-a4b-it",
        inputTokens: result.input,
        outputTokens: result.output,
        totalTokens: result.total,
        modelLatencyMs: result.latency,
      }),
    );
    expect(result.total).toBe(20);
    expect(calls).toEqual(["selection", "tool"]);
    time.advance(2);
    const observed = trace.finish({ outcome: "completed" });
    expect(observed.complete).toBe(true);
    expect(observed.endedAtMs - observed.startedAtMs).toBe(20);
    expect(
      observed.spans.map(({ index, parentIndex }) => [index, parentIndex]),
    ).toEqual([
      [1, 0],
      [2, 1],
    ]);
    expect(observed.spans[0].endedAtMs - observed.spans[0].startedAtMs).toBe(
      18,
    );
    expect(observed.spans[1].endedAtMs - observed.spans[1].startedAtMs).toBe(5);
    expect(observed.spans[0].attributes).toMatchObject({
      provider: "Google",
      inputTokens: 14,
      outputTokens: 6,
      totalTokens: 20,
      modelLatencyMs: 18,
    });
    expect(RuntimeTraceMeasurementSchema.safeParse(observed).success).toBe(
      true,
    );
    expect(JSON.stringify(observed)).not.toContain("traceId");
    expect(trace.finish()).toEqual(observed);
    observed.spans[0].attributes.totalTokens = 999;
    expect(trace.finish().spans[0].attributes.totalTokens).toBe(20);
  });

  it("marks an outer validation failure without changing successful child outcomes", async () => {
    const time = clock();
    const trace = createRuntimeTrace("briefstamp.agent", {}, time.now);
    const task = vi.fn(async () => {
      time.advance(5);
      return { completedTransport: true };
    });
    await expect(
      trace.span("briefstamp.agent.model.summarize", task),
    ).resolves.toEqual({ completedTransport: true });
    time.advance(2);
    const observed = trace.finish({ outcome: "failed" });
    expect(task).toHaveBeenCalledTimes(1);
    expect(observed.status).toBe("error");
    expect(observed.attributes.outcome).toBe("failed");
    expect(observed.spans[0].status).toBe("ok");
    expect(observed.complete).toBe(true);
    expect(trace.finish({ outcome: "completed" })).toEqual(observed);
  });

  it("preserves the identical thrown error and invokes the real task exactly once", async () => {
    const time = clock();
    const trace = createRuntimeTrace("briefstamp.agent", {}, time.now);
    const secret = new Error("private-client@example.test credential=not-real");
    const task = vi.fn(async () => {
      time.advance(11);
      throw secret;
    });
    const attributes = {
      provider: "Backboard",
      model: "google/gemma-4-26b-a4b-it",
      inputTokens: null,
    } as const;
    await expect(
      trace.span("briefstamp.agent.model.summarize", task, attributes),
    ).rejects.toBe(secret);
    expect(task).toHaveBeenCalledTimes(1);
    const observed = trace.finish();
    expect(observed.status).toBe("error");
    expect(observed.spans[0]).toMatchObject({
      status: "error",
      attributes: { provider: "Backboard", model: "google/gemma-4-26b-a4b-it" },
    });
    expect(observed.spans[0].attributes).not.toHaveProperty("inputTokens");
    expect(JSON.stringify(observed)).not.toContain(secret.message);
  });

  it("keeps success unchanged when telemetry attribute code throws or counts exceed bounds", async () => {
    const trace = createRuntimeTrace("briefstamp.audit");
    const value = { privateResult: "not-for-telemetry" };
    const task = vi.fn(async () => value);
    expect(
      await trace.span("briefstamp.audit.browser", task, () => {
        throw new Error("telemetry accessor failure");
      }),
    ).toBe(value);
    expect(task).toHaveBeenCalledTimes(1);
    expect(trace.finish().spans[0].attributes).toEqual({});
    const hostile = {
      get provider() {
        throw new Error("secret getter");
      },
      inputTokens: -1,
      outputTokens: Infinity,
      totalTokens: 524289,
      checkCount: 25,
      model: "private-model-name",
      outcome: "private detail",
      url: "https://private.test",
      error: value,
    };
    expect(sanitizeRuntimeAttributes(hostile)).toEqual({});
    expect(
      sanitizeRuntimeAttributes({
        inputTokens: null,
        outputTokens: 0,
        totalTokens: 0,
        provider: "Google",
      }),
    ).toEqual({ outputTokens: 0, totalTokens: 0, provider: "Google" });
  });

  it("bounds recorded spans while still executing overflow tasks once", async () => {
    const trace = createRuntimeTrace("briefstamp.audit");
    const task = vi.fn(async () => 1);
    for (let i = 0; i < 20; i++)
      expect(await trace.span("briefstamp.audit.browser", task)).toBe(1);
    expect(task).toHaveBeenCalledTimes(20);
    const result = trace.finish();
    expect(result.spans).toHaveLength(16);
    expect(result.complete).toBe(false);
  });

  it("fails closed if finish is called before the measured work ends", async () => {
    const trace = createRuntimeTrace("briefstamp.audit");
    let release!: () => void;
    const task = trace.span(
      "briefstamp.audit.browser",
      async () =>
        new Promise<void>((done) => {
          release = done;
        }),
    );
    const unfinished = trace.finish();
    expect(unfinished.complete).toBe(false);
    const reserve = vi.fn();
    await expect(
      exportRuntimeTrace(unfinished, { reserve, captureEnvelope: vi.fn() }),
    ).rejects.toThrow();
    expect(reserve).not.toHaveBeenCalled();
    release();
    await task;
  });

  it("rejects tampered scope, private attributes and impossible span relationships", async () => {
    const good = await measurement();
    for (const bad of [
      { ...good, secret: "private" },
      { ...good, operation: "private.operation" },
      { ...good, attributes: { prompt: "private" } },
      { ...good, endedAtMs: good.startedAtMs - 1 },
      { ...good, spans: [{ ...good.spans[0], parentIndex: 1 }] },
      { ...good, spans: [{ ...good.spans[0], endedAtMs: good.endedAtMs + 1 }] },
    ])
      expect(RuntimeTraceMeasurementSchema.safeParse(bad).success).toBe(false);
  });

  it("does not inherit provider credentials, proxy configuration, TLS overrides or Node loaders", () => {
    const safe = runtimeTraceChildEnvironment({
      PATH: "/usr/bin",
      SENTRY_DSN: "https://public@o1.ingest.sentry.io/1",
      FLOWPROOF_SENTRY_ENABLED: "true",
      FLOWPROOF_SENTRY_FREE_CONFIRMED: "true",
      FLOWPROOF_SENTRY_FREE_CONFIRMED_AT: new Date().toISOString(),
      GOOGLE_GEMMA_API_KEY: "private",
      BACKBOARD_API_KEY: "private",
      FLOWPROOF_TOKEN: "private",
      DATABASE_URL: "private",
      TIGER_DATABASE_URL: "private",
      NODE_OPTIONS: "--import private",
      NODE_EXTRA_CA_CERTS: "/private",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      HTTPS_PROXY: "private",
      HTTP_PROXY: "private",
      HOME: "/private",
      SECRET: "private",
    });
    expect(Object.keys(safe).sort()).toEqual(
      [
        "FLOWPROOF_SENTRY_ENABLED",
        "FLOWPROOF_SENTRY_FREE_CONFIRMED",
        "FLOWPROOF_SENTRY_FREE_CONFIRMED_AT",
        "MASTRA_TELEMETRY_DISABLED",
        "NODE_ENV",
        "PATH",
        "SENTRY_DSN",
      ].sort(),
    );
    expect(JSON.stringify(safe)).not.toContain("private");
  });

  it("does not reserve or launch when hosted confirmation is absent or stale", async () => {
    const reserve = vi.fn();
    await expect(
      exportRuntimeTrace(await measurement(), { env: {}, reserve }),
    ).rejects.toThrow();
    await expect(
      exportRuntimeTrace(await measurement(), {
        env: {
          SENTRY_DSN: "https://public@o1.ingest.sentry.io/1",
          FLOWPROOF_SENTRY_ENABLED: "true",
          FLOWPROOF_SENTRY_FREE_CONFIRMED: "true",
          FLOWPROOF_SENTRY_FREE_CONFIRMED_AT: new Date(
            Date.now() - 25 * 3600000,
          ).toISOString(),
        },
        reserve,
      }),
    ).rejects.toThrow();
    expect(reserve).not.toHaveBeenCalled();
  });

  it("never retries or refunds a failed reservation", async () => {
    const observed = await measurement();
    const reserve = vi.fn(async () => {
      throw new Error("offline reservation denial");
    });
    const captureEnvelope = vi.fn();
    await expect(
      exportRuntimeTrace(observed, { reserve, captureEnvelope }),
    ).rejects.toThrow("offline reservation denial");
    await expect(
      exportRuntimeTrace(structuredClone(observed), {
        reserve,
        captureEnvelope,
      }),
    ).rejects.toThrow("already attempted");
    expect(reserve).toHaveBeenCalledExactlyOnceWith({
      operation: "runtime_trace",
      measurementSha256: runtimeTraceHash(observed),
      units: 1,
      maxEnvelopes: 2,
    });
    expect(captureEnvelope).not.toHaveBeenCalled();
  });
});

describe("isolated real Sentry SDK capture", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    await exec(
      process.execPath,
      [
        path.join(ROOT, "node_modules/vite/bin/vite.js"),
        "build",
        "--ssr",
        "server/runtime-trace-child.ts",
        "--outDir",
        "dist-trace-worker",
      ],
      { cwd: ROOT, timeout: 30_000, maxBuffer: 128 * 1024 },
    );
  }, 30_000);

  it("emits real SDK parent/child IDs with observed timestamps and bounded safe attributes", async () => {
    const time = clock();
    const secret = "client-private@example.test token=never-export";
    const trace = createRuntimeTrace(
      "briefstamp.agent",
      {
        checkCount: 6,
        target: "sample",
        prompt: secret,
      } as SafeRuntimeAttributes,
      time.now,
    );
    await trace.span(
      "briefstamp.agent.model.select_tools",
      async () => {
        time.advance(17);
        await trace.span(
          "briefstamp.agent.tool.failure_history",
          async () => {
            time.advance(7);
            return null;
          },
          { tool: "failure_history", outcome: "completed" },
        );
        time.advance(5);
        return { input: 71, output: 13, total: 84 };
      },
      (result) => ({
        provider: "Backboard",
        model: "google/gemma-4-26b-a4b-it",
        inputTokens: result.input,
        outputTokens: result.output,
        totalTokens: result.total,
        modelLatencyMs: 17,
      }),
    );
    time.advance(2);
    await trace.span(
      "briefstamp.agent.model.summarize",
      async () => {
        time.advance(9);
        return null;
      },
      {
        provider: "Google",
        model: "gemma-4-26b-a4b-it",
        inputTokens: null,
        outputTokens: null,
      },
    );
    const observed = trace.finish({ outcome: "completed" });
    const envelopes: any[] = [];
    const reserve = vi.fn(async () => {});
    const receipt = await exportRuntimeTrace(observed, {
      reserve,
      captureEnvelope: (envelope) => {
        expect(reserve).toHaveBeenCalledTimes(1);
        envelopes.push(envelope);
      },
      env: {
        GOOGLE_GEMMA_API_KEY: secret,
        FLOWPROOF_TOKEN: secret,
        NODE_OPTIONS: "--throw-deprecation",
      },
    });
    expect(receipt).toMatchObject({
      provider: "Sentry",
      mode: "local_capture",
      flushed: true,
      ingestionVerified: false,
      measurementSha256: runtimeTraceHash(observed),
      maxEnvelopes: 2,
    });
    expect(receipt.traceId).toMatch(/^[a-f0-9]{32}$/);
    expect(receipt.traceId).not.toBe("0".repeat(32));
    expect(envelopes.length).toBeGreaterThan(0);
    expect(envelopes.length).toBeLessThanOrEqual(2);
    const event = envelopes
      .flatMap((envelope) => envelope[1])
      .find((item: any) => item[0].type === "transaction")?.[1];
    expect(event).toBeDefined();
    expect(event.contexts.trace.trace_id).toBe(receipt.traceId);
    expect(event.transaction).toBe("briefstamp.agent");
    expect(event.start_timestamp).toBeCloseTo(observed.startedAtMs / 1000, 3);
    expect(event.timestamp).toBeCloseTo(observed.endedAtMs / 1000, 3);
    expect(event.contexts.trace.data).toMatchObject({
      "briefstamp.checkCount": 6,
      "briefstamp.target": "sample",
      "briefstamp.outcome": "completed",
    });
    expect(event.spans).toHaveLength(3);
    const select = event.spans.find(
      (span: any) => span.op === "briefstamp.agent.model.select_tools",
    );
    const history = event.spans.find(
      (span: any) => span.op === "briefstamp.agent.tool.failure_history",
    );
    const summarize = event.spans.find(
      (span: any) => span.op === "briefstamp.agent.model.summarize",
    );
    expect(select.parent_span_id).toBe(event.contexts.trace.span_id);
    expect(history.parent_span_id).toBe(select.span_id);
    expect(summarize.parent_span_id).toBe(event.contexts.trace.span_id);
    expect(select.data).toMatchObject({
      "briefstamp.provider": "Backboard",
      "briefstamp.model": "google/gemma-4-26b-a4b-it",
      "briefstamp.inputTokens": 71,
      "briefstamp.outputTokens": 13,
      "briefstamp.totalTokens": 84,
      "briefstamp.modelLatencyMs": 17,
    });
    expect(summarize.data).not.toHaveProperty("briefstamp.inputTokens");
    for (const source of observed.spans) {
      const actual = event.spans.find(
        (span: any) => span.op === source.operation,
      );
      expect(actual.trace_id).toBe(receipt.traceId);
      expect(actual.start_timestamp).toBeCloseTo(source.startedAtMs / 1000, 3);
      expect(actual.timestamp).toBeCloseTo(source.endedAtMs / 1000, 3);
    }
    expect(JSON.stringify(envelopes)).not.toContain(secret);
    expect(JSON.stringify(envelopes)).not.toMatch(
      /prompt|Authorization|cookie|request_body|GOOGLE_GEMMA_API_KEY/,
    );
    const forbidden = vi.fn(async () => {});
    await expect(
      exportRuntimeTrace(observed, {
        reserve: forbidden,
        captureEnvelope: vi.fn(),
      }),
    ).rejects.toThrow("already attempted");
    expect(forbidden).not.toHaveBeenCalled();
  });

  it("keeps the parent import graph free of the SDK", async () => {
    const source = await readFile(
      path.join(ROOT, "server/runtime-trace.ts"),
      "utf8",
    );
    expect(source).not.toContain('from "@sentry/');
    expect(source).not.toContain('import("./observability');
    const script = `import {register} from 'node:module'; register('data:text/javascript,'+encodeURIComponent("export async function resolve(s,c,n){if(s.startsWith('@sentry/'))throw new Error('Parent loaded Sentry SDK');return n(s,c)}")); const {createRuntimeTrace}=await import('./server/runtime-trace.ts');const trace=createRuntimeTrace('briefstamp.audit');await trace.span('briefstamp.audit.browser',async()=>42);process.stdout.write(JSON.stringify(trace.finish()));`;
    const result = await exec(
      process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script],
      {
        cwd: ROOT,
        timeout: 20_000,
        maxBuffer: 32 * 1024,
        env: runtimeTraceChildEnvironment(),
      },
    );
    expect(JSON.parse(result.stdout).spans[0].status).toBe("ok");
  });
});
