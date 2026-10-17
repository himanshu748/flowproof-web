import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackboardMemoryAnswerError,
  executeBackboardMemoryAnswer,
  validateBackboardMemoryAnswer,
} from "../server/providers/backboard-memory-answer.js";

// Real retained structured memory; all transport responses below are injected.
// Test completion is not new live Backboard persistence or inference evidence.
const receipt = JSON.parse(
  readFileSync(
    new URL(
      "../docs/evidence/hosted-optional/2026-10-16T09-13-12Z/backboard-search.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
interface Fact {
  kind: string;
  status: string;
}
interface SourceMemory {
  format: string;
  project: string;
  audit: string;
  observedAt: string;
  facts: Fact[];
}
const { score: _score, ...stored } = receipt.memories[0];
const memory = stored as SourceMemory;
const content = JSON.stringify(memory);
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const assistantId = "00000000-0000-4000-8000-000000000001";
const providerMemoryId = "00000000-0000-4000-8000-000000000002";
const apiKey = ["synthetic", "backboard", "key", "not", "real"].join("-");
const secret = ["private", "provider", "details", "not", "for", "output"].join(
  "-",
);
const question = "What failed on mobile and was it fixed?";
const model = "google/gemma-4-26b-a4b-it";
type Scope = Parameters<typeof executeBackboardMemoryAnswer>[0];
type Options = Parameters<typeof executeBackboardMemoryAnswer>[1];
type Result = Awaited<ReturnType<typeof executeBackboardMemoryAnswer>>;
type RetrievedFact = Result["facts"][number];
const scope = (): Scope => ({
  projectScope: memory.project,
  auditScope: memory.audit,
  expectedFactsSha256: hash(
    JSON.stringify(memory.facts.map(({ kind, status }) => ({ kind, status }))),
  ),
});
function assertions(facts: RetrievedFact[]) {
  const mobile = facts.find((fact) => fact.kind === "no_horizontal_overflow");
  if (!mobile) throw new Error("Expected retained mobile fact missing.");
  return {
    claims: [
      { factId: mobile.factId, kind: mobile.kind, status: mobile.status },
    ],
    resolution: "not_proven_by_retrieved_facts",
    supportingFactIds: facts.map((fact) => fact.factId),
  };
}
function modelEnvelope(output: unknown) {
  return {
    status: "COMPLETED",
    content: JSON.stringify(output),
    model_provider: "openrouter",
    model_name: model,
    input_tokens: 801,
    output_tokens: 103,
    total_tokens: 904,
  };
}
function harness(
  overrides: {
    memories?: unknown[];
    answer?: (facts: RetrievedFact[]) => unknown;
    envelope?: Record<string, unknown>;
  } = {},
) {
  const events: string[] = [];
  const controller = new AbortController();
  const reserve = vi.fn<Options["reserve"]>(async (request) => {
    events.push(`reserve:${request.operation}`);
  });
  const fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (String(url).endsWith("/memories/search")) {
      events.push("fetch:memory_search");
      return Response.json({
        memories: overrides.memories ?? [
          { content, id: providerMemoryId, score: 0.33153504 },
        ],
      });
    }
    events.push("fetch:answer");
    const body = JSON.parse(String(init?.body));
    const sent = JSON.parse(body.content) as {
      question: string;
      facts: RetrievedFact[];
    };
    return Response.json({
      ...modelEnvelope(
        overrides.answer
          ? overrides.answer(sent.facts)
          : assertions(sent.facts),
      ),
      ...overrides.envelope,
    });
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
    run: (requestedScope = scope()) =>
      executeBackboardMemoryAnswer(requestedScope, options),
  };
}
async function failed(run: () => Promise<unknown>) {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeInstanceOf(BackboardMemoryAnswerError);
  const error = caught as BackboardMemoryAnswerError;
  expect(error.code).toEqual(expect.any(String));
  expect(Array.isArray(error.attempts)).toBe(true);
  expect(Array.isArray(error.facts)).toBe(true);
  const exposed = `${error.message}\n${JSON.stringify(error)}`;
  expect(exposed).not.toContain(apiKey);
  expect(exposed).not.toContain(secret);
  return error;
}
let globalFetch: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  globalFetch = vi.fn<typeof fetch>(async () => {
    throw new Error("Global network forbidden in memory-answer tests");
  });
  vi.stubGlobal("fetch", globalFetch);
});
afterEach(() => {
  expect(globalFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Backboard memory answer over six retained facts (offline)", () => {
  it("independently replays the same strict citation validation without transport", async () => {
    const h = harness();
    const result = await h.run();
    const original = structuredClone(result);
    expect(
      validateBackboardMemoryAnswer(result.modelAssertions, result.facts),
    ).toEqual(result.modelAssertions);
    expect(result).toEqual(original);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    "changed_status",
    "phantom_fact",
    "missing_mobile",
    "duplicate_support",
    "fixed_claim",
  ])("rejects independent checker replay with %s", async (mutation) => {
    const { facts, modelAssertions } = await harness().run();
    const modified = structuredClone(modelAssertions);
    if (mutation === "changed_status") modified.claims[0].status = "passed";
    if (mutation === "phantom_fact")
      modified.claims[0].factId = `app-fact-${"e".repeat(64)}`;
    if (mutation === "missing_mobile") {
      const heading = facts[0];
      modified.claims = [
        { factId: heading.factId, kind: heading.kind, status: heading.status },
      ];
    }
    if (mutation === "duplicate_support")
      modified.supportingFactIds[1] = modified.supportingFactIds[0];
    const output =
      mutation === "fixed_claim"
        ? { ...modified, resolution: "fixed" }
        : modified;
    expect(() => validateBackboardMemoryAnswer(output, facts)).toThrowError(
      BackboardMemoryAnswerError,
    );
  });

  it("refuses an incomplete or conflicting fact set during independent replay", async () => {
    const { facts, modelAssertions } = await harness().run();
    expect(() =>
      validateBackboardMemoryAnswer(modelAssertions, facts.slice(1)),
    ).toThrowError(BackboardMemoryAnswerError);
    const conflict = structuredClone(facts);
    conflict[3].status = "passed";
    expect(() =>
      validateBackboardMemoryAnswer(modelAssertions, conflict),
    ).toThrowError(BackboardMemoryAnswerError);
  });

  it("preserves the actual provider id with unknown retrieval score", async () => {
    const result = await harness({
      memories: [{ content, id: providerMemoryId, score: null }],
    }).run();
    expect(result.retrieval.providerMemoryId).toBe(providerMemoryId);
    expect(
      result.facts.every((fact) => fact.providerMemoryId === providerMemoryId),
    ).toBe(true);
    expect(result.facts.every((fact) => fact.factId !== providerMemoryId)).toBe(
      true,
    );
  });

  it("retrieves once, reserves answer separately, and grounds the answer in the exact six facts", async () => {
    const h = harness();
    const result = await h.run();
    expect(h.events).toEqual([
      "reserve:memory_search",
      "fetch:memory_search",
      "reserve:answer",
      "fetch:answer",
    ]);
    expect(h.reserve).toHaveBeenCalledTimes(2);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    const [searchUrl, searchInit] = h.fetcher.mock.calls[0];
    expect(String(searchUrl)).toBe(
      `https://app.backboard.io/api/assistants/${assistantId}/memories/search`,
    );
    expect(searchInit).toMatchObject({ method: "POST", redirect: "error" });
    const searchBody = JSON.parse(String(searchInit?.body));
    expect(searchBody).toEqual({ query: expect.any(String), limit: 5 });
    expect(searchBody.query).toContain(memory.project);
    expect(searchBody.query).toContain(memory.audit);
    expect(searchBody.query).toContain("no_horizontal_overflow");
    const [answerUrl, answerInit] = h.fetcher.mock.calls[1];
    expect(String(answerUrl)).toBe(
      "https://app.backboard.io/api/threads/messages",
    );
    expect(answerInit).toMatchObject({ method: "POST", redirect: "error" });
    expect(JSON.parse(String(answerInit?.body))).toEqual({
      assistant_id: assistantId,
      content: JSON.stringify({ question, facts: result.facts }),
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
    for (const [, init] of h.fetcher.mock.calls) {
      expect(new Headers(init?.headers).get("x-api-key")).toBe(apiKey);
      expect(new Headers(init?.headers).get("content-type")).toBe(
        "application/json",
      );
    }
    expect(result).toMatchObject({
      provider: "Backboard",
      modelProvider: "openrouter",
      model,
      question,
      usage: { inputTokens: 801, outputTokens: 103, totalTokens: 904 },
    });
    expect(result.facts).toHaveLength(6);
    expect(new Set(result.facts.map((fact) => fact.factId)).size).toBe(6);
    result.facts.forEach((fact, index) => {
      expect(fact).toMatchObject({
        ...memory.facts[index],
        index,
        providerMemoryId,
        contentSha256: hash(content),
        projectScope: memory.project,
        auditScope: memory.audit,
        observedAt: memory.observedAt,
      });
      expect(fact.factId).toMatch(/^app-fact-[a-f0-9]{64}$/);
      expect(fact.factId).toBe(
        `app-fact-${hash(JSON.stringify({ contentSha256: hash(content), index }))}`,
      );
      expect(fact.factId).not.toBe(providerMemoryId);
    });
    expect(result.modelAssertions).toEqual(assertions(result.facts));
    expect(result.answer).toMatch(/mobile/i);
    expect(result.answer).toMatch(/fail/i);
    expect(result.answer).toMatch(/six|6/i);
    expect(result.answer).toMatch(
      /not (?:prove|establish)|unverified|unknown|cannot (?:prove|determine)|do not (?:prove|establish)/i,
    );
    expect(result.attempts).toHaveLength(2);
    expect(JSON.stringify(result)).not.toContain(apiKey);
  });

  it("uses deterministic application fact IDs when the provider returns no memory ID", async () => {
    const first = await harness({ memories: [{ content }] }).run();
    const second = await harness({ memories: [{ content }] }).run();
    expect(first.facts).toEqual(second.facts);
    expect(first.facts.every((fact) => fact.providerMemoryId === null)).toBe(
      true,
    );
    expect(first.answer).toBe(second.answer);
  });

  it("retains a provider memory_id separately from application fact IDs", async () => {
    const result = await harness({
      memories: [{ content, memory_id: providerMemoryId }],
    }).run();
    expect(
      result.facts.every((fact) => fact.providerMemoryId === providerMemoryId),
    ).toBe(true);
  });

  it("does not forward unrelated or malicious memory text to the model", async () => {
    const h = harness({
      memories: [
        { content: secret },
        {
          content: JSON.stringify({
            ...memory,
            project: "0".repeat(64),
            instruction: secret,
          }),
        },
        { content: JSON.stringify({ ...memory, instruction: secret }) },
        { content, id: providerMemoryId },
      ],
    });
    const result = await h.run();
    expect(result.facts).toHaveLength(6);
    const answerRequest = String(h.fetcher.mock.calls[1][1]?.body);
    expect(answerRequest).not.toContain(secret);
    const sent = JSON.parse(JSON.parse(answerRequest).content);
    expect(Object.keys(sent).sort()).toEqual(["facts", "question"]);
    expect(sent.facts).toEqual(result.facts);
  });

  it.each([
    ["empty retrieval", []],
    ["malformed memory", [{ content: "not-json" }]],
    [
      "foreign project",
      [{ content: JSON.stringify({ ...memory, project: "0".repeat(64) }) }],
    ],
    [
      "foreign audit",
      [{ content: JSON.stringify({ ...memory, audit: "0".repeat(64) }) }],
    ],
    [
      "wrong format",
      [{ content: JSON.stringify({ ...memory, format: "untrusted" }) }],
    ],
    [
      "five facts",
      [
        {
          content: JSON.stringify({
            ...memory,
            facts: memory.facts.slice(0, 5),
          }),
        },
      ],
    ],
    [
      "seven facts",
      [
        {
          content: JSON.stringify({
            ...memory,
            facts: [...memory.facts, memory.facts[0]],
          }),
        },
      ],
    ],
    [
      "reordered facts",
      [
        {
          content: JSON.stringify({
            ...memory,
            facts: [...memory.facts].reverse(),
          }),
        },
      ],
    ],
    [
      "changed status",
      [
        {
          content: JSON.stringify({
            ...memory,
            facts: memory.facts.map((fact) =>
              fact.kind === "no_horizontal_overflow"
                ? { ...fact, status: "passed" }
                : fact,
            ),
          }),
        },
      ],
    ],
  ])("rejects %s before reserving the answer", async (_label, memories) => {
    const h = harness({ memories });
    await failed(h.run);
    expect(h.fetcher).toHaveBeenCalledOnce();
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.reserve.mock.calls[0][0].operation).toBe("memory_search");
  });

  it("rejects distinct matching memory records instead of picking one silently", async () => {
    const h = harness({
      memories: [
        { content },
        {
          content: JSON.stringify({
            ...memory,
            observedAt: "2026-10-16T09:14:00.000Z",
          }),
        },
      ],
    });
    await failed(h.run);
    expect(h.fetcher).toHaveBeenCalledOnce();
    expect(h.reserve).toHaveBeenCalledOnce();
  });

  it("deduplicates identical memory records without duplicating facts", async () => {
    const result = await harness({
      memories: [{ content }, { content }],
    }).run();
    expect(result.facts).toHaveLength(6);
    expect(new Set(result.facts.map((fact) => fact.factId)).size).toBe(6);
  });

  it("rejects identical content associated with distinct provider memory identities", async () => {
    const h = harness({
      memories: [
        { content, id: providerMemoryId },
        { content, id: "00000000-0000-4000-8000-000000000003" },
      ],
    });
    await failed(h.run);
    expect(h.fetcher).toHaveBeenCalledOnce();
    expect(h.reserve).toHaveBeenCalledOnce();
  });

  it.each([
    { id: `${secret}\nunsafe` },
    { id: providerMemoryId, memory_id: "00000000-0000-4000-8000-000000000003" },
  ])(
    "discards memory with unsafe or conflicting provider IDs: %j",
    async (ids) => {
      const h = harness({ memories: [{ content, ...ids }] });
      await failed(h.run);
      expect(h.fetcher).toHaveBeenCalledOnce();
      expect(h.reserve).toHaveBeenCalledOnce();
    },
  );

  it.each([
    { projectScope: "not-a-scope-hash" },
    { auditScope: "not-a-scope-hash" },
    { expectedFactsSha256: "not-a-hash" },
    { extra: "untrusted" },
  ])("rejects invalid scope before reservations: %j", async (override) => {
    const h = harness();
    await failed(() => h.run({ ...scope(), ...override } as Scope));
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("does not infer scope from returned memory when the expected facts hash differs", async () => {
    const h = harness();
    await failed(() =>
      h.run({ ...scope(), expectedFactsSha256: "0".repeat(64) }),
    );
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it.each([
    [
      "unknown citation",
      (facts: RetrievedFact[]) => ({
        ...assertions(facts),
        claims: [
          {
            ...assertions(facts).claims[0],
            factId: `app-fact-${"0".repeat(64)}`,
          },
        ],
      }),
    ],
    [
      "wrong status",
      (facts: RetrievedFact[]) => ({
        ...assertions(facts),
        claims: [{ ...assertions(facts).claims[0], status: "passed" }],
      }),
    ],
    [
      "wrong kind",
      (facts: RetrievedFact[]) => ({
        ...assertions(facts),
        claims: [{ ...assertions(facts).claims[0], kind: "heading" }],
      }),
    ],
    [
      "missing mobile failure",
      (facts: RetrievedFact[]) => ({ ...assertions(facts), claims: [] }),
    ],
    [
      "duplicate claims",
      (facts: RetrievedFact[]) => ({
        ...assertions(facts),
        claims: [assertions(facts).claims[0], assertions(facts).claims[0]],
      }),
    ],
    [
      "claimed repair",
      (facts: RetrievedFact[]) => ({
        ...assertions(facts),
        resolution: "fixed",
      }),
    ],
    [
      "missing support",
      (facts: RetrievedFact[]) => ({
        ...assertions(facts),
        supportingFactIds: facts.slice(0, 5).map((fact) => fact.factId),
      }),
    ],
    [
      "duplicate support",
      (facts: RetrievedFact[]) => ({
        ...assertions(facts),
        supportingFactIds: facts.map(() => facts[0].factId),
      }),
    ],
    [
      "unknown support",
      (facts: RetrievedFact[]) => ({
        ...assertions(facts),
        supportingFactIds: [
          ...facts.slice(0, 5).map((fact) => fact.factId),
          `app-fact-${"0".repeat(64)}`,
        ],
      }),
    ],
    [
      "invented prose",
      (facts: RetrievedFact[]) => ({ ...assertions(facts), answer: secret }),
    ],
  ])("rejects %s without a repair model call", async (_label, answer) => {
    const h = harness({ answer });
    const error = await failed(h.run);
    expect(error.facts).toHaveLength(6);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.reserve).toHaveBeenCalledTimes(2);
  });

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
      "null usage",
      { input_tokens: null, output_tokens: null, total_tokens: null },
      { inputTokens: null, outputTokens: null, totalTokens: null },
    ],
    [
      "missing total",
      { total_tokens: undefined },
      { inputTokens: 801, outputTokens: 103, totalTokens: null },
    ],
    [
      "partial usage",
      { input_tokens: null },
      { inputTokens: null, outputTokens: 103, totalTokens: 904 },
    ],
  ])(
    "preserves %s without inventing charges or token counts",
    async (_label, envelope, usage) => {
      const result = await harness({ envelope }).run();
      expect(result.usage).toEqual(usage);
    },
  );

  it.each([
    { model_provider: "google" },
    { model_name: "google/another-model" },
    { status: "FAILED" },
    { status: "REQUIRES_ACTION" },
    { content: "not-json" },
    { input_tokens: -1 },
    { total_tokens: 1 },
  ])("rejects invalid provider output %j with no retries", async (envelope) => {
    const h = harness({ envelope });
    await failed(h.run);
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    expect(h.reserve).toHaveBeenCalledTimes(2);
  });

  it("does not search after an ambiguous first reservation", async () => {
    const h = harness();
    h.reserve.mockRejectedValueOnce(new Error(`${secret}:${apiKey}`));
    const error = await failed(h.run);
    expect(error.attempts).toEqual([]);
    expect(error.reservations).toEqual({
      memory_search: "unconfirmed",
      answer: "not_requested",
    });
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("retains retrieved facts but does not infer after an ambiguous answer reservation", async () => {
    const h = harness();
    h.reserve.mockImplementation(async (request) => {
      if (request.operation === "answer")
        throw new Error(`${secret}:${apiKey}`);
    });
    const error = await failed(h.run);
    expect(error.facts).toHaveLength(6);
    expect(error.attempts).toHaveLength(1);
    expect(error.reservations).toEqual({
      memory_search: "confirmed",
      answer: "unconfirmed",
    });
    expect(h.reserve).toHaveBeenCalledTimes(2);
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it.each([400, 401, 500])(
    "sanitizes memory HTTP %s without invoking the model",
    async (status) => {
      const h = harness();
      h.fetcher.mockResolvedValueOnce(
        new Response(`${secret}:${apiKey}`, { status }),
      );
      const error = await failed(h.run);
      expect(error.attempts).toHaveLength(1);
      expect(h.reserve).toHaveBeenCalledOnce();
      expect(h.fetcher).toHaveBeenCalledOnce();
    },
  );

  it.each([400, 401, 500])(
    "sanitizes model HTTP %s and retains the valid retrieved facts",
    async (status) => {
      const h = harness();
      h.fetcher.mockResolvedValueOnce(
        Response.json({ memories: [{ content }] }),
      );
      h.fetcher.mockResolvedValueOnce(
        new Response(`${secret}:${apiKey}`, { status }),
      );
      const error = await failed(h.run);
      expect(error.facts).toHaveLength(6);
      expect(error.attempts).toHaveLength(2);
      expect(h.fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it("sanitizes search transport errors and does not retry", async () => {
    const h = harness();
    h.fetcher.mockRejectedValueOnce(new Error(`${secret}:${apiKey}`));
    await failed(h.run);
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it("does not reserve an already-aborted request", async () => {
    const h = harness();
    h.controller.abort(new Error(secret));
    const error = await failed(h.run);
    expect(error.attempts).toEqual([]);
    expect(error.reservations).toEqual({
      memory_search: "not_requested",
      answer: "not_requested",
    });
    expect(h.reserve).not.toHaveBeenCalled();
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("does not transport after cancellation during a reservation", async () => {
    const h = harness();
    h.reserve.mockImplementationOnce(async () =>
      h.controller.abort(new Error(secret)),
    );
    await failed(h.run);
    expect(h.reserve).toHaveBeenCalledOnce();
    expect(h.fetcher).not.toHaveBeenCalled();
  });
});
