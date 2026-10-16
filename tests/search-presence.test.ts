import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeSearchPresence,
  SearchPresenceCheckSchema,
  type SearchPresenceCheck,
  type SearchPresenceOptions,
} from "../server/search-presence.js";
const now = Date.parse("2026-10-16T18:00:00Z");
const key = "synthetic-search-presence-credential";
const folders: string[] = [];
const check = (changes: Partial<SearchPresenceCheck> = {}) =>
  SearchPresenceCheckSchema.parse({
    id: randomUUID(),
    kind: "search_presence",
    targetUrl: "https://github.com/himanshu748",
    expectedText: "himanshu748",
    authorized: true,
    approved: true,
    ...changes,
  });
const success = (organic_results: unknown[]) => ({
  search_metadata: { status: "Success" },
  organic_results,
});
const profile = (changes: Record<string, unknown> = {}) => ({
  title: "himanshu748 · GitHub",
  link: "https://github.com/himanshu748",
  snippet: "Public developer profile",
  position: 1,
  ...changes,
});
async function harness(body: unknown = success([profile()]), status = 200) {
  const folder = await mkdtemp(
    path.join(tmpdir(), "briefstamp-search-presence-"),
  );
  folders.push(folder);
  const filename = path.join(folder, "allowance.json");
  await writeFile(
    filename,
    JSON.stringify({
      version: 1,
      providers: {
        serpapi: {
          credentialSha256: createHash("sha256").update(key).digest("hex"),
          checkedAt: "2026-10-16T17:00:00Z",
          expiresAt: "2026-10-16T19:00:00Z",
          evidence: "Synthetic isolated test allowance; not funding evidence",
          freeOnly: true,
          paidOverageDisabled: true,
          confirmedFreeUnits: 2,
          unit: "requests",
          operations: ["search-visibility"],
          maxUnits: 2,
          usedUnits: 0,
          maxCalls: 2,
          usedCalls: 0,
        },
      },
    }),
    { mode: 0o600 },
  );
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  const reserved = new Set<string>();
  const reserveCheck = vi.fn(async (value: Readonly<SearchPresenceCheck>) => {
    // Test double for the root verifier's durable ID+payload journal.
    if (reserved.has(value.id)) return false;
    reserved.add(value.id);
    return true;
  });
  const options: SearchPresenceOptions = {
    env: {
      BRIEFSTAMP_SERPAPI_ENABLED: "true",
      SERPAPI_API_KEY: key,
      BRIEFSTAMP_PROVIDER_ALLOWANCE_FILE: filename,
    },
    now: () => now,
    fetcher,
    reserveCheck,
  };
  const used = async () =>
    JSON.parse(await readFile(filename, "utf8")).providers.serpapi;
  return { options, fetcher, reserveCheck, used, filename };
}
afterEach(async () => {
  await Promise.all(
    folders
      .splice(0)
      .map((folder) => rm(folder, { recursive: true, force: true })),
  );
  vi.restoreAllMocks();
});
describe("approved search-presence observations", () => {
  it("defaults to an unapproved title check and performs no reservation before approval and ownership", async () => {
    const value = SearchPresenceCheckSchema.parse({
      id: randomUUID(),
      kind: "search_presence",
      targetUrl: "https://github.com/himanshu748",
      expectedText: "himanshu748",
    });
    expect(value).toMatchObject({
      approved: false,
      authorized: false,
      matchField: "title",
    });
    const h = await harness();
    expect(await executeSearchPresence(value, h.options)).toMatchObject({
      status: "unavailable",
      failureCode: "approval_required",
      citations: [],
    });
    expect(
      await executeSearchPresence({ ...value, approved: true }, h.options),
    ).toMatchObject({ failureCode: "authorization_required" });
    expect(h.reserveCheck).not.toHaveBeenCalled();
    expect(h.fetcher).not.toHaveBeenCalled();
    expect(await h.used()).toMatchObject({ usedCalls: 0, usedUnits: 0 });
  });

  it("matches the exact indexed profile title with one physical request and a cited field", async () => {
    const h = await harness();
    const value = check();
    const before = structuredClone(value);
    expect(await executeSearchPresence(value, h.options)).toMatchObject({
      kind: "search_presence_observation",
      status: "matched",
      matchField: "title",
      query: "site:github.com/himanshu748",
      organicResultCount: 1,
      scopedResultCount: 1,
      citations: [
        {
          title: "himanshu748 · GitHub",
          link: "https://github.com/himanshu748",
          matchesExpectedText: true,
        },
      ],
    });
    expect(h.fetcher).toHaveBeenCalledOnce();
    const [url, init] = h.fetcher.mock.calls[0];
    const request = new URL(String(url));
    expect(request.origin + request.pathname).toBe(
      "https://serpapi.com/search.json",
    );
    expect(Object.fromEntries(request.searchParams)).toEqual({
      engine: "google",
      q: "site:github.com/himanshu748",
      api_key: key,
      hl: "en",
      safe: "active",
      num: "10",
    });
    expect(init).toMatchObject({ method: "GET", redirect: "error" });
    expect(init?.headers).toBeUndefined();
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(h.reserveCheck.mock.invocationCallOrder[0]).toBeLessThan(
      h.fetcher.mock.invocationCallOrder[0],
    );
    expect(await h.used()).toMatchObject({ usedCalls: 1, usedUnits: 1 });
    expect(value).toEqual(before);
  });

  it("requires the approved selected field rather than a matching URL or unselected snippet", async () => {
    const h = await harness(
      success([
        profile({ title: "A developer profile", snippet: "himanshu748" }),
      ]),
    );
    expect(await executeSearchPresence(check(), h.options)).toMatchObject({
      status: "no_match",
      citations: [{ matchesExpectedText: false }],
    });
    expect(
      await executeSearchPresence(check({ matchField: "snippet" }), h.options),
    ).toMatchObject({ status: "matched" });
    expect(
      SearchPresenceCheckSchema.safeParse({ ...check(), matchField: "link" })
        .success,
    ).toBe(false);
  });

  it("supports the owned landing page while keeping results separate from browser acceptance", async () => {
    const h = await harness(
      success([
        profile({
          title: "Briefstamp — delivery evidence",
          link: "https://flowproof-demo.onrender.com/?utm_source=search#hero",
        }),
      ]),
    );
    const result = await executeSearchPresence(
      check({
        targetUrl: "https://flowproof-demo.onrender.com/",
        expectedText: "Briefstamp",
      }),
      h.options,
    );
    expect(result).toMatchObject({
      status: "matched",
      query: "site:flowproof-demo.onrender.com",
      citations: [{ link: "https://flowproof-demo.onrender.com/" }],
    });
    expect(result.limitation).toContain("separate from browser acceptance");
    expect(result).not.toHaveProperty("passed");
  });

  it.each([
    "https://github.com/himanshu748-other",
    "https://github.com/himanshu748/a-repository",
    "https://github.com/other",
    "https://github.com.evil.invalid/himanshu748",
    "https://github.com@evil.invalid/himanshu748",
    "https://user:password@github.com/himanshu748",
    "http://github.com/himanshu748",
    "https://github.com:444/himanshu748",
    "https://github.com/himanshu748%2Frepository",
    "https://github.com/himanshu748%5Crepository",
  ])(
    "excludes an out-of-scope or unsafe organic citation: %s",
    async (link) => {
      const h = await harness(success([profile({ link })]));
      expect(await executeSearchPresence(check(), h.options)).toMatchObject({
        status: "no_match",
        organicResultCount: 1,
        scopedResultCount: 0,
        citations: [],
      });
      expect(h.fetcher).toHaveBeenCalledOnce();
    },
  );

  it("accepts a profile trailing slash but never a demo subpage", async () => {
    const h = await harness(
      success([
        profile({
          link: "https://github.com/himanshu748/?token=private#secret",
        }),
      ]),
    );
    expect(await executeSearchPresence(check(), h.options)).toMatchObject({
      status: "matched",
      citations: [{ link: "https://github.com/himanshu748/" }],
    });
    const demo = await harness(
      success([
        profile({
          title: "Briefstamp",
          link: "https://flowproof-demo.onrender.com/private",
        }),
      ]),
    );
    expect(
      await executeSearchPresence(
        check({
          targetUrl: "https://flowproof-demo.onrender.com/",
          expectedText: "Briefstamp",
        }),
        demo.options,
      ),
    ).toMatchObject({ status: "no_match", citations: [] });
  });

  it("keeps explicit empty, no match and unavailable responses distinct", async () => {
    for (const body of [
      success([]),
      {
        search_metadata: { status: "Success" },
        search_information: { organic_results_state: "Fully empty" },
      },
      {
        search_metadata: { status: "Success" },
        search_information: { total_results: 0 },
      },
    ]) {
      const h = await harness(body);
      expect(await executeSearchPresence(check(), h.options)).toMatchObject({
        status: "empty",
        organicResultCount: 0,
        citations: [],
      });
    }
    for (const body of [
      { search_metadata: { status: "Success" } },
      { search_metadata: { status: "Processing" }, organic_results: [] },
      { organic_results: [] },
      { ...success([]), organic_results: "not-an-array" },
      "not JSON",
    ]) {
      const h = await harness(body);
      expect(await executeSearchPresence(check(), h.options)).toMatchObject({
        status: "unavailable",
        failureCode: "invalid_response",
        organicResultCount: null,
      });
      expect(h.fetcher).toHaveBeenCalledOnce();
    }
  });

  it("rejects a repeated or changed check ID and ambiguous reservation without another request", async () => {
    const h = await harness();
    const value = check();
    await executeSearchPresence(value, h.options);
    expect(await executeSearchPresence(value, h.options)).toMatchObject({
      status: "unavailable",
      failureCode: "already_reserved",
    });
    expect(
      await executeSearchPresence(
        { ...value, expectedText: "different" },
        h.options,
      ),
    ).toMatchObject({ failureCode: "already_reserved" });
    h.reserveCheck.mockRejectedValueOnce(new Error("private journal path"));
    const error = await executeSearchPresence(check(), h.options);
    expect(error).toMatchObject({ failureCode: "reservation_unavailable" });
    expect(JSON.stringify(error)).not.toContain("private journal path");
    expect(h.fetcher).toHaveBeenCalledOnce();
  });

  it.each([400, 429, 500, 503])(
    "never retries or refunds an HTTP %i response",
    async (status) => {
      const h = await harness({ error: `private data ${key}` }, status);
      const value = check();
      const result = await executeSearchPresence(value, h.options);
      expect(result).toMatchObject({
        status: "unavailable",
        failureCode: "provider_rejected",
      });
      expect(JSON.stringify(result)).not.toContain(key);
      expect(h.fetcher).toHaveBeenCalledOnce();
      expect(await h.used()).toMatchObject({ usedCalls: 1, usedUnits: 1 });
      expect(await executeSearchPresence(value, h.options)).toMatchObject({
        failureCode: "already_reserved",
      });
      expect(h.fetcher).toHaveBeenCalledOnce();
    },
  );

  it("never retries an ambiguous network timeout and leaves the allowance consumed", async () => {
    const h = await harness();
    h.fetcher.mockRejectedValue(new Error(`timeout ${key}`));
    const result = await executeSearchPresence(check(), h.options);
    expect(result).toMatchObject({
      status: "unavailable",
      failureCode: "request_failed",
    });
    expect(h.fetcher).toHaveBeenCalledOnce();
    expect(await h.used()).toMatchObject({ usedCalls: 1 });
    expect(JSON.stringify(result)).not.toContain(key);
  });

  it("requires fresh bound funding and preserves the dedicated two-call ceiling", async () => {
    const h = await harness();
    await executeSearchPresence(check(), h.options);
    await executeSearchPresence(check(), h.options);
    expect(await executeSearchPresence(check(), h.options)).toMatchObject({
      status: "unavailable",
      failureCode: "budget_exhausted",
    });
    expect(h.fetcher).toHaveBeenCalledTimes(2);
    const stale = await harness();
    expect(
      await executeSearchPresence(check(), {
        ...stale.options,
        now: () => Date.parse("2026-10-16T20:00:00Z"),
      }),
    ).toMatchObject({ failureCode: "free_confirmation_required" });
    expect(stale.fetcher).not.toHaveBeenCalled();
  });

  it("rejects arbitrary target, query/header injection, private expected text and extra input fields before reservation", async () => {
    const h = await harness();
    for (const value of [
      { ...check(), targetUrl: "https://arbitrary.invalid/" },
      {
        ...check(),
        targetUrl: "https://github.com/himanshu748?api_key=secret",
      },
      { ...check(), expectedText: "person@example.com" },
      { ...check(), expectedText: "<script>private</script>" },
      { ...check(), headers: { Authorization: "private" } },
      { ...check(), query: "unapproved search" },
    ]) {
      await expect(
        executeSearchPresence(value, h.options),
      ).rejects.toMatchObject({ code: "invalid_check" });
    }
    expect(h.reserveCheck).not.toHaveBeenCalled();
    expect(h.fetcher).not.toHaveBeenCalled();
  });

  it("only matches the exact normalized title phrase and redacts returned text", async () => {
    const h = await harness(
      success([
        profile({
          title: "nothimanshu748",
          snippet: `person@example.com api_key=${key} <b>public</b>`,
        }),
      ]),
    );
    const result = await executeSearchPresence(check(), h.options);
    expect(result.status).toBe("no_match");
    expect(JSON.stringify(result)).not.toContain(key);
    expect(JSON.stringify(result)).not.toContain("person@example.com");
    expect(result.citations[0].snippet).not.toMatch(/[<>]/);
    const normalized = await harness(
      success([profile({ title: "HIMANSHU748 · GitHub" })]),
    );
    expect(
      (await executeSearchPresence(check(), normalized.options)).status,
    ).toBe("matched");
  });

  it("does not manufacture matching text through redaction or deleting boundaries", async () => {
    const redacted = await harness(success([profile({ title: key })]));
    const result = await executeSearchPresence(
      check({ expectedText: "redacted credential" }),
      redacted.options,
    );
    expect(result).toMatchObject({
      status: "no_match",
      citations: [
        { title: "[redacted credential]", matchesExpectedText: false },
      ],
    });
    for (const title of [
      "hi<manshu748",
      "hi\nmanshu748",
      "hi\u202emanshu748",
    ]) {
      const h = await harness(success([profile({ title })]));
      expect((await executeSearchPresence(check(), h.options)).status).toBe(
        "no_match",
      );
    }
  });

  it("bounds malformed and oversized response bodies without extra requests", async () => {
    const h = await harness(success([profile({ snippet: "x".repeat(7000) })]));
    expect(await executeSearchPresence(check(), h.options)).toMatchObject({
      failureCode: "invalid_response",
    });
    const oversized = await harness("x".repeat(65537));
    expect(
      await executeSearchPresence(check(), oversized.options),
    ).toMatchObject({ failureCode: "invalid_response" });
    expect(oversized.fetcher).toHaveBeenCalledOnce();
  });
});
