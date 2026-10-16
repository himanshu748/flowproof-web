import { createHash, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import path from "node:path";
import { z } from "zod";
import { HOSTED_WEBSITE_URL } from "../shared/hosted-target.js";
import {
  ProviderError,
  type ProviderOptions,
} from "./providers/free-resource-policy.js";

const DAY = 86_400_000;
export const EVIDENCE_AGENT_EXPIRES_BY = "2026-10-20T00:00:00.000Z";
// Committed evidence of the already-consumed, separate hosted search allowance.
// docs/evidence/hosted-optional/2026-10-16T09-13-12Z/receipt.json
export const EVIDENCE_AGENT_PRIOR_SERP_RECEIPT_SHA256 =
  "75d7d7d17e2476ebeb09abe14c53b29bc23012b27a811649376623e47d6574ff";
// The one failed native attempt at 2026-10-16T11:31Z: invalid_model_json,
// HTTP 200, 516 input / 38 output tokens, no tool or search execution.
// Bound to the exact unexpected-response.json bytes, not a reconstructed receipt.
export const EVIDENCE_AGENT_FAILED_RECEIPT_SHA256 =
  "da520b1fde09e57d15e03d4f92bc8b1e4af124e122a87b7c8131a762d2e6a384";
// The separately spent repair failed at 2026-10-16T11:45Z with HTTP 500
// INTERNAL before any tool or search ran. Exact unexpected-response.json bytes.
export const EVIDENCE_AGENT_FAILED_REPAIR_RECEIPT_SHA256 =
  "06064dc3f52050916b37c63a59ed098b56740d73bb9873115f57a3fd92598536";
const sha256 = (value: string) => createHash("sha256").update(value).digest();
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const credential = z
  .string()
  .min(8)
  .max(500)
  .regex(/^[^\s\x00-\x1f]+$/);
const operatorToken = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[^\s\x00-\x1f]+$/);
const proofSchema = z
  .object({
    trancheId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    credentialSha256: hash,
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    confirmedFreeSearches: z.number().int().min(1).max(1_000_000),
    freeOnly: z.literal(true),
    paidOverageDisabled: z.literal(true),
    priorSerpReceiptSha256: z.literal(EVIDENCE_AGENT_PRIOR_SERP_RECEIPT_SHA256),
    priorSerpProofSha256: hash,
    priorSerpCalls: z.literal(1),
    priorSerpUnits: z.literal(1),
    maxModelCalls: z.literal(2),
    maxSearchCalls: z.literal(1),
    usedRuns: z.union([z.literal(0), z.literal(1)]),
    evidence: z.string().min(8).max(500),
  })
  .strict();

const repairProofSchema = proofSchema
  .extend({
    previousAgentProofSha256: hash,
    previousAgentReceiptSha256: z.literal(EVIDENCE_AGENT_FAILED_RECEIPT_SHA256),
  })
  .strict();
const resilientProofSchema = repairProofSchema
  .extend({
    maxModelCalls: z.literal(6),
    previousRepairProofSha256: hash,
    previousRepairReceiptSha256: z.literal(
      EVIDENCE_AGENT_FAILED_REPAIR_RECEIPT_SHA256,
    ),
    cumulativeAgentReservedModelCalls: z.literal(10),
  })
  .strict();

export type EvidenceAgentRepairProof = z.infer<typeof repairProofSchema>;
export type EvidenceAgentResilientProof = z.infer<typeof resilientProofSchema>;
export type EvidenceAgentProof =
  | z.infer<typeof proofSchema>
  | EvidenceAgentRepairProof
  | EvidenceAgentResilientProof;

function validWindow(proof: EvidenceAgentProof, now: number, fresh: boolean) {
  const checked = Date.parse(proof.checkedAt);
  const expires = Date.parse(proof.expiresAt);
  return (
    checked <= now &&
    expires > checked &&
    expires - checked <= DAY &&
    expires <= Date.parse(EVIDENCE_AGENT_EXPIRES_BY) &&
    (!fresh || (now - checked <= DAY && expires > now))
  );
}

// Matches the shared providerRequest allowance format, with a one-search cap.
// Counter fields are read from disk and never replaced by zero on an existing file.
const searchAllowance = z
  .object({
    credentialSha256: hash,
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    evidence: z.string().min(8).max(500),
    freeOnly: z.literal(true),
    paidOverageDisabled: z.literal(true),
    confirmedFreeUnits: z.number().int().positive().max(1_000_000),
    unit: z.literal("requests"),
    operations: z.tuple([z.literal("search-visibility")]),
    maxUnits: z.literal(1),
    usedUnits: z.number().int().min(0).max(1),
    maxCalls: z.literal(1),
    usedCalls: z.number().int().min(0).max(1),
  })
  .strict();
const historicalSearchProof = searchAllowance
  .extend({
    usedUnits: z.literal(1),
    usedCalls: z.literal(1),
  })
  .strict();
const ledgerSchema = z
  .object({
    version: z.literal(1),
    providers: z.object({ serpapi: searchAllowance }).strict(),
  })
  .strict();

/** Internal configuration only. Never serialize this return value into a response. */
export function evidenceAgentConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): { proof: EvidenceAgentProof; key: string } | null {
  if (env.BRIEFSTAMP_EVIDENCE_AGENT_ENABLED !== "true") return null;
  const key = credential.safeParse(env.SERPAPI_API_KEY);
  const token = operatorToken.safeParse(env.FLOWPROOF_TOKEN);
  const raw = env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON;
  const priorRaw = env.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON;
  const repairRaw = env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON;
  const resilientRaw = env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON;
  if (
    !key.success ||
    !token.success ||
    !raw ||
    raw.length > 16_384 ||
    !priorRaw ||
    priorRaw.length > 16_384 ||
    !Number.isFinite(now)
  )
    return null;
  try {
    const primary = proofSchema.parse(JSON.parse(raw));
    const historical = historicalSearchProof.parse(JSON.parse(priorRaw));
    const credentialHash = sha256(key.data).toString("hex");
    if (
      !validWindow(primary, now, false) ||
      primary.credentialSha256 !== credentialHash ||
      historical.credentialSha256 !== credentialHash ||
      primary.priorSerpProofSha256 !== sha256(priorRaw).toString("hex") ||
      historical.usedCalls < historical.maxCalls ||
      historical.usedUnits < historical.maxUnits
    )
      return null;
    // A configured later tranche never falls back to an earlier allowance.
    // Every prior reservation stays spent; the exact raw proofs remain bound.
    if (repairRaw !== undefined || resilientRaw !== undefined) {
      if (!repairRaw || repairRaw.length > 16_384 || primary.usedRuns !== 1)
        return null;
      const repair = repairProofSchema.parse(JSON.parse(repairRaw));
      if (
        !validWindow(repair, now, false) ||
        repair.trancheId === primary.trancheId ||
        repair.credentialSha256 !== credentialHash ||
        repair.priorSerpProofSha256 !== primary.priorSerpProofSha256 ||
        repair.previousAgentProofSha256 !== sha256(raw).toString("hex") ||
        Date.parse(repair.checkedAt) < Date.parse(primary.checkedAt)
      )
        return null;
      if (resilientRaw !== undefined) {
        if (
          !resilientRaw ||
          resilientRaw.length > 16_384 ||
          repair.usedRuns !== 1
        )
          return null;
        const resilient = resilientProofSchema.parse(JSON.parse(resilientRaw));
        if (
          resilient.usedRuns !== 0 ||
          !validWindow(resilient, now, true) ||
          resilient.trancheId === primary.trancheId ||
          resilient.trancheId === repair.trancheId ||
          resilient.credentialSha256 !== credentialHash ||
          resilient.priorSerpProofSha256 !== primary.priorSerpProofSha256 ||
          resilient.previousAgentProofSha256 !== sha256(raw).toString("hex") ||
          resilient.previousRepairProofSha256 !==
            sha256(repairRaw).toString("hex") ||
          Date.parse(resilient.checkedAt) < Date.parse(repair.checkedAt)
        )
          return null;
        return { proof: resilient, key: key.data };
      }
      if (repair.usedRuns !== 0 || !validWindow(repair, now, true)) return null;
      return { proof: repair, key: key.data };
    }
    if (primary.usedRuns !== 0 || !validWindow(primary, now, true)) return null;
    // Historical entitlement may be expired. It is retained spent, never refreshed.
    return { proof: primary, key: key.data };
  } catch {
    return null;
  }
}

/** Configuration availability, not remaining durable budget or a funding check. */
export function evidenceAgentEnabled(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): boolean {
  return evidenceAgentConfiguration(env, now) !== null;
}

/** Invoke before any session/project lookup, durable reservation or model I/O. */
export function authorizeEvidenceAgent(
  headers: IncomingHttpHeaders | Headers,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): boolean {
  if (!evidenceAgentConfiguration(env, now)) return false;
  const supplied =
    headers instanceof Headers
      ? headers.get("X-FlowProof-Token")
      : headers["x-flowproof-token"];
  return (
    typeof supplied === "string" &&
    operatorToken.safeParse(supplied).success &&
    timingSafeEqual(sha256(supplied), sha256(env.FLOWPROOF_TOKEN!))
  );
}

/**
 * Initialize only this new tranche's search allowance, never the original proof.
 * Caller must first reserve the UUID in Tiger and the off-host verifier ledger.
 * This local file is a second guard, not a cross-deploy durable reservation.
 * providerRequest reserves before transport and never retries or refunds.
 */
export async function agentSearchOptions(
  headers: IncomingHttpHeaders | Headers,
  options: ProviderOptions = {},
): Promise<ProviderOptions> {
  const env = options.env ?? process.env;
  const now = (options.now ?? Date.now)();
  if (!authorizeEvidenceAgent(headers, env, now))
    throw new ProviderError(
      "unauthorized",
      "Evidence-agent operator authorization is unavailable.",
    );
  const config = evidenceAgentConfiguration(env, now)!;
  const { proof } = config;
  const allowance = searchAllowance.parse({
    credentialSha256: proof.credentialSha256,
    checkedAt: proof.checkedAt,
    expiresAt: proof.expiresAt,
    evidence: `Evidence-agent tranche ${proof.trancheId}; immutable proof SHA-256 ${sha256(JSON.stringify(proof)).toString("hex")}; prior receipt ${proof.priorSerpReceiptSha256}; prior proof ${proof.priorSerpProofSha256}.`,
    freeOnly: true,
    paidOverageDisabled: true,
    confirmedFreeUnits: proof.confirmedFreeSearches,
    unit: "requests",
    operations: ["search-visibility"],
    maxUnits: 1,
    usedUnits: 0,
    maxCalls: 1,
    usedCalls: 0,
  });
  const directory = path.resolve(
    env.FLOWPROOF_DATA_DIR || "data",
    "provider-allowances",
  );
  // Only canonical UUID is identity. No timestamp, balance or proof hash is a path.
  const filename = path.join(
    directory,
    `evidence-agent-serpapi-${proof.trancheId}.json`,
  );
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      filename,
      `${JSON.stringify({ version: 1, providers: { serpapi: allowance } }, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST")
      throw new ProviderError(
        "allowance_unavailable",
        "The separate evidence-agent allowance could not be initialized.",
      );
  }
  let saved: z.infer<typeof searchAllowance>;
  try {
    const file = await open(
      filename,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size > 32_768) throw new Error();
      saved = ledgerSchema.parse(JSON.parse(await file.readFile("utf8")))
        .providers.serpapi;
    } finally {
      await file.close();
    }
    if (
      JSON.stringify({ ...saved, usedUnits: 0, usedCalls: 0 }) !==
      JSON.stringify(allowance)
    )
      throw new Error();
  } catch {
    throw new ProviderError(
      "free_confirmation_required",
      "The existing evidence-agent ledger is invalid or does not match its immutable proof.",
    );
  }
  if (saved.usedCalls >= saved.maxCalls || saved.usedUnits >= saved.maxUnits)
    throw new ProviderError(
      "budget_exhausted",
      "The evidence-agent search reservation is already consumed.",
    );
  return {
    fetcher: options.fetcher,
    now: options.now,
    env: {
      BRIEFSTAMP_SERPAPI_ENABLED: "true",
      SERPAPI_API_KEY: config.key,
      BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: filename,
      BRIEFSTAMP_SEARCH_DOMAINS: new URL(HOSTED_WEBSITE_URL).hostname,
    },
  };
}
