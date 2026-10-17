import express from "express";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backboardAnswerHttpBoundary, createDemoRouter } from "../server/demo";
import {
  BACKBOARD_MEMORY_QUESTION,
  BACKBOARD_MEMORY_RECORDED_SCOPE,
  BackboardMemoryAnswerError,
  type BackboardMemoryAnswerResult,
  type BackboardMemoryAttempt,
  type BackboardMemoryReservationRequest,
  type executeBackboardMemoryAnswer,
} from "../server/providers/backboard-memory-answer";
import { BACKBOARD_GEMMA_EVIDENCE_MODEL } from "../server/providers/backboard-gemma-evidence";
import type { runAudit } from "../server/runner";
import type { Audit, Bootstrap, CheckResult, Project } from "../shared/types";

// Route policy only: the audit runner, Tiger store, allowance and provider are
// injected fixtures. Network use is limited to this loopback HTTP test server.
const gate = vi.hoisted(() => ({
  authorize: vi.fn(),
  configuration: vi.fn(),
  reserveRun: vi.fn(),
  reserveCall: vi.fn(),
}));
vi.mock("../server/backboard-answer-gate", () => ({
  authorizeBackboardAnswer: gate.authorize,
  backboardAnswerConfiguration: gate.configuration,
  reserveBackboardAnswerRun: gate.reserveRun,
  reserveBackboardAnswerCall: gate.reserveCall,
}));
const NOW = Date.parse("2026-10-17T08:00:00.000Z");
const TOKEN = ["synthetic", "operator", "token", "not", "a", "real", "credential"].join("-");
const TRANCHE = "927035df-87a0-4c3d-835a-faa6c66f0e68";
const ASSISTANT = "f2ed435a-2700-4a61-9f05-814b29d32bd7";
const KEY = ["synthetic", "provider", "key", "never", "dispatched"].join("-");
const config = {
  proof: {
    trancheId: TRANCHE,
    ...BACKBOARD_MEMORY_RECORDED_SCOPE,
    maxUnits: 2,
    maxMemorySearches: 1,
    maxModelCalls: 1,
  },
  proofSha256: "a".repeat(64),
  key: KEY,
  assistantId: ASSISTANT,
};
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FLOWPROOF_TOKEN", "");
  gate.authorize.mockImplementation(
    (headers) => headers["x-flowproof-token"] === TOKEN,
  );
  gate.configuration.mockReturnValue(config);
  gate.reserveRun.mockImplementation(
    async (reserveTiger: (id: string) => Promise<{ reserved: boolean }>) =>
      reserveTiger(TRANCHE),
  );
  gate.reserveCall.mockResolvedValue(undefined);
});
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
});

const usage = { inputTokens: null, outputTokens: null, totalTokens: null };
function attempt(
  operation: "memory_search" | "answer",
): BackboardMemoryAttempt {
  return {
    operation,
    index: 1,
    provider: "Backboard",
    transport:
      operation === "answer"
        ? "backboard_openrouter_gemma"
        : "backboard_memory_search",
    modelProvider: operation === "answer" ? "openrouter" : null,
    model: operation === "answer" ? BACKBOARD_GEMMA_EVIDENCE_MODEL : null,
    status: 200,
    providerStatus: operation === "answer" ? "COMPLETED" : null,
    durationMs: 0,
    requestBytes: 1,
    requestSha256: "b".repeat(64),
    responseBytes: 1,
    responseComplete: true,
    responseSha256: "c".repeat(64),
    usage,
    retryDelayMs: 0,
  };
}
function answerFixture(): BackboardMemoryAnswerResult {
  return {
    provider: "Backboard",
    modelProvider: "openrouter",
    model: BACKBOARD_GEMMA_EVIDENCE_MODEL,
    question: BACKBOARD_MEMORY_QUESTION,
    scope: { ...BACKBOARD_MEMORY_RECORDED_SCOPE },
    facts: [],
    modelAssertions: {
      claims: [],
      resolution: "not_proven_by_retrieved_facts",
      supportingFactIds: [],
    },
    answer:
      "Offline HTTP fixture only. No memory was retrieved and no model was called.",
    usage,
    attempts: [attempt("memory_search"), attempt("answer")],
    retrieval: {
      returnedRecords: 0,
      matchingRecords: 0,
      providerMemoryId: null,
      contentSha256: "d".repeat(64),
    },
    citationIdKind: "application-derived-fact-ids",
    limitations: "Offline injected route fixture; not provider evidence.",
  };
}
function metadata(
  operation: "memory_search" | "answer",
): BackboardMemoryReservationRequest {
  return {
    ...BACKBOARD_MEMORY_RECORDED_SCOPE,
    operation,
    provider: "Backboard",
    assistantId: ASSISTANT,
    endpoint:
      operation === "answer"
        ? "https://app.backboard.io/api/threads/messages"
        : `https://app.backboard.io/api/assistants/${ASSISTANT}/memories/search`,
    credentialSha256: createHash("sha256").update(KEY).digest("hex"),
    requestBytes: 1,
    requestSha256: "e".repeat(64),
    freshThread: operation === "answer",
    modelProvider: operation === "answer" ? "openrouter" : null,
    model: operation === "answer" ? BACKBOARD_GEMMA_EVIDENCE_MODEL : null,
    retrievedContentSha256: null,
    factIds: [],
  };
}
const fixtureExecution: typeof runAudit = async (project, audit, onResult) => {
  const results: CheckResult[] = audit.checks.map((check) => ({
    checkId: check.id,
    requirement: check.requirement,
    expected: check.expected,
    kind: check.kind,
    status: check.kind === "manual" ? "unverified" : "failed",
    durationMs: 1,
    evidence: {
      observed: "Offline HTTP fixture only; no browser was run.",
      url: project.url,
      viewport: { width: 1365, height: 900 },
    },
  }));
  for (const result of results) await onResult(result);
  return results;
};
type Visitor = { cookie: string; project: Project };
async function harness(
  options: {
    holdAudit?: boolean;
    tigerAvailable?: boolean;
    answer?: typeof executeBackboardMemoryAnswer;
  } = {},
) {
  const evidenceRoot = await mkdtemp(
    path.join(tmpdir(), "briefstamp-memory-answer-http-"),
  );
  const saved = new Map<string, Audit>();
  const reservations = new Set<string>();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  if (!options.holdAudit) release();
  const store = {
    persistAudit: vi.fn(async (scope: string, audit: Audit) => {
      saved.set(`${scope}:${audit.id}`, structuredClone(audit));
      return {
        inserted: true,
        expiresAt: new Date(NOW + 30 * 60_000).toISOString(),
      };
    }),
    getAudit: vi.fn(async (scope: string, id: string) =>
      structuredClone(saved.get(`${scope}:${id}`) ?? null),
    ),
    searchFailures: vi.fn(async () => []),
    searchFailuresHybrid: vi.fn(async () => []),
    indexAuditFailures: vi.fn(async () => ({
      indexed: 0,
      matched: 0,
      skipped: 0,
      model: "all-minilm:22m" as const,
      catalogSha256: "f".repeat(64),
    })),
    reserveAgentRun: vi.fn(
      async (
        _scope: string,
        _project: string,
        _audit: string,
        tranche: string,
      ) => {
        if (reservations.has(tranche)) return { reserved: false };
        reservations.add(tranche);
        return { reserved: true };
      },
    ),
    judgeAgentStatus: vi.fn(),
    reserveJudgeAgentRun: vi.fn(),
    appendJudgeAgentResult: vi.fn(),
    close: vi.fn(async () => {}),
  };
  const answer = vi.fn<typeof executeBackboardMemoryAnswer>(
    options.answer ??
      (async (_scope, controls) => {
        await controls.reserve(metadata("memory_search"));
        await controls.reserve(metadata("answer"));
        return answerFixture();
      }),
  );
  const execute = vi.fn<typeof runAudit>(async (...args) => {
    await pending;
    return fixtureExecution(...args);
  });
  const demo = createDemoRouter({
    evidenceRoot,
    secureCookie: false,
    now: () => NOW,
    execute,
    gemmaAvailable: () => false,
    tinkerAvailable: () => false,
    tigerAvailable: () => options.tigerAvailable ?? true,
    tigerStore: store,
    backboardMemoryAnswer: answer,
  });
  const app = express();
  app.use(backboardAnswerHttpBoundary(() => NOW));
  app.use(express.json({ limit: "64kb" }));
  app.use(demo.router);
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(400).json({ error: "Malformed request JSON." });
    },
  );
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", (error?: Error) =>
      error ? reject(error) : resolve(listener),
    );
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    release();
    await demo.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(evidenceRoot, { recursive: true, force: true });
  });
  const request = (
    route: string,
    cookie = "",
    body?: unknown,
    token?: string,
    method = body === undefined ? "GET" : "POST",
    raw?: string,
  ) =>
    fetch(base + route, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(token ? { "x-flowproof-token": token } : {}),
        ...(body !== undefined || raw !== undefined
          ? { "content-type": "application/json" }
          : {}),
      },
      body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
    });
  const visitor = async (): Promise<Visitor> => {
    const response = await request("/api/bootstrap");
    expect(response.status).toBe(200);
    const bootstrap: Bootstrap = await response.json();
    return {
      cookie: response.headers.get("set-cookie")!.split(";")[0],
      project: bootstrap.projects[0],
    };
  };
  const getAudit = async (id: string, cookie: string): Promise<Audit> => {
    const response = await request(`/api/audits/${id}`, cookie);
    expect(response.status).toBe(200);
    return response.json();
  };
  const start = async (v: Visitor): Promise<Audit> => {
    const approval = await request(
      `/api/projects/${v.project.id}/checks`,
      v.cookie,
      {
        checks: v.project.checks.map((check) => ({ ...check, approved: true })),
      },
      undefined,
      "PUT",
    );
    expect(approval.status).toBe(200);
    const response = await request(
      `/api/projects/${v.project.id}/audits`,
      v.cookie,
      {},
    );
    expect(response.status).toBe(202);
    return response.json();
  };
  const ready = async () => {
    const v = await visitor();
    const started = await start(v);
    for (let attempt = 0; attempt < 100; attempt++) {
      const audit = await getAudit(started.id, v.cookie);
      const persistence = await (
        await request(`/api/audits/${started.id}/persistence`, v.cookie)
      ).json();
      if (audit.status === "completed" && persistence.status !== "saving")
        return { ...v, audit };
      if (audit.status === "error")
        throw new Error("Offline audit fixture failed.");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    throw new Error("Offline audit fixture did not complete.");
  };
  const ask = (
    v: Visitor & { audit: Audit },
    body: unknown = { modelConsent: true },
  ) =>
    request(`/api/audits/${v.audit.id}/memory-answer`, v.cookie, body, TOKEN);
  const sessionAudit = async (id: string, cookie: string) => {
    const response = await request("/api/bootstrap", cookie);
    expect(response.status).toBe(200);
    const bootstrap: Bootstrap = await response.json();
    return bootstrap.audits.find((audit) => audit.id === id);
  };
  const noProviderWork = () => {
    expect(gate.reserveRun).not.toHaveBeenCalled();
    expect(gate.reserveCall).not.toHaveBeenCalled();
    expect(store.reserveAgentRun).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
  };
  const noJudgeWork = () => {
    expect(store.judgeAgentStatus).not.toHaveBeenCalled();
    expect(store.reserveJudgeAgentRun).not.toHaveBeenCalled();
    expect(store.appendJudgeAgentResult).not.toHaveBeenCalled();
  };
  return {
    request,
    visitor,
    start,
    ready,
    getAudit,
    sessionAudit,
    ask,
    noProviderWork,
    noJudgeWork,
    saved,
    reservations,
    store,
    answer,
    execute,
  };
}

describe(
  "operator Backboard memory-answer HTTP boundary",
  { timeout: 15_000 },
  () => {
    it("hides anonymous and unauthorized routes before body validation, source lookup, or reservation", async () => {
      const h = await harness();
      const v = await h.ready();
      h.store.getAudit.mockClear();
      gate.configuration.mockClear();
      for (const [id, cookie, token] of [
        ["unknown", "", undefined],
        [v.audit.id, "", undefined],
        [v.audit.id, v.cookie, undefined],
        [v.audit.id, v.cookie, "incorrect-operator-token"],
      ] as const) {
        const response = await h.request(
          `/api/audits/${id}/memory-answer`,
          cookie,
          { unsafe: true },
          token,
        );
        expect(response.status).toBe(404);
        expect(response.headers.get("set-cookie")).toBeNull();
        expect(await response.json()).toEqual({
          error: "Not found in this demo session.",
        });
      }
      expect(gate.configuration).not.toHaveBeenCalled();
      expect(h.store.getAudit).not.toHaveBeenCalled();
      h.noProviderWork();
      h.noJudgeWork();
    });

    it("rejects anonymous malformed JSON with 404 before parsing or source lookup", async () => {
      const h = await harness();
      const response = await h.request(
        "/api/audits/unknown/memory-answer",
        "",
        undefined,
        undefined,
        "POST",
        '{"modelConsent":',
      );
      expect(response.status).toBe(404);
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(h.store.getAudit).not.toHaveBeenCalled();
      h.noProviderWork();
    });

    it("does not reveal another visitor's completed audit to an authenticated operator", async () => {
      const h = await harness();
      const owner = await h.ready();
      const other = await h.visitor();
      h.store.getAudit.mockClear();
      const response = await h.request(
        `/api/audits/${owner.audit.id}/memory-answer`,
        other.cookie,
        { modelConsent: true },
        TOKEN,
      );
      expect(response.status).toBe(404);
      expect(h.store.getAudit).not.toHaveBeenCalled();
      h.noProviderWork();
      h.noJudgeWork();
    });

    it.each([
      {},
      { modelConsent: false },
      { modelConsent: "true" },
      { modelConsent: true, question: "Use an arbitrary scope" },
      { modelConsent: true, maxUnits: 12 },
    ])("rejects missing consent or extra caller input %j", async (body) => {
      const h = await harness();
      const v = await h.ready();
      h.store.getAudit.mockClear();
      expect((await h.ask(v, body)).status).toBe(400);
      expect(h.store.getAudit).not.toHaveBeenCalled();
      h.noProviderWork();
    });

    it("requires completion before looking up or reserving durable evidence", async () => {
      const h = await harness({ holdAudit: true });
      const v = await h.visitor();
      const audit = await h.start(v);
      expect((await h.ask({ ...v, audit })).status).toBe(409);
      expect(h.store.getAudit).not.toHaveBeenCalled();
      h.noProviderWork();
    });

    it.each(["unsaved", "mismatched"] as const)(
      "requires an exact Tiger round trip for a %s audit",
      async (condition) => {
        const h = await harness();
        const v = await h.ready();
        h.store.getAudit.mockClear();
        if (condition === "unsaved") h.saved.clear();
        else
          for (const audit of h.saved.values())
            audit.summary = "Different stored observation.";
        expect((await h.ask(v)).status).toBe(409);
        expect(h.store.getAudit).toHaveBeenCalledTimes(1);
        h.noProviderWork();
        expect(await h.sessionAudit(v.audit.id, v.cookie)).toEqual(v.audit);
      },
    );

    it("fails closed when the durable lookup is unavailable", async () => {
      const h = await harness();
      const v = await h.ready();
      h.store.getAudit.mockRejectedValueOnce(
        new Error("offline-storage-unavailable"),
      );
      const response = await h.ask(v);
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.allowanceConsumed).toBe(false);
      expect(body).not.toHaveProperty("answer");
      h.noProviderWork();
    });

    it("rejects an already spent dedicated reservation without a provider call or judge grant", async () => {
      const h = await harness();
      const v = await h.ready();
      h.reservations.add(TRANCHE);
      expect((await h.ask(v)).status).toBe(409);
      expect(gate.reserveRun).toHaveBeenCalledTimes(1);
      expect(h.store.reserveAgentRun).toHaveBeenCalledTimes(1);
      expect(gate.reserveCall).not.toHaveBeenCalled();
      expect(h.answer).not.toHaveBeenCalled();
      h.noJudgeWork();
    });

    it("returns a dedicated two-unit historical answer while preserving the reservation audit exactly", async () => {
      const h = await harness();
      const v = await h.ready();
      h.store.getAudit.mockClear();
      const savedBefore = structuredClone([...h.saved.entries()]);
      const response = await h.ask(v);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({
        ...answerFixture(),
        reservation: {
          trancheId: TRANCHE,
          consumed: true,
          maxUnits: 2,
          reservedExistingCreditUsd: 0.1,
          neverRefund: true,
          publicJudgeSlotsConsumed: 0,
        },
        reservationAuditId: v.audit.id,
        reservationAuditUnchanged: true,
        reservationAuditRoundTrip: "Tiger",
      });
      expect(body.sourceScope).toContain("historical Backboard record");
      expect(body.sourceScope).toContain("not the reservation audit");
      expect(h.answer.mock.calls[0][0]).toEqual(
        BACKBOARD_MEMORY_RECORDED_SCOPE,
      );
      expect(h.answer).toHaveBeenCalledTimes(1);
      expect(h.answer.mock.calls[0][1]).toMatchObject({
        apiKey: KEY,
        assistantId: ASSISTANT,
      });
      expect(
        gate.reserveCall.mock.calls.map(([request]) => request.operation),
      ).toEqual(["memory_search", "answer"]);
      const sessionHash = createHash("sha256")
        .update(v.cookie.split("=")[1])
        .digest("hex");
      expect(h.store.reserveAgentRun).toHaveBeenCalledExactlyOnceWith(
        sessionHash,
        v.project.id,
        v.audit.id,
        TRANCHE,
      );
      expect(h.store.getAudit).toHaveBeenCalledTimes(2);
      expect([...h.saved.entries()]).toEqual(savedBefore);
      expect(await h.sessionAudit(v.audit.id, v.cookie)).toEqual(v.audit);
      expect(JSON.stringify(body)).not.toContain(KEY);
      expect(JSON.stringify(body)).not.toContain(TOKEN);
      h.noJudgeWork();
      expect((await h.ask(v)).status).toBe(409);
      expect(h.answer).toHaveBeenCalledTimes(1);
    });

    it("never fabricates an answer or refunds a reservation after provider failure", async () => {
      const h = await harness({
        answer: async (_scope, controls) => {
          await controls.reserve(metadata("memory_search"));
          throw new BackboardMemoryAnswerError("provider_rejected", [], [], {
            memory_search: "confirmed",
            answer: "not_requested",
          });
        },
      });
      const v = await h.ready();
      const response = await h.ask(v);
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({
        status: "failed",
        code: "provider_rejected",
        allowanceConsumed: true,
        neverRefund: true,
        reservationAuditUnchanged: true,
        publicJudgeSlotsConsumed: 0,
      });
      expect(body).not.toHaveProperty("answer");
      expect(body).not.toHaveProperty("modelAssertions");
      expect(body.error).toContain("No generated answer is available");
      expect(h.reservations).toEqual(new Set([TRANCHE]));
      expect(
        gate.reserveCall.mock.calls.map(([request]) => request.operation),
      ).toEqual(["memory_search"]);
      expect(await h.sessionAudit(v.audit.id, v.cookie)).toEqual(v.audit);
      expect((await h.ask(v)).status).toBe(409);
      expect(h.answer).toHaveBeenCalledTimes(1);
      h.noJudgeWork();
    });

    it("suppresses a generated answer when Tiger evidence changes during the operation", async () => {
      const h = await harness();
      const v = await h.ready();
      h.store.getAudit
        .mockResolvedValueOnce(structuredClone(v.audit))
        .mockResolvedValueOnce({
          ...structuredClone(v.audit),
          summary: "Changed after reservation.",
        });
      const response = await h.ask(v);
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).not.toHaveProperty("answer");
      expect(body.allowanceConsumed).toBe(true);
      expect(body.neverRefund).toBe(true);
      expect(await h.sessionAudit(v.audit.id, v.cookie)).toEqual(v.audit);
      h.noJudgeWork();
    });
  },
);
