import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVIDENCE_AGENT_TASK,
  EvidenceAgentPhaseRequestSchema,
  type EvidenceAgentPhaseRequest,
} from "../server/providers/gemma-evidence-agent.js";
import {
  BackboardGemmaEvidenceError,
  generateBackboardGemmaEvidenceTurn,
} from "../server/providers/backboard-gemma-evidence.js";

// Retained public observations supply inputs; every Backboard response below is
// synthetic. These tests make no claim that a live Backboard request succeeded.
const retained = JSON.parse(
  readFileSync(
    new URL(
      "../docs/evidence/judge-agent/2026-10-16T13-07-24Z/attempt-2/agent-run.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const endpoint = "https://app.backboard.io/api/threads/messages";
const model = "google/gemma-4-26b-a4b-it";
const assistantId = "00000000-0000-4000-8000-000000000001";
const apiKey = ["synthetic", "backboard", "key", "not", "real"].join("-");
const privateMarker = "private-provider-detail-must-not-escape";
type Options = Parameters<typeof generateBackboardGemmaEvidenceTurn>[1];

function input(phase: EvidenceAgentPhaseRequest["phase"] = "select_tools") {
  return EvidenceAgentPhaseRequestSchema.parse({
    phase,
    task: EVIDENCE_AGENT_TASK,
    audit: structuredClone(retained.auditObservation),
    ...(phase === "summarize"
      ? {
          selection: structuredClone(retained.selection),
          observations: structuredClone(retained.observations),
        }
      : {}),
  });
}
function envelope(output: unknown = retained.selection) {
  return {
    status: "COMPLETED",
    content: JSON.stringify(output),
    model_provider: "openrouter",
    model_name: model,
    input_tokens: 518,
    output_tokens: 38,
    total_tokens: 556,
  };
}
function setup() {
  const events: string[] = [];
  const controller = new AbortController();
  const reserve = vi.fn<Options["reserve"]>(async () => {
    events.push("reserved");
  });
  const fetcher = vi.fn<typeof fetch>(async () => {
    events.push("fetch");
    return Response.json(envelope());
  });
  const options: Options = {
    fetcher,
    apiKey,
    assistantId,
    signal: controller.signal,
    reserve,
  };
  return {
    events,
    controller,
    reserve,
    fetcher,
    options,
    run: (request: EvidenceAgentPhaseRequest = input()) =>
      generateBackboardGemmaEvidenceTurn(request, options),
  };
}
async function safeFailure(run: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BackboardGemmaEvidenceError);
  const error = caught as BackboardGemmaEvidenceError;
  expect(error.code).toEqual(expect.any(String));
  expect(Array.isArray(error.attempts)).toBe(true);
  const exposed = `${error.message}\n${JSON.stringify(error)}`;
  expect(exposed).not.toContain(apiKey);
  expect(exposed).not.toContain(privateMarker);
  expect(exposed).not.toContain(EVIDENCE_AGENT_TASK);
  return error;
}

let globalFetch: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  globalFetch = vi.fn<typeof fetch>(async () => {
    throw new Error("Global network transport is forbidden in this test.");
  });
  vi.stubGlobal("fetch", globalFetch);
});
afterEach(() => {
  expect(globalFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("prepared Backboard Gemma evidence adapter (offline contracts only)", () => {
  it("reserves before one exact fixed-scope request and records Backboard provenance", async () => {
    const h = setup();
    const request = input();
    const original = structuredClone(request);
    const result = await h.run(request);
    expect(h.events).toEqual(["reserved", "fetch"]);
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.fetcher).toHaveBeenCalledOnce();
    const [url, init] = h.fetcher.mock.calls[0];
    expect(String(url)).toBe(endpoint);
    expect(init).toMatchObject({ method: "POST", redirect: "error" });
    expect(new Headers(init?.headers).get("x-api-key")).toBe(apiKey);
    expect(new Headers(init?.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(JSON.parse(String(init?.body))).toEqual({
      assistant_id: assistantId,
      content: JSON.stringify(request),
      llm_provider: "openrouter",
      model_name: model,
      system_prompt: expect.any(String),
      stream: false,
      tools: [],
      memory: "off",
      web_search: "off",
      image_generation: "off",
      video_generation: "off",
      send_to_llm: "true",
      json_output: true,
    });
    const body = JSON.parse(String(init?.body));
    expect(body.system_prompt.length).toBeGreaterThan(0);
    expect(body).not.toHaveProperty("thread_id");
    expect(body).not.toHaveProperty("max_tokens");
    const requestSha256 = createHash("sha256")
      .update(String(init?.body))
      .digest("hex");
    expect(h.reserve).toHaveBeenCalledExactlyOnceWith({
      provider: "Backboard",
      transport: "backboard_openrouter_gemma",
      phase: "select_tools",
      assistantId,
      modelProvider: "openrouter",
      model,
      endpoint,
      requestBytes: Buffer.byteLength(String(init?.body)),
      requestSha256,
      credentialSha256: createHash("sha256").update(apiKey).digest("hex"),
      freshThread: true,
    });
    expect(Object.isFrozen(h.reserve.mock.calls[0][0])).toBe(true);
    expect(result).toMatchObject({
      provider: "Backboard",
      transport: "backboard_openrouter_gemma",
      modelProvider: "openrouter",
      model,
      output: retained.selection,
      usage: { inputTokens: 518, outputTokens: 38, totalTokens: 556 },
    });
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      index: 1,
      phase: "select_tools",
      status: 200,
      providerStatus: "COMPLETED",
      requestSha256,
      responseBytes: Buffer.byteLength(JSON.stringify(envelope())),
      responseComplete: true,
      responseSha256: createHash("sha256")
        .update(JSON.stringify(envelope()))
        .digest("hex"),
      retryDelayMs: 0,
    });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(request).toEqual(original);
  });

  it("validates the summary against the supplied observed evidence", async () => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(
      Response.json(envelope(retained.modelOutput)),
    );
    const result = await h.run(input("summarize"));
    expect(result.output).toEqual(retained.modelOutput);
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it.each(["denied", "ambiguous completion"])(
    "does not transport after a %s reservation",
    async () => {
      const h = setup();
      h.reserve.mockRejectedValueOnce(new Error(`${privateMarker}:${apiKey}`));
      const error = await safeFailure(h.run);
      expect(error.reservation).toBe("unconfirmed");
      expect(error.attempts).toEqual([]);
      expect(h.reserve).toHaveBeenCalledOnce();
      expect(h.fetcher).not.toHaveBeenCalled();
    },
  );

  it("waits for reservation fulfillment before transport", async () => {
    const h = setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.reserve.mockReturnValueOnce(pending);
    const result = h.run();
    await Promise.resolve();
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.fetcher).not.toHaveBeenCalled();
    release();
    await result;
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ["unknown task", () => ({ ...input(), task: privateMarker })],
    ["extra prompt", () => ({ ...input(), prompt: privateMarker })],
    [
      "unsupported audit scope",
      () => ({
        ...input(),
        audit: { ...input().audit, url: "https://other.test" },
      }),
    ],
    [
      "unsupported query",
      () => ({
        ...input("summarize"),
        selection: {
          tools: [
            { name: "failure_history", arguments: { queryId: "unknown" } },
          ],
        },
      }),
    ],
    [
      "outside search domain",
      () => ({
        ...input("summarize"),
        observations: [
          { ...retained.observations[1], domain: "unapproved.example" },
        ],
      }),
    ],
  ])("rejects %s before reserving", async (_label, makeInput) => {
    const h = setup();
    await safeFailure(() => h.run(makeInput() as EvidenceAgentPhaseRequest));
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["model provider", { model_provider: "google" }],
    ["model name", { model_name: "google/different-model" }],
    ["unconfirmed status", { status: "PENDING" }],
    ["action-required status", { status: "REQUIRES_ACTION" }],
    ["in-progress status", { status: "IN_PROGRESS" }],
    ["failed status", { status: "FAILED" }],
    ["cancelled status", { status: "CANCELLED" }],
    ["missing status", { status: undefined }],
    ["missing model provider", { model_provider: undefined }],
    ["missing model name", { model_name: undefined }],
  ])(
    "rejects a response with %s mismatch without retrying",
    async (_label, override) => {
      const h = setup();
      h.fetcher.mockResolvedValueOnce(
        Response.json({ ...envelope(), ...override }),
      );
      await safeFailure(h.run);
      expect(h.reserve).toHaveBeenCalledOnce();
      expect(h.fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each([
    [
      "missing usage",
      {
        input_tokens: undefined,
        output_tokens: undefined,
        total_tokens: undefined,
      },
      { inputTokens: null, outputTokens: null, totalTokens: null },
    ],
    [
      "explicit null usage",
      { input_tokens: null, output_tokens: null, total_tokens: null },
      { inputTokens: null, outputTokens: null, totalTokens: null },
    ],
    [
      "missing total",
      { input_tokens: 518, output_tokens: 38, total_tokens: undefined },
      { inputTokens: 518, outputTokens: 38, totalTokens: null },
    ],
    [
      "partial usage",
      { input_tokens: null, output_tokens: 38, total_tokens: 556 },
      { inputTokens: null, outputTokens: 38, totalTokens: 556 },
    ],
  ])(
    "preserves %s honestly without invented counts",
    async (_label, override, usage) => {
      const h = setup();
      h.fetcher.mockResolvedValueOnce(
        Response.json({ ...envelope(), ...override }),
      );
      const result = await h.run();
      expect(result.usage).toEqual(usage);
      expect(h.fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each([
    ["negative usage", { input_tokens: -1 }],
    ["fractional usage", { output_tokens: 1.5 }],
    ["string usage", { total_tokens: "556" }],
    ["inconsistent usage", { total_tokens: 1 }],
  ])("rejects %s", async (_label, override) => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(
      Response.json({ ...envelope(), ...override }),
    );
    await safeFailure(h.run);
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    ["invalid JSON content", "not-json"],
    [
      "unknown tool",
      JSON.stringify({ tools: [{ name: "shell", arguments: {} }] }),
    ],
    [
      "duplicate tools",
      JSON.stringify({
        tools: [retained.selection.tools[0], retained.selection.tools[0]],
      }),
    ],
    [
      "extra selection field",
      JSON.stringify({ tools: [], leaked: privateMarker }),
    ],
  ])("rejects %s without repair requests", async (_label, content) => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(Response.json({ ...envelope(), content }));
    await safeFailure(h.run);
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it("rejects a summary citing an invented result", async () => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(
      Response.json(
        envelope({
          findings: [
            {
              type: "search_snapshot",
              observationId: "tool-2",
              resultCount: 1,
            },
          ],
          abstention: "none",
        }),
      ),
    );
    await safeFailure(() => h.run(input("summarize")));
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it.each([429, 500, 503])(
    "sanitizes HTTP %s and performs no retries",
    async (status) => {
      const h = setup();
      h.fetcher.mockResolvedValueOnce(
        new Response(`${privateMarker}:${apiKey}:${EVIDENCE_AGENT_TASK}`, {
          status,
        }),
      );
      const error = await safeFailure(h.run);
      expect(error.attempts).toHaveLength(1);
      expect(h.reserve).toHaveBeenCalledOnce();
      expect(h.fetcher).toHaveBeenCalledOnce();
    },
  );

  it("rejects malformed response JSON without exposing its body", async () => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(new Response(`${privateMarker}:${apiKey}`));
    const error = await safeFailure(h.run);
    expect(error.reservation).toBe("confirmed");
    expect(error.attempts[0]).toMatchObject({
      responseComplete: true,
      responseSha256: createHash("sha256")
        .update(`${privateMarker}:${apiKey}`)
        .digest("hex"),
    });
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it("rejects an oversized response without retrying", async () => {
    const h = setup();
    h.fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ ...envelope(), padding: "x".repeat(1_000_000) }),
      ),
    );
    const error = await safeFailure(h.run);
    expect(error.reservation).toBe("confirmed");
    expect(error.attempts[0]).toMatchObject({
      responseComplete: false,
      responseSha256: null,
    });
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it("does not label a partially read response hash as a complete provider response", async () => {
    const h = setup();
    const chunk = new TextEncoder().encode('{"status":"COMPLETED",');
    let pulls = 0;
    h.fetcher.mockResolvedValueOnce(
      new Response(
        new ReadableStream<Uint8Array>({
          pull(controller) {
            if (pulls++ === 0) controller.enqueue(chunk);
            else controller.error(new Error(`${privateMarker}:${apiKey}`));
          },
        }),
      ),
    );
    const error = await safeFailure(h.run);
    expect(error.reservation).toBe("confirmed");
    expect(error.attempts[0]).toMatchObject({
      responseBytes: chunk.byteLength,
      responseComplete: false,
      responseSha256: null,
    });
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it("sanitizes network exceptions and consumes only one reservation and attempt", async () => {
    const h = setup();
    h.fetcher.mockRejectedValueOnce(new Error(`${privateMarker}:${apiKey}`));
    const error = await safeFailure(h.run);
    expect(error.attempts).toHaveLength(1);
    expect(error.reservation).toBe("confirmed");
    expect(error.attempts[0]).toMatchObject({
      status: null,
      responseBytes: 0,
      responseComplete: false,
      responseSha256: null,
    });
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it("does not reserve or send an already-aborted request", async () => {
    const h = setup();
    h.controller.abort(new Error(privateMarker));
    const error = await safeFailure(h.run);
    expect(error.reservation).toBe("not_requested");
    expect(error.attempts).toEqual([]);
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("does not send if the signal aborts while reservation is pending", async () => {
    const h = setup();
    h.reserve.mockImplementationOnce(async () => {
      h.controller.abort(new Error(privateMarker));
    });
    const error = await safeFailure(h.run);
    expect(error.reservation).toBe("unconfirmed");
    expect(error.attempts).toEqual([]);
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("combines the caller signal with a fixed 30-second deadline and never retries on expiry", async () => {
    const h = setup();
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    h.fetcher.mockImplementationOnce(() => new Promise<Response>(() => {}));
    const result = safeFailure(h.run);
    await vi.waitFor(() => expect(h.fetcher).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalledExactlyOnceWith(30_000);
    const sentSignal = h.fetcher.mock.calls[0][1]?.signal;
    expect(sentSignal).toBeInstanceOf(AbortSignal);
    expect(sentSignal?.aborted).toBe(false);
    deadline.abort(new Error(privateMarker));
    const error = await result;
    expect(sentSignal?.aborted).toBe(true);
    expect(error.code).toBe("request_timeout");
    expect(error.reservation).toBe("confirmed");
    expect(error.attempts).toHaveLength(1);
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.fetcher).toHaveBeenCalledOnce();
  });
});
