import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Audit, Project } from "../shared/types.js";
import {
  rememberAudit,
  recallProjectMemory,
} from "../server/providers/backboard.js";
import { checkSearchVisibility } from "../server/providers/serpapi.js";
import {
  createSpokenSampleReport,
  sampleNarration,
} from "../server/providers/elevenlabs.js";
import {
  boundedBytes,
  providerRequest,
  reserveProviderUse,
  type OptionalProvider,
  type ProviderOptions,
} from "../server/providers/free-resource-policy.js";

const now = Date.parse("2026-10-15T08:00:00Z");
const key = "test-only-provider-key";
const dirs: string[] = [];
const audit: Audit = {
  id: "audit-private",
  projectId: "project-private",
  projectName: "Private Client Name",
  status: "completed",
  createdAt: "2026-10-15T07:00:00Z",
  completedAt: "2026-10-15T07:01:00Z",
  source: {
    target: "sample",
    url: "https://private.example.test",
    brief: "Secret customer brief",
    sampleVariant: "broken",
    generator: { provider: "test", model: null },
  },
  checks: [],
  results: [
    {
      checkId: "private-check",
      requirement: "Private requirement name@mail.example",
      kind: "heading",
      status: "failed",
      expected: "Private heading",
      evidence: {
        observed: "Bearer secret-token-value",
        url: "https://private.example.test",
        viewport: { width: 100, height: 100 },
      },
      durationMs: 1,
    },
    {
      checkId: "manual-check",
      requirement: "Private judgment",
      kind: "manual",
      status: "unverified",
      expected: "",
      evidence: {
        observed: "Needs review",
        url: "",
        viewport: { width: 100, height: 100 },
      },
      durationMs: 1,
    },
  ],
};
const project: Project = {
  id: "p",
  name: "Private project",
  url: "https://flowproof-demo.onrender.com/",
  authorized: true,
  target: "website",
  sampleVariant: "healthy",
  brief: "private brief",
  checks: [],
  createdAt: "",
  updatedAt: "",
  generator: { provider: "test", model: null },
};
async function setup(
  provider: OptionalProvider,
  fetcher: typeof fetch,
  changes: Record<string, unknown> = {},
): Promise<ProviderOptions> {
  const directory = await mkdtemp(
    path.join(os.tmpdir(), "briefstamp-provider-test-"),
  );
  dirs.push(directory);
  const filename = path.join(directory, "allowance.json");
  await writeFile(
    filename,
    JSON.stringify({
      version: 1,
      providers: {
        [provider]: {
          credentialSha256: createHash("sha256").update(key).digest("hex"),
          checkedAt: "2026-10-15T07:00:00Z",
          expiresAt: "2026-10-15T09:00:00Z",
          evidence: "Synthetic test fixture, not a real allowance",
          freeOnly: true,
          paidOverageDisabled: true,
          unit:
            provider === "elevenlabs"
              ? "characters"
              : provider === "tinker"
                ? "tokens"
                : "requests",
          operations: [
            "memory-write",
            "memory-search",
            "search-visibility",
            "sample-speech",
            "generate-checks",
          ],
          confirmedFreeUnits: 2000,
          maxUnits: 2000,
          usedUnits: 0,
          maxCalls: 4,
          usedCalls: 0,
          ...changes,
        },
      },
    }),
  );
  return {
    env: {
      [`BRIEFSTAMP_${provider.toUpperCase()}_ENABLED`]: "true",
      [`${provider.toUpperCase()}_API_KEY`]: key,
      BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: filename,
      BACKBOARD_ASSISTANT_ID: "123e4567-e89b-42d3-a456-426614174000",
      BRIEFSTAMP_SEARCH_DOMAINS: "flowproof-demo.onrender.com",
      ELEVENLABS_VOICE_ID: "JBFqnCBsd6RMkjVDRZzb",
      BRIEFSTAMP_ELEVENLABS_NONCOMMERCIAL_DEMO: "true",
    },
    fetcher,
    now: () => now,
  };
}
afterEach(async () => {
  for (const directory of dirs.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("optional provider free-resource boundary", () => {
  it("sends nothing when disabled or lacking fresh free evidence", async () => {
    const transport = vi.fn();
    await expect(
      rememberAudit(audit, { env: {}, fetcher: transport }),
    ).rejects.toMatchObject({ code: "disabled" });
    const options = await setup("backboard", transport, {
      checkedAt: "2026-10-13T07:00:00Z",
    });
    await expect(rememberAudit(audit, options)).rejects.toMatchObject({
      code: "free_confirmation_required",
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    { paidOverageDisabled: false },
    { freeOnly: false },
    { expiresAt: "2026-10-15T07:59:59Z" },
    { checkedAt: "2026-10-15T08:01:00Z" },
    { credentialSha256: "0".repeat(64) },
    { operations: ["sample-speech"] },
  ])("rejects unsafe allowance %j before transport", async (changes) => {
    const transport = vi.fn();
    const options = await setup("backboard", transport, changes);
    await expect(rememberAudit(audit, options)).rejects.toMatchObject({
      code: "free_confirmation_required",
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it("persists a reservation before transport and never refunds or retries failure", async () => {
    const transport = vi.fn(async () => {
      throw new Error(`secret ${key}`);
    });
    const options = await setup("backboard", transport, { maxCalls: 1 });
    await expect(rememberAudit(audit, options)).rejects.toMatchObject({
      code: "request_failed",
      message: expect.not.stringContaining(key),
    });
    await expect(rememberAudit(audit, options)).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    const ledger = JSON.parse(
      await readFile(options.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!, "utf8"),
    );
    expect(ledger.providers.backboard.usedCalls).toBe(1);
    expect(ledger.providers.backboard.usedUnits).toBe(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("concurrent calls cannot overdraw the persistent allowance", async () => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 201 }),
    );
    const options = await setup("backboard", transport, { maxCalls: 1 });
    const results = await Promise.allSettled([
      rememberAudit(audit, options),
      rememberAudit(audit, options),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("forbids custom endpoints and keeps redirects disabled", async () => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 201 }),
    );
    const options = await setup("backboard", transport);
    await expect(
      providerRequest(
        "backboard",
        new URL("https://example.com/private"),
        {},
        "memory-write",
        1,
        "requests",
        options,
      ),
    ).rejects.toMatchObject({ code: "unsafe_endpoint" });
    expect(transport).not.toHaveBeenCalled();
    await rememberAudit(audit, options);
    expect(transport.mock.calls[0]?.[1]).toMatchObject({
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
  });
  it("rejects credentials for a different account before spending a reservation", async () => {
    const transport = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 201 }),
    );
    const options = await setup("backboard", transport);
    await expect(
      providerRequest(
        "backboard",
        new URL(
          "https://app.backboard.io/api/assistants/123e4567-e89b-42d3-a456-426614174000/memories",
        ),
        { method: "POST", headers: { "X-API-Key": "different-account-key" } },
        "memory-write",
        1,
        "requests",
        options,
      ),
    ).rejects.toMatchObject({ code: "not_configured" });
    const ledger = JSON.parse(
      await readFile(options.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!, "utf8"),
    );
    expect(ledger.providers.backboard.usedCalls).toBe(0);
    expect(transport).not.toHaveBeenCalled();
  });
  it("bounds streamed responses without trusting content-length", async () => {
    await expect(
      boundedBytes(new Response("x".repeat(101)), 100),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("Tinker shared reservation contract", () => {
  it("reserves the bounded token allowance without any provider transport", async () => {
    const transport = vi.fn();
    const options = await setup("tinker", transport, {
      unit: "tokens",
      operations: ["generate-checks"],
      maxUnits: 1500,
    });
    await reserveProviderUse(
      "tinker",
      key,
      "generate-checks",
      1000,
      "tokens",
      options,
    );
    await expect(
      reserveProviderUse(
        "tinker",
        key,
        "generate-checks",
        501,
        "tokens",
        options,
      ),
    ).rejects.toMatchObject({ code: "budget_exhausted" });
    delete options.env!.BRIEFSTAMP_TINKER_ENABLED;
    await expect(
      reserveProviderUse(
        "tinker",
        key,
        "generate-checks",
        1,
        "tokens",
        options,
      ),
    ).rejects.toMatchObject({ code: "disabled" });
    expect(transport).not.toHaveBeenCalled();
  });
});

describe("Backboard anonymous project memory contract", () => {
  it("writes only structured anonymous outcomes and retrieves only the same project", async () => {
    let memory = "";
    const transport = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toMatch(
        /^https:\/\/app.backboard.io\/api\/assistants\//,
      );
      expect(init?.headers).toMatchObject({ "X-API-Key": key });
      const body = JSON.parse(String(init?.body));
      if (String(url).endsWith("/search"))
        return Response.json({
          memories: [
            { content: memory, score: 0.9 },
            {
              content: memory.replace(
                JSON.parse(memory).project,
                "f".repeat(64),
              ),
              score: 0.99,
            },
            { content: "untrusted private content", score: 1 },
          ],
          total_count: 3,
        });
      memory = body.content;
      expect(String(init?.body)).not.toMatch(
        /Private|private|Bearer|name@mail|Secret/,
      );
      return new Response(null, { status: 201 });
    });
    const options = await setup("backboard", transport);
    expect(await rememberAudit(audit, options)).toMatchObject({
      status: "accepted",
      persistedAndRetrieved: false,
    });
    const result = await recallProjectMemory(
      audit.projectId,
      "heading",
      options,
    );
    expect(result.memories).toHaveLength(1);
    expect(result.memories[0].facts[0]).toEqual({
      kind: "heading",
      status: "failed",
    });
  });
  it("does not claim memory retrieval when the API shape changes", async () => {
    const options = await setup(
      "backboard",
      vi.fn(async () => Response.json({ success: true })),
    );
    await expect(
      recallProjectMemory("p", "heading", options),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});

describe("SerpApi bounded visibility contract", () => {
  it("queries only an allowlisted domain and filters unrelated/unsafe results", async () => {
    const transport = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      expect(url.origin + url.pathname).toBe("https://serpapi.com/search.json");
      expect(url.searchParams.get("q")).toBe(
        "site:flowproof-demo.onrender.com",
      );
      expect(url.searchParams.get("api_key")).toBe(key);
      return Response.json({
        search_metadata: { status: "Success" },
        organic_results: [
          {
            title: "Briefstamp",
            link: "https://flowproof-demo.onrender.com/#demo",
            position: 1,
          },
          { title: "Elsewhere", link: "https://example.com/", position: 2 },
          { title: "Unsafe", link: "http://127.0.0.1/", position: 3 },
        ],
      });
    });
    const options = await setup("serpapi", transport);
    const result = await checkSearchVisibility(project, options);
    expect(result.status).toBe("observed");
    expect(result.results).toEqual([
      {
        title: "Briefstamp",
        url: "https://flowproof-demo.onrender.com/",
        position: 1,
      },
    ]);
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("rejects unauthorized or nonallowlisted projects before a request", async () => {
    const transport = vi.fn();
    const options = await setup("serpapi", transport);
    for (const candidate of [
      { ...project, authorized: false },
      { ...project, url: "https://example.com/" },
      { ...project, url: "https://127.0.0.1/" },
    ])
      await expect(
        checkSearchVisibility(candidate, options),
      ).rejects.toMatchObject({ code: "invalid_input" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("retains no-results as a limited observation, and rejects processing as unexecuted", async () => {
    const options = await setup(
      "serpapi",
      vi.fn(async () =>
        Response.json({ search_metadata: { status: "Success" } }),
      ),
    );
    expect((await checkSearchVisibility(project, options)).results).toEqual([]);
    options.fetcher = vi.fn(async () =>
      Response.json({ search_metadata: { status: "Processing" } }),
    );
    await expect(checkSearchVisibility(project, options)).rejects.toMatchObject(
      { code: "invalid_response" },
    );
  });
});

describe("ElevenLabs noncommercial synthetic speech contract", () => {
  it("narrates only observed counts, reserves characters and returns bounded audio", async () => {
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe("https://api.elevenlabs.io");
      expect(url.searchParams.get("output_format")).toBe("mp3_22050_32");
      const body = JSON.parse(String(init?.body));
      expect(body.model_id).toBe("eleven_multilingual_v2");
      expect(body.text).toContain("1 failed checks");
      expect(body.text).toContain("1 unverified checks");
      expect(body.text).not.toMatch(/Private|private|Bearer|Secret/);
      return new Response(new Uint8Array([73, 68, 51, 1]), {
        headers: {
          "content-type": "audio/mpeg",
          "character-cost": String(body.text.length),
        },
      });
    });
    const options = await setup("elevenlabs", transport);
    const result = await createSpokenSampleReport(audit, options);
    expect(result.audio.length).toBe(4);
    expect(result.reportedCharacters).toBe(result.reservedCharacters);
    const ledger = JSON.parse(
      await readFile(options.env!.BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE!, "utf8"),
    );
    expect(ledger.providers.elevenlabs.usedUnits).toBe(
      sampleNarration(audit).length,
    );
  });
  it("blocks private website audio and missing free-license confirmation without transport", async () => {
    const transport = vi.fn();
    const options = await setup("elevenlabs", transport);
    await expect(
      createSpokenSampleReport(
        { ...audit, source: { ...audit.source!, target: "website" } },
        options,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    delete options.env!.BRIEFSTAMP_ELEVENLABS_NONCOMMERCIAL_DEMO;
    await expect(
      createSpokenSampleReport(audit, options),
    ).rejects.toMatchObject({ code: "license_confirmation_required" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not turn malformed or empty provider output into verified audio", async () => {
    const options = await setup(
      "elevenlabs",
      vi.fn(async () => Response.json({ detail: `private ${key}` })),
    );
    await expect(
      createSpokenSampleReport(audit, options),
    ).rejects.toMatchObject({ code: "invalid_response" });
    options.fetcher = vi.fn(
      async () =>
        new Response(null, { headers: { "content-type": "audio/mpeg" } }),
    );
    await expect(
      createSpokenSampleReport(audit, options),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });
});
