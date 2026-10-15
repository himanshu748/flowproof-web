import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import path from "node:path";
import { z } from "zod";
import { redact } from "../shared/redact.js";
import { validateModelProposal } from "./generator.js";
import { generateTinkerProposal } from "./providers/tinker.js";
import {
  ProviderError,
  type ProviderOptions,
} from "./providers/free-resource-policy.js";

const DAY = 86_400_000;
const CUTOFF = Date.parse("2026-10-20T00:00:00Z");
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
const checkpoint = z
  .string()
  .regex(
    /^tinker:\/\/[A-Za-z0-9:_-]{1,150}\/sampler_weights\/[A-Za-z0-9_.-]{1,100}$/,
  );
const hostedProof = z
  .object({
    credentialSha256: z.string().regex(/^[a-f0-9]{64}$/),
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    evidence: z.string().min(8).max(500),
    freeOnly: z.literal(true),
    paidOverageDisabled: z.literal(true),
    unit: z.literal("tokens"),
    operations: z.tuple([z.literal("generate-checks")]),
    confirmedFreeUnits: z.number().int().positive().max(1_000_000),
    maxUnits: z.number().int().positive().max(50_000),
    usedUnits: z.literal(0),
    maxCalls: z.number().int().min(1).max(2),
    usedCalls: z.literal(0),
  })
  .strict();
const savedLedger = z
  .object({
    version: z.literal(1),
    providers: z
      .object({
        tinker: hostedProof.extend({
          usedUnits: z.number().int().nonnegative().max(50_000),
          usedCalls: z.number().int().nonnegative().max(2),
        }),
      })
      .strict(),
  })
  .strict();

function configuration(env: NodeJS.ProcessEnv, now: number) {
  if (env.BRIEFSTAMP_HOSTED_TINKER_ENABLED !== "true") return null;
  const key = credential.safeParse(env.TINKER_API_KEY);
  const model = checkpoint.safeParse(env.TINKER_MODEL_PATH);
  const token = operatorToken.safeParse(env.FLOWPROOF_TOKEN);
  const raw = env.BRIEFSTAMP_HOSTED_TINKER_PROOF_JSON;
  if (
    !key.success ||
    !model.success ||
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
      now - checked > DAY ||
      expires <= now ||
      expires <= checked ||
      expires - checked > DAY ||
      expires > CUTOFF ||
      proof.credentialSha256 !== digest(key.data).toString("hex") ||
      proof.confirmedFreeUnits < proof.maxUnits
    )
      return null;
    return { key: key.data, model: model.data, token: token.data, proof };
  } catch {
    return null;
  }
}

/** Pure configuration check, not proof of available ledger budget or live inference. */
export function hostTinkerEnabled(
  env: NodeJS.ProcessEnv = process.env,
  now = Date.now(),
) {
  return configuration(env, now) !== null;
}

/** Invoke before session/project lookup. Independent of Backboard's proof or key. */
export function authorizeHostedTinker(
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
 * Bootstrap once per canonical credential-bound proof, never per checkpoint or
 * process. Existing corrupt or consumed ledgers are never repaired or reset.
 * The native guard reserves before network I/O and never refunds or retries.
 * Render's ephemeral disk can reset this local allowance on disk replacement.
 * This is an operator-only temporary proof, not a durable cross-deploy quota;
 * the confirmed free-only/no-overage provider boundary remains mandatory.
 */
export async function hostedTinkerOptions(
  options: ProviderOptions = {},
): Promise<ProviderOptions> {
  const env = options.env ?? process.env;
  const config = configuration(env, (options.now ?? Date.now)());
  if (!config)
    throw new ProviderError(
      "disabled",
      "Hosted Tinker requires a current checkpoint, fresh credential-bound free-only proof and operator authentication.",
    );
  const directory = path.resolve(
    env.FLOWPROOF_DATA_DIR || "data",
    "provider-allowances",
  );
  // Zod emits fields in schema order, so reordering input JSON cannot reset use.
  // The checkpoint is deliberately excluded: changing it grants no new budget.
  const identity = digest(JSON.stringify(config.proof)).toString("hex");
  const filename = path.join(directory, `tinker-${identity}.json`);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    await writeFile(
      filename,
      `${JSON.stringify({ version: 1, providers: { tinker: config.proof } }, null, 2)}\n`,
      { mode: 0o600, flag: "wx" },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST")
      throw new ProviderError(
        "allowance_unavailable",
        "The hosted allowance could not be initialized; no provider request was sent.",
      );
  }
  // The shared provider guard accepts larger operator budgets for other uses.
  // A valid-shaped but replaced ledger cannot widen this hosted proof's caps.
  try {
    if ((await stat(filename)).size > 32_768) throw new Error();
    const saved = savedLedger.parse(
      JSON.parse(await readFile(filename, "utf8")),
    ).providers.tinker;
    if (
      JSON.stringify({ ...saved, usedUnits: 0, usedCalls: 0 }) !==
      JSON.stringify(config.proof)
    )
      throw new Error();
  } catch {
    throw new ProviderError(
      "free_confirmation_required",
      "The existing hosted Tinker allowance does not match its confirmed proof; no provider request was sent.",
    );
  }
  return {
    fetcher: options.fetcher,
    now: options.now,
    env: {
      BRIEFSTAMP_TINKER_ENABLED: "true",
      TINKER_API_KEY: config.key,
      TINKER_MODEL_PATH: config.model,
      BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: filename,
    },
  };
}

/** Trusted server input only. The route must authorize first and choose its own sample brief. */
export async function generateHostedTinkerProposal(
  requirements: string[],
  options: ProviderOptions = {},
) {
  // Keep the one-requirement-per-line binding exact before spending any allowance.
  const parsed = z
    .array(z.string().min(1).max(2000))
    .min(1)
    .max(6)
    .safeParse(requirements);
  if (
    !parsed.success ||
    parsed.data.some(
      (value) =>
        value !== value.trim() ||
        /[\r\n]/.test(value) ||
        /^(?:[-*•]|\d+[.)])\s+/.test(value) ||
        redact(value) !== value,
    )
  )
    throw new ProviderError(
      "invalid_input",
      "Use bounded, unnumbered synthetic requirements without private information.",
    );
  const proposed = await generateTinkerProposal(
    parsed.data,
    await hostedTinkerOptions(options),
  );
  try {
    const checks = validateModelProposal(parsed.data.join("\n"), {
      checks: proposed.checks.map(
        ({ requirement: _requirement, ...check }, requirementIndex) => ({
          ...check,
          requirementIndex,
        }),
      ),
    });
    return { ...proposed, checks };
  } catch {
    throw new ProviderError(
      "invalid_plan",
      "Tinker returned a proposal that did not pass the source-bound safe check schema. No browser action was run.",
    );
  }
}
