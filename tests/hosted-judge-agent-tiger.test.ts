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
