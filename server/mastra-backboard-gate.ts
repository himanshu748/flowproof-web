import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import path from "node:path";
import { z } from "zod";
import {
  BACKBOARD_GEMMA_EVIDENCE_MODEL,
  type BackboardGemmaReservationRequest,
} from "./providers/backboard-gemma-evidence.js";
import type { ProviderOptions } from "./providers/free-resource-policy.js";

const PROOF_KEY = "BRIEFSTAMP_MASTRA_BACKBOARD_PROOF_JSON";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const credentialSchema = z.string().regex(/^[\x21-\x7e]{8,500}$/);
const tokenSchema = z.string().regex(/^[\x21-\x7e]{32,512}$/);
const uuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const operationSchema = z.enum([
  "select_tools",
  "summarize",
  "failure_history",
  "search_visibility",
]);
export type MastraBackboardOperation = z.infer<typeof operationSchema>;

/** Bind exact old bytes, including spent grants; never rewrite or reconstruct them. */
export function priorMastraBackboardProofHashes(env: NodeJS.ProcessEnv) {
  return Object.fromEntries(
    Object.entries(env)
      .filter(
        ([key, value]) =>
          value !== undefined &&
          /_(?:PROOF|ALLOWANCE)_JSON$/.test(key) &&
          key !== PROOF_KEY,
      )
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key, sha(value!)]),
  );
}
const proofSchema = z
  .object({
    trancheId: uuidSchema,
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    credentialSha256: hashSchema,
    modelCredentialSha256: hashSchema,
    assistantIdSha256: hashSchema,
    confirmedFreeSearches: z.number().int().min(97).max(1_000_000),
    serpFreeOnly: z.literal(true),
    serpPaidOverageDisabled: z.literal(true),
    reservedExistingCreditUsd: z.literal(0.2),
    mixedCreditApproved: z.literal(true),
    confirmedFreeCreditsUsd: z.number().finite().min(0.2).max(1_000_000),
    confirmedTotalCreditsUsd: z.number().finite().min(0.2).max(1_000_000),
    autoReloadEnabled: z.literal(false),
    paymentMethodConfigured: z.literal(false),
    modelProvider: z.literal("openrouter"),
    model: z.literal(BACKBOARD_GEMMA_EVIDENCE_MODEL),
    inputUsdPerMillion: z.literal(0.0765),
    outputUsdPerMillion: z.literal(0.255),
    contextWindowTokens: z.literal(262_144),
    maximumOutputTokens: z.literal(235_929),
    maxModelCalls: z.literal(2),
    maxSearchCalls: z.literal(1),
    maxTigerCalls: z.literal(1),
    maxUnits: z.literal(4),
    maximumRuns: z.literal(1),
    usedRuns: z.union([z.literal(0), z.literal(1)]),
    priorProofHashes: z.record(hashSchema),
    evidence: z.string().min(8).max(500),
  })
  .strict();
export type MastraBackboardProof = z.infer<typeof proofSchema>;

/** Internal only: returns credentials to trusted ports, never to an HTTP response. */
export function mastraBackboardConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const key = credentialSchema.safeParse(env.BACKBOARD_API_KEY);
  const searchKey = credentialSchema.safeParse(env.SERPAPI_API_KEY);
  const assistant = z.string().uuid().safeParse(env.BACKBOARD_ASSISTANT_ID);
  const token = tokenSchema.safeParse(env.FLOWPROOF_TOKEN);
  const raw = env[PROOF_KEY];
  const previousRaw = env.BRIEFSTAMP_MASTRA_AGENT_PROOF_JSON;
  if (
    env.BRIEFSTAMP_MASTRA_BACKBOARD_ENABLED !== "true" ||
    !Number.isFinite(now) ||
    !key.success ||
    !searchKey.success ||
    !assistant.success ||
    !token.success ||
    !raw ||
    raw.length > 65_536 ||
    !previousRaw ||
    previousRaw.length > 65_536
  )
    return null;
  try {
    const proof = proofSchema.parse(JSON.parse(raw));
    const previous = z
      .object({ trancheId: uuidSchema, usedRuns: z.literal(1) })
      .parse(JSON.parse(previousRaw));
    const checked = Date.parse(proof.checkedAt);
    const expires = Date.parse(proof.expiresAt);
    const bound = Object.entries(proof.priorProofHashes).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    const actual = Object.entries(priorMastraBackboardProofHashes(env));
    if (
      proof.usedRuns !== 0 ||
      proof.trancheId === previous.trancheId ||
      checked > now ||
      expires <= now ||
      expires <= checked ||
      now - checked > 86_400_000 ||
      expires - checked > 86_400_000 ||
      expires > Date.parse("2026-10-20T00:00:00.000Z") ||
      proof.credentialSha256 !== sha(searchKey.data) ||
      proof.modelCredentialSha256 !== sha(key.data) ||
      proof.assistantIdSha256 !== sha(assistant.data) ||
      proof.confirmedTotalCreditsUsd < proof.confirmedFreeCreditsUsd ||
      JSON.stringify(bound) !== JSON.stringify(actual)
    )
      return null;
    return {
      proof,
      proofSha256: sha(raw),
      key: key.data,
      searchKey: searchKey.data,
      assistantId: assistant.data,
      searchTimeoutMs: 60_000 as const,
    };
  } catch {
    return null;
  }
}
export function authorizeMastraBackboardOperator(
  headers: IncomingHttpHeaders | Headers,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  if (!mastraBackboardConfiguration(env, now)) return false;
  const supplied =
    headers instanceof Headers
      ? headers.get("X-FlowProof-Token")
      : headers["x-flowproof-token"];
  return (
    typeof supplied === "string" &&
    tokenSchema.safeParse(supplied).success &&
    timingSafeEqual(
      Buffer.from(sha(supplied), "hex"),
      Buffer.from(sha(env.FLOWPROOF_TOKEN!), "hex"),
    )
  );
}

type Configuration = NonNullable<
  ReturnType<typeof mastraBackboardConfiguration>
>;
interface Capability {
  proofSha256: string;
  claimedOperations: Set<MastraBackboardOperation>;
  operations: Set<MastraBackboardOperation>;
}
// Disk guards supplement the globally UNIQUE Tiger reservation. They never
// replace it: a restart loses capabilities, and Tiger refuses a repeated run.
const capabilities = new Map<string, Capability>();
const claimedRuns = new Set<string>();
const directory = (env: NodeJS.ProcessEnv) =>
  path.resolve(env.FLOWPROOF_DATA_DIR || "data", "provider-allowances");
const runKey = (env: NodeJS.ProcessEnv, config: Configuration) =>
  path.join(directory(env), `mastra-backboard-${config.proof.trancheId}`);
const unavailable = () => new Error("Mastra Backboard allowance unavailable");
function requiredConfiguration(env: NodeJS.ProcessEnv, now: number) {
  const config = mastraBackboardConfiguration(env, now);
  if (!config) throw unavailable();
  return config;
}
function requiredCapability(env: NodeJS.ProcessEnv, now: number) {
  const config = requiredConfiguration(env, now);
  const capability = capabilities.get(runKey(env, config));
  if (!capability || capability.proofSha256 !== config.proofSha256)
    throw unavailable();
  return { config, capability };
}
function unchanged(env: NodeJS.ProcessEnv, now: number, config: Configuration) {
  if (
    mastraBackboardConfiguration(env, now)?.proofSha256 !== config.proofSha256
  )
    throw unavailable();
}
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

/**
 * The caller supplies the actual Tiger UNIQUE insert, not a request-body flag.
 * A false/failed/ambiguous reservation never grants a capability. Intent and
 * completion files are append-only; every attempted run retains its full four
 * units and $0.20 reservation after failure. This function does not refund.
 */
export async function reserveMastraBackboardRun(
  reserveTiger: (trancheId: string) => Promise<{ reserved: boolean }>,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
): Promise<{ reserved: boolean }> {
  const config = requiredConfiguration(env, now);
  if (typeof reserveTiger !== "function") throw unavailable();
  const key = runKey(env, config);
  if (claimedRuns.has(key)) return { reserved: false };
  claimedRuns.add(key);
  try {
    await mkdir(directory(env), { recursive: true, mode: 0o700 });
    unchanged(env, now, config);
    const seal = {
      trancheId: config.proof.trancheId,
      proofSha256: config.proofSha256,
      maxUnits: 4,
      reservedExistingCreditUsd: 0.2,
      mixedCreditApproved: true,
      reservedAt: new Date(now).toISOString(),
      neverRefund: true,
    };
    await exclusive(`${key}.intent.json`, seal);
    unchanged(env, now, config);
    const result = await reserveTiger(config.proof.trancheId);
    if (!result || typeof result !== "object" || result.reserved !== true)
      return { reserved: false };
    unchanged(env, now, config);
    await exclusive(`${key}.tiger-reserved.json`, {
      ...seal,
      durable: "Tiger UNIQUE tranche",
      reserved: true,
    });
    unchanged(env, now, config);
    capabilities.set(key, {
      proofSha256: config.proofSha256,
      claimedOperations: new Set(),
      operations: new Set(),
    });
    return { reserved: true };
  } catch {
    throw unavailable();
  }
}

const modelRequestSchema = z
  .object({
    provider: z.literal("Backboard"),
    transport: z.literal("backboard_openrouter_gemma"),
    phase: z.enum(["select_tools", "summarize"]),
    assistantId: z.string().uuid(),
    modelProvider: z.literal("openrouter"),
    model: z.literal(BACKBOARD_GEMMA_EVIDENCE_MODEL),
    endpoint: z.literal("https://app.backboard.io/api/threads/messages"),
    requestBytes: z.number().int().positive().max(32_768),
    requestSha256: hashSchema,
    credentialSha256: hashSchema,
    freshThread: z.literal(true),
  })
  .strict();

/** Must run immediately before the corresponding transport, never after I/O. */
export async function reserveMastraBackboardCall(
  operation: MastraBackboardOperation,
  env: NodeJS.ProcessEnv = process.env,
  modelRequestMetadata?: BackboardGemmaReservationRequest,
  now = Date.now(),
) {
  try {
    operationSchema.parse(operation);
    const { config, capability } = requiredCapability(env, now);
    let request: BackboardGemmaReservationRequest | undefined;
    if (operation === "select_tools" || operation === "summarize") {
      request = modelRequestSchema.parse(modelRequestMetadata);
      if (
        request.phase !== operation ||
        request.assistantId !== config.assistantId ||
        request.credentialSha256 !== config.proof.modelCredentialSha256
      )
        throw unavailable();
    } else if (modelRequestMetadata !== undefined) throw unavailable();
    if (capability.claimedOperations.has(operation)) throw unavailable();
    // Claim before awaited filesystem work. Failed/ambiguous writes stay spent.
    capability.claimedOperations.add(operation);
    await exclusive(`${runKey(env, config)}-${operation}.reservation.json`, {
      operation,
      units: 1,
      trancheId: config.proof.trancheId,
      reservedAt: new Date(now).toISOString(),
      neverRefund: true,
      proofSha256: config.proofSha256,
      ...(request ? { modelRequest: request } : {}),
    });
    unchanged(env, now, config);
    capability.operations.add(operation);
  } catch {
    throw unavailable();
  }
}

/** One new SerpApi ledger for this tranche; existing ledgers are never rewritten. */
export async function mastraBackboardSearchOptions(
  headers: IncomingHttpHeaders | Headers,
  options: ProviderOptions = {},
): Promise<ProviderOptions> {
  const env = options.env ?? process.env;
  const now = (options.now ?? Date.now)();
  if (!authorizeMastraBackboardOperator(headers, env, now)) throw unavailable();
  try {
    const { config, capability } = requiredCapability(env, now);
    if (!capability.operations.has("search_visibility")) throw unavailable();
    const filename = `${runKey(env, config)}-serpapi.json`;
    await exclusive(filename, {
      version: 1,
      providers: {
        serpapi: {
          credentialSha256: config.proof.credentialSha256,
          checkedAt: config.proof.checkedAt,
          expiresAt: config.proof.expiresAt,
          evidence: config.proof.evidence,
          freeOnly: config.proof.serpFreeOnly,
          paidOverageDisabled: config.proof.serpPaidOverageDisabled,
          confirmedFreeUnits: config.proof.confirmedFreeSearches,
          unit: "requests",
          operations: ["search-visibility"],
          maxUnits: 1,
          usedUnits: 0,
          maxCalls: 1,
          usedCalls: 0,
        },
      },
    });
    unchanged(env, now, config);
    return {
      ...options,
      env: {
        ...env,
        BRIEFSTAMP_SERPAPI_ENABLED: "true",
        SERPAPI_API_KEY: config.searchKey,
        BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: filename,
        BRIEFSTAMP_SEARCH_DOMAINS: "flowproof-demo.onrender.com",
      },
    };
  } catch {
    throw unavailable();
  }
}
