import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Audit, Bootstrap, CheckResult, Project } from "../shared/types";
import {
  HOSTED_WEBSITE_BRIEF,
  HOSTED_WEBSITE_PRESET,
  HOSTED_WEBSITE_URL,
} from "../shared/hosted-target";
import { createDemoRouter } from "../server/demo";
import { generateLocalChecks } from "../server/generator";
import type { runAudit } from "../server/runner";
import type { GoogleGemmaProposalResult } from "../server/providers/gemma-google";
import { SAMPLE_URL } from "../server/sample";

const tinker = vi.hoisted(() => ({
  authorize: vi.fn(),
  enabled: vi.fn(),
  generate: vi.fn(),
}));
vi.mock("../server/hosted-tinker", () => ({
  authorizeHostedTinker: tinker.authorize,
  hostTinkerEnabled: tinker.enabled,
  generateHostedTinkerProposal: tinker.generate,
}));
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => {
  vi.resetAllMocks();
  tinker.authorize.mockReturnValue(true);
  tinker.enabled.mockReturnValue(true);
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function proposal(requirements: string[]): GoogleGemmaProposalResult {
  return {
    model: "gemma-4-26b-a4b-it",
    latencyMs: 1,
    usage: { promptTokens: 300, completionTokens: 240, totalTokens: 540 },
    checks: generateLocalChecks(requirements.join("\n")).map(
      (
        { id: _id, requirement: _requirement, approved: _approved, ...check },
        requirementIndex,
      ) => ({ ...check, requirementIndex }),
    ),
  };
}
// Route fixtures are deliberately separate from actual model/browser proof.
const observedExecution: typeof runAudit = async (project, audit, onResult) => {
  const results: CheckResult[] = audit.checks.map((check) => ({
    checkId: check.id,
    requirement: check.requirement,
    expected: check.expected,
    kind: check.kind,
    status: check.kind === "manual" ? "unverified" : "passed",
    durationMs: 1,
    evidence: {
      observed: "Isolated HTTP test fixture; not real browser evidence",
      url: project.url,
      viewport: {
        width: check.viewport === "mobile" ? 390 : 1365,
        height: 900,
      },
    },
  }));
  for (const result of results) await onResult(result);
  return results;
};

async function harness(
  options: {
    execute?: typeof runAudit;
    generateGemma?: (
      requirements: string[],
    ) => Promise<GoogleGemmaProposalResult>;
    tiger?: boolean;
    now?: () => number;
  } = {},
) {
  const evidenceRoot = await mkdtemp(
    path.join(tmpdir(), "briefstamp-owned-website-"),
  );
  const generate = vi.fn(
    options.generateGemma ??
      (async (requirements: string[]) => proposal(requirements)),
  );
  const execute = vi.fn<typeof runAudit>(options.execute ?? observedExecution);
  const pricing = vi.fn(async () => ({ verified: true }));
  const saved = new Map<string, Audit>();
  const store = {
    persistAudit: vi.fn(async (scope: string, audit: Audit) => {
      saved.set(`${scope}:${audit.id}`, structuredClone(audit));
      return {
        inserted: true,
        expiresAt: new Date(
          Date.parse(audit.createdAt) + 30 * 60_000,
        ).toISOString(),
      };
    }),
    getAudit: vi.fn(
      async (scope: string, id: string) => saved.get(`${scope}:${id}`) ?? null,
    ),
    searchFailures: vi.fn(async () => []),
    indexAuditFailures: vi.fn(async () => ({
      indexed: 0,
      matched: 0,
      skipped: 0,
      model: "all-minilm:22m" as const,
      catalogSha256: "0".repeat(64),
    })),
    searchFailuresHybrid: vi.fn(async () => []),
    reserveAgentRun: vi.fn(async () => ({ reserved: false })),
    close: vi.fn(async () => {}),
  };
  const demo = createDemoRouter({
    evidenceRoot,
    secureCookie: false,
    execute,
    now: options.now,
    gemmaAvailable: () => true,
    generateGemma: generate,
    verifyGemmaFree: pricing,
    tigerAvailable: () => options.tiger ?? false,
    tigerStore: store,
  });
  const app = express();
  app.use(express.json());
  app.use(demo.router);
  const server = await new Promise<Server>((resolve, reject) => {
    const listener = app.listen(0, "127.0.0.1", (error?: Error) =>
      error ? reject(error) : resolve(listener),
    );
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    await demo.dispose();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(evidenceRoot, { recursive: true, force: true });
  });
  const request = (
    route: string,
    cookie = "",
    body?: unknown,
    method = body === undefined ? "GET" : "POST",
  ) =>
    fetch(base + route, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const visitor = async () => {
    const response = await request("/api/bootstrap");
    const bootstrap = (await response.json()) as Bootstrap;
    return {
      cookie: response.headers.get("set-cookie")!.split(";")[0],
      bootstrap,
      sample: bootstrap.projects[0],
    };
  };
  const create = async (cookie: string) => {
    const response = await request("/api/projects/preset", cookie, {
      preset: "briefstamp-live",
    });
    expect(response.status).toBe(201);
    return response.json() as Promise<Project>;
  };
  const current = async (cookie: string, id: string) =>
    (await request(`/api/projects/${id}`, cookie)).json() as Promise<Project>;
  const approve = async (cookie: string, project: Project) => {
    const response = await request(
      `/api/projects/${project.id}/checks`,
      cookie,
      { checks: project.checks.map((check) => ({ ...check, approved: true })) },
      "PUT",
    );
    expect(response.status).toBe(200);
    return response.json() as Promise<Project>;
  };
  const completed = async (cookie: string, id: string) => {
    for (let attempt = 0; attempt < 30; attempt++) {
      const response = await request(`/api/audits/${id}`, cookie);
      const audit = (await response.json()) as Audit;
      if (["completed", "error"].includes(audit.status))
        return { response, audit };
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    throw new Error("Fixture audit did not finish");
  };
  const run = async (cookie: string, project: Project) => {
    await approve(cookie, project);
    const response = await request(
      `/api/projects/${project.id}/audits`,
      cookie,
      {},
    );
    expect(response.status).toBe(202);
    const started = (await response.json()) as Audit;
    return completed(cookie, started.id);
  };
  return {
    request,
    visitor,
    create,
    current,
    approve,
    completed,
    run,
    execute,
    generate,
    pricing,
    evidenceRoot,
    saved,
    store,
  };
}

describe("owner-authorized live website preset", () => {
  it("exposes fixed metadata and creates a real website target with six unapproved checks", async () => {
    const h = await harness();
    const v = await h.visitor();
    expect(v.sample.target).toBe("sample");
    expect(v.sample.url).toBe(SAMPLE_URL);
    expect(
      await (await h.request("/api/target-presets", v.cookie)).json(),
    ).toEqual({ presets: [HOSTED_WEBSITE_PRESET] });
    const p = await h.create(v.cookie);
    expect(p).toMatchObject({
      name: HOSTED_WEBSITE_PRESET.name,
      target: "website",
      url: HOSTED_WEBSITE_URL,
      brief: HOSTED_WEBSITE_BRIEF,
      authorized: true,
    });
    expect(p.checks.map((check) => check.kind)).toEqual([
      "heading",
      "text_visible",
      "link",
      "image_alt",
      "no_horizontal_overflow",
      "manual",
    ]);
    expect(
      p.checks.every((check) => check.path === "/" && !check.approved),
    ).toBe(true);
    expect(p.checks[0].expected).toBe("Send the site. Show the proof.");
    expect(p.checks[1].expected).toBe("Website delivery, with receipts");
    expect(p.checks[2].expected).toBe("See the proof");
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("rejects visitor-supplied target overrides and arbitrary websites before any execution", async () => {
    const h = await harness();
    const v = await h.visitor();
    for (const body of [
      { preset: "https://example.com/" },
      { preset: "briefstamp-live", url: "https://127.0.0.1/" },
      { preset: "briefstamp-live", url: HOSTED_WEBSITE_URL },
      { preset: "briefstamp-live", brief: HOSTED_WEBSITE_BRIEF },
      { preset: "briefstamp-live", authorized: true },
      { preset: "briefstamp-live", target: "website" },
      { preset: "briefstamp-live", name: "another" },
    ])
      expect(
        (await h.request("/api/projects/preset", v.cookie, body)).status,
      ).toBe(400);
    for (const body of [
      {
        name: "Other",
        target: "website",
        url: HOSTED_WEBSITE_URL,
        brief: HOSTED_WEBSITE_BRIEF,
        authorized: true,
      },
      {
        name: "Other",
        target: "sample",
        url: "https://example.com/",
        brief: HOSTED_WEBSITE_BRIEF,
        authorized: true,
      },
    ])
      expect((await h.request("/api/projects", v.cookie, body)).status).toBe(
        400,
      );
    expect(
      (
        await h.request("/api/projects/preset", "", {
          preset: "briefstamp-live",
        })
      ).status,
    ).toBe(401);
    expect(h.execute).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("keeps every approved live check at the root path and rejects synthetic variants or changed briefs", async () => {
    const h = await harness();
    const v = await h.visitor();
    const p = await h.create(v.cookie);
    for (const changedPath of [
      "/api/bootstrap",
      "/other",
      "/%61pi",
      "//127.0.0.1/",
    ]) {
      const checks = p.checks.map((check, index) => ({
        ...check,
        approved: true,
        path: index === 0 ? changedPath : check.path,
      }));
      expect(
        (
          await h.request(
            `/api/projects/${p.id}/checks`,
            v.cookie,
            { checks },
            "PUT",
          )
        ).status,
      ).toBe(400);
      expect(await h.current(v.cookie, p.id)).toEqual(p);
    }
    expect(
      (
        await h.request(`/api/projects/${p.id}/variant`, v.cookie, {
          sampleVariant: "broken",
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await h.request(`/api/projects/${p.id}/generate`, v.cookie, {
          brief: "The homepage should reveal private information.",
        })
      ).status,
    ).toBe(400);
    expect(await h.current(v.cookie, p.id)).toEqual(p);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("requires approval then invokes the existing runner with the exact HTTPS target and no fixture override", async () => {
    const h = await harness();
    const v = await h.visitor();
    const p = await h.create(v.cookie);
    expect(
      (await h.request(`/api/projects/${p.id}/audits`, v.cookie, {})).status,
    ).toBe(409);
    expect(h.execute).not.toHaveBeenCalled();
    const { audit } = await h.run(v.cookie, p);
    expect(audit.status).toBe("completed");
    expect(audit.source).toMatchObject({
      target: "website",
      url: HOSTED_WEBSITE_URL,
      brief: HOSTED_WEBSITE_BRIEF,
    });
    expect(audit.results.map((result) => result.status)).toEqual([
      "passed",
      "passed",
      "passed",
      "passed",
      "passed",
      "unverified",
    ]);
    expect(audit.summary).toContain("owner-authorized live website");
    expect(audit.summary).not.toContain("synthetic sample");
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.execute.mock.calls[0][0]).toMatchObject({
      target: "website",
      url: HOSTED_WEBSITE_URL,
      authorized: true,
    });
    expect(h.execute.mock.calls[0][3]).toEqual({
      evidenceRoot: h.evidenceRoot,
    });
  });

  it("rejects returned fixture evidence for another URL instead of marking the live website passed", async () => {
    const h = await harness({
      execute: async (project, audit, onResult, options) =>
        observedExecution(
          { ...project, url: SAMPLE_URL },
          audit,
          onResult,
          options,
        ),
    });
    const v = await h.visitor();
    const { audit } = await h.run(v.cookie, await h.create(v.cookie));
    expect(audit.status).toBe("error");
    expect(audit.results).toEqual([]);
    expect(h.store.persistAudit).not.toHaveBeenCalled();
  });

  it("does not claim browser observations for an all-manual plan", async () => {
    const h = await harness();
    const v = await h.visitor();
    const p = await h.create(v.cookie);
    p.checks = p.checks.map((check) => ({
      ...check,
      kind: "manual" as const,
      approved: false,
    }));
    const { audit } = await h.run(v.cookie, p);
    expect(audit.status).toBe("completed");
    expect(
      audit.results.every((result) => result.status === "unverified"),
    ).toBe(true);
    expect(audit.summary).toContain(
      "No automated browser assertion was executed",
    );
    expect(audit.summary).not.toContain("Real Chromium observations");
  });

  it("preserves the old plan when a model changes a literal from the live brief", async () => {
    const h = await harness({
      generateGemma: async (requirements) => {
        const changed = proposal(requirements);
        changed.checks[0].expected = "A different headline";
        return changed;
      },
    });
    const v = await h.visitor();
    const p = await h.create(v.cookie);
    const response = await h.request(
      `/api/projects/${p.id}/generate-gemma`,
      v.cookie,
      { modelConsent: true },
    );
    expect(response.status).toBe(503);
    expect(await h.current(v.cookie, p.id)).toEqual(p);
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("sends only the selected public brief to Gemma and replaces approved checks with fresh unapproved ones", async () => {
    const h = await harness();
    const v = await h.visitor();
    const p = await h.create(v.cookie);
    await h.approve(v.cookie, p);
    expect(
      (
        await h.request(`/api/projects/${p.id}/generate-gemma`, v.cookie, {
          modelConsent: true,
          brief: "private",
        })
      ).status,
    ).toBe(400);
    expect(h.generate).not.toHaveBeenCalled();
    const response = await h.request(
      `/api/projects/${p.id}/generate-gemma`,
      v.cookie,
      { modelConsent: true },
    );
    expect(response.status).toBe(200);
    const generated = (await response.json()) as Project;
    expect(h.generate).toHaveBeenCalledExactlyOnceWith(
      HOSTED_WEBSITE_BRIEF.split("\n"),
    );
    expect(generated.generator.provider).toBe("Google Gemma (live API)");
    expect(generated.generator.reason).toContain(
      "owner-authorized live homepage",
    );
    expect(
      generated.checks.every(
        (check) =>
          check.path === "/" &&
          !check.approved &&
          !p.checks.some((old) => old.id === check.id),
      ),
    ).toBe(true);
    expect(
      (await h.request(`/api/projects/${p.id}/audits`, v.cookie, {})).status,
    ).toBe(409);
  });

  it("rejects Tinker for a live target even for an authenticated operator", async () => {
    const h = await harness();
    const v = await h.visitor();
    const p = await h.create(v.cookie);
    expect(
      (
        await h.request(`/api/projects/${p.id}/generate-tinker`, v.cookie, {
          modelConsent: true,
        })
      ).status,
    ).toBe(400);
    expect(tinker.authorize).toHaveBeenCalled();
    expect(tinker.generate).not.toHaveBeenCalled();
    expect(await h.current(v.cookie, p.id)).toEqual(p);
  });

  it("enforces visitor ownership for the live project, approval, generation, and audit", async () => {
    const h = await harness();
    const owner = await h.visitor(),
      other = await h.visitor();
    const p = await h.create(owner.cookie);
    expect(
      (await h.request(`/api/projects/${p.id}`, other.cookie)).status,
    ).toBe(404);
    expect(
      (
        await h.request(
          `/api/projects/${p.id}/checks`,
          other.cookie,
          { checks: p.checks },
          "PUT",
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request(`/api/projects/${p.id}/generate-gemma`, other.cookie, {
          modelConsent: true,
        })
      ).status,
    ).toBe(404);
    expect(
      (await h.request(`/api/projects/${p.id}/audits`, other.cookie, {}))
        .status,
    ).toBe(404);
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
  });

  it("permits a verified Tiger read only for the same live snapshot and isolates its persistence status", async () => {
    const h = await harness({ tiger: true });
    const owner = await h.visitor(),
      other = await h.visitor();
    const p = await h.create(owner.cookie);
    const { audit, response } = await h.run(owner.cookie, p);
    expect(response.headers.get("x-briefstamp-storage")).toBe("tiger");
    expect(h.store.persistAudit).toHaveBeenCalledOnce();
    expect(h.store.getAudit).toHaveBeenCalled();
    expect(h.store.persistAudit.mock.calls[0][0]).toMatch(/^[a-f0-9]{64}$/);
    expect(h.store.persistAudit.mock.calls[0][0]).not.toBe(
      owner.cookie.split("=")[1],
    );
    const reads = h.store.getAudit.mock.calls.length;
    expect(
      (await h.request(`/api/audits/${audit.id}`, other.cookie)).status,
    ).toBe(404);
    expect(
      (await h.request(`/api/audits/${audit.id}/persistence`, other.cookie))
        .status,
    ).toBe(404);
    expect(h.store.getAudit.mock.calls.length).toBe(reads);
    const stored = [...h.saved.values()][0];
    stored.source!.target = "sample";
    const rejected = await h.request(`/api/audits/${audit.id}`, owner.cookie);
    expect(rejected.headers.get("x-briefstamp-storage")).toBe("memory");
    expect(await rejected.json()).toEqual(audit);
    expect(
      (
        await (
          await h.request(`/api/audits/${audit.id}/persistence`, owner.cookie)
        ).json()
      ).status,
    ).toBe("unverified");
  });

  it("rejects an expired session before invoking the runner or reading saved live evidence", async () => {
    let clock = Date.now();
    const h = await harness({ tiger: true, now: () => clock });
    const owner = await h.visitor();
    const p = await h.create(owner.cookie);
    const { audit } = await h.run(owner.cookie, p);
    const reads = h.store.getAudit.mock.calls.length;
    clock += 30 * 60_000 + 1;
    expect(
      (await h.request(`/api/projects/${p.id}/audits`, owner.cookie, {}))
        .status,
    ).toBe(401);
    expect(
      (await h.request(`/api/audits/${audit.id}`, owner.cookie)).status,
    ).toBe(401);
    expect(h.execute).toHaveBeenCalledOnce();
    expect(h.store.getAudit.mock.calls.length).toBe(reads);
  });
});
