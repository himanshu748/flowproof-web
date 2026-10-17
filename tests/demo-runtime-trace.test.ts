import express from "express";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoRouter } from "../server/demo";
import { runtimeTraceHttpBoundary } from "../server/runtime-trace-gate";
import {
  runtimeTraceHash,
  type exportRuntimeTrace,
  type RuntimeTraceMeasurement,
} from "../server/runtime-trace";
import type { runAudit } from "../server/runner";
import type { Audit, Bootstrap, Project } from "../shared/types";

// HTTP policy fixtures only. The real SDK-free recorder measures the injected
// runner; no Chromium, Sentry SDK export, hosted DB, or external fetch is used.
const gate = vi.hoisted(() => ({
  authorize: vi.fn(),
  configuration: vi.fn(),
  reserve: vi.fn(),
}));
vi.mock("../server/runtime-trace-gate", async (original) => ({
  ...(await original<typeof import("../server/runtime-trace-gate")>()),
  authorizeRuntimeTrace: gate.authorize,
  runtimeTraceConfiguration: gate.configuration,
  reserveRuntimeTraceExport: gate.reserve,
}));
const NOW = Date.parse("2026-10-17T08:00:00Z");
const TOKEN = ["synthetic", "runtime", "operator", "token", "not", "real"].join(
  "-",
);
const UUID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.resetAllMocks();
  // The imported production pre-parser boundary intentionally retains its real
  // local authorization function. Supply a synthetic fresh proof for that path;
  // route-level reservation is separately mocked and never reaches a provider.
  const agent = JSON.stringify({ trancheId: UUID(4), usedRuns: 0 });
  const dsn = new URL("https://o0.ingest.sentry.io/1");
  dsn.username = ["synthetic", "sentry", "public", "key"].join("-");
  const proof = {
    grantId: UUID(1),
    auditReservationId: UUID(2),
    agentReservationId: UUID(3),
    checkedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
    sentryDsnSha256: sha(dsn.href),
    agentProofSha256: sha(agent),
    plan: "Sponsored Team",
    payAsYouGoLimitUsd: 0,
    maximumExports: 2,
    usedExports: 0,
    maximumEnvelopesPerExport: 2,
    evidence: "Synthetic offline authorization fixture; never exported",
  };
  for (const [name, value] of Object.entries({
    FLOWPROOF_TOKEN: TOKEN,
    SENTRY_DSN: dsn.href,
    FLOWPROOF_SENTRY_ENABLED: "true",
    FLOWPROOF_SENTRY_FREE_CONFIRMED: "true",
    FLOWPROOF_SENTRY_FREE_CONFIRMED_AT: new Date(NOW).toISOString(),
    BRIEFSTAMP_RUNTIME_TRACE_ENABLED: "true",
    BRIEFSTAMP_RUNTIME_TRACE_GRANT_JSON: JSON.stringify(proof),
    BRIEFSTAMP_SENTRY_AGENT_PROOF_JSON: agent,
  }))
    vi.stubEnv(name, value);
  gate.authorize.mockImplementation(
    (headers) => headers["x-flowproof-token"] === TOKEN,
  );
  gate.configuration.mockReturnValue({
    proof,
    proofSha256: sha(JSON.stringify(proof)),
  });
  gate.reserve.mockImplementation(async (_kind, _metadata, reserveTiger) => {
    const outcome = await reserveTiger(UUID(2));
    if (!outcome.reserved) throw new Error("Already reserved");
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
type Visitor = { cookie: string; project: Project };
async function harness(
  options: {
    holdAudit?: boolean;
    tigerAvailable?: boolean;
    exporter?: typeof exportRuntimeTrace;
  } = {},
) {
  const root = await mkdtemp(
    path.join(tmpdir(), "briefstamp-runtime-trace-http-"),
  );
  const saved = new Map<string, Audit>();
  const reservations = new Set<string>();
  const events: string[] = [];
  let clock = NOW;
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
        expiresAt: new Date(NOW + 1_800_000).toISOString(),
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
      async (_scope: string, _project: string, _audit: string, id: string) => {
        events.push("tiger-reserve");
        if (reservations.has(id)) return { reserved: false };
        reservations.add(id);
        return { reserved: true };
      },
    ),
    judgeAgentStatus: vi.fn(),
    reserveJudgeAgentRun: vi.fn(),
    appendJudgeAgentResult: vi.fn(),
    close: vi.fn(async () => {}),
  };
  const execute = vi.fn<typeof runAudit>(async (project, audit, onResult) => {
    events.push("browser-start");
    await pending;
    clock += 17;
    const results = audit.checks.map((check) => ({
      checkId: check.id,
      requirement: check.requirement,
      expected: check.expected,
      kind: check.kind,
      status:
        check.kind === "manual" ? ("unverified" as const) : ("failed" as const),
      durationMs: 1,
      evidence: {
        observed: "Offline runner fixture, not actual Chromium",
        url: project.url,
        viewport: { width: 1365, height: 900 },
      },
    }));
    for (const result of results) await onResult(result);
    events.push("browser-end");
    return results;
  });
  const exporter = vi.fn<typeof exportRuntimeTrace>(
    options.exporter ??
      (async (measurement, controls) => {
        events.push("export-callback");
        await controls.reserve({
          operation: "runtime_trace",
          measurementSha256: runtimeTraceHash(measurement),
          units: 1,
          maxEnvelopes: 2,
        });
        events.push("export-fixture");
        return {
          provider: "Sentry",
          mode: "local_capture",
          traceId: "a".repeat(32),
          flushed: true,
          ingestionVerified: false,
          measurementSha256: runtimeTraceHash(measurement),
          maxEnvelopes: 2,
          maxRssMiB: 1,
        };
      }),
  );
  const demo = createDemoRouter({
    evidenceRoot: root,
    secureCookie: false,
    now: () => clock,
    execute,
    gemmaAvailable: () => false,
    tinkerAvailable: () => false,
    tigerAvailable: () => options.tigerAvailable ?? true,
    tigerStore: store,
    runtimeTraceExport: exporter,
  });
  const app = express();
  app.use(runtimeTraceHttpBoundary(() => clock));
  const parsed = vi.fn(
    (
      _request: express.Request,
      _response: express.Response,
      next: express.NextFunction,
    ) => next(),
  );
  app.use(parsed);
  app.use(express.json({ limit: "64kb" }));
  app.use(demo.router);
  app.use(
    (
      _error: unknown,
      _request: express.Request,
      response: express.Response,
      _next: express.NextFunction,
    ) => response.status(400).json({ error: "Malformed request JSON" }),
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
    await rm(root, { recursive: true, force: true });
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
    const data: Bootstrap = await response.json();
    return {
      cookie: response.headers.get("set-cookie")!.split(";")[0],
      project: data.projects[0],
    };
  };
  const getAudit = async (id: string, cookie: string): Promise<Audit> => {
    const response = await request(`/api/audits/${id}`, cookie);
    expect(response.status).toBe(200);
    return response.json();
  };
  const start = async (v: Visitor) => {
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
    return (await response.json()) as Audit;
  };
  const ready = async () => {
    const v = await visitor();
    const initial = await start(v);
    for (let count = 0; count < 50; count++) {
      const audit = await getAudit(initial.id, v.cookie);
      const persistence = await (
        await request(`/api/audits/${initial.id}/persistence`, v.cookie)
      ).json();
      if (audit.status === "completed" && persistence.status !== "saving")
        return { ...v, audit };
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    throw Error("Offline audit not completed");
  };
  const exportAudit = (v: Visitor & { audit: Audit }) =>
    request(`/api/audits/${v.audit.id}/runtime-trace`, v.cookie, {}, TOKEN);
  const noExport = () => {
    expect(exporter).not.toHaveBeenCalled();
    expect(gate.reserve).not.toHaveBeenCalled();
    expect(store.reserveAgentRun).not.toHaveBeenCalled();
  };
  return {
    request,
    visitor,
    start,
    ready,
    getAudit,
    exportAudit,
    noExport,
    execute,
    exporter,
    saved,
    store,
    events,
    parsed,
    release,
  };
}

describe(
  "protected measured runtime-trace HTTP export",
  { timeout: 15_000 },
  () => {
    it("returns anonymous and wrong-token 404 before JSON parsing or audit lookup", async () => {
      const h = await harness();
      for (const token of [
        undefined,
        ["wrong", "operator", "token"].join("-"),
      ]) {
        h.parsed.mockClear();
        const response = await h.request(
          `/api/audits/${UUID(20)}/runtime-trace`,
          "",
          {},
          token,
          "POST",
          "{",
        );
        expect(response.status).toBe(404);
        expect(h.parsed).not.toHaveBeenCalled();
      }
      expect(h.store.getAudit).not.toHaveBeenCalled();
      h.noExport();
    });
    it("hides another visitor's audit even from an authorized export caller", async () => {
      const h = await harness(),
        owner = await h.ready(),
        other = await h.visitor();
      h.store.getAudit.mockClear();
      const response = await h.request(
        `/api/audits/${owner.audit.id}/runtime-trace`,
        other.cookie,
        {},
        TOKEN,
      );
      expect(response.status).toBe(404);
      expect(h.store.getAudit).not.toHaveBeenCalled();
      h.noExport();
    });
    it("refuses unapproved audit execution before recording browser work", async () => {
      const h = await harness(),
        v = await h.visitor();
      const response = await h.request(
        `/api/projects/${v.project.id}/audits`,
        v.cookie,
        {},
      );
      expect(response.status).toBe(409);
      expect(h.execute).not.toHaveBeenCalled();
      h.noExport();
    });
    it("rejects an incomplete audit without exporting partial timings", async () => {
      const h = await harness({ holdAudit: true }),
        v = await h.visitor(),
        audit = await h.start(v);
      const response = await h.exportAudit({ ...v, audit });
      expect(response.status).toBe(409);
      h.noExport();
      h.release();
    });
    it("rejects unavailable Tiger storage before export", async () => {
      const h = await harness({ tigerAvailable: false }),
        v = await h.ready();
      const response = await h.exportAudit(v);
      expect(response.status).toBe(503);
      h.noExport();
    });
    it.each(["missing", "mismatch", "read-error"])(
      "does not export when persisted source is %s",
      async (mode) => {
        const h = await harness(),
          v = await h.ready();
        if (mode === "missing") h.store.getAudit.mockResolvedValueOnce(null);
        else if (mode === "read-error")
          h.store.getAudit.mockRejectedValueOnce(
            new Error("Private DB details"),
          );
        else
          h.store.getAudit.mockResolvedValueOnce({
            ...v.audit,
            projectName: "Changed stored snapshot",
          });
        const response = await h.exportAudit(v),
          result = await response.json();
        expect(response.status).toBe(200);
        expect(result.status).toBe("unavailable");
        expect(result).not.toHaveProperty("traceId");
        expect(JSON.stringify(result)).not.toContain("Private");
        h.noExport();
        expect(await h.getAudit(v.audit.id, v.cookie)).toEqual(v.audit);
      },
    );
    it("exports actual measured runner timestamps once after durable reservation and caches the receipt", async () => {
      const h = await harness(),
        v = await h.ready(),
        source = structuredClone(v.audit);
      const response = await h.exportAudit(v),
        result = await response.json();
      expect(response.status).toBe(200);
      expect(result.ingestionVerified).toBe(false);
      expect(result.sourceAuditUnchanged).toBe(true);
      expect(result.observedSpanCount).toBe(2);
      const measurement: RuntimeTraceMeasurement = h.exporter.mock.calls[0][0];
      expect(measurement.operation).toBe("briefstamp.audit");
      expect(measurement.complete).toBe(true);
      expect(measurement.spans).toHaveLength(1);
      expect(measurement.spans[0]).toMatchObject({
        operation: "briefstamp.audit.browser",
        parentIndex: 0,
        startedAtMs: NOW,
        endedAtMs: NOW + 17,
        status: "ok",
      });
      expect(measurement.startedAtMs).toBe(NOW);
      expect(measurement.endedAtMs).toBe(NOW + 17);
      expect(h.events).toEqual([
        "browser-start",
        "browser-end",
        "export-callback",
        "tiger-reserve",
        "export-fixture",
      ]);
      expect(h.store.reserveAgentRun).toHaveBeenCalledOnce();
      expect(h.store.reserveAgentRun.mock.calls[0].slice(1)).toEqual([
        v.audit.projectId,
        v.audit.id,
        UUID(2),
      ]);
      expect(await h.getAudit(v.audit.id, v.cookie)).toEqual(source);
      const reads = h.store.getAudit.mock.calls.length;
      const repeated = await h.exportAudit(v);
      expect(repeated.status).toBe(200);
      expect(await repeated.json()).toEqual(result);
      expect(h.exporter).toHaveBeenCalledOnce();
      expect(gate.reserve).toHaveBeenCalledOnce();
      expect(h.store.reserveAgentRun).toHaveBeenCalledOnce();
      expect(h.store.getAudit).toHaveBeenCalledTimes(reads);
      expect(h.store.reserveJudgeAgentRun).not.toHaveBeenCalled();
      expect(h.store.appendJudgeAgentResult).not.toHaveBeenCalled();
      expect(JSON.stringify(measurement)).not.toContain(v.audit.id);
      expect(JSON.stringify(measurement)).not.toContain(v.project.brief);
    });
    it("caches exporter failure with no fabricated trace ID and leaves audit acceptance unchanged", async () => {
      const exporter: typeof exportRuntimeTrace = async (
        measurement,
        controls,
      ) => {
        await controls.reserve({
          operation: "runtime_trace",
          measurementSha256: runtimeTraceHash(measurement),
          units: 1,
          maxEnvelopes: 2,
        });
        throw new Error("Private SDK error and request data");
      };
      const h = await harness({ exporter }),
        v = await h.ready();
      const response = await h.exportAudit(v),
        result = await response.json();
      expect(response.status).toBe(200);
      expect(result).toMatchObject({
        status: "unavailable",
        ingestionVerified: false,
        sourceAuditUnchanged: true,
      });
      expect(result).not.toHaveProperty("traceId");
      expect(result).not.toHaveProperty("measurement");
      expect(JSON.stringify(result)).not.toContain("Private");
      const again = await h.exportAudit(v);
      expect(await again.json()).toEqual(result);
      expect(h.exporter).toHaveBeenCalledOnce();
      expect(h.store.reserveAgentRun).toHaveBeenCalledOnce();
      expect(await h.getAudit(v.audit.id, v.cookie)).toEqual(v.audit);
    });
  },
);
