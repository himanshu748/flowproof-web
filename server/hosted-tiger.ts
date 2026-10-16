import pg from "pg";
import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  GemmaAttemptSchema,
  GemmaUsageSchema,
} from "./providers/gemma-google.js";
import type { Audit } from "../shared/types.js";
import { redact } from "../shared/redact.js";
import { databaseConfig } from "./database.js";
import { CheckSchema, isSafePath } from "./schema.js";
import {
  HOSTED_WEBSITE_URL,
  HOSTED_WEBSITE_BRIEF,
} from "../shared/hosted-target.js";
import {
  AGENT_RETRIEVAL_MODEL,
  AgentRetrievalQuerySchema,
  loadAgentRetrievalCatalog,
  retrievalTextSha256,
  type AgentRetrievalCatalog,
  type AgentRetrievalQueryId,
} from "./agent-retrieval-catalog.js";
import {
  JudgeAgentGrantSchema,
  type JudgeAgentGrant,
} from "./judge-agent-gate.js";

export interface JudgeAgentBudget {
  maximumRuns: 12;
  usedRuns: number;
  remainingRuns: number;
  visitorUsed: boolean;
  ownRunId?: string;
  ownResult?: Record<string, unknown>;
}
export interface JudgeAgentReservation {
  reserved: boolean;
  runId?: string;
  slot?: number;
  reason?: "exhausted" | "visitor_used" | "rate_limited";
  budget: JudgeAgentBudget;
}

const CUTOFF = Date.parse("2026-10-20T00:00:00Z");
const TTL_MS = 30 * 60_000;
const sessionSchema = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.string().uuid();
const ownSample = (value: string) => {
  try {
    const url = new URL(value);
    return (
      url.origin === "https://sample.flowproof.test" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      isSafePath(url.pathname)
    );
  } catch {
    return false;
  }
};
const ownEvidence = (value: string) =>
  ownSample(value) || value === HOSTED_WEBSITE_URL;
const kind = CheckSchema.innerType().shape.kind;
const generatorSchema = z
  .object({
    provider: z.string().max(120),
    model: z.string().max(120).nullable(),
    reason: z.string().max(3000).optional(),
    usage: GemmaUsageSchema.nullable().optional(),
    attempts: z.array(GemmaAttemptSchema).min(1).max(3).optional(),
    orchestration: z
      .object({
        provider: z.literal("Mastra"),
        workflowId: z.string().max(100),
        runId: uuid,
        steps: z.array(z.string().max(100)).max(4),
        maxRssMiB: z.number().finite().positive(),
        telemetry: z
          .object({
            provider: z.literal("Sentry"),
            mode: z.enum(["hosted_configured", "local_capture"]),
            traceId: z.string().regex(/^[a-f0-9]{32}$/),
            flushed: z.boolean(),
            ingestionVerified: z.literal(false),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const auditSchema = z
  .object({
    id: uuid,
    projectId: uuid,
    projectName: z.string().max(200),
    status: z.literal("completed"),
    createdAt: z.string().datetime({ offset: true }),
    completedAt: z.string().datetime({ offset: true }),
    checks: z.array(CheckSchema).min(1).max(24),
    summary: z.string().max(6000).optional(),
    source: z
      .object({
        target: z.enum(["sample", "website"]),
        url: z.string().refine(ownEvidence),
        sampleVariant: z.enum(["healthy", "broken"]),
        brief: z.string().max(12000),
        generator: generatorSchema,
      })
      .strict(),
    results: z
      .array(
        z
          .object({
            checkId: z.string().max(80),
            requirement: z.string().max(3000),
            expected: z.string().max(1000),
            kind,
            status: z.enum(["passed", "failed", "blocked", "unverified"]),
            durationMs: z.number().finite().nonnegative(),
            evidence: z
              .object({
                observed: z.string().max(6000),
                dom: z.string().max(6000).optional(),
                url: z.string().refine(ownEvidence),
                screenshot: z.string().max(180).optional(),
                viewport: z
                  .object({
                    width: z.number().int().positive().max(4096),
                    height: z.number().int().positive().max(4096),
                  })
                  .strict(),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1)
      .max(24),
  })
  .strict();

function connection(env: NodeJS.ProcessEnv, now: number) {
  const confirmation = z
    .string()
    .datetime({ offset: true })
    .safeParse(env.BRIEFSTAMP_TIGER_CONFIRMED_FREE_UNTIL);
  const until = confirmation.success ? Date.parse(confirmation.data) : NaN;
  if (
    env.BRIEFSTAMP_TIGER_ENABLED !== "true" ||
    !Number.isFinite(now) ||
    !Number.isFinite(until) ||
    until <= now ||
    until > CUTOFF ||
    until - now > 7 * 86_400_000
  )
    throw new Error(
      "Hosted Tiger is disabled or its confirmed trial window is invalid.",
    );
  const url = new URL(env.BRIEFSTAMP_TIGER_DATABASE_URL ?? "");
  if (
    !/^postgres(?:ql)?:$/.test(url.protocol) ||
    !/^[a-z0-9-]+\.[a-z0-9-]+\.tsdb\.cloud\.timescale\.com$/.test(
      url.hostname,
    ) ||
    decodeURIComponent(url.username) !== "briefstamp_demo_runtime" ||
    !url.password ||
    url.pathname.length < 2 ||
    url.search ||
    url.hash
  )
    throw new Error(
      "Hosted Tiger requires its dedicated role and an unmodified Tiger TLS URL.",
    );
  if (
    env.DATABASE_SSL === "false" ||
    env.NODE_TLS_REJECT_UNAUTHORIZED === "0" ||
    env.PGSSLMODE ||
    env.PGSSLROOTCERT ||
    env.NODE_EXTRA_CA_CERTS
  )
    throw new Error("Hosted Tiger does not accept ambient TLS overrides.");
  return {
    ...databaseConfig(url.toString(), { DATABASE_SSL: "true" }),
    max: 2,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 10_000,
    statement_timeout: 5000,
    query_timeout: 5500,
    application_name: "briefstamp-public-audit",
  };
}

export function hostedTigerEnabled(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  try {
    connection(env, now);
    return true;
  } catch {
    return false;
  }
}

function normalizedAudit(value: unknown, now: number): Audit {
  if (Buffer.byteLength(JSON.stringify(value)) > 2 * 1024 * 1024)
    throw new Error("The public audit exceeds its storage limit.");
  const audit = auditSchema.parse(value);
  const website = audit.source.target === "website";
  if (
    website
      ? audit.source.url !== HOSTED_WEBSITE_URL ||
        audit.source.brief !== HOSTED_WEBSITE_BRIEF ||
        audit.checks.some((check) => check.path !== "/") ||
        audit.results.some(
          (result) => result.evidence.url !== HOSTED_WEBSITE_URL,
        )
      : !ownSample(audit.source.url) ||
        audit.results.some((result) => !ownSample(result.evidence.url))
  )
    throw new Error("The public audit must match its fixed authorized target.");
  if (
    Date.parse(audit.createdAt) <= now - TTL_MS ||
    Date.parse(audit.createdAt) > now ||
    Date.parse(audit.completedAt) < Date.parse(audit.createdAt) ||
    Date.parse(audit.completedAt) > now
  )
    throw new Error(
      "Only a current completed public audit can be stored or retrieved.",
    );
  const text = (value: string) => redact(value);
  audit.projectName = text(audit.projectName);
  if (audit.summary) audit.summary = text(audit.summary);
  audit.source.brief = text(audit.source.brief);
  audit.source.generator.provider = text(audit.source.generator.provider);
  if (audit.source.generator.model)
    audit.source.generator.model = text(audit.source.generator.model);
  if (audit.source.generator.reason)
    audit.source.generator.reason = text(audit.source.generator.reason);
  audit.checks = audit.checks.map((check) => ({
    ...check,
    requirement: text(check.requirement),
    expected: text(check.expected),
  }));
  if (
    new Set(audit.checks.map((check) => check.id)).size !==
      audit.checks.length ||
    audit.results.length !== audit.checks.length ||
    new Set(audit.results.map((result) => result.checkId)).size !==
      audit.results.length
  )
    throw new Error(
      "The public audit must contain one result per unique check.",
    );
  for (const result of audit.results) {
    result.requirement = text(result.requirement);
    result.expected = text(result.expected);
    result.evidence.observed = text(result.evidence.observed);
    if (result.evidence.dom) result.evidence.dom = text(result.evidence.dom);
    const check = audit.checks.find((check) => check.id === result.checkId);
    if (
      !check ||
      result.kind !== check.kind ||
      result.expected !== check.expected ||
      result.requirement !== check.requirement ||
      (check.kind === "manual"
        ? result.status !== "unverified"
        : !check.approved)
    )
      throw new Error(
        "The public audit result does not match its approved check.",
      );
    if (
      result.evidence.screenshot &&
      !new RegExp(`^/evidence/${audit.id}/[A-Za-z0-9_-]+\\.png$`).test(
        result.evidence.screenshot,
      )
    )
      throw new Error(
        "Only a reference to this public audit's screenshot is permitted.",
      );
  }
  return audit;
}

/** Construction is offline. Every operation rechecks expiry; runtime never creates schema. */
export function createHostedTigerStore(
  options: {
    env?: NodeJS.ProcessEnv;
    now?: () => number;
    /** Trusted offline fixture injection, never accepted from an HTTP request. */
    catalog?: () => Promise<AgentRetrievalCatalog>;
  } = {},
) {
  const env = options.env ?? process.env,
    now = options.now ?? Date.now;
  let pool: pg.Pool | undefined;
  const database = () => {
    const config = connection(env, now());
    if (!pool) {
      pool = new pg.Pool(config);
      pool.on("error", () => {});
    }
    return pool;
  };
  const query = async (sql: string, values: unknown[]) => {
    try {
      return await database().query(sql, values);
    } catch {
      throw new Error(
        "Hosted Tiger is unavailable; no database detail or credential is exposed.",
      );
    }
  };
  const readAudit = async (sessionHash: string, auditId: string) => {
    sessionSchema.parse(sessionHash);
    uuid.parse(auditId);
    const result = await query(
      "SELECT payload FROM briefstamp_demo_v1.audits WHERE session_hash=$1 AND audit_id=$2 AND expires_at>now() LIMIT 1",
      [sessionHash, auditId],
    );
    if (!result.rows.length) return null;
    const audit = normalizedAudit(result.rows[0].payload, now());
    if (audit.id !== auditId)
      throw new Error("The stored public audit identity is invalid.");
    return audit;
  };
  const fixedCatalog = options.catalog ?? loadAgentRetrievalCatalog;
  type Executor = (
    statement: string,
    values: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[] }>;
  const validateJudgeGrant = (grant: JudgeAgentGrant) => {
    JudgeAgentGrantSchema.parse(grant);
    if (Date.parse(grant.expiresAt) <= now())
      throw new Error("The judge grant has expired.");
  };
  const sealSchema = z
    .object({
      grantId: uuid,
      proofSha256: z.string().regex(/^[a-f0-9]{64}$/),
      maxRuns: z.literal(12),
      expiresAt: z.union([z.date(), z.string().datetime({ offset: true })]),
    })
    .strict();
  const checkJudgeSeal = async (execute: Executor, grant: JudgeAgentGrant) => {
    const result = await execute(
      'SELECT grant_id AS "grantId",proof_sha256 AS "proofSha256",max_runs AS "maxRuns",expires_at AS "expiresAt" FROM briefstamp_demo_v1.judge_agent_grants WHERE grant_id=$1 LIMIT 1',
      [grant.grantId],
    );
    if (!result.rows.length) return false;
    const seal = sealSchema.parse(result.rows[0]);
    if (
      seal.grantId !== grant.grantId ||
      seal.proofSha256 !== grant.proofSha256 ||
      seal.maxRuns !== grant.maxRuns ||
      new Date(seal.expiresAt).toISOString() !==
        new Date(grant.expiresAt).toISOString()
    )
      throw new Error(
        "The immutable judge grant does not match its stored seal.",
      );
    return true;
  };
  const readJudgeBudget = async (
    execute: Executor,
    sessionHash: string,
    grant: JudgeAgentGrant,
  ): Promise<JudgeAgentBudget> => {
    const result = await execute(
      'SELECT run_id AS "runId",slot,session_hash AS "sessionHash",audit_id AS "auditId" FROM briefstamp_demo_v1.judge_agent_reservations WHERE grant_id=$1 ORDER BY slot LIMIT 13',
      [grant.grantId],
    );
    const rows = z
      .array(
        z
          .object({
            runId: uuid,
            slot: z.number().int().min(1).max(12),
            sessionHash: sessionSchema,
            auditId: uuid,
          })
          .strict(),
      )
      .max(12)
      .parse(result.rows);
    if (
      new Set(rows.map((row) => row.slot)).size !== rows.length ||
      new Set(rows.map((row) => row.sessionHash)).size !== rows.length
    )
      throw new Error("The judge reservation counters are invalid.");
    const own = rows.find((row) => row.sessionHash === sessionHash);
    const budget: JudgeAgentBudget = {
      maximumRuns: 12,
      usedRuns: rows.length,
      remainingRuns: 12 - rows.length,
      visitorUsed: Boolean(own),
      ...(own ? { ownRunId: own.runId } : {}),
    };
    if (own) {
      const saved = await execute(
        `SELECT j.payload,j.status FROM briefstamp_demo_v1.judge_agent_results j
        JOIN briefstamp_demo_v1.judge_agent_reservations r ON r.run_id=j.run_id AND r.session_hash=j.session_hash AND r.audit_id=j.audit_id
        JOIN briefstamp_demo_v1.judge_agent_grants g ON g.grant_id=r.grant_id
        JOIN briefstamp_demo_v1.audits a ON a.session_hash=r.session_hash AND a.audit_id=r.audit_id AND a.project_id=r.project_id
        WHERE j.run_id=$1 AND j.session_hash=$2 AND j.audit_id=$3 AND r.grant_id=$4 AND g.proof_sha256=$5 AND g.expires_at>now() AND a.expires_at>now() LIMIT 1`,
        [own.runId, sessionHash, own.auditId, grant.grantId, grant.proofSha256],
      );
      if (saved.rows.length) {
        const value = z
          .object({
            payload: z.record(z.unknown()),
            status: z.enum([
              "completed",
              "completed_with_unavailable_tools",
              "failed",
            ]),
          })
          .strict()
          .parse(saved.rows[0]);
        if (
          Buffer.byteLength(JSON.stringify(value.payload)) > 262144 ||
          value.payload.status !== value.status
        )
          throw new Error("The stored judge result is invalid.");
        budget.ownResult = structuredClone(value.payload);
      }
    }
    return budget;
  };
  return {
    /** No insertion or entitlement refresh. Status is a snapshot, not a reservation. */
    async judgeAgentStatus(
      sessionHash: string,
      grant: JudgeAgentGrant,
    ): Promise<JudgeAgentBudget> {
      sessionSchema.parse(sessionHash);
      validateJudgeGrant(grant);
      if (!(await checkJudgeSeal(query, grant)))
        return {
          maximumRuns: 12,
          usedRuns: 0,
          remainingRuns: 12,
          visitorUsed: false,
        };
      return readJudgeBudget(query, sessionHash, grant);
    },
    /** One checked-out connection, grant lock and confirmed COMMIT precede provider I/O. */
    async reserveJudgeAgentRun(
      sessionHash: string,
      projectId: string,
      auditId: string,
      grant: JudgeAgentGrant,
    ): Promise<JudgeAgentReservation> {
      sessionSchema.parse(sessionHash);
      uuid.parse(projectId);
      uuid.parse(auditId);
      validateJudgeGrant(grant);
      let client: pg.PoolClient | undefined;
      let commitAttempted = false,
        committed = false;
      try {
        client = await database().connect();
        const execute: Executor = (statement, values) => {
          connection(env, now());
          return client!.query(statement, values);
        };
        await execute("BEGIN", []);
        await execute("SET LOCAL statement_timeout = '5s'", []);
        await execute("SET LOCAL lock_timeout = '2s'", []);
        await execute("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `briefstamp-judge:${grant.grantId}`,
        ]);
        validateJudgeGrant(grant);
        const stored = await execute(
          "SELECT payload FROM briefstamp_demo_v1.audits WHERE session_hash=$1 AND audit_id=$2 AND project_id=$3 AND expires_at>now() LIMIT 1",
          [sessionHash, auditId, projectId],
        );
        if (!stored.rows.length)
          throw new Error("The session-owned completed audit is unavailable.");
        const audit = normalizedAudit(stored.rows[0].payload, now());
        if (
          audit.id !== auditId ||
          audit.projectId !== projectId ||
          audit.source?.target !== "sample" ||
          audit.source.sampleVariant !== "broken"
        )
          throw new Error("The owned synthetic audit does not match.");
        await execute(
          `INSERT INTO briefstamp_demo_v1.judge_agent_grants (grant_id,proof_sha256,max_runs,expires_at)
          SELECT $1,$2,$3,$4::timestamptz WHERE $4::timestamptz>now()
          ON CONFLICT (grant_id) DO NOTHING RETURNING grant_id`,
          [grant.grantId, grant.proofSha256, grant.maxRuns, grant.expiresAt],
        );
        if (!(await checkJudgeSeal(execute, grant)))
          throw new Error("The judge grant could not be sealed.");
        let budget = await readJudgeBudget(execute, sessionHash, grant);
        let reservation: JudgeAgentReservation;
        if (budget.visitorUsed)
          reservation = { reserved: false, reason: "visitor_used", budget };
        else if (budget.remainingRuns === 0)
          reservation = { reserved: false, reason: "exhausted", budget };
        else {
          const hourly = await execute(
            "SELECT count(*)::integer AS \"recentRuns\" FROM briefstamp_demo_v1.judge_agent_reservations WHERE grant_id=$1 AND created_at>now()-interval '1 hour'",
            [grant.grantId],
          );
          const recent = z
            .number()
            .int()
            .min(0)
            .max(12)
            .parse(hourly.rows[0]?.recentRuns);
          if (recent >= 6)
            reservation = { reserved: false, reason: "rate_limited", budget };
          else {
            const runId = randomUUID(),
              slot = budget.usedRuns + 1;
            const saved = await execute(
              `INSERT INTO briefstamp_demo_v1.judge_agent_reservations (run_id,grant_id,slot,session_hash,project_id,audit_id)
              SELECT $1,g.grant_id,$3,a.session_hash,a.project_id,a.audit_id FROM briefstamp_demo_v1.judge_agent_grants g
              JOIN briefstamp_demo_v1.audits a ON a.session_hash=$4 AND a.project_id=$5 AND a.audit_id=$6
              WHERE g.grant_id=$2 AND g.proof_sha256=$7 AND g.expires_at>now() AND a.expires_at>now()
              ON CONFLICT DO NOTHING RETURNING run_id`,
              [
                runId,
                grant.grantId,
                slot,
                sessionHash,
                projectId,
                auditId,
                grant.proofSha256,
              ],
            );
            if (saved.rows.length !== 1)
              throw new Error(
                "The durable judge reservation was not confirmed.",
              );
            budget = await readJudgeBudget(execute, sessionHash, grant);
            if (budget.ownRunId !== runId || budget.usedRuns !== slot)
              throw new Error(
                "The saved judge reservation did not round-trip.",
              );
            reservation = { reserved: true, runId, slot, budget };
          }
        }
        validateJudgeGrant(grant);
        connection(env, now());
        commitAttempted = true;
        await client.query("COMMIT");
        committed = true;
        return reservation;
      } catch {
        if (client && !commitAttempted)
          await client.query("ROLLBACK").catch(() => {});
        throw new Error(
          "The judge reservation could not be confirmed. An ambiguous commit is not permission to retry or refund a run.",
        );
      } finally {
        client?.release(commitAttempted && !committed);
      }
    },
    /** Append once, scoped to the committed reservation. Never change audit or grant rows. */
    async appendJudgeAgentResult(
      sessionHash: string,
      runId: string,
      auditId: string,
      value: Record<string, unknown>,
    ) {
      sessionSchema.parse(sessionHash);
      uuid.parse(runId);
      uuid.parse(auditId);
      const status = z
        .enum(["completed", "completed_with_unavailable_tools", "failed"])
        .parse(value.status);
      // Compare the actual JSON document PostgreSQL stores: optional undefined
      // fields disappear during serialization and are not persisted changes.
      const payload = JSON.stringify(value);
      const normalized = JSON.parse(payload) as Record<string, unknown>;
      if (Buffer.byteLength(payload) > 262144)
        throw new Error("The judge result exceeds its bound.");
      const saved = await query(
        `INSERT INTO briefstamp_demo_v1.judge_agent_results (run_id,session_hash,audit_id,payload,status)
        SELECT r.run_id,r.session_hash,r.audit_id,$4::jsonb,$5 FROM briefstamp_demo_v1.judge_agent_reservations r
        JOIN briefstamp_demo_v1.judge_agent_grants g ON g.grant_id=r.grant_id
        JOIN briefstamp_demo_v1.audits a ON a.session_hash=r.session_hash AND a.audit_id=r.audit_id AND a.project_id=r.project_id
        WHERE r.run_id=$1 AND r.session_hash=$2 AND r.audit_id=$3 AND g.expires_at>now() AND a.expires_at>now()
        ON CONFLICT (run_id) DO NOTHING RETURNING run_id`,
        [runId, sessionHash, auditId, payload, status],
      );
      const existing = await query(
        `SELECT j.payload FROM briefstamp_demo_v1.judge_agent_results j
        JOIN briefstamp_demo_v1.judge_agent_reservations r ON r.run_id=j.run_id AND r.session_hash=j.session_hash AND r.audit_id=j.audit_id
        JOIN briefstamp_demo_v1.judge_agent_grants g ON g.grant_id=r.grant_id
        JOIN briefstamp_demo_v1.audits a ON a.session_hash=r.session_hash AND a.audit_id=r.audit_id AND a.project_id=r.project_id
        WHERE j.run_id=$1 AND j.session_hash=$2 AND j.audit_id=$3 AND g.expires_at>now() AND a.expires_at>now() LIMIT 1`,
        [runId, sessionHash, auditId],
      );
      if (
        existing.rows.length !== 1 ||
        !isDeepStrictEqual(
          JSON.parse(JSON.stringify(existing.rows[0].payload)),
          normalized,
        )
      )
        throw new Error("The immutable judge result could not be verified.");
      return { inserted: saved.rows.length === 1 };
    },
    async persistAudit(sessionHash: string, value: Audit) {
      sessionSchema.parse(sessionHash);
      const audit = normalizedAudit(value, now());
      const failures = audit.results
        .filter((result) => ["failed", "blocked"].includes(result.status))
        .map((result) => `${result.requirement}\n${result.evidence.observed}`)
        .join("\n");
      const saved = await query(
        "INSERT INTO briefstamp_demo_v1.audits (session_hash,audit_id,project_id,payload,failure_text,expires_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6::timestamptz) ON CONFLICT (session_hash,audit_id) DO NOTHING RETURNING audit_id",
        [
          sessionHash,
          audit.id,
          audit.projectId,
          JSON.stringify(audit),
          failures,
          new Date(Date.parse(audit.createdAt) + TTL_MS).toISOString(),
        ],
      );
      return {
        inserted: saved.rows.length === 1,
        expiresAt: new Date(Date.parse(audit.createdAt) + TTL_MS).toISOString(),
      };
    },
    async getAudit(
      sessionHash: string,
      auditId: string,
    ): Promise<Audit | null> {
      return readAudit(sessionHash, auditId);
    },
    /** Index only fingerprints of actual saved failures; never replace audit JSON. */
    async indexAuditFailures(sessionHash: string, auditId: string) {
      const audit = await readAudit(sessionHash, auditId);
      if (!audit) throw new Error("The owned saved audit is unavailable.");
      const catalog = await fixedCatalog();
      const failures = audit.results.filter((result) =>
        ["failed", "blocked"].includes(result.status),
      );
      const documents = failures.flatMap((result) => {
        const text = `${result.requirement}\n${result.evidence.observed}`;
        const textSha256 = retrievalTextSha256(text);
        const entry = catalog.documents.find(
          (item) => item.textSha256 === textSha256 && item.text === text,
        );
        return entry
          ? [
              {
                check_id: result.checkId,
                text,
                text_sha256: textSha256,
                embedding: entry.vector,
              },
            ]
          : [];
      });
      const inserted = documents.length
        ? await query(
            `INSERT INTO briefstamp_demo_v1.failure_embeddings
              (session_hash,audit_id,project_id,check_id,text_sha256,model,model_digest,catalog_sha256,embedding)
            SELECT a.session_hash,a.audit_id,a.project_id,r->>'checkId',d.text_sha256,$5,$6,$7,d.embedding
            FROM briefstamp_demo_v1.audits a
            CROSS JOIN LATERAL jsonb_array_elements(a.payload->'results') r
            JOIN jsonb_to_recordset($4::jsonb) AS d(check_id text,text text,text_sha256 text,embedding double precision[])
              ON d.check_id=r->>'checkId' AND d.text=(r->>'requirement') || chr(10) || (r->'evidence'->>'observed')
            WHERE a.session_hash=$1 AND a.audit_id=$2 AND a.project_id=$3 AND a.expires_at>now()
              AND r->>'status' IN ('failed','blocked')
            ON CONFLICT (session_hash,audit_id,check_id) DO NOTHING RETURNING check_id`,
            [
              sessionHash,
              audit.id,
              audit.projectId,
              JSON.stringify(documents),
              catalog.model,
              catalog.provenance.modelDigest,
              catalog.catalogSha256,
            ],
          )
        : { rows: [] };
      return {
        indexed: inserted.rows.length,
        matched: documents.length,
        skipped: failures.length - documents.length,
        model: catalog.model,
        catalogSha256: catalog.catalogSha256,
      };
    },
    /** Globally unique append-only allowance. A failed agent run never refunds it. */
    async reserveAgentRun(
      sessionHash: string,
      projectId: string,
      auditId: string,
      trancheId: string,
    ) {
      uuid.parse(projectId);
      z.string()
        .regex(/^[a-z0-9][a-z0-9_-]{0,79}$/)
        .parse(trancheId);
      const audit = await readAudit(sessionHash, auditId);
      if (!audit || audit.projectId !== projectId)
        throw new Error("The owned saved audit is unavailable.");
      const reserved = await query(
        `INSERT INTO briefstamp_demo_v1.agent_reservations (tranche_id,session_hash,project_id,audit_id)
         SELECT $4,a.session_hash,a.project_id,a.audit_id FROM briefstamp_demo_v1.audits a
         WHERE a.session_hash=$1 AND a.project_id=$2 AND a.audit_id=$3 AND a.expires_at>now()
         ON CONFLICT (tranche_id) DO NOTHING RETURNING tranche_id`,
        [sessionHash, projectId, auditId, trancheId],
      );
      return { reserved: reserved.rows.length === 1 };
    },
    /** Exact catalog only. Portable PostgreSQL arrays, not pgvector or a lexical fallback. */
    async searchFailuresHybrid(
      sessionHash: string,
      projectId: string,
      queryId: AgentRetrievalQueryId,
    ) {
      sessionSchema.parse(sessionHash);
      uuid.parse(projectId);
      AgentRetrievalQuerySchema.parse(queryId);
      // Recheck the funding/TLS gate before reading even the local catalog.
      connection(env, now());
      const catalog = await fixedCatalog();
      const fixed = catalog.queries.find((item) => item.id === queryId)!;
      const result = await query(
        `WITH candidates AS (
          SELECT a.audit_id AS "auditId",a.project_id AS "projectId",e.check_id AS "checkId",
            r->>'kind' AS kind,r->>'status' AS status,r->>'requirement' AS requirement,r->'evidence'->>'observed' AS observed,
            e.text_sha256 AS "textSha256",e.model,e.model_digest AS "modelDigest",e.catalog_sha256 AS "catalogSha256",
            ts_rank_cd(to_tsvector('simple',(r->>'requirement') || ' ' || (r->'evidence'->>'observed')),plainto_tsquery('simple',$3))::double precision AS "lexicalScore",
            (SELECT sum(left_value*right_value) FROM unnest(e.embedding,$4::double precision[]) AS v(left_value,right_value))::double precision AS cosine
          FROM briefstamp_demo_v1.failure_embeddings e
          JOIN briefstamp_demo_v1.audits a ON a.session_hash=e.session_hash AND a.audit_id=e.audit_id AND a.project_id=e.project_id
          CROSS JOIN LATERAL jsonb_array_elements(a.payload->'results') r
          WHERE a.session_hash=$1 AND a.project_id=$2 AND a.expires_at>now()
            AND e.session_hash=$1 AND e.project_id=$2 AND e.check_id=r->>'checkId'
            AND r->>'status' IN ('failed','blocked') AND e.model=$5 AND e.model_digest=$6 AND e.catalog_sha256=$7
        ), ranked AS (
          SELECT *,CASE WHEN "lexicalScore">0 THEN (row_number() OVER (ORDER BY "lexicalScore" DESC,"auditId","checkId"))::integer ELSE NULL END AS "lexicalRank",
            (row_number() OVER (ORDER BY cosine DESC,"auditId","checkId"))::integer AS "vectorRank" FROM candidates
        )
        SELECT *,((CASE WHEN "lexicalRank" IS NULL THEN 0 ELSE 1.0/(60+"lexicalRank") END)+1.0/(60+"vectorRank"))::double precision AS rrf
        FROM ranked ORDER BY rrf DESC,cosine DESC,"auditId","checkId" LIMIT 20`,
        [
          sessionHash,
          projectId,
          fixed.text,
          fixed.vector,
          catalog.model,
          catalog.provenance.modelDigest,
          catalog.catalogSha256,
        ],
      );
      const rows = z
        .array(
          z
            .object({
              auditId: uuid,
              projectId: z.literal(projectId),
              checkId: z.string().min(1).max(80),
              kind,
              status: z.enum(["failed", "blocked"]),
              requirement: z.string().max(3000),
              observed: z.string().max(6000),
              textSha256: z.string().regex(/^[a-f0-9]{64}$/),
              model: z.literal(AGENT_RETRIEVAL_MODEL),
              modelDigest: z.literal(catalog.provenance.modelDigest),
              catalogSha256: z.literal(catalog.catalogSha256),
              lexicalScore: z.number().finite().nonnegative(),
              lexicalRank: z.number().int().positive().nullable(),
              vectorRank: z.number().int().positive(),
              cosine: z.number().finite().min(-1.00001).max(1.00001),
              rrf: z.number().finite().positive(),
            })
            .strict(),
        )
        .max(20)
        .parse(result.rows);
      for (const row of rows) {
        const text = `${row.requirement}\n${row.observed}`;
        const document = catalog.documents.find(
          (entry) => entry.textSha256 === row.textSha256 && entry.text === text,
        );
        const expectedCosine = document?.vector.reduce(
          (sum, value, index) => sum + value * fixed.vector[index],
          0,
        );
        const expectedRrf =
          (row.lexicalRank === null ? 0 : 1 / (60 + row.lexicalRank)) +
          1 / (60 + row.vectorRank);
        if (
          !document ||
          retrievalTextSha256(text) !== row.textSha256 ||
          expectedCosine === undefined ||
          Math.abs(row.cosine - expectedCosine) > 0.0000001 ||
          Math.abs(row.rrf - expectedRrf) > 0.0000001 ||
          row.lexicalScore > 0 !== (row.lexicalRank !== null)
        )
          throw new Error(
            "The hybrid retrieval evidence could not be verified.",
          );
      }
      if (rows.some((row, index) => index > 0 && rows[index - 1].rrf < row.rrf))
        throw new Error("The hybrid retrieval order could not be verified.");
      return rows.map((row) => ({
        ...row,
        retrieval: "hybrid-rrf" as const,
        queryId,
      }));
    },
    async searchFailures(
      sessionHash: string,
      input: { projectId: string; query: string },
    ) {
      sessionSchema.parse(sessionHash);
      const parsed = z
        .object({ projectId: uuid, query: z.string().trim().min(1).max(200) })
        .strict()
        .parse(input);
      const result = await query(
        `SELECT a.audit_id AS "auditId",a.project_id AS "projectId",a.payload->>'createdAt' AS "createdAt",r->>'kind' AS kind,r->>'status' AS status,r->>'requirement' AS requirement,r->'evidence'->>'observed' AS observed
        FROM briefstamp_demo_v1.audits a CROSS JOIN LATERAL jsonb_array_elements(a.payload->'results') r
        WHERE a.session_hash=$1 AND a.project_id=$2 AND a.expires_at>now() AND r->>'status' IN ('failed','blocked')
        AND a.search @@ plainto_tsquery('simple',$3) AND to_tsvector('simple',(r->>'requirement') || ' ' || (r->'evidence'->>'observed')) @@ plainto_tsquery('simple',$3)
        ORDER BY a.expires_at DESC,a.audit_id,r->>'checkId' LIMIT 20`,
        [sessionHash, parsed.projectId, redact(parsed.query)],
      );
      return z
        .array(
          z
            .object({
              auditId: uuid,
              projectId: z.literal(parsed.projectId),
              createdAt: z.string().datetime({ offset: true }),
              kind,
              status: z.enum(["failed", "blocked"]),
              requirement: z.string().max(3000),
              observed: z.string().max(6000),
            })
            .strict(),
        )
        .max(20)
        .parse(result.rows)
        .map((row) => ({
          ...row,
          requirement: redact(row.requirement),
          observed: redact(row.observed),
          retrieval: "lexical" as const,
        }));
    },
    async close() {
      if (pool) {
        const existing = pool;
        pool = undefined;
        await existing.end();
      }
    },
  };
}

const store = createHostedTigerStore();
export const persistAudit = store.persistAudit;
export const getAudit = store.getAudit;
export const searchFailures = store.searchFailures;
export const closeHostedTiger = store.close;
