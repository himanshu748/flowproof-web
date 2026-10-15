import pg from "pg";
import { z } from "zod";
import type { Audit } from "../shared/types.js";
import { redact } from "../shared/redact.js";
import { databaseConfig } from "./database.js";
import { CheckSchema, isSafePath } from "./schema.js";

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
const kind = CheckSchema.innerType().shape.kind;
const generatorSchema = z
  .object({
    provider: z.string().max(120),
    model: z.string().max(120).nullable(),
    reason: z.string().max(3000).optional(),
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
        target: z.literal("sample"),
        url: z.string().refine(ownSample),
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
                url: z.string().refine(ownSample),
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
    application_name: "briefstamp-public-synthetic",
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
    throw new Error("The synthetic audit exceeds its storage limit.");
  const audit = auditSchema.parse(value);
  if (
    Date.parse(audit.createdAt) <= now - TTL_MS ||
    Date.parse(audit.createdAt) > now ||
    Date.parse(audit.completedAt) < Date.parse(audit.createdAt) ||
    Date.parse(audit.completedAt) > now
  )
    throw new Error(
      "Only a current completed synthetic audit can be stored or retrieved.",
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
      "The synthetic audit must contain one result per unique check.",
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
        "The synthetic audit result does not match its approved check.",
      );
    if (
      result.evidence.screenshot &&
      !new RegExp(`^/evidence/${audit.id}/[A-Za-z0-9_-]+\\.png$`).test(
        result.evidence.screenshot,
      )
    )
      throw new Error(
        "Only a reference to this synthetic audit's screenshot is permitted.",
      );
  }
  return audit;
}

/** Construction is offline. Every operation rechecks expiry; runtime never creates schema. */
export function createHostedTigerStore(
  options: { env?: NodeJS.ProcessEnv; now?: () => number } = {},
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
      sessionSchema.parse(sessionHash);
      uuid.parse(auditId);
      const result = await query(
        "SELECT payload FROM briefstamp_demo_v1.audits WHERE session_hash=$1 AND audit_id=$2 AND expires_at>now() LIMIT 1",
        [sessionHash, auditId],
      );
      if (!result.rows.length) return null;
      const audit = normalizedAudit(result.rows[0].payload, now());
      if (audit.id !== auditId)
        throw new Error("The stored synthetic audit identity is invalid.");
      return audit;
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
