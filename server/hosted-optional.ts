import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import path from "node:path";
import { z } from "zod";
import { HOSTED_WEBSITE_URL } from "../shared/hosted-target.js";
import type { Audit, Project } from "../shared/types.js";
import { SAMPLE_URL } from "./sample.js";
import { checkSearchVisibility } from "./providers/serpapi.js";
import {
  createSpokenSampleReport,
  sampleNarration,
} from "./providers/elevenlabs.js";
import {
  ProviderError,
  type ProviderOptions,
} from "./providers/free-resource-policy.js";

type HostedOptionalProvider = "serpapi" | "elevenlabs";
const DAY = 86_400_000;
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
// This stock voice is fixed server-side; a request cannot select or clone a voice.
export const HOSTED_SAMPLE_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const commonProof = z.object({
  credentialSha256: z.string().regex(/^[a-f0-9]{64}$/),
  checkedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  evidence: z.string().min(8).max(500),
  freeOnly: z.literal(true),
  paidOverageDisabled: z.literal(true),
  confirmedFreeUnits: z.number().int().positive().max(1_000_000),
  usedUnits: z.literal(0),
  maxCalls: z.literal(1),
  usedCalls: z.literal(0),
});
const searchProof = commonProof
  .extend({
    unit: z.literal("requests"),
    operations: z.tuple([z.literal("search-visibility")]),
    maxUnits: z.literal(1),
  })
  .strict();
const speechProof = commonProof
  .extend({
    unit: z.literal("characters"),
    operations: z.tuple([z.literal("sample-speech")]),
    maxUnits: z.number().int().positive().max(1000),
  })
  .strict();
const searchLedger = z
  .object({
    version: z.literal(1),
    providers: z
      .object({
        serpapi: searchProof.extend({
          usedUnits: z.number().int().min(0).max(1),
          usedCalls: z.number().int().min(0).max(1),
        }),
      })
      .strict(),
  })
  .strict();
const speechLedger = z
  .object({
    version: z.literal(1),
    providers: z
      .object({
        elevenlabs: speechProof.extend({
          usedUnits: z.number().int().min(0).max(1000),
          usedCalls: z.number().int().min(0).max(1),
        }),
      })
      .strict(),
  })
  .strict();

function configuration(
  provider: HostedOptionalProvider,
  env: NodeJS.ProcessEnv,
  now: number,
) {
  const prefix = `BRIEFSTAMP_HOSTED_${provider.toUpperCase()}`;
  if (env[`${prefix}_ENABLED`] !== "true") return null;
  const key = credential.safeParse(env[`${provider.toUpperCase()}_API_KEY`]);
  const token = operatorToken.safeParse(env.FLOWPROOF_TOKEN);
  const raw = env[`${prefix}_PROOF_JSON`];
  if (!key.success || !token.success || !raw || raw.length > 16_384)
    return null;
  if (
    provider === "elevenlabs" &&
    (env.ELEVENLABS_VOICE_ID !== HOSTED_SAMPLE_VOICE_ID ||
      env.BRIEFSTAMP_ELEVENLABS_STOCK_VOICE_CONFIRMED !== "true" ||
      env.BRIEFSTAMP_ELEVENLABS_NONCOMMERCIAL_DEMO !== "true")
  )
    return null;
  try {
    const parsed = (
      provider === "serpapi" ? searchProof : speechProof
    ).safeParse(JSON.parse(raw));
    if (!parsed.success) return null;
    const proof = parsed.data;
    const checked = Date.parse(proof.checkedAt),
      expires = Date.parse(proof.expiresAt);
    if (
      !Number.isFinite(now) ||
      now < checked ||
      now - checked > DAY ||
      expires <= now ||
      expires <= checked ||
      expires - checked > DAY ||
      proof.credentialSha256 !== digest(key.data).toString("hex") ||
      proof.confirmedFreeUnits < proof.maxUnits
    )
      return null;
    return { key: key.data, token: token.data, proof };
  } catch {
    return null;
  }
}

/** Configuration availability only: not ledger budget or a verified provider result. */
export function hostOptionalEnabled(
  provider: HostedOptionalProvider,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  return configuration(provider, env, now) !== null;
}

/** Call before any visitor, target or audit lookup; never accept auth from a body. */
export function authorizeHostedOptional(
  provider: HostedOptionalProvider,
  headers: IncomingHttpHeaders | Headers,
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  const config = configuration(provider, env, now);
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
 * Exclusive initialization never replaces consumed or corrupt reservations.
 * The shared guard locks and persists before transport, without refund/retry.
 * Ephemeral host disk can reset on replacement: this is not a cross-deploy quota.
 * Fresh account-confirmed free-only/no-overage entitlement remains mandatory.
 */
export async function hostedOptionalOptions(
  provider: HostedOptionalProvider,
  options: ProviderOptions = {},
): Promise<ProviderOptions> {
  const env = options.env ?? process.env;
  const config = configuration(provider, env, (options.now ?? Date.now)());
  if (!config)
    throw new ProviderError(
      "disabled",
      "Hosted optional providers require fresh credential-bound confirmed-free proof and operator authentication.",
    );
  const directory = path.resolve(
    env.FLOWPROOF_DATA_DIR || "data",
    "provider-allowances",
  );
  // Zod's canonical field ordering prevents a reordered JSON proof granting new use.
  // Voice, search domain and request bodies are excluded from ledger identity.
  const identity = digest(JSON.stringify(config.proof)).toString("hex");
  const filename = path.join(directory, `${provider}-${identity}.json`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      filename,
      `${JSON.stringify({ version: 1, providers: { [provider]: config.proof } }, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST")
      throw new ProviderError(
        "allowance_unavailable",
        "The hosted allowance could not be initialized; no provider request was sent.",
      );
  }
  try {
    if ((await stat(filename)).size > 32_768) throw new Error();
    const raw = JSON.parse(await readFile(filename, "utf8"));
    const saved =
      provider === "serpapi"
        ? searchLedger.parse(raw).providers.serpapi
        : speechLedger.parse(raw).providers.elevenlabs;
    if (
      JSON.stringify({ ...saved, usedUnits: 0, usedCalls: 0 }) !==
      JSON.stringify(config.proof)
    )
      throw new Error();
  } catch {
    throw new ProviderError(
      "free_confirmation_required",
      "The saved hosted allowance does not match its confirmed proof; no provider request was sent.",
    );
  }
  return {
    fetcher: options.fetcher,
    now: options.now,
    env: {
      [`BRIEFSTAMP_${provider.toUpperCase()}_ENABLED`]: "true",
      [`${provider.toUpperCase()}_API_KEY`]: config.key,
      BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: filename,
      ...(provider === "serpapi"
        ? { BRIEFSTAMP_SEARCH_DOMAINS: new URL(HOSTED_WEBSITE_URL).hostname }
        : {
            ELEVENLABS_VOICE_ID: HOSTED_SAMPLE_VOICE_ID,
            BRIEFSTAMP_ELEVENLABS_NONCOMMERCIAL_DEMO: "true",
          }),
    },
  };
}

export async function searchHostedHomepage(
  project: Project,
  options: ProviderOptions = {},
) {
  if (
    project.target !== "website" ||
    project.url !== HOSTED_WEBSITE_URL ||
    project.authorized !== true
  )
    throw new ProviderError(
      "invalid_input",
      "Only the owner's exact Briefstamp homepage can be observed.",
    );
  return checkSearchVisibility(
    project,
    await hostedOptionalOptions("serpapi", options),
  );
}

export async function narrateHostedSample(
  audit: Audit,
  options: ProviderOptions = {},
) {
  if (
    audit.source?.url !== SAMPLE_URL ||
    !["healthy", "broken"].includes(audit.source.sampleVariant)
  )
    throw new ProviderError(
      "invalid_input",
      "Only a completed built-in synthetic sample audit may be narrated.",
    );
  // Validate counts-only text before any allowance initialization or expenditure.
  if (sampleNarration(audit).length > 1000)
    throw new ProviderError(
      "invalid_input",
      "The synthetic narration exceeded its character cap.",
    );
  return createSpokenSampleReport(
    audit,
    await hostedOptionalOptions("elevenlabs", options),
  );
}
