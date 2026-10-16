import express from "express";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  HOSTED_WEBSITE_BRIEF,
  HOSTED_WEBSITE_URL,
} from "../shared/hosted-target.js";
import type {
  Audit,
  Bootstrap,
  CheckResult,
  Project,
} from "../shared/types.js";
import * as hosted from "../server/hosted-optional.js";
import { createDemoRouter } from "../server/demo.js";
import { SAMPLE_URL } from "../server/sample.js";

type Provider = "serpapi" | "elevenlabs";
const now = Date.parse("2026-10-16T08:00:00Z");
const key = ["hosted", "optional", "synthetic", "not", "real"].join("-");
const token = [
  "hosted",
  "optional",
  "operator",
  "synthetic",
  "not",
  "real",
].join("-");
const directories: string[] = [];
const cleanups: Array<() => Promise<void>> = [];
const project: Project = {
  id: "synthetic-project",
  name: "Private project name",
  target: "website",
  url: HOSTED_WEBSITE_URL,
  authorized: true,
  brief: HOSTED_WEBSITE_BRIEF,
  sampleVariant: "healthy",
  checks: [],
  createdAt: "",
  updatedAt: "",
  generator: { provider: "Synthetic fixture", model: null },
};
const audit: Audit = {
  id: "synthetic-audit",
  projectId: "synthetic-project",
  projectName: "Private project name",
  status: "completed",
  createdAt: "",
  completedAt: "",
  source: {
    target: "sample",
    url: SAMPLE_URL,
    sampleVariant: "broken",
    brief: "Private source brief",
    generator: { provider: "Synthetic fixture", model: null },
  },
  checks: [],
  results: [
    {
      checkId: "synthetic-check",
      requirement: "Private client requirement",
      kind: "heading",
      expected: "Private expectation",
      status: "failed",
      durationMs: 1,
      evidence: {
        observed: "Private evidence",
        url: SAMPLE_URL,
        viewport: { width: 100, height: 100 },
      },
    },
  ],
};
const proofName = (provider: Provider) =>
  `BRIEFSTAMP_HOSTED_${provider.toUpperCase()}_PROOF_JSON`;
async function environment(provider: Provider): Promise<NodeJS.ProcessEnv> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "briefstamp-hosted-optional-"),
  );
  directories.push(directory);
  return {
    FLOWPROOF_DATA_DIR: directory,
    FLOWPROOF_TOKEN: token,
    [`${provider.toUpperCase()}_API_KEY`]: key,
    [`BRIEFSTAMP_HOSTED_${provider.toUpperCase()}_ENABLED`]: "true",
    ELEVENLABS_VOICE_ID: hosted.HOSTED_SAMPLE_VOICE_ID,
    BRIEFSTAMP_ELEVENLABS_STOCK_VOICE_CONFIRMED: "true",
    BRIEFSTAMP_ELEVENLABS_NONCOMMERCIAL_DEMO: "true",
    [proofName(provider)]: JSON.stringify({
      credentialSha256: createHash("sha256").update(key).digest("hex"),
      checkedAt: "2026-10-16T07:00:00Z",
      expiresAt: "2026-10-17T07:00:00Z",
      evidence: "Synthetic test proof, not real provider entitlement",
      freeOnly: true,
      paidOverageDisabled: true,
      confirmedFreeUnits: provider === "serpapi" ? 100 : 1000,
      usedUnits: 0,
      maxCalls: 1,
      usedCalls: 0,
      unit: provider === "serpapi" ? "requests" : "characters",
      operations: [
        provider === "serpapi" ? "search-visibility" : "sample-speech",
      ],
      maxUnits: provider === "serpapi" ? 1 : 1000,
    }),
  };
}
function amend(
  env: NodeJS.ProcessEnv,
  provider: Provider,
  values: Record<string, unknown>,
) {
  env[proofName(provider)] = JSON.stringify({
    ...JSON.parse(env[proofName(provider)]!),
    ...values,
  });
}
async function saved(filename: string, provider: Provider) {
  return JSON.parse(await readFile(filename, "utf8")).providers[provider];
}
const invoke = (
  provider: Provider,
  options: Parameters<typeof hosted.hostedOptionalOptions>[1],
) =>
  provider === "serpapi"
    ? hosted.searchHostedHomepage(project, options)
    : hosted.narrateHostedSample(audit, options);
const success = (provider: Provider) =>
  provider === "serpapi"
    ? Response.json({
        search_metadata: { status: "Success" },
        organic_results: [
          { title: "Briefstamp", link: HOSTED_WEBSITE_URL, position: 1 },
        ],
      })
    : new Response(Buffer.from([73, 68, 51, 1]), {
        headers: { "content-type": "audio/mpeg", "character-cost": "418" },
      });

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const cleanup of cleanups.splice(0)) await cleanup();
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe.each<Provider>(["serpapi", "elevenlabs"])(
  "hosted %s confirmed-free operator boundary",
  (provider) => {
    it("requires exact header authorization and creates no file for availability checks", async () => {
      const env = await environment(provider);
      expect(hosted.hostOptionalEnabled(provider, env, now)).toBe(true);
      for (const headers of [
        {},
        { "x-flowproof-token": token + "wrong" },
        { "x-flowproof-token": [token, token] },
      ])
        expect(
          hosted.authorizeHostedOptional(provider, headers, env, now),
        ).toBe(false);
      expect(
        hosted.authorizeHostedOptional(
          provider,
          { "x-flowproof-token": token },
          env,
          now,
        ),
      ).toBe(true);
      expect(
        hosted.authorizeHostedOptional(
          provider,
          new Headers({ "X-FlowProof-Token": token }),
          env,
          now,
        ),
      ).toBe(true);
      expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
    });
    it.each([
      { credentialSha256: "0".repeat(64) },
      { checkedAt: "2026-10-14T07:00:00Z" },
      { checkedAt: "2026-10-16T08:01:00Z" },
      { expiresAt: "2026-10-16T08:00:00Z" },
      { expiresAt: "2026-10-18T07:00:00Z" },
      { freeOnly: false },
      { paidOverageDisabled: false },
      { confirmedFreeUnits: 0 },
      { maxUnits: 1001 },
      { maxCalls: 2 },
      { usedUnits: 1 },
      { usedCalls: 1 },
      { evidence: "" },
      { injected: true },
      { operations: ["memory-write"] },
    ])(
      "rejects unsafe proof before initialization or network %j",
      async (change) => {
        const env = await environment(provider);
        amend(env, provider, change);
        const fetcher = vi.fn<typeof fetch>();
        expect(hosted.hostOptionalEnabled(provider, env, now)).toBe(false);
        expect(
          hosted.authorizeHostedOptional(
            provider,
            { "x-flowproof-token": token },
            env,
            now,
          ),
        ).toBe(false);
        await expect(
          invoke(provider, { env, now: () => now, fetcher }),
        ).rejects.toMatchObject({ code: "disabled" });
        expect(fetcher).not.toHaveBeenCalled();
        expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
      },
    );
    it("fails closed for disabled, malformed, missing, mismatched or insufficient configuration", async () => {
      const initial = await environment(provider);
      for (const changes of [
        { [`BRIEFSTAMP_HOSTED_${provider.toUpperCase()}_ENABLED`]: "false" },
        { [proofName(provider)]: "invalid-json" },
        { [proofName(provider)]: "x".repeat(16385) },
        { [`${provider.toUpperCase()}_API_KEY`]: "short" },
        { FLOWPROOF_TOKEN: "short" },
      ]) {
        const env = { ...initial, ...changes };
        expect(hosted.hostOptionalEnabled(provider, env, now)).toBe(false);
        await expect(
          hosted.hostedOptionalOptions(provider, { env, now: () => now }),
        ).rejects.toMatchObject({ code: "disabled" });
      }
      amend(initial, provider, {
        confirmedFreeUnits: provider === "serpapi" ? 1 : 999,
      });
      if (provider === "elevenlabs")
        expect(hosted.hostOptionalEnabled(provider, initial, now)).toBe(false);
      expect(await readdir(initial.FLOWPROOF_DATA_DIR!)).toEqual([]);
    });
    it("reserves one bounded call before transport and never forwards ambient secrets", async () => {
      const env = await environment(provider);
      env.DATABASE_URL = "excluded-synthetic-database";
      env.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE =
        "/tmp/ambient-untrusted-ledger.json";
      env.BRIEFSTAMP_SEARCH_DOMAINS = "attacker.invalid";
      const options = await hosted.hostedOptionalOptions(provider, {
        env,
        now: () => now,
      });
      const filename = options.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!;
      for (const name of [
        "DATABASE_URL",
        "FLOWPROOF_TOKEN",
        proofName(provider),
      ])
        expect(options.env).not.toHaveProperty(name);
      const fetcher = vi.fn<typeof fetch>(async (url, init) => {
        const stored = await saved(filename, provider);
        expect(stored.usedCalls).toBe(1);
        expect(stored.usedUnits).toBeGreaterThan(0);
        expect(stored.usedUnits).toBeLessThanOrEqual(
          provider === "serpapi" ? 1 : 1000,
        );
        expect(init?.redirect).toBe("error");
        if (provider === "serpapi") {
          expect(new URL(String(url)).searchParams.get("q")).toBe(
            "site:flowproof-demo.onrender.com",
          );
        } else {
          expect(String(url)).toContain(
            `/text-to-speech/${hosted.HOSTED_SAMPLE_VOICE_ID}`,
          );
          const body = String(init?.body);
          for (const privateValue of [
            audit.projectName,
            audit.source!.brief,
            audit.results[0].requirement,
            audit.results[0].expected,
            audit.results[0].evidence.observed,
          ])
            expect(body).not.toContain(privateValue);
        }
        return success(provider);
      });
      const result = await invoke(provider, { env, now: () => now, fetcher });
      if (provider === "serpapi")
        expect(result).toMatchObject({
          status: "observed",
          limitation: expect.stringContaining("not proof"),
        });
      else
        expect(result).toMatchObject({
          mimeType: "audio/mpeg",
          attribution: expect.stringContaining("Noncommercial synthetic"),
          reservedCharacters: expect.any(Number),
        });
      await expect(
        invoke(provider, { env, now: () => now, fetcher }),
      ).rejects.toMatchObject({ code: "budget_exhausted" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it("does not reset a consumed allowance when proof field order or ambient settings change", async () => {
      const env = await environment(provider);
      const fetcher = vi.fn<typeof fetch>(async () => success(provider));
      await invoke(provider, { env, now: () => now, fetcher });
      env[proofName(provider)] = JSON.stringify(
        Object.fromEntries(
          Object.entries(JSON.parse(env[proofName(provider)]!)).reverse(),
        ),
      );
      env.BRIEFSTAMP_SEARCH_DOMAINS = "example.invalid";
      await expect(
        invoke(provider, { env, now: () => now, fetcher }),
      ).rejects.toMatchObject({ code: "budget_exhausted" });
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it("concurrent calls cannot overdraw the one-call reservation", async () => {
      const env = await environment(provider);
      const fetcher = vi.fn<typeof fetch>(async () => success(provider));
      const results = await Promise.allSettled([
        invoke(provider, { env, now: () => now, fetcher }),
        invoke(provider, { env, now: () => now, fetcher }),
      ]);
      expect(
        results.filter((result) => result.status === "fulfilled"),
      ).toHaveLength(1);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });
    it.each(["transport", "http", "invalid-body"])(
      "a %s failure consumes the only call without refund or retry",
      async (failure) => {
        const env = await environment(provider);
        const fetcher = vi.fn<typeof fetch>(async () => {
          if (failure === "transport")
            throw new Error("Synthetic transport failure");
          if (failure === "http") return new Response(null, { status: 503 });
          return new Response("invalid-response", {
            headers: { "content-type": "text/plain" },
          });
        });
        const setup = await hosted.hostedOptionalOptions(provider, {
          env,
          now: () => now,
        });
        await expect(
          invoke(provider, { env, now: () => now, fetcher }),
        ).rejects.toBeInstanceOf(Error);
        const before = await saved(
          setup.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!,
          provider,
        );
        expect(before.usedCalls).toBe(1);
        await expect(
          invoke(provider, { env, now: () => now, fetcher }),
        ).rejects.toMatchObject({ code: "budget_exhausted" });
        expect(
          await saved(setup.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!, provider),
        ).toEqual(before);
        expect(fetcher).toHaveBeenCalledTimes(1);
      },
    );
    it.each(["corrupt", "widened"])(
      "never repairs an existing %s ledger",
      async (kind) => {
        const env = await environment(provider);
        const fetcher = vi.fn<typeof fetch>();
        const setup = await hosted.hostedOptionalOptions(provider, {
          env,
          now: () => now,
        });
        const filename = setup.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!;
        let modified = "corrupt-ledger";
        if (kind === "widened") {
          const raw = JSON.parse(await readFile(filename, "utf8"));
          raw.providers[provider].maxCalls = 2;
          modified = JSON.stringify(raw);
        }
        await writeFile(filename, modified);
        await expect(
          invoke(provider, { env, now: () => now, fetcher }),
        ).rejects.toMatchObject({ code: "free_confirmation_required" });
        expect(await readFile(filename, "utf8")).toBe(modified);
        expect(fetcher).not.toHaveBeenCalled();
      },
    );
  },
);

describe("hosted optional input restrictions", () => {
  it("rejects substituted sites and unauthorized samples before allowance files", async () => {
    const env = await environment("serpapi");
    const fetcher = vi.fn<typeof fetch>();
    for (const change of [
      { url: "https://example.org/" },
      { url: HOSTED_WEBSITE_URL + "another-page" },
      { authorized: false },
      { target: "sample" as const },
    ])
      await expect(
        hosted.searchHostedHomepage(
          { ...project, ...change },
          { env, now: () => now, fetcher },
        ),
      ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects incomplete, real-site or substituted sample audits before files", async () => {
    const env = await environment("elevenlabs");
    const fetcher = vi.fn<typeof fetch>();
    for (const value of [
      { ...audit, status: "running" as const },
      { ...audit, results: [] },
      { ...audit, source: { ...audit.source!, target: "website" as const } },
      { ...audit, source: { ...audit.source!, url: HOSTED_WEBSITE_URL } },
    ])
      await expect(
        hosted.narrateHostedSample(value, { env, now: () => now, fetcher }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    expect(await readdir(env.FLOWPROOF_DATA_DIR!)).toEqual([]);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([
    { ELEVENLABS_VOICE_ID: "another20charvoiceidX" },
    { BRIEFSTAMP_ELEVENLABS_STOCK_VOICE_CONFIRMED: "false" },
    { BRIEFSTAMP_ELEVENLABS_NONCOMMERCIAL_DEMO: "false" },
  ])(
    "requires confirmed fixed stock voice and noncommercial scope %j",
    async (change) => {
      const env = { ...(await environment("elevenlabs")), ...change };
      const fetcher = vi.fn<typeof fetch>();
      expect(hosted.hostOptionalEnabled("elevenlabs", env, now)).toBe(false);
      await expect(
        hosted.narrateHostedSample(audit, { env, now: () => now, fetcher }),
      ).rejects.toMatchObject({ code: "disabled" });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
});

async function harness(hold = false) {
  const evidenceRoot = await mkdtemp(
    path.join(os.tmpdir(), "briefstamp-optional-routes-"),
  );
  directories.push(evidenceRoot);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  if (!hold) release();
  const router = createDemoRouter({
    evidenceRoot,
    secureCookie: false,
    now: () => now,
    gemmaAvailable: () => false,
    tinkerAvailable: () => false,
    tigerAvailable: () => false,
    execute: async (_project, a, onResult) => {
      await gate;
      const results: CheckResult[] = a.checks.map((check) => ({
        checkId: check.id,
        requirement: check.requirement,
        kind: check.kind,
        expected: check.expected,
        status: check.kind === "manual" ? "unverified" : "failed",
        durationMs: 1,
        evidence: {
          observed: "Injected synthetic test evidence, not a browser receipt",
          url: a.source!.url,
          viewport: { width: 1365, height: 900 },
        },
      }));
      for (const result of results) await onResult(result);
      return results;
    },
  });
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(router.router);
  app.use(
    (
      error: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res
        .status(error instanceof z.ZodError ? 400 : 500)
        .json({ error: "Request rejected." });
    },
  );
  const server = await new Promise<Server>((resolve, reject) => {
    const listening = app.listen(0, "127.0.0.1", (error?: Error) =>
      error ? reject(error) : resolve(listening),
    );
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    release();
    await router.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  const request = (
    route: string,
    cookie = "",
    body?: unknown,
    suppliedToken?: string,
    method = body === undefined ? "GET" : "POST",
  ) =>
    fetch(base + route, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(suppliedToken ? { "x-flowproof-token": suppliedToken } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const visitor = async () => {
    const response = await request("/api/bootstrap");
    const body: Bootstrap = await response.json();
    return {
      cookie: response.headers.get("set-cookie")!.split(";")[0],
      project: body.projects[0],
    };
  };
  const liveProject = async (cookie: string) => {
    const response = await request("/api/projects/preset", cookie, {
      preset: "briefstamp-live",
    });
    expect(response.status).toBe(201);
    return (await response.json()) as Project;
  };
  const start = async (p: Project, cookie: string) => {
    expect(
      (
        await request(
          `/api/projects/${p.id}/checks`,
          cookie,
          { checks: p.checks.map((check) => ({ ...check, approved: true })) },
          undefined,
          "PUT",
        )
      ).status,
    ).toBe(200);
    const response = await request(`/api/projects/${p.id}/audits`, cookie, {});
    expect(response.status).toBe(202);
    return (await response.json()) as Audit;
  };
  const completed = async (id: string, cookie: string) => {
    for (let attempt = 0; attempt < 20; attempt++) {
      const a = (await (
        await request(`/api/audits/${id}`, cookie)
      ).json()) as Audit;
      if (a.status === "completed") return a;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Injected audit did not finish");
  };
  return { request, visitor, liveProject, start, completed, release };
}
async function routeSetup() {
  for (const provider of ["serpapi", "elevenlabs"] as const)
    for (const [name, value] of Object.entries(await environment(provider)))
      if (value !== undefined) vi.stubEnv(name, value);
  const search = vi
    .spyOn(hosted, "searchHostedHomepage")
    .mockResolvedValue({
      provider: "SerpApi",
      domain: "flowproof-demo.onrender.com",
      query: "site:flowproof-demo.onrender.com",
      observedAt: new Date(now).toISOString(),
      results: [],
      status: "observed",
      limitation: "An observation, never an audit pass.",
    });
  const speech = vi
    .spyOn(hosted, "narrateHostedSample")
    .mockResolvedValue({
      provider: "ElevenLabs",
      audio: Buffer.from([73, 68, 51, 1]),
      mimeType: "audio/mpeg",
      narration: "Synthetic count report",
      reservedCharacters: 418,
      reportedCharacters: null,
      attribution:
        "Voice generated with ElevenLabs. Noncommercial synthetic demonstration only.",
      limitation: "No additional verification.",
    });
  return { search, speech };
}
describe("hosted optional routes preserve visitor ownership", () => {
  it("hides protected paths from anonymous and tokenless visitors before body parsing or lookup", async () => {
    const mocks = await routeSetup();
    const h = await harness();
    const visitor = await h.visitor();
    for (const route of [
      "/api/projects/unknown/search-visibility",
      "/api/audits/unknown/spoken-report",
    ])
      for (const [cookie, suppliedToken] of [
        ["", undefined],
        ["", token],
        [visitor.cookie, undefined],
        [visitor.cookie, token + "wrong"],
      ] as const)
        expect(
          (await h.request(route, cookie, { unexpected: true }, suppliedToken))
            .status,
        ).toBe(404);
    expect(mocks.search).not.toHaveBeenCalled();
    expect(mocks.speech).not.toHaveBeenCalled();
  });
  it("searches only a session-owned live preset and never accepts arbitrary query or URL input", async () => {
    const { search, speech } = await routeSetup();
    const h = await harness();
    const owner = await h.visitor();
    const other = await h.visitor();
    const live = await h.liveProject(owner.cookie);
    expect(
      (
        await h.request(
          `/api/projects/${live.id}/search-visibility`,
          other.cookie,
          {},
          token,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request(
          `/api/projects/${owner.project.id}/search-visibility`,
          owner.cookie,
          {},
          token,
        )
      ).status,
    ).toBe(400);
    for (const body of [
      { query: "arbitrary" },
      { url: "https://example.org/" },
      { authorized: true },
      { token },
    ])
      expect(
        (
          await h.request(
            `/api/projects/${live.id}/search-visibility`,
            owner.cookie,
            body,
            token,
          )
        ).status,
      ).toBe(400);
    const response = await h.request(
      `/api/projects/${live.id}/search-visibility`,
      owner.cookie,
      {},
      token,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "observed" });
    expect(search).toHaveBeenCalledExactlyOnceWith(live);
    expect(speech).not.toHaveBeenCalled();
  });
  it("narrates only completed owned synthetic audits with fixed attribution and no body-selected text or voice", async () => {
    const { speech } = await routeSetup();
    const h = await harness();
    const owner = await h.visitor();
    const other = await h.visitor();
    const a = await h.start(owner.project, owner.cookie);
    const complete = await h.completed(a.id, owner.cookie);
    expect(
      (
        await h.request(
          `/api/audits/${a.id}/spoken-report`,
          other.cookie,
          {},
          token,
        )
      ).status,
    ).toBe(404);
    for (const body of [
      { text: "arbitrary" },
      { voice: hosted.HOSTED_SAMPLE_VOICE_ID },
      { noncommercial: true },
    ])
      expect(
        (
          await h.request(
            `/api/audits/${a.id}/spoken-report`,
            owner.cookie,
            body,
            token,
          )
        ).status,
      ).toBe(400);
    const response = await h.request(
      `/api/audits/${a.id}/spoken-report`,
      owner.cookie,
      {},
      token,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("audio/mpeg");
    expect(response.headers.get("x-briefstamp-attribution")).toBe(
      "Voice generated with ElevenLabs. Noncommercial synthetic demonstration only.",
    );
    expect(response.headers.get("x-briefstamp-scope")).toBe(
      "noncommercial-synthetic-demonstration",
    );
    expect(response.headers.get("x-briefstamp-reserved-characters")).toBe(
      "418",
    );
    expect(response.headers.get("x-briefstamp-reported-characters")).toBe(
      "unreported",
    );
    expect(Buffer.from(await response.arrayBuffer())).toEqual(
      Buffer.from([73, 68, 51, 1]),
    );
    expect(speech).toHaveBeenCalledExactlyOnceWith(complete);
    expect(
      await (await h.request(`/api/audits/${a.id}`, owner.cookie)).json(),
    ).toEqual(complete);
  });
  it("rejects unfinished or real-website speech and sanitizes provider errors without altering results", async () => {
    const { search, speech } = await routeSetup();
    const h = await harness(true);
    const owner = await h.visitor();
    const a = await h.start(owner.project, owner.cookie);
    expect(
      (
        await h.request(
          `/api/audits/${a.id}/spoken-report`,
          owner.cookie,
          {},
          token,
        )
      ).status,
    ).toBe(409);
    expect(speech).not.toHaveBeenCalled();
    h.release();
    await h.completed(a.id, owner.cookie);
    speech.mockRejectedValue(new Error("Private provider internals"));
    search.mockRejectedValue(new Error("Private provider internals"));
    const response = await h.request(
      `/api/audits/${a.id}/spoken-report`,
      owner.cookie,
      {},
      token,
    );
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("Private provider");
    const live = await h.liveProject(owner.cookie);
    const real = await h.start(live, owner.cookie);
    await h.completed(real.id, owner.cookie);
    expect(
      (
        await h.request(
          `/api/audits/${real.id}/spoken-report`,
          owner.cookie,
          {},
          token,
        )
      ).status,
    ).toBe(400);
    const searchResponse = await h.request(
      `/api/projects/${live.id}/search-visibility`,
      owner.cookie,
      {},
      token,
    );
    expect(searchResponse.status).toBe(503);
    expect(await searchResponse.text()).not.toContain("Private provider");
  });
  it("returns only configuration availability to an authenticated operator", async () => {
    const { search, speech } = await routeSetup();
    const h = await harness();
    const owner = await h.visitor();
    expect((await h.request("/api/operator/status", owner.cookie)).status).toBe(
      404,
    );
    const response = await h.request(
      "/api/operator/status",
      owner.cookie,
      undefined,
      token,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      serpapi: true,
      elevenlabs: true,
    });
    expect(search).not.toHaveBeenCalled();
    expect(speech).not.toHaveBeenCalled();
  });
});
