import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { z } from "zod";
import { createDemoRouter } from "../server/demo";
import { generateLocalChecks } from "../server/generator";
import type { generateHostedTinkerProposal } from "../server/hosted-tinker";
import type { generateGoogleGemmaProposal } from "../server/providers/gemma-google";
import type { runAudit } from "../server/runner";
import type { Audit, Bootstrap, CheckResult, Project } from "../shared/types";

const hosted = vi.hoisted(() => ({
  authorize: vi.fn(),
  enabled: vi.fn(),
  generate: vi.fn(),
  backboardAuthorize: vi.fn(),
  backboardEnabled: vi.fn(),
}));
vi.mock("../server/hosted-tinker", () => ({
  authorizeHostedTinker: hosted.authorize,
  hostTinkerEnabled: hosted.enabled,
  generateHostedTinkerProposal: hosted.generate,
}));
vi.mock("../server/hosted-backboard", () => ({
  authorizeHostedBackboard: hosted.backboardAuthorize,
  hostBackboardEnabled: hosted.backboardEnabled,
  rememberHostedAudit: vi.fn(),
  recallHostedMemory: vi.fn(),
}));

const OPERATOR_TOKEN = ["synthetic", "tinker", "operator", "token", "at", "least", "32", "characters"].join("-");
const CHECKPOINT =
  "tinker://private-test-training:train:0/sampler_weights/private-test";
const DEMO_BRIEF =
  'The homepage heading must say "Design that moves business forward."\nA contact link must say "Start a project".\nEvery content image must have nonempty alternative text.\nThe homepage must fit a 390px mobile screen without horizontal scrolling.\nThe homepage must show "Independent by design."\nThe site should feel welcoming and trustworthy.';
type TinkerResult = Awaited<ReturnType<typeof generateHostedTinkerProposal>>;
type Visitor = { cookie: string; project: Project; bootstrap: Bootstrap };
const cleanups: Array<() => Promise<void>> = [];
const releasePending: Array<() => void> = [];

// Trusted local fixtures exercise routing only; none are model or browser evidence.
function proposal(requirements = DEMO_BRIEF.split("\n")): TinkerResult {
  return {
    checks: generateLocalChecks(requirements.join("\n")),
    model: CHECKPOINT,
    usage: { prompt_tokens: 321, completion_tokens: 123 },
    reservedTokens: 12000,
    sourcePunctuationRestored: requirements.map(() => false),
    redacted: requirements.map(() => false),
  };
}
const gemmaProposal: typeof generateGoogleGemmaProposal = async (
  requirements,
) => ({
  model: "gemma-4-26b-a4b-it",
  checks: generateLocalChecks(requirements.join("\n")).map(
    (
      { requirement: _requirement, id: _id, approved: _approved, ...check },
      requirementIndex,
    ) => ({
      ...check,
      requirementIndex,
    }),
  ),
  latencyMs: 1,
  usage: { promptTokens: 321, completionTokens: 123, totalTokens: 444 },
});
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
      observed: "Trusted test fixture; not real browser evidence",
      url: "https://sample.flowproof.test/",
      viewport: { width: 1365, height: 900 },
    },
  }));
  for (const result of results) await onResult(result);
  return results;
};
function deferred<T>(fallback: () => T) {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  releasePending.push(() => resolve(fallback()));
  return { promise, resolve };
}

beforeEach(() => {
  vi.resetAllMocks();
  hosted.authorize.mockImplementation(
    (headers) => headers["x-flowproof-token"] === OPERATOR_TOKEN,
  );
  hosted.enabled.mockReturnValue(true);
  hosted.generate.mockImplementation(async (requirements: string[]) =>
    proposal(requirements),
  );
  hosted.backboardAuthorize.mockReturnValue(false);
  hosted.backboardEnabled.mockReturnValue(false);
});
afterEach(async () => {
  for (const release of releasePending.splice(0)) release();
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

async function harness(
  options: {
    generateTinker?: typeof generateHostedTinkerProposal;
    tinkerAvailable?: () => boolean;
    generateGemma?: typeof generateGoogleGemmaProposal;
    now?: () => number;
    execute?: typeof runAudit;
  } = {},
) {
  const evidenceRoot = await mkdtemp(
    path.join(tmpdir(), "briefstamp-demo-tinker-"),
  );
  const generate = options.generateTinker
    ? vi.fn(options.generateTinker)
    : hosted.generate;
  const gemma = vi.fn(options.generateGemma ?? gemmaProposal);
  const pricing = vi.fn(async () => ({ verified: true }));
  const execute = vi.fn(options.execute ?? observedExecution);
  const demo = createDemoRouter({
    evidenceRoot,
    secureCookie: false,
    now: options.now,
    ...(options.generateTinker ? { generateTinker: generate } : {}),
    ...(options.tinkerAvailable
      ? { tinkerAvailable: options.tinkerAvailable }
      : {}),
    gemmaAvailable: () => true,
    generateGemma: gemma,
    verifyGemmaFree: pricing,
    execute,
  });
  const app = express();
  app.use(express.json({ limit: "64kb" }));
  app.use(demo.router);
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
    const listener = app.listen(0, "127.0.0.1", (error?: Error) =>
      error ? reject(error) : resolve(listener),
    );
  });
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  cleanups.push(async () => {
    await demo.dispose();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(evidenceRoot, { recursive: true, force: true });
  });
  const request = (
    route: string,
    cookie = "",
    body?: unknown,
    token?: string,
    method = body === undefined ? "GET" : "POST",
    origin?: string,
  ) =>
    fetch(base + route, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
        ...(token ? { "x-flowproof-token": token } : {}),
        ...(origin ? { origin } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const visitor = async (): Promise<Visitor> => {
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
    visitor: Visitor,
    body: unknown = { modelConsent: true },
    token = OPERATOR_TOKEN,
  ) =>
    request(
      `/api/projects/${visitor.project.id}/generate-tinker`,
      visitor.cookie,
      body,
      token,
    );
  const current = async (visitor: Visitor): Promise<Project> =>
    (
      await request(`/api/projects/${visitor.project.id}`, visitor.cookie)
    ).json();
  const approve = async (visitor: Visitor): Promise<Project> => {
    const project = await current(visitor);
    const response = await request(
      `/api/projects/${project.id}/checks`,
      visitor.cookie,
      { checks: project.checks.map((check) => ({ ...check, approved: true })) },
      undefined,
      "PUT",
    );
    expect(response.status).toBe(200);
    return response.json();
  };
  return {
    request,
    visitor,
    generateFor,
    current,
    approve,
    generate,
    gemma,
    pricing,
    execute,
  };
}

describe("hosted Tinker operator route", () => {
  it("hides projects and validates operator authorization before project lookup or request bodies", async () => {
    const h = await harness();
    const a = await h.visitor(),
      b = await h.visitor();
    for (const [id, cookie] of [
      [a.project.id, a.cookie],
      [a.project.id, b.cookie],
      ["unknown", a.cookie],
      ["unknown", ""],
    ]) {
      const response = await h.request(
        `/api/projects/${id}/generate-tinker`,
        cookie,
        { unsafe: true },
      );
      expect(response.status).toBe(404);
    }
    expect((await h.generateFor(a, {}, "wrong-operator-token")).status).toBe(
      404,
    );
    expect(
      (
        await h.request(
          `/api/projects/${a.project.id}/generate-tinker`,
          "",
          { modelConsent: true },
          OPERATOR_TOKEN,
        )
      ).status,
    ).toBe(401);
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.gemma).not.toHaveBeenCalled();
    expect(await h.current(a)).toEqual(a.project);
  });

  it("requires strict consent, the owning session and same-origin writes before generation", async () => {
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
          `/api/projects/${a.project.id}/generate-tinker`,
          b.cookie,
          { modelConsent: true },
          OPERATOR_TOKEN,
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await h.request(
          `/api/projects/${a.project.id}/generate-tinker`,
          a.cookie,
          { modelConsent: true },
          OPERATOR_TOKEN,
          "POST",
          "https://other.invalid",
        )
      ).status,
    ).toBe(403);
    expect(h.generate).not.toHaveBeenCalled();
    expect(h.pricing).not.toHaveBeenCalled();
  });

  it("marks an unavailable hosted model honestly while retaining offline evaluation evidence", async () => {
    const h = await harness({ tinkerAvailable: () => false });
    const a = await h.visitor();
    expect(a.bootstrap.demo?.tinker?.available).toBe(false);
    expect(
      a.bootstrap.integrations.find((item) => item.name === "Tinker")?.status,
    ).toBe("not_configured");
    expect(a.bootstrap.evaluation).toBeTruthy();
    expect((await h.generateFor(a)).status).toBe(503);
    expect(h.generate).not.toHaveBeenCalled();
    expect(await h.current(a)).toEqual(a.project);
  });

  it("rejects a visitor-edited brief before sending anything to Tinker", async () => {
    const h = await harness();
    const a = await h.visitor();
    const edited = await h.request(
      `/api/projects/${a.project.id}/generate`,
      a.cookie,
      { brief: 'The homepage must say "Private visitor text".' },
    );
    expect(edited.status).toBe(200);
    const expected: Project = await edited.json();
    expect((await h.generateFor(a)).status).toBe(400);
    expect(h.generate).not.toHaveBeenCalled();
    expect(await h.current(a)).toEqual(expected);
  });

  it("publishes fresh unapproved source-bound checks and token usage without exposing the checkpoint", async () => {
    const returned = proposal();
    const h = await harness({ generateTinker: async () => returned });
    const a = await h.visitor();
    const before = await h.approve(a);
    const response = await h.generateFor(a);
    expect(response.status).toBe(200);
    const p: Project = await response.json();
    expect(h.generate).toHaveBeenCalledExactlyOnceWith(
      a.project.brief.split("\n"),
    );
    expect(h.pricing).not.toHaveBeenCalled();
    expect(h.gemma).not.toHaveBeenCalled();
    expect(p.checks.map((check) => check.requirement)).toEqual(
      a.project.brief.split("\n"),
    );
    expect(p.checks.every((check) => !check.approved)).toBe(true);
    expect(
      p.checks.every(
        (check) => !before.checks.some((old) => old.id === check.id),
      ),
    ).toBe(true);
    expect(
      p.checks.every(
        (check) => !returned.checks.some((old) => old.id === check.id),
      ),
    ).toBe(true);
    expect(p.generator).toMatchObject({
      provider: "Tinker (live trained checkpoint)",
      model: "Qwen/Qwen3.5-4B",
    });
    expect(p.generator.reason).toContain("321");
    expect(p.generator.reason).toContain("123");
    expect(p.generator.reason).toContain("12000");
    expect(JSON.stringify(p)).not.toContain(CHECKPOINT);
    expect(p.checks[5].kind).toBe("manual");
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
    const id = (await started.json()).id;
    await vi.waitFor(async () => {
      const audit: Audit = await (
        await h.request(`/api/audits/${id}`, a.cookie)
      ).json();
      expect(audit.status).toBe("completed");
      expect(audit.source?.generator.provider).toBe(
        "Tinker (live trained checkpoint)",
      );
      expect(
        audit.results.find((result) => result.kind === "manual")?.status,
      ).toBe("unverified");
    });
  });

  it.each(["approval", "variant", "brief"] as const)(
    "preserves a newer %s change when inference completes with the same timestamp",
    async (change) => {
      const gate = deferred(proposal);
      const h = await harness({
        now: () => 1800000000000,
        generateTinker: () => gate.promise,
      });
      const a = await h.visitor();
      const pending = h.generateFor(a);
      await vi.waitFor(() => expect(h.generate).toHaveBeenCalledOnce());
      let edited: Project;
      if (change === "approval") edited = await h.approve(a);
      else {
        const response = await h.request(
          `/api/projects/${a.project.id}/${change === "variant" ? "variant" : "generate"}`,
          a.cookie,
          change === "variant"
            ? { sampleVariant: "broken" }
            : { brief: 'The homepage must show "A later edit".' },
        );
        expect(response.status).toBe(200);
        edited = await response.json();
      }
      expect(edited.updatedAt).toBe(a.project.updatedAt);
      gate.resolve(proposal());
      expect((await pending).status).toBe(409);
      expect(await h.current(a)).toEqual(edited);
    },
  );

  it("never saves generated checks after the visitor session expires", async () => {
    let time = 1800000000000;
    const gate = deferred(proposal);
    const h = await harness({
      now: () => time,
      generateTinker: () => gate.promise,
    });
    const a = await h.visitor();
    const pending = h.generateFor(a);
    await vi.waitFor(() => expect(h.generate).toHaveBeenCalledOnce());
    time += 31 * 60000;
    gate.resolve(proposal());
    expect((await pending).status).toBe(401);
    expect(
      (await h.request(`/api/projects/${a.project.id}`, a.cookie)).status,
    ).toBe(401);
  });

  it("preserves the approved plan on a provider failure and releases the shared slot without fallback", async () => {
    let reject = true;
    const h = await harness({
      generateTinker: async () => {
        if (reject) throw new Error("private-provider-secret failure");
        return proposal();
      },
    });
    const a = await h.visitor();
    const before = await h.approve(a);
    const response = await h.generateFor(a);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("private-provider-secret");
    expect(await h.current(a)).toEqual(before);
    expect(h.gemma).not.toHaveBeenCalled();
    reject = false;
    expect((await h.generateFor(a)).status).toBe(200);
  });

  it.each(["source", "literal", "missing", "approved", "script"] as const)(
    "rejects a %s result without changing the approved plan",
    async (failure) => {
      const invalid = proposal();
      if (failure === "source")
        invalid.checks[0].requirement =
          'The homepage heading must say "Wrong source".';
      if (failure === "literal") invalid.checks[0].expected = "Wrong heading";
      if (failure === "missing") invalid.checks.pop();
      if (failure === "approved") invalid.checks[0].approved = true;
      if (failure === "script")
        Object.assign(invalid.checks[0], { script: "danger()" });
      const h = await harness({ generateTinker: async () => invalid });
      const a = await h.visitor();
      const before = await h.approve(a);
      expect((await h.generateFor(a)).status).toBe(503);
      expect(await h.current(a)).toEqual(before);
      expect(h.gemma).not.toHaveBeenCalled();
      expect(h.execute).not.toHaveBeenCalled();
    },
  );

  it("blocks other Tinker calls, Gemma and audits while Tinker owns the shared execution slot", async () => {
    const gate = deferred(proposal);
    const h = await harness({ generateTinker: () => gate.promise });
    const a = await h.visitor(),
      b = await h.visitor();
    await h.approve(b);
    const pending = h.generateFor(a);
    await vi.waitFor(() => expect(h.generate).toHaveBeenCalledOnce());
    expect((await h.generateFor(b)).status).toBe(429);
    expect(
      (
        await h.request(
          `/api/projects/${b.project.id}/generate-gemma`,
          b.cookie,
          { modelConsent: true },
        )
      ).status,
    ).toBe(429);
    expect(
      (await h.request(`/api/projects/${b.project.id}/audits`, b.cookie, {}))
        .status,
    ).toBe(409);
    expect(h.gemma).not.toHaveBeenCalled();
    expect(h.pricing).not.toHaveBeenCalled();
    expect(h.execute).not.toHaveBeenCalled();
    gate.resolve(proposal());
    expect((await pending).status).toBe(200);
  });

  it("blocks Tinker while Gemma owns the shared execution slot", async () => {
    const fixture = await gemmaProposal(DEMO_BRIEF.split("\n"));
    const gate = deferred(() => fixture);
    const h = await harness({ generateGemma: () => gate.promise });
    const a = await h.visitor(),
      b = await h.visitor();
    const pending = h.request(
      `/api/projects/${a.project.id}/generate-gemma`,
      a.cookie,
      { modelConsent: true },
    );
    await vi.waitFor(() => expect(h.gemma).toHaveBeenCalledOnce());
    expect((await h.generateFor(b)).status).toBe(429);
    expect(h.generate).not.toHaveBeenCalled();
    gate.resolve(fixture);
    expect((await pending).status).toBe(200);
    expect((await h.generateFor(b)).status).toBe(200);
  });

  it("blocks Tinker while the browser audit owns the shared execution slot", async () => {
    const gate = deferred(() => undefined);
    const h = await harness({
      execute: async (...args) => {
        await gate.promise;
        return observedExecution(...args);
      },
    });
    const a = await h.visitor(),
      b = await h.visitor();
    await h.approve(a);
    const started = await h.request(
      `/api/projects/${a.project.id}/audits`,
      a.cookie,
      {},
    );
    expect(started.status).toBe(202);
    expect((await h.generateFor(b)).status).toBe(429);
    expect(h.generate).not.toHaveBeenCalled();
    gate.resolve(undefined);
    const id = (await started.json()).id;
    await vi.waitFor(async () => {
      const audit: Audit = await (
        await h.request(`/api/audits/${id}`, a.cookie)
      ).json();
      expect(audit.status).toBe("completed");
    });
    expect((await h.generateFor(b)).status).toBe(200);
  });

  it("authorizes Tinker operator status independently of Backboard configuration", async () => {
    const h = await harness();
    const a = await h.visitor();
    expect((await h.request("/api/operator/status", a.cookie)).status).toBe(
      404,
    );
    const response = await h.request(
      "/api/operator/status",
      a.cookie,
      undefined,
      OPERATOR_TOKEN,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      backboard: false,
      tinker: true,
    });
    expect(h.generate).not.toHaveBeenCalled();
  });
});
