import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { Audit, Bootstrap, CheckResult, Project } from "../shared/types";
import { createDemoRouter } from "../server/demo";
import type { runAudit } from "../server/runner";
import {
  GOOGLE_GEMMA_MODEL,
  type generateGoogleGemmaProposal,
  type GoogleGemmaProposalResult,
} from "../server/providers/gemma-google";

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function proposal(): GoogleGemmaProposalResult {
  return {
    model: GOOGLE_GEMMA_MODEL,
    latencyMs: 25,
    usage: { promptTokens: 150, completionTokens: 120, totalTokens: 270 },
    checks: [
      {
        requirementIndex: 0,
        kind: "heading",
        path: "/",
        expected: "Design that moves business forward.",
        viewport: "desktop",
      },
      {
        requirementIndex: 1,
        kind: "link",
        path: "/",
        expected: "Start a project",
        viewport: "desktop",
      },
      {
        requirementIndex: 2,
        kind: "image_alt",
        path: "/",
        expected: "nonempty alt",
        viewport: "desktop",
      },
      {
        requirementIndex: 3,
        kind: "no_horizontal_overflow",
        path: "/",
        expected: "no horizontal scrolling",
        viewport: "mobile",
      },
      {
        requirementIndex: 4,
        kind: "text_visible",
        path: "/",
        expected: "Independent by design.",
        viewport: "desktop",
      },
      {
        requirementIndex: 5,
        kind: "manual",
        path: "/",
        expected: "A human must review this",
        viewport: "desktop",
      },
    ],
  };
}
const observedExecution: typeof runAudit = async (
  _project,
  audit,
  onResult,
) => {
  const results: CheckResult[] = audit.checks.map((check) => ({
    checkId: check.id,
    requirement: check.requirement,
    expected: check.expected,
    kind: check.kind,
    status: check.kind === "manual" ? "unverified" : "passed",
    durationMs: 1,
    evidence: {
      observed: "Trusted test fixture, not real browser proof",
      url: "https://sample.flowproof.test/",
      viewport: { width: 1365, height: 900 },
    },
  }));
  for (const result of results) await onResult(result);
  return results;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function harness(
  options: {
    generateGemma?: typeof generateGoogleGemmaProposal;
    verifyGemmaFree?: () => Promise<unknown>;
    gemmaAvailable?: () => boolean;
    now?: () => number;
    execute?: typeof runAudit;
  } = {},
) {
  const evidenceRoot = await mkdtemp(
    path.join(tmpdir(), "briefstamp-demo-gemma-"),
  );
  const generate = vi.fn<typeof generateGoogleGemmaProposal>(
    options.generateGemma ?? (async () => proposal()),
  );
  const pricing = vi.fn(
    options.verifyGemmaFree ?? (async () => ({ verified: true })),
  );
  const execute = vi.fn<typeof runAudit>(options.execute ?? observedExecution);
  const demo = createDemoRouter({
    evidenceRoot,
    secureCookie: false,
    now: options.now,
    gemmaAvailable: options.gemmaAvailable ?? (() => true),
    generateGemma: generate,
    verifyGemmaFree: pricing,
    execute,
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
    origin?: string,
  ) =>
    fetch(base + route, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(origin ? { origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const visitor = async () => {
    const response = await request("/api/bootstrap");
    expect(response.status).toBe(200);
    const bootstrap: Bootstrap = await response.json();
    return {
      cookie: response.headers.get("set-cookie")!.split(";")[0],
      project: bootstrap.projects[0],
      bootstrap,
    };
  };
  const generateFor = (
    visitor: { cookie: string; project: Project },
    body: unknown = { modelConsent: true },
  ) =>
    request(
      `/api/projects/${visitor.project.id}/generate-gemma`,
      visitor.cookie,
      body,
    );
  const current = async (visitor: {
    cookie: string;
    project: Project;
  }): Promise<Project> =>
    (
      await request(`/api/projects/${visitor.project.id}`, visitor.cookie)
    ).json();
  const approve = async (visitor: { cookie: string; project: Project }) => {
    const p = await current(visitor);
    const result = await request(
      `/api/projects/${p.id}/checks`,
      visitor.cookie,
      { checks: p.checks.map((check) => ({ ...check, approved: true })) },
      "PUT",
    );
    expect(result.status).toBe(200);
    return result.json() as Promise<Project>;
  };
  return {
    request,
    visitor,
    generateFor,
    current,
    approve,
    generate,
    pricing,
    execute,
  };
}

describe("public Gemma generation boundary", () => {
  it("requires explicit strict consent, same-origin writes, and session ownership before I/O", async () => {
    const h = await harness();
    const a = await h.visitor(),
      b = await h.visitor();
    for (const body of [
      {},
      { modelConsent: false },
      { modelConsent: true, brief: "private" },
    ])
      expect((await h.generateFor(a, body)).status).toBe(400);
    expect(
      (
        await h.request(
          `/api/projects/${a.project.id}/generate-gemma`,
          b.cookie,
          { modelConsent: true },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request(
          `/api/projects/${a.project.id}/generate-gemma`,
          a.cookie,
          { modelConsent: true },
          "POST",
          "https://other.invalid",
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await h.request(`/api/projects/${a.project.id}/generate-gemma`, "", {
          modelConsent: true,
        })
      ).status,
    ).toBe(401);
    expect(h.pricing).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
    expect(await h.current(a)).toEqual(a.project);
  });

  it("rejects disabled AI and custom briefs without calling pricing or generation", async () => {
    let available = false;
    const h = await harness({ gemmaAvailable: () => available });
    const a = await h.visitor();
    expect(a.bootstrap.demo?.gemma?.available).toBe(false);
    expect((await h.generateFor(a)).status).toBe(503);
    available = true;
    const changed = await h.request(
      `/api/projects/${a.project.id}/generate`,
      a.cookie,
      { brief: 'The homepage must say "A private visitor brief".' },
    );
    const expected: Project = await changed.json();
    expect((await h.generateFor(a)).status).toBe(400);
    expect(await h.current(a)).toEqual(expected);
    expect(h.pricing).not.toHaveBeenCalled();
    expect(h.generate).not.toHaveBeenCalled();
  });

  it("replaces an approved plan with freshly identified unapproved AI checks bound to the original brief", async () => {
    const h = await harness();
    const a = await h.visitor();
    const before = await h.approve(a);
    const generated = await h.generateFor(a);
    expect(generated.status).toBe(200);
    const p: Project = await generated.json();
    expect(h.pricing).toHaveBeenCalledTimes(1);
    expect(h.generate).toHaveBeenCalledWith(a.project.brief.split("\n"));
    expect(p.brief).toBe(a.project.brief);
    expect(p.checks.map((check) => check.requirement)).toEqual(
      a.project.brief.split("\n"),
    );
    expect(p.checks.every((check) => !check.approved)).toBe(true);
    expect(
      p.checks.every(
        (check) => !before.checks.some((old) => old.id === check.id),
      ),
    ).toBe(true);
    expect(p.generator).toMatchObject({
      provider: "Google Gemma (live API)",
      model: GOOGLE_GEMMA_MODEL,
    });
    expect(
      (await h.request(`/api/projects/${p.id}/audits`, a.cookie, {})).status,
    ).toBe(409);
    expect(h.execute).not.toHaveBeenCalled();
    await h.approve(a);
    const started = await h.request(
      `/api/projects/${p.id}/audits`,
      a.cookie,
      {},
    );
    expect(started.status).toBe(202);
    const auditId = (await started.json()).id;
    await vi.waitFor(async () => {
      const audit: Audit = await (
        await h.request(`/api/audits/${auditId}`, a.cookie)
      ).json();
      expect(audit.status).toBe("completed");
      expect(audit.source?.generator.provider).toBe("Google Gemma (live API)");
      expect(
        audit.results.find((result) => result.kind === "manual")?.status,
      ).toBe("unverified");
    });
  });

  it("keeps newer same-timestamp edits when a generation response arrives late", async () => {
    const gate = deferred<GoogleGemmaProposalResult>();
    const h = await harness({
      now: () => 1_800_000_000_000,
      generateGemma: () => gate.promise,
    });
    const a = await h.visitor();
    const pending = h.generateFor(a);
    await vi.waitFor(() => expect(h.generate).toHaveBeenCalledTimes(1));
    const edited = await h.approve(a);
    expect(edited.updatedAt).toBe(a.project.updatedAt);
    gate.resolve(proposal());
    expect((await pending).status).toBe(409);
    expect(await h.current(a)).toEqual(edited);
  });

  it("does not save generated checks after session expiry", async () => {
    let time = 1_800_000_000_000;
    const gate = deferred<GoogleGemmaProposalResult>();
    const h = await harness({
      now: () => time,
      generateGemma: () => gate.promise,
    });
    const a = await h.visitor();
    const pending = h.generateFor(a);
    await vi.waitFor(() => expect(h.generate).toHaveBeenCalledTimes(1));
    time += 31 * 60_000;
    gate.resolve(proposal());
    expect((await pending).status).toBe(401);
    expect(
      (await h.request(`/api/projects/${a.project.id}`, a.cookie)).status,
    ).toBe(401);
  });

  it("reserves a single global slot before awaiting pricing and consumes failed attempts", async () => {
    const gate = deferred<unknown>();
    const h = await harness({
      verifyGemmaFree: () => gate.promise,
      generateGemma: async () => {
        throw new Error("private provider error");
      },
    });
    const a = await h.visitor(),
      b = await h.visitor();
    const pending = h.generateFor(a);
    await vi.waitFor(() => expect(h.pricing).toHaveBeenCalledTimes(1));
    expect((await h.generateFor(b)).status).toBe(429);
    expect((await h.generateFor(a)).status).toBe(429);
    expect(h.generate).not.toHaveBeenCalled();
    gate.resolve({ verified: true });
    expect((await pending).status).toBe(503);
    expect((await h.generateFor(a)).status).toBe(503);
    expect((await h.generateFor(a)).status).toBe(429);
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(await h.current(a)).toEqual(a.project);
    expect((await h.generateFor(b)).status).toBe(503);
  });

  it("caps twelve attempted generations per hour across visitors and reopens after the window", async () => {
    let time = 1_800_000_000_000;
    const h = await harness({
      now: () => time,
      generateGemma: async () => {
        throw new Error("fixture failure");
      },
    });
    for (let i = 0; i < 6; i++) {
      const a = await h.visitor();
      expect((await h.generateFor(a)).status).toBe(503);
      expect((await h.generateFor(a)).status).toBe(503);
      expect((await h.generateFor(a)).status).toBe(429);
    }
    const blocked = await h.visitor();
    expect((await h.generateFor(blocked)).status).toBe(429);
    expect(h.generate).toHaveBeenCalledTimes(12);
    time += 60 * 60_000;
    const fresh = await h.visitor();
    expect((await h.generateFor(fresh)).status).toBe(503);
    expect(h.generate).toHaveBeenCalledTimes(13);
  });

  it("fails closed on pricing failure without inference and preserves the approved plan", async () => {
    const h = await harness({
      verifyGemmaFree: async () => {
        throw new Error("pricing unavailable");
      },
    });
    const a = await h.visitor();
    const before = await h.approve(a);
    for (let i = 0; i < 2; i++) {
      const result = await h.generateFor(a);
      expect(result.status).toBe(503);
      expect(await result.text()).not.toContain("pricing unavailable");
    }
    expect((await h.generateFor(a)).status).toBe(429);
    expect(h.generate).not.toHaveBeenCalled();
    expect(await h.current(a)).toEqual(before);
  });

  it.each(["literal", "missing", "unknown"] as const)(
    "keeps the approved plan when a %s model proposal fails server validation",
    async (failure) => {
      const invalid = proposal();
      if (failure === "literal")
        invalid.checks[0].expected = "Wrong requested heading";
      if (failure === "missing") invalid.checks.pop();
      if (failure === "unknown")
        Object.assign(invalid.checks[0], { approved: true });
      const h = await harness({ generateGemma: async () => invalid });
      const a = await h.visitor();
      const before = await h.approve(a);
      expect((await h.generateFor(a)).status).toBe(503);
      expect(await h.current(a)).toEqual(before);
    },
  );

  it("forces subjective requirements to manual even if the model proposes an executable check", async () => {
    const proposed = proposal();
    proposed.checks[5] = {
      requirementIndex: 5,
      kind: "heading",
      path: "/",
      expected: "trustworthy",
      viewport: "desktop",
    };
    const h = await harness({ generateGemma: async () => proposed });
    const a = await h.visitor();
    const result = await h.generateFor(a);
    expect(result.status).toBe(200);
    const p: Project = await result.json();
    expect(p.checks[5]).toMatchObject({
      kind: "manual",
      approved: false,
      requirement: a.project.checks[5].requirement,
    });
  });

  it("rejects a runner that marks a generated manual requirement as passed", async () => {
    const h = await harness({
      execute: async (project, audit, onResult, options) => {
        const results = await observedExecution(
          project,
          audit,
          () => {},
          options,
        );
        results.find((result) => result.kind === "manual")!.status = "passed";
        for (const result of results) await onResult(result);
        return results;
      },
    });
    const a = await h.visitor();
    expect((await h.generateFor(a)).status).toBe(200);
    await h.approve(a);
    const started = await h.request(
      `/api/projects/${a.project.id}/audits`,
      a.cookie,
      {},
    );
    const auditId = (await started.json()).id;
    await vi.waitFor(async () => {
      const audit: Audit = await (
        await h.request(`/api/audits/${auditId}`, a.cookie)
      ).json();
      expect(audit.status).toBe("error");
      expect(
        audit.results.some(
          (result) => result.kind === "manual" && result.status === "passed",
        ),
      ).toBe(false);
    });
  });
});
