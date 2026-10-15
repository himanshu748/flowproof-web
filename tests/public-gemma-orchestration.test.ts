import { spawn, execFile, execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  publicGemmaChildEnvironment,
  runPublicGemmaWorkflow,
  PUBLIC_GEMMA_STEPS,
  PUBLIC_GEMMA_WORKFLOW_ID,
} from "../server/public-gemma-orchestration";

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: vi.fn(),
}));
const requirements = ['The homepage heading must say "Welcome".'];
const proposal = {
  checks: [
    {
      requirementIndex: 0,
      kind: "heading",
      path: "/",
      expected: "Welcome",
      viewport: "desktop",
    },
  ],
  model: "gemma-4-26b-a4b-it",
  usage: { promptTokens: 100, completionTokens: 40, totalTokens: 140 },
  latencyMs: 12,
};
const result = {
  ...proposal,
  orchestration: {
    provider: "Mastra",
    workflowId: PUBLIC_GEMMA_WORKFLOW_ID,
    runId: "0f6ab3bf-8a85-4613-b431-0c7cc911d52d",
    steps: [...PUBLIC_GEMMA_STEPS],
    maxRssMiB: 170,
  },
};
function fakeChild() {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
  });
}
let compiled = false;
function buildWorker() {
  if (compiled) return;
  execFileSync(
    process.execPath,
    [
      resolve("node_modules/vite/bin/vite.js"),
      "build",
      "--ssr",
      "server/gemma-workflow-child.ts",
      "--outDir",
      "dist-worker",
    ],
    { timeout: 30_000, maxBuffer: 64 * 1024 },
  );
  compiled = true;
}
let child: ReturnType<typeof fakeChild>;
beforeEach(() => {
  child = fakeChild();
  vi.mocked(spawn).mockReturnValue(
    child as unknown as ReturnType<typeof spawn>,
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(spawn).mockReset();
});

describe("isolated public Mastra workflow process", () => {
  it("uses the fixed plain-JS worker, bounded heap and safe environment, and waits for close", async () => {
    vi.stubEnv("NODE_OPTIONS", "--import /untrusted/loader.js");
    vi.stubEnv("GOOGLE_GEMMA_API_KEY", "synthetic-key");
    const pending = runPublicGemmaWorkflow(requirements);
    const settled = vi.fn();
    void pending.then(settled);
    const [binary, args, options] = vi.mocked(spawn).mock.calls[0];
    expect(binary).toBe(process.execPath);
    expect(args).toEqual([
      "--max-old-space-size=192",
      resolve("dist-worker/gemma-workflow-child.js"),
    ]);
    expect(options).toMatchObject({
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(options?.env?.GOOGLE_GEMMA_API_KEY).toBe("synthetic-key");
    expect(options?.env).not.toHaveProperty("NODE_OPTIONS");
    expect(JSON.parse(child.stdin.read().toString())).toEqual({ requirements });
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ ok: true, result })),
    );
    child.emit("exit", 0, null);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    child.emit("close", 0, null);
    await expect(pending).resolves.toEqual(result);
  });

  it("allowlists only OS necessities and the exact Google and optional Sentry configuration", () => {
    const input = {
      PATH: "/usr/bin",
      HOME: "/synthetic",
      TMPDIR: "/tmp",
      LANG: "en_US.UTF-8",
      BRIEFSTAMP_PUBLIC_GEMMA_ENABLED: "true",
      BRIEFSTAMP_GEMMA_CONFIRMED_FREE: "true",
      BRIEFSTAMP_GEMMA_FREE_UNTIL: "2026-10-20T00:00:00Z",
      GOOGLE_GEMMA_API_KEY: "synthetic-key",
      NODE_OPTIONS: "--import bad",
      NODE_EXTRA_CA_CERTS: "/bad",
      NODE_TLS_REJECT_UNAUTHORIZED: "0",
      HTTPS_PROXY: "https://bad",
      HTTP_PROXY: "https://bad",
      ALL_PROXY: "https://bad",
      SENTRY_DSN: "https://synthetic@o0.ingest.sentry.io/1",
      FLOWPROOF_SENTRY_ENABLED: "true",
      FLOWPROOF_SENTRY_FREE_CONFIRMED: "true",
      FLOWPROOF_SENTRY_FREE_CONFIRMED_AT: "2026-10-15T00:00:00Z",
      SENTRY_AUTH_TOKEN: "secret",
      SENTRY_CAPTURE_FIXTURE: "forbidden",
      TINKER_API_KEY: "secret",
      DATABASE_URL: "secret",
      BACKBOARD_API_KEY: "secret",
      MASTRA_TELEMETRY_DISABLED: "0",
      MASTRA_STORAGE: "untrusted",
      GEMMA_FIXTURE: "fake",
    };
    const env = publicGemmaChildEnvironment(input);
    expect(Object.keys(env).sort()).toEqual(
      [
        "PATH",
        "HOME",
        "TMPDIR",
        "LANG",
        "BRIEFSTAMP_PUBLIC_GEMMA_ENABLED",
        "BRIEFSTAMP_GEMMA_CONFIRMED_FREE",
        "BRIEFSTAMP_GEMMA_FREE_UNTIL",
        "GOOGLE_GEMMA_API_KEY",
        "SENTRY_DSN",
        "FLOWPROOF_SENTRY_ENABLED",
        "FLOWPROOF_SENTRY_FREE_CONFIRMED",
        "FLOWPROOF_SENTRY_FREE_CONFIRMED_AT",
        "NODE_ENV",
        "MASTRA_TELEMETRY_DISABLED",
      ].sort(),
    );
    expect(env.MASTRA_TELEMETRY_DISABLED).toBe("1");
    expect(env.NODE_ENV).toBe("production");
  });

  it("rejects invalid or oversized inputs before creating a child", async () => {
    for (const input of [
      [],
      Array(7).fill("requirement"),
      ["x".repeat(2001)],
      ["x".repeat(2000), "y".repeat(2000), "z".repeat(2000), "extra"],
      ["\u0000".repeat(2000), "\u0000".repeat(2000), "\u0000".repeat(2000)],
    ]) {
      await expect(runPublicGemmaWorkflow(input)).rejects.toBeInstanceOf(Error);
    }
    expect(spawn).not.toHaveBeenCalled();
  });

  it("requires successful close even when stdout contains a valid result", async () => {
    const pending = runPublicGemmaWorkflow(requirements);
    child.stdout.emit(
      "data",
      Buffer.from(JSON.stringify({ ok: true, result })),
    );
    child.emit("close", 1, null);
    await expect(pending).rejects.toThrow("workflow failed");
  });

  it.each([
    { ...result, model: "different-model" },
    { ...result, checks: [{ ...proposal.checks[0], approved: true }] },
    { ...result, checks: [{ ...proposal.checks[0], requirementIndex: 1 }] },
    { ...result, checks: [proposal.checks[0], proposal.checks[0]] },
    {
      ...result,
      orchestration: {
        ...result.orchestration,
        steps: [PUBLIC_GEMMA_STEPS[0]],
      },
    },
    {
      ...result,
      orchestration: { ...result.orchestration, workflowId: "fake" },
    },
    {
      ...result,
      orchestration: { ...result.orchestration, runId: "not-a-run-id" },
    },
    { ...result, orchestration: { ...result.orchestration, maxRssMiB: 0 } },
  ])(
    "rejects invalid child result identity, schema or step receipt %#",
    async (invalid) => {
      const pending = runPublicGemmaWorkflow(requirements);
      child.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ ok: true, result: invalid })),
      );
      child.emit("close", 0, null);
      await expect(pending).rejects.toThrow("invalid result");
    },
  );

  it("accepts only a minimal actual telemetry receipt and never promotes flush to ingestion proof", async () => {
    const telemetry = {
      provider: "Sentry",
      mode: "hosted_configured",
      traceId: "a".repeat(32),
      flushed: true,
      ingestionVerified: false,
    };
    for (const mode of ["hosted_configured", "local_capture"]) {
      const actual = {
        ...result,
        orchestration: {
          ...result.orchestration,
          telemetry: { ...telemetry, mode },
        },
      };
      const pending = runPublicGemmaWorkflow(requirements);
      child.stdout.emit(
        "data",
        Buffer.from(JSON.stringify({ ok: true, result: actual })),
      );
      child.emit("close", 0, null);
      await expect(pending).resolves.toEqual(actual);
    }
    for (const invalid of [
      { ...telemetry, traceId: "0".repeat(32) },
      { ...telemetry, traceId: "not-a-trace" },
      { ...telemetry, ingestionVerified: true },
      { ...telemetry, mode: "verified" },
      { ...telemetry, flushed: "true" },
      { ...telemetry, dsn: "private" },
    ]) {
      const pending = runPublicGemmaWorkflow(requirements);
      child.stdout.emit(
        "data",
        Buffer.from(
          JSON.stringify({
            ok: true,
            result: {
              ...result,
              orchestration: { ...result.orchestration, telemetry: invalid },
            },
          }),
        ),
      );
      child.emit("close", 0, null);
      await expect(pending).rejects.toThrow("invalid result");
    }
  });

  it("rejects multiple JSON values and unrecognized envelope fields", async () => {
    for (const text of [
      JSON.stringify({ ok: true, result }) + "\n{}",
      JSON.stringify({ ok: true, result, approved: true }),
      JSON.stringify({ ok: false, error: "private secret" }),
    ]) {
      const pending = runPublicGemmaWorkflow(requirements);
      child.stdout.emit("data", Buffer.from(text));
      child.emit("close", 0, null);
      await expect(pending).rejects.toThrow("invalid result");
    }
  });

  it.each(["stdout", "stderr"] as const)(
    "bounds %s without echoing diagnostics and waits for actual close",
    async (stream) => {
      const pending = runPublicGemmaWorkflow(requirements);
      const rejected = vi.fn();
      void pending.catch(rejected);
      child[stream].emit(
        "data",
        Buffer.from("private-secret".repeat(stream === "stdout" ? 6000 : 1000)),
      );
      expect(child.kill).toHaveBeenCalledWith("SIGTERM");
      await Promise.resolve();
      expect(rejected).not.toHaveBeenCalled();
      child.emit("close", null, "SIGTERM");
      await expect(pending).rejects.toThrow(
        /exceeded its (output|diagnostic) limit/,
      );
      expect(String(rejected.mock.calls[0][0])).not.toContain("private-secret");
    },
  );

  it("times out at 45 seconds, escalates only its own child and waits for close", async () => {
    vi.useFakeTimers();
    const pending = runPublicGemmaWorkflow(requirements);
    const rejected = vi.fn();
    void pending.catch(rejected);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
    expect(rejected).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    child.emit("close", null, "SIGKILL");
    await expect(pending).rejects.toThrow("time limit");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("redacts spawn and pipe exceptions until the child closes", async () => {
    const pending = runPublicGemmaWorkflow(requirements);
    const rejected = vi.fn();
    void pending.catch(rejected);
    child.emit("error", new Error("private-key path and provider detail"));
    child.stdin.emit("error", new Error("private-key"));
    await Promise.resolve();
    expect(rejected).not.toHaveBeenCalled();
    child.emit("close", -1, null);
    await expect(pending).rejects.toThrow("could not start");
    expect(String(rejected.mock.calls[0][0])).not.toContain("private-key");
  });

  it("runs the real two-step SDK workflow from fresh compiled JS under 300 MiB with a trusted fixture callback", async () => {
    buildWorker();
    const moduleUrl = pathToFileURL(
      resolve("dist-worker/gemma-workflow-child.js"),
    ).href;
    const source = `import { register } from 'node:module';
      register('data:text/javascript,' + encodeURIComponent("export async function resolve(s,c,n) { if (s.startsWith('@sentry/')) throw new Error('Disabled worker loaded Sentry'); return n(s,c); }"));
      const { executeGemmaWorkflow } = await import(${JSON.stringify(moduleUrl)});
      let calls = 0;
      const requirements = ${JSON.stringify(requirements)};
      const result = await executeGemmaWorkflow(requirements, async (input) => {
        if (JSON.stringify(input) !== JSON.stringify(requirements)) throw new Error('mismatched input');
        calls++;
        return ${JSON.stringify(proposal)};
      });
      const gateRejections = [];
      for (const config of [
        { FLOWPROOF_SENTRY_ENABLED: 'false', FLOWPROOF_SENTRY_FREE_CONFIRMED: 'true', FLOWPROOF_SENTRY_FREE_CONFIRMED_AT: new Date().toISOString(), SENTRY_DSN: 'https://synthetic@o0.ingest.sentry.io/1' },
        { FLOWPROOF_SENTRY_ENABLED: 'true', FLOWPROOF_SENTRY_FREE_CONFIRMED: 'false', FLOWPROOF_SENTRY_FREE_CONFIRMED_AT: new Date().toISOString(), SENTRY_DSN: 'https://synthetic@o0.ingest.sentry.io/1' },
        { FLOWPROOF_SENTRY_ENABLED: 'true', FLOWPROOF_SENTRY_FREE_CONFIRMED: 'true', FLOWPROOF_SENTRY_FREE_CONFIRMED_AT: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(), SENTRY_DSN: 'https://synthetic@o0.ingest.sentry.io/1' },
        { FLOWPROOF_SENTRY_ENABLED: 'true', FLOWPROOF_SENTRY_FREE_CONFIRMED: 'true', FLOWPROOF_SENTRY_FREE_CONFIRMED_AT: new Date(Date.now() + 60 * 60 * 1000).toISOString(), SENTRY_DSN: 'https://synthetic@o0.ingest.sentry.io/1' },
        { FLOWPROOF_SENTRY_ENABLED: 'true', FLOWPROOF_SENTRY_FREE_CONFIRMED: 'true', FLOWPROOF_SENTRY_FREE_CONFIRMED_AT: new Date().toISOString(), SENTRY_DSN: '' },
      ]) {
        Object.assign(process.env, config);
        const denied = await executeGemmaWorkflow(requirements, async () => (${JSON.stringify(proposal)}));
        gateRejections.push(denied.orchestration.telemetry === undefined);
      }
      for (const name of ['FLOWPROOF_SENTRY_ENABLED', 'FLOWPROOF_SENTRY_FREE_CONFIRMED', 'FLOWPROOF_SENTRY_FREE_CONFIRMED_AT', 'SENTRY_DSN']) delete process.env[name];
      let failingCalls = 0;
      let failureRejected = false;
      try {
        await executeGemmaWorkflow(requirements, async () => {
          failingCalls++;
          throw new Error('synthetic failure');
        });
      } catch { failureRejected = true; }
      let invalidRejected = false;
      try {
        await executeGemmaWorkflow(requirements, async () => ({ ...${JSON.stringify(proposal)}, checks: [{ ...${JSON.stringify(proposal.checks[0])}, requirementIndex: 1 }] }));
      } catch { invalidRejected = true; }
      process.stdout.write(JSON.stringify({ result, calls, gateRejections, failingCalls, failureRejected, invalidRejected, heap: process.execArgv, telemetry: process.env.MASTRA_TELEMETRY_DISABLED }), () => process.exit(0));`;
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ["--max-old-space-size=192", "--input-type=module", "--eval", source],
      {
        env: publicGemmaChildEnvironment({ PATH: process.env.PATH }),
        timeout: 30_000,
        maxBuffer: 64 * 1024,
      },
    );
    // Mastra emits bounded diagnostics for the two intentional fixture failures.
    // The parent tests above prove these are drained privately, never returned.
    expect(stderr).toContain("synthetic failure");
    expect(Buffer.byteLength(stderr)).toBeLessThan(8 * 1024);
    const actual = JSON.parse(stdout);
    expect(actual.calls).toBe(1);
    expect(actual.gateRejections).toEqual([true, true, true, true, true]);
    expect(actual.failingCalls).toBe(1);
    expect(actual.failureRejected).toBe(true);
    expect(actual.invalidRejected).toBe(true);
    expect(actual.telemetry).toBe("1");
    expect(actual.heap).toContain("--max-old-space-size=192");
    expect(actual.heap.join(" ")).not.toContain("tsx");
    expect(actual.result.checks).toEqual(proposal.checks);
    expect(actual.result.orchestration).not.toHaveProperty("telemetry");
    expect(actual.result.orchestration).toMatchObject({
      provider: "Mastra",
      workflowId: PUBLIC_GEMMA_WORKFLOW_ID,
      steps: [...PUBLIC_GEMMA_STEPS],
    });
    expect(actual.result.orchestration.runId).toMatch(/^[a-f0-9-]{36}$/);
    expect(actual.result.orchestration.maxRssMiB).toBeGreaterThan(0);
    expect(actual.result.orchestration.maxRssMiB).toBeLessThan(300);
    console.info(
      `Compiled Mastra fixture worker peak RSS: ${actual.result.orchestration.maxRssMiB} MiB`,
    );
  }, 45_000);
  it("captures three real allowlisted SDK spans in the compiled child without network or private text", async () => {
    buildWorker();
    const moduleUrl = pathToFileURL(
      resolve("dist-worker/gemma-workflow-child.js"),
    ).href;
    const source = `
      globalThis.fetch = async () => { throw new Error('Network is forbidden in local telemetry proof'); };
      const { executeGemmaWorkflow } = await import(${JSON.stringify(moduleUrl)});
      const envelopes = [];
      let calls = 0;
      const result = await executeGemmaWorkflow(['PRIVATE-CLIENT-REQUIREMENT'], async () => {
        calls++;
        return ${JSON.stringify(proposal)};
      }, { captureEnvelope: (envelope) => { envelopes.push(envelope); } });
      process.stdout.write(JSON.stringify({ result, calls, envelopes }), () => process.exit(0));`;
    const { stdout, stderr } = await promisify(execFile)(
      process.execPath,
      ["--max-old-space-size=192", "--input-type=module", "--eval", source],
      {
        env: publicGemmaChildEnvironment({
          PATH: process.env.PATH,
          GOOGLE_GEMMA_API_KEY: ["PRIVATE", "PROVIDER", "KEY"].join("-"),
        }),
        timeout: 30_000,
        maxBuffer: 64 * 1024,
      },
    );
    expect(stderr).toBe("");
    const actual = JSON.parse(stdout);
    expect(actual.calls).toBe(1);
    expect(actual.result.checks).toEqual(proposal.checks);
    expect(actual.result.orchestration.telemetry).toMatchObject({
      provider: "Sentry",
      mode: "local_capture",
      flushed: true,
      ingestionVerified: false,
    });
    expect(actual.envelopes).toHaveLength(1);
    const [header, items] = actual.envelopes[0];
    expect(Object.keys(header).sort()).toEqual(["event_id", "sent_at"]);
    expect(items).toHaveLength(1);
    expect(items[0][0]).toEqual({ type: "transaction" });
    const event = items[0][1];
    expect(event.transaction).toBe("briefstamp.proposal");
    expect(event.contexts.trace.trace_id).toBe(
      actual.result.orchestration.telemetry.traceId,
    );
    expect(event.spans.map((span: { op: string }) => span.op).sort()).toEqual([
      "briefstamp.proposal.generate",
      "briefstamp.proposal.validate",
    ]);
    for (const span of event.spans) {
      expect(span.trace_id).toBe(event.contexts.trace.trace_id);
      expect(span.parent_span_id).toBe(event.contexts.trace.span_id);
      expect(Object.keys(span).sort()).toEqual([
        "data",
        "description",
        "op",
        "parent_span_id",
        "span_id",
        "start_timestamp",
        "status",
        "timestamp",
        "trace_id",
      ]);
      expect(span.data).toEqual({
        "briefstamp.checkCount": 1,
        "briefstamp.target": "sample",
      });
    }
    const telemetry = JSON.stringify(actual.envelopes);
    for (const forbidden of [
      "PRIVATE-CLIENT",
      "PRIVATE-PROVIDER",
      "Welcome",
      "requirements",
      "GOOGLE_GEMMA_API_KEY",
      "gemma-4",
      "localhost",
      "http",
    ])
      expect(telemetry).not.toContain(forbidden);
    expect(actual.result.orchestration.maxRssMiB).toBeLessThan(300);
    console.info(
      `Compiled Mastra + local Sentry worker peak RSS: ${actual.result.orchestration.maxRssMiB} MiB`,
    );
  }, 45_000);
});
