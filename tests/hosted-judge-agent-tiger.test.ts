import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHostedTigerStore } from "../server/hosted-tiger.js";
import type { JudgeAgentGrant } from "../server/judge-agent-gate.js";
import { EVIDENCE_AGENT_SAMPLE_BRIEF } from "../server/evidence-agent.js";
import { generateLocalChecks } from "../server/generator.js";
import type { Audit } from "../shared/types.js";

const sql = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  pool: vi.fn(),
  releases: [] as ReturnType<typeof vi.fn>[],
}));
vi.mock("pg", () => ({
  default: {
    Pool: class {
      constructor(config: unknown) {
        sql.pool(config);
      }
      query = sql.query;
      connect = sql.connect;
      on = vi.fn();
      end = vi.fn();
    },
  },
}));
const NOW = Date.parse("2026-10-16T08:00:00Z");
const uuid = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const scope = (value: number) =>
  createHash("sha256").update(`synthetic-visitor-${value}`).digest("hex");
const grant: JudgeAgentGrant = {
  grantId: uuid(1),
  proofSha256: "a".repeat(64),
  maxRuns: 12,
  expiresAt: "2026-10-20T00:00:00Z",
};
const expandedGrant: JudgeAgentGrant = {
  ...grant,
  maxRuns: 100,
  expansion: {
    expansionId: uuid(90),
    proofSha256: "b".repeat(64),
    baseProofSha256: grant.proofSha256,
    maxRuns: 100,
  },
};
interface ExpansionSeal {
  grantId: string;
  expansionId: string;
  proofSha256: string;
  baseProofSha256: string;
  maxRuns: number;
  expiresAt: string;
}
const expansionSeal: ExpansionSeal = {
  grantId: grant.grantId,
  expansionId: uuid(90),
  proofSha256: "b".repeat(64),
  baseProofSha256: grant.proofSha256,
  maxRuns: 100,
  expiresAt: grant.expiresAt,
};
const env = {
  BRIEFSTAMP_TIGER_ENABLED: "true",
  BRIEFSTAMP_TIGER_CONFIRMED_FREE_UNTIL: "2026-10-20T00:00:00Z",
  BRIEFSTAMP_TIGER_DATABASE_URL: `postgresql://briefstamp_demo_runtime:${["fixture", "not-real"].join("-")}@service.region.tsdb.cloud.timescale.com:5432/tsdb`,
};
function audit(now: number): Audit {
  const checks = generateLocalChecks(EVIDENCE_AGENT_SAMPLE_BRIEF).map(
    (check, index) => ({
      ...check,
      id: uuid(100 + index),
      approved: check.kind !== "manual",
    }),
  );
  return {
    id: uuid(2),
    projectId: uuid(3),
    projectName: "Synthetic database fixture",
    status: "completed",
    createdAt: new Date(now - 1000).toISOString(),
    completedAt: new Date(now).toISOString(),
    checks,
    source: {
      target: "sample",
      url: "https://sample.flowproof.test/",
      sampleVariant: "broken",
      brief: EVIDENCE_AGENT_SAMPLE_BRIEF,
      generator: { provider: "Deterministic parser", model: null },
    },
    results: checks.map((check) => ({
      checkId: check.id,
      requirement: check.requirement,
      expected: check.expected,
      kind: check.kind,
      status:
        check.kind === "manual"
          ? "unverified"
          : check.kind === "link" || check.kind === "text_visible"
            ? "passed"
            : "failed",
      durationMs: 1,
      evidence: {
        observed: "Synthetic test observation, not a browser receipt",
        url: "https://sample.flowproof.test/",
        viewport: { width: 390, height: 844 },
      },
    })),
  };
}
interface Reservation {
  runId: string;
  grantId: string;
  slot: number;
  sessionHash: string;
  projectId: string;
  auditId: string;
  created: number;
}
/** Deterministic PostgreSQL protocol double, not evidence of a live DB transaction. */
function backend() {
  let clock = NOW,
    tail = Promise.resolve();
  const grants = new Map<string, JudgeAgentGrant>(),
    expansions = new Map<string, ExpansionSeal>(),
    rows: Reservation[] = [],
    results = new Map<string, Record<string, unknown>>(),
    audits = new Map<string, Audit>();
  const statements: string[] = [];
  const fail = { commit: false, insert: false, ownedRead: false };
  let holdCommit: Promise<void> | undefined;
  const fresh = (visitor: number) => {
    const value = audit(clock);
    audits.set(scope(visitor), value);
    return value;
  };
  const query = async (
    statement: string,
    parameters: unknown[],
    tx?: { release?: () => void; inserted: string[]; grantInserted?: string },
  ) => {
    statements.push(statement);
    if (statement === "BEGIN" || statement.startsWith("SET LOCAL"))
      return { rows: [] };
    if (statement.startsWith("SELECT pg_advisory_xact_lock")) {
      const previous = tail;
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      tail = previous.then(() => held);
      await previous;
      tx!.release = release;
      return { rows: [] };
    }
    if (statement === "COMMIT") {
      if (holdCommit) await holdCommit;
      tx?.release?.();
      if (fail.commit) throw new Error("Private commit connection detail");
      return { rows: [] };
    }
    if (statement === "ROLLBACK") {
      for (const id of tx?.inserted ?? []) {
        const index = rows.findIndex((row) => row.runId === id);
        if (index >= 0) rows.splice(index, 1);
      }
      if (tx?.grantInserted) grants.delete(tx.grantInserted);
      tx?.release?.();
      return { rows: [] };
    }
    if (statement.startsWith("SELECT payload FROM")) {
      const value = audits.get(String(parameters[0]));
      return {
        rows:
          !fail.ownedRead &&
          value &&
          value.id === parameters[1] &&
          value.projectId === parameters[2] &&
          Date.parse(value.createdAt) + 30 * 60000 > clock
            ? [{ payload: structuredClone(value) }]
            : [],
      };
    }
    if (
      statement.startsWith("INSERT INTO briefstamp_demo_v1.judge_agent_grants")
    ) {
      const id = String(parameters[0]);
      if (!grants.has(id)) {
        grants.set(id, {
          grantId: id,
          proofSha256: String(parameters[1]),
          maxRuns: 12,
          expiresAt: String(parameters[3]),
        });
        if (tx) tx.grantInserted = id;
      }
      return { rows: [] };
    }
    if (
      statement.startsWith("SELECT ") &&
      statement.includes("FROM briefstamp_demo_v1.judge_agent_expansions")
    ) {
      const value = expansions.get(String(parameters[0]));
      return {
        rows: value ? [{ ...value, expiresAt: new Date(value.expiresAt) }] : [],
      };
    }
    if (statement.startsWith("SELECT grant_id AS")) {
      const value = grants.get(String(parameters[0]));
      return {
        rows: value
          ? [
              {
                grantId: value.grantId,
                proofSha256: value.proofSha256,
                maxRuns: value.maxRuns,
                expiresAt: new Date(value.expiresAt),
              },
            ]
          : [],
      };
    }
    if (statement.startsWith("SELECT run_id AS"))
      return {
        rows: rows
          .filter((row) => row.grantId === parameters[0])
          .sort((a, b) => a.slot - b.slot)
          .map(({ runId, slot, sessionHash, auditId }) => ({
            runId,
            slot,
            sessionHash,
            auditId,
          })),
      };
    if (statement.startsWith("SELECT count(*)"))
      return {
        rows: [
          {
            recentRuns: rows.filter(
              (row) =>
                row.grantId === parameters[0] && row.created > clock - 3600000,
            ).length,
          },
        ],
      };
    if (
      statement.startsWith(
        "INSERT INTO briefstamp_demo_v1.judge_agent_reservations",
      )
    ) {
      if (fail.insert) throw new Error("Private failed SQL detail");
      const [runId, grantId, slot, sessionHash, projectId, auditId] =
        parameters as [string, string, number, string, string, string];
      if (
        rows.some(
          (row) =>
            row.grantId === grantId &&
            (row.slot === slot || row.sessionHash === sessionHash),
        )
      )
        return { rows: [] };
      rows.push({
        runId,
        grantId,
        slot,
        sessionHash,
        projectId,
        auditId,
        created: clock,
      });
      tx?.inserted.push(runId);
      return { rows: [{ run_id: runId }] };
    }
    if (
      statement.startsWith("INSERT INTO briefstamp_demo_v1.judge_agent_results")
    ) {
      const row = rows.find(
        (item) =>
          item.runId === parameters[0] &&
          item.sessionHash === parameters[1] &&
          item.auditId === parameters[2],
      );
      const source = row && audits.get(row.sessionHash);
      if (
        !row ||
        !source ||
        Date.parse(source.createdAt) + 30 * 60000 <= clock ||
        results.has(row.runId)
      )
        return { rows: [] };
      results.set(row.runId, JSON.parse(String(parameters[3])));
      return { rows: [{ run_id: row.runId }] };
    }
    if (statement.startsWith("SELECT j.payload")) {
      const row = rows.find(
        (item) =>
          item.runId === parameters[0] &&
          item.sessionHash === parameters[1] &&
          item.auditId === parameters[2],
      );
      const value = row && results.get(row.runId),
        source = row && audits.get(row.sessionHash);
      if (
        !row ||
        !value ||
        !source ||
        Date.parse(source.createdAt) + 30 * 60000 <= clock ||
        (parameters.length > 3 &&
          (row.grantId !== parameters[3] ||
            grants.get(row.grantId)?.proofSha256 !== parameters[4]))
      )
        return { rows: [] };
      return {
        rows: [
          statement.startsWith("SELECT j.payload,j.status")
            ? { payload: structuredClone(value), status: value.status }
            : { payload: structuredClone(value) },
        ],
      };
    }
    throw new Error("Unexpected test SQL");
  };
  sql.query.mockImplementation((statement: string, values: unknown[]) =>
    query(statement, values),
  );
  sql.connect.mockImplementation(async () => {
    const tx: {
      release?: () => void;
      inserted: string[];
      grantInserted?: string;
    } = { inserted: [] };
    const release = vi.fn();
    sql.releases.push(release);
    return {
      query: vi.fn((statement: string, values: unknown[] = []) =>
        query(statement, values, tx),
      ),
      release,
    };
  });
  const store = () => createHostedTigerStore({ env, now: () => clock });
  return {
    store,
    fresh,
    rows,
    grants,
    expansions,
    results,
    statements,
    fail,
    advance: (ms: number) => {
      clock += ms;
    },
    hold: (value: Promise<void>) => {
      holdCommit = value;
    },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  sql.releases.splice(0);
});
afterEach(() => vi.restoreAllMocks());

describe("append-only durable judge grants", () => {
  it("returns an uninitialized twelve-run snapshot without inserting or claiming a run", async () => {
    const db = backend();
    expect(await db.store().judgeAgentStatus(scope(1), grant)).toEqual({
      maximumRuns: 12,
      usedRuns: 0,
      remainingRuns: 12,
      visitorUsed: false,
    });
    expect(db.statements).toHaveLength(1);
    expect(db.statements[0]).toMatch(/^SELECT grant_id/);
    expect(sql.connect).not.toHaveBeenCalled();
  });
  it("uses one client, grant advisory lock and confirmed commit before releasing a reserved result", async () => {
    const db = backend();
    const source = db.fresh(1);
    let release!: () => void;
    db.hold(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    let settled = false;
    const pending = db
      .store()
      .reserveJudgeAgentRun(scope(1), source.projectId, source.id, grant)
      .then((result) => {
        settled = true;
        return result;
      });
    await vi.waitFor(() => expect(db.statements).toContain("COMMIT"));
    expect(settled).toBe(false);
    release();
    expect(await pending).toMatchObject({
      reserved: true,
      slot: 1,
      budget: { usedRuns: 1, remainingRuns: 11, visitorUsed: true },
    });
    expect(sql.connect).toHaveBeenCalledOnce();
    expect(sql.query).not.toHaveBeenCalled();
    expect(
      db.statements.some((text) => text.includes("pg_advisory_xact_lock")),
    ).toBe(true);
    expect(sql.releases[0]).toHaveBeenCalledWith(false);
    expect(
      db.statements.every(
        (text) => !/\b(?:UPDATE|DELETE|CREATE|ALTER)\b/i.test(text),
      ),
    ).toBe(true);
  });
  it("concurrent visitors cannot exceed six runs/hour or duplicate a visitor across store instances", async () => {
    const db = backend();
    const sources = Array.from({ length: 8 }, (_, index) =>
      db.fresh(index + 1),
    );
    const outcomes = await Promise.all(
      sources.map((value, index) =>
        db
          .store()
          .reserveJudgeAgentRun(
            scope(index + 1),
            value.projectId,
            value.id,
            grant,
          ),
      ),
    );
    expect(outcomes.filter((result) => result.reserved)).toHaveLength(6);
    expect(
      outcomes.filter((result) => result.reason === "rate_limited"),
    ).toHaveLength(2);
    expect(db.rows).toHaveLength(6);
    expect(new Set(db.rows.map((row) => row.slot)).size).toBe(6);
    const replay = await db
      .store()
      .reserveJudgeAgentRun(
        scope(1),
        sources[0].projectId,
        sources[0].id,
        grant,
      );
    expect(replay).toMatchObject({
      reserved: false,
      reason: "visitor_used",
      budget: { usedRuns: 6 },
    });
  });
  it("retains the twelve-slot cap after an hour and a server/store restart", async () => {
    const db = backend();
    for (let visitor = 1; visitor <= 6; visitor++) {
      const a = db.fresh(visitor);
      expect(
        (
          await db
            .store()
            .reserveJudgeAgentRun(scope(visitor), a.projectId, a.id, grant)
        ).reserved,
      ).toBe(true);
    }
    db.advance(3600001);
    for (let visitor = 7; visitor <= 12; visitor++) {
      const a = db.fresh(visitor);
      expect(
        (
          await db
            .store()
            .reserveJudgeAgentRun(scope(visitor), a.projectId, a.id, grant)
        ).reserved,
      ).toBe(true);
    }
    const extra = db.fresh(13);
    expect(
      await db
        .store()
        .reserveJudgeAgentRun(scope(13), extra.projectId, extra.id, grant),
    ).toMatchObject({
      reserved: false,
      reason: "exhausted",
      budget: { usedRuns: 12, remainingRuns: 0 },
    });
    expect(db.rows).toHaveLength(12);
  });
  it("serializes simultaneous requests from the same visitor to one reservation", async () => {
    const db = backend();
    const a = db.fresh(1);
    const results = await Promise.all([
      db.store().reserveJudgeAgentRun(scope(1), a.projectId, a.id, grant),
      db.store().reserveJudgeAgentRun(scope(1), a.projectId, a.id, grant),
    ]);
    expect(results.filter((result) => result.reserved)).toHaveLength(1);
    expect(results.find((result) => !result.reserved)?.reason).toBe(
      "visitor_used",
    );
  });
  it("refuses changed proof or expiry under a sealed UUID without granting new slots", async () => {
    const db = backend();
    const a = db.fresh(1);
    await db.store().reserveJudgeAgentRun(scope(1), a.projectId, a.id, grant);
    for (const changed of [
      { ...grant, proofSha256: "b".repeat(64) },
      { ...grant, expiresAt: "2026-10-19T23:00:00Z" },
    ]) {
      await expect(
        db.store().judgeAgentStatus(scope(1), changed),
      ).rejects.toThrow();
      const other = db.fresh(2);
      await expect(
        db
          .store()
          .reserveJudgeAgentRun(scope(2), other.projectId, other.id, changed),
      ).rejects.toThrow();
    }
    expect(db.rows).toHaveLength(1);
    expect(db.grants.get(grant.grantId)).toEqual(grant);
  });
  it("treats ambiguous commit as consumed, destroys that connection and never rolls it back or refunds", async () => {
    const db = backend();
    const a = db.fresh(1);
    db.fail.commit = true;
    await expect(
      db.store().reserveJudgeAgentRun(scope(1), a.projectId, a.id, grant),
    ).rejects.toThrow("ambiguous commit");
    expect(db.rows).toHaveLength(1);
    expect(db.statements).not.toContain("ROLLBACK");
    expect(sql.releases[0]).toHaveBeenCalledWith(true);
    db.fail.commit = false;
    expect(
      await db.store().reserveJudgeAgentRun(scope(1), a.projectId, a.id, grant),
    ).toMatchObject({ reserved: false, reason: "visitor_used" });
  });
  it("rolls back pre-commit failures and never leaks SQL details", async () => {
    const db = backend();
    const a = db.fresh(1);
    db.fail.insert = true;
    const error = await db
      .store()
      .reserveJudgeAgentRun(scope(1), a.projectId, a.id, grant)
      .catch(String);
    expect(error).not.toContain("Private failed SQL");
    expect(db.statements).toContain("ROLLBACK");
    expect(db.rows).toHaveLength(0);
    expect(db.grants.size).toBe(0);
  });
  it("does not seal a missing, wrong-project, stale or non-synthetic source", async () => {
    const db = backend();
    const a = db.fresh(1);
    await expect(
      db.store().reserveJudgeAgentRun(scope(2), a.projectId, a.id, grant),
    ).rejects.toThrow();
    await expect(
      db.store().reserveJudgeAgentRun(scope(1), uuid(90), a.id, grant),
    ).rejects.toThrow();
    a.source!.target = "website";
    await expect(
      db.store().reserveJudgeAgentRun(scope(1), a.projectId, a.id, grant),
    ).rejects.toThrow();
    expect(db.rows).toHaveLength(0);
    expect(db.grants.size).toBe(0);
  });
  it("fails closed on malformed scope, widened grant or hard expiry before any DB call", async () => {
    const db = backend();
    await expect(
      db.store().judgeAgentStatus("raw-cookie", grant),
    ).rejects.toThrow();
    await expect(
      db.store().judgeAgentStatus(scope(1), { ...grant, maxRuns: 13 } as never),
    ).rejects.toThrow();
    db.advance(4 * 86400000);
    await expect(
      db.store().judgeAgentStatus(scope(1), grant),
    ).rejects.toThrow();
    expect(sql.query).not.toHaveBeenCalled();
    expect(sql.connect).not.toHaveBeenCalled();
  });
  it("appends one owned raw result and keeps others' data and expired audits hidden", async () => {
    const db = backend();
    const a = db.fresh(1),
      s = db.store();
    const run = await s.reserveJudgeAgentRun(
      scope(1),
      a.projectId,
      a.id,
      grant,
    );
    const value = {
      status: "completed",
      modelOutput: { findings: [], abstention: "no_relevant_observations" },
      sourceAuditUnchanged: true,
    };
    expect(
      await s.appendJudgeAgentResult(scope(1), run.runId!, a.id, value),
    ).toEqual({ inserted: true });
    expect(await db.store().judgeAgentStatus(scope(1), grant)).toMatchObject({
      ownRunId: run.runId,
      ownResult: value,
    });
    expect(
      await db.store().judgeAgentStatus(scope(2), grant),
    ).not.toHaveProperty("ownResult");
    await expect(
      s.appendJudgeAgentResult(scope(2), run.runId!, a.id, value),
    ).rejects.toThrow();
    expect(
      await s.appendJudgeAgentResult(scope(1), run.runId!, a.id, value),
    ).toEqual({ inserted: false });
    await expect(
      s.appendJudgeAgentResult(scope(1), run.runId!, a.id, {
        ...value,
        status: "failed",
      }),
    ).rejects.toThrow();
    db.advance(30 * 60000);
    expect(
      await db.store().judgeAgentStatus(scope(1), grant),
    ).not.toHaveProperty("ownResult");
    expect(db.results.get(run.runId!)).toEqual(value);
    const resultSQL = db.statements.filter((statement) =>
      statement.startsWith("SELECT j.payload"),
    );
    expect(
      resultSQL.every(
        (statement) =>
          statement.includes("a.expires_at>now()") &&
          statement.includes("j.session_hash=$2") &&
          statement.includes("j.audit_id=$3"),
      ),
    ).toBe(true);
  });
  it("round-trips optional undefined fields using persisted JSON semantics without permitting changed facts", async () => {
    const db = backend();
    const a = db.fresh(1),
      s = db.store();
    const run = await s.reserveJudgeAgentRun(
      scope(1),
      a.projectId,
      a.id,
      grant,
    );
    const value = {
      status: "completed",
      error: undefined,
      modelOutput: {
        findings: [{ observationId: "history-1", optionalDetail: undefined }],
        abstention: undefined,
      },
      sourceAuditUnchanged: true,
    };
    const persisted = JSON.parse(JSON.stringify(value));
    expect(
      await s.appendJudgeAgentResult(scope(1), run.runId!, a.id, value),
    ).toEqual({ inserted: true });
    expect(db.results.get(run.runId!)).toEqual(persisted);
    expect(await s.judgeAgentStatus(scope(1), grant)).toMatchObject({
      ownResult: persisted,
    });
    expect(
      await s.appendJudgeAgentResult(scope(1), run.runId!, a.id, persisted),
    ).toEqual({ inserted: false });
    await expect(
      s.appendJudgeAgentResult(scope(1), run.runId!, a.id, {
        ...value,
        modelOutput: { findings: [{ observationId: "forged-observation" }] },
      }),
    ).rejects.toThrow("immutable judge result");
    expect(db.results.get(run.runId!)).toEqual(persisted);
  });
});

describe("append-only expansion of the same judge grant", () => {
  async function existingFour() {
    const db = backend();
    for (let visitor = 1; visitor <= 4; visitor++) {
      const a = db.fresh(visitor);
      await db
        .store()
        .reserveJudgeAgentRun(scope(visitor), a.projectId, a.id, grant);
    }
    return db;
  }

  it("preserves four spent slots and their results, then reserves slot five with 95 remaining", async () => {
    const db = await existingFour();
    const oldRows = structuredClone(db.rows);
    const oldBase = structuredClone(db.grants.get(grant.grantId));
    const prior = db.rows[0];
    const oldResult = {
      status: "completed_with_unavailable_tools",
      sourceAuditUnchanged: true,
      factualSummary: ["Offline fixture; a spent partial run remains spent."],
    };
    await db
      .store()
      .appendJudgeAgentResult(scope(1), prior.runId, prior.auditId, oldResult);
    db.expansions.set(grant.grantId, structuredClone(expansionSeal));
    expect(await db.store().judgeAgentStatus(scope(5), expandedGrant)).toEqual({
      maximumRuns: 100,
      usedRuns: 4,
      remainingRuns: 96,
      visitorUsed: false,
    });
    expect(
      await db.store().judgeAgentStatus(scope(1), expandedGrant),
    ).toMatchObject({
      maximumRuns: 100,
      usedRuns: 4,
      remainingRuns: 96,
      visitorUsed: true,
      ownRunId: prior.runId,
      ownResult: oldResult,
    });
    const next = db.fresh(5);
    expect(
      await db
        .store()
        .reserveJudgeAgentRun(scope(5), next.projectId, next.id, expandedGrant),
    ).toMatchObject({
      reserved: true,
      slot: 5,
      budget: { maximumRuns: 100, usedRuns: 5, remainingRuns: 95 },
    });
    expect(db.rows.slice(0, 4)).toEqual(oldRows);
    expect(db.grants.get(grant.grantId)).toEqual(oldBase);
    expect(db.expansions.get(grant.grantId)).toEqual(expansionSeal);
    expect(db.results.get(prior.runId)).toEqual(oldResult);
    expect(
      db.statements.every(
        (statement) => !/\b(?:UPDATE|DELETE|CREATE|ALTER)\b/i.test(statement),
      ),
    ).toBe(true);
    expect(
      db.statements.some((statement) =>
        /INSERT INTO .*judge_agent_expansions/.test(statement),
      ),
    ).toBe(false);
    expect(await db.store().judgeAgentStatus(scope(6), grant)).toEqual({
      maximumRuns: 12,
      usedRuns: 5,
      remainingRuns: 7,
      visitorUsed: false,
    });
  });

  it("counts existing slots toward both the unchanged six-per-hour cap and the exact 100-run total", async () => {
    const db = await existingFour();
    const original = structuredClone(db.rows);
    db.expansions.set(grant.grantId, structuredClone(expansionSeal));
    for (let visitor = 5; visitor <= 100; visitor++) {
      let source = db.fresh(visitor);
      if ((visitor - 1) % 6 === 0) {
        expect(
          await db
            .store()
            .reserveJudgeAgentRun(
              scope(visitor),
              source.projectId,
              source.id,
              expandedGrant,
            ),
        ).toMatchObject({
          reserved: false,
          reason: "rate_limited",
          budget: { usedRuns: visitor - 1 },
        });
        expect(db.rows).toHaveLength(visitor - 1);
        db.advance(3_600_001);
        source = db.fresh(visitor);
      }
      expect(
        await db
          .store()
          .reserveJudgeAgentRun(
            scope(visitor),
            source.projectId,
            source.id,
            expandedGrant,
          ),
      ).toMatchObject({
        reserved: true,
        slot: visitor,
        budget: {
          maximumRuns: 100,
          usedRuns: visitor,
          remainingRuns: 100 - visitor,
        },
      });
    }
    const extra = db.fresh(101);
    expect(
      await db
        .store()
        .reserveJudgeAgentRun(
          scope(101),
          extra.projectId,
          extra.id,
          expandedGrant,
        ),
    ).toMatchObject({
      reserved: false,
      reason: "exhausted",
      budget: { maximumRuns: 100, usedRuns: 100, remainingRuns: 0 },
    });
    expect(db.rows).toHaveLength(100);
    expect(db.rows.slice(0, 4)).toEqual(original);
    expect(db.rows.map((row) => row.slot)).toEqual(
      Array.from({ length: 100 }, (_, index) => index + 1),
    );
    expect(new Set(db.rows.map((row) => row.grantId))).toEqual(
      new Set([grant.grantId]),
    );
    expect(db.grants.get(grant.grantId)).toEqual(grant);
    expect(db.expansions.get(grant.grantId)).toEqual(expansionSeal);
  });

  it("cannot initialize an expanded grant when its original twelve-run seal is missing", async () => {
    const db = backend();
    db.expansions.set(grant.grantId, structuredClone(expansionSeal));
    const source = db.fresh(1);
    await expect(
      db.store().judgeAgentStatus(scope(1), expandedGrant),
    ).rejects.toThrow();
    await expect(
      db
        .store()
        .reserveJudgeAgentRun(
          scope(1),
          source.projectId,
          source.id,
          expandedGrant,
        ),
    ).rejects.toThrow();
    expect(db.grants.size).toBe(0);
    expect(db.rows).toHaveLength(0);
    expect(
      db.statements.some((statement) =>
        statement.startsWith(
          "INSERT INTO briefstamp_demo_v1.judge_agent_grants",
        ),
      ),
    ).toBe(false);
  });

  it.each([
    ["missing", undefined],
    ["grant identity", { ...expansionSeal, grantId: uuid(91) }],
    ["expansion identity", { ...expansionSeal, expansionId: uuid(92) }],
    ["expansion proof", { ...expansionSeal, proofSha256: "c".repeat(64) }],
    ["base proof", { ...expansionSeal, baseProofSha256: "d".repeat(64) }],
    ["run cap", { ...expansionSeal, maxRuns: 101 }],
    ["expiry", { ...expansionSeal, expiresAt: "2026-10-19T23:00:00Z" }],
  ] as const)(
    "refuses a %s expansion seal without creating or freeing a slot",
    async (_reason, seal) => {
      const db = await existingFour();
      const original = structuredClone(db.rows);
      if (seal) db.expansions.set(grant.grantId, structuredClone(seal));
      const next = db.fresh(5);
      await expect(
        db.store().judgeAgentStatus(scope(5), expandedGrant),
      ).rejects.toThrow();
      await expect(
        db
          .store()
          .reserveJudgeAgentRun(
            scope(5),
            next.projectId,
            next.id,
            expandedGrant,
          ),
      ).rejects.toThrow();
      expect(db.rows).toEqual(original);
      expect(db.grants.get(grant.grantId)).toEqual(grant);
      expect(db.expansions.get(grant.grantId)).toEqual(seal);
      expect(
        db.statements.filter((statement) =>
          statement.includes("FROM briefstamp_demo_v1.judge_agent_expansions"),
        ),
      ).toHaveLength(2);
      expect(
        db.statements.some((statement) =>
          /INSERT INTO .*judge_agent_expansions/.test(statement),
        ),
      ).toBe(false);
    },
  );

  it("rolls back a pre-commit reservation failure without touching either seal or prior spent slots", async () => {
    const db = await existingFour();
    db.expansions.set(grant.grantId, structuredClone(expansionSeal));
    const original = structuredClone(db.rows);
    const source = db.fresh(5);
    db.fail.insert = true;
    const failure = await db
      .store()
      .reserveJudgeAgentRun(
        scope(5),
        source.projectId,
        source.id,
        expandedGrant,
      )
      .catch(String);
    expect(failure).not.toContain("Private failed SQL");
    expect(db.statements).toContain("ROLLBACK");
    expect(db.rows).toEqual(original);
    expect(db.grants.get(grant.grantId)).toEqual(grant);
    expect(db.expansions.get(grant.grantId)).toEqual(expansionSeal);
    db.fail.insert = false;
    expect(
      await db.store().judgeAgentStatus(scope(5), expandedGrant),
    ).toMatchObject({ usedRuns: 4, remainingRuns: 96, visitorUsed: false });
  });

  it("keeps an ambiguously committed expanded slot consumed across a new store instance", async () => {
    const db = await existingFour();
    db.expansions.set(grant.grantId, structuredClone(expansionSeal));
    const source = db.fresh(5);
    db.fail.commit = true;
    const before = db.statements.length;
    await expect(
      db
        .store()
        .reserveJudgeAgentRun(
          scope(5),
          source.projectId,
          source.id,
          expandedGrant,
        ),
    ).rejects.toThrow("ambiguous commit");
    expect(db.statements.slice(before)).not.toContain("ROLLBACK");
    expect(sql.releases.at(-1)).toHaveBeenCalledWith(true);
    expect(db.rows).toHaveLength(5);
    expect(db.rows.at(-1)?.slot).toBe(5);
    db.fail.commit = false;
    expect(
      await db.store().judgeAgentStatus(scope(5), expandedGrant),
    ).toMatchObject({
      maximumRuns: 100,
      usedRuns: 5,
      remainingRuns: 95,
      visitorUsed: true,
    });
    expect(
      await db
        .store()
        .reserveJudgeAgentRun(
          scope(5),
          source.projectId,
          source.id,
          expandedGrant,
        ),
    ).toMatchObject({ reserved: false, reason: "visitor_used" });
    expect(db.rows).toHaveLength(5);
    expect(db.grants.get(grant.grantId)).toEqual(grant);
    expect(db.expansions.get(grant.grantId)).toEqual(expansionSeal);
  });
});
