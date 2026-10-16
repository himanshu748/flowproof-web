import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { IncomingHttpHeaders, Server } from "node:http";
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
import type { runAudit } from "../server/runner";
import { GOOGLE_GEMMA_MODEL } from "../server/providers/gemma-google";
import { HOSTED_WEBSITE_URL } from "../shared/hosted-target";
import type { Audit, Bootstrap, CheckResult, Project } from "../shared/types";

// These HTTP tests isolate policy wiring. No credentials, provider transports,
// database connections, real browser execution or live funding checks are used.
const boundary = vi.hoisted(() => ({
  authorize: vi.fn(),
  configuration: vi.fn(),
  enabled: vi.fn(),
  searchOptions: vi.fn(),
  search: vi.fn(),
}));
vi.mock("../server/evidence-agent-gate", () => ({
  authorizeEvidenceAgent: boundary.authorize,
  evidenceAgentConfiguration: boundary.configuration,
  evidenceAgentEnabled: boundary.enabled,
  agentSearchOptions: boundary.searchOptions,
}));
vi.mock("../server/providers/serpapi", () => ({
  checkSearchVisibility: boundary.search,
}));

const OPERATOR = "isolated-test-operator-token-not-a-credential";
const TRANCHE = "f181103a-ed68-4de9-9206-1074ac73dcee";
const NOW = Date.parse("2026-10-16T11:00:00.000Z");
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.resetAllMocks();
  boundary.authorize.mockImplementation(
    (headers: IncomingHttpHeaders) => headers["x-flowproof-token"] === OPERATOR,
  );
  boundary.enabled.mockReturnValue(true);
  boundary.configuration.mockReturnValue({ proof: { trancheId: TRANCHE } });
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
  for (const cleanup of cleanups.splice(0)) await cleanup();
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
    factualSummary: ["Trusted route fixture; no model was called."],
    sourceAuditUnchanged: true,
    limits: {
      maximumModelCalls: 2,
      maximumToolCalls: 2,
      modelRetries: 0,
      toolRetries: 0,
      refundPerformed: false,
      maximumDurationMs: 50_000,
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
      observed: "Offline route fixture; not real browser evidence.",
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
    path.join(tmpdir(), "briefstamp-agent-http-"),
  );
  const saved = new Map<string, Audit>();
  const reserved = new Set<string>();
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
    reserveAgentRun: vi.fn(
      async (
        _scope: string,
        _project: string,
        _audit: string,
        tranche: string,
      ) => {
        if (reserved.has(tranche)) return { reserved: false };
        reserved.add(tranche);
        return { reserved: true };
      },
    ),
    close: vi.fn(async () => {}),
  };
  const agent = vi.fn<typeof executeEvidenceAgent>(
    options.evidenceAgent ??
      (async ({ audit }, tools) => {
        await tools.failureHistory(
          "mobile_paraphrase",
          new AbortController().signal,
        );
        await tools.searchVisibility(new AbortController().signal);
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
    token = OPERATOR,
  ) =>
    fetch(base + route, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(token ? { "x-flowproof-token": token } : {}),
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
    const variantResponse = await request(
      `/api/projects/${v.project.id}/variant`,
      v.cookie,
      { sampleVariant: variant },
    );
    expect(variantResponse.status).toBe(200);
    v.project = await variantResponse.json();
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
      const completed = await request(`/api/audits/${running.id}`, v.cookie);
      const audit: Audit = await completed.json();
      const persistence = await (
        await request(`/api/audits/${running.id}/persistence`, v.cookie)
      ).json();
      if (audit.status === "completed" && persistence.status !== "saving")
        return audit;
      if (audit.status === "error")
        throw new Error("Offline runner fixture failed.");
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    throw new Error("Offline fixture did not finish persisting.");
  };
  const ready = async (variant: "healthy" | "broken" = "broken") => {
    const v = await prepare(variant);
    await approve(v);
    return { ...v, audit: await run(v) };
  };
  const review = (
    v: Visitor & { audit: Audit; website: Project },
    body: unknown = {
      websiteProjectId: v.website.id,
      modelConsent: true,
    },
  ) => request(`/api/audits/${v.audit.id}/agent-review`, v.cookie, body);
  const noAgentWork = () => {
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
    noAgentWork,
    saved,
    reserved,
    store,
    agent,
    pricing,
    execute,
    generate,
  };
}

describe("operator evidence-agent HTTP boundary", () => {
  it("does not expose source or session existence to tokenless callers", async () => {
    const h = await harness();
    const v = await h.ready();
    for (const [id, cookie] of [
      [v.audit.id, v.cookie],
      [randomUUID(), v.cookie],
      [v.audit.id, "flowproof_demo=expired"],
      [v.audit.id, ""],
    ]) {
      const response = await h.request(
        `/api/audits/${id}/agent-review`,
        cookie,
        { websiteProjectId: v.website.id, modelConsent: true },
        "POST",
        "",
      );
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        error: "Not found in this demo session.",
      });
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(h.pricing).not.toHaveBeenCalled();
    h.noAgentWork();
  });

  it("requires literal consent and strict input before spending any allowance", async () => {
    const h = await harness();
    const v = await h.ready();
    for (const body of [
      { websiteProjectId: v.website.id, modelConsent: false },
      { websiteProjectId: v.website.id },
      { websiteProjectId: v.website.id, modelConsent: "true" },
      {
        websiteProjectId: v.website.id,
        modelConsent: true,
        task: "Injected instruction",
      },
    ])
      expect((await h.review(v, body)).status).toBe(400);
    expect(h.pricing).not.toHaveBeenCalled();
    h.noAgentWork();
    expect((await h.review(v)).status).toBe(200);
    expect(h.pricing).toHaveBeenCalledTimes(1);
    expect(h.store.reserveAgentRun).toHaveBeenCalledTimes(1);
  });

  it("requires approval before creating the fixed broken sample evidence", async () => {
    const h = await harness();
    const v = await h.prepare();
    expect(v.project.checks.every((check) => !check.approved)).toBe(true);
    expect(
      (await h.request(`/api/projects/${v.project.id}/audits`, v.cookie, {}))
        .status,
    ).toBe(409);
    expect(h.execute).not.toHaveBeenCalled();
    h.noAgentWork();
    await h.approve(v);
    const audit = await h.run(v);
    expect(audit.source?.sampleVariant).toBe("broken");
    expect((await h.review({ ...v, audit })).status).toBe(200);
  });

  it.each(["healthy", "changed assertion", "custom brief"] as const)(
    "rejects %s evidence before pricing or reservation",
    async (kind) => {
      const h = await harness();
      const v = await h.prepare(kind === "healthy" ? "healthy" : "broken");
      if (kind === "custom brief") {
        const response = await h.request(
          `/api/projects/${v.project.id}/generate`,
          v.cookie,
          { brief: 'The homepage heading must say "Unapproved client words".' },
        );
        expect(response.status).toBe(200);
        v.project = await response.json();
      }
      const checks = structuredClone(v.project.checks);
      if (kind === "changed assertion")
        checks[0].expected = "A different heading";
      await h.approve(v, checks);
      const audit = await h.run(v);
      expect((await h.review({ ...v, audit })).status).toBe(400);
      expect(h.pricing).not.toHaveBeenCalled();
      h.noAgentWork();
    },
  );

  it("accepts only the same session's fixed owner website", async () => {
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
          `/api/audits/${v.audit.id}/agent-review`,
          other.cookie,
          { websiteProjectId: other.website.id, modelConsent: true },
        )
      ).status,
    ).toBe(404);
    h.noAgentWork();
  });

  it.each(["disabled", "save failed"] as const)(
    "requires verified Tiger persistence when storage is %s",
    async (condition) => {
      const h = await harness({ tigerAvailable: condition !== "disabled" });
      if (condition === "save failed")
        h.store.persistAudit.mockRejectedValue(
          new Error("PRIVATE DATABASE ERROR"),
        );
      const v = await h.ready();
      expect((await h.review(v)).status).toBe(409);
      expect(h.pricing).not.toHaveBeenCalled();
      h.noAgentWork();
    },
  );

  it("compares the complete saved audit before reserving a run", async () => {
    const h = await harness();
    const v = await h.ready();
    const mismatch = structuredClone(v.audit);
    mismatch.results[0].evidence.observed = "Different saved observation";
    h.store.getAudit.mockResolvedValueOnce(mismatch);
    expect((await h.review(v)).status).toBe(409);
    expect(h.pricing).toHaveBeenCalledTimes(1);
    h.noAgentWork();
  });

  it("compares JSON evidence without mistaking omitted optional fields for changed observations", async () => {
    const h = await harness({
      execute: async (project, audit, onResult) => {
        const rows = await fixtureExecution(project, audit, async () => {});
        for (const row of rows) {
          row.evidence.dom = undefined;
          row.evidence.screenshot = undefined;
          await onResult(row);
        }
        return rows;
      },
    });
    h.store.getAudit.mockImplementation(async (scope, id) =>
      JSON.parse(JSON.stringify(h.saved.get(`${scope}:${id}`) ?? null)),
    );
    const v = await h.ready();
    expect((await h.review(v)).status).toBe(200);
    expect(h.store.reserveAgentRun).toHaveBeenCalledTimes(1);
    expect(h.agent).toHaveBeenCalledTimes(1);
  });

  it("returns the injected result and exact tool receipts without changing audit results", async () => {
    const h = await harness();
    const v = await h.ready();
    const before = structuredClone(v.audit);
    const response = await h.review(v);
    expect(response.status).toBe(200);
    const output = await response.json();
    expect(output).toMatchObject({
      status: "completed",
      transport: "injected_offline",
      factualSummary: ["Trusted route fixture; no model was called."],
      sourceAuditId: before.id,
      auditUnchanged: true,
      sourceAuditUnchanged: true,
      sourceAuditSha256: createHash("sha256")
        .update(JSON.stringify(before))
        .digest("hex"),
      trancheId: TRANCHE,
      reservation: {
        durable: "Tiger UNIQUE tranche",
        consumed: true,
        maxModelCalls: 2,
        maxSearchCalls: 1,
      },
      indexing: { indexed: 3, matched: 3, skipped: 0, model: "all-minilm:22m" },
      pricing: { verified: true, fixture: true },
    });
    expect(output.toolReceipts).toEqual([
      { tool: "failure_history", result: [] },
      {
        tool: "search_visibility",
        result: await boundary.search.mock.results[0].value,
      },
    ]);
    const scope = h.store.persistAudit.mock.calls[0][0];
    expect(h.store.reserveAgentRun).toHaveBeenCalledWith(
      scope,
      v.project.id,
      before.id,
      TRANCHE,
    );
    expect(h.store.searchFailuresHybrid).toHaveBeenCalledWith(
      scope,
      v.project.id,
      "mobile_paraphrase",
    );
    expect(h.agent.mock.calls[0][0]).toEqual({
      audit: before,
      task: EVIDENCE_AGENT_TASK,
    });
    expect(boundary.search).toHaveBeenCalledWith(
      expect.objectContaining({ id: v.website.id, url: HOSTED_WEBSITE_URL }),
      expect.objectContaining({
        env: { TEST_FIXTURE: "true" },
        fetcher: expect.any(Function),
      }),
    );
    expect(
      await (await h.request(`/api/audits/${before.id}`, v.cookie)).json(),
    ).toEqual(before);
    expect(h.store.persistAudit).toHaveBeenCalledTimes(1);
  });

  it("keeps a durable tranche spent across duplicate requests and separate visitors", async () => {
    const h = await harness();
    const first = await h.ready();
    const second = await h.ready();
    expect((await h.review(first)).status).toBe(200);
    expect((await h.review(first)).status).toBe(409);
    expect((await h.review(second)).status).toBe(409);
    expect(h.agent).toHaveBeenCalledTimes(1);
    expect(h.store.indexAuditFailures).toHaveBeenCalledTimes(1);
    expect(boundary.search).toHaveBeenCalledTimes(1);
    expect(h.reserved.size).toBe(1);
  });

  it("does not refund failed agent work or expose raw provider errors", async () => {
    const h = await harness({
      evidenceAgent: async () => {
        throw new Error("PRIVATE PROVIDER URL AND KEY");
      },
    });
    const v = await h.ready();
    const response = await h.review(v);
    expect(response.status).toBe(503);
    const body = await response.json();
    expect(body.allowanceConsumed).toBe(true);
    expect(JSON.stringify(body)).not.toContain("PRIVATE");
    expect((await h.review(v)).status).toBe(409);
    expect(h.agent).toHaveBeenCalledTimes(1);
    expect(
      await (await h.request(`/api/audits/${v.audit.id}`, v.cookie)).json(),
    ).toEqual(v.audit);
  });

  it("reports an ambiguous durable reservation conservatively without starting the agent", async () => {
    const h = await harness();
    const v = await h.ready();
    h.store.reserveAgentRun.mockRejectedValueOnce(
      new Error("PRIVATE database transport lost after commit"),
    );
    const response = await h.review(v);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      allowanceConsumed: "unknown; no retry or refund",
    });
    expect(h.agent).not.toHaveBeenCalled();
    expect(h.store.indexAuditFailures).not.toHaveBeenCalled();
  });

  it("checks free Gemma availability and pricing before durable reservation", async () => {
    const unavailable = await harness({ gemmaAvailable: false });
    expect((await unavailable.review(await unavailable.ready())).status).toBe(
      503,
    );
    expect(unavailable.pricing).not.toHaveBeenCalled();
    unavailable.noAgentWork();
    const unconfirmed = await harness({
      verifyGemmaFree: async () => {
        throw new Error("Unconfirmed free pricing");
      },
    });
    expect((await unconfirmed.review(await unconfirmed.ready())).status).toBe(
      503,
    );
    unconfirmed.noAgentWork();
  });

  it("rechecks proof configuration after pricing before reservation", async () => {
    const h = await harness({
      verifyGemmaFree: async () => {
        boundary.configuration.mockReturnValue(null);
        return {};
      },
    });
    expect((await h.review(await h.ready())).status).toBe(404);
    h.noAgentWork();
  });

  it.each(["pricing", "saved read", "reservation", "indexing"] as const)(
    "stops on session expiry during %s without later model or tool work",
    async (stage) => {
      let now = NOW;
      const h = await harness({ now: () => now });
      const v = await h.ready();
      const expire = () => {
        now += 31 * 60_000;
      };
      if (stage === "pricing")
        h.pricing.mockImplementationOnce(async () => {
          expire();
          return {};
        });
      if (stage === "saved read")
        h.store.getAudit.mockImplementationOnce(async () => {
          expire();
          return structuredClone(v.audit);
        });
      if (stage === "reservation")
        h.store.reserveAgentRun.mockImplementationOnce(async () => {
          expire();
          return { reserved: true };
        });
      if (stage === "indexing")
        h.store.indexAuditFailures.mockImplementationOnce(async () => {
          expire();
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
      expect(h.store.searchFailuresHybrid).not.toHaveBeenCalled();
      if (stage === "pricing" || stage === "saved read")
        expect(h.store.reserveAgentRun).not.toHaveBeenCalled();
      else expect((await response.json()).allowanceConsumed).toBe(true);
    },
  );

  it("rejects an already expired session with the recoverable code before pricing", async () => {
    let now = NOW;
    const h = await harness({ now: () => now });
    const v = await h.ready();
    now += 31 * 60_000;
    const response = await h.review(v);
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ code: "SESSION_EXPIRED" });
    expect(h.pricing).not.toHaveBeenCalled();
    h.noAgentWork();
  });

  it("rejects a website plan changed while pricing is pending", async () => {
    const started = deferred<void>();
    const release = deferred<unknown>();
    const h = await harness({
      verifyGemmaFree: () => {
        started.resolve();
        return release.promise;
      },
    });
    const v = await h.ready();
    const pending = h.review(v);
    await started.promise;
    await h.approve({ cookie: v.cookie, project: v.website });
    release.resolve({ verified: true });
    expect((await pending).status).toBe(409);
    h.noAgentWork();
  });

  it("blocks a later model turn after expiry, retaining the spent reservation", async () => {
    let now = NOW;
    const model = vi.fn();
    const h = await harness({
      now: () => now,
      evidenceAgent: async ({ audit }, tools) => {
        expect(tools.beforeModel).toBeTypeOf("function");
        tools.beforeModel!();
        model();
        now += 31 * 60_000;
        tools.beforeModel!();
        model();
        return receipt(audit);
      },
    });
    const v = await h.ready();
    const response = await h.review(v);
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ allowanceConsumed: true });
    expect(model).toHaveBeenCalledTimes(1);
    expect(h.reserved.has(TRANCHE)).toBe(true);
    expect(boundary.search).not.toHaveBeenCalled();
  });

  it("rejects a website mutation after reservation and preserves the source audit", async () => {
    const started = deferred<void>();
    const release = deferred<void>();
    const h = await harness({
      evidenceAgent: async ({ audit }, tools) => {
        started.resolve();
        await release.promise;
        await tools.searchVisibility(new AbortController().signal);
        return receipt(audit);
      },
    });
    const v = await h.ready();
    const pending = h.review(v);
    await started.promise;
    await h.approve({ cookie: v.cookie, project: v.website });
    release.resolve();
    const response = await pending;
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ allowanceConsumed: true });
    expect(boundary.searchOptions).not.toHaveBeenCalled();
    expect(boundary.search).not.toHaveBeenCalled();
    expect(h.reserved.has(TRANCHE)).toBe(true);
    expect(
      await (await h.request(`/api/audits/${v.audit.id}`, v.cookie)).json(),
    ).toEqual(v.audit);
  });

  it.each(["failure history", "search options", "after agent"] as const)(
    "does not publish success when the session expires at %s",
    async (stage) => {
      let now = NOW;
      const h = await harness({
        now: () => now,
        evidenceAgent: async ({ audit }, tools) => {
          if (stage === "failure history") {
            now += 31 * 60_000;
            await tools.failureHistory(
              "mobile_paraphrase",
              new AbortController().signal,
            );
          }
          if (stage === "search options")
            await tools.searchVisibility(new AbortController().signal);
          if (stage === "after agent") now += 31 * 60_000;
          return receipt(audit);
        },
      });
      const v = await h.ready();
      if (stage === "search options")
        boundary.searchOptions.mockImplementationOnce(async () => {
          now += 31 * 60_000;
          return {};
        });
      const response = await h.review(v);
      expect(response.status).toBe(409);
      expect(h.reserved.has(TRANCHE)).toBe(true);
      expect(boundary.search).not.toHaveBeenCalled();
      expect(h.store.searchFailuresHybrid).not.toHaveBeenCalled();
    },
  );

  it("shares one busy lock with model generation and browser audits", async () => {
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
    const duplicate = await h.review(v);
    expect(duplicate.status).toBe(429);
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
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.execute).toHaveBeenCalledTimes(1);
    expect(h.store.reserveAgentRun).toHaveBeenCalledTimes(1);
    release.resolve();
    expect((await pending).status).toBe(200);
    // Completion releases the lock; a normal browser audit can run again.
    expect(
      (await h.request(`/api/projects/${v.project.id}/audits`, v.cookie, {}))
        .status,
    ).toBe(202);
  });

  it("does not reserve an agent run while a Gemma proposal is pending", async () => {
    const started = deferred<void>();
    const release = deferred<unknown>();
    const h = await harness({
      verifyGemmaFree: () => {
        started.resolve();
        return release.promise;
      },
    });
    const v = await h.ready();
    const pending = h.request(
      `/api/projects/${v.project.id}/generate-gemma`,
      v.cookie,
      { modelConsent: true },
    );
    await started.promise;
    expect((await h.review(v)).status).toBe(429);
    h.noAgentWork();
    release.resolve({ verified: true });
    expect((await pending).status).toBe(503); // Trusted proposal fixture throws.
  });

  it("does not reserve an agent run while another browser audit is pending", async () => {
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
    expect((await h.review(v)).status).toBe(429);
    h.noAgentWork();
    release.resolve();
  });
});
