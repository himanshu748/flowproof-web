import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import path from "node:path";
import { z } from "zod";
import type { Audit, CheckKind } from "../shared/types.js";
import { rememberAudit, recallProjectMemory } from "./providers/backboard.js";
import {
  ProviderError,
  type ProviderOptions,
} from "./providers/free-resource-policy.js";

const digest = (value: string) => createHash("sha256").update(value).digest();
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
const hostedProof = z
  .object({
    credentialSha256: z.string().regex(/^[a-f0-9]{64}$/),
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    evidence: z.string().min(8).max(500),
    freeOnly: z.literal(false),
    existingCreditOnly: z.literal(true),
    existingCreditsApproved: z.literal(true),
    autoReloadEnabled: z.literal(false),
    paymentMethodConfigured: z.literal(false),
    confirmedExistingCreditsUsd: z.number().finite().positive(),
    maxCreditSpendUsd: z.number().finite().positive().max(0.03),
    usedCreditSpendUsd: z.literal(0),
    unit: z.literal("requests"),
    operations: z.tuple([
      z.literal("memory-write"),
      z.literal("memory-search"),
    ]),
    usedOperations: z.array(z.never()).length(0),
    maxUnits: z.literal(2),
    usedUnits: z.literal(0),
    maxCalls: z.literal(2),
    usedCalls: z.literal(0),
  })
  .strict();

function configuration(env: NodeJS.ProcessEnv, now: number) {
  if (
    env.BRIEFSTAMP_BACKBOARD_ENABLED !== "true" ||
    env.BRIEFSTAMP_BACKBOARD_EXISTING_CREDITS_APPROVED !== "true"
  )
    return null;
  const key = credential.safeParse(env.BACKBOARD_API_KEY);
  const assistant = z.string().uuid().safeParse(env.BACKBOARD_ASSISTANT_ID);
  const token = operatorToken.safeParse(env.FLOWPROOF_TOKEN);
  const raw = env.BRIEFSTAMP_BACKBOARD_ALLOWANCE_JSON;
  if (
    !key.success ||
    !assistant.success ||
    !token.success ||
    !raw ||
    raw.length > 16_384
  )
    return null;
  try {
    const parsed = hostedProof.safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const proof = parsed.data;
    const checked = Date.parse(proof.checkedAt),
      expires = Date.parse(proof.expiresAt);
    if (
      !Number.isFinite(now) ||
      now < checked ||
      now - checked > 86_400_000 ||
      expires <= now ||
      expires <= checked ||
      expires - checked > 86_400_000 ||
      proof.credentialSha256 !== digest(key.data).toString("hex") ||
      proof.confirmedExistingCreditsUsd < proof.maxCreditSpendUsd
    )
      return null;
    return {
      key: key.data,
      assistant: assistant.data,
      token: token.data,
      proof,
    };
  } catch {
    return null;
  }
}

/** Pure configuration availability, not a claim that a remote call has succeeded. */
export function hostBackboardEnabled(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  return configuration(env, now) !== null;
}

/** Routes must call this before looking up session-owned projects or audits. */
export function authorizeHostedBackboard(
  headers: IncomingHttpHeaders | Headers,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const config = configuration(env, now);
  if (!config) return false;
  const supplied =
    headers instanceof Headers
      ? headers.get("X-FlowProof-Token")
      : headers["x-flowproof-token"];
  return (
    typeof supplied === "string" &&
    operatorToken.safeParse(supplied).success &&
    timingSafeEqual(digest(supplied), digest(config.token))
  );
}

/**
 * Bootstrap once per exact key/assistant/proof. Never reset a consumed ledger.
 * A free host's ephemeral disk cannot retain this limit across disk replacement;
 * operator authentication and the provider's no-reload/no-card boundary still apply.
 */
export async function hostedBackboardOptions(
  options: ProviderOptions = {},
): Promise<ProviderOptions> {
  const env = options.env ?? process.env;
  const config = configuration(env, (options.now ?? Date.now)());
  if (!config)
    throw new ProviderError(
      "disabled",
      "Hosted Backboard requires fresh approved existing-credit evidence and operator authentication.",
    );
  const directory = path.resolve(
    env.FLOWPROOF_DATA_DIR || "data",
    "provider-allowances",
  );
  const identity = digest(
    JSON.stringify({ assistant: config.assistant, proof: config.proof }),
  ).toString("hex");
  const filename = path.join(directory, `backboard-${identity}.json`);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      filename,
      `${JSON.stringify({ version: 1, providers: { backboard: config.proof } }, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST")
      throw new ProviderError(
        "allowance_unavailable",
        "The hosted allowance could not be initialized; no provider request was sent.",
      );
  }
  return {
    fetcher: options.fetcher,
    now: options.now,
    env: {
      BRIEFSTAMP_BACKBOARD_ENABLED: "true",
      BRIEFSTAMP_BACKBOARD_EXISTING_CREDITS_APPROVED: "true",
      BACKBOARD_API_KEY: config.key,
      BACKBOARD_ASSISTANT_ID: config.assistant,
      BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: filename,
    },
  };
}

export async function rememberHostedAudit(
  audit: Audit,
  options: ProviderOptions = {},
) {
  return rememberAudit(audit, await hostedBackboardOptions(options));
}

export async function recallHostedMemory(
  projectId: string,
  kind: CheckKind,
  options: ProviderOptions = {},
) {
  return recallProjectMemory(
    projectId,
    kind,
    await hostedBackboardOptions(options),
  );
}
