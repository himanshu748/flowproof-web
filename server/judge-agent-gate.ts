import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { HOSTED_WEBSITE_URL } from "../shared/hosted-target.js";
import {
  ProviderError,
  providerJson,
  type ProviderOptions,
} from "./providers/free-resource-policy.js";

const CUTOFF = Date.parse("2026-10-20T00:00:00Z");
const DAY = 86_400_000;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const credential = z
  .string()
  .min(8)
  .max(500)
  .regex(/^[^\s\x00-\x1f]+$/);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
export const JUDGE_AGENT_PRIOR_PINS = Object.freeze({
  primary: "a17d77aecf9dd2198bd0c5fbc97c042267ad39752954e675797e58e01d796021",
  repair: "b4b76307c7fbd7bc1f5cc94c52e07f6754277960d0e074067a708d54f9151016",
  resilient: "6a0bb27b7728c074ab4934939df30be29ed23316294b96de2b07ce2eaf578b9f",
  searchRepair:
    "29914853202469f299d8be2e630a519db6a9c4574a51b8fcf6d95c9ef9b2df73",
  standaloneSerp:
    "4266ddc018bb407e5da7d6fa524068f0f992007f65bda983a5f31bf07c8fd810",
});
const priorNames = {
  primary: "BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON",
  repair: "BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON",
  resilient: "BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON",
  searchRepair: "BRIEFSTAMP_EVIDENCE_AGENT_SEARCH_REPAIR_PROOF_JSON",
} as const;
export const JudgeAgentProofSchema = z
  .object({
    grantId: z
      .string()
      .uuid()
      .transform((value) => value.toLowerCase()),
    credentialSha256: hash,
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    freeOnly: z.literal(true),
    paidOverageDisabled: z.literal(true),
    maxRuns: z.literal(12),
    maxModelCallsPerRun: z.literal(2),
    maxSearchCallsPerRun: z.literal(1),
    maxRunsPerVisitor: z.literal(1),
    priorSpentProofsSha256: z
      .object({
        primary: hash,
        repair: hash,
        resilient: hash,
        searchRepair: hash,
      })
      .strict(),
    priorStandaloneSerpProofSha256: hash,
    priorStandaloneSerpCalls: z.literal(1),
    priorStandaloneSerpUnits: z.literal(1),
    evidence: z.string().min(8).max(500),
  })
  .strict();
export type JudgeAgentProof = z.infer<typeof JudgeAgentProofSchema>;
export const JUDGE_AGENT_EXPANSION_PIN = Object.freeze({
  grantId: "69c1acd6-6a7c-44e1-bb82-e4d2544a62ea",
  baseProofSha256:
    "fbaef465b12db6c4b1571d61cb50b3347a6b4189cb39ff09efbd392f1ea64f5c",
  expansionId: "a3b8d32e-e7ec-4576-bbac-c0b9d74baaaa",
  proofSha256:
    "cf9fa8a9367035b7226401f8c90b4e59a1072a8620e05ca6b411479704a8804a",
});
export const JudgeAgentExpansionProofSchema = z
  .object({
    expansionId: z.string().uuid(),
    grantId: z.string().uuid(),
    baseProofSha256: hash,
    credentialSha256: hash,
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    freeOnly: z.literal(true),
    paidOverageDisabled: z.literal(true),
    baseMaxRuns: z.literal(12),
    maxRuns: z.literal(100),
    maxRunsPerHour: z.literal(6),
    maxModelCallsPerRun: z.literal(2),
    maxSearchCallsPerRun: z.literal(1),
    maxRunsPerVisitor: z.literal(1),
    confirmedFreeSearches: z.number().int().min(100).max(1_000_000),
    evidence: z.string().min(8).max(500),
  })
  .strict();
export type JudgeAgentExpansionProof = z.infer<
  typeof JudgeAgentExpansionProofSchema
>;
const BaseJudgeAgentGrantSchema = z
  .object({
    grantId: z.string().uuid(),
    proofSha256: hash,
    maxRuns: z.literal(12),
    expiresAt: z
      .string()
      .datetime({ offset: true })
      .refine((value) => Date.parse(value) <= CUTOFF),
  })
  .strict();
const expansionSealSchema = z
  .object({
    expansionId: z.string().uuid(),
    proofSha256: hash,
    baseProofSha256: hash,
    maxRuns: z.literal(100),
  })
  .strict();
export const JudgeAgentGrantSchema = z.union([
  BaseJudgeAgentGrantSchema,
  BaseJudgeAgentGrantSchema.extend({
    maxRuns: z.literal(100),
    expansion: expansionSealSchema,
  }).strict(),
]);
export type JudgeAgentGrant = z.infer<typeof JudgeAgentGrantSchema>;
export interface JudgeAgentConfiguration {
  proof: JudgeAgentProof;
  expansion?: JudgeAgentExpansionProof;
  grant: JudgeAgentGrant;
  key: string;
}
export interface JudgeAgentFundingSnapshot {
  provider: "SerpApi";
  checkedAt: string;
  plan: "Free Plan";
  remainingSearches: number;
  modelRequests: 0;
  searchRequests: 0;
}
export interface JudgeFundingOptions extends ProviderOptions {
  forceFresh?: boolean;
  minimumSearches?: number;
  signal?: AbortSignal;
}
const accountSchema = z.object({
  account_status: z.literal("Active"),
  plan_name: z.literal("Free Plan"),
  plan_monthly_price: z.literal(0),
  extra_credits: z.literal(0),
  total_searches_left: z.number().int().min(1).max(1_000_000),
  plan_searches_left: z.number().int().min(1).max(1_000_000),
});
const searchAllowance = z
  .object({
    credentialSha256: hash,
    checkedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    evidence: z.string().min(8).max(500),
    freeOnly: z.literal(true),
    paidOverageDisabled: z.literal(true),
    confirmedFreeUnits: z.literal(1),
    unit: z.literal("requests"),
    operations: z.tuple([z.literal("search-visibility")]),
    maxUnits: z.literal(1),
    usedUnits: z.number().int().min(0).max(1),
    maxCalls: z.literal(1),
    usedCalls: z.number().int().min(0).max(1),
  })
  .strict();
const ledgerSchema = z
  .object({
    version: z.literal(1),
    providers: z.object({ serpapi: searchAllowance }).strict(),
  })
  .strict();
function validProof(
  proof: Pick<JudgeAgentProof, "checkedAt" | "expiresAt">,
  now: number,
) {
  const checked = Date.parse(proof.checkedAt),
    expires = Date.parse(proof.expiresAt);
  return (
    Number.isFinite(now) &&
    now >= checked &&
    now < expires &&
    expires > checked &&
    expires - checked <= 4 * DAY &&
    expires <= CUTOFF
  );
}
function denied(code: string): never {
  throw new ProviderError(
    code,
    "The judge agent's confirmed-free funding or immutable allowance is unavailable. No provider retry or allowance reset is authorized.",
  );
}

/** Test-only code injection can supply synthetic historical hashes; no env/HTTP override exists. */
export function createJudgeAgentGate(
  options: {
    priorPins?: Record<keyof typeof JUDGE_AGENT_PRIOR_PINS, string>;
    expansionPin?: {
      grantId: string;
      baseProofSha256: string;
      expansionId: string;
      proofSha256: string;
    };
  } = {},
) {
  const pins = { ...(options.priorPins ?? JUDGE_AGENT_PRIOR_PINS) };
  const expansionPin = {
    ...(options.expansionPin ?? JUDGE_AGENT_EXPANSION_PIN),
  };
  for (const value of Object.values(pins)) hash.parse(value);
  z.string().uuid().parse(expansionPin.grantId);
  z.string().uuid().parse(expansionPin.expansionId);
  hash.parse(expansionPin.baseProofSha256);
  hash.parse(expansionPin.proofSha256);
  function validExpansion(
    expansion: JudgeAgentExpansionProof,
    proof: JudgeAgentProof,
    now: number,
  ) {
    return (
      validProof(expansion, now) &&
      expansion.grantId === proof.grantId &&
      expansion.grantId === expansionPin.grantId &&
      expansion.expansionId === expansionPin.expansionId &&
      expansion.baseProofSha256 === sha(JSON.stringify(proof)) &&
      expansion.baseProofSha256 === expansionPin.baseProofSha256 &&
      sha(JSON.stringify(expansion)) === expansionPin.proofSha256 &&
      expansion.credentialSha256 === proof.credentialSha256 &&
      expansion.expiresAt === proof.expiresAt &&
      Date.parse(expansion.checkedAt) >= Date.parse(proof.checkedAt)
    );
  }
  const cached = new Map<
    string,
    { checked: number; snapshot: JudgeAgentFundingSnapshot }
  >();
  function configuration(
    env: NodeJS.ProcessEnv = process.env,
    now = Date.now(),
  ): JudgeAgentConfiguration | null {
    if (env.BRIEFSTAMP_JUDGE_AGENT_ENABLED !== "true") return null;
    const key = credential.safeParse(env.SERPAPI_API_KEY),
      raw = env.BRIEFSTAMP_JUDGE_AGENT_PROOF_JSON;
    if (!key.success || !raw || raw.length > 16384) return null;
    try {
      const proof = JudgeAgentProofSchema.parse(JSON.parse(raw));
      const keyHash = sha(key.data);
      if (
        !validProof(proof, now) ||
        proof.credentialSha256 !== keyHash ||
        proof.priorStandaloneSerpProofSha256 !== pins.standaloneSerp
      )
        return null;
      for (const name of Object.keys(priorNames) as Array<
        keyof typeof priorNames
      >) {
        const old = env[priorNames[name]];
        if (
          !old ||
          old.length > 16384 ||
          sha(old) !== pins[name] ||
          proof.priorSpentProofsSha256[name] !== pins[name]
        )
          return null;
        const spent = z
          .object({
            usedRuns: z.literal(1),
            credentialSha256: z.literal(keyHash),
          })
          .safeParse(JSON.parse(old));
        if (!spent.success) return null;
      }
      const oldSearch = env.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON;
      if (
        !oldSearch ||
        oldSearch.length > 16384 ||
        sha(oldSearch) !== pins.standaloneSerp ||
        !z
          .object({
            credentialSha256: z.literal(keyHash),
            usedCalls: z.literal(1),
            usedUnits: z.literal(1),
          })
          .safeParse(JSON.parse(oldSearch)).success
      )
        return null;
      const expansionRaw = env.BRIEFSTAMP_JUDGE_AGENT_EXPANSION_PROOF_JSON;
      let expansion: JudgeAgentExpansionProof | undefined;
      if (expansionRaw !== undefined) {
        if (!expansionRaw || expansionRaw.length > 16384) return null;
        expansion = JudgeAgentExpansionProofSchema.parse(
          JSON.parse(expansionRaw),
        );
        if (!validExpansion(expansion, proof, now)) return null;
      }
      const grant = JudgeAgentGrantSchema.parse({
        grantId: proof.grantId,
        proofSha256: sha(JSON.stringify(proof)),
        maxRuns: expansion ? 100 : 12,
        expiresAt: proof.expiresAt,
        ...(expansion
          ? {
              expansion: {
                expansionId: expansion.expansionId,
                proofSha256: sha(JSON.stringify(expansion)),
                baseProofSha256: expansion.baseProofSha256,
                maxRuns: 100,
              },
            }
          : {}),
      });
      return {
        proof,
        ...(expansion ? { expansion } : {}),
        key: key.data,
        grant,
      };
    } catch {
      return null;
    }
  }
  function assertConfig(config: JudgeAgentConfiguration, now: number) {
    const proof = JudgeAgentProofSchema.safeParse(config.proof),
      grant = JudgeAgentGrantSchema.safeParse(config.grant);
    if (
      !proof.success ||
      !grant.success ||
      !validProof(proof.data, now) ||
      !credential.safeParse(config.key).success ||
      proof.data.credentialSha256 !== sha(config.key) ||
      config.grant.grantId !== proof.data.grantId ||
      config.grant.proofSha256 !== sha(JSON.stringify(proof.data)) ||
      config.grant.expiresAt !== proof.data.expiresAt ||
      config.proof.priorStandaloneSerpProofSha256 !== pins.standaloneSerp ||
      Object.keys(priorNames).some(
        (name) =>
          config.proof.priorSpentProofsSha256[
            name as keyof typeof priorNames
          ] !== pins[name as keyof typeof priorNames],
      )
    )
      denied("invalid_judge_grant");
    if (config.grant.maxRuns === 100) {
      const expansion = JudgeAgentExpansionProofSchema.safeParse(
        config.expansion,
      );
      if (
        !expansion.success ||
        !validExpansion(expansion.data, config.proof, now) ||
        config.grant.expansion.expansionId !== expansion.data.expansionId ||
        config.grant.expansion.proofSha256 !==
          sha(JSON.stringify(expansion.data)) ||
        config.grant.expansion.baseProofSha256 !== config.grant.proofSha256
      )
        denied("invalid_judge_grant");
    } else if (config.expansion !== undefined) denied("invalid_judge_grant");
  }
  async function funding(
    config: JudgeAgentConfiguration,
    opts: JudgeFundingOptions = {},
  ): Promise<JudgeAgentFundingSnapshot> {
    const clock = opts.now ?? Date.now,
      current = clock();
    assertConfig(config, current);
    const minimum = opts.minimumSearches ?? 1;
    if (
      !Number.isInteger(minimum) ||
      minimum < 1 ||
      minimum > config.grant.maxRuns
    )
      denied("invalid_funding_minimum");
    const identity = `${config.proof.credentialSha256}:${config.grant.grantId}:${config.grant.proofSha256}:${config.grant.maxRuns === 100 ? config.grant.expansion.proofSha256 : "base"}`;
    const previous = cached.get(identity);
    if (
      !opts.forceFresh &&
      previous &&
      current >= previous.checked &&
      current - previous.checked < 60_000 &&
      previous.snapshot.remainingSearches >= minimum
    )
      return { ...previous.snapshot };
    cached.delete(identity);
    const signal = opts.signal
      ? AbortSignal.any([opts.signal, AbortSignal.timeout(10_000)])
      : AbortSignal.timeout(10_000);
    const bounded = async <T>(operation: () => Promise<T>): Promise<T> => {
      signal.throwIfAborted();
      let abort = () => {};
      const stopped = new Promise<never>((_resolve, reject) => {
        abort = () => reject(new Error("Funding deadline"));
        signal.addEventListener("abort", abort, { once: true });
      });
      try {
        return await Promise.race([operation(), stopped]);
      } finally {
        signal.removeEventListener("abort", abort);
      }
    };
    try {
      signal.throwIfAborted();
      const url = new URL("https://serpapi.com/account");
      url.searchParams.set("api_key", config.key);
      const response = await bounded(() =>
        (opts.fetcher ?? fetch)(url, {
          method: "GET",
          redirect: "error",
          headers: { accept: "application/json" },
          signal,
        }),
      );
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        denied("free_funding_unavailable");
      }
      const account = accountSchema.parse(
        await bounded(() => providerJson(response)),
      );
      signal.throwIfAborted();
      assertConfig(config, clock());
      if (
        account.total_searches_left < minimum ||
        account.plan_searches_left < minimum
      )
        denied("free_funding_insufficient");
      const snapshot: JudgeAgentFundingSnapshot = {
        provider: "SerpApi",
        checkedAt: new Date(clock()).toISOString(),
        plan: "Free Plan",
        remainingSearches: account.total_searches_left,
        modelRequests: 0,
        searchRequests: 0,
      };
      if (cached.size >= 16) cached.clear();
      cached.set(identity, { checked: clock(), snapshot });
      return { ...snapshot };
    } catch (error) {
      if (
        error instanceof ProviderError &&
        error.code === "free_funding_insufficient"
      )
        throw error;
      denied("free_funding_unavailable");
    }
  }
  async function searchOptions(
    config: JudgeAgentConfiguration,
    runId: string,
    opts: JudgeFundingOptions = {},
  ): Promise<ProviderOptions> {
    const now = (opts.now ?? Date.now)();
    assertConfig(config, now);
    z.string().uuid().parse(runId);
    const env = opts.env ?? process.env;
    const current = configuration(env, now);
    if (
      !current ||
      JSON.stringify(current.grant) !== JSON.stringify(config.grant) ||
      current.key !== config.key
    )
      denied("invalid_judge_grant");
    const directory = path.resolve(
      env.FLOWPROOF_DATA_DIR || "data",
      "provider-allowances",
    );
    const filename = path.join(
      directory,
      `judge-agent-serpapi-${runId.toLowerCase()}.json`,
    );
    await mkdir(directory, { recursive: true, mode: 0o700 });
    let existing: z.infer<typeof searchAllowance> | undefined;
    try {
      const file = await open(
        filename,
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size > 32768) denied("invalid_judge_ledger");
        existing = ledgerSchema.parse(JSON.parse(await file.readFile("utf8")))
          .providers.serpapi;
      } finally {
        await file.close();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        denied("invalid_judge_ledger");
    }
    const evidence = `Judge grant ${config.grant.grantId}; run ${runId.toLowerCase()}; immutable proof ${config.grant.proofSha256}.`;
    if (existing) {
      if (
        existing.credentialSha256 !== config.proof.credentialSha256 ||
        existing.evidence !== evidence
      )
        denied("invalid_judge_ledger");
      if (existing.usedCalls !== 0 || existing.usedUnits !== 0)
        denied("budget_exhausted");
      if (
        Date.parse(existing.checkedAt) > now ||
        now - Date.parse(existing.checkedAt) > DAY ||
        Date.parse(existing.expiresAt) <= now ||
        Date.parse(existing.expiresAt) > Date.parse(config.grant.expiresAt) ||
        Date.parse(existing.expiresAt) - Date.parse(existing.checkedAt) > DAY
      )
        denied("invalid_judge_ledger");
    } else {
      const confirmed = await funding(config, opts);
      opts.signal?.throwIfAborted();
      assertConfig(config, (opts.now ?? Date.now)());
      const checked = Date.parse(confirmed.checkedAt);
      const allowance = searchAllowance.parse({
        credentialSha256: config.proof.credentialSha256,
        checkedAt: confirmed.checkedAt,
        expiresAt: new Date(
          Math.min(Date.parse(config.grant.expiresAt), checked + DAY),
        ).toISOString(),
        evidence,
        freeOnly: true,
        paidOverageDisabled: true,
        confirmedFreeUnits: 1,
        unit: "requests",
        operations: ["search-visibility"],
        maxUnits: 1,
        usedUnits: 0,
        maxCalls: 1,
        usedCalls: 0,
      });
      try {
        await writeFile(
          filename,
          `${JSON.stringify({ version: 1, providers: { serpapi: allowance } }, null, 2)}\n`,
          { mode: 0o600, flag: "wx" },
        );
      } catch {
        denied("allowance_unavailable");
      }
    }
    opts.signal?.throwIfAborted();
    return {
      fetcher: opts.fetcher,
      now: opts.now,
      env: {
        BRIEFSTAMP_SERPAPI_ENABLED: "true",
        SERPAPI_API_KEY: config.key,
        BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: filename,
        BRIEFSTAMP_SEARCH_DOMAINS: new URL(HOSTED_WEBSITE_URL).hostname,
      },
    };
  }
  return {
    configuration,
    enabled: (env: NodeJS.ProcessEnv = process.env, now = Date.now()) =>
      configuration(env, now) !== null,
    funding,
    searchOptions,
  };
}
const gate = createJudgeAgentGate();
export const judgeAgentConfiguration = gate.configuration;
export const judgeAgentEnabled = gate.enabled;
export const verifyJudgeAgentFunding = gate.funding;
/** Caller must first commit the matching run reservation in Tiger. No operator gate is changed. */
export const judgeSearchOptions = gate.searchOptions;
