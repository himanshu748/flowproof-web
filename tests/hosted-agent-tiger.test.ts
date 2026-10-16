import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  parseAgentRetrievalCatalog,
  retrievalTextSha256,
} from "../server/agent-retrieval-catalog";
import { createHostedTigerStore } from "../server/hosted-tiger";
import type { Audit } from "../shared/types";

const sql = vi.hoisted(() => ({ query: vi.fn(), pool: vi.fn() }));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      constructor(config: unknown) {
        sql.pool(config);
      }
      query = sql.query;
      on = vi.fn();
      end = vi.fn();
    },
  },
}));
const NOW = Date.parse("2026-10-16T10:00:00Z");
const scope = "a".repeat(64),
  other = "b".repeat(64);
const auditId = "1d568de6-e3c0-4e37-9e9e-e6a3c26cbb2e";
const projectId = "6af66504-cb40-451b-8d49-4af643520d29";
const env = {
  BRIEFSTAMP_TIGER_ENABLED: "true",
  BRIEFSTAMP_TIGER_CONFIRMED_FREE_UNTIL: "2026-10-20T00:00:00Z",
  BRIEFSTAMP_TIGER_DATABASE_URL:
    "postgresql://briefstamp_demo_runtime:fixture-password@service.region.tsdb.cloud.timescale.com:5432/tsdb",
};
const text =
  "The site must fit a mobile screen.\nHorizontal overflow observed.";
// Deliberately synthetic unit-test vectors, never published as model evidence.
const basis = (index: number): number[] =>
  Array.from({ length: 384 }, (_, i) => (i === index ? 1 : 0));
const rawCatalog = () => ({
  version: 1,
  model: "all-minilm:22m",
  dimensions: 384,
  documents: [
    { textSha256: retrievalTextSha256(text), text, vector: basis(0) },
  ],
  queries: [
    {
      id: "mobile_paraphrase",
      text: "sideways panning on smartphones",
      vector: basis(0),
    },
    { id: "images", text: "image alternative text", vector: basis(1) },
    { id: "contact", text: "contact link", vector: basis(2) },
  ],
  provenance: {
    modelDigest: "c".repeat(64),
    generatedAt: "2026-10-16T09:00:00Z",
    source: "Synthetic test fixture; no model call.",
  },
});
const catalog = () => parseAgentRetrievalCatalog(rawCatalog());
const fixture = (): Audit => ({
  id: auditId,
  projectId,
  projectName: "Synthetic unit fixture",
  status: "completed",
  createdAt: "2026-10-16T09:59:00Z",
  completedAt: "2026-10-16T10:00:00Z",
  checks: [
    {
      id: "mobile",
      requirement: text.split("\n")[0],
      kind: "no_horizontal_overflow",
      expected: "No horizontal overflow",
      path: "/",
      viewport: "mobile",
      approved: true,
    },
  ],
  source: {
    target: "sample",
    url: "https://sample.flowproof.test/",
    sampleVariant: "broken",
    brief: "Synthetic test fixture",
    generator: { provider: "Deterministic", model: null },
  },
  results: [
    {
      checkId: "mobile",
      requirement: text.split("\n")[0],
      kind: "no_horizontal_overflow",
      expected: "No horizontal overflow",
      status: "failed",
      durationMs: 1,
      evidence: {
        observed: text.split("\n")[1],
        url: "https://sample.flowproof.test/",
        viewport: { width: 390, height: 844 },
      },
    },
  ],
});
const store = (options: { now?: () => number } = {}) =>
  createHostedTigerStore({
    env,
    now: () => NOW,
    catalog: async () => catalog(),
    ...options,
  });
const hybridRow = () => ({
  auditId,
  projectId,
  checkId: "mobile",
  kind: "no_horizontal_overflow",
  status: "failed",
  requirement: text.split("\n")[0],
  observed: text.split("\n")[1],
  textSha256: retrievalTextSha256(text),
  model: "all-minilm:22m",
  modelDigest: catalog().provenance.modelDigest,
  catalogSha256: catalog().catalogSha256,
  lexicalScore: 0,
  lexicalRank: null,
  vectorRank: 1,
  cosine: 1,
  rrf: 1 / 61,
});
beforeEach(() => {
  vi.resetAllMocks();
  sql.query.mockResolvedValue({ rows: [] });
});
afterEach(() => vi.unstubAllEnvs());

describe("fixed real-embedding catalog contract", () => {
  it("binds exact text and model provenance to a stable catalog fingerprint", () => {
    expect(catalog().catalogSha256).toBe(catalog().catalogSha256);
    const changed = rawCatalog();
    changed.provenance.modelDigest = "d".repeat(64);
    expect(parseAgentRetrievalCatalog(changed).catalogSha256).not.toBe(
      catalog().catalogSha256,
    );
  });
  it.each([
    "dimension",
    "nan",
    "zero",
    "unnormalized",
    "text",
    "duplicate",
    "missing-query",
  ])("rejects %s without inventing a replacement vector", (variant) => {
    const value = rawCatalog();
    if (variant === "dimension") value.documents[0].vector.pop();
    if (variant === "nan") value.documents[0].vector[1] = NaN;
    if (variant === "zero") value.documents[0].vector = Array(384).fill(0);
    if (variant === "unnormalized") value.documents[0].vector[0] = 0.5;
    if (variant === "text") value.documents[0].text += " changed";
    if (variant === "duplicate") value.documents.push(value.documents[0]);
    if (variant === "missing-query") value.queries[2].id = "images";
    expect(() => parseAgentRetrievalCatalog(value)).toThrow();
  });
});

describe("append-only hosted Tiger agent retrieval", () => {
  it("indexes only the exact saved failed observation, without changing canonical audit JSON", async () => {
    const value = fixture(),
      original = structuredClone(value);
    sql.query
      .mockResolvedValueOnce({ rows: [{ payload: value }] })
      .mockResolvedValueOnce({ rows: [{ check_id: "mobile" }] });
    expect(await store().indexAuditFailures(scope, auditId)).toMatchObject({
      indexed: 1,
      matched: 1,
      skipped: 0,
      model: "all-minilm:22m",
    });
    const [statement, parameters] = sql.query.mock.calls[1];
    expect(statement).toContain(
      "a.session_hash=$1 AND a.audit_id=$2 AND a.project_id=$3 AND a.expires_at>now()",
    );
    expect(statement).toContain("r->>'status' IN ('failed','blocked')");
    expect(statement).toContain(
      "ON CONFLICT (session_hash,audit_id,check_id) DO NOTHING",
    );
    expect(statement).not.toMatch(/\b(UPDATE|DELETE|CREATE|ALTER)\b/i);
    expect(parameters.slice(0, 3)).toEqual([scope, auditId, projectId]);
    expect(JSON.parse(parameters[3])).toEqual([
      {
        check_id: "mobile",
        text,
        text_sha256: retrievalTextSha256(text),
        embedding: basis(0),
      },
    ]);
    expect(value).toEqual(original);
    sql.query.mockResolvedValueOnce({ rows: [{ payload: value }] });
    expect(await store().getAudit(scope, auditId)).toEqual(original);
  });
  it("abstains on changed observation text and passed checks instead of attaching similar vectors", async () => {
    const value = fixture();
    value.results[0].evidence.observed += " Different width.";
    sql.query.mockResolvedValueOnce({ rows: [{ payload: value }] });
    expect(await store().indexAuditFailures(scope, auditId)).toMatchObject({
      indexed: 0,
      matched: 0,
      skipped: 1,
    });
    expect(sql.query).toHaveBeenCalledOnce();
    value.results[0].status = "passed";
    sql.query.mockResolvedValueOnce({ rows: [{ payload: value }] });
    expect(await store().indexAuditFailures(scope, auditId)).toMatchObject({
      indexed: 0,
      matched: 0,
      skipped: 0,
    });
    expect(sql.query).toHaveBeenCalledTimes(2);
  });
  it("rejects absent, stale and invalid-source audits before embedding insertion", async () => {
    await expect(store().indexAuditFailures(other, auditId)).rejects.toThrow();
    for (const edit of [
      (a: Audit) => {
        a.createdAt = "2026-10-16T09:00:00Z";
      },
      (a: Audit) => {
        a.source!.url = "https://foreign.invalid/";
      },
    ]) {
      const value = fixture();
      edit(value);
      sql.query.mockResolvedValueOnce({ rows: [{ payload: value }] });
      await expect(
        store().indexAuditFailures(scope, auditId),
      ).rejects.toThrow();
    }
    expect(
      sql.query.mock.calls.every(([statement]) =>
        statement.startsWith("SELECT payload"),
      ),
    ).toBe(true);
  });
  it("uses scoped parameterized cosine plus lexical RRF with no lexical-match prerequisite", async () => {
    sql.query.mockResolvedValueOnce({ rows: [hybridRow()] });
    expect(
      await store().searchFailuresHybrid(scope, projectId, "mobile_paraphrase"),
    ).toEqual([
      { ...hybridRow(), retrieval: "hybrid-rrf", queryId: "mobile_paraphrase" },
    ]);
    const [statement, parameters] = sql.query.mock.calls[0];
    expect(parameters).toEqual([
      scope,
      projectId,
      "sideways panning on smartphones",
      basis(0),
      catalog().model,
      catalog().provenance.modelDigest,
      catalog().catalogSha256,
    ]);
    expect(statement).toContain(
      "a.session_hash=$1 AND a.project_id=$2 AND a.expires_at>now()",
    );
    expect(statement).toContain("e.session_hash=$1 AND e.project_id=$2");
    expect(statement).toContain("unnest(e.embedding,$4::double precision[])");
    expect(statement).toContain("ts_rank_cd");
    expect(statement).toContain('1.0/(60+"vectorRank")');
    expect(statement).toContain("LIMIT 20");
    expect(statement).not.toContain("@@");
    expect(statement).not.toContain(parameters[2]);
  });
  it("independently checks returned source fingerprints, cosine and RRF arithmetic", async () => {
    for (const change of [
      { projectId: auditId },
      { observed: "Fabricated observation" },
      { textSha256: "d".repeat(64) },
      { cosine: 0.5 },
      { rrf: 0.9 },
      { lexicalScore: 1 },
      { modelDigest: "d".repeat(64) },
      { catalogSha256: "d".repeat(64) },
      { status: "passed" },
    ]) {
      sql.query.mockResolvedValueOnce({
        rows: [{ ...hybridRow(), ...change }],
      });
      await expect(
        store().searchFailuresHybrid(scope, projectId, "mobile_paraphrase"),
      ).rejects.toThrow();
    }
    const row = {
      ...hybridRow(),
      lexicalScore: 0.1,
      lexicalRank: 1,
      rrf: 2 / 61,
    };
    sql.query.mockResolvedValueOnce({ rows: [row] });
    expect(
      (
        await store().searchFailuresHybrid(
          scope,
          projectId,
          "mobile_paraphrase",
        )
      )[0].rrf,
    ).toBe(2 / 61);
  });
  it("rejects unknown queries, bad scopes and expired funding before query I/O", async () => {
    await expect(
      store().searchFailuresHybrid(scope, projectId, "arbitrary" as never),
    ).rejects.toThrow();
    await expect(
      store().searchFailuresHybrid("raw-cookie", projectId, "images"),
    ).rejects.toThrow();
    await expect(
      store({
        now: () => Date.parse("2026-10-20T00:00:00Z"),
      }).searchFailuresHybrid(scope, projectId, "images"),
    ).rejects.toThrow();
    expect(sql.query).not.toHaveBeenCalled();
    expect(sql.pool).not.toHaveBeenCalled();
  });
  it("never substitutes lexical results when the catalog or hybrid query fails", async () => {
    const absent = createHostedTigerStore({
      env,
      now: () => NOW,
      catalog: async () => {
        throw new Error("missing fixture catalog");
      },
    });
    await expect(
      absent.searchFailuresHybrid(scope, projectId, "images"),
    ).rejects.toThrow();
    expect(sql.query).not.toHaveBeenCalled();
    sql.query.mockRejectedValueOnce(new Error("private database credential"));
    const failure = await store()
      .searchFailuresHybrid(scope, projectId, "images")
      .catch(String);
    expect(failure).not.toContain("private database credential");
    expect(sql.query).toHaveBeenCalledOnce();
  });
  it("reserves a global tranche once across independent store instances and retains it on retry", async () => {
    const consumed = new Set<string>();
    sql.query.mockImplementation(
      async (statement: string, params: string[]) => {
        if (statement.startsWith("SELECT payload"))
          return { rows: [{ payload: fixture() }] };
        const tranche = params[3];
        if (consumed.has(tranche)) return { rows: [] };
        consumed.add(tranche);
        return { rows: [{ tranche_id: tranche }] };
      },
    );
    const results = await Promise.all([
      store().reserveAgentRun(scope, projectId, auditId, "approved-proof-1"),
      store().reserveAgentRun(scope, projectId, auditId, "approved-proof-1"),
    ]);
    expect(results.filter((result) => result.reserved)).toHaveLength(1);
    // A new process/store after any later model failure gets no allowance refund.
    expect(
      await store().reserveAgentRun(
        scope,
        projectId,
        auditId,
        "approved-proof-1",
      ),
    ).toEqual({ reserved: false });
    const insert = sql.query.mock.calls.find(([statement]) =>
      statement.startsWith("INSERT"),
    )!;
    expect(insert[0]).toContain("ON CONFLICT (tranche_id) DO NOTHING");
    expect(insert[0]).toContain(
      "a.session_hash=$1 AND a.project_id=$2 AND a.audit_id=$3 AND a.expires_at>now()",
    );
    expect(
      sql.query.mock.calls.every(
        ([statement]) => !/\b(UPDATE|DELETE|CREATE|ALTER)\b/i.test(statement),
      ),
    ).toBe(true);
  });
  it("does not reserve for another project, missing audit or invalid tranche", async () => {
    sql.query.mockResolvedValueOnce({ rows: [{ payload: fixture() }] });
    await expect(
      store().reserveAgentRun(scope, auditId, auditId, "approved-proof-1"),
    ).rejects.toThrow();
    await expect(
      store().reserveAgentRun(other, projectId, auditId, "approved-proof-1"),
    ).rejects.toThrow();
    await expect(
      store().reserveAgentRun(scope, projectId, auditId, "x'); DELETE --"),
    ).rejects.toThrow();
    expect(
      sql.query.mock.calls.every(([statement]) =>
        statement.startsWith("SELECT payload"),
      ),
    ).toBe(true);
  });
});
