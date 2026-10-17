import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import path from "node:path";
import { z } from "zod";
import { hostedSentryAvailable } from "./sentry-configuration.js";
import type { RequestHandler } from "express";
import { authorizeSentryAgentOperator } from "./sentry-agent-gate.js";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const key = "BRIEFSTAMP_RUNTIME_TRACE_GRANT_JSON";
const token = z.string().regex(/^[\x21-\x7e]{32,512}$/);
const schema = z
  .object({
    grantId: uuid,
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    auditReservationId: uuid,
    agentReservationId: uuid,
    sentryDsnSha256: hash,
    agentProofSha256: hash,
    plan: z.literal("Sponsored Team"),
    payAsYouGoLimitUsd: z.literal(0),
    maximumExports: z.literal(2),
    usedExports: z.union([z.literal(0), z.literal(2)]),
    maximumEnvelopesPerExport: z.literal(2),
    evidence: z.string().min(8).max(500),
  })
  .strict();
export type RuntimeTraceGrant = z.infer<typeof schema>;
export function runtimeTraceConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  if (
    env.BRIEFSTAMP_RUNTIME_TRACE_ENABLED !== "true" ||
    !hostedSentryAvailable(env, now) ||
    !token.safeParse(env.FLOWPROOF_TOKEN).success ||
    !env[key] ||
    env[key]!.length > 8192 ||
    !env.BRIEFSTAMP_SENTRY_AGENT_PROOF_JSON ||
    env.BRIEFSTAMP_SENTRY_AGENT_PROOF_JSON.length > 65536
  )
    return null;
  try {
    const proof = schema.parse(JSON.parse(env[key]!));
    const agent = z
      .object({ trancheId: uuid, usedRuns: z.literal(0) })
      .parse(JSON.parse(env.BRIEFSTAMP_SENTRY_AGENT_PROOF_JSON));
    const checked = Date.parse(proof.checkedAt),
      expires = Date.parse(proof.expiresAt);
    const ids = [
      proof.grantId,
      proof.auditReservationId,
      proof.agentReservationId,
      agent.trancheId,
    ];
    if (
      !Number.isFinite(now) ||
      proof.usedExports !== 0 ||
      checked > now ||
      now - checked > 86400000 ||
      expires <= now ||
      expires <= checked ||
      expires - checked > 86400000 ||
      expires > Date.parse("2026-10-20T00:00:00Z") ||
      expires >
        Date.parse(env.FLOWPROOF_SENTRY_FREE_CONFIRMED_AT!) + 86400000 ||
      new Set(ids).size !== ids.length ||
      proof.sentryDsnSha256 !== sha(env.SENTRY_DSN!) ||
      proof.agentProofSha256 !== sha(env.BRIEFSTAMP_SENTRY_AGENT_PROOF_JSON)
    )
      return null;
    return { proof, proofSha256: sha(env[key]!) };
  } catch {
    return null;
  }
}
export function authorizeRuntimeTrace(
  headers: IncomingHttpHeaders | Headers,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  if (!runtimeTraceConfiguration(env, now)) return false;
  const supplied =
    headers instanceof Headers
      ? headers.get("X-FlowProof-Token")
      : headers["x-flowproof-token"];
  return (
    typeof supplied === "string" &&
    token.safeParse(supplied).success &&
    timingSafeEqual(
      Buffer.from(sha(supplied), "hex"),
      Buffer.from(sha(env.FLOWPROOF_TOKEN!), "hex"),
    )
  );
}
/** Install before JSON parsing; tokenless callers cannot probe this proof route. */
export function runtimeTraceHttpBoundary(
  now: () => number = Date.now,
): RequestHandler {
  return (req, res, next) => {
    const audit =
      req.method === "POST" &&
      /^\/api\/audits\/[^/]+\/runtime-trace\/?$/i.test(req.path);
    const agent =
      req.method === "POST" &&
      /^\/api\/audits\/[^/]+\/agent-review\/?$/i.test(req.path) &&
      process.env.BRIEFSTAMP_SENTRY_AGENT_PROOF_JSON !== undefined;
    if (
      (audit && !authorizeRuntimeTrace(req.headers, process.env, now())) ||
      (agent &&
        (!authorizeRuntimeTrace(req.headers, process.env, now()) ||
          !authorizeSentryAgentOperator(req.headers, process.env, now())))
    )
      return res.status(404).json({ error: "Not found in this demo session." });
    next();
  };
}
const attempted = new Set<string>();
const metadataSchema = z
  .object({
    operation: z.literal("runtime_trace"),
    measurementSha256: hash,
    units: z.literal(1),
    maxEnvelopes: z.literal(2),
  })
  .strict();
async function exclusive(filename: string, value: unknown) {
  const f = await open(filename, "wx", 0o600);
  try {
    await f.writeFile(JSON.stringify(value) + "\n");
    await f.sync();
  } finally {
    await f.close();
  }
  const d = await open(path.dirname(filename), "r");
  try {
    await d.sync();
  } finally {
    await d.close();
  }
}
/** Two independent, once-only exports, not a renewable Sentry allowance. Unknown completion stays consumed. */
export async function reserveRuntimeTraceExport(
  kind: "audit" | "agent",
  metadata: z.infer<typeof metadataSchema>,
  reserveTiger: (id: string) => Promise<{ reserved: boolean }>,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const config = runtimeTraceConfiguration(env, now);
  if (!config || !["audit", "agent"].includes(kind))
    throw Error("Runtime trace allowance unavailable");
  const request = metadataSchema.parse(metadata);
  const id =
    kind === "audit"
      ? config.proof.auditReservationId
      : config.proof.agentReservationId;
  const directory = path.resolve(
    env.FLOWPROOF_DATA_DIR || "data",
    "provider-allowances",
  );
  const filename = path.join(
    directory,
    `runtime-trace-${config.proof.grantId}-${kind}`,
  );
  if (attempted.has(filename))
    throw Error("Runtime trace export already reserved");
  attempted.add(filename);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const seal = {
    ...request,
    kind,
    trancheId: id,
    grantId: config.proof.grantId,
    proofSha256: config.proofSha256,
    neverRefund: true,
    reservedAt: new Date(now).toISOString(),
  };
  await exclusive(filename + ".intent.json", seal);
  if (runtimeTraceConfiguration(env, now)?.proofSha256 !== config.proofSha256)
    throw Error("Runtime trace proof changed");
  const result = await reserveTiger(id);
  if (
    result?.reserved !== true ||
    runtimeTraceConfiguration(env, now)?.proofSha256 !== config.proofSha256
  )
    throw Error("Runtime trace reservation unavailable; no retry or refund");
  await exclusive(filename + ".tiger-reserved.json", seal);
  if (runtimeTraceConfiguration(env, now)?.proofSha256 !== config.proofSha256)
    throw Error("Runtime trace proof changed");
}
