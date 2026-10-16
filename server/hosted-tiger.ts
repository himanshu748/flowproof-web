import pg from "pg";
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
  return {
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
