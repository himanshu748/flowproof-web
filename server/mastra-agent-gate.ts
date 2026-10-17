import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingHttpHeaders } from "node:http";
import { z } from "zod";
import type { ProviderOptions } from "./providers/free-resource-policy.js";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export function priorMastraProofHashes(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(
        ([key, value]) =>
          value !== undefined &&
          /(?:PROOF_JSON|ALLOWANCE_JSON)$/.test(key) &&
          key !== "BRIEFSTAMP_MASTRA_AGENT_PROOF_JSON",
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, sha(value!)]),
  );
}
const proofSchema = z
  .object({
    trancheId: z.string().uuid(),
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    credentialSha256: z.string().regex(/^[a-f0-9]{64}$/),
    modelCredentialSha256: z.string().regex(/^[a-f0-9]{64}$/),
    confirmedFreeSearches: z.number().int().min(97),
    freeOnly: z.literal(true),
    paidOverageDisabled: z.literal(true),
    maxModelCalls: z.literal(2),
    maxSearchCalls: z.literal(1),
    maxTigerCalls: z.literal(1),
    maxUnits: z.literal(4),
    maximumRuns: z.literal(1),
    usedRuns: z.union([z.literal(0), z.literal(1)]),
    priorProofHashes: z.record(z.string().regex(/^[a-f0-9]{64}$/)),
    evidence: z.string().min(8).max(1000),
  })
  .strict();
export type MastraOperatorProof = z.infer<typeof proofSchema>;
export function mastraOperatorConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  if (
    env.BRIEFSTAMP_MASTRA_AGENT_ENABLED !== "true" ||
    !env.SERPAPI_API_KEY ||
    !env.GOOGLE_GEMMA_API_KEY ||
    !env.FLOWPROOF_TOKEN ||
    env.FLOWPROOF_TOKEN.length < 32
  )
    return null;
  try {
    const p = proofSchema.parse(
      JSON.parse(env.BRIEFSTAMP_MASTRA_AGENT_PROOF_JSON ?? ""),
    );
    const checked = Date.parse(p.checkedAt),
      expires = Date.parse(p.expiresAt);
    if (
      p.usedRuns !== 0 ||
      checked > now ||
      expires <= now ||
      now - checked > 86400000 ||
      expires - checked > 86400000 ||
      expires > Date.parse("2026-10-20T00:00:00Z") ||
      p.credentialSha256 !== sha(env.SERPAPI_API_KEY) ||
      p.modelCredentialSha256 !== sha(env.GOOGLE_GEMMA_API_KEY) ||
      JSON.stringify(p.priorProofHashes) !==
        JSON.stringify(priorMastraProofHashes(env))
    )
      return null;
    return {
      proof: p,
      key: env.SERPAPI_API_KEY,
      searchTimeoutMs: 60_000 as const,
    };
  } catch {
    return null;
  }
}
export function authorizeMastraOperator(
  headers: IncomingHttpHeaders | Headers,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  if (!mastraOperatorConfiguration(env, now)) return false;
  const supplied =
    headers instanceof Headers
      ? headers.get("X-FlowProof-Token")
      : headers["x-flowproof-token"];
  return (
    typeof supplied === "string" &&
    timingSafeEqual(
      Buffer.from(sha(supplied)),
      Buffer.from(sha(env.FLOWPROOF_TOKEN!)),
    )
  );
}
/** A durable Tiger UNIQUE tranche must already be reserved; disk is only an additional per-call guard. */
export async function reserveMastraOperatorCall(
  operation:
    | "select_tools"
    | "summarize"
    | "failure_history"
    | "search_visibility",
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const config = mastraOperatorConfiguration(env, now);
  if (!config) throw Error("Mastra allowance unavailable");
  const directory = path.resolve(
    env.FLOWPROOF_DATA_DIR || "data",
    "provider-allowances",
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    path.join(
      directory,
      `mastra-${config.proof.trancheId}-${operation}.reservation.json`,
    ),
    JSON.stringify({
      operation,
      units: 1,
      reservedAt: new Date(now).toISOString(),
      neverRefund: true,
      proofSha256: sha(env.BRIEFSTAMP_MASTRA_AGENT_PROOF_JSON!),
    }) + "\n",
    { flag: "wx", mode: 0o600 },
  );
}
export async function mastraSearchOptions(
  headers: IncomingHttpHeaders | Headers,
  options: ProviderOptions = {},
): Promise<ProviderOptions> {
  const env = options.env ?? process.env;
  const now = (options.now ?? Date.now)();
  if (!authorizeMastraOperator(headers, env, now))
    throw Error("Mastra operator unavailable");
  const { proof, key } = mastraOperatorConfiguration(env, now)!;
  const directory = path.resolve(
    env.FLOWPROOF_DATA_DIR || "data",
    "provider-allowances",
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const filename = path.join(
    directory,
    `mastra-serpapi-${proof.trancheId}.json`,
  );
  // Refuse an existing ledger rather than reconstructing or resetting it. The durable
  // Tiger tranche prevents another call after a process restart or ephemeral-disk loss.
  await writeFile(
    filename,
    JSON.stringify({
      version: 1,
      providers: {
        serpapi: {
          credentialSha256: proof.credentialSha256,
          checkedAt: proof.checkedAt,
          expiresAt: proof.expiresAt,
          evidence: proof.evidence,
          freeOnly: true,
          paidOverageDisabled: true,
          confirmedFreeUnits: proof.confirmedFreeSearches,
          unit: "requests",
          operations: ["search-visibility"],
          maxUnits: 1,
          usedUnits: 0,
          maxCalls: 1,
          usedCalls: 0,
        },
      },
    }) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  return {
    ...options,
    env: {
      BRIEFSTAMP_SERPAPI_ENABLED: "true",
      SERPAPI_API_KEY: key,
      BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: filename,
      BRIEFSTAMP_SEARCH_DOMAINS: "flowproof-demo.onrender.com",
    },
  };
}
