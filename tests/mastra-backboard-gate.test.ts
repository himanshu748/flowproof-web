import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeMastraBackboardOperator,
  mastraBackboardConfiguration,
  mastraBackboardSearchOptions,
  priorMastraBackboardProofHashes,
  reserveMastraBackboardCall,
  reserveMastraBackboardRun,
} from "../server/mastra-backboard-gate.js";
import type { BackboardGemmaReservationRequest } from "../server/providers/backboard-gemma-evidence.js";
import { checkSearchVisibility } from "../server/providers/serpapi.js";
import type { Project } from "../shared/types.js";

const NOW = Date.parse("2026-10-17T05:00:00Z");
const PROOF = "BRIEFSTAMP_MASTRA_BACKBOARD_PROOF_JSON";
const OLD_PROOF = "BRIEFSTAMP_MASTRA_AGENT_PROOF_JSON";
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const directories: string[] = [];
type Operation = Parameters<typeof reserveMastraBackboardCall>[0];

function fixtureEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    BRIEFSTAMP_MASTRA_BACKBOARD_ENABLED: "true",
    SERPAPI_API_KEY: ["synthetic", "serpapi", "key", "not", "real"].join("-"),
    BACKBOARD_API_KEY: ["synthetic", "backboard", "key", "not", "real"].join(
      "-",
    ),
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
    [OLD_PROOF]: JSON.stringify({ trancheId: randomUUID(), usedRuns: 1 }),
    BRIEFSTAMP_JUDGE_AGENT_PROOF_JSON: '{ "usedRuns": 4, "retained": true }',
    BRIEFSTAMP_PROVIDER_ALLOWANCE_JSON: '{"providers":{},"spent":true}',
    UNRELATED_PROOF_JSON: "opaque prior proof bytes must remain unchanged",
  };
  env[PROOF] = JSON.stringify({
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
    evidence:
      "Synthetic offline funding fixture; not a provider account receipt",
    priorProofHashes: priorMastraBackboardProofHashes(env),
  });
  return env;
}
function change(env: NodeJS.ProcessEnv, values: Record<string, unknown>) {
  env[PROOF] = JSON.stringify({ ...JSON.parse(env[PROOF]!), ...values });
}
function metadata(
  env: NodeJS.ProcessEnv,
  phase: "select_tools" | "summarize" = "select_tools",
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
    requestSha256: hash(`synthetic-${phase}-request-body`),
    credentialSha256: hash(env.BACKBOARD_API_KEY!),
    freshThread: true,
  };
}
async function harness() {
  const env = fixtureEnv();
  const directory = await mkdtemp(
    path.join(tmpdir(), "mastra-backboard-gate-"),
  );
  directories.push(directory);
  env.FLOWPROOF_DATA_DIR = directory;
  const reserveTiger = vi.fn(async (_trancheId: string) => ({
    reserved: true,
  }));
  return {
    env,
    directory,
    reserveTiger,
    headers: { "x-flowproof-token": env.FLOWPROOF_TOKEN },
    run: () => reserveMastraBackboardRun(reserveTiger, env, NOW),
    call: (operation: Operation, request?: BackboardGemmaReservationRequest) =>
      reserveMastraBackboardCall(operation, env, request, NOW),
  };
}
async function snapshot(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function walk(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(filename);
      else
        result[path.relative(root, filename)] = await readFile(
          filename,
          "utf8",
        );
    }
  }
  await walk(root);
  return Object.fromEntries(
    Object.entries(result).sort(([a], [b]) => a.localeCompare(b)),
  );
}
const project: Project = {
  id: "00000000-0000-4000-8000-000000000002",
  name: "Synthetic authorized website",
  target: "website",
  authorized: true,
  url: "https://flowproof-demo.onrender.com/",
  sampleVariant: "healthy",
  brief: "Synthetic offline test",
  checks: [],
  createdAt: "",
  updatedAt: "",
  generator: { provider: "Synthetic", model: null },
};
let globalFetch: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  globalFetch = vi.fn<typeof fetch>(async () => {
    throw new Error("Global network is forbidden in allowance tests.");
  });
  vi.stubGlobal("fetch", globalFetch);
});
afterEach(async () => {
  expect(globalFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("separate Mastra Backboard mixed-credit allowance", () => {
  it("binds the exact approved credit, model, assistant and four-unit limits", () => {
    const env = fixtureEnv();
    expect(mastraBackboardConfiguration(env, NOW)).toMatchObject({
      proof: {
        reservedExistingCreditUsd: 0.2,
        mixedCreditApproved: true,
        maxModelCalls: 2,
        maxSearchCalls: 1,
        maxTigerCalls: 1,
        maxUnits: 4,
        maximumRuns: 1,
      },
      assistantId: env.BACKBOARD_ASSISTANT_ID,
      key: env.BACKBOARD_API_KEY,
      searchKey: env.SERPAPI_API_KEY,
      searchTimeoutMs: 60_000,
    });
  });

  it("hashes every prior proof and allowance byte-for-byte, excluding only this tranche", () => {
    const env = fixtureEnv();
    const before = { ...env };
    const actual = priorMastraBackboardProofHashes(env);
    const expected = Object.fromEntries(
      Object.entries(env)
        .filter(
          ([name]) =>
            /(?:PROOF_JSON|ALLOWANCE_JSON)$/.test(name) && name !== PROOF,
        )
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([name, value]) => [name, hash(value!)]),
    );
    expect(actual).toEqual(expected);
    expect(actual).not.toHaveProperty(PROOF);
    expect(env).toEqual(before);
    env[PROOF] = "own proof does not enter its own history hash";
    expect(priorMastraBackboardProofHashes(env)).toEqual(expected);
  });

  it.each([
    ["maxUnits", 5],
    ["maxModelCalls", 3],
    ["maxSearchCalls", 2],
    ["maxTigerCalls", 2],
    ["maximumRuns", 2],
    ["usedRuns", 1],
    ["confirmedFreeSearches", 96],
    ["serpFreeOnly", false],
    ["serpPaidOverageDisabled", false],
    ["reservedExistingCreditUsd", 0.21],
    ["reservedExistingCreditUsd", 0.19],
    ["mixedCreditApproved", false],
    ["confirmedFreeCreditsUsd", 0.19],
    ["confirmedTotalCreditsUsd", 0.19],
    ["autoReloadEnabled", true],
    ["paymentMethodConfigured", true],
    ["modelProvider", "google"],
    ["model", "google/different-model"],
    ["inputUsdPerMillion", 0.08],
    ["outputUsdPerMillion", 0.26],
    ["contextWindowTokens", 262145],
    ["maximumOutputTokens", 235930],
    ["extra", "unapproved"],
    ["evidence", "short"],
    ["evidence", "x".repeat(501)],
    ["checkedAt", new Date(NOW + 1).toISOString()],
    ["checkedAt", new Date(NOW - 86_400_001).toISOString()],
    ["expiresAt", new Date(NOW).toISOString()],
    ["expiresAt", new Date(NOW + 86_400_001).toISOString()],
    ["expiresAt", "2026-10-20T00:00:01Z"],
  ])("rejects unsafe proof %s=%s", (key, value) => {
    const env = fixtureEnv();
    change(env, { [key as string]: value });
    expect(mastraBackboardConfiguration(env, NOW)).toBeNull();
  });

  it.each(["SERPAPI_API_KEY", "BACKBOARD_API_KEY", "BACKBOARD_ASSISTANT_ID"])(
    "rejects changed binding %s",
    (name) => {
      const env = fixtureEnv();
      env[name] = name.endsWith("ID") ? randomUUID() : "changed-synthetic-key";
      expect(mastraBackboardConfiguration(env, NOW)).toBeNull();
    },
  );

  it.each([
    "BRIEFSTAMP_MASTRA_BACKBOARD_ENABLED",
    "FLOWPROOF_TOKEN",
    "BACKBOARD_API_KEY",
    "SERPAPI_API_KEY",
    "BACKBOARD_ASSISTANT_ID",
  ])("requires explicit valid configuration for %s", (name) => {
    const env = fixtureEnv();
    delete env[name];
    expect(mastraBackboardConfiguration(env, NOW)).toBeNull();
  });

  it.each(["changed", "added", "removed"])(
    "rejects %s historical proof bytes",
    (operation) => {
      const env = fixtureEnv();
      if (operation === "changed")
        env.BRIEFSTAMP_PROVIDER_ALLOWANCE_JSON += " ";
      if (operation === "added") env.ADDED_PROOF_JSON = "new proof";
      if (operation === "removed") delete env.UNRELATED_PROOF_JSON;
      expect(mastraBackboardConfiguration(env, NOW)).toBeNull();
    },
  );

  it.each([
    undefined,
    "null",
    "[]",
    "malformed",
    JSON.stringify({ usedRuns: 1 }),
    JSON.stringify({ trancheId: randomUUID(), usedRuns: 0 }),
  ])(
    "requires a spent, identified prior Mastra tranche even with refreshed hashes: %s",
    (old) => {
      const env = fixtureEnv();
      if (old === undefined) delete env[OLD_PROOF];
      else env[OLD_PROOF] = old;
      change(env, { priorProofHashes: priorMastraBackboardProofHashes(env) });
      expect(mastraBackboardConfiguration(env, NOW)).toBeNull();
    },
  );

  it("cannot reuse the old Mastra tranche identity", () => {
    const env = fixtureEnv();
    change(env, { trancheId: JSON.parse(env[OLD_PROOF]!).trancheId });
    expect(mastraBackboardConfiguration(env, NOW)).toBeNull();
  });

  it("requires the operator token in either supported header representation", () => {
    const env = fixtureEnv();
    expect(
      authorizeMastraBackboardOperator(
        { "x-flowproof-token": env.FLOWPROOF_TOKEN },
        env,
        NOW,
      ),
    ).toBe(true);
    expect(
      authorizeMastraBackboardOperator(
        new Headers({ "X-FlowProof-Token": env.FLOWPROOF_TOKEN! }),
        env,
        NOW,
      ),
    ).toBe(true);
    for (const headers of [
      {},
      { "x-flowproof-token": "wrong" },
      { "x-flowproof-token": [env.FLOWPROOF_TOKEN!] },
    ])
      expect(authorizeMastraBackboardOperator(headers, env, NOW)).toBe(false);
  });

  it("writes only a consumed intent and grants no calls before Tiger confirms the run reservation", async () => {
    const h = await harness();
    h.reserveTiger.mockImplementationOnce(async (trancheId) => {
      expect(trancheId).toBe(JSON.parse(h.env[PROOF]!).trancheId);
      const before = await snapshot(h.directory);
      expect(Object.keys(before)).toHaveLength(1);
      expect(Object.keys(before)[0]).toMatch(/\.intent\.json$/);
      await expect(h.call("select_tools", metadata(h.env))).rejects.toThrow();
      expect(await snapshot(h.directory)).toEqual(before);
      return { reserved: true };
    });
    await expect(h.run()).resolves.toEqual({ reserved: true });
    await expect(
      h.call("select_tools", metadata(h.env)),
    ).resolves.toBeUndefined();
    expect(h.reserveTiger).toHaveBeenCalledOnce();
  });

  it("retains only consumed intent after a denied Tiger reservation without granting a capability", async () => {
    const h = await harness();
    h.reserveTiger.mockResolvedValueOnce({ reserved: false });
    await expect(h.run()).resolves.toEqual({ reserved: false });
    await expect(h.call("failure_history")).rejects.toThrow();
    const files = Object.keys(await snapshot(h.directory));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.intent\.json$/);
  });

  it("does not retry an ambiguous Tiger reservation or grant a capability", async () => {
    const h = await harness();
    h.reserveTiger.mockRejectedValueOnce(
      new Error("ambiguous Tiger completion"),
    );
    await Promise.allSettled([h.run()]);
    await Promise.allSettled([h.run()]);
    expect(h.reserveTiger).toHaveBeenCalledOnce();
    await expect(h.call("failure_history")).rejects.toThrow();
    const files = Object.keys(await snapshot(h.directory));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/\.intent\.json$/);
  });

  it("atomically allows one concurrent run and does not repeat the trusted Tiger call", async () => {
    const h = await harness();
    const results = await Promise.allSettled([h.run(), h.run(), h.run()]);
    expect(
      results.filter(
        (result) => result.status === "fulfilled" && result.value.reserved,
      ),
    ).toHaveLength(1);
    expect(h.reserveTiger).toHaveBeenCalledOnce();
    const before = await snapshot(h.directory);
    await Promise.allSettled([h.run()]);
    expect(await snapshot(h.directory)).toEqual(before);
    expect(h.reserveTiger).toHaveBeenCalledOnce();
  });

  it("does not grant a capability when disk persistence fails after Tiger consumed the run", async () => {
    const h = await harness();
    const directory = path.join(h.directory, "provider-allowances");
    await mkdir(directory);
    const blocked = path.join(
      directory,
      `mastra-backboard-${JSON.parse(h.env[PROOF]!).trancheId}.tiger-reserved.json`,
    );
    await writeFile(blocked, "preserve this file");
    await Promise.allSettled([h.run()]);
    await Promise.allSettled([h.run()]);
    expect(h.reserveTiger).toHaveBeenCalledOnce();
    await expect(h.call("failure_history")).rejects.toThrow();
    expect(await readFile(blocked, "utf8")).toBe("preserve this file");
  });

  it("does not unlock search options after an attempted but failed search operation write", async () => {
    const h = await harness();
    await h.run();
    const blocked = path.join(
      h.directory,
      "provider-allowances",
      `mastra-backboard-${JSON.parse(h.env[PROOF]!).trancheId}-search_visibility.reservation.json`,
    );
    await writeFile(blocked, "preexisting reservation must not be overwritten");
    await expect(h.call("search_visibility")).rejects.toThrow();
    const before = await snapshot(h.directory);
    await expect(
      mastraBackboardSearchOptions(h.headers, { env: h.env, now: () => NOW }),
    ).rejects.toThrow();
    await expect(h.call("search_visibility")).rejects.toThrow();
    expect(await snapshot(h.directory)).toEqual(before);
  });

  it.each([
    "select_tools",
    "summarize",
    "failure_history",
    "search_visibility",
  ] as const)(
    "requires a trusted run capability before %s",
    async (operation) => {
      const h = await harness();
      const request =
        operation === "select_tools" || operation === "summarize"
          ? metadata(h.env, operation)
          : undefined;
      await expect(h.call(operation, request)).rejects.toThrow();
      expect(await readdir(h.directory)).toEqual([]);
    },
  );

  it("consumes each of four operations at most once under concurrent calls", async () => {
    const h = await harness();
    await h.run();
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
        h.call(operation, request),
        h.call(operation, request),
      ]);
      expect(
        attempts.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      const before = await snapshot(h.directory);
      await expect(h.call(operation, request)).rejects.toThrow();
      expect(await snapshot(h.directory)).toEqual(before);
    }
    const stored = JSON.stringify(await snapshot(h.directory));
    expect(stored).not.toContain(h.env.BACKBOARD_API_KEY);
    expect(stored).not.toContain(h.env.SERPAPI_API_KEY);
  });

  it.each([
    { provider: "Google" },
    { transport: "native_google_gemma" },
    { modelProvider: "google" },
    { model: "google/different-model" },
    { phase: "summarize" },
    { assistantId: randomUUID() },
    { credentialSha256: "0".repeat(64) },
    { endpoint: "https://unapproved.test/api" },
    { requestSha256: "bad-hash" },
    { requestBytes: 0 },
    { requestBytes: 32769 },
    { freshThread: false },
    { extra: "not approved" },
  ])(
    "rejects mismatched model request metadata %j before consuming the model slot",
    async (override) => {
      const h = await harness();
      await h.run();
      const before = await snapshot(h.directory);
      await expect(
        h.call("select_tools", {
          ...metadata(h.env),
          ...override,
        } as BackboardGemmaReservationRequest),
      ).rejects.toThrow();
      expect(await snapshot(h.directory)).toEqual(before);
      await expect(
        h.call("select_tools", metadata(h.env)),
      ).resolves.toBeUndefined();
    },
  );

  it("requires model metadata and forbids attaching it to a tool operation", async () => {
    const h = await harness();
    await h.run();
    await expect(h.call("select_tools")).rejects.toThrow();
    await expect(h.call("failure_history", metadata(h.env))).rejects.toThrow();
    await expect(h.call("failure_history")).resolves.toBeUndefined();
    await expect(
      h.call("select_tools", metadata(h.env)),
    ).resolves.toBeUndefined();
  });

  it("requires both operator auth and a previously reserved search operation before creating a ledger", async () => {
    const h = await harness();
    await expect(
      mastraBackboardSearchOptions(h.headers, { env: h.env, now: () => NOW }),
    ).rejects.toThrow();
    expect(await readdir(h.directory)).toEqual([]);
    await h.run();
    const before = await snapshot(h.directory);
    await expect(
      mastraBackboardSearchOptions(h.headers, { env: h.env, now: () => NOW }),
    ).rejects.toThrow();
    expect(await snapshot(h.directory)).toEqual(before);
    await h.call("search_visibility");
    const reserved = await snapshot(h.directory);
    await expect(
      mastraBackboardSearchOptions({}, { env: h.env, now: () => NOW }),
    ).rejects.toThrow();
    expect(await snapshot(h.directory)).toEqual(reserved);
  });

  it("preserves every prior proof and creates one non-resettable search ledger consumed before transport", async () => {
    const h = await harness();
    const original = { ...h.env };
    await h.run();
    await h.call("search_visibility");
    let filename = "";
    const fetcher = vi.fn<typeof fetch>(async () => {
      const during = JSON.parse(await readFile(filename, "utf8"));
      expect(during.providers.serpapi).toMatchObject({
        usedCalls: 1,
        usedUnits: 1,
      });
      return Response.json({
        search_metadata: { status: "Success" },
        organic_results: [],
      });
    });
    const options = await mastraBackboardSearchOptions(h.headers, {
      env: h.env,
      now: () => NOW,
      fetcher,
    });
    filename = options.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!;
    expect(options.fetcher).toBe(fetcher);
    expect(options.env).not.toBe(h.env);
    expect(h.env).toEqual(original);
    for (const name of Object.keys(priorMastraBackboardProofHashes(h.env)))
      expect(options.env![name]).toBe(h.env[name]);
    expect(options.env![PROOF]).toBe(h.env[PROOF]);
    const ledger = JSON.parse(await readFile(filename, "utf8"));
    expect(ledger.providers.serpapi).toMatchObject({
      credentialSha256: hash(h.env.SERPAPI_API_KEY!),
      freeOnly: true,
      paidOverageDisabled: true,
      confirmedFreeUnits: 97,
      operations: ["search-visibility"],
      maxUnits: 1,
      usedUnits: 0,
      maxCalls: 1,
      usedCalls: 0,
    });
    await expect(
      checkSearchVisibility(project, options),
    ).resolves.toMatchObject({ status: "observed", results: [] });
    const spent = await readFile(filename);
    await expect(checkSearchVisibility(project, options)).rejects.toThrow();
    await expect(
      mastraBackboardSearchOptions(h.headers, {
        env: h.env,
        now: () => NOW,
        fetcher,
      }),
    ).rejects.toThrow();
    expect(await readFile(filename)).toEqual(spent);
    expect(fetcher).toHaveBeenCalledOnce();
    expect(h.env).toEqual(original);
  });
});
