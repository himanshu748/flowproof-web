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
import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  authorizeRuntimeTrace,
  reserveRuntimeTraceExport,
  runtimeTraceConfiguration,
  runtimeTraceHttpBoundary,
} from "../server/runtime-trace-gate.js";

const NOW = Date.parse("2026-10-17T05:00:00Z");
const GRANT = "BRIEFSTAMP_RUNTIME_TRACE_GRANT_JSON";
const AGENT = "BRIEFSTAMP_SENTRY_AGENT_PROOF_JSON";
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const directories: string[] = [];
const request = {
  operation: "runtime_trace" as const,
  measurementSha256: sha("synthetic observed runtime measurement"),
  units: 1 as const,
  maxEnvelopes: 2 as const,
};

function fixtureEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    BRIEFSTAMP_RUNTIME_TRACE_ENABLED: "true",
    FLOWPROOF_SENTRY_ENABLED: "true",
    FLOWPROOF_SENTRY_FREE_CONFIRMED: "true",
    FLOWPROOF_SENTRY_FREE_CONFIRMED_AT: new Date(NOW - 3_600_000).toISOString(),
    SENTRY_DSN: "https://synthetic-public-key@o123.ingest.sentry.io/456",
    FLOWPROOF_TOKEN: [
      "synthetic",
      "operator",
      "token",
      "long",
      "enough",
      "not",
      "real",
    ].join("-"),
    [AGENT]: JSON.stringify({ trancheId: randomUUID(), usedRuns: 0 }),
    BRIEFSTAMP_MASTRA_BACKBOARD_PROOF_JSON:
      '{ "usedRuns": 1, "retained": true }',
    BRIEFSTAMP_BACKBOARD_ANSWER_PROOF_JSON: '{"usedRuns":1,"retained":true}',
    BRIEFSTAMP_PROVIDER_ALLOWANCE_JSON: '{ "providers": {}, "spent": true }',
  };
  env[GRANT] = JSON.stringify({
    grantId: randomUUID(),
    checkedAt: new Date(NOW).toISOString(),
    expiresAt: new Date(NOW + 3_600_000).toISOString(),
    auditReservationId: randomUUID(),
    agentReservationId: randomUUID(),
    sentryDsnSha256: sha(env.SENTRY_DSN!),
    agentProofSha256: sha(env[AGENT]!),
    plan: "Sponsored Team",
    payAsYouGoLimitUsd: 0,
    maximumExports: 2,
    usedExports: 0,
    maximumEnvelopesPerExport: 2,
    evidence: "Synthetic offline authorization fixture, not a provider receipt",
  });
  return env;
}
function change(env: NodeJS.ProcessEnv, fields: Record<string, unknown>) {
  env[GRANT] = JSON.stringify({ ...JSON.parse(env[GRANT]!), ...fields });
}
async function harness() {
  const env = fixtureEnv();
  env.FLOWPROOF_DATA_DIR = await mkdtemp(
    path.join(tmpdir(), "runtime-trace-gate-"),
  );
  directories.push(env.FLOWPROOF_DATA_DIR);
  const tiger = vi.fn(async (_id: string) => ({ reserved: true }));
  return {
    env,
    tiger,
    reserve: (kind: "audit" | "agent") =>
      reserveRuntimeTraceExport(kind, request, tiger, env, NOW),
  };
}
async function files(env: NodeJS.ProcessEnv) {
  const directory = path.join(env.FLOWPROOF_DATA_DIR!, "provider-allowances");
  const names = await readdir(directory).catch(() => [] as string[]);
  return Object.fromEntries(
    await Promise.all(
      names
        .sort()
        .map(async (name) => [
          name,
          await readFile(path.join(directory, name), "utf8"),
        ]),
    ),
  );
}
let fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  fetcher = vi.fn<typeof fetch>(async () => {
    throw Error("Network is forbidden in offline trace gate tests");
  });
  vi.stubGlobal("fetch", fetcher);
});
afterEach(async () => {
  expect(fetcher).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("dedicated runtime trace export authorization", () => {
  it("accepts only the fresh separately bound two-export grant without mutating prior proof bytes", () => {
    const env = fixtureEnv();
    const original = { ...env };
    expect(runtimeTraceConfiguration(env, NOW)).toMatchObject({
      proof: {
        maximumExports: 2,
        usedExports: 0,
        maximumEnvelopesPerExport: 2,
        payAsYouGoLimitUsd: 0,
        plan: "Sponsored Team",
      },
      proofSha256: sha(env[GRANT]!),
    });
    expect(env).toEqual(original);
  });

  it.each([
    "BRIEFSTAMP_RUNTIME_TRACE_ENABLED",
    "FLOWPROOF_SENTRY_ENABLED",
    "FLOWPROOF_SENTRY_FREE_CONFIRMED",
    "FLOWPROOF_SENTRY_FREE_CONFIRMED_AT",
    "SENTRY_DSN",
    "FLOWPROOF_TOKEN",
    GRANT,
    AGENT,
  ])(
    "requires %s instead of inferring authorization from another grant",
    (name) => {
      const env = fixtureEnv();
      delete env[name];
      expect(runtimeTraceConfiguration(env, NOW)).toBeNull();
    },
  );

  it.each([
    { usedExports: 1 },
    { usedExports: 2 },
    { maximumExports: 3 },
    { maximumEnvelopesPerExport: 3 },
    { payAsYouGoLimitUsd: 1 },
    { plan: "Team" },
    { sentryDsnSha256: "0".repeat(64) },
    { agentProofSha256: "0".repeat(64) },
    { checkedAt: new Date(NOW + 1).toISOString() },
    { checkedAt: new Date(NOW - 86_400_001).toISOString() },
    { expiresAt: new Date(NOW).toISOString() },
    { expiresAt: new Date(NOW + 86_400_001).toISOString() },
    { evidence: "short" },
    { unknown: true },
  ])("rejects broadened, spent or stale trace authorization: %j", (values) => {
    const env = fixtureEnv();
    change(env, values);
    expect(runtimeTraceConfiguration(env, NOW)).toBeNull();
  });

  it("cannot extend the original Sentry confirmation window even with a fresh grant", () => {
    const env = fixtureEnv();
    change(env, { expiresAt: new Date(NOW + 23 * 3_600_000).toISOString() });
    expect(runtimeTraceConfiguration(env, NOW)).not.toBeNull();
    change(env, {
      expiresAt: new Date(NOW + 23 * 3_600_000 + 1).toISOString(),
    });
    expect(runtimeTraceConfiguration(env, NOW)).toBeNull();
    env.FLOWPROOF_SENTRY_FREE_CONFIRMED_AT = new Date(
      NOW - 86_400_001,
    ).toISOString();
    expect(runtimeTraceConfiguration(env, NOW)).toBeNull();
    env.FLOWPROOF_SENTRY_FREE_CONFIRMED_AT = new Date(NOW + 1).toISOString();
    expect(runtimeTraceConfiguration(env, NOW)).toBeNull();
  });

  it("enforces the October 20 absolute cutoff independently of the 24-hour window", () => {
    const env = fixtureEnv();
    const now = Date.parse("2026-10-19T12:00:00Z");
    env.FLOWPROOF_SENTRY_FREE_CONFIRMED_AT = new Date(now).toISOString();
    change(env, {
      checkedAt: new Date(now).toISOString(),
      expiresAt: "2026-10-20T00:00:00Z",
    });
    expect(runtimeTraceConfiguration(env, now)).not.toBeNull();
    change(env, { expiresAt: "2026-10-20T00:00:00.001Z" });
    expect(runtimeTraceConfiguration(env, now)).toBeNull();
  });

  it("binds exact DSN and agent proof bytes, including an unspent identified agent tranche", () => {
    for (const raw of [
      "malformed",
      "null",
      "[]",
      JSON.stringify({ usedRuns: 0 }),
      JSON.stringify({ trancheId: randomUUID(), usedRuns: 1 }),
    ]) {
      const env = fixtureEnv();
      env[AGENT] = raw;
      change(env, { agentProofSha256: sha(raw) });
      expect(runtimeTraceConfiguration(env, NOW)).toBeNull();
    }
    const changedAgent = fixtureEnv();
    changedAgent[AGENT] += " ";
    expect(runtimeTraceConfiguration(changedAgent, NOW)).toBeNull();
    const changedDsn = fixtureEnv();
    changedDsn.SENTRY_DSN =
      "https://different-public-key@o123.ingest.sentry.io/456";
    expect(runtimeTraceConfiguration(changedDsn, NOW)).toBeNull();
    for (const dsn of [
      "http://public@o123.ingest.sentry.io/456",
      "https://public@example.com/456",
      "https://public:secret@o123.ingest.sentry.io/456",
      "https://public@o123.ingest.sentry.io/456?token=secret",
    ]) {
      const env = fixtureEnv();
      env.SENTRY_DSN = dsn;
      change(env, { sentryDsnSha256: sha(dsn) });
      expect(runtimeTraceConfiguration(env, NOW)).toBeNull();
    }
  });

  it("requires four distinct UUID identities even when the same UUID uses different casing", () => {
    for (const [left, right] of [
      ["grantId", "auditReservationId"],
      ["auditReservationId", "agentReservationId"],
      ["agentReservationId", "agentTranche"],
    ]) {
      const env = fixtureEnv();
      const grant = JSON.parse(env[GRANT]!);
      const target =
        right === "agentTranche"
          ? JSON.parse(env[AGENT]!).trancheId
          : grant[right];
      change(env, { [left]: target });
      expect(runtimeTraceConfiguration(env, NOW)).toBeNull();
      change(env, { [left]: target.toUpperCase() });
      expect(runtimeTraceConfiguration(env, NOW)).toBeNull();
    }
  });

  it("requires the operator token for either header representation", () => {
    const env = fixtureEnv();
    expect(
      authorizeRuntimeTrace(
        { "x-flowproof-token": env.FLOWPROOF_TOKEN },
        env,
        NOW,
      ),
    ).toBe(true);
    expect(
      authorizeRuntimeTrace(
        new Headers({ "X-FlowProof-Token": env.FLOWPROOF_TOKEN! }),
        env,
        NOW,
      ),
    ).toBe(true);
    for (const headers of [
      {},
      { "x-flowproof-token": "incorrect" },
      { "x-flowproof-token": [env.FLOWPROOF_TOKEN!] },
    ])
      expect(authorizeRuntimeTrace(headers, env, NOW)).toBe(false);
    change(env, { usedExports: 2 });
    expect(
      authorizeRuntimeTrace(
        { "x-flowproof-token": env.FLOWPROOF_TOKEN },
        env,
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects protected callers before the next JSON parser can see malformed input", () => {
    const env = fixtureEnv();
    for (const [name, value] of Object.entries(env)) vi.stubEnv(name, value);
    const boundary = runtimeTraceHttpBoundary(() => NOW);
    for (const route of [
      "/api/audits/a/runtime-trace",
      "/api/audits/a/agent-review/",
    ]) {
      const status = vi.fn().mockReturnThis(),
        json = vi.fn();
      const res = { status, json } as unknown as Response;
      const nextJsonParser = vi.fn(() => JSON.parse("{ malformed input"));
      const req = { method: "POST", path: route, headers: {} } as Request;
      Object.defineProperty(req, "body", {
        get() {
          throw Error("Body accessed before authorization");
        },
      });
      expect(() =>
        boundary(req, res, nextJsonParser as NextFunction),
      ).not.toThrow();
      expect(status).toHaveBeenCalledWith(404);
      expect(json).toHaveBeenCalledWith({
        error: "Not found in this demo session.",
      });
      expect(nextJsonParser).not.toHaveBeenCalled();
    }
    const next = vi.fn();
    boundary(
      {
        method: "POST",
        path: "/api/audits/a/runtime-trace",
        headers: { "x-flowproof-token": env.FLOWPROOF_TOKEN },
      } as unknown as Request,
      {} as Response,
      next,
    );
    expect(next).toHaveBeenCalledOnce();
    const agentNext = vi.fn(),
      status = vi.fn().mockReturnThis();
    // Minimal agent identity is enough for audit export, never the funded agent route.
    boundary(
      {
        method: "POST",
        path: "/api/audits/a/agent-review",
        headers: { "x-flowproof-token": env.FLOWPROOF_TOKEN },
      } as unknown as Request,
      { status, json: vi.fn() } as unknown as Response,
      agentNext,
    );
    expect(status).toHaveBeenCalledWith(404);
    expect(agentNext).not.toHaveBeenCalled();
  });
});

describe("nonrenewable runtime export reservations", () => {
  it("requires Tiger confirmation after durable intent and keeps separate once-only audit/agent identities", async () => {
    const h = await harness();
    const original = { ...h.env },
      grant = JSON.parse(h.env[GRANT]!);
    h.tiger.mockImplementation(async (id) => {
      const snapshot = await files(h.env);
      const kind = id === grant.auditReservationId ? "audit" : "agent";
      expect(
        JSON.parse(
          snapshot[`runtime-trace-${grant.grantId}-${kind}.intent.json`],
        ),
      ).toMatchObject({ ...request, kind, trancheId: id, neverRefund: true });
      expect(snapshot).not.toHaveProperty(
        `runtime-trace-${grant.grantId}-${kind}.tiger-reserved.json`,
      );
      return { reserved: true };
    });
    await h.reserve("audit");
    await h.reserve("agent");
    expect(h.tiger.mock.calls.map(([id]) => id)).toEqual([
      grant.auditReservationId,
      grant.agentReservationId,
    ]);
    const before = await files(h.env);
    expect(Object.keys(before)).toHaveLength(4);
    await expect(h.reserve("audit")).rejects.toThrow();
    await expect(h.reserve("agent")).rejects.toThrow();
    expect(await files(h.env)).toEqual(before);
    expect(h.env).toEqual(original);
    expect(h.tiger).toHaveBeenCalledTimes(2);
  });

  it("lets only one concurrent reservation through for each kind", async () => {
    const h = await harness();
    const results = await Promise.allSettled([
      h.reserve("audit"),
      h.reserve("agent"),
      h.reserve("audit"),
      h.reserve("agent"),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(2);
    expect(h.tiger).toHaveBeenCalledTimes(2);
    expect(Object.keys(await files(h.env))).toHaveLength(4);
  });

  it.each(["denied", "ambiguous"] as const)(
    "does not retry a %s Tiger result, while preserving the other kind",
    async (outcome) => {
      const h = await harness();
      if (outcome === "denied")
        h.tiger.mockResolvedValueOnce({ reserved: false });
      else
        h.tiger.mockRejectedValueOnce(Error("Synthetic ambiguous completion"));
      await expect(h.reserve("audit")).rejects.toThrow();
      const before = await files(h.env);
      expect(Object.keys(before)).toHaveLength(1);
      expect(Object.keys(before)[0]).toMatch(/\.intent\.json$/);
      await expect(h.reserve("audit")).rejects.toThrow();
      expect(await files(h.env)).toEqual(before);
      expect(h.tiger).toHaveBeenCalledOnce();
      await expect(h.reserve("agent")).resolves.toBeUndefined();
      expect(h.tiger).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["confirmed", "ambiguous"] as const)(
    "does not replay a %s reservation after process-local state resets",
    async (outcome) => {
      const h = await harness();
      if (outcome === "ambiguous") {
        h.tiger.mockRejectedValueOnce(Error("Synthetic ambiguous completion"));
        await expect(h.reserve("audit")).rejects.toThrow();
      } else await h.reserve("audit");
      const before = await files(h.env);
      vi.resetModules();
      const restarted = await import("../server/runtime-trace-gate.js");
      const anotherTiger = vi.fn(async () => ({ reserved: true }));
      await expect(
        restarted.reserveRuntimeTraceExport(
          "audit",
          request,
          anotherTiger,
          h.env,
          NOW,
        ),
      ).rejects.toThrow();
      expect(anotherTiger).not.toHaveBeenCalled();
      expect(await files(h.env)).toEqual(before);
    },
  );

  it("preserves old local ledgers and denies a completion-file collision after Tiger has consumed the export", async () => {
    const h = await harness();
    const grant = JSON.parse(h.env[GRANT]!),
      directory = path.join(h.env.FLOWPROOF_DATA_DIR!, "provider-allowances");
    await mkdir(directory);
    const prior = "old provider allowance bytes must remain unchanged";
    await writeFile(
      path.join(directory, "mastra-backboard-prior.intent.json"),
      prior,
    );
    const completion = `runtime-trace-${grant.grantId}-audit.tiger-reserved.json`;
    await writeFile(
      path.join(directory, completion),
      "existing completion bytes",
    );
    await expect(h.reserve("audit")).rejects.toThrow();
    await expect(h.reserve("audit")).rejects.toThrow();
    expect(h.tiger).toHaveBeenCalledOnce();
    const snapshot = await files(h.env);
    expect(snapshot[completion]).toBe("existing completion bytes");
    expect(snapshot["mastra-backboard-prior.intent.json"]).toBe(prior);
    expect(Object.keys(snapshot)).toHaveLength(3);
  });

  it("denies an export if exact grant bytes change while Tiger is reserving it", async () => {
    const h = await harness();
    h.tiger.mockImplementationOnce(async () => {
      h.env[GRANT] += " ";
      return { reserved: true };
    });
    await expect(h.reserve("audit")).rejects.toThrow();
    expect(Object.keys(await files(h.env))).toHaveLength(1);
    await expect(h.reserve("audit")).rejects.toThrow();
    expect(h.tiger).toHaveBeenCalledOnce();
  });

  it.each([
    { operation: "anything_else" },
    { units: 2 },
    { maxEnvelopes: 3 },
    { measurementSha256: "invalid" },
    { privateBrief: "never write client content" },
  ])(
    "rejects invalid reservation metadata before consuming a slot: %j",
    async (values) => {
      const h = await harness();
      await expect(
        reserveRuntimeTraceExport(
          "audit",
          { ...request, ...values } as typeof request,
          h.tiger,
          h.env,
          NOW,
        ),
      ).rejects.toThrow();
      expect(await files(h.env)).toEqual({});
      expect(h.tiger).not.toHaveBeenCalled();
      await expect(h.reserve("audit")).resolves.toBeUndefined();
    },
  );
});
