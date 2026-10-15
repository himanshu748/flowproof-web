import { createHash, randomUUID } from "node:crypto";
import {
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

export type OptionalProvider =
  | "backboard"
  | "serpapi"
  | "elevenlabs"
  | "tinker";
export interface ProviderOptions {
  env?: NodeJS.ProcessEnv;
  /** Inject only from trusted server tests; never from a request body. */
  fetcher?: typeof fetch;
  now?: () => number;
}
export class ProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
const allowance = z
  .object({
    credentialSha256: z.string().regex(/^[a-f0-9]{64}$/),
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    evidence: z.string().min(8).max(500),
    freeOnly: z.literal(true),
    paidOverageDisabled: z.literal(true),
    unit: z.enum(["requests", "characters", "tokens"]),
    operations: z
      .array(
        z.enum([
          "memory-write",
          "memory-search",
          "search-visibility",
          "sample-speech",
          "generate-checks",
        ]),
      )
      .min(1)
      .max(5),
    confirmedFreeUnits: z.number().int().nonnegative().max(1_000_000),
    maxUnits: z.number().int().positive().max(1_000_000),
    usedUnits: z.number().int().nonnegative(),
    maxCalls: z.number().int().min(1).max(20),
    usedCalls: z.number().int().nonnegative(),
  })
  .strict();
const ledger = z
  .object({
    version: z.literal(1),
    providers: z
      .object({
        backboard: allowance.optional(),
        serpapi: allowance.optional(),
        elevenlabs: allowance.optional(),
        tinker: allowance.optional(),
      })
      .strict(),
  })
  .strict();
const endpoints: Partial<
  Record<OptionalProvider, { origin: string; path: RegExp }>
> = {
  backboard: {
    origin: "https://app.backboard.io",
    path: /^\/api\/assistants\/[a-f0-9-]{36}\/memories(?:\/search)?$/i,
  },
  serpapi: { origin: "https://serpapi.com", path: /^\/search\.json$/ },
  tinker: {
    origin: "https://tinker.thinkingmachines.dev",
    path: /^\/services\/tinker-prod\/oai\/api\/v1\/completions$/,
  },
  elevenlabs: {
    origin: "https://api.elevenlabs.io",
    path: /^\/v1\/text-to-speech\/[A-Za-z0-9]{20}$/,
  },
};

export function providerKey(
  provider: OptionalProvider,
  options: ProviderOptions = {},
): string {
  const env = options.env ?? process.env;
  if (env[`BRIEFSTAMP_${provider.toUpperCase()}_ENABLED`] !== "true")
    throw new ProviderError("disabled", "This optional provider is disabled.");
  const key = env[`${provider.toUpperCase()}_API_KEY`];
  if (!key || key.length < 8 || key.length > 500 || /[\s\x00-\x1f]/.test(key))
    throw new ProviderError(
      "not_configured",
      "A valid server-side provider key is required.",
    );
  return key;
}

/** Persist the full reservation before a request. Failures are never refunded or retried. */
export async function reserveProviderUse(
  provider: OptionalProvider,
  key: string,
  operation: string,
  units: number,
  unit: "requests" | "characters" | "tokens",
  options: ProviderOptions = {},
) {
  if (key !== providerKey(provider, options))
    throw new ProviderError(
      "not_configured",
      "The reservation key does not match the enabled provider.",
    );
  const permitted = {
    backboard: {
      unit: "requests",
      operations: ["memory-write", "memory-search"],
    },
    serpapi: { unit: "requests", operations: ["search-visibility"] },
    elevenlabs: { unit: "characters", operations: ["sample-speech"] },
    tinker: { unit: "tokens", operations: ["generate-checks"] },
  }[provider];
  if (unit !== permitted.unit || !permitted.operations.includes(operation))
    throw new ProviderError(
      "invalid_input",
      "The operation or unit is not supported for this provider.",
    );
  const filename = (options.env ?? process.env)
    .BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE;
  if (!filename || !path.isAbsolute(filename))
    throw new ProviderError(
      "free_confirmation_required",
      "A fresh confirmed-free allowance file is required.",
    );
  const lockname = `${filename}.lock`;
  let lock;
  try {
    lock = await open(lockname, "wx", 0o600);
  } catch {
    throw new ProviderError(
      "allowance_unavailable",
      "The allowance is locked or unavailable; no provider request was sent.",
    );
  }
  try {
    let data: z.infer<typeof ledger>;
    try {
      if ((await stat(filename)).size > 32_768) throw new Error();
      data = ledger.parse(JSON.parse(await readFile(filename, "utf8")));
    } catch {
      throw new ProviderError(
        "free_confirmation_required",
        "The confirmed-free allowance is missing or invalid.",
      );
    }
    const proof = data.providers[provider];
    const now = (options.now ?? Date.now)();
    if (
      !proof ||
      proof.credentialSha256 !==
        createHash("sha256").update(key).digest("hex") ||
      proof.unit !== unit ||
      !proof.operations.includes(
        operation as (typeof proof.operations)[number],
      ) ||
      now < Date.parse(proof.checkedAt) ||
      now - Date.parse(proof.checkedAt) > 86_400_000 ||
      Date.parse(proof.expiresAt) <= now ||
      Date.parse(proof.expiresAt) <= Date.parse(proof.checkedAt)
    )
      throw new ProviderError(
        "free_confirmation_required",
        "Confirm this account's free allowance and disabled overage within the last 24 hours.",
      );
    if (
      !Number.isSafeInteger(units) ||
      units < 1 ||
      proof.usedCalls + 1 > proof.maxCalls ||
      proof.usedUnits + units >
        Math.min(proof.maxUnits, proof.confirmedFreeUnits)
    )
      throw new ProviderError(
        "budget_exhausted",
        "The confirmed-free request budget is exhausted.",
      );
    proof.usedCalls += 1;
    proof.usedUnits += units;
    const temp = `${filename}.${randomUUID()}.tmp`;
    try {
      await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      await rename(temp, filename);
    } catch {
      await unlink(temp).catch(() => {});
      throw new ProviderError(
        "allowance_unavailable",
        "The request reservation could not be saved.",
      );
    }
  } finally {
    await lock.close();
    await unlink(lockname).catch(() => {});
  }
}

export async function providerRequest(
  provider: OptionalProvider,
  url: URL,
  init: RequestInit,
  operation: string,
  units: number,
  unit: "requests" | "characters" | "tokens",
  options: ProviderOptions = {},
): Promise<Response> {
  const key = providerKey(provider, options);
  const allowed = endpoints[provider];
  if (
    !allowed ||
    url.origin !== allowed.origin ||
    !allowed.path.test(url.pathname) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new ProviderError(
      "unsafe_endpoint",
      "Only the fixed provider endpoint is allowed.",
    );
  const method = (init.method ?? "GET").toUpperCase();
  if (method !== (provider === "serpapi" ? "GET" : "POST"))
    throw new ProviderError(
      "invalid_input",
      "Only the documented bounded provider operation is allowed.",
    );
  const headers = new Headers(init.headers);
  const requestKey =
    provider === "serpapi"
      ? url.searchParams.get("api_key")
      : provider === "backboard"
        ? headers.get("X-API-Key")
        : provider === "elevenlabs"
          ? headers.get("xi-api-key")
          : headers.get("authorization")?.replace(/^Bearer /, "");
  if (requestKey !== key)
    throw new ProviderError(
      "not_configured",
      "The request credential does not match the confirmed account.",
    );
  await reserveProviderUse(provider, key, operation, units, unit, options);
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new ProviderError(
      "request_failed",
      "The provider request failed; its reservation remains consumed.",
    );
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => {});
    throw new ProviderError(
      "provider_rejected",
      `The provider returned HTTP ${response.status}; no error body was retained.`,
    );
  }
  return response;
}

export async function boundedBytes(
  response: Response,
  maximum: number,
): Promise<Buffer> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maximum) {
    await response.body?.cancel();
    throw new ProviderError(
      "invalid_response",
      "The provider response exceeded the size limit.",
    );
  }
  const reader = response.body?.getReader();
  if (!reader)
    throw new ProviderError(
      "invalid_response",
      "The provider returned no body.",
    );
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maximum) {
        await reader.cancel();
        throw new ProviderError(
          "invalid_response",
          "The provider response exceeded the size limit.",
        );
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      "invalid_response",
      "The provider response could not be read.",
    );
  }
  return Buffer.concat(chunks);
}
export async function providerJson(response: Response): Promise<unknown> {
  try {
    return JSON.parse(
      (await boundedBytes(response, 64 * 1024)).toString("utf8"),
    );
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError(
      "invalid_response",
      "The provider returned invalid JSON.",
    );
  }
}
