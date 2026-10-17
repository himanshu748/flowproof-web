import { fork } from "node:child_process";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Audit } from "../shared/types.js";
import {
  EVIDENCE_AGENT_TASK,
  EvidenceAgentError,
  evidenceModelTraceAttributes,
  executeEvidenceAgent,
  type EvidenceAgentReceipt,
  type EvidenceAgentDependencies,
} from "../server/evidence-agent.js";
import {
  executeMastraEvidenceAgent,
  type MastraEvidenceReceipt,
} from "../server/mastra-evidence-agent.js";
import {
  generateGemmaEvidenceTurn,
  GemmaEvidenceProviderError,
} from "../server/providers/gemma-evidence-agent.js";
import { BackboardGemmaEvidenceError } from "../server/providers/backboard-gemma-evidence.js";
import type {
  RuntimeTraceRecorder,
  SafeRuntimeAttributes,
} from "../server/runtime-trace.js";

vi.mock("node:child_process", async (original) => ({
  ...(await original<typeof import("node:child_process")>()),
  fork: vi.fn(),
}));
vi.mock("../server/providers/gemma-evidence-agent.js", async (original) => ({
  ...(await original<
    typeof import("../server/providers/gemma-evidence-agent.js")
  >()),
  generateGemmaEvidenceTurn: vi.fn(),
}));
const read = <T>(path: string): T =>
  JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const nativeDir = "docs/evidence/hosted-evidence-agent/2026-10-16T12-14-14Z";
const backboardDir = "docs/evidence/mastra/2026-10-17T04-08-48Z";
const native = read<EvidenceAgentReceipt>(`${nativeDir}/agent-run.json`);
const backboard = read<MastraEvidenceReceipt>(`${backboardDir}/agent-run.json`);
const input = (directory = nativeDir) => ({
  audit: read<Audit>(`${directory}/source-audit.json`),
  task: EVIDENCE_AGENT_TASK,
});
function traceRecorder() {
  const events: Array<{
    op: string;
    attributes: SafeRuntimeAttributes;
    failed: boolean;
  }> = [];
  const recorder = {
    span: async <T>(
      op: string,
      fn: () => Promise<T>,
      attrs?: SafeRuntimeAttributes | ((result: T) => SafeRuntimeAttributes),
    ) => {
      let value: T | undefined;
      let failed = true;
      try {
        value = await fn();
        failed = false;
        return value;
      } finally {
        events.push({
          op,
          failed,
          attributes:
            typeof attrs === "function"
              ? failed
                ? {}
                : attrs(value!)
              : { ...attrs },
        });
      }
    },
  } as RuntimeTraceRecorder;
  return { recorder, events };
}
function dependencies(audit: Audit, fixture = native) {
  const history = fixture.observations.find(
    (observation) => observation.type === "failure_history",
  );
  const search = fixture.observations.find(
    (observation) => observation.type === "search_visibility",
  );
  if (
    history?.status !== "observed" ||
    history.type !== "failure_history" ||
    search?.status !== "observed" ||
    search.type !== "search_visibility"
  )
    throw new Error("Retained fixture missing observations");
  return {
    failureHistory: vi.fn(async () =>
      history.rows.map((row) => ({ ...row, projectId: audit.projectId })),
    ),
    searchVisibility: vi.fn(async () => ({
      provider: "SerpApi",
      domain: search.domain,
      query: search.query,
      status: "observed" as const,
      observedAt: search.observedAt,
      results: [],
      limitation: "Recorded fixture, no new search",
    })),
    now: () => Date.parse("2026-10-17T05:00:00Z"),
  } satisfies EvidenceAgentDependencies;
}
// This IPC fixture exercises the parent transport boundaries. Real Agent SDK
// ownership is covered separately by mastra-evidence-runtime.test.ts.
function installChildProtocol() {
  vi.mocked(fork).mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      connected: true,
      send: vi.fn(),
      kill: vi.fn(),
    });
    let audit: unknown;
    let selection: any;
    const observations: any[] = [];
    const request = (
      id: number,
      operation: "model" | "tool",
      payload: unknown,
    ) =>
      queueMicrotask(() =>
        child.emit("message", { type: "request", id, operation, payload }),
      );
    child.kill.mockImplementation(() => {
      child.connected = false;
      queueMicrotask(() => child.emit("close", 1));
      return true;
    });
    child.send.mockImplementation((message: any) => {
      if (message.type === "start") {
        audit = message.input.audit;
        request(1, "model", {
          phase: "select_tools",
          task: EVIDENCE_AGENT_TASK,
          audit,
        });
      } else if (message.ok && message.id === 1) {
        selection = message.result.output;
        request(2, "tool", { entry: selection.tools[0], id: "tool-1" });
      } else if (message.ok && message.id === 2) {
        observations.push(message.result);
        request(3, "tool", { entry: selection.tools[1], id: "tool-2" });
      } else if (message.ok && message.id === 3) {
        observations.push(message.result);
        request(4, "model", {
          phase: "summarize",
          task: EVIDENCE_AGENT_TASK,
          audit,
          selection,
          observations,
        });
      } else if (message.ok && message.id === 4) {
        queueMicrotask(() => {
          child.emit("message", {
            type: "done",
            result: {
              selection,
              observations,
              modelOutput: message.result.output,
              sdk: { provider: "Mastra Agent", fixture: true },
            },
          });
          child.emit("close", 0);
        });
      }
      return true;
    });
    return child as unknown as ReturnType<typeof fork>;
  });
}
let forbiddenFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  forbiddenFetch = vi.fn(async () => {
    throw new Error("No network in tracing tests");
  });
  vi.stubGlobal("fetch", forbiddenFetch);
  vi.mocked(generateGemmaEvidenceTurn).mockImplementation(async (request) =>
    structuredClone(
      native.modelTurns.find((turn) => turn.phase === request.phase)!.result!,
    ),
  );
  installChildProtocol();
});
afterEach(() => {
  expect(forbiddenFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
const ops = [
  "briefstamp.agent.model.select_tools",
  "briefstamp.agent.tool.failure_history",
  "briefstamp.agent.tool.search_visibility",
  "briefstamp.agent.model.summarize",
];
function assertPrivateFree(events: unknown, audit: Audit) {
  const text = JSON.stringify(events);
  for (const value of [
    audit.id,
    audit.projectId,
    audit.source!.brief,
    "https:",
    "observedAt",
    "requestSha256",
    "output",
  ])
    expect(text).not.toContain(value === "output" ? '"output":' : value);
}

describe("evidence runtime tracing without transport replacement", () => {
  it("preserves native receipt and exactly-once callbacks while tracing all four real boundaries", async () => {
    const request = input();
    const original = structuredClone(request.audit);
    const base = await executeEvidenceAgent(
      request,
      dependencies(request.audit),
    );
    vi.mocked(generateGemmaEvidenceTurn).mockClear();
    const t = traceRecorder();
    const deps = dependencies(request.audit);
    const traced = await executeEvidenceAgent(request, {
      ...deps,
      trace: t.recorder,
    });
    expect(traced).toEqual(base);
    expect(traced.transport).toBe("native_google_gemma");
    expect(request.audit).toEqual(original);
    expect(generateGemmaEvidenceTurn).toHaveBeenCalledTimes(2);
    expect(deps.failureHistory).toHaveBeenCalledOnce();
    expect(deps.searchVisibility).toHaveBeenCalledOnce();
    expect(t.events.map((event) => event.op)).toEqual(ops);
    const attempt = native.modelTurns[0].result!.attempts[0];
    expect(t.events[0].attributes).toEqual({
      provider: "Google",
      model: "gemma-4-26b-a4b-it",
      inputTokens: attempt.usage!.promptTokens,
      outputTokens: attempt.usage!.completionTokens,
      totalTokens: attempt.usage!.totalTokens,
      modelLatencyMs: attempt.durationMs,
    });
    assertPrivateFree(t.events, request.audit);
  });

  it.each(["Google", "Backboard"] as const)(
    "traces Mastra %s without changing reservation order or receipt transport",
    async (provider) => {
      const request = input(
        provider === "Backboard" ? backboardDir : nativeDir,
      );
      const fixture = provider === "Backboard" ? backboard : native;
      const t = traceRecorder();
      const events: string[] = [];
      const deps = dependencies(request.audit, fixture);
      const backboardGenerate =
        provider === "Backboard"
          ? vi.fn(
              async (
                phase: Parameters<typeof generateGemmaEvidenceTurn>[0],
              ) => {
                events.push(`model:${phase.phase}`);
                return structuredClone(
                  backboard.backboardModelTurns!.find(
                    (turn) => turn.phase === phase.phase,
                  )!.result!,
                );
              },
            )
          : undefined;
      if (provider === "Google")
        vi.mocked(generateGemmaEvidenceTurn).mockImplementation(
          async (phase) => {
            events.push(`model:${phase.phase}`);
            return structuredClone(
              native.modelTurns.find((turn) => turn.phase === phase.phase)!
                .result!,
            );
          },
        );
      const result = await executeMastraEvidenceAgent(request, {
        ...deps,
        trace: t.recorder,
        backboardGenerate,
        reserveExternal: async (operation) => {
          events.push(`reserve:${operation}`);
        },
      });
      expect(result.status).toBe("completed");
      expect(result.transport).toBe(
        provider === "Backboard"
          ? "backboard_openrouter_gemma"
          : "native_google_gemma",
      );
      expect(result.modelOutput).toEqual(fixture.modelOutput);
      expect(result.sourceAuditUnchanged).toBe(true);
      expect(t.events.map((event) => event.op)).toEqual(ops);
      expect(t.events[0].attributes.provider).toBe(provider);
      expect(events).toEqual([
        "reserve:select_tools",
        "model:select_tools",
        "reserve:failure_history",
        "reserve:search_visibility",
        "reserve:summarize",
        "model:summarize",
      ]);
      expect(deps.failureHistory).toHaveBeenCalledOnce();
      expect(deps.searchVisibility).toHaveBeenCalledOnce();
      if (provider === "Backboard") {
        expect(result.modelTurns).toEqual([]);
        expect(backboardGenerate).toHaveBeenCalledTimes(2);
        expect(generateGemmaEvidenceTurn).not.toHaveBeenCalled();
        const actual = backboard.backboardModelTurns![0].result!;
        expect(t.events[0].attributes).toEqual({
          provider: "Backboard",
          model: actual.model,
          ...actual.usage,
          modelLatencyMs: actual.attempts[0].durationMs,
        });
      }
      assertPrivateFree(t.events, request.audit);
    },
  );

  it("retains failed native usage and fails without a retry or tool call", async () => {
    const request = input(),
      deps = dependencies(request.audit),
      t = traceRecorder();
    const attempt = {
      ...structuredClone(native.modelTurns[0].result!.attempts[0]),
      status: 500,
      usage: null,
    };
    vi.mocked(generateGemmaEvidenceTurn).mockRejectedValueOnce(
      new GemmaEvidenceProviderError("provider_rejected", [attempt]),
    );
    await expect(
      executeEvidenceAgent(request, { ...deps, trace: t.recorder }),
    ).rejects.toMatchObject({
      code: "provider_rejected",
      receipt: { transport: "native_google_gemma", status: "failed" },
    });
    expect(generateGemmaEvidenceTurn).toHaveBeenCalledOnce();
    expect(deps.failureHistory).not.toHaveBeenCalled();
    expect(deps.searchVisibility).not.toHaveBeenCalled();
    expect(t.events).toEqual([
      {
        op: ops[0],
        failed: true,
        attributes: {
          provider: "Google",
          model: attempt.model,
          modelLatencyMs: attempt.durationMs,
        },
      },
    ]);
  });

  it("retains failed Backboard receipt without native fallback or extra calls", async () => {
    const request = input(backboardDir),
      deps = dependencies(request.audit, backboard),
      t = traceRecorder();
    const actual = backboard.backboardModelTurns![0].result!;
    const rejected = vi.fn(async () => {
      throw new BackboardGemmaEvidenceError(
        "provider_rejected",
        [{ ...actual.attempts[0], status: 500 }],
        "confirmed",
      );
    });
    await expect(
      executeMastraEvidenceAgent(request, {
        ...deps,
        trace: t.recorder,
        backboardGenerate: rejected,
      }),
    ).rejects.toBeInstanceOf(EvidenceAgentError);
    expect(rejected).toHaveBeenCalledOnce();
    expect(generateGemmaEvidenceTurn).not.toHaveBeenCalled();
    expect(deps.failureHistory).not.toHaveBeenCalled();
    expect(t.events[0]).toMatchObject({
      op: ops[0],
      failed: true,
      attributes: {
        provider: "Backboard",
        inputTokens: actual.usage.inputTokens,
      },
    });
  });

  it("keeps unavailable tools unavailable and records the failed boundary once", async () => {
    const request = input(),
      deps = dependencies(request.audit),
      t = traceRecorder();
    deps.searchVisibility.mockRejectedValueOnce(
      new Error("Private provider failure must not be traced"),
    );
    vi.mocked(generateGemmaEvidenceTurn).mockImplementation(async (phase) => ({
      ...structuredClone(
        native.modelTurns.find((turn) => turn.phase === phase.phase)!.result!,
      ),
      ...(phase.phase === "summarize"
        ? { output: { findings: [], abstention: "tools_unavailable" } }
        : {}),
    }));
    const result = await executeEvidenceAgent(request, {
      ...deps,
      trace: t.recorder,
    });
    expect(result.status).toBe("completed_with_unavailable_tools");
    expect(result.observations[1]).toMatchObject({
      status: "unavailable",
      failureCode: "tool_unavailable",
    });
    expect(t.events[2]).toEqual({
      op: ops[2],
      failed: true,
      attributes: { tool: "search_visibility" },
    });
    expect(deps.searchVisibility).toHaveBeenCalledOnce();
    expect(JSON.stringify(t.events)).not.toContain("Private");
  });

  it("omits unknown usage and does not turn native retry latency into a physical request duration", () => {
    const known = {
      durationMs: 7,
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    };
    expect(
      evidenceModelTraceAttributes("Google", [
        known,
        { durationMs: 12, usage: null },
      ]),
    ).toEqual({ provider: "Google", model: "gemma-4-26b-a4b-it" });
    expect(evidenceModelTraceAttributes("Google", [known, known])).toEqual({
      provider: "Google",
      model: "gemma-4-26b-a4b-it",
      inputTokens: 20,
      outputTokens: 10,
      totalTokens: 30,
    });
    expect(
      evidenceModelTraceAttributes("Backboard", [
        {
          durationMs: 9,
          usage: { inputTokens: null, outputTokens: 0, totalTokens: null },
        },
      ]),
    ).toEqual({
      provider: "Backboard",
      model: "google/gemma-4-26b-a4b-it",
      outputTokens: 0,
      modelLatencyMs: 9,
    });
    expect(evidenceModelTraceAttributes("Google", [])).toEqual({
      provider: "Google",
      model: "gemma-4-26b-a4b-it",
    });
  });
});
