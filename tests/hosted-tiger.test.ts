import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Audit } from "../shared/types";
import {
  HOSTED_WEBSITE_URL,
  HOSTED_WEBSITE_BRIEF,
} from "../shared/hosted-target";
import {
  createHostedTigerStore,
  hostedTigerEnabled,
} from "../server/hosted-tiger";

const pgMock = vi.hoisted(() => ({
  query: vi.fn(),
  end: vi.fn(),
  pool: vi.fn(),
  on: vi.fn(),
}));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      constructor(config: unknown) {
        pgMock.pool(config);
      }
      query = pgMock.query;
      end = pgMock.end;
      on = pgMock.on;
    },
  },
}));
const NOW = Date.parse("2026-10-15T10:00:00Z");
const env = {
  BRIEFSTAMP_TIGER_ENABLED: "true",
  BRIEFSTAMP_TIGER_CONFIRMED_FREE_UNTIL: "2026-10-20T00:00:00Z",
  BRIEFSTAMP_TIGER_DATABASE_URL:
    "postgresql://briefstamp_demo_runtime:synthetic-private-password@service.region.tsdb.cloud.timescale.com:5432/tsdb",
};
const session = "a".repeat(64),
  other = "b".repeat(64);
const auditId = "1d568de6-e3c0-4e37-9e9e-e6a3c26cbb2e",
  projectId = "6af66504-cb40-451b-8d49-4af643520d29";
const fixture = (): Audit => ({
  id: auditId,
  projectId,
  projectName: "Synthetic Forma sample",
  status: "completed",
  createdAt: "2026-10-15T09:59:00Z",
  completedAt: "2026-10-15T10:00:00Z",
  checks: [
    {
      id: "heading-check",
      requirement: 'The heading must say "Welcome".',
      kind: "heading",
      expected: "Welcome",
      path: "/",
      viewport: "desktop",
      approved: true,
    },
  ],
  source: {
    target: "sample",
    url: "https://sample.flowproof.test/",
    sampleVariant: "broken",
    brief: 'The heading must say "Welcome".',
    generator: { provider: "Deterministic parser", model: null },
  },
  results: [
    {
      checkId: "heading-check",
      requirement: 'The heading must say "Welcome".',
      kind: "heading",
      expected: "Welcome",
      status: "failed",
      durationMs: 2,
      evidence: {
        observed: "No matching heading",
        dom: "Actual synthetic heading",
        url: "https://sample.flowproof.test/",
        screenshot: `/evidence/${auditId}/heading.png`,
        viewport: { width: 1365, height: 900 },
      },
    },
  ],
});
beforeEach(() => {
  vi.resetAllMocks();
  pgMock.query.mockResolvedValue({ rows: [] });
  pgMock.end.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("completed native approval persistence", () => {
  const approvedFixture = (): Audit => {
    const audit = fixture();
    audit.approvalWorkflow = {
      provider: "Mastra",
      package: "@mastra/core",
      version: "1.77.0",
      workflowId: "briefstamp-explicit-approval",
      runId: projectId,
      status: "success",
      scope: "process-local",
      durable: false,
      maxRssMiB: 150,
      steps: [
        "propose-checks",
        "validate-proposal",
        "await-developer-approval",
        "browser-handoff",
      ].map((id) => ({ id, status: "success" })),
      lifecycle: ["approval", "browser", "complete"].map((phase, i) => ({
        phase: phase as "approval" | "browser" | "complete",
        status: i === 2 ? "success" : "suspended",
        runId: projectId,
        snapshotSha256: i === 2 ? null : "a".repeat(64),
        workerMaxRssMiB: 150,
        workerExited: true,
      })),
      result: {
        results: structuredClone(audit.results),
        approvedCheckIds: audit.checks.map((c) => c.id),
        planDigest: "b".repeat(64),
      },
    };
    return audit;
  };
  it("round-trips the real receipt shape without dropping approval or result evidence", async () => {
    const audit = approvedFixture();
    const store = createHostedTigerStore({ env, now: () => NOW });
    pgMock.query.mockResolvedValueOnce({ rows: [{ audit_id: auditId }] });
    await store.persistAudit(session, audit);
    expect(JSON.parse(pgMock.query.mock.calls[0][1][3])).toEqual(audit);
    pgMock.query.mockResolvedValueOnce({ rows: [{ payload: audit }] });
    expect(await store.getAudit(session, auditId)).toEqual(audit);
  });
  it("rejects mismatched results, approvals, lifecycle identities and private snapshots before I/O", async () => {
    const store = createHostedTigerStore({ env, now: () => NOW });
    for (const mutate of [
      (a: Audit) => {
        a.approvalWorkflow!.result!.results[0].status = "passed";
      },
      (a: Audit) => {
        a.approvalWorkflow!.result!.approvedCheckIds = ["foreign"];
      },
      (a: Audit) => {
        a.approvalWorkflow!.lifecycle![0].runId = auditId;
      },
      (a: Audit) => {
        Object.assign(a.approvalWorkflow!, { nativeSnapshot: {} });
      },
      (a: Audit) => {
        a.approvalWorkflow!.status = "suspended";
      },
      (a: Audit) => {
        a.approvalWorkflow!.lifecycle![2].snapshotSha256 = "a".repeat(64);
      },
    ]) {
      const audit = approvedFixture();
      mutate(audit);
      await expect(store.persistAudit(session, audit)).rejects.toThrow();
      expect(pgMock.query).not.toHaveBeenCalled();
    }
  });
});

describe("disabled-by-default scoped hosted Tiger adapter", () => {
  it("round-trips bounded Gemma usage and retry receipts without accepting raw diagnostics", async () => {
    const value = fixture();
    value.source!.generator = {
      provider: "Google Gemma (live API)",
      model: "gemma-4-26b-a4b-it",
      usage: { promptTokens: 335, completionTokens: 300, totalTokens: 635 },
      attempts: [
        {
          index: 1,
          status: 500,
          durationMs: 12,
          requestBytes: 1928,
          retryDelayMs: 1000,
          usage: null,
          providerStatus: "INTERNAL",
        },
        {
          index: 2,
          status: 200,
          durationMs: 400,
          requestBytes: 1928,
          retryDelayMs: 0,
          usage: { promptTokens: 335, completionTokens: 300, totalTokens: 635 },
          providerStatus: null,
        },
      ],
    };
    const store = createHostedTigerStore({ env, now: () => NOW });
    pgMock.query.mockResolvedValueOnce({ rows: [{ audit_id: auditId }] });
    await store.persistAudit(session, value);
    expect(JSON.parse(pgMock.query.mock.calls[0][1][3])).toEqual(value);
    pgMock.query.mockResolvedValueOnce({ rows: [{ payload: value }] });
    expect(await store.getAudit(session, auditId)).toEqual(value);
    const invalid = structuredClone(value);
    Object.assign(invalid.source!.generator.attempts![0], {
      privateMessage: "not allowed",
    });
    await expect(store.persistAudit(session, invalid)).rejects.toThrow();
  });
  it("round-trips only the preauthorized live landing, with its source and evidence bound together", async () => {
    const live = fixture();
    live.source = {
      ...live.source!,
      target: "website",
      url: HOSTED_WEBSITE_URL,
      brief: HOSTED_WEBSITE_BRIEF,
      sampleVariant: "healthy",
    };
    live.results[0].evidence.url = HOSTED_WEBSITE_URL;
    const store = createHostedTigerStore({ env, now: () => NOW });
    pgMock.query.mockResolvedValueOnce({ rows: [{ audit_id: auditId }] });
    expect(await store.persistAudit(session, live)).toMatchObject({
      inserted: true,
    });
    pgMock.query.mockResolvedValueOnce({ rows: [{ payload: live }] });
    expect(await store.getAudit(session, auditId)).toEqual(live);
    const changes = [
      (a: Audit) => {
        a.source!.url = HOSTED_WEBSITE_URL + "api/bootstrap";
      },
      (a: Audit) => {
        a.checks[0].path = "/api/bootstrap";
      },
      (a: Audit) => {
        a.source!.brief = "Unapproved private client brief";
      },
      (a: Audit) => {
        a.source!.target = "sample";
      },
      (a: Audit) => {
        a.results[0].evidence.url = "https://sample.flowproof.test/";
      },
      (a: Audit) => {
        a.results[0].evidence.url =
          "https://flowproof-demo.onrender.com.evil.invalid/";
      },
    ];
    for (const change of changes) {
      const invalid = structuredClone(live);
      change(invalid);
      const calls = pgMock.query.mock.calls.length;
      await expect(store.persistAudit(session, invalid)).rejects.toThrow();
      expect(pgMock.query.mock.calls.length).toBe(calls);
    }
  });
  it("constructs and inspects configuration offline; uses existing strict TLS config with bounded pool and no DDL", async () => {
    const store = createHostedTigerStore({ env, now: () => NOW });
    expect(hostedTigerEnabled(env, NOW)).toBe(true);
    expect(hostedTigerEnabled({}, NOW)).toBe(false);
    expect(pgMock.pool).not.toHaveBeenCalled();
    pgMock.query.mockResolvedValueOnce({ rows: [{ audit_id: auditId }] });
    expect(await store.persistAudit(session, fixture())).toEqual({
      inserted: true,
      expiresAt: "2026-10-15T10:29:00.000Z",
    });
    expect(pgMock.pool).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        ssl: {
          rejectUnauthorized: true,
          servername: "service.region.tsdb.cloud.timescale.com",
        },
        max: 2,
        connectionTimeoutMillis: 5000,
        statement_timeout: 5000,
        query_timeout: 5500,
        idleTimeoutMillis: 10_000,
      }),
    );
    const [sql, values] = pgMock.query.mock.calls[0];
    expect(sql).toMatch(/^INSERT INTO briefstamp_demo_v1\.audits/);
    expect(sql).toContain("ON CONFLICT (session_hash,audit_id) DO NOTHING");
    expect(sql).not.toMatch(/CREATE|ALTER|UPDATE|DROP/i);
    expect(values.slice(0, 3)).toEqual([session, auditId, projectId]);
    expect(JSON.parse(values[3])).toEqual(fixture());
    expect(values[5]).toBe("2026-10-15T10:29:00.000Z");
    await store.close();
    expect(pgMock.end).toHaveBeenCalledOnce();
  });

  it.each([
    { BRIEFSTAMP_TIGER_ENABLED: "false" },
    { BRIEFSTAMP_TIGER_CONFIRMED_FREE_UNTIL: "2026-10-15T10:00:00Z" },
    { BRIEFSTAMP_TIGER_CONFIRMED_FREE_UNTIL: "2026-10-20T00:00:01Z" },
    { BRIEFSTAMP_TIGER_CONFIRMED_FREE_UNTIL: "October 20 2026" },
    {
      BRIEFSTAMP_TIGER_DATABASE_URL: env.BRIEFSTAMP_TIGER_DATABASE_URL.replace(
        "service.region.tsdb.cloud.timescale.com",
        "localhost",
      ),
    },
    {
      BRIEFSTAMP_TIGER_DATABASE_URL: env.BRIEFSTAMP_TIGER_DATABASE_URL.replace(
        "service.region.tsdb.cloud.timescale.com",
        "service.region.tsdb.cloud.timescale.com.attacker.invalid",
      ),
    },
    {
      BRIEFSTAMP_TIGER_DATABASE_URL: env.BRIEFSTAMP_TIGER_DATABASE_URL.replace(
        "briefstamp_demo_runtime",
        "tsdbadmin",
      ),
    },
    {
      BRIEFSTAMP_TIGER_DATABASE_URL: `${env.BRIEFSTAMP_TIGER_DATABASE_URL}?sslmode=disable`,
    },
    {
      BRIEFSTAMP_TIGER_DATABASE_URL: `${env.BRIEFSTAMP_TIGER_DATABASE_URL}?options=anything`,
    },
    { DATABASE_SSL: "false" },
    { NODE_TLS_REJECT_UNAUTHORIZED: "0" },
    { PGSSLMODE: "require" },
    { PGSSLROOTCERT: "/unverified.pem" },
    { NODE_EXTRA_CA_CERTS: "/unverified.pem" },
  ])(
    "rejects unapproved, expired, unrelated or TLS-weakened configuration before connection %#",
    async (override) => {
      const configured = { ...env, ...override };
      expect(hostedTigerEnabled(configured, NOW)).toBe(false);
      await expect(
        createHostedTigerStore({ env: configured, now: () => NOW }).getAudit(
          session,
          auditId,
        ),
      ).rejects.toThrow("unavailable");
      expect(pgMock.pool).not.toHaveBeenCalled();
      expect(pgMock.query).not.toHaveBeenCalled();
    },
  );

  it("enforces the seven-day window and rechecks expiry even after a pool was opened", async () => {
    expect(hostedTigerEnabled(env, Date.parse("2026-10-12T00:00:00Z"))).toBe(
      false,
    );
    let current = NOW;
    const store = createHostedTigerStore({ env, now: () => current });
    await store.getAudit(session, auditId);
    current = Date.parse(env.BRIEFSTAMP_TIGER_CONFIRMED_FREE_UNTIL);
    await expect(store.getAudit(session, auditId)).rejects.toThrow(
      "unavailable",
    );
    expect(pgMock.query).toHaveBeenCalledOnce();
  });

  it("scopes audit reads by session and id, filters expiry, and rejects mismatched stored identity", async () => {
    const store = createHostedTigerStore({ env, now: () => NOW });
    pgMock.query.mockImplementation(async (_sql, values) => ({
      rows: values[0] === session ? [{ payload: fixture() }] : [],
    }));
    expect(await store.getAudit(session, auditId)).toEqual(fixture());
    expect(await store.getAudit(other, auditId)).toBeNull();
    expect(pgMock.query.mock.calls[1]).toEqual([
      expect.stringContaining(
        "session_hash=$1 AND audit_id=$2 AND expires_at>now()",
      ),
      [other, auditId],
    ]);
    pgMock.query.mockResolvedValueOnce({
      rows: [{ payload: { ...fixture(), id: projectId } }],
    });
    await expect(store.getAudit(session, auditId)).rejects.toThrow();
  });

  it("uses bounded parameterized lexical search over only that session's project failures", async () => {
    const store = createHostedTigerStore({ env, now: () => NOW });
    const row = {
      auditId,
      projectId,
      createdAt: fixture().createdAt,
      kind: "heading",
      status: "failed",
      requirement: fixture().checks[0].requirement,
      observed: "No matching heading",
    };
    pgMock.query.mockResolvedValueOnce({ rows: [row] });
    const query = "heading'); DROP TABLE public.users; --";
    expect(await store.searchFailures(session, { projectId, query })).toEqual([
      { ...row, retrieval: "lexical" },
    ]);
    const [sql, params] = pgMock.query.mock.calls[0];
    expect(params).toEqual([session, projectId, query]);
    expect(sql).not.toContain(query);
    expect(sql).toContain(
      "a.session_hash=$1 AND a.project_id=$2 AND a.expires_at>now()",
    );
    expect(sql).toContain("r->>'status' IN ('failed','blocked')");
    expect(sql).toContain("plainto_tsquery('simple',$3)");
    expect(sql).toContain("LIMIT 20");
    expect(sql).not.toMatch(/\bvector\s*\(|embedding/i);
    pgMock.query.mockResolvedValueOnce({
      rows: [{ ...row, projectId: auditId }],
    });
    await expect(
      store.searchFailures(session, { projectId, query: "heading" }),
    ).rejects.toThrow();
  });

  it("redacts known text fields while keeping IDs, timestamps and screenshot references intact", async () => {
    const value = fixture();
    value.projectName = "token=private-example-token";
    value.results[0].evidence.dom =
      "Email person@example.invalid and token=secret-value";
    value.results[0].evidence.observed = "Contact person@example.invalid";
    await createHostedTigerStore({ env, now: () => NOW }).persistAudit(
      session,
      value,
    );
    const payload = JSON.parse(pgMock.query.mock.calls[0][1][3]);
    expect(payload.id).toBe(auditId);
    expect(payload.createdAt).toBe(value.createdAt);
    expect(payload.results[0].evidence.screenshot).toBe(
      value.results[0].evidence.screenshot,
    );
    expect(JSON.stringify(payload)).not.toContain("private-example-token");
    expect(JSON.stringify(payload)).not.toContain("person@example.invalid");
    expect(JSON.stringify(payload)).not.toContain("secret-value");
    expect(value.results[0].evidence.dom).toContain("secret-value");
  });

  it("rejects non-synthetic, unfinished, stale, mismatched, unapproved and binary evidence before SQL", async () => {
    const variants: Audit[] = [];
    const edit = (mutate: (value: Audit) => void) => {
      const value = fixture();
      mutate(value);
      variants.push(value);
    };
    edit((a) => {
      a.source!.target = "website";
    });
    edit((a) => {
      a.source!.url = "https://private-client.invalid/";
    });
    edit((a) => {
      a.results[0].evidence.url =
        "https://secret:password@sample.flowproof.test/";
    });
    edit((a) => {
      a.status = "running";
    });
    edit((a) => {
      a.createdAt = "2026-10-15T09:30:00Z";
    });
    edit((a) => {
      a.results[0].expected = "Different assertion";
    });
    edit((a) => {
      a.checks[0].approved = false;
    });
    edit((a) => {
      a.results.push(a.results[0]);
    });
    edit((a) => {
      a.results[0].evidence.screenshot = "data:image/png;base64,AAAA";
    });
    edit((a) => {
      a.results[0].evidence.screenshot = `/evidence/${projectId}/other.png`;
    });
    edit((a) => {
      a.summary = "x".repeat(2 * 1024 * 1024);
    });
    edit((a) => {
      a.checks[0].kind = "manual";
      a.results[0].kind = "manual";
      a.results[0].status = "passed";
    });
    const store = createHostedTigerStore({ env, now: () => NOW });
    for (const value of variants)
      await expect(store.persistAudit(session, value)).rejects.toThrow();
    expect(pgMock.query).not.toHaveBeenCalled();
    expect(pgMock.pool).not.toHaveBeenCalled();
  });

  it("rejects invalid scopes/search budgets before SQL and suppresses provider errors", async () => {
    const store = createHostedTigerStore({ env, now: () => NOW });
    await expect(store.getAudit("unhashed-cookie", auditId)).rejects.toThrow();
    await expect(
      store.searchFailures(session, { projectId, query: "x".repeat(201) }),
    ).rejects.toThrow();
    await expect(
      store.searchFailures(session, { projectId, query: "" }),
    ).rejects.toThrow();
    expect(pgMock.query).not.toHaveBeenCalled();
    pgMock.query.mockRejectedValueOnce(
      new Error(`Database secret ${env.BRIEFSTAMP_TIGER_DATABASE_URL}`),
    );
    const error = await store
      .getAudit(session, auditId)
      .catch((error) => error);
    expect(String(error)).toContain("Hosted Tiger is unavailable");
    expect(String(error)).not.toContain("synthetic-private-password");
    expect(pgMock.query).toHaveBeenCalledOnce();
  });
});
