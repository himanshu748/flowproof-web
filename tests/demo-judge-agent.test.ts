import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoRouter } from "../server/demo";
import {
  EVIDENCE_AGENT_TASK,
  type EvidenceAgentReceipt,
  type executeEvidenceAgent,
} from "../server/evidence-agent";
import { GOOGLE_GEMMA_MODEL } from "../server/providers/gemma-google";
import type { runAudit } from "../server/runner";
import { HOSTED_WEBSITE_URL } from "../shared/hosted-target";
import type { Audit, Bootstrap, CheckResult, Project } from "../shared/types";

// HTTP policy tests only: all model, search, billing, database and browser work
// is injected. The only network transport is this test's loopback HTTP server.
const boundary = vi.hoisted(() => ({
  configuration: vi.fn(),
  enabled: vi.fn(),
  funding: vi.fn(),
  searchOptions: vi.fn(),
  search: vi.fn(),
}));
vi.mock("../server/judge-agent-gate", () => ({
  judgeAgentConfiguration: boundary.configuration,
  judgeAgentEnabled: boundary.enabled,
  verifyJudgeAgentFunding: boundary.funding,
  judgeSearchOptions: boundary.searchOptions,
}));
vi.mock("../server/providers/serpapi", () => ({
  checkSearchVisibility: boundary.search,
}));

const NOW = Date.parse("2026-10-16T13:00:00.000Z");
const ORIGIN = "https://flowproof-demo.onrender.com";
const GRANT_ID = "51784d44-8d60-4400-9c33-c2715fc8a70f";
const grant = {
  grantId: GRANT_ID,
  proofSha256: "a".repeat(64),
  maxRuns: 12 as const,
  expiresAt: "2026-10-17T12:00:00.000Z",
};
const config = {
  proof: { grantId: GRANT_ID, maxRuns: 12, maxModelCallsPerRun: 2 },
  grant,
  key: "SYNTHETIC_TEST_KEY_NOT_A_PROVIDER_CREDENTIAL",
};
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("FLOWPROOF_TOKEN", "");
  boundary.configuration.mockReturnValue(config);
  boundary.enabled.mockReturnValue(true);
  boundary.funding.mockResolvedValue({ verified: true, fixture: true });
  boundary.searchOptions.mockResolvedValue({ env: { TEST_FIXTURE: "true" } });
  boundary.search.mockResolvedValue({
    provider: "SerpApi",
    domain: "flowproof-demo.onrender.com",
    query: "site:flowproof-demo.onrender.com",
    observedAt: new Date(NOW).toISOString(),
    results: [],
    status: "observed",
    limitation: "Offline HTTP test fixture; no search was performed.",
  });
});
afterEach(async () => {
  try {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}
function receipt(audit: Audit): EvidenceAgentReceipt {
  return {
    version: 1,
    status: "completed",
    transport: "injected_offline",
    model: GOOGLE_GEMMA_MODEL,
    startedAt: new Date(NOW).toISOString(),
    completedAt: new Date(NOW).toISOString(),
    task: EVIDENCE_AGENT_TASK,
    sourceAuditId: audit.id,
    modelTurns: [],
    toolCalls: [],
    observations: [],
    factualSummary: ["Offline judge-route fixture; no model was called."],
    sourceAuditUnchanged: true,
    limits: {
      maximumModelCalls: 2,
      maximumLogicalModelTurns: 2,
      maximumToolCalls: 2,
      modelRetries: 0,
      toolRetries: 0,
      refundPerformed: false,
      maximumDurationMs: 90_000,
      maximumSearchDurationMs: 60_000,
    },
    scope: "Offline injected HTTP route fixture.",
  };
}
const fixtureExecution: typeof runAudit = async (project, audit, onResult) => {
  const results: CheckResult[] = audit.checks.map((check) => ({
    checkId: check.id,
    requirement: check.requirement,
    expected: check.expected,
    kind: check.kind,
    status:
      check.kind === "manual"
        ? "unverified"
        : project.sampleVariant === "broken" &&
            ["heading", "image_alt", "no_horizontal_overflow"].includes(
              check.kind,
            )
          ? "failed"
          : "passed",
    durationMs: 1,
    evidence: {
      observed: "Offline judge-route fixture; not real browser evidence.",
      url: project.url,
      viewport:
        check.viewport === "mobile"
          ? { width: 390, height: 844 }
          : { width: 1365, height: 900 },
    },
  }));
  for (const result of results) await onResult(result);
  return results;
};
type Visitor = { cookie: string; project: Project };
type ReadyVisitor = Visitor & { website: Project; audit: Audit };
async function harness(
  options: {
    now?: () => number;
    tigerAvailable?: boolean;
    gemmaAvailable?: boolean;
    execute?: typeof runAudit;
    evidenceAgent?: typeof executeEvidenceAgent;
    verifyGemmaFree?: () => Promise<unknown>;
  } = {},
) {
  const evidenceRoot = await mkdtemp(
    path.join(tmpdir(), "briefstamp-judge-http-"),
  );
  const saved = new Map<string, Audit>();
  const reservations = new Map<
    string,
    { runId: string; auditId: string; result?: Record<string, unknown> }
  >();
  let externalUsedRuns = 0;
  const budget = (scope: string) => {
    const own = reservations.get(scope);
    const usedRuns = externalUsedRuns + reservations.size;
    return {
      maximumRuns: 12 as const,
      usedRuns,
      remainingRuns: Math.max(0, 12 - usedRuns),
      visitorUsed: Boolean(own),
      ...(own ? { ownRunId: own.runId } : {}),
      ...(own?.result ? { ownResult: structuredClone(own.result) } : {}),
    };
  };
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
      indexed: 3,
      matched: 3,
      skipped: 0,
      model: "all-minilm:22m" as const,
      catalogSha256: "1".repeat(64),
    })),
    reserveAgentRun: vi.fn(async () => ({ reserved: false })),
    judgeAgentStatus: vi.fn(async (scope: string, _grant: typeof grant) =>
      budget(scope),
    ),
    reserveJudgeAgentRun: vi.fn(
      async (
        scope: string,
        _projectId: string,
        auditId: string,
        _grant: typeof grant,
      ): Promise<{
        reserved: boolean;
        runId?: string;
        slot?: number;
        reason?: "visitor_used" | "exhausted" | "rate_limited";
        budget: ReturnType<typeof budget>;
      }> => {
        if (reservations.has(scope))
          return {
            reserved: false,
            reason: "visitor_used" as const,
            budget: budget(scope),
          };
        if (budget(scope).remainingRuns === 0)
          return {
            reserved: false,
            reason: "exhausted" as const,
            budget: budget(scope),
          };
        const runId = randomUUID();
        reservations.set(scope, { runId, auditId });
        return {
          reserved: true,
          runId,
          slot: budget(scope).usedRuns,
          budget: budget(scope),
        };
      },
    ),
    appendJudgeAgentResult: vi.fn(
      async (
        scope: string,
        runId: string,
        auditId: string,
        result: Record<string, unknown>,
      ) => {
        const own = reservations.get(scope);
        if (!own || own.runId !== runId || own.auditId !== auditId)
          throw new Error("Fixture rejected unowned result");
        if (own.result) return { inserted: false };
        own.result = structuredClone(result);
        return { inserted: true };
      },
    ),
    close: vi.fn(async () => {}),
  };
  const agent = vi.fn<typeof executeEvidenceAgent>(
    options.evidenceAgent ??
      (async ({ audit }, tools) => {
        tools.beforeModel?.();
        await tools.failureHistory(
          "mobile_paraphrase",
          new AbortController().signal,
        );
        await tools.searchVisibility(new AbortController().signal);
        tools.beforeModel?.();
        return receipt(audit);
      }),
  );
  const pricing = vi.fn(
    options.verifyGemmaFree ??
      (async () => ({ verified: true, fixture: true })),
  );
  const execute = vi.fn<typeof runAudit>(options.execute ?? fixtureExecution);
  const generate = vi.fn(async () => {
    throw new Error("Offline generation fixture");
  });
  const demo = createDemoRouter({
    evidenceRoot,
    secureCookie: false,
    now: options.now ?? (() => NOW),
    execute,
    evidenceAgent: agent,
    gemmaAvailable: () => options.gemmaAvailable ?? true,
    tigerAvailable: () => options.tigerAvailable ?? true,
    tinkerAvailable: () => false,
    tigerStore: store,
    generateGemma: generate,
    verifyGemmaFree: pricing,
  });
  const app = express();
  app.use(express.json());
  app.use(demo.router);
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", (error?: Error) =>
      error ? reject(error) : resolve(listener),
    );
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(async () => {
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
    method = body === undefined ? "GET" : "POST",
    origin: string | null = null,
  ) =>
    fetch(base + route, {
      method,
      headers: {
        host: new URL(ORIGIN).host,
        ...(cookie ? { cookie } : {}),
        ...(origin === null ? {} : { origin }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
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
  const approve = async (v: Visitor, checks = v.project.checks) => {
    const response = await request(
      `/api/projects/${v.project.id}/checks`,
      v.cookie,
      { checks: checks.map((check) => ({ ...check, approved: true })) },
      "PUT",
    );
    expect(response.status).toBe(200);
    v.project = await response.json();
  };
  const prepare = async (variant: "healthy" | "broken" = "broken") => {
    const v = await visitor();
    const response = await request(
      `/api/projects/${v.project.id}/variant`,
      v.cookie,
      { sampleVariant: variant },
    );
    expect(response.status).toBe(200);
    v.project = await response.json();
    const websiteResponse = await request("/api/projects/preset", v.cookie, {
      preset: "briefstamp-live",
    });
    expect(websiteResponse.status).toBe(201);
    const website: Project = await websiteResponse.json();
    return { ...v, website };
  };
  const run = async (v: Visitor) => {
    const response = await request(
      `/api/projects/${v.project.id}/audits`,
      v.cookie,
      {},
    );
    expect(response.status).toBe(202);
    const running: Audit = await response.json();
    for (let attempt = 0; attempt < 100; attempt++) {
      const audit: Audit = await (
        await request(`/api/audits/${running.id}`, v.cookie)
      ).json();
      const persistence = await (
        await request(`/api/audits/${running.id}/persistence`, v.cookie)
      ).json();
      if (audit.status === "completed" && persistence.status !== "saving")
        return audit;
      if (audit.status === "error")
        throw new Error("Offline runner fixture failed");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    throw new Error("Offline audit did not finish persisting");
  };
  const ready = async (
    variant: "healthy" | "broken" = "broken",
  ): Promise<ReadyVisitor> => {
    const v = await prepare(variant);
    await approve(v);
    return { ...v, audit: await run(v) };
  };
  const review = (
    v: ReadyVisitor,
    body: unknown = { websiteProjectId: v.website.id, modelConsent: true },
    origin: string | null = ORIGIN,
  ) =>
    request(
      `/api/audits/${v.audit.id}/judge-review`,
      v.cookie,
      body,
      "POST",
      origin,
    );
  const status = (v: Visitor) => request("/api/judge-agent/status", v.cookie);
  const noAgentWork = () => {
    expect(store.reserveJudgeAgentRun).not.toHaveBeenCalled();
    expect(store.reserveAgentRun).not.toHaveBeenCalled();
    expect(store.indexAuditFailures).not.toHaveBeenCalled();
    expect(store.searchFailuresHybrid).not.toHaveBeenCalled();
    expect(agent).not.toHaveBeenCalled();
    expect(boundary.searchOptions).not.toHaveBeenCalled();
    expect(boundary.search).not.toHaveBeenCalled();
  };
  return {
    request,
    visitor,
    approve,
    prepare,
    run,
    ready,
    review,
    status,
    noAgentWork,
    saved,
    reservations,
    store,
    agent,
    pricing,
    execute,
    generate,
    setExternalUsedRuns: (count: number) => {
      externalUsedRuns = count;
    },
  };
}

// These assertions exercise the public HTTP contract, not model quality.
describe("public judge evidence-agent HTTP boundary", () => {
  it.each([
    null,
    "http://flowproof-demo.onrender.com",
    "https://other.example",
    "null",
  ])(
    "rejects untrusted Origin %s before funding or reservation",
    async (origin) => {
      const h = await harness();
      const v = await h.ready();
      expect((await h.review(v, undefined, origin)).status).toBe(403);
      expect(boundary.funding).not.toHaveBeenCalled();
      expect(h.pricing).not.toHaveBeenCalled();
      h.noAgentWork();
    },
  );

  it.each([
    { modelConsent: false },
    { modelConsent: "true" },
    {},
    { modelConsent: true, task: "Injected private brief" },
    { modelConsent: true, searchTimeoutMs: 60_000 },
  ])("rejects missing/invalid consent or extra input %j", async (body) => {
    const h = await harness();
    const v = await h.ready();
    expect(
      (await h.review(v, { websiteProjectId: v.website.id, ...body })).status,
    ).toBe(400);
    expect(boundary.funding).not.toHaveBeenCalled();
    expect(h.pricing).not.toHaveBeenCalled();
    h.noAgentWork();
  });

  it("accepts an owned approved sample without an operator token and passes exact fixed limits", async () => {
    const h = await harness();
    const v = await h.ready();
    const response = await h.review(v);
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result).toMatchObject({
      status: "completed",
      transport: "injected_offline",
      sourceAuditId: v.audit.id,
      sourceAuditUnchanged: true,
      auditUnchanged: true,
      sourceAuditSha256: createHash("sha256")
        .update(JSON.stringify(v.audit))
        .digest("hex"),
      budget: {
        maximumRuns: 12,
        usedRuns: 1,
        remainingRuns: 11,
        visitorUsed: true,
      },
    });
    expect(h.agent.mock.calls[0][1]).toMatchObject({
      maxModelRequests: 2,
      searchTimeoutMs: 60_000,
    });
    expect(boundary.funding).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        forceFresh: true,
        minimumSearches: 12,
      }),
    );
    const scope = h.store.persistAudit.mock.calls[0][0];
    expect(h.store.reserveJudgeAgentRun).toHaveBeenCalledWith(
      scope,
      v.project.id,
      v.audit.id,
      grant,
    );
    expect(h.store.searchFailuresHybrid).toHaveBeenCalledWith(
      scope,
      v.project.id,
      "mobile_paraphrase",
    );
    const runId = h.reservations.get(scope)!.runId;
    expect(boundary.searchOptions).toHaveBeenCalledWith(config, runId);
    expect(h.store.appendJudgeAgentResult).toHaveBeenCalledWith(
      scope,
      runId,
      v.audit.id,
      expect.objectContaining({ status: "completed" }),
    );
    expect(h.store.reserveAgentRun).not.toHaveBeenCalled();
    expect(
      await (await h.request(`/api/audits/${v.audit.id}`, v.cookie)).json(),
    ).toEqual(v.audit);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(config.key);
    expect(serialized).not.toContain("proofSha256");
  });

  it("forwards the bounded judge signal instead of the generic provider's expired 30-second signal", async () => {
    const nativeFetch = globalThis.fetch;
    const boundedCaller = new AbortController();
    const genericProviderTimeout = new AbortController();
    genericProviderTimeout.abort(
      new DOMException("Fixture 30-second timeout", "TimeoutError"),
    );
    const syntheticUrl =
      "https://serpapi.com/search.json?q=PRIVATE_QUERY&api_key=SYNTHETIC_SECRET_NOT_A_CREDENTIAL";
    const providerFetch = vi.fn(async (init?: RequestInit) => {
      expect(init?.signal).toBe(boundedCaller.signal);
      expect(init?.signal).not.toBe(genericProviderTimeout.signal);
      expect(init?.signal?.aborted).toBe(false);
      return new Response('{"fixture":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.hostname === "serpapi.com") return providerFetch(init);
      if (url.hostname !== "127.0.0.1")
        return Promise.reject(new Error("Unexpected external test transport"));
      return nativeFetch(input, init);
    });
    boundary.search.mockImplementation(
      async (_project: Project, options: { fetcher: typeof fetch }) => {
        const response = await options.fetcher(syntheticUrl, {
          method: "GET",
          signal: genericProviderTimeout.signal,
        });
        expect(response.status).toBe(200);
        return { provider: "SerpApi", status: "observed", results: [] };
      },
    );
    const h = await harness({
      evidenceAgent: async ({ audit }, tools) => {
        expect(tools.searchTimeoutMs).toBe(60_000);
        await tools.searchVisibility(boundedCaller.signal);
        return receipt(audit);
      },
    });
    const v = await h.ready();
    const response = await h.review(v);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(providerFetch).toHaveBeenCalledOnce();
    expect(boundary.search).toHaveBeenCalledOnce();
    expect(body.providerAttempts).toEqual([
      {
        provider: "serpapi",
        operation: "search-visibility",
        startedAt: expect.any(String),
        durationMs: expect.any(Number),
        status: 200,
        outcome: "response",
      },
    ]);
    expect(body.reservation).toMatchObject({
      consumed: true,
      maxModelCalls: 2,
      maxSearchCalls: 1,
    });
    for (const privateValue of [
      syntheticUrl,
      "PRIVATE_QUERY",
      "api_key",
      "SYNTHETIC_SECRET_NOT_A_CREDENTIAL",
    ])
      expect(JSON.stringify(body)).not.toContain(privateValue);
  });

  it("keeps the old operator endpoint hidden from tokenless visitors", async () => {
    const h = await harness();
    const v = await h.ready();
    expect(
      (
        await h.request(
          `/api/audits/${v.audit.id}/agent-review`,
          v.cookie,
          { websiteProjectId: v.website.id, modelConsent: true },
          "POST",
          ORIGIN,
        )
      ).status,
    ).toBe(404);
    expect(boundary.funding).not.toHaveBeenCalled();
    h.noAgentWork();
  });

  it("cannot create the underlying sample audit until its checks are approved", async () => {
    const h = await harness();
    const v = await h.prepare();
    expect(
      (await h.request(`/api/projects/${v.project.id}/audits`, v.cookie, {}))
        .status,
    ).toBe(409);
    expect(h.execute).not.toHaveBeenCalled();
    h.noAgentWork();
  });

  it.each(["healthy", "changed assertion", "custom brief"] as const)(
    "rejects %s evidence before funding or reservation",
    async (kind) => {
      const h = await harness();
      const v = await h.prepare(kind === "healthy" ? "healthy" : "broken");
      if (kind === "custom brief") {
        const response = await h.request(
          `/api/projects/${v.project.id}/generate`,
          v.cookie,
          { brief: 'The homepage heading must say "Different client words".' },
        );
        expect(response.status).toBe(200);
        v.project = await response.json();
      }
      const checks = structuredClone(v.project.checks);
      if (kind === "changed assertion")
        checks[0].expected = "Different heading";
      await h.approve(v, checks);
      const audit = await h.run(v);
      expect((await h.review({ ...v, audit })).status).toBe(400);
      expect(boundary.funding).not.toHaveBeenCalled();
      h.noAgentWork();
    },
  );

  it("denies cross-visitor audit/website access and rejects the sample as search target", async () => {
    const h = await harness();
    const v = await h.ready();
    const other = await h.prepare();
    expect(
      (
        await h.review(v, {
          websiteProjectId: v.project.id,
          modelConsent: true,
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.review(v, {
          websiteProjectId: other.website.id,
          modelConsent: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request(
          `/api/audits/${v.audit.id}/judge-review`,
          other.cookie,
          { websiteProjectId: other.website.id, modelConsent: true },
          "POST",
          ORIGIN,
        )
      ).status,
    ).toBe(404);
    expect(boundary.funding).not.toHaveBeenCalled();
    h.noAgentWork();
  });

  it.each(["disabled", "save failed"] as const)(
    "requires actual Tiger persistence when storage is %s",
    async (kind) => {
      const h = await harness({ tigerAvailable: kind !== "disabled" });
      if (kind === "save failed")
        h.store.persistAudit.mockRejectedValue(
          new Error("PRIVATE DATABASE ERROR"),
        );
      expect((await h.review(await h.ready())).status).toBe(409);
      expect(boundary.funding).not.toHaveBeenCalled();
      h.noAgentWork();
    },
  );

  it("requires exact saved audit JSON before reservation", async () => {
    const h = await harness();
    const v = await h.ready();
    const changed = structuredClone(v.audit);
    changed.results[0].evidence.observed = "A different observation";
    h.store.getAudit.mockResolvedValueOnce(changed);
    expect((await h.review(v)).status).toBe(409);
    h.noAgentWork();
  });

  it("compares canonical JSON when optional runner properties are undefined", async () => {
    const h = await harness({
      execute: async (project, audit, onResult) => {
        const rows = await fixtureExecution(project, audit, async () => {});
        for (const result of rows) {
          result.evidence.dom = undefined;
          result.evidence.screenshot = undefined;
          await onResult(result);
        }
        return rows;
      },
    });
    h.store.getAudit.mockImplementation(async (scope, id) =>
      JSON.parse(JSON.stringify(h.saved.get(`${scope}:${id}`) ?? null)),
    );
    expect((await h.review(await h.ready())).status).toBe(200);
    expect(h.agent).toHaveBeenCalledOnce();
  });

  it("replays only this visitor's persisted result without repeating funding/model/tool work", async () => {
    const h = await harness();
    const v = await h.ready();
    expect((await h.review(v)).status).toBe(200);
    const status = await h.status(v);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({
      result: { status: "completed", sourceAuditId: v.audit.id },
      budget: { visitorUsed: true },
    });
    expect((await h.review(v)).status).toBe(409);
    expect(h.agent).toHaveBeenCalledOnce();
    expect(boundary.funding).toHaveBeenCalledOnce();
    expect(boundary.search).toHaveBeenCalledOnce();
    const other = await h.visitor();
    const otherStatus = await (await h.status(other)).json();
    expect(otherStatus.result).toBeUndefined();
    expect(otherStatus.budget).toMatchObject({
      visitorUsed: false,
      usedRuns: 1,
      remainingRuns: 11,
    });
    expect(JSON.stringify(otherStatus)).not.toContain(v.audit.id);
  });

  it("rejects an exhausted durable grant before fresh funding or reservation", async () => {
    const h = await harness();
    const v = await h.ready();
    h.setExternalUsedRuns(12);
    expect((await h.review(v)).status).toBe(429);
    expect(boundary.funding).not.toHaveBeenCalled();
    h.noAgentWork();
    expect(await (await h.status(v)).json()).toMatchObject({
      available: false,
      budget: { remainingRuns: 0 },
    });
  });

  it("does not refund a model failure and exposes only a safe failure result", async () => {
    const h = await harness({
      evidenceAgent: async () => {
        throw new Error("PRIVATE PROVIDER URL KEY");
      },
    });
    const v = await h.ready();
    const response = await h.review(v);
    expect(response.status).toBe(503);
    const body = await response.json();
    const scope = h.store.persistAudit.mock.calls[0][0];
    const committed = h.reservations.get(scope)!;
    expect(body).toMatchObject({
      status: "failed",
      sourceAuditId: v.audit.id,
      allowanceConsumed: true,
      trancheId: committed.runId,
      grantId: GRANT_ID,
      reservation: {
        durable: "Tiger sealed grant and UNIQUE session/slot",
        consumed: true,
        maxModelCalls: 2,
        maxSearchCalls: 1,
      },
      budget: { usedRuns: 1, remainingRuns: 11, visitorUsed: true },
    });
    expect(JSON.stringify(body)).not.toContain("PRIVATE");
    expect(h.reservations.size).toBe(1);
    expect(h.store.appendJudgeAgentResult).toHaveBeenCalledOnce();
    expect(h.store.appendJudgeAgentResult).toHaveBeenCalledWith(
      scope,
      committed.runId,
      v.audit.id,
      body,
    );
    expect(committed.result).toEqual(body);
    expect((await h.review(v)).status).toBe(409);
    expect(h.agent).toHaveBeenCalledOnce();
    const resumed = await (await h.status(v)).json();
    expect(resumed.available).toBe(false);
    expect(resumed.result).toEqual(body);
    expect(
      await (await h.request(`/api/audits/${v.audit.id}`, v.cookie)).json(),
    ).toEqual(v.audit);
  });

  it("does not start models after an ambiguous reservation response", async () => {
    const h = await harness();
    const v = await h.ready();
    h.store.reserveJudgeAgentRun.mockImplementationOnce(
      async (scope, _project, auditId) => {
        h.reservations.set(scope, { runId: randomUUID(), auditId });
        throw new Error("PRIVATE transport lost after commit");
      },
    );
    const response = await h.review(v);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      allowanceConsumed: "unknown; no retry or refund",
    });
    expect(h.reservations.size).toBe(1);
    expect((await h.review(v)).status).toBe(409);
    expect(h.store.reserveJudgeAgentRun).toHaveBeenCalledOnce();
    expect(h.agent).not.toHaveBeenCalled();
    expect(h.store.indexAuditFailures).not.toHaveBeenCalled();
    expect(boundary.search).not.toHaveBeenCalled();
  });

  it.each(["visitor_used", "exhausted", "rate_limited"] as const)(
    "honors atomic reservation denial %s without model I/O",
    async (reason) => {
      const h = await harness();
      const v = await h.ready();
      h.store.reserveJudgeAgentRun.mockImplementationOnce(async () => ({
        reserved: false,
        reason,
        budget: {
          maximumRuns: 12,
          usedRuns: 1,
          remainingRuns: 11,
          visitorUsed: reason === "visitor_used",
        },
      }));
      expect((await h.review(v)).status).toBe(
        reason === "visitor_used" ? 409 : 429,
      );
      expect(h.agent).not.toHaveBeenCalled();
      expect(h.store.indexAuditFailures).not.toHaveBeenCalled();
      expect(boundary.search).not.toHaveBeenCalled();
    },
  );

  it("fails closed when the judge gate is disabled", async () => {
    const h = await harness();
    const v = await h.ready();
    boundary.configuration.mockReturnValue(null);
    boundary.enabled.mockReturnValue(false);
    expect((await h.review(v)).status).toBe(503);
    expect(await (await h.status(v)).json()).toMatchObject({
      available: false,
    });
    expect(boundary.funding).not.toHaveBeenCalled();
    h.noAgentWork();
  });

  it("requires freshly confirmed funding before reserving a judge run", async () => {
    const h = await harness();
    const v = await h.ready();
    boundary.funding.mockRejectedValueOnce(
      new Error("PRIVATE free-plan account response"),
    );
    const response = await h.review(v);
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("PRIVATE");
    h.noAgentWork();
  });

  it("does not reserve judge work while another browser audit is active", async () => {
    const h = await harness();
    const v = await h.ready();
    const started = deferred<void>();
    const release = deferred<void>();
    h.execute.mockImplementationOnce(async (...args) => {
      started.resolve();
      await release.promise;
      return fixtureExecution(...args);
    });
    expect(
      (await h.request(`/api/projects/${v.project.id}/audits`, v.cookie, {}))
        .status,
    ).toBe(202);
    await started.promise;
    try {
      expect((await h.review(v)).status).toBe(429);
      h.noAgentWork();
    } finally {
      release.resolve();
    }
  });

  it("shares its busy lock with proposals, other judge runs and browser audits", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const h = await harness({
      evidenceAgent: async ({ audit }) => {
        started.resolve();
        await release.promise;
        return receipt(audit);
      },
    });
    const v = await h.ready();
    const pending = h.review(v);
    await started.promise;
    try {
      expect((await h.review(v)).status).toBe(429);
      expect(
        (
          await h.request(
            `/api/projects/${v.project.id}/generate-gemma`,
            v.cookie,
            { modelConsent: true },
          )
        ).status,
      ).toBe(429);
      expect(
        (await h.request(`/api/projects/${v.project.id}/audits`, v.cookie, {}))
          .status,
      ).toBe(409);
      expect(h.store.reserveJudgeAgentRun).toHaveBeenCalledOnce();
      expect(h.generate).not.toHaveBeenCalled();
    } finally {
      release.resolve();
    }
    expect((await pending).status).toBe(200);
  });

  it("rejects a changed website snapshot while funding is pending", async () => {
    const started = deferred<void>();
    const release = deferred<unknown>();
    boundary.funding.mockImplementationOnce(() => {
      started.resolve();
      return release.promise;
    });
    const h = await harness();
    const v = await h.ready();
    const pending = h.review(v);
    await started.promise;
    try {
      await h.approve({ cookie: v.cookie, project: v.website });
    } finally {
      release.resolve({ verified: true });
    }
    expect((await pending).status).toBe(409);
    h.noAgentWork();
  });

  it.each(["saved read", "reservation", "indexing"] as const)(
    "stops on session expiry during %s",
    async (stage) => {
      let now = NOW;
      const h = await harness({ now: () => now });
      const v = await h.ready();
      if (stage === "saved read")
        h.store.getAudit.mockImplementationOnce(async () => {
          now += 31 * 60_000;
          return structuredClone(v.audit);
        });
      if (stage === "reservation")
        h.store.reserveJudgeAgentRun.mockImplementationOnce(
          async (scope, _project, auditId) => {
            const runId = randomUUID();
            h.reservations.set(scope, { runId, auditId });
            now += 31 * 60_000;
            return {
              reserved: true,
              runId,
              slot: 1,
              budget: {
                maximumRuns: 12,
                usedRuns: 1,
                remainingRuns: 11,
                visitorUsed: true,
              },
            };
          },
        );
      if (stage === "indexing")
        h.store.indexAuditFailures.mockImplementationOnce(async () => {
          now += 31 * 60_000;
          return {
            indexed: 3,
            matched: 3,
            skipped: 0,
            model: "all-minilm:22m",
            catalogSha256: "1".repeat(64),
          };
        });
      const response = await h.review(v);
      expect(response.status).toBe(409);
      expect(h.agent).not.toHaveBeenCalled();
      expect(boundary.search).not.toHaveBeenCalled();
      if (stage === "saved read")
        expect(h.store.reserveJudgeAgentRun).not.toHaveBeenCalled();
      else expect((await response.json()).allowanceConsumed).toBe(true);
    },
  );

  it("reserves two physical calls per run against the shared twelve-call hourly cap", async () => {
    const h = await harness();
    for (let i = 0; i < 6; i++)
      expect((await h.review(await h.ready())).status).toBe(200);
    const seventh = await h.ready();
    expect((await h.review(seventh)).status).toBe(429);
    expect(h.agent).toHaveBeenCalledTimes(6);
    expect(h.store.reserveJudgeAgentRun).toHaveBeenCalledTimes(6);
    expect(boundary.funding).toHaveBeenCalledTimes(6);
  });
  it("shares physical reservations with three-call Gemma proposal attempts", async () => {
    const h = await harness();
    const first = await h.visitor();
    expect(
      (
        await h.request(
          `/api/projects/${first.project.id}/generate-gemma`,
          first.cookie,
          { modelConsent: true },
        )
      ).status,
    ).toBe(503);
    for (let i = 0; i < 3; i++)
      expect((await h.review(await h.ready())).status).toBe(200);
    const second = await h.visitor();
    expect(
      (
        await h.request(
          `/api/projects/${second.project.id}/generate-gemma`,
          second.cookie,
          { modelConsent: true },
        )
      ).status,
    ).toBe(503);
    expect((await h.review(await h.ready())).status).toBe(429);
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(h.agent).toHaveBeenCalledTimes(3);
    expect(h.store.reserveJudgeAgentRun).toHaveBeenCalledTimes(3);
    expect(boundary.funding).toHaveBeenCalledTimes(3);
  });

  it("does not fabricate persisted success if result append fails", async () => {
    const h = await harness();
    const v = await h.ready();
    h.store.appendJudgeAgentResult.mockRejectedValueOnce(
      new Error("PRIVATE result write failure"),
    );
    const response = await h.review(v);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      status: "completed",
      receiptPersistence: "unverified",
    });
    expect(JSON.stringify(body)).not.toContain("PRIVATE");
    const resumed = await (await h.status(v)).json();
    expect(resumed).toMatchObject({
      available: false,
      budget: { visitorUsed: true },
    });
    expect(resumed.result).toBeUndefined();
    expect((await h.review(v)).status).toBe(409);
    expect(h.agent).toHaveBeenCalledOnce();
  });
  it("keeps the run consumed but rejects success after session expiry during result append", async () => {
    let now = NOW;
    const h = await harness({ now: () => now });
    const v = await h.ready();
    h.store.appendJudgeAgentResult.mockImplementationOnce(
      async (scope, runId, auditId, result) => {
        const own = h.reservations.get(scope);
        expect(own).toMatchObject({ runId, auditId });
        own!.result = structuredClone(result);
        now += 31 * 60_000;
        return { inserted: true };
      },
    );
    const response = await h.review(v);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      status: "failed",
      allowanceConsumed: true,
    });
    expect(h.reservations.size).toBe(1);
    expect(h.store.reserveJudgeAgentRun).toHaveBeenCalledOnce();
    expect(h.agent).toHaveBeenCalledOnce();
    expect(h.store.searchFailuresHybrid).toHaveBeenCalledOnce();
    expect(boundary.funding).toHaveBeenCalledOnce();
    expect(boundary.searchOptions).toHaveBeenCalledOnce();
    expect(boundary.search).toHaveBeenCalledOnce();
    expect(h.store.persistAudit).toHaveBeenCalledOnce();
  });

  it("withholds an old saved result when the grant changes during status read", async () => {
    const h = await harness();
    const v = await h.visitor();
    const oldAuditId = randomUUID();
    h.store.judgeAgentStatus.mockImplementationOnce(async () => {
      boundary.configuration.mockReturnValue({
        ...config,
        grant: { ...grant, grantId: randomUUID() },
      });
      return {
        maximumRuns: 12,
        usedRuns: 1,
        remainingRuns: 11,
        visitorUsed: true,
        ownRunId: randomUUID(),
        ownResult: {
          status: "completed",
          sourceAuditId: oldAuditId,
          factualSummary: ["OLD_GRANT_RESULT"],
        },
      };
    });
    const response = await h.status(v);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.available).toBe(false);
    expect(body.result).toBeUndefined();
    expect(body.budget).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain(oldAuditId);
    expect(JSON.stringify(body)).not.toContain("OLD_GRANT_RESULT");
    expect(boundary.funding).not.toHaveBeenCalled();
    h.noAgentWork();
  });

  it("withholds available status when the immutable grant proof changes during funding", async () => {
    const h = await harness();
    const v = await h.visitor();
    boundary.funding.mockImplementationOnce(async () => {
      boundary.configuration.mockReturnValue({
        ...config,
        grant: { ...grant, proofSha256: "b".repeat(64) },
      });
      return {
        verified: true,
        fixture: true,
        checkedAt: new Date(NOW).toISOString(),
      };
    });
    const response = await h.status(v);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.available).toBe(false);
    expect(body.result).toBeUndefined();
    expect(body.budget).toBeUndefined();
    expect(body.funding).toBeUndefined();
    expect(boundary.funding).toHaveBeenCalledOnce();
    h.noAgentWork();
  });
});
