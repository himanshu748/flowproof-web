import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import path from "node:path";
import { z } from "zod";
import { BACKBOARD_MEMORY_RECORDED_SCOPE } from "./providers/backboard-memory-answer.js";
import type { BackboardMemoryReservationRequest } from "./providers/backboard-memory-answer.js";

const PROOF = "BRIEFSTAMP_BACKBOARD_ANSWER_PROOF_JSON";
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const credential = z.string().regex(/^[\x21-\x7e]{8,500}$/);
const token = z.string().regex(/^[\x21-\x7e]{32,512}$/);
const operations = z.enum(["memory_search", "answer"]);
export type BackboardAnswerOperation = z.infer<typeof operations>;
export function priorBackboardAnswerProofHashes(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(
        ([k, v]) =>
          v !== undefined &&
          /_(?:PROOF|ALLOWANCE)_JSON$/.test(k) &&
          k !== PROOF,
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, sha(v!)]),
  );
}
const schema = z
  .object({
    trancheId: z.string().uuid(),
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    credentialSha256: hash,
    assistantIdSha256: hash,
    projectScope: hash,
    auditScope: hash,
    expectedFactsSha256: hash,
    confirmedFreeCreditsUsd: z.number().finite().min(0.1),
    confirmedTotalCreditsUsd: z.number().finite().min(0.1),
    existingCreditsApproved: z.literal(true),
    freeOnly: z.literal(false),
    autoReloadEnabled: z.literal(false),
    paymentMethodConfigured: z.literal(false),
    reservedExistingCreditUsd: z.literal(0.1),
    modelProvider: z.literal("openrouter"),
    model: z.literal("google/gemma-4-26b-a4b-it"),
    inputUsdPerMillion: z.literal(0.0765),
    outputUsdPerMillion: z.literal(0.255),
    contextWindowTokens: z.literal(262144),
    maximumOutputTokens: z.literal(235929),
    maximumRuns: z.literal(1),
    usedRuns: z.union([z.literal(0), z.literal(1)]),
    maxMemorySearches: z.literal(1),
    maxModelCalls: z.literal(1),
    maxUnits: z.literal(2),
    priorProofHashes: z.record(hash),
    evidence: z.string().min(8).max(500),
  })
  .strict();
export type BackboardAnswerProof = z.infer<typeof schema>;
export function backboardAnswerConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const key = credential.safeParse(env.BACKBOARD_API_KEY);
  const assistant = z.string().uuid().safeParse(env.BACKBOARD_ASSISTANT_ID);
  if (
    env.BRIEFSTAMP_BACKBOARD_ANSWER_ENABLED !== "true" ||
    !Number.isFinite(now) ||
    !key.success ||
    !assistant.success ||
    !token.safeParse(env.FLOWPROOF_TOKEN).success ||
    !env[PROOF] ||
    env[PROOF]!.length > 65536
  )
    return null;
  try {
    const proof = schema.parse(JSON.parse(env[PROOF]!));
    const checked = Date.parse(proof.checkedAt),
      expires = Date.parse(proof.expiresAt);
    if (
      proof.usedRuns !== 0 ||
      checked > now ||
      now - checked > 86400000 ||
      expires <= now ||
      expires <= checked ||
      expires - checked > 86400000 ||
      expires > Date.parse("2026-10-20T00:00:00Z") ||
      proof.credentialSha256 !== sha(key.data) ||
      proof.assistantIdSha256 !== sha(assistant.data) ||
      proof.projectScope !== BACKBOARD_MEMORY_RECORDED_SCOPE.projectScope ||
      proof.auditScope !== BACKBOARD_MEMORY_RECORDED_SCOPE.auditScope ||
      proof.expectedFactsSha256 !==
        BACKBOARD_MEMORY_RECORDED_SCOPE.expectedFactsSha256 ||
      proof.confirmedTotalCreditsUsd < proof.confirmedFreeCreditsUsd ||
      JSON.stringify(
        Object.entries(proof.priorProofHashes).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      ) !== JSON.stringify(Object.entries(priorBackboardAnswerProofHashes(env)))
    )
      return null;
    // A new grant may never reuse any preceding spent tranche's identity.
    const previous = JSON.parse(
      env.BRIEFSTAMP_MASTRA_BACKBOARD_PROOF_JSON || "null",
    );
    if (previous?.usedRuns !== 1) return null;
    for (const name of Object.keys(proof.priorProofHashes)) {
      try {
        if (JSON.parse(env[name]!).trancheId === proof.trancheId) return null;
      } catch {
        /* Opaque old bytes remain hash-bound. */
      }
    }
    return {
      proof,
      proofSha256: sha(env[PROOF]!),
      key: key.data,
      assistantId: assistant.data,
    };
  } catch {
    return null;
  }
}
export function authorizeBackboardAnswer(
  headers: IncomingHttpHeaders | Headers,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  if (!backboardAnswerConfiguration(env, now)) return false;
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
type Config = NonNullable<ReturnType<typeof backboardAnswerConfiguration>>;
const capabilities = new Map<
  string,
  { proofSha256: string; claimed: Set<BackboardAnswerOperation> }
>();
const claimedRuns = new Set<string>();
const unavailable = () => new Error("Backboard answer allowance unavailable");
const runKey = (env: NodeJS.ProcessEnv, c: Config) =>
  path.join(
    path.resolve(env.FLOWPROOF_DATA_DIR || "data", "provider-allowances"),
    `backboard-answer-${c.proof.trancheId}`,
  );
const required = (env: NodeJS.ProcessEnv, now: number) => {
  const c = backboardAnswerConfiguration(env, now);
  if (!c) throw unavailable();
  return c;
};
async function exclusive(filename: string, value: unknown) {
  const file = await open(filename, "wx", 0o600);
  try {
    await file.writeFile(JSON.stringify(value) + "\n", "utf8");
    await file.sync();
  } finally {
    await file.close();
  }
  const parent = await open(path.dirname(filename), "r");
  try {
    await parent.sync();
  } finally {
    await parent.close();
  }
}
/** A confirmed Tiger UNIQUE insertion is required. Disk replacement loses capabilities, never replenishes them. */
export async function reserveBackboardAnswerRun(
  reserveTiger: (id: string) => Promise<{ reserved: boolean }>,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const c = required(env, now),
    key = runKey(env, c);
  if (typeof reserveTiger !== "function") throw unavailable();
  if (claimedRuns.has(key)) return { reserved: false };
  claimedRuns.add(key);
  await mkdir(path.dirname(key), { recursive: true, mode: 0o700 });
  const seal = {
    trancheId: c.proof.trancheId,
    proofSha256: c.proofSha256,
    maxUnits: 2,
    reservedExistingCreditUsd: 0.1,
    neverRefund: true,
    reservedAt: new Date(now).toISOString(),
  };
  await exclusive(`${key}.intent.json`, seal);
  if (required(env, now).proofSha256 !== c.proofSha256) throw unavailable();
  const result = await reserveTiger(c.proof.trancheId);
  if (required(env, now).proofSha256 !== c.proofSha256) throw unavailable();
  if (result?.reserved !== true) return { reserved: false };
  await exclusive(`${key}.tiger-reserved.json`, seal);
  if (required(env, now).proofSha256 !== c.proofSha256) throw unavailable();
  capabilities.set(key, { proofSha256: c.proofSha256, claimed: new Set() });
  return { reserved: true };
}
/** Bind the exact explicit adapter request before each external call. No retry or refund. */
export async function reserveBackboardAnswerCall(
  metadata: BackboardMemoryReservationRequest,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const c = required(env, now),
    key = runKey(env, c),
    cap = capabilities.get(key);
  const op = operations.parse(metadata.operation);
  if (
    !cap ||
    cap.proofSha256 !== c.proofSha256 ||
    cap.claimed.has(op) ||
    metadata.assistantId !== c.assistantId ||
    metadata.credentialSha256 !== c.proof.credentialSha256 ||
    metadata.projectScope !== c.proof.projectScope ||
    metadata.auditScope !== c.proof.auditScope ||
    metadata.expectedFactsSha256 !== c.proof.expectedFactsSha256 ||
    metadata.provider !== "Backboard" ||
    !hash.safeParse(metadata.requestSha256).success ||
    !Number.isInteger(metadata.requestBytes) ||
    metadata.requestBytes < 1 ||
    metadata.requestBytes > 32768 ||
    (op === "memory_search" &&
      (metadata.endpoint !==
        `https://app.backboard.io/api/assistants/${c.assistantId}/memories/search` ||
        metadata.freshThread !== false ||
        metadata.modelProvider !== null ||
        metadata.model !== null ||
        metadata.retrievedContentSha256 !== null ||
        metadata.factIds.length !== 0)) ||
    (op === "answer" &&
      (!cap.claimed.has("memory_search") ||
        metadata.endpoint !== "https://app.backboard.io/api/threads/messages" ||
        metadata.freshThread !== true ||
        metadata.modelProvider !== "openrouter" ||
        metadata.model !== c.proof.model ||
        !hash.safeParse(metadata.retrievedContentSha256).success ||
        !z
          .array(z.string().regex(/^app-fact-[a-f0-9]{64}$/))
          .length(6)
          .safeParse(metadata.factIds).success ||
        new Set(metadata.factIds).size !== 6))
  )
    throw unavailable();
  cap.claimed.add(op);
  await exclusive(`${key}-${op}.reservation.json`, {
    ...metadata,
    units: 1,
    trancheId: c.proof.trancheId,
    neverRefund: true,
    reservedAt: new Date(now).toISOString(),
    proofSha256: c.proofSha256,
  });
  if (required(env, now).proofSha256 !== c.proofSha256) throw unavailable();
}
