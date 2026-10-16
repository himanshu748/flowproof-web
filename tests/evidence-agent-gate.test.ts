import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HOSTED_WEBSITE_URL } from "../shared/hosted-target.js";
import type { Project } from "../shared/types.js";
import {
  agentSearchOptions,
  authorizeEvidenceAgent,
  evidenceAgentConfiguration,
  evidenceAgentEnabled,
  EVIDENCE_AGENT_FAILED_RECEIPT_SHA256,
  EVIDENCE_AGENT_FAILED_REPAIR_RECEIPT_SHA256,
  EVIDENCE_AGENT_PARTIAL_RESILIENT_RECEIPT_SHA256,
  EVIDENCE_AGENT_PRIOR_SERP_RECEIPT_SHA256,
} from "../server/evidence-agent-gate.js";
import { checkSearchVisibility } from "../server/providers/serpapi.js";

const now = Date.parse("2026-10-16T10:00:00Z");
const key = "synthetic-evidence-agent-key-not-a-real-provider-key";
const token = ["synthetic", "evidence", "agent", "operator", "fixture"].join(
  "-",
);
const tranche = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const repairTranche = "11111111-2222-4333-8444-555555555555";
const resilientTranche = "66666666-7777-4888-8999-aaaaaaaaaaaa";
const searchRepairTranche = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const directories: string[] = [];
const headers = { "x-flowproof-token": token };
const project: Project = {
  id: "synthetic-test-project",
  name: "Synthetic test project",
  target: "website",
  url: HOSTED_WEBSITE_URL,
  authorized: true,
  brief: "Synthetic test brief, not client data",
  sampleVariant: "healthy",
  checks: [],
  createdAt: "",
  updatedAt: "",
  generator: { provider: "Synthetic fixture", model: null },
};

async function environment(): Promise<NodeJS.ProcessEnv> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "briefstamp-evidence-agent-"),
  );
  directories.push(directory);
  const historical = JSON.stringify({
    credentialSha256: digest(key),
    checkedAt: "2026-10-15T08:00:00Z",
    expiresAt: "2026-10-16T08:00:00Z",
    evidence: "Synthetic fixture for a consumed historical reservation",
    freeOnly: true,
    paidOverageDisabled: true,
    confirmedFreeUnits: 100,
    unit: "requests",
    operations: ["search-visibility"],
    maxUnits: 1,
    usedUnits: 1,
    maxCalls: 1,
    usedCalls: 1,
  });
  return {
    FLOWPROOF_DATA_DIR: directory,
    FLOWPROOF_TOKEN: token,
    SERPAPI_API_KEY: key,
    BRIEFSTAMP_EVIDENCE_AGENT_ENABLED: "true",
    BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON: historical,
    BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON: JSON.stringify({
      trancheId: tranche,
      credentialSha256: digest(key),
      checkedAt: "2026-10-16T09:00:00Z",
      expiresAt: "2026-10-17T09:00:00Z",
      confirmedFreeSearches: 100,
      freeOnly: true,
      paidOverageDisabled: true,
      priorSerpReceiptSha256: EVIDENCE_AGENT_PRIOR_SERP_RECEIPT_SHA256,
      priorSerpProofSha256: digest(historical),
      priorSerpCalls: 1,
      priorSerpUnits: 1,
      maxModelCalls: 2,
      maxSearchCalls: 1,
      usedRuns: 0,
      evidence: "Synthetic fixture only, not real account or funding evidence",
    }),
  };
}

function amend(env: NodeJS.ProcessEnv, change: Record<string, unknown>) {
  env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON = JSON.stringify({
    ...JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!),
    ...change,
  });
}

function amendHistory(env: NodeJS.ProcessEnv, change: Record<string, unknown>) {
  env.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON = JSON.stringify({
    ...JSON.parse(env.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON!),
    ...change,
  });
  amend(env, {
    priorSerpProofSha256: digest(env.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON),
  });
}

function installRepair(env: NodeJS.ProcessEnv) {
  amend(env, { usedRuns: 1 });
  env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON = JSON.stringify({
    ...JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!),
    trancheId: repairTranche,
    checkedAt: "2026-10-16T09:30:00Z",
    expiresAt: "2026-10-17T09:30:00Z",
    usedRuns: 0,
    previousAgentProofSha256: digest(env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!),
    previousAgentReceiptSha256: EVIDENCE_AGENT_FAILED_RECEIPT_SHA256,
    evidence:
      "Synthetic separately approved repair fixture; not live funding evidence",
  });
}

function amendRepair(env: NodeJS.ProcessEnv, change: Record<string, unknown>) {
  env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON = JSON.stringify({
    ...JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON!),
    ...change,
  });
}

function installResilient(env: NodeJS.ProcessEnv) {
  installRepair(env);
  amendRepair(env, { usedRuns: 1 });
  env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON = JSON.stringify({
    ...JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON!),
    trancheId: resilientTranche,
    checkedAt: "2026-10-16T09:45:00Z",
    expiresAt: "2026-10-17T09:45:00Z",
    maxModelCalls: 6,
    usedRuns: 0,
    previousRepairProofSha256: digest(
      env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON!,
    ),
    previousRepairReceiptSha256: EVIDENCE_AGENT_FAILED_REPAIR_RECEIPT_SHA256,
    cumulativeAgentReservedModelCalls: 10,
    evidence:
      "Synthetic separately approved resilient fixture; not live funding evidence",
  });
}

function amendResilient(
  env: NodeJS.ProcessEnv,
  change: Record<string, unknown>,
) {
  env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON = JSON.stringify({
    ...JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON!),
    ...change,
  });
}

function installSearchRepair(env: NodeJS.ProcessEnv) {
  installResilient(env);
  amendResilient(env, { usedRuns: 1 });
  env.BRIEFSTAMP_EVIDENCE_AGENT_SEARCH_REPAIR_PROOF_JSON = JSON.stringify({
    ...JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON!),
    trancheId: searchRepairTranche,
    checkedAt: "2026-10-16T09:50:00Z",
    expiresAt: "2026-10-17T09:50:00Z",
    maxModelCalls: 2,
    usedRuns: 0,
    previousResilientProofSha256: digest(
      env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON!,
    ),
    previousResilientReceiptSha256:
      EVIDENCE_AGENT_PARTIAL_RESILIENT_RECEIPT_SHA256,
    cumulativeAgentReservedModelCalls: 12,
    evidence:
      "Synthetic separately approved search follow-up; not live funding evidence",
  });
}

function amendSearchRepair(
  env: NodeJS.ProcessEnv,
  change: Record<string, unknown>,
) {
  env.BRIEFSTAMP_EVIDENCE_AGENT_SEARCH_REPAIR_PROOF_JSON = JSON.stringify({
    ...JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_SEARCH_REPAIR_PROOF_JSON!),
    ...change,
  });
}

const filename = (env: NodeJS.ProcessEnv) =>
  path.join(
    env.FLOWPROOF_DATA_DIR!,
    "provider-allowances",
    `evidence-agent-serpapi-${tranche}.json`,
  );
const response = () =>
  Response.json({
    search_metadata: { status: "Success" },
    organic_results: [],
  });
const search = async (
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
  supplied: IncomingHttpHeaders | Headers = headers,
) =>
  checkSearchVisibility(
    project,
    await agentSearchOptions(supplied, { env, fetcher, now: () => now }),
  );

afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("evidence-agent operator and confirmed-free proof gate", () => {
  it("binds the known committed historical receipt", async () => {
    expect(
      digest(
        await readFile(
          "docs/evidence/hosted-optional/2026-10-16T09-13-12Z/receipt.json",
          "utf8",
        ),
      ),
    ).toBe(EVIDENCE_AGENT_PRIOR_SERP_RECEIPT_SHA256);
  });

  it("checks availability without files or transport and omits the operator token", async () => {
    const env = await environment();
    const original = { ...env };
    expect(evidenceAgentEnabled(env, now)).toBe(true);
    expect(Object.keys(evidenceAgentConfiguration(env, now)!)).toEqual([
      "proof",
      "key",
      "searchTimeoutMs",
    ]);
    expect(evidenceAgentConfiguration(env, now)?.proof).toMatchObject({
      trancheId: tranche,
      usedRuns: 0,
      maxModelCalls: 2,
      maxSearchCalls: 1,
    });
    expect(env).toEqual(original);
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
  });

  it("accepts only the exact existing operator token in a header", async () => {
    const env = await environment();
    for (const value of [headers, new Headers({ "X-FlowProof-Token": token })])
      expect(authorizeEvidenceAgent(value, env, now)).toBe(true);
    const fetcher = vi.fn<typeof fetch>();
    for (const supplied of [
      {},
      { "x-flowproof-token": token + "wrong" },
      { "x-flowproof-token": [token, token] },
      { "x-flowproof-token": "short" },
      { "x-flowproof-token": token + "\n" },
      { authorization: `Bearer ${token}` },
      { token },
    ]) {
      expect(authorizeEvidenceAgent(supplied, env, now)).toBe(false);
      await expect(search(env, fetcher, supplied)).rejects.toMatchObject({
        code: "unauthorized",
      });
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
  });

  it.each([
    { trancheId: "not-a-uuid" },
    { trancheId: "../../replacement" },
    { credentialSha256: "0".repeat(64) },
    { checkedAt: "2026-10-14T09:00:00Z" },
    { checkedAt: "2026-10-16T10:00:01Z" },
    { expiresAt: "2026-10-16T10:00:00Z" },
    { expiresAt: "2026-10-16T08:00:00Z" },
    { expiresAt: "2026-10-18T09:00:00Z" },
    { confirmedFreeSearches: 0 },
    { confirmedFreeSearches: 1.5 },
    { freeOnly: false },
    { paidOverageDisabled: false },
    { priorSerpReceiptSha256: "0".repeat(64) },
    { priorSerpProofSha256: "0".repeat(64) },
    { priorSerpCalls: 0 },
    { priorSerpUnits: 0 },
    { maxModelCalls: 3 },
    { maxSearchCalls: 2 },
    { usedRuns: 1 },
    { usedRuns: 2 },
    { evidence: "" },
    { unexpected: true },
  ])("fails closed for unsafe agent proof %j", async (change) => {
    const env = await environment();
    amend(env, change);
    const fetcher = vi.fn<typeof fetch>();
    expect(evidenceAgentConfiguration(env, now)).toBeNull();
    expect(evidenceAgentEnabled(env, now)).toBe(false);
    expect(authorizeEvidenceAgent(headers, env, now)).toBe(false);
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "unauthorized",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
  });

  it("does not infer free funding from a key, flag, malformed JSON or partial configuration", async () => {
    const env = await environment();
    for (const change of [
      { BRIEFSTAMP_EVIDENCE_AGENT_ENABLED: "false" },
      { BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON: undefined },
      { BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON: "{}" },
      { BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON: "invalid-json" },
      { BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON: "x".repeat(16_385) },
      { BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON: undefined },
      { BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON: "invalid-json" },
      { BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON: "x".repeat(16_385) },
      { SERPAPI_API_KEY: ["different", "synthetic", "fixture"].join("-") },
      { SERPAPI_API_KEY: "invalid key with spaces" },
      { FLOWPROOF_TOKEN: undefined },
      { FLOWPROOF_TOKEN: "short" },
    ])
      expect(evidenceAgentEnabled({ ...env, ...change }, now)).toBe(false);
    expect(evidenceAgentEnabled(env, Number.NaN)).toBe(false);
    expect(evidenceAgentEnabled(env, Number.POSITIVE_INFINITY)).toBe(false);
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
  });

  it("enforces the absolute October 20 UTC ceiling as well as a fresh 24-hour window", async () => {
    const env = await environment();
    const late = Date.parse("2026-10-19T12:00:00Z");
    amend(env, {
      checkedAt: "2026-10-19T11:00:00Z",
      expiresAt: "2026-10-20T00:00:00Z",
    });
    expect(evidenceAgentEnabled(env, late)).toBe(true);
    amend(env, { expiresAt: "2026-10-20T00:00:01Z" });
    expect(evidenceAgentEnabled(env, late)).toBe(false);
    amend(env, { expiresAt: "2026-10-20T00:00:00Z" });
    expect(evidenceAgentEnabled(env, Date.parse("2026-10-20T00:00:00Z"))).toBe(
      false,
    );
  });

  it.each([
    { usedCalls: 0 },
    { usedUnits: 0 },
    { maxCalls: 2 },
    { maxUnits: 2 },
    { usedCalls: 2 },
    { credentialSha256: "0".repeat(64) },
    { freeOnly: false },
    { paidOverageDisabled: false },
    { operations: ["memory-write"] },
    { unexpected: true },
  ])(
    "rejects historical resets or mismatches even with a rebound hash %j",
    async (change) => {
      const env = await environment();
      amendHistory(env, change);
      expect(evidenceAgentEnabled(env, now)).toBe(false);
      expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
    },
  );

  it("requires the exact historical proof bytes, while allowing that spent proof to be expired", async () => {
    const env = await environment();
    expect(evidenceAgentEnabled(env, now)).toBe(true);
    const prior = JSON.parse(env.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON!);
    expect(Date.parse(prior.expiresAt)).toBeLessThan(now);
    env.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON = JSON.stringify(prior, null, 2);
    expect(evidenceAgentEnabled(env, now)).toBe(false);
  });
});

describe("evidence-agent immutable separate search allowance", () => {
  it("uses the shared provider guard for one search and retains historical proof byte for byte", async () => {
    const env = await environment();
    const original = { ...env };
    const options = await agentSearchOptions(headers, { env, now: () => now });
    expect(options.env?.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE).toBe(filename(env));
    expect(options.env?.BRIEFSTAMP_SEARCH_DOMAINS).toBe(
      new URL(HOSTED_WEBSITE_URL).hostname,
    );
    expect(options.env?.FLOWPROOF_TOKEN).toBeUndefined();
    expect(options.env?.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON).toBeUndefined();
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const reserved = JSON.parse(await readFile(filename(env), "utf8"))
        .providers.serpapi;
      expect(reserved).toMatchObject({
        maxCalls: 1,
        usedCalls: 1,
        maxUnits: 1,
        usedUnits: 1,
      });
      expect(init?.redirect).toBe("error");
      return response();
    });
    expect(await search(env, fetcher)).toMatchObject({
      status: "observed",
      results: [],
    });
    const spent = await readFile(filename(env), "utf8");
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await readFile(filename(env), "utf8")).toBe(spent);
    expect(env).toEqual(original);
  });

  it("does not gain another ledger from reordered proof fields or uppercase spelling of the same UUID", async () => {
    const env = await environment();
    const fetcher = vi.fn<typeof fetch>(async () => response());
    await search(env, fetcher);
    const spent = await readFile(filename(env), "utf8");
    const proof = JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!);
    proof.trancheId = tranche.toUpperCase();
    env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON = JSON.stringify(
      Object.fromEntries(Object.entries(proof).reverse()),
    );
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await readFile(filename(env), "utf8")).toBe(spent);
    expect(await readdir(path.dirname(filename(env)))).toEqual([
      path.basename(filename(env)),
    ]);
  });

  it.each([
    { checkedAt: "2026-10-16T09:30:00Z", expiresAt: "2026-10-17T09:30:00Z" },
    { confirmedFreeSearches: 200 },
    { evidence: "A newer synthetic proof does not replenish this tranche" },
  ])(
    "never treats refreshed proof fields as a new identity %j",
    async (change) => {
      const env = await environment();
      const fetcher = vi.fn<typeof fetch>(async () => response());
      await search(env, fetcher);
      const spent = await readFile(filename(env), "utf8");
      amend(env, change);
      expect(evidenceAgentEnabled(env, now)).toBe(true);
      await expect(search(env, fetcher)).rejects.toMatchObject({
        code: "free_confirmation_required",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await readFile(filename(env), "utf8")).toBe(spent);
      expect(await readdir(path.dirname(filename(env)))).toEqual([
        path.basename(filename(env)),
      ]);
    },
  );

  it.each(["transport", "http", "invalid-response"])(
    "never retries or refunds a %s failure",
    async (failure) => {
      const env = await environment();
      const original = env.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON;
      const fetcher = vi.fn<typeof fetch>(async () => {
        if (failure === "transport")
          throw new Error("Synthetic network failure");
        if (failure === "http") return new Response(null, { status: 503 });
        return Response.json({ search_metadata: { status: "Processing" } });
      });
      await expect(search(env, fetcher)).rejects.toBeInstanceOf(Error);
      const spent = await readFile(filename(env), "utf8");
      expect(JSON.parse(spent).providers.serpapi).toMatchObject({
        usedCalls: 1,
        usedUnits: 1,
      });
      await expect(search(env, fetcher)).rejects.toMatchObject({
        code: "budget_exhausted",
      });
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(await readFile(filename(env), "utf8")).toBe(spent);
      expect(env.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON).toBe(original);
    },
  );

  it.each([
    "corrupt",
    "widened",
    "mismatched-proof",
    "mismatched-key",
    "excess-counter",
    "other-provider",
  ])("does not repair or overwrite an existing %s ledger", async (kind) => {
    const env = await environment();
    await agentSearchOptions(headers, { env, now: () => now });
    const raw = JSON.parse(await readFile(filename(env), "utf8"));
    if (kind === "widened") raw.providers.serpapi.maxCalls = 2;
    if (kind === "mismatched-proof")
      raw.providers.serpapi.evidence = "An unrelated synthetic immutable proof";
    if (kind === "mismatched-key")
      raw.providers.serpapi.credentialSha256 = "0".repeat(64);
    if (kind === "excess-counter") raw.providers.serpapi.usedCalls = 2;
    if (kind === "other-provider")
      raw.providers.backboard = raw.providers.serpapi;
    const modified =
      kind === "corrupt" ? "corrupt-ledger" : JSON.stringify(raw);
    await writeFile(filename(env), modified);
    const fetcher = vi.fn<typeof fetch>();
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "free_confirmation_required",
    });
    expect(await readFile(filename(env), "utf8")).toBe(modified);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a symlink ledger without changing its target", async () => {
    const env = await environment();
    await agentSearchOptions(headers, { env, now: () => now });
    const original = await readFile(filename(env), "utf8");
    const target = path.join(env.FLOWPROOF_DATA_DIR!, "synthetic-target.json");
    await writeFile(target, original);
    await unlink(filename(env));
    await symlink(target, filename(env));
    const fetcher = vi.fn<typeof fetch>();
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "free_confirmation_required",
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readFile(target, "utf8")).toBe(original);
  });

  it("allows at most one transport across concurrent requests", async () => {
    const env = await environment();
    await agentSearchOptions(headers, { env, now: () => now });
    const fetcher = vi.fn<typeof fetch>(async () => response());
    const outcomes = await Promise.allSettled([
      search(env, fetcher),
      search(env, fetcher),
    ]);
    expect(
      outcomes.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(await readFile(filename(env), "utf8")).providers.serpapi,
    ).toMatchObject({ usedCalls: 1, usedUnits: 1 });
  });

  it("uses only the fixed public domain even if unrelated environment controls are supplied", async () => {
    const env = {
      ...(await environment()),
      BRIEFSTAMP_SEARCH_DOMAINS: "example.org",
      BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: "/tmp/unrelated.json",
    };
    const fetcher = vi.fn<typeof fetch>();
    const options = await agentSearchOptions(headers, {
      env,
      fetcher,
      now: () => now,
    });
    await expect(
      checkSearchVisibility(
        { ...project, url: "https://example.org/" },
        options,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(
      JSON.parse(await readFile(filename(env), "utf8")).providers.serpapi
        .usedCalls,
    ).toBe(0);
  });
});

describe("separately approved evidence-agent repair allowance", () => {
  it("leaves the primary spent and selects only a separately bound repair proof", async () => {
    const env = await environment();
    amend(env, { usedRuns: 1 });
    expect(evidenceAgentEnabled(env, now)).toBe(false);
    installRepair(env);
    const unchanged = { ...env };
    expect(evidenceAgentConfiguration(env, now)?.proof).toMatchObject({
      trancheId: repairTranche,
      usedRuns: 0,
      maxModelCalls: 2,
      maxSearchCalls: 1,
      previousAgentProofSha256: digest(
        env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!,
      ),
      previousAgentReceiptSha256: EVIDENCE_AGENT_FAILED_RECEIPT_SHA256,
    });
    expect(authorizeEvidenceAgent(headers, env, now)).toBe(true);
    expect(env).toEqual(unchanged);
    expect(JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!).usedRuns).toBe(
      1,
    );
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
  });

  it.each([
    { trancheId: tranche },
    { trancheId: tranche.toUpperCase() },
    { previousAgentProofSha256: "0".repeat(64) },
    { previousAgentReceiptSha256: "0".repeat(64) },
    { previousAgentReceiptSha256: EVIDENCE_AGENT_PRIOR_SERP_RECEIPT_SHA256 },
    { credentialSha256: "0".repeat(64) },
    { priorSerpProofSha256: "0".repeat(64) },
    { priorSerpCalls: 0 },
    { maxModelCalls: 3 },
    { maxSearchCalls: 2 },
    { usedRuns: 1 },
    { freeOnly: false },
    { paidOverageDisabled: false },
    { confirmedFreeSearches: 0 },
    { checkedAt: "2026-10-16T08:59:59Z" },
    { checkedAt: "2026-10-16T10:00:01Z" },
    { expiresAt: "2026-10-16T10:00:00Z" },
    { expiresAt: "2026-10-18T09:30:00Z" },
    { unexpected: true },
  ])(
    "rejects an unsafe repair proof %j without fallback or provider calls",
    async (change) => {
      const env = await environment();
      installRepair(env);
      amendRepair(env, change);
      const fetcher = vi.fn<typeof fetch>();
      expect(evidenceAgentConfiguration(env, now)).toBeNull();
      await expect(search(env, fetcher)).rejects.toMatchObject({
        code: "unauthorized",
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
    },
  );

  it("never falls back to an unused primary when a repair is configured", async () => {
    const env = await environment();
    const unused = env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!;
    installRepair(env);
    env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON = unused;
    amendRepair(env, { previousAgentProofSha256: digest(unused) });
    expect(evidenceAgentEnabled(env, now)).toBe(false);
    for (const raw of ["", "{}", "invalid-json", "x".repeat(16_385)]) {
      env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON = raw;
      expect(evidenceAgentEnabled(env, now)).toBe(false);
    }
    delete env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON;
    expect(evidenceAgentEnabled(env, now)).toBe(true);
  });

  it("binds the exact spent primary bytes, not just parsed fields", async () => {
    const env = await environment();
    installRepair(env);
    const primary = JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!);
    env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON = JSON.stringify(primary, null, 2);
    expect(evidenceAgentEnabled(env, now)).toBe(false);
    amendRepair(env, {
      previousAgentProofSha256: digest(
        env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON,
      ),
    });
    expect(evidenceAgentEnabled(env, now)).toBe(true);
  });

  it.each([
    { usedRuns: 0 },
    { credentialSha256: "0".repeat(64) },
    { priorSerpProofSha256: "0".repeat(64) },
    { maxModelCalls: 3 },
    { maxSearchCalls: 2 },
    { checkedAt: "2026-10-16T10:00:01Z" },
    { expiresAt: "2026-10-18T09:00:00Z" },
    { unexpected: true },
  ])(
    "rejects invalid or reset primary context even with a rebound hash %j",
    async (change) => {
      const env = await environment();
      installRepair(env);
      amend(env, change);
      amendRepair(env, {
        previousAgentProofSha256: digest(
          env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!,
        ),
      });
      expect(evidenceAgentEnabled(env, now)).toBe(false);
    },
  );

  it("allows expired spent context but requires a fresh repair within the absolute cutoff", async () => {
    const env = await environment();
    installRepair(env);
    const later = Date.parse("2026-10-19T12:00:00Z");
    amendRepair(env, {
      checkedAt: "2026-10-19T11:00:00Z",
      expiresAt: "2026-10-20T00:00:00Z",
    });
    expect(
      Date.parse(
        JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!).expiresAt,
      ),
    ).toBeLessThan(later);
    expect(evidenceAgentEnabled(env, later)).toBe(true);
    expect(evidenceAgentEnabled(env, Date.parse("2026-10-20T00:00:00Z"))).toBe(
      false,
    );
    amendRepair(env, { expiresAt: "2026-10-20T00:00:01Z" });
    expect(evidenceAgentEnabled(env, later)).toBe(false);
  });

  it("creates one separate UUID ledger and preserves both spent historical allowances", async () => {
    const env = await environment();
    const fetcher = vi.fn<typeof fetch>(async () => response());
    await search(env, fetcher);
    const oldLedger = await readFile(filename(env), "utf8");
    installRepair(env);
    const unchanged = { ...env };
    const repairFile = filename(env).replace(tranche, repairTranche);
    const options = await agentSearchOptions(headers, { env, now: () => now });
    expect(options.env?.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE).toBe(repairFile);
    await search(env, fetcher);
    const repairSpent = await readFile(repairFile, "utf8");
    expect(JSON.parse(repairSpent).providers.serpapi).toMatchObject({
      usedCalls: 1,
      usedUnits: 1,
    });
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await readFile(filename(env), "utf8")).toBe(oldLedger);
    expect(await readFile(repairFile, "utf8")).toBe(repairSpent);
    expect(env).toEqual(unchanged);
    expect((await readdir(path.dirname(repairFile))).sort()).toEqual(
      [path.basename(filename(env)), path.basename(repairFile)].sort(),
    );
  });

  it("does not treat a refreshed repair proof or rebound primary hash as a new ledger", async () => {
    const env = await environment();
    installRepair(env);
    const fetcher = vi.fn<typeof fetch>(async () => response());
    await search(env, fetcher);
    const repairFile = filename(env).replace(tranche, repairTranche);
    const spent = await readFile(repairFile, "utf8");
    const oldRepair = env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON;
    amendRepair(env, {
      checkedAt: "2026-10-16T09:45:00Z",
      expiresAt: "2026-10-17T09:45:00Z",
    });
    expect(evidenceAgentEnabled(env, now)).toBe(true);
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "free_confirmation_required",
    });
    env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON = oldRepair;
    env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON = JSON.stringify(
      JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!),
      null,
      2,
    );
    amendRepair(env, {
      previousAgentProofSha256: digest(
        env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON,
      ),
    });
    expect(evidenceAgentEnabled(env, now)).toBe(true);
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "free_confirmation_required",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await readFile(repairFile, "utf8")).toBe(spent);
    expect(await readdir(path.dirname(repairFile))).toEqual([
      path.basename(repairFile),
    ]);
  });
});

describe("separately bounded resilient evidence-agent allowance", () => {
  it("selects the six-call tranche while retaining both earlier reservations as spent", async () => {
    const env = await environment();
    installResilient(env);
    const unchanged = { ...env };
    const config = evidenceAgentConfiguration(env, now);
    expect(config?.proof).toMatchObject({
      trancheId: resilientTranche,
      maxModelCalls: 6,
      maxSearchCalls: 1,
      cumulativeAgentReservedModelCalls: 10,
      usedRuns: 0,
      previousAgentProofSha256: digest(
        env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!,
      ),
      previousAgentReceiptSha256: EVIDENCE_AGENT_FAILED_RECEIPT_SHA256,
      previousRepairProofSha256: digest(
        env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON!,
      ),
      previousRepairReceiptSha256: EVIDENCE_AGENT_FAILED_REPAIR_RECEIPT_SHA256,
    });
    expect(authorizeEvidenceAgent(headers, env, now)).toBe(true);
    expect(JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!).usedRuns).toBe(
      1,
    );
    expect(
      JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON!).usedRuns,
    ).toBe(1);
    expect(env).toEqual(unchanged);
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
  });

  it.each([
    { maxModelCalls: 2 },
    { maxModelCalls: 7 },
    { maxSearchCalls: 2 },
    { cumulativeAgentReservedModelCalls: 6 },
    { cumulativeAgentReservedModelCalls: 12 },
    { trancheId: tranche },
    { trancheId: repairTranche },
    { trancheId: tranche.toUpperCase() },
    { previousAgentProofSha256: "0".repeat(64) },
    { previousAgentReceiptSha256: EVIDENCE_AGENT_FAILED_REPAIR_RECEIPT_SHA256 },
    { previousRepairProofSha256: "0".repeat(64) },
    { previousRepairReceiptSha256: EVIDENCE_AGENT_FAILED_RECEIPT_SHA256 },
    { credentialSha256: "0".repeat(64) },
    { priorSerpProofSha256: "0".repeat(64) },
    { priorSerpCalls: 0 },
    { usedRuns: 1 },
    { freeOnly: false },
    { paidOverageDisabled: false },
    { confirmedFreeSearches: 0 },
    { checkedAt: "2026-10-16T09:29:59Z" },
    { checkedAt: "2026-10-16T10:00:01Z" },
    { expiresAt: "2026-10-16T10:00:00Z" },
    { expiresAt: "2026-10-18T09:45:00Z" },
    { unexpected: true },
  ])(
    "rejects invalid resilient proof %j before filesystem or provider access",
    async (change) => {
      const env = await environment();
      installResilient(env);
      amendResilient(env, change);
      const fetcher = vi.fn<typeof fetch>();
      expect(evidenceAgentEnabled(env, now)).toBe(false);
      await expect(search(env, fetcher)).rejects.toMatchObject({
        code: "unauthorized",
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
    },
  );

  it("fails closed for missing, malformed or unused earlier proofs without fallback", async () => {
    const env = await environment();
    installResilient(env);
    for (const field of [
      "BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON",
      "BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON",
    ] as const) {
      const original = env[field]!;
      for (const raw of [
        undefined,
        "",
        "{}",
        "invalid-json",
        "x".repeat(16_385),
      ]) {
        env[field] = raw;
        expect(evidenceAgentEnabled(env, now)).toBe(false);
      }
      env[field] = JSON.stringify({ ...JSON.parse(original), usedRuns: 0 });
      if (field === "BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON") {
        amendRepair(env, { previousAgentProofSha256: digest(env[field]!) });
        amendResilient(env, {
          previousAgentProofSha256: digest(env[field]!),
          previousRepairProofSha256: digest(
            env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON!,
          ),
        });
      } else
        amendResilient(env, { previousRepairProofSha256: digest(env[field]!) });
      expect(evidenceAgentEnabled(env, now)).toBe(false);
      installResilient(env);
    }
    for (const raw of ["", "{}", "invalid-json", "x".repeat(16_385)]) {
      env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON = raw;
      expect(evidenceAgentEnabled(env, now)).toBe(false);
    }
    delete env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON;
    expect(evidenceAgentEnabled(env, now)).toBe(false); // Both prior tranches remain spent.
    amendRepair(env, { usedRuns: 0 });
    expect(evidenceAgentEnabled(env, now)).toBe(true); // The pre-existing repair gate is unchanged.
    env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON = "{}";
    expect(evidenceAgentEnabled(env, now)).toBe(false); // No fallback to that unused repair.
  });

  it.each([
    { credentialSha256: "0".repeat(64) },
    { previousAgentProofSha256: "0".repeat(64) },
    { previousAgentReceiptSha256: "0".repeat(64) },
    { priorSerpProofSha256: "0".repeat(64) },
    { trancheId: tranche },
    { maxModelCalls: 6 },
    { maxSearchCalls: 2 },
    { expiresAt: "2026-10-18T09:30:00Z" },
  ])(
    "revalidates spent repair context even if its outer hash is rebound %j",
    async (change) => {
      const env = await environment();
      installResilient(env);
      amendRepair(env, change);
      amendResilient(env, {
        previousRepairProofSha256: digest(
          env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON!,
        ),
      });
      expect(evidenceAgentEnabled(env, now)).toBe(false);
    },
  );

  it("binds exact prior proof bytes while allowing their expired spent windows", async () => {
    const env = await environment();
    installResilient(env);
    env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON = JSON.stringify(
      JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON!),
      null,
      2,
    );
    expect(evidenceAgentEnabled(env, now)).toBe(false);
    amendResilient(env, {
      previousRepairProofSha256: digest(
        env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON,
      ),
    });
    expect(evidenceAgentEnabled(env, now)).toBe(true);
    const later = Date.parse("2026-10-19T12:00:00Z");
    expect(evidenceAgentEnabled(env, later)).toBe(false); // The selected proof is stale.
    amendResilient(env, {
      checkedAt: "2026-10-19T11:00:00Z",
      expiresAt: "2026-10-20T00:00:00Z",
    });
    expect(evidenceAgentEnabled(env, later)).toBe(true);
    expect(evidenceAgentEnabled(env, Date.parse("2026-10-20T00:00:00Z"))).toBe(
      false,
    );
    amendResilient(env, { expiresAt: "2026-10-20T00:00:01Z" });
    expect(evidenceAgentEnabled(env, later)).toBe(false);
  });

  it("permits only one search on the new ledger and leaves both older ledgers and raw proofs unchanged", async () => {
    const env = await environment();
    const fetcher = vi.fn<typeof fetch>(async () => response());
    await search(env, fetcher);
    const primaryFile = filename(env);
    const primarySpent = await readFile(primaryFile, "utf8");
    installRepair(env);
    await search(env, fetcher);
    const repairFile = primaryFile.replace(tranche, repairTranche);
    const repairSpent = await readFile(repairFile, "utf8");
    installResilient(env);
    const unchanged = { ...env };
    const resilientFile = primaryFile.replace(tranche, resilientTranche);
    await search(env, fetcher);
    const spent = await readFile(resilientFile, "utf8");
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(await readFile(primaryFile, "utf8")).toBe(primarySpent);
    expect(await readFile(repairFile, "utf8")).toBe(repairSpent);
    expect(await readFile(resilientFile, "utf8")).toBe(spent);
    expect(env).toEqual(unchanged);
    expect((await readdir(path.dirname(resilientFile))).sort()).toEqual(
      [primaryFile, repairFile, resilientFile]
        .map((value) => path.basename(value))
        .sort(),
    );
  });

  it("does not reset the resilient ledger through refreshed timestamps or rebound earlier bytes", async () => {
    const env = await environment();
    installResilient(env);
    const fetcher = vi.fn<typeof fetch>(async () => response());
    await search(env, fetcher);
    const resilientFile = filename(env).replace(tranche, resilientTranche);
    const spent = await readFile(resilientFile, "utf8");
    const originalProof = env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON;
    amendResilient(env, {
      checkedAt: "2026-10-16T09:50:00Z",
      expiresAt: "2026-10-17T09:50:00Z",
    });
    expect(evidenceAgentEnabled(env, now)).toBe(true);
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "free_confirmation_required",
    });
    env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON = originalProof;
    env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON = JSON.stringify(
      JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON!),
      null,
      2,
    );
    amendResilient(env, {
      previousRepairProofSha256: digest(
        env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON,
      ),
    });
    expect(evidenceAgentEnabled(env, now)).toBe(true);
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "free_confirmation_required",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await readFile(resilientFile, "utf8")).toBe(spent);
    expect(await readdir(path.dirname(resilientFile))).toEqual([
      path.basename(resilientFile),
    ]);
  });
});

describe("final bounded evidence-agent search follow-up", () => {
  it("gives only the separately bound follow-up a trusted thirty-second search timeout", async () => {
    const env = await environment();
    expect(evidenceAgentConfiguration(env, now)?.searchTimeoutMs).toBe(10000);
    installRepair(env);
    expect(evidenceAgentConfiguration(env, now)?.searchTimeoutMs).toBe(10000);
    installResilient(env);
    expect(evidenceAgentConfiguration(env, now)?.searchTimeoutMs).toBe(10000);
    installSearchRepair(env);
    const unchanged = { ...env };
    expect(evidenceAgentConfiguration(env, now)).toMatchObject({
      searchTimeoutMs: 30000,
      proof: {
        trancheId: searchRepairTranche,
        usedRuns: 0,
        maxModelCalls: 2,
        maxSearchCalls: 1,
        cumulativeAgentReservedModelCalls: 12,
        previousResilientProofSha256: digest(
          env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON!,
        ),
        previousResilientReceiptSha256:
          EVIDENCE_AGENT_PARTIAL_RESILIENT_RECEIPT_SHA256,
      },
    });
    expect(authorizeEvidenceAgent(headers, env, now)).toBe(true);
    expect(env).toEqual(unchanged);
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
  });

  it.each([
    { trancheId: tranche },
    { trancheId: repairTranche },
    { trancheId: resilientTranche },
    { trancheId: resilientTranche.toUpperCase() },
    { maxModelCalls: 6 },
    { maxSearchCalls: 2 },
    { cumulativeAgentReservedModelCalls: 10 },
    { cumulativeAgentReservedModelCalls: 13 },
    { previousAgentProofSha256: "0".repeat(64) },
    { previousRepairProofSha256: "0".repeat(64) },
    { previousResilientProofSha256: "0".repeat(64) },
    {
      previousResilientReceiptSha256:
        EVIDENCE_AGENT_FAILED_REPAIR_RECEIPT_SHA256,
    },
    { credentialSha256: "0".repeat(64) },
    { priorSerpProofSha256: "0".repeat(64) },
    { usedRuns: 1 },
    { confirmedFreeSearches: 0 },
    { freeOnly: false },
    { paidOverageDisabled: false },
    { checkedAt: "2026-10-16T09:44:59Z" },
    { checkedAt: "2026-10-16T10:00:01Z" },
    { expiresAt: "2026-10-16T10:00:00Z" },
    { expiresAt: "2026-10-18T09:50:00Z" },
    { searchTimeoutMs: 60000 },
    { unexpected: true },
  ])(
    "rejects unsafe search follow-up %j without reopening an earlier allowance",
    async (change) => {
      const env = await environment();
      installSearchRepair(env);
      amendSearchRepair(env, change);
      const fetcher = vi.fn<typeof fetch>();
      expect(evidenceAgentConfiguration(env, now)).toBeNull();
      await expect(search(env, fetcher)).rejects.toMatchObject({
        code: "unauthorized",
      });
      expect(fetcher).not.toHaveBeenCalled();
      expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
    },
  );

  it("requires all three earlier proofs spent even when every raw hash is rebound", async () => {
    const env = await environment();
    for (const field of [
      "BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON",
      "BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON",
      "BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON",
    ] as const) {
      installSearchRepair(env);
      const original = env[field]!;
      for (const raw of [
        undefined,
        "",
        "{}",
        "invalid-json",
        "x".repeat(16_385),
      ]) {
        env[field] = raw;
        expect(evidenceAgentEnabled(env, now)).toBe(false);
      }
      env[field] = JSON.stringify({ ...JSON.parse(original), usedRuns: 0 });
      amendRepair(env, {
        previousAgentProofSha256: digest(
          env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!,
        ),
      });
      amendResilient(env, {
        previousAgentProofSha256: digest(
          env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!,
        ),
        previousRepairProofSha256: digest(
          env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON!,
        ),
      });
      amendSearchRepair(env, {
        previousAgentProofSha256: digest(
          env.BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON!,
        ),
        previousRepairProofSha256: digest(
          env.BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON!,
        ),
        previousResilientProofSha256: digest(
          env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON!,
        ),
      });
      expect(evidenceAgentEnabled(env, now)).toBe(false);
    }
  });

  it("never falls back to an unused resilient allowance when a malformed follow-up is present", async () => {
    const env = await environment();
    installResilient(env);
    expect(evidenceAgentEnabled(env, now)).toBe(true);
    for (const raw of ["", "{}", "invalid-json", "x".repeat(16_385)]) {
      env.BRIEFSTAMP_EVIDENCE_AGENT_SEARCH_REPAIR_PROOF_JSON = raw;
      expect(evidenceAgentEnabled(env, now)).toBe(false);
    }
    delete env.BRIEFSTAMP_EVIDENCE_AGENT_SEARCH_REPAIR_PROOF_JSON;
    expect(evidenceAgentConfiguration(env, now)?.searchTimeoutMs).toBe(10000);
  });

  it.each([
    { maxModelCalls: 2 },
    { cumulativeAgentReservedModelCalls: 12 },
    { previousAgentProofSha256: "0".repeat(64) },
    { previousRepairProofSha256: "0".repeat(64) },
    { previousRepairReceiptSha256: "0".repeat(64) },
    { credentialSha256: "0".repeat(64) },
    { trancheId: repairTranche },
    { expiresAt: "2026-10-18T09:45:00Z" },
  ])(
    "revalidates the spent resilient proof independently of its rebound outer hash %j",
    async (change) => {
      const env = await environment();
      installSearchRepair(env);
      amendResilient(env, change);
      amendSearchRepair(env, {
        previousResilientProofSha256: digest(
          env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON!,
        ),
      });
      expect(evidenceAgentEnabled(env, now)).toBe(false);
    },
  );

  it("requires exact earlier proof bytes and fresh funding within the October 20 ceiling", async () => {
    const env = await environment();
    installSearchRepair(env);
    env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON = JSON.stringify(
      JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON!),
      null,
      2,
    );
    expect(evidenceAgentEnabled(env, now)).toBe(false);
    amendSearchRepair(env, {
      previousResilientProofSha256: digest(
        env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON,
      ),
    });
    expect(evidenceAgentEnabled(env, now)).toBe(true);
    const later = Date.parse("2026-10-19T12:00:00Z");
    expect(evidenceAgentEnabled(env, later)).toBe(false);
    amendSearchRepair(env, {
      checkedAt: "2026-10-19T11:00:00Z",
      expiresAt: "2026-10-20T00:00:00Z",
    });
    expect(evidenceAgentConfiguration(env, later)?.searchTimeoutMs).toBe(30000);
    expect(evidenceAgentEnabled(env, Date.parse("2026-10-20T00:00:00Z"))).toBe(
      false,
    );
    amendSearchRepair(env, { expiresAt: "2026-10-20T00:00:01Z" });
    expect(evidenceAgentEnabled(env, later)).toBe(false);
  });

  it("consumes only the final UUID search ledger and never overwrites or replenishes the spent resilient ledger", async () => {
    const env = await environment();
    installResilient(env);
    const fetcher = vi.fn<typeof fetch>(async () => response());
    await search(env, fetcher);
    const resilientFile = filename(env).replace(tranche, resilientTranche);
    const oldSpent = await readFile(resilientFile, "utf8");
    installSearchRepair(env);
    const unchanged = { ...env };
    const finalFile = filename(env).replace(tranche, searchRepairTranche);
    await search(env, fetcher);
    const finalSpent = await readFile(finalFile, "utf8");
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await readFile(resilientFile, "utf8")).toBe(oldSpent);
    expect(await readFile(finalFile, "utf8")).toBe(finalSpent);
    expect(env).toEqual(unchanged);
    const raw = env.BRIEFSTAMP_EVIDENCE_AGENT_SEARCH_REPAIR_PROOF_JSON;
    amendSearchRepair(env, {
      checkedAt: "2026-10-16T09:55:00Z",
      expiresAt: "2026-10-17T09:55:00Z",
    });
    expect(evidenceAgentEnabled(env, now)).toBe(true);
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "free_confirmation_required",
    });
    env.BRIEFSTAMP_EVIDENCE_AGENT_SEARCH_REPAIR_PROOF_JSON = raw;
    env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON = JSON.stringify(
      JSON.parse(env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON!),
      null,
      2,
    );
    amendSearchRepair(env, {
      previousResilientProofSha256: digest(
        env.BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON,
      ),
    });
    await expect(search(env, fetcher)).rejects.toMatchObject({
      code: "free_confirmation_required",
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(await readFile(finalFile, "utf8")).toBe(finalSpent);
    expect((await readdir(path.dirname(finalFile))).sort()).toEqual(
      [path.basename(resilientFile), path.basename(finalFile)].sort(),
    );
  });
});
