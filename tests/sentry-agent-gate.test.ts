import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMastraBackboardGate,
  mastraBackboardConfiguration,
  priorMastraBackboardProofHashes,
  reserveMastraBackboardCall,
  reserveMastraBackboardRun,
} from "../server/mastra-backboard-gate.js";
import {
  authorizeSentryAgentOperator,
  priorSentryAgentProofHashes,
  reserveSentryAgentCall,
  reserveSentryAgentRun,
  sentryAgentConfiguration,
  sentryAgentSearchOptions,
} from "../server/sentry-agent-gate.js";
import type { BackboardGemmaReservationRequest } from "../server/providers/backboard-gemma-evidence.js";

const NOW = Date.parse("2026-10-17T05:00:00Z");
const PROOF = "BRIEFSTAMP_SENTRY_AGENT_PROOF_JSON";
const TASK1 = "BRIEFSTAMP_MASTRA_BACKBOARD_PROOF_JSON";
const TASK2 = "BRIEFSTAMP_BACKBOARD_ANSWER_PROOF_JSON";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const directories: string[] = [];

function proof(
  env: NodeJS.ProcessEnv,
  priorProofHashes: Record<string, string>,
) {
  return {
    trancheId: randomUUID(),
    checkedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
    credentialSha256: hash(env.SERPAPI_API_KEY!),
    modelCredentialSha256: hash(env.BACKBOARD_API_KEY!),
    assistantIdSha256: hash(env.BACKBOARD_ASSISTANT_ID!),
    confirmedFreeSearches: 97,
    serpFreeOnly: true,
    serpPaidOverageDisabled: true,
    reservedExistingCreditUsd: 0.2,
    mixedCreditApproved: true,
    confirmedFreeCreditsUsd: 0.2,
    confirmedTotalCreditsUsd: 1,
    autoReloadEnabled: false,
    paymentMethodConfigured: false,
    modelProvider: "openrouter",
    model: "google/gemma-4-26b-a4b-it",
    inputUsdPerMillion: 0.0765,
    outputUsdPerMillion: 0.255,
    contextWindowTokens: 262144,
    maximumOutputTokens: 235929,
    maxModelCalls: 2,
    maxSearchCalls: 1,
    maxTigerCalls: 1,
    maxUnits: 4,
    maximumRuns: 1,
    usedRuns: 0,
    priorProofHashes,
    evidence: "Synthetic offline fixture, not an account or approval receipt",
  };
}
function fixtureEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    BRIEFSTAMP_SENTRY_AGENT_ENABLED: "true",
    BRIEFSTAMP_MASTRA_BACKBOARD_ENABLED: "true",
    BACKBOARD_API_KEY: ["synthetic", "backboard", "key", "not", "real"].join(
      "-",
    ),
    SERPAPI_API_KEY: ["synthetic", "serpapi", "key", "not", "real"].join("-"),
    BACKBOARD_ASSISTANT_ID: randomUUID(),
    FLOWPROOF_TOKEN: [
      "synthetic",
      "operator",
      "token",
      "long",
      "enough",
      "not",
      "real",
    ].join("-"),
    BRIEFSTAMP_MASTRA_AGENT_PROOF_JSON: JSON.stringify({
      trancheId: randomUUID(),
      usedRuns: 1,
    }),
    [TASK1]: JSON.stringify({ trancheId: randomUUID(), usedRuns: 1 }),
    [TASK2]: JSON.stringify({ trancheId: randomUUID(), usedRuns: 1 }),
    BRIEFSTAMP_PROVIDER_ALLOWANCE_JSON: '{ "providers": {}, "spent": true }',
    UNRELATED_PROOF_JSON: "preserve these opaque historical bytes exactly",
    BRIEFSTAMP_SENTRY_EXPORT_GRANT_JSON: '{"separateExportGate":true}',
  };
  env[PROOF] = JSON.stringify(proof(env, priorSentryAgentProofHashes(env)));
  return env;
}
function update(env: NodeJS.ProcessEnv, fields: Record<string, unknown>) {
  env[PROOF] = JSON.stringify({ ...JSON.parse(env[PROOF]!), ...fields });
}
async function harness() {
  const env = fixtureEnv();
  env.FLOWPROOF_DATA_DIR = await mkdtemp(
    path.join(tmpdir(), "sentry-agent-gate-"),
  );
  directories.push(env.FLOWPROOF_DATA_DIR);
  return {
    env,
    headers: { "x-flowproof-token": env.FLOWPROOF_TOKEN },
    tiger: vi.fn(async (_trancheId: string) => ({ reserved: true })),
  };
}
function metadata(
  env: NodeJS.ProcessEnv,
  phase: "select_tools" | "summarize",
): BackboardGemmaReservationRequest {
  return {
    provider: "Backboard",
    transport: "backboard_openrouter_gemma",
    phase,
    assistantId: env.BACKBOARD_ASSISTANT_ID!,
    modelProvider: "openrouter",
    model: "google/gemma-4-26b-a4b-it",
    endpoint: "https://app.backboard.io/api/threads/messages",
    requestBytes: 1234,
    requestSha256: hash(`synthetic-${phase}-request`),
    credentialSha256: hash(env.BACKBOARD_API_KEY!),
    freshThread: true,
  };
}
async function files(env: NodeJS.ProcessEnv) {
  const folder = path.join(env.FLOWPROOF_DATA_DIR!, "provider-allowances");
  const names = await readdir(folder).catch(() => [] as string[]);
  return Object.fromEntries(
    await Promise.all(
      names
        .sort()
        .map(async (name) => [
          name,
          await readFile(path.join(folder, name), "utf8"),
        ]),
    ),
  );
}
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  fetcher = vi.fn<typeof fetch>(async () => {
    throw new Error("Network is forbidden in offline gate tests");
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => {
  expect(fetcher).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("dedicated hosted Sentry agent proof gate", () => {
  it("uses only the new proof and enable flag while preserving old spent proofs", () => {
    const env = fixtureEnv();
    const original = { ...env };
    expect(sentryAgentConfiguration(env, NOW)?.proof).toMatchObject({
      reservedExistingCreditUsd: 0.2,
      maximumRuns: 1,
      maxUnits: 4,
      maxModelCalls: 2,
      maxTigerCalls: 1,
      maxSearchCalls: 1,
    });
    expect(mastraBackboardConfiguration(env, NOW)).toBeNull();
    expect(
      authorizeSentryAgentOperator(
        { "x-flowproof-token": env.FLOWPROOF_TOKEN },
        env,
        NOW,
      ),
    ).toBe(true);
    expect(authorizeSentryAgentOperator({}, env, NOW)).toBe(false);
    expect(env).toEqual(original);
    delete env.BRIEFSTAMP_SENTRY_AGENT_ENABLED;
    expect(sentryAgentConfiguration(env, NOW)).toBeNull();
    env.BRIEFSTAMP_SENTRY_AGENT_ENABLED = "true";
    delete env[PROOF];
    expect(sentryAgentConfiguration(env, NOW)).toBeNull();
  });

  it("excludes only its own proof and leaves a separate export grant out of provider history", () => {
    const env = fixtureEnv();
    const hashes = priorSentryAgentProofHashes(env);
    expect(hashes).toEqual(
      Object.fromEntries(
        Object.entries(env)
          .filter(
            ([name]) =>
              /_(?:PROOF|ALLOWANCE)_JSON$/.test(name) && name !== PROOF,
          )
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, value]) => [name, hash(value!)]),
      ),
    );
    expect(hashes[TASK1]).toBe(hash(env[TASK1]!));
    expect(hashes[TASK2]).toBe(hash(env[TASK2]!));
    expect(hashes).not.toHaveProperty(PROOF);
    expect(hashes).not.toHaveProperty("BRIEFSTAMP_SENTRY_EXPORT_GRANT_JSON");
    expect(priorMastraBackboardProofHashes(env)).toHaveProperty(
      PROOF,
      hash(env[PROOF]!),
    );
    env.BRIEFSTAMP_SENTRY_EXPORT_GRANT_JSON =
      "new export gate, separately authorized";
    expect(sentryAgentConfiguration(env, NOW)).not.toBeNull();
  });

  it.each([TASK1, TASK2])(
    "requires an identified spent prior proof %s even if hashes are refreshed",
    (name) => {
      for (const value of [
        undefined,
        "not-json",
        "null",
        "[]",
        JSON.stringify({ usedRuns: 1 }),
        JSON.stringify({ trancheId: randomUUID(), usedRuns: 0 }),
        JSON.stringify({ trancheId: randomUUID(), usedRuns: "1" }),
      ]) {
        const env = fixtureEnv();
        if (value === undefined) delete env[name];
        else env[name] = value;
        update(env, { priorProofHashes: priorSentryAgentProofHashes(env) });
        expect(sentryAgentConfiguration(env, NOW)).toBeNull();
      }
    },
  );

  it.each([
    TASK1,
    TASK2,
    "BRIEFSTAMP_PROVIDER_ALLOWANCE_JSON",
    "UNRELATED_PROOF_JSON",
  ])("rejects a one-byte change to retained %s", (name) => {
    const env = fixtureEnv();
    env[name] += " ";
    expect(sentryAgentConfiguration(env, NOW)).toBeNull();
  });

  it("rejects added or removed historical proof bindings", () => {
    const added = fixtureEnv();
    added.EXTRA_ALLOWANCE_JSON = "new allowance";
    expect(sentryAgentConfiguration(added, NOW)).toBeNull();
    const removed = fixtureEnv();
    delete removed.UNRELATED_PROOF_JSON;
    expect(sentryAgentConfiguration(removed, NOW)).toBeNull();
  });

  it.each([TASK1, TASK2, "BRIEFSTAMP_MASTRA_AGENT_PROOF_JSON"])(
    "cannot reuse an earlier tranche identity from %s",
    (name) => {
      const env = fixtureEnv();
      update(env, {
        trancheId: JSON.parse(env[name]!).trancheId.toUpperCase(),
      });
      expect(sentryAgentConfiguration(env, NOW)).toBeNull();
    },
  );

  it.each([TASK1, TASK2])(
    "cannot activate Task 3 by copying a spent %s into its own key",
    (name) => {
      const env = fixtureEnv();
      env[PROOF] = env[name];
      expect(sentryAgentConfiguration(env, NOW)).toBeNull();
      expect(env[name]).toBe(env[PROOF]);
    },
  );

  it.each([
    { reservedExistingCreditUsd: 0.1 },
    { mixedCreditApproved: false },
    { maxUnits: 5 },
    { maxModelCalls: 3 },
    { maxTigerCalls: 2 },
    { maxSearchCalls: 2 },
    { maximumRuns: 2 },
    { usedRuns: 1 },
    { model: "google/different-model" },
    { inputUsdPerMillion: 0.08 },
    { outputUsdPerMillion: 0.26 },
    { credentialSha256: "0".repeat(64) },
    { modelCredentialSha256: "0".repeat(64) },
    { assistantIdSha256: "0".repeat(64) },
    { checkedAt: new Date(NOW - 86_400_001).toISOString() },
    { expiresAt: "2026-10-20T00:00:01Z" },
  ])(
    "keeps the inherited budget, identity and freshness boundary: %j",
    (change) => {
      const env = fixtureEnv();
      update(env, change);
      expect(sentryAgentConfiguration(env, NOW)).toBeNull();
    },
  );

  it("does not accept an old instance's capability or alter its reservation files", async () => {
    const h = await harness();
    const oldEnv = { ...h.env };
    delete oldEnv[PROOF];
    delete oldEnv[TASK2];
    oldEnv[TASK1] = JSON.stringify(
      proof(oldEnv, priorMastraBackboardProofHashes(oldEnv)),
    );
    const oldTiger = vi.fn(async () => ({ reserved: true }));
    await reserveMastraBackboardRun(oldTiger, oldEnv, NOW);
    await reserveMastraBackboardCall("failure_history", oldEnv, undefined, NOW);
    const oldFiles = await files(oldEnv);
    expect(
      Object.keys(oldFiles).every((name) =>
        name.startsWith("mastra-backboard-"),
      ),
    ).toBe(true);
    h.env[TASK1] = JSON.stringify({
      ...JSON.parse(oldEnv[TASK1]!),
      usedRuns: 1,
    });
    update(h.env, { priorProofHashes: priorSentryAgentProofHashes(h.env) });
    await expect(
      reserveSentryAgentCall("failure_history", h.env, undefined, NOW),
    ).rejects.toThrow();
    expect(await files(h.env)).toEqual(oldFiles);
    await expect(reserveSentryAgentRun(h.tiger, h.env, NOW)).resolves.toEqual({
      reserved: true,
    });
    await reserveSentryAgentCall("failure_history", h.env, undefined, NOW);
    const allFiles = await files(h.env);
    for (const [name, bytes] of Object.entries(oldFiles))
      expect(allFiles[name]).toBe(bytes);
    expect(
      Object.keys(allFiles).filter((name) => name.startsWith("sentry-agent-")),
    ).toHaveLength(3);
    expect(oldTiger).toHaveBeenCalledOnce();
    expect(h.tiger).toHaveBeenCalledOnce();
  });

  it("keeps capabilities private even between factories with identical host configuration", async () => {
    const h = await harness();
    const other = createMastraBackboardGate({
      proofKey: PROOF,
      enabledKey: "BRIEFSTAMP_SENTRY_AGENT_ENABLED",
      filePrefix: "sentry-agent",
      previousProofKey: TASK1,
      requiredSpentProofKeys: [TASK2],
    });
    await reserveSentryAgentRun(h.tiger, h.env, NOW);
    await expect(
      other.reserveCall("failure_history", h.env, undefined, NOW),
    ).rejects.toThrow();
    const secondTiger = vi.fn(async () => ({ reserved: true }));
    await expect(other.reserveRun(secondTiger, h.env, NOW)).rejects.toThrow();
    expect(secondTiger).not.toHaveBeenCalled();
    await expect(
      reserveSentryAgentCall("failure_history", h.env, undefined, NOW),
    ).resolves.toBeUndefined();
  });

  it("reserves exactly four operations and a separate one-use search ledger without rewriting prior bytes", async () => {
    const h = await harness();
    const original = { ...h.env };
    await reserveSentryAgentRun(h.tiger, h.env, NOW);
    for (const operation of [
      "select_tools",
      "failure_history",
      "search_visibility",
      "summarize",
    ] as const) {
      const request =
        operation === "select_tools" || operation === "summarize"
          ? metadata(h.env, operation)
          : undefined;
      const attempts = await Promise.allSettled([
        reserveSentryAgentCall(operation, h.env, request, NOW),
        reserveSentryAgentCall(operation, h.env, request, NOW),
      ]);
      expect(
        attempts.filter((attempt) => attempt.status === "fulfilled"),
      ).toHaveLength(1);
    }
    const options = await sentryAgentSearchOptions(h.headers, {
      env: h.env,
      now: () => NOW,
    });
    expect(options.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE).toMatch(
      /sentry-agent-[a-f0-9-]+-serpapi\.json$/,
    );
    expect(options.env![TASK1]).toBe(original[TASK1]);
    expect(options.env![TASK2]).toBe(original[TASK2]);
    expect(h.env).toEqual(original);
    const before = await files(h.env);
    expect(Object.keys(before)).toHaveLength(7);
    await expect(
      sentryAgentSearchOptions(h.headers, { env: h.env, now: () => NOW }),
    ).rejects.toThrow();
    await expect(reserveSentryAgentRun(h.tiger, h.env, NOW)).resolves.toEqual({
      reserved: false,
    });
    expect(await files(h.env)).toEqual(before);
    expect(h.tiger).toHaveBeenCalledOnce();
    expect(JSON.stringify(before)).not.toContain(h.env.BACKBOARD_API_KEY);
    expect(JSON.stringify(before)).not.toContain(h.env.SERPAPI_API_KEY);
  });
});
