import { createHash } from "node:crypto";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createJudgeAgentGate,
  judgeAgentConfiguration,
} from "../server/judge-agent-gate.js";
import { checkSearchVisibility } from "../server/providers/serpapi.js";
import type { Project } from "../shared/types.js";

const NOW = Date.parse("2026-10-16T08:00:00Z");
const KEY = ["judge", "synthetic", "test", "not-real"].join("-");
const uuid = (value: number) =>
  `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const names = {
  primary: "BRIEFSTAMP_EVIDENCE_AGENT_PROOF_JSON",
  repair: "BRIEFSTAMP_EVIDENCE_AGENT_REPAIR_PROOF_JSON",
  resilient: "BRIEFSTAMP_EVIDENCE_AGENT_RESILIENT_PROOF_JSON",
  searchRepair: "BRIEFSTAMP_EVIDENCE_AGENT_SEARCH_REPAIR_PROOF_JSON",
};
const directories: string[] = [];
async function fixture() {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "briefstamp-judge-gate-"),
  );
  directories.push(directory);
  const env: NodeJS.ProcessEnv = {
    BRIEFSTAMP_JUDGE_AGENT_ENABLED: "true",
    SERPAPI_API_KEY: KEY,
    FLOWPROOF_DATA_DIR: directory,
  };
  const prior: Record<string, string> = {};
  for (const [index, [name, field]] of Object.entries(names).entries()) {
    env[field] = JSON.stringify({
      usedRuns: 1,
      credentialSha256: sha(KEY),
      trancheId: uuid(index + 10),
      evidence: "Synthetic offline historical proof, not cloud entitlement",
    });
    prior[name] = sha(env[field]!);
  }
  env.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON = JSON.stringify({
    usedCalls: 1,
    usedUnits: 1,
    credentialSha256: sha(KEY),
    fixture: true,
  });
  prior.standaloneSerp = sha(env.BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON);
  const pins = prior as Record<
    "primary" | "repair" | "resilient" | "searchRepair" | "standaloneSerp",
    string
  >;
  const proof = {
    grantId: uuid(1),
    credentialSha256: sha(KEY),
    checkedAt: new Date(NOW).toISOString(),
    expiresAt: "2026-10-20T00:00:00Z",
    freeOnly: true,
    paidOverageDisabled: true,
    maxRuns: 12,
    maxModelCallsPerRun: 2,
    maxSearchCallsPerRun: 1,
    maxRunsPerVisitor: 1,
    priorSpentProofsSha256: {
      primary: pins.primary,
      repair: pins.repair,
      resilient: pins.resilient,
      searchRepair: pins.searchRepair,
    },
    priorStandaloneSerpProofSha256: pins.standaloneSerp,
    priorStandaloneSerpCalls: 1,
    priorStandaloneSerpUnits: 1,
    evidence:
      "Synthetic offline grant and funding fixtures, not provider proof",
  };
  env.BRIEFSTAMP_JUDGE_AGENT_PROOF_JSON = JSON.stringify(proof);
  const gate = createJudgeAgentGate({ priorPins: pins });
  const config = gate.configuration(env, NOW)!;
  return { env, proof, gate, config, directory };
}
const account = (change: Record<string, unknown> = {}) => ({
  account_status: "Active",
  plan_name: "Free Plan",
  plan_monthly_price: 0,
  extra_credits: 0,
  total_searches_left: 200,
  plan_searches_left: 200,
  ...change,
});
const project: Project = {
  id: uuid(2),
  name: "Synthetic fixture",
  target: "website",
  authorized: true,
  url: "https://flowproof-demo.onrender.com/",
  sampleVariant: "healthy",
  brief: "Synthetic fixture",
  checks: [],
  createdAt: "",
  updatedAt: "",
  generator: { provider: "Synthetic", model: null },
};
afterEach(async () => {
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("separate immutable judge grant", () => {
  it("defaults disabled, pins production history, and accepts only code-injected synthetic pins in offline tests", async () => {
    const { env, gate, config, directory } = await fixture();
    expect(judgeAgentConfiguration(env, NOW)).toBeNull();
    expect(gate.enabled(env, NOW)).toBe(true);
    expect(config.grant).toMatchObject({ maxRuns: 12, grantId: uuid(1) });
    expect(config.grant.proofSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(
      gate.configuration(
        { ...env, BRIEFSTAMP_JUDGE_AGENT_ENABLED: "false" },
        NOW,
      ),
    ).toBeNull();
    expect(await readdir(directory)).toEqual([]);
  });
  it.each([
    { maxRuns: 13 },
    { maxRuns: 0 },
    { maxModelCallsPerRun: 6 },
    { maxSearchCallsPerRun: 2 },
    { maxRunsPerVisitor: 2 },
    { freeOnly: false },
    { paidOverageDisabled: false },
    { credentialSha256: "0".repeat(64) },
    { checkedAt: "2026-10-16T08:00:01Z" },
    { checkedAt: "2026-10-15T00:00:00Z" },
    { expiresAt: "2026-10-20T00:00:01Z" },
    { expiresAt: "2026-10-16T08:00:00Z" },
    { priorStandaloneSerpCalls: 0 },
    { priorStandaloneSerpUnits: 0 },
    { priorStandaloneSerpProofSha256: "0".repeat(64) },
    { evidence: "" },
    { unknownOverride: true },
  ])("rejects widened, stale or altered proof %j", async (change) => {
    const { env, proof, gate } = await fixture();
    env.BRIEFSTAMP_JUDGE_AGENT_PROOF_JSON = JSON.stringify({
      ...proof,
      ...change,
    });
    expect(gate.configuration(env, NOW)).toBeNull();
  });
  it("checks all four old raw byte strings, their consumed counters and the standalone search", async () => {
    const { env, gate } = await fixture();
    for (const field of [
      ...Object.values(names),
      "BRIEFSTAMP_HOSTED_SERPAPI_PROOF_JSON",
    ]) {
      expect(
        gate.configuration({ ...env, [field]: undefined }, NOW),
      ).toBeNull();
      expect(
        gate.configuration({ ...env, [field]: env[field] + " " }, NOW),
      ).toBeNull();
      const changed = JSON.parse(env[field]!);
      if (field.endsWith("SERPAPI_PROOF_JSON")) {
        changed.usedCalls = 0;
        changed.usedUnits = 0;
      } else changed.usedRuns = 0;
      expect(
        gate.configuration({ ...env, [field]: JSON.stringify(changed) }, NOW),
      ).toBeNull();
    }
    expect(
      gate.configuration(env, Date.parse("2026-10-20T00:00:00Z")),
    ).toBeNull();
    expect(
      gate.configuration(
        { ...env, SERPAPI_API_KEY: [KEY, "changed"].join("-") },
        NOW,
      ),
    ).toBeNull();
  });
  it("canonically seals field order but does not let evidence or expiry changes reuse a seal", async () => {
    const { env, proof, config, gate } = await fixture();
    env.BRIEFSTAMP_JUDGE_AGENT_PROOF_JSON = JSON.stringify(
      Object.fromEntries(Object.entries(proof).reverse()),
    );
    expect(gate.configuration(env, NOW)!.grant.proofSha256).toBe(
      config.grant.proofSha256,
    );
    env.BRIEFSTAMP_JUDGE_AGENT_PROOF_JSON = JSON.stringify({
      ...proof,
      evidence: "Different synthetic proof",
    });
    expect(gate.configuration(env, NOW)!.grant.proofSha256).not.toBe(
      config.grant.proofSha256,
    );
  });
});
describe("read-only current confirmed-free SerpApi funding", () => {
  it("uses only the fixed read-only endpoint and returns no key/account identifier", async () => {
    const { gate, config } = await fixture();
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(new URL(String(url)).origin + new URL(String(url)).pathname).toBe(
        "https://serpapi.com/account",
      );
      expect(new URL(String(url)).searchParams.get("api_key")).toBe(KEY);
      expect(init?.method).toBe("GET");
      expect(init?.redirect).toBe("error");
      return Response.json({
        ...account(),
        api_key: KEY,
        account_id: "private-account",
      });
    });
    const result = await gate.funding(config, {
      fetcher,
      now: () => NOW,
      forceFresh: true,
      minimumSearches: 12,
    });
    expect(result).toEqual({
      provider: "SerpApi",
      checkedAt: new Date(NOW).toISOString(),
      plan: "Free Plan",
      remainingSearches: 200,
      modelRequests: 0,
      searchRequests: 0,
    });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain("private-account");
  });
  it.each([
    { account_status: "Inactive" },
    { plan_name: "Developer" },
    { plan_monthly_price: 1 },
    { extra_credits: 1 },
    { total_searches_left: 0 },
    { plan_searches_left: 0 },
    { total_searches_left: 11 },
    { plan_searches_left: 11 },
    { total_searches_left: "200" },
  ])(
    "fails closed on unconfirmed or insufficient entitlement %j",
    async (change) => {
      const { gate, config } = await fixture();
      const fetcher = vi.fn<typeof fetch>(async () =>
        Response.json(account(change)),
      );
      await expect(
        gate.funding(config, {
          fetcher,
          now: () => NOW,
          minimumSearches: 12,
          forceFresh: true,
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(fetcher).toHaveBeenCalledOnce();
    },
  );
  it("caches at most sixty seconds per exact grant and never falls back after a failed fresh read", async () => {
    const { gate, config, env, proof } = await fixture();
    let clock = NOW;
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(account()));
    await gate.funding(config, { fetcher, now: () => clock });
    clock += 59_999;
    await gate.funding(config, { fetcher, now: () => clock });
    expect(fetcher).toHaveBeenCalledOnce();
    clock++;
    await gate.funding(config, { fetcher, now: () => clock });
    expect(fetcher).toHaveBeenCalledTimes(2);
    fetcher.mockResolvedValueOnce(
      new Response("Private key=" + KEY, { status: 500 }),
    );
    await expect(
      gate.funding(config, { fetcher, now: () => clock, forceFresh: true }),
    ).rejects.toMatchObject({ code: "free_funding_unavailable" });
    await gate.funding(config, { fetcher, now: () => clock });
    expect(fetcher).toHaveBeenCalledTimes(4);
    env.BRIEFSTAMP_JUDGE_AGENT_PROOF_JSON = JSON.stringify({
      ...proof,
      grantId: uuid(3),
    });
    await gate.funding(gate.configuration(env, clock)!, {
      fetcher,
      now: () => clock,
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });
  it("does not log, return or reuse private provider errors", async () => {
    const { gate, config } = await fixture();
    const fetcher = vi.fn<typeof fetch>(async () => {
      throw new Error(`Private endpoint key=${KEY}`);
    });
    const error = await gate
      .funding(config, { fetcher, now: () => NOW })
      .catch((value) => value);
    expect(error.code).toBe("free_funding_unavailable");
    expect(String(error)).not.toContain(KEY);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("cancels a stuck read, never caches it, and fails closed if entitlement expires while reading", async () => {
    const { gate, config } = await fixture();
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = vi.fn<typeof fetch>(async () => {
      started();
      return new Promise<Response>(() => {});
    });
    const caught = gate
      .funding(config, { fetcher, now: () => NOW, signal: controller.signal })
      .catch((error) => error);
    await ready;
    controller.abort();
    expect(await caught).toMatchObject({ code: "free_funding_unavailable" });
    let clock = NOW;
    const expired = vi.fn<typeof fetch>(async () => {
      clock = Date.parse("2026-10-20T00:00:00Z");
      return Response.json(account());
    });
    await expect(
      gate.funding(config, {
        fetcher: expired,
        now: () => clock,
        forceFresh: true,
      }),
    ).rejects.toMatchObject({ code: "free_funding_unavailable" });
  });
});
describe("one-search local guard per already reserved judge run", () => {
  it("uses a separate run UUID ledger, preserves old proofs and consumes success exactly once", async () => {
    const { gate, config, env } = await fixture(),
      before = structuredClone(env);
    let searches = 0;
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (new URL(String(url)).pathname === "/account")
        return Response.json(account());
      searches++;
      return Response.json({
        search_metadata: { status: "Success" },
        organic_results: [],
      });
    });
    const options = await gate.searchOptions(config, uuid(50), {
      env,
      now: () => NOW,
      fetcher,
    });
    expect(
      path.basename(options.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!),
    ).toBe(`judge-agent-serpapi-${uuid(50)}.json`);
    expect(Object.keys(options.env!).sort()).toEqual(
      [
        "BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE",
        "BRIEFSTAMP_SEARCH_DOMAINS",
        "BRIEFSTAMP_SERPAPI_ENABLED",
        "SERPAPI_API_KEY",
      ].sort(),
    );
    expect(await checkSearchVisibility(project, options)).toMatchObject({
      status: "observed",
      results: [],
    });
    await expect(
      gate.searchOptions(config, uuid(50), { env, now: () => NOW, fetcher }),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    expect(searches).toBe(1);
    expect(env).toEqual(before);
  });
  it("keeps failed provider requests consumed and never repairs a corrupt or symlink ledger", async () => {
    const { gate, config, env } = await fixture();
    const fetcher = vi.fn<typeof fetch>(async (url) =>
      new URL(String(url)).pathname === "/account"
        ? Response.json(account())
        : new Response(null, { status: 503 }),
    );
    const options = await gate.searchOptions(config, uuid(51), {
      env,
      now: () => NOW,
      fetcher,
    });
    await expect(checkSearchVisibility(project, options)).rejects.toMatchObject(
      { code: "provider_rejected" },
    );
    await expect(
      gate.searchOptions(config, uuid(51), { env, now: () => NOW, fetcher }),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    const filename = options.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!;
    await writeFile(filename, "corrupt");
    await expect(
      gate.searchOptions(config, uuid(51), { env, now: () => NOW, fetcher }),
    ).rejects.toMatchObject({ code: "invalid_judge_ledger" });
    expect(await readFile(filename, "utf8")).toBe("corrupt");
    const link = path.join(
      path.dirname(filename),
      `judge-agent-serpapi-${uuid(52)}.json`,
    );
    await symlink(filename, link);
    await expect(
      gate.searchOptions(config, uuid(52), { env, now: () => NOW, fetcher }),
    ).rejects.toMatchObject({ code: "invalid_judge_ledger" });
  });
  it("cannot widen a previously initialized ledger or initialize from altered grant bytes", async () => {
    const { gate, config, env } = await fixture();
    const fetcher = vi.fn<typeof fetch>(async () => Response.json(account()));
    const options = await gate.searchOptions(config, uuid(53), {
      env,
      now: () => NOW,
      fetcher,
    });
    const filename = options.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!;
    const raw = JSON.parse(await readFile(filename, "utf8"));
    raw.providers.serpapi.maxCalls = 2;
    await writeFile(filename, JSON.stringify(raw));
    await expect(
      gate.searchOptions(config, uuid(53), { env, now: () => NOW, fetcher }),
    ).rejects.toMatchObject({ code: "invalid_judge_ledger" });
    await expect(
      gate.searchOptions(
        { ...config, grant: { ...config.grant, proofSha256: "0".repeat(64) } },
        uuid(54),
        { env, now: () => NOW, fetcher },
      ),
    ).rejects.toMatchObject({ code: "invalid_judge_grant" });
  });
});
